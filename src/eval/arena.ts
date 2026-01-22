/**
 * Arena: Self-Referential Configuration Testing
 *
 * Tests different orchestration configurations against each other
 * using a judge model to determine winners. Creates feedback loop
 * for continuous improvement.
 *
 * Theory:
 * - Each "configuration" represents a hypothesis about optimal orchestration
 * - Configurations compete on identical tasks
 * - Judge model (separate from competitors) evaluates outputs
 * - ELO-style ratings track configuration performance over time
 * - Winners inform future configuration design
 *
 * Pattern Locations in Codebase:
 * ┌─────────────────────────────────────────────────────────────┐
 * │ Pattern              │ File                                 │
 * ├─────────────────────────────────────────────────────────────┤
 * │ Mixture of Agents    │ orchestrator/puzzle-assembly.ts      │
 * │ Graph of Thoughts    │ orchestrator/puzzle-assembly.ts      │
 * │ Self-Refine          │ orchestrator/puzzle-assembly.ts      │
 * │ Capability Cascade   │ router/router.ts                     │
 * │ Pipeline Execution   │ executor/executor.ts                 │
 * │ Plan Builders        │ executor/plan-builders.ts            │
 * │ PK-Poet (phased)     │ executor/pk-poet-builder.ts          │
 * │ Factory Modes        │ executor/factory-modes-builder.ts    │
 * │ Intelligent Routing  │ orchestrator/intelligent-orchestrator│
 * │ Profile System       │ orchestrator/profiles.ts             │
 * └─────────────────────────────────────────────────────────────┘
 */

import { execa } from 'execa';
import pc from 'picocolors';
import { adapters } from '../adapters';

// ============================================================================
// TYPES
// ============================================================================

export interface ArenaConfig {
  id: string;
  name: string;
  description: string;
  /** CLI command pattern (will interpolate {{task}}) */
  command: string;
  /** Theoretical basis */
  theory: string;
}

export interface ArenaTask {
  id: string;
  prompt: string;
  category: 'code' | 'analysis' | 'reasoning' | 'creative';
  difficulty: 'easy' | 'medium' | 'hard';
  /** Optional ground truth for verification */
  groundTruth?: string;
}

export interface ArenaResult {
  configId: string;
  taskId: string;
  output: string;
  duration: number;
  error?: string;
}

export interface JudgmentResult {
  taskId: string;
  winnerId: string;
  loserId: string;
  reasoning: string;
  scores: Record<string, number>;  // 0-100
  confidence: number;
}

export interface ArenaStats {
  configId: string;
  wins: number;
  losses: number;
  draws: number;
  avgScore: number;
  elo: number;
}

// ============================================================================
// CONFIGURATIONS
// ============================================================================

/**
 * Pre-defined configurations to test against each other
 * Each represents a different orchestration hypothesis
 */
export const ARENA_CONFIGS: ArenaConfig[] = [
  {
    id: 'single-codex',
    name: 'Single Codex',
    description: 'Direct to most capable model',
    command: 'pk-puzldai run "{{task}}" -a codex',
    theory: 'Hypothesis: Single powerful model beats complex orchestration for most tasks'
  },
  {
    id: 'single-claude',
    name: 'Single Claude',
    description: 'Direct to Claude',
    command: 'pk-puzldai run "{{task}}" -a claude',
    theory: 'Baseline: Standard single-agent approach'
  },
  {
    id: 'moa-2',
    name: 'MoA-2',
    description: 'Mixture of 2 Agents',
    command: 'pk-puzldai puzzle "{{task}}" -p 2 -r 1',
    theory: 'MoA paper: Multiple proposals + aggregation improves quality'
  },
  {
    id: 'moa-3',
    name: 'MoA-3',
    description: 'Mixture of 3 Agents',
    command: 'pk-puzldai puzzle "{{task}}" -p 3 -r 1',
    theory: 'More proposers = more diverse solutions to synthesize'
  },
  {
    id: 'pipeline-plan-code',
    name: 'Plan→Code Pipeline',
    description: 'Plan first, then implement',
    command: 'pk-puzldai pipe "{{task}}" "codex:plan -> claude:implement"',
    theory: 'Decomposition: Planning before execution reduces errors'
  },
  {
    id: 'pipeline-validate',
    name: 'Plan→Validate→Code',
    description: 'With validation step',
    command: 'pk-puzldai pipe "{{task}}" "codex:plan -> gemini:validate -> claude:implement"',
    theory: 'Verification-first: Catch issues before implementation'
  },
  {
    id: 'self-refine',
    name: 'Self-Refine',
    description: 'Generate then refine',
    command: 'pk-puzldai pipe "{{task}}" "codex:implement -> gemini:critique -> codex:refine"',
    theory: 'Self-Refine paper: Iterative improvement via self-feedback'
  },
  {
    id: 'pkpoet',
    name: 'PK-Poet',
    description: 'Phased execution with verification',
    command: 'pk-puzldai pkpoet "{{task}}"',
    theory: 'Multi-phase: REASON→DISCOVER→ATTACK→FORTIFY→EXECUTE'
  },
  {
    id: 'puzzle-full',
    name: 'Puzzle Assembly',
    description: 'Full MoA + GoT + Self-Refine',
    command: 'pk-puzldai puzzle "{{task}}" -p 2 -r 2 --verify cross-check',
    theory: 'Combined patterns: Decompose→Propose→Assemble→Verify→Refine'
  }
];

// ============================================================================
// TASKS
// ============================================================================

/**
 * Test tasks for arena evaluation
 * Mix of difficulties and categories
 */
export const ARENA_TASKS: ArenaTask[] = [
  // Easy - sanity checks
  {
    id: 'fizzbuzz',
    prompt: 'Write a FizzBuzz function in TypeScript that handles numbers 1-100',
    category: 'code',
    difficulty: 'easy'
  },
  {
    id: 'palindrome',
    prompt: 'Write a function to check if a string is a palindrome, ignoring spaces and case',
    category: 'code',
    difficulty: 'easy'
  },
  // Medium - requires thought
  {
    id: 'debounce',
    prompt: 'Implement a debounce function in TypeScript with proper typing and cancellation support',
    category: 'code',
    difficulty: 'medium'
  },
  {
    id: 'lru-cache',
    prompt: 'Implement an LRU cache class with get, put, and capacity management',
    category: 'code',
    difficulty: 'medium'
  },
  {
    id: 'parse-json-stream',
    prompt: 'Write a streaming JSON parser that handles partial chunks and emits complete objects',
    category: 'code',
    difficulty: 'medium'
  },
  // Hard - complex reasoning
  {
    id: 'rate-limiter',
    prompt: 'Design and implement a distributed rate limiter using the token bucket algorithm with Redis-like semantics',
    category: 'code',
    difficulty: 'hard'
  },
  {
    id: 'ast-transformer',
    prompt: 'Write a TypeScript AST transformer that converts arrow functions to regular functions while preserving this binding',
    category: 'code',
    difficulty: 'hard'
  },
  // Analysis tasks
  {
    id: 'analyze-tradeoffs',
    prompt: 'Analyze the tradeoffs between microservices and monolithic architecture for a startup with 5 engineers',
    category: 'analysis',
    difficulty: 'medium'
  }
];

// ============================================================================
// ARENA RUNNER
// ============================================================================

export interface ArenaOptions {
  /** Configs to test (default: all) */
  configs?: string[];
  /** Tasks to run (default: all) */
  tasks?: string[];
  /** Judge model */
  judge?: 'codex' | 'claude' | 'gemini';
  /** Number of rounds per matchup */
  rounds?: number;
  /** Timeout per run in ms */
  timeout?: number;
  /** Output directory for results */
  outputDir?: string;
  /** Verbose logging */
  verbose?: boolean;
}

/**
 * Run a single configuration on a task
 */
async function runConfig(
  config: ArenaConfig,
  task: ArenaTask,
  timeout: number
): Promise<ArenaResult> {
  const command = config.command.replace('{{task}}', task.prompt.replace(/"/g, '\\"'));
  const startTime = Date.now();

  try {
    // Parse command into parts
    const parts = command.split(' ');
    const cmd = parts[0];
    const args = parts.slice(1);

    const { stdout } = await execa(cmd, args, {
      timeout,
      shell: true,
      reject: false
    });

    return {
      configId: config.id,
      taskId: task.id,
      output: stdout,
      duration: Date.now() - startTime
    };
  } catch (err: unknown) {
    const error = err as Error;
    return {
      configId: config.id,
      taskId: task.id,
      output: '',
      duration: Date.now() - startTime,
      error: error.message
    };
  }
}

/**
 * Judge compares two outputs and determines winner
 */
async function judge(
  task: ArenaTask,
  resultA: ArenaResult,
  resultB: ArenaResult,
  judgeModel: 'codex' | 'claude' | 'gemini'
): Promise<JudgmentResult> {
  const adapter = adapters[judgeModel];

  const judgePrompt = `You are an impartial judge evaluating two solutions to the same task.

TASK: ${task.prompt}

SOLUTION A (${resultA.configId}):
${resultA.output || '[ERROR: No output]'}

SOLUTION B (${resultB.configId}):
${resultB.output || '[ERROR: No output]'}

Evaluate both solutions on:
1. Correctness - Does it solve the task correctly?
2. Completeness - Are all requirements addressed?
3. Code Quality - Is it clean, efficient, well-structured?
4. Error Handling - Are edge cases handled?
5. Clarity - Is it easy to understand?

Output ONLY valid JSON:
{
  "winner": "A" or "B" or "TIE",
  "scoreA": 0-100,
  "scoreB": 0-100,
  "reasoning": "Brief explanation of decision",
  "confidence": 0.0-1.0
}`;

  try {
    const response = await adapter.run(judgePrompt, { timeout: 60000 });
    const parsed = JSON.parse(response.content);

    return {
      taskId: task.id,
      winnerId: parsed.winner === 'A' ? resultA.configId :
        parsed.winner === 'B' ? resultB.configId : 'TIE',
      loserId: parsed.winner === 'A' ? resultB.configId :
        parsed.winner === 'B' ? resultA.configId : 'TIE',
      reasoning: parsed.reasoning,
      scores: {
        [resultA.configId]: parsed.scoreA,
        [resultB.configId]: parsed.scoreB
      },
      confidence: parsed.confidence
    };
  } catch (err) {
    // Fallback: compare by output length (crude but deterministic)
    const lenA = resultA.output?.length || 0;
    const lenB = resultB.output?.length || 0;

    return {
      taskId: task.id,
      winnerId: lenA > lenB ? resultA.configId : resultB.configId,
      loserId: lenA > lenB ? resultB.configId : resultA.configId,
      reasoning: 'Judge failed, used output length heuristic',
      scores: {
        [resultA.configId]: lenA > 0 ? 50 : 0,
        [resultB.configId]: lenB > 0 ? 50 : 0
      },
      confidence: 0.3
    };
  }
}

/**
 * Calculate ELO rating change
 */
function calculateElo(
  winnerElo: number,
  loserElo: number,
  k: number = 32
): { winnerNew: number; loserNew: number } {
  const expectedWinner = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  const expectedLoser = 1 / (1 + Math.pow(10, (winnerElo - loserElo) / 400));

  return {
    winnerNew: Math.round(winnerElo + k * (1 - expectedWinner)),
    loserNew: Math.round(loserElo + k * (0 - expectedLoser))
  };
}

/**
 * Main arena runner
 */
export async function runArena(options: ArenaOptions = {}): Promise<{
  results: JudgmentResult[];
  stats: ArenaStats[];
  leaderboard: string;
}> {
  const {
    configs = ARENA_CONFIGS.map(c => c.id),
    tasks = ARENA_TASKS.map(t => t.id),
    judge: judgeModel = 'gemini',
    rounds = 1,
    timeout = 120000,

    verbose = false
  } = options;

  const selectedConfigs = ARENA_CONFIGS.filter(c => configs.includes(c.id));
  const selectedTasks = ARENA_TASKS.filter(t => tasks.includes(t.id));

  console.log(pc.bold(pc.cyan('\n🏟️  Arena: Configuration Tournament\n')));
  console.log(pc.dim(`Configs: ${selectedConfigs.length} | Tasks: ${selectedTasks.length} | Judge: ${judgeModel}\n`));

  // Initialize stats
  const stats: Map<string, ArenaStats> = new Map();
  for (const config of selectedConfigs) {
    stats.set(config.id, {
      configId: config.id,
      wins: 0,
      losses: 0,
      draws: 0,
      avgScore: 0,
      elo: 1000
    });
  }

  const allResults: JudgmentResult[] = [];
  const allScores: Map<string, number[]> = new Map();

  // Run tournament
  for (const task of selectedTasks) {
    console.log(pc.bold(`\nTask: ${task.id} (${task.difficulty})`));
    console.log(pc.dim(task.prompt.slice(0, 80) + '...'));

    // Run all configs on this task
    const taskResults: Map<string, ArenaResult> = new Map();

    for (const config of selectedConfigs) {
      if (verbose) console.log(pc.dim(`  Running ${config.id}...`));
      const result = await runConfig(config, task, timeout);
      taskResults.set(config.id, result);

      if (result.error) {
        console.log(pc.red(`  ✗ ${config.id}: ${result.error.slice(0, 50)}`));
      } else if (verbose) {
        console.log(pc.green(`  ✓ ${config.id}: ${(result.duration / 1000).toFixed(1)}s`));
      }
    }

    // Pairwise comparisons
    for (let i = 0; i < selectedConfigs.length; i++) {
      for (let j = i + 1; j < selectedConfigs.length; j++) {
        const configA = selectedConfigs[i];
        const configB = selectedConfigs[j];
        const resultA = taskResults.get(configA.id)!;
        const resultB = taskResults.get(configB.id)!;

        if (verbose) console.log(pc.dim(`  Judging: ${configA.id} vs ${configB.id}...`));

        const judgment = await judge(task, resultA, resultB, judgeModel);
        allResults.push(judgment);

        // Update stats
        const statsA = stats.get(configA.id)!;
        const statsB = stats.get(configB.id)!;

        if (judgment.winnerId === 'TIE') {
          statsA.draws++;
          statsB.draws++;
        } else if (judgment.winnerId === configA.id) {
          statsA.wins++;
          statsB.losses++;
          const { winnerNew, loserNew } = calculateElo(statsA.elo, statsB.elo);
          statsA.elo = winnerNew;
          statsB.elo = loserNew;
        } else {
          statsB.wins++;
          statsA.losses++;
          const { winnerNew, loserNew } = calculateElo(statsB.elo, statsA.elo);
          statsB.elo = winnerNew;
          statsA.elo = loserNew;
        }

        // Track scores
        if (!allScores.has(configA.id)) allScores.set(configA.id, []);
        if (!allScores.has(configB.id)) allScores.set(configB.id, []);
        allScores.get(configA.id)!.push(judgment.scores[configA.id] || 0);
        allScores.get(configB.id)!.push(judgment.scores[configB.id] || 0);

        if (verbose) {
          const winner = judgment.winnerId === 'TIE' ? 'TIE' : judgment.winnerId;
          console.log(pc.yellow(`    → Winner: ${winner} (${judgment.confidence.toFixed(2)} conf)`));
        }
      }
    }
  }

  // Calculate average scores
  for (const [configId, scores] of allScores) {
    const stat = stats.get(configId)!;
    stat.avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  // Generate leaderboard
  const sortedStats = [...stats.values()].sort((a, b) => b.elo - a.elo);
  let leaderboard = '\n' + pc.bold('🏆 Leaderboard\n');
  leaderboard += pc.dim('─'.repeat(60) + '\n');
  leaderboard += pc.dim('Rank  Config                 W   L   D   Avg   ELO\n');
  leaderboard += pc.dim('─'.repeat(60) + '\n');

  sortedStats.forEach((stat, i) => {
    const config = ARENA_CONFIGS.find(c => c.id === stat.configId)!;
    const rank = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    leaderboard += `${rank.padEnd(6)}${config.name.padEnd(23)}${String(stat.wins).padStart(3)}  ${String(stat.losses).padStart(3)}  ${String(stat.draws).padStart(3)}  ${stat.avgScore.toFixed(0).padStart(4)}  ${stat.elo}\n`;
  });

  leaderboard += pc.dim('─'.repeat(60));

  console.log(leaderboard);

  // Theory validation
  console.log(pc.bold('\n📊 Theory Validation:\n'));
  const winner = sortedStats[0];
  const winnerConfig = ARENA_CONFIGS.find(c => c.id === winner.configId)!;
  console.log(pc.green(`Winner: ${winnerConfig.name}`));
  console.log(pc.dim(`Theory: ${winnerConfig.theory}`));

  return {
    results: allResults,
    stats: sortedStats,
    leaderboard
  };
}

/**
 * Quick arena with subset of configs and tasks
 */
export async function runQuickArena(): Promise<void> {
  await runArena({
    configs: ['single-codex', 'moa-2', 'pipeline-plan-code'],
    tasks: ['fizzbuzz', 'debounce'],
    judge: 'gemini',
    verbose: true
  });
}

/**
 * Full arena tournament
 */
export async function runFullArena(): Promise<void> {
  await runArena({
    verbose: false
  });
}
