/**
 * Arena Command - Self-Referential Configuration Testing
 *
 * Usage:
 *   pk-puzldai arena                    # Quick test (3 configs, 2 tasks)
 *   pk-puzldai arena --full             # Full tournament
 *   pk-puzldai arena -c moa-2,single-codex -t fizzbuzz
 *   pk-puzldai arena --list             # Show available configs/tasks
 */

import pc from 'picocolors';
import {
  runArena,
  ARENA_CONFIGS,
  ARENA_TASKS
} from '../../eval/arena';

export interface ArenaCommandOptions {
  full?: boolean;
  configs?: string;
  tasks?: string;
  judge?: string;
  verbose?: boolean;
  list?: boolean;
}

export async function arenaCommand(options: ArenaCommandOptions = {}): Promise<void> {
  // List mode
  if (options.list) {
    console.log(pc.bold(pc.cyan('\n🏟️  Arena Configurations\n')));

    console.log(pc.bold('Configurations:'));
    for (const config of ARENA_CONFIGS) {
      console.log(`  ${pc.cyan(config.id.padEnd(20))} ${config.name}`);
      console.log(`    ${pc.dim(config.theory)}`);
    }

    console.log(pc.bold('\nTasks:'));
    for (const task of ARENA_TASKS) {
      const diffColor = task.difficulty === 'easy' ? 'green' :
                        task.difficulty === 'medium' ? 'yellow' : 'red';
      console.log(`  ${pc.cyan(task.id.padEnd(20))} [${pc[diffColor](task.difficulty)}] ${task.category}`);
      console.log(`    ${pc.dim(task.prompt.slice(0, 60))}...`);
    }

    console.log(pc.dim('\nUsage: pk-puzldai arena -c config1,config2 -t task1,task2\n'));
    return;
  }

  // Full mode
  if (options.full) {
    console.log(pc.bold(pc.yellow('\nRunning FULL tournament (this may take a while)...\n')));
    await runArena({
      verbose: options.verbose
    });
    return;
  }

  // Custom or quick mode
  const arenaOptions: Parameters<typeof runArena>[0] = {
    verbose: options.verbose ?? true,
    judge: (options.judge as 'codex' | 'claude' | 'gemini') || 'gemini'
  };

  if (options.configs) {
    arenaOptions.configs = options.configs.split(',').map(c => c.trim());
  }

  if (options.tasks) {
    arenaOptions.tasks = options.tasks.split(',').map(t => t.trim());
  }

  // If no custom options, run quick
  if (!options.configs && !options.tasks) {
    console.log(pc.dim('Running quick arena (use --full for complete tournament)\n'));
    arenaOptions.configs = ['single-codex', 'moa-2', 'pipeline-plan-code'];
    arenaOptions.tasks = ['fizzbuzz', 'debounce'];
  }

  await runArena(arenaOptions);
}
