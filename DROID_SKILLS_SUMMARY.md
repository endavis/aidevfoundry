# Factory Droid Skills - Summary

## Overview

Factory Droid now has **2 skills** available for using external CLI tools as subagents:

1. **Codex CLI Skill** - Uses OpenAI Codex for code generation
2. **Gemini CLI Skill** - Uses Google Gemini for multi-modal AI tasks

---

## Codex CLI Skill

### Location
`C:\users\prest\.factory\skills\codex\SKILL.md`

### Triggers
- "use codex"
- "codex help"
- "codex subagent"
- "codex implementation"
- "codex analyze"

### Capabilities
- Code generation via GPT-5.2-Codex
- Quick code generation
- Simple scripts
- Single-file tasks
- Diff patch generation

### Quick Usage
```bash
# In Factory Droid session:
codex exec "Analyze <files> and generate diff patches for <requirement>"
```

### Key Features
- Workspace-write sandbox mode for agentic workflows
- JSONL output for token tracking
- Direct execution mode: `codex exec`

---

## Gemini CLI Skill

### Location
`C:\users\prest\.factory\skills\gemini\SKILL.md`

### Triggers
- "use gemini"
- "gemini help"
- "gemini subagent"
- "gemini implementation"
- "gemini analyze"

### Capabilities
- Multi-modal AI (text, images, video)
- Advanced code analysis
- LSP integration (gopls, typescript-language-server, etc.)
- MCP support (40+ servers)
- Session management
- Multiple approval modes

### Quick Usage
```bash
# In Factory Droid session:
gemini "Analyze <files> and create implementation plan for <requirement>"
```

### Key Features
- **Multi-model support**: Gemini 2.5 Pro, Flash, etc.
- **Built-in LSP**: Automatic context from Language Server Protocol
- **MCP integration**: GitHub, Linear, Notion, Stripe, and more
- **Approval modes**: default (read-only), auto_edit, confirm_all
- **Multi-modal**: Can analyze screenshots, designs, etc.

---

## Combined Workflow Pattern

Both skills follow the same subagent pattern:

### 1. Explore with Droid
```bash
glob "**/*Variant*.kt"
grep "class DistroVariant" app/src/main/java/
```

### 2. Analyze with Subagent
**Using Codex:**
```bash
codex exec "Analyze DistroVariant.kt and add downloadUrl field. Generate diff patch."
```

**Using Gemini:**
```bash
gemini "Analyze DistroVariant.kt and create plan for adding downloadUrl field"
```

### 3. Apply with Droid
Use Droid's Edit/Write tools with permission checks

### 4. Verify with Droid
```bash
bash "gradle test"
```

### 5. Iterate
Repeat until tests pass

---

## When to Use Each

### Use Codex CLI for:
- Quick code generation
- Simple scripts and single-file tasks
- When you need diff patches
- Fast iteration on straightforward code

### Use Gemini CLI for:
- Multi-modal tasks (images, screenshots, designs)
- Complex code analysis requiring LSP context
- When you need MCP integrations (GitHub, Linear, etc.)
- Multi-file refactoring with session management
- Tasks requiring visual understanding

---

## Skill Activation

Factory Droid automatically detects and activates skills based on trigger phrases:

```bash
# Activates Codex skill
"use codex to analyze authentication flow"

# Activates Gemini skill  
"use gemini to review this PR"

# Or directly
"codex exec '...'"
"gemini '...'"
```

---

## Installation Requirements

### Codex CLI
```bash
npm install -g @openai/codex
# or
brew install --cask codex
```

### Gemini CLI
```bash
npm install -g @google/gemini-cli
# or
brew install gemini-cli
```

Both CLI tools must be installed and available in your PATH for the skills to work.

---

## Configuration

### Codex Configuration
- Config file: `~/.codex/config.toml`
- Environment: `CODEX_API_KEY`
- Default sandbox: `workspace-write`

### Gemini Configuration
- Config file: `$HOME/.config/crush/crush.json`
- Environment: `GEMINI_API_KEY` or Google Cloud auth
- Default approval mode: `default` (read-only)

---

## Safety & Permissions

Both skills integrate with Factory Droid's permission system:

1. **Read-only mode** - For analysis tasks
2. **Permission prompts** - For file operations
3. **Diff previews** - Review before applying
4. **Auto-approval tracking** - Learn from your decisions

---

## Comparison Table

| Feature | Codex CLI | Gemini CLI |
|---------|-----------|-------------|
| **Provider** | OpenAI | Google |
| **Models** | GPT-5.2-Codex | Gemini 2.5 Pro/Flash |
| **Multi-modal** | Limited | Full (images, video) |
| **LSP Support** | Via MCP | Built-in |
| **MCP Support** | Yes | Yes (40+ servers) |
| **Output Format** | JSONL | Text/JSON |
| **Session Mgmt** | Basic | Advanced |
| **Best For** | Quick code gen | Complex analysis |
| **Approval Modes** | Sandbox levels | Default/auto_edit/confirm |

---

## Examples

### Example 1: Bug Fix with Codex
```bash
# In Droid session:
codex exec "Analyze failing test and generate patch to fix it"
# Review output
# Apply with Droid's Edit tool
bash "npm test"
```

### Example 2: Feature Design with Gemini
```bash
# In Droid session:
gemini "Analyze this screenshot and implement the UI design shown" design.png
# Review implementation plan
# Apply with Droid's Write tool
bash "npm run build"
```

### Example 3: Code Review with Both
```bash
# Analyze with Gemini
gemini "Review auth.ts for security vulnerabilities"

# Generate fixes with Codex
codex exec "Implement security fixes for auth.ts based on analysis"

# Apply and test
```

---

## Troubleshooting

**Skill not activating?**
- Check trigger phrases match skill description
- Verify skill file exists in `C:\users\prest\.factory\skills\<name>\SKILL.md`
- Restart Factory Droid session

**CLI tool not found?**
- Verify installation: `codex --version` or `gemini --version`
- Check PATH includes CLI installation directory
- Try full path to executable

**Permission errors?**
- Check approval mode settings
- Verify file permissions
- Use read-only mode for analysis tasks

---

## Future Extensions

Additional skills can be added following the same pattern:

1. Create directory: `C:\users\prest\.factory\skills\<name>\`
2. Add `SKILL.md` with frontmatter (name, description, triggers)
3. Document usage, examples, and workflows
4. Test with Factory Droid

Popular candidates:
- **Ollama CLI** - Local model support
- **Mistral CLI** - Mistral AI integration
- **Custom tools** - Project-specific workflows

---

*These skills extend Factory Droid's capabilities by leveraging specialized CLI tools for specific tasks.*