/**
 * Feedback Loop Command
 *
 * Usage:
 *   pk-puzldai loop                    # Run 3 generations
 *   pk-puzldai loop -g 5               # Run 5 generations
 *   pk-puzldai loop --reset            # Reset and start fresh
 *   pk-puzldai loop --ab direct,moa-simple  # Quick A/B test
 *   pk-puzldai loop --status           # Show current standings
 *   pk-puzldai loop --parallel         # Test parallel model configs
 */

import pc from 'picocolors';
import { FeedbackLoop, runFeedbackLoop, runQuickAB } from '../../eval/feedback-loop';
import { testParallelConfigs } from '../../eval/parallel-model-test';

export interface LoopCommandOptions {
  generations?: number;
  verbose?: boolean;
  reset?: boolean;
  ab?: string;
  status?: boolean;
  judge?: string;
  parallel?: boolean;
}

export async function loopCommand(options: LoopCommandOptions = {}): Promise<void> {
  // Status mode
  if (options.status) {
    const loop = new FeedbackLoop({ verbose: false });
    const state = loop.getState();

    console.log(pc.bold(pc.cyan('\n🔁 Feedback Loop Status\n')));
    console.log(`Generation: ${state.generation}`);
    console.log(`Configs: ${state.configs.length}`);
    console.log(`Best: ${state.bestConfig || 'none yet'}`);
    console.log(`Converged: ${state.converged ? pc.green('Yes') : 'No'}`);
    console.log(`History: ${state.history.length} matches`);

    loop.printLeaderboard();
    return;
  }

  // A/B test mode
  if (options.ab) {
    const [a, b] = options.ab.split(',').map(s => s.trim());
    if (!a || !b) {
      console.error(pc.red('Usage: --ab configA,configB'));
      return;
    }
    await runQuickAB(a, b);
    return;
  }

  // Parallel model testing mode
  if (options.parallel) {
    await testParallelConfigs({
      verbose: options.verbose ?? true
    });
    return;
  }

  // Main loop
  await runFeedbackLoop({
    generations: options.generations || 3,
    verbose: options.verbose ?? true,
    reset: options.reset,
    judge: (options.judge as 'codex' | 'claude' | 'gemini') || 'gemini'
  });
}
