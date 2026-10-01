/**
 * Pure Rollback game engine. No Firebase, no DOM: every function takes a state
 * and returns a new one, so it can run inside a Realtime Database transaction
 * on any client and be unit-tested in isolation.
 *
 * What counts as a play, what beats what, the bag and the deal all come from the
 * game's ruleset (rulesets.ts); this file runs the turn structure around them.
 */
import { bagSize, buildBag, roll, shuffle, type Die, type Rng } from './dice';
import { describePlay } from './plays';
import { classifyTable, DEFAULT_RULESET_ID, getRuleset, type Ruleset, type RulesetId } from './rulesets';

const LOG_LIMIT = 40;

export type Phase = 'playing' | 'roundOver' | 'gameOver';

export interface TablePlay {
    playerId: string;
    dice: Die[];
}

export interface GameState {
    /** Unique per game (rooms are short-lived and their codes get reused). */
    gameId: string;
    /** Which ruleset this game is played under (see rulesets.ts). */
    rulesetId: RulesetId;
    /** Counts committed state changes (moves and round starts); orders telemetry events. */
    seq: number;
    round: number;
    /** Trick number within the round, starting at 1. */
    trick: number;
    totalRounds: number;
    handSize: number;
    /** Player ids in clockwise order. */
    seating: string[];
    names: Record<string, string>;
    hands: Record<string, Die[]>;
    table: TablePlay | null;
    /** Player whose move it is. */
    turn: string;
    /** Players who have passed since the last play (soft passes: they may still play later). */
    passed: string[];
    /** Per player, the dice most recently picked up or rerolled, so the UI can highlight them. */
    rolled: Record<string, string[]>;
    /** Finishing order this round. */
    finished: string[];
    scores: Record<string, number>;
    firstPlaces: Record<string, number>;
    /** Finishing order of every completed round. */
    roundResults: string[][];
    phase: Phase;
    /** Newest last. */
    log: string[];
}

export type Action =
    | { type: 'play'; playerId: string; dieIds: string[]; takeBackId?: string }
    | { type: 'pass'; playerId: string; rerollIds: string[] }
    | { type: 'pickup'; playerId: string; dieId: string }
    | { type: 'replace'; playerId: string; handDieId: string; tableDieId: string };

export class GameError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'GameError';
    }
}

export interface PlayerSeat {
    id: string;
    name: string;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/** The ruleset a game is played under. */
export function rulesOf(state: Pick<GameState, 'rulesetId'>): Ruleset {
    return getRuleset(state.rulesetId);
}

export function startGame(
    players: PlayerSeat[],
    rng: Rng = Math.random,
    options: { rulesetId?: RulesetId; handSize?: number; totalRounds?: number; gameId?: string } = {},
): GameState {
    const rulesetId = options.rulesetId ?? DEFAULT_RULESET_ID;
    const rules = getRuleset(rulesetId);
    if (players.length < rules.minPlayers || players.length > rules.maxPlayers) {
        throw new GameError(`${rules.name} needs ${rules.minPlayers}–${rules.maxPlayers} players`);
    }
    const handSize = options.handSize ?? rules.handSize;
    if (handSize * players.length > bagSize(rules.bag)) {
        throw new GameError(`Not enough dice in the bag to deal ${handSize} each to ${players.length} players`);
    }
    const seating = players.map(p => p.id);
    const zeroes = Object.fromEntries(seating.map(id => [id, 0]));
    const base: GameState = {
        gameId: options.gameId ?? '',
        rulesetId,
        seq: 0,
        round: 0,
        trick: 0,
        totalRounds: options.totalRounds ?? rules.rounds,
        handSize,
        seating,
        names: Object.fromEntries(players.map(p => [p.id, p.name])),
        hands: {},
        table: null,
        turn: seating[0],
        passed: [],
        rolled: {},
        finished: [],
        scores: { ...zeroes },
        firstPlaces: { ...zeroes },
        roundResults: [],
        phase: 'roundOver',
        log: [],
    };
    // First round: random starting player.
    const leader = seating[Math.floor(rng() * seating.length)];
    return dealRound(base, leader, rng);
}

/** Host action between rounds. The first player out last round leads. */
export function startNextRound(state: GameState, rng: Rng = Math.random): GameState {
    if (state.phase !== 'roundOver') throw new GameError('The round is not over yet');
    const lastRound = state.roundResults[state.roundResults.length - 1];
    return { ...dealRound(state, lastRound[0], rng), seq: state.seq + 1 };
}

function dealRound(state: GameState, leader: string, rng: Rng): GameState {
    const bag = shuffle(buildBag(rulesOf(state).bag), rng);
    const hands: Record<string, Die[]> = {};
    for (const id of state.seating) {
        hands[id] = bag.splice(0, state.handSize).map(d => roll(d, rng));
    }
    const round = state.round + 1;
    return {
        ...state,
        round,
        trick: 1,
        hands,
        table: null,
        turn: leader,
        passed: [],
        rolled: {},
        finished: [],
        phase: 'playing',
        log: appendLog(state.log, `Round ${round} begins. ${state.names[leader]} leads.`),
    };
}

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

export function applyAction(state: GameState, action: Action, rng: Rng = Math.random): GameState {
    if (state.phase !== 'playing') throw new GameError('The round is over');
    if (state.turn !== action.playerId) throw new GameError("It's not your turn");
    const next = action.type === 'play' ? applyPlay(state, action.playerId, action.dieIds, rng, action.takeBackId)
        : action.type === 'pass' ? applyPass(state, action.playerId, action.rerollIds, rng)
        : action.type === 'pickup' ? applyPickup(state, action.playerId, action.dieId, rng)
        : applyReplace(state, action.playerId, action.handDieId, action.tableDieId, rng);
    return { ...next, seq: state.seq + 1 };
}

function applyPlay(state: GameState, playerId: string, dieIds: string[], rng: Rng, takeBackId?: string): GameState {
    const hand = state.hands[playerId] ?? [];
    const rules = rulesOf(state);
    const dice = pickDice(hand, dieIds);
    const play = rules.classifyPlay(dice);
    if (!play) throw new GameError('Those dice are not a single, set, run, or bomb');

    const name = state.names[playerId];
    let remaining = hand.filter(d => !dieIds.includes(d.id));
    let pickedUp: Die[] = [];
    let log: string[];

    if (!state.table) {
        if (play.kind !== 'single') throw new GameError('The leader plays one die');
        log = appendLog(state.log, `${name} leads ${describePlay(play)}.`);
    } else {
        const tablePlay = classifyTable(rules, state.table.dice)!;
        if (!rules.beats(play, tablePlay)) {
            throw new GameError(`${describePlay(play)} does not beat ${describePlay(tablePlay)}`);
        }
        if (play.kind === 'bomb' && rules.bombPenalty && remaining.length > 0) {
            // A costly bomb: take back one of the bombed dice (bomber's choice), rerolled.
            const taken = bombPenaltyDie(state.table.dice, takeBackId);
            pickedUp = [roll(taken, rng)];
            remaining = [...remaining, ...pickedUp];
            log = appendLog(state.log, `${name} bombs ${describePlay(tablePlay)} with ${describePlay(play)}`
                + ` and must take back a ${taken.color} d${taken.sides}.`);
        } else if (play.kind === 'bomb') {
            // A bomb takes nothing back: the bombed dice leave the round with the table.
            log = appendLog(state.log, `${name} bombs ${describePlay(tablePlay)} with ${describePlay(play)}!`);
        } else if (remaining.length === 0) {
            // Playing your whole hand takes you out; the beaten dice leave the round.
            log = appendLog(state.log, `${name} beats ${describePlay(tablePlay)} with ${describePlay(play)}.`);
        } else {
            // Take the beaten dice behind your screen and reroll them.
            pickedUp = state.table.dice.map(d => roll(d, rng));
            remaining = [...remaining, ...pickedUp];
            const types = pickedUp.map(d => `${d.color} d${d.sides}`).join(', ');
            log = appendLog(state.log,
                `${name} beats ${describePlay(tablePlay)} with ${describePlay(play)} and picks up ${types}.`);
        }
    }

    let next: GameState = {
        ...state,
        hands: { ...state.hands, [playerId]: remaining },
        table: { playerId, dice },
        passed: [], // a new play reopens the trick to everyone
        rolled: { ...state.rolled, [playerId]: pickedUp.map(d => d.id) },
        log,
    };

    if (remaining.length === 0) {
        next = markOut(next, playerId);
        if (next.phase !== 'playing') return next;
    }
    // A bomb clears the table at once; the bomber (or, if out, the next player on their left) leads.
    if (play.kind === 'bomb') return endTrick(next);
    return advanceTurn(next, playerId);
}

/** The bombed die the bomber takes back: their pick, or the only one there is. */
function bombPenaltyDie(bombed: readonly Die[], takeBackId?: string): Die {
    if (bombed.length === 1) return bombed[0];
    const die = bombed.find(d => d.id === takeBackId);
    if (!die) throw new GameError('A bomb costs a die here: choose one of the table dice to take back');
    return die;
}

function applyPass(state: GameState, playerId: string, rerollIds: string[], rng: Rng): GameState {
    if (!state.table) throw new GameError('The leader must play a die');
    const limit = state.table.dice.length;
    if (rerollIds.length > limit) {
        throw new GameError(`You may reroll at most ${limit} ${limit === 1 ? 'die' : 'dice'}`);
    }
    const hand = state.hands[playerId] ?? [];
    pickDice(hand, rerollIds); // validates ownership / duplicates
    const newHand = hand.map(d => (rerollIds.includes(d.id) ? roll(d, rng) : d));
    const rerolled = rerollIds.length ? ` and rerolls ${rerollIds.length}` : '';
    const next: GameState = {
        ...state,
        hands: { ...state.hands, [playerId]: newHand },
        passed: [...state.passed, playerId],
        rolled: { ...state.rolled, [playerId]: rerollIds },
        log: appendLog(state.log, `${state.names[playerId]} passes${rerolled}.`),
    };
    return advanceTurn(next, playerId);
}

/**
 * Pick up: take one die from the table play behind your screen, rerolled.
 * Counts as a pass for ending the trick. What stays on the table must still be
 * a legal play (so a run gives up only an end die). Taking the last die clears
 * the table, and the next player in turn leads a single.
 */
export function canPickUp(state: GameState, dieId: string): boolean {
    const rules = rulesOf(state);
    if (!rules.pickup || !state.table) return false;
    const rest = state.table.dice.filter(d => d.id !== dieId);
    return rest.length < state.table.dice.length && (rest.length === 0 || rules.classifyPlay(rest) !== null);
}

function applyPickup(state: GameState, playerId: string, dieId: string, rng: Rng): GameState {
    const table = state.table;
    if (!rulesOf(state).pickup) throw new GameError(`${rulesOf(state).name} has no picking up`);
    if (!table) throw new GameError('There is nothing on the table to pick up');
    const taken = table.dice.find(d => d.id === dieId);
    if (!taken) throw new GameError('That die is not on the table');
    if (!canPickUp(state, dieId)) throw new GameError('Taking that die would break the play: take an end die');

    const rest = table.dice.filter(d => d.id !== dieId);
    const rolledDie = roll(taken, rng);
    const next: GameState = {
        ...state,
        hands: { ...state.hands, [playerId]: [...(state.hands[playerId] ?? []), rolledDie] },
        table: { playerId: table.playerId, dice: rest },
        passed: [...state.passed, playerId],
        rolled: { ...state.rolled, [playerId]: [dieId] },
        log: appendLog(state.log, `${state.names[playerId]} picks up a ${taken.color} d${taken.sides} from the table and rerolls it.`),
    };
    if (rest.length === 0) return endTrick(next, nextClockwise(next, playerId, id => !isOut(next, id))!);
    return advanceTurn(next, playerId);
}

/**
 * Replace: put one die from behind your screen into the table play and take one
 * table die in exchange, rerolled. Counts as a pass. The table must still be a
 * legal play; a bomb shape is allowed but only counts as the set or run it is
 * (see classifyTable). The table play stays with the player who made it.
 */
export function canReplace(state: GameState, playerId: string, handDieId: string, tableDieId: string): boolean {
    const rules = rulesOf(state);
    const given = state.hands[playerId]?.find(d => d.id === handDieId);
    if (!rules.replace || !state.table || !given || !state.table.dice.some(d => d.id === tableDieId)) return false;
    return rules.classifyPlay(swapIn(state.table.dice, tableDieId, given)) !== null;
}

/** `dice` with the die `outId` replaced by `die`, in the same place. */
export const swapIn = (dice: readonly Die[], outId: string, die: Die): Die[] => dice.map(d => (d.id === outId ? die : d));

function applyReplace(state: GameState, playerId: string, handDieId: string, tableDieId: string, rng: Rng): GameState {
    const rules = rulesOf(state);
    const table = state.table;
    if (!rules.replace) throw new GameError(`${rules.name} has no replacing`);
    if (!table) throw new GameError('There is nothing on the table to swap with');
    const taken = table.dice.find(d => d.id === tableDieId);
    if (!taken) throw new GameError('That die is not on the table');
    const hand = state.hands[playerId] ?? [];
    const [given] = pickDice(hand, [handDieId]);
    if (!canReplace(state, playerId, handDieId, tableDieId)) throw new GameError('That swap would break the play on the table');

    const next: GameState = {
        ...state,
        hands: { ...state.hands, [playerId]: [...hand.filter(d => d.id !== handDieId), roll(taken, rng)] },
        table: { playerId: table.playerId, dice: swapIn(table.dice, tableDieId, given) },
        passed: [...state.passed, playerId],
        rolled: { ...state.rolled, [playerId]: [tableDieId] },
        log: appendLog(state.log, `${state.names[playerId]} swaps a ${given.color} ${given.value} into the table`
            + ` for a ${taken.color} d${taken.sides} and rerolls it.`),
    };
    return advanceTurn(next, playerId);
}

function pickDice(hand: readonly Die[], ids: readonly string[]): Die[] {
    if (new Set(ids).size !== ids.length) throw new GameError('Each die can only be used once');
    return ids.map(id => {
        const die = hand.find(d => d.id === id);
        if (!die) throw new GameError('That die is not behind your screen');
        return die;
    });
}

// ---------------------------------------------------------------------------
// Turn order
// ---------------------------------------------------------------------------

/** Next player clockwise after `fromId` who satisfies `eligible`, or null. */
function nextClockwise(state: GameState, fromId: string, eligible: (id: string) => boolean): string | null {
    const n = state.seating.length;
    const start = state.seating.indexOf(fromId);
    for (let step = 1; step <= n; step++) {
        const id = state.seating[(start + step) % n];
        if (eligible(id)) return id;
    }
    return null;
}

function isOut(state: GameState, id: string): boolean {
    return state.finished.includes(id);
}

function advanceTurn(state: GameState, fromId: string): GameState {
    const owner = state.table!.playerId;
    // Soft passes: the trick ends once every player still in the round, other than
    // the last player to play, has passed since that play. Until then the turn keeps
    // going around, and anyone who passed earlier may play when it reaches them.
    const others = state.seating.filter(id => id !== owner && !isOut(state, id));
    if (others.every(id => state.passed.includes(id))) return endTrick(state);
    return { ...state, turn: nextClockwise(state, fromId, id => !isOut(state, id))! };
}

/**
 * Clear the table and start the next trick. By default the owner of the last
 * play leads; if they have gone out, the next remaining player on their left.
 */
function endTrick(state: GameState, leaderOverride?: string): GameState {
    const owner = state.table!.playerId;
    const leader = leaderOverride
        ?? (isOut(state, owner) ? nextClockwise(state, owner, id => !isOut(state, id))! : owner);
    return {
        ...state,
        table: null,
        passed: [],
        turn: leader,
        trick: state.trick + 1,
        log: appendLog(state.log, `Trick over — the dice leave the round. ${state.names[leader]} leads.`),
    };
}

function markOut(state: GameState, playerId: string): GameState {
    const finished = [...state.finished, playerId];
    let next: GameState = {
        ...state,
        finished,
        log: appendLog(state.log, `${state.names[playerId]} is out in ${ordinal(finished.length)} place!`),
    };
    const left = next.seating.filter(id => !finished.includes(id));
    if (left.length <= 1) next = endRound({ ...next, finished: [...finished, ...left] });
    return next;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Points for a finishing place (0-based): 1st gets players−1, last gets 0. */
export function placePoints(placeIndex: number, playerCount: number): number {
    return playerCount - 1 - placeIndex;
}

function endRound(state: GameState): GameState {
    const scores = { ...state.scores };
    state.finished.forEach((id, i) => {
        scores[id] += placePoints(i, state.seating.length);
    });
    const winner = state.finished[0];
    const firstPlaces = { ...state.firstPlaces, [winner]: state.firstPlaces[winner] + 1 };
    const phase: Phase = state.round >= state.totalRounds ? 'gameOver' : 'roundOver';
    return {
        ...state,
        scores,
        firstPlaces,
        table: null,
        passed: [],
        roundResults: [...state.roundResults, state.finished],
        phase,
        log: appendLog(state.log, phase === 'gameOver'
            ? 'Game over!'
            : `Round ${state.round} over. ${state.names[state.finished[state.finished.length - 1]]} finishes last.`),
    };
}

export interface Standing {
    playerId: string;
    name: string;
    score: number;
    firstPlaces: number;
    /** 1-based; tied players share a rank. */
    rank: number;
}

/**
 * Order two players for the final standings. Negative = `a` ranks higher, 0 = tied.
 * Rules: highest total wins; if tied, more first places wins.
 */
export function compareStandings(a: Standing, b: Standing, state: GameState): number {
    if (a.score !== b.score) return b.score - a.score;
    if (a.firstPlaces !== b.firstPlaces) return b.firstPlaces - a.firstPlaces;
    // TODO(you): the rules don't say what happens if score AND first places tie.
    return 0;
}

export function standings(state: GameState): Standing[] {
    const rows: Standing[] = state.seating.map(id => ({
        playerId: id,
        name: state.names[id],
        score: state.scores[id],
        firstPlaces: state.firstPlaces[id],
        rank: 0,
    }));
    rows.sort((a, b) => compareStandings(a, b, state));
    rows.forEach((row, i) => {
        const prev = rows[i - 1];
        row.rank = prev && compareStandings(prev, row, state) === 0 ? prev.rank : i + 1;
    });
    return rows;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function ordinal(n: number): string {
    const suffix = n % 10 === 1 && n % 100 !== 11 ? 'st'
        : n % 10 === 2 && n % 100 !== 12 ? 'nd'
        : n % 10 === 3 && n % 100 !== 13 ? 'rd'
        : 'th';
    return `${n}${suffix}`;
}

function appendLog(log: readonly string[], entry: string): string[] {
    return [...log, entry].slice(-LOG_LIMIT);
}

/** How many dice a player who passes now may reroll (0 when leading). */
export function rerollAllowance(state: GameState): number {
    return state.table?.dice.length ?? 0;
}

/**
 * Firebase Realtime Database drops empty arrays/objects and may turn arrays into
 * index-keyed objects. Restore the shape the engine expects.
 */
export function normalizeGame(raw: any): GameState {
    const arr = <T>(v: any): T[] => (Array.isArray(v) ? v : v ? Object.values(v) : []);
    const seating = arr<string>(raw.seating);
    const hands: Record<string, Die[]> = {};
    const rolled: Record<string, string[]> = {};
    for (const id of seating) {
        hands[id] = arr<Die>(raw.hands?.[id]);
        rolled[id] = arr<string>(raw.rolled?.[id]);
    }
    return {
        ...raw,
        gameId: raw.gameId ?? '',
        rulesetId: getRuleset(raw.rulesetId).id as RulesetId,
        seq: raw.seq ?? 0,
        trick: raw.trick ?? 1,
        seating,
        hands,
        rolled,
        names: raw.names ?? {},
        table: raw.table ? { playerId: raw.table.playerId, dice: arr<Die>(raw.table.dice) } : null,
        passed: arr<string>(raw.passed),
        finished: arr<string>(raw.finished),
        scores: raw.scores ?? {},
        firstPlaces: raw.firstPlaces ?? {},
        roundResults: arr<any>(raw.roundResults).map(r => arr<string>(r)),
        log: arr<string>(raw.log),
    };
}
