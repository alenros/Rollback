import { describe, expect, it } from 'vitest';
import type { Die, Sides } from '../../src/lib/dice';
import {
    applyAction, normalizeGame, placePoints, standings, startGame, startNextRound,
    type GameState,
} from '../../src/lib/game';

/** Rolls always come up 1, which makes rerolls easy to spot. */
const ones = () => 0;

function seeded(seed: number) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const die = (id: string, value: number, sides: Sides = 12): Die => ({ id, sides, value });

const PLAYERS = [
    { id: 'a', name: 'Ann' },
    { id: 'b', name: 'Ben' },
    { id: 'c', name: 'Cat' },
];

function makeState(hands: Record<string, Die[]>, overrides: Partial<GameState> = {}): GameState {
    const seating = Object.keys(hands);
    return {
        gameId: 'test',
        seq: 0,
        round: 1,
        trick: 1,
        totalRounds: 3,
        handSize: 9,
        seating,
        names: Object.fromEntries(seating.map(id => [id, id.toUpperCase()])),
        hands,
        table: null,
        turn: seating[0],
        passed: [],
        rolled: {},
        finished: [],
        scores: Object.fromEntries(seating.map(id => [id, 0])),
        firstPlaces: Object.fromEntries(seating.map(id => [id, 0])),
        roundResults: [],
        phase: 'playing',
        log: [],
        ...overrides,
    };
}

const play = (s: GameState, playerId: string, ...dieIds: string[]) =>
    applyAction(s, { type: 'play', playerId, dieIds }, ones);
const pass = (s: GameState, playerId: string, ...rerollIds: string[]) =>
    applyAction(s, { type: 'pass', playerId, rerollIds }, ones);

describe('startGame', () => {
    it('deals 9 rolled dice to each player from one 60-die bag', () => {
        const s = startGame(PLAYERS, seeded(1));
        expect(s.phase).toBe('playing');
        expect(s.round).toBe(1);
        const all = s.seating.flatMap(id => s.hands[id]);
        expect(all).toHaveLength(27);
        expect(new Set(all.map(d => d.id)).size).toBe(27);
        for (const d of all) {
            expect([4, 6, 8, 12]).toContain(d.sides);
            expect(d.value).toBeGreaterThanOrEqual(1);
            expect(d.value).toBeLessThanOrEqual(d.sides);
        }
        expect(s.seating).toContain(s.turn);
    });

    it('requires 2–5 players', () => {
        expect(() => startGame(PLAYERS.slice(0, 1))).toThrow(/2–5/);
        expect(startGame(PLAYERS.slice(0, 2)).seating).toHaveLength(2);
        const six = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
        expect(() => startGame(six)).toThrow(/2–5/);
    });
});

describe('leading and turn order', () => {
    const base = () => makeState({
        a: [die('a1', 5), die('a2', 5)],
        b: [die('b1', 9), die('b2', 2)],
        c: [die('c1', 3), die('c2', 3), die('c3', 11)],
    });

    it('the leader plays exactly one die and cannot pass', () => {
        expect(() => play(base(), 'a', 'a1', 'a2')).toThrow(/one die/);
        expect(() => pass(base(), 'a')).toThrow(/leader/);
        const s = play(base(), 'a', 'a1');
        expect(s.table).toEqual({ playerId: 'a', dice: [die('a1', 5)] });
        expect(s.turn).toBe('b');
    });

    it('rejects moves out of turn or with foreign dice', () => {
        expect(() => play(base(), 'b', 'b1')).toThrow(/not your turn/);
        expect(() => play(base(), 'a', 'b1')).toThrow(/not behind your screen/);
    });

    it('beating takes the beaten dice back and rerolls them', () => {
        let s = play(base(), 'a', 'a1');
        s = play(s, 'b', 'b1'); // 9 beats 5
        expect(s.hands.b.map(d => d.id).sort()).toEqual(['a1', 'b2']);
        expect(s.hands.b.find(d => d.id === 'a1')!.value).toBe(1); // rerolled
        expect(s.table!.playerId).toBe('b');
        expect(s.turn).toBe('c');
    });

    it('rejects plays that do not beat the table', () => {
        const s = play(base(), 'a', 'a1');
        expect(() => play(s, 'b', 'b2')).toThrow(/does not beat/); // 2 vs 5
    });

    it('passing allows rerolling up to the table size', () => {
        let s = play(base(), 'a', 'a1');
        expect(() => pass(s, 'b', 'b1', 'b2')).toThrow(/at most 1 die/);
        s = pass(s, 'b', 'b2');
        expect(s.hands.b.find(d => d.id === 'b2')!.value).toBe(1);
        expect(s.hands.b.find(d => d.id === 'b1')!.value).toBe(9);
        expect(s.passed).toEqual(['b']);
        expect(s.turn).toBe('c');
    });

    it('passes are soft: the turn comes back and a passed player may still play', () => {
        let s = makeState({
            a: [die('a1', 5), die('a2', 5)],
            b: [die('b1', 9), die('b2', 9), die('b3', 1)],
            c: [die('c1', 3), die('c2', 3)],
        });
        s = play(s, 'a', 'a1');        // single 5
        s = pass(s, 'b');
        s = play(s, 'c', 'c1', 'c2');  // pair of 3s reopens the trick
        expect(s.passed).toEqual([]);
        s = pass(s, 'a');
        expect(s.turn).toBe('b');      // b passed earlier but gets another chance
        s = play(s, 'b', 'b1', 'b2');  // pair of 9s beats pair of 3s
        expect(s.table!.playerId).toBe('b');
        expect(s.hands.b.map(d => d.id).sort()).toEqual(['b3', 'c1', 'c2']);
    });

    it('tracks the dice each player just picked up or rerolled', () => {
        let s = play(base(), 'a', 'a1');
        s = pass(s, 'b', 'b2');
        expect(s.rolled.b).toEqual(['b2']);
        s = play(s, 'c', 'c1', 'c2');
        expect(s.rolled.c).toEqual(['a1']);
        expect(s.rolled.b).toEqual(['b2']); // untouched until b acts again
    });

    it('ends the trick when everyone but the last player has passed since that play', () => {
        let s = play(base(), 'a', 'a1');
        s = pass(s, 'b');
        s = play(s, 'c', 'c1', 'c2'); // pair of 3s beats a single
        s = pass(s, 'a');
        expect(s.turn).toBe('b');
        s = pass(s, 'b');             // a and b both passed since c played
        expect(s.table).toBeNull();
        expect(s.passed).toEqual([]);
        expect(s.turn).toBe('c');
        expect(s.hands.c.map(d => d.id)).toEqual(['c3', 'a1']);
    });
});

describe('bombs', () => {
    const bombHand = () => [1, 2, 3, 4, 5].map(v => die(`b${v}`, v));

    it('take nothing back, clear the table, and the bomber leads next', () => {
        let s = makeState({
            a: [die('a1', 9), die('a2', 3)],
            b: [...bombHand(), die('b6', 12)],
            c: [die('c1', 7)],
        });
        s = play(s, 'a', 'a1');
        s = play(s, 'b', 'b1', 'b2', 'b3', 'b4', 'b5');
        expect(s.hands.b.map(d => d.id)).toEqual(['b6']); // a1 was not picked up
        expect(s.rolled.b).toEqual([]);
        expect(s.table).toBeNull();
        expect(s.turn).toBe('b');
        expect(s.passed).toEqual([]);
    });

    it('can take you out; then the next player on your left leads', () => {
        let s = makeState({
            a: [die('a1', 9), die('a2', 3)],
            b: bombHand(),
            c: [die('c1', 7), die('c2', 8)],
        });
        s = play(s, 'a', 'a1');
        s = play(s, 'b', 'b1', 'b2', 'b3', 'b4', 'b5');
        expect(s.finished).toEqual(['b']);
        expect(s.table).toBeNull();
        expect(s.turn).toBe('c');
    });
});

describe('going out and scoring', () => {
    it('last play stays on the table; if its owner is out, the next player on the left leads', () => {
        let s = makeState({
            a: [die('a1', 12)],
            b: [die('b1', 1), die('b2', 2)],
            c: [die('c1', 1), die('c2', 2)],
        });
        s = play(s, 'a', 'a1');
        expect(s.finished).toEqual(['a']);
        expect(s.table!.playerId).toBe('a');
        expect(s.turn).toBe('b');
        s = pass(s, 'b');
        s = pass(s, 'c');
        expect(s.table).toBeNull();
        expect(s.turn).toBe('b'); // a is out, b is on a's left
    });

    it('playing your whole hand takes you out without picking up', () => {
        let s = makeState({
            a: [die('a1', 9), die('a2', 3)],
            b: [die('b1', 5), die('b2', 5)],
            c: [die('c1', 7), die('c2', 7), die('c3', 7)],
        });
        s = play(s, 'a', 'a1');
        s = play(s, 'b', 'b1', 'b2');       // pair beats single, using b's whole hand
        expect(s.finished).toEqual(['b']);
        expect(s.hands.b).toEqual([]);      // a1 was not picked up
        expect(s.table!.playerId).toBe('b'); // the play stays and can still be beaten
        expect(s.turn).toBe('c');
        s = play(s, 'c', 'c1', 'c2');
        expect(s.hands.c.map(d => d.id).sort()).toEqual(['b1', 'b2', 'c3']);
    });

    it('scores the round when one player is left, then the winner leads the next round', () => {
        let s = makeState({
            a: [die('a1', 12)],
            b: [die('b1', 7)],
            c: [die('c1', 1), die('c2', 2)],
        });
        s = play(s, 'a', 'a1');                 // a out 1st
        s = pass(s, 'b');
        s = pass(s, 'c');                        // trick ends, b leads
        s = play(s, 'b', 'b1');                  // b out 2nd, c is last
        expect(s.phase).toBe('roundOver');
        expect(s.roundResults).toEqual([['a', 'b', 'c']]);
        expect(s.scores).toEqual({ a: 2, b: 1, c: 0 });
        expect(s.firstPlaces.a).toBe(1);

        const next = startNextRound(s, seeded(7));
        expect(next.round).toBe(2);
        expect(next.phase).toBe('playing');
        expect(next.turn).toBe('a');
        expect(next.seating.every(id => next.hands[id].length === 9)).toBe(true);
    });

    it('matches the scoring table', () => {
        expect([0, 1, 2].map(i => placePoints(i, 3))).toEqual([2, 1, 0]);
        expect([0, 1, 2, 3, 4].map(i => placePoints(i, 5))).toEqual([4, 3, 2, 1, 0]);
    });

    it('ends the game after the last round and breaks ties on first places', () => {
        const s = makeState({ a: [], b: [], c: [] }, {
            phase: 'gameOver',
            scores: { a: 3, b: 3, c: 0 },
            firstPlaces: { a: 1, b: 2, c: 0 },
        });
        expect(standings(s).map(r => [r.playerId, r.rank])).toEqual([['b', 1], ['a', 2], ['c', 3]]);
    });
});

describe('normalizeGame', () => {
    it('restores arrays that Firebase dropped or turned into objects', () => {
        const raw = {
            ...makeState({ a: [], b: [], c: [] }),
            hands: { a: { 0: die('x', 1) } },
            passed: undefined,
            finished: undefined,
            log: undefined,
            roundResults: undefined,
            table: { playerId: 'a', dice: { 0: die('y', 2) } },
        };
        const s = normalizeGame(raw);
        expect(s.hands).toEqual({ a: [die('x', 1)], b: [], c: [] });
        expect(s.passed).toEqual([]);
        expect(s.table!.dice).toHaveLength(1);
    });
});
