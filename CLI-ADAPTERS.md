# CLI Tool Adapters

PuzldAI now includes adapters for external CLI-based AI coding tools, allowing you to integrate Factory AI's `droid` and Charm's `crush` alongside the built-in puzzle games.

## Overview

| Adapter | CLI Tool | Purpose | Status |
|---------|----------|---------|--------|
| `factory` | `droid` | Factory AI autonomous development agent | External |
| `crush` | `crush` | Charm Crush terminal-based AI coding agent | External |
| `codex` | `codex` | OpenAI Codex CLI (existing) | External |
| `factory-ai-droid` | Built-in | Resource management puzzle game | Built-in |
| `charm-crush` | Built-in | Match-3 puzzle game | Built-in |

## Installation

### Factory AI (droid)

Install Factory's CLI tool:

```bash
# macOS/Linux
curl -fsSL https://app.factory.ai/cli | sh

# Verify installation
which droid
```

### Charm Crush

Install Crush via your package manager:

```bash
# Homebrew (macOS/Linux)
brew install charmbracelet/tap/crush

# npm
npm install -g @charmbracelet/crush

# Verify installation
which crush
```

## Configuration

Edit `~/.puzldai/config.json` to enable the adapters:

```json
{
  "adapters": {
    "factory": {
      "enabled": true,
      "path": "droid",
      "model": "claude-3-5-sonnet-20241022"
    },
    "crush": {
      "enabled": true,
      "path": "crush",
      "model": "claude-3-5-sonnet-20241022"
    }
  }
}
```

### Configuration Options

**Factory Adapter:**
- `enabled`: Enable/disable the adapter (boolean)
- `path`: Path to the `droid` CLI executable (default: `"droid"`)
- `model`: AI model to use (optional, e.g., `"claude-3-5-sonnet-20241022"`, `"gpt-4"`)

**Crush Adapter:**
- `enabled`: Enable/disable the adapter (boolean)
- `path`: Path to the `crush` CLI executable (default: `"crush"`)
- `model`: AI model to use (optional)

## Usage

### Factory AI (droid)

Run tasks with Factory's autonomous agent:

```bash
# Direct invocation
pk-puzldai run "refactor the authentication module" --agent factory

# With specific model
pk-puzldai run "implement JWT refresh tokens" --agent factory --model gpt-4

# Auto-routing (will select factory if appropriate)
pk-puzldai run "migrate from REST to GraphQL"
```

**Key Features:**
- Autonomous multi-step task execution
- Contextual code understanding
- Built-in code review workflow
- Integration with Jira, Slack, Notion
- Specification mode for complex implementations

### Charm Crush

Run tasks with Charm's terminal-based coding agent:

```bash
# Direct invocation
pk-puzldai run "add dark mode support" --agent crush

# With specific model
pk-puzldai run "optimize database queries" --agent crush --model claude-3-opus

# Auto-routing
pk-puzldai run "fix the memory leak in the worker pool"
```

**Key Features:**
- LSP integration for code awareness
- MCP server support (stdio, HTTP, SSE)
- Multi-model support
- Session management per project
- Cross-platform compatibility

## Comparison with Built-in Games

The naming might be confusing, so here's the distinction:

### CLI Tool Adapters (External)
- **`factory`**: Calls the external `droid` CLI for real development work
- **`crush`**: Calls the external `crush` CLI for real development work
- **`codex`**: Calls the external `codex` CLI for real development work

### Built-in Puzzle Games
- **`factory-ai-droid`**: Built-in resource management puzzle game
- **`charm-crush`**: Built-in match-3 puzzle game

Use the game command for puzzles:
```bash
pk-puzldai game factory-ai-droid --new
pk-puzldai game charm-crush --new
```

Use the run command for actual development work:
```bash
pk-puzldai run "your task" --agent factory
pk-puzldai run "your task" --agent crush
```

## Auto-Routing

PuzldAI's router can automatically select the appropriate agent based on task characteristics:

```bash
# Router might select 'factory' for:
pk-puzldai run "perform a complete refactor of the API layer"
pk-puzldai run "migrate from MongoDB to PostgreSQL"

# Router might select 'crush' for:
pk-puzldai run "add comprehensive logging to the service"
pk-puzldai run "implement rate limiting middleware"
```

To configure routing confidence thresholds, edit `~/.puzldai/config.json`:

```json
{
  "defaultAgent": "auto",
  "confidenceThreshold": 0.6,
  "fallbackAgent": "claude"
}
```

## Troubleshooting

### Factory adapter not available

```bash
# Check if droid is installed
which droid

# Install if missing
curl -fsSL https://app.factory.ai/cli | sh

# Verify config
cat ~/.puzldai/config.json | grep -A 3 factory
```

### Crush adapter not available

```bash
# Check if crush is installed
which crush

# Install if missing (Homebrew)
brew install charmbracelet/crush

# Verify config
cat ~/.puzldai/config.json | grep -A 3 crush
```

### Permission Issues

```bash
# Ensure executables are accessible
chmod +x $(which droid)
chmod +x $(which crush)
```

## Advanced Configuration

### Model Selection Priority

Models can be specified at multiple levels (highest priority first):

1. Command-line flag: `--model gpt-4`
2. Adapter config: `"model": "claude-3-5-sonnet-20241022"`
3. Tool default: Uses the CLI tool's configured default

### Timeout Configuration

Adjust timeout for long-running tasks:

```json
{
  "timeout": 300000
}
```

The timeout value is in milliseconds (300000 = 5 minutes).

## Integration Examples

### Multi-Agent Workflows

Use different agents for different phases:

```bash
# Factory for architecture and implementation
pk-puzldai run "design and implement a caching layer" --agent factory

# Crush for refinement and optimization
pk-puzldai run "optimize the caching layer implementation" --agent crush

# Codex for testing
pk-puzldai run "write comprehensive tests for the cache" --agent codex
```

### Comparison Mode

Compare how different agents approach the same task:

```bash
pk-puzldai compare "implement a rate limiter" --agents factory,crush,codex
```

### Consensus Building

Get consensus across multiple agents:

```bash
pk-puzldai consensus "should we use Redis or Memcached for session storage?"
```

## API Reference

### Factory Adapter

```typescript
import { factoryAdapter } from './adapters/factory';

const response = await factoryAdapter.run(
  "refactor the authentication system",
  {
    model: "claude-3-5-sonnet-20241022",
    signal: abortSignal
  }
);
```

### Crush Adapter

```typescript
import { crushAdapter } from './adapters/crush';

const response = await crushAdapter.run(
  "add request validation middleware",
  {
    model: "gpt-4",
    signal: abortSignal
  }
);
```

## Resources

- **Factory AI Docs**: https://docs.factory.ai
- **Factory AI Quickstart**: https://docs.factory.ai/cli/getting-started/quickstart
- **Charm Crush GitHub**: https://github.com/charmbracelet/crush
- **PuzldAI Config Reference**: [config.ts](src/lib/config.ts)
- **Adapter Implementation**: [factory.ts](src/adapters/factory.ts), [crush.ts](src/adapters/crush.ts)

## Contributing

To add a new CLI tool adapter:

1. Create a new adapter file in `src/adapters/`
2. Implement the `Adapter` interface
3. Register in `src/adapters/index.ts`
4. Add config types in `src/lib/config.ts`
5. Update `RouteResult` type in `src/lib/types.ts`
6. Add tests and documentation

See [factory.ts](src/adapters/factory.ts) as a reference implementation.
