/**
 * Puzzle Assembly Command
 *
 * Multi-agent orchestration using state-of-the-art patterns:
 * - Mixture of Agents (MoA)
 * - Graph of Thoughts decomposition
 * - Self-Refine iteration
 * - Semantic verification
 *
 * Usage:
 *   pk-puzldai puzzle "Build a REST API for user management"
 *   pk-puzldai puzzle "Refactor auth system" --proposers 3 --refine 2
 */

import pc from 'picocolors';
import { buildPuzzleAssemblyPlan, type PuzzleAssemblyOptions } from '../../orchestrator/puzzle-assembly';
import { execute, formatPlanForDisplay } from '../../executor';

export interface PuzzleCommandOptions {
  /** Number of proposer agents in MoA layer */
  proposers?: number;
  /** Number of refinement rounds */
  refine?: number;
  /** Verification strategy */
  verify?: 'triangulation' | 'test-generation' | 'cross-check';
  /** Show execution plan without running */
  dryRun?: boolean;
  /** Verbose output */
  verbose?: boolean;
}

export async function puzzleCommand(task: string, options: PuzzleCommandOptions = {}): Promise<void> {
  const startTime = Date.now();

  console.log(pc.bold(pc.cyan('\n🧩 Puzzle Assembly Orchestration\n')));
  console.log(pc.dim('Multi-agent collaboration using MoA + GoT + Self-Refine patterns\n'));

  // Display configuration
  console.log(pc.bold('Configuration:'));
  console.log(`  ${pc.dim('Proposers:')} ${options.proposers || 2} agents`);
  console.log(`  ${pc.dim('Refinement:')} ${options.refine || 2} rounds`);
  console.log(`  ${pc.dim('Verification:')} ${options.verify || 'cross-check'}`);
  console.log();

  // Build the execution plan
  const assemblyOptions: PuzzleAssemblyOptions = {
    proposerCount: options.proposers || 2,
    refinementRounds: options.refine || 2,
    verificationStrategy: options.verify || 'cross-check',
  };

  const plan = buildPuzzleAssemblyPlan(task, assemblyOptions);

  if (options.dryRun) {
    console.log(pc.bold('\nExecution Plan:\n'));
    console.log(formatPlanForDisplay(plan));
    return;
  }

  // Phase indicators
  const phases = [
    { id: 'decompose', name: 'DECOMPOSE', icon: '📋', desc: 'Breaking into pieces' },
    { id: 'propose_1', name: 'PROPOSE', icon: '💡', desc: 'Agent proposals (MoA)' },
    { id: 'propose_2', name: 'PROPOSE', icon: '💡', desc: 'Agent proposals (MoA)' },
    { id: 'assemble', name: 'ASSEMBLE', icon: '🔧', desc: 'Combining best solutions' },
    { id: 'verify', name: 'VERIFY', icon: '✓', desc: 'Checking correctness' },
    { id: 'refine', name: 'REFINE', icon: '✨', desc: 'Final improvements' },
  ];

  let currentPhase = '';

  console.log(pc.bold('Execution:\n'));

  const result = await execute(plan, {
    onEvent: (event) => {
      if (event.type === 'start') {
        const phase = phases.find(p => p.id === event.stepId);
        if (phase && phase.name !== currentPhase) {
          currentPhase = phase.name;
          console.log(`${phase.icon} ${pc.bold(pc.cyan(phase.name))} - ${pc.dim(phase.desc)}`);
        }

        const step = plan.steps.find(s => s.id === event.stepId);
        if (step && options.verbose) {
          console.log(pc.dim(`   → ${step.agent}: starting...`));
        }
      } else if (event.type === 'complete') {
        const data = event.data as { content?: string; duration?: number } | undefined;
        if (options.verbose && data?.duration) {
          console.log(pc.dim(`   ✓ completed (${(data.duration / 1000).toFixed(1)}s)`));
        }
      } else if (event.type === 'error') {
        console.log(pc.red(`   ✗ Error: ${event.message}`));
      }
    }
  });

  console.log();

  // Display results
  if (result.status === 'completed') {
    const finalResult = result.results.find(r => r.stepId === 'refine');

    console.log(pc.bold(pc.green('═══ Final Solution ═══\n')));
    if (finalResult?.content) {
      console.log(finalResult.content);
    }

    // Summary
    const duration = Date.now() - startTime;
    console.log(pc.dim('\n───────────────────────'));
    console.log(pc.dim(`Status: ${pc.green('✓ Complete')}`));
    console.log(pc.dim(`Duration: ${(duration / 1000).toFixed(1)}s`));
    console.log(pc.dim(`Agents used: ${result.results.map(r => r.model).filter(Boolean).join(' → ')}`));
  } else {
    console.log(pc.red('\n✗ Puzzle assembly failed'));
    for (const r of result.results) {
      if (r.error) {
        console.log(pc.red(`  ${r.stepId}: ${r.error}`));
      }
    }
    process.exit(1);
  }
}
