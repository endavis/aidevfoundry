# Self-Discover Codex Integration Task

## Overview

This task demonstrates how to integrate the **self-discover** sub-droid into the PuzldAI workflow for atomic problem analysis before final planning.

## Purpose

The self-discover sub-droid provides:
- **Atomic Problem Analysis**: Breaks down complex tasks into minimal steps
- **Meta-Reasoning**: Explicit self-correction loops to resolve conflicts
- **Dual-Path Verification**: Parity checks between different approaches
- **Adversarial Simulation**: Proactively identifies failure modes
- **Structured Output**: INI-TSV format for predictable parsing

## Integration Points

### 1. Before Autopilot Planning

Use self-discover to analyze complex tasks before `pk-puzldai autopilot` generates execution plans:

```typescript
// In src/executor/planner.ts or src/orchestrator/index.ts

async function generatePlanWithAnalysis(task: string) {
  // Step 1: Run self-discover for atomic analysis
  const analysis = await runSelfDiscover(task);
  
  // Step 2: Parse INI-TSV output
  const parsed = parseSelfDiscoverOutput(analysis);
  
  // Step 3: Use analysis to inform plan generation
  const plan = buildExecutionPlan(task, {
    selectedModules: parsed.SELECT.modules,
    implementationSteps: parsed.IMPLEMENT.steps,
    verificationGates: parsed.VERIFY.qa_checks,
    parityChecks: parsed.VERIFY.parity_checks
  });
  
  return plan;
}
```

### 2. Before PickBuild Workflow

Enhance `pk-puzldai pickbuild` with atomic analysis of the proposed plans:

```typescript
// In src/cli/commands/pickbuild.ts or src/executor/plan-builders.ts

async function pickBuildWithAnalysis(task: string, agents: string[]) {
  // Step 1: Run self-discover to understand the problem space
  const analysis = await runSelfDiscover(task);
  
  // Step 2: Generate proposals from agents
  const proposals = await generateProposals(task, agents, analysis);
  
  // Step 3: Use parity checks from analysis to compare proposals
  const comparison = compareProposals(proposals, analysis.VERIFY.parity_checks);
  
  // Step 4: Present to user for selection
  return presentForSelection(comparison);
}
```

### 3. Complex Task Detection

Automatically invoke self-discover for complex tasks:

```typescript
// In src/orchestrator/index.ts or src/router/router.ts

function shouldUseSelfDiscover(task: string, routing: RouteResult): boolean {
  // Use self-discover for:
  // - Architectural changes
  // - Multi-file refactoring
  // - Security-sensitive tasks
  // - Performance optimizations
  // - Tasks with high complexity
  
  const complexityIndicators = [
    /refactor|architecture|redesign/i,
    /security|auth|encryption|pii/i,
    /performance|optimization|cache/i,
    /migration|upgrade|integration/i,
    /\b(and|,|&)\b.*\b(and|,|&)\b/ // Multiple requirements
  ];
  
  return complexityIndicators.some(pattern => pattern.test(task));
}
```

## Implementation

### Step 1: Create Self-Discover Runner

Create `src/agentic/self-discover.ts`:

```typescript
import { execa } from 'execa';
import { getConfig } from '../lib/config';

export interface SelfDiscoverOutput {
  SELECT: {
    meta: { task_type: string; timestamp_utc: string };
    selected_modules: Array<{
      tier: 'core' | 'opt';
      name: string;
      why: string;
    }>;
  };
  IMPLEMENT: {
    constraints: { performance_budget_ms: number; max_retries: number };
    meta: { timestamp_utc: string; cache_key: string };
    success_criteria: { item: string[] };
    steps: Array<{
      key: string;
      action: string;
      inputs_csv: string;
      outputs_csv: string;
      tool: string;
      guardrails_csv: string;
      on_error_retry: string;
      on_error_fallback: string;
      on_error_log: string;
    }>;
  };
  VERIFY: {
    meta: {
      trace_id: string;
      task_type: string;
      timestamp_utc: string;
      performance_budget_ms: number;
    };
    qa_checks: Array<{
      gate: string;
      status: 'pass' | 'fail';
      evidence: string;
    }>;
    meta_analysis: Array<{
      type: string;
      observation: string;
      resolution: string;
    }>;
    final_answer: {
      format: string;
      confidence: number;
      value: string;
    };
    residual_risks: Array<{ item: string }>;
  };
}

export async function runSelfDiscover(
  task: string,
  options?: { timeout?: number }
): Promise<SelfDiscoverOutput> {
  const config = getConfig();
  
  const { stdout } = await execa(
    'droid',
    ['self-discover', task],
    {
      timeout: options?.timeout ?? 30000,
      reject: false,
      stdin: 'ignore'
    }
  );
  
  // Parse INI-TSV output
  return parseSelfDiscoverOutput(stdout);
}

function parseSelfDiscoverOutput(output: string): SelfDiscoverOutput {
  // Extract code fence content
  const codeFenceMatch = output.match(/```[\s\S]*?\n([\s\S]*?)```/);
  const content = codeFenceMatch ? codeFenceMatch[1] : output;
  
  // Parse INI-TSV format
  const sections: Record<string, any> = {};
  let currentSection: string | null = null;
  
  const lines = content.split('\n');
  for (const line of lines) {
    // Section header
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      sections[currentSection] = {};
      continue;
    }
    
    if (!currentSection) continue;
    
    // Key-value pairs (TSV)
    const [key, ...values] = line.split('\t');
    if (key && values.length > 0) {
      sections[currentSection][key] = values.join('\t');
    }
  }
  
  return sections as SelfDiscoverOutput;
}
```

### Step 2: Update CLI Commands

Modify `src/cli/commands/plan.ts` to use self-discover:

```typescript
import { runSelfDiscover } from '../agentic/self-discover';

export async function planCommand(args: {
  task: string;
  analyze?: boolean;
}) {
  console.log(`Planning task: ${args.task}`);
  
  // Run atomic analysis if requested or for complex tasks
  if (args.analyze || isComplexTask(args.task)) {
    console.log('\n🔬 Running atomic analysis...\n');
    const analysis = await runSelfDiscover(args.task);
    
    console.log('Selected modules:', analysis.SELECT.selected_modules.map(m => m.name).join(', '));
    console.log('Implementation steps:', analysis.IMPLEMENT.steps.length);
    console.log('QA gates:', analysis.VERIFY.qa_checks.length);
    
    // Use analysis to inform plan generation
    const plan = await generatePlan(args.task, { analysis });
    return plan;
  }
  
  // Default plan generation
  return await generatePlan(args.task);
}
```

### Step 3: Add CLI Flag

Add `--analyze` flag to run command:

```typescript
// In src/cli/index.ts

program
  .command('run [task]')
  .option('--analyze', 'Run atomic analysis before execution')
  .action(async (task, options) => {
    await runCommand(task, options);
  });
```

## Usage Examples

### Example 1: Complex Refactoring

```bash
# Run with atomic analysis
pk-puzldai run "Refactor authentication system to use JWT" --analyze

# Self-discover will:
# - Select modules: Security_Preflight, Verification_Strategy, Edge_Case_Scan
# - Identify security risks (PII, secrets, injection)
# - Create parity check: Current vs JWT implementation
# - Suggest adversarial simulation: Session hijacking, CSRF
# - Output confidence score and residual risks
```

### Example 2: Performance Optimization

```bash
# Pick build with analysis
pk-puzldai pickbuild "Add Redis caching layer" -a claude,gemini --analyze

# Self-discover will:
# - Select modules: Algorithmic_Complexity, Fault_Tolerance, Verification_Strategy
# - Compare Redis vs in-memory caching (parity check)
# - Identify performance bottlenecks
# - Plan rollback strategy
# - Suggest cache invalidation strategy
```

### Example 3: Security Enhancement

```bash
# Autopilot with atomic analysis
pk-puzldai autopilot "Add input validation to all API endpoints" --analyze

# Self-discover will:
# - Select modules: Security_Preflight, Edge_Case_Scan, Adversarial_Sim_Review
# - Identify injection points
# - Simulate attack vectors (SQL injection, XSS)
# - Create validation strategy
# - Plan verification with security tests
```

## Benefits

1. **Atomic Analysis**: Break down complex tasks into minimal, verifiable steps
2. **Meta-Reasoning**: Explicit self-correction loops resolve conflicts
3. **Dual-Path Verification**: Compare approaches before committing to implementation
4. **Adversarial Thinking**: Proactively identify and mitigate failure modes
5. **Structured Output**: Predictable INI-TSV format for programmatic consumption
6. **Confidence Scoring**: Quantitative assessment of approach viability
7. **Risk Identification**: Explicit residual risk documentation

## Next Steps

1. ✅ Create `/self-discover` command
2. ⬜ Implement `src/agentic/self-discover.ts` parser
3. ⬜ Add `--analyze` flag to `run`, `autopilot`, `pickbuild` commands
4. ⬜ Test with real-world scenarios
5. ⬜ Document best practices and patterns

## Testing

Test the integration:

```bash
# Test self-discover command
droid self-discover "Add Redis caching to API responses"

# Test with run command
pk-puzldai run "Add input validation" --analyze

# Test with autopilot
pk-puzldai autopilot "Refactor data layer" --analyze
```

## Notes

- Self-discover adds ~30 seconds to planning time
- Most beneficial for complex, multi-faceted tasks
- Can be disabled with `--no-analyze` flag
- Results can be cached for similar tasks
- INI-TSV output can be stored for audit trails
