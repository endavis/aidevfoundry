import { Ollama } from 'ollama';
import type { RouteResult } from '../lib/types';
import { getConfig } from '../lib/config';
import { logRoutingDecision } from '../observation/logger';

let ollamaClient: Ollama | null = null;

function getOllama(): Ollama {
  if (!ollamaClient) {
    const config = getConfig();
    ollamaClient = new Ollama({ host: config.adapters.ollama.host });
  }
  return ollamaClient;
}

const ROUTING_PROMPT = `You are a task router. Classify the task and choose the best agent.

Available agents:
- claude: Complex coding, debugging, architecture, multi-file changes, refactoring
- gemini: Analysis, research, explanations, documentation, multi-modal
- codex: Quick code generation, simple scripts, single-file tasks
- ollama: Simple queries, local processing, basic questions

Respond ONLY with valid JSON: {"agent":"...","confidence":0.X,"taskType":"..."}

Task: `;

export async function routeTask(task: string): Promise<RouteResult> {
  const config = getConfig();

  try {
    const ollama = getOllama();
    const response = await ollama.chat({
      model: config.routerModel,
      messages: [
        { role: 'user', content: ROUTING_PROMPT + task }
      ],
      format: 'json'
    });

    const parsed = JSON.parse(response.message.content);

    if (!parsed.agent || typeof parsed.confidence !== 'number') {
      throw new Error('Invalid router response structure');
    }

    if (parsed.confidence < config.confidenceThreshold) {
      console.log(`[router] Low confidence (${parsed.confidence.toFixed(2)} < ${config.confidenceThreshold}) - using fallback agent: ${config.fallbackAgent}`);
      console.log(`[router] Fix: Start Ollama service, adjust confidenceThreshold in config, or specify agent directly`);
      try {
        logRoutingDecision({
          task,
          selectedAgent: config.fallbackAgent,
          confidence: parsed.confidence,
          taskType: parsed.taskType || 'fallback',
          fallbackReason: `Router confidence (${parsed.confidence.toFixed(2)}) below threshold (${config.confidenceThreshold})`,
          routerModel: config.routerModel,
          mode: 'auto'
        });
      } catch {
        // Ignore logging errors
      }
      return {
        agent: config.fallbackAgent as RouteResult['agent'],
        confidence: 1.0,
        taskType: 'fallback',
        fallbackReason: `Router confidence (${parsed.confidence.toFixed(2)}) below threshold (${config.confidenceThreshold})`
      };
    }

    try {
      logRoutingDecision({
        task,
        selectedAgent: parsed.agent,
        confidence: parsed.confidence,
        taskType: parsed.taskType,
        routerModel: config.routerModel,
        mode: 'auto'
      });
    } catch {
      // Ignore logging errors
    }

    return parsed as RouteResult;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown error';
    console.log(`[router] Unavailable - ${reason}. Using fallback agent: ${config.fallbackAgent}`);
    console.log(`[router] Fix: Start Ollama service (ollama serve) or change routerModel in config`);
    try {
      logRoutingDecision({
        task,
        selectedAgent: config.fallbackAgent,
        confidence: 0,
        taskType: 'fallback',
        fallbackReason: `Router unavailable: ${reason}`,
        routerModel: config.routerModel,
        mode: 'auto'
      });
    } catch {
      // Ignore logging errors
    }
    return {
      agent: config.fallbackAgent as RouteResult['agent'],
      confidence: 1.0,
      taskType: 'fallback',
      fallbackReason: `Router unavailable: ${reason}`
    };
  }
}

export async function isRouterAvailable(): Promise<boolean> {
  try {
    const ollama = getOllama();
    const models = await ollama.list();
    const config = getConfig();
    return models.models.some(m => m.name.includes(config.routerModel.split(':')[0]));
  } catch {
    return false;
  }
}
