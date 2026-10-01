import { COLORS, type Color, type Die } from './dice';

export type PlayKind = 'single' | 'set' | 'run' | 'bomb';

/** A same-color run of exactly this many dice is a bomb. */
export const RUN_BOMB_LENGTH = 5;
/** A set of exactly this many dice, every one a different color, is a bomb. */
export const SET_BOMB_SIZE = COLORS.length;

export interface Play {
    kind: PlayKind;
    count: number;
    /** The shared face value for singles and sets; the top value for runs and run bombs. */
    value: number;
    /** Set when every die in the play is the same color. */
    color?: Color;
    /** For bombs: whether it is a rainbow set or a same-color run. */
    of?: 'set' | 'run';
}

/**
 * Classify a group of dice as a legal play, or null if it isn't one.
 * - Single: one die.
 * - Set: 2+ dice showing the same value. Bomb if exactly 4, all different colors.
 * - Run: 2+ dice showing consecutive values. Bomb if exactly 5, all one color.
 */
export function classifyPlay(dice: readonly Die[]): Play | null {
    if (dice.length === 0) return null;
    const count = dice.length;
    const values = dice.map(d => d.value).sort((a, b) => a - b);
    const colors = new Set(dice.map(d => d.color));
    const color = colors.size === 1 ? dice[0].color : undefined;
    const withColor = (play: Play): Play => (color ? { ...play, color } : play);

    if (values.every(v => v === values[0])) {
        if (count === 1) return withColor({ kind: 'single', count, value: values[0] });
        if (count === SET_BOMB_SIZE && colors.size === SET_BOMB_SIZE) {
            return { kind: 'bomb', of: 'set', count, value: values[0] };
        }
        return withColor({ kind: 'set', count, value: values[0] });
    }
    if (values.every((v, i) => i === 0 || v === values[i - 1] + 1)) {
        const top = values[count - 1];
        if (count === RUN_BOMB_LENGTH && color) return { kind: 'bomb', of: 'run', count, value: top, color };
        return withColor({ kind: 'run', count, value: top });
    }
    return null;
}

/**
 * Exactly one more die wins at any value (never more than one extra);
 * with the same number of dice, a strictly higher value wins.
 */
function stronger(challenger: Play, table: Play): boolean {
    return challenger.count === table.count + 1 ||
        (challenger.count === table.count && challenger.value > table.value);
}

/**
 * Does `challenger` beat the play currently on the table?
 * - Single: beaten by a higher single, or by a 2-die set or run.
 * - Set: beaten by a stronger set. Run: beaten by a stronger run.
 *   Sets and runs never beat each other.
 * - A one-color set or run can only be beaten by a one-color play (any color).
 * - A bomb beats any single, set or run, ignoring color and the one-extra-die
 *   limit. It clears the table at once, so nothing is ever played on a bomb.
 * Equal never beats.
 */
export function beats(challenger: Play, table: Play): boolean {
    if (table.kind === 'bomb') return false;
    if (challenger.kind === 'bomb') return true;
    if (colorRequired(table) && !challenger.color) return false;
    if (table.kind === 'single' && challenger.kind !== 'single') return challenger.count === 2;
    return challenger.kind === table.kind && stronger(challenger, table);
}

/** Must a play beating `table` be all one color? (One-color sets and runs.) */
export function colorRequired(table: Play): boolean {
    return (table.kind === 'set' || table.kind === 'run') && !!table.color;
}

/**
 * Every distinct play that can be formed from `dice`: one entry per genuinely
 * different choice, so a group that can be made mixed or one-color appears once
 * for each. Used by telemetry to judge decisions.
 */
export function possiblePlays(dice: readonly Die[]): Play[] {
    const plays: Play[] = [];
    const byValue = new Map<number, Die[]>();
    for (const d of dice) byValue.set(d.value, [...(byValue.get(d.value) ?? []), d]);

    for (const [value, group] of byValue) {
        const perColor = countBy(group.map(d => d.color));
        const hasRepeatColor = [...perColor.values()].some(n => n > 1);
        for (const color of perColor.keys()) plays.push({ kind: 'single', count: 1, value, color });
        for (let count = 2; count <= group.length; count++) {
            // Mixed: needs two colors, and at the bomb size a repeat so it isn't forced rainbow.
            const mixed = perColor.size >= 2 && (count !== SET_BOMB_SIZE || hasRepeatColor);
            if (mixed) plays.push({ kind: 'set', count, value });
            for (const [color, n] of perColor) if (n >= count) plays.push({ kind: 'set', count, value, color });
        }
        if (perColor.size >= SET_BOMB_SIZE) plays.push({ kind: 'bomb', of: 'set', count: SET_BOMB_SIZE, value });
    }

    const values = [...byValue.keys()].sort((a, b) => a - b);
    for (let start = 0; start < values.length; start++) {
        for (let end = start + 1; end < values.length && values[end] === values[end - 1] + 1; end++) {
            const count = end - start + 1;
            const top = values[end];
            const span = values.slice(start, end + 1).map(v => new Set(byValue.get(v)!.map(d => d.color)));
            const allColors = new Set(span.flatMap(colors => [...colors]));
            if (allColors.size >= 2) plays.push({ kind: 'run', count, value: top }); // a mixed choice exists
            for (const color of COLORS.filter(c => span.every(colors => colors.has(c)))) {
                plays.push(count === RUN_BOMB_LENGTH
                    ? { kind: 'bomb', of: 'run', count, value: top, color }
                    : { kind: 'run', count, value: top, color });
            }
        }
    }
    return plays;
}

function countBy<T>(items: readonly T[]): Map<T, number> {
    const counts = new Map<T, number>();
    for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
    return counts;
}

const COUNT_WORDS = ['', 'one', 'pair', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

export function describePlay(play: Play): string {
    const color = play.color ? `${play.color} ` : '';
    const low = play.value - play.count + 1;
    switch (play.kind) {
        case 'single':
            return `${color}${play.value}`;
        case 'bomb':
            return play.of === 'set'
                ? `rainbow bomb of ${play.value}s`
                : `${color}bomb ${low}–${play.value}`;
        case 'run':
            return `${color}run ${low}–${play.value}`;
        case 'set': {
            const word = COUNT_WORDS[play.count] ?? `${play.count}×`;
            return play.count === 2 ? `${color}pair of ${play.value}s` : `${color}${word} ${play.value}s`;
        }
    }
}
