# Ludo Arena — Structure & Code Review

## 1. Structure Report

```
remix-ludo-arena/
├── src/
│   ├── engine/        Pure TS game logic (types, constants, rules, gameEngine, botEngine, boardCoordinates)
│   ├── components/    React UI: board/, game/, navigation/, pwa/, screens/
│   ├── audio/         Web Audio synthesizer (soundEffects.ts)
│   ├── storage/       localStorage profile / history / settings
│   ├── network/       protocol.ts — message types only (no transport)
│   ├── App.tsx        Screen router (useState-based, no router library)
│   └── main.tsx, index.css
├── public/            icon.svg, manifest.json, assets/aistudio/ (6 PNGs, ~1.5 MB, unreferenced)
├── .aistudio/         AI Studio session artifacts (not app code)
├── *.md               PRD, architecture, game-rules, multiplayer-protocol, testing-plan, README
├── package.json, bun.lock, tsconfig.json, vite.config.ts, index.html, metadata.json, .env.example
```

**Layering (good):** the engine has no React/DOM imports; `components/screens/BoardGameScreen.tsx` is the only place that drives it (timers, animation, bot turns). The layering matches `architecture.md`.

**Size hot spots:** `BoardGameScreen.tsx` (~17 KB), `LobbyScreen.tsx` (~22 KB), `CornerPlayerPod.tsx` (~10 KB). `LobbyScreen` and `BoardGameScreen` are candidates for splitting.

**Missing:** no git repository, no test files, no `test` script (testing-plan.md describes Vitest/Playwright that are not installed), no server code.

## 2. Dependency & Config Report

| Item | Status |
|---|---|
| `@google/genai`, `express`, `@types/express`, `dotenv`, `tsx`, `esbuild` | Not imported anywhere in `src/` — likely leftovers from the AI Studio template |
| `motion` | No imports found — verify and remove if unused |
| `canvas-confetti`, `lucide-react`, `vite-plugin-pwa`, `@tailwindcss/vite` | Used |
| `scripts.clean` | Removes `server.js`, which does not exist |
| `scripts.lint` | Runs `tsc --noEmit` — fine, but there is no test script |
| `.env.example` | Declares `GEMINI_API_KEY` / `APP_URL`; nothing in the client reads them |
| Lockfiles | `bun.lock` present, README says `npm install` — pick one |
| `.gitignore` | Does not exclude `.aistudio/` |
| `vite.config.ts` | `devOptions.enabled: true` for the PWA plugin (service worker runs in dev) — intentional? |

## 3. Code Review — Findings

### High

1. **Stats are fabricated on every match** — `BoardGameScreen.tsx:316-326`
   `captures: 4` and `place: isVictory ? 1 : 2` are hard-coded. Every finished match adds 4 captures to the profile (`profileStore.ts:155`). Actual captures are never counted.
   *Fix:* count captures from `lastAction.capturedToken` / log entries in the engine, and derive `place` from `winners`.

2. **Multiplayer is UI-only.** `network/protocol.ts` defines message types, but no WebSocket client exists, and `Room`/`Matchmaking` screens just start a local `classic_4p` game with bots (`App.tsx:80-88`). The README and architecture docs describe a working Durable Object backend. Users (and docs) will expect online play that does not exist.
   *Fix:* label these as mocks in the UI, or update the docs to say "planned".

3. **Demo data ships as real defaults** — `profileStore.ts:46-57` seeds `DEFAULT_PROFILE` with fake stats (4 matches, 3 wins, 14 captures, etc.), and `loadMatchHistory` writes three fake match records into localStorage on first run.
   *Fix:* start from zeros, or gate seed data behind a dev flag.

### Medium

4. **Timer cleanup bug in bot roll** — `BoardGameScreen.tsx:267-281`. `return () => clearTimeout(innerTimer)` is inside a `setTimeout` callback, so React never receives it. `innerTimer` is never cancelled on unmount or re-run. The guard in `rollDice` (phase check) prevents a double roll today, but the cleanup is dead code.
   *Fix:* store `innerTimer` in a ref and clear it in the effect cleanup.

5. **Stale match start time on rematch** — `matchStartTime` is `useState(Date.now())` and never reset in `handleRematch` (line 330-337). The second match's `durationSeconds` includes the first match's time.

6. **Pass-and-play records a false outcome** — the human is always `players.find(p => !p.isBot)`, so every pass-and-play game is logged as a red-player result.
   *Fix:* skip history recording for `pass_and_play` (or make it multi-player aware).

7. **Type-narrowing smell in engine** — `gameEngine.ts:319,352-357,531`. `capturedTokenInfo` is assigned inside a `.map` callback. TypeScript narrows it to `null` at the return site, so `capturedToken` is typed as `null` even when a capture happened. It works at runtime but the type is wrong. Replace the closure with a value computed before the map.

8. **Log/React key collisions** — `gameEngine.ts` builds log IDs with `Date.now()`; several entries can share a millisecond (e.g. `log-${Date.now()}` on a roll and a move in the same tick). Use a counter or `crypto.randomUUID()`.

9. **Non-validated localStorage reads** — `loadMatchHistory` and `loadProfile` `JSON.parse` into typed objects without shape checks; a corrupt or older-format entry flows straight into the UI.

### Low

10. **Unused / dead assets** — `public/assets/aistudio/*.png` (~1.5 MB) are not referenced; `.aistudio/` holds session artifacts.
11. **Hard-coded team winner colour** — `gameEngine.ts:440,444` set `winnerColor` to `'red'`/`'green'` for teams; OK for display, but fragile if colours change.
12. **Duplicate constants** — `DEFAULT_RULES` lives in `gameEngine.ts` but is imported by `profileStore.ts` (engine → storage coupling in reverse; minor).
13. **Engine is correct on the points I checked**: exact-roll finish (`rules.ts`, moves past `TOTAL_STEPS_TO_FINISH` are skipped), safe-star capture blocking, teammate capture exclusion, 3-six forfeit, bonus-turn rules, and fair dice via rejection sampling (`getFairDiceRoll`).
14. **Bot personalities** are implemented as weighted heuristics (`botEngine.ts`); the random jitter (`Math.random() * 5`) is fine for tie-breaking.

## 4. Recommended Next Steps (priority order)

1. Fix the stats (#1) and seed data (#3) — these corrupt what users see.
2. Clarify the multiplayer status in the UI and docs (#2).
3. Remove unused dependencies (`@google/genai`, `express`, `dotenv`, `tsx`, `esbuild`, `motion`?) and the `clean` script; pick one lockfile.
4. Add Vitest and write engine tests first: `rollDice` with fixed values, `applyMove` capture/finish/bonus, `getLegalMoves` in team mode. The engine is pure, so this is cheap.
5. Fix the timer cleanup (#4) and rematch timing (#5).
6. Add `.aistudio/` and the unused assets to `.gitignore` / delete them, and initialise git.
