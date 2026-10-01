import { describe, expect, it } from 'vitest';
import { COLORS, type Color, type Die, type Sides } from '../../src/lib/dice';
import { beats, classifyPlay, describePlay, possiblePlays, type Play } from '../../src/lib/plays';

let seq = 0;
/** Without an explicit color, dice cycle through the colors so groups come out mixed. */
const d = (value: number, color: Color = COLORS[seq % COLORS.length], sides: Sides = 12): Die =>
    ({ id: `t${seq++}`, color, sides, value });
/** `count` dice of one value: one color if given, otherwise red/blue alternating (never rainbow). */
const same = (count: number, value: number, color?: Color) =>
    Array.from({ length: count }, (_, i) => d(value, color ?? (i % 2 ? 'blue' : 'red')));
const runOf = (low: number, high: number, color?: Color) =>
    Array.from({ length: high - low + 1 }, (_, i) => d(low + i, color ?? (i % 2 ? 'blue' : 'red')));
const play = (dice: Die[]): Play => {
    const p = classifyPlay(dice);
    if (!p) throw new Error('invalid test play');
    return p;
};
const rainbow = (value: number) => COLORS.map(c => d(value, c));

describe('classifyPlay', () => {
    it('classifies singles, sets and runs, noting one-color plays', () => {
        expect(classifyPlay([d(7, 'red')])).toEqual({ kind: 'single', count: 1, value: 7, color: 'red' });
        expect(classifyPlay(same(2, 5))).toEqual({ kind: 'set', count: 2, value: 5 });
        expect(classifyPlay(same(3, 5, 'green'))).toEqual({ kind: 'set', count: 3, value: 5, color: 'green' });
        expect(classifyPlay(same(4, 5))).toEqual({ kind: 'set', count: 4, value: 5 });
        expect(classifyPlay(runOf(4, 6))).toEqual({ kind: 'run', count: 3, value: 6 });
        expect(classifyPlay(runOf(4, 6, 'blue'))).toEqual({ kind: 'run', count: 3, value: 6, color: 'blue' });
    });

    it('a set of 4 in four different colors is a bomb', () => {
        expect(classifyPlay(rainbow(3))).toEqual({ kind: 'bomb', of: 'set', count: 4, value: 3 });
    });

    it('a one-color run of exactly 5 is a bomb; mixed or other lengths are runs', () => {
        expect(classifyPlay(runOf(1, 5, 'red'))).toEqual({ kind: 'bomb', of: 'run', count: 5, value: 5, color: 'red' });
        expect(classifyPlay(runOf(1, 5))!.kind).toBe('run');
        expect(classifyPlay(runOf(1, 4, 'red'))!.kind).toBe('run');
        expect(classifyPlay(runOf(1, 6, 'red'))!.kind).toBe('run');
    });

    it('rejects everything else', () => {
        expect(classifyPlay([])).toBeNull();
        expect(classifyPlay([d(4), d(6)])).toBeNull();
        expect(classifyPlay([d(4), d(4), d(5)])).toBeNull();
    });
});

describe('beats', () => {
    it('a single is beaten by a higher single of any color, or a 2-die set or run', () => {
        expect(beats(play([d(11, 'blue')]), play([d(10, 'red')]))).toBe(true);
        expect(beats(play([d(10)]), play([d(10)]))).toBe(false);
        expect(beats(play(same(2, 1)), play([d(12)]))).toBe(true);
        expect(beats(play(runOf(1, 2)), play([d(12)]))).toBe(true);
        expect(beats(play(same(3, 1)), play([d(12)]))).toBe(false); // two extra dice
    });

    it('sets and runs need one more die, or the same count and a higher value', () => {
        expect(beats(play(same(2, 6)), play(same(2, 5)))).toBe(true);
        expect(beats(play(same(3, 1)), play(same(2, 9)))).toBe(true);
        expect(beats(play(same(4, 1)), play(same(2, 9)))).toBe(false);
        expect(beats(play(runOf(10, 11)), play(runOf(9, 10)))).toBe(true);
        expect(beats(play(runOf(1, 3)), play(runOf(9, 10)))).toBe(true);
        expect(beats(play(runOf(1, 4)), play(runOf(9, 10)))).toBe(false);
        expect(beats(play(same(3, 12)), play(runOf(1, 2)))).toBe(false); // kinds never mix
    });

    it('a one-color set or run must be beaten by a one-color play, in any color', () => {
        const redPair = play(same(2, 5, 'red'));
        expect(beats(play(same(2, 6)), redPair)).toBe(false);          // mixed
        expect(beats(play(same(2, 6, 'blue')), redPair)).toBe(true);   // other single color
        expect(beats(play(same(3, 1, 'red')), redPair)).toBe(true);
        const greenRun = play(runOf(3, 4, 'green'));
        expect(beats(play(runOf(4, 5)), greenRun)).toBe(false);
        expect(beats(play(runOf(4, 5, 'yellow')), greenRun)).toBe(true);
        // a mixed play on the table can be beaten by anything that is otherwise stronger
        expect(beats(play(same(2, 6, 'red')), play(same(2, 5)))).toBe(true);
    });

    it('bombs beat anything but a bomb, ignoring color', () => {
        const bombs = [play(rainbow(1)), play(runOf(1, 5, 'red'))];
        for (const bomb of bombs) {
            expect(beats(bomb, play([d(12)]))).toBe(true);
            expect(beats(bomb, play(same(3, 12, 'green')))).toBe(true);
            expect(beats(bomb, play(runOf(7, 10, 'blue')))).toBe(true);
            expect(beats(bomb, play(rainbow(12)))).toBe(false); // the table clears, nothing beats a bomb
        }
    });
});

describe('possiblePlays', () => {
    it('includes one-color variants and both kinds of bomb', () => {
        const hand = [...runOf(1, 5, 'red'), d(3, 'blue'), d(3, 'green'), d(3, 'yellow')];
        const plays = possiblePlays(hand);
        expect(plays).toContainEqual({ kind: 'bomb', of: 'run', count: 5, value: 5, color: 'red' });
        expect(plays).toContainEqual({ kind: 'bomb', of: 'set', count: 4, value: 3 });
        expect(plays).toContainEqual({ kind: 'run', count: 3, value: 3, color: 'red' });
        expect(plays).toContainEqual({ kind: 'set', count: 3, value: 3 });
    });
});

describe('describePlay', () => {
    it('reads naturally', () => {
        expect(describePlay(play([d(7, 'red')]))).toBe('red 7');
        expect(describePlay(play(same(2, 5)))).toBe('pair of 5s');
        expect(describePlay(play(same(3, 5, 'blue')))).toBe('blue three 5s');
        expect(describePlay(play(runOf(3, 5)))).toBe('run 3–5');
        expect(describePlay(play(runOf(3, 7, 'green')))).toBe('green bomb 3–7');
        expect(describePlay(play(rainbow(4)))).toBe('rainbow bomb of 4s');
    });
});
