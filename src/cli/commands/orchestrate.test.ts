import { describe, it, expect } from 'bun:test';
import { runCommand } from './run';

describe('run command dry-run', () => {
  it('prints a plan preview for pipeline dry-run', async () => {
    const logs: string[] = [];
    const originalLog = console.log;

    console.log = (...args: unknown[]) => {
      logs.push(args.map(a => String(a)).join(' '));
    };

    try {
      await runCommand('Explain recursion', {
        pipeline: 'gemini:analyze,claude:code',
        dryRun: true
      });
    } finally {
      console.log = originalLog;
    }

    const output = logs.join('
');
    expect(output).toContain('Plan ID');
    expect(output).toContain('Mode: pipeline');
  });
});
