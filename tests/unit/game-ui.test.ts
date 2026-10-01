import { describe, expect, it } from 'vitest';
import { startGame } from '../../src/lib/game';
import { computeControls, dieHtml, renderHeader, type ViewState } from '../../src/lib/game-ui';

const view = (meId: string): ViewState => ({
    meId, isHost: false, selection: new Set(), tableSelection: null, sortBy: 'color',
    fresh: new Set(), animate: new Set(), animateElapsedMs: 0,
});

describe('dieHtml', () => {
    it('draws an ink shadow behind the die outline', () => {
        const html = dieHtml({ id: 'x', color: 'red', sides: 6, value: 4 });
        expect(html).toContain('class="die-shadow"');
        expect(html.indexOf('die-shadow')).toBeLessThan(html.indexOf('die-outline'));
        expect(html).toContain('viewBox="-4 -4 112 112"');
    });

    it('labels a just-rolled die with a NEW sticker', () => {
        expect(dieHtml({ id: 'x', color: 'red', sides: 6, value: 4 }, { fresh: true })).toContain('class="die-new"');
    });
});

describe('renderHeader', () => {
    const s = startGame([{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Ben' }], () => 0, { rulesetId: 'colors' });

    it('shows a YOUR TURN sticker to the player whose turn it is', () => {
        expect(renderHeader(s, view(s.turn))).toContain('tag-marker');
        expect(renderHeader(s, view(s.turn))).toContain('Your turn');
    });

    it('shows whose turn it is to everyone else', () => {
        const other = s.seating.find(id => id !== s.turn)!;
        const html = renderHeader(s, view(other));
        expect(html).not.toContain('Your turn');
        expect(html).toContain(`${s.names[s.turn]}`);
    });

    it('shows the round and the ruleset name', () => {
        const html = renderHeader(s, view(s.turn));
        expect(html).toContain('Round 1 / 3');
        expect(html).toContain('Colors');
    });
});

describe('computeControls: replace', () => {
    const s0 = startGame([{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Ben' }], () => 0, { rulesetId: 'colors-replace' });
    const die = (id: string, value: number) => ({ id, color: 'red' as const, sides: 12 as const, value });
    const s = {
        ...s0, turn: 'a', hands: { a: [die('a1', 6), die('a2', 9)], b: [die('b1', 1)] },
        table: { playerId: 'b', dice: [die('x', 5), die('y', 5)] },
    };
    const pick = (hand: string[], table: string): ViewState => ({ ...view('a'), selection: new Set(hand), tableSelection: table });

    it('offers Replace for one hand die and one table die when the swap is legal', () => {
        const c = computeControls(s, pick(['a1'], 'y'));
        expect(c.showReplace).toBe(true);
        expect(c.canReplace).toBe(true);
        expect(c.hint).toMatch(/swap/i);
    });

    it('refuses a swap that breaks the play', () => {
        const c = computeControls(s, pick(['a2'], 'y'));
        expect(c.canReplace).toBe(false);
        expect(c.hint).toMatch(/break the play/);
    });

    it('hides Replace in rulesets without it', () => {
        expect(computeControls({ ...s, rulesetId: 'colors' }, pick(['a1'], 'y')).showReplace).toBe(false);
    });
});
