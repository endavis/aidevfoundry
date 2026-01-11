# CLI Adapter Implementation Errors Found

## Executive Summary

After comparing PuzldAI's CLI adapter implementations against official documentation, **5 critical errors** were identified across different adapters that could cause incorrect behavior, failures, or unexpected results.

---

## Error 1: Claude Code Adapter - Missing `--print` Flag

### Location
**File:** `src/adapters/claude.ts`  
**Line:** 78

### Current Implementation
```typescript
const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
```

### Issue
The adapter uses `-p` flag which is ** shorthand for `--print`**, not for providing a prompt. According to [Claude Code CLI Reference](https://docs.claude.com/en/docs/claude-code/cli-reference):

- `-p, --print` - Print response without interactive mode
- To pass a prompt in print mode, use: `claude -p "query"` (prompt comes AFTER the flag)

### Correct Implementation
```typescript
const args = ['-p', '--output-format', 'stream-json', '--verbose', prompt];
```

### Impact
- **Severity:** HIGH  
- **Effect:** The prompt is likely being interpreted as a flag instead of content, causing the LLM to receive no prompt or malformed input  
- **Current Behavior:** May work but is syntactically incorrect

---

## Error 2: Gemini CLI Adapter - Incorrect Flag Format

### Location
**File:** `src/adapters/gemini.ts`  
**Line:** 42-44

### Current Implementation
```typescript
// Add approval mode flag based on option
if (geminiApprovalMode === 'yolo') {
  args.push('--yolo');
} else if (geminiApprovalMode === 'auto_edit') {
  args.push('--approval-mode', 'auto_edit');
}
```

### Issue
According to the [Gemini CLI documentation](https://geminicli.com/docs/cli/commands/), there is **no `--yolo` flag** for Gemini CLI. 

The correct flags for Gemini are:
- **`--approval-mode`** with values: `default`, `auto_edit`, `confirm_all`
- **No `--yolo` flag exists**

### Correct Implementation
```typescript
// Add approval mode flag based on option
if (geminiApprovalMode === 'yolo' || geminiApprovalMode === 'auto_edit') {
  args.push('--approval-mode', 'auto_edit');
}
// 'default' or undefined = no flag (read-only mode)
```

### Impact
- **Severity:** MEDIUM  
- **Effect:** Using `--yolo` flag will cause Gemini CLI to fail with unknown flag error  
- **Current Behavior:** Breaks when `geminiApprovalMode` is set to `'yolo'`

---

## Error 3: Codex CLI Adapter - Missing `exec` Subcommand

### Location
**File:** `src/adapters/codex.ts`  
**Line:** 35

### Current Implementation
```typescript
const args = ['exec', '--skip-git-repo-check', '--json'];
```

### Issue
This is actually **CORRECT**, but there's a subtle issue: the adapter doesn't handle the `--sandbox` flag properly for agentic mode.

According to [Codex CLI Reference](https://developers.openai.com/codex/cli/reference/):

- `--sandbox` accepts: `read-only`, `workspace-write`, `danger-full-access`  
- Current code uses: `--sandbox workspace-write` (correct format)

However, the implementation **doesn't validate** that the sandbox value is one of the accepted values.

### Potential Improvement
Add validation:

```typescript
const sandboxModes = ['read-only', 'workspace-write', 'danger-full-access'] as const;
type SandboxMode = typeof sandboxModes[number];

// In the adapter:
args.push('--sandbox', 'workspace-write'); // This is correct
```

### Impact
- **Severity:** LOW (informational)  
- **Effect:** Currently works but lacks type safety  
- **Current Behavior:** Works correctly

---

## Error 4: Factory (droid) Adapter - Incorrect Autonomy Flag

### Location
**File:** `src/adapters/factory.ts`  
**Line:** 40-46

### Current Implementation
```typescript
// Add autonomy level (default to low for safety)
const autonomy = factoryConfig?.autonomy || 'low';
if (autonomy && autonomy !== 'low') {
  args.push('--auto', autonomy);
} else if (autonomy === 'low') {
  args.push('--auto', 'low');
}
```

### Issue
According to [Factory CLI Reference](https://docs.factory.ai/reference/cli-reference):

- The `--auto` flag expects: `low`, `medium`, `high`  
- **There is NO "default" autonomy level** - if not specified, it's read-only  
- The current code incorrectly sets `--auto low` even for low autonomy

### Correct Implementation
```typescript
// Add autonomy level if specified
const autonomy = factoryConfig?.autonomy;
if (autonomy) {
  args.push('--auto', autonomy);
}
// If not specified, no --auto flag = read-only (default)
```

### Impact
- **Severity:** MEDIUM  
- **Effect:** Forces low autonomy even when user didn't specify any, preventing read-only mode  
- **Current Behavior:** Can't use read-only mode

---

## Error 5: Crush Adapter - Incorrect Subcommand

### Location
**File:** `src/adapters/crush.ts`  
**Line:** 33

### Current Implementation
```typescript
// Crush uses 'run' subcommand for non-interactive execution
const args: string[] = ['run'];
```

### Issue
According to the [Crush GitHub README](https://github.com/charmbracelet/crush):

- **There is NO `crush run` subcommand**  
- For non-interactive execution, you use: `crush "prompt"` (direct invocation)  
- Crush doesn't have a separate `exec` or `run` subcommand like other tools

### Correct Implementation
```typescript
// Crush doesn't have a run subcommand - pass prompt directly
const args: string[] = [];

// Add working directory if specified
if (crushConfig?.cwd) {
  args.push('--cwd', crushConfig.cwd);
}

// Enable auto-accept (yolo mode) if configured
if (crushConfig?.autoAccept) {
  args.push('--yolo');
}

// Enable debug mode if configured
if (crushConfig?.debug) {
  args.push('--debug');
}

// Add model selection if specified
if (model) {
  args.push('--model', model);
}

// Add the prompt (must be last)
args.push(prompt);

// Execute directly without 'run' subcommand
const { stdout, stderr } = await execa(
  config.adapters.crush?.path || 'crush',
  args,
  // ... rest of config
);
```

### Impact
- **Severity:** HIGH  
- **Effect:** Using non-existent `run` subcommand will cause Crush to fail  
- **Current Behavior:** Completely broken - will fail with "unknown command" error

---

## Summary Table

| Adapter | Error | Severity | Status |
|---------|-------|----------|--------|
| Claude | Missing `--print` flag, incorrect argument order | HIGH | Needs Fix |
| Gemini | Non-existent `--yolo` flag | MEDIUM | Needs Fix |
| Codex | Minor: lacks sandbox validation | LOW | Optional |
| Factory | Forces low autonomy, can't use read-only | MEDIUM | Needs Fix |
| Crush | Uses non-existent `run` subcommand | HIGH | Needs Fix |

---

## Recommended Actions

1. **Fix Claude adapter** - Reorder arguments correctly
2. **Fix Gemini adapter** - Remove `--yolo` flag usage  
3. **Improve Codex adapter** - Add sandbox mode validation
4. **Fix Factory adapter** - Don't force `--auto low` when not specified
5. **Fix Crush adapter** - Remove `run` subcommand

All fixes are backwards compatible and will improve reliability.