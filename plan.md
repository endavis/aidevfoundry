# PuzldAI - Game System Implementation Plan

**Last Updated:** 2025-12-23
**Status:** In Progress
**Completion:** 3/13 tasks (Phase 1 complete, Phase 2A complete, Phase 2B complete)

---

## 📋 Task Overview

This document tracks the implementation of game mechanics, CLI improvements, and testing for the PuzldAI game system. All changes should be documented here as they are completed.

### Outstanding Tasks

- [x] Fix SQLite schema - remove UNIQUE constraint on (game_name, is_active)
- [x] Implement Factory AI Droid game mechanics (build droid, produce, win/lose logic)
- [x] Implement Charm Crush game mechanics (swap, match detection, scoring, cascade)
- [ ] Fix CLI behavior - show current state instead of creating new game when no prompt
- [ ] Implement state parsing - extract game state from adapter responses
- [ ] Add session.updateSession() calls in CLI after game commands
- [ ] Improve test-game-integration.js to use actual adapters/CLI
- [ ] Add input validation for CLI options (--cleanup, --session, etc.)
- [ ] Add command validation using adapter.validateCommand()
- [ ] Add win/lose condition detection to both games
- [ ] Test complete game lifecycle (start → play → win/lose → end)
- [ ] Update agents.md with game system documentation

---

## 🏗️ Implementation Strategy

### Parallel Execution Plan

Tasks are grouped into phases that can be executed in parallel to optimize development time:

```
Phase 1 (Sequential)  →  Phase 2 (Parallel)  →  Phase 3 (Parallel)  →  Phase 4 (Parallel)
      ↓                      ↓         ↓              ↓         ↓              ↓         ↓
  Schema Fix           Factory AI   Charm       CLI State   Input       State    Command
                        Mechanics   Crush        & Session  Valid.      Parse    Valid.
                                   Mechanics

  →  Phase 5 (Parallel)  →  Phase 6 (Sequential)  →  Phase 7 (Anytime)
         ↓         ↓              ↓         ↓              ↓
    Factory     Charm         Test      Test           Update
    Win/Lose   Win/Lose    Integration Lifecycle      Docs
```

**Estimated Time Savings:** ~45% reduction vs. sequential execution

---

## Phase 1: Foundation (Sequential)

**Status:** ✅ Completed
**Must Complete Before:** All other phases

### Task 1.1: Fix SQLite Schema Constraint ✅

**Files:**
- `src/memory/game-sessions.ts:38-113`

**Current Issue:**
```sql
UNIQUE(game_name, is_active)
```
This prevents having multiple inactive sessions for the same game.

**Solution Options:**

**Option A: Partial Unique Index** (Recommended)
```sql
DROP INDEX IF EXISTS idx_game_sessions_unique;
CREATE UNIQUE INDEX idx_game_sessions_unique_active
ON game_sessions(game_name) WHERE is_active = 1;
```

**Option B: Remove Constraint**
```sql
-- Remove UNIQUE constraint entirely
-- Let application logic enforce single active session
```

**Implementation Steps:**
1. Update `game-sessions.ts` schema initialization
2. Add migration logic for existing databases
3. Test constraint works: only one active session per game allowed
4. Test multiple inactive sessions can exist

**Verification:**
```bash
# Should succeed
puzldai game factory-ai-droid --new
puzldai game factory-ai-droid --end
puzldai game factory-ai-droid --new
puzldai game factory-ai-droid --end

# Should have 2+ inactive sessions
puzldai game factory-ai-droid --list
```

---

## Phase 2: Core Game Mechanics (Parallel - 2 Agents)

**Status:** Not Started
**Dependencies:** Phase 1 complete
**Agents:** Run simultaneously

### 🎮 Agent A: Factory AI Droid Mechanics

**File:** `src/adapters/factory-ai-droid.ts`
**Current State:** 127 lines, placeholder demo mechanics

#### Tasks

1. **Implement Droid Building System**
   - Droid types: `miner`, `refinery`, `battery`, `solar`
   - Resource costs per type
   - Production rates per type
   - Add droids to state

2. **Implement Production Mechanics**
   - Ore mining (miner droids)
   - Energy generation (solar droids)
   - Ore → Energy conversion (battery droids)
   - Ore → Credits conversion (refinery droids)

3. **Update run() Method**
   - Parse commands:
     - `"build droid miner"` → Add miner droid
     - `"build droid refinery"` → Add refinery droid
     - `"produce"` → Execute production cycle
     - `"status"` → Show current state
   - Deduct resources for builds
   - Increment turn counter
   - Validate commands

4. **Track Game State**
   ```typescript
   interface FactoryState extends GameState {
     status: 'playing' | 'won' | 'lost' | 'invalid';
     moves?: string[];
     score?: number;
     message?: string;
     data: {
       ore: number;
       energy: number;
       credits: number;
       droids: Array<{ type: string; count: number }>;
       turn: number;
       maxTurns: number;
       targetCredits: number;
     };
   }
   ```

#### Game Rules

**Droid Types:**
| Type | Cost (Credits) | Production |
|------|----------------|------------|
| Miner | 10 | +5 ore/turn |
| Solar | 15 | +3 energy/turn |
| Battery | 20 | Convert 2 ore → 1 energy |
| Refinery | 25 | Convert 3 ore → 5 credits |

**Difficulty Levels:**
- Easy: 20 turns, 100 target credits
- Medium: 15 turns, 150 target credits
- Hard: 10 turns, 200 target credits

**Starting Resources:**
- 50 credits
- 10 ore
- 5 energy

#### Implementation Example

```typescript
async run(prompt: string, options?: RunOptions): Promise<ModelResponse> {
  const state = this.parseCommand(prompt, this.currentState);

  if (prompt.startsWith('build droid')) {
    const droidType = prompt.split(' ')[2];
    const cost = this.getDroidCost(droidType);

    if (state.data.credits < cost) {
      state.message = `Insufficient credits. Need ${cost}, have ${state.data.credits}`;
      state.status = 'invalid';
    } else {
      state.data.credits -= cost;
      const droid = state.data.droids.find(d => d.type === droidType);
      if (droid) {
        droid.count++;
      } else {
        state.data.droids.push({ type: droidType, count: 1 });
      }
      state.message = `Built ${droidType} droid. Remaining credits: ${state.data.credits}`;
    }
  } else if (prompt === 'produce') {
    this.executeProduction(state);
    state.data.turn++;
    state.message = `Production complete. Turn ${state.data.turn}/${state.data.maxTurns}`;
  }

  return {
    content: this.renderState(state),
    model: 'factory-ai-droid',
    duration: Date.now() - startTime
  };
}

private executeProduction(state: FactoryState): void {
  state.data.droids.forEach(droid => {
    switch (droid.type) {
      case 'miner':
        state.data.ore += 5 * droid.count;
        break;
      case 'solar':
        state.data.energy += 3 * droid.count;
        break;
      case 'battery':
        const oreToConvert = Math.min(state.data.ore, 2 * droid.count);
        state.data.ore -= oreToConvert;
        state.data.energy += Math.floor(oreToConvert / 2);
        break;
      case 'refinery':
        const oreForCredits = Math.min(state.data.ore, 3 * droid.count);
        state.data.ore -= oreForCredits;
        state.data.credits += Math.floor(oreForCredits / 3) * 5;
        break;
    }
  });
}
```

#### Verification

```bash
puzldai game factory-ai-droid --new --difficulty easy
puzldai game factory-ai-droid "build droid miner"
puzldai game factory-ai-droid "produce"
puzldai game factory-ai-droid "status"
```

Expected output should show:
- Resources updated correctly
- Turn counter incremented
- Droids in state

---

### 🧩 Agent B: Charm Crush Mechanics

**File:** `src/adapters/charm-crush.ts`
**Current State:** 124 lines, placeholder demo mechanics

#### Tasks

1. **Implement Swap Mechanics**
   - Validate cells are adjacent (not diagonal)
   - Swap two charms
   - Check if swap creates a match
   - Undo swap if no match created

2. **Implement Match Detection**
   - Find horizontal runs of 3+ identical charms
   - Find vertical runs of 3+ identical charms
   - Return coordinates of matched charms

3. **Implement Match Clearing**
   - Remove matched charms from board
   - Add score based on match size
   - Track combo multipliers

4. **Implement Gravity & Refill**
   - Drop charms to fill empty spaces
   - Generate new random charms at top
   - Maintain 8x8 board size

5. **Implement Cascade System**
   - After gravity, check for new matches
   - Repeat until no more matches
   - Apply combo multipliers

6. **Update run() Method**
   - Parse commands:
     - `"swap 2 3 2 4"` → Swap cells at (2,3) and (2,4)
     - `"hint"` → Suggest valid move
     - `"status"` → Show board state
   - Decrement moves counter
   - Validate moves

7. **Track Game State**
   ```typescript
   interface CharmCrushState extends GameState {
     status: 'playing' | 'won' | 'lost' | 'invalid';
     moves?: string[];
     score?: number;
     message?: string;
     data: {
       board: string[][]; // 8x8 grid
       score: number;
       movesLeft: number;
       targetScore: number;
       combo: number;
     };
   }
   ```

#### Game Rules

**Charm Types:** 🔴 🔵 🟢 🟡 🟣 🟠 (6 types)

**Scoring:**
- 3 match: 10 points × combo
- 4 match: 20 points × combo
- 5 match: 30 points × combo
- 6+ match: 50 points × combo
- Combo multiplier: +1 per cascade

**Difficulty Levels:**
- Easy: 30 moves, 1000 target score
- Medium: 20 moves, 1500 target score
- Hard: 15 moves, 2000 target score

#### Implementation Example

```typescript
async run(prompt: string, options?: RunOptions): Promise<ModelResponse> {
  const state = { ...this.currentState };

  if (prompt.startsWith('swap')) {
    const [_, r1, c1, r2, c2] = prompt.split(' ').map(Number);

    // Validate adjacency
    const isAdjacent =
      (Math.abs(r1 - r2) === 1 && c1 === c2) ||
      (Math.abs(c1 - c2) === 1 && r1 === r2);

    if (!isAdjacent) {
      state.message = 'Cells must be adjacent';
      state.status = 'invalid';
    } else {
      // Swap
      [state.data.board[r1][c1], state.data.board[r2][c2]] =
      [state.data.board[r2][c2], state.data.board[r1][c1]];

      // Check for matches
      const matches = this.detectMatches(state.data.board);

      if (matches.length === 0) {
        // Undo swap
        [state.data.board[r1][c1], state.data.board[r2][c2]] =
        [state.data.board[r2][c2], state.data.board[r1][c1]];
        state.message = 'No match created';
        state.status = 'invalid';
      } else {
        // Process cascade
        this.processCascade(state);
        state.data.movesLeft--;
        state.message = `Score: ${state.data.score}. Moves left: ${state.data.movesLeft}`;
      }
    }
  }

  return {
    content: this.renderState(state),
    model: 'charm-crush',
    duration: Date.now() - startTime
  };
}

private detectMatches(board: string[][]): Array<{row: number, col: number}> {
  const matches: Array<{row: number, col: number}> = [];

  // Horizontal matches
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 6; c++) {
      const charm = board[r][c];
      if (board[r][c+1] === charm && board[r][c+2] === charm) {
        matches.push({row: r, col: c}, {row: r, col: c+1}, {row: r, col: c+2});
      }
    }
  }

  // Vertical matches
  for (let c = 0; c < 8; c++) {
    for (let r = 0; r < 6; r++) {
      const charm = board[r][c];
      if (board[r+1][c] === charm && board[r+2][c] === charm) {
        matches.push({row: r, col: c}, {row: r+1, col: c}, {row: r+2, col: c});
      }
    }
  }

  return matches;
}

private processCascade(state: CharmCrushState): void {
  let combo = 1;

  while (true) {
    const matches = this.detectMatches(state.data.board);
    if (matches.length === 0) break;

    // Clear matches
    const uniqueMatches = this.deduplicateMatches(matches);
    state.data.score += uniqueMatches.length * 10 * combo;

    uniqueMatches.forEach(({row, col}) => {
      state.data.board[row][col] = '';
    });

    // Apply gravity
    this.applyGravity(state.data.board);

    // Refill
    this.refillBoard(state.data.board);

    combo++;
  }

  state.data.combo = combo - 1;
}
```

#### Verification

```bash
puzldai game charm-crush --new --difficulty easy
puzldai game charm-crush "swap 0 0 0 1"
puzldai game charm-crush "status"
```

Expected output should show:
- Board updated with swap
- Matches detected and cleared
- Score updated
- Moves decremented

---

## Phase 3: CLI & Session Integration (Parallel - 2 Agents)

**Status:** Not Started
**Dependencies:** Phase 1 complete
**Agents:** Work on different sections of same file

### 🖥️ Agent C: CLI State Display & Session Updates

**File:** `src/cli/commands/game.ts` (6.1 KB)

#### Task 3.1: Fix CLI Behavior for Empty Prompt

**Current Bug:**
```typescript
if (!prompt) {
  // Creates new game - WRONG!
}
```

**Fixed Logic:**
```typescript
if (!prompt) {
  const activeSession = gameSessionManager.getActiveSession(gameName);

  if (!activeSession) {
    console.log(`No active session for ${gameName}.`);
    console.log(`Use --new to start a new game.`);
    return;
  }

  // Show current state
  const adapter = adapters[gameName] as GameAdapter;
  console.log(adapter.renderState(activeSession.state));
  return;
}
```

**Code Location:** `game.ts:50-120` (main game command logic)

#### Task 3.2: Add session.updateSession() Calls

**Locations to Update:**
1. After every game command execution
2. After state changes
3. Before rendering output

**Pattern:**
```typescript
// Execute game command
const response = await adapter.run(prompt, options);

// Update session in database
gameSessionManager.updateSession(activeSession.id, response.state);

// Display result
console.log(response.content);
```

**Files to Update:**
- After `adapter.run()` calls
- After state mutations
- In game command handler

#### Verification

```bash
# Should show state, not create new game
puzldai game factory-ai-droid --new
puzldai game factory-ai-droid

# Should show "No active session"
puzldai game charm-crush

# Session should update in database
puzldai game factory-ai-droid "build droid miner"
# Check database: updated_at should be recent
```

---

### 🛡️ Agent D: CLI Input Validation

**File:** `src/cli/commands/game.ts`

#### Tasks

1. **Validate --cleanup Option**
   ```typescript
   if (options.cleanup !== undefined) {
     const days = Number(options.cleanup);
     if (isNaN(days) || days <= 0) {
       console.error('Error: --cleanup requires a positive number of days');
       process.exit(1);
     }
   }
   ```

2. **Validate --session Option**
   ```typescript
   if (options.session) {
     const session = gameSessionManager.getSession(options.session);
     if (!session) {
       console.error(`Error: Session ID not found: ${options.session}`);
       process.exit(1);
     }
     if (session.game_name !== gameName) {
       console.error(`Error: Session ${options.session} is for ${session.game_name}, not ${gameName}`);
       process.exit(1);
     }
   }
   ```

3. **Validate --difficulty Option**
   ```typescript
   if (options.difficulty) {
     const validDifficulties = ['easy', 'medium', 'hard'];
     if (!validDifficulties.includes(options.difficulty.toLowerCase())) {
       console.error('Error: Invalid difficulty. Use: easy, medium, hard');
       process.exit(1);
     }
   }
   ```

4. **Validate Game Name**
   ```typescript
   if (!adapters[gameName]) {
     console.error(`Error: Unknown game: ${gameName}`);
     console.error('Available games:', Object.keys(adapters).filter(name =>
       name === 'factory-ai-droid' || name === 'charm-crush'
     ).join(', '));
     process.exit(1);
   }
   ```

**Code Location:** `game.ts:15-45` (option parsing)

#### Error Messages Format

```
Error: Invalid difficulty. Use: easy, medium, hard
Error: Session ID not found: abc123
Error: --cleanup requires a positive number of days
Error: Unknown game: invalid-game
```

#### Verification

```bash
# Should show error
puzldai game factory-ai-droid --cleanup -5
puzldai game factory-ai-droid --cleanup abc
puzldai game factory-ai-droid --difficulty impossible
puzldai game factory-ai-droid --session nonexistent
puzldai game invalid-game --new

# Should succeed
puzldai game factory-ai-droid --cleanup 30
puzldai game factory-ai-droid --difficulty hard
```

---

## Phase 4: Validation & State Parsing (Parallel - 2 Agents)

**Status:** Not Started
**Dependencies:** Phase 2 complete
**Agents:** Different concerns, minimal overlap

### 🔍 Agent E: State Parsing Implementation

**Files:**
- `src/adapters/base-game-adapter.ts` (add utility)
- `src/adapters/factory-ai-droid.ts` (use utility)
- `src/adapters/charm-crush.ts` (use utility)

#### Task 4.1: Create State Parser Utility

**Add to `base-game-adapter.ts`:**

```typescript
export class GameStateParser {
  /**
   * Extract GameState from LLM text responses
   * Handles JSON blocks, inline JSON, and malformed responses
   */
  static extractState(response: string): Partial<GameState> | null {
    // Try JSON code block
    const jsonBlockMatch = response.match(/```json\n(.*?)\n```/s);
    if (jsonBlockMatch) {
      try {
        return JSON.parse(jsonBlockMatch[1]);
      } catch {
        // Continue to next attempt
      }
    }

    // Try inline JSON
    const inlineMatch = response.match(/\{[^{}]*"status"[^{}]*\}/s);
    if (inlineMatch) {
      try {
        return JSON.parse(inlineMatch[0]);
      } catch {
        // Continue to next attempt
      }
    }

    // Try multiline JSON object
    const multilineMatch = response.match(/\{[\s\S]*?"status"[\s\S]*?\}/);
    if (multilineMatch) {
      try {
        return JSON.parse(multilineMatch[0]);
      } catch {
        // Failed to parse
      }
    }

    return null;
  }

  /**
   * Merge partial state with current state
   */
  static mergeState(current: GameState, partial: Partial<GameState>): GameState {
    return {
      ...current,
      ...partial,
      data: {
        ...current.data,
        ...partial.data
      }
    };
  }
}
```

#### Task 4.2: Update Game Adapters to Use Parser

**In `factory-ai-droid.ts` and `charm-crush.ts`:**

```typescript
import { GameStateParser } from './base-game-adapter';

async run(prompt: string, options?: RunOptions): Promise<ModelResponse> {
  // ... existing logic ...

  // If using LLM to process commands (future enhancement)
  if (options?.useLLM) {
    const llmResponse = await this.callLLM(prompt);
    const parsedState = GameStateParser.extractState(llmResponse);

    if (parsedState) {
      const newState = GameStateParser.mergeState(this.currentState, parsedState);
      this.currentState = newState;
    }
  }

  // ... rest of logic ...
}
```

#### Verification

**Test with various response formats:**
```typescript
// Test JSON block
const state1 = GameStateParser.extractState(`
Here's the result:
\`\`\`json
{"status": "playing", "score": 100}
\`\`\`
`);

// Test inline JSON
const state2 = GameStateParser.extractState(
  'The state is {"status": "won", "score": 500}'
);

// Test malformed
const state3 = GameStateParser.extractState('No JSON here');
// Should return null
```

---

### ✅ Agent F: Command Validation

**Files:**
- `src/adapters/factory-ai-droid.ts`
- `src/adapters/charm-crush.ts`

#### Task 4.3: Implement validateCommand() for Factory AI Droid

```typescript
validateCommand(command: string, state: GameState): { valid: boolean; error?: string } {
  const factoryState = state as FactoryState;

  // Build droid command
  if (command.startsWith('build droid')) {
    const parts = command.split(' ');
    if (parts.length !== 3) {
      return { valid: false, error: 'Usage: build droid <type>' };
    }

    const droidType = parts[2];
    const validTypes = ['miner', 'refinery', 'battery', 'solar'];

    if (!validTypes.includes(droidType)) {
      return {
        valid: false,
        error: `Invalid droid type. Available: ${validTypes.join(', ')}`
      };
    }

    const cost = this.getDroidCost(droidType);
    if (factoryState.data.credits < cost) {
      return {
        valid: false,
        error: `Insufficient credits. Need ${cost}, have ${factoryState.data.credits}`
      };
    }
  }

  // Produce command
  else if (command === 'produce') {
    if (factoryState.data.droids.length === 0) {
      return {
        valid: false,
        error: 'No droids to produce. Build droids first.'
      };
    }
  }

  // Status command
  else if (command === 'status') {
    // Always valid
  }

  // Unknown command
  else {
    return {
      valid: false,
      error: 'Unknown command. Use: build droid <type>, produce, or status'
    };
  }

  return { valid: true };
}
```

#### Task 4.4: Implement validateCommand() for Charm Crush

```typescript
validateCommand(command: string, state: GameState): { valid: boolean; error?: string } {
  const crushState = state as CharmCrushState;

  // Swap command
  if (command.startsWith('swap')) {
    const parts = command.split(' ');
    if (parts.length !== 5) {
      return { valid: false, error: 'Usage: swap <row1> <col1> <row2> <col2>' };
    }

    const [_, r1, c1, r2, c2] = parts.map(Number);

    // Check all are numbers
    if (isNaN(r1) || isNaN(c1) || isNaN(r2) || isNaN(c2)) {
      return { valid: false, error: 'Coordinates must be numbers' };
    }

    // Check bounds
    if (r1 < 0 || r1 > 7 || c1 < 0 || c1 > 7) {
      return { valid: false, error: `Cell (${r1}, ${c1}) out of bounds (0-7)` };
    }
    if (r2 < 0 || r2 > 7 || c2 < 0 || c2 > 7) {
      return { valid: false, error: `Cell (${r2}, ${c2}) out of bounds (0-7)` };
    }

    // Check adjacency (not diagonal)
    const isAdjacent =
      (Math.abs(r1 - r2) === 1 && c1 === c2) ||
      (Math.abs(c1 - c2) === 1 && r1 === r2);

    if (!isAdjacent) {
      return { valid: false, error: 'Cells must be adjacent (not diagonal)' };
    }

    // Check moves left
    if (crushState.data.movesLeft <= 0) {
      return { valid: false, error: 'No moves left' };
    }
  }

  // Hint command
  else if (command === 'hint') {
    // Always valid
  }

  // Status command
  else if (command === 'status') {
    // Always valid
  }

  // Unknown command
  else {
    return {
      valid: false,
      error: 'Unknown command. Use: swap <r1> <c1> <r2> <c2>, hint, or status'
    };
  }

  return { valid: true };
}
```

#### Task 4.5: Integrate Validation into CLI

**Update `game.ts` to call validation:**

```typescript
// Before executing command
const validation = adapter.validateCommand?.(prompt, activeSession.state);

if (validation && !validation.valid) {
  console.error(`Invalid command: ${validation.error}`);
  return;
}

// Continue with command execution
const response = await adapter.run(prompt, options);
```

#### Verification

```bash
# Should show validation errors
puzldai game factory-ai-droid "build droid invalid"
puzldai game factory-ai-droid "build droid miner" # when credits < 10
puzldai game charm-crush "swap 0 0 5 5" # non-adjacent
puzldai game charm-crush "swap 10 10 10 11" # out of bounds
puzldai game charm-crush "swap a b c d" # not numbers

# Should succeed
puzldai game factory-ai-droid "build droid miner" # when credits >= 10
puzldai game charm-crush "swap 0 0 0 1" # valid adjacent swap
```

---

## Phase 5: Win/Lose Detection (Parallel - 2 Agents)

**Status:** Not Started
**Dependencies:** Phase 2 complete
**Agents:** Same implementation pattern, different games

### 🏆 Agent G: Factory AI Droid Win/Lose Logic

**File:** `src/adapters/factory-ai-droid.ts`

#### Task 5.1: Add Condition Checking

```typescript
private checkWinLose(state: FactoryState): void {
  // Win condition: reached target credits
  if (state.data.credits >= state.data.targetCredits) {
    state.status = 'won';
    state.message = `🎉 Victory! Reached ${state.data.targetCredits} credits in ${state.data.turn} turns!`;
    return;
  }

  // Lose condition: out of turns
  if (state.data.turn >= state.data.maxTurns) {
    state.status = 'lost';
    state.message = `💀 Game Over! Only ${state.data.credits}/${state.data.targetCredits} credits after ${state.data.maxTurns} turns.`;
    return;
  }

  // Still playing
  state.status = 'playing';
}
```

#### Task 5.2: Call After Each Turn

```typescript
async run(prompt: string, options?: RunOptions): Promise<ModelResponse> {
  // ... execute command logic ...

  if (prompt === 'produce') {
    this.executeProduction(state);
    state.data.turn++;
  }

  // Check win/lose after every command
  this.checkWinLose(state);

  // If game ended, auto-end session
  if (state.status === 'won' || state.status === 'lost') {
    // Mark session as inactive
    if (options?.sessionId) {
      gameSessionManager.endSession(options.sessionId);
    }
  }

  return {
    content: this.renderState(state),
    model: 'factory-ai-droid',
    duration: Date.now() - startTime
  };
}
```

#### Task 5.3: Update renderState to Show Win/Lose

```typescript
renderState(state: GameState): string {
  const factoryState = state as FactoryState;

  let output = `=== Factory AI Droid ===\n\n`;

  if (state.status === 'won') {
    output += `🎉 ${state.message}\n\n`;
  } else if (state.status === 'lost') {
    output += `💀 ${state.message}\n\n`;
  }

  output += `Resources:\n`;
  output += `  Ore: ${factoryState.data.ore}\n`;
  output += `  Energy: ${factoryState.data.energy}\n`;
  output += `  Credits: ${factoryState.data.credits}/${factoryState.data.targetCredits}\n\n`;

  output += `Droids:\n`;
  factoryState.data.droids.forEach(droid => {
    output += `  ${droid.type}: ${droid.count}\n`;
  });

  output += `\nTurn: ${factoryState.data.turn}/${factoryState.data.maxTurns}\n`;

  if (state.status === 'playing') {
    const remaining = factoryState.data.targetCredits - factoryState.data.credits;
    const turnsLeft = factoryState.data.maxTurns - factoryState.data.turn;
    output += `\nNeed ${remaining} more credits in ${turnsLeft} turns.\n`;
  }

  return output;
}
```

#### Verification

```bash
# Test win condition
puzldai game factory-ai-droid --new --difficulty easy
# ... play until credits >= 100
# Should see: "🎉 Victory! Reached 100 credits in X turns!"

# Test lose condition
puzldai game factory-ai-droid --new --difficulty hard
# ... play for 10 turns without reaching 200 credits
# Should see: "💀 Game Over! Only X/200 credits after 10 turns."
```

---

### 🏆 Agent H: Charm Crush Win/Lose Logic

**File:** `src/adapters/charm-crush.ts`

#### Task 5.4: Add Condition Checking

```typescript
private checkWinLose(state: CharmCrushState): void {
  // Win condition: reached target score
  if (state.data.score >= state.data.targetScore) {
    state.status = 'won';
    state.message = `🎉 You crushed it! Score: ${state.data.score}/${state.data.targetScore}!`;
    return;
  }

  // Lose condition: out of moves
  if (state.data.movesLeft <= 0) {
    state.status = 'lost';
    state.message = `💀 No more moves! Final score: ${state.data.score}/${state.data.targetScore}`;
    return;
  }

  // Still playing
  state.status = 'playing';
}
```

#### Task 5.5: Call After Each Move

```typescript
async run(prompt: string, options?: RunOptions): Promise<ModelResponse> {
  // ... execute swap logic ...

  if (prompt.startsWith('swap')) {
    // ... swap and cascade logic ...
    state.data.movesLeft--;
  }

  // Check win/lose after every move
  this.checkWinLose(state);

  // If game ended, auto-end session
  if (state.status === 'won' || state.status === 'lost') {
    if (options?.sessionId) {
      gameSessionManager.endSession(options.sessionId);
    }
  }

  return {
    content: this.renderState(state),
    model: 'charm-crush',
    duration: Date.now() - startTime
  };
}
```

#### Task 5.6: Update renderState to Show Win/Lose

```typescript
renderState(state: GameState): string {
  const crushState = state as CharmCrushState;

  let output = `=== Charm Crush ===\n\n`;

  if (state.status === 'won') {
    output += `🎉 ${state.message}\n\n`;
  } else if (state.status === 'lost') {
    output += `💀 ${state.message}\n\n`;
  }

  // Render board
  output += `   0 1 2 3 4 5 6 7\n`;
  crushState.data.board.forEach((row, i) => {
    output += `${i}  ${row.join(' ')}\n`;
  });

  output += `\nScore: ${crushState.data.score}/${crushState.data.targetScore}\n`;
  output += `Moves Left: ${crushState.data.movesLeft}\n`;

  if (crushState.data.combo > 1) {
    output += `Last Combo: ${crushState.data.combo}x\n`;
  }

  if (state.status === 'playing') {
    const remaining = crushState.data.targetScore - crushState.data.score;
    output += `\nNeed ${remaining} more points in ${crushState.data.movesLeft} moves.\n`;
  }

  return output;
}
```

#### Verification

```bash
# Test win condition
puzldai game charm-crush --new --difficulty easy
# ... play until score >= 1000
# Should see: "🎉 You crushed it! Score: 1000/1000!"

# Test lose condition
puzldai game charm-crush --new --difficulty hard
# ... use all 15 moves without reaching 2000 score
# Should see: "💀 No more moves! Final score: X/2000"
```

---

## Phase 6: Testing (Sequential)

**Status:** Not Started
**Dependencies:** All previous phases complete
**Agents:** Run sequentially (tests depend on completed features)

### 🧪 Task 6.1: Improve test-game-integration.js

**File:** `test-game-integration.js` (create if doesn't exist)

#### Implementation

```javascript
import { execSync } from 'child_process';
import { describe, it, expect } from 'bun:test';

describe('Game Integration Tests', () => {
  describe('Factory AI Droid', () => {
    it('should create new game', () => {
      const output = execSync(
        'puzldai game factory-ai-droid --new --difficulty easy',
        { encoding: 'utf-8' }
      );
      expect(output).toContain('Factory AI Droid');
      expect(output).toContain('Credits: 50');
    });

    it('should build droid', () => {
      execSync('puzldai game factory-ai-droid --new --difficulty easy');
      const output = execSync(
        'puzldai game factory-ai-droid "build droid miner"',
        { encoding: 'utf-8' }
      );
      expect(output).toContain('miner: 1');
      expect(output).toContain('Credits: 40'); // 50 - 10
    });

    it('should execute production', () => {
      execSync('puzldai game factory-ai-droid --new --difficulty easy');
      execSync('puzldai game factory-ai-droid "build droid miner"');
      const output = execSync(
        'puzldai game factory-ai-droid "produce"',
        { encoding: 'utf-8' }
      );
      expect(output).toContain('Ore: 15'); // 10 + 5
      expect(output).toContain('Turn: 1/20');
    });

    it('should show validation errors', () => {
      execSync('puzldai game factory-ai-droid --new --difficulty easy');
      expect(() => {
        execSync('puzldai game factory-ai-droid "build droid invalid"');
      }).toThrow();
    });
  });

  describe('Charm Crush', () => {
    it('should create new game', () => {
      const output = execSync(
        'puzldai game charm-crush --new --difficulty easy',
        { encoding: 'utf-8' }
      );
      expect(output).toContain('Charm Crush');
      expect(output).toContain('Score: 0/1000');
    });

    it('should swap adjacent cells', () => {
      execSync('puzldai game charm-crush --new --difficulty easy');
      const output = execSync(
        'puzldai game charm-crush "swap 0 0 0 1"',
        { encoding: 'utf-8' }
      );
      expect(output).toContain('Moves Left:'); // Should decrement
    });

    it('should reject non-adjacent swaps', () => {
      execSync('puzldai game charm-crush --new --difficulty easy');
      expect(() => {
        execSync('puzldai game charm-crush "swap 0 0 5 5"');
      }).toThrow();
    });
  });

  describe('Session Management', () => {
    it('should list sessions', () => {
      const output = execSync('puzldai game factory-ai-droid --list', { encoding: 'utf-8' });
      expect(output).toContain('Sessions');
    });

    it('should show stats', () => {
      const output = execSync('puzldai game --stats', { encoding: 'utf-8' });
      expect(output).toContain('Total sessions');
    });

    it('should cleanup old sessions', () => {
      const output = execSync('puzldai game --cleanup 30', { encoding: 'utf-8' });
      expect(output).toContain('Cleaned up');
    });
  });
});
```

**Run Tests:**
```bash
npm run test
```

---

### 🧪 Task 6.2: Test Complete Game Lifecycle

#### Test Case 1: Factory AI Droid - Win Scenario

```bash
# Start game
puzldai game factory-ai-droid --new --difficulty easy

# Build production chain
puzldai game factory-ai-droid "build droid miner"
puzldai game factory-ai-droid "build droid refinery"

# Produce multiple times
for i in {1..10}; do
  puzldai game factory-ai-droid "produce"
done

# Should eventually win
# Expected: "🎉 Victory! Reached 100 credits in X turns!"
```

#### Test Case 2: Factory AI Droid - Lose Scenario

```bash
# Start hard difficulty
puzldai game factory-ai-droid --new --difficulty hard

# Don't build anything, just produce
for i in {1..10}; do
  puzldai game factory-ai-droid "produce"
done

# Should lose
# Expected: "💀 Game Over! Only X/200 credits after 10 turns."
```

#### Test Case 3: Charm Crush - Win Scenario

```bash
# Start game
puzldai game charm-crush --new --difficulty easy

# Make strategic swaps to reach 1000 points
# (This requires actually finding valid matches on the board)
puzldai game charm-crush "swap 0 0 0 1"
# ... continue making swaps until score >= 1000

# Should win
# Expected: "🎉 You crushed it! Score: 1000/1000!"
```

#### Test Case 4: Session Management

```bash
# Create multiple sessions
puzldai game factory-ai-droid --new --difficulty easy
puzldai game factory-ai-droid --end
puzldai game factory-ai-droid --new --difficulty medium
puzldai game factory-ai-droid --end
puzldai game charm-crush --new --difficulty hard

# List all sessions
puzldai game factory-ai-droid --list
puzldai game charm-crush --list

# Should show multiple inactive sessions for factory-ai-droid
# Should show 1 active session for charm-crush

# Resume specific session
SESSION_ID=$(puzldai game factory-ai-droid --list | grep -m1 "ID:" | awk '{print $2}')
puzldai game factory-ai-droid --session $SESSION_ID

# Cleanup old sessions
puzldai game --cleanup 0  # Clean all
```

#### Test Case 5: Input Validation

```bash
# All should show errors
puzldai game invalid-game --new
puzldai game factory-ai-droid --difficulty impossible
puzldai game factory-ai-droid --cleanup abc
puzldai game factory-ai-droid --session nonexistent

# Should succeed
puzldai game factory-ai-droid --new --difficulty hard
puzldai game factory-ai-droid --cleanup 30
```

#### Test Case 6: State Persistence

```bash
# Start game and make moves
puzldai game factory-ai-droid --new --difficulty easy
puzldai game factory-ai-droid "build droid miner"
puzldai game factory-ai-droid "produce"

# Show state (without new prompt)
OUTPUT1=$(puzldai game factory-ai-droid)

# Make another move
puzldai game factory-ai-droid "produce"

# Show state again
OUTPUT2=$(puzldai game factory-ai-droid)

# Outputs should differ (turn count, resources)
echo "First state: $OUTPUT1"
echo "Second state: $OUTPUT2"
```

**Document Results:**
Create `test-results.md` with:
- Test cases executed
- Pass/fail status
- Screenshots or output logs
- Issues discovered

---

## Phase 7: Documentation (Can Run Anytime)

**Status:** Not Started
**Dependencies:** Phase 2 complete (game mechanics)
**Can Overlap:** With testing phase

### 📝 Task 7.1: Update AGENTS.md

**File:** `AGENTS.md`

#### Additions Required

1. **Add Game Adapters Section**

   After line 26 (after MCP and Context):

   ```markdown
   | **Games** | Puzzle game adapters | `src/adapters/factory-ai-droid.ts`, `src/adapters/charm-crush.ts` |
   ```

2. **Add Games Subsection to Key Concepts**

   After line 80 (after Observation Layer):

   ```markdown
   ### Games
   Game adapters implement the `GameAdapter` interface, extending the base `Adapter`:
   - `initializeGame(options)` - Create initial game state
   - `renderState(state)` - Render game as formatted string
   - `validateCommand(command, state)` - Optional command validation

   **Available Games:**
   - **Factory AI Droid**: Resource management puzzle (ore → energy → credits)
   - **Charm Crush**: Match-3 puzzle (swap charms, cascade matches)

   **Game State:**
   ```typescript
   interface GameState {
     status: 'playing' | 'won' | 'lost' | 'invalid';
     moves?: string[];
     score?: number;
     message?: string;
     data?: unknown; // Game-specific data
   }
   ```

   **Session Management:**
   - Games stored in `~/.puzldai/game-sessions.db`
   - Only one active session per game
   - Multiple inactive sessions allowed
   - Auto-end on win/lose
   ```

3. **Add Game Commands to File Locations**

   After line 124:

   ```markdown
   | Game sessions DB | `~/.puzldai/game-sessions.db` |
   | Game adapters | `src/adapters/factory-ai-droid.ts`, `src/adapters/charm-crush.ts` |
   ```

4. **Add Game Execution Mode**

   After line 142:

   ```markdown
   | **Game** | Play puzzle games (Factory AI Droid, Charm Crush) | `puzldai game <name> [command]` |
   ```

5. **Update Troubleshooting**

   After line 199:

   ```markdown
   | Game session conflict | Only one active session per game - end current with `--end` |
   | Invalid game command | Check game-specific commands with `puzldai game <name> status` |
   ```

#### Verification

- Read through AGENTS.md to ensure flow makes sense
- Verify all cross-references are correct
- Check markdown formatting

---

## 📊 Progress Tracking

### Completion Status

| Phase | Tasks | Status | Agent(s) | Notes |
|-------|-------|--------|----------|-------|
| 1 | Schema Fix | ✅ Completed | Single | Completed 2025-12-23 |
| 2A | Factory AI Droid | ✅ Completed | Agent A | Completed 2025-12-23 |
| 2B | Charm Crush | ✅ Completed | Agent B | Completed 2025-12-23 |
| 3A | CLI State & Session | ⬜ Not Started | Agent C | Parallel |
| 3B | CLI Validation | ⬜ Not Started | Agent D | Parallel |
| 4A | State Parsing | ⬜ Not Started | Agent E | Parallel |
| 4B | Command Validation | ⬜ Not Started | Agent F | Parallel |
| 5A | Factory Win/Lose | ⬜ Not Started | Agent G | Parallel |
| 5B | Charm Win/Lose | ⬜ Not Started | Agent H | Parallel |
| 6A | Test Integration | ⬜ Not Started | Single | Sequential |
| 6B | Test Lifecycle | ⬜ Not Started | Single | Sequential |
| 7 | Documentation | ⬜ Not Started | Single | Anytime |

**Legend:**
- ⬜ Not Started
- 🔄 In Progress
- ✅ Completed
- ❌ Blocked

### Task Dependencies

```
Phase 1 (Schema) ──┬──> Phase 2 (Game Mechanics)
                   │
                   ├──> Phase 3 (CLI)
                   │
                   └──> Phase 4 (Validation) ──> Phase 5 (Win/Lose)
                                                       │
                                                       └──> Phase 6 (Testing)

Phase 7 (Docs) can run independently after Phase 2
```

---

## 🔄 Change Log

### 2025-12-24
- Documentation consolidation completed:
  - Aligned CLI command names (`pk-puzldai` across all docs)
  - Updated test file references to include `agent-loop.test.ts`
  - Added Provider Safety sections referencing PROVIDER_SUPPORT_MATRIX.md
  - Added PickBuild mode to all relevant sections
  - Fixed repository URLs to use consistent format
  - Added Factory/Crush safety notes to CLAUDE.md

### 2025-12-23
- Initial plan created
- All 13 tasks identified
- 7 phases defined with parallel execution strategy
- **Phase 1 Completed**: Fixed SQLite schema constraint
  - Removed UNIQUE(game_name, is_active) table constraint
  - Added partial unique index for active sessions only
  - Implemented automatic migration from old schema
  - Created comprehensive test suite (game-sessions.test.ts)
  - Solution allows multiple inactive sessions, enforces single active session per game
- **Phase 2A Completed**: Implemented Factory AI Droid game mechanics
  - Updated FactoryState interface with proper data structure (ore, energy, credits, droids[], turn, maxTurns, targetCredits)
  - Implemented droid building system with 4 types:
    - Miner: 10 credits, produces +5 ore/turn
    - Solar: 15 credits, produces +3 energy/turn
    - Battery: 20 credits, converts 2 ore → 1 energy
    - Refinery: 25 credits, converts 3 ore → 5 credits
  - Implemented production mechanics in executeProduction() helper
  - Implemented resource validation (check credits before building)
  - Implemented command parsing: "build droid <type>", "produce", "status"
  - Updated renderState() to display resources, droids, and turn counter
  - Starting resources: 50 credits, 10 ore, 5 energy
  - Turn counter increments during production only
  - Error handling for invalid commands, insufficient credits, invalid droid types
  - State updates properly saved and returned in response
- **Phase 2B Completed**: Implemented Charm Crush game mechanics
  - Created initial board generation ensuring no starting matches
  - Implemented swap mechanics with adjacency validation
  - Implemented match detection for 3+ horizontal and vertical runs
  - Implemented gravity system to drop charms down after matches
  - Implemented board refill with random charms
  - Implemented cascade system with combo multiplier
  - Scoring: 10 points per charm × combo multiplier
  - Updated interface to include board[][] and score tracking
  - Command parsing for: swap <r1> <c1> <r2> <c2>, hint, status
  - Invalid swaps (non-adjacent or no match) are rejected and undone
  - Moves counter decrements only on successful swaps
  - Board maintains 8×8 size through all operations

---

## 📝 Notes for Maintainers

### When to Update This Plan

**Update this document whenever:**
1. A task is started (change status to 🔄 In Progress)
2. A task is completed (change status to ✅ Completed)
3. A blocker is discovered (change status to ❌ Blocked, add notes)
4. Requirements change (update task descriptions)
5. New tasks are discovered (add to appropriate phase)
6. Timeline estimates change (update progress tracking)

### How to Update

1. **Starting a task:**
   ```markdown
   | 2A | Factory AI Droid | 🔄 In Progress | Agent A | Started 2025-12-23 |
   ```

2. **Completing a task:**
   ```markdown
   | 2A | Factory AI Droid | ✅ Completed | Agent A | Done 2025-12-23 |
   ```
   Also check the box in Task Overview:
   ```markdown
   - [x] Implement Factory AI Droid game mechanics
   ```

3. **Blocking a task:**
   ```markdown
   | 2A | Factory AI Droid | ❌ Blocked | Agent A | Waiting on schema fix |
   ```

4. **Adding change log entry:**
   ```markdown
   ### 2025-12-24
   - Completed Phase 1 (Schema fix)
   - Started Phase 2A (Factory AI Droid mechanics)
   - Discovered issue: need to refactor GameState interface
   ```

### Document Format Guidelines

- Keep sections in order (Overview → Phases → Tracking → Log)
- Use consistent emoji indicators (⬜🔄✅❌)
- Always update "Last Updated" date at top
- Increment "Completion" counter when tasks finish
- Add detailed notes for blockers or changes
- Link to relevant commits/PRs when available

### Verification Checklist

Before marking a task complete, verify:
- [ ] Code compiles without errors
- [ ] All verification steps pass
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] No regressions introduced
- [ ] Code reviewed (if applicable)

---

## 🎯 Success Criteria

### Phase 1 Complete When:
- Schema allows multiple inactive sessions per game
- Only one active session per game enforced
- Existing sessions migrated successfully

### Phase 2 Complete When:
- Both games have full mechanics implemented
- Games are playable end-to-end
- State updates correctly
- Rendering displays properly

### Phase 3 Complete When:
- CLI shows state instead of creating new game
- Session updates persist to database
- All input validation prevents invalid usage

### Phase 4 Complete When:
- State parsing handles various LLM response formats
- Command validation prevents invalid moves
- Error messages are clear and helpful

### Phase 5 Complete When:
- Win conditions detected correctly
- Lose conditions detected correctly
- Sessions auto-end on game completion

### Phase 6 Complete When:
- All integration tests pass
- Full lifecycle tested manually
- No regressions in existing features

### Phase 7 Complete When:
- AGENTS.md fully documents game system
- Examples are clear and accurate
- All cross-references work

---

## 🚀 Quick Start for New Contributors

To work on a task from this plan:

1. **Choose a phase** that's ready to start (dependencies met)
2. **Read the task description** in detail
3. **Review the implementation examples** provided
4. **Update plan.md** to mark task as "In Progress"
5. **Implement the feature** following the guidelines
6. **Run verification steps** to ensure it works
7. **Update plan.md** to mark task as "Completed"
8. **Add change log entry** with details

---

## 📚 Related Documentation

- [AGENTS.md](./AGENTS.md) - Agent integration guide
- [GAME_INTEGRATION.md](./GAME_INTEGRATION.md) - Game system overview
- [CLAUDE.md](./CLAUDE.md) - Complete project guide
- [README.md](./README.md) - Getting started

---

*This plan is a living document. Keep it updated as work progresses!*
