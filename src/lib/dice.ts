export const COLORS = ['red', 'blue', 'green', 'yellow'] as const;
export type Color = typeof COLORS[number];

export const DIE_SIDES = [4, 6, 8, 12] as const;
export type Sides = typeof DIE_SIDES[number];

/** Dice of each color/type combination in the bag (4 colors × 4 types × 4 = 64 dice). */
export const COPIES = 4;

export interface Die {
    id: string;
    color: Color;
    sides: Sides;
    value: number;
}

/** Returns a float in [0, 1). Injectable so the engine is deterministic under test. */
export type Rng = () => number;

export function rollValue(sides: number, rng: Rng = Math.random): number {
    return 1 + Math.floor(rng() * sides);
}

export function roll(die: Die, rng: Rng = Math.random): Die {
    return { ...die, value: rollValue(die.sides, rng) };
}

export function createBag(): Die[] {
    const bag: Die[] = [];
    for (const color of COLORS) {
        for (const sides of DIE_SIDES) {
            for (let copy = 0; copy < COPIES; copy++) {
                bag.push({ id: `${color}-d${sides}-${copy}`, color, sides, value: 1 });
            }
        }
    }
    return bag;
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
