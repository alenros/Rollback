/**
 * Ruleset-independent pieces of a play: its shape, shared comparison helpers,
 * and how it reads. Which dice form which play, and what beats what, is up to
 * each ruleset (see rulesets.ts).
 */
import type { Color, Die } from './dice';

export type PlayKind = 'single' | 'set' | 'run' | 'bomb';

export interface Play {
    kind: PlayKind;
    count: number;
    /** The shared face value for singles and sets; the top value for runs and run bombs. */
    value: number;
    /** Set when color matters and every die in the play is the same color. */
    color?: Color;
    /** For bombs: whether it is shaped like a set or a run. */
    of?: 'set' | 'run';
}

export const sortedValues = (dice: readonly Die[]) => dice.map(d => d.value).sort((a, b) => a - b);
export const allSame = (values: readonly number[]) => values.every(v => v === values[0]);
export const consecutive = (values: readonly number[]) => values.every((v, i) => i === 0 || v === values[i - 1] + 1);

/**
 * Exactly one more die wins at any value (never more than one extra);
 * with the same number of dice, a strictly higher value wins.
 */
export function stronger(challenger: Play, table: Play): boolean {
    return challenger.count === table.count + 1 ||
        (challenger.count === table.count && challenger.value > table.value);
}

/** Identity of a play for de-duplication. */
export const playKey = (p: Play) => `${p.kind}:${p.count}:${p.value}:${p.color ?? ''}:${p.of ?? ''}`;

const COUNT_WORDS = ['', 'one', 'pair', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

export function describePlay(play: Play): string {
    const color = play.color ? `${play.color} ` : '';
    const low = play.value - play.count + 1;
    switch (play.kind) {
        case 'single':
            return play.color ? `${play.color} ${play.value}` : `single ${play.value}`;
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
