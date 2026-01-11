# Ralph Wiggum Loop - Unified Specification

## Overview

The **Ralph Wiggum loop** is an iterative coding pattern that implements: **plan → change → verify → reflect → repeat** with explicit stop conditions, budgets, and safety rails. Named after the character who keeps trying until he gets it right.

## Cross-Tool Support

The Ralph Wiggum loop is implemented as slash commands/prompt templates for:

1. **Claude Code** - `.claude/commands/ralph.md` → `/ralph <goal>`
2. **Codex CLI** - `.codex/prompts/ralph.md` → `/prompts:ralph GOAL="..."`
3. **Gemini CLI** - `.gemini/commands/ralph.toml` → `/ralph <goal>`
4. **Factory (droid)** - `.factory/commands/ralph.md` → `/ralph <goal>`
5. **Charm Crush** - `.crush/commands/ralph.md` → `/ralph <goal>`

## Unified Argument Contract

All tools support a common argument interface:

| Argument | Description | Default |
|----------|-------------|---------|
| `GOAL` / `<goal>` | The coding task to accomplish | Required |
| `ITERS` / `--iters` | Maximum iterations | 5 |
| `TESTS` / `--tests` | Test/lint command to run | Auto-detect |
| `SCOPE` / `--scope` | File paths/globs to limit changes | All files |
| `STOP` / `--stop` | Acceptance criteria | Inferred from goal |

## Core Principles

### 1. Budgets & Safety Rails
- **MAX_ITERS = 5** (configurable)
- **MAX_FILES_CHANGED = 8** - ask before exceeding
- **MAX_TOOL_CALLS = 50** - hard safety limit
- **Fail-fast** - explain when verification is impossible

### 2. Per-Iteration Contract
Each iteration MUST include:
1. **Plan** - 3-7 bullet points outlining minimal steps
2. **Identify** - List files to touch before editing
3. **Execute** - Make edits with clear explanations
4. **Verify** - Run tests or static checks, inspect diffs
5. **Reflect** - Explain what changed and why

### 3. Exit Criteria
Stop when:
- Acceptance criteria met AND verification succeeds, OR
- MAX_ITERS reached

### 4. Stop Reasons
Use one of:
- `DONE` - Task completed successfully
- `BLOCKED` - Missing dependency or external blocker
- `BUDGET_EXCEEDED` - Hit iteration/file/tool call limits
- `RISK_TOO_HIGH` - Destructive change requires human approval

## Tool-Specific Usage

### Claude Code
```bash
/ralph "Fix failing authentication test" --iters 4 --tests "npm test"
/ralph "Add input validation" --scope "src/auth/*" --stop "All tests pass"
```

### Codex CLI
```bash
/prompts:ralph GOAL="Fix failing test" ITERS=4 TESTS="npm test"
/prompts:ralph GOAL="Add validation" SCOPE="src/auth/*" STOP="Tests pass"
```

### Gemini CLI
```bash
/ralph "Fix failing authentication test with 4 iterations"
/ralph "Add input validation to src/auth/* until all tests pass"
```

### Factory (droid)
```bash
/ralph "Fix failing authentication test" --iters 4 --tests "npm test"
/ralph "Add input validation" --scope "src/auth/*"
```

### Charm Crush
```bash
/ralph "Fix failing authentication test" --iters 4 --tests "npm test"
/ralph "Add input validation" --scope "src/auth/*"
```

## Output Format

### Per Iteration
```
Iteration X/Y
---
Plan:
• Step 1
• Step 2

Files to modify:
• file.ext (reason)

Changes:
[diffs or summary]

Verification:
$ <test command>
[output]

Reflection:
[what failed, what changed, why it should improve]
```

### Final Summary
```
Summary:
• Changed files: [list]
• Commands run: [list with results]
• Final status: [DONE/BLOCKED/BUDGET_EXCEEDED/RISK_TOO_HIGH]
• Next steps: [top 3 most likely fixes if incomplete]
• Remaining risks: [any concerns]
```

## Verification Auto-Detection

If no test command is provided, the loop will:
1. Check `package.json` scripts (test, lint, typecheck)
2. Look for Makefile, pytest.ini, tox.ini, or similar
3. Use project-specific conventions if obvious
4. Propose adding tests if none exist

## Guardrails

### Diff Discipline
- Always show what changed and why
- Prefer smallest possible diffs
- Avoid refactors unless required by failing tests

### Human Oversight
- Stop and ask if uncertain about destructive changes
- Request confirmation before modifying >8 files
- Propose alternatives when verification is impossible

### Test Awareness
- If no tests exist, propose adding them first
- Run tests after each iteration
- Show test results clearly

## Best Practices

### 1. Clear Acceptance Criteria
Define explicit success conditions:
```
/ralph "Fix user login bug" --stop "User can login with valid credentials and error shows for invalid ones"
```

### 2. Appropriate Iteration Budgets
- Simple fixes: 2-3 iterations
- Complex features: 5-7 iterations
- Unknown scope: Start with 5, extend if needed

### 3. Scoped Changes
Limit blast radius for safety:
```
/ralph "Refactor validation" --scope "src/auth/*" --iters 3
```

### 4. Explicit Test Commands
Ensure reliable verification:
```
/ralph "Fix tests" --tests "pytest -xvs tests/test_auth.py" --iters 4
```

## Advanced Features

### Factory (droid) Specific
- Uses agentic tools: `view`, `glob`, `grep`, `bash`, `write`, `edit`
- Efficient exploration with `grep` and `glob` before changes
- Permission system for write operations

### Claude Code Specific
- Pre-tool hooks: Show git status before bash commands
- Post-tool hooks: Show git diff stats after bash commands
- Tool restrictions: Only Bash and Files tools allowed

### Codex CLI Specific
- Named placeholders: `GOAL`, `ITERS`, `TESTS`, `SCOPE`, `STOP`
- Falls back to `$ARGUMENTS` if `GOAL` not provided
- Supports positional args `$1`-`$9`

### Gemini CLI Specific
- Uses `{{args}}` for goal injection
- Supports TOML configuration
- Can be packaged as extensions

## When to Use Ralph Wiggum Loop

**Ideal for:**
- Well-defined tasks needing refinement
- Automated development workflows
- Test-driven development cycles
- Bug fixes with clear reproduction steps
- Feature implementation with acceptance criteria

**Not suitable for:**
- Tasks requiring human judgment/design decisions
- Open-ended exploration
- Architectural decisions needing team consensus
- Tasks without verifiable outcomes

## Installation

Each tool's slash command is installed in its respective directory:

- Claude Code: `.claude/commands/ralph.md` (project) or `~/.claude/commands/ralph.md` (user)
- Codex CLI: `.codex/prompts/ralph.md` (requires session restart)
- Gemini CLI: `.gemini/commands/ralph.toml` (project) or `~/.gemini/commands/ralph.toml` (user)
- Factory: `.factory/commands/ralph.md`
- Crush: `.crush/commands/ralph.md`

## Extension & Customization

### Adding Custom Budgets
Modify the `MAX_ITERS`, `MAX_FILES_CHANGED`, or `MAX_TOOL_CALLS` values in the command files to match your project's needs.

### Adding Project-Specific Verification
Update the verification section to include your project's standard test commands:

```markdown
## Project-Specific Verification
- Run: `npm run test:integration`
- Check: `npm run lint:strict`
- Verify: `npm run typecheck`
```

### Packaging as Plugins/Extensions

**Claude Code:** Create `.claude-plugin/plugin.json` with commands
**Gemini CLI:** Bundle into extension with commands + MCP configs
**Codex CLI:** Use "skills" for team sharing (refer to Codex docs)

## References

- [Claude Code Slash Commands](https://code.claude.com/docs/en/slash-commands)
- [Claude Code Plugins](https://code.claude.com/docs/en/plugins)
- [Codex CLI Custom Prompts](https://developers.openai.com/codex/custom-prompts/)
- [Gemini CLI Custom Commands](https://geminicli.com/docs/cli/custom-commands/)

---

**The Ralph Wiggum loop persists until the task is genuinely complete or budget limits are reached.**