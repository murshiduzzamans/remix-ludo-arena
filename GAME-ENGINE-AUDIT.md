# GAME ENGINE AUDIT - Ludo Arena
**Date:** 2026-11-05  
**Framework:** Remix + Vite + TypeScript + better-sqlite3  
**Game Engine Location:** `app/lib/game-engine.ts`

---

## VERIFIED FILE MAP

| Component | File Path | Status |
|-----------|-----------|--------|
| **Game Engine** | `app/lib/game-engine.ts` | ✅ EXISTS |
| **Game State Types** | `app/types/game.ts` | ✅ EXISTS |
| **Board Component** | `app/components/game/LudoBoard.tsx` | ✅ EXISTS |
| **Pawn Component** | `app/components/game/LudoPawn.tsx` | ✅ EXISTS |
| **Dice Component** | `app/components/game/DiceRoller.tsx` | ✅ EXISTS |
| **Player Pod** | `app/components/game/CornerPlayerPod.tsx` | ✅ EXISTS |
| **Board Screen** | `app/routes/game.board.tsx` | ✅ EXISTS |
| **Game Setup** | `app/routes/game.setup.tsx` | ✅ EXISTS |
| **Solo Mode** | ✅ Implemented in board screen | VERIFIED |
| **Pass-and-Play** | ✅ Implemented in board screen | VERIFIED |
| **Team Mode** | ✅ Implemented in engine | VERIFIED |
| **Bot AI** | ✅ Implemented in engine | VERIFIED |
| **Match Results** | `app/routes/api.match-result.ts` | ✅ EXISTS |

---

## PART 1: CLASSIC FOUR-PLAYER LUDO RULES

### ✅ CORRECTLY IMPLEMENTED

1. **Four Players** - Red, Green, Yellow, Blue ✅
2. **Four Tokens Per Player** ✅
3. **Six to Release Token** - Lines 262-282 ✅
4. **52-Cell Shared Track** - Constants defined ✅
5. **Home Lanes** - 6 squares per player ✅
6. **Safe Squares** - Star squares protect from capture ✅
7. **Opponent Capture** - Lines 367-406 ✅
8. **Return to Yard** - Captured tokens reset to HOME ✅
9. **Exact Roll to Finish** - Lines 339-344 ✅
10. **Turn Order** - Red → Green → Yellow → Blue ✅
11. **Automatic Pass on No Moves** - Lines 475-488 ✅
12. **Victory Detection** - Lines 409-450 ✅

### ⚠️ ISSUES FOUND

#### **CRITICAL BUG #1: Six Does Not Grant Extra Roll When No Legal Move**
- **File:** `app/lib/game-engine.ts:475-488`
- **Current Code:**
```typescript
// If no legal moves available, pass turn
if (legalMoves.length === 0) {
  return {
    ...state,
    currentPlayer: getNextPlayer(state.currentPlayer, state.gameMode),
    diceValue: null,
    selectedToken: null,
    bonusRollPending: false,
    turnLog: [createLogEntry('NO_MOVE', state.currentPlayer), ...state.turnLog],
  };
}
```
- **Problem:** When a player rolls a 6 but has no legal moves, the turn passes instead of granting another roll
- **Expected:** According to game-rules.md §5.1, rolling a 6 should always grant another roll, even when there are no legal moves
- **Impact:** Game rule violation

#### **CRITICAL BUG #2: Three Consecutive Sixes Not Tracked**
- **File:** `app/lib/game-engine.ts`
- **Current Code:** No tracking of consecutive six count
- **Problem:** The engine has `consecutiveSixes` in GameState type but never increments or checks it
- **Expected:** After three consecutive sixes, the turn should pass without any movement
- **Impact:** Missing classic Ludo rule

#### **BUG #3: Dice Value Not Cleared After Bonus Roll**
- **File:** `app/routes/game.board.tsx:145-152`
- **Current Code:**
```typescript
setGameState((prev) => ({
  ...prev,
  bonusRollPending: false,
  diceValue: null, // ✅ This is correct
}));
```
- **Problem:** The dice UI shows the previous roll value when bonusRollPending is true
- **Impact:** Confusing UX - players see "6" from previous roll

#### **BUG #4: Bot Decision Timeout Not Cancellable**
- **File:** `app/routes/game.board.tsx:197-239`
- **Current Code:** `setTimeout` for bot decisions not stored in ref
- **Problem:** If component unmounts or rematch happens, bot timers continue
- **Impact:** Potential memory leak and ghost bot moves after rematch

#### **BUG #5: Empty Dice Shows "6" as Default**
- **File:** `app/components/game/CornerPlayerPod.tsx:147`
- **Current Code:**
```typescript
<DiceRoller value={diceValue ?? 6} rolling={false} onRollComplete={() => {}} />
```
- **Problem:** Fallback value of 6 shows when no roll has happened
- **Expected:** Should show blank or disabled state
- **Impact:** Confusing visual - game appears to start with a 6

---

## PART 2: TEAM MODE (2 VS 2)

### ✅ CORRECTLY IMPLEMENTED

1. **Team Structure** - Red+Yellow vs Green+Blue ✅
2. **Teammate Protection** - Lines 367-379 ✅
3. **Team Victory** - Lines 426-450 ✅
4. **Turn Order Preserved** - Red→Green→Yellow→Blue ✅

### ⚠️ ISSUES FOUND

#### **BUG #6: Team Victory Requires All 8 Tokens, But Logic Is Unclear**
- **File:** `app/lib/game-engine.ts:426-450`
- **Current Code:**
```typescript
if (gameMode === 'TEAM') {
  const redYellowFinished = /* ... */;
  const greenBlueFinished = /* ... */;
  if (redYellowFinished) winnerColor = 'RED';
  if (greenBlueFinished) winnerColor = 'GREEN';
}
```
- **Problem:** The winning color is set to the first player of the team, but the actual human player might be Yellow
- **Impact:** Statistics may attribute victory to the wrong player in team mode
- **Verification Needed:** Check if match results correctly attribute team wins

---

## PART 3: SOLO GAME AND BOT AI

### ✅ CORRECTLY IMPLEMENTED

1. **Bot Difficulties** - Easy, Normal, Hard ✅
2. **Legal Move Selection** - Bots only pick from `getLegalMoves()` ✅
3. **Capture Priority** - Hard bots prefer captures ✅
4. **Finish Priority** - Hard bots prefer finishing tokens ✅
5. **Safe Square Awareness** - Hard bots move to safe squares ✅
6. **Team Awareness** - Bots don't capture teammates ✅

### ⚠️ ISSUES FOUND

#### **BUG #7: Bot Decision Function Can Return Undefined**
- **File:** `app/lib/game-engine.ts:528-633`
- **Current Code:**
```typescript
export function makeBotDecision(
  state: GameState,
  difficulty: BotDifficulty
): number | undefined {
  const legalMoves = getLegalMoves(state);
  if (legalMoves.length === 0) return undefined;
  // ... decision logic
}
```
- **Problem:** Function can return `undefined`, but caller doesn't handle it
- **Impact:** Potential runtime error if bot has no legal moves
- **Fix:** Caller should check for undefined and pass turn

#### **BUG #8: Bot Timeout Is 2000ms**
- **File:** `app/routes/game.board.tsx:211`
- **Current Code:** `setTimeout(executeMove, 2000)`
- **Problem:** 2 seconds per bot turn feels slow
- **Expected:** 800-1000ms for better UX
- **Impact:** Game pacing feels sluggish with 3 bots

---

## PART 4: GAME STATE VALIDATION

### ✅ CORRECTLY IMPLEMENTED

1. **Turn Validation** - Can't move opponent's token ✅
2. **Legal Move Calculation** - Lines 252-406 ✅
3. **Finished Token Protection** - Lines 288-291 ✅
4. **Exact Home Entry** - Lines 339-344 ✅

### ⚠️ ISSUES FOUND

#### **BUG #9: No Dice Value Range Validation**
- **File:** `app/lib/game-engine.ts:136-158`
- **Current Code:**
```typescript
export function rollDice(state: GameState): GameState {
  const diceValue = Math.floor(Math.random() * 6) + 1;
  // ... no validation
}
```
- **Problem:** No check that diceValue is 1-6
- **Impact:** If random() fails or is tampered, invalid dice values could occur
- **Fix:** Add validation: `if (diceValue < 1 || diceValue > 6) throw new Error('Invalid dice')`

#### **BUG #10: Token Movement Doesn't Validate Token ID**
- **File:** `app/lib/game-engine.ts:160-198`
- **Current Code:**
```typescript
export function moveToken(state: GameState, tokenId: number): GameState {
  const token = state.players[state.currentPlayer].tokens[tokenId];
  // ... no check if tokenId is valid
}
```
- **Problem:** No validation that tokenId is 0-3
- **Impact:** Array access could fail with invalid tokenId
- **Fix:** Add validation: `if (tokenId < 0 || tokenId > 3) throw new Error('Invalid token')`

---

## PART 5: USER INTERFACE ISSUES

### ✅ CORRECTLY IMPLEMENTED

1. **Board Rendering** - All 52 squares + home lanes ✅
2. **Token Animation** - Smooth movement with CSS ✅
3. **Legal Move Highlighting** - Glowing tokens ✅
4. **Turn Indicators** - Corner pods show current player ✅
5. **Game Log** - Last 10 actions displayed ✅

### ⚠️ UI BUGS FOUND

#### **UI BUG #1: Dice Shows "6" When Empty**
- **File:** `app/components/game/CornerPlayerPod.tsx:147`
- **Already documented above as BUG #5**

#### **UI BUG #2: Board Rotation in Pass-and-Play**
- **File:** `app/components/game/LudoBoard.tsx:38`
- **Status:** ✅ **ALREADY FIXED** - Board stays at 0° in pass-and-play

#### **UI BUG #3: Token Tap During Animation**
- **File:** `app/components/game/LudoPawn.tsx`
- **Problem:** Tokens are interactive during movement animation
- **Impact:** Players can tap a moving token and trigger another move
- **Fix:** Disable pointer events during animation

---

## PART 6: STATISTICS AND MATCH RESULTS

### ✅ CORRECTLY IMPLEMENTED

1. **Win Recording** - Match results record winner ✅
2. **Placement Recording** - 1st, 2nd, 3rd, 4th ✅
3. **Token Captures** - Counted during game ✅

### ⚠️ ISSUES FOUND

#### **BUG #11: Team Mode Victory Attribute Wrong Player**
- **File:** `app/routes/game.board.tsx:287-324`
- **Current Code:**
```typescript
if (result.winner) {
  // Award coins only to human if they won
  if (result.winner === humanColor) {
    coinReward = 100;
  }
}
```
- **Problem:** In team mode, `result.winner` is set to first teammate color (RED or GREEN), not the actual human's color
- **Impact:** If human plays as YELLOW on winning team, they don't get coins
- **Fix:** Check if human is on winning team, not just if winner === humanColor

#### **BUG #12: Pass-and-Play Records Fake Result**
- **File:** `app/routes/game.board.tsx:295-301`
- **Current Code:**
```typescript
if (gameMode === 'LOCAL') {
  // Don't submit result for local multiplayer
  await fetch('/api/match-result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchData: { color: 'RED', result: 'loss' } }),
  });
}
```
- **Problem:** Submits a fake RED loss for every pass-and-play match
- **Impact:** Corrupts player statistics
- **Fix:** Don't submit any result for LOCAL mode

---

## PART 7: AUTOMATED TESTS

### Current Test Status

**File:** `app/lib/__tests__/game-engine.test.ts`

❌ **FILE NOT FOUND**

No tests currently exist for the game engine.

### Required Test Coverage

1. **Token Release Tests**
   - Six releases token from yard
   - Non-six doesn't release
   - All tokens in yard require six
   
2. **Movement Tests**
   - Basic movement
   - Track wraparound
   - Home lane entry
   - Exact finish
   - Overshoot blocks finish

3. **Capture Tests**
   - Opponent capture
   - Return to yard
   - Safe square protection
   - Teammate protection in team mode

4. **Turn Logic Tests**
   - Six grants bonus roll
   - Six with no moves grants bonus roll ⚠️ CURRENTLY FAILS
   - Three consecutive sixes pass turn ⚠️ NOT IMPLEMENTED
   - No legal moves passes turn

5. **Victory Tests**
   - Classic 4-player victory
   - Team victory
   - Correct placement order

6. **Bot Tests**
   - Bot returns legal move
   - Hard bot prefers capture
   - Hard bot prefers finish
   - Bot doesn't capture teammate

---

## SUMMARY: BUGS TO FIX IN PRIORITY ORDER

### 🔴 CRITICAL (Game Rule Violations)

1. **Six without legal move must grant bonus roll** - `game-engine.ts:475-488`
2. **Three consecutive sixes not implemented** - Missing entirely
3. **Team victory attributes wrong player** - `game.board.tsx:287-324`
4. **Pass-and-play records fake result** - `game.board.tsx:295-301`

### 🟡 HIGH (UX and State Management)

5. **Bot timers not cancelled on unmount** - `game.board.tsx:197-239`
6. **Dice shows "6" when empty** - `CornerPlayerPod.tsx:147`
7. **Bot decision timeout too long (2000ms)** - `game.board.tsx:211`
8. **Token interactive during animation** - `LudoPawn.tsx`

### 🟢 MEDIUM (Validation and Safety)

9. **No dice value validation** - `game-engine.ts:136-158`
10. **No token ID validation** - `game-engine.ts:160-198`
11. **Bot decision can return undefined** - `game-engine.ts:528-633`

### ⚪ LOW (Testing Infrastructure)

12. **No automated tests** - Create `game-engine.test.ts`

---

## RECOMMENDATIONS FOR PHASE 2 IMPLEMENTATION

### Stage 1: Fix Critical Game Rule Bugs
1. Implement three consecutive sixes tracking and enforcement
2. Fix six with no legal moves to grant bonus roll
3. Fix team victory player attribution
4. Remove fake pass-and-play result submission

### Stage 2: Fix State Management
5. Make bot timers cancellable with refs
6. Fix dice empty state display
7. Reduce bot timeout to 1000ms
8. Disable token interaction during animation

### Stage 3: Add Validation
9. Validate dice values
10. Validate token IDs
11. Handle undefined bot decisions

### Stage 4: Automated Testing
12. Install Vitest
13. Write comprehensive test suite
14. Verify all game rules

### Stage 5: Verification
- Run TypeScript checks
- Run all tests
- Manual gameplay testing (solo, pass-and-play, team mode)
- Test all bot difficulties
- Test all edge cases

---

## EXISTING FEATURES THAT WORK CORRECTLY

✅ Four players with four tokens each  
✅ 52-cell shared track with correct routes  
✅ Home lanes (6 squares)  
✅ Safe squares (star squares)  
✅ Opponent capture and return to yard  
✅ Teammate protection in team mode  
✅ Exact roll to finish  
✅ Bot AI with three difficulty levels  
✅ Bot capture, safe square, and finish priorities  
✅ Legal move calculation  
✅ Turn order enforcement  
✅ Victory detection  
✅ Match result recording  
✅ Board animations and visual design  

---

**End of Audit**
