<p align="center">
  <img src="https://raw.githubusercontent.com/MedChaouch/Puzld.ai/main/assets/logo.jpg" alt="PuzldAI" width="200">
</p>

<h1 align="center">PuzldAI</h1>

<p align="center">
  Multi-LLM orchestration CLI — route tasks intelligently across Claude, Gemini, Codex, and local models.
</p>

## Install

```bash
npm install -g puzldai
```

## Or run without install

```bash
npx puzldai
```

## Usage

```bash
# Launch interactive TUI
puzld

# Run a single task
puzld run "explain recursion"

# Compare multiple agents
puzld compare claude,gemini "best practice for error handling"

# Run a workflow
puzld run -T code-review "function add(a, b) { return a + b; }"

# Generate and execute a plan
puzld plan "build a REST API for todos" -x

# Check available agents
puzld check
```

## Features

- **Auto-routing** — Automatically selects the best agent for each task
- **Multi-agent compare** — Run the same task on multiple agents side-by-side
- **Pipelines** — Chain agents together (e.g., `gemini:analyze,claude:code`)
- **Workflows** — Save and reuse pipeline templates
- **Autopilot** — AI-generated execution plans
- **Interactive TUI** — Full terminal UI with autocomplete and keyboard navigation

## Supported Agents

| Agent | Source | Requirements |
|-------|--------|--------------|
| Claude | Anthropic | [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) |
| Gemini | Google | [Gemini CLI](https://github.com/google-gemini/gemini-cli) |
| Codex | OpenAI | [Codex CLI](https://github.com/openai/codex) |
| Ollama | Local | [Ollama](https://ollama.ai) running locally |

## Configuration

Config stored at `~/.pulzdai/config.json`

```json
{
  "defaultAgent": "auto",
  "routerModel": "llama3.2",
  "fallbackAgent": "claude",
  "adapters": {
    "claude": { "enabled": true, "path": "claude" },
    "gemini": { "enabled": true, "path": "gemini" },
    "codex": { "enabled": false, "path": "codex" },
    "ollama": { "enabled": true, "model": "llama3.2", "host": "http://localhost:11434" }
  }
}
```

## TUI Commands

| Command | Description |
|---------|-------------|
| `/compare <agents> <task>` | Compare agents side-by-side |
| `/autopilot <task>` | AI-generated execution plan |
| `/workflow <name> <task>` | Run a saved workflow |
| `/workflows` | Manage workflows (interactive) |
| `/agent [name]` | Show/set current agent |
| `/help` | Show all commands |
| `/clear` | Clear chat history |
| `/exit` | Exit |

## CLI Commands

```bash
puzld                     # Launch TUI
puzld run <task>          # Run a task
puzld compare <agents>    # Compare agents
puzld plan <task>         # Generate plan
puzld check               # Check agent availability
puzld serve               # Start API server
puzld template list       # List workflow templates
```

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   CLI/TUI   │────▶│  Orchestrator │────▶│   Adapters  │
└─────────────┘     └──────────────┘     └─────────────┘
                           │                    │
                           ▼                    ▼
                    ┌──────────────┐     ┌─────────────┐
                    │ Local Router │     │ Claude      │
                    │   (Ollama)   │     │ Gemini      │
                    └──────────────┘     │ Codex       │
                                         │ Ollama      │
                                         └─────────────┘
```

## Development

```bash
# Clone
git clone https://github.com/MedChaouch/Puzld.ai.git
cd puzldai

# Install dependencies
bun install

# Build
bun run build

# Test locally
npm link
puzld
```

## License

AGPL-3.0-only — See [LICENSE](LICENSE) for details.

## Contributing

Pull requests welcome! Please ensure your changes pass the build before submitting.
