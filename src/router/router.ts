/**
 * Smart Task Router
 *
 * Routes tasks to the most capable available agent using:
 * 1. Rule-based task classification (no LLM dependency)
 * 2. Capability cascade: Codex → Claude → Gemini → Droid
 * 3. Harness recommendations for complex reasoning tasks
 *
 * Inspired by state-of-the-art techniques:
 * - PoET (Program of Thoughts) - code as reasoning
 * - Self-Discover - atomic problem decomposition
 * - Chain of Code - executable reasoning
 */

import { Ollama } from 'ollama';
import type { RouteResult } from '../lib/types';
import { getConfig } from '../lib/config';
import { logRoutingDecision } from '../observation/logger';
import { adapters } from '../adapters';

let ollamaClient: Ollama | null = null;

function getOllama(): Ollama {
  if (!ollamaClient) {
    const config = getConfig();
    ollamaClient = new Ollama({ host: config.adapters.ollama.host });
  }
  return ollamaClient;
}

// Task complexity patterns
const COMPLEXITY_PATTERNS = {
  // High complexity - needs most capable model
  high: [
    /architect/i, /design\s+system/i, /refactor/i, /optimize/i,
    /debug.*complex/i, /fix.*bug/i, /security/i, /vulnerability/i,
    /multi.?file/i, /across.*files/i, /entire\s+codebase/i,
    /implement.*feature/i, /add.*functionality/i, /build.*from.*scratch/i,
    /migration/i, /upgrade/i, /performance/i, /scale/i,
    /test.*coverage/i, /integration/i, /api\s+design/i,
    /algorithm/i, /data\s+structure/i, /concurrent/i, /async/i,
    /state\s+management/i, /authentication/i, /authorization/i,
  ],
  // Medium complexity
  medium: [
    /add.*function/i, /create.*component/i, /write.*test/i,
    /update/i, /modify/i, /change/i, /edit/i,
    /fix.*error/i, /resolve/i, /handle/i,
    /convert/i, /transform/i, /parse/i,
    /validate/i, /check/i, /verify/i,
  ],
  // Analysis tasks - good for Gemini
  analysis: [
    /explain/i, /understand/i, /analyze/i, /review/i,
    /document/i, /describe/i, /summarize/i,
    /compare/i, /difference/i, /what\s+is/i, /how\s+does/i,
    /why/i, /when\s+to/i, /best\s+practice/i,
    /research/i, /find.*information/i, /look\s+up/i,
  ],
  // Simple tasks
  simple: [
    /list/i, /show/i, /print/i, /display/i,
    /rename/i, /move/i, /copy/i, /delete/i,
    /format/i, /lint/i, /prettier/i,
    /hello/i, /hi/i, /thanks/i,
  ],
};

// Harness recommendations based on task type
const HARNESS_RECOMMENDATIONS: Record<string, string> = {
  'complex-reasoning': 'codereason',  // Code as reasoning (PoET/CoRT)
  'architecture': 'discover',         // Self-Discover for decomposition
  'multi-step': 'pkpoet',            // PK-Poet for phased execution
  'security': 'adversary',           // Red-team analysis
  'feature': 'feature',              // Multi-phase feature workflow
  'verification': 'poetiq',          // Verification-first approach
};

// Capability cascade: most capable first
const CAPABILITY_CASCADE = ['codex', 'claude', 'gemini', 'factory'] as const;

type TaskType = 'high-complexity' | 'medium-complexity' | 'analysis' | 'simple' | 'unknown';

interface ClassificationResult {
  taskType: TaskType;
  confidence: number;
  suggestedHarness?: string;
  reasoning: string;
}

/**
 * Classify task complexity using rule-based patterns
 */
function classifyTask(task: string): ClassificationResult {
  const taskLower = task.toLowerCase();
  const taskLength = task.length;

  // Check for high complexity patterns
  const highMatches = COMPLEXITY_PATTERNS.high.filter(p => p.test(task));
  if (highMatches.length > 0) {
    // Determine suggested harness
    let harness: string | undefined;
    if (/security|vulnerability|attack/i.test(task)) {
      harness = 'adversary';
    } else if (/architect|design|system/i.test(task)) {
      harness = 'discover';
    } else if (/implement.*feature|add.*functionality/i.test(task)) {
      harness = 'feature';
    } else if (/algorithm|complex.*logic|reasoning/i.test(task)) {
      harness = 'codereason';
    } else if (highMatches.length >= 2 || taskLength > 200) {
      harness = 'pkpoet';
    }

    return {
      taskType: 'high-complexity',
      confidence: Math.min(0.95, 0.7 + (highMatches.length * 0.1)),
      suggestedHarness: harness,
      reasoning: `Matched ${highMatches.length} high-complexity pattern(s)`,
    };
  }

  // Check for analysis patterns (route to Gemini)
  const analysisMatches = COMPLEXITY_PATTERNS.analysis.filter(p => p.test(task));
  if (analysisMatches.length > 0) {
    return {
      taskType: 'analysis',
      confidence: Math.min(0.9, 0.6 + (analysisMatches.length * 0.1)),
      reasoning: `Matched ${analysisMatches.length} analysis pattern(s)`,
    };
  }

  // Check for medium complexity
  const mediumMatches = COMPLEXITY_PATTERNS.medium.filter(p => p.test(task));
  if (mediumMatches.length > 0) {
    return {
      taskType: 'medium-complexity',
      confidence: Math.min(0.85, 0.6 + (mediumMatches.length * 0.1)),
      reasoning: `Matched ${mediumMatches.length} medium-complexity pattern(s)`,
    };
  }

  // Check for simple patterns
  const simpleMatches = COMPLEXITY_PATTERNS.simple.filter(p => p.test(task));
  if (simpleMatches.length > 0) {
    return {
      taskType: 'simple',
      confidence: Math.min(0.9, 0.7 + (simpleMatches.length * 0.1)),
      reasoning: `Matched ${simpleMatches.length} simple pattern(s)`,
    };
  }

  // Default: estimate by task length and structure
  if (taskLength > 300) {
    return {
      taskType: 'high-complexity',
      confidence: 0.6,
      suggestedHarness: 'pkpoet',
      reasoning: 'Long task description suggests complexity',
    };
  } else if (taskLength > 100) {
    return {
      taskType: 'medium-complexity',
      confidence: 0.5,
      reasoning: 'Moderate task length',
    };
  }

  return {
    taskType: 'unknown',
    confidence: 0.4,
    reasoning: 'No clear patterns matched',
  };
}

/**
 * Check which adapters are available (cached for performance)
 */
let availabilityCache: Map<string, boolean> | null = null;
let cacheTime = 0;
const CACHE_TTL = 30000; // 30 seconds

async function getAvailableAdapters(): Promise<Set<string>> {
  const now = Date.now();
  if (availabilityCache && (now - cacheTime) < CACHE_TTL) {
    return new Set([...availabilityCache.entries()].filter(([_, v]) => v).map(([k]) => k));
  }

  availabilityCache = new Map();
  const config = getConfig();

  // Check each adapter in the cascade
  for (const name of CAPABILITY_CASCADE) {
    try {
      const adapter = adapters[name];
      if (adapter) {
        const available = await adapter.isAvailable();
        availabilityCache.set(name, available);
      }
    } catch {
      availabilityCache.set(name, false);
    }
  }

  cacheTime = now;
  return new Set([...availabilityCache.entries()].filter(([_, v]) => v).map(([k]) => k));
}

/**
 * Select best available agent from capability cascade
 */
async function selectAgent(taskType: TaskType): Promise<string> {
  const available = await getAvailableAdapters();
  const config = getConfig();

  // For analysis tasks, prefer Gemini
  if (taskType === 'analysis') {
    const analysisCascade = ['gemini', 'claude', 'codex', 'factory'];
    for (const agent of analysisCascade) {
      if (available.has(agent)) return agent;
    }
  }

  // For simple tasks, use fastest available
  if (taskType === 'simple') {
    const simpleCascade = ['gemini', 'codex', 'claude', 'factory'];
    for (const agent of simpleCascade) {
      if (available.has(agent)) return agent;
    }
  }

  // For complex/medium tasks, use capability cascade: Codex → Claude → Gemini → Droid
  for (const agent of CAPABILITY_CASCADE) {
    if (available.has(agent)) return agent;
  }

  // Ultimate fallback
  return config.fallbackAgent;
}

/**
 * Main routing function - smart rule-based routing with capability cascade
 */
export async function routeTask(task: string): Promise<RouteResult> {
  const config = getConfig();

  // First, try rule-based classification (fast, no LLM needed)
  const classification = classifyTask(task);
  const selectedAgent = await selectAgent(classification.taskType);

  const result: RouteResult = {
    agent: selectedAgent as RouteResult['agent'],
    confidence: classification.confidence,
    taskType: classification.taskType,
    suggestedHarness: classification.suggestedHarness,
    reasoning: classification.reasoning,
  };

  // Log the routing decision
  try {
    logRoutingDecision({
      task,
      selectedAgent,
      confidence: classification.confidence,
      taskType: classification.taskType,
      routerModel: 'rule-based',
      mode: 'auto',
      suggestedHarness: classification.suggestedHarness,
    });
  } catch {
    // Ignore logging errors
  }

  return result;
}

/**
 * Route with LLM (optional - uses Ollama if available for enhanced routing)
 */
export async function routeTaskWithLLM(task: string): Promise<RouteResult> {
  const config = getConfig();

  // First get rule-based result as fallback
  const ruleBasedResult = await routeTask(task);

  // Try LLM routing if Ollama is available
  if (config.adapters.ollama.enabled) {
    try {
      const ollama = getOllama();
      const response = await ollama.chat({
        model: config.routerModel,
        messages: [{
          role: 'user',
          content: `Classify this task and choose the best agent.

Available agents (in capability order):
- codex: Most capable - complex architecture, multi-file refactoring, deep debugging
- claude: Very capable - coding, analysis, documentation
- gemini: Good for analysis, research, explanations, documentation
- factory: Alternative model (GLM-4.7) - good general capability

Task: ${task}

Respond with JSON: {"agent":"...","confidence":0.X,"taskType":"...","reasoning":"..."}`
        }],
        format: 'json'
      });

      const parsed = JSON.parse(response.message.content);
      if (parsed.agent && typeof parsed.confidence === 'number') {
        // Validate agent is in our cascade
        if (CAPABILITY_CASCADE.includes(parsed.agent as any)) {
          return {
            agent: parsed.agent,
            confidence: parsed.confidence,
            taskType: parsed.taskType || ruleBasedResult.taskType,
            reasoning: parsed.reasoning,
            suggestedHarness: ruleBasedResult.suggestedHarness,
          };
        }
      }
    } catch {
      // Fall through to rule-based result
    }
  }

  return ruleBasedResult;
}

/**
 * Check if LLM router is available (Ollama)
 */
export async function isRouterAvailable(): Promise<boolean> {
  try {
    const config = getConfig();
    if (!config.adapters.ollama.enabled) return false;

    const ollama = getOllama();
    const models = await ollama.list();
    return models.models.some(m => m.name.includes(config.routerModel.split(':')[0]));
  } catch {
    return false;
  }
}

/**
 * Get harness recommendation for a task
 */
export function getHarnessRecommendation(task: string): string | undefined {
  const classification = classifyTask(task);
  return classification.suggestedHarness;
}

/**
 * Force refresh the adapter availability cache
 */
export function clearAvailabilityCache(): void {
  availabilityCache = null;
  cacheTime = 0;
}
