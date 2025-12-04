import { Ollama } from 'ollama';
import type { RouteResult } from '../lib/types';
import { getConfig } from '../lib/config';

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
      return {
        agent: config.fallbackAgent as RouteResult['agent'],
        confidence: 1.0,
        taskType: 'fallback'
      };
    }

    return parsed as RouteResult;
  } catch (err) {
    console.warn('Router failed, using fallback agent:', (err as Error).message);
    return {
      agent: config.fallbackAgent as RouteResult['agent'],
      confidence: 1.0,
      taskType: 'fallback'
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
