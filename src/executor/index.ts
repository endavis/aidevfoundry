/**
 * Executor module exports
 */

// Types
export type {
  AgentName,
  StepAction,
  StepStatus,
  StepResult,
  PlanStep,
  ExecutionPlan,
  PlanMode,
  TimelineEvent,
  ExecutionResult,
  ExecutorConfig,
  CompareOptions,
  PipelineOptions,
  PipelineStep,
  PipelineTemplate
} from './types';

// Context
export {
  createContext,
  addStepResult,
  injectVariables,
  evaluateCondition,
  dependenciesSatisfied,
  anyDependencyFailed,
  getUnresolvedDependencies,
  type ExecutionContext
} from './context';

// Plan builders
export {
  buildSingleAgentPlan,
  buildComparePlan,
  buildPipelinePlan,
  parsePipelineString,
  parseAgentsString
} from './plan-builders';

// Executor
export { execute } from './executor';

// Templates
export {
  loadTemplate,
  saveTemplate,
  listTemplates,
  deleteTemplate,
  createTemplate,
  ensureTemplatesDir
} from './templates';

// Planner
export { generatePlan, formatPlanForDisplay } from './planner';
