# PuzldAI External CLI Tools Integration Guide

## Overview

PuzldAI integrates with external CLI coding tools (**Factory/droid** and **Charm Crush**) to provide multi-agent orchestration capabilities. This guide covers configuration, optimization, and advanced usage patterns.

---

## 🎯 Quick Start

### Prerequisites

Ensure the CLI tools are installed and available in your PATH:

```bash
# Check installations
droid --version  # Should show: 0.39.0 or later
crush --version  # Should show: v0.18.6 or later
```

### Basic Configuration

Edit `~/.puzldai/config.json`:

```json
{
  "adapters": {
    "factory": {
      "enabled": true,
      "path": "droid",
      "model": "claude-sonnet-4-5-20250929",
      "autonomy": "medium",
      "reasoningEffort": "medium",
      "skipPermissions": false
    },
    "crush": {
      "enabled": true,
      "path": "crush",
      "autoAccept": false,
      "debug": false
    }
  }
}
```

---

## 🚀 Usage Examples

### 1. Single Agent Execution

```bash
# Using Factory (droid)
pk-puzldai run "Create a hello world function in JavaScript" --agent factory

# Using Crush
pk-puzldai run "Explain closures in JavaScript" --agent crush
```

### 2. Compare Mode

Compare responses from multiple agents:

```bash
pk-puzldai compare "What is the best way to handle errors in async JS?" \
  --agents claude,factory

pk-puzldai compare "Should TypeScript be used for all projects?" \
  --agents factory,crush,gemini
```

### 3. Pipeline Mode

Chain agents for multi-step workflows:

```bash
# Factory implements, then Claude reviews
pk-puzldai run "Create a Fibonacci calculator in Python" \
  -P "factory:implement,claude:review"

# Multi-stage pipeline
pk-puzldai run "Build a REST API endpoint" \
  -P "factory:design,claude:implement,gemini:test"
```

### 4. Debate Mode

Multi-round debates between agents:

```bash
pk-puzldai debate "Should TypeScript be used for all projects?" \
  --agents claude,factory \
  --rounds 3
```

### 5. Consensus Mode

Build consensus across multiple agents:

```bash
pk-puzldai consensus "What are the best practices for React hooks?" \
  --agents claude,factory,gemini
```

---

## ⚙️ Factory (droid) Configuration

### Available Models

```
gpt-5.1, gpt-5.1-codex, gpt-5.1-codex-max, gpt-5.2
claude-sonnet-4-5-20250929 (recommended)
claude-opus-4-5-20251101
claude-haiku-4-5-20251001
gemini-3-pro-preview, gemini-3-flash-preview
glm-4.6
```

### Autonomy Levels

Controls what operations the agent can perform:

**`low` (Recommended for safety):**
- File creation/modification in non-system directories
- Safe operations: touch, mkdir, mv, cp
- ✗ No system modifications or package installations

**`medium` (Development operations):**
- Package installations: npm install, pip install
- Network requests to trusted endpoints
- Git operations (local): commit, checkout, pull
- Build operations: make, npm run build
- ✗ No git push, sudo commands, or production changes

**`high` (Production operations - Use with caution):**
- Running arbitrary code
- Git push operations
- Production deployments
- Database migrations
- ✗ Still blocks: sudo rm -rf /, system-wide changes

**`skipPermissions: true` (DANGEROUS - Isolated environments only):**
- Allows ALL operations without confirmation
- Use ONLY in Docker containers or isolated VMs

### Reasoning Effort

Controls the depth of model reasoning:

```
off, low, medium (recommended), high, xhigh
```

### Example Configurations

**Safe Mode (Read-only + Analysis):**
```json
{
  "factory": {
    "enabled": true,
    "model": "claude-sonnet-4-5-20250929",
    "autonomy": "low",
    "reasoningEffort": "low",
    "skipPermissions": false
  }
}
```

**Development Mode (File operations + packages):**
```json
{
  "factory": {
    "enabled": true,
    "model": "claude-sonnet-4-5-20250929",
    "autonomy": "medium",
    "reasoningEffort": "medium",
    "skipPermissions": false
  }
}
```

**Production Mode (Full access - Use carefully):**
```json
{
  "factory": {
    "enabled": true,
    "model": "claude-opus-4-5-20251101",
    "autonomy": "high",
    "reasoningEffort": "high",
    "skipPermissions": false,
    "cwd": "/path/to/project"
  }
}
```

---

## 🎨 Crush Configuration

### Available Options

```json
{
  "crush": {
    "enabled": true,
    "path": "crush",
    "autoAccept": false,  // Enable yolo mode (auto-accept permissions)
    "debug": false,       // Enable debug logging
    "cwd": "/path/to/project"  // Set working directory
  }
}
```

### Performance Optimization

Crush can be slower in non-interactive mode. Optimization strategies:

1. **Disable auto-accept** unless in trusted environment
2. **Keep prompts concise** for faster responses
3. **Use specific working directories** to reduce context loading

---

## 🔧 Advanced Integration Patterns

### 1. Multi-Agent Code Review

```bash
# Factory writes code, Claude reviews for best practices, Gemini checks tests
pk-puzldai run "Implement user authentication" \
  -P "factory:implement,claude:review-security,gemini:review-tests"
```

### 2. Parallel Analysis

```bash
# All agents analyze simultaneously
pk-puzldai compare "Analyze this codebase for performance issues" \
  --agents claude,factory,gemini \
  --parallel
```

### 3. Iterative Refinement

```bash
# Debate to explore options, then factory implements consensus
pk-puzldai debate "Best architecture for microservices" \
  --agents claude,factory \
  --rounds 2

# Then implement based on debate outcome
pk-puzldai run "Implement the agreed architecture" --agent factory
```

### 4. Context-Aware Workflows

```bash
# Set working directory in config for project-specific context
{
  "factory": {
    "cwd": "/path/to/my-project"
  }
}

# Factory will operate within project context
pk-puzldai run "Add error handling to the API" --agent factory
```

---

## 📊 Performance Comparison

| Mode | Factory (droid) | Crush | Claude | Use Case |
|------|----------------|-------|--------|----------|
| Simple queries | ~15s | ~30s | ~5s | Quick answers |
| Code generation | ~25s | ~45s | ~10s | Writing code |
| File operations | ~20s* | N/A | N/A | Creating/editing files |
| Analysis | ~15s | ~35s | ~8s | Code review |

*With `autonomy: medium` or higher

---

## 🛡️ Security Best Practices

### 1. Factory Permissions

**NEVER use `skipPermissions: true` in production or development environments.**

Use autonomy levels appropriately:
- Local development: `medium`
- Code review/analysis: `low`
- CI/CD (isolated): `high`
- Production: Manual approval required

### 2. Credential Management

```bash
# Set API keys via environment variables
export FACTORY_API_KEY="fk-..."
export CRUSH_API_KEY="..."

# Or use config file (less secure)
# ~/.factory/config.json
# ~/.crush/config.json
```

### 3. Working Directory Isolation

Always set explicit working directories:

```json
{
  "factory": {
    "cwd": "/path/to/safe/project"
  }
}
```

---

## 🐛 Troubleshooting

### Issue: "Factory adapter not available"

**Solution:**
```bash
# Check if droid is in PATH
which droid

# Verify config
cat ~/.puzldai/config.json | grep factory

# Test directly
droid --version
```

### Issue: "Crush timeouts"

Crush can be slower in non-interactive mode. **Solutions:**

1. Increase timeout in config:
   ```json
   {
     "timeout": 180000  // 3 minutes
   }
   ```

2. Use Factory for time-sensitive tasks

3. Keep prompts focused and specific

### Issue: "Permission denied" errors

**For Factory:**
- Check autonomy level is sufficient
- Verify working directory permissions
- Consider `skipPermissions` only in isolated environments

**For Crush:**
- Ensure `autoAccept` is set if needed
- Check file system permissions

### Issue: Model not found

```bash
# List available models
droid exec --list-tools

# Update config with valid model name
{
  "factory": {
    "model": "claude-sonnet-4-5-20250929"  // Use exact model ID
  }
}
```

---

## 📚 Real-World Examples

### Example 1: Full-Stack Feature Implementation

```bash
# 1. Design phase
pk-puzldai debate "Best approach for user authentication" \
  --agents claude,factory --rounds 2

# 2. Implementation
pk-puzldai run "Implement JWT authentication" \
  -P "factory:backend,claude:frontend,gemini:tests"

# 3. Review
pk-puzldai compare "Review the authentication implementation" \
  --agents claude,factory,gemini
```

### Example 2: Codebase Modernization

```bash
# Parallel analysis
pk-puzldai compare "Analyze legacy code for modernization opportunities" \
  --agents claude,factory --parallel

# Implement changes with factory
pk-puzldai run "Migrate callbacks to async/await" \
  --agent factory
```

### Example 3: Documentation Generation

```bash
# Factory generates docs, Claude reviews for clarity
pk-puzldai run "Generate API documentation from code" \
  -P "factory:generate,claude:review-clarity"
```

---

## 🎯 Best Practices

### 1. Choose the Right Agent for the Job

- **Factory (droid):** File operations, code generation, refactoring
- **Crush:** Quick queries, explanations, analysis
- **Claude:** Code review, best practices, architecture
- **Gemini:** Testing, validation, research

### 2. Use Appropriate Autonomy

Start conservative and increase as needed:
1. Begin with `autonomy: low` for analysis
2. Use `autonomy: medium` for development
3. Only use `autonomy: high` with explicit approval

### 3. Combine Modes for Complex Tasks

```bash
# Debate → Consensus → Implementation
pk-puzldai debate "..." --agents claude,factory
pk-puzldai consensus "..." --agents claude,factory,gemini
pk-puzldai run "..." --agent factory
```

### 4. Leverage Model Selection

Different models have different strengths:

- **claude-opus-4-5:** Complex reasoning, architecture
- **claude-sonnet-4-5:** Balanced performance/cost
- **claude-haiku-4-5:** Fast responses, simple tasks
- **gpt-5.1-codex:** Code-focused tasks

---

## 🔄 Configuration Templates

### Template 1: Safe Review Mode

```json
{
  "defaultAgent": "auto",
  "adapters": {
    "factory": {
      "enabled": true,
      "model": "claude-sonnet-4-5-20250929",
      "autonomy": "low",
      "reasoningEffort": "medium"
    },
    "crush": {
      "enabled": true,
      "autoAccept": false
    }
  }
}
```

### Template 2: Development Mode

```json
{
  "defaultAgent": "factory",
  "adapters": {
    "factory": {
      "enabled": true,
      "model": "claude-sonnet-4-5-20250929",
      "autonomy": "medium",
      "reasoningEffort": "medium",
      "cwd": "/path/to/project"
    }
  }
}
```

### Template 3: CI/CD Mode (Isolated)

```json
{
  "adapters": {
    "factory": {
      "enabled": true,
      "model": "gpt-5.1-codex",
      "autonomy": "high",
      "reasoningEffort": "low",
      "skipPermissions": true  // Only in Docker/isolated!
    }
  }
}
```

---

## 📖 Additional Resources

- **Factory Documentation:** https://docs.factory.ai/factory-cli
- **PuzldAI Repository:** https://github.com/MedChaouch/Puzld.ai
- **Configuration Reference:** `Puzld.ai/CLAUDE.md`
- **Architecture Guide:** `Puzld.ai/AGENTS.md`

---

## 🎮 Easter Eggs

Want to try the puzzle games?

```bash
# Factory AI Droid - Resource management game
pk-puzldai game factory-ai-droid --new --difficulty medium

# Charm Crush - Match-3 puzzle
pk-puzldai game charm-crush --new --difficulty easy
```

**Note:** These are fun demonstrations of the adapter pattern, not production coding tools!

---

## 📝 License

AGPL-3.0-only (same as PuzldAI)

---

**Questions or Issues?**

File an issue at: https://github.com/MedChaouch/Puzld.ai/issues
