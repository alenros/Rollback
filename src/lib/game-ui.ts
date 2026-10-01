/**
 * HTML rendering for the game page. Pure string builders over GameState so the
 * page script only has to re-render on each Firebase snapshot and wire clicks.
 */
import { COLORS, type Color, type Die, type Sides } from './dice';
import { canPickUp, canReplace, ordinal, placePoints, rerollAllowance, rulesOf, standings, type GameState } from './game';
import { describePlay } from './plays';
import { classifyTable } from './rulesets';
import { escapeHtml } from './session';

export type SortMode = 'color' | 'value';

export interface ViewState {
    meId: string;
    isHost: boolean;
    selection: Set<string>;
    /** A table die chosen to pick up, swap for, or take back after a bomb, if any. */
    tableSelection: string | null;
    sortBy: SortMode;
    /** My dice that were just picked up or rerolled (highlighted until my next move). */
    fresh: Set<string>;
    /** Subset of `fresh` currently mid roll animation. */
    animate: Set<string>;
    /** How far into the roll animation we are, so a re-render resumes it instead of restarting. */
    animateElapsedMs: number;
}

/** Keep in sync with the `die-roll` animation duration in styles.css. */
export const ROLL_ANIMATION_MS = 700;

const nameOf = (state: GameState, id: string) => escapeHtml(state.names[id] ?? '?');

export type Point = readonly [number, number];

/** Each color's dice wear a card suit as their pips (the color still drives the rules). */
export const SUIT_OF: Record<Color, Suit> = { red: 'hearts', blue: 'diamonds', green: 'clubs', yellow: 'spades' };
type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';

/** Suit glyphs drawn in a 20×20 box centered on the origin. */
const SUITS: Record<Suit, string> = {
    hearts: '<path d="M0,9 C-4,5.5 -10,1.5 -10,-3.5 C-10,-7.5 -7.5,-10 -5,-10 C-2.5,-10 -1,-8.5 0,-6.5 C1,-8.5 2.5,-10 5,-10 C7.5,-10 10,-7.5 10,-3.5 C10,1.5 4,5.5 0,9 Z"/>',
    diamonds: '<path d="M0,-10 L7.5,0 L0,10 L-7.5,0 Z"/>',
    spades: '<path d="M0,-10 C4,-5.5 10,-1.5 10,3 C10,6.5 7.5,8.5 5,8.5 C3,8.5 1.6,7.6 0.9,6.3 C1.2,8.2 2.2,9.4 4,10 L-4,10 C-2.2,9.4 -1.2,8.2 -0.9,6.3 C-1.6,7.6 -3,8.5 -5,8.5 C-7.5,8.5 -10,6.5 -10,3 C-10,-1.5 -4,-5.5 0,-10 Z"/>',
    clubs: '<circle cx="0" cy="-5" r="4.6"/><circle cx="-5.2" cy="2" r="4.6"/><circle cx="5.2" cy="2" r="4.6"/><circle cx="0" cy="0.5" r="2.5"/>'
        + '<path d="M-1,1 L1,1 L1.4,6.5 C1.8,8.6 2.8,9.5 4,10 L-4,10 C-2.8,9.5 -1.8,8.6 -1.4,6.5 Z"/>',
};

/**
 * Smallest pip worth drawing (viewBox units). A face whose pips would come out smaller
 * shows a numeral over a suit index instead, like a card corner; each shape's `max` follows.
 */
export const MIN_PIP_SIZE = 13;

// Classic die faces on a 3×3 grid, (0,0) top left to (1,1) bottom right. 7–9 extend the six.
const LEFT: Point[] = [[0, 0], [0, 0.5], [0, 1]];
const RIGHT: Point[] = [[1, 0], [1, 0.5], [1, 1]];
const GRID: Record<number, Point[]> = {
    1: [[0.5, 0.5]],
    2: [[0, 0], [1, 1]],
    3: [[0, 0], [0.5, 0.5], [1, 1]],
    4: [[0, 0], [1, 0], [0, 1], [1, 1]],
    5: [[0, 0], [1, 0], [0.5, 0.5], [0, 1], [1, 1]],
    6: [...LEFT, ...RIGHT],
    7: [...LEFT, ...RIGHT, [0.5, 0.5]],
    8: [...LEFT, ...RIGHT, [0.5, 0], [0.5, 1]],
    9: [...LEFT, ...RIGHT, [0.5, 0], [0.5, 0.5], [0.5, 1]],
};
// A triangle has no room for a square grid, so the d4 racks its pips like pins (offsets from the center, ±1).
const RACK: Record<number, Point[]> = {
    1: [[0, 0]],
    2: [[0, -0.55], [0, 0.55]],
    3: [[0, -0.7], [-0.8, 0.55], [0.8, 0.55]],
    4: [[0, -0.9], [-0.9, 0.6], [0.9, 0.6], [0, 0.1]],
};

/**
 * How pips spread over a face: around (50, cy), `spread` units from the center to the
 * outer pips, for values up to `max`. The d8 turns its grid 45° to follow the diamond
 * (the glyphs stay upright). Sizes are the largest that keep every pip clear of the
 * outline (see game-ui tests); higher values put a numeral at `valueY` over a suit at `indexY`.
 */
interface PipFrame {
    cy: number; spread: number; size: number; max: number;
    layout: 'grid' | 'diamond' | 'rack';
    valueY?: number; indexY?: number;
}

/**
 * Silhouettes of the polyhedral dice (viewBox 0 0 100 100). `hull` is the outline's
 * corners, used to keep pips off the edge. Shape shows the type; fill shows the color.
 */
export const SHAPES: Record<Sides, { outline: string; hull: Point[]; pips: PipFrame }> = {
    4: { outline: '<polygon points="50,4 97,93 3,93"/>', hull: [[50, 4], [97, 93], [3, 93]],
        pips: { cy: 63.5, spread: 17, size: 14, max: 4, layout: 'rack' } },
    6: { outline: '<rect x="7" y="7" width="86" height="86" rx="10"/>', hull: [[7, 7], [93, 7], [93, 93], [7, 93]],
        pips: { cy: 50, spread: 21.5, size: 18.5, max: 6, layout: 'grid' } },
    8: { outline: '<polygon points="50,2 96,44 50,98 4,44"/>', hull: [[50, 2], [96, 44], [50, 98], [4, 44]],
        pips: { cy: 47, spread: 12.5, size: 14.5, max: 5, layout: 'diamond', valueY: 42, indexY: 68 } },
    12: { outline: '<polygon points="50,3 97,37 79,93 21,93 3,37"/>', hull: [[50, 3], [97, 37], [79, 93], [21, 93], [3, 37]],
        pips: { cy: 54.5, spread: 16.5, size: 13, max: 9, layout: 'grid', valueY: 47, indexY: 74 } },
};

/** Centers of the pips for `value` on a die with this many sides (empty above its `max`). */
export function pipCenters(sides: Sides, value: number): Point[] {
    const { cy, spread, layout, max } = SHAPES[sides].pips;
    if (value > max) return [];
    if (layout === 'rack') return (RACK[value] ?? []).map(([u, v]) => [50 + u * spread, cy + v * spread]);
    return (GRID[value] ?? []).map(([u, v]) => {
        const x = (u - 0.5) * 2 * spread, y = (v - 0.5) * 2 * spread;
        return layout === 'diamond'
            ? [50 + (x - y) * Math.SQRT1_2, cy + (x + y) * Math.SQRT1_2]
            : [50 + x, cy + y];
    });
}

export const INDEX_SIZE = 14;

const glyph = (suit: Suit, [x, y]: Point, size: number, cls: string) =>
    `<g class="${cls}" transform="translate(${+x.toFixed(1)} ${+y.toFixed(1)}) scale(${size / 20})">${SUITS[suit]}</g>`;

function faceHtml(die: Die): string {
    const suit = SUIT_OF[die.color];
    const { size, max, valueY, indexY } = SHAPES[die.sides].pips;
    if (die.value > max) {
        return `<text class="die-value" x="50" y="${valueY}">${die.value}</text>${glyph(suit, [50, indexY!], INDEX_SIZE, 'die-index')}`;
    }
    return pipCenters(die.sides, die.value).map(p => glyph(suit, p, size, 'pip')).join('');
}

export interface DieOptions {
    selectable?: boolean;
    selected?: boolean;
    fresh?: boolean;
    animate?: boolean;
    animateElapsedMs?: number;
}

export function dieHtml(die: Die, opts: DieOptions = {}): string {
    const shape = SHAPES[die.sides];
    const label = `${die.color} d${die.sides} showing ${die.value}${opts.fresh ? ', just rolled' : ''}`;
    const inner = `<svg class="die-shape" viewBox="-4 -4 112 112" aria-hidden="true">`
        + `<g class="die-shadow" transform="translate(6 6)">${shape.outline}</g>`
        + `<g class="die-outline">${shape.outline}</g>`
        + `<g class="die-face">${faceHtml(die)}</g></svg>`
        + (opts.fresh ? '<span class="die-new" aria-hidden="true">new</span>' : '');
    const cls = ['die', `die-${die.color}`, `die-suit-${SUIT_OF[die.color]}`, `die-d${die.sides}`];
    if (opts.selected) cls.push('selected');
    if (opts.fresh) cls.push('fresh');
    if (opts.animate) cls.push('rolling');
    const style = opts.animate ? ` style="--roll-delay: -${Math.round(opts.animateElapsedMs ?? 0)}ms"` : '';
    return opts.selectable
        ? `<button type="button" class="${cls.join(' ')}"${style} data-die-id="${die.id}" aria-pressed="${!!opts.selected}" aria-label="${label}" title="${label}">${inner}</button>`
        : `<span class="${cls.join(' ')}" role="img" aria-label="${label}" title="${label}">${inner}</span>`;
}

export function sortDice(dice: readonly Die[], mode: SortMode): Die[] {
    const byColor = (a: Die, b: Die) => COLORS.indexOf(a.color) - COLORS.indexOf(b.color);
    return [...dice].sort((a, b) => mode === 'color'
        ? byColor(a, b) || a.value - b.value
        : a.value - b.value || byColor(a, b));
}

export function renderHeader(state: GameState, view: ViewState): string {
    const round = `<span class="label">Round ${state.round} / ${state.totalRounds}</span>`
        + ` <span class="tag ruleset-name">${escapeHtml(rulesOf(state).name)}</span>`;
    const turn = state.phase !== 'playing'
        ? `<span class="label">${state.phase === 'roundOver' ? 'Round over' : 'Game over'}</span>`
        : state.turn === view.meId
            ? '<span class="tag tag-marker turn-tag">Your turn</span>'
            : `<span class="label turn-text"><span class="turn-name">${nameOf(state, state.turn)}</span>'s turn</span>`;
    return `<div class="game-top-round">${round}</div><div class="game-top-turn">${turn}</div>`;
}

export function renderSeats(state: GameState, view: ViewState): string {
    return state.seating.map(id => {
        const place = state.finished.indexOf(id);
        const classes = ['seat'];
        const badges: string[] = [];
        if (id === view.meId) classes.push('is-me');
        if (state.phase === 'playing' && state.turn === id) {
            classes.push('is-turn');
            badges.push('<span class="badge badge-turn">Turn</span>');
        }
        if (place >= 0) {
            classes.push('is-out');
            badges.push(`<span class="badge badge-out">Out ${ordinal(place + 1)}</span>`);
        } else if (state.passed.includes(id)) {
            classes.push('is-passed');
            badges.push('<span class="badge badge-passed">Passed</span>');
        }
        if (state.table?.playerId === id) badges.push('<span class="badge badge-table">On table</span>');
        const count = state.hands[id]?.length ?? 0;
        return `<div class="${classes.join(' ')}">
            <div class="seat-name">${nameOf(state, id)}${id === view.meId ? ' (you)' : ''}</div>
            <div class="seat-meta">${count} ${count === 1 ? 'die' : 'dice'} · ${state.scores[id]} pts</div>
            <div class="seat-badges">${badges.join('')}</div>
        </div>`;
    }).join('');
}

export function renderTable(state: GameState, view: ViewState): string {
    if (!state.table) {
        return state.phase === 'playing'
            ? `<p class="hint">${nameOf(state, state.turn)} leads a single die.</p>`
            : '';
    }
    const rules = rulesOf(state);
    const play = classifyTable(rules, state.table.dice)!;
    // On your turn the table dice are clickable: to pick one up, swap for one, or choose a bomb's take-back.
    const selectable = (rules.pickup || rules.replace || rules.bombPenalty) && state.phase === 'playing' && state.turn === view.meId;
    const dice = state.table.dice.map(d => dieHtml(d, { selectable, selected: view.tableSelection === d.id }));
    return `<div class="dice-row">${dice.join('')}</div>
        <p class="table-desc"><strong>${describePlay(play)}</strong> by ${nameOf(state, state.table.playerId)}</p>`;
}

export function renderHand(state: GameState, view: ViewState): string {
    const hand = sortDice(state.hands[view.meId] ?? [], view.sortBy);
    if (hand.length === 0) {
        return `<p class="hint">${state.finished.includes(view.meId) ? 'Your screen is empty — you are out!' : 'No dice.'}</p>`;
    }
    const selectable = state.phase === 'playing';
    const dice = hand.map(d => dieHtml(d, {
        selectable,
        selected: view.selection.has(d.id),
        fresh: view.fresh.has(d.id),
        animate: view.animate.has(d.id),
        animateElapsedMs: view.animateElapsedMs,
    }));
    return `<div class="dice-row">${dice.join('')}</div>`;
}

export interface Controls {
    hint: string;
    canPlay: boolean;
    canPass: boolean;
    passLabel: string;
    canPickUp: boolean;
    /** Whether this ruleset has a pick-up action at all. */
    showPickup: boolean;
    canReplace: boolean;
    /** Whether this ruleset has a replace action at all. */
    showReplace: boolean;
}

export function computeControls(state: GameState, view: ViewState): Controls {
    const rules = rulesOf(state);
    const showPickup = rules.pickup;
    const showReplace = rules.replace;
    const myTurn = state.phase === 'playing' && state.turn === view.meId;
    const hand = state.hands[view.meId] ?? [];
    const selected = hand.filter(d => view.selection.has(d.id));
    const allowance = rerollAllowance(state);
    const passLabel = selected.length ? `Pass & reroll ${selected.length}` : 'Pass';
    const passOk = myTurn && !!state.table && selected.length <= allowance;
    const pickupOk = myTurn && !!view.tableSelection && canPickUp(state, view.tableSelection);
    const replaceOk = myTurn && selected.length === 1 && !!view.tableSelection
        && canReplace(state, view.meId, selected[0].id, view.tableSelection);
    const flags = { canPass: passOk, passLabel, canPickUp: pickupOk, showPickup, canReplace: replaceOk, showReplace };
    const none = { ...flags, canPlay: false, canPass: false, canPickUp: false, canReplace: false };

    if (state.phase !== 'playing') return { hint: '', ...none };
    if (!myTurn) return { hint: `Waiting for ${nameOf(state, state.turn)}…`, ...none };

    const tablePlay = state.table ? classifyTable(rules, state.table.dice)! : null;
    if (rules.pickup && view.tableSelection && selected.length === 0) {
        const last = state.table!.dice.length === 1;
        const swapNote = rules.replace ? ' Or select one of your dice to swap it in.' : '';
        const hint = (!pickupOk ? 'Taking that die would break the play: pick up an end die.'
            : last ? 'Pick up and reroll the last die: it goes behind your screen, the table clears, and the next player leads.'
            : 'Pick up and reroll that die: it goes behind your screen. Counts as a pass.') + swapNote;
        return { hint, ...flags, canPlay: false };
    }
    if (rules.replace && view.tableSelection && selected.length === 1) {
        const given = selected[0];
        const hint = replaceOk
            ? `Swap your ${given.color} ${given.value} into the play and take that table die, rerolled. Counts as a pass.`
            : 'That swap would break the play on the table.';
        return { hint, ...flags, canPlay: false };
    }
    if (selected.length === 0) {
        const colorNote = tablePlay && rules.colorRequired(tablePlay) ? ' (it must be one color)' : '';
        const pickupNote = rules.pickup ? ', or click a table die to pick it up and reroll it' : '';
        const swapNote = rules.replace ? ' Select one of your dice and a table die to swap them.' : '';
        const hint = tablePlay
            ? `Select dice that beat <strong>${describePlay(tablePlay)}</strong>${colorNote}, or pass and reroll up to ${allowance}${pickupNote}.${swapNote}`
            : 'You lead: select one die to play.';
        return { hint, ...flags, canPlay: false, canPickUp: false, canReplace: false };
    }

    const play = rules.classifyPlay(selected);
    let hint: string;
    let canPlay = false;
    if (!play) {
        hint = 'Not a single, set, run, or bomb.';
    } else if (!tablePlay) {
        canPlay = play.kind === 'single';
        hint = canPlay ? `Lead <strong>${describePlay(play)}</strong>.` : 'The leader plays one die.';
    } else {
        canPlay = rules.beats(play, tablePlay);
        hint = `<strong>${describePlay(play)}</strong> ${canPlay ? 'beats' : 'does not beat'} ${describePlay(tablePlay)}.`;
        if (!canPlay && play.kind !== 'bomb' && rules.colorRequired(tablePlay) && !play.color) {
            hint += ' A one-color play must be beaten by a one-color play.';
        }
        const goingOut = selected.length === hand.length;
        if (canPlay && play.kind === 'bomb' && rules.bombPenalty && !goingOut) {
            const tableDice = state.table!.dice;
            const chosen = tableDice.length === 1 || tableDice.some(d => d.id === view.tableSelection);
            hint += chosen
                ? ' It clears the table, and you take back the chosen die, rerolled.'
                : ' A bomb costs a die: click one of the table dice to take back (rerolled).';
            canPlay = chosen;
        } else if (canPlay && play.kind === 'bomb') {
            hint += ' It clears the table and you take nothing back.';
        }
    }
    if (canPlay && selected.length === hand.length) hint += ' Those are your last dice — you go out!';
    if (tablePlay && selected.length > allowance) hint += ` (Passing rerolls at most ${allowance}.)`;
    return { hint, ...flags, canPlay };
}

export function renderRoundPanel(state: GameState, view: ViewState): string {
    if (state.phase === 'playing') return '';
    const last = state.roundResults[state.roundResults.length - 1] ?? [];
    const n = state.seating.length;
    const results = last.map((id, i) =>
        `<li><span>${ordinal(i + 1)} ${nameOf(state, id)}</span><span>+${placePoints(i, n)}</span></li>`).join('');
    const rows = standings(state).map(s => `<tr>
            <td>${s.rank}</td><td>${escapeHtml(s.name)}${s.playerId === view.meId ? ' (you)' : ''}</td>
            <td>${s.score}</td><td>${s.firstPlaces}</td></tr>`).join('');
    const totals = `<table class="standings"><thead><tr><th>#</th><th>Player</th><th>Points</th><th>1st places</th></tr></thead><tbody>${rows}</tbody></table>`;

    if (state.phase === 'gameOver') {
        const winners = standings(state).filter(s => s.rank === 1).map(s => escapeHtml(s.name));
        return `<h3>Game over — ${winners.join(' & ')} ${winners.length > 1 ? 'win' : 'wins'}!</h3>
            <ol class="round-results">${results}</ol>${totals}
            <button id="home-btn" type="button" class="primary">Back to home</button>`;
    }
    const action = view.isHost
        ? `<button id="next-round-btn" type="button" class="primary">Start round ${state.round + 1}</button>`
        : '<p class="hint">Waiting for the host to start the next round…</p>';
    return `<h3>Round ${state.round} results</h3><ol class="round-results">${results}</ol>${totals}${action}`;
}

export function renderLog(state: GameState): string {
    return [...state.log].reverse().map(entry => `<li>${escapeHtml(entry)}</li>`).join('');
}
