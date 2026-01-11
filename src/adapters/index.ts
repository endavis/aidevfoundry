import type { Adapter } from '../lib/types';
import { claudeAdapter } from './claude';
import { geminiAdapter } from './gemini';
import { geminiSafeAdapter } from './gemini-safe';
import { codexAdapter } from './codex';
import { codexSafeAdapter } from './codex-safe';
import { ollamaAdapter } from './ollama';
import { mistralAdapter } from './mistral';
import { factoryAdapter } from './factory';
import { crushAdapter } from './crush';
import { factoryDroidAdapter } from './factory-ai-droid';
import { charmCrushAdapter } from './charm-crush';
import { GameStateParser } from './base-game-adapter';
import { createInteractiveAdapter, runInteractive } from './interactive-adapter';
import type { InteractiveRunOptions } from './interactive-adapter';

export const adapters: Record<string, Adapter> = {
  claude: claudeAdapter,
  gemini: geminiAdapter,
  codex: codexAdapter,
  ollama: ollamaAdapter,
  mistral: mistralAdapter,
  factory: factoryAdapter,
  crush: crushAdapter,
  'factory-ai-droid': factoryDroidAdapter,
  'charm-crush': charmCrushAdapter
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

export {
  claudeAdapter,
  geminiAdapter,
  geminiSafeAdapter,
  codexAdapter,
  codexSafeAdapter,
  ollamaAdapter,
  mistralAdapter,
  factoryAdapter,
  crushAdapter,
  factoryDroidAdapter,
  charmCrushAdapter,
  GameStateParser,
  // Interactive mode support
  createInteractiveAdapter,
  runInteractive,
};

export type { InteractiveRunOptions };
