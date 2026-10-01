# Rollback

Online multiplayer version of **Rollback**, a dice climbing game for 3–5 players where beating a play means taking it back. The full rules are in [Rules.md](Rules.md) and in the app at `/rules`.

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
| `pnpm test:e2e` | Three-browser Playwright flow against the Firebase in `.env`. Set `PW_CHANNEL=msedge` (or `chrome`) to use an installed browser instead of Playwright's own build. |
| `pnpm cleanup:firebase` | Delete rooms older than 24h |

## How it works

```
src/lib/
  dice.ts          60-die bag, rolling, shuffling
  plays.ts         classifyPlay() / beats(): singles, sets, bombs
  game.ts          pure rules engine: deal, lead, beat, pass, tricks, going out, scoring
  room-actions.ts  Firebase glue: every change is a transaction that runs the engine
  telemetry.ts     gameplay event log, derived from before/after states
  game-ui.ts       HTML rendering for the game page
  session.ts       localStorage identity (no accounts), HTML escaping
src/pages/
  index / join / lobby / game / rules
```

- **Rooms** live at `rooms/{CODE}` with `players` and, once started, a `game` object (`GameState` in `game.ts`).
- **Moves run as transactions.** `sendAction()` runs `applyAction()` inside `ref.transaction()`. If two players act at once, Firebase replays the later update against the new state and the engine rejects it if it's no longer legal. There is no server, so every client enforces the rules.
- **Randomness** (the deal and all rerolls) happens inside the transaction of the player who triggers it.
- **Seating** is lobby join order, clockwise. The first leader is random. After that, the first player out leads the next round.

### Gameplay telemetry

Every committed change is appended to `telemetry/games/{gameId}/events/{seq}-{n}`. This is an append-only event log, kept separate from `rooms/` so the room cleanup never deletes it.

| Event | When | Key fields |
|---|---|---|
| `gameStart` | host starts | `rulesVersion`, `playerCount`, `seating`, `handSize`, `totalRounds` |
| `roundStart` | each deal | `leader`, every player's `hands` |
| `play` | lead or beat | `hand` before the move, `dice`, `play`, `beat`, `pickedUp`, `wentOut`, `trickEnded`, `handSizes` |
| `pass` | pass | `hand`, `table`, `beatOptions` (0 = forced pass), `allowance`, `rerolls` (from → to), `handSizes` |
| `roundEnd` | round over | `finished` order, `tricks`, `scores` |
| `gameEnd` | game over | final `standings` |

- Every event also carries `gameId`, `seq` (the order within the game), `round` and a server timestamp `at`. The gaps between `at` values give think time.
- Dice are written as `"sides:value"`, e.g. `"8:5"`. No player names are stored, only the random per-game player ids.
- The acting client writes the events after its transaction commits. If that browser closes at that exact moment, the event is lost; the game itself is unaffected.
- Bump `RULES_VERSION` in `game.ts` whenever the rules change, so data from different rule sets can be told apart.
- Clients can't read telemetry. Export it from the Firebase console (**Realtime Database → ⋮ → Export JSON**) on the `telemetry` node.

### Known limitations

- **Hidden information is trust-based**, just like in obviously-static. Every hand is stored in the room, so anyone reading the database directly can see all the screens. The UI shows only your own dice.
- If a player leaves mid-game, the game can't continue without them. They can rejoin from the same browser (the home page shows **Rejoin room**).
- The variants (shorter game, penalty scoring) are not implemented. `startGame()` already accepts `handSize` and `totalRounds`.

See [DEPLOYMENT.md](DEPLOYMENT.md) for GitHub Pages and Firebase setup.
