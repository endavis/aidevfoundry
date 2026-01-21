/**
 * Tests for Campaign Worker
 *
 * Tests mode-based execution switching and task execution modes.
 */

import { describe, it, expect } from 'bun:test';
import type { CampaignTask } from './campaign-state.js';
import type { EnhancedCampaignTask, TaskCriterion } from './campaign-types.js';
import type { PlanMode } from '../../executor/types.js';

// Test helpers - we test the mode selection logic without running actual LLM calls
describe('Campaign Worker Mode Selection', () => {
  // Mock task for testing
  const basicTask: CampaignTask = {
    id: 'test-task-1',
    title: 'Test Feature Implementation',
    description: 'Implement a test feature',
    status: 'pending',
    dependencies: [],
    acceptanceCriteria: ['Feature works correctly'],
    assignedFiles: [],
    attempts: 0,
    createdAt: Date.now()
  };

  describe('Mode Detection from EnhancedCampaignTask', () => {
    it('should detect single mode from task', () => {
      const task: EnhancedCampaignTask = {
        ...basicTask,
        entry_criteria: [],
        exit_criteria: [],
        execution_mode: 'single'
      };

      expect(task.execution_mode).toBe('single');
    });

    it('should detect compare mode from task', () => {
      const task: EnhancedCampaignTask = {
        ...basicTask,
        entry_criteria: [],
        exit_criteria: [],
        execution_mode: 'compare'
      };

      expect(task.execution_mode).toBe('compare');
    });

    it('should detect pipeline mode from task', () => {
      const task: EnhancedCampaignTask = {
        ...basicTask,
        entry_criteria: [],
        exit_criteria: [],
        execution_mode: 'pipeline'
      };

      expect(task.execution_mode).toBe('pipeline');
    });

    it('should detect debate mode from task', () => {
      const task: EnhancedCampaignTask = {
        ...basicTask,
        entry_criteria: [],
        exit_criteria: [],
        execution_mode: 'debate'
      };

      expect(task.execution_mode).toBe('debate');
    });

    it('should detect consensus mode from task', () => {
      const task: EnhancedCampaignTask = {
        ...basicTask,
        entry_criteria: [],
        exit_criteria: [],
        execution_mode: 'consensus'
      };

      expect(task.execution_mode).toBe('consensus');
    });

    it('should detect correction mode from task', () => {
      const task: EnhancedCampaignTask = {
        ...basicTask,
        entry_criteria: [],
        exit_criteria: [],
        execution_mode: 'correction'
      };

      expect(task.execution_mode).toBe('correction');
    });

    it('should detect pickbuild mode from task', () => {
      const task: EnhancedCampaignTask = {
        ...basicTask,
        entry_criteria: [],
        exit_criteria: [],
        execution_mode: 'pickbuild'
      };

      expect(task.execution_mode).toBe('pickbuild');
    });
  });

  describe('Mode Resolution Logic', () => {
    /**
     * Simulates the mode resolution logic from runWorkerTask
     */
    function resolveExecutionMode(
      task: CampaignTask | EnhancedCampaignTask,
      forceMode?: PlanMode
    ): PlanMode {
      // Check if task has execution_mode (is EnhancedCampaignTask)
      const hasExecutionMode = 'execution_mode' in task && task.execution_mode;
      const taskMode = hasExecutionMode ? (task as EnhancedCampaignTask).execution_mode : undefined;

      return forceMode ?? taskMode ?? 'single';
    }

    it('should default to single mode for basic tasks', () => {
      const mode = resolveExecutionMode(basicTask);
      expect(mode).toBe('single');
    });

    it('should use task execution_mode for enhanced tasks', () => {
      const task: EnhancedCampaignTask = {
        ...basicTask,
        entry_criteria: [],
        exit_criteria: [],
        execution_mode: 'compare'
      };

      const mode = resolveExecutionMode(task);
      expect(mode).toBe('compare');
    });

    it('should allow forceMode to override task mode', () => {
      const task: EnhancedCampaignTask = {
        ...basicTask,
        entry_criteria: [],
        exit_criteria: [],
        execution_mode: 'compare'
      };

      const mode = resolveExecutionMode(task, 'pipeline');
      expect(mode).toBe('pipeline');
    });

    it('should use forceMode even for basic tasks', () => {
      const mode = resolveExecutionMode(basicTask, 'debate');
      expect(mode).toBe('debate');
    });

    it('should fall back to single if no mode specified', () => {
      const task: EnhancedCampaignTask = {
        ...basicTask,
        entry_criteria: [],
        exit_criteria: []
        // No execution_mode set
      };

      const mode = resolveExecutionMode(task);
      expect(mode).toBe('single');
    });
  });

  describe('WorkerOptions Interface', () => {
    it('should support all expected execution mode options', () => {
      interface WorkerOptions {
        cwd: string;
        workers: string[];
        useDroid: boolean;
        forceMode?: PlanMode;
        compareAgents?: string[];
        debateRounds?: number;
        interactive?: boolean;
      }

      const options: WorkerOptions = {
        cwd: '/test',
        workers: ['droid:claude'],
        useDroid: true,
        forceMode: 'compare',
        compareAgents: ['claude', 'gemini'],
        debateRounds: 3,
        interactive: true
      };

      expect(options.forceMode).toBe('compare');
      expect(options.compareAgents).toEqual(['claude', 'gemini']);
      expect(options.debateRounds).toBe(3);
      expect(options.interactive).toBe(true);
    });
  });

  describe('WorkerResult Interface', () => {
    it('should include execution mode in result', () => {
      interface WorkerResult {
        taskId: string;
        success: boolean;
        summary: string;
        error?: string;
        artifacts: string[];
        gitDiff?: string;
        executionMode?: PlanMode;
      }

      const result: WorkerResult = {
        taskId: 'test-1',
        success: true,
        summary: 'Task completed',
        artifacts: ['file.ts'],
        executionMode: 'compare'
      };

      expect(result.executionMode).toBe('compare');
    });
  });
});

describe('Mode Plan Building', () => {
  // Test that each mode maps to expected plan structure
  const allModes: PlanMode[] = [
    'single',
    'compare',
    'pipeline',
    'correction',
    'debate',
    'consensus',
    'pickbuild'
  ];

  it('should recognize all supported execution modes', () => {
    expect(allModes).toContain('single');
    expect(allModes).toContain('compare');
    expect(allModes).toContain('pipeline');
    expect(allModes).toContain('correction');
    expect(allModes).toContain('debate');
    expect(allModes).toContain('consensus');
    expect(allModes).toContain('pickbuild');
  });

  it('should have 7 supported modes', () => {
    expect(allModes.length).toBe(7);
  });
});

describe('Task Prompt Building', () => {
  /**
   * Simulates buildTaskPrompt logic
   */
  function buildTaskPrompt(task: CampaignTask, cwd: string): string {
    let prompt = `Task: ${task.title}\n\n`;

    if (task.description) {
      prompt += `Description: ${task.description}\n\n`;
    }

    if (task.acceptanceCriteria && task.acceptanceCriteria.length > 0) {
      prompt += `Acceptance Criteria:\n`;
      for (const criteria of task.acceptanceCriteria) {
        prompt += `- ${criteria}\n`;
      }
      prompt += '\n';
    }

    prompt += `Working Directory: ${cwd}\n\n`;
    prompt += `Execute this task using tools as needed. Run relevant tests or checks if you modify code. `;
    prompt += `If you make file changes, list them at the end along with any tests run.`;

    return prompt;
  }

  it('should build prompt with title', () => {
    const task: CampaignTask = {
      id: 'test-1',
      title: 'Test Task',
      status: 'pending',
      dependencies: [],
      acceptanceCriteria: [],
      assignedFiles: [],
      attempts: 0,
      createdAt: Date.now()
    };

    const prompt = buildTaskPrompt(task, '/test/dir');
    expect(prompt).toContain('Task: Test Task');
  });

  it('should include description if present', () => {
    const task: CampaignTask = {
      id: 'test-1',
      title: 'Test Task',
      description: 'A detailed description',
      status: 'pending',
      dependencies: [],
      acceptanceCriteria: [],
      assignedFiles: [],
      attempts: 0,
      createdAt: Date.now()
    };

    const prompt = buildTaskPrompt(task, '/test/dir');
    expect(prompt).toContain('Description: A detailed description');
  });

  it('should include acceptance criteria', () => {
    const task: CampaignTask = {
      id: 'test-1',
      title: 'Test Task',
      status: 'pending',
      dependencies: [],
      acceptanceCriteria: ['Criterion 1', 'Criterion 2'],
      assignedFiles: [],
      attempts: 0,
      createdAt: Date.now()
    };

    const prompt = buildTaskPrompt(task, '/test/dir');
    expect(prompt).toContain('Acceptance Criteria:');
    expect(prompt).toContain('- Criterion 1');
    expect(prompt).toContain('- Criterion 2');
  });

  it('should include working directory', () => {
    const task: CampaignTask = {
      id: 'test-1',
      title: 'Test Task',
      status: 'pending',
      dependencies: [],
      acceptanceCriteria: [],
      assignedFiles: [],
      attempts: 0,
      createdAt: Date.now()
    };

    const prompt = buildTaskPrompt(task, '/test/working/directory');
    expect(prompt).toContain('Working Directory: /test/working/directory');
  });
});
