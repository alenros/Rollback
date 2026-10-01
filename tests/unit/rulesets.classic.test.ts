import { describe, expect, it } from 'vitest';
import { COLORS, type Die } from '../../src/lib/dice';
import { describePlay, type Play } from '../../src/lib/plays';
import { RULESETS } from '../../src/lib/rulesets';

const { classifyPlay, beats } = RULESETS.classic;

let seq = 0;
/** Colors cycle so tests prove Classic ignores them. */
const d = (value: number): Die => ({ id: `t${seq}`, color: COLORS[seq++ % COLORS.length], sides: 12, value });
const same = (count: number, value: number) => Array.from({ length: count }, () => d(value));
const run = (low: number, high: number) => Array.from({ length: high - low + 1 }, (_, i) => d(low + i));
const play = (dice: Die[]): Play => {
    const p = classifyPlay(dice);
    if (!p) throw new Error('invalid test play');
    return p;
};

describe('Classic: classifyPlay', () => {
    it('classifies singles, sets and runs without color', () => {
        expect(classifyPlay([d(7)])).toEqual({ kind: 'single', count: 1, value: 7 });
        expect(classifyPlay(same(4, 5))).toEqual({ kind: 'set', count: 4, value: 5 }); // never a bomb
        expect(classifyPlay(run(5, 6))).toEqual({ kind: 'run', count: 2, value: 6 });
    });

    it('any run of exactly 5 is a bomb, whatever its colors', () => {
        expect(classifyPlay(run(3, 7))).toEqual({ kind: 'bomb', of: 'run', count: 5, value: 7 });
        expect(classifyPlay(run(3, 6))!.kind).toBe('run');
        expect(classifyPlay(run(3, 8))!.kind).toBe('run');
    });

    it('rejects everything else', () => {
        expect(classifyPlay([])).toBeNull();
        expect(classifyPlay([d(4), d(6)])).toBeNull();
    });
});

describe('Classic: beats', () => {
    it('ignores color entirely', () => {
        expect(beats(play([d(11)]), play([d(10)]))).toBe(true);
        expect(beats(play(same(2, 6)), play(same(2, 5)))).toBe(true);
        expect(beats(play(run(10, 11)), play(run(9, 10)))).toBe(true);
    });

    it('allows one extra die at most, except for bombs', () => {
        expect(beats(play(same(2, 1)), play([d(12)]))).toBe(true);
        expect(beats(play(same(3, 1)), play([d(12)]))).toBe(false);
        expect(beats(play(run(1, 3)), play(run(9, 10)))).toBe(true);
        expect(beats(play(run(1, 4)), play(run(9, 10)))).toBe(false);
        expect(beats(play(run(1, 5)), play([d(12)]))).toBe(true);
    });

    it('nothing beats a bomb', () => {
        expect(beats(play(run(4, 8)), play(run(3, 7)))).toBe(false);
    });

    it('reads without colors', () => {
        expect(describePlay(play([d(7)]))).toBe('single 7');
        expect(describePlay(play(run(3, 7)))).toBe('bomb 3–7');
    });
});
