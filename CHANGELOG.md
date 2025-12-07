# Changelog

All notable changes to PuzldAI will be documented in this file.

## [Unreleased]

### Added - Phase 1: Foundation

#### Token Management Layer (`src/context/tokens.ts`)
- Token estimation using ~4 chars/token standard
- Per-adapter limits (Claude 100k, Gemini 128k, Codex 32k, Ollama 8k)
- Reserve tokens for response budget
- Smart truncation at paragraph/sentence boundaries
- Text chunking for scaffolding support
- Context usage tracking with percentage

#### Summarization Layer (`src/context/summarizer.ts`)
- Zero-cost compression using local Ollama
- Code block preservation (extract → summarize → restore)
- Graceful fallback to truncation if Ollama unavailable
- Skip-if-short optimization
- Key points extraction utility
- Compression ratio metrics

#### Context Window Manager (`src/context/window.ts`)
- Agent-specific context rules (Claude verbose, Ollama minimal)
- Priority-based compression (code priority 8, summaries priority 3)
- Dynamic Ollama model limits (llama3.1=128k, mixtral=32k)
- Structured context tags (`<code_context>`, `<previous_context>`)
- User override via config `maxTokens`

#### Pipeline Memory (`src/executor/memory.ts`)
- Auto-summarized step outputs
- Token-safe variable injection
- Key point extraction for tight budgets
- Memory stats tracking across steps
- Budget-aware output formatting

#### Semantic Relevance Scoring (`src/context/relevance.ts`)
- Embedding-based relevance via Ollama (nomic-embed-text)
- Keyword fallback using Jaccard similarity
- Recency scoring with linear decay
- Configurable weights (embedding vs keyword vs recency)
- `filterByRelevance()` and `getTopRelevant()` utilities

#### Session Manager (`src/memory/sessions.ts`)
- Persistent chat history to `~/.puzldai/sessions/`
- Auto-summarization when token limit reached
- Per-agent session isolation
- Token tracking per session
- Compression ratio stats

#### CLI Session Commands (`src/cli/commands/session.ts`)
- `puzld session list [agent]` — List all sessions
- `puzld session new [agent]` — Create a new session
- `puzld session info <id>` — View session details
- `puzld session delete <id>` — Remove a session
- `puzld session clear <id>` — Clear history, keep session

#### TUI Session Management (`src/tui/components/SessionsManager.tsx`)
- `/session` — Create new session directly
- `/resume` — Interactive picker with arrow navigation
- Menu: All Sessions / Current Agent Sessions
- Session detail view with stats
- Resume, Clear History, Delete actions
- Confirm dialogs default to "No" for safety

#### TUI Settings Panel (`src/tui/components/SettingsPanel.tsx`)
- `/settings` — Open tabbed settings panel
- **Status tab:** Version, current agent, router, planner
- **Session tab:** Active session info, message count, token usage, compression ratio
- **Config tab:** Toggle sequential, pick, auto-execute, interactive mode
- Tab to cycle, Enter/Space to toggle, Esc to exit

---

## [0.1.9] - 2024-12-07

### Added
- Auto-migration from `~/.pulzdai` to `~/.puzldai`
- `/planner` command in TUI for autopilot agent selection

### Fixed
- Autopilot error handling for plan result
- Config path consistency (pulzdai → puzldai)

## [0.1.8] - 2024-12-07

### Fixed
- Autopilot error when plan generation fails

## [0.1.7] - 2024-12-07

### Changed
- Config path updated to `~/.puzldai`
- Branding consistency fixes

## [0.1.6] - 2024-12-07

### Added
- `/planner` command in TUI

## [0.1.5] - 2024-12-07

### Added
- Compare mode screenshots
- Interface screenshot
- Dynamic version from package.json

### Fixed
- Logo URL for npm/GitHub display

## [0.1.0] - 2024-12-07

### Added
- Initial release
- Multi-agent orchestration (Claude, Gemini, Codex, Ollama)
- Compare mode with side-by-side, expanded, stacked views
- Pipeline mode for chaining agents
- Workflow mode with reusable templates
- Autopilot mode with AI-planned execution
- TUI with autocomplete and keyboard navigation
- CLI with full command support
- Auto-routing based on task type
