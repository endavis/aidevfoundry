/**
 * Puzzle Assembly Orchestration Pattern
 *
 * Combines state-of-the-art research patterns:
 * - Mixture of Agents (MoA) - multiple proposers, intelligent aggregation
 * - LATS - tree search with value functions and reflection
 * - Graph of Thoughts - non-linear reasoning with subproblem aggregation
 * - Self-Refine - iterative improvement loops
 * - Semantic Triangulation - verification through transformation
 *
 * The "puzzle" metaphor:
 * 1. DECOMPOSE: Break task into puzzle pieces (subproblems)
 * 2. SOLVE: Each agent solves their assigned pieces
 * 3. ASSEMBLE: Intelligently combine pieces, resolving conflicts
 * 4. VERIFY: Check assembly correctness, identify gaps
 * 5. REFINE: Fix gaps and polish final result
 *
 * References:
 * - MoA: arxiv.org/abs/2406.04692
 * - LATS: arxiv.org/abs/2310.04406
 * - GoT: arxiv.org/abs/2308.09687
 * - Self-Refine: arxiv.org/abs/2303.17651
 * - ReVeal: arxiv.org/abs/2506.11442
 */

import type { AgentName, ExecutionPlan, PlanStep } from '../executor/types';
import { adapters } from '../adapters';
import { routeTask, getHarnessRecommendation } from '../router/router';

// Capability cascade for intelligent agent selection
const CAPABILITY_CASCADE: AgentName[] = ['codex', 'claude', 'gemini', 'factory'];

export interface PuzzlePiece {
  id: string;
  description: string;
  dependencies: string[];  // IDs of pieces this depends on
  assignedAgent?: AgentName;
  solution?: string;
  confidence?: number;
  verified?: boolean;
}

export interface PuzzleAssemblyOptions {
  /** Maximum decomposition depth */
  maxDepth?: number;
  /** Number of agents to use in MoA proposer layer */
  proposerCount?: number;
  /** Enable debate rounds for conflict resolution */
  enableDebate?: boolean;
  /** Number of refinement iterations */
  refinementRounds?: number;
  /** Verification strategy */
  verificationStrategy?: 'triangulation' | 'test-generation' | 'cross-check';
  /** Custom agent assignments */
  agentAssignments?: Record<string, AgentName>;
}

export interface AssemblyResult {
  success: boolean;
  finalOutput: string;
  pieces: PuzzlePiece[];
  conflicts: ConflictResolution[];
  iterations: number;
  timeline: AssemblyEvent[];
}

export interface ConflictResolution {
  pieceIds: string[];
  conflictType: 'overlap' | 'contradiction' | 'gap';
  resolution: string;
  resolvedBy: AgentName;
}

export interface AssemblyEvent {
  phase: 'decompose' | 'solve' | 'assemble' | 'verify' | 'refine';
  timestamp: number;
  agent?: AgentName;
  pieceId?: string;
  message: string;
}

/**
 * Phase 1: DECOMPOSE - Break task into puzzle pieces
 *
 * Uses Graph of Thoughts approach to create dependency-aware subproblems
 */
export function buildDecomposePlan(
  task: string,
  options: PuzzleAssemblyOptions = {}
): ExecutionPlan {
  const { maxDepth = 3 } = options;

  return {
    id: `puzzle_decompose_${Date.now()}`,
    mode: 'pipeline',
    prompt: task,
    steps: [
      {
        id: 'analyze',
        agent: 'codex',  // Most capable for analysis
        action: 'prompt',
        prompt: `Analyze this task and identify independent subproblems that can be solved separately.

Task: {{prompt}}

For each subproblem, provide:
1. A unique ID (snake_case)
2. Clear description
3. Dependencies (IDs of subproblems that must complete first)
4. Estimated complexity (low/medium/high)
5. Best-suited agent type (reasoning/coding/research/implementation)

Output as JSON:
{
  "pieces": [
    {
      "id": "setup_database",
      "description": "Create database schema",
      "dependencies": [],
      "complexity": "medium",
      "agentType": "coding"
    }
  ],
  "executionOrder": ["id1", "id2", ...],
  "parallelGroups": [["id1", "id2"], ["id3"]]
}`,
        outputAs: 'decomposition'
      },
      {
        id: 'validate_decomposition',
        agent: 'gemini',  // Good at analysis/validation
        action: 'prompt',
        prompt: `Review this task decomposition for completeness and correctness.

Original Task: {{prompt}}

Decomposition:
{{decomposition}}

Check for:
1. Missing subproblems
2. Incorrect dependencies (circular, missing)
3. Granularity issues (too coarse or too fine)
4. Feasibility of parallel execution

Output corrected JSON with same structure, or confirm "VALID" if correct.`,
        dependsOn: ['analyze'],
        outputAs: 'validated_decomposition'
      }
    ],
    createdAt: Date.now()
  };
}

/**
 * Phase 2: SOLVE - Each agent solves assigned pieces
 *
 * Uses Mixture of Agents pattern for complex pieces
 */
export function buildSolvePlan(
  pieces: PuzzlePiece[],
  originalTask: string,
  options: PuzzleAssemblyOptions = {}
): ExecutionPlan {
  const { proposerCount = 2 } = options;

  const steps: PlanStep[] = [];

  // Group pieces by execution order (respecting dependencies)
  const executionLayers = groupByDependencies(pieces);

  let stepIndex = 0;
  for (const layer of executionLayers) {
    // Pieces in same layer can run in parallel
    for (const piece of layer) {
      const agent = piece.assignedAgent || selectAgentForPiece(piece);

      // For high-complexity pieces, use MoA pattern
      if (piece.description.includes('complex') || layer.length === 1) {
        // MoA: Multiple proposers
        const proposers = CAPABILITY_CASCADE.slice(0, proposerCount);
        for (const proposer of proposers) {
          steps.push({
            id: `solve_${piece.id}_${proposer}`,
            agent: proposer,
            action: 'prompt',
            prompt: `Solve this subproblem as part of a larger task.

Overall Task: ${originalTask}

Subproblem: ${piece.description}

${piece.dependencies.length > 0 ? `Dependencies (already solved):\n${piece.dependencies.map(d => `{{${d}_solution}}`).join('\n')}` : ''}

Provide a complete, production-ready solution. Include:
1. Implementation/answer
2. Rationale for key decisions
3. Potential edge cases handled
4. Confidence score (0-1)`,
            dependsOn: piece.dependencies.map(d => `solve_${d}_aggregated`),
            outputAs: `${piece.id}_proposal_${proposer}`
          });
        }

        // MoA: Aggregator combines proposals
        steps.push({
          id: `solve_${piece.id}_aggregated`,
          agent: 'codex',  // Best aggregator
          action: 'prompt',
          prompt: `You are an aggregator. Synthesize these proposals into the best solution.

Subproblem: ${piece.description}

Proposals:
${proposers.map(p => `\n--- ${p} ---\n{{${piece.id}_proposal_${p}}}`).join('\n')}

Create a unified solution that:
1. Takes the best elements from each proposal
2. Resolves any contradictions
3. Fills any gaps
4. Is production-ready

Output the final solution with confidence score.`,
          dependsOn: proposers.map(p => `solve_${piece.id}_${p}`),
          outputAs: `${piece.id}_solution`
        });
      } else {
        // Simple piece: single agent
        steps.push({
          id: `solve_${piece.id}_aggregated`,
          agent,
          action: 'prompt',
          prompt: `Solve this subproblem as part of a larger task.

Overall Task: ${originalTask}

Subproblem: ${piece.description}

${piece.dependencies.length > 0 ? `Dependencies (already solved):\n${piece.dependencies.map(d => `{{${d}_solution}}`).join('\n')}` : ''}

Provide a complete solution.`,
          dependsOn: piece.dependencies.map(d => `solve_${d}_aggregated`),
          outputAs: `${piece.id}_solution`
        });
      }

      stepIndex++;
    }
  }

  return {
    id: `puzzle_solve_${Date.now()}`,
    mode: 'pipeline',
    prompt: originalTask,
    steps,
    createdAt: Date.now()
  };
}

/**
 * Phase 3: ASSEMBLE - Combine pieces intelligently
 *
 * Uses conflict detection and resolution
 */
export function buildAssemblePlan(
  pieces: PuzzlePiece[],
  originalTask: string
): ExecutionPlan {
  const pieceRefs = pieces.map(p => `{{${p.id}_solution}}`).join('\n\n---\n\n');

  return {
    id: `puzzle_assemble_${Date.now()}`,
    mode: 'pipeline',
    prompt: originalTask,
    steps: [
      {
        id: 'detect_conflicts',
        agent: 'gemini',
        action: 'prompt',
        prompt: `Analyze these solved pieces for conflicts and integration issues.

Original Task: {{prompt}}

Solved Pieces:
${pieceRefs}

Identify:
1. Overlapping implementations (same thing done differently)
2. Contradictions (incompatible approaches)
3. Gaps (missing connections between pieces)
4. Integration points (where pieces must connect)

Output as JSON:
{
  "conflicts": [{"pieces": ["id1", "id2"], "type": "overlap|contradiction|gap", "description": "..."}],
  "integrationPoints": [{"from": "id1", "to": "id2", "interface": "..."}],
  "assemblyOrder": ["id1", "id2", ...]
}`,
        outputAs: 'conflict_analysis'
      },
      {
        id: 'resolve_conflicts',
        agent: 'codex',
        action: 'prompt',
        prompt: `Resolve the identified conflicts and assemble the final solution.

Original Task: {{prompt}}

Conflict Analysis:
{{conflict_analysis}}

Solved Pieces:
${pieceRefs}

For each conflict:
1. Choose the best approach or merge approaches
2. Ensure consistency across the solution
3. Fill any gaps with minimal additions

Output the fully assembled, integrated solution.`,
        dependsOn: ['detect_conflicts'],
        outputAs: 'assembled_solution'
      }
    ],
    createdAt: Date.now()
  };
}

/**
 * Phase 4: VERIFY - Check assembly correctness
 *
 * Uses Semantic Triangulation and test generation
 */
export function buildVerifyPlan(
  originalTask: string,
  options: PuzzleAssemblyOptions = {}
): ExecutionPlan {
  const { verificationStrategy = 'cross-check' } = options;

  const steps: PlanStep[] = [];

  if (verificationStrategy === 'triangulation') {
    // Semantic Triangulation: transform problem and verify consistency
    steps.push(
      {
        id: 'transform_problem',
        agent: 'gemini',
        action: 'prompt',
        prompt: `Transform this problem into an equivalent form that would have the same solution.

Original: {{prompt}}
Solution: {{assembled_solution}}

Create a semantically equivalent problem statement that:
1. Uses different terminology
2. Approaches from a different angle
3. Would produce the same correct solution

Output the transformed problem.`,
        outputAs: 'transformed_problem'
      },
      {
        id: 'solve_transformed',
        agent: 'claude',
        action: 'prompt',
        prompt: `Solve this problem independently.

{{transformed_problem}}

Provide your solution.`,
        dependsOn: ['transform_problem'],
        outputAs: 'transformed_solution'
      },
      {
        id: 'compare_solutions',
        agent: 'codex',
        action: 'prompt',
        prompt: `Compare these two solutions for consistency.

Original Solution:
{{assembled_solution}}

Transformed Solution:
{{transformed_solution}}

Are they semantically equivalent? Identify any discrepancies.
Output: {"consistent": true/false, "discrepancies": [...], "confidence": 0.X}`,
        dependsOn: ['solve_transformed'],
        outputAs: 'verification_result'
      }
    );
  } else if (verificationStrategy === 'test-generation') {
    // ReVeal pattern: generate tests and execute
    steps.push(
      {
        id: 'generate_tests',
        agent: 'codex',
        action: 'prompt',
        prompt: `Generate comprehensive tests for this solution.

Task: {{prompt}}
Solution: {{assembled_solution}}

Create:
1. Unit tests for individual components
2. Integration tests for piece connections
3. Edge case tests
4. Regression tests

Output executable test code.`,
        outputAs: 'test_suite'
      },
      {
        id: 'analyze_coverage',
        agent: 'gemini',
        action: 'prompt',
        prompt: `Analyze test coverage and identify gaps.

Solution: {{assembled_solution}}
Tests: {{test_suite}}

Identify:
1. Untested code paths
2. Missing edge cases
3. Potential failure modes

Output coverage analysis.`,
        dependsOn: ['generate_tests'],
        outputAs: 'verification_result'
      }
    );
  } else {
    // Cross-check: different agent verifies
    steps.push({
      id: 'cross_verify',
      agent: 'factory',  // Different model family
      action: 'prompt',
      prompt: `Critically review this solution for correctness and completeness.

Task: {{prompt}}
Solution: {{assembled_solution}}

Check for:
1. Logical errors
2. Missing requirements
3. Edge cases not handled
4. Performance issues
5. Security concerns

Output: {"valid": true/false, "issues": [...], "suggestions": [...]}`,
      outputAs: 'verification_result'
    });
  }

  return {
    id: `puzzle_verify_${Date.now()}`,
    mode: 'pipeline',
    prompt: originalTask,
    steps,
    createdAt: Date.now()
  };
}

/**
 * Phase 5: REFINE - Fix issues and polish
 *
 * Uses Self-Refine iterative improvement
 */
export function buildRefinePlan(
  originalTask: string,
  options: PuzzleAssemblyOptions = {}
): ExecutionPlan {
  const { refinementRounds = 2 } = options;

  const steps: PlanStep[] = [];

  for (let round = 0; round < refinementRounds; round++) {
    const prevSolution = round === 0 ? '{{assembled_solution}}' : `{{refined_solution_${round - 1}}}`;
    const prevVerification = round === 0 ? '{{verification_result}}' : `{{refinement_feedback_${round - 1}}}`;

    steps.push(
      {
        id: `refine_${round}`,
        agent: 'codex',
        action: 'prompt',
        prompt: `Refine this solution based on feedback.

Original Task: {{prompt}}

Current Solution:
${prevSolution}

Feedback/Issues:
${prevVerification}

Improve the solution by:
1. Fixing all identified issues
2. Addressing suggestions
3. Improving code quality
4. Adding missing error handling

Output the refined solution.`,
        dependsOn: round === 0 ? ['cross_verify'] : [`feedback_${round - 1}`],
        outputAs: `refined_solution_${round}`
      },
      {
        id: `feedback_${round}`,
        agent: 'gemini',
        action: 'prompt',
        prompt: `Review the refinements made.

Previous: ${prevSolution}
Refined: {{refined_solution_${round}}}

Are all issues addressed? Any new issues introduced?
Output remaining issues or "COMPLETE" if satisfactory.`,
        dependsOn: [`refine_${round}`],
        outputAs: `refinement_feedback_${round}`
      }
    );
  }

  // Final polish
  steps.push({
    id: 'final_polish',
    agent: 'claude',
    action: 'prompt',
    prompt: `Final polish of the solution.

Task: {{prompt}}
Solution: {{refined_solution_${refinementRounds - 1}}}

Make final improvements:
1. Clean up formatting
2. Add helpful comments
3. Ensure consistency
4. Optimize if obvious opportunities

Output the final, production-ready solution.`,
    dependsOn: [`feedback_${refinementRounds - 1}`],
    outputAs: 'final_solution'
  });

  return {
    id: `puzzle_refine_${Date.now()}`,
    mode: 'pipeline',
    prompt: originalTask,
    steps,
    createdAt: Date.now()
  };
}

/**
 * Build complete Puzzle Assembly execution plan
 */
export function buildPuzzleAssemblyPlan(
  task: string,
  options: PuzzleAssemblyOptions = {}
): ExecutionPlan {
  // This would typically be called after decomposition is complete
  // For now, return a simplified single-plan version

  return {
    id: `puzzle_assembly_${Date.now()}`,
    mode: 'pipeline',
    prompt: task,
    steps: [
      // Phase 1: Decompose
      {
        id: 'decompose',
        agent: 'codex',
        action: 'prompt',
        prompt: `Break this task into independent, solvable pieces.

Task: {{prompt}}

Output JSON with pieces, dependencies, and execution order.`,
        outputAs: 'pieces'
      },
      // Phase 2: Solve (simplified - MoA with 2 proposers)
      {
        id: 'propose_1',
        agent: 'codex',
        action: 'prompt',
        prompt: `Solve this task completely.

Task: {{prompt}}
Structure: {{pieces}}

Provide full implementation.`,
        dependsOn: ['decompose'],
        outputAs: 'proposal_1'
      },
      {
        id: 'propose_2',
        agent: 'claude',
        action: 'prompt',
        prompt: `Solve this task completely.

Task: {{prompt}}
Structure: {{pieces}}

Provide full implementation.`,
        dependsOn: ['decompose'],
        outputAs: 'proposal_2'
      },
      // Phase 3: Assemble (MoA aggregation)
      {
        id: 'assemble',
        agent: 'codex',
        action: 'prompt',
        prompt: `Synthesize these proposals into the best solution.

Task: {{prompt}}

Proposal 1:
{{proposal_1}}

Proposal 2:
{{proposal_2}}

Create unified solution taking best from each.`,
        dependsOn: ['propose_1', 'propose_2'],
        outputAs: 'assembled'
      },
      // Phase 4: Verify
      {
        id: 'verify',
        agent: 'gemini',
        action: 'prompt',
        prompt: `Verify this solution for correctness.

Task: {{prompt}}
Solution: {{assembled}}

Check for errors, gaps, issues. Output JSON with valid flag and issues list.`,
        dependsOn: ['assemble'],
        outputAs: 'verification'
      },
      // Phase 5: Refine
      {
        id: 'refine',
        agent: 'codex',
        action: 'prompt',
        prompt: `Refine based on verification feedback.

Task: {{prompt}}
Solution: {{assembled}}
Feedback: {{verification}}

Fix all issues and output final solution.`,
        dependsOn: ['verify'],
        outputAs: 'final'
      }
    ],
    createdAt: Date.now()
  };
}

// Helper functions

function groupByDependencies(pieces: PuzzlePiece[]): PuzzlePiece[][] {
  const layers: PuzzlePiece[][] = [];
  const solved = new Set<string>();

  while (solved.size < pieces.length) {
    const layer = pieces.filter(p =>
      !solved.has(p.id) &&
      p.dependencies.every(d => solved.has(d))
    );

    if (layer.length === 0) {
      // Circular dependency or error
      const remaining = pieces.filter(p => !solved.has(p.id));
      layers.push(remaining);
      break;
    }

    layers.push(layer);
    layer.forEach(p => solved.add(p.id));
  }

  return layers;
}

function selectAgentForPiece(piece: PuzzlePiece): AgentName {
  const desc = piece.description.toLowerCase();

  // Route based on piece characteristics
  if (desc.includes('research') || desc.includes('analyze') || desc.includes('document')) {
    return 'gemini';
  }
  if (desc.includes('implement') || desc.includes('code') || desc.includes('build')) {
    return 'codex';
  }
  if (desc.includes('design') || desc.includes('architect')) {
    return 'claude';
  }

  // Default to capability cascade
  return 'codex';
}

export {
  CAPABILITY_CASCADE,
  groupByDependencies,
  selectAgentForPiece
};
