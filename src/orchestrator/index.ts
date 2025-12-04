import type { ModelResponse, RunOptions } from '../lib/types';
import { getConfig } from '../lib/config';
import { adapters } from '../adapters';
import { routeTask, isRouterAvailable } from '../router/router';

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
    const adapter = adapters[options.agent];
    if (!adapter) {
      return {
        content: '',
        model: 'unknown',
        error: `Unknown agent: ${options.agent}`
      };
    }

    if (!(await adapter.isAvailable())) {
      return {
        content: '',
        model: options.agent,
        error: `Agent ${options.agent} is not available. Run 'ai check' for details.`
      };
    }

    return adapter.run(task, options);
  }

  // Auto-routing mode
  let selectedAgent = config.fallbackAgent;

  // Try to use router if available
  if (await isRouterAvailable()) {
    const route = await routeTask(task);
    selectedAgent = route.agent;

    if (config.logLevel === 'debug') {
      console.log(`[router] Selected: ${route.agent} (confidence: ${route.confidence})`);
    }
  }

  const adapter = adapters[selectedAgent];
  if (!adapter) {
    return {
      content: '',
      model: 'unknown',
      error: `Unknown agent: ${selectedAgent}`
    };
  }

  if (!(await adapter.isAvailable())) {
    // Try fallback
    const fallbackAdapter = adapters[config.fallbackAgent];
    if (fallbackAdapter && (await fallbackAdapter.isAvailable())) {
      return fallbackAdapter.run(task, options);
    }

    // Try any available adapter
    for (const [, adp] of Object.entries(adapters)) {
      if (await adp.isAvailable()) {
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
