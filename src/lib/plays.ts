import type { Die } from './dice';

export type PlayKind = 'single' | 'set' | 'run' | 'bomb';

/** A bomb is a run of exactly this many dice. */
export const BOMB_LENGTH = 5;

export interface Play {
    kind: PlayKind;
    count: number;
    /** The shared face value for singles and sets; the top value for runs and bombs. */
    value: number;
}

/**
 * Classify a group of dice as a legal play, or null if it isn't one.
 * - Single: one die.
 * - Set: 2+ dice showing the same value.
 * - Bomb: exactly 5 dice showing consecutive values (e.g. 3-4-5-6-7), any types.
 * - Run: any other group of 2+ dice showing consecutive values (2, 3, 4, 6, …).
 */
export function classifyPlay(dice: readonly Die[]): Play | null {
    if (dice.length === 0) return null;
    const count = dice.length;
    const values = dice.map(d => d.value).sort((a, b) => a - b);
    if (values.every(v => v === values[0])) {
        return { kind: count === 1 ? 'single' : 'set', count, value: values[0] };
    }
    if (values.every((v, i) => i === 0 || v === values[i - 1] + 1)) {
        return { kind: count === BOMB_LENGTH ? 'bomb' : 'run', count, value: values[count - 1] };
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
 * - A bomb beats any single, set or run (the one play exempt from the one-extra-die
 *   limit). It clears the table at once, so nothing is ever played on a bomb.
 * Equal never beats.
 */
export function beats(challenger: Play, table: Play): boolean {
    if (table.kind === 'bomb') return false;
    if (challenger.kind === 'bomb') return true;
    if (table.kind === 'single' && challenger.kind !== 'single') return challenger.count === 2;
    return challenger.kind === table.kind && stronger(challenger, table);
}

/** Every distinct play (kind, count, value) that can be formed from `dice`. */
export function possiblePlays(dice: readonly Die[]): Play[] {
    const counts = new Map<number, number>();
    for (const d of dice) counts.set(d.value, (counts.get(d.value) ?? 0) + 1);
    const plays: Play[] = [];
    for (const [value, available] of counts) {
        for (let count = 1; count <= available; count++) {
            plays.push({ kind: count === 1 ? 'single' : 'set', count, value });
        }
    }
    const values = [...counts.keys()].sort((a, b) => a - b);
    for (let start = 0; start < values.length; start++) {
        for (let end = start + 1; end < values.length && values[end] === values[end - 1] + 1; end++) {
            const count = end - start + 1;
            plays.push({ kind: count === BOMB_LENGTH ? 'bomb' : 'run', count, value: values[end] });
        }
    }
    return plays;
}

const COUNT_WORDS =['', 'one', 'pair', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

export function describePlay(play: Play): string {
    switch (play.kind) {
        case 'single':
            return `single ${play.value}`;
        case 'bomb':
            return `bomb ${play.value - play.count + 1}–${play.value}`;
        case 'run':
            return `run ${play.value - play.count + 1}–${play.value}`;
        case 'set': {
            const word = COUNT_WORDS[play.count] ?? `${play.count}×`;
            return play.count === 2 ? `pair of ${play.value}s` : `${word} ${play.value}s`;
        }
    }
}
