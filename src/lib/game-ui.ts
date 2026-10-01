/**
 * HTML rendering for the game page. Pure string builders over GameState so the
 * page script only has to re-render on each Firebase snapshot and wire clicks.
 */
import { COLORS, type Die, type Sides } from './dice';
import { canPickUp, ordinal, placePoints, rerollAllowance, rulesOf, standings, type GameState } from './game';
import { describePlay } from './plays';
import { escapeHtml } from './session';

export type SortMode = 'color' | 'value';

export interface ViewState {
    meId: string;
    isHost: boolean;
    selection: Set<string>;
    /** A table die chosen to pick up, if any. */
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

/**
 * Silhouettes of the polyhedral dice (viewBox 0 0 100 100), with the value centered
 * in each shape's visual middle. Shape shows the type; fill shows the color.
 */
const SHAPES: Record<Sides, { outline: string; valueY: number }> = {
    4: { outline: '<polygon points="50,4 97,93 3,93"/>', valueY: 66 },
    6: { outline: '<rect x="7" y="7" width="86" height="86" rx="10"/>', valueY: 52 },
    8: { outline: '<polygon points="50,2 96,44 50,98 4,44"/>', valueY: 48 },
    12: { outline: '<polygon points="50,3 97,37 79,93 21,93 3,37"/>', valueY: 56 },
};

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
    const inner = `<svg class="die-shape" viewBox="0 0 100 100" aria-hidden="true">`
        + `<g class="die-outline">${shape.outline}</g>`
        + `<text class="die-value" x="50" y="${shape.valueY}">${die.value}</text></svg>`
        + (opts.fresh ? '<span class="die-new" aria-hidden="true">new</span>' : '');
    const cls = ['die', `die-${die.color}`, `die-d${die.sides}`];
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

export function renderHeader(state: GameState): string {
    const turn = state.phase === 'playing'
        ? `<span class="turn-name">${nameOf(state, state.turn)}</span>'s turn`
        : state.phase === 'roundOver' ? 'Round over' : 'Game over';
    return `<div>Round ${state.round} / ${state.totalRounds} <span class="ruleset-name">${escapeHtml(rulesOf(state).name)}</span></div><div>${turn}</div>`;
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
    const play = rules.classifyPlay(state.table.dice)!;
    // On your turn the table dice are clickable, to pick one up (if the ruleset allows it).
    const selectable = rules.pickup && state.phase === 'playing' && state.turn === view.meId;
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
}

export function computeControls(state: GameState, view: ViewState): Controls {
    const rules = rulesOf(state);
    const showPickup = rules.pickup;
    const myTurn = state.phase === 'playing' && state.turn === view.meId;
    const hand = state.hands[view.meId] ?? [];
    const selected = hand.filter(d => view.selection.has(d.id));
    const allowance = rerollAllowance(state);
    const passLabel = selected.length ? `Pass & reroll ${selected.length}` : 'Pass';
    const passOk = myTurn && !!state.table && selected.length <= allowance;
    const pickupOk = myTurn && !!view.tableSelection && canPickUp(state, view.tableSelection);
    const none = { canPlay: false, canPass: false, passLabel, canPickUp: false, showPickup };

    if (state.phase !== 'playing') return { hint: '', ...none };
    if (!myTurn) return { hint: `Waiting for ${nameOf(state, state.turn)}…`, ...none };

    const tablePlay = state.table ? rules.classifyPlay(state.table.dice)! : null;
    if (view.tableSelection && selected.length === 0) {
        const last = state.table!.dice.length === 1;
        const hint = !pickupOk ? 'Taking that die would break the play: pick up an end die.'
            : last ? 'Pick up and reroll the last die: it goes behind your screen, the table clears, and the next player leads.'
            : 'Pick up and reroll that die: it goes behind your screen. Counts as a pass.';
        return { hint, canPlay: false, canPass: passOk, passLabel, canPickUp: pickupOk, showPickup };
    }
    if (selected.length === 0) {
        const colorNote = tablePlay && rules.colorRequired(tablePlay) ? ' (it must be one color)' : '';
        const pickupNote = rules.pickup ? ', or click a table die to pick it up and reroll it' : '';
        const hint = tablePlay
            ? `Select dice that beat <strong>${describePlay(tablePlay)}</strong>${colorNote}, or pass and reroll up to ${allowance}${pickupNote}.`
            : 'You lead: select one die to play.';
        return { hint, canPlay: false, canPass: passOk, passLabel, canPickUp: false, showPickup };
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
        if (canPlay && play.kind === 'bomb') hint += ' It clears the table and you take nothing back.';
    }
    if (canPlay && selected.length === hand.length) hint += ' Those are your last dice — you go out!';
    if (tablePlay && selected.length > allowance) hint += ` (Passing rerolls at most ${allowance}.)`;
    return { hint, canPlay, canPass: passOk, passLabel, canPickUp: pickupOk, showPickup };
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
            <button id="home-btn" type="button">Back to home</button>`;
    }
    const action = view.isHost
        ? `<button id="next-round-btn" type="button">Start round ${state.round + 1}</button>`
        : '<p class="hint">Waiting for the host to start the next round…</p>';
    return `<h3>Round ${state.round} results</h3><ol class="round-results">${results}</ol>${totals}${action}`;
}

export function renderLog(state: GameState): string {
    return [...state.log].reverse().map(entry => `<li>${escapeHtml(entry)}</li>`).join('');
}
