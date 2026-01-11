import type { ModelResponse, RunOptions } from '../lib/types';
import type { AgentName } from '../executor/types';
import { getConfig } from '../lib/config';
import { adapters } from '../adapters';
import { routeTask, isRouterAvailable } from '../router/router';
import { resolveAgentSelection } from '../lib/agent-selection';

export interface OrchestrateOptions extends RunOptions {
  agent?: string;
}

export async function orchestrate(
  task: string,
  options?: OrchestrateOptions
): Promise<ModelResponse> {
  const config = getConfig();

  // If specific agent requested, use it directly
  if (options?.agent && options.agent !== 'auto') {
    const selection = resolveAgentSelection(options.agent as AgentName);
    if (selection.notice) {
      console.log(`[orchestrator] ${selection.notice}`);
    }
    const adapter = adapters[selection.agent];
    if (!adapter) {
      return {
        content: '',
        model: 'unknown',
        error: `Unknown agent: ${selection.agent}`
      };
    }

    if (!(await adapter.isAvailable())) {
      return {
        content: '',
        model: selection.agent,
        error: `Agent ${selection.agent} is not available. Run 'ai check' for details.`
      };
    }

    return adapter.run(task, options);
  }

  // Auto-routing mode
  let selectedAgent = config.fallbackAgent;
  let routerFallbackReason: string | undefined;

  // Try to use router if available
  if (await isRouterAvailable()) {
    const route = await routeTask(task);
    selectedAgent = route.agent;
    routerFallbackReason = route.fallbackReason;

    if (config.logLevel === 'debug') {
      console.log(`[router] Selected: ${route.agent} (confidence: ${route.confidence})`);
    }
  }

  const selection = resolveAgentSelection(selectedAgent as AgentName);
  if (selection.notice) {
    console.log(`[orchestrator] ${selection.notice}`);
  }
  const adapter = adapters[selection.agent];
  if (!adapter) {
    return {
      content: '',
      model: 'unknown',
      error: `Unknown agent: ${selection.agent}`
    };
  }

  if (!(await adapter.isAvailable())) {
    // Try fallback
    const fallbackSelection = resolveAgentSelection(config.fallbackAgent as AgentName);
    if (fallbackSelection.notice) {
      console.log(`[orchestrator] ${fallbackSelection.notice}`);
    }
    const fallbackAdapter = adapters[fallbackSelection.agent];
    if (fallbackAdapter && (await fallbackAdapter.isAvailable())) {
      if (routerFallbackReason) {
        console.log(`[orchestrator] Router fallback to ${fallbackSelection.agent}: ${routerFallbackReason}`);
      }
      return fallbackAdapter.run(task, options);
    }

    // Try any available adapter
    for (const [name, adp] of Object.entries(adapters)) {
      if (await adp.isAvailable()) {
        console.log(`[orchestrator] Using available agent: ${name} (preferred ${selectedAgent} unavailable)`);
        return adp.run(task, options);
      }
    }

    return {
      content: '',
      model: selectedAgent,
      error: 'No agents available. Run "ai check" for details.'
    };
  }

  return adapter.run(task, options);
}
