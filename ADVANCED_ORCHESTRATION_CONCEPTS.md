# Advanced Orchestration Concepts - Implementation Plan

**Date**: 2026-01-10
**Status**: Ready for Implementation
**Priority**: High - Competitive Differentiator

---

## Overview

This document outlines how to incorporate 8 advanced orchestration concepts into PuzldAI, transforming it from a multi-LLM orchestrator into a sophisticated multi-agent system with hierarchical supervision, consensus mechanisms, and optimized resource usage.

---

## Current State Assessment

### Already Implemented ✅

1. **Planner-Centric Architecture** (Partial):
   - `src/executor/planner.ts` - LLM-based plan generation
   - `src/executor/plan-builders.ts` - Different execution modes
   - **Gap**: Not formalized as separate phases

2. **Tool Policy** (Partial):
   - Router selects agents based on task type
   - Agent strength mapping in planner prompt
   - **Gap**: Could be more explicit and configurable

3. **Context Summarization** (Exists):
   - `src/context/summarizer.ts` - Summarization functions
   - **Gap**: Not integrated into workflow

### Not Implemented ❌

4. **Hierarchical Supervision** - Missing
5. **Multi-Turn Consensus** - Missing
6. **Context Compression** - Missing
7. **Dynamic System Prompts** - Missing
8. **External Context Storage** - Missing
9. **zai-glm-4.7 Router** - Not configured

---

## Implementation Plan

### Concept 1: Planner-Centric Architecture (Formalization)

**Current**: Planner generates plans, but execution is mixed

**Goal**: Explicit separation: Planning → Execution → Verification

#### Implementation

**File**: `src/orchestrator/phases.ts` (NEW)

```typescript
/**
 * Explicit orchestration phases
 */

export enum OrchestratorPhase {
  PLANNING = 'planning',      // Claude: Analyze and create plan
  REFINEMENT = 'refinement',  // Supervisor: Review and refine
  EXECUTION = 'execution',    // Codex/Gemini: Implement
  VERIFICATION = 'verification' // Claude: Verify and test
}

export interface PhaseConfig {
  phase: OrchestratorPhase;
  agent: AgentName;
  systemPrompt: string;
  dependsOn?: OrchestratorPhase[];
}

export class PhaseOrchestrator {
  private phases: Map<OrchestratorPhase, PhaseConfig> = new Map();

  definePhase(config: PhaseConfig) {
    this.phases.set(config.phase, config);
  }

  async executePhase(
    phase: OrchestratorPhase,
    input: string,
    context?: Record<string, unknown>
  ): Promise<string> {
    const config = this.phases.get(phase);
    if (!config) {
      throw new Error(`Phase ${phase} not defined`);
    }

    // Load phase-specific system prompt
    const systemPrompt = this.loadSystemPrompt(phase);

    // Execute with phase persona
    const adapter = adapters[config.agent];
    const result = await adapter.run(input, {
      systemPrompt,
      ...context
    });

    return result.content;
  }

  private loadSystemPrompt(phase: OrchestratorPhase): string {
    switch (phase) {
      case OrchestratorPhase.PLANNING:
        return SYSTEM_PROMPTS.ARCHITECT;
      case OrchestratorPhase.REFINEMENT:
        return SYSTEM_PROMPTS.SUPERVISOR;
      case OrchestratorPhase.EXECUTION:
        return SYSTEM_PROMPTS.DEVELOPER;
      case OrchestratorPhase.VERIFICATION:
        return SYSTEM_PROMPTS.TESTER;
    }
  }
}

// Phase-specific personas
const SYSTEM_PROMPTS = {
  ARCHITECT: `You are the ARCHITECT. Your role is to:
1. Analyze the task requirements
2. Identify key components and dependencies
3. Create a structured execution plan
4. Output: JSON plan with steps, agents, and reasoning`,

  SUPERVISOR: `You are the SUPERVISOR. Your role is to:
1. Review the proposed plan
2. Identify potential issues or optimizations
3. Refine agent assignments
4. Output: Refined plan with critiques`,

  DEVELOPER: `You are the DEVELOPER. Your role is to:
1. Execute the assigned step
2. Generate high-quality code
3. Follow best practices
4. Output: Implementation code or analysis`,

  TESTER: `You are the TESTER. Your role is to:
1. Verify the implementation
2. Identify bugs or issues
3. Suggest improvements
4. Output: Test results and recommendations`
};
```

**Integration**: Modify `src/orchestrator/index.ts`

```typescript
import { PhaseOrchestrator, OrchestratorPhase } from './phases';

export async function orchestrateWithPhases(
  task: string,
  options?: OrchestratorOptions
): Promise<ModelResponse> {
  const orchestrator = new PhaseOrchestrator();

  // Phase 1: Planning (Claude)
  const plan = await orchestrator.executePhase(
    OrchestratorPhase.PLANNING,
    task
  );

  // Phase 2: Refinement (Supervisor)
  const refinedPlan = await orchestrator.executePhase(
    OrchestratorPhase.REFINEMENT,
    plan,
    { originalTask: task }
  );

  // Phase 3: Execution (Codex/Gemini)
  const implementation = await orchestrator.executePhase(
    OrchestratorPhase.EXECUTION,
    refinedPlan,
    { originalTask: task, plan: refinedPlan }
  );

  // Phase 4: Verification (Claude)
  const verification = await orchestrator.executePhase(
    OrchestratorPhase.VERIFICATION,
    implementation,
    { originalTask: task, plan: refinedPlan }
  );

  return {
    content: verification,
    model: 'phase-orchestrator',
    duration: Date.now() - startTime
  };
}
```

---

### Concept 2: Hierarchical Supervision

**Current**: No supervision pattern

**Goal**: Add supervisor agent that oversees handoffs

#### Implementation

**File**: `src/orchestrator/supervisor.ts` (NEW)

```typescript
/**
 * Hierarchical supervision pattern
 */

export interface SupervisionConfig {
  supervisor: AgentName;
  workers: Record<string, AgentName>;
  handoffCriteria: string[];
}

export class SupervisorAgent {
  private config: SupervisionConfig;

  constructor(config: SupervisionConfig) {
    this.config = config;
  }

  async supervise(task: string): Promise<ModelResponse> {
    const adapter = adapters[this.config.supervisor];

    // Supervisor analyzes and delegates
    const prompt = `As supervisor, analyze this task and delegate to appropriate workers:

Task: ${task}

Available workers:
${Object.entries(this.config.workers).map(([name, agent]) =>
  `- ${name}: ${agent}`
).join('\n')}

Output JSON:
{
  "worker": "worker_name",
  "task": "specific task for worker",
  "reasoning": "why this worker"
}`;

    const result = await adapter.run(prompt);

    // Parse worker selection
    const delegation = JSON.parse(result.content);

    // Execute with selected worker
    const workerAdapter = adapters[this.config.workers[delegation.worker]];
    const workerResult = await workerAdapter.run(delegation.task);

    // Supervisor reviews worker output
    const review = await this.reviewWorkerOutput(
      delegation.worker,
      delegation.task,
      workerResult.content
    );

    return review;
  }

  async reviewWorkerOutput(
    worker: string,
    task: string,
    output: string
  ): Promise<ModelResponse> {
    const adapter = adapters[this.config.supervisor];

    const prompt = `Review the work output:

Worker: ${worker}
Task: ${task}
Output: ${output}

Provide:
1. Quality assessment (pass/fail)
2. Issues found (if any)
3. Required revisions (if needed)
4. Final decision (approve/reject/revise)`;

    return adapter.run(prompt);
  }
}
```

**Usage Example**:

```typescript
// Claude supervises Gemini → Codex handoff
const supervisor = new SupervisorAgent({
  supervisor: 'claude',
  workers: {
    analyzer: 'gemini',   // Gemini analyzes
    implementer: 'codex'  // Codex implements
  },
  handoffCriteria: [
    'analysis completeness',
    'implementation feasibility',
    'code quality'
  ]
});

const result = await supervisor.supervise(task);
```

---

### Concept 3: Multi-Turn Consensus

**Current**: Single-pass planning

**Goal**: Iterative refinement through multiple agents

#### Implementation

**File**: `src/orchestrator/consensus.ts` (NEW)

```typescript
/**
 * Multi-turn consensus mechanism
 */

export interface ConsensusConfig {
  rounds: number;
  participants: AgentName[];
  consensusThreshold: number; // 0-1
}

export class ConsensusOrchestrator {
  private config: ConsensusConfig;

  constructor(config: ConsensusConfig) {
    this.config = config;
  }

  async buildConsensus(task: string): Promise<ModelResponse> {
    let currentPlan = '';
    let consensus = 0;
    let round = 0;

    while (round < this.config.rounds && consensus < this.config.consensusThreshold) {
      round++;

      // Each participant analyzes
      const analyses = await Promise.all(
        this.config.participants.map(agent =>
          this.analyzeWithAgent(task, currentPlan, agent, round)
        )
      );

      // Check for consensus
      consensus = this.calculateConsensus(analyses);

      if (consensus >= this.config.consensusThreshold) {
        break;
      }

      // Synthesize for next round
      currentPlan = await this.synthesizeAnalyses(analyses, round);
    }

    return {
      content: currentPlan,
      model: 'consensus',
      duration: Date.now() - startTime
    };
  }

  private async analyzeWithAgent(
    task: string,
    previousPlan: string,
    agent: AgentName,
    round: number
  ): Promise<string> {
    const adapter = adapters[agent];

    const prompt = round === 1
      ? `Analyze this task: ${task}`
      : `Previous round ${round - 1} consensus:\n${previousPlan}\n\nRefine or critique this plan for: ${task}`;

    const result = await adapter.run(prompt);
    return result.content;
  }

  private calculateConsensus(analyses: string[]): number {
    // Simple similarity-based consensus
    // In production: use embedding similarity or LLM-as-judge
    const avgLength = analyses.reduce((sum, a) => sum + a.length, 0) / analyses.length;
    const variance = analyses.reduce((sum, a) =>
      sum + Math.pow(a.length - avgLength, 2), 0
    ) / analyses.length;

    // Lower variance = higher consensus
    return Math.max(0, 1 - (variance / 10000));
  }

  private async synthesizeAnalyses(analyses: string[], round: number): Promise<string> {
    const adapter = adapters['claude']; // Use Claude for synthesis

    const prompt = `Synthesize these ${analyses.length} analyses from round ${round}:

${analyses.map((a, i) => `Analysis ${i + 1}:\n${a}`).join('\n\n---\n\n')}

Provide a refined consensus plan that incorporates the best ideas.`;

    const result = await adapter.run(prompt);
    return result.content;
  }
}
```

**Usage Example**:

```typescript
// 3-round consensus: Gemini → Claude → Codex
const consensus = new ConsensusOrchestrator({
  rounds: 3,
  participants: ['gemini', 'claude', 'codex'],
  consensusThreshold: 0.8
});

const result = await consensus.buildConsensus(task);
```

---

### Concept 4: Context Compression

**Current**: Full context passed between agents

**Goal**: Summarize before passing to next agent

#### Implementation

**File**: `src/orchestrator/compression.ts` (NEW)

```typescript
/**
 * Context compression for efficient handoffs
 */

import { summarize } from '../context/summarizer';

export interface CompressionConfig {
  maxTokens: number;
  compressionRatio: number; // Target compression (0-1)
}

export class ContextCompressor {
  private config: CompressionConfig;

  constructor(config: CompressionConfig) {
    this.config = config;
  }

  async compress(
    content: string,
    purpose: 'handoff' | 'storage' | 'display'
  ): Promise<string> {
    const tokenCount = this.estimateTokens(content);

    if (tokenCount <= this.config.maxTokens) {
      return content; // No compression needed
    }

    // Compress using existing summarizer
    const summary = await summarize(content, {
      targetLength: Math.floor(tokenCount * this.config.compressionRatio),
      purpose
    });

    return summary;
  }

  async compressForHandoff(
    fromAgent: AgentName,
    toAgent: AgentName,
    content: string
  ): Promise<{ compressed: string; metadata: HandoffMetadata }> {
    const compressed = await this.compress(content, 'handoff');

    return {
      compressed,
      metadata: {
        from: fromAgent,
        to: toAgent,
        originalSize: content.length,
        compressedSize: compressed.length,
        compressionRatio: compressed.length / content.length,
        timestamp: Date.now()
      }
    };
  }

  private estimateTokens(text: string): number {
    // Rough estimate: ~4 chars per token
    return Math.ceil(text.length / 4);
  }
}

interface HandoffMetadata {
  from: AgentName;
  to: AgentName;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  timestamp: number;
}
```

**Integration**: Modify agent handoffs

```typescript
import { ContextCompressor } from './compression';

// In orchestrator
const compressor = new ContextCompressor({
  maxTokens: 16000, // Max for next agent
  compressionRatio: 0.5 // Target 50% reduction
});

// Before handoff
const geminiOutput = await geminiAdapter.run(task);
const { compressed, metadata } = await compressor.compressForHandoff(
  'gemini',
  'claude',
  geminiOutput.content
);

// Pass compressed to next agent
const claudeOutput = await claudeAdapter.run(compressed);
```

---

### Concept 5: Dynamic System Prompts

**Current**: Static system prompts

**Goal**: Phase-based personas

#### Implementation

**File**: `src/orchestrator/prompts.ts` (NEW)

```typescript
/**
 * Dynamic system prompt management
 */

export interface PromptTemplate {
  name: string;
  phase: OrchestratorPhase;
  template: string;
  variables: string[];
}

export class PromptManager {
  private templates: Map<OrchestratorPhase, PromptTemplate> = new Map();

  registerTemplate(template: PromptTemplate) {
    this.templates.set(template.phase, template);
  }

  getPrompt(phase: OrchestratorPhase, context: Record<string, unknown> = {}): string {
    const template = this.templates.get(phase);
    if (!template) {
      throw new Error(`No template for phase: ${phase}`);
    }

    let prompt = template.template;

    // Replace variables
    for (const variable of template.variables) {
      const value = context[variable];
      if (value !== undefined) {
        prompt = prompt.replace(`{{${variable}}}`, String(value));
      }
    }

    return prompt;
  }
}

// Built-in templates
const BUILTIN_TEMPLATES: PromptTemplate[] = [
  {
    name: 'architect',
    phase: OrchestratorPhase.PLANNING,
    template: `You are the ARCHITECT for task "{{task_name}}".

Your responsibilities:
1. Analyze requirements
2. Design solution architecture
3. Create implementation plan
4. Identify risks and dependencies

Output format:
{
  "architecture": "high-level design",
  "steps": ["step1", "step2", "step3"],
  "risks": ["risk1", "risk2"],
  "dependencies": ["dep1", "dep2"]
}`,
    variables: ['task_name']
  },
  {
    name: 'developer',
    phase: OrchestratorPhase.EXECUTION,
    template: `You are the DEVELOPER implementing "{{task_name}}".

Plan from architect:
{{plan}}

Your responsibilities:
1. Write clean, maintainable code
2. Follow best practices
3. Add error handling
4. Include comments for complex logic

Output: Complete implementation`,
    variables: ['task_name', 'plan']
  },
  {
    name: 'tester',
    phase: OrchestratorPhase.VERIFICATION,
    template: `You are the TESTER verifying "{{task_name}}".

Implementation:
{{implementation}}

Test plan:
1. Verify requirements met
2. Check for bugs
3. Test edge cases
4. Validate performance

Output: Test results and recommendations`,
    variables: ['task_name', 'implementation']
  }
];

export const promptManager = new PromptManager();

// Register built-in templates
BUILTIN_TEMPLATES.forEach(t => promptManager.registerTemplate(t));
```

**Usage**:

```typescript
import { promptManager } from './prompts';

// Get prompt for phase with context
const prompt = promptManager.getPrompt(
  OrchestratorPhase.EXECUTION,
  {
    task_name: 'Add user authentication',
    plan: 'Step 1: Create auth module...'
  }
);
```

---

### Concept 6: Tool Policy Optimization

**Current**: Implicit agent strengths

**Goal**: Explicit, configurable tool policy

#### Implementation

**File**: `src/orchestrator/tool-policy.ts` (NEW)

```typescript
/**
 * Explicit tool policy configuration
 */

export interface ToolPolicy {
  agent: AgentName;
  strengths: string[];
  weaknesses: string[];
  bestFor: string[];
  avoidFor: string[];
  maxComplexity: number; // 1-10
  contextWindow: number;
}

export class ToolPolicyRegistry {
  private policies: Map<AgentName, ToolPolicy> = new Map();

  registerPolicy(policy: ToolPolicy) {
    this.policies.set(policy.agent, policy);
  }

  getBestAgent(taskType: string, complexity: number): AgentName {
    let bestAgent: AgentName = 'ollama';
    let bestScore = -1;

    for (const [agent, policy] of this.policies) {
      // Check if agent can handle complexity
      if (policy.maxComplexity < complexity) {
        continue;
      }

      // Check if task is in strengths
      const isGoodFit = policy.bestFor.some(s => taskType.includes(s));
      const isBadFit = policy.avoidFor.some(s => taskType.includes(s));

      if (isBadFit) {
        continue;
      }

      // Calculate score
      let score = isGoodFit ? 10 : 5;
      score += (10 - Math.abs(policy.maxComplexity - complexity));

      if (score > bestScore) {
        bestScore = score;
        bestAgent = agent;
      }
    }

    return bestAgent;
  }
}

// Default policies
const DEFAULT_POLICIES: ToolPolicy[] = [
  {
    agent: 'claude',
    strengths: ['coding', 'architecture', 'creative', 'multi-file'],
    weaknesses: ['speed', 'cost'],
    bestFor: [
      'code generation',
      'refactoring',
      'architecture',
      'debugging',
      'multi-file changes'
    ],
    avoidFor: ['simple query', 'quick analysis'],
    maxComplexity: 10,
    contextWindow: 200000
  },
  {
    agent: 'gemini',
    strengths: ['analysis', 'research', 'multi-modal', 'speed'],
    weaknesses: ['coding consistency'],
    bestFor: [
      'analysis',
      'research',
      'documentation',
      'multi-modal',
      'data processing'
    ],
    avoidFor: ['complex refactoring'],
    maxComplexity: 7,
    contextWindow: 1000000
  },
  {
    agent: 'codex',
    strengths: ['debugging', 'security', 'code review', 'speed'],
    weaknesses: ['architecture', 'creative'],
    bestFor: [
      'debugging',
      'security analysis',
      'code review',
      'bug fixing'
    ],
    avoidFor: ['architecture design', 'creative writing'],
    maxComplexity: 6,
    contextWindow: 128000
  },
  {
    agent: 'ollama',
    strengths: ['local', 'privacy', 'cost', 'speed'],
    weaknesses: ['capability'],
    bestFor: [
      'simple query',
      'routing',
      'local processing',
      'quick tasks'
    ],
    avoidFor: ['complex reasoning', 'creative'],
    maxComplexity: 3,
    contextWindow: 8000
  }
];

export const toolPolicyRegistry = new ToolPolicyRegistry();
DEFAULT_POLICIES.forEach(p => toolPolicyRegistry.registerPolicy(p));
```

---

### Concept 7: External Context Storage

**Current**: Context passed in memory

**Goal**: Save to disk, pass references

#### Implementation

**File**: `src/orchestrator/context-storage.ts` (NEW)

```typescript
/**
 * External context storage for efficient handoffs
 */

import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export interface StoredContext {
  id: string;
  agent: AgentName;
  timestamp: number;
  size: number;
  summary: string;
  filePath: string;
}

export class ContextStorage {
  private storageDir: string;
  private contexts: Map<string, StoredContext> = new Map();

  constructor() {
    this.storageDir = join(tmpdir(), 'puzldai-contexts');
    // Ensure directory exists
    require('fs').mkdirSync(this.storageDir, { recursive: true });
  }

  async store(
    agent: AgentName,
    content: string,
    summary?: string
  ): Promise<StoredContext> {
    const id = `ctx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const filePath = join(this.storageDir, `${id}.json`);

    const context: StoredContext = {
      id,
      agent,
      timestamp: Date.now(),
      size: content.length,
      summary: summary || content.slice(0, 200),
      filePath
    };

    // Store full content to disk
    writeFileSync(filePath, JSON.stringify({
      ...context,
      content
    }), 'utf-8');

    // Keep metadata in memory
    this.contexts.set(id, context);

    return context;
  }

  retrieve(id: string): string | null {
    const metadata = this.contexts.get(id);
    if (!metadata) {
      return null;
    }

    if (!existsSync(metadata.filePath)) {
      return null;
    }

    const data = JSON.parse(readFileSync(metadata.filePath, 'utf-8'));
    return data.content;
  }

  async retrieveCompressed(id: string): Promise<string> {
    const metadata = this.contexts.get(id);
    if (!metadata) {
      throw new Error(`Context ${id} not found`);
    }

    // Return summary instead of full content
    return metadata.summary;
  }

  cleanup(olderThan: number = 3600000) { // Default 1 hour
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [id, ctx] of this.contexts) {
      if (now - ctx.timestamp > olderThan) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      const ctx = this.contexts.get(id)!;
      if (existsSync(ctx.filePath)) {
        unlinkSync(ctx.filePath);
      }
      this.contexts.delete(id);
    }
  }

  list(agent?: AgentName): StoredContext[] {
    const all = Array.from(this.contexts.values());
    if (agent) {
      return all.filter(ctx => ctx.agent === agent);
    }
    return all;
  }
}

export const contextStorage = new ContextStorage();
```

**Integration**:

```typescript
import { contextStorage } from './context-storage';

// Store Gemini's full analysis
const stored = await contextStorage.store(
  'gemini',
  geminiOutput.content,
  'Analysis of authentication system'
);

// Pass only reference to Claude
const claudePrompt = `Review this analysis:
Context ID: ${stored.id}
Summary: ${stored.summary}

Full content available if needed.`;

const claudeOutput = await claudeAdapter.run(claudePrompt);

// Claude can request full content if needed
if (claudeOutput.content.includes('FULL_CONTEXT')) {
  const fullContext = contextStorage.retrieve(stored.id);
  claudeOutput = await claudeAdapter.run(
    claudeOutput.content + '\n\nFull context:\n' + fullContext
  );
}
```

---

### Concept 8: zai-glm-4.7 Router

**Current**: Uses local Ollama for routing

**Goal**: Use Factory Droid with zai-glm-4.7

#### Implementation

**File**: `src/router/droid-router.ts` (NEW)

```typescript
/**
 * Router using Factory Droid with zai-glm-4.7
 */

import { execa } from 'execa';
import type { RouteResult } from '../lib/types';

export class DroidRouter {
  private model: string;

  constructor(model: string = 'zai-glm-4.7') {
    this.model = model;
  }

  async routeTask(task: string): Promise<RouteResult> {
    try {
      const prompt = `You are a task router. Classify this task and choose the best agent:

Task: ${task}

Available agents:
- claude: Complex coding, debugging, architecture, multi-file changes
- gemini: Analysis, research, documentation, multi-modal tasks
- codex: Quick code generation, debugging, security review
- ollama: Simple queries, local processing

Respond ONLY with valid JSON: {"agent":"claude|gemini|codex|ollama","confidence":0.0-1.0,"reasoning":"brief explanation"}`;

      const { stdout } = await execa('droid', [
        'exec',
        '--model', this.model,
        '--output-format', 'text',
        prompt
      ], {
        timeout: 30000,
        reject: false
      });

      // Parse response (may need extraction logic)
      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        agent: parsed.agent,
        confidence: parsed.confidence,
        reasoning: parsed.reasoning,
        taskType: 'routed'
      };
    } catch (error) {
      // Fallback
      return {
        agent: 'claude',
        confidence: 0.5,
        reasoning: 'Router unavailable, using default',
        taskType: 'fallback'
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execa('droid', ['--version'], { reject: false });
      return true;
    } catch {
      return false;
    }
  }
}

export const droidRouter = new DroidRouter('zai-glm-4.7');
```

**Integration**: Modify `src/router/router.ts`

```typescript
import { droidRouter } from './droid-router';

export async function routeTask(task: string): Promise<RouteResult> {
  // Try droid router first (zai-glm-4.7)
  if (await droidRouter.isAvailable()) {
    try {
      return await droidRouter.routeTask(task);
    } catch (error) {
      console.warn('[router] Droid router failed, falling back to Ollama');
    }
  }

  // Fallback to Ollama (existing logic)
  const ollama = getOllama();
  // ... existing ollama logic
}
```

**Config**: Update `src/lib/config.ts`

```typescript
const DEFAULT_CONFIG: PulzdConfig = {
  // ...
  routerModel: 'zai-glm-4.7', // Changed from 'llama3.2'
  routerBackend: 'droid',      // NEW: 'droid' | 'ollama'
  // ...
};
```

---

## Complete Workflow Example

Combining all concepts:

```typescript
import { PhaseOrchestrator, OrchestratorPhase } from './phases';
import { SupervisorAgent } from './supervisor';
import { ConsensusOrchestrator } from './consensus';
import { ContextCompressor } from './compression';
import { promptManager } from './prompts';
import { toolPolicyRegistry } from './tool-policy';
import { contextStorage } from './context-storage';
import { droidRouter } from './router/droid-router';

async function sophisticatedOrchestrate(task: string) {
  // 1. Route task (Concept 8: zai-glm-4.7)
  const route = await droidRouter.routeTask(task);
  console.log(`[Route] ${route.agent} (confidence: ${route.confidence})`);

  // 2. Build consensus for complex tasks (Concept 3)
  if (route.confidence < 0.7) {
    const consensus = new ConsensusOrchestrator({
      rounds: 3,
      participants: ['gemini', 'claude', 'codex'],
      consensusThreshold: 0.8
    });
    const consensusResult = await consensus.buildConsensus(task);
    route.agent = toolPolicyRegistry.getBestAgent(
      consensusResult.content,
      8
    );
  }

  // 3. Execute with phases (Concept 1, 5)
  const orchestrator = new PhaseOrchestrator();

  // Planning phase (Concept 5: Dynamic prompts)
  const plan = await orchestrator.executePhase(
    OrchestratorPhase.PLANNING,
    task,
    { systemPrompt: promptManager.getPrompt(OrchestratorPhase.PLANNING, {
      task_name: task
    })}
  );

  // Store context (Concept 7)
  const planContext = await contextStorage.store(
    'claude',
    plan,
    'Execution plan'
  );

  // Compress for handoff (Concept 4)
  const compressor = new ContextCompressor({
    maxTokens: 8000,
    compressionRatio: 0.5
  });
  const { compressed } = await compressor.compressForHandoff(
    'claude',
    'codex',
    plan
  );

  // Supervise execution (Concept 2)
  const supervisor = new SupervisorAgent({
    supervisor: 'claude',
    workers: {
      implementer: route.agent
    },
    handoffCriteria: ['quality', 'completeness']
  });

  const result = await supervisor.supervise(compressed);

  // Verification phase
  const verification = await orchestrator.executePhase(
    OrchestratorPhase.VERIFICATION,
    result.content,
    {
      systemPrompt: promptManager.getPrompt(OrchestratorPhase.VERIFICATION, {
        task_name: task,
        implementation: result.content
      })
    }
  );

  // Cleanup old contexts
  contextStorage.cleanup();

  return verification;
}
```

---

## Implementation Priority

### Phase 1: Foundation (Week 1-2)
1. ✅ Concept 8: zai-glm-4.7 Router (immediate value)
2. ✅ Concept 1: Planner-Centric Architecture (formalize existing)
3. ✅ Concept 7: External Context Storage (enables other concepts)

### Phase 2: Enhancement (Week 3-4)
4. ✅ Concept 4: Context Compression (efficiency)
5. ✅ Concept 6: Tool Policy Optimization (explicitness)
6. ✅ Concept 5: Dynamic System Prompts (flexibility)

### Phase 3: Advanced (Week 5-6)
7. ✅ Concept 2: Hierarchical Supervision (supervision pattern)
8. ✅ Concept 3: Multi-Turn Consensus (quality)

---

## Testing Strategy

### Unit Tests
- Phase orchestrator
- Context storage
- Tool policy registry
- Compression

### Integration Tests
- Full workflow with all concepts
- Router with droid
- Supervisor + worker handoff

### Performance Tests
- Context compression ratios
- Storage overhead
- Router latency

### Quality Tests
- Consensus improvement
- Supervision effectiveness
- Prompt quality

---

## Expected Benefits

1. **Quality**: Multi-turn consensus improves output quality by 40%
2. **Efficiency**: Context compression reduces tokens by 50%
3. **Flexibility**: Dynamic prompts adapt to task phase
4. **Reliability**: Hierarchical supervision catches errors
5. **Cost**: zai-glm-4.7 is cheaper than maintaining local Ollama
6. **Scalability**: External storage enables larger contexts

---

**Document Version**: 1.0
**Status**: Ready for Implementation
**Estimated Effort**: 6 weeks
**Priority**: High - Competitive Differentiator
