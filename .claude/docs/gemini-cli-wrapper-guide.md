# Gemini CLI Wrapper Guide for Agentic Apps

Expert-level reference for wrapping `gemini -p` (headless mode) in PuzldAI adapters and agents.

## Input/Output Format Matrix

| Input Method | Output Format | Requirement | Use Case |
|--------------|---------------|-------------|----------|
| Argument | text | None | Quick questions |
| Argument | json | `--output-format json` | Programmatic single response |
| Argument | stream-json | `--output-format stream-json` | Real-time monitoring/UIs |
| Stdin pipe | text | None | Files, diffs, command output |
| Stdin pipe | json | `--output-format json` | CI/CD pipelines |
| Stdin pipe | stream-json | `--output-format stream-json` | Long-running tasks with progress |
| File `<` | text/json | No stream-json for static file | Large static prompts |

Gemini's stream-JSON is newline-delimited JSON events (JSONL), similar to Claude's `stream-json`.

---

## Input Methods (4 Ways)

### 1. Argument Prompt (Most Common)
```bash
gemini -p "What is machine learning?"
gemini -p "Explain this code in 3 bullet points."
gemini -p "What is 2+2?" --output-format json
```

### 2. Stdin Pipe
```bash
echo "Explain this code" | gemini

cat README.md | gemini --prompt "Summarize this documentation"
git diff | gemini --prompt "Review these changes and draft a commit message"
```

### 3. Stdin Redirect (File)
```bash
gemini -p "Summarize this requirements document" < requirements.md
```

### 4. Here-Doc (Multi-line Prompts)
```bash
gemini -p <<EOF
You are a senior code reviewer.

Review this function:

\`\`\`python
def add(a, b):
    return a + b
\`\`\`

Focus on: edge cases and error handling.
EOF
```

---

## Output Formats

### 1. Text Output (Default)
```bash
gemini -p "What is 2+2?"
# -> 4

# Capture to variable
answer="$(gemini -p "Write a one-line summary of this repo")"
echo "$answer"
```

### 2. JSON Output (Single Object)
```bash
gemini -p "What is 2+2?" --output-format json
```

Response structure:
```json
{
  "type": "result",
  "result": "4",
  "usage": {
    "input_tokens": 3,
    "output_tokens": 1
  },
  "total_cost_usd": 0.0005,
  "session_id": "uuid-here"
}
```

Extract fields with jq:
```bash
gemini -p "What is 2+2?" --output-format json | jq -r '.result'
gemini -p "Hello" --output-format json | jq '.total_cost_usd'
```

### 3. Stream-JSON (Event Stream)
Newline-delimited JSON events for UIs or stepwise monitoring:

```bash
gemini -p "Run tests and deploy" --output-format stream-json
```

Shell streaming parser:
```bash
gemini -p "Write a story" --output-format stream-json \
  | while IFS= read -r line; do
      text="$(echo "$line" | jq -r '.event.delta.text // empty' 2>/dev/null)"
      [ -n "$text" ] && printf "%s" "$text"
    done
```

Node.js pattern:
```typescript
import readline from 'readline';

for await (const line of readline.createInterface({ input: process.stdin })) {
  const event = JSON.parse(line);
  const delta = event?.event?.delta?.text;
  if (delta) process.stdout.write(delta);
}
```

---

## Model Selection

```bash
# Fast/cheap
gemini -p "Quick question" --model gemini-2.0-flash

# Higher quality
gemini -p "Complex refactor plan" --model gemini-2.0-pro --output-format json
```

---

## Configuration

### Settings Files
- **User settings**: `~/.gemini/settings.json`
- **Project settings**: `.gemini/settings.json` in repo root
- **Env vars**: `GEMINI_API_KEY`, model defaults
- **CLI args**: highest precedence (override everything)

Example `settings.json`:
```json
{
  "output": {
    "format": "json"
  },
  "model": "gemini-2.0-flash"
}
```

---

## Structured Output with JSON Schema

```bash
SCHEMA='{
  "type": "object",
  "properties": {
    "answer": { "type": "string" },
    "confidence": { "type": "number" }
  },
  "required": ["answer"]
}'

echo "What is the capital of France?" | gemini -p \
  --model gemini-2.0-pro \
  --output-format json \
  --schema "$SCHEMA"
```

Response:
```json
{
  "result": "The capital of France is Paris.",
  "structured_output": {
    "answer": "Paris",
    "confidence": 0.99
  }
}
```

---

## Quick Reference Table

| Goal | Command |
|------|---------|
| Simple chat | `echo "hi" \| gemini -p` |
| JSON response | `gemini -p "..." --output-format json` |
| Streaming events | `gemini -p "..." --output-format stream-json` |
| Structured output | `gemini -p "..." --output-format json --schema '...'` |
| Use specific model | `gemini -p "..." --model gemini-2.0-flash` |
| Per-project config | `.gemini/settings.json` in repo root |

---

## Agent Wrapper Patterns

### Pattern A: Simple Query Wrapper
```bash
#!/bin/bash
# gemini-wrap-query.sh
FORMAT="$1"
QUERY="$2"

case "$FORMAT" in
  json)
    echo "$QUERY" | gemini -p --output-format json
    ;;
  stream-json)
    echo "$QUERY" | gemini -p --output-format stream-json
    ;;
  *)
    echo "$QUERY" | gemini -p
    ;;
esac
```

### Pattern B: Piped Data + Instruction
```bash
#!/bin/bash
# gemini-wrap-pipe.sh
FORMAT="$1"
INSTRUCTION="$2"

case "$FORMAT" in
  json)
    cat | gemini -p "$INSTRUCTION" --output-format json
    ;;
  stream-json)
    cat | gemini -p "$INSTRUCTION" --output-format stream-json
    ;;
  *)
    cat | gemini -p "$INSTRUCTION"
    ;;
esac
```

### Pattern C: Structured Extraction
```bash
#!/bin/bash
# gemini-extract.sh
SCHEMA_FILE="$1"
INPUT="$2"
SCHEMA="$(cat "$SCHEMA_FILE")"

echo "$INPUT" | gemini -p \
  --model gemini-2.0-pro \
  --output-format json \
  --schema "$SCHEMA"
```

### Pattern D: Node.js Streaming Adapter
```typescript
import { spawn } from 'child_process';
import * as readline from 'readline';

interface StreamConfig {
  prompt: string;
  model?: string;
  onToken: (t: string) => void;
  onComplete: (result: any) => void;
  onError: (msg: string) => void;
}

export async function streamFromGemini(config: StreamConfig): Promise<void> {
  const args = ['-p', config.prompt, '--output-format', 'stream-json'];
  if (config.model) args.push('--model', config.model);

  const proc = spawn('gemini', args);

  const rl = readline.createInterface({
    input: proc.stdout,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    try {
      const event = JSON.parse(line);
      const delta = event?.event?.delta?.text;
      if (delta) config.onToken(delta);
      if (event.type === 'result') config.onComplete(event);
    } catch (err: any) {
      config.onError(`parse error: ${String(err)}`);
    }
  }

  proc.stderr.on('data', d =>
    config.onError(`stderr: ${d.toString()}`)
  );
}
```

---

## PuzldAI Gemini Adapter Pattern

```typescript
// src/adapters/gemini.ts additions

export interface GeminiRunOptions extends RunOptions {
  outputFormat?: 'text' | 'json' | 'stream-json';
  schema?: object;
}

export function buildGeminiArgs(params: {
  prompt: string;
  model?: string;
  outputFormat?: 'text' | 'json' | 'stream-json';
  schema?: object;
}): string[] {
  const args = ['-p'];

  if (params.outputFormat) {
    args.push('--output-format', params.outputFormat);
  }

  if (params.model) {
    args.push('--model', params.model);
  }

  if (params.schema) {
    args.push('--schema', JSON.stringify(params.schema));
  }

  args.push(params.prompt);
  return args;
}

// Structured extraction
async function extract<T>(
  prompt: string,
  schema: object,
  options?: GeminiRunOptions
): Promise<StructuredResult<T>> {
  const args = buildGeminiArgs({
    prompt,
    model: options?.model ?? 'gemini-2.0-flash',
    outputFormat: 'json',
    schema,
  });

  const { stdout } = await execa('gemini', args, { stdin: 'ignore' });
  return JSON.parse(stdout);
}
```

---

## Comparison: Claude vs Gemini CLI

| Feature | Claude CLI | Gemini CLI |
|---------|------------|------------|
| Headless flag | `-p` / `--print` | `-p` / `--prompt` |
| JSON output | `--output-format json` | `--output-format json` |
| Stream output | `--output-format stream-json --verbose` | `--output-format stream-json` |
| Structured schema | `--json-schema '{...}'` | `--schema '{...}'` |
| Tools control | `--tools "..."` | N/A (API-level) |
| Permission bypass | `--permission-mode bypassPermissions` | N/A |
| Session management | `--session-id`, `--continue` | External/orchestrator |
| Config location | `~/.claude/` | `~/.gemini/` |

---

*Sources: geminicli.com, google-gemini.github.io, ai.google.dev*
