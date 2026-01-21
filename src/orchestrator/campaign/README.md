# Campaign Orchestrator

The Campaign Orchestrator enables long-running, multi-agent coding campaigns with checkpointing, drift detection, and parallel domain execution.

## Overview

A **campaign** is a structured approach to executing complex, multi-step coding tasks that span multiple files, features, or components. The system provides:

- **Hierarchical task decomposition** via planner/sub-planner/worker agents
- **Checkpoint-based state persistence** for resume capability
- **Drift detection** to identify when campaigns diverge from their goals
- **Parallel domain execution** for independent work streams
- **Metrics collection** for real-time observability

## Quick Start

### CLI Usage

```bash
# Start a new campaign
pk-puzldai campaign run "Migrate codebase from CommonJS to ESM"

# Resume a paused campaign
pk-puzldai campaign resume

# Check campaign status
pk-puzldai campaign status

# List checkpoints
pk-puzldai campaign list

# Create a manual checkpoint
pk-puzldai campaign checkpoint "Before major refactor"

# Check for drift
pk-puzldai campaign drift
```

### Programmatic Usage

```typescript
import {
  runCampaign,
  loadCampaign,
  resumeCampaign,
  type CampaignOptions
} from './orchestrator/campaign';

const options: CampaignOptions = {
  goal: 'Add user authentication system',
  cwd: process.cwd(),
  planner: 'claude',
  workers: ['claude', 'gemini'],
  maxWorkers: 2,
  autonomy: 'auto'
};

const result = await runCampaign(options);
```

## Architecture

### State Management

Campaign state is persisted to `.campaign/campaign.json`:

```typescript
interface CampaignState {
  campaignId: string;
  goal: string;
  status: CampaignStatus;  // 'idle' | 'running' | 'paused' | 'completed' | 'failed'
  version: number;         // Optimistic locking
  tasks: CampaignTask[];
  checkpoints: CampaignCheckpoint[];
  decisions: CampaignDecision[];
  artifacts: CampaignArtifact[];
  meta: CampaignMeta;
}
```

### Task Lifecycle

Tasks progress through these states:

```
pending -> in_progress -> completed
                      \-> failed -> (retry) -> in_progress
                      \-> blocked
```

### Task Queue

The queue system manages task dependencies:

```typescript
import {
  createQueueFromTasks,
  getNextTask,
  updateTaskStatus,
  hasWorkRemaining,
  getProgress
} from './campaign-queue';

// Create queue from tasks
const queue = createQueueFromTasks(tasks);

// Get next available task (respects dependencies)
const nextTask = getNextTask(queue, tasks);

// Update task status
updateTaskStatus(tasks, 'task-1', 'completed');
```

## Checkpointing

Checkpoints capture campaign state at specific points for recovery:

```typescript
import {
  createCheckpoint,
  saveCheckpoint,
  loadLatestCheckpoint,
  quickSaveCheckpoint,
  quickResume
} from './campaign-checkpoint';

// Quick checkpoint with summary
await quickSaveCheckpoint(state, cwd, 'Completed authentication module');

// Resume from latest checkpoint
const result = await quickResume(cwd);
if (result.success) {
  console.log(`Resumed from: ${result.checkpoint.summary}`);
}
```

### Checkpoint Contents

```typescript
interface EnhancedCheckpoint {
  id: string;
  campaignId: string;
  timestamp: number;
  summary: string;

  // State snapshot
  stateSnapshot: CampaignState;
  gitCommit?: string;
  gitBranch?: string;

  // Domain progress (for parallel execution)
  domainStates?: Record<string, DomainCheckpointState>;

  // Integrity validation
  checksum?: string;
}
```

## Drift Detection

Drift detection identifies when a campaign diverges from its intended path:

```typescript
import {
  DriftDetector,
  checkForDrift,
  exceedsThreshold,
  applyCorrectivePlan
} from './campaign-drift';

// Quick drift check
const result = await checkForDrift(state, cwd, { criteriaOnly: true });

if (result.drifted) {
  console.log(`Drift detected: ${result.severity}`);
  for (const area of result.drift_areas) {
    console.log(`  - ${area.domain}: ${area.description}`);
  }
}

// Class-based detector for tracking history
const detector = new DriftDetector({ cwd });
const driftResult = await detector.detect(state);

// Check if severity exceeds threshold
if (exceedsThreshold(result.severity, 'moderate')) {
  // Apply corrective action
}
```

### Drift Severity Levels

| Severity | Description | Typical Causes |
|----------|-------------|----------------|
| `minor` | Small deviations, easily correctable | Minor scope changes |
| `moderate` | Notable divergence, needs attention | Multiple failed tasks, missed criteria |
| `severe` | Significant drift, may need replanning | High failure rate, stuck tasks |

### Configuring Drift Detection

```typescript
import { DEFAULT_DRIFT_CONFIG } from './campaign-drift';

const config = {
  ...DEFAULT_DRIFT_CONFIG,
  failure_rate_threshold: 0.4,    // Alert at 40% failure rate
  stuck_threshold_ms: 15 * 60000, // 15 minutes without progress
  check_every_n_tasks: 3,         // Check after every 3 tasks
  check_at_milestones: [25, 50, 75, 100]  // Check at these progress %
};
```

## Metrics & Observability

Track campaign progress with the metrics collector:

```typescript
import {
  MetricsCollector,
  createMetricsCollector,
  calculateMetrics,
  generateMetricsSummary
} from './campaign-metrics';

// Create collector with event callback
const collector = createMetricsCollector({
  onEvent: (event) => console.log(`Event: ${event.type}`)
});

// Record task lifecycle events
collector.recordTaskStarted('task-1');
collector.recordTaskCompleted('task-1');
collector.recordTaskFailed('task-2', 'Test failure');
collector.recordTaskRetried('task-2', 2);

// Record drift checks
collector.recordDriftCheck(driftResult);
collector.recordDriftCorrection(2, 1, 0);

// Get metrics snapshot
const snapshot = collector.getSnapshot(state);
console.log(generateMetricsSummary(snapshot));
```

### Metrics Snapshot

```typescript
interface MetricsSnapshot {
  timestamp: number;
  campaignId: string;

  // Task counts
  tasksTotal: number;
  tasksCompleted: number;
  tasksFailed: number;
  tasksBlocked: number;
  tasksInProgress: number;
  tasksPending: number;

  // Progress
  progressPercent: number;
  completionRate: number;  // Tasks/minute
  failureRate: number;     // % of attempted that failed

  // Retries
  totalRetries: number;
  avgRetriesPerTask: number;

  // Timing
  elapsedMs: number;
  avgTaskDurationMs: number;
  estimatedRemainingMs: number;

  // Drift
  driftChecks: number;
  driftCorrections: number;
  lastDriftSeverity?: string;
}
```

## Parallel Domain Execution

For large campaigns, work can be split across independent domains:

```typescript
import {
  ParallelOrchestrator,
  runDomainsInParallel,
  createParallelConfig,
  type ParallelOrchestratorOptions
} from './parallel-orchestrator';

import {
  createDomainQueue,
  createMultiDomainQueue,
  getNextTaskForDomain,
  getDomainsWithWork
} from './campaign-queue';

// Define domains
const domains = [
  { name: 'frontend', tasks: frontendTasks },
  { name: 'backend', tasks: backendTasks },
  { name: 'infrastructure', tasks: infraTasks }
];

// Create multi-domain queue
const multiQueue = createMultiDomainQueue(domains);

// Get domains with available work
const availableDomains = getDomainsWithWork(multiQueue, tasks);
```

### Git Branch Strategy

```typescript
import {
  createDomainBranch,
  switchToDomainBranch,
  mergeDomainsToCampaign,
  detectDomainConflicts
} from './campaign-git';

// Create domain-specific branches
await createDomainBranch(cwd, campaignId, 'frontend');
await createDomainBranch(cwd, campaignId, 'backend');

// Detect conflicts before merging
const conflicts = await detectDomainConflicts(cwd, campaignId, ['frontend', 'backend']);
if (conflicts.length > 0) {
  console.log('Conflicts detected:', conflicts);
}

// Merge domains back to campaign branch
await mergeDomainsToCampaign(cwd, campaignId, ['frontend', 'backend']);
```

## Task Reflection

Independent assessment of task completion:

```typescript
import {
  TaskReflector,
  createReflector,
  assessTask
} from './task-reflector';

// Create reflector
const reflector = createReflector({ cwd });

// Assess a task independently
const assessment = await assessTask(reflector, task, {
  validateExitCriteria: true,
  checkForRegressions: true
});

if (!assessment.passed) {
  console.log(`Task failed: ${assessment.failureClassification}`);
  console.log(`Recommendation: ${assessment.recommendation}`);
}
```

## Criteria Validation

Validate entry and exit criteria for tasks:

```typescript
import {
  validateCriteria,
  canTaskStart,
  createTypescriptCompileCriterion,
  createTestsCriterion,
  createFileExistsCriterion
} from './campaign-validation';

// Define criteria
const exitCriteria = [
  createTypescriptCompileCriterion(),
  createTestsCriterion('bun test'),
  createFileExistsCriterion('src/auth/index.ts')
];

// Validate all criteria
const results = await validateCriteria(exitCriteria, { cwd });

// Check if task can start (dependencies met)
const canStart = await canTaskStart(task, state.tasks, { cwd });
```

## Database Persistence

Campaign data can be persisted to SQLite for querying:

```typescript
import {
  upsertCampaignProject,
  upsertCampaignTasks,
  getCampaignMetrics,
  getTasksByStatus
} from './campaign-db';

// Persist campaign
await upsertCampaignProject(state);
await upsertCampaignTasks(state.campaignId, state.tasks);

// Query metrics
const metrics = await getCampaignMetrics(state.campaignId);

// Get tasks by status
const failedTasks = await getTasksByStatus(state.campaignId, 'failed');
```

## File Structure

```
src/orchestrator/campaign/
├── index.ts                    # Public API exports
├── campaign-engine.ts          # Main orchestration engine
├── campaign-state.ts           # State management
├── campaign-queue.ts           # Task queue with dependencies
├── campaign-planner.ts         # Planner agent integration
├── campaign-worker.ts          # Worker agent execution
├── campaign-checkpoint.ts      # Checkpoint save/load/resume
├── campaign-drift.ts           # Drift detection
├── campaign-metrics.ts         # Metrics collection
├── campaign-validation.ts      # Entry/exit criteria
├── campaign-git.ts             # Git branch management
├── campaign-db.ts              # SQLite persistence
├── campaign-types.ts           # Enhanced type definitions
├── campaign-schema.ts          # JSON schema validation
├── campaign-defaults.ts        # Default configuration
├── campaign-agent.ts           # Agent spec parsing
├── campaign-repo-map.ts        # Repository mapping
├── task-reflector.ts           # Independent task assessment
├── parallel-orchestrator.ts    # Parallel domain execution
└── *.test.ts                   # Test files
```

## Configuration Defaults

```typescript
import { CAMPAIGN_DEFAULTS } from './campaign-defaults';

// Default configuration
{
  planner: 'claude',
  subPlanner: 'claude',
  workers: ['claude'],
  maxWorkers: 1,
  checkpointEvery: 5,      // Tasks between checkpoints
  freshStartEvery: 10,     // Tasks before context refresh
  autonomy: 'auto',        // 'auto' | 'checkpoint'
  gitMode: 'campaign-branch',
  mergeStrategy: 'merge',
  useDroid: false
}
```

## Error Handling

The campaign system uses typed errors for different failure modes:

```typescript
// State version conflicts (optimistic locking)
try {
  await saveCampaignState(stateFile, state, expectedVersion);
} catch (err) {
  if (err.message.includes('version conflict')) {
    // Another process modified state
  }
}

// Task execution errors
if (task.status === 'failed') {
  console.log(`Task failed: ${task.lastError}`);
  console.log(`Attempts: ${task.attempts}`);
}

// Drift correction application
const result = applyCorrectivePlan(state, plan);
console.log(`Applied: ${result.added} added, ${result.modified} modified`);
```

## Best Practices

1. **Checkpoint frequently** - Use `checkpointEvery: 3-5` for large campaigns
2. **Enable drift detection** - Check at milestones to catch divergence early
3. **Use domain isolation** - Split independent work streams into domains
4. **Monitor metrics** - Track failure rates and stuck tasks
5. **Validate criteria** - Define clear entry/exit criteria for tasks
6. **Use optimistic locking** - Always pass expected version when saving state
