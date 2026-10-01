import { describe, expect, it } from 'vitest';
import { startGame } from '../../src/lib/game';
import { DIE_SIDES } from '../../src/lib/dice';
import { computeControls, dieHtml, INDEX_SIZE, MIN_PIP_SIZE, pipCenters, renderHeader, SHAPES, type Point, type ViewState } from '../../src/lib/game-ui';

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

    const pipCount = (html: string) => html.split('class="pip"').length - 1;
    const pipFace = (html: string) => html.slice(html.indexOf('die-face-pips'), html.indexOf('die-face-number'));
    const numberFace = (html: string) => html.slice(html.indexOf('die-face-number'));

    it('shows values up to 9 as that many suit pips, with no numeral', () => {
        for (const value of [1, 6, 7, 8, 9]) {
            const html = dieHtml({ id: 'x', color: 'red', sides: 12, value });
            expect(pipCount(html)).toBe(value);
            expect(pipFace(html)).not.toContain('<text');
        }
    });

    it('shows faces too crowded for pips as a numeral over a single suit index', () => {
        for (const [sides, value] of [[12, 10], [12, 11], [12, 12], [8, 6], [8, 8]] as const) {
            const face = pipFace(dieHtml({ id: 'x', color: 'red', sides, value }));
            expect(face).toContain(`>${value}</text>`);
            expect(pipCount(face)).toBe(0);
            expect(face).toContain('class="die-index"');
        }
    });

    it('draws a d8 up to 5 and a d4 2 (stacked vertically) as pips', () => {
        expect(pipCount(dieHtml({ id: 'x', color: 'blue', sides: 8, value: 5 }))).toBe(5);
        const [top, bottom] = pipCenters(4, 2);
        expect(top[0]).toBe(bottom[0]);
        expect(top[1]).toBeLessThan(bottom[1]);
    });

    it('draws each color in its own suit', () => {
        const suitOf = (color: 'red' | 'blue' | 'green' | 'yellow') =>
            dieHtml({ id: 'x', color, sides: 6, value: 3 }).match(/die-suit-(\w+)/)?.[1];
        expect(suitOf('red')).toBe('hearts');
        expect(suitOf('blue')).toBe('diamonds');
        expect(suitOf('green')).toBe('clubs');
        expect(suitOf('yellow')).toBe('spades');
    });

    it('keeps every pip big, well inside the die outline and apart from its neighbors', () => {
        const EDGE_GAP = 9; // viewBox units between a pip and the inner edge of the 6-unit outline stroke
        const distToEdge = ([x, y]: Point, hull: Point[]) => Math.min(...hull.map(([ax, ay], i) => {
            const [bx, by] = hull[(i + 1) % hull.length];
            return Math.abs((x - ax) * (by - ay) - (y - ay) * (bx - ax)) / Math.hypot(bx - ax, by - ay);
        }));
        for (const sides of DIE_SIDES) {
            const { hull, pips } = SHAPES[sides];
            expect(pips.size, `d${sides} pip size`).toBeGreaterThanOrEqual(MIN_PIP_SIZE);
            if (pips.max < sides) {
                expect(distToEdge([50, pips.indexY!], hull) - 3 - INDEX_SIZE / 2, `d${sides} suit index`).toBeGreaterThanOrEqual(EDGE_GAP);
            }
            for (let value = 1; value <= pips.max; value++) {
                const centers = pipCenters(sides, value);
                expect(centers).toHaveLength(value);
                for (const c of centers) {
                    expect(distToEdge(c, hull) - 3 - pips.size / 2, `d${sides} showing ${value}`).toBeGreaterThanOrEqual(EDGE_GAP);
                }
                centers.forEach((a, i) => centers.slice(i + 1).forEach(b =>
                    expect(Math.hypot(a[0] - b[0], a[1] - b[1]), `d${sides} showing ${value}`).toBeGreaterThan(pips.size)));
            }
        }
    });

    it('also carries a plain-numeral face, for players who switch pips off', () => {
        for (const sides of DIE_SIDES) {
            const face = numberFace(dieHtml({ id: 'x', color: 'green', sides, value: 3 }));
            expect(face).toContain(`class="die-number" x="50" y="${SHAPES[sides].numberY}">3</text>`);
            expect(pipCount(face)).toBe(0);
        }
    });

    it('keeps the value in the accessible label', () => {
        expect(dieHtml({ id: 'x', color: 'blue', sides: 8, value: 7 })).toContain('aria-label="blue d8 showing 7"');
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
