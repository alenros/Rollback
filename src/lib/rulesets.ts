/**
 * Rulesets (Strategy pattern): each one bundles the bag recipe, the deal, and the
 * logic that decides what a play is and what beats what. Games store only the
 * ruleset id (Firebase holds plain JSON), and the engine looks the ruleset up
 * in the RULESETS registry.
 *
 * To add a ruleset: define it here, add it to RULESETS, and add its rules page
 * in src/pages/rules/[id].astro.
 */
import { bagSize, eachColorAndType, type DieSpec, type Die } from './dice';
import { allSame, consecutive, playKey, sortedValues, stronger, type Play } from './plays';

export interface Ruleset {
    id: string;
    name: string;
    /** One line for the lobby. */
    summary: string;
    /** Bump on every rules change, so telemetry from different versions can be told apart. */
    version: string;
    /** What's in the bag. */
    bag: readonly DieSpec[];
    handSize: number;
    rounds: number;
    minPlayers: number;
    maxPlayers: number;
    /** May a player take one die from the table instead of beating or passing? */
    pickup: boolean;
    /**
     * Does a bomb cost the bomber? If so they take back one of the bombed dice
     * (their choice), rerolled, unless the bomb took them out.
     */
    bombPenalty: boolean;
    classifyPlay(dice: readonly Die[]): Play | null;
    beats(challenger: Play, table: Play): boolean;
    /** For hints: must a play beating `table` be all one color? */
    colorRequired(table: Play): boolean;
}

// ---------------------------------------------------------------------------
// Bags
// ---------------------------------------------------------------------------

/** 4 colors × 4 types (d4, d6, d8, d12) × 4 = 64 dice. */
export const STANDARD_BAG: readonly DieSpec[] = eachColorAndType(4);

/** 15 of each type, one color per type (color is only for looks in Classic). */
export const CLASSIC_BAG: readonly DieSpec[] = [
    { sides: 4, color: 'red', count: 15 },
    { sides: 6, color: 'blue', count: 15 },
    { sides: 8, color: 'green', count: 15 },
    { sides: 12, color: 'yellow', count: 15 },
];

// ---------------------------------------------------------------------------
// Classic: color plays no part; a bomb is any run of exactly 5.
// ---------------------------------------------------------------------------

const classic: Ruleset = {
    id: 'classic',
    name: 'Classic',
    summary: 'Singles, sets and runs. Any 5-run is a bomb. Color is just for looks.',
    version: '2026-10-01',
    bag: CLASSIC_BAG,
    handSize: 9,
    rounds: 3,
    minPlayers: 2,
    maxPlayers: 5,
    pickup: false,
    bombPenalty: false,

    classifyPlay(dice) {
        if (dice.length === 0) return null;
        const count = dice.length;
        const values = sortedValues(dice);
        if (allSame(values)) return { kind: count === 1 ? 'single' : 'set', count, value: values[0] };
        if (consecutive(values)) {
            return count === 5
                ? { kind: 'bomb', of: 'run', count, value: values[count - 1] }
                : { kind: 'run', count, value: values[count - 1] };
        }
        return null;
    },

    beats(challenger, table) {
        if (table.kind === 'bomb') return false; // a bomb clears the table at once
        if (challenger.kind === 'bomb') return true;
        if (table.kind === 'single' && challenger.kind !== 'single') return challenger.count === 2;
        return challenger.kind === table.kind && stronger(challenger, table);
    },

    colorRequired: () => false,
};

// ---------------------------------------------------------------------------
// Colors: color bombs, follow one-color plays, pick up a die.
// ---------------------------------------------------------------------------

const RUN_BOMB_LENGTH = 5;
const SET_BOMB_SIZE = 4;

const oneColorRequired = (table: Play) => (table.kind === 'set' || table.kind === 'run') && !!table.color;

const colorsRules: Ruleset = {
    id: 'colors',
    name: 'Colors',
    summary: 'Same-color 5-runs and rainbow 4-sets are bombs, one-color plays must be followed in one color, and you may pick up and reroll a die from the table.',
    version: '2026-10-01-colors',
    bag: STANDARD_BAG,
    handSize: 9,
    rounds: 3,
    minPlayers: 2,
    maxPlayers: 5,
    pickup: true,
    bombPenalty: false,

    classifyPlay(dice) {
        if (dice.length === 0) return null;
        const count = dice.length;
        const values = sortedValues(dice);
        const colors = new Set(dice.map(d => d.color));
        const color = colors.size === 1 ? dice[0].color : undefined;
        const withColor = (play: Play): Play => (color ? { ...play, color } : play);

        if (allSame(values)) {
            if (count === 1) return withColor({ kind: 'single', count, value: values[0] });
            if (count === SET_BOMB_SIZE && colors.size === SET_BOMB_SIZE) {
                return { kind: 'bomb', of: 'set', count, value: values[0] };
            }
            return withColor({ kind: 'set', count, value: values[0] });
        }
        if (consecutive(values)) {
            const top = values[count - 1];
            if (count === RUN_BOMB_LENGTH && color) return { kind: 'bomb', of: 'run', count, value: top, color };
            return withColor({ kind: 'run', count, value: top });
        }
        return null;
    },

    beats(challenger, table) {
        if (table.kind === 'bomb') return false;
        if (challenger.kind === 'bomb') return true; // bombs ignore color
        if (oneColorRequired(table) && !challenger.color) return false;
        if (table.kind === 'single' && challenger.kind !== 'single') return challenger.count === 2;
        return challenger.kind === table.kind && stronger(challenger, table);
    },

    colorRequired: oneColorRequired,
};

// ---------------------------------------------------------------------------
// Colors: bomb penalty. Identical to Colors, except that a bomb, like an
// unbeatable trick-ender, costs the bomber one of the bombed dice.
// ---------------------------------------------------------------------------

const colorsBombPenalty: Ruleset = {
    ...colorsRules,
    id: 'colors-bomb-penalty',
    name: 'Colors: bomb penalty',
    summary: 'Colors, but a bomb costs you: take back one of the bombed dice, rerolled.',
    version: '2026-10-02-colors-bomb-penalty',
    bombPenalty: true,
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Keys must match each ruleset's `id` (checked by the unit tests). */
export const RULESETS = {
    classic,
    colors: colorsRules,
    'colors-bomb-penalty': colorsBombPenalty,
} satisfies Record<string, Ruleset>;

export type RulesetId = keyof typeof RULESETS;

export const DEFAULT_RULESET_ID: RulesetId = 'colors';

export function getRuleset(id: string | undefined): Ruleset {
    return RULESETS[id as RulesetId] ?? RULESETS[DEFAULT_RULESET_ID];
}

export const rulesetList = (): Ruleset[] => Object.values(RULESETS);

/** The most players any ruleset allows (rooms can never hold more). */
export const MAX_PLAYERS_ANY = Math.max(...rulesetList().map(r => r.maxPlayers));

export function totalDice(rules: Ruleset): number {
    return bagSize(rules.bag);
}

/**
 * Every distinct play in `hand` that beats `table` under `rules`, found by trying
 * each group of dice. Groups are capped at one more die than the table or 6,
 * whichever is larger (no ruleset has a bigger bomb). Used by telemetry.
 */
export function beatingPlays(rules: Ruleset, hand: readonly Die[], table: Play): Play[] {
    const limit = Math.min(hand.length, Math.max(table.count + 1, 6));
    const found = new Map<string, Play>();
    const pick: Die[] = [];
    const visit = (start: number) => {
        if (pick.length > 0) {
            const play = rules.classifyPlay(pick);
            if (play && rules.beats(play, table)) found.set(playKey(play), play);
        }
        if (pick.length === limit) return;
        for (let i = start; i < hand.length; i++) {
            pick.push(hand[i]);
            visit(i + 1);
            pick.pop();
        }
    };
    visit(0);
    return [...found.values()];
}
