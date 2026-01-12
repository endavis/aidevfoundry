# Claude CLI Wrapper Guide for Agentic Apps

Expert-level reference for wrapping `claude -p` (print mode) in PuzldAI adapters and agents.

## Input/Output Format Matrix

| Input Format | Output Format | Requirement | Use Case |
|--------------|---------------|-------------|----------|
| `text` (default) | `text` (default) | None | Simple pipes, human-readable |
| `text` | `json` | None | Structured responses with metadata |
| `text` | `stream-json` | `--verbose` | Real-time streaming UI |
| `stream-json` | `stream-json` | `--verbose` | **Bidirectional streaming** (full duplex) |

### Critical Gotchas
- `--output-format stream-json` **REQUIRES** `--verbose` or you get an error
- `--input-format stream-json` **REQUIRES** `--output-format stream-json` (bidirectional only)
- `structured_output` is **SEPARATE** from `result` field in JSON response

---

## Input Methods (5 Ways)

### 1. Command Line Argument (Most Common)
```bash
claude -p "What is 2+2?"
claude -p --model haiku "Explain recursion"
```

### 2. Stdin Pipe
```bash
echo "What is 2+2?" | claude -p
cat README.md | claude -p "Summarize this"
git diff | claude -p "Review these changes"
```

### 3. Stdin Redirect
```bash
claude -p < prompt.txt
claude -p --model sonnet < complex_task.md
```

### 4. Here-Doc (Multi-line Prompts)
```bash
claude -p <<EOF
You are a code reviewer. Review this code:

\`\`\`python
def add(a, b):
    return a + b
\`\`\`

Focus on: error handling, edge cases, documentation.
EOF
```

### 5. Stream-JSON Input (Bidirectional)
```bash
echo '{"type":"user","message":{"role":"user","content":"Hello"}}' | \
  claude -p --input-format stream-json --output-format stream-json --verbose
```

### Combining Input Methods
```bash
# File content via stdin, instruction via argument
cat code.py | claude -p "Find bugs in this code"

# Git diff via stdin, task via argument
git diff HEAD~3 | claude -p "Write commit message for these changes"
```

---

## Output Formats

### 1. Text Output (Default)
```bash
claude -p "What is 2+2?"
# Output: 4

# Capture to variable
response=$(claude -p "What is 2+2?")

# Save to file
claude -p "Write a haiku" > haiku.txt

# Pipe to another command
claude -p "List 5 colors as JSON array" | jq '.'
```

### 2. JSON Output
```bash
claude -p --output-format json "What is 2+2?"
```

Response structure:
```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "duration_ms": 1336,
  "duration_api_ms": 20400,
  "num_turns": 1,
  "result": "4",
  "session_id": "uuid-here",
  "total_cost_usd": 0.0427,
  "usage": {
    "input_tokens": 2,
    "output_tokens": 5,
    "cache_read_input_tokens": 15792
  },
  "modelUsage": {
    "claude-haiku-4-5-20251001": {
      "inputTokens": 5,
      "outputTokens": 169,
      "costUSD": 0.028
    }
  }
}
```

Extract fields with jq:
```bash
# Get just the result
claude -p --output-format json "What is 2+2?" | jq -r '.result'

# Get cost
claude -p --output-format json "Hello" | jq '.total_cost_usd'

# Check for errors
claude -p --output-format json "task" | jq '.is_error'
```

### 3. Stream-JSON Output (Real-Time)
```bash
claude -p --output-format stream-json --verbose "Write a poem"
```

Emits multiple JSON events (one per line):
```json
{"type":"system","subtype":"init","session_id":"...","tools":[...],"model":"..."}
{"type":"stream_event","event":{"type":"content_block_delta","delta":{"text":"Roses"}}}
{"type":"stream_event","event":{"type":"content_block_delta","delta":{"text":" are"}}}
{"type":"assistant","message":{...}}
{"type":"result","subtype":"success","total_cost_usd":0.02,...}
```

Parse in real-time (bash):
```bash
claude -p --output-format stream-json --verbose "Write a story" | \
  while IFS= read -r line; do
    text=$(echo "$line" | jq -r '.event.delta.text // empty' 2>/dev/null)
    [ -n "$text" ] && printf "%s" "$text"
  done
```

Parse in Node.js:
```javascript
const readline = require('readline');

for await (const line of readline.createInterface({ input: process.stdin })) {
  const event = JSON.parse(line);
  if (event.type === 'stream_event' && event.event?.delta?.text) {
    process.stdout.write(event.event.delta.text);
  }
}
```

---

## Structured Output with JSON Schema

**Killer feature for data extraction:**

```bash
echo "What is the capital of France?" | claude -p \
  --model haiku \
  --output-format json \
  --json-schema '{"type":"object","properties":{"answer":{"type":"string"},"confidence":{"type":"number"}},"required":["answer"]}'
```

Response includes BOTH fields:
```json
{
  "result": "The capital of France is **Paris**.",
  "structured_output": {
    "answer": "Paris",
    "confidence": 1.0
  }
}
```

**Use cases:**
- Data extraction pipelines
- Form filling automation
- API response formatting
- Type-safe agentic outputs

---

## Tool Configuration

### Disable All Tools (Pure LLM)
```bash
echo "Hello" | claude -p --tools ""
```

### Specific Tool Whitelist
```bash
echo "List files" | claude -p --tools "Bash,Read,Glob,Grep"
```

### Pattern-Based Allow/Deny
```bash
# Only allow git commands
claude -p --allowedTools "Bash(git:*)" "commit these changes"

# Block destructive tools
claude -p --disallowedTools "Write,Edit,Bash" "analyze this code"
```

---

## Permission Modes

### For Autonomous/CI/CD Execution
```bash
echo "$task" | claude -p \
  --model sonnet \
  --permission-mode bypassPermissions \
  --tools "Bash,Read,Write,Edit" \
  --output-format json
```

Convenience flag:
```bash
--dangerously-skip-permissions  # Equivalent to --permission-mode bypassPermissions
```

---

## Session Management

### Ephemeral Sessions (No Disk Storage)
```bash
echo "task" | claude -p --no-session-persistence
```

### Fixed Session ID (Multi-Turn)
```bash
SESSION="11111111-1111-1111-1111-111111111111"

# Turn 1
echo "My name is Alice" | claude -p --session-id $SESSION --output-format json

# Turn 2 (remembers context)
echo "What's my name?" | claude -p --session-id $SESSION --continue
```

### Continue Most Recent
```bash
claude -p --continue "follow up question"
```

---

## System Prompts

### Replace Entirely
```bash
echo "review this code" | claude -p \
  --system-prompt "You are a senior code reviewer. Be concise and critical."
```

### Append to Default (Recommended)
Preserves Claude Code's capabilities:
```bash
echo "help me" | claude -p \
  --append-system-prompt "IMPORTANT: Always respond in bullet points."
```

---

## Custom Agents

```bash
claude -p \
  --agents '{"reviewer":{"description":"Code reviewer","prompt":"You are a strict code reviewer."}}' \
  --agent reviewer \
  "review this function"
```

---

## Model Selection

### Basic Choice
```bash
claude -p --model haiku "quick question"   # Fast and cheap
claude -p --model sonnet "standard task"   # Balanced
claude -p --model opus "complex task"      # Best quality
```

### Fallback for Reliability
```bash
claude -p --model sonnet --fallback-model haiku "important task"
```

---

## Bidirectional Streaming (Advanced)

For real-time interactive applications:

```bash
echo '{"type":"user","message":{"role":"user","content":"Hello"}}' | \
  claude -p \
  --input-format stream-json \
  --output-format stream-json \
  --verbose \
  --replay-user-messages
```

The `--replay-user-messages` flag echoes user messages back with `"isReplay": true`.

Input format:
```json
{"type":"user","message":{"role":"user","content":"Your message"}}
```

---

## Quick Reference Table

| Goal | Command |
|------|---------|
| Simple chat | `echo "hi" \| claude -p` |
| JSON response | `claude -p --output-format json` |
| Streaming | `claude -p --output-format stream-json --verbose` |
| Structured data | `claude -p --json-schema '...'` |
| No tools | `claude -p --tools ""` |
| Full autonomy | `claude -p --permission-mode bypassPermissions` |
| Ephemeral | `claude -p --no-session-persistence` |
| Custom persona | `claude -p --system-prompt "..."` |
| Append persona | `claude -p --append-system-prompt "..."` |
| Fast/cheap | `claude -p --model haiku` |
| Best quality | `claude -p --model opus` |
| With fallback | `claude -p --model sonnet --fallback-model haiku` |
| Multi-turn | `claude -p --session-id $UUID` |
| Continue | `claude -p --continue "..."` |

---

## Production Wrapper Examples

### Bash: Agentic Wrapper
```bash
#!/bin/bash
# agentic-claude.sh - Production wrapper for autonomous execution

TASK="$1"
SESSION_ID="${2:-$(uuidgen)}"

result=$(echo "$TASK" | claude -p \
  --model sonnet \
  --fallback-model haiku \
  --tools "Bash,Read,Write,Edit,Glob,Grep" \
  --permission-mode bypassPermissions \
  --no-session-persistence \
  --output-format json \
  --json-schema '{"type":"object","properties":{"success":{"type":"boolean"},"summary":{"type":"string"}},"required":["success","summary"]}')

success=$(echo "$result" | jq -r '.structured_output.success')
summary=$(echo "$result" | jq -r '.structured_output.summary')
cost=$(echo "$result" | jq -r '.total_cost_usd')

echo "Task: $success"
echo "Summary: $summary"
echo "Cost: \$$cost"
```

### TypeScript: Chatbot Wrapper
```typescript
import { execSync } from 'child_process';

interface ClaudeResult {
  type: string;
  subtype: string;
  result: string;
  total_cost_usd: number;
  is_error: boolean;
}

function chat(prompt: string, model = 'haiku'): ClaudeResult {
  const result = execSync(
    `claude -p --model ${model} --output-format json`,
    { input: prompt, encoding: 'utf-8' }
  );
  return JSON.parse(result);
}

const response = chat('What is the meaning of life?');
console.log(response.result);
console.log(`Cost: $${response.total_cost_usd.toFixed(4)}`);
```

### TypeScript: Data Extraction Pipeline
```typescript
import { execSync } from 'child_process';

interface ExtractedData {
  entities: string[];
  sentiment: 'positive' | 'negative' | 'neutral';
  summary: string;
}

interface ClaudeResult {
  result: string;
  structured_output?: ExtractedData;
}

const SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    entities: { type: 'array', items: { type: 'string' } },
    sentiment: { enum: ['positive', 'negative', 'neutral'] },
    summary: { type: 'string' }
  },
  required: ['entities', 'sentiment', 'summary']
});

function extract(text: string): ExtractedData | undefined {
  const result = execSync(
    `claude -p --model haiku --output-format json --json-schema '${SCHEMA}'`,
    { input: `Extract entities, sentiment, and summary from: ${text}`, encoding: 'utf-8' }
  );
  const data: ClaudeResult = JSON.parse(result);
  return data.structured_output;
}

const info = extract('I love this new iPhone! Apple really outdid themselves.');
console.log(info);
// { entities: ['iPhone', 'Apple'], sentiment: 'positive', summary: '...' }
```

---

## PuzldAI Integration Patterns

### Adapter Enhancement
```typescript
// src/adapters/claude.ts additions

interface StructuredResult<T> {
  result: string;
  structured_output: T;
  total_cost_usd: number;
  usage: { input_tokens: number; output_tokens: number };
}

// Structured extraction
async extract<T>(prompt: string, schema: object): Promise<StructuredResult<T>> {
  const args = buildClaudeArgs({
    prompt,
    model: 'haiku',
    disableTools: true,
  });
  args.push('--json-schema', JSON.stringify(schema));
  // ... execute and parse
}

// Autonomous execution
async autonomous(task: string, tools?: string[]): Promise<ModelResponse> {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'bypassPermissions',
    '--no-session-persistence',
  ];
  if (tools) {
    args.push('--tools', tools.join(','));
  }
  args.push(task);
  // ... execute with streaming
}
```

### Agent Spawn Pattern
```bash
# Single agent with full autonomy
claude --agent ui-components-agent \
  --output-format stream-json \
  --verbose \
  --permission-mode bypassPermissions \
  --no-session-persistence

# Coordinated agents with shared session
SHARED_SESSION=$(uuidgen)

claude --agent agent1 --session-id $SHARED_SESSION &
claude --agent agent2 --session-id $SHARED_SESSION --continue &
wait
```

---

*Source: trysquad.ai implementation guide | Claude Code version: 2.1.2 | Tested: 2026-01-08*
