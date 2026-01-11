# Self-Discover Analysis: Usage Guide

## Overview

The Self-Discover framework provides atomic problem analysis using structured meta-reasoning. This guide shows how to use it with PuzldAI and Factory Droid.

## Quick Start

### Option 1: Direct Analysis with Factory Droid

```bash
# Run atomic analysis on a task
droid exec "Analyze this task using SELF-DISCOVER v5 framework:

Task: Add Redis caching layer to API responses

Output exactly one INI-TSV block with:
- [SELECT v5]: Module selection (4 core + 0-6 optional modules)
- [IMPLEMENT v5]: Implementation plan with steps, tools, guardrails
- [VERIFY v5]: QA gates, parity checks, meta-analysis

Core modules (always include):
1. Define_Task_Contract
2. Define_IO
3. Decompose_Task
4. Tool_Selection

Optional modules (select if relevant):
- Verification_Strategy
- Fault_Tolerance
- Security_Preflight
- Algorithmic_Complexity
- Edge_Case_Scan
- Grounding_and_Source
- Ensemble_Parity_Check
- Adversarial_Sim_Review
- Meta_Reasoning_Refinement

Use ISO8601Z timestamps. Tabs separate columns."
```

### Option 2: Using the Self-Discover Command File

The `.factory/commands/self-discover.md` file provides a reusable prompt template:

```bash
# The command file is located at:
# .factory/commands/self-discover.md

# To use it, copy the prompt and replace $ARGUMENTS with your task
```

## INI-TSV Output Format

The analysis produces a structured INI-TSV block:

```ini
[SELECT v5]
meta	task_type	timestamp_utc
feature_add	2026-01-10T12:34:56.789Z
selected_modules	tier	name	why
core	1	Define_Task_Contract	always
core	2	Define_IO	always
core	3	Decompose_Task	always
core	4	Tool_Selection	always
opt	5	Verification_Strategy	Need tests for cache behavior
opt	6	Fault_Tolerance	Cache failures should fallback to DB
opt	7	Algorithmic_Complexity	Performance is key requirement
opt	8	Ensemble_Parity_Check	Compare Redis vs in-memory

[IMPLEMENT v5]
constraints	performance_budget_ms	max_retries
5000	3
meta	timestamp_utc	cache_key
2026-01-10T12:34:56.789Z	H(feature_add)
success_criteria	item
all_tests_pass
no_secrets_leaked
parity_check_success
self_correction_verified
stop_condition	text
all success_criteria true
steps	key	action	inputs_csv	outputs_csv	tool	guardrails_csv	on_error_retry	on_error_fallback	on_error_log
step01_contract	Define task contract	task	description	contract	none	prechecks	none	fail_fast	class,msg,attempts,elapsed
step02_io	Define IO + validation	contract	io_spec	none	prechecks	none	fail_fast	class,msg,attempts,elapsed
step03_decompose	Decompose into minimal steps	io_spec	step_plan	none	determinism	none	fail_fast	class,msg,attempts,elapsed
step04_tools	Select tools + safety	step_plan	tool_plan	none	dom_safety	none	fail_fast	class,msg,attempts,elapsed
step70_parity	Develop dual-path cross-check	io_spec	parity_spec	none	verification	none	fail_fast	status,elapsed
step90_execute	Execute using chosen tools	tool_plan	artifacts	code.exec	resource_caps	jitter2	rollback	class,msg,attempts,elapsed
step95_verify	Invoke verification gates	artifacts	qa_report	none	tests	none	fail_fast	status,elapsed

[VERIFY v5]
meta	trace_id	task_type	timestamp_utc	performance_budget_ms
abc-123	feature_add	2026-01-10T12:34:56.789Z	5000
qa_checks	gate	status	evidence
tests_passed	pass	Unit tests for cache hit/miss
no_secrets_leaked	pass	No credentials in cache keys
parity_cross_check	pass	Redis 2x faster than in-memory
meta_analysis	type	observation	resolution
conflict_detection	Performance vs complexity	Separate cache layer for modularity
self_correction	N/A	No issues found
final_answer	format	confidence	value
markdown	0.92	Implement Redis cache with 5min TTL
residual_risks	item
<row>	Cache stampede if key expires
```

## Integration with PuzldAI

### Before Running Autopilot

```bash
# Step 1: Run atomic analysis
droid exec "Analyze using SELF-DISCOVER v5: Refactor authentication system" > analysis.txt

# Step 2: Use analysis to inform autopilot
pk-puzldai autopilot "Refactor authentication system" --context analysis.txt
```

### Before PickBuild

```bash
# Step 1: Analyze the problem space
droid exec "SELF-DISCOVER v5 analysis: Add input validation to API" > analysis.txt

# Step 2: Run pickbuild with analysis context
pk-puzldai pickbuild "Add input validation" -a claude,gemini --context analysis.txt
```

### For Complex Tasks

```bash
# Detect complex tasks that benefit from analysis
COMPLEX_PATTERNS=(
  "refactor|architecture|redesign"
  "security|authentication|authorization"
  "performance|optimization|caching"
  "migration|upgrade|integration"
)

TASK="Add Redis caching to API responses"

if [[ "$TASK" =~ ${COMPLEX_PATTERNS[@]} ]]; then
  echo "Complex task detected - running atomic analysis..."
  droid exec "SELF-DISCOVER v5: $TASK" > analysis.txt
  pk-puzldai run "$TASK" --with-analysis analysis.txt
fi
```

## Example Analyses

### Example 1: Feature Addition

**Task**: Add user password reset feature

**Selected Modules**: Verification_Strategy, Security_Preflight, Edge_Case_Scan, Adversarial_Sim_Review

**Key Insights**:
- Security: Token expiration, rate limiting, secure random tokens
- Edge cases: Expired tokens, already used tokens, email delivery failures
- Adversarial: Token enumeration, timing attacks, email flooding
- Parity check: Compare token-based vs link-based approaches

### Example 2: Performance Optimization

**Task**: Optimize database query performance

**Selected Modules**: Algorithmic_Complexity, Verification_Strategy, Fault_Tolerance, Ensemble_Parity_Check

**Key Insights**:
- Complexity: O(n²) queries → O(n) with indexing
- Verification: Query execution time, result correctness
- Fault tolerance: Fallback to full table scan if index fails
- Parity: Index-based vs materialized view approaches

### Example 3: Security Enhancement

**Task**: Add rate limiting to API endpoints

**Selected Modules**: Security_Preflight, Verification_Strategy, Edge_Case_Scan, Adversarial_Sim_Review, Meta_Reasoning_Refinement

**Key Insights**:
- Security: Prevent DDoS, protect sensitive endpoints
- Edge cases: Burst traffic, distributed attacks, legitimate high-volume users
- Adversarial: Bypass attempts, IP spoofing, credential stuffing
- Meta-reasoning: Balance security vs user experience

## Parsing the Output

### Python Example

```python
import re
from datetime import datetime

def parse_ini_tsv(output: str) -> dict:
    """Parse INI-TSV output from self-discover analysis"""
    
    # Extract code fence content
    match = re.search(r'```[\s\S]*?\n([\s\S]*?)```', output)
    content = match.group(1) if match else output
    
    sections = {}
    current_section = None
    
    for line in content.split('\n'):
        # Section header
        section_match = re.match(r'\[([^\]]+)\]', line)
        if section_match:
            current_section = section_match.group(1)
            sections[current_section] = {}
            continue
        
        if not current_section:
            continue
        
        # Key-value pairs (tab-separated)
        parts = line.split('\t')
        if len(parts) >= 2:
            key = parts[0]
            value = '\t'.join(parts[1:])
            sections[current_section][key] = value
    
    return sections

# Usage
output = open('analysis.txt').read()
parsed = parse_ini_tsv(output)
print(f"Task type: {parsed['SELECT']['meta']}")
print(f"Selected modules: {parsed['SELECT']['selected_modules']}")
```

### TypeScript Example

```typescript
interface SelfDiscoverOutput {
  SELECT: {
    meta: { task_type: string; timestamp_utc: string };
    selected_modules: string;
  };
  IMPLEMENT: {
    constraints: string;
    steps: string;
  };
  VERIFY: {
    qa_checks: string;
    meta_analysis: string;
    final_answer: string;
  };
}

function parseIniTsv(output: string): SelfDiscoverOutput {
  // Extract code fence
  const codeFenceMatch = output.match(/```[\s\S]*?\n([\s\S]*?)```/);
  const content = codeFenceMatch?.[1] || output;
  
  const sections: Record<string, any> = {};
  let currentSection: string | null = null;
  
  for (const line of content.split('\n')) {
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      sections[currentSection] = {};
      continue;
    }
    
    if (!currentSection) continue;
    
    const [key, ...values] = line.split('\t');
    if (key && values.length > 0) {
      sections[currentSection][key] = values.join('\t');
    }
  }
  
  return sections as SelfDiscoverOutput;
}
```

## Benefits

1. **Atomic Analysis**: Break down complex tasks into minimal steps
2. **Meta-Reasoning**: Explicit self-correction loops
3. **Dual-Path Verification**: Compare approaches before implementing
4. **Adversarial Thinking**: Proactively identify failure modes
5. **Structured Output**: Predictable format for automation
6. **Confidence Scoring**: Quantitative assessment
7. **Risk Documentation**: Explicit residual risks

## Best Practices

1. **Use for Complex Tasks**: Architectural changes, security work, performance optimization
2. **Review Parity Checks**: Compare multiple approaches before committing
3. **Check Meta-Analysis**: Look for conflict detection and self-correction
4. **Verify Confidence Scores**: Low confidence indicates need for more analysis
5. **Document Residual Risks**: Ensure risks are acceptable before proceeding
6. **Cache Results**: Store analysis for similar future tasks

## Tips

- Run analysis before making architectural decisions
- Use parity checks to compare implementation approaches
- Pay attention to adversarial simulation results
- Review meta-analysis for conflict resolution
- Consider confidence scores when choosing approaches
- Document residual risks in project notes

## Troubleshooting

**Issue**: Analysis doesn't complete
- **Solution**: Break task into smaller sub-tasks

**Issue**: Too many optional modules selected
- **Solution**: Focus on most critical aspects, limit to 6 optional modules

**Issue**: Parity check shows major conflicts
- **Solution**: Review meta-analysis section for resolution approach

**Issue**: Low confidence score (< 0.7)
- **Solution**: Run additional analysis or break into smaller tasks
