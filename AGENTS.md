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
| **Single** | One agent processes task | `pk-puzldai run "task"` |
| **Compare** | Multiple agents in parallel | `pk-puzldai compare "task"` |
| **Pipeline** | Chain agents: `gemini:analyze,claude:code` | `pk-puzldai run "task" -P "..."` |
| **Workflow** | Saved reusable pipeline | `pk-puzldai run "task" -T name` |
| **Autopilot** | LLM generates and executes plan | `pk-puzldai autopilot "task"` |
| **Correct** | Producer → Reviewer → Fix | `pk-puzldai correct "task"` |
| **Debate** | Agents argue in rounds | `pk-puzldai debate "topic"` |
| **Consensus** | Propose → Vote → Synthesize | `pk-puzldai consensus "task"` |
| **PickBuild** | Propose plans → Pick best → Implement | `pk-puzldai pickbuild "task"` |
| **Plan** | Analyze without execution | `pk-puzldai autopilot "task"` (no -x) |
| **Build** | Full tool access for implementation | `pk-puzldai agent -a claude` |

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

## Provider Safety

For agentic mode, some providers are safer than others. See [PROVIDER_SUPPORT_MATRIX.md](PROVIDER_SUPPORT_MATRIX.md) for details:

| Provider | Agentic Safety | Notes |
|----------|----------------|-------|
| Claude | SAFE | Full permission system support |
| Ollama | SAFE | Local, no native file access |
| Mistral | SAFE | `disableTools: true` by default |
| Gemini | UNSAFE | Auto-reads files, use `gemini-safe` |
| Codex | UNSAFE | No approval layer, use `codex-safe` |
| Factory | CONDITIONAL | Depends on `autonomy` and `skipPermissions` config |
| Crush | CONDITIONAL | Depends on `autoAccept` config |
