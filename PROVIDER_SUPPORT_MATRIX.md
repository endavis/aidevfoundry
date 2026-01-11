# Provider Support Matrix for Agentic Mode

This document defines which providers are safe for agentic mode (tool calling, file operations) and any bypass risks.

## Quick Reference

| Provider | Agentic Mode | Permission Safety | Tool Format | Bypass Risk |
|----------|--------------|-------------------|-------------|-------------|
| **Claude** | SAFE | Full | Stream JSON | None |
| **Ollama** | SAFE | Full (local) | Chat + wrapper | None |
| **Mistral** | SAFE | Full | Streaming JSON | None |
| **Gemini** | UNSAFE | Auto-reads files | JSON | High |
| **Codex** | UNSAFE | No interception | JSONL | High |
| **Factory** | CONDITIONAL | Configurable | Text | Config-based |
| **Crush** | CONDITIONAL | Configurable | Text | Config-based |

---

## Detailed Provider Analysis

### SAFE: Claude (`claude` adapter)

**Status:** Production-ready for agentic mode

**Why it's safe:**
- Uses `--permission-mode default` flag - respects permission prompts
- Disables native tools by default (`--tools ""`)
- Has explicit `dryRun()` method for safe exploration
- Stream parser integration for proper tool event handling

**Configuration:**
```typescript
// Safe by default - no special configuration needed
adapter: 'claude'
```

**Agentic features:**
- Stream JSON output format
- Token tracking
- Diff preview support via `dryRun()`

---

### SAFE: Ollama (`ollama` adapter)

**Status:** Production-ready for agentic mode

**Why it's safe:**
- Pure LLM API with no native file access
- Runs locally - no external network operations
- No auto-read or auto-execute capabilities
- `disableTools` is a no-op (no tools to disable)

**Configuration:**
```typescript
// Safe by default
adapter: 'ollama'
```

**Limitations:**
- Requires PuzldAI's `runAgentLoop()` for tool calling
- No native tool support - chat-only interface
- Token tracking available via eval counts

---

### SAFE: Mistral (`mistral` adapter)

**Status:** Production-ready for agentic mode

**Why it's safe:**
- Default: `disableTools: true`
- Uses `--enabled-tools none` to explicitly disable native tools
- Tool invocation controlled by PuzldAI's agent loop
- No auto-read or auto-execute behaviors

**Configuration:**
```typescript
// Safe by default
adapter: 'mistral'
```

**Agentic features:**
- Streaming JSON output
- Text-based tool invocation via ` ```tool` ``` blocks
- Token tracking from NDJSON responses

---

### UNSAFE: Gemini (`gemini` adapter)

**Status:** NOT safe for production agentic mode

**Why it's unsafe:**
- **Auto-reads project files** without permission
- No reliable way to disable context loading
- `approval_mode` options can bypass all safety:
  - `'auto_edit'` - auto-applies edits
  - `'yolo'` - most permissive, no approvals

**Bypass vectors:**
```typescript
// DANGEROUS - do not use in production
geminiApprovalMode: 'yolo'    // Bypasses ALL approvals
geminiApprovalMode: 'auto_edit'  // Auto-applies without review
```

**Safe alternative:** Use `gemini-safe` (CLI-safe wrapper with approval prompt)

---

### UNSAFE: Codex (`codex` adapter)

**Status:** NOT safe for production agentic mode

**Why it's unsafe:**
- No approval interception mechanism
- Uses `--sandbox workspace-write` - allows writes
- Trusts Codex CLI to handle permissions internally
- No diff preview or user approval integrated

**Bypass vectors:**
- No explicit bypass flags, but no approval checks either
- Write operations execute without PuzldAI approval layer

**Safe alternative:** Use `codex-safe` (CLI-safe wrapper with approval prompt)

---

### CONDITIONAL: Factory (`factory` adapter)

**Status:** Safe only with correct configuration

**Why it's risky:**
```typescript
// DANGEROUS - NEVER enable in production
skipPermissions: true  // Completely disables safety
```

**Safe configuration:**
```typescript
{
  factory: {
    autonomy: 'low',           // Most restrictive
    skipPermissions: false,    // NEVER enable
    reasoningEffort: 'medium'
  }
}
```

**Autonomy levels:**
- `'low'` - Safest, requires approvals
- `'medium'` - Some auto-execution
- `'high'` - DANGEROUS, full autonomy

---

### CONDITIONAL: Crush (`crush` adapter)

**Status:** Safe only with correct configuration

**Why it's risky:**
```typescript
// DANGEROUS - NEVER enable in production
autoAccept: true  // -y flag, bypasses ALL prompts
```

**Safe configuration:**
```typescript
{
  crush: {
    autoAccept: false,  // Default, keep disabled
    debug: true         // Enable for visibility
  }
}
```

---

## Configuration Checklist

Before using agentic mode in production:

### Must Verify:
- [ ] Claude: No special config needed (safe by default)
- [ ] Ollama: No special config needed (safe by default)
- [ ] Mistral: `disableTools: true` (default)

### Must Avoid:
- [ ] Gemini: DO NOT use base adapter in agentic mode (use `gemini-safe`)
- [ ] Codex: DO NOT use base adapter in agentic mode (use `codex-safe`)
- [ ] Factory: `skipPermissions` MUST be false
- [ ] Crush: `autoAccept` MUST be false

### Safe Alternatives:
Use the CLI-safe wrappers:

```bash
pk-puzldai run "task" -a gemini-safe
pk-puzldai run "task" -a codex-safe
```

---

## Safety Invariants

These conditions must ALWAYS be true in production:

1. **Bash commands are DEFAULT-DENY**
   - Every `bash` tool call requires explicit approval
   - No silent execution of shell commands
   - All commands logged with full args

2. **Write operations show diff preview**
   - `write` and `edit` tools display changes before applying
   - User can approve, reject, or approve all
   - Diff preview can be skipped only via explicit user action

3. **Read operations respect boundaries**
   - File reads within allowed directories only
   - Pattern matching (`glob`, `grep`) respects exclusions
   - No reading outside project scope without approval

4. **Secrets are never logged**
   - API keys, tokens redacted in logs
   - Environment variables sanitized
   - Config values masked in exports

---

## Adapter Selection Guide

### For Code Generation Tasks:
```bash
# Best choice - full agentic support
pk-puzldai agent -a claude

# Local alternative - no network
pk-puzldai agent -a ollama
```

### For Analysis/Research Tasks:
```bash
# Any safe adapter works
pk-puzldai run "analyze this code" -a claude
pk-puzldai run "analyze this code" -a mistral
```

### For Multi-Agent Workflows:
```bash
# Use safe adapters only
pk-puzldai pickbuild "add feature" -a claude,mistral --build-agent claude

# DO NOT use unsafe adapters in workflows
# BAD: pk-puzldai pickbuild "task" -a gemini,codex
```

---

## Reporting Issues

If you discover a permission bypass or safety issue:

1. **DO NOT** exploit in production
2. File issue at: https://github.com/kingkillery/Puzld.ai/issues
3. Label as `security` for priority handling
4. Include:
   - Adapter name
   - Configuration used
   - Steps to reproduce
   - Expected vs actual behavior

---

*Last updated: 2025-12-24*
*Version: 0.2.95*
