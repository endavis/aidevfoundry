---
description: Iterative "Ralph Wiggum loop" coding run (plan → edit → test → reflect → repeat)
argument-hint: <goal> | --iters N --tests "cmd" --scope "paths" --stop "criteria"
---

# Ralph Wiggum Loop - Iterative Coding Assistant

You are running a bounded iterative loop to accomplish the goal below. The Ralph Wiggum loop means: **iterative plan → change → verify → reflect → repeat** with explicit stop conditions, budgets, and safety rails.

## Goal
$ARGUMENTS

## Operating Rules

### Budgets & Safety Rails
- **MAX_ITERS = 5** unless user specifies `--iters N`
- **MAX_FILES_CHANGED = 8** - never modify more than 8 files without stopping and asking for confirmation
- **MAX_TOOL_CALLS = 50** per session (hard safety limit)
- Always prefer smallest diffs. Avoid refactors unless required by failing tests.
- **Fail-fast**: if tests cannot be run, explain why and propose alternatives.

### Per-Iteration Contract (MUST do all)
Each iteration must include:
1. **Plan** - 3-7 bullet points outlining the minimal steps
2. **Identify** - List files to touch before editing
3. **Execute** - Make edits with clear explanations
4. **Verify** - Run tests or static checks, inspect diffs
5. **Reflect** - Brief explanation of what changed and why

### Exit Criteria
Stop when:
- Acceptance criteria are met (from `--stop` or inferred from goal), AND
- Verification succeeds (tests pass, no new lints), OR
- MAX_ITERS reached

## Suggested Verification
- If user provided `--tests "..."`, run that command
- Otherwise run the project's standard test or lint command:
  - Check `package.json` scripts (test, lint, typecheck)
  - Look for Makefile, pytest.ini, tox.ini, or similar
  - Use project-specific conventions if obvious
- Always end with a verification summary

## Output Format (Per Iteration)
```
Iteration X/Y
---
Plan:
• [bullet points]

Files to modify:
• file.ext (reason)

Changes:
[show diffs or summarize]

Verification:
$ <test command>
[output]

Reflection:
[what failed, what changed, why it should improve]
```

## Final Summary (When Stopping)
```
Summary:
• Changed files: [list]
• Commands run: [list with results]
• Final status: [DONE/BLOCKED/BUDGET_EXCEEDED]
• Next steps: [if incomplete, top 3 most likely fixes]
• Remaining risks: [any concerns]
```

## Loop Execution
Repeat until:
- Acceptance criteria met AND verification succeeds, OR
- MAX_ITERS reached

On MAX_ITERS reached: stop, summarize best state, and list the top 3 most likely fixes.

## Guardrails
- **Diff discipline**: always show what changed and why
- **Exit criteria**: use explicit stop conditions (DONE, BLOCKED, BUDGET_EXCEEDED, RISK_TOO_HIGH)
- **Human oversight**: stop and ask if uncertain about destructive changes
- **Test awareness**: if no tests exist, propose adding them first

---
*The Ralph Wiggum loop persists until the task is genuinely complete or budget limits are reached. Named after the character who keeps trying until he gets it right.*

## Usage Examples
- `/ralph "Fix the failing authentication test" --iters 4 --tests "npm test"`
- `/ralph "Add input validation to user signup" --scope "src/auth/*" --stop "All validation tests pass"`
- `/ralph "Refactor duplicate code in utils" --iters 3`