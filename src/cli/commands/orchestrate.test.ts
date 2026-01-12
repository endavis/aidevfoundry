import { describe, it, expect } from 'bun:test';
import { apiLogger } from '../../lib/logger';
import { runCommand } from './run';

describe('run command dry-run', () => {
  it('prints a plan preview for pipeline dry-run', async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    const originalError = apiLogger.error.bind(apiLogger);

    console.log = (...args: unknown[]) => {
      logs.push(args.map(a => String(a)).join(' '));
    };
    (apiLogger as typeof apiLogger & { error: (...args: unknown[]) => void }).error = () => {};

    try {
      await runCommand('Explain recursion', {
        pipeline: 'gemini:analyze,claude:code',
        dryRun: true
      });
    } finally {
      console.log = originalLog;
      (apiLogger as typeof apiLogger & { error: typeof originalError }).error = originalError;
    }

    const output = logs.join('\n');
    expect(output).toContain('Plan ID');
    expect(output).toContain('Mode: pipeline');
  });
});
