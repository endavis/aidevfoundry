import type { GameAdapter, GameState } from './base-game-adapter';
import { GameAdapterUtils } from './base-game-adapter';
import type { ModelResponse, RunOptions } from '../lib/types';

/**
 * Factory AI Droid - Resource management puzzle game
 *
 * Build droids to produce resources and reach credit goals within turn limits
 */

interface FactoryState extends GameState {
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

// Helper functions for game logic
function getDroidCost(type: string): number {
  const costs: Record<string, number> = {
    miner: 10,
    solar: 15,
    battery: 20,
    refinery: 25
  };
  return costs[type] || 0;
}

function validateResources(state: FactoryState, cost: number): boolean {
  return state.data.credits >= cost;
}

function executeProduction(state: FactoryState): void {
  state.data.droids.forEach(droid => {
    switch (droid.type) {
      case 'miner':
        // Miner: +5 ore/turn
        state.data.ore += 5 * droid.count;
        break;
      case 'solar':
        // Solar: +3 energy/turn
        state.data.energy += 3 * droid.count;
        break;
      case 'battery':
        // Battery: Convert 2 ore → 1 energy
        const oreToConvert = Math.min(state.data.ore, 2 * droid.count);
        state.data.ore -= oreToConvert;
        state.data.energy += Math.floor(oreToConvert / 2);
        break;
      case 'refinery':
        // Refinery: Convert 3 ore → 5 credits
        const oreForCredits = Math.min(state.data.ore, 3 * droid.count);
        state.data.ore -= oreForCredits;
        state.data.credits += Math.floor(oreForCredits / 3) * 5;
        break;
    }
  });
}

function checkWinLose(state: FactoryState): void {
  // Check win condition
  if (state.data.credits >= state.data.targetCredits) {
    state.status = 'won';
    state.message = `Victory! You reached ${state.data.credits} credits (target: ${state.data.targetCredits})`;
  }
  // Check lose condition
  else if (state.data.turn >= state.data.maxTurns) {
    state.status = 'lost';
    state.message = `Game Over! Ran out of turns. Credits: ${state.data.credits}/${state.data.targetCredits}`;
  }
}

export const factoryAiDroidAdapter: GameAdapter = {
  name: 'factory-ai-droid',

  async isAvailable(): Promise<boolean> {
    // Pure logic game - always available
    return true;
  },

  initializeGame(options: Record<string, unknown> = {}): FactoryState {
    const difficulty = (options.difficulty as string) || 'medium';

    const config = {
      easy: { maxTurns: 20, target: 100 },
      medium: { maxTurns: 15, target: 150 },
      hard: { maxTurns: 10, target: 200 }
    }[difficulty] || { maxTurns: 15, target: 150 };

    return {
      status: 'playing',
      moves: [],
      score: 0,
      data: {
        ore: 10,
        energy: 5,
        credits: 50,
        droids: [],
        turn: 0,
        maxTurns: config.maxTurns,
        targetCredits: config.target
      }
    };
  },

  renderState(state: FactoryState): string {
    const { ore, energy, credits, droids, turn, maxTurns, targetCredits } = state.data;

    let output = `
╔═══════════════════════════════════════════╗
║     FACTORY AI DROID - Turn ${turn}/${maxTurns}        ║
╚═══════════════════════════════════════════╝

Resources:
  🪨 Ore:     ${ore.toString().padStart(4)}
  ⚡ Energy:  ${energy.toString().padStart(4)}
  💰 Credits: ${credits.toString().padStart(4)} / ${targetCredits}

Droids:`;

    if (droids.length === 0) {
      output += '\n  (none)';
    } else {
      droids.forEach(droid => {
        const cost = getDroidCost(droid.type);
        output += `\n  ${droid.type.padEnd(10)} x${droid.count.toString().padStart(2)} (cost: ${cost} credits)`;
      });
    }

    output += `

Status: ${state.status.toUpperCase()}`;

    if (state.message) {
      output += `\n⚠️  ${state.message}`;
    }

    output += `

Available commands:
  • build droid <type>       - Build a new droid (miner/solar/battery/refinery)
  • produce                  - Execute production cycle
  • status                   - Show current status
  • help                     - Show detailed help`;

    return output.trim();
  },

  validateCommand(command: string, state: FactoryState): boolean {
    if (state.status !== 'playing') return false;

    // Validate command format
    return /^(build droid |produce|status|help)/i.test(command.trim());
  },

  async run(prompt: string, options?: RunOptions): Promise<ModelResponse> {
    const startTime = Date.now();

    try {
      // Handle new game requests
      if (GameAdapterUtils.isNewGameRequest(prompt)) {
        const difficulty = GameAdapterUtils.parseDifficulty(prompt);
        const state = this.initializeGame({ difficulty });

        return GameAdapterUtils.createResponse(state, this, Date.now() - startTime);
      }

      // Get current state from options or initialize a new game
      let state: FactoryState;
      if (options && 'state' in options && options.state) {
        state = options.state as FactoryState;
      } else {
        state = this.initializeGame();
      }

      // Don't allow moves if game is over
      const command = prompt.trim().toLowerCase();
      if (state.status !== 'playing' && !['status', 'help'].includes(command)) {
        state.message = 'Game is over. Start a new game to continue playing.';
        return GameAdapterUtils.createResponse(state, this, Date.now() - startTime);
      }

      // Parse and execute command
      if (command.startsWith('build droid ')) {
        const parts = command.split(' ');
        if (parts.length !== 3) {
          state.status = 'invalid';
          state.message = 'Usage: build droid <type>';
          return GameAdapterUtils.createResponse(state, this, Date.now() - startTime);
        }

        const droidType = parts[2];
        const validTypes = ['miner', 'solar', 'battery', 'refinery'];

        if (!validTypes.includes(droidType)) {
          state.status = 'invalid';
          state.message = `Invalid droid type. Available: ${validTypes.join(', ')}`;
          return GameAdapterUtils.createResponse(state, this, Date.now() - startTime);
        }

        const cost = getDroidCost(droidType);

        if (!validateResources(state, cost)) {
          state.status = 'invalid';
          state.message = `Insufficient credits. Need ${cost}, have ${state.data.credits}`;
          return GameAdapterUtils.createResponse(state, this, Date.now() - startTime);
        }

        // Deduct cost and add droid
        state.data.credits -= cost;
        const existingDroid = state.data.droids.find(d => d.type === droidType);
        if (existingDroid) {
          existingDroid.count++;
        } else {
          state.data.droids.push({ type: droidType, count: 1 });
        }

        state.status = 'playing';
        state.message = `Built ${droidType} droid. Remaining credits: ${state.data.credits}`;
        state.moves = [...(state.moves || []), command];

      } else if (command === 'produce') {
        if (state.data.droids.length === 0) {
          state.status = 'invalid';
          state.message = 'No droids to produce. Build droids first.';
          return GameAdapterUtils.createResponse(state, this, Date.now() - startTime);
        }

        // Execute production
        executeProduction(state);
        state.data.turn++;

        // Check win/lose conditions
        checkWinLose(state);

        if (state.status === 'playing') {
          state.message = `Production complete. Turn ${state.data.turn}/${state.data.maxTurns}`;
        }

        state.moves = [...(state.moves || []), command];

      } else if (command === 'status') {
        // Just show current state
        state.message = 'Current game status';

      } else if (command === 'help') {
        state.message = `
FACTORY AI DROID - Game Rules

GOAL: Reach ${state.data.targetCredits} credits within ${state.data.maxTurns} turns

DROID TYPES & COSTS:
  • Miner (10 credits)     - Produces +5 ore per turn
  • Solar (15 credits)     - Produces +3 energy per turn
  • Battery (20 credits)   - Converts 2 ore → 1 energy per turn
  • Refinery (25 credits)  - Converts 3 ore → 5 credits per turn

STRATEGY:
  1. Build miners to generate ore
  2. Build refineries to convert ore to credits
  3. Use solar panels for energy production
  4. Balance resource production to reach your goal

COMMANDS:
  • build droid <type>  - Purchase and build a droid
  • produce            - Execute production cycle (advances turn)
  • status             - Show current game state
  • help               - Show this help message
        `.trim();

      } else {
        state.status = 'invalid';
        state.message = 'Unknown command. Use: build droid <type>, produce, status, or help';
        return GameAdapterUtils.createResponse(state, this, Date.now() - startTime);
      }

      return GameAdapterUtils.createResponse(state, this, Date.now() - startTime);

    } catch (err: unknown) {
      const state: FactoryState = {
        status: 'invalid',
        message: (err as Error).message,
        moves: [],
        score: 0,
        data: {
          ore: 0,
          energy: 0,
          credits: 0,
          droids: [],
          turn: 0,
          maxTurns: 15,
          targetCredits: 150
        }
      };

      return GameAdapterUtils.createResponse(
        state,
        this,
        Date.now() - startTime,
        (err as Error).message
      );
    }
  }
};
