import { describe, expect, it } from 'vitest';
import { bagSize, buildBag, COLORS, eachColorAndType } from '../../src/lib/dice';
import { applyAction, startGame } from '../../src/lib/game';
import { classifyTable, DEFAULT_RULESET_ID, getRuleset, RULESETS, rulesetList } from '../../src/lib/rulesets';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));

describe('registry', () => {
    it('keys match ids, and unknown ids fall back to the default', () => {
        for (const [key, rules] of Object.entries(RULESETS)) expect(rules.id).toBe(key);
        expect(getRuleset('nope').id).toBe(DEFAULT_RULESET_ID);
    });
});

describe('bags', () => {
    it('build one uniquely-identified die per recipe entry', () => {
        const recipe = eachColorAndType(2, ['red', 'blue'], [6, 12]);
        const bag = buildBag(recipe);
        expect(bag).toHaveLength(8);
        expect(bagSize(recipe)).toBe(8);
        expect(new Set(bag.map(d => d.id)).size).toBe(8);
        expect(bag.filter(d => d.color === 'blue' && d.sides === 12)).toHaveLength(2);
    });

    it.each(rulesetList().map(r => [r.id, r] as const))('%s has enough dice for a full table', (_, rules) => {
        expect(bagSize(rules.bag)).toBeGreaterThanOrEqual(rules.handSize * rules.maxPlayers);
    });

    it('Classic keeps the original 60-die bag; Colors uses 64', () => {
        expect(bagSize(RULESETS.classic.bag)).toBe(60);
        expect(bagSize(RULESETS.colors.bag)).toBe(64);
    });
});

describe('the engine follows the game’s ruleset', () => {
    it('deals from that ruleset’s bag and uses its hand size', () => {
        const s = startGame(players(3), Math.random, { rulesetId: 'classic', handSize: 7 });
        expect(s.rulesetId).toBe('classic');
        const dealt = s.seating.flatMap(id => s.hands[id]);
        expect(dealt).toHaveLength(21);
        // Classic colors dice by type
        for (const d of dealt) expect({ 4: 'red', 6: 'blue', 8: 'green', 12: 'yellow' }[d.sides]).toBe(d.color);
    });

    it('refuses more dice than the bag holds', () => {
        expect(() => startGame(players(5), Math.random, { rulesetId: 'classic', handSize: 13 })).toThrow(/Not enough dice/);
    });

    it('only allows picking up where the ruleset has it', () => {
        let s = startGame(players(2), () => 0, { rulesetId: 'classic' });
        const leader = s.turn;
        s = applyAction(s, { type: 'play', playerId: leader, dieIds: [s.hands[leader][0].id] });
        const other = s.turn;
        expect(() => applyAction(s, { type: 'pickup', playerId: other, dieId: s.table!.dice[0].id }))
            .toThrow(/no picking up/);
    });

    it('only allows replacing where the ruleset has it', () => {
        let s = startGame(players(2), () => 0, { rulesetId: 'colors' });
        const leader = s.turn;
        s = applyAction(s, { type: 'play', playerId: leader, dieIds: [s.hands[leader][0].id] });
        const other = s.turn;
        expect(() => applyAction(s, {
            type: 'replace', playerId: other, handDieId: s.hands[other][0].id, tableDieId: s.table!.dice[0].id,
        })).toThrow(/no replacing/);
    });
});

describe('Colors: bomb penalty', () => {
    // A run bomb red 1-5 against a red table, in a 2-player game.
    const red = (id: string, value: number) => ({ id, color: 'red' as const, sides: 12 as const, value });
    function bombState(rulesetId: 'colors' | 'colors-bomb-penalty', tableDice: ReturnType<typeof red>[], extra = true) {
        const s = startGame(players(2), () => 0, { rulesetId });
        const [a, b] = s.seating;
        return {
            ...s,
            turn: b,
            table: { playerId: a, dice: tableDice },
            hands: { [a]: [red('a9', 9)], [b]: [1, 2, 3, 4, 5].map(v => red(`b${v}`, v)).concat(extra ? [red('b9', 9)] : []) },
        };
    }
    const bomb = (s: ReturnType<typeof bombState>, takeBackId?: string) =>
        applyAction(s, { type: 'play', playerId: s.turn, dieIds: ['b1', 'b2', 'b3', 'b4', 'b5'], takeBackId }, () => 0);

    it('is Colors plus the penalty', () => {
        const rules = RULESETS['colors-bomb-penalty'];
        expect(rules.bombPenalty).toBe(true);
        expect(RULESETS.colors.bombPenalty).toBe(false);
        expect(rules.classifyPlay).toBe(RULESETS.colors.classifyPlay);
        expect(rules.bag).toBe(RULESETS.colors.bag);
    });

    it('the bomber takes back the chosen bombed die, rerolled; the table clears', () => {
        const s = bomb(bombState('colors-bomb-penalty', [red('t1', 7), red('t2', 8)]), 't2');
        expect(s.table).toBeNull();
        expect(s.turn).toBe(s.seating[1]); // the bomber still leads
        expect(s.hands[s.seating[1]].map(d => d.id).sort()).toEqual(['b9', 't2']);
        expect(s.hands[s.seating[1]].find(d => d.id === 't2')!.value).toBe(1);
        expect(s.rolled[s.seating[1]]).toEqual(['t2']);
    });

    it('requires a choice when several dice were bombed, and takes the only one otherwise', () => {
        expect(() => bomb(bombState('colors-bomb-penalty', [red('t1', 7), red('t2', 8)]))).toThrow(/choose one of the table dice/);
        const s = bomb(bombState('colors-bomb-penalty', [red('t1', 7)]));
        expect(s.hands[s.seating[1]].map(d => d.id).sort()).toEqual(['b9', 't1']);
    });

    it('going out with a bomb beats the penalty', () => {
        const s = bomb(bombState('colors-bomb-penalty', [red('t1', 7), red('t2', 8)], false));
        expect(s.finished).toContain(s.seating[1]);
        expect(s.hands[s.seating[1]]).toEqual([]);
    });

    it('plain Colors bombs still cost nothing', () => {
        const s = bomb(bombState('colors', [red('t1', 7), red('t2', 8)]), 't2');
        expect(s.hands[s.seating[1]].map(d => d.id)).toEqual(['b9']);
    });
});

describe('classifyTable', () => {
    const rules = RULESETS['colors-replace'];
    const red = (v: number) => ({ id: `r${v}`, color: 'red' as const, sides: 12 as const, value: v });

    it('reports a bomb shape as the plain run or set it is', () => {
        expect(classifyTable(rules, [1, 2, 3, 4, 5].map(red))).toEqual({ kind: 'run', count: 5, value: 5, color: 'red' });
        expect(classifyTable(rules, COLORS.map(color => ({ id: color, color, sides: 12 as const, value: 6 }))))
            .toEqual({ kind: 'set', count: 4, value: 6 });
    });

    it('leaves every other play alone', () => {
        expect(classifyTable(rules, [red(3)])).toEqual(rules.classifyPlay([red(3)]));
        expect(classifyTable(rules, [red(3), red(9)])).toBeNull();
    });

    it('only Colors: pass & replace has replacing', () => {
        expect(rulesetList().filter(r => r.replace).map(r => r.id)).toEqual(['colors-replace']);
    });
});
