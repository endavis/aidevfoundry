---
description: Bounded iterative "Ralph Wiggum loop" run (plan → edit → verify → reflect → repeat)
argument-hint: GOAL="<text>" ITERS=5 TESTS="cmd" SCOPE="paths" STOP="criteria"
---

# Ralph Wiggum Loop - Iterative Coding Assistant

You are running a bounded iterative loop to accomplish a coding goal. The Ralph Wiggum loop means: **iterative plan → change → verify → reflect → repeat** with explicit stop conditions, budgets, and safety rails.

## Goal
$GOAL
If GOAL is empty, use: $ARGUMENTS

## Budgets & Safety Rails
- **MAX_ITERS = $ITERS** (default: 5 if not provided)
- **MAX_FILES_CHANGED = 8** - never modify more than 8 files without asking
- **MAX_TOOL_CALLS = 50** per session (hard safety limit)
- Always prefer smallest diffs. Avoid refactors unless required by failing tests.
- **Fail-fast**: if tests cannot be run, explain why and propose alternatives.

## Per-Iteration Contract (MUST do all)
Each iteration must include:
1. **Plan** - 3-7 bullet points outlining the minimal steps
2. **Identify** - List files to touch before editing
3. **Execute** - Make edits with clear explanations
4. **Verify** - Run tests or static checks, inspect diffs
5. **Reflect** - Brief explanation of what changed and why

### Verification Rules
- If $TESTS provided, run that exact command
- Otherwise pick the most standard test/lint command available:
  - Check `package.json` scripts (test, lint, typecheck)
  - Look for Makefile, pytest.ini, tox.ini, or similar
  - Use project-specific conventions if obvious

## Scope
If $SCOPE is provided, only modify files matching those paths/globs.
Otherwise, limit changes to files directly related to the goal.

## Exit Criteria
Stop when:
- Acceptance criteria in $STOP are satisfied (or infer reasonable acceptance criteria from GOAL), AND
- Verification succeeds (tests pass, no new lints), OR
- MAX_ITERS reached

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
• Final status: [DONE/BLOCKED/BUDGET_EXCEEDED/RISK_TOO_HIGH]
• Next steps: [if incomplete, top 3 most likely fixes]
• Remaining risks: [any concerns]
```

## Loop Execution
Repeat until:
- Acceptance criteria met AND verification succeeds, OR
- MAX_ITERS reached

If MAX_ITERS reached: stop, summarize current state, list top 3 most likely fixes.

## Guardrails
- **Diff discipline**: always show what changed and why
- **Exit criteria**: use one of: DONE, BLOCKED (missing dependency), BUDGET_EXCEEDED, RISK_TOO_HIGH
- **Human oversight**: stop and ask if uncertain about destructive changes
- **Test awareness**: if no tests exist, propose adding them first

---
*The Ralph Wiggum loop persists until the task is genuinely complete or budget limits are reached. Named after the character who keeps trying until he gets it right.*

## Usage Examples
- `/prompts:ralph GOAL="Fix flaky unit test" ITERS=4 TESTS="pnpm test" STOP="All unit tests pass"`
- `/prompts:ralph GOAL="Add input validation" ITERS=6 TESTS="npm test && npm run lint" SCOPE="src/auth/**"`
- `/prompts:ralph Fix flaky unit test` (falls back to $ARGUMENTS)