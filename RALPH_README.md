# Ralph Wiggum Loop - Quick Start

## What is it?

The **Ralph Wiggum loop** is an iterative coding pattern that keeps AI agents working on a task until completion: **plan → change → verify → reflect → repeat**

## Quick Usage

### Claude Code
```bash
/ralph "Fix the failing authentication test" --iters 4 --tests "npm test"
```

### Codex CLI
```bash
/prompts:ralph GOAL="Fix failing test" ITERS=4 TESTS="npm test"
```

### Gemini CLI
```bash
/ralph "Fix the failing authentication test"
```

### Factory (droid)
```bash
/ralph "Fix the failing authentication test" --iters 4 --tests "npm test"
```

### Charm Crush
```bash
/ralph "Fix the failing authentication test" --iters 4 --tests "npm test"
```

## Common Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `<goal>` / `GOAL` | The coding task to accomplish | Required |
| `--iters` / `ITERS` | Maximum iterations | 5 |
| `--tests` / `TESTS` | Test/lint command to run | Auto-detect |
| `--scope` / `SCOPE` | File paths/globs to limit changes | All files |
| `--stop` / `STOP` | Acceptance criteria | Inferred from goal |

## Key Features

✅ **Bounded iterations** - Won't run forever (default: 5 iterations)
✅ **Safety rails** - Max 8 files changed, 50 tool calls
✅ **Auto-verification** - Runs tests after each iteration
✅ **Clear output** - Structured iteration reports
✅ **Exit conditions** - DONE, BLOCKED, BUDGET_EXCEEDED, RISK_TOO_HIGH

## Per-Iteration Structure

Each iteration includes:
1. **Plan** - 3-7 bullet points
2. **Identify** - List files to modify
3. **Execute** - Make changes
4. **Verify** - Run tests
5. **Reflect** - Explain what changed and why

## Files Created

```
.claude/commands/ralph.md          # Claude Code slash command
.codex/prompts/ralph.md            # Codex CLI custom prompt
.gemini/commands/ralph.toml        # Gemini CLI custom command
.factory/commands/ralph.md         # Factory (droid) slash command
.crush/commands/ralph.md           # Charm Crush slash command
RALPH_WIGGUM_LOOP.md               # Full documentation
test-ralph-loop.ts                 # Validation script
```

## Installation

All commands are already installed in their respective directories. Each CLI tool will automatically detect them:

- **Claude Code**: Detects `.claude/commands/` automatically
- **Codex CLI**: Detects `.codex/prompts/` after restart
- **Gemini CLI**: Detects `.gemini/commands/` automatically
- **Factory**: Detects `.factory/commands/` automatically
- **Crush**: Detects `.crush/commands/` automatically

## Testing

Run the validation script:
```bash
node test-ralph-loop.ts
```

## Documentation

See [RALPH_WIGGUM_LOOP.md](./RALPH_WIGGUM_LOOP.md) for complete documentation including:
- Detailed specification
- Tool-specific features
- Best practices
- Extension & customization guide
- When to use (and when not to use)

## Examples

### Simple bug fix
```bash
/ralph "Fix the user login bug"
```

### Complex feature with constraints
```bash
/ralph "Add input validation to user signup" --iters 6 --scope "src/auth/*" --stop "All validation tests pass"
```

### Test-driven development
```bash
/ralph "Implement password reset flow" --tests "pytest -xvs tests/test_reset.py" --iters 5
```

---

**The Ralph Wiggum loop persists until the task is genuinely complete or budget limits are reached.**