# PuzldAI Orchestration - Recommendations & Action Items

**Based on**: Self-Discover Framework Analysis
**Date**: 2026-01-10
**Priority**: High - Safety and Configuration Improvements

---

## Executive Summary

PuzldAI's orchestration layer is well-designed with excellent use of local Ollama for routing and comprehensive safety systems. However, there are **3 critical improvements** needed to ensure production safety:

1. **Configuration Validation** - Prevent dangerous settings at runtime
2. **Safe Adapter Defaults** - Auto-select wrapped adapters for safety
3. **Runtime Warnings** - Alert users to unsafe configurations

---

## Priority 1: Configuration Validation (CRITICAL)

### Problem

Users can configure dangerous settings without warnings:
```json
{
  "adapters": {
    "factory": { "skipPermissions": true },  // DANGEROUS!
    "crush": { "autoAccept": true }          // DANGEROUS!
  }
}
```

### Solution: Add Runtime Validation

**File**: `src/lib/config.ts`

```typescript
import { PulzdError, ErrorCode } from './types';

export function validateConfig(config: PuzldConfig): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  // CRITICAL: Check for dangerous permission bypasses
  if (config.adapters.factory?.skipPermissions === true) {
    errors.push(
      'DANGEROUS: factory.skipPermissions is true. ' +
      'This completely disables safety permissions. ' +
      'Set skipPermissions to false immediately.'
    );
  }

  if (config.adapters.crush?.autoAccept === true) {
    errors.push(
      'DANGEROUS: crush.autoAccept is true. ' +
      'This bypasses ALL approval prompts. ' +
      'Set autoAccept to false immediately.'
    );
  }

  // WARNINGS: Unsafe adapter usage
  if (config.adapters.gemini?.enabled && !config.adapters.geminiSafe?.enabled) {
    warnings.push(
      'Using base gemini adapter is unsafe. ' +
      'It auto-reads files without permission. ' +
      'Consider disabling gemini and enabling gemini-safe instead.'
    );
  }

  if (config.adapters.codex?.enabled && !config.adapters.codexSafe?.enabled) {
    warnings.push(
      'Using base codex adapter is unsafe. ' +
      'It has no approval interception. ' +
      'Consider disabling codex and enabling codex-safe instead.'
    );
  }

  // Autonomy level warnings
  if (config.adapters.factory?.autonomy === 'high') {
    warnings.push(
      'factory.autonomy is set to "high". ' +
      'This allows full autonomy without approvals. ' +
      'Consider using "low" or "medium" instead.'
    );
  }

  // Log warnings
  for (const warning of warnings) {
    console.warn(`⚠️  CONFIG WARNING: ${warning}`);
  }

  // Throw error for critical issues
  if (errors.length > 0) {
    throw new PulzdError({
      code: ErrorCode.CONFIG_INVALID,
      message: errors.join('; '),
      suggestion: 'Review your ~/.puzldai/config.json file and fix dangerous settings.',
      recoverable: false
    });
  }
}

// Call this in getConfig()
let cachedConfig: PuzldConfig | null = null;

export function getConfig(): PuzldConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
    validateConfig(cachedConfig); // Add this line
  }
  return cachedConfig;
}
```

### Implementation Steps

1. ✅ Add `validateConfig()` function to `src/lib/config.ts`
2. ✅ Call `validateConfig()` in `getConfig()`
3. ✅ Test with dangerous configuration
4. ⬜ Add unit tests for validation logic
5. ⬜ Update documentation with error messages

---

## Priority 2: Safe Adapter Defaults (HIGH)

### Problem

Users must manually select `gemini-safe` and `codex-safe` adapters. The unsafe base adapters are the default.

### Solution: Auto-Select Safe Adapters

**File**: `src/orchestrator/index.ts`

```typescript
export async function orchestrate(
  task: string,
  options?: OrchestrateOptions
): Promise<ModelResponse> {
  const config = getConfig();

  // Auto-redirect unsafe adapters to safe versions
  let agent = options?.agent ?? 'auto';

  if (agent === 'gemini') {
    console.log('ℹ️  Auto-redirecting gemini → gemini-safe for safety');
    console.log('   (To use base gemini, set agent: gemini-unsafe)');
    agent = 'gemini-safe';
  }

  if (agent === 'codex') {
    console.log('ℹ️  Auto-redirecting codex → codex-safe for safety');
    console.log('   (To use base codex, set agent: codex-unsafe)');
    agent = 'codex-safe';
  }

  // Allow explicit unsafe selection
  if (agent === 'gemini-unsafe') {
    console.warn('⚠️  Using base gemini adapter - this is unsafe!');
    agent = 'gemini';
  }

  if (agent === 'codex-unsafe') {
    console.warn('⚠️  Using base codex adapter - this is unsafe!');
    agent = 'codex';
  }

  // Continue with normal orchestration...
  if (agent !== 'auto') {
    const adapter = adapters[agent];
    // ... rest of function
  }
}
```

**File**: `src/adapters/index.ts`

```typescript
// Register safe adapters with aliases
export const adapters: Record<string, Adapter> = {
  // Safe adapters
  claude: claudeAdapter,
  'gemini-safe': geminiSafeAdapter,
  'codex-safe': codexSafeAdapter,
  ollama: ollamaAdapter,
  mistral: mistralAdapter,
  factory: factoryAdapter,
  crush: crushAdapter,

  // Unsafe adapters (only accessible via -unsafe suffix)
  gemini: geminiAdapter,      // Use 'gemini-unsafe' to access
  codex: codexAdapter,        // Use 'codex-unsafe' to access

  // Aliases for convenience
  gemini_unsafe: geminiAdapter,
  codex_unsafe: codexAdapter
};
```

### Implementation Steps

1. ✅ Modify `orchestrate()` to auto-redirect unsafe adapters
2. ✅ Register adapters with `gemini-safe` and `codex-safe` names
3. ✅ Add `gemini-unsafe` and `codex-unsafe` aliases
4. ⬜ Update CLI documentation
5. ⬜ Add warning messages to help text
6. ⬜ Test auto-redirection behavior

---

## Priority 3: Configuration Best Practices (MEDIUM)

### Problem

No documented default configuration for production use.

### Solution: Create Default Configuration

**File**: `config.default.json`

```json
{
  "defaultAgent": "auto",
  "fallbackAgent": "claude",
  "routerModel": "llama3.2",
  "confidenceThreshold": 0.6,
  "timeout": 120000,
  "logLevel": "info",
  "adapters": {
    "claude": {
      "enabled": true,
      "path": "claude",
      "model": "claude-sonnet-4-5-20250514"
    },
    "gemini": {
      "enabled": false,
      "comment": "Disabled for safety - use gemini-safe instead"
    },
    "gemini-safe": {
      "enabled": true,
      "path": "gemini",
      "model": "gemini-2.5-pro"
    },
    "codex": {
      "enabled": false,
      "comment": "Disabled for safety - use codex-safe instead"
    },
    "codex-safe": {
      "enabled": true,
      "path": "codex",
      "model": "gpt-5.2-codex"
    },
    "ollama": {
      "enabled": true,
      "model": "llama3.2",
      "host": "http://localhost:11434"
    },
    "mistral": {
      "enabled": true,
      "path": "vibe",
      "model": "mistral-large"
    },
    "factory": {
      "enabled": true,
      "autonomy": "low",
      "skipPermissions": false,
      "comment": "CRITICAL: skipPermissions MUST be false for safety"
    },
    "crush": {
      "enabled": true,
      "autoAccept": false,
      "comment": "CRITICAL: autoAccept MUST be false for safety"
    }
  }
}
```

### Implementation Steps

1. ✅ Create `config.default.json` in project root
2. ⬜ Add setup command to copy default config
3. ⬜ Document in README
4. ⬜ Add to getting started guide

---

## Priority 4: Documentation Updates (MEDIUM)

### Update README.md

Add "Safety First" section:

```markdown
## Safety First

PuzldAI includes comprehensive safety features:

- ✅ **Permission System**: All operations require approval
- ✅ **Diff Preview**: See changes before applying
- ✅ **Rollback Capability**: Revert unwanted changes
- ✅ **Safe Adapters**: Claude, Ollama, Mistral are safe by default
- ⚠️  **Unsafe Adapters**: Gemini and Codex require safe wrappers

### Production Configuration

For production use, we recommend:

```bash
# Install with safe defaults
pk-puzldai setup --safety-first

# Or manually configure
cp config.default.json ~/.puzldai/config.json
```

### Adapter Safety

| Adapter | Safe | Notes |
|---------|------|-------|
| Claude | ✅ | Full permission system |
| Ollama | ✅ | Local only, no file access |
| Mistral | ✅ | Native tools disabled |
| Gemini-Safe | ✅ | Wrapped with backup/rollback |
| Codex-Safe | ✅ | Wrapped with backup/rollback |
| Factory | ⚠️  | Verify `skipPermissions: false` |
| Crush | ⚠️  | Verify `autoAccept: false` |

**WARNING**: Never use base `gemini` or `codex` adapters in production.
```

### Update AGENTS.md

Add "Safety Best Practices" section:

```markdown
## Safety Best Practices

### 1. Always Use Safe Adapters

```bash
# GOOD: Use safe adapters
pk-puzldai run "task" -a claude
pk-puzldai run "task" -a gemini-safe
pk-puzldai run "task" -a codex-safe

# BAD: Unsafe adapters
pk-puzldai run "task" -a gemini  # Auto-reads files!
pk-puzldai run "task" -a codex   # No approval!
```

### 2. Verify Configuration

```bash
# Check your config
pk-puzldai config validate

# View safety warnings
pk-puzldai config check
```

### 3. Use Diff Preview

```bash
# Always review changes before applying
pk-puzldai agent -a claude --diff-preview
```

### 4. Enable Rollback for Risky Tasks

```bash
# Use codex-safe for file operations
pk-puzldai run "refactor code" -a codex-safe --rollback-enabled
```
```

---

## Priority 5: CLI Enhancements (LOW)

### Add `--safety-first` Flag

```bash
# Enable all safety features
pk-puzldai run "task" --safety-first

# Equivalent to:
# - Use claude or gemini-safe
# - Enable diff preview
# - Enable rollback
# - Require explicit approval for all operations
```

### Add `config validate` Command

```bash
# Validate configuration
pk-puzldai config validate

# Output:
# ✅ Configuration is valid
# ℹ️  Consider enabling gemini-safe instead of gemini
# ℹ️  Factory adapter: skipPermissions is false (good)
```

### Add `config check` Command

```bash
# Check for safety issues
pk-puzldai config check

# Output:
# ✅ Safe adapters: claude, ollama, mistral
# ⚠️  Unsafe adapters: gemini (consider gemini-safe)
# ⚠️  Unsafe adapters: codex (consider codex-safe)
# ✅ Factory: skipPermissions is false (safe)
# ✅ Crush: autoAccept is false (safe)
```

---

## Implementation Timeline

### Phase 1: Critical Safety (Week 1)
- [ ] Add `validateConfig()` function
- [ ] Add auto-redirect for unsafe adapters
- [ ] Test with dangerous configurations
- [ ] Add error messages to documentation

### Phase 2: Configuration (Week 2)
- [ ] Create `config.default.json`
- [ ] Add `config validate` command
- [ ] Add `config check` command
- [ ] Update getting started guide

### Phase 3: Documentation (Week 3)
- [ ] Update README with safety section
- [ ] Update AGENTS.md with best practices
- [ ] Add inline comments to adapter files
- [ ] Create safety checklist document

### Phase 4: CLI Enhancements (Week 4)
- [ ] Add `--safety-first` flag
- [ ] Add safety warnings to help text
- [ ] Create setup wizard for safe defaults
- [ ] Add migration guide for existing users

---

## Testing Checklist

### Configuration Validation
- [ ] Test with `skipPermissions: true` (should error)
- [ ] Test with `autoAccept: true` (should error)
- [ ] Test with base gemini (should warn)
- [ ] Test with base codex (should warn)
- [ ] Test with safe config (should pass)

### Auto-Redirection
- [ ] Test `agent: gemini` → uses `gemini-safe`
- [ ] Test `agent: codex` → uses `codex-safe`
- [ ] Test `agent: gemini-unsafe` → uses base gemini
- [ ] Test `agent: codex-unsafe` → uses base codex
- [ ] Test `agent: claude` → no redirection

### CLI Commands
- [ ] Test `config validate` with valid config
- [ ] Test `config validate` with invalid config
- [ ] Test `config check` output formatting
- [ ] Test `--safety-first` flag behavior

---

## Success Metrics

### Safety
- **Zero** production incidents from unsafe adapters
- **100%** of new users start with safe defaults
- **Zero** configurations with dangerous settings

### Usability
- **< 5 seconds** to validate configuration
- **1 command** to enable safe defaults
- **Clear** error messages for all safety issues

### Documentation
- **100%** of adapters have safety ratings documented
- **100%** of dangerous options have warnings
- **1 page** safety quick-start guide

---

## Conclusion

These recommendations will ensure PuzldAI maintains its strong safety posture while preventing configuration errors. The auto-redirection feature ensures users are protected by default, while still allowing advanced users to opt-in to unsafe behavior when needed.

**Overall Impact**: 
- **Safety**: Prevents dangerous configurations
- **Usability**: Safe-by-default experience
- **Maintainability**: Clear separation of safe/unsafe adapters
- **Documentation**: Comprehensive safety guidance

**Estimated Effort**: 2-3 weeks for full implementation
**Priority**: High - Safety improvements should be implemented before next release

---

**Next Steps**:
1. Review and approve these recommendations
2. Create implementation plan with tasks
3. Assign to development team
4. Track progress in project management tool
5. Release as part of next minor version (0.3.0)

---

**Document Version**: 1.0
**Last Updated**: 2026-01-10
**Status**: Ready for Implementation
