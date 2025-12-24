/**
 * CLI Commands for Task Management
 *
 * Provides /tasks command for listing, viewing, and managing background tasks.
 */

import chalk from 'chalk';
import {
  listTasks,
  getTask,
  getTaskOutput,
  killTask,
  deleteTask,
  clearCompletedTasks,
  getTaskCounts
} from '../../tasks';
import type { TaskStatus } from '../../tasks/types';

/**
 * Format duration for display
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

/**
 * Format timestamp for display
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString();
}

/**
 * Get status color
 */
function statusColor(status: TaskStatus): (text: string) => string {
  switch (status) {
    case 'running': return chalk.blue;
    case 'completed': return chalk.green;
    case 'failed': return chalk.red;
    case 'cancelled': return chalk.yellow;
    case 'pending': return chalk.gray;
    default: return chalk.white;
  }
}

/**
 * Get status icon
 */
function statusIcon(status: TaskStatus): string {
  switch (status) {
    case 'running': return '⟳';
    case 'completed': return '✓';
    case 'failed': return '✗';
    case 'cancelled': return '⊘';
    case 'pending': return '○';
    default: return '?';
  }
}

/**
 * List all tasks
 */
export async function tasksListCommand(options: { status?: string; type?: string; limit?: number }): Promise<void> {
  const filter: { status?: TaskStatus } = {};

  if (options.status) {
    filter.status = options.status as TaskStatus;
  }

  const tasks = listTasks(filter);
  const limit = options.limit || 20;
  const displayTasks = tasks.slice(0, limit);

  if (displayTasks.length === 0) {
    console.log(chalk.gray('No tasks found'));
    return;
  }

  // Print header
  console.log(chalk.bold('\nTasks:\n'));
  console.log(chalk.gray('  ID                      Status     Type    Description'));
  console.log(chalk.gray('  ─'.repeat(35)));

  for (const task of displayTasks) {
    const icon = statusIcon(task.status);
    const color = statusColor(task.status);
    const duration = task.duration ? chalk.gray(` (${formatDuration(task.duration)})`) : '';
    const agent = task.agent ? chalk.cyan(`[${task.agent}]`) : '';

    console.log(
      `  ${chalk.dim(task.id.slice(0, 20))}  ` +
      `${color(`${icon} ${task.status.padEnd(10)}`)}  ` +
      `${task.type.padEnd(6)}  ` +
      `${task.description.slice(0, 30)}${duration} ${agent}`
    );
  }

  if (tasks.length > limit) {
    console.log(chalk.gray(`\n  ... and ${tasks.length - limit} more tasks`));
  }

  // Print summary
  const counts = getTaskCounts();
  console.log('\n' + chalk.gray(
    `  Running: ${counts.running} | Pending: ${counts.pending} | ` +
    `Completed: ${counts.completed} | Failed: ${counts.failed}`
  ));
}

/**
 * Show task details
 */
export async function tasksShowCommand(taskId: string): Promise<void> {
  const task = getTask(taskId);

  if (!task) {
    console.log(chalk.red(`Task not found: ${taskId}`));
    return;
  }

  const color = statusColor(task.status);

  console.log(chalk.bold('\nTask Details:\n'));
  console.log(`  ID:          ${task.id}`);
  console.log(`  Status:      ${color(task.status)}`);
  console.log(`  Type:        ${task.type}`);
  console.log(`  Description: ${task.description}`);
  console.log(`  Agent:       ${task.agent || 'auto'}`);
  console.log(`  Model:       ${task.model || '(default)'}`);
  console.log(`  CWD:         ${task.cwd}`);
  console.log(`  Created:     ${formatTime(task.createdAt)}`);

  if (task.startedAt) {
    console.log(`  Started:     ${formatTime(task.startedAt)}`);
  }

  if (task.completedAt) {
    console.log(`  Completed:   ${formatTime(task.completedAt)}`);
    const duration = task.completedAt - (task.startedAt || task.createdAt);
    console.log(`  Duration:    ${formatDuration(duration)}`);
  }

  if (task.parentTaskId) {
    console.log(`  Resumed From: ${task.parentTaskId}`);
  }

  if (task.result) {
    console.log('\n' + chalk.bold('Result:'));
    if (task.result.error) {
      console.log(chalk.red(`  Error: ${task.result.error}`));
    }
    if (task.result.iterations) {
      console.log(`  Iterations: ${task.result.iterations}`);
    }
    if (task.result.tokens) {
      console.log(`  Tokens: ${task.result.tokens.input} in / ${task.result.tokens.output} out`);
    }
    if (task.result.toolCalls?.length) {
      console.log(`  Tool Calls: ${task.result.toolCalls.length}`);
    }
  }

  // Show prompt
  console.log('\n' + chalk.bold('Prompt:'));
  console.log(chalk.gray(task.prompt.slice(0, 200) + (task.prompt.length > 200 ? '...' : '')));

  // Show output preview
  if (task.output) {
    console.log('\n' + chalk.bold('Output Preview:'));
    const preview = task.output.slice(0, 500);
    console.log(chalk.gray(preview + (task.output.length > 500 ? '...' : '')));
  }
}

/**
 * Get task output
 */
export async function tasksOutputCommand(taskId: string, options: { wait?: boolean }): Promise<void> {
  try {
    const output = await getTaskOutput({
      taskId,
      block: options.wait ?? false,
      timeout: 30000
    });

    console.log(chalk.bold('\nTask Output:\n'));
    console.log(`Status: ${statusColor(output.status)(output.status)}`);
    console.log(`Duration: ${formatDuration(output.duration)}`);
    console.log('\n' + chalk.gray('─'.repeat(60)) + '\n');
    console.log(output.output || chalk.gray('(no output)'));

    if (output.result?.error) {
      console.log('\n' + chalk.red(`Error: ${output.result.error}`));
    }
  } catch (err) {
    console.log(chalk.red((err as Error).message));
  }
}

/**
 * Kill a running task
 */
export async function tasksKillCommand(taskId: string): Promise<void> {
  const task = getTask(taskId);

  if (!task) {
    console.log(chalk.red(`Task not found: ${taskId}`));
    return;
  }

  if (task.status !== 'running' && task.status !== 'pending') {
    console.log(chalk.yellow(`Task is not running (status: ${task.status})`));
    return;
  }

  const killed = killTask(taskId);

  if (killed) {
    console.log(chalk.green(`Task ${taskId} killed`));
  } else {
    console.log(chalk.red(`Failed to kill task ${taskId}`));
  }
}

/**
 * Delete a task
 */
export async function tasksDeleteCommand(taskId: string): Promise<void> {
  const deleted = deleteTask(taskId);

  if (deleted) {
    console.log(chalk.green(`Task ${taskId} deleted`));
  } else {
    console.log(chalk.red(`Task not found: ${taskId}`));
  }
}

/**
 * Clear completed tasks
 */
export async function tasksClearCommand(): Promise<void> {
  const cleared = clearCompletedTasks();
  console.log(chalk.green(`Cleared ${cleared} completed tasks`));
}

/**
 * Main tasks command dispatcher
 */
export async function tasksCommand(
  action?: string,
  target?: string,
  options: {
    status?: string;
    type?: string;
    limit?: number;
    wait?: boolean;
  } = {}
): Promise<void> {
  switch (action) {
    case 'list':
    case undefined:
      await tasksListCommand(options);
      break;

    case 'show':
    case 'get':
      if (!target) {
        console.log(chalk.red('Please provide a task ID'));
        return;
      }
      await tasksShowCommand(target);
      break;

    case 'output':
      if (!target) {
        console.log(chalk.red('Please provide a task ID'));
        return;
      }
      await tasksOutputCommand(target, options);
      break;

    case 'kill':
    case 'cancel':
      if (!target) {
        console.log(chalk.red('Please provide a task ID'));
        return;
      }
      await tasksKillCommand(target);
      break;

    case 'delete':
    case 'rm':
      if (!target) {
        console.log(chalk.red('Please provide a task ID'));
        return;
      }
      await tasksDeleteCommand(target);
      break;

    case 'clear':
      await tasksClearCommand();
      break;

    default:
      console.log(chalk.yellow(`Unknown action: ${action}`));
      console.log('\nUsage: tasks [action] [target]');
      console.log('\nActions:');
      console.log('  list [--status <status>]  List all tasks');
      console.log('  show <task-id>            Show task details');
      console.log('  output <task-id> [--wait] Get task output');
      console.log('  kill <task-id>            Kill a running task');
      console.log('  delete <task-id>          Delete a task');
      console.log('  clear                     Clear completed tasks');
  }
}
