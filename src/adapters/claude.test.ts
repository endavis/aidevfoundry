import { describe, it, expect } from 'bun:test';

import { buildClaudeArgs } from './claude';

describe('claude adapter arg building', () => {
  it('uses --tools= (not --tools "") so the positional prompt is not swallowed', () => {
    const args = buildClaudeArgs({
      prompt: 'hello',
      disableTools: true,
      model: undefined,
    });

    expect(args).toContain('--tools=');
    expect(args).not.toContain('--tools');
    expect(args.at(-1)).toBe('hello');
  });

  it('does not include --tools when disableTools=false', () => {
    const args = buildClaudeArgs({
      prompt: 'hello',
      disableTools: false,
      model: undefined,
    });

    expect(args.join(' ')).not.toContain('--tools');
    expect(args.at(-1)).toBe('hello');
  });

  it('appends --model when provided and keeps prompt last', () => {
    const args = buildClaudeArgs({
      prompt: 'hello',
      disableTools: true,
      model: 'sonnet',
    });

    expect(args).toContain('--model');
    expect(args).toContain('sonnet');
    expect(args.at(-1)).toBe('hello');
  });
});
