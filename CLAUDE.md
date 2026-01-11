# PuzldAI Project Guide

## Project Overview

**PuzldAI** is a multi-LLM orchestration framework that coordinates AI agents for complex tasks. It provides agentic execution, memory/RAG capabilities, and training data generation. The codebase is TypeScript-based, runs on Node.js 20+, and uses Bun for building.

**Core Capabilities:**
- Multi-agent orchestration of CLI coding tools:
  - **LLM Providers:** Claude, Gemini, Codex, Ollama, Mistral
  - **External CLI Tools:** Factory (droid), Charm Crush (crush)
- Agentic execution with tool access (view, glob, grep, bash, write, edit)
- Memory/RAG with SQLite FTS5 + optional LanceDB
- Multiple execution modes (compare, pipeline, debate, consensus, correction)
- Training data generation from user interactions
- Universal ExecutionPlan system for all workflows

**NOTE:** The `factory-ai-droid` and `charm-crush` game adapters are fun easter eggs for demonstrating the adapter pattern. When referring to "droid" or "crush" in production contexts, we mean the external CLI coding tools (`factory` and `crush` adapters).

---

## Architecture Layers

```
┌─────────────────────────────────────────┐
│   CLI/TUI Interface (src/cli, src/tui)  │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│   Orchestrator (src/orchestrator)       │
│   - Task routing                        │
│   - Agent selection                     │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│   Executor (src/executor)               │
│   - Universal ExecutionPlan execution   │
│   - Dependency management               │
│   - Timeline tracking                   │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│   Adapters (src/adapters)               │
│   - Provider abstractions               │
│   - Claude, Gemini, Codex, Ollama, etc. │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│   Infrastructure                         │
│   Memory | Indexing | Context | Router  │
└─────────────────────────────────────────┘
```

---

## Key Directories

### `src/adapters/`
**Purpose:** Abstract LLM provider differences

Each adapter implements the `Adapter` interface:
```typescript
interface Adapter {
  name: string;
  run(prompt: string, options?: RunOptions): Promise<ModelResponse>;
  isAvailable(): Promise<boolean>;
}
```

**Files:**
- `index.ts` - Adapter registry
- **LLM Adapters:**
  - `claude.ts`, `gemini.ts`, `codex.ts` - CLI-based LLM adapters
  - `ollama.ts` - Local Ollama integration
  - `mistral.ts` - Mistral AI integration
- **External CLI Tool Adapters:**
  - `factory.ts` - Factory AI (droid) CLI with configurable autonomy levels
  - `crush.ts` - Charm Crush CLI with auto-accept mode
- **Easter Egg Game Adapters** (demonstrating adapter pattern):
  - `factory-ai-droid.ts` - Resource management puzzle game
  - `charm-crush.ts` - Match-3 puzzle game

**Safety Note:** Factory and Crush adapters have configuration options that can bypass permission prompts. See [PROVIDER_SUPPORT_MATRIX.md](PROVIDER_SUPPORT_MATRIX.md) for safe configurations.

**Pattern for new adapters:**
1. Implement `Adapter` interface
2. Check availability in `isAvailable()`
3. Handle streaming via `options.onChunk`
4. Return `ModelResponse` with content, model, duration, tokens, error
5. Register in `adapters/index.ts`

### `src/executor/`
**Purpose:** Execute plans with dependency management

**Core Files:**
- `types.ts` - ExecutionPlan and PlanStep definitions
- `executor.ts` - Main execution engine
- `plan-builders.ts` - Converts modes to ExecutionPlans
- `context.ts` - Variable interpolation
- `templates.ts` - Pipeline template persistence

**ExecutionPlan Structure:**
```typescript
interface ExecutionPlan {
  id: string;
  mode: PlanMode; // 'single' | 'compare' | 'pipeline' | 'debate' | 'consensus' | 'pickbuild'
  prompt: string;
  steps: PlanStep[];
  context?: Record<string, unknown>;
}

interface PlanStep {
  id: string;
  agent: AgentName | 'auto';
  action: StepAction; // 'prompt' | 'analyze' | 'combine' | 'validate'
  prompt: string; // Can contain {{variables}}
  dependsOn?: string[]; // Dependency graph
  fallback?: AgentName;
  retries?: number;
  timeout?: number;
  outputAs?: string; // Store result with name
}
```

### `src/agentic/`
**Purpose:** LLM with tool access - the core differentiator

**Key Components:**
- `agent-loop.ts` - Main loop that iterates until tool calls complete
- `response-parser.ts` - Parse LLM tool call outputs
- `edit-extractor.ts` - Extract file edits from responses
- `file-executor.ts` - Apply diffs safely

**Tools Available (`tools/`):**
1. **view** - Read files (read permission)
2. **glob** - Find files by pattern (read permission)
3. **grep** - Search file contents (read permission)
4. **bash** - Execute shell commands (execute permission)
5. **write** - Create/overwrite files (write permission)
6. **edit** - Find-and-replace in files (write permission)

**Tool Pattern:**
```typescript
interface Tool {
  name: string;
  description: string;
  execute(args: Record<string, unknown>, cwd: string): Promise<ToolResult>;
}
```

### Windows/PowerShell Command Syntax

When running CLI tools in PowerShell, use proper Windows syntax to bypass permission system:

```powershell
# File creation - use Out-File
$content = "file content here"
$content | Out-File -FilePath filename.txt -Encoding UTF8

# Command chaining - use semicolons instead of &&
command1; command2; command3

# Multi-line scripts - use $script = @"...content..."@ syntax
$script = @"
line1
line2
line3
"@
$script | Out-File script.ps1

# Use PowerShell native cmdlets instead of bash equivalents
Get-Content    # instead of cat
Set-Content    # instead of echo > file
Get-ChildItem  # instead of ls
```

For Claude Code CLI with PowerShell, use:
```powershell
claude -p --output-format stream-json --verbose "your prompt"
```

### `src/memory/`
**Purpose:** Semantic search with SQLite FTS5 + optional LanceDB

**Files:**
- `vector-store.ts` - Memory item storage
- `embeddings.ts` - Auto-detect embeddings
- `database.ts` - SQLite FTS5 backend
- `retriever.ts` - Search & ranking
- `sessions.ts` - Conversation persistence
- `signals.ts` - Preference detection

**Memory Types:**
- `conversation` - Q&A pairs
- `decision` - Accepted file edits
- `code` - Code snippets and patterns
- `pattern` - Reusable solutions
- `context` - Contextual information

### `src/indexing/`
**Purpose:** AST parsing + dependency analysis

**Capabilities:**
- Parse TypeScript/JavaScript AST
- Build import/export relationships
- Create semantic embeddings
- Enable semantic search
- Auto-inject project instructions (AGENTS.md, CLAUDE.md, etc.)

### `src/router/`
**Purpose:** Intelligent task routing via LLM

Uses Ollama with configurable routing model to classify tasks:
- **Claude:** Complex coding, debugging, architecture
- **Gemini:** Analysis, research, documentation
- **Codex:** Quick code generation
- **Ollama:** Simple queries, local processing

Returns confidence score (default threshold: 0.6)

### `src/context/`
**Purpose:** Dynamic context injection

**Features:**
- Retrieve relevant context based on task
- Prioritize context by relevance (1=critical, 4=low)
- Token budget management
- Format adaptation per provider (XML for Claude, Markdown for others)
- Auto-summarization when needed

---

## Adding New Features

### Pattern 1: Add a New Adapter (e.g., Game Engine)

**File:** `src/adapters/new-adapter.ts`
```typescript
import type { Adapter, ModelResponse, RunOptions } from '../lib/types';

export const newAdapter: Adapter = {
  name: 'new-adapter',

  async isAvailable(): Promise<boolean> {
    // Check if service/CLI is available
    try {
      // Verify connection
      return true;
    } catch {
      return false;
    }
  },

  async run(prompt: string, options?: RunOptions): Promise<ModelResponse> {
    const startTime = Date.now();
    try {
      // Call your service/API with the prompt
      const response = await callService(prompt);

      return {
        content: response,
        model: 'new-adapter',
        duration: Date.now() - startTime
      };
    } catch (err: unknown) {
      return {
        content: '',
        model: 'new-adapter',
        duration: Date.now() - startTime,
        error: (err as Error).message
      };
    }
  }
};
```

**Register:** Update `src/adapters/index.ts`
```typescript
import { newAdapter } from './new-adapter';

export const adapters: Record<string, Adapter> = {
  // ...existing...
  'new-adapter': newAdapter,
};
```

**Update Types:** Add to `AgentName` in `src/executor/types.ts`
```typescript
type AgentName = 'claude' | 'gemini' | 'codex' | 'ollama' | 'mistral' | 'new-adapter';
```

### Pattern 2: Add a New Execution Mode

**File:** `src/executor/plan-builders.ts`

Add new builder function:
```typescript
export function buildCustomModePlan(
  prompt: string,
  options: CustomModeOptions
): ExecutionPlan {
  return {
    id: `custom_${Date.now()}`,
    mode: 'pipeline', // Or new custom mode
    prompt,
    steps: [
      {
        id: 'step1',
        agent: 'claude',
        action: 'prompt',
        prompt: 'Step 1 instructions'
      },
      {
        id: 'step2',
        agent: 'ollama',
        action: 'validate',
        prompt: 'Validate results from step 1',
        dependsOn: ['step1']
      }
    ]
  };
}
```

### Pattern 3: Add a New Tool

**File:** `src/agentic/tools/new-tool.ts`
```typescript
import type { Tool, ToolResult } from './types';

export const newTool: Tool = {
  name: 'new-tool',
  description: 'Description of what this tool does',

  async execute(
    args: Record<string, unknown>,
    cwd: string
  ): Promise<Omit<ToolResult, 'toolCallId'>> {
    try {
      // Tool implementation
      const result = await doSomething(args);

      return {
        content: JSON.stringify(result, null, 2),
        isError: false
      };
    } catch (err: unknown) {
      return {
        content: `Error: ${(err as Error).message}`,
        isError: true
      };
    }
  }
};
```

**Register:** Update `src/agentic/tools/index.ts`
```typescript
import { newTool } from './new-tool';

export const allTools: Tool[] = [
  // ...existing tools...
  newTool,
];
```

---

## Code Quality Standards

### DRY (Don't Repeat Yourself)
- Consolidate duplicate patterns into reusable functions after 2nd occurrence
- Extract common logic into shared utilities
- Use the executor's dependency system for repeated workflows

### Clean Code
- Delete dead code immediately (unused imports, functions, variables, commented code)
- Remove debug console.logs before committing
- Keep functions focused on single responsibility

### Leverage Packages
- Use battle-tested packages over custom implementations
- Current stack: commander, ink, better-sqlite3, ollama, ts-morph, execa

### Readable Code
- Maintain comments for complex logic
- Use clear, descriptive naming
- Don't sacrifice clarity for line count

---

## Configuration

**Location:** `~/.puzldai/config.json`

```typescript
interface PulzdConfig {
  defaultAgent: 'auto' | 'claude' | 'gemini' | 'codex' | 'ollama' | 'mistral';
  routerModel: string; // Default: 'llama3.2'
  timeout: number; // Default: 120000 (2 min)
  fallbackAgent: string; // Default: 'claude'
  confidenceThreshold: number; // Default: 0.6
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  adapters: {
    claude: { enabled: boolean; path: string; model?: string };
    gemini: { enabled: boolean; path: string; model?: string };
    codex: { enabled: boolean; path: string; model?: string };
    ollama: { enabled: boolean; model: string; host: string };
    mistral: { enabled: boolean; path: string; model?: string };
  };
}
```

To extend config with new features, update `src/lib/config.ts`

---

## CLI Commands

```bash
# Single task
pk-puzldai run <task>

# Compare agents
pk-puzldai compare <prompt>

# AI-planned workflow
pk-puzldai autopilot <task>

# Compare→Pick→Build workflow
pk-puzldai pickbuild <task> -a claude,gemini -i

# Correction mode
pk-puzldai correct <task> --producer X --reviewer Y

# Multi-agent debate
pk-puzldai debate <topic> -a X,Y -r N

# Consensus building
pk-puzldai consensus <task> -a X,Y,Z

# Template management
pk-puzldai template {list,show,create,edit,delete}

# Session management
pk-puzldai session {list,new,info,delete,clear}

# Codebase indexing
pk-puzldai index [path]

# Model configuration
pk-puzldai model {show,list,set,clear}

# API server
pk-puzldai serve [-p PORT] [-w]
```

To add new commands, create file in `src/cli/commands/` and register in `src/cli/index.ts`

---

## Build & Deploy

```bash
# Development
npm run dev

# Build
npm run build
# Output: dist/cli/index.js

# Test
npm run test

# Type checking
npm run typecheck
```

**Distribution:**
- Published to npm registry as `puzldai`
- Installed globally: `npm install -g puzldai`
- Entry points: `puzld`, `puzldai`

---

## Key Abstractions

### 1. The Adapter Pattern
Common interface for all LLM providers - easy to add new ones

### 2. ExecutionPlan Universal Unit
Every execution mode compiles to a plan - single executor handles all modes

### 3. Agent Loop Pattern
LLM → Tool Calls → Permission Checks → Tool Execution → LLM (repeat until done)

### 4. Memory-Driven Context
Retrieve relevant memories based on task → inject as context → track decisions

### 5. Dependency Graphs
Steps have `dependsOn` fields - executor respects dependencies and enables parallel execution

---

## Dependencies

**Core:**
- hono (4.11.1) - Lightweight web framework
- ink (6.5.1) - React-like terminal UI
- commander (12.1.0) - CLI argument parsing
- better-sqlite3 (12.5.0) - Embedded SQLite
- ollama (0.5.11) - Local LLM integration
- ts-morph (27.0.2) - TypeScript AST manipulation
- execa (9.5.1) - Shell execution

**Optional:**
- @lancedb/lancedb (0.22.3) - Vector database

---

## Testing

Run tests with:
```bash
bun test
# or
npm run test
```

Test files are co-located with source:
- `src/agentic/agent-loop.test.ts` - Tool name normalization, parsing, permission categories
- `src/lib/stream-parser.test.ts` - Stream parsing tests

---

## User Experience Philosophy

> **The architecture serves the user, not the other way around.**

When designing features:
1. **Aesthetically pleasing** - Clean, organized output
2. **Easy to understand** - Minimal explanation needed
3. **Abstract complexity** - Hide implementation details
4. **Empower users** - Give full control where needed

Examples:
- Interactive permission prompts with preview
- Tree-style result display
- Auto-complete with history
- Live execution timeline
- Model selection panel

---

## Common Patterns

### Running Multiple Agents in Parallel
```typescript
const plan: ExecutionPlan = {
  id: 'parallel_analysis',
  mode: 'compare',
  prompt: 'Analyze this code',
  steps: [
    { id: 'claude', agent: 'claude', action: 'prompt', prompt: '...' },
    { id: 'gemini', agent: 'gemini', action: 'prompt', prompt: '...' },
    { id: 'codex', agent: 'codex', action: 'prompt', prompt: '...' }
  ]
  // No dependsOn = parallel execution
};
```

### Sequential Pipeline with Context
```typescript
const plan: ExecutionPlan = {
  id: 'sequential_pipeline',
  mode: 'pipeline',
  prompt: 'Build feature',
  steps: [
    {
      id: 'plan',
      agent: 'claude',
      action: 'prompt',
      prompt: 'Create implementation plan',
      outputAs: 'plan'
    },
    {
      id: 'implement',
      agent: 'claude',
      action: 'prompt',
      prompt: 'Implement based on {{plan}}',
      dependsOn: ['plan']
    }
  ]
};
```

### Retry with Fallback
```typescript
{
  id: 'resilient_step',
  agent: 'claude',
  action: 'prompt',
  prompt: 'Complex task',
  fallback: 'gemini',
  retries: 3,
  timeout: 60000
}
```

### PickBuild Workflow (Compare→Pick→Build)
```typescript
import { buildPickBuildPlan } from './plan-builders';

const plan = buildPickBuildPlan('Add user authentication', {
  agents: ['claude', 'gemini'],      // Agents to propose plans
  picker: 'human',                    // Who picks: 'human' | AgentName
  buildAgent: 'claude',               // Agent to implement chosen plan
  reviewer: 'gemini',                 // Optional review step
  interactive: true,                  // Confirm risky operations
  format: 'json'                      // Plan output format
});
// Phases: propose → pick → build → review
```

---

## Future Extension Points

### Games Integration
PuzldAI's architecture naturally supports game integration:

**Option 1: Games as Adapters**
- Minimal code, reuses orchestration
- Games treated like LLM "agents"

**Option 2: Games as Execution Mode**
- Full executor features
- Memory tracking of strategies
- Agentic mode plays against game engine

**Option 3: Games as Full Subsystem**
- `src/games/` module
- Per-game implementations
- Multi-agent tournament support
- Strategy learning via memory system

---

## Provider Safety

For agentic mode, some providers have different safety profiles. See [PROVIDER_SUPPORT_MATRIX.md](PROVIDER_SUPPORT_MATRIX.md) for full details:

| Provider | Agentic Safety | Notes |
|----------|----------------|-------|
| Claude | SAFE | Full permission system support |
| Ollama | SAFE | Local, no native file access |
| Mistral | SAFE | `disableTools: true` by default |
| Gemini | UNSAFE | Auto-reads files, use `gemini-safe` |
| Codex | UNSAFE | No approval layer, use `codex-safe` |
| Factory | CONDITIONAL | Depends on `autonomy` and `skipPermissions` config |
| Crush | CONDITIONAL | Depends on `autoAccept` config |

---

## License

AGPL-3.0-only

---

## Repository

https://github.com/kingkillery/Puzld.ai
