import * as readline from 'readline';
import type { Adapter } from '../lib/types';
import { codexSafeAdapter, type FileChange as CodexFileChange } from './codex-safe';
import { geminiSafeAdapter, type FileChange as GeminiFileChange } from './gemini-safe';

type FileChange = CodexFileChange | GeminiFileChange;

const MAX_CHANGE_LIST = 50;

function formatChange(change: FileChange): string {
  return `${change.kind}: ${change.path}`;
}

function isTtyPromptAvailable(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function promptForApproval(adapterLabel: string, changes: FileChange[]): Promise<boolean> {
  if (!isTtyPromptAvailable()) {
    return false;
  }

  const total = changes.length;
  const display = changes.slice(0, MAX_CHANGE_LIST);

  console.log(`\n${adapterLabel} proposed file changes (${total}):`);
  for (const change of display) {
    console.log(`- ${formatChange(change)}`);
  }
  if (total > display.length) {
    console.log(`- ...and ${total - display.length} more`);
  }

  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('Apply these changes? [y/N]: ', answer => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === 'y' || normalized === 'yes');
    });
  });
}

export const geminiSafeCliAdapter: Adapter = {
  name: 'gemini-safe',
  isAvailable: () => geminiSafeAdapter.isAvailable(),
  run: async (prompt, options) => {
    return geminiSafeAdapter.runWithApproval(prompt, {
      ...options,
      onChangesReview: changes => promptForApproval('Gemini Safe', changes)
    });
  }
};

export const codexSafeCliAdapter: Adapter = {
  name: 'codex-safe',
  isAvailable: () => codexSafeAdapter.isAvailable(),
  run: async (prompt, options) => {
    return codexSafeAdapter.runWithApproval(prompt, {
      ...options,
      onChangesReview: changes => promptForApproval('Codex Safe', changes)
    });
  }
};
