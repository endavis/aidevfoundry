# Game Integration Guide

## Overview

PuzldAI now supports puzzle games as first-class adapters! This integration demonstrates the framework's versatility beyond code generation by treating games as specialized agents.

## Available Games

### 1. Factory AI Droid
**Type:** Resource management puzzle
**Difficulty Levels:** Easy, Medium, Hard

A strategic resource management game where you build and manage automated droids to maximize resource production within a turn limit.

**Core Mechanics:**
- Build droids (miner, engineer, trader)
- Assign droids to resource tasks
- Upgrade droid efficiency
- Meet resource targets before turn limit

### 2. Charm Crush
**Type:** Match-3 puzzle
**Difficulty Levels:** Easy, Medium, Hard

A colorful match-3 puzzle game where you swap adjacent charms to create matches and achieve score targets.

**Core Mechanics:**
- Swap adjacent charms
- Create matches of 3+ identical charms
- Build combos for higher scores
- Reach target score before moves run out

## CLI Commands

### Start a New Game

```bash
# Start Factory AI Droid on medium difficulty
pk-puzldai game factory-ai-droid --new

# Start Charm Crush on hard difficulty
pk-puzldai game charm-crush --new --difficulty hard
```

### List Game Sessions

```bash
# List all game sessions
pk-puzldai game --list

# List sessions for specific game
pk-puzldai game factory-ai-droid --list
```

### View Statistics

```bash
# Show overall statistics
pk-puzldai game --stats
```

### Session Management

```bash
# Resume specific session
pk-puzldai game factory-ai-droid --session <session-id>

# End active session
pk-puzldai game factory-ai-droid --end

# Delete specific session
pk-puzldai game --delete <session-id>

# Clean up old sessions (older than 30 days)
pk-puzldai game --cleanup 30
```

### Gameplay

```bash
# Send game commands to active session
pk-puzldai game factory-ai-droid "build droid miner"
pk-puzldai game charm-crush "swap A3 with B3"

# Show current game state
pk-puzldai game factory-ai-droid
```

## Multi-Agent Integration

Games work seamlessly with PuzldAI's orchestration modes:

### Compare Mode
Have different agents solve the same puzzle and compare strategies:

```bash
pk-puzldai compare "What's the optimal strategy for Factory AI Droid?" \
  -a claude,gemini,codex
```

### Debate Mode
Let agents debate the best approach:

```bash
pk-puzldai debate "Best opening move in Charm Crush" \
  -a claude,gemini -r 3
```

### Consensus Mode
Build consensus on strategy:

```bash
pk-puzldai consensus "Determine optimal Factory AI Droid build order" \
  -a claude,gemini,codex
```

### Pipeline Mode
Create multi-step game solving workflows:

```bash
# Using template
pk-puzldai template create game-solver \
  -P "factory-ai-droid:init,claude:analyze,gemini:strategy,claude:execute"

pk-puzldai run "Solve Factory AI Droid" --template game-solver
```

## Architecture

### Game Adapters
Games are implemented as specialized adapters that conform to the standard `Adapter` interface:

```typescript
interface GameAdapter extends Adapter {
  name: string;
  isAvailable(): Promise<boolean>;
  run(prompt: string, options?: RunOptions): Promise<ModelResponse>;

  // Game-specific methods
  initializeGame(options?: Record<string, unknown>): GameState;
  renderState(state: GameState): string;
  validateCommand?(command: string, state: GameState): boolean;
}
```

### Session Persistence
Game sessions are stored in SQLite (`~/.puzldai/game-sessions.db`) with:
- Unique session IDs
- Game state snapshots
- Creation and update timestamps
- Active/inactive status tracking

### Integration Points

1. **Adapter Registry** ([src/adapters/index.ts](src/adapters/index.ts))
   - Games registered alongside LLM adapters
   - Available via standard adapter discovery

2. **Type System** ([src/executor/types.ts](src/executor/types.ts))
   - `AgentName` type includes game names
   - Full orchestrator compatibility

3. **CLI** ([src/cli/index.ts](src/cli/index.ts))
   - Dedicated `game` command
   - Session management flags
   - Consistent with other commands

4. **Session Manager** ([src/memory/game-sessions.ts](src/memory/game-sessions.ts))
   - CRUD operations for game sessions
   - Statistics and cleanup utilities
   - Active session tracking

## File Structure

```
src/
├── adapters/
│   ├── base-game-adapter.ts          # Game adapter interface
│   ├── factory-ai-droid.ts           # Factory AI Droid implementation
│   ├── charm-crush.ts                # Charm Crush implementation
│   └── index.ts                      # Updated registry
├── memory/
│   └── game-sessions.ts              # Session persistence
├── cli/
│   ├── commands/
│   │   └── game.ts                   # Game CLI command
│   └── index.ts                      # Updated with game command
└── executor/
    └── types.ts                      # Updated AgentName type
```

## Development Notes

### Current Implementation Status

✅ **Completed:**
- Base game adapter interface
- Factory AI Droid adapter (placeholder mechanics)
- Charm Crush adapter (placeholder mechanics)
- Session persistence system
- CLI integration
- Type system updates
- Adapter registry integration

🚧 **Future Enhancements:**
- Full game mechanics implementation
- State persistence in game commands
- Interactive TUI mode for games
- Replay system
- Leaderboards
- AI strategy learning via memory system
- Multi-player tournaments

### Adding New Games

To add a new puzzle game:

1. **Create Adapter** ([src/adapters/your-game.ts](src/adapters/your-game.ts))
   ```typescript
   import type { GameAdapter, GameState } from './base-game-adapter';

   export const yourGameAdapter: GameAdapter = {
     name: 'your-game',
     async isAvailable() { return true; },
     initializeGame(options) { /* ... */ },
     renderState(state) { /* ... */ },
     async run(prompt, options) { /* ... */ }
   };
   ```

2. **Register Adapter** ([src/adapters/index.ts](src/adapters/index.ts))
   ```typescript
   import { yourGameAdapter } from './your-game';

   export const adapters: Record<string, Adapter> = {
     // ...
     'your-game': yourGameAdapter
   };
   ```

3. **Update Types** ([src/executor/types.ts](src/executor/types.ts))
   ```typescript
   export type AgentName =
     'claude' | 'gemini' | 'codex' | 'ollama' |
     'factory-ai-droid' | 'charm-crush' | 'your-game';
   ```

4. **Test Integration**
   ```bash
   pk-puzldai game your-game --new
   pk-puzldai game --list
   ```

## Use Cases

### 1. Agent Strategy Comparison
Compare how different LLMs approach puzzle solving:
```bash
pk-puzldai compare "Solve this Factory AI Droid scenario optimally" \
  -a claude,gemini,codex
```

### 2. AI Learning
Use the memory system to track successful strategies:
- Game moves stored as decisions
- Pattern recognition across sessions
- Strategy optimization over time

### 3. Benchmarking
Test agent reasoning capabilities:
- Constraint satisfaction (Factory AI Droid)
- Pattern recognition (Charm Crush)
- Multi-step planning
- Resource optimization

### 4. Interactive Demonstrations
Show PuzldAI's versatility:
- Games as adapters pattern
- Orchestration flexibility
- Session persistence
- Multi-agent collaboration

## Example Session

```bash
# Start new game
$ pk-puzldai game factory-ai-droid --new --difficulty medium

✓ Started new factory-ai-droid game
  Difficulty: medium
  Session ID: game_1703365200_abc123

╔═══════════════════════════════════════════╗
║     FACTORY AI DROID - Turn 0/15         ║
╚═══════════════════════════════════════════╝

Resources:
  🪨 Ore:       10
  ⚡ Energy:    10
  💰 Credits:   50
  ───────────────
  📊 Total:     70 / 150

Droids: 0 active

Status: PLAYING

Available commands:
  • build droid [type]
  • produce [resource]
  • status
  • help

# Make a move (future implementation)
$ pk-puzldai game factory-ai-droid "build droid miner"

# View all sessions
$ pk-puzldai game --list

=== All Games Sessions ===

game_1703365200_abc123 [active]
  Game: factory-ai-droid
  Created: 12/23/2024, 3:20:00 PM
  Updated: 12/23/2024, 3:20:00 PM
  Status: playing

# View statistics
$ pk-puzldai game --stats

=== Game Session Statistics ===

Total sessions: 5
Active sessions: 2

Sessions by game:
  factory-ai-droid: 3
  charm-crush: 2
```

## Testing

Run the integration test:

```bash
node test-game-integration.js
```

This verifies:
- Adapter loading
- Availability checks
- Basic run functionality
- CLI command structure

## Contributing

To contribute new games or enhance existing ones:

1. Follow the adapter pattern in [base-game-adapter.ts](src/adapters/base-game-adapter.ts)
2. Keep mechanics simple and terminal-friendly
3. Ensure compatibility with orchestration modes
4. Add tests for game logic
5. Update this documentation

## License

AGPL-3.0-only (same as PuzldAI)

---

**Questions or Issues?**
See main project: https://github.com/MedChaouch/Puzld.ai
