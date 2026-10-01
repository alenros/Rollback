import { describe, expect, it } from 'vitest';
import { bagSize, buildBag, eachColorAndType } from '../../src/lib/dice';
import { applyAction, startGame } from '../../src/lib/game';
import { DEFAULT_RULESET_ID, getRuleset, RULESETS, rulesetList } from '../../src/lib/rulesets';

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
});
