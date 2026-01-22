/**
 * PK-Poet Plan Builder
 *
 * Builds ExecutionPlans for the PK-Poet paradigm:
 * REASON → DISCOVER → ATTACK → FORTIFY → EXECUTE
 *
 * This unified reasoning framework combines:
 * 1. Code-as-Reasoning - Express understanding through executable code
 * 2. Self-Discover - Atomic problem analysis with meta-reasoning
 * 3. Adversary - Red-team attack simulation and failure-mode analysis
 * 4. Poetic - Spec-first planning with verification-first execution
 * 5. Poetiq - Verification-first implementation with diverge/converge
 */

import type { ExecutionPlan, PlanStep, PKPoetOptions } from './types';

function generatePlanId(): string {
  return `pkpoet_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateStepId(phase: string, index: number = 0): string {
  return `${phase}_${index}`;
}

/**
 * Build a PK-Poet execution plan
 *
 * Workflow:
 * 1. REASON - Express understanding through code
 * 2. DISCOVER - Atomic problem analysis
 * 3. ATTACK - Red-team the plan
 * 4. FORTIFY - Create hardened specification
 * 5. EXECUTE - Verification-first implementation
 */
export function buildPKPoetPlan(
  prompt: string,
  options: PKPoetOptions = {}
): ExecutionPlan {
  const {
    depth = 'medium',
    reasonAgent = 'claude',
    discoverAgent = 'claude',
    attackAgent = 'claude',
    fortifyAgent = 'claude',
    executeAgent = 'claude',
    verifyCommand,
    verifyScope,
    maxIterations = 5,
    maxFiles = 8,
    projectStructure
  } = options;

  const steps: PlanStep[] = [];
  let stepIndex = 0;

  // Build context
  const context: Record<string, unknown> = {
    max_iterations: maxIterations,
    max_files: maxFiles,
    depth
  };

  if (projectStructure) {
    context.project_structure = projectStructure;
  }
  if (verifyCommand) {
    context.verify_command = verifyCommand;
  }
  if (verifyScope) {
    context.verify_scope = verifyScope;
  }

  // --- Phase 0: REASON (Code-as-Reasoning) ---
  steps.push({
    id: generateStepId('reason', stepIndex),
    agent: reasonAgent,
    action: 'prompt',
    prompt: buildReasonPrompt(depth),
    outputAs: 'reason_output'
  });
  stepIndex++;

  // --- Phase 1: DISCOVER (Self-Discover v5) ---
  steps.push({
    id: generateStepId('discover', stepIndex),
    agent: discoverAgent,
    action: 'analyze',
    prompt: buildDiscoverPrompt(depth, projectStructure),
    dependsOn: [generateStepId('reason', stepIndex - 1)],
    outputAs: 'discover_output'
  });
  stepIndex++;

  // --- Phase 2: ATTACK (Adversary Red-Team) ---
  steps.push({
    id: generateStepId('attack', stepIndex),
    agent: attackAgent,
    action: 'analyze',
    prompt: buildAttackPrompt(depth),
    dependsOn: [generateStepId('discover', stepIndex - 1)],
    outputAs: 'attack_output'
  });
  stepIndex++;

  // --- Phase 3: FORTIFY (Poetic Specification) ---
  steps.push({
    id: generateStepId('fortify', stepIndex),
    agent: fortifyAgent,
    action: 'analyze',
    prompt: buildFortifyPrompt(),
    dependsOn: [generateStepId('attack', stepIndex - 1)],
    outputAs: 'fortify_output'
  });
  stepIndex++;

  // --- Phase 4: EXECUTE (Poetiq Verification-First) ---
  steps.push({
    id: generateStepId('execute', stepIndex),
    agent: executeAgent,
    action: 'prompt',
    role: 'code',  // Enable agentic tools
    prompt: buildExecutePrompt(verifyCommand, maxIterations, maxFiles),
    dependsOn: [generateStepId('fortify', stepIndex - 1)],
    outputAs: 'execute_output'
  });
  stepIndex++;

  // --- Summary Step ---
  steps.push({
    id: generateStepId('summary', stepIndex),
    agent: executeAgent,
    action: 'combine',
    prompt: buildSummaryPrompt(),
    dependsOn: [generateStepId('execute', stepIndex - 1)],
    outputAs: 'pkpoet_summary'
  });

  return {
    id: generatePlanId(),
    mode: 'pkpoet' as any, // Will be added to PlanMode type
    prompt,
    steps,
    context,
    createdAt: Date.now()
  };
}

/**
 * Build prompt for REASON phase (Code-as-Reasoning)
 */
function buildReasonPrompt(depth: 'shallow' | 'medium' | 'deep'): string {
  const depthInstructions = {
    shallow: 'Define 1-2 type contracts and 2-3 key assertions.',
    medium: 'Define 3-4 type contracts, write pseudocode proof, and 5-8 assertions.',
    deep: 'Define comprehensive type contracts, detailed pseudocode with edge cases, 10+ assertions, and test specifications.'
  };

  return `# Phase 0: REASON (Code-as-Reasoning)

**Task:** {{prompt}}

**Depth:** ${depth} - ${depthInstructions[depth]}

## Instructions

Before any natural language analysis, express your understanding through executable code.

**Code-as-Reasoning Principle**: Natural language is ambiguous. Code is precise. By expressing understanding through types, assertions, and tests BEFORE reasoning, we catch logical errors early.

### Required Output

\`\`\`
[REASON]
type_contracts:
  // Define the shape of inputs and outputs
  interface TaskInput { ... }
  interface TaskOutput { ... }
  // Any other relevant interfaces

pseudocode_proof:
  // Write pseudocode that validates your understanding of the solution
  function solve(input: TaskInput): TaskOutput {
    // Express the solution logic
    assert(preconditions);
    const result = compute();
    assert(postconditions);
    return result;
  }

assertions:
  // List invariants that must ALWAYS hold
  - assert(condition, "explanation");

test_specifications:
  // Define test cases that specify expected behavior
  describe("Solution", () => {
    it("happy path case", () => { ... });
    it("edge case 1", () => { ... });
    it("error case", () => { ... });
  });

executable_examples:
  // Runnable examples demonstrating understanding
  const input = { ... };
  const result = solve(input);
  expect(result).toBe({ ... });
\`\`\`

Express your understanding through code NOW.`;
}

/**
 * Build prompt for DISCOVER phase (Self-Discover v5)
 */
function buildDiscoverPrompt(depth: 'shallow' | 'medium' | 'deep', projectStructure?: string): string {
  const moduleConfig = {
    shallow: '2 core modules only (Define_Task_Contract, Define_IO)',
    medium: '4 core + 2 optional modules',
    deep: '4 core + 6 optional modules with full analysis'
  };

  const projectContext = projectStructure
    ? `\n\n**Project Structure:**\n{{project_structure}}`
    : '';

  return `# Phase 1: DISCOVER (Self-Discover v5)

**Task:** {{prompt}}${projectContext}

**Previous Phase Output:**
{{reason_output}}

**Depth:** ${depth} - ${moduleConfig[depth]}

## Instructions

Perform atomic problem analysis using the SELF-DISCOVER v5 framework.

### Core Modules (Always Active)
1. **Define_Task_Contract**: objective, acceptance criteria, assumptions
2. **Define_IO**: inputs, outputs, schemas, validation
3. **Decompose_Task**: minimal ordered steps
4. **Tool_Selection**: choose tools, scope, safety

### Optional Modules (Select based on task)
- Verification_Strategy, Fault_Tolerance, Security_Preflight
- Algorithmic_Complexity, Edge_Case_Scan, Grounding_and_Source
- Ensemble_Parity_Check, Adversarial_Sim_Review, Meta_Reasoning_Refinement

### Required Output

\`\`\`
[DISCOVER]
contract:
  objective: <what we're building>
  acceptance: <definition of done>
  assumptions: <what we assume is true>

io_spec:
  inputs: <what we receive with types>
  outputs: <what we produce with types>
  validation: <how we validate>

decomposition:
  1. <step with dependency and tool>
  2. <step with dependency and tool>
  ...

tools:
  - <tool>: <why and safety envelope>

selected_modules:
  core: [Define_Task_Contract, Define_IO, Decompose_Task, Tool_Selection]
  optional: [<selected modules with reasons>]
\`\`\`

Perform atomic analysis NOW.`;
}

/**
 * Build prompt for ATTACK phase (Adversary Red-Team)
 */
function buildAttackPrompt(depth: 'shallow' | 'medium' | 'deep'): string {
  const vectorConfig = {
    shallow: '3-5 attack vectors',
    medium: '8-10 attack vectors with proofs of concept',
    deep: '15-20 attack vectors with detailed exploitation scenarios'
  };

  return `# Phase 2: ATTACK (Adversary Red-Team)

**Task:** {{prompt}}

**DISCOVER Output:**
{{discover_output}}

**Depth:** ${depth} - ${vectorConfig[depth]}

## Instructions

You are now an adversarial reviewer. Your job is to BREAK the proposed implementation.

Identify the weakest assumptions and produce concrete attack scenarios:

1. **Failure Modes**: What can go wrong at each step?
2. **Edge Cases**: Boundary conditions, malformed inputs, empty states
3. **Security Probes**: Injection, privilege escalation, data leaks
4. **Race Conditions**: Concurrency issues, timing attacks
5. **Resource Exhaustion**: Memory leaks, infinite loops, DoS vectors

### Required Output

\`\`\`
[ATTACK]
failure_modes:
  - mode: <what can fail>
    likelihood: high|medium|low
    impact: critical|major|minor
    exploit: <exact steps to trigger failure>
    affected_step: <reference to DISCOVER step>

edge_cases:
  - input: <problematic input value>
    expected_fail: <what breaks>
    attack_vector: <how to weaponize>

security_probes:
  - vulnerability: <security issue>
    severity: critical|high|medium|low
    proof_of_concept: <exact exploit steps>
    mitigation_required: true|false

resource_attacks:
  - attack: <resource exhaustion method>
    target: memory|cpu|disk|network
    trigger: <how to trigger>

race_conditions:
  - scenario: <concurrent situation>
    timing_window: <when exploitable>
    consequence: <what happens>
\`\`\`

Attack the plan ruthlessly NOW.`;
}

/**
 * Build prompt for FORTIFY phase (Poetic Specification)
 */
function buildFortifyPrompt(): string {
  return `# Phase 3: FORTIFY (Poetic Specification)

**Task:** {{prompt}}

**DISCOVER Output:**
{{discover_output}}

**ATTACK Output:**
{{attack_output}}

## Instructions

Create a hardened specification that addresses all attack vectors found.

For each attack identified, create a corresponding defense layer.

### Required Output

\`\`\`
[FORTIFY]
hardened_contract:
  objective: <same as DISCOVER>
  acceptance: <original + attack-informed criteria>
  invariants:
    - <things that must ALWAYS be true>

defense_layers:
  input_validation:
    - rule: <validation rule>
      defends_against: <attack reference>
      implementation: <how to implement>

  sanitization:
    - transform: <sanitization step>
      defends_against: <attack reference>

  rate_limiting:
    - limit: <rate limit value>
      defends_against: <attack reference>

  timeouts:
    - timeout: <timeout value>
      defends_against: <attack reference>

verification_gates:
  - gate: <verification checkpoint>
    type: test|assertion|invariant
    blocks: <what it prevents>
    when: <when to run>

rollback_strategy:
  trigger: <when to rollback>
  procedure: <how to rollback>
  recovery: <how to recover>

parity_check:
  approach_a: <primary approach>
  approach_b: <alternative approach>
  decision_criteria: <how to choose between them>

implementation_plan:
  phases:
    - name: <phase name>
      steps: [<step references>]
      verification: <how to verify phase complete>
\`\`\`

Create the hardened specification NOW.`;
}

/**
 * Build prompt for EXECUTE phase (Poetiq Verification-First)
 */
function buildExecutePrompt(
  verifyCommand?: string,
  maxIterations: number = 5,
  maxFiles: number = 8
): string {
  const verifyInstructions = verifyCommand
    ? `\n\n**Verification Command:** \`${verifyCommand}\``
    : '\n\n**Verification:** Find and run the project\'s test command (check package.json, Makefile, etc.)';

  return `# Phase 4: EXECUTE (Poetiq Verification-First)

**Task:** {{prompt}}

**FORTIFY Output:**
{{fortify_output}}
${verifyInstructions}

## Budgets & Safety Rails
- **MAX_ITERS = ${maxIterations}**
- **MAX_FILES_CHANGED = ${maxFiles}**
- Always prefer smallest diffs
- Fail-fast on verification failure

## Instructions

Implement the solution using verification-first discipline.

### Per-Iteration Contract (MUST do all)

1. **Verification First**: Write test/assertion BEFORE implementation
2. **Diverge**: Consider 2-4 candidate approaches
3. **Implement**: Make minimal changes with clear rationale
4. **Converge**: Run verification, iterate if failing
5. **Reflect**: Document what worked, what failed, what's next

### Agentic Tools Available
- \`view\` - Read file contents
- \`glob\` - Find files by pattern
- \`grep\` - Search file contents
- \`bash\` - Execute shell commands
- \`write\` - Create/overwrite files
- \`edit\` - Find-and-replace in files

### Required Output Per Iteration

\`\`\`
[EXECUTE]
iteration: N of ${maxIterations}
---
verification_first:
  - test: <test to write BEFORE implementation>
  - assertion: <invariant to verify>

candidates:
  - approach_1: <description>
  - approach_2: <description>
  selected: <which and why>

implementation:
  files_touched:
    - <file>: <change description>

  changes:
    <minimal diff with rationale>

verification_result:
  $ <test command>
  <output>
  status: pass|fail

reflection:
  worked: <what succeeded>
  failed: <what failed>
  learned: <insight for next iteration>
  next: <next action if continuing>
\`\`\`

Begin implementation NOW, starting with verification.`;
}

/**
 * Build prompt for Summary phase
 */
function buildSummaryPrompt(): string {
  return `# PK-Poet Summary

Compile a final summary of the entire PK-Poet workflow.

**All Phase Outputs:**
- REASON: {{reason_output}}
- DISCOVER: {{discover_output}}
- ATTACK: {{attack_output}}
- FORTIFY: {{fortify_output}}
- EXECUTE: {{execute_output}}

### Required Output

\`\`\`
[PK-POET SUMMARY]
status: DONE|BLOCKED|BUDGET_EXCEEDED|RISK_TOO_HIGH

reason:
  type_contracts_defined: <count>
  assertions_validated: <count>
  logic_errors_caught: <count>

discover:
  modules_used: <list>
  decomposition_steps: <count>

attack:
  vectors_found: <count>
  critical: <count>
  mitigated: <count>/<total>

fortify:
  defense_layers: <count>
  verification_gates: <count>
  parity_check: pass|fail|skipped

execute:
  iterations: <count>
  candidates_tried: <count>
  files_changed: <list>
  tests_added: <count>
  all_gates_pass: true|false

confidence: 0.00-1.00

residual_risks:
  - <risk that couldn't be fully mitigated>

next_steps:
  - <recommended follow-up if incomplete>
\`\`\``;
}

export default buildPKPoetPlan;
