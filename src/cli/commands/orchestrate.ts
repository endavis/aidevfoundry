import pc from 'picocolors';
import { orchestrate } from '../../orchestrator/intelligent-orchestrator';
import { buildSingleAgentPlan, execute, formatPlanForDisplay } from '../../executor';
import { getConfig } from '../../lib/config';
import { resolveOrchestrationConfig } from '../../orchestrator/profiles';
import { selectPlanForProfile } from '../../orchestrator/profile-orchestrator';

interface OrchestrateCommandOptions {
  agent?: string;
  mode?: 'delegate' | 'coordinate' | 'supervise';
  agents?: string;
  interactive?: boolean;
  profile?: string;
  dryRun?: boolean;
  noCompress?: boolean;
}

export async function orchestrateCommand(
  task: string,
  options: OrchestrateCommandOptions
): Promise<void> {
  if (!task || task.trim() === '') {
    console.error(pc.red('Error: No task provided'));
    console.log(pc.dim('Usage: pk-puzldai orchestrate "complex task" --mode delegate'));
    process.exit(1);
  }

  const startTime = Date.now();

  console.log(pc.bold('\n🤖 Intelligent Orchestration'));
  if (options.profile || options.dryRun) {
    console.log(pc.dim('Mode: profile'));
  } else {
    console.log(pc.dim(`Mode: ${options.mode || 'delegate'}`));
  }

  if (options.agents) {
    console.log(pc.dim(`Agents: ${options.agents}`));
  }

  console.log(pc.dim(`Task: ${task.slice(0, 80)}${task.length > 80 ? '...' : ''}\n`));

  try {
    if (options.profile || options.dryRun) {
      const config = getConfig();
      const orchestration = resolveOrchestrationConfig(config.orchestration);
      const profileName = options.profile || orchestration.defaultProfile;
      const profile = orchestration.profiles[profileName];

      if (!profile) {
        console.error(pc.red('Profile not found: ' + profileName));
        process.exit(1);
      }

      const selection = await selectPlanForProfile(task, profile);
      const orchestrationContext = {
        useContextCompression: profile.useContextCompression,
        noCompress: options.noCompress
      };

      console.log(pc.dim(`Profile: ${profile.name}`));
      console.log(pc.dim(`Mode: ${selection.mode}`));
      console.log(pc.dim(`Rationale: ${selection.rationale}`));
      if (selection.agents.length > 0) {
        console.log(pc.dim(`Agents: ${selection.agents.join(', ')}`));
      }
      console.log();

      if (options.dryRun) {
        const previewPlan = selection.plan || buildSingleAgentPlan(task, selection.primaryAgent);
        previewPlan.context = {
          ...previewPlan.context,
          orchestration: orchestrationContext
        };
        console.log(formatPlanForDisplay(previewPlan));
        return;
      }

      if (selection.mode === 'supervise') {
        const result = await orchestrate(task, {
          mode: 'supervise',
          agents: selection.agents
        });
        console.log(pc.bold('\n--- Result ---\n'));
        console.log(result.content);
        return;
      }

      if (selection.plan) {
        selection.plan.context = {
          ...selection.plan.context,
          orchestration: orchestrationContext
        };
        const result = await execute(selection.plan, {});
        console.log(pc.bold('\n--- Result ---\n'));
        console.log(result.finalOutput || '(no output)');
        return;
      }
    }

    const result = await orchestrate(task, {
      agent: options.agent,
      mode: options.mode as 'delegate' | 'coordinate' | 'supervise',
      agents: options.agents?.split(',').map(a => a.trim()),
      onAgentResponse: (agent, response) => {
        console.log(pc.dim(`\n  [${agent}] ${response.model} - ${response.duration}ms`));
        if (response.tokens) {
          console.log(pc.dim(`     Tokens: ${response.tokens.input} in / ${response.tokens.output} out`));
        }
      }
    });

    console.log(pc.bold('\n--- Result ---\n'));
    console.log(result.content);

    const duration = Date.now() - startTime;
    console.log(pc.dim(`\n---`));
    console.log(pc.dim(`Model: ${result.model} | Time: ${(duration / 1000).toFixed(1)}s`));
    if (result.tokens) {
      console.log(pc.dim(`Tokens: ${result.tokens.input} in / ${result.tokens.output} out`));
    }

  } catch (err) {
    console.error(pc.red(`\nOrchestration error: ${(err as Error).message}`));
    process.exit(1);
  }
}
