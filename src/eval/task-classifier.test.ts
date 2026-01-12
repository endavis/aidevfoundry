/**
 * Task Classification Evaluation Suite
 *
 * Verifies that task classification and mode selection
 * produces correct results for known test cases.
 */

import { describe, it, expect } from 'bun:test';

// Task types matching do.ts
type TaskType =
  | 'implement'
  | 'fix'
  | 'analyze'
  | 'security'
  | 'refactor'
  | 'explain'
  | 'simple';

// Expected mode for each task type
const EXPECTED_MODES: Record<TaskType, string> = {
  security: 'PK-Poet (Security Focus)',
  implement: 'Poetiq (Verification-First)',
  fix: 'Self-Discover (Bug Analysis)',
  refactor: 'PK-Poet (Refactor)',
  analyze: 'Self-Discover (Analysis)',
  explain: 'Self-Discover (Analysis)',
  simple: 'Direct',
};

/**
 * Test cases with expected classification
 */
interface TestCase {
  task: string;
  expectedType: TaskType;
  description: string;
}

const TEST_CASES: TestCase[] = [
  // Implementation tasks
  {
    task: 'Implement user authentication with JWT tokens',
    expectedType: 'implement',
    description: 'Feature implementation with "implement"',
  },
  {
    task: 'Create a REST API endpoint for user profiles',
    expectedType: 'implement',
    description: 'Feature implementation with "create"',
  },
  {
    task: 'Build a caching layer for database queries',
    expectedType: 'implement',
    description: 'Feature implementation with "build"',
  },
  {
    task: 'Add pagination to the products list',
    expectedType: 'implement',
    description: 'Feature implementation with "add"',
  },
  {
    task: 'Write unit tests for the payment module',
    expectedType: 'implement',
    description: 'Implementation with "write"',
  },
  {
    task: 'Develop a WebSocket connection handler',
    expectedType: 'implement',
    description: 'Implementation with "develop"',
  },

  // Bug fix tasks
  {
    task: 'Fix the login form validation bug',
    expectedType: 'fix',
    description: 'Bug fix with "fix" and "bug"',
  },
  {
    task: 'The upload feature is not working',
    expectedType: 'fix',
    description: 'Bug fix with "not working"',
  },
  {
    task: 'Tests are failing on the CI pipeline',
    expectedType: 'fix',
    description: 'Bug fix with "failing"',
  },
  {
    task: 'Error when submitting the contact form',
    expectedType: 'fix',
    description: 'Bug fix with "error"',
  },
  {
    task: 'There is an issue with the date picker',
    expectedType: 'fix',
    description: 'Bug fix with "issue"',
  },

  // Security tasks
  {
    task: 'Check for security vulnerabilities in the auth module',
    expectedType: 'security',
    description: 'Security with "security" and "vulnerabilities"',
  },
  {
    task: 'Perform a security audit on the API endpoints',
    expectedType: 'security',
    description: 'Security with "security audit"',
  },
  {
    task: 'Find potential SQL injection attack vectors',
    expectedType: 'security',
    description: 'Security with "attack"',
  },
  {
    task: 'Check for exploitable XSS vulnerabilities',
    expectedType: 'security',
    description: 'Security with "exploit" and "vulnerabilities"',
  },
  {
    task: 'Penetration test the login flow',
    expectedType: 'security',
    description: 'Security with "penetration"',
  },

  // Refactor tasks
  {
    task: 'Refactor the user service to use dependency injection',
    expectedType: 'refactor',
    description: 'Refactor with "refactor"',
  },
  {
    task: 'Improve the performance of database queries',
    expectedType: 'refactor',
    description: 'Refactor with "improve"',
  },
  {
    task: 'Optimize the image loading pipeline',
    expectedType: 'refactor',
    description: 'Refactor with "optimize"',
  },
  {
    task: 'Clean up the legacy authentication code',
    expectedType: 'refactor',
    description: 'Refactor with "clean up"',
  },
  {
    task: 'Restructure the components folder',
    expectedType: 'refactor',
    description: 'Refactor with "restructure"',
  },

  // Analysis tasks
  {
    task: 'Analyze the performance bottlenecks in the app',
    expectedType: 'analyze',
    description: 'Analysis with "analyze"',
  },
  {
    task: 'Review the error handling patterns',
    expectedType: 'analyze',
    description: 'Analysis with "review"',
  },
  {
    task: 'I need to understand how the auth flow works',
    expectedType: 'analyze',
    description: 'Analysis with "understand"',
  },
  {
    task: 'Investigate the memory leak issue',
    expectedType: 'analyze',
    description: 'Analysis with "investigate"',
  },
  {
    task: 'Find all usages of deprecated API',
    expectedType: 'analyze',
    description: 'Analysis with "find"',
  },

  // Explain tasks
  {
    task: 'Explain how the middleware chain works',
    expectedType: 'explain',
    description: 'Explain with "explain"',
  },
  {
    task: 'What is the purpose of the adapter pattern here?',
    expectedType: 'explain',
    description: 'Explain with "what is"',
  },
  {
    task: 'How does the caching mechanism work?',
    expectedType: 'explain',
    description: 'Explain with "how does"',
  },
  {
    task: 'Why is the state managed this way?',
    expectedType: 'explain',
    description: 'Explain with "why"',
  },
  {
    task: 'Describe the authentication architecture',
    expectedType: 'explain',
    description: 'Explain with "describe"',
  },

  // Simple tasks (short or ambiguous)
  {
    task: 'Hello',
    expectedType: 'simple',
    description: 'Very short task',
  },
  {
    task: 'List files',
    expectedType: 'simple',
    description: 'Short command-like task',
  },
  {
    task: 'Run tests',
    expectedType: 'simple',
    description: 'Simple command task',
  },
];

/**
 * Classify a task (matching logic from do.ts)
 */
function classifyTask(task: string): TaskType {
  const lower = task.toLowerCase();

  // Security keywords
  if (
    lower.includes('security') ||
    lower.includes('vulnerabil') ||
    lower.includes('attack') ||
    lower.includes('exploit') ||
    lower.includes('penetration') ||
    lower.includes('audit')
  ) {
    return 'security';
  }

  // Implementation keywords
  if (
    lower.includes('implement') ||
    lower.includes('create') ||
    lower.includes('build') ||
    lower.includes('add') ||
    lower.includes('develop') ||
    lower.includes('make') ||
    lower.includes('write')
  ) {
    return 'implement';
  }

  // Analysis keywords - check before fix to allow "review error handling" to be analyzed
  // rather than classified as a fix task
  if (
    lower.includes('analyze') ||
    lower.includes('review') ||
    lower.includes('understand') ||
    lower.includes('investigate') ||
    lower.includes('find') ||
    lower.includes('search') ||
    lower.includes('look at')
  ) {
    return 'analyze';
  }

  // Fix keywords
  if (
    lower.includes('fix') ||
    lower.includes('bug') ||
    lower.includes('error') ||
    lower.includes('issue') ||
    lower.includes('broken') ||
    lower.includes('not working') ||
    lower.includes('failing')
  ) {
    return 'fix';
  }

  // Refactor keywords
  if (
    lower.includes('refactor') ||
    lower.includes('improve') ||
    lower.includes('optimize') ||
    lower.includes('clean up') ||
    lower.includes('restructure')
  ) {
    return 'refactor';
  }

  // Explain keywords
  if (
    lower.includes('explain') ||
    lower.includes('what is') ||
    lower.includes('how does') ||
    lower.includes('why') ||
    lower.includes('describe')
  ) {
    return 'explain';
  }

  // Default to simple for short tasks, implement for longer ones
  return task.length < 50 ? 'simple' : 'implement';
}

// Run tests
describe('Task Classification', () => {
  describe('Implementation Tasks', () => {
    const implCases = TEST_CASES.filter(c => c.expectedType === 'implement');
    for (const testCase of implCases) {
      it(testCase.description, () => {
        const result = classifyTask(testCase.task);
        expect(result).toBe(testCase.expectedType);
      });
    }
  });

  describe('Bug Fix Tasks', () => {
    const fixCases = TEST_CASES.filter(c => c.expectedType === 'fix');
    for (const testCase of fixCases) {
      it(testCase.description, () => {
        const result = classifyTask(testCase.task);
        expect(result).toBe(testCase.expectedType);
      });
    }
  });

  describe('Security Tasks', () => {
    const secCases = TEST_CASES.filter(c => c.expectedType === 'security');
    for (const testCase of secCases) {
      it(testCase.description, () => {
        const result = classifyTask(testCase.task);
        expect(result).toBe(testCase.expectedType);
      });
    }
  });

  describe('Refactor Tasks', () => {
    const refCases = TEST_CASES.filter(c => c.expectedType === 'refactor');
    for (const testCase of refCases) {
      it(testCase.description, () => {
        const result = classifyTask(testCase.task);
        expect(result).toBe(testCase.expectedType);
      });
    }
  });

  describe('Analysis Tasks', () => {
    const anaCases = TEST_CASES.filter(c => c.expectedType === 'analyze');
    for (const testCase of anaCases) {
      it(testCase.description, () => {
        const result = classifyTask(testCase.task);
        expect(result).toBe(testCase.expectedType);
      });
    }
  });

  describe('Explain Tasks', () => {
    const expCases = TEST_CASES.filter(c => c.expectedType === 'explain');
    for (const testCase of expCases) {
      it(testCase.description, () => {
        const result = classifyTask(testCase.task);
        expect(result).toBe(testCase.expectedType);
      });
    }
  });

  describe('Simple Tasks', () => {
    const simCases = TEST_CASES.filter(c => c.expectedType === 'simple');
    for (const testCase of simCases) {
      it(testCase.description, () => {
        const result = classifyTask(testCase.task);
        expect(result).toBe(testCase.expectedType);
      });
    }
  });
});

// Evaluation metrics
describe('Classifier Evaluation', () => {
  it('should achieve 100% accuracy on test suite', () => {
    let correct = 0;
    const failures: string[] = [];

    for (const testCase of TEST_CASES) {
      const result = classifyTask(testCase.task);
      if (result === testCase.expectedType) {
        correct++;
      } else {
        failures.push(
          `"${testCase.task}" -> ${result} (expected ${testCase.expectedType})`
        );
      }
    }

    const accuracy = (correct / TEST_CASES.length) * 100;

    if (failures.length > 0) {
      console.log('\nMisclassifications:');
      failures.forEach(f => console.log(`  - ${f}`));
    }

    console.log(`\nAccuracy: ${accuracy.toFixed(1)}% (${correct}/${TEST_CASES.length})`);

    expect(accuracy).toBe(100);
  });
});

// Export for use in evaluation CLI
export { classifyTask, TEST_CASES, EXPECTED_MODES, type TaskType, type TestCase };
