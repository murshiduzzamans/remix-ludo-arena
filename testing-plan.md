# Comprehensive Testing Plan — Ludo Arena

## 1. Testing Strategy & Pyramid

Ludo Arena's decoupled pure TypeScript architecture enables high test coverage with fast, deterministic unit test execution.

```
       / \
      /   \      E2E Browser Tests (Playwright) — PWA install, full match flow
     /     \
    /───────\    Component & Integration Tests — Board clicks, SVG coordinates, dice HUD
   /         \
  /───────────\  Unit Tests (Vitest) — Pure Engine, Move Validator, Bot AI Heuristics
```

---

## 2. Unit Testing Strategy (Vitest)

Because `/src/engine` has zero dependencies on React or DOM APIs, Vitest executes engine tests headlessly in milliseconds.

### Core Test Suites:

#### Suite 1: Rule Validation (`src/engine/__tests__/rules.test.ts`)
- **Yard Exit Logic**:
  - `canExitYard(6, { sixToExit: true })` ➔ `true`.
  - `canExitYard(5, { sixToExit: true })` ➔ `false`.
  - `canExitYard(1, { sixToExit: false })` ➔ `true`.
- **Exact Roll Home Finish**:
  - Token at Step 53 with roll 3 ➔ `toStep: 56`, `isFinish: true`.
  - Token at Step 54 with roll 3 ➔ Illegal move (overshoot).
- **Safe Star Immunity**:
  - Opponent on Cell 9 (Star) cannot be captured when landed upon.
  - Opponent on Cell 10 (Normal) is captured and returned to yard (`stepCount: -1`).
- **Team Immunity**:
  - In `team_2v2`, Red token landing on Yellow token does not trigger capture.

#### Suite 2: State Machine Reducer (`src/engine/__tests__/gameEngine.test.ts`)
- **Deterministic Dice Roll**:
  - Passing fixed dice value to `rollDice(state, 6)` advances `consecutiveSixes` to 1.
  - 3rd consecutive 6 with `consecutiveSixForfeit: true` forfeits turn and passes to next player.
- **Bonus Turns**:
  - Rolling 6 awards bonus turn.
  - Capturing opponent awards bonus turn.
  - Bringing pawn home awards bonus turn.
- **Victory Condition**:
  - Bringing 4th pawn home transitions phase to `game_over` with correct `winnerColor`.
  - In `team_2v2`, team wins when all 8 pawns of partner pair reach home.

#### Suite 3: Bot AI Decision Making (`src/engine/__tests__/botEngine.test.ts`)
- **Aggressive Bot**:
  - When given a choice between capturing an opponent vs advancing a safe pawn, aggressive bot consistently picks the capture strike.
- **Defensive Bot**:
  - When given a choice between landing on a safe star vs an un-safe square, defensive bot chooses the safe star.

---

## 3. End-to-End Browser Testing Plan (Playwright)

### Playwright Test Scenarios:

#### E2E Scenario 1: PWA Installation & Offline Standalone
```typescript
test('PWA manifest is valid and in-app install button is visible', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('button:has-text("Install App")')).toBeVisible();
  const manifest = await page.evaluate(async () => {
    const res = await fetch('/manifest.json');
    return res.json();
  });
  expect(manifest.display).toBe('standalone');
});
```

#### E2E Scenario 2: Solo Match Full Loop
1. Navigate to `/`.
2. Click `"Quick Play vs Bots"`.
3. Verify board mounts with 4 player pods and 16 pawns in yards.
4. Click `"Roll Dice"`.
5. If roll is 6, click playable pawn. Verify pawn exits yard to start cell (Step 0).
6. Verify turn passes to bot, and bot takes turn automatically with realistic delay.

#### E2E Scenario 3: Private Room Creation
1. Click `"Custom Rooms"` in top navigation.
2. Verify 6-character room code format (`LUDO-[A-Z0-9]{4}`).
3. Click `"Copy Invite Code"` and verify clipboard confirmation.
4. Verify authoritative protocol note is visible.

---

## 4. Execution Commands

```bash
# Run Vitest unit test suite
npm run test

# Run Vitest with coverage report
npx vitest run --coverage

# Run Playwright end-to-end tests
npx playwright test
```
