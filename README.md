<p align="center">
  <img src="https://unpkg.com/pk-puzldai@latest/assets/logo.jpg" width="300" alt="PuzldAI">
</p>

<p align="center">
  <strong>Multi-LLM orchestration with agentic execution, memory, and training data generation.</strong>
</p>

<p align="center">
  <a href="#install">Install</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#features">Features</a> •
  <a href="#configuration">Config</a>
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/puzldai?color=blue" alt="npm">
  <img src="https://img.shields.io/badge/license-AGPL--3.0-green" alt="license">
  <img src="https://img.shields.io/badge/agents-Claude%20%7C%20Gemini%20%7C%20Codex%20%7C%20Ollama%20%7C%20Mistral-purple" alt="agents">
  <img src="https://img.shields.io/badge/models-sonnet%20%7C%20opus%20%7C%20gemini--pro%20%7C%20devstral-orange" alt="models">
  <img src="https://github.com/kingkillery/Puzld.ai/workflows/CI/badge.svg" alt="CI">
</p>

---

> **Beyond CLI wrappers.** PuzldAI is a complete AI orchestration framework — route tasks, explore codebases, execute file edits, build memory, and generate training data.

PuzldAI is a terminal-native framework for orchestrating multiple AI agents. Route tasks to the best agent, compare responses, chain agents in pipelines, or let them collaborate. **Agentic Mode** gives LLMs tools to explore your codebase (view, glob, grep, bash) and propose file edits with permission prompts — like Claude Code, but for any LLM. **Memory/RAG** stores decisions and code for future context. **Observation Layer** logs everything for DPO fine-tuning. One framework that grows with your AI workflow.

---

## Why PuzldAI?

| Problem | Solution |
|---------|----------|
| Claude is great at code, Gemini at research | **Auto-routing** picks the best agent |
| Need specific model versions | **Model selection** — pick sonnet, opus, haiku, etc. |
| Want multiple opinions | **Compare mode** runs all agents in parallel |
| Complex tasks need multiple steps | **Pipelines** chain agents together |
| Repetitive workflows | **Workflows** save and reuse pipelines |
| Need agents to review each other | **Collaboration** — correct, debate, consensus |
| Want LLM to explore & edit files safely | **Agentic mode** — tools, permission prompts, apply |
| Context gets lost between sessions | **Memory/RAG** — semantic retrieval of past decisions |
| Need data to fine-tune models | **Observations** — export DPO training pairs |
| Need AI to understand your codebase | **Indexing** — AST parsing, semantic search, AGENTS.md |

---

## Features

- **Auto-routing** — Ask anything. The right agent answers.
- **Model Selection** — Pick specific models per agent (sonnet, opus, haiku, etc.)
- **Compare** — Same question, multiple agents, side-by-side.
- **Pipelines** — Chain agents on-the-fly: `gemini:analyze → claude:code` (CLI)
- **Workflows** — Save pipelines as templates, run anywhere (TUI & CLI)
- **Autopilot** — Describe the goal. AI builds the plan.
- **Multi-Agent Collaboration** — Correct, debate, and build consensus across agents.
- **Agentic Mode** — LLMs explore your codebase, propose edits, you approve with permission prompts.
- **Codebase Indexing** — AST parsing, semantic search, AGENTS.md support.
- **Memory/RAG** — Semantic retrieval injects relevant context into prompts.
- **Observation Layer** — Logs all interactions for training data generation.
- **Sessions** — Persist chat history, resume conversations.
- **TUI** — Full terminal UI with autocomplete, history, keyboard nav.

---

## Supported Agents

| Agent | Source | Requirement | Agentic Mode | Safety |
|-------|--------|-------------|--------------|--------|
| Claude | Anthropic | [Claude CLI](https://docs.anthropic.com) | ✅ Full support | SAFE |
| Ollama | Local | [Ollama](https://ollama.ai) running | ✅ Full support | SAFE |
| Mistral | Mistral AI | [Vibe CLI](https://github.com/mistralai/vibe) | ✅ Full support | SAFE |
| Gemini | Google | [Gemini CLI](https://ai.google.dev) | ⚠️ Auto-reads files | Use `gemini-safe` |
| Codex | OpenAI | [Codex CLI](https://openai.com) | ⚠️ Auto-reads files | Use `codex-safe` |

> **Safety Note:** Claude, Ollama, and Mistral respect our permission system fully. Gemini and Codex auto-read files - use their `-safe` wrapper adapters for production. See [PROVIDER_SUPPORT_MATRIX.md](PROVIDER_SUPPORT_MATRIX.md) for details.
>
> **Orchestration Modes:** See [MODES.md](MODES.md) for comprehensive documentation of all orchestration modes, workflows, and CLI examples.

---

## Install

```bash
npm install -g pk-puzldai
```

Or try without installing:

```bash
npx pk-puzldai
```

**Update:**

```bash
npm update -g pk-puzldai
```

---

## Quick Start

```bash
# Interactive TUI
pk-puzldai

# Single task
pk-puzldai run "explain recursion"

# Compare agents
pk-puzldai compare claude,gemini "best error handling practices"

# Pipeline: analyze → code → review
pk-puzldai run "build a logger" -P "gemini:analyze,claude:code,gemini:review"

# Multi-agent collaboration
pk-puzldai correct "write a sort function" --producer claude --reviewer gemini
pk-puzldai debate "microservices vs monolith" -a claude,gemini
pk-puzldai consensus "best database choice" -a claude,gemini,ollama

# Compare→Pick→Build: propose plans, select best, implement
pk-puzldai pickbuild "add user authentication" -a claude,gemini -i

# Check what's available
pk-puzldai check
```

> `pk-puzldai` is the CLI entrypoint.

---

## Interface

<p align="center">
  <img src="https://raw.githubusercontent.com/kingkillery/Puzld.ai/main/assets/interface/TUI.png" width="700" alt="PuzldAI TUI">
</p>

---

## Execution Modes

| Mode | Pattern | Use Case | Category |
|------|---------|----------|----------|
| **Single** | One agent processes task | Quick questions, simple tasks | Basic |
| **Compare** | Same task → multiple agents in parallel | See different perspectives | Parallel |
| **Pipeline** | Agent A → Agent B → Agent C | Multi-step processing | Sequencing |
| **Workflow** | Saved pipeline, reusable | Repeatable workflows | Sequencing |
| **Autopilot** | LLM generates plan → executes | Complex tasks, unknown steps | AI Planning |
| **Correct** | Producer → Reviewer → Fix | Quality assurance, code review | Collaboration |
| **Debate** | Agents argue in rounds, optional moderator | Find flaws in reasoning | Collaboration |
| **Consensus** | Propose → Vote → Synthesize | High-confidence answers | Collaboration |
| **PickBuild** | Propose plans → Pick best → Implement with tools | Strategic planning + safe execution | Orchestration |
| **Agentic** | LLM explores → Tools → Permission prompts → Apply | Codebase exploration + file edits | Execution |
| **Plan** | LLM analyzes task → Describes approach | Planning before implementation | Execution |
| **Build** | LLM explores + edits with full tool access | Direct implementation with tools | Execution |

### Mode Options

| Mode | Option | Type | Default | Description |
|------|--------|------|---------|-------------|
| Single | `agent` | AgentName | `auto` | Which agent to use |
| | `model` | string | — | Override model (e.g., sonnet, opus) |
| Compare | `agents` | AgentName[] | — | Agents to compare (min 2) |
| | `sequential` | boolean | `false` | Run one-at-a-time vs parallel |
| | `pick` | boolean | `false` | LLM selects best response |
| Pipeline | `steps` | PipelineStep[] | — | Sequence of agent:action |
| | `interactive` | boolean | `false` | Confirm between steps |
| Workflow | `name` | string | — | Workflow to load |
| | `interactive` | boolean | `false` | Confirm between steps |
| Autopilot | `planner` | AgentName | `ollama` | Agent that generates plan |
| | `execute` | boolean | `false` | Auto-run generated plan |
| Correct | `producer` | AgentName | `auto` | Agent that creates output |
| | `reviewer` | AgentName | `auto` | Agent that critiques |
| | `fixAfterReview` | boolean | `false` | Producer fixes based on review |
| Debate | `agents` | AgentName[] | — | Debating agents (min 2) |
| | `rounds` | number | `2` | Number of debate rounds |
| | `moderator` | AgentName | `none` | Synthesizes final conclusion |
| Consensus | `agents` | AgentName[] | — | Participating agents (min 2) |
| | `maxRounds` | number | `2` | Voting rounds |
| | `synthesizer` | AgentName | `auto` | Creates final output |
| PickBuild | `agents` | AgentName[] | `claude,gemini` | Agents to propose plans |
| | `picker` | AgentName\|`human` | `human` | Who selects the winning plan |
| | `buildAgent` | AgentName | `claude` | Agent to implement selected plan |
| | `reviewer` | AgentName | — | Optional review agent |
| | `sequential` | boolean | `false` | Run proposers sequentially |
| | `format` | `json`\|`md` | `json` | Plan output format |
| | `interactive` | boolean | `false` | Confirm plan pick + risky ops |
| Agentic | `agent` | AgentName | `claude` | Agent to use for exploration |
| | `tools` | string[] | all | Available tools (view, glob, grep, bash, write, edit) |
| Plan | `agent` | AgentName | `claude` | Agent to analyze task |
| Build | `agent` | AgentName | `claude` | Agent to implement |

### Model Selection

Pick specific models for each agent. Aliases like `sonnet`, `opus`, `haiku` always point to the latest version. Specific versions like `claude-sonnet-4-20250514` are pinned.

```bash
# TUI
/model                            # Open model selection panel

# CLI
pk-puzldai model show                # Show current models for all agents
pk-puzldai model list                # List all available models
pk-puzldai model list claude         # List models for specific agent
pk-puzldai model set claude opus     # Set model for an agent
pk-puzldai model clear claude        # Reset to CLI default

# Per-task override
pk-puzldai run "task" -m opus        # Override model for this run
pk-puzldai agent -a claude -m haiku  # Interactive mode with specific model
```

<p align="center">
  <img src="https://raw.githubusercontent.com/kingkillery/Puzld.ai/main/assets/Models/Model-change.gif" width="700" alt="Model Selection">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/kingkillery/Puzld.ai/main/assets/Models/model-change.png" width="700" alt="Model Change">
</p>

---

## Compare Mode

Run the same prompt on multiple agents and compare results side-by-side.

Three views: **side-by-side**, **expanded**, or **stacked**.

```bash
# TUI
/compare claude,gemini "explain async/await"
/sequential                    # Toggle: run one-at-a-time
/pick                          # Toggle: select best response

# CLI
pk-puzldai compare "task"                          # Default: claude,gemini
pk-puzldai compare "task" -a claude,gemini,codex   # Specify agents
pk-puzldai compare "task" -s                       # Sequential mode
pk-puzldai compare "task" -p                       # Pick best response
```

<p align="center">
  <img src="https://raw.githubusercontent.com/kingkillery/Puzld.ai/main/assets/compare-mode/compare-mode-1.gif" width="700" alt="Compare Mode 1">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/kingkillery/Puzld.ai/main/assets/compare-mode/compare-mode-2.gif" width="700" alt="Compare Mode 2">
</p>

---

## Pipeline Mode (CLI)

Chain multiple agents together for complex tasks. Each agent handles a specific step.

```bash
pk-puzldai run "build a REST API" -P "gemini:analyze,claude:code,gemini:review"
pk-puzldai run "task" -P "claude:plan,codex:code" -i   # Interactive: pause between steps
```

<p align="center">
  <img src="https://raw.githubusercontent.com/kingkillery/Puzld.ai/main/assets/pipeline-mode/1.png" width="700" alt="Pipeline Mode">
</p>

---

## Workflow Mode

Save pipelines as reusable templates. Run them anywhere with a single command.

Three views: **side-by-side**, **expanded**, or **stacked**.

```bash
# TUI
/workflow code-review "my code here"
/workflows                     # Manage templates (interactive)
/interactive                   # Toggle: pause between steps

# CLI
pk-puzldai run "task" -T code-review
pk-puzldai run "task" -T code-review -i   # Interactive mode
pk-puzldai template list            # List all templates
pk-puzldai template show my-flow    # Show template details
pk-puzldai template create my-flow -P "claude:plan,codex:code"
pk-puzldai template delete my-flow  # Delete template
```

<p align="center">
  <img src="https://raw.githubusercontent.com/kingkillery/Puzld.ai/main/assets/workflow-mode/1.png" width="700" alt="Workflow Mode 1">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/kingkillery/Puzld.ai/main/assets/workflow-mode/2.png" width="700" alt="Workflow Mode 2">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/kingkillery/Puzld.ai/main/assets/workflow-mode/3.png" width="700" alt="Workflow Mode 3">
</p>

---

## Autopilot Mode

Describe the goal. AI analyzes the task, builds a multi-step plan, and executes it automatically using the best agents for each step.

With `/execute` enabled, results display in **3 view modes**: side-by-side, expanded, or stacked.

```bash
# TUI
/autopilot "build a todo app with authentication"
/planner claude                # Set planner agent
/execute                       # Toggle auto-execution on/off

# CLI
pk-puzldai autopilot "task"              # Generate plan only
pk-puzldai autopilot "task" -x           # Generate and execute
pk-puzldai autopilot "task" -p claude    # Use specific agent as planner
```

<p align="center">
  <img src="https://raw.githubusercontent.com/kingkillery/Puzld.ai/main/assets/autopilot-mode/autopilot-mode.gif" width="700" alt="Autopilot Mode">
</p>

---

## Multi-Agent Collaboration

Get multiple agents to work together through correction, debate, or consensus.

### Correct Mode

One agent produces, another reviews. Optionally fix based on feedback.

```bash
# TUI
/correct claude gemini "write a sorting algorithm"

# CLI
pk-puzldai correct "task" --producer claude --reviewer gemini
pk-puzldai correct "task" --producer claude --reviewer gemini --fix
```

<p align="center">
  <img src="https://raw.githubusercontent.com/kingkillery/Puzld.ai/main/assets/correct-mode/correct-mode.gif" width="700" alt="Correct Mode">
</p>

### Debate Mode

Agents debate a topic across multiple rounds. Optional moderator summarizes.

```bash
# TUI
/debate claude,gemini "Is functional programming better than OOP?"

# CLI
pk-puzldai debate "topic" -a claude,gemini
pk-puzldai debate "topic" -a claude,gemini -r 3 -m ollama   # 3 rounds + moderator
```

<p align="center">
  <img src="https://raw.githubusercontent.com/kingkillery/Puzld.ai/main/assets/Debate%20mode/Debate%20mode.png" width="700" alt="Debate Mode">
</p>

### Consensus Mode

Agents propose solutions, vote on them, and synthesize a final answer.

```bash
# TUI
/consensus claude,gemini,ollama "best database for this use case"

# CLI
pk-puzldai consensus "task" -a claude,gemini,ollama
pk-puzldai consensus "task" -a claude,gemini -r 3 -s claude   # 3 rounds + synthesizer
```

<p align="center">
  <img src="https://raw.githubusercontent.com/kingkillery/Puzld.ai/main/assets/consensus-mode/consensus-mode.png" width="700" alt="Consensus Mode">
</p>

All collaboration modes support **3 view modes**: side-by-side, expanded, and stacked.

Configure rounds, moderator, and synthesizer in `/settings`.

---

## Agentic Mode

LLMs explore your codebase using tools, then propose file edits with permission prompts (like Claude Code). PuzldAI acts as the execution layer — the LLM explores and proposes, you approve what gets executed.

```bash
# TUI - Use @agent syntax to trigger agentic mode
@claude fix the bug in src/utils.ts
@gemini add error handling to api/routes.ts
@ollama create a hello world script

# Or use commands
/plan @claude refactor the auth system      # Plan only (no execution)
/build @claude implement the login form     # Full implementation with tools
```

**Tools available to LLM:**
| Tool | Description |
|------|-------------|
| `view` | Read file contents with line numbers |
| `glob` | Find files by pattern (e.g., `**/*.ts`) |
| `grep` | Search file contents with regex |
| `bash` | Execute shell commands |
| `write` | Create or overwrite files |
| `edit` | Search and replace in files |

**Permission prompts (like Claude Code):**
- `Allow` — Execute this tool call
- `Allow from directory` — Auto-approve reads from this directory
- `Allow all reads` — Auto-approve all file reads
- `Deny` — Skip this tool call
- `Esc` — Cancel entire operation

**Live tool activity:**
- Colored status dots: ● green (done), yellow (running), red (error), gray (pending)
- Tree-style result display with truncation
- `Ctrl+S` to expand/collapse full output

**How it works:**
1. You describe the task with `@agent`
2. LLM explores codebase using tools (view, glob, grep)
3. Each tool call shows a permission prompt
4. LLM proposes file edits (write, edit)
5. You approve or deny each change
6. PuzldAI applies approved changes

**Consensus → Agentic workflow:**
Run consensus first, then continue with an agent. The consensus result is automatically injected as context:
```bash
/consensus claude,gemini "best approach for auth"
# Choose "Continue"
@claude implement this    # Has consensus context
```

---

## Memory & Context

PuzldAI includes a memory system that stores conversations, decisions, and code patterns for future retrieval.

**Memory types:**
- `conversation` — Q&A pairs from sessions
- `decision` — Accepted file edits and explanations
- `code` — Code snippets and patterns
- `pattern` — Reusable solutions

**How it works:**
- Observations from `/agentic` are automatically saved to memory
- When you accept file edits, the decision is stored for future context
- Semantic search retrieves relevant memories for new prompts
- Uses SQLite FTS5 (zero dependencies) or Ollama embeddings when available

**Embedding models (auto-detected):**
- `nomic-embed-text` (recommended)
- `mxbai-embed-large`
- `all-minilm`

---

## Observation Layer

All `/agentic` interactions are logged for training data generation:

- **Inputs:** Prompts, injected context, agent/model used
- **Outputs:** LLM responses, proposed files, explanations
- **Decisions:** Which files were accepted/rejected
- **Edits:** User modifications to proposed content

**Export for fine-tuning:**

```typescript
import { exportObservations, exportPreferencePairs } from 'pk-puzldai/observation';

// Export all observations as JSONL
exportObservations({ outputPath: 'observations.jsonl', format: 'jsonl' });

// Export DPO training pairs (chosen vs rejected)
exportPreferencePairs({ outputPath: 'preferences.jsonl', format: 'jsonl' });
```

**DPO pair types:**
- `accept_reject` — User accepted some files, rejected others
- `user_edit` — User modified the LLM's proposed content
- `full_reject` — User rejected all proposed files

---

## Codebase Indexing

Index your codebase for semantic search and automatic context injection.

```bash
# TUI
/index                    # Open indexing panel
/index search "auth"      # Search indexed code

# CLI
pk-puzldai index               # Index current directory
pk-puzldai index --quick       # Skip embeddings (faster)
pk-puzldai index --search "handleLogin"
pk-puzldai index --context "fix auth bug"
pk-puzldai index --config      # Show detected config files
pk-puzldai index --graph       # Show dependency graph
```

**What gets indexed:**
- Functions, classes, interfaces, types
- Import/export relationships
- File dependencies with tsconfig path alias support

**Project instructions (auto-injected into prompts):**
- `AGENTS.md` — Project-wide instructions
- `CLAUDE.md`, `CODEX.md` — Agent-specific instructions
- `.cursorrules`, `copilot-instructions.md` — IDE rules
- `.puzldai/agents/*.md` — Per-agent instructions

When you run `/agentic`, project instructions are automatically injected into the prompt.

---

## Commands

### TUI Mode

```
/compare claude,gemini "task"   Compare agents side-by-side
/autopilot "task"               AI-planned workflow
/workflow code-review "code"    Run saved workflow
/workflows                      Manage templates

/correct claude gemini "task"   Cross-agent correction
/debate claude,gemini "topic"   Multi-agent debate
/consensus claude,gemini "task" Build consensus

@claude "task"                  Agentic mode with Claude
@gemini "task"                  Agentic mode with Gemini
/plan @claude "task"            Plan mode (analyze, no execution)
/build @claude "task"           Build mode (full tool access)

/index                          Codebase indexing options
/index search "query"           Search indexed code

/session                        Start new session
/resume                         Resume previous session
/settings                       Open settings panel
/changelog                      Show version history

/agent claude                   Switch agent
/model                          Model selection panel
/router ollama                  Set routing agent
/planner claude                 Set autopilot planner
/sequential                     Toggle: compare one-at-a-time
/pick                           Toggle: select best from compare
/execute                        Toggle: auto-run autopilot plans
/interactive                    Toggle: pause between steps
/help                           All commands
```

### CLI Mode

```bash
pk-puzldai                           # Launch TUI
pk-puzldai run "task"                # Single task
pk-puzldai run "task" -a claude      # Force agent
pk-puzldai run "task" -m opus        # Override model
pk-puzldai run "task" -P "..."       # Pipeline
pk-puzldai run "task" -T template    # Use template
pk-puzldai run "task" -i             # Interactive: pause between steps
pk-puzldai compare "task"            # Compare (default: claude,gemini)
pk-puzldai compare "task" -a a,b,c   # Specify agents
pk-puzldai compare "task" -s         # Sequential mode
pk-puzldai compare "task" -p         # Pick best response
pk-puzldai autopilot "task"          # Generate plan
pk-puzldai autopilot "task" -x       # Plan + execute
pk-puzldai autopilot "task" -p claude # Use specific planner
pk-puzldai correct "task" --producer claude --reviewer gemini
pk-puzldai correct "task" --producer claude --reviewer gemini --fix
pk-puzldai debate "topic" -a claude,gemini -r 3 -m ollama
pk-puzldai consensus "task" -a claude,gemini -r 3 -s claude
pk-puzldai session list              # List sessions
pk-puzldai session new               # Create new session
pk-puzldai check                     # Agent status
pk-puzldai agent                     # Interactive agent mode
pk-puzldai agent -a claude           # Force specific agent
pk-puzldai agent -m sonnet           # With specific model
pk-puzldai model show                # Show current models
pk-puzldai model list                # List available models
pk-puzldai model set claude opus     # Set model for agent
pk-puzldai model clear claude        # Reset to CLI default
pk-puzldai serve                     # API server
pk-puzldai serve -p 8080             # Custom port
pk-puzldai serve -w                  # With web terminal
pk-puzldai template list             # List templates
pk-puzldai template show <name>      # Show template details
pk-puzldai template create <name> -P "..." -d "desc"
pk-puzldai template edit <name>      # Edit template
pk-puzldai template delete <name>    # Delete template
pk-puzldai index                     # Index codebase
pk-puzldai index --quick             # Skip embeddings
pk-puzldai index --search "query"    # Search indexed code
pk-puzldai index --context "task"    # Get relevant context
pk-puzldai index --config            # Show project config
```

---

## Configuration

`~/.puzldai/config.json`

```json
{
  "defaultAgent": "auto",
  "fallbackAgent": "claude",
  "routerModel": "llama3.2",
  "adapters": {
    "claude": { "enabled": true, "path": "claude", "model": "sonnet" },
    "gemini": { "enabled": true, "path": "gemini", "model": "gemini-2.5-pro" },
    "codex": { "enabled": false, "path": "codex", "model": "gpt-5.1-codex" },
    "ollama": { "enabled": true, "model": "llama3.2" },
    "mistral": { "enabled": true, "path": "vibe" }
  }
}
```

---

## Architecture

```
User Input (@claude "fix bug")
    │
    ▼
┌─────────┐     ┌────────────┐     ┌──────────┐
│ CLI/TUI │────▶│ Orchestrator│────▶│ Adapters │
└─────────┘     └────────────┘     └──────────┘
                      │                  │
        ┌─────────────┼─────────────┐    │
        ▼             ▼             ▼    ▼
 ┌───────────┐ ┌───────────┐ ┌──────────────┐
 │  Router   │ │  Memory   │ │   Agents     │
 │ (Ollama)  │ │  (RAG)    │ │ Claude       │
 └───────────┘ └───────────┘ │ Gemini       │
        │             │      │ Codex        │
        ▼             ▼      │ Ollama       │
 ┌───────────┐ ┌───────────┐ │ Mistral      │
 │ Indexing  │ │Observation│ └──────────────┘
 │ (AST/FTS) │ │  Logger   │
 └───────────┘ └───────────┘
        │             │
        ▼             ▼
 ┌───────────────────────────────┐
 │        Agent Loop             │
 │  LLM ──▶ Tool Call ──▶ Result │
 │   ▲           │          │    │
 │   │     ┌─────▼─────┐    │    │
 │   │     │ Permission│    │    │
 │   │     │  Prompts  │    │    │
 │   │     └───────────┘    │    │
 │   └──────────────────────┘    │
 └───────────────────────────────┘
        │             │
        ▼             ▼
 ┌───────────┐ ┌───────────┐
 │   Diff    │ │  Export   │
 │  Review   │ │  (DPO)    │
 └───────────┘ └───────────┘
```

---

## Authentication & Privacy

PuzldAI doesn't handle your AI credentials directly. Instead, it orchestrates the official CLI tools you already have installed:

| What PuzldAI Does | What PuzldAI Doesn't Do |
|-------------------|-------------------------|
| Calls `claude`, `gemini`, `codex` binaries | Store your API keys |
| Passes prompts, receives responses | Handle OAuth flows |
| Respects each CLI's auth state | Piggyback on private OAuth clients |

**Why this matters:**

- **No credential exposure** — Your tokens stay with the official CLIs
- **No piggybacking** — We don't borrow OAuth client IDs or reverse-engineer auth endpoints
- **No terms violations** — We use CLIs exactly as their creators intended
- **Always up-to-date** — When CLIs update their auth, you get it automatically
- **Your auth, your control** — Log in once per CLI, PuzldAI just orchestrates

Some tools bypass official CLIs to call APIs directly using piggybacked credentials or unofficial OAuth flows. PuzldAI takes a different approach: we wrap the tools you trust, nothing more.

---

## Development

```bash
git clone https://github.com/kingkillery/Puzld.ai.git
cd Puzld.ai
bun install
bun run build
npm link
pk-puzldai
```

---

## Contributing

Pull requests welcome! Please ensure your changes pass the build before submitting.

---

## License

**AGPL-3.0-only** — See [LICENSE](./LICENSE)

---

<p align="center">
  <sub>Built by <a href="https://github.com/MedChaouch">Med Chaouch</a></sub>
</p>
