/**
 * Tests for Task Reflector
 *
 * Tests the task reflector's ability to assess task completion,
 * classify failures, and recommend appropriate actions.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { TaskReflector, createReflector, assessTask } from './task-reflector.js';
import type { CampaignTask } from './campaign-state.js';
import type { WorkerResult } from './campaign-worker.js';
import type { EnhancedCampaignTask } from './campaign-types.js';

const cwd = process.cwd();

// Test tasks
const basicTask: CampaignTask = {
  id: 'test-task-1',
  title: 'Implement Feature X',
  description: 'Add feature X to the system',
  status: 'in_progress',
  dependencies: [],
  acceptanceCriteria: ['Feature works correctly', 'Tests pass'],
  assignedFiles: ['src/feature.ts'],
  attempts: 0,
  createdAt: Date.now()
};

const taskWithAttempts: CampaignTask = {
  ...basicTask,
  id: 'test-task-2',
  attempts: 2
};

const enhancedTask: EnhancedCampaignTask = {
  ...basicTask,
  id: 'test-task-3',
  entry_criteria: [
    {
      description: 'Dependencies installed',
      check_command: 'echo ok'
    }
  ],
  exit_criteria: [
    {
      description: 'TypeScript compiles',
      check_command: 'echo ok'
    },
    {
      description: 'Tests pass',
      check_command: 'echo ok'
    }
  ]
};

const enhancedTaskWithFailingCriteria: EnhancedCampaignTask = {
  ...basicTask,
  id: 'test-task-4',
  entry_criteria: [],
  exit_criteria: [
    {
      description: 'TypeScript compiles',
      check_command: 'exit 1'
    }
  ]
};

// Test worker results
const successResult: WorkerResult = {
  taskId: 'test-task-1',
  success: true,
  summary: 'Implemented feature X successfully',
  artifacts: ['src/feature.ts']
};

const failedResult: WorkerResult = {
  taskId: 'test-task-1',
  success: false,
  summary: '',
  error: 'TypeError: Cannot read property of undefined',
  artifacts: []
};

const timeoutResult: WorkerResult = {
  taskId: 'test-task-1',
  success: false,
  summary: '',
  error: 'Operation timeout after 30 seconds',
  artifacts: []
};

const notFoundResult: WorkerResult = {
  taskId: 'test-task-1',
  success: false,
  summary: '',
  error: 'ENOENT: no such file or directory',
  artifacts: []
};

describe('TaskReflector', () => {
  describe('constructor', () => {
    it('should create reflector with default options', () => {
      const reflector = new TaskReflector({ cwd });
      expect(reflector).toBeDefined();
    });

    it('should create reflector with custom options', () => {
      const reflector = new TaskReflector({
        cwd,
        timeout: 30000,
        criteriaOnly: true
      });
      expect(reflector).toBeDefined();
    });
  });

  describe('assess - catastrophic failures', () => {
    it('should classify TypeError as SYNTAX', async () => {
      const reflector = new TaskReflector({ cwd, criteriaOnly: true });
      const result = await reflector.assess(basicTask, failedResult);

      expect(result.passed).toBe(false);
      expect(result.classification).toBe('SYNTAX');
      expect(result.recommendation).toBe('retry');
      expect(result.analysis).toContain('TypeError');
    });

    it('should classify timeout as INTEGRATION and escalate', async () => {
      const reflector = new TaskReflector({ cwd, criteriaOnly: true });
      const result = await reflector.assess(basicTask, timeoutResult);

      expect(result.passed).toBe(false);
      expect(result.classification).toBe('INTEGRATION');
      expect(result.recommendation).toBe('escalate');
    });

    it('should classify ENOENT as SYNTAX', async () => {
      const reflector = new TaskReflector({ cwd, criteriaOnly: true });
      const result = await reflector.assess(basicTask, notFoundResult);

      expect(result.passed).toBe(false);
      expect(result.classification).toBe('SYNTAX');
      expect(result.recommendation).toBe('retry');
      expect(result.suggested_fixes).toBeDefined();
      expect(result.suggested_fixes?.[0]).toContain('files exist');
    });
  });

  describe('assess - criteria-only mode', () => {
    it('should pass when worker succeeds with no criteria', async () => {
      const reflector = new TaskReflector({ cwd, criteriaOnly: true });
      const result = await reflector.assess(basicTask, successResult);

      expect(result.passed).toBe(true);
      expect(result.classification).toBeUndefined();
    });

    it('should fail when worker fails with no criteria', async () => {
      const resultWithNoError: WorkerResult = {
        ...failedResult,
        error: undefined
      };
      const reflector = new TaskReflector({ cwd, criteriaOnly: true });
      const result = await reflector.assess(basicTask, resultWithNoError);

      expect(result.passed).toBe(false);
      expect(result.classification).toBe('LOGIC');
      expect(result.analysis).toContain('No exit criteria defined');
    });

    it('should pass when exit criteria pass', async () => {
      const reflector = new TaskReflector({ cwd, criteriaOnly: true });
      const result = await reflector.assess(enhancedTask, successResult);

      expect(result.passed).toBe(true);
      expect(result.analysis).toContain('exit criteria passed');
      expect(result.confidence).toBe(1.0);
    });

    it('should fail when exit criteria fail', async () => {
      const reflector = new TaskReflector({ cwd, criteriaOnly: true });
      const result = await reflector.assess(enhancedTaskWithFailingCriteria, successResult);

      expect(result.passed).toBe(false);
      expect(result.analysis).toContain('Exit criteria failed');
    });
  });

  describe('classification logic', () => {
    it('should recommend retry for SYNTAX with few attempts', async () => {
      const reflector = new TaskReflector({ cwd, criteriaOnly: true });
      const result = await reflector.assess(basicTask, failedResult);

      expect(result.recommendation).toBe('retry');
    });

    it('should recommend escalate for SYNTAX with many attempts', async () => {
      const reflector = new TaskReflector({ cwd, criteriaOnly: true });
      const result = await reflector.assess(taskWithAttempts, failedResult);

      expect(result.recommendation).toBe('escalate');
    });
  });

  describe('confidence scoring', () => {
    it('should have high confidence for criteria-based pass', async () => {
      const reflector = new TaskReflector({ cwd, criteriaOnly: true });
      const result = await reflector.assess(enhancedTask, successResult);

      expect(result.confidence).toBe(1.0);
    });

    it('should have medium confidence for error-based classification', async () => {
      const reflector = new TaskReflector({ cwd, criteriaOnly: true });
      const result = await reflector.assess(basicTask, failedResult);

      expect(result.confidence).toBe(0.8);
    });

    it('should have lower confidence when no criteria defined', async () => {
      const reflector = new TaskReflector({ cwd, criteriaOnly: true });
      const successNoError: WorkerResult = {
        ...successResult,
        success: true
      };
      const result = await reflector.assess(basicTask, successNoError);

      expect(result.confidence).toBe(0.5);
    });
  });
});

describe('createReflector factory', () => {
  it('should create a TaskReflector instance', () => {
    const reflector = createReflector({ cwd });
    expect(reflector).toBeInstanceOf(TaskReflector);
  });
});

describe('assessTask function', () => {
  it('should assess task with default options', async () => {
    const result = await assessTask(basicTask, successResult, cwd, { criteriaOnly: true });

    expect(result).toBeDefined();
    expect(result.passed).toBe(true);
  });

  it('should assess task with custom options', async () => {
    const result = await assessTask(enhancedTask, successResult, cwd, {
      criteriaOnly: true,
      timeout: 5000
    });

    expect(result).toBeDefined();
    expect(result.passed).toBe(true);
  });
});

describe('failure classification patterns', () => {
  it('should classify compilation failures as SYNTAX', async () => {
    const taskWithCompileFailure: EnhancedCampaignTask = {
      ...basicTask,
      id: 'compile-fail',
      entry_criteria: [],
      exit_criteria: [
        {
          description: 'Code compiles',
          check_command: 'echo "tsc: error TS2345" && exit 1',
          error_message: 'Compilation failed with type errors'
        }
      ]
    };

    const reflector = new TaskReflector({ cwd, criteriaOnly: true });
    const result = await reflector.assess(taskWithCompileFailure, successResult);

    // The criteria will run and fail, classification based on failure message
    expect(result.passed).toBe(false);
  });
});

describe('suggested fixes', () => {
  it('should suggest fix for ENOENT errors', async () => {
    const reflector = new TaskReflector({ cwd, criteriaOnly: true });
    const result = await reflector.assess(basicTask, notFoundResult);

    expect(result.suggested_fixes).toBeDefined();
    expect(result.suggested_fixes?.length).toBeGreaterThan(0);
    expect(result.suggested_fixes?.[0]).toContain('path');
  });

  it('should suggest fix for timeout errors', async () => {
    const reflector = new TaskReflector({ cwd, criteriaOnly: true });
    const result = await reflector.assess(basicTask, timeoutResult);

    expect(result.suggested_fixes).toBeDefined();
    expect(result.suggested_fixes?.[0]).toContain('smaller subtasks');
  });

  it('should suggest fix for TypeError', async () => {
    const reflector = new TaskReflector({ cwd, criteriaOnly: true });
    const result = await reflector.assess(basicTask, failedResult);

    expect(result.suggested_fixes).toBeDefined();
    expect(result.suggested_fixes?.[0]).toContain('type');
  });
});
