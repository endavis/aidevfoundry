/**
 * Continue Plan Command
 *
 * Execute temp-plan.txt with parallel PK-Poet agents.
 * This command reads the plan and spawns appropriate agents to complete it.
 */

import { spawn as spawnProcess, type ChildProcess } from 'child_process';
import { readFile, stat } from 'fs/promises';
import { join } from 'path';
import pc from 'picocolors';
import { discoverAgents, getAgent } from '../../lib/agent-discovery';
import { getConfig } from '../../lib/config';

interface ContinuePlanOptions {
  sequential?: boolean;
  agent?: string;
  dryRun?: boolean;
}

// Core agents that execute the plan
const CORE_AGENTS = [
  'ui-components-agent',
  'input-commands-agent',
  'rich-render-agent',
  'magic-attach-agent'
];

// Dependency order for sequential execution
const SEQUENTIAL_ORDER = [
  'rich-render-agent',      // No dependencies
  'magic-attach-agent',     // Uses rich-render
  'input-commands-agent',   // Independent
  'ui-components-agent'     // Integrates all
];

export async function continuePlanCommand(options: ContinuePlanOptions): Promise<void> {
  const planPath = join(process.cwd(), 'temp-plan.txt');

  // Check if plan exists
  try {
    await stat(planPath);
  } catch {
    console.error(pc.red('temp-plan.txt not found in current directory.'));
    console.log(pc.dim('Create a plan first or navigate to a directory with temp-plan.txt'));
    process.exit(1);
  }

  // Read and display plan summary
  const planContent = await readFile(planPath, 'utf-8');
  console.log(pc.cyan('\n=== Continue Plan Execution ==='));
  console.log(pc.dim('Source: temp-plan.txt'));
  console.log(pc.dim('─'.repeat(50)));

  // Extract steps from plan
  const stepMatches = planContent.match(/^\d+\)\s+\*\*(.+?)\*\*/gm) || [];
  if (stepMatches.length > 0) {
    console.log(pc.dim('\nPlan steps:'));
    for (const step of stepMatches.slice(0, 8)) {
      const title = step.replace(/^\d+\)\s+\*\*/, '').replace(/\*\*$/, '');
      console.log(pc.dim(`  • ${title}`));
    }
  }
  console.log('');

  // Validate agents exist
  const available = await discoverAgents();
  const availableNames = available.map(a => a.name);
  const missingAgents = CORE_AGENTS.filter(a => !availableNames.includes(a));

  if (missingAgents.length > 0) {
    console.error(pc.red(`Missing agents: ${missingAgents.join(', ')}`));
    console.log(pc.dim('Ensure .claude/agents/ contains the required agent files.'));
    process.exit(1);
  }

  // Dry run - just show what would happen
  if (options.dryRun) {
    console.log(pc.yellow('Dry run - no agents will be spawned.\n'));
    if (options.agent) {
      console.log(`Would spawn: ${options.agent}`);
    } else if (options.sequential) {
      console.log('Would spawn sequentially:');
      SEQUENTIAL_ORDER.forEach((a, i) => console.log(`  ${i + 1}. ${a}`));
    } else {
      console.log('Would spawn in parallel:');
      CORE_AGENTS.forEach(a => console.log(`  • ${a}`));
    }
    return;
  }

  const config = getConfig();
  const claudePath = config.adapters.claude?.path || 'claude';

  if (options.agent) {
    // Single agent mode
    if (!availableNames.includes(options.agent)) {
      console.error(pc.red(`Agent not found: ${options.agent}`));
      console.log(pc.dim('Available: ' + availableNames.join(', ')));
      process.exit(1);
    }
    console.log(pc.cyan(`Running single agent: ${options.agent}\n`));
    await spawnSingleAgent(claudePath, options.agent);
  } else if (options.sequential) {
    // Sequential execution
    console.log(pc.cyan('Running agents sequentially...\n'));
    for (const agentName of SEQUENTIAL_ORDER) {
      console.log(pc.dim(`\n>>> Starting ${agentName}...`));
      await spawnSingleAgent(claudePath, agentName);
      console.log(pc.green(`<<< ${agentName} completed\n`));
    }
  } else {
    // Parallel execution (default)
    console.log(pc.cyan(`Spawning ${CORE_AGENTS.length} agents in parallel...\n`));
    await spawnParallelAgents(claudePath, CORE_AGENTS);
  }

  console.log(pc.green('\n=== Plan Execution Complete ==='));
  console.log(pc.dim('Check temp-plan.txt for progress notes.'));
  console.log(pc.dim('Run verification steps to confirm implementation.\n'));
}

async function spawnSingleAgent(claudePath: string, agentName: string): Promise<void> {
  const agent = await getAgent(agentName);
  const args = ['--agent', agentName];
  if (agent?.model) {
    args.push('--model', agent.model);
  }

  const proc = spawnProcess(claudePath, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  await new Promise<void>((resolve, reject) => {
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Agent ${agentName} exited with code ${code}`));
      }
    });
    proc.on('error', reject);
  });
}

async function spawnParallelAgents(claudePath: string, agentNames: string[]): Promise<void> {
  const processes: Array<{ name: string; proc: ChildProcess }> = [];

  for (const agentName of agentNames) {
    const agent = await getAgent(agentName);
    const args = ['--agent', agentName];
    if (agent?.model) {
      args.push('--model', agent.model);
    }

    const proc = spawnProcess(claudePath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      detached: false,
    });

    // Prefix output with agent name
    proc.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          console.log(pc.cyan(`[${agentName}]`), line);
        }
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          console.log(pc.yellow(`[${agentName}]`), line);
        }
      }
    });

    processes.push({ name: agentName, proc });
  }

  // Wait for all to complete
  const results = await Promise.allSettled(
    processes.map(
      ({ name, proc }) =>
        new Promise<string>((resolve, reject) => {
          proc.on('close', (code) => {
            if (code === 0) {
              resolve(name);
            } else {
              reject(new Error(`${name} exited with code ${code}`));
            }
          });
          proc.on('error', reject);
        })
    )
  );

  console.log('');
  console.log(pc.bold('=== Agent Results ==='));

  let hasFailures = false;
  for (const result of results) {
    if (result.status === 'fulfilled') {
      console.log(pc.green(`  [${result.value}] completed successfully`));
    } else {
      hasFailures = true;
      console.log(pc.red(`  ${result.reason}`));
    }
  }

  if (hasFailures) {
    console.log(pc.yellow('\nSome agents failed. Check output above for details.'));
  }
}
