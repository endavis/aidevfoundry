import type { Adapter } from '../lib/types';
import { claudeAdapter } from './claude';
import { geminiAdapter } from './gemini';
import { geminiSafeAdapter } from './gemini-safe';
import { codexAdapter } from './codex';
import { codexSafeAdapter } from './codex-safe';
import { ollamaAdapter } from './ollama';
import { mistralAdapter } from './mistral';
import { factoryAiDroidAdapter } from './factory-ai-droid';
import { charmCrushAdapter } from './charm-crush';
import { factoryAdapter } from './factory';
import { crushAdapter } from './crush';

export const adapters: Record<string, Adapter> = {
  claude: claudeAdapter,
  gemini: geminiAdapter,
  codex: codexAdapter,
  ollama: ollamaAdapter,
  mistral: mistralAdapter,
  'factory-ai-droid': factoryAiDroidAdapter,
  'charm-crush': charmCrushAdapter,
  factory: factoryAdapter,
  crush: crushAdapter
};

export async function getAvailableAdapters(): Promise<Adapter[]> {
  const available: Adapter[] = [];
  for (const adapter of Object.values(adapters)) {
    if (await adapter.isAvailable()) {
      available.push(adapter);
    }
  }
  return available;
}

export { claudeAdapter, geminiAdapter, geminiSafeAdapter, codexAdapter, codexSafeAdapter, ollamaAdapter, mistralAdapter, factoryAiDroidAdapter, charmCrushAdapter, factoryAdapter, crushAdapter };
