/**
 * HTML rendering for the game page. Pure string builders over GameState so the
 * page script only has to re-render on each Firebase snapshot and wire clicks.
 */
import type { Die, Sides } from './dice';
import { ordinal, placePoints, rerollAllowance, standings, type GameState } from './game';
import { beats, classifyPlay, describePlay } from './plays';
import { escapeHtml } from './session';

export type SortMode = 'type' | 'value';

export interface ViewState {
    meId: string;
    isHost: boolean;
    selection: Set<string>;
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
 * in each shape's visual middle. Each type also has its own color (see .die-dN in styles.css);
 * color is purely visual and has no effect on play.
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
    const label = `d${die.sides} showing ${die.value}${opts.fresh ? ', just rolled' : ''}`;
    const inner = `<svg class="die-shape" viewBox="0 0 100 100" aria-hidden="true">`
        + `<g class="die-outline">${shape.outline}</g>`
        + `<text class="die-value" x="50" y="${shape.valueY}">${die.value}</text></svg>`
        + (opts.fresh ? '<span class="die-new" aria-hidden="true">new</span>' : '');
    const cls = ['die', `die-d${die.sides}`];
    if (opts.selected) cls.push('selected');
    if (opts.fresh) cls.push('fresh');
    if (opts.animate) cls.push('rolling');
    const style = opts.animate ? ` style="--roll-delay: -${Math.round(opts.animateElapsedMs ?? 0)}ms"` : '';
    return opts.selectable
        ? `<button type="button" class="${cls.join(' ')}"${style} data-die-id="${die.id}" aria-pressed="${!!opts.selected}" aria-label="${label}" title="${label}">${inner}</button>`
        : `<span class="${cls.join(' ')}" role="img" aria-label="${label}" title="${label}">${inner}</span>`;
}

export function sortDice(dice: readonly Die[], mode: SortMode): Die[] {
    const byType = (a: Die, b: Die) => a.sides - b.sides;
    return [...dice].sort((a, b) => mode === 'type'
        ? byType(a, b) || a.value - b.value
        : a.value - b.value || byType(a, b));
}

export function renderHeader(state: GameState): string {
    const turn = state.phase === 'playing'
        ? `<span class="turn-name">${nameOf(state, state.turn)}</span>'s turn`
        : state.phase === 'roundOver' ? 'Round over' : 'Game over';
    return `<div>Round ${state.round} / ${state.totalRounds}</div><div>${turn}</div>`;
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

export function renderTable(state: GameState): string {
    if (!state.table) {
        return state.phase === 'playing'
            ? `<p class="hint">${nameOf(state, state.turn)} leads a single die.</p>`
            : '';
    }
    const play = classifyPlay(state.table.dice)!;
    return `<div class="dice-row">${state.table.dice.map(d => dieHtml(d)).join('')}</div>
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
}

export function computeControls(state: GameState, view: ViewState): Controls {
    const myTurn = state.phase === 'playing' && state.turn === view.meId;
    const hand = state.hands[view.meId] ?? [];
    const selected = hand.filter(d => view.selection.has(d.id));
    const allowance = rerollAllowance(state);
    const passLabel = selected.length ? `Pass & reroll ${selected.length}` : 'Pass';
    const passOk = myTurn && !!state.table && selected.length <= allowance;

    if (state.phase !== 'playing') return { hint: '', canPlay: false, canPass: false, passLabel };
    if (!myTurn) {
        return { hint: `Waiting for ${nameOf(state, state.turn)}…`, canPlay: false, canPass: false, passLabel };
    }

    const tablePlay = state.table ? classifyPlay(state.table.dice)! : null;
    if (selected.length === 0) {
        const hint = tablePlay
            ? `Select dice that beat <strong>${describePlay(tablePlay)}</strong>, or pass and reroll up to ${allowance}.`
            : 'You lead: select one die to play.';
        return { hint, canPlay: false, canPass: passOk, passLabel };
    }

    const play = classifyPlay(selected);
    let hint: string;
    let canPlay = false;
    if (!play) {
        hint = 'Not a single, set, run, or bomb.';
    } else if (!tablePlay) {
        canPlay = play.kind === 'single';
        hint = canPlay ? `Lead <strong>${describePlay(play)}</strong>.` : 'The leader plays one die.';
    } else {
        canPlay = beats(play, tablePlay);
        hint = `<strong>${describePlay(play)}</strong> ${canPlay ? 'beats' : 'does not beat'} ${describePlay(tablePlay)}.`;
        if (canPlay && play.kind === 'bomb') hint += ' It clears the table and you take nothing back.';
    }
    if (canPlay && selected.length === hand.length) hint += ' Those are your last dice — you go out!';
    if (tablePlay && selected.length > allowance) hint += ` (Passing rerolls at most ${allowance}.)`;
    return { hint, canPlay, canPass: passOk, passLabel };
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
