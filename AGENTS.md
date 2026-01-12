# PuzldAI - Agents Guide

## Project Overview
PuzldAI is a multi-LLM orchestration framework with agentic execution, memory/RAG, and training data generation. It provides a CLI/TUI interface to orchestrate multiple AI coding tools including:

**Production Agents:**
- **LLM Providers:** Claude, Gemini, Codex, Ollama, Mistral
- **External CLI Coding Tools:** Factory (droid), Charm Crush (crush)

**Easter Eggs:** `factory-ai-droid` and `charm-crush` are fun puzzle games that demonstrate the adapter pattern, but **NOT** production coding agents. When we refer to "droid" or "crush" in production contexts, we mean the external CLI tool adapters (`factory` and `crush`).

**Features:** Auto-routing, task comparison, pipelines, workflows, codebase indexing

**Stack**: TypeScript (Node.js 20+), Bun (runtime/bundler), SQLite (persistence), Fastify/Hono (API)

---

## 📋 Implementation Plan Tracking

**IMPORTANT:** This project maintains an active implementation plan at `plan.md`.

### Plan Maintenance Requirements

**ALL contributors, agents, and developers MUST:**

1. **Read `plan.md`** before starting any new work
2. **Update `plan.md`** when:
   - Starting a task (mark as 🔄 In Progress)
   - Completing a task (mark as ✅ Completed, check the box)
   - Discovering blockers (mark as ❌ Blocked with notes)
   - Finding new tasks or requirements
   - Making architectural changes
   - Changing timelines or dependencies

**Exception:** Read-only audits or reviews that do not change code or architecture do not require plan.md updates; note the audit outcome in your final summary instead.

3. **Add change log entries** to `plan.md` with:
   - Date of change
   - Tasks started/completed
   - Issues discovered
   - Important decisions made

4. **Keep plan.md in sync** with actual codebase state
   - Update completion percentages
   - Document deviations from plan
   - Note lessons learned

**Location:** `plan.md` in project root

**Format:** Markdown with status indicators (⬜🔄✅❌)

**Review:** Check plan.md before and after each work session

---

## Architecture

### Core Modules

| Module | Purpose | Key Files |
|--------|---------|-----------|
| **Orchestrator** | Task routing and agent selection | `src/orchestrator/index.ts` |
| **Adapters** | LLM provider interfaces | `src/adapters/` |
| **Executor** | Plan/pipeline/workflow execution | `src/executor/` |
| **Agentic** | Tool-based file operations | `src/agentic/` |
| **Router** | Task classification for auto-routing | `src/router/router.ts` |
| **Memory** | SQLite sessions, embeddings, RAG | `src/memory/` |
| **Indexing** | AST parsing, semantic search | `src/indexing/` |
| **Observation** | Training data logging | `src/observation/` |
| **MCP** | Model Context Protocol bridge | `src/mcp/` |
| **Context** | Unified message management | `src/context/` |

### Execution Flow

```
User Input → Orchestrator → Router (optional) → Adapter → LLM
                              ↓                        ↓
                         Memory/RAG          Agentic Tools
                              ↓                        ↓
                         Indexing           Permission System
                              ↓                        ↓
                         Observation         File Operations
```

---

## Key Concepts

### Adapters
Each LLM provider (claude, gemini, codex, ollama, mistral) implements the `Adapter` interface:
- `name`: Provider identifier
- `isAvailable()`: Check if CLI/API is installed/running
- `run(prompt, options)`: Execute prompt, return `ModelResponse`

**Important**: Use `disableTools: true` for agentic mode - LLM returns JSON, we handle tools.

### Agentic Mode
Two approaches:
1. **JSON-based**: LLM returns `{"operations": [...]}` in JSON format (`runAgentic`)
2. **Tool-based**: LLM calls tools via ` ```tool` ``` blocks (`runAgentLoop`)

**Tools**: `view`, `glob`, `grep`, `bash`, `write`, `edit`
- Read-only (`view`, `glob`, `grep`) vs write (`write`, `edit`) vs execute (`bash`)
- Permission system: ask user for approval before execution
- Diff preview: show changes before applying write/edit

### Router
Uses Ollama (`routerModel` from config, default `llama3.2`) to classify tasks and select best agent. Returns `{agent, confidence, taskType}`.

### Ralph Wiggum Loop
Plan-first iterative execution with explicit budgets and guardrails:
- **Budgets**: MAX_ITERS=5, MAX_FILES_CHANGED=8, MAX_TOOL_CALLS=50
- **Per-Iteration Contract**: Plan → Identify → Execute → Verify → Reflect
- **Exit Criteria**: DONE (all steps complete), BUDGET_EXCEEDED (limits hit), BLOCKED (missing deps)
- **Final Summary**: Reports changed files, commands run, status, next steps, remaining risks

**Usage**:
```bash
pk-puzldai ralph "Fix bug X" --iters 3 --tests "npm test" --scope "src/"
```

**Features**:
- Generates structured plan with clarifying questions
- Tracks files changed, tool calls, and commands run
- Enforces budgets to prevent runaway execution
- Provides detailed iteration summaries and final report

### Memory
- **SQLite Sessions**: Persist conversations in `~/.puzldai/sessions.db`
- **Vector Store**: Embeddings for semantic search (Ollama or SQLite FTS5)
- **Injection**: Auto-inject relevant memory into prompts

### Indexing
- **AST Parsing**: Extract functions, classes, interfaces from code
- **Dependency Graph**: Import/export relationships
- **Config Detection**: Find `AGENTS.md`, `.cursorrules`, etc. for project instructions

### Observation Layer
Logs all interactions for DPO fine-tuning:
- Inputs (prompts, context)
- Outputs (responses, edits)
- Decisions (accept/reject)
- User modifications (diff tracking)

---

## Development

### Build & Test
```bash
bun install           # Install dependencies
bun run dev           # Run from source
bun run build         # Build to dist/
bun run typecheck     # TypeScript check
npm link              # Link CLI globally
```

### TypeScript Config
- Target: ES2022
- Strict mode enabled
- No unused locals/parameters
- Dist output to `./dist/`, source from `./src/`

### Adding a New Adapter
1. Create `src/adapters/[name].ts`
2. Implement `Adapter` interface
3. Add to `adapters` object in `src/adapters/index.ts`
4. Add config in `~/.puzldai/config.json`

### Adding a New Tool
1. Create `src/agentic/tools/[name].ts`
2. Implement `Tool` interface (name, description, parameters, execute)
3. Add to `allTools` in `src/agentic/tools/index.ts`
4. Update `MAX_ITERATIONS` if needed in `agent-loop.ts`

---

## File Locations

| Purpose | Path |
|---------|------|
| Implementation plan | `plan.md` |
| CLI entrypoint | `src/cli/index.ts` |
| TUI components | `src/tui/` |
| API server | `src/api/server.ts` |
| Configuration | `~/.puzldai/config.json` |
| Sessions DB | `~/.puzldai/sessions.db` |
| Game sessions DB | `~/.puzldai/game-sessions.db` |
| Templates | `~/.puzldai/templates/` |
| Logs | `~/.puzldai/logs/` |

---

## Execution Modes

| Mode | Description | Command |
|------|-------------|---------|
| **Do** | Auto-select best approach (recommended) | `pk-puzldai do "task"` |
| **Single** | One agent processes task | `pk-puzldai run "task"` |
| **Compare** | Multiple agents in parallel | `pk-puzldai compare "task"` |
| **Pipeline** | Chain agents: `gemini:analyze,claude:code` | `pk-puzldai run "task" -P "..."` |
| **Workflow** | Saved reusable pipeline | `pk-puzldai run "task" -T name` |
| **Orchestrate** | Intelligent multi-agent orchestration | `pk-puzldai orchestrate "task"` |
| **Autopilot** | LLM generates and executes plan | `pk-puzldai autopilot "task"` |
| **Correct** | Producer → Reviewer → Fix | `pk-puzldai correct "task"` |
| **Debate** | Agents argue in rounds | `pk-puzldai debate "topic"` |
| **Consensus** | Propose → Vote → Synthesize | `pk-puzldai consensus "task"` |
| **PickBuild** | Propose plans → Pick best → Implement | `pk-puzldai pickbuild "task"` |
| **Plan** | Analyze without execution | `pk-puzldai autopilot "task"` (no -x) |
| **Build** | Full tool access for implementation | `pk-puzldai agent -a claude` |
| **Ralph** | Plan-first iterative loop (Ralph Wiggum style) | `pk-puzldai ralph "task" --iters 5 --tests "npm test"` |
| **PK-Poet** | REASON+DISCOVER+ATTACK+FORTIFY+EXECUTE | `pk-puzldai pkpoet "task"` |
| **Poetiq** | Verification-first problem solving | `pk-puzldai poetiq "task"` |

---

## Additional CLI Commands

| Command | Purpose |
|---------|---------|
| `pk-puzldai interact "task"` | Interactive task runner (CLI approvals) |
| `pk-puzldai eval --full` | Evaluate approach selection and routing |
| `pk-puzldai observe summary` | Observation summary/export |
| `pk-puzldai tasks list` | Background task management |
| `pk-puzldai remember "note"` | Save or list memories |
| `pk-puzldai mcp-status` | MCP bridge status |
| `pk-puzldai login` | MCP login |
| `pk-puzldai whoami` | MCP login status |
| `pk-puzldai logout` | MCP logout |
| `pk-puzldai game <name>` | Play built-in games |

---

## Important Patterns

### Tool Name Aliases
LLMs may use various tool names (`read_file`, `file_read`, etc.). The system normalizes these to our tools:
- `read_file`, `cat`, `file_read` → `view`
- `find`, `list_files`, `ls` → `glob`
- `search`, `find_in_files` → `grep`
- `shell`, `run`, `execute` → `bash`

### Permission System
- Track auto-approvals: `allow_dir`, `allow_all_reads`, `allow_all_writes`, `allow_all_exec`
- Use `permissionTracker.isAutoApproved()` to check before asking
- Record approvals for future auto-approve

### Context Management
- Use `UnifiedMessage` format (preferred) for conversation history
- Context compaction available when token limits approached
- Use `prepareContextForAgent()` for proper formatting

### Diff Preview
- Single file: `onDiffPreview()` returns `'yes' | 'yes-all' | 'no'`
- Batch: `onBatchDiffPreview()` returns `{accepted: [], rejected: [], allowAll: boolean}`
- Deduplicate write/edit calls to same file

---

## Testing

Tests use Bun test framework (`bun test`).

**Test Files:**
- `src/agentic/agent-loop.test.ts` - Tool name normalization, parsing, permission categories
- `src/lib/stream-parser.test.ts` - Stream parsing tests

**Adding Tests:**
- Co-locate with source files (e.g., `foo.ts` → `foo.test.ts`)
- Mock adapters to avoid external API calls
- Run with `bun test` or `npm run test`

---

## Release/Publish

Triggered by GitHub release event (`.github/workflows/npm-publish.yml`):
1. Checkout code
2. Bun install
3. Build with `bun run build`
4. Publish to npm with `npm publish`

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Adapter unavailable | Run `pk-puzldai check` to verify CLI installation |
| Router fails | Ensure Ollama is running and `routerModel` is available |
| Token limits | Use context compaction, reduce history, or simplify prompts |
| Tool not found | Check `normalizeToolName()` aliases in `agent-loop.ts` |
| Permission loops | Check `permissionTracker` auto-approval state |

---

## Internal Utilities

### Adapter Runner

**File:** `src/lib/adapter-runner.ts`

The adapter runner is a utility for executing adapter calls with enhanced features:

**Features:**
- Timeout support (default: 120000ms)
- AbortSignal for cancellation
- Chunk streaming via `onChunk` callback
- Observation/telemetry integration
- Token tracking (tokensIn/tokensOut)
- Duration tracking
- Error logging with metrics

**Usage:**
```typescript
import { runAdapter } from './lib/adapter-runner';

const result = await runAdapter('claude', 'Your prompt', {
  model: 'sonnet',
  timeout: 60000,
  signal: abortController.signal,
  stepId: 'my-step',
  onChunk: (chunk) => console.log(chunk)
});

// Result includes:
// { content, model, error, duration, tokensIn, tokensOut }
```

**Telemetry Integration:**
- Automatically starts observation tracking
- Logs response with duration and token counts
- Tracks errors with metrics
- Integrates with observation layer for training data generation

---

## Provider Safety

For agentic mode, some providers are safer than others. See [PROVIDER_SUPPORT_MATRIX.md](PROVIDER_SUPPORT_MATRIX.md) for details:

| Provider | Agentic Safety | Notes |
|----------|----------------|-------|
| Claude | SAFE | Full permission system support |
| Ollama | SAFE | Local, no native file access |
| Mistral | SAFE | `disableTools: true` by default |
| Gemini | UNSAFE | Auto-reads files; use `gemini-safe` (default redirect) |
| Codex | UNSAFE | No approval layer; use `codex-safe` (default redirect) |
| Factory | CONDITIONAL | Depends on `autonomy` and `skipPermissions` config |
| Crush | CONDITIONAL | Depends on `autoAccept` config |
