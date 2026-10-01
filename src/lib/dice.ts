export const COLORS = ['red', 'blue', 'green', 'yellow'] as const;
export type Color = typeof COLORS[number];

export const DIE_SIDES = [4, 6, 8, 12] as const;
export type Sides = typeof DIE_SIDES[number];

export interface Die {
    id: string;
    color: Color;
    sides: Sides;
    value: number;
}

/** One line of a bag recipe: `count` dice with this many sides, in this color. */
export interface DieSpec {
    sides: Sides;
    color: Color;
    count: number;
}

/** Every color × every type, `count` of each: the usual way to build a recipe. */
export function eachColorAndType(
    count: number,
    colors: readonly Color[] = COLORS,
    sides: readonly Sides[] = DIE_SIDES,
): DieSpec[] {
    return colors.flatMap(color => sides.map(s => ({ sides: s, color, count })));
}

export function bagSize(recipe: readonly DieSpec[]): number {
    return recipe.reduce((total, spec) => total + spec.count, 0);
}

/** The physical dice for a recipe, each with a stable unique id (values are set when rolled). */
export function buildBag(recipe: readonly DieSpec[]): Die[] {
    const seen = new Map<string, number>();
    return recipe.flatMap(({ sides, color, count }) => Array.from({ length: count }, () => {
        const key = `${color}-d${sides}`;
        const n = seen.get(key) ?? 0;
        seen.set(key, n + 1);
        return { id: `${key}-${n}`, color, sides, value: 1 };
    }));
}

/** Returns a float in [0, 1). Injectable so the engine is deterministic under test. */
export type Rng = () => number;

export function rollValue(sides: number, rng: Rng = Math.random): number {
    return 1 + Math.floor(rng() * sides);
}

export function roll(die: Die, rng: Rng = Math.random): Die {
    return { ...die, value: rollValue(die.sides, rng) };
}

/** Fisher–Yates shuffle; returns a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}
