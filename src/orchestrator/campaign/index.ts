export {
  runCampaign,
  loadCampaign,
  resumeCampaign,
  type CampaignOptions,
  type CampaignResult
} from './campaign-engine.js';

export {
  type CampaignState,
  type CampaignStatus,
  type CampaignTask,
  type CampaignTaskStatus,
  type CampaignCheckpoint,
  type CampaignDecision,
  type CampaignArtifact,
  type CampaignStateInit,
  createInitialState,
  loadCampaignState,
  saveCampaignState,
  getDefaultStateDir,
  getStateFilePath,
  ensureStateDir
} from './campaign-state.js';

export {
  type TaskQueue,
  type DomainQueue,
  type DomainQueueStatus,
  type MultiDomainQueue,
  createQueueFromTasks,
  getNextTask,
  updateTaskStatus,
  hasWorkRemaining,
  getProgress,
  // Domain queue functions
  createDomainQueue,
  createMultiDomainQueue,
  getNextTaskForDomain,
  getDomainStatus,
  hasDomainWorkRemaining,
  getDomainsWithWork,
  getMultiDomainProgress,
  updateDomainTaskStatus
} from './campaign-queue.js';

export { runPlanner, runSubPlanner } from './campaign-planner.js';

export {
  type PlannerOutput,
  type SubPlannerOutput,
  type RecoveryOutput,
  type ConflictResolutionOutput,
  validatePlannerOutput,
  validateSubPlannerOutput,
  validateRecoveryOutput,
  validateConflictResolutionOutput
} from './campaign-schema.js';

export {
  type WorkerResult,
  type WorkerOptions,
  runWorkerTask,
  runTaskWithMode
} from './campaign-worker.js';

// Task reflector
export {
  TaskReflector,
  createReflector,
  assessTask,
  type ReflectorOptions
} from './task-reflector.js';

// Parallel orchestrator
export {
  ParallelOrchestrator,
  runDomainsInParallel,
  createParallelConfig,
  type OrchestratorStatus,
  type DomainContext,
  type ProgressUpdate,
  type ParallelOrchestratorOptions
} from './parallel-orchestrator.js';

export {
  type AgentSpec,
  parseAgentSpec,
  resolveAgentForRole
} from './campaign-agent.js';

export { CAMPAIGN_DEFAULTS, type CampaignDefaults } from './campaign-defaults.js';

export { buildRepoMap, type RepoMapOptions } from './campaign-repo-map.js';

// Campaign git branch management
export {
  // Types
  type GitOperationResult,
  type BranchInfo,
  type MergeResult,
  type StashEntry,
  // Branch management
  getCurrentBranch,
  getBranchCommit,
  branchExists,
  listBranches,
  createBranch,
  deleteBranch,
  switchBranch,
  // Domain branch management
  getDomainBranchName,
  getCampaignBranchName,
  createDomainBranch,
  switchToDomainBranch,
  returnFromDomainBranch,
  // Merge operations
  mergeBranch,
  getConflictingFiles,
  abortMerge,
  mergeDomainsToCampaign,
  // Conflict detection
  detectMergeConflicts,
  detectDomainConflicts,
  // Stash management
  listStashes,
  popStash,
  dropStash,
  // Rollback operations
  rollbackBranchCreation,
  hardReset,
  // Utility functions
  initializeCampaignBranches,
  cleanupCampaignBranches,
  getCampaignBranchStatus
} from './campaign-git.js';

export {
  // Core persistence
  upsertCampaignProject,
  upsertCampaignTasks,
  logCampaignExecution,
  // Domain progress
  upsertDomainProgress,
  getDomainProgress,
  getDomainProgressByName,
  // Criteria results
  logCriteriaResult,
  logCriteriaValidation,
  getCriteriaResults,
  getCriteriaPassRate,
  // Domain metrics
  recordDomainMetric,
  getDomainMetricsByName,
  // Campaign metrics
  getCampaignMetrics,
  getAllDomainMetrics,
  // Task operations
  updateTaskTiming,
  updateTaskDomain,
  getTasksByDomain,
  getTasksByStatus,
  getExecutionLogs,
  // Types
  type DomainProgressRecord,
  type CriteriaResultRecord,
  type CampaignMetricsAggregate
} from './campaign-db.js';

// Campaign criteria validation
export {
  validateCriterion,
  validateEntryCriteria,
  validateExitCriteria,
  validateCriteria,
  canTaskStart,
  validateCriteriaParallel,
  formatCriteriaResult,
  createValidationSummary,
  withDefaults
} from './campaign-validation.js';

// Enhanced campaign types for parallel domain orchestration
export {
  // Domain types
  type CampaignDomain,
  type DomainStatus,
  type DomainConfig,
  // Criteria types
  type TaskCriterion,
  type CriteriaValidationResult,
  type CriterionResult,
  // Enhanced task types
  type EnhancedCampaignTask,
  // Parallel execution types
  type ParallelCampaignConfig,
  type ParallelGitStrategy,
  type MergeCoordination,
  type DriftDetectionConfig,
  type DriftSeverity,
  // Campaign state extensions
  type EnhancedCampaignState,
  type DomainMetrics,
  type CampaignMetrics,
  // Reflection types
  type TaskReflectionResult,
  type FailureClassification,
  type ReflectionRecommendation,
  // Drift detection types
  type DriftDetectionResult,
  type DriftArea,
  type CorrectivePlan,
  // Checkpoint types
  type EnhancedCheckpoint,
  type DomainCheckpointState,
  // Progress event types
  type CampaignProgressEvent,
  type CampaignEventType,
  // Defaults
  DEFAULT_PARALLEL_CONFIG,
  DEFAULT_TASK_CRITERION,
  // Type guards
  isEnhancedTask,
  isDomainBased,
  // Utility functions
  createDomain,
  createTypescriptCompileCriterion,
  createTestsCriterion,
  createFileExistsCriterion,
  createGrepCriterion
} from './campaign-types.js';

// Checkpoint management
export {
  // Core functions
  createCheckpoint,
  saveCheckpoint,
  loadCheckpoint,
  loadLatestCheckpoint,
  listCheckpoints,
  validateCheckpoint,
  resumeFromCheckpoint,
  // Convenience functions
  quickCheckpoint,
  quickSaveCheckpoint,
  quickResume,
  // Types
  type CheckpointConfig,
  type CheckpointValidation,
  type ResumeOptions,
  type ResumeResult
} from './campaign-checkpoint.js';

// Drift detection and correction
export {
  // Core class
  DriftDetector,
  // Factory functions
  createDriftDetector,
  checkForDrift,
  // Utilities
  exceedsThreshold,
  applyCorrectivePlan,
  // Defaults
  DEFAULT_DRIFT_CONFIG,
  // Types
  type DriftDetectorOptions
} from './campaign-drift.js';

// Metrics and observability
export {
  // Core class
  MetricsCollector,
  // Factory functions
  createMetricsCollector,
  // Stateless utilities
  calculateMetrics,
  // Formatting
  formatDuration,
  formatPercent,
  formatRate,
  // Reporting
  generateMetricsSummary,
  exportMetricsJson,
  // Types
  type MetricsSnapshot,
  type MetricsEvent,
  type MetricsCollectorOptions
} from './campaign-metrics.js';
