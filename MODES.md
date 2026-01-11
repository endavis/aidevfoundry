# PuzldAI Orchestration Modes

PuzldAI provides multiple orchestration modes for coordinating multi-agent workflows. Each mode is designed for different use cases, from simple single-agent tasks to complex multi-step collaborations.

---

## Mode Overview

| Mode | Use Case | Interactive? | Best For |
|-------|-----------|--------------|-----------|
| **Pipeline** | Structured, sequential multi-step workflows | Optional | Complex tasks with clear phases (analyze → build → review) |
| **Autopilot** | Unknown path, let planner propose steps | Yes | Ambiguous tasks where steps aren't known upfront |
| **Compare→Pick→Build** | Get multiple proposals, select best approach | Optional | High-stakes changes where you want to compare approaches |
| **Compare** | Parallel single-step comparisons | Optional | Quick comparison of agent responses |
| **Correction** | Producer → reviewer → optional fix | Optional | Code review and improvement cycle |
| **Debate** | Multi-round agent discussion | No | Exploring complex topics with different perspectives |
| **Consensus** | Propose → vote → iterate until agreement | No | Building agreement on contentious decisions |

---

## Mode A: Pipeline Mode

### Purpose
Execute a structured, sequential workflow where each step has a defined purpose and can build on previous outputs.

### Use Cases
- Multi-phase development (analysis → implementation → review → testing)
- Documentation workflows (research → draft → review → finalize)
- CI/CD pipeline orchestration

### CLI Examples

```bash
# Basic 3-step pipeline: analyze, implement, review
pk-puzldai run "add user authentication" \
  -P "claude:analyze,claude:code,gemini:review" \
  -i

# Custom pipeline with specific actions
pk-puzldai run "optimize database queries" \
  -P "gemini:analyze,claude:code,ollama:test,claude:review" \
  -i

# Use Factory Droid for build step with custom model
pk-puzldai run "implement API endpoint" \
  -P "gemini:analyze,factory:code,gemini:review" \
  --model MiniMax-M2.1 \
  -i
```

### Step-by-Step Workflow

1. **Step 1 (analyze)** - Agent analyzes requirements, identifies files, outlines approach
2. **Step 2 (code)** - Agent implements based on analysis output, uses agentic tools
3. **Step 3 (review)** - Agent reviews implementation, suggests improvements

Each step automatically receives the output of the previous step as context via `{{stepN_output}}` variables.

### Configuration

```json
// Save as a template (e.g., ~/.puzldai/templates/code-review.json)
{
  "name": "code-review",
  "description": "Three-step code review pipeline",
  "steps": [
    { "agent": "claude", "action": "analyze" },
    { "agent": "claude", "action": "code" },
    { "agent": "gemini", "action": "review" }
  ]
}
```

```bash
# Use saved template
pk-puzldai run "your task" -T code-review -i
```

### Safety Notes
- Bash commands remain DEFAULT-DENY in all steps
- Diff previews shown for all write operations
- See [PROVIDER_SUPPORT_MATRIX.md](PROVIDER_SUPPORT_MATRIX.md) for adapter safety

---

## Mode B: Autopilot Mode

### Purpose
Let a planner agent propose an ExecutionPlan for an ambiguous task, then execute with interactive approvals.

### Use Cases
- Tasks where the approach isn't known upfront
- Complex refactoring with many unknown files
- "Make this work" requests requiring discovery

### CLI Examples

```bash
# Basic autopilot with interactive approvals
pk-puzldai autopilot "add caching to API responses" \
  --execute \
  --interactive

# Autopilot with specific planner
pk-puzldai autopilot "optimize bundle size" \
  --planner claude \
  --execute \
  --interactive

# Plan-only (default) - see plan without executing
pk-puzldai autopilot "implement rate limiting"
```

### Step-by-Step Workflow

1. **Planning** - Planner agent analyzes task, generates ExecutionPlan with steps
2. **Review** - User reviews proposed plan, can approve/reject/edit
3. **Execution** - Executor runs each step with dependencies
4. **Verification** - Each step's output is validated before proceeding

### Configuration

Autopilot configuration is currently CLI-only (no `autopilot` block in `~/.puzldai/config.json`).

### Safety Notes
- `--execute` flag required for actual execution
- `--interactive` flag shows diff previews and requires approval for writes
- Plan can be saved and rerun later without re-planning

---

## Mode C: Compare→Pick→Build (pickbuild)

### Purpose
Get multiple plan proposals from different agents, select the best approach (manually or via LLM), then implement with agentic tools.

### Use Cases
- High-stakes architecture changes
- When you want to compare multiple approaches before committing
- Building consensus on complex features

### CLI Examples

```bash
# Basic pickbuild - human picker
pk-puzldai pickbuild "implement rate limiting" \
  --agents claude,gemini \
  --build-agent claude \
  -i

# LLM picker, sequential proposers
pk-puzldai pickbuild "refactor user service" \
  --agents claude,gemini,mistral \
  --picker claude \
  --sequential \
  -i

# With reviewer and custom models
pk-puzldai pickbuild "add search feature" \
  --agents claude,gemini \
  --picker claude \
  --build-agent claude \
  --reviewer gemini \
  -i

# Markdown format plans, skip review
pk-puzldai pickbuild "optimize database queries" \
  --agents claude,gemini \
  --format md \
  --no-review
```

### Step-by-Step Workflow

1. **Propose Plans** - Each proposer agent generates a `PlanArtifact` (not code)
   - Structure: title, summary, assumptions, steps, risks, acceptance criteria
2. **Pick Plan** - Human or LLM selects the best plan
   - Criteria: completeness, specificity, risk awareness, feasibility
3. **Build** - Build agent implements selected plan using agentic tools
   - Reads files before editing
   - Makes targeted edits with diff previews
4. **Review (Optional)** - Reviewer validates implementation against plan

### Plan Artifact Structure

```json
{
  "title": "Rate Limiting Implementation",
  "summary": [
    "Implement token-bucket algorithm",
    "Add Redis for distributed rate limiting",
    "Create middleware for Express",
    "Add configuration options",
    "Write unit tests",
    "Document usage examples"
  ],
  "assumptions": [
    "Redis is already in use for caching",
    "Express.js is the web framework",
    "Rate limits per user, not global"
  ],
  "steps": [
    {
      "id": "step_1",
      "goal": "Create rate limiter class",
      "filesLikelyTouched": ["src/middleware/rateLimiter.ts"],
      "approach": "Implement token-bucket with Redis backend",
      "verification": "Unit tests for token decrement and refill"
    }
  ],
  "risks": [
    {
      "risk": "Redis single point of failure",
      "mitigation": "Add fallback to in-memory if Redis unavailable"
    }
  ],
  "acceptanceCriteria": [
    "Middleware blocks excess requests",
    "Rate limits are configurable per route",
    "Tests cover edge cases"
  ]
}
```

### CLI Flags

| Flag | Description | Default |
|------|-------------|----------|
| `-a, --agents` | Comma-separated list of proposers | `claude,gemini` |
| `--picker` | Agent to pick plan, or `human` | `human` (interactive) / `claude` (non-interactive) |
| `--build-agent` | Agent for implementation | `claude` |
| `--reviewer` | Optional review agent | `none` |
| `--sequential` | Run proposers sequentially | `false` (parallel) |
| `-i, --interactive` | Confirm plan pick + risky operations | `true` |
| `--format` | Plan format (`json` or `md`) | `json` |
| `--no-review` | Skip review step | `false` |

### Safety Invariants

1. **Bash is DEFAULT-DENY** - No shell execution without explicit approval
2. **Pick never selects unsafe plans** - Plans requiring unreviewed shell execution are rejected
3. **Diff previews for all writes** - Implementation step shows changes before applying
4. **Reliability via OpenRouter healing** - Invalid JSON/tool calls are retried once

### Error Recovery

```typescript
// OpenRouter healing retry policy
if (malformedToolCalls) {
  // Retry once with explicit formatting guidance
  retryWithStrictToolFormatting();
} else if (invalidJson) {
  // Retry once with "return valid JSON only" instruction
  retryWithJsonOnlyInstruction();
}
```

---

## Other Modes

### Compare Mode
```bash
# Parallel comparison
pk-puzldai compare "analyze this code" -a claude,gemini,ollama

# Sequential comparison
pk-puzldai compare "write a function" -a claude,gemini --sequential

# Pick best response automatically
pk-puzldai compare "implement feature" -a claude,gemini --pick
```

### Correction Mode
```bash
# Producer → reviewer
pk-puzldai correct "fix this bug" --producer claude --reviewer gemini

# Producer → reviewer → fix
pk-puzldai correct "refactor this" --producer claude --reviewer gemini --fix
```

### Debate Mode
```bash
# 2-round debate between Claude and Gemini
pk-puzldai debate "best approach for X" \
  --agents claude,gemini \
  --rounds 2

# Debate with moderator synthesis
pk-puzldai debate "architectural decision" \
  --agents claude,gemini,mistral \
  --rounds 3 \
  --moderator claude
```

### Consensus Mode
```bash
# Propose, vote, synthesize
pk-puzldai consensus "decide on approach" \
  --agents claude,gemini,ollama \
  --rounds 2

# With custom synthesizer
pk-puzldai consensus "feature design" \
  --agents claude,gemini \
  --synthesizer gemini
```

---

## Safety Across All Modes

### Permission Gating
- **Read tools** (`view`, `glob`, `grep`) - Read permission, can allow by directory
- **Write tools** (`write`, `edit`) - Write permission, always show diff preview
- **Exec tools** (`bash`) - Exec permission, DEFAULT-DENY, require explicit approval

### Diff Preview Workflow
```bash
$ pk-puzldai pickbuild "add feature" -i

[Step 2] Build from plan
  ┌─────────────────────────────────────────┐
  │ edit src/api/users.ts               │
  │─────────────────────────────────────────│
  │ -async function getUsers() {          │
  │ +async function getUsers(limit=100) { │
  │   const users = await db.query(       │
  │-    "SELECT * FROM users"          │
  │+    "SELECT * FROM users LIMIT ?",    │
  │+    [limit]                        │
  │   );                               │
  │   return users;                     │
  │ }                                  │
  └─────────────────────────────────────────┘

  Apply this change? [y/N/a] >
```

### See Also
- [PROVIDER_SUPPORT_MATRIX.md](PROVIDER_SUPPORT_MATRIX.md) - Adapter safety classifications
- [AGENTS.md](AGENTS.md) - Agent capabilities and configuration
- [CLI_TOOLS_GUIDE.md](CLI_TOOLS_GUIDE.md) - Tool reference for agentic mode

---

*Last updated: 2025-12-24*
*Version: 0.2.95*

## Orchestration Profiles

Profiles control auto-selection of modes and agents for `run` and `orchestrate`.

- **speed**: default, favors single/pipeline
- **balanced**: pipeline with optional supervision or consensus
- **quality**: consensus/pickbuild with review

```bash
# Preview plan without executing
pk-puzldai run "task" --profile balanced --dry-run

# Disable context compression
pk-puzldai orchestrate "task" --profile quality --no-compress
```
