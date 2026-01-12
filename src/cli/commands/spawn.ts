/**
 * Spawn Command
 *
 * Spawn custom agents from .claude/agents/ directory.
 * Supports spawning multiple agents in parallel.
 */

import { spawn as spawnProcess, type ChildProcess } from 'child_process';
import pc from 'picocolors';
import { discoverAgents, getAgent, formatAgentList } from '../../lib/agent-discovery';
import { getConfig } from '../../lib/config';

interface SpawnCommandOptions {
  parallel?: boolean;
  list?: boolean;
  model?: string;
}

export async function spawnCommand(
  agentNames: string[],
  options: SpawnCommandOptions
): Promise<void> {
  // List agents if requested or no agents specified
  if (options.list || agentNames.length === 0) {
    const agents = await discoverAgents();
    console.log('\n' + formatAgentList(agents));

    if (agents.length > 0) {
      console.log('');
      console.log(pc.dim('Usage:'));
      console.log(pc.dim('  pk-puzldai spawn <agent-name>              # Spawn single agent'));
      console.log(pc.dim('  pk-puzldai spawn <a1> <a2> --parallel      # Spawn multiple in parallel'));
      console.log(pc.dim('  pk-puzldai spawn --list                    # List available agents'));
    }
    console.log('');
    return;
  }

  const config = getConfig();
  const claudePath = config.adapters.claude?.path || 'claude';

  // Validate all agents exist
  const validAgents: Array<{ name: string; agent: NonNullable<Awaited<ReturnType<typeof getAgent>>> }> = [];
  for (const name of agentNames) {
    const agent = await getAgent(name);
    if (!agent) {
      console.error(pc.red(`Agent not found: ${name}`));
      const available = await discoverAgents();
      if (available.length > 0) {
        console.log(pc.dim('Available: ' + available.map(a => a.name).join(', ')));
      }
      process.exit(1);
    }
    validAgents.push({ name, agent });
  }

  // Single agent or sequential
  if (validAgents.length === 1 || !options.parallel) {
    for (const { name, agent } of validAgents) {
      console.log(pc.cyan(`\nSpawning agent: ${name}`));
      console.log(pc.dim(agent.description));
      console.log(pc.dim('─'.repeat(50)));
      console.log('');

      const args = ['--agent', name];
      const model = options.model || agent.model;
      if (model) {
        args.push('--model', model);
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
            reject(new Error(`Agent ${name} exited with code ${code}`));
          }
        });
        proc.on('error', reject);
      });
    }
    return;
  }

  // Multiple agents in parallel
  console.log(pc.cyan(`\nSpawning ${validAgents.length} agents in parallel:`));
  for (const { name, agent } of validAgents) {
    console.log(pc.dim(`  - ${name}: ${agent.description}`));
  }
  console.log(pc.dim('─'.repeat(50)));
  console.log('');

  const processes: Array<{ name: string; proc: ChildProcess }> = [];

  for (const { name, agent } of validAgents) {
    const args = ['--agent', name];
    const model = options.model || agent.model;
    if (model) {
      args.push('--model', model);
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
          console.log(pc.cyan(`[${name}]`), line);
        }
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          console.log(pc.yellow(`[${name}]`), line);
        }
      }
    });

    processes.push({ name, proc });
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
  console.log(pc.bold('=== Results ==='));

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
    process.exit(1);
  }
}
