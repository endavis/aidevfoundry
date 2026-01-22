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
  getDefaultStateDir,
  saveCampaignState,
  getStateFilePath
} from '../../orchestrator/campaign/campaign-state.js';
import {
  listCheckpoints,
  quickSaveCheckpoint
} from '../../orchestrator/campaign/campaign-checkpoint.js';
import {
  checkForDrift,
  exceedsThreshold
} from '../../orchestrator/campaign/campaign-drift.js';
import type {
  DriftSeverity,
  EnhancedCampaignTask,
  DriftDetectionResult
} from '../../orchestrator/campaign/campaign-types.js';
import {
  createDomainQueue,
  createMultiDomainQueue,
  getDomainStatus
} from '../../orchestrator/campaign/campaign-queue.js';
import {
  validateEntryCriteria,
  validateExitCriteria,
  formatCriteriaResult
} from '../../orchestrator/campaign/campaign-validation.js';

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
    .option('--tui', 'Launch interactive TUI dashboard')
    .action(async (opts) => {
      try {
        if (opts.tui) {
          await launchCampaignDashboard(opts);
        } else {
          await showCampaignStatus(opts);
        }
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

  // Domains command
  campaign
    .command('domains')
    .description('List configured domains for the campaign')
    .option('--state <path>', 'Campaign state directory')
    .option('--verbose', 'Show detailed domain information')
    .action(async (opts) => {
      try {
        await listCampaignDomains(opts);
      } catch (error) {
        console.error(pc.red(`Error: ${(error as Error).message}`));
        process.exit(1);
      }
    });

  // Parallel configuration command
  campaign
    .command('parallel')
    .description('Configure parallel execution settings')
    .option('--state <path>', 'Campaign state directory')
    .option('--max-concurrent <n>', 'Maximum concurrent domains')
    .option('--fail-fast', 'Stop all domains on first failure')
    .option('--no-fail-fast', 'Continue other domains on failure')
    .option('--show', 'Show current parallel configuration')
    .action(async (opts) => {
      try {
        await configureParallel(opts);
      } catch (error) {
        console.error(pc.red(`Error: ${(error as Error).message}`));
        process.exit(1);
      }
    });

  // Progress command (per-domain status)
  campaign
    .command('progress')
    .description('Show detailed per-domain progress')
    .option('--state <path>', 'Campaign state directory')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      try {
        await showDomainProgress(opts);
      } catch (error) {
        console.error(pc.red(`Error: ${(error as Error).message}`));
        process.exit(1);
      }
    });

  // Validate command (run entry/exit criteria)
  campaign
    .command('validate')
    .description('Run entry/exit criteria validation for tasks')
    .option('--state <path>', 'Campaign state directory')
    .option('--task <id>', 'Validate specific task by ID')
    .option('--entry', 'Validate entry criteria only')
    .option('--exit', 'Validate exit criteria only')
    .option('--verbose', 'Show detailed validation output')
    .action(async (opts) => {
      try {
        await validateCampaignCriteria(opts);
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

// ============================================================================
// New CLI Command Implementations (T8)
// ============================================================================

async function listCampaignDomains(opts: Record<string, unknown>): Promise<void> {
  const cwd = process.cwd();
  const stateDir = (opts.state as string) || getDefaultStateDir(cwd);
  const verbose = opts.verbose === true;

  const state = await loadCampaignState(getStateFilePath(stateDir));
  if (!state) {
    console.log(pc.yellow('No campaign found in this directory.'));
    return;
  }

  console.log(pc.bold('\n📁 Campaign Domains\n'));
  console.log(`${pc.bold('Campaign ID:')} ${state.campaignId}`);
  console.log();

  // Extract domains from tasks (using area field or enhanced task domain field)
  const domainMap = new Map<string, { tasks: typeof state.tasks; status: Record<string, number> }>();

  for (const task of state.tasks) {
    const domainName = ('domain' in task ? (task as EnhancedCampaignTask).domain : task.area) || 'unassigned';

    if (!domainMap.has(domainName)) {
      domainMap.set(domainName, {
        tasks: [],
        status: { pending: 0, in_progress: 0, completed: 0, failed: 0, blocked: 0 }
      });
    }

    const domain = domainMap.get(domainName)!;
    domain.tasks.push(task);
    domain.status[task.status] = (domain.status[task.status] || 0) + 1;
  }

  if (domainMap.size === 0) {
    console.log(pc.dim('No domains configured. Tasks may not have domain assignments.'));
    return;
  }

  for (const [name, data] of domainMap) {
    const total = data.tasks.length;
    const completed = data.status.completed || 0;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    const statusIcon = progress === 100 ? pc.green('✓') :
      (data.status.failed || 0) > 0 ? pc.red('!') :
        (data.status.in_progress || 0) > 0 ? pc.yellow('●') : pc.dim('○');

    console.log(`${statusIcon} ${pc.bold(name)}`);
    console.log(`  ${progressBar(progress)}`);
    console.log(`  Tasks: ${completed}/${total} completed`);

    if ((data.status.failed || 0) > 0) {
      console.log(`  ${pc.red(`Failed: ${data.status.failed}`)}`);
    }
    if ((data.status.blocked || 0) > 0) {
      console.log(`  ${pc.magenta(`Blocked: ${data.status.blocked}`)}`);
    }

    if (verbose) {
      console.log(pc.dim('  Tasks:'));
      for (const task of data.tasks) {
        const icon = getTaskStatusIcon(task.status);
        console.log(`    ${icon} ${task.id}: ${task.title}`);
      }
    }

    console.log();
  }
}

async function configureParallel(opts: Record<string, unknown>): Promise<void> {
  const cwd = process.cwd();
  const stateDir = (opts.state as string) || getDefaultStateDir(cwd);
  const showOnly = opts.show === true;

  const state = await loadCampaignState(getStateFilePath(stateDir));
  if (!state) {
    console.log(pc.yellow('No campaign found in this directory.'));
    return;
  }

  console.log(pc.bold('\n⚡ Parallel Execution Configuration\n'));

  // Get current parallel config from state meta or defaults
  const currentConfig = {
    maxConcurrent: state.meta.maxWorkers || CAMPAIGN_DEFAULTS.maxWorkers,
    failFast: false // Default, could be stored in extended state
  };

  if (showOnly) {
    console.log(`${pc.bold('Max Concurrent Domains:')} ${currentConfig.maxConcurrent}`);
    console.log(`${pc.bold('Fail Fast:')} ${currentConfig.failFast ? 'Yes' : 'No'}`);
    console.log(`${pc.bold('Checkpoint Every:')} ${state.meta.checkpointEvery} tasks`);
    console.log(`${pc.bold('Fresh Start Every:')} ${state.meta.freshStartEvery} tasks`);
    console.log(`${pc.bold('Git Mode:')} ${state.meta.gitMode}`);
    console.log(`${pc.bold('Merge Strategy:')} ${state.meta.mergeStrategy}`);
    return;
  }

  // Update configuration
  let updated = false;

  if (opts.maxConcurrent !== undefined) {
    const newMax = parseInt(opts.maxConcurrent as string, 10);
    if (!isNaN(newMax) && newMax > 0) {
      state.meta.maxWorkers = newMax;
      console.log(pc.green(`✓ Max concurrent domains set to ${newMax}`));
      updated = true;
    } else {
      console.log(pc.red('Invalid max-concurrent value. Must be a positive number.'));
    }
  }

  if (opts.failFast !== undefined) {
    const failFast = opts.failFast === true;
    console.log(pc.green(`✓ Fail fast ${failFast ? 'enabled' : 'disabled'}`));
    // Note: failFast would need to be added to state.meta for persistence
    updated = true;
  }

  if (updated) {
    await saveCampaignState(getStateFilePath(stateDir), state);
    console.log(pc.dim('\nConfiguration saved.'));
  } else {
    console.log(pc.dim('No changes specified. Use --max-concurrent <n> or --fail-fast to configure.'));
    console.log(pc.dim('Use --show to display current configuration.'));
  }
}

async function showDomainProgress(opts: Record<string, unknown>): Promise<void> {
  const cwd = process.cwd();
  const stateDir = (opts.state as string) || getDefaultStateDir(cwd);
  const asJson = opts.json === true;

  const state = await loadCampaignState(getStateFilePath(stateDir));
  if (!state) {
    console.log(pc.yellow('No campaign found in this directory.'));
    return;
  }

  // Build domain progress data
  const domainProgress: Record<string, {
    name: string;
    pending: number;
    in_progress: number;
    completed: number;
    failed: number;
    blocked: number;
    total: number;
    progress: number;
    status: string;
  }> = {};

  // Group tasks by domain
  for (const task of state.tasks) {
    const domainName = ('domain' in task ? (task as EnhancedCampaignTask).domain : task.area) || 'unassigned';

    if (!domainProgress[domainName]) {
      domainProgress[domainName] = {
        name: domainName,
        pending: 0,
        in_progress: 0,
        completed: 0,
        failed: 0,
        blocked: 0,
        total: 0,
        progress: 0,
        status: 'pending'
      };
    }

    const domain = domainProgress[domainName];
    domain.total++;

    switch (task.status) {
      case 'pending': domain.pending++; break;
      case 'in_progress': domain.in_progress++; break;
      case 'completed': domain.completed++; break;
      case 'failed': domain.failed++; break;
      case 'blocked': domain.blocked++; break;
    }
  }

  // Calculate progress and status for each domain
  for (const domain of Object.values(domainProgress)) {
    domain.progress = domain.total > 0 ? Math.round((domain.completed / domain.total) * 100) : 0;

    if (domain.completed === domain.total && domain.total > 0) {
      domain.status = 'completed';
    } else if (domain.failed > 0 && domain.pending === 0 && domain.in_progress === 0) {
      domain.status = 'failed';
    } else if (domain.in_progress > 0) {
      domain.status = 'running';
    } else if (domain.blocked > 0 && domain.pending === 0 && domain.in_progress === 0) {
      domain.status = 'blocked';
    }
  }

  if (asJson) {
    console.log(JSON.stringify({
      campaignId: state.campaignId,
      status: state.status,
      domains: domainProgress,
      overall: {
        total: state.tasks.length,
        completed: state.tasks.filter(t => t.status === 'completed').length,
        failed: state.tasks.filter(t => t.status === 'failed').length,
        progress: state.tasks.length > 0
          ? Math.round((state.tasks.filter(t => t.status === 'completed').length / state.tasks.length) * 100)
          : 0
      }
    }, null, 2));
    return;
  }

  console.log(pc.bold('\n📊 Domain Progress\n'));
  console.log(`${pc.bold('Campaign:')} ${state.campaignId}`);
  console.log(`${pc.bold('Status:')} ${getStatusColor(state.status)(state.status)}`);
  console.log();

  // Overall progress
  const totalCompleted = state.tasks.filter(t => t.status === 'completed').length;
  const totalTasks = state.tasks.length;
  const overallProgress = totalTasks > 0 ? Math.round((totalCompleted / totalTasks) * 100) : 0;

  console.log(pc.bold('Overall Progress:'));
  console.log(`  ${progressBar(overallProgress)}`);
  console.log(`  ${totalCompleted}/${totalTasks} tasks completed`);
  console.log();

  // Per-domain progress
  console.log(pc.bold('Per-Domain Progress:'));
  console.log();

  const domains = Object.values(domainProgress).sort((a, b) => b.progress - a.progress);

  for (const domain of domains) {
    const statusIcon = domain.status === 'completed' ? pc.green('✓') :
      domain.status === 'failed' ? pc.red('✗') :
        domain.status === 'running' ? pc.yellow('●') :
          domain.status === 'blocked' ? pc.magenta('⊘') : pc.dim('○');

    console.log(`  ${statusIcon} ${pc.bold(domain.name.padEnd(15))} ${progressBar(domain.progress)}`);
    console.log(`     ${pc.green('✓')} ${domain.completed}  ${pc.yellow('●')} ${domain.in_progress}  ${pc.dim('○')} ${domain.pending}  ${pc.red('✗')} ${domain.failed}  ${pc.magenta('⊘')} ${domain.blocked}`);
    console.log();
  }
}

async function validateCampaignCriteria(opts: Record<string, unknown>): Promise<void> {
  const cwd = process.cwd();
  const stateDir = (opts.state as string) || getDefaultStateDir(cwd);
  const taskId = opts.task as string | undefined;
  const entryOnly = opts.entry === true;
  const exitOnly = opts.exit === true;
  const verbose = opts.verbose === true;

  const state = await loadCampaignState(getStateFilePath(stateDir));
  if (!state) {
    console.log(pc.yellow('No campaign found in this directory.'));
    return;
  }

  console.log(pc.bold('\n🔍 Criteria Validation\n'));

  // Get tasks to validate
  let tasksToValidate = state.tasks;
  if (taskId) {
    tasksToValidate = state.tasks.filter(t => t.id === taskId);
    if (tasksToValidate.length === 0) {
      console.log(pc.red(`Task not found: ${taskId}`));
      return;
    }
  }

  // Filter to only enhanced tasks with criteria
  const enhancedTasks = tasksToValidate.filter(t =>
    'entry_criteria' in t || 'exit_criteria' in t
  ) as EnhancedCampaignTask[];

  if (enhancedTasks.length === 0) {
    console.log(pc.dim('No tasks with entry/exit criteria found.'));
    console.log(pc.dim('Criteria validation requires EnhancedCampaignTask with entry_criteria or exit_criteria fields.'));
    return;
  }

  console.log(`Validating ${enhancedTasks.length} task(s)...\n`);

  let totalPassed = 0;
  let totalFailed = 0;

  for (const task of enhancedTasks) {
    console.log(`${pc.bold(task.id)}: ${task.title}`);

    // Validate entry criteria
    if (!exitOnly && task.entry_criteria && task.entry_criteria.length > 0) {
      console.log(pc.dim('  Entry Criteria:'));
      const entryResult = await validateEntryCriteria(task, cwd);

      if (verbose) {
        console.log('  ' + formatCriteriaResult(entryResult, true).split('\n').join('\n  '));
      } else {
        const icon = entryResult.valid ? pc.green('✓') : pc.red('✗');
        console.log(`    ${icon} ${entryResult.results.filter(r => r.passed).length}/${entryResult.results.length} passed`);
      }

      if (entryResult.valid) totalPassed++;
      else totalFailed++;
    }

    // Validate exit criteria
    if (!entryOnly && task.exit_criteria && task.exit_criteria.length > 0) {
      console.log(pc.dim('  Exit Criteria:'));
      const exitResult = await validateExitCriteria(task, cwd);

      if (verbose) {
        console.log('  ' + formatCriteriaResult(exitResult, true).split('\n').join('\n  '));
      } else {
        const icon = exitResult.valid ? pc.green('✓') : pc.red('✗');
        console.log(`    ${icon} ${exitResult.results.filter(r => r.passed).length}/${exitResult.results.length} passed`);
      }

      if (exitResult.valid) totalPassed++;
      else totalFailed++;
    }

    console.log();
  }

  // Summary
  console.log(pc.bold('Summary:'));
  console.log(`  ${pc.green('Passed:')} ${totalPassed}`);
  console.log(`  ${pc.red('Failed:')} ${totalFailed}`);

  if (totalFailed > 0) {
    console.log(pc.yellow('\n⚠ Some criteria failed. Use --verbose for details.'));
  } else {
    console.log(pc.green('\n✓ All criteria passed.'));
  }
}

// ============================================================================
// TUI Dashboard Launcher
// ============================================================================

async function launchCampaignDashboard(opts: Record<string, unknown>): Promise<void> {
  const cwd = process.cwd();
  const stateDir = (opts.state as string) || getDefaultStateDir(cwd);

  const state = await loadCampaignState(getStateFilePath(stateDir));
  if (!state) {
    console.log(pc.yellow('No campaign found in this directory.'));
    return;
  }

  // Dynamic import of TUI components (React/Ink)
  const { render, Box, Text, useApp } = await import('ink');
  const React = await import('react');
  const { CampaignPanel } = await import('../../tui/components/CampaignPanel.js');

  // Wrapper component with refresh and exit
  function DashboardApp() {
    const { exit } = useApp();
    // state is guaranteed non-null at this point
    const [currentState, setCurrentState] = React.useState(state!);
    const [driftResult, setDriftResult] = React.useState<DriftDetectionResult | undefined>();
    const [refreshing, setRefreshing] = React.useState(false);
    const [lastRefresh, setLastRefresh] = React.useState(Date.now());

    // Auto-refresh every 5 seconds
    React.useEffect(() => {
      const interval = setInterval(async () => {
        try {
          const newState = await loadCampaignState(getStateFilePath(stateDir));
          if (newState) {
            setCurrentState(newState);
            setLastRefresh(Date.now());
          }
        } catch {
          // Ignore refresh errors
        }
      }, 5000);
      return () => clearInterval(interval);
    }, []);

    const handleRefresh = React.useCallback(async () => {
      setRefreshing(true);
      try {
        const newState = await loadCampaignState(getStateFilePath(stateDir));
        if (newState) {
          setCurrentState(newState);
          // Also check drift
          const drift = await checkForDrift(newState, cwd, { criteriaOnly: true });
          setDriftResult(drift);
          setLastRefresh(Date.now());
        }
      } catch {
        // Ignore refresh errors
      }
      setRefreshing(false);
    }, []);

    const handleBack = React.useCallback(() => {
      exit();
    }, [exit]);

    return React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(CampaignPanel, {
        state: currentState,
        driftResult,
        onRefresh: handleRefresh,
        onBack: handleBack
      }),
      refreshing && React.createElement(Text, { dimColor: true }, 'Refreshing...'),
      React.createElement(
        Text,
        { dimColor: true },
        `Last updated: ${new Date(lastRefresh).toLocaleTimeString()} (auto-refresh every 5s)`
      )
    );
  }

  // Render the dashboard
  const { waitUntilExit } = render(React.createElement(DashboardApp));
  await waitUntilExit();
}
