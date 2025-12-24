/**
 * pickbuild command - Compare→Pick→Build workflow
 *
 * This is Mode C from the discovery document:
 * 1. Multiple agents propose PLANs (not code)
 * 2. Human or LLM picks the best plan
 * 3. Build agent implements with agentic tools
 * 4. Optional reviewer validates
 */

import { buildPickBuildPlan, parseAgentsString } from '../../executor/plan-builders';
import { execute } from '../../executor/executor';
import type { AgentName, PickBuildOptions, ExecutorConfig, PlanStep, StepResult } from '../../executor/types';
import { adapters } from '../../adapters';
import { createSpinner } from 'nanospinner';
import pc from 'picocolors';
import { getProjectStructure } from '../../agentic/agent-loop';
import * as readline from 'readline';

interface PickBuildCommandOptions {
  agents?: string;
  picker?: string;
  buildAgent?: string;
  reviewer?: string;
  sequential?: boolean;
  interactive?: boolean;
  format?: string;
  noReview?: boolean;
}

/**
 * pickbuild CLI command handler
 */
export async function pickbuildCommand(
  task: string,
  options: PickBuildCommandOptions
): Promise<void> {
  const spinner = createSpinner('Initializing pickbuild workflow...').start();

  try {
    // Parse agents
    const agents = options.agents
      ? parseAgentsString(options.agents) as AgentName[]
      : ['claude', 'gemini'] as AgentName[];

    // Validate agents are available
    for (const agent of agents) {
      const adapter = adapters[agent];
      if (!adapter) {
        spinner.error({ text: `Unknown agent: ${agent}` });
        process.exit(1);
      }
      if (!(await adapter.isAvailable())) {
        spinner.warn({ text: `Agent ${agent} is not available, skipping...` });
        agents.splice(agents.indexOf(agent), 1);
      }
    }

    if (agents.length === 0) {
      spinner.error({ text: 'No available agents to propose plans' });
      process.exit(1);
    }

    // Parse build agent
    const buildAgent = (options.buildAgent || 'claude') as AgentName;
    const buildAdapter = adapters[buildAgent];
    if (!buildAdapter || !(await buildAdapter.isAvailable())) {
      spinner.error({ text: `Build agent ${buildAgent} is not available` });
      process.exit(1);
    }

    // Parse reviewer (optional)
    let reviewer: AgentName | undefined;
    if (options.reviewer && !options.noReview) {
      reviewer = options.reviewer as AgentName;
      const reviewAdapter = adapters[reviewer];
      if (!reviewAdapter || !(await reviewAdapter.isAvailable())) {
        spinner.warn({ text: `Reviewer ${reviewer} not available, skipping review step` });
        reviewer = undefined;
      }
    }

    // Get project structure for context
    const projectStructure = getProjectStructure(process.cwd());

    // Build plan options
    const pickBuildOptions: PickBuildOptions = {
      agents,
      picker: options.interactive ? 'human' : (options.picker as AgentName | 'human') || 'claude',
      buildAgent,
      reviewer,
      sequential: options.sequential,
      interactive: options.interactive,
      format: (options.format as 'json' | 'md') || 'json',
      skipReview: options.noReview || !reviewer,
      projectStructure
    };

    spinner.success({ text: 'Workflow initialized' });

    // Display configuration
    console.log('');
    console.log(pc.bold('=== Compare→Pick→Build Workflow ==='));
    console.log('');
    console.log(pc.dim('Task:'), task);
    console.log(pc.dim('Proposers:'), agents.join(', '));
    console.log(pc.dim('Picker:'), pickBuildOptions.picker);
    console.log(pc.dim('Build Agent:'), buildAgent);
    console.log(pc.dim('Reviewer:'), reviewer || 'none');
    console.log(pc.dim('Mode:'), pickBuildOptions.sequential ? 'sequential' : 'parallel');
    console.log('');

    // Build the execution plan
    const plan = buildPickBuildPlan(task, pickBuildOptions);

    // Configure executor with interactive callbacks
    const executorConfig: ExecutorConfig = {
      maxConcurrency: pickBuildOptions.sequential ? 1 : 3,
      defaultTimeout: 300000, // 5 minutes per step
      onEvent: (event) => {
        if (event.type === 'start') {
          const step = plan.steps.find(s => s.id === event.stepId);
          if (step) {
            console.log(pc.cyan(`\n▶ Starting step: ${step.id} (${step.agent})`));
          }
        } else if (event.type === 'complete') {
          console.log(pc.green(`✓ Step ${event.stepId} completed`));
        } else if (event.type === 'error') {
          console.log(pc.red(`✗ Step ${event.stepId} failed: ${event.message}`));
        }
      }
    };

    // Add interactive confirmation for plan pick if human picker
    if (options.interactive && pickBuildOptions.picker === 'human') {
      executorConfig.onBeforeStep = async (step: PlanStep, _index: number, previousResults: StepResult[]) => {
        // Intercept the pick step for human selection
        if (step.outputAs === 'picked_plan') {
          console.log('');
          console.log(pc.bold('=== Plan Selection ==='));
          console.log('');

          // Display each plan
          for (const agent of agents) {
            const planResult = previousResults.find(r =>
              plan.steps.find(s => s.id === r.stepId)?.outputAs === `plan_${agent}`
            );
            if (planResult?.content) {
              console.log(pc.bold(pc.blue(`--- ${agent.toUpperCase()}'s Plan ---`)));
              console.log(planResult.content.substring(0, 2000));
              if (planResult.content.length > 2000) {
                console.log(pc.dim('... (truncated)'));
              }
              console.log('');
            }
          }

          // Ask user to pick
          const choice = await promptUser(
            `Select a plan (${agents.join('/')}): `,
            agents
          );

          if (!choice) {
            console.log(pc.yellow('No plan selected, using LLM picker...'));
            return { proceed: true };
          }

          // Find the selected plan
          const selectedPlanResult = previousResults.find(r =>
            plan.steps.find(s => s.id === r.stepId)?.outputAs === `plan_${choice}`
          );

          if (selectedPlanResult?.content) {
            console.log(pc.green(`\n✓ Selected ${choice}'s plan`));
            // Inject the human-selected plan as the step output
            const editedPrompt = `**Selected:** ${choice}
**Reasoning:** Human selection

**Chosen Plan:**
${selectedPlanResult.content}`;
            return { proceed: true, editedPrompt };
          }

          return { proceed: true };
        }

        // For build step, confirm before proceeding
        if (step.outputAs === 'implementation' && options.interactive) {
          const proceed = await promptYesNo('Proceed with implementation? (y/n): ');
          if (!proceed) {
            console.log(pc.yellow('Implementation skipped by user'));
            return { proceed: false };
          }
        }

        return { proceed: true };
      };
    }

    // Execute the workflow
    console.log(pc.bold('\n=== Phase 1: Proposing Plans ===\n'));
    const result = await execute(plan, executorConfig);

    // Display results
    console.log('');
    console.log(pc.bold('=== Workflow Complete ==='));
    console.log('');
    console.log(pc.dim('Status:'), result.status === 'completed' ? pc.green('Success') : pc.red(result.status));
    console.log(pc.dim('Duration:'), `${(result.duration / 1000).toFixed(1)}s`);
    console.log('');

    // Show final output
    if (result.finalOutput) {
      console.log(pc.bold('Final Output:'));
      console.log('');
      console.log(result.finalOutput);
    }

    // Show any errors
    const errors = result.results.filter(r => r.status === 'failed');
    if (errors.length > 0) {
      console.log('');
      console.log(pc.red('Errors:'));
      for (const err of errors) {
        console.log(`  - Step ${err.stepId}: ${err.error}`);
      }
    }

  } catch (error) {
    spinner.error({ text: `Workflow failed: ${(error as Error).message}` });
    process.exit(1);
  }
}

/**
 * Prompt user for input from a list of choices
 */
async function promptUser(question: string, choices: string[]): Promise<string | null> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      const match = choices.find(c => c.toLowerCase() === normalized);
      resolve(match || null);
    });
  });
}

/**
 * Prompt user for yes/no confirmation
 */
async function promptYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === 'y' || normalized === 'yes');
    });
  });
}
