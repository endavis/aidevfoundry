import pc from 'picocolors';
import type { Command } from 'commander';
import {
  runCampaign,
  loadCampaign,
  resumeCampaign,
  type CampaignOptions,
  type CampaignResult
} from '../../orchestrator/campaign/campaign-engine.js';
import { CAMPAIGN_DEFAULTS } from '../../orchestrator/campaign/campaign-defaults.js';
import {
  loadCampaignState,
  getDefaultStateDir
} from '../../orchestrator/campaign/campaign-state.js';
import {
  listCheckpoints,
  quickSaveCheckpoint
} from '../../orchestrator/campaign/campaign-checkpoint.js';
import {
  checkForDrift,
  exceedsThreshold
} from '../../orchestrator/campaign/campaign-drift.js';
import type { DriftSeverity } from '../../orchestrator/campaign/campaign-types.js';

export function campaignCommand(program: Command): void {
  const campaign = program
    .command('campaign')
    .description('Run long-running autonomous coding campaigns with hierarchical planner/worker agents');

  // Main run command
  campaign
    .command('run')
    .description('Start a new campaign')
    .argument('<goal>', 'The campaign goal')
    .option('--state <path>', 'Override campaign state directory')
    .option('--planner <agent>', `Planner agent (default: ${CAMPAIGN_DEFAULTS.planner})`)
    .option('--sub-planner <agent>', `Sub-planner agent (default: ${CAMPAIGN_DEFAULTS.subPlanner})`)
    .option('--worker <agents>', `Worker agents comma-separated (default: ${CAMPAIGN_DEFAULTS.workers.join(',')})`)
    .option('--max-workers <n>', 'Maximum concurrent workers', String(CAMPAIGN_DEFAULTS.maxWorkers))
    .option('--checkpoint-every <n>', 'Checkpoint after N tasks', String(CAMPAIGN_DEFAULTS.checkpointEvery))
    .option('--fresh-start-every <n>', 'Fresh start after N tasks', String(CAMPAIGN_DEFAULTS.freshStartEvery))
    .option('--autonomy <level>', 'Autonomy level: checkpoint or auto', CAMPAIGN_DEFAULTS.autonomy)
    .option('--git-mode <mode>', 'Git mode: task-branch, campaign-branch, or patches', CAMPAIGN_DEFAULTS.gitMode)
    .option('--merge-strategy <strategy>', 'Merge strategy: merge, rebase, or squash', CAMPAIGN_DEFAULTS.mergeStrategy)
    .option('--use-droid', 'Enable droid execution for workers')
    .option('--no-droid', 'Disable droid execution')
    .option('--dry-run', 'Show plan without executing')
    .action(async (goal: string, opts) => {
      try {
        await executeCampaignRun(goal, opts, false);
      } catch (error) {
        console.error(pc.red(`Error: ${(error as Error).message}`));
        process.exit(1);
      }
    });

  // Resume command
  campaign
    .command('resume')
    .description('Resume an existing campaign')
    .option('--state <path>', 'Campaign state directory')
    .option('--from-checkpoint <id>', 'Resume from specific checkpoint')
    .action(async (opts) => {
      try {
        await executeCampaignResume(opts);
      } catch (error) {
        console.error(pc.red(`Error: ${(error as Error).message}`));
        process.exit(1);
      }
    });

  // Status command
  campaign
    .command('status')
    .description('Show current campaign status')
    .option('--state <path>', 'Campaign state directory')
    .option('--verbose', 'Show detailed task information')
    .action(async (opts) => {
      try {
        await showCampaignStatus(opts);
      } catch (error) {
        console.error(pc.red(`Error: ${(error as Error).message}`));
        process.exit(1);
      }
    });

  // List checkpoints command
  campaign
    .command('list')
    .description('List campaign checkpoints')
    .option('--state <path>', 'Campaign state directory')
    .action(async (opts) => {
      try {
        await listCampaignCheckpoints(opts);
      } catch (error) {
        console.error(pc.red(`Error: ${(error as Error).message}`));
        process.exit(1);
      }
    });

  // Checkpoint command
  campaign
    .command('checkpoint')
    .description('Create a manual checkpoint')
    .option('--state <path>', 'Campaign state directory')
    .option('--reason <reason>', 'Reason for checkpoint', 'manual')
    .action(async (opts) => {
      try {
        await createManualCheckpoint(opts);
      } catch (error) {
        console.error(pc.red(`Error: ${(error as Error).message}`));
        process.exit(1);
      }
    });

  // Drift detection command
  campaign
    .command('drift')
    .description('Check for campaign drift')
    .option('--state <path>', 'Campaign state directory')
    .option('--threshold <level>', 'Severity threshold: minor, moderate, severe', 'moderate')
    .action(async (opts) => {
      try {
        await checkCampaignDrift(opts);
      } catch (error) {
        console.error(pc.red(`Error: ${(error as Error).message}`));
        process.exit(1);
      }
    });

  // Default action (backward compatibility) - run with goal as argument
  campaign
    .argument('[goal]', 'The campaign goal (for backward compatibility)')
    .option('--state <path>', 'Override campaign state directory')
    .option('--planner <agent>', `Planner agent (default: ${CAMPAIGN_DEFAULTS.planner})`)
    .option('--sub-planner <agent>', `Sub-planner agent (default: ${CAMPAIGN_DEFAULTS.subPlanner})`)
    .option('--worker <agents>', `Worker agents comma-separated (default: ${CAMPAIGN_DEFAULTS.workers.join(',')})`)
    .option('--max-workers <n>', 'Maximum concurrent workers', String(CAMPAIGN_DEFAULTS.maxWorkers))
    .option('--checkpoint-every <n>', 'Checkpoint after N tasks', String(CAMPAIGN_DEFAULTS.checkpointEvery))
    .option('--fresh-start-every <n>', 'Fresh start after N tasks', String(CAMPAIGN_DEFAULTS.freshStartEvery))
    .option('--autonomy <level>', 'Autonomy level: checkpoint or auto', CAMPAIGN_DEFAULTS.autonomy)
    .option('--git-mode <mode>', 'Git mode: task-branch, campaign-branch, or patches', CAMPAIGN_DEFAULTS.gitMode)
    .option('--merge-strategy <strategy>', 'Merge strategy: merge, rebase, or squash', CAMPAIGN_DEFAULTS.mergeStrategy)
    .option('--use-droid', 'Enable droid execution for workers')
    .option('--no-droid', 'Disable droid execution')
    .option('--dry-run', 'Show plan without executing')
    .option('--resume', 'Resume existing campaign')
    .action(async (goal: string | undefined, opts) => {
      if (!goal) {
        // Show help if no goal provided
        campaign.help();
        return;
      }
      try {
        await executeCampaignRun(goal, opts, opts.resume === true);
      } catch (error) {
        console.error(pc.red(`Error: ${(error as Error).message}`));
        process.exit(1);
      }
    });

  // Alias for backward compatibility
  program
    .command('hierarchy')
    .alias('campaign-long-running')
    .description('Alias for campaign command')
    .argument('<goal>', 'The campaign goal')
    .action(async (goal: string, opts) => {
      try {
        await executeCampaignRun(goal, opts, false);
      } catch (error) {
        console.error(pc.red(`Error: ${(error as Error).message}`));
        process.exit(1);
      }
    });
}

async function executeCampaignRun(
  goal: string,
  opts: Record<string, unknown>,
  resume: boolean
): Promise<void> {
  console.log(pc.bold('\n🚀 Campaign Mode - Hierarchical Long-Running Agents\n'));
  console.log(pc.dim(`Goal: ${goal.slice(0, 100)}${goal.length > 100 ? '...' : ''}\n`));

  const options: CampaignOptions = {
    goal,
    stateDir: opts.state as string | undefined,
    planner: opts.planner as string | undefined,
    subPlanner: opts.subPlanner as string | undefined,
    workers: opts.worker ? (opts.worker as string).split(',') : undefined,
    maxWorkers: opts.maxWorkers ? parseInt(opts.maxWorkers as string, 10) : undefined,
    checkpointEvery: opts.checkpointEvery ? parseInt(opts.checkpointEvery as string, 10) : undefined,
    freshStartEvery: opts.freshStartEvery ? parseInt(opts.freshStartEvery as string, 10) : undefined,
    autonomy: (opts.autonomy as 'checkpoint' | 'auto') || 'checkpoint',
    gitMode: (opts.gitMode as 'task-branch' | 'campaign-branch' | 'patches') || 'task-branch',
    mergeStrategy: (opts.mergeStrategy as 'merge' | 'rebase' | 'squash') || 'merge',
    useDroid: opts.useDroid !== false,
    dryRun: opts.dryRun === true
  };

  // Show configuration
  console.log(pc.dim('Configuration:'));
  console.log(pc.dim(`  Planner: ${options.planner || CAMPAIGN_DEFAULTS.planner}`));
  console.log(pc.dim(`  Workers: ${options.workers?.join(', ') || CAMPAIGN_DEFAULTS.workers.join(',')}`));
  console.log(pc.dim(`  Autonomy: ${options.autonomy}`));
  console.log(pc.dim(`  Git Mode: ${options.gitMode}`));
  console.log(pc.dim(`  Checkpoint every: ${options.checkpointEvery || CAMPAIGN_DEFAULTS.checkpointEvery} tasks`));
  if (options.dryRun) {
    console.log(pc.yellow('\n🔍 Dry run mode - showing plan only\n'));
  }
  console.log();

  let result: CampaignResult;

  if (resume) {
    console.log(pc.cyan('Resuming existing campaign...\n'));
    result = await resumeCampaign(process.cwd(), options);
  } else {
    // Check for existing campaign
    const existing = await loadCampaign(process.cwd(), options.stateDir);
    if (existing && existing.status === 'running') {
      console.log(pc.yellow('Found active campaign. Use --resume to continue or delete .campaign/campaign.json to start fresh.\n'));
      console.log(pc.dim(`Campaign ID: ${existing.campaignId}`));
      console.log(pc.dim(`Status: ${existing.status}`));
      console.log(pc.dim(`Tasks: ${existing.tasks.length}`));
      return;
    }

    result = await runCampaign(options);
  }

  // Display results
  displayResults(result);
}

async function executeCampaignResume(opts: Record<string, unknown>): Promise<void> {
  const cwd = process.cwd();
  const stateDir = (opts.state as string) || getDefaultStateDir(cwd);

  console.log(pc.bold('\n🔄 Resuming Campaign\n'));

  const state = await loadCampaignState(stateDir);
  if (!state) {
    console.log(pc.yellow('No campaign found in this directory.'));
    return;
  }

  console.log(pc.dim(`Campaign ID: ${state.campaignId}`));
  console.log(pc.dim(`Status: ${state.status}`));
  console.log(pc.dim(`Tasks: ${state.tasks.length}`));
  console.log();

  const result = await resumeCampaign(cwd, {
    goal: state.goal,
    stateDir
  });

  displayResults(result);
}

async function showCampaignStatus(opts: Record<string, unknown>): Promise<void> {
  const cwd = process.cwd();
  const stateDir = (opts.state as string) || getDefaultStateDir(cwd);

  const state = await loadCampaignState(stateDir);
  if (!state) {
    console.log(pc.yellow('No campaign found in this directory.'));
    return;
  }

  console.log(pc.bold('\n📊 Campaign Status\n'));
  console.log(`${pc.bold('Campaign ID:')} ${state.campaignId}`);
  console.log(`${pc.bold('Goal:')} ${state.goal.slice(0, 80)}${state.goal.length > 80 ? '...' : ''}`);
  console.log(`${pc.bold('Status:')} ${getStatusColor(state.status)(state.status)}`);
  console.log(`${pc.bold('Version:')} ${state.version}`);
  console.log();

  // Task breakdown
  const byStatus = {
    pending: state.tasks.filter(t => t.status === 'pending').length,
    in_progress: state.tasks.filter(t => t.status === 'in_progress').length,
    completed: state.tasks.filter(t => t.status === 'completed').length,
    failed: state.tasks.filter(t => t.status === 'failed').length,
    blocked: state.tasks.filter(t => t.status === 'blocked').length
  };

  console.log(pc.bold('Tasks:'));
  console.log(`  ${pc.green('✓')} Completed: ${byStatus.completed}`);
  console.log(`  ${pc.yellow('●')} In Progress: ${byStatus.in_progress}`);
  console.log(`  ${pc.dim('○')} Pending: ${byStatus.pending}`);
  console.log(`  ${pc.red('✗')} Failed: ${byStatus.failed}`);
  console.log(`  ${pc.magenta('⊘')} Blocked: ${byStatus.blocked}`);
  console.log();

  const progress = state.tasks.length > 0
    ? Math.round((byStatus.completed / state.tasks.length) * 100)
    : 0;
  console.log(`${pc.bold('Progress:')} ${progress}%`);
  console.log(progressBar(progress));
  console.log();

  if (opts.verbose) {
    console.log(pc.bold('Task Details:\n'));
    for (const task of state.tasks) {
      const statusIcon = getTaskStatusIcon(task.status);
      console.log(`  ${statusIcon} ${pc.bold(task.id)}: ${task.title}`);
      const desc = task.description || '';
      console.log(`     ${pc.dim(desc.slice(0, 60))}${desc.length > 60 ? '...' : ''}`);
      if (task.attempts > 0) {
        console.log(`     ${pc.dim(`Attempts: ${task.attempts}`)}`);
      }
    }
  }

  // Show recent checkpoints
  console.log(pc.bold('Checkpoints:'), state.checkpoints.length);
  console.log(pc.bold('Decisions:'), state.decisions.length);
  console.log(pc.bold('Artifacts:'), state.artifacts.length);
}

async function listCampaignCheckpoints(opts: Record<string, unknown>): Promise<void> {
  const cwd = process.cwd();
  const stateDir = (opts.state as string) || getDefaultStateDir(cwd);

  const state = await loadCampaignState(stateDir);
  if (!state) {
    console.log(pc.yellow('No campaign found in this directory.'));
    return;
  }

  console.log(pc.bold('\n📋 Campaign Checkpoints\n'));

  const checkpointDir = `${stateDir}/checkpoints`;
  const checkpoints = await listCheckpoints(checkpointDir);

  if (checkpoints.length === 0) {
    console.log(pc.dim('No checkpoints found.'));
    return;
  }

  for (const cp of checkpoints) {
    const date = new Date(cp.created_at);
    console.log(`  ${pc.cyan(cp.id)}`);
    console.log(`    Created: ${date.toLocaleString()}`);
    console.log(`    Summary: ${cp.summary}`);
    console.log();
  }
}

async function createManualCheckpoint(opts: Record<string, unknown>): Promise<void> {
  const cwd = process.cwd();
  const stateDir = (opts.state as string) || getDefaultStateDir(cwd);
  const reason = (opts.reason as string) || 'manual';

  const state = await loadCampaignState(stateDir);
  if (!state) {
    console.log(pc.yellow('No campaign found in this directory.'));
    return;
  }

  console.log(pc.bold('\n💾 Creating Checkpoint\n'));
  console.log(pc.dim(`Campaign: ${state.campaignId}`));
  console.log(pc.dim(`Reason: ${reason}`));

  const checkpointPath = await quickSaveCheckpoint(state, stateDir, reason);

  console.log(pc.green(`\n✓ Checkpoint created: ${checkpointPath}`));
}

async function checkCampaignDrift(opts: Record<string, unknown>): Promise<void> {
  const cwd = process.cwd();
  const stateDir = (opts.state as string) || getDefaultStateDir(cwd);
  const threshold = (opts.threshold as DriftSeverity) || 'moderate';

  const state = await loadCampaignState(stateDir);
  if (!state) {
    console.log(pc.yellow('No campaign found in this directory.'));
    return;
  }

  console.log(pc.bold('\n🔍 Checking for Drift\n'));
  console.log(pc.dim(`Campaign: ${state.campaignId}`));
  console.log(pc.dim(`Threshold: ${threshold}`));
  console.log();

  const result = await checkForDrift(state, cwd, { criteriaOnly: true });

  console.log(`${pc.bold('Drifted:')} ${result.drifted ? pc.red('Yes') : pc.green('No')}`);
  console.log(`${pc.bold('Severity:')} ${getSeverityColor(result.severity)(result.severity)}`);
  console.log(`${pc.bold('Confidence:')} ${Math.round(result.confidence * 100)}%`);
  console.log();

  if (result.drift_areas.length > 0) {
    console.log(pc.bold('Drift Areas:'));
    for (const area of result.drift_areas) {
      const severityIcon = area.severity === 'severe' ? '🔴' :
        area.severity === 'moderate' ? '🟡' : '🟢';
      console.log(`  ${severityIcon} ${pc.bold(area.domain)}: ${area.description}`);
      for (const taskId of area.contributing_tasks) {
        console.log(`     - ${taskId}`);
      }
    }
    console.log();
  }

  if (exceedsThreshold(result.severity, threshold)) {
    console.log(pc.yellow(`⚠ Drift exceeds threshold (${threshold}). Consider corrective action.`));
  } else {
    console.log(pc.green('✓ Drift within acceptable limits.'));
  }
}

function displayResults(result: CampaignResult): void {
  console.log();
  console.log(pc.bold('─── Campaign Results ───\n'));

  if (result.error) {
    console.log(pc.red(`Error: ${result.error}`));
    return;
  }

  console.log(`${pc.bold('Status:')} ${getStatusColor(result.status)(result.status)}`);
  console.log(`${pc.bold('Tasks:')} ${result.tasksCompleted}/${result.tasksTotal} completed`);
  console.log(`${pc.bold('Duration:')} ${(result.duration / 1000).toFixed(1)}s`);
  console.log(`${pc.bold('Checkpoints:')} ${result.checkpoints}`);
  console.log(`${pc.bold('Decisions:')} ${result.decisions}`);

  if (result.recoverySummary) {
    console.log();
    console.log(pc.bold('Recovery Summary:'));
    console.log(pc.dim(result.recoverySummary));
  }

  if (result.finalSummary) {
    console.log();
    console.log(pc.bold('Summary:'));
    console.log(pc.dim(result.finalSummary));
  }
}

function getStatusColor(status: string): (str: string) => string {
  switch (status) {
    case 'completed':
      return pc.green;
    case 'failed':
      return pc.red;
    case 'running':
      return pc.yellow;
    case 'paused':
      return pc.cyan;
    default:
      return pc.dim;
  }
}

function getSeverityColor(severity: DriftSeverity): (str: string) => string {
  switch (severity) {
    case 'severe':
      return pc.red;
    case 'moderate':
      return pc.yellow;
    case 'minor':
      return pc.green;
    default:
      return pc.dim;
  }
}

function getTaskStatusIcon(status: string): string {
  switch (status) {
    case 'completed':
      return pc.green('✓');
    case 'in_progress':
      return pc.yellow('●');
    case 'failed':
      return pc.red('✗');
    case 'blocked':
      return pc.magenta('⊘');
    default:
      return pc.dim('○');
  }
}

function progressBar(percent: number, width: number = 20): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const bar = pc.green('█'.repeat(filled)) + pc.dim('░'.repeat(empty));
  return `[${bar}] ${percent}%`;
}
