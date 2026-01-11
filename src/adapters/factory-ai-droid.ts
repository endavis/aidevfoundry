/**
 * Factory AI Droid Game Adapter
 *
 * A strategic resource management game where you build and manage
 * automated droids to maximize resource production within a turn limit.
 *
 * Game Mechanics:
 * - Build droids: miner, solar, battery, refinery
 * - Produce resources each turn
 * - Win by reaching target credits before turns run out
 */

import type { GameAdapter, GameOptions, GameState, ModelResponse, RunOptions } from '../lib/types';

interface FactoryDroidState extends GameState {
  data: {
    ore: number;
    energy: number;
    credits: number;
    droids: Array<{ type: string; count: number }>;
    turn: number;
    maxTurns: number;
    targetCredits: number;
    difficulty: string;
  };
  moves: string[];
}

interface DroidType {
  name: string;
  cost: number;
  description: string;
}

const DROID_TYPES: DroidType[] = [
  { name: 'miner', cost: 10, description: 'Produces +5 ore/turn' },
  { name: 'solar', cost: 15, description: 'Produces +3 energy/turn' },
  { name: 'battery', cost: 20, description: 'Converts 2 ore -> 1 energy' },
  { name: 'refinery', cost: 25, description: 'Converts 3 ore -> 5 credits' }
];

const DIFFICULTY_SETTINGS = {
  easy: { maxTurns: 20, targetCredits: 100 },
  medium: { maxTurns: 15, targetCredits: 150 },
  hard: { maxTurns: 10, targetCredits: 200 }
};

function getDroidCost(type: string): number {
  const droid = DROID_TYPES.find(d => d.name === type);
  return droid?.cost ?? 0;
}

function createInitialState(options: GameOptions): FactoryDroidState {
  const settings = DIFFICULTY_SETTINGS[options.difficulty];
  return {
    status: 'playing',
    moves: [],
    score: 0,
    message: 'Build droids and produce resources to reach the target!',
    data: {
      ore: 10,
      energy: 5,
      credits: 50,
      droids: [],
      turn: 0,
      maxTurns: settings.maxTurns,
      targetCredits: settings.targetCredits,
      difficulty: options.difficulty
    }
  };
}

function renderFactoryState(state: GameState): string {
  const s = state as FactoryDroidState;

  let output = `=== Factory AI Droid ===\n`;
  output += `Difficulty: ${s.data.difficulty}\n\n`;

  if (state.status === 'won') {
    output += `VICTORY! ${state.message}\n\n`;
  } else if (state.status === 'lost') {
    output += `GAME OVER! ${state.message}\n\n`;
  } else if (state.status === 'invalid') {
    output += `ERROR: ${state.message}\n\n`;
  }

  output += `Resources:\n`;
  output += `  Ore: ${s.data.ore}\n`;
  output += `  Energy: ${s.data.energy}\n`;
  output += `  Credits: ${s.data.credits}/${s.data.targetCredits}\n\n`;

  output += `Droids:\n`;
  if (s.data.droids.length === 0) {
    output += `  (No droids built yet)\n`;
  } else {
    for (const droid of s.data.droids) {
      const info = DROID_TYPES.find(d => d.name === droid.type);
      output += `  ${droid.type}: ${droid.count} ${info ? `(${info.description})` : ''}\n`;
    }
  }

  output += `\nTurn: ${s.data.turn}/${s.data.maxTurns}\n`;

  if (state.status === 'playing') {
    const creditsNeeded = s.data.targetCredits - s.data.credits;
    const turnsLeft = s.data.maxTurns - s.data.turn;
    output += `\nNeed ${creditsNeeded} more credits in ${turnsLeft} turns.\n`;
  }

  return output;
}

function validateFactoryCommand(command: string, state: GameState): { valid: boolean; error?: string } {
  const s = state as FactoryDroidState;

  if (state.status === 'won' || state.status === 'lost') {
    return { valid: false, error: 'Game is over. Use --new to start a new game.' };
  }

  if (command.startsWith('build droid')) {
    const parts = command.split(' ');
    if (parts.length !== 3) {
      return { valid: false, error: 'Usage: build droid <miner|solar|battery|refinery>' };
    }

    const type = parts[2].toLowerCase();
    const droid = DROID_TYPES.find(d => d.name === type);

    if (!droid) {
      return { valid: false, error: `Unknown droid type: ${type}. Available: ${DROID_TYPES.map(d => d.name).join(', ')}` };
    }

    if (s.data.credits < droid.cost) {
      return { valid: false, error: `Insufficient credits. Need ${droid.cost}, have ${s.data.credits}` };
    }
  } else if (command === 'produce') {
    if (s.data.droids.length === 0) {
      return { valid: false, error: 'No droids to produce. Build droids first.' };
    }
  } else if (command === 'status' || command === '') {
    return { valid: true };
  } else {
    return { valid: false, error: 'Unknown command. Use: build droid <type>, produce, or status' };
  }

  return { valid: true };
}

function checkWinLose(state: FactoryDroidState): void {
  if (state.data.credits >= state.data.targetCredits) {
    state.status = 'won';
    state.message = `Reached ${state.data.targetCredits} credits in ${state.data.turn} turns!`;
  } else if (state.data.turn >= state.data.maxTurns) {
    state.status = 'lost';
    state.message = `Only ${state.data.credits}/${state.data.targetCredits} credits after ${state.data.maxTurns} turns.`;
  } else {
    state.status = 'playing';
  }
}

function executeProduction(state: FactoryDroidState): void {
  let oreProduced = 0;
  let energyProduced = 0;
  let creditsEarned = 0;

  for (const droid of state.data.droids) {
    switch (droid.type) {
      case 'miner':
        oreProduced += 5 * droid.count;
        break;
      case 'solar':
        energyProduced += 3 * droid.count;
        break;
      case 'battery':
        const oreForEnergy = Math.min(state.data.ore, 2 * droid.count);
        state.data.ore -= oreForEnergy;
        energyProduced += Math.floor(oreForEnergy / 2);
        break;
      case 'refinery':
        const oreForCredits = Math.min(state.data.ore, 3 * droid.count);
        state.data.ore -= oreForCredits;
        creditsEarned += Math.floor(oreForCredits / 3) * 5;
        break;
    }
  }

  state.data.ore += oreProduced;
  state.data.energy += energyProduced;
  state.data.credits += creditsEarned;

  if (oreProduced > 0 || energyProduced > 0 || creditsEarned > 0) {
    state.message = `Production: +${oreProduced} ore, +${energyProduced} energy, +${creditsEarned} credits`;
  } else {
    state.message = 'No production this turn.';
  }
}

export const factoryDroidAdapter: GameAdapter = {
  name: 'factory-ai-droid',

  async isAvailable(): Promise<boolean> {
    return true;
  },

  initializeGame(options: GameOptions): GameState {
    return createInitialState(options);
  },

  renderState(state: GameState): string {
    return renderFactoryState(state);
  },

  validateCommand(command: string, state: GameState): { valid: boolean; error?: string } {
    return validateFactoryCommand(command, state);
  },

  async run(prompt: string, options?: RunOptions): Promise<ModelResponse> {
    const startTime = Date.now();
    const state = options?.state as FactoryDroidState ?? createInitialState({ difficulty: 'easy' });

    if (!prompt || prompt === 'status') {
      return {
        content: renderFactoryState(state),
        model: this.name,
        duration: Date.now() - startTime,
        state
      };
    }

    const validation = validateFactoryCommand(prompt, state);
    if (!validation.valid) {
      return {
        content: `Invalid command: ${validation.error}\n\n${renderFactoryState(state)}`,
        model: this.name,
        duration: Date.now() - startTime,
        state: { ...state, status: 'invalid', message: validation.error }
      };
    }

    if (prompt.startsWith('build droid')) {
      const type = prompt.split(' ')[2].toLowerCase();
      const cost = getDroidCost(type);

      state.data.credits -= cost;
      const existing = state.data.droids.find(d => d.type === type);
      if (existing) {
        existing.count++;
      } else {
        state.data.droids.push({ type, count: 1 });
      }

      state.message = `Built ${type} droid. Remaining credits: ${state.data.credits}`;
      state.moves = [...(state.moves ?? []), prompt];
    } else if (prompt === 'produce') {
      executeProduction(state);
      state.data.turn++;
      checkWinLose(state);
      state.moves = [...(state.moves ?? []), prompt];
    }

    return {
      content: renderFactoryState(state),
      model: this.name,
      duration: Date.now() - startTime,
      state
    };
  }
};

export {
  type FactoryDroidState,
  type DroidType,
  DIFFICULTY_SETTINGS,
  DROID_TYPES
};
