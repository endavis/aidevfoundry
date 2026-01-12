/**
 * Feedback Loop: Self-Improving Configuration Testing
 *
 * A tight, self-referential loop that:
 * 1. Tests configurations head-to-head
 * 2. Analyzes what makes winners win
 * 3. Generates new hybrid configurations
 * 4. Eliminates losers, promotes winners
 * 5. Repeats until convergence
 *
 * Theory: Evolutionary optimization of orchestration patterns
 * - Configurations are "genomes"
 * - Performance is "fitness"
 * - Winners "reproduce" (combine traits)
 * - Losers "die" (get removed)
 */

import { execa } from 'execa';
import pc from 'picocolors';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { adapters } from '../adapters';
import { getConfig, getConfigDir } from '../lib/config';

// ============================================================================
// TYPES
// ============================================================================

export interface LoopConfig {
  id: string;
  name: string;
  /** The command pattern */
  pattern: ConfigPattern;
  /** Generation number (0 = seed, 1+ = evolved) */
  generation: number;
  /** Parent configs if evolved */
  parents?: string[];
  /** Performance metrics */
  stats: {
    wins: number;
    losses: number;
    elo: number;
    avgScore: number;
    avgDuration: number;
  };
}

export interface ConfigPattern {
  /** Pipeline steps: "agent:action" */
  steps: string[];
  /** Number of proposers for MoA-style */
  proposers?: number;
  /** Refinement rounds */
  refineRounds?: number;
  /** Verification strategy */
  verification?: 'none' | 'cross-check' | 'self-verify';
}

export interface LoopTask {
  id: string;
  prompt: string;
  /** Expected behavior for quick validation */
  validator?: (output: string) => boolean;
}

export interface MatchResult {
  winnerId: string;
  loserId: string;
  winnerScore: number;
  loserScore: number;
  reasoning: string;
  task: string;
  timestamp: number;
}

export interface LoopState {
  generation: number;
  configs: LoopConfig[];
  history: MatchResult[];
  bestConfig: string | null;
  converged: boolean;
}

// ============================================================================
// SEED CONFIGURATIONS
// ============================================================================

const SEED_CONFIGS: LoopConfig[] = [
  {
    id: 'direct',
    name: 'Direct',
    pattern: { steps: ['codex:implement'] },
    generation: 0,
    stats: { wins: 0, losses: 0, elo: 1000, avgScore: 0, avgDuration: 0 }
  },
  {
    id: 'plan-then-code',
    name: 'Plan→Code',
    pattern: { steps: ['codex:plan', 'claude:implement'] },
    generation: 0,
    stats: { wins: 0, losses: 0, elo: 1000, avgScore: 0, avgDuration: 0 }
  },
  {
    id: 'moa-simple',
    name: 'MoA Simple',
    pattern: { steps: ['codex:implement', 'claude:implement'], proposers: 2 },
    generation: 0,
    stats: { wins: 0, losses: 0, elo: 1000, avgScore: 0, avgDuration: 0 }
  },
  {
    id: 'validate-first',
    name: 'Validate First',
    pattern: { steps: ['codex:plan', 'gemini:validate', 'claude:implement'], verification: 'cross-check' },
    generation: 0,
    stats: { wins: 0, losses: 0, elo: 1000, avgScore: 0, avgDuration: 0 }
  },
  {
    id: 'self-refine',
    name: 'Self Refine',
    pattern: { steps: ['codex:implement', 'gemini:critique', 'codex:refine'], refineRounds: 1 },
    generation: 0,
    stats: { wins: 0, losses: 0, elo: 1000, avgScore: 0, avgDuration: 0 }
  }
];

// ============================================================================
// QUICK VALIDATION TASKS
// ============================================================================

const QUICK_TASKS: LoopTask[] = [
  {
    id: 'sum',
    prompt: 'Write a TypeScript function sum(a: number, b: number) that returns their sum',
    validator: (out) => out.includes('function') && out.includes('return') && (out.includes('a + b') || out.includes('a+b'))
  },
  {
    id: 'reverse',
    prompt: 'Write a TypeScript function reverse(s: string) that reverses the string',
    validator: (out) => out.includes('function') && out.includes('reverse')
  },
  {
    id: 'fizzbuzz',
    prompt: 'Write fizzbuzz(n: number) that returns "Fizz" for multiples of 3, "Buzz" for 5, "FizzBuzz" for both',
    validator: (out) => out.includes('Fizz') && out.includes('Buzz') && out.includes('%')
  },
  {
    id: 'isPalindrome',
    prompt: 'Write isPalindrome(s: string): boolean that checks if string is palindrome ignoring case',
    validator: (out) => out.includes('function') && (out.includes('toLowerCase') || out.includes('toUpperCase'))
  }
];

// ============================================================================
// CORE LOOP ENGINE
// ============================================================================

export class FeedbackLoop {
  private state: LoopState;
  private stateFile: string;
  private judgeModel: 'codex' | 'claude' | 'gemini';
  private verbose: boolean;

  constructor(options: { judgeModel?: 'codex' | 'claude' | 'gemini'; verbose?: boolean } = {}) {
    this.judgeModel = options.judgeModel || 'gemini';
    this.verbose = options.verbose ?? false;
    this.stateFile = join(getConfigDir(), 'feedback-loop-state.json');
    this.state = this.loadState();
  }

  private loadState(): LoopState {
    if (existsSync(this.stateFile)) {
      try {
        return JSON.parse(readFileSync(this.stateFile, 'utf-8'));
      } catch {
        // Fall through to default
      }
    }
    return {
      generation: 0,
      configs: [...SEED_CONFIGS],
      history: [],
      bestConfig: null,
      converged: false
    };
  }

  private saveState(): void {
    const dir = getConfigDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
  }

  /**
   * Build CLI command from config pattern
   */
  private buildCommand(config: LoopConfig, task: string): string {
    const { pattern } = config;
    const escapedTask = task.replace(/"/g, '\\"');

    // MoA style (multiple proposers)
    if (pattern.proposers && pattern.proposers > 1) {
      return `pk-puzldai puzzle "${escapedTask}" -p ${pattern.proposers} -r ${pattern.refineRounds || 1}`;
    }

    // Pipeline style
    if (pattern.steps.length > 1) {
      const pipeline = pattern.steps.join(' -> ');
      return `pk-puzldai pipe "${escapedTask}" "${pipeline}"`;
    }

    // Direct single agent
    const [agent, action] = pattern.steps[0].split(':');
    return `pk-puzldai run "${escapedTask}" -a ${agent}`;
  }

  /**
   * Execute a config on a task
   */
  private async execute(config: LoopConfig, task: LoopTask): Promise<{ output: string; duration: number; error?: string }> {
    const command = this.buildCommand(config, task.prompt);
    const startTime = Date.now();

    if (this.verbose) {
      console.log(pc.dim(`  $ ${command.slice(0, 60)}...`));
    }

    try {
      const { stdout } = await execa('sh', ['-c', command], {
        timeout: 60000,
        reject: false,
        shell: true
      });

      return {
        output: stdout,
        duration: Date.now() - startTime
      };
    } catch (err: unknown) {
      return {
        output: '',
        duration: Date.now() - startTime,
        error: (err as Error).message
      };
    }
  }

  /**
   * Quick validation using simple heuristics
   */
  private quickValidate(output: string, task: LoopTask): { valid: boolean; score: number } {
    if (!output || output.length < 10) {
      return { valid: false, score: 0 };
    }

    // Use task validator if available
    if (task.validator) {
      const valid = task.validator(output);
      return { valid, score: valid ? 70 : 30 };
    }

    // Fallback heuristics
    const hasCode = output.includes('function') || output.includes('=>') || output.includes('const ');
    const hasReturn = output.includes('return');
    const reasonable = output.length > 50 && output.length < 5000;

    const score = (hasCode ? 30 : 0) + (hasReturn ? 20 : 0) + (reasonable ? 20 : 0);
    return { valid: score >= 50, score };
  }

  /**
   * Judge comparison using LLM
   */
  private async judge(task: LoopTask, outputA: string, outputB: string, configA: LoopConfig, configB: LoopConfig): Promise<{
    winner: 'A' | 'B' | 'TIE';
    scoreA: number;
    scoreB: number;
    reasoning: string;
  }> {
    // Quick validation first
    const quickA = this.quickValidate(outputA, task);
    const quickB = this.quickValidate(outputB, task);

    // If one clearly fails, fast path
    if (quickA.valid && !quickB.valid) {
      return { winner: 'A', scoreA: quickA.score, scoreB: quickB.score, reasoning: 'B failed basic validation' };
    }
    if (!quickA.valid && quickB.valid) {
      return { winner: 'B', scoreA: quickA.score, scoreB: quickB.score, reasoning: 'A failed basic validation' };
    }
    if (!quickA.valid && !quickB.valid) {
      return { winner: 'TIE', scoreA: quickA.score, scoreB: quickB.score, reasoning: 'Both failed validation' };
    }

    // LLM judgment for close calls
    const adapter = adapters[this.judgeModel];
    const prompt = `Compare these two solutions. Output ONLY JSON.

TASK: ${task.prompt}

SOLUTION A:
${outputA.slice(0, 1500)}

SOLUTION B:
${outputB.slice(0, 1500)}

{"winner":"A"|"B"|"TIE","scoreA":0-100,"scoreB":0-100,"reasoning":"brief"}`;

    try {
      const response = await adapter.run(prompt, { timeout: 30000 });
      const match = response.content.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        return {
          winner: parsed.winner,
          scoreA: parsed.scoreA || 50,
          scoreB: parsed.scoreB || 50,
          reasoning: parsed.reasoning || 'LLM judgment'
        };
      }
    } catch {
      // Fallback to quick scores
    }

    // Fallback: use quick scores
    if (quickA.score > quickB.score + 10) return { winner: 'A', scoreA: quickA.score, scoreB: quickB.score, reasoning: 'Higher quick score' };
    if (quickB.score > quickA.score + 10) return { winner: 'B', scoreA: quickA.score, scoreB: quickB.score, reasoning: 'Higher quick score' };
    return { winner: 'TIE', scoreA: quickA.score, scoreB: quickB.score, reasoning: 'Close scores' };
  }

  /**
   * Update ELO ratings
   */
  private updateElo(winner: LoopConfig, loser: LoopConfig, k: number = 32): void {
    const expected = 1 / (1 + Math.pow(10, (loser.stats.elo - winner.stats.elo) / 400));
    winner.stats.elo = Math.round(winner.stats.elo + k * (1 - expected));
    loser.stats.elo = Math.round(loser.stats.elo + k * (0 - (1 - expected)));
  }

  /**
   * Run one match between two configs
   */
  async runMatch(configA: LoopConfig, configB: LoopConfig, task: LoopTask): Promise<MatchResult> {
    if (this.verbose) {
      console.log(pc.cyan(`\n  ${configA.name} vs ${configB.name} on "${task.id}"`));
    }

    // Execute both
    const [resultA, resultB] = await Promise.all([
      this.execute(configA, task),
      this.execute(configB, task)
    ]);

    // Judge
    const judgment = await this.judge(task, resultA.output, resultB.output, configA, configB);

    // Update stats
    if (judgment.winner === 'A') {
      configA.stats.wins++;
      configB.stats.losses++;
      this.updateElo(configA, configB);
    } else if (judgment.winner === 'B') {
      configB.stats.wins++;
      configA.stats.losses++;
      this.updateElo(configB, configA);
    }

    // Track scores
    const scoresA = [configA.stats.avgScore * (configA.stats.wins + configA.stats.losses - 1), judgment.scoreA];
    const scoresB = [configB.stats.avgScore * (configB.stats.wins + configB.stats.losses - 1), judgment.scoreB];
    configA.stats.avgScore = scoresA.reduce((a, b) => a + b, 0) / (configA.stats.wins + configA.stats.losses || 1);
    configB.stats.avgScore = scoresB.reduce((a, b) => a + b, 0) / (configB.stats.wins + configB.stats.losses || 1);

    // Track duration
    configA.stats.avgDuration = (configA.stats.avgDuration + resultA.duration) / 2;
    configB.stats.avgDuration = (configB.stats.avgDuration + resultB.duration) / 2;

    const result: MatchResult = {
      winnerId: judgment.winner === 'A' ? configA.id : judgment.winner === 'B' ? configB.id : 'TIE',
      loserId: judgment.winner === 'A' ? configB.id : judgment.winner === 'B' ? configA.id : 'TIE',
      winnerScore: judgment.winner === 'A' ? judgment.scoreA : judgment.scoreB,
      loserScore: judgment.winner === 'A' ? judgment.scoreB : judgment.scoreA,
      reasoning: judgment.reasoning,
      task: task.id,
      timestamp: Date.now()
    };

    this.state.history.push(result);

    if (this.verbose) {
      const winnerName = judgment.winner === 'TIE' ? 'TIE' : (judgment.winner === 'A' ? configA.name : configB.name);
      console.log(pc.yellow(`    → ${winnerName} (${judgment.scoreA} vs ${judgment.scoreB})`));
    }

    return result;
  }

  /**
   * Evolve: Create new configs by combining winners
   */
  evolve(): LoopConfig[] {
    const sorted = [...this.state.configs].sort((a, b) => b.stats.elo - a.stats.elo);
    const top2 = sorted.slice(0, 2);
    const newConfigs: LoopConfig[] = [];

    if (top2.length < 2) return newConfigs;

    const [parent1, parent2] = top2;

    // Crossover: combine steps from both parents
    const combinedSteps = [
      ...parent1.pattern.steps.slice(0, 1),
      ...parent2.pattern.steps.slice(-1)
    ];

    // Child 1: First parent's start + second parent's end
    newConfigs.push({
      id: `evolved-${this.state.generation + 1}-a`,
      name: `Evolved ${this.state.generation + 1}A`,
      pattern: {
        steps: combinedSteps,
        proposers: parent1.pattern.proposers,
        refineRounds: parent2.pattern.refineRounds,
        verification: parent1.pattern.verification || parent2.pattern.verification
      },
      generation: this.state.generation + 1,
      parents: [parent1.id, parent2.id],
      stats: { wins: 0, losses: 0, elo: 1000, avgScore: 0, avgDuration: 0 }
    });

    // Child 2: Add refinement to winner if it doesn't have it
    if (!parent1.pattern.refineRounds) {
      newConfigs.push({
        id: `evolved-${this.state.generation + 1}-b`,
        name: `Evolved ${this.state.generation + 1}B`,
        pattern: {
          ...parent1.pattern,
          steps: [...parent1.pattern.steps, 'gemini:refine'],
          refineRounds: 1
        },
        generation: this.state.generation + 1,
        parents: [parent1.id],
        stats: { wins: 0, losses: 0, elo: 1000, avgScore: 0, avgDuration: 0 }
      });
    }

    return newConfigs;
  }

  /**
   * Prune: Remove worst performers
   */
  prune(keepTop: number = 5): void {
    const sorted = [...this.state.configs].sort((a, b) => b.stats.elo - a.stats.elo);
    this.state.configs = sorted.slice(0, keepTop);
  }

  /**
   * Run one generation of the feedback loop
   */
  async runGeneration(tasks: LoopTask[] = QUICK_TASKS): Promise<void> {
    console.log(pc.bold(pc.cyan(`\n🔄 Generation ${this.state.generation}\n`)));
    console.log(pc.dim(`Configs: ${this.state.configs.length} | Tasks: ${tasks.length}`));

    // Round robin tournament
    for (const task of tasks) {
      for (let i = 0; i < this.state.configs.length; i++) {
        for (let j = i + 1; j < this.state.configs.length; j++) {
          await this.runMatch(this.state.configs[i], this.state.configs[j], task);
        }
      }
    }

    // Show current standings
    this.printLeaderboard();

    // Evolve new configs
    const newConfigs = this.evolve();
    if (newConfigs.length > 0) {
      console.log(pc.green(`\n✨ Evolved ${newConfigs.length} new config(s)`));
      for (const nc of newConfigs) {
        console.log(pc.dim(`   ${nc.name}: ${nc.pattern.steps.join(' → ')}`));
      }
      this.state.configs.push(...newConfigs);
    }

    // Prune losers
    this.prune(6);

    // Update state
    this.state.generation++;
    this.state.bestConfig = this.state.configs.sort((a, b) => b.stats.elo - a.stats.elo)[0]?.id || null;

    // Check convergence (top config is stable)
    if (this.state.generation > 3) {
      const top = this.state.configs[0];
      if (top.stats.elo > 1100 && top.stats.wins > top.stats.losses * 2) {
        this.state.converged = true;
      }
    }

    this.saveState();
  }

  /**
   * Run multiple generations until convergence
   */
  async runLoop(maxGenerations: number = 5): Promise<LoopConfig> {
    console.log(pc.bold(pc.magenta('\n🔁 Starting Feedback Loop\n')));

    for (let g = 0; g < maxGenerations && !this.state.converged; g++) {
      await this.runGeneration();
    }

    const best = this.state.configs.sort((a, b) => b.stats.elo - a.stats.elo)[0];

    console.log(pc.bold(pc.green('\n═══ Loop Complete ═══\n')));
    console.log(`Best Config: ${pc.cyan(best.name)}`);
    console.log(`Pattern: ${pc.dim(best.pattern.steps.join(' → '))}`);
    console.log(`ELO: ${best.stats.elo} | W/L: ${best.stats.wins}/${best.stats.losses}`);
    console.log(`Generation: ${best.generation} ${best.parents ? `(from ${best.parents.join(' + ')})` : '(seed)'}`);

    if (this.state.converged) {
      console.log(pc.green('\n✓ Converged!'));
    }

    return best;
  }

  /**
   * Quick A/B test between two specific configs
   */
  async abTest(configIdA: string, configIdB: string, task?: LoopTask): Promise<MatchResult> {
    const configA = this.state.configs.find(c => c.id === configIdA);
    const configB = this.state.configs.find(c => c.id === configIdB);

    if (!configA || !configB) {
      throw new Error(`Config not found: ${configIdA} or ${configIdB}`);
    }

    const testTask = task || QUICK_TASKS[Math.floor(Math.random() * QUICK_TASKS.length)];
    return this.runMatch(configA, configB, testTask);
  }

  /**
   * Print current leaderboard
   */
  printLeaderboard(): void {
    const sorted = [...this.state.configs].sort((a, b) => b.stats.elo - a.stats.elo);

    console.log(pc.bold('\n📊 Leaderboard'));
    console.log(pc.dim('─'.repeat(55)));
    console.log(pc.dim('Rank  Config              W   L   Avg   ELO   Gen'));
    console.log(pc.dim('─'.repeat(55)));

    sorted.forEach((config, i) => {
      const rank = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      const gen = config.generation === 0 ? 'seed' : `gen${config.generation}`;
      console.log(
        `${rank.padEnd(6)}${config.name.padEnd(20)}` +
        `${String(config.stats.wins).padStart(3)}  ` +
        `${String(config.stats.losses).padStart(3)}  ` +
        `${config.stats.avgScore.toFixed(0).padStart(4)}  ` +
        `${String(config.stats.elo).padStart(4)}  ` +
        `${gen}`
      );
    });
    console.log(pc.dim('─'.repeat(55)));
  }

  /**
   * Reset state to seeds
   */
  reset(): void {
    this.state = {
      generation: 0,
      configs: [...SEED_CONFIGS],
      history: [],
      bestConfig: null,
      converged: false
    };
    this.saveState();
    console.log(pc.yellow('State reset to seed configurations'));
  }

  /**
   * Get current state
   */
  getState(): LoopState {
    return this.state;
  }

  /**
   * Add custom config
   */
  addConfig(config: Omit<LoopConfig, 'stats'>): void {
    this.state.configs.push({
      ...config,
      stats: { wins: 0, losses: 0, elo: 1000, avgScore: 0, avgDuration: 0 }
    });
    this.saveState();
  }
}

// ============================================================================
// CLI HELPERS
// ============================================================================

export async function runFeedbackLoop(options: {
  generations?: number;
  verbose?: boolean;
  reset?: boolean;
  judge?: 'codex' | 'claude' | 'gemini';
}): Promise<void> {
  const loop = new FeedbackLoop({
    judgeModel: options.judge,
    verbose: options.verbose ?? true
  });

  if (options.reset) {
    loop.reset();
  }

  await loop.runLoop(options.generations || 3);
}

export async function runQuickAB(configA: string, configB: string): Promise<void> {
  const loop = new FeedbackLoop({ verbose: true });
  await loop.abTest(configA, configB);
  loop.printLeaderboard();
}
