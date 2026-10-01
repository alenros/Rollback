/**
 * Gameplay telemetry: an append-only event log of every committed state change,
 * for later analysis of how players use the mechanics and what wins games.
 *
 * Events are derived purely from (before, action, after) game states, so this
 * module has no Firebase dependency and is unit-testable. room-actions.ts writes
 * the events after each transaction commits.
 *
 * Privacy: no player names are recorded, only the random per-game player ids.
 * Dice are encoded compactly as "color:sides:value" strings, e.g. "red:8:5".
 */
import type { Die } from './dice';
import { RULES_VERSION, standings, type Action, type GameState } from './game';
import { beats, classifyPlay, possiblePlays, type Play } from './plays';

type DieCode = string;
type PlaySummary = Pick<Play, 'kind' | 'count' | 'value' | 'color' | 'of'>;

interface Base {
    gameId: string;
    seq: number;
    round: number;
}

export type TelemetryEvent = Base & (
    | {
        type: 'gameStart';
        rulesVersion: string;
        playerCount: number;
        /** Player ids in clockwise order. */
        seating: string[];
        handSize: number;
        totalRounds: number;
    }
    | {
        type: 'roundStart';
        leader: string;
        hands: Record<string, DieCode[]>;
    }
    | {
        type: 'play';
        trick: number;
        player: string;
        /** The hand before the move, so the decision can be judged against its alternatives. */
        hand: DieCode[];
        dice: DieCode[];
        play: PlaySummary;
        /** The play that was beaten, or null when leading. */
        beat: PlaySummary | null;
        /** Dice picked up (after rerolling); empty for leads, bombs, and going out. */
        pickedUp: DieCode[];
        wentOut: boolean;
        trickEnded: boolean;
        /** Every player's dice count after the move. */
        handSizes: Record<string, number>;
    }
    | {
        type: 'pass';
        trick: number;
        player: string;
        hand: DieCode[];
        table: PlaySummary;
        /** Distinct plays in hand that would have beaten the table (0 = forced pass). */
        beatOptions: number;
        allowance: number;
        rerolls: { from: DieCode; to: DieCode }[];
        trickEnded: boolean;
        handSizes: Record<string, number>;
    }
    | {
        type: 'pickup';
        trick: number;
        player: string;
        hand: DieCode[];
        table: PlaySummary;
        beatOptions: number;
        /** The die taken, before and after its reroll. */
        die: { from: DieCode; to: DieCode };
        trickEnded: boolean;
        handSizes: Record<string, number>;
    }
    | {
        type: 'roundEnd';
        /** Finishing order, first to last. */
        finished: string[];
        tricks: number;
        scores: Record<string, number>;
    }
    | {
        type: 'gameEnd';
        standings: { player: string; rank: number; score: number; firstPlaces: number }[];
    }
);

const code = (d: Die): DieCode => `${d.color}:${d.sides}:${d.value}`;
/** Firebase rejects `undefined`, so optional fields are only set when present. */
const summary = (dice: readonly Die[]): PlaySummary => {
    const { kind, count, value, color, of } = classifyPlay(dice)!;
    return { kind, count, value, ...(color && { color }), ...(of && { of }) };
};
const handSizes = (s: GameState) => Object.fromEntries(s.seating.map(id => [id, s.hands[id]?.length ?? 0]));

/**
 * Events for one committed state change.
 * - `before` null: the game just started.
 * - `action` set: a play or pass.
 * - neither: the host started the next round.
 */
export function buildEvents(before: GameState | null, after: GameState, action?: Action): TelemetryEvent[] {
    const base = { gameId: after.gameId, seq: after.seq };
    const events: TelemetryEvent[] = [];

    if (!before) {
        events.push({
            ...base, round: 0, type: 'gameStart', rulesVersion: RULES_VERSION,
            playerCount: after.seating.length, seating: after.seating,
            handSize: after.handSize, totalRounds: after.totalRounds,
        });
    }

    if (!action) {
        events.push({
            ...base, round: after.round, type: 'roundStart', leader: after.turn,
            hands: Object.fromEntries(after.seating.map(id => [id, (after.hands[id] ?? []).map(code)])),
        });
        return events;
    }

    const hand = before!.hands[action.playerId] ?? [];
    const common = { ...base, round: before!.round, trick: before!.trick, player: action.playerId, hand: hand.map(code) };
    const trickEnded = after.trick !== before!.trick || after.round !== before!.round;

    if (action.type === 'play') {
        const dice = action.dieIds.map(id => hand.find(d => d.id === id)!);
        const handAfter = after.hands[action.playerId] ?? [];
        const picked = new Set(after.rolled[action.playerId] ?? []);
        events.push({
            ...common, type: 'play',
            dice: dice.map(code),
            play: summary(dice),
            beat: before!.table ? summary(before!.table.dice) : null,
            pickedUp: handAfter.filter(d => picked.has(d.id)).map(code),
            wentOut: after.finished.includes(action.playerId) && !before!.finished.includes(action.playerId),
            trickEnded,
            handSizes: handSizes(after),
        });
    } else if (action.type === 'pickup') {
        const table = before!.table!.dice;
        const tablePlay = classifyPlay(table)!;
        const taken = table.find(d => d.id === action.dieId)!;
        const now = (after.hands[action.playerId] ?? []).find(d => d.id === action.dieId)!;
        events.push({
            ...common, type: 'pickup',
            table: summary(table),
            beatOptions: possiblePlays(hand).filter(p => beats(p, tablePlay)).length,
            die: { from: code(taken), to: code(now) },
            trickEnded,
            handSizes: handSizes(after),
        });
    } else {
        const table = before!.table!.dice;
        const tablePlay = classifyPlay(table)!;
        const handAfter = after.hands[action.playerId] ?? [];
        events.push({
            ...common, type: 'pass',
            table: summary(table),
            beatOptions: possiblePlays(hand).filter(p => beats(p, tablePlay)).length,
            allowance: table.length,
            rerolls: action.rerollIds.map(id => ({
                from: code(hand.find(d => d.id === id)!),
                to: code(handAfter.find(d => d.id === id)!),
            })),
            trickEnded,
            handSizes: handSizes(after),
        });
    }

    if (before!.phase === 'playing' && after.phase !== 'playing') {
        events.push({
            ...base, round: before!.round, type: 'roundEnd',
            finished: after.roundResults[after.roundResults.length - 1],
            tricks: before!.trick,
            scores: after.scores,
        });
    }
    if (after.phase === 'gameOver') {
        events.push({
            ...base, round: before!.round, type: 'gameEnd',
            standings: standings(after).map(s => ({
                player: s.playerId, rank: s.rank, score: s.score, firstPlaces: s.firstPlaces,
            })),
        });
    }
    return events;
}

/** Database key for an event: zero-padded seq + index, so keys sort in game order and retries can't duplicate. */
export function eventKey(event: TelemetryEvent, index: number): string {
    return `${String(event.seq).padStart(5, '0')}-${index}`;
}
