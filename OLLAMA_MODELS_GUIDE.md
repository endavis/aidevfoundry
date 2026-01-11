# Ollama Models for PuzldAI - Lightweight Options

## Current Default Model

**Model**: `llama3.2`
**Size**: ~2.0 GB (RAM when running)
**Parameters**: 3 billion
**Purpose**: Task routing and local LLM operations

**Why llama3.2?**
- Good balance of speed and intelligence
- 3B parameters - efficient for routing tasks
- Fast inference on modern CPUs
- Good at following structured JSON instructions

---

## Lightweight Alternatives

### Option 1: Phi-3.5 Mini (RECOMMENDED)

**Model**: `phi3.5` or `phi3.5:mini`
**Size**: ~2.3 GB (RAM when running)
**Parameters**: 3.8 billion
**Performance**: ⚡ Very Fast
**Quality**: 🧠 Excellent for small tasks

**Installation**:
```bash
ollama pull phi3.5
# or specifically the mini version
ollama pull phi3.5:mini
```

**Configuration**:
```json
{
  "routerModel": "phi3.5",
  "adapters": {
    "ollama": {
      "enabled": true,
      "model": "phi3.5",
      "host": "http://localhost:11434"
    }
  }
}
```

**Pros**:
- ✅ Faster than llama3.2 (better CPU optimization)
- ✅ Good at following instructions
- ✅ Strong reasoning for small model
- ✅ Built by Microsoft (well-maintained)
- ✅ Similar memory footprint to llama3.2

**Cons**:
- ⚠️ Slightly larger model file (but similar RAM usage)
- ⚠️ Newer model (less battle-tested)

**Best For**: Routing, classification, simple tasks

---

### Option 2: Phi-3 Mini (Smallest)

**Model**: `phi3`
**Size**: ~2.2 GB (RAM when running)
**Parameters**: 3.8 billion
**Performance**: ⚡⚡ Fastest
**Quality**: 🧠 Good for small tasks

**Installation**:
```bash
ollama pull phi3
```

**Configuration**:
```json
{
  "routerModel": "phi3",
  "adapters": {
    "ollama": {
      "enabled": true,
      "model": "phi3",
      "host": "http://localhost:11434"
    }
  }
}
```

**Pros**:
- ✅ Fastest inference (highly optimized)
- ✅ Small memory footprint
- ✅ Good at simple routing
- ✅ Low CPU usage

**Cons**:
- ⚠️ Less capable with complex reasoning
- ⚠️ May struggle with nuanced tasks

**Best For**: Simple routing, low-resource systems

---

### Option 3: Gemma 2 (2B)

**Model**: `gemma2:2b`
**Size**: ~1.6 GB (RAM when running)
**Parameters**: 2 billion
**Performance**: ⚡⚡⚡ Very Fast
**Quality**: 🧠🧠 Good for small model

**Installation**:
```bash
ollama pull gemma2:2b
```

**Configuration**:
```json
{
  "routerModel": "gemma2:2b",
  "adapters": {
    "ollama": {
      "enabled": true,
      "model": "gemma2:2b",
      "host": "http://localhost:11434"
    }
  }
}
```

**Pros**:
- ✅ Smallest memory footprint (~1.6 GB)
- ✅ Very fast inference
- ✅ Built by Google (well-maintained)
- ✅ Good at simple tasks
- ✅ Lower CPU usage

**Cons**:
- ⚠️ Less capable with complex routing
- ⚠️ May need more prompts for nuanced decisions

**Best For**: Low-resource systems, simple routing

---

### Option 4: Qwen 2.5 (0.5B or 1.5B)

**Model**: `qwen2.5:0.5b` or `qwen2.5:1.5b`
**Size**: 
- 0.5B: ~0.4 GB (RAM when running)
- 1.5B: ~1.0 GB (RAM when running)
**Parameters**: 0.5B or 1.5B
**Performance**: ⚡⚡⚡⚡ Extremely Fast
**Quality**: 🧠 Basic capabilities

**Installation**:
```bash
ollama pull qwen2.5:0.5b
# or
ollama pull qwen2.5:1.5b
```

**Configuration**:
```json
{
  "routerModel": "qwen2.5:0.5b",
  "adapters": {
    "ollama": {
      "enabled": true,
      "model": "qwen2.5:0.5b",
      "host": "http://localhost:11434"
    }
  }
}
```

**Pros**:
- ✅ Minimal memory usage (0.4 GB for 0.5B!)
- ✅ Extremely fast inference
- ✅ Good for very simple routing
- ✅ Lowest CPU usage

**Cons**:
- ⚠️ Limited reasoning capabilities
- ⚠️ May struggle with complex tasks
- ⚠️ Lower quality routing decisions

**Best For**: Extremely low-resource systems, basic routing

---

## Comparison Table

| Model | Size (RAM) | Speed | Quality | Best For |
|-------|-----------|-------|---------|----------|
| **llama3.2** (current) | 2.0 GB | ⚡⚡ | 🧠🧠🧠 | Balanced routing |
| **phi3.5** | 2.3 GB | ⚡⚡⚡ | 🧠🧠🧠 | **RECOMMENDED** - Fast & smart |
| **phi3** | 2.2 GB | ⚡⚡⚡⚡ | 🧠🧠 | Fast routing |
| **gemma2:2b** | 1.6 GB | ⚡⚡⚡ | 🧠🧠 | Low resources |
| **qwen2.5:1.5b** | 1.0 GB | ⚡⚡⚡⚡ | 🧠 | Very low resources |
| **qwen2.5:0.5b** | 0.4 GB | ⚡⚡⚡⚡⚡ | 🧠 | Minimal resources |

---

## Recommendations by System Resources

### 8 GB RAM Systems

**Recommended**: `phi3.5` or `llama3.2`
- Enough memory for OS + model + other apps
- Good balance of speed and intelligence

### 4 GB RAM Systems

**Recommended**: `gemma2:2b` or `phi3`
- Tight fit, but manageable
- Close other applications when running

### 2 GB RAM Systems (or very old PCs)

**Recommended**: `qwen2.5:1.5b` or `qwen2.5:0.5b`
- Minimal memory usage
- May need to close all other apps
- Expect lower quality routing

---

## How to Change Model

### Option 1: Edit Config File

**Location**: `~/.puzldai/config.json`

```bash
# Edit config
nano ~/.puzldai/config.json

# Change these lines:
{
  "routerModel": "phi3.5",           // For routing
  "adapters": {
    "ollama": {
      "model": "phi3.5"             // For direct ollama usage
    }
  }
}
```

### Option 2: Use PuzldAI CLI

```bash
# View current model
pk-puzldai model show

# Set new model (if command exists)
pk-puzldai model set ollama phi3.5
```

### Option 3: Use PuzldAI TUI

```bash
# Launch TUI
pk-puzldai

# Navigate to Model settings
# Change ollama model
# Save config
```

---

## Testing Your New Model

### Test Routing Performance

```bash
# Test routing with new model
time pk-puzldai run "What is 2+2?" -a auto

# Check speed and quality
```

### Test Direct Ollama Usage

```bash
# Test ollama directly
ollama run phi3.5 "Classify this task: 'Fix the login bug'"

# Should output JSON like:
# {"agent":"claude","confidence":0.85,"taskType":"bug-fix"}
```

### Benchmark Models

```bash
# Compare routing speed
for model in llama3.2 phi3.5 phi3 gemma2:2b; do
  echo "Testing $model..."
  time pk-puzldai run "Simple question" -a auto
done
```

---

## Troubleshooting

### Model Not Found

**Error**: `model 'phi3.5' not found`

**Solution**:
```bash
# Pull the model first
ollama pull phi3.5

# List available models
ollama list
```

### Out of Memory

**Error**: `cannot allocate memory`

**Solution**:
- Switch to smaller model (qwen2.5:0.5b)
- Close other applications
- Increase swap space

### Slow Inference

**Solution**:
- Use smaller model (phi3 or gemma2:2b)
- Check CPU usage (may be thermal throttling)
- Ensure Ollama is using GPU if available

### Poor Routing Quality

**Solution**:
- Use larger model (phi3.5 or llama3.2)
- Adjust `confidenceThreshold` in config
- Consider using specific agent instead of auto-routing

---

## Advanced: Quantized Models

For even lower memory usage, you can use quantized versions:

### Example: Phi-3.5 Quantized

```bash
# Pull quantized version (4-bit)
ollama pull phi3.5:q4_0

# Configuration
{
  "routerModel": "phi3.5:q4_0",
  "adapters": {
    "ollama": {
      "model": "phi3.5:q4_0"
    }
  }
}
```

**Memory Savings**: ~30-40% less RAM
**Trade-off**: Slightly lower quality

---

## My Recommendation

**For most users**: Switch to **`phi3.5`**

**Reasons**:
1. ✅ Faster than llama3.2 (better CPU optimization)
2. ✅ Similar memory footprint (~2.3 GB vs 2.0 GB)
3. ✅ Better instruction following
4. ✅ Strong reasoning for routing tasks
5. ✅ Well-maintained by Microsoft

**Configuration**:
```json
{
  "routerModel": "phi3.5",
  "adapters": {
    "ollama": {
      "enabled": true,
      "model": "phi3.5",
      "host": "http://localhost:11434"
    }
  }
}
```

**Installation**:
```bash
# Pull the model
ollama pull phi3.5

# Edit config
nano ~/.puzldai/config.json

# Restart PuzldAI
pk-puzldai run "test" -a auto
```

---

## Quick Reference Commands

```bash
# List available models
ollama list

# Pull recommended model
ollama pull phi3.5

# Pull ultra-light model
ollama pull qwen2.5:0.5b

# Test model
ollama run phi3.5 "Hello, world!"

# Edit config
nano ~/.puzldai/config.json

# View current config
pk-puzldai model show

# Test routing
time pk-puzldai run "test task" -a auto
```

---

**Last Updated**: 2026-01-10
**Current Default**: llama3.2
**Recommended**: phi3.5
