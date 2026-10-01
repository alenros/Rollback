# Rollback

Online multiplayer version of **Rollback**, a dice climbing game for 2–5 players where beating a play means taking it back. It ships with several **rulesets** the host picks in the lobby: [Colors](Rules.md), [Colors: bomb penalty](Rules.colors-bomb-penalty.md) and [Classic](Rules.classic.md). Both are also in the app at `/rules`.

The infrastructure follows [obviously-static](https://github.com/alenros/obviously-static): a static [Astro](https://astro.build) site on GitHub Pages, with a Firebase Realtime Database as the only backend.

## Quick start

```bash
pnpm install
cp .env.example .env   # fill in your Firebase web-app config
pnpm dev               # http://localhost:4321
```

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server |
| `pnpm build` | Static build to `dist/` |
| `pnpm check` | Type-check `.astro` and `.ts` files |
| `pnpm test` | Unit tests for the rules engine (Vitest, no Firebase needed) |
| `pnpm test:e2e` | Three-browser Playwright flow against the Firebase in `.env`. Set `PW_CHANNEL=msedge` (or `chrome`) to use an installed browser instead of Playwright's own build, and `PW_BASE_URL` to test a dev server on another port. |
| `pnpm cleanup:firebase` | Delete rooms older than 24h |

## How it works

```
src/lib/
  dice.ts          dice, bag recipes (DieSpec lists), rolling, shuffling
  plays.ts         the Play shape and ruleset-independent helpers
  rulesets.ts      the rulesets (Strategy pattern) and their registry
  game.ts          pure engine: deal, lead, beat, pass, pick up, tricks, going out, scoring
  room-actions.ts  Firebase glue: every change is a transaction that runs the engine
  telemetry.ts     gameplay event log, derived from before/after states
  game-ui.ts       HTML rendering for the game page
  session.ts       localStorage identity (no accounts), HTML escaping
src/pages/
  index / join / lobby / game / rules/ (index + one page per ruleset)
```

- **Rooms** live at `rooms/{CODE}` with `players`, the chosen `rulesetId`, and, once started, a `game` object (`GameState` in `game.ts`).
- **Moves run as transactions.** `sendAction()` runs `applyAction()` inside `ref.transaction()`. If two players act at once, Firebase replays the later update against the new state and the engine rejects it if it's no longer legal. There is no server, so every client enforces the rules.
- **Randomness** (the deal and all rerolls) happens inside the transaction of the player who triggers it.
- **Seating** is lobby join order, clockwise. The first leader is random. After that, the first player out leads the next round.

### Rulesets

A ruleset (`Ruleset` in `rulesets.ts`) bundles everything that can differ between versions of the game:

- **`bag`**: a recipe of `{ sides, color, count }` lines. Rulesets can share one (`STANDARD_BAG`, 4 colors × 4 types × 4) or define their own (`CLASSIC_BAG`, 15 of each type, colored by type). Build recipes with `eachColorAndType(count, colors?, sides?)` or list lines by hand.
- **Numbers**: `handSize`, `rounds`, `minPlayers`, `maxPlayers`. `startGame` refuses a deal the bag can't cover.
- **Logic**: `classifyPlay`, `beats`, and `colorRequired`, plus switches: `pickup` turns the pick-up action on or off, and `bombPenalty` makes a bomb cost the bomber one of the bombed dice.

A variant can copy another ruleset and change a few fields: `colors-bomb-penalty` is `{ ...colors, bombPenalty: true }` plus its own id, name and version.

Games store only `rulesetId`. The engine, UI and telemetry look the ruleset up with `rulesOf(state)`. To add a ruleset: define it in `rulesets.ts`, add it to `RULESETS`, and map its rules document in `src/pages/rules/[id].astro`.

### Gameplay telemetry

Every committed change is appended to `telemetry/games/{gameId}/events/{seq}-{n}`. This is an append-only event log, kept separate from `rooms/` so the room cleanup never deletes it. The `gameId` is `yyyy-mm-dd-HH:mm-<GUID>` (UTC start time, e.g. `2026-10-02-14:07-3f2b8c1e-9d4a-4f5e-8b6c-2a1d0e9f7c35`), so games are readable and list in chronological order.

| Event | When | Key fields |
|---|---|---|
| `gameStart` | host starts | `rulesetId`, `rulesVersion`, `playerCount`, `seating`, `handSize`, `totalRounds` |
| `roundStart` | each deal | `leader`, every player's `hands` |
| `play` | lead or beat | `hand` before the move, `dice`, `play`, `beat`, `pickedUp`, `wentOut`, `trickEnded`, `handSizes` |
| `pass` | pass | `hand`, `table`, `beatOptions` (0 = forced pass), `allowance`, `rerolls` (from → to), `handSizes` |
| `pickup` | pick up | `hand`, `table`, `beatOptions`, `die` (from → to), `trickEnded`, `handSizes` |
| `roundEnd` | round over | `finished` order, `tricks`, `scores` |
| `gameEnd` | game over | final `standings` |

- Every event also carries `gameId`, `seq` (the order within the game), `round` and a server timestamp `at`. The gaps between `at` values give think time.
- Dice are written as `"color:sides:value"`, e.g. `"red:8:5"`. No player names are stored, only the random per-game player ids.
- The acting client writes the events after its transaction commits. If that browser closes at that exact moment, the event is lost; the game itself is unaffected.
- Bump a ruleset's `version` whenever its rules change, so data from different versions can be told apart.
- Clients can't read telemetry. Export it from the Firebase console (**Realtime Database → ⋮ → Export JSON**) on the `telemetry` node.

### Known limitations

- **Hidden information is trust-based**, just like in obviously-static. Every hand is stored in the room, so anyone reading the database directly can see all the screens. The UI shows only your own dice.
- If a player leaves mid-game, the game can't continue without them. They can rejoin from the same browser (the home page shows **Rejoin room**).
- The variants (shorter game, penalty scoring) are not implemented. `startGame()` already accepts `handSize` and `totalRounds`.

See [DEPLOYMENT.md](DEPLOYMENT.md) for GitHub Pages and Firebase setup.
