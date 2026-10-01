import { describe, expect, it } from 'vitest';
import type { Die, Sides } from '../../src/lib/dice';
import { beats, classifyPlay, describePlay, type Play } from '../../src/lib/plays';

let seq = 0;
const d = (value: number, sides: Sides = 12): Die => ({ id: `t${seq++}`, sides, value });
const same = (count: number, value: number) => Array.from({ length: count }, () => d(value));
const play = (...dice: Die[]): Play => {
    const p = classifyPlay(dice);
    if (!p) throw new Error('invalid test play');
    return p;
};

describe('classifyPlay', () => {
    it('classifies singles, sets and bombs by count of matching values', () => {
        expect(classifyPlay([d(7)])).toEqual({ kind: 'single', count: 1, value: 7 });
        expect(classifyPlay(same(2, 5))).toEqual({ kind: 'set', count: 2, value: 5 });
        expect(classifyPlay(same(3, 5))).toEqual({ kind: 'set', count: 3, value: 5 });
        expect(classifyPlay(same(4, 5))).toEqual({ kind: 'set', count: 4, value: 5 });
        expect(classifyPlay(same(5, 5))).toEqual({ kind: 'set', count: 5, value: 5 });
    });

    it('a bomb is a run of exactly 5, across die types', () => {
        expect(classifyPlay([d(1, 4), d(2, 6), d(3, 8), d(4, 12), d(5, 12)]))
            .toEqual({ kind: 'bomb', count: 5, value: 5 });
        expect(classifyPlay([d(1), d(2), d(3), d(4)])!.kind).toBe('run');
        expect(classifyPlay([d(1), d(2), d(3), d(4), d(5), d(6)])!.kind).toBe('run');
    });

    it('classifies consecutive values as runs, topped by the highest value', () => {
        expect(classifyPlay([d(5), d(6)])).toEqual({ kind: 'run', count: 2, value: 6 });
        expect(classifyPlay([d(6), d(4), d(5)])).toEqual({ kind: 'run', count: 3, value: 6 });
    });

    it('rejects everything else', () => {
        expect(classifyPlay([])).toBeNull();
        expect(classifyPlay([d(4), d(6)])).toBeNull();          // gap
        expect(classifyPlay([d(4), d(4), d(5)])).toBeNull();    // repeat inside a run
    });
});

const run = (low: number, high: number) => play(...Array.from({ length: high - low + 1 }, (_, i) => d(low + i)));
const bomb = (low: number) => run(low, low + 4);

describe('beats', () => {
    it('a single is beaten by a higher single, or by a 2-die set or run', () => {
        expect(beats(play(d(11)), play(d(10)))).toBe(true);
        expect(beats(play(d(10)), play(d(10)))).toBe(false); // equal never beats
        expect(beats(play(...same(2, 1)), play(d(12)))).toBe(true);
        expect(beats(run(1, 2), play(d(12)))).toBe(true);
        expect(beats(play(...same(3, 1)), play(d(12)))).toBe(false); // two extra dice
        expect(beats(run(1, 3), play(d(12)))).toBe(false);
    });

    it('a set is beaten by exactly one more die, or the same count with a higher value', () => {
        expect(beats(play(...same(2, 6)), play(...same(2, 5)))).toBe(true);
        expect(beats(play(...same(2, 5)), play(...same(2, 5)))).toBe(false);
        expect(beats(play(...same(2, 12)), play(...same(3, 1)))).toBe(false); // fewer dice
        expect(beats(play(...same(3, 1)), play(...same(2, 9)))).toBe(true);
        expect(beats(play(...same(5, 1)), play(...same(3, 9)))).toBe(false); // two extra dice
    });

    it('a run is beaten by a run one die longer, or a same-length run with a higher top', () => {
        const table = run(9, 10);
        expect(beats(run(10, 11), table)).toBe(true);
        expect(beats(run(11, 12), table)).toBe(true);
        expect(beats(run(1, 3), table)).toBe(true);
        expect(beats(run(1, 4), table)).toBe(false); // two extra dice
        expect(beats(run(8, 9), table)).toBe(false);
        expect(beats(run(9, 10), table)).toBe(false);
    });

    it('sets and runs never beat each other', () => {
        expect(beats(play(...same(3, 12)), run(1, 2))).toBe(false);
        expect(beats(run(1, 3), play(...same(2, 1)))).toBe(false);
    });

    it('a bomb beats any single, set or run', () => {
        expect(beats(bomb(1), play(d(12)))).toBe(true);
        expect(beats(bomb(1), play(...same(5, 12)))).toBe(true);
        expect(beats(bomb(1), run(7, 12))).toBe(true);
    });

    it('nothing beats a bomb (it clears the table right away)', () => {
        expect(beats(bomb(4), bomb(3))).toBe(false);
        expect(beats(play(...same(5, 12)), bomb(3))).toBe(false);
    });
});

describe('describePlay', () => {
    it('reads naturally', () => {
        expect(describePlay(play(d(7)))).toBe('single 7');
        expect(describePlay(play(...same(2, 5)))).toBe('pair of 5s');
        expect(describePlay(play(...same(3, 5)))).toBe('three 5s');
        expect(describePlay(play(...same(4, 5)))).toBe('four 5s');
        expect(describePlay(bomb(3))).toBe('bomb 3–7');
        expect(describePlay(play(...same(5, 5)))).toBe('five 5s');
        expect(describePlay(run(3, 5))).toBe('run 3–5');
    });
});
