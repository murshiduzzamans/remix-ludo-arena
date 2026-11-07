# Ludo Arena - Game Rules Reference

## Standard Classic Ludo Rules

### 1. GAME SETUP
- 4 players: Red, Green, Yellow, Blue
- 4 tokens per player
- Each player starts with all tokens in their yard (home base)
- Players sit in clockwise order: Red → Green → Yellow → Blue

### 2. STARTING THE GAME
- Roll a 6 to release a token from the yard onto the starting square
- If you roll a 6, you get a bonus turn
- If you cannot move (no tokens out and didn't roll a 6), turn passes

### 3. TOKEN MOVEMENT
- Roll the dice and move any one of your tokens by the number shown
- Tokens move clockwise around the board
- You must use the exact dice value
- You cannot split moves between tokens

### 4. TRACK LAYOUT
- 52 squares in the main track (shared by all players)
- Each player has a unique starting square
- Each player has a home lane (5-6 squares leading to finish)
- Safe squares (star squares) where tokens cannot be captured

### 5. ROLLING A SIX
**§5.1: Six with Legal Move**
- Roll a 6 → Move a token → Get a bonus turn

**§5.2: Six with No Legal Move**
- Roll a 6 but cannot move any token → Still get a bonus turn
- This allows another chance to roll for releasing a token

**§5.3: Three Consecutive Sixes**
- If you roll three 6s in a row: penalty applied
- Common rule: forfeit the turn, no moves made
- Alternative rule: last 6 doesn't count, only first two moves apply
- Counter resets after any non-six roll

### 6. CAPTURING OPPONENTS
- Land exactly on a square occupied by an opponent's token → Capture
- Captured token returns to opponent's yard
- Capturing grants a bonus turn
- Cannot capture on safe squares (star squares)
- In team mode: cannot capture your teammate's tokens

### 7. SAFE SQUARES
- Star-marked squares on the board
- Tokens on safe squares cannot be captured
- Multiple tokens (from any player) can occupy a safe square

### 8. HOME LANE ENTRY
- After completing the full circuit, enter your colored home lane
- Only your tokens can enter your home lane
- Movement in home lane requires exact dice values

### 9. FINISHING
- Reach the center finish square with an EXACT roll
- Example: 2 squares from finish, need to roll exactly 2
- Overshooting is not allowed (turn wasted if you can't use the roll exactly)
- Finished tokens cannot move again

### 10. WINNING

**Classic Mode (Individual)**
- First player to get all 4 tokens to finish wins
- Game continues for 2nd, 3rd, 4th place

**Team Mode (2v2)**
- Team A: Red + Yellow (opposite sides)
- Team B: Green + Blue (opposite sides)
- Team wins when all 8 tokens (both teammates combined) reach finish
- Both teammates get the win
- Game tracks which teammate finished the final token

### 11. TURN ORDER
- Turns pass clockwise: Red → Green → Yellow → Blue → Red...
- Bonus turns go to the same player (don't advance turn order)
- After bonus turn completes, normal turn order resumes

### 12. NO LEGAL MOVES
- If you cannot make any legal move with your dice roll, turn passes
- This happens when:
  - All tokens in yard and didn't roll a 6
  - All legal moves would overshoot finish
  - All tokens already finished

## Regional Variations (Configurable)

### Bonus Turn on Six
- **Standard**: Always get bonus turn after rolling 6
- **Variant**: Only get bonus turn if you actually moved a token

### Three Consecutive Sixes
- **Standard**: Forfeit turn, no moves
- **Variant**: Only first two 6s count
- **Variant**: All three 6s count but no more bonus

### Exact Finishing
- **Standard**: Must roll exact value to finish
- **Variant**: Can overshoot (finish with any value ≥ remaining)

### Stacking
- **Standard**: One token per square (except safe squares)
- **Variant**: Multiple own tokens can stack

## Implementation Notes

All these rules must be enforced in `app/lib/game-engine.ts`:
- `canReleaseToken()` - Check if 6 allows release
- `getLegalMoves()` - Calculate valid moves
- `executeMove()` - Apply move and side effects
- `checkCapture()` - Handle opponent captures
- `checkWinCondition()` - Detect individual/team victory
- `shouldGrantBonusTurn()` - Bonus turn logic
- `handleThreeConsecutiveSixes()` - Penalty logic
