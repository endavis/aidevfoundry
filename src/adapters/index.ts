import { isInteractiveAdapter, type Adapter, type InteractiveAdapter } from '../lib/types';
import { claudeAdapter } from './claude';
import { geminiAdapter } from './gemini';
import { geminiSafeAdapter } from './gemini-safe';
import { codexAdapter } from './codex';
import { codexSafeAdapter } from './codex-safe';
import { ollamaAdapter } from './ollama';
import { mistralAdapter } from './mistral';
import { factoryAdapter } from './factory';
import { crushAdapter } from './crush';
import { codexSafeCliAdapter, geminiSafeCliAdapter } from './safe-cli';
import { factoryDroidAdapter } from './factory-ai-droid';
import { charmCrushAdapter } from './charm-crush';
import { openrouterAdapter, runOpenRouter, runOpenRouterStream, FAST_MODELS, listFastModels } from './openrouter';
import { GameStateParser } from './base-game-adapter';
import { createInteractiveAdapter, runInteractive } from './interactive-adapter';
import { ixagentAdapter } from './ixagent';
import type { InteractiveRunOptions } from './interactive-adapter';

export const adapters: Record<string, Adapter> = {
  claude: claudeAdapter,
  gemini: geminiAdapter,
  codex: codexAdapter,
  'gemini-safe': geminiSafeCliAdapter,
  'codex-safe': codexSafeCliAdapter,
  'gemini-unsafe': geminiAdapter,
  'codex-unsafe': codexAdapter,
  ollama: ollamaAdapter,
  mistral: mistralAdapter,
  factory: factoryAdapter,
  crush: crushAdapter,
  openrouter: openrouterAdapter,
  'factory-ai-droid': factoryDroidAdapter,
  'charm-crush': charmCrushAdapter,
  ixagent: ixagentAdapter
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

/**
 * Get all adapters that support interactive mode
 */
export function getInteractiveAdapters(): InteractiveAdapter[] {
  const interactive: InteractiveAdapter[] = [];
  for (const adapter of Object.values(adapters)) {
    if (isInteractiveAdapter(adapter)) {
      interactive.push(adapter);
    }
  }
  return interactive;
}

/**
 * Get available adapters that support interactive mode
 */
export async function getAvailableInteractiveAdapters(): Promise<InteractiveAdapter[]> {
  const available: InteractiveAdapter[] = [];
  for (const adapter of Object.values(adapters)) {
    if (isInteractiveAdapter(adapter) && (await adapter.isAvailable())) {
      available.push(adapter);
    }
  }
  return available;
}

/**
 * Check if a specific adapter supports interactive mode
 */
export function adapterSupportsInteractive(adapterName: string): boolean {
  const adapter = adapters[adapterName];
  return adapter ? isInteractiveAdapter(adapter) : false;
}

export {
  claudeAdapter,
  geminiAdapter,
  geminiSafeAdapter,
  codexAdapter,
  codexSafeAdapter,
  geminiSafeCliAdapter,
  codexSafeCliAdapter,
  ollamaAdapter,
  mistralAdapter,
  factoryAdapter,
  crushAdapter,
  factoryDroidAdapter,
  charmCrushAdapter,
  openrouterAdapter,
  runOpenRouter,
  runOpenRouterStream,
  FAST_MODELS,
  listFastModels,
  ixagentAdapter,
  GameStateParser,
  // Interactive mode support
  createInteractiveAdapter,
  runInteractive,
  // Note: getInteractiveAdapters, getAvailableInteractiveAdapters, adapterSupportsInteractive
  // are already exported via 'export function' declarations above
};

export type { InteractiveRunOptions };
