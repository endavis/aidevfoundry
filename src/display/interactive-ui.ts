/**
 * Interactive Mode UI Components
 *
 * Provides polished terminal UI for interactive sessions with
 * a tactical dashboard aesthetic using double-line borders.
 */

import pc from 'picocolors';
import figlet from 'figlet';
import chalk from 'chalk';

// Double-line box characters (tactical/mainframe aesthetic)
const BOX = {
  topLeft: '╔',
  topRight: '╗',
  bottomLeft: '╚',
  bottomRight: '╝',
  horizontal: '═',
  vertical: '║',
  teeDown: '╦',
  teeUp: '╩',
  teeRight: '╠',
  teeLeft: '╣',
  cross: '╬',
  leftTee: '╠',
  rightTee: '╣',
};

// Status symbols
const STATUS = {
  pending: pc.dim('[○]'),
  running: pc.cyan('[●]'),
  completed: pc.green('[✓]'),
  failed: pc.red('[✗]'),
  timeout: pc.yellow('[⏱]'),
};

/**
 * Render PK-puzld ASCII art banner with colors
 * Uses figlet with Small font for compact side-by-side display
 */
export async function renderBanner(): Promise<string[]> {
  // Generate ASCII art for PK and puzld side-by-side
  const pkArt = figlet.textSync('PK', { font: 'Small', horizontalLayout: 'full' });
  const puzldArt = figlet.textSync('puzld', { font: 'Small', horizontalLayout: 'full' });

  // Split into lines
  const pkLines = pkArt.split('\n');
  const puzldLines = puzldArt.split('\n');

  // Ensure both arrays have the same length by padding shorter one
  const maxLines = Math.max(pkLines.length, puzldLines.length);
  while (pkLines.length < maxLines) pkLines.push('');
  while (puzldLines.length < maxLines) puzldLines.push('');

  // Interleave lines side-by-side: PK in white, puzld in red
  const lines: string[] = [];
  for (let i = 0; i < maxLines; i++) {
    const pkLine = pkLines[i].padEnd(pkLines.reduce((w, l) => Math.max(w, l.length), 0));
    const puzldLine = puzldLines[i];
    lines.push(chalk.white(pkLine) + '  ' + chalk.red(puzldLine));
  }

  return lines;
}

/**
 * Render session header with full configuration
 */
export function renderSessionHeader(config: {
  agent: string;
  responder: string;
  maxInteractions: number;
  timeout: number;
  prompt: string;
}): string[] {
  const termWidth = Math.min(process.stdout.columns || 80, 100);
  const boxWidth = termWidth - 2;

  const lines: string[] = [];

  // Main header border
  lines.push(BOX.topLeft + BOX.horizontal.repeat(boxWidth - 2) + BOX.topRight);

  // Title line
  const title = pc.bold(pc.cyan('  INTERACTIVE SESSION  '));
  const titlePad = Math.floor((boxWidth - 2 - stripAnsi(title).length) / 2);
  lines.push(
    BOX.vertical +
    ' '.repeat(titlePad) +
    title +
    ' '.repeat(boxWidth - 2 - titlePad - stripAnsi(title).length) +
    BOX.vertical
  );

  // Separator
  lines.push(BOX.leftTee + BOX.horizontal.repeat(boxWidth - 2) + BOX.rightTee);

  // Configuration grid
  const configs = [
    { label: 'Agent', value: pc.bold(config.agent) },
    { label: 'Responder', value: pc.bold(config.responder) },
    { label: 'Max Iterations', value: pc.bold(String(config.maxInteractions)) },
    { label: 'Timeout', value: pc.bold(formatDuration(config.timeout)) },
  ];

  const colWidth = Math.floor((boxWidth - 2) / 2) - 2;
  for (let i = 0; i < configs.length; i += 2) {
    const left = configs[i];
    const right = configs[i + 1];

    const leftLine = pc.dim(left.label) + ': ' + left.value;
    const rightLine = right ? pc.dim(right.label) + ': ' + right.value : '';

    lines.push(
      BOX.vertical +
      '  ' +
      truncate(leftLine, colWidth) +
      ' '.repeat(Math.max(0, colWidth - stripAnsi(leftLine).length)) +
      '  ' +
      truncate(rightLine, colWidth) +
      ' '.repeat(Math.max(0, colWidth - stripAnsi(rightLine).length)) +
      '  ' +
      BOX.vertical
    );
  }

  // Separator
  lines.push(BOX.leftTee + BOX.horizontal.repeat(boxWidth - 2) + BOX.rightTee);

  // Initial prompt (truncated)
  const promptLabel = pc.dim('Initial Prompt:');
  const promptText = truncate(config.prompt, boxWidth - 8);
  lines.push(BOX.vertical + '  ' + promptLabel + ' ' + pc.white(promptText) + BOX.vertical);

  // Bottom border
  lines.push(BOX.bottomLeft + BOX.horizontal.repeat(boxWidth - 2) + BOX.bottomRight);

  return lines;
}

/**
 * Render session status panel
 */
export function renderStatusPanel(state: string, interaction: number, maxInteractions: number): string[] {
  const termWidth = Math.min(process.stdout.columns || 80, 100);
  const boxWidth = Math.min(termWidth - 2, 80);
  const innerWidth = boxWidth - 4;

  const lines: string[] = [];

  // Top
  lines.push(BOX.topLeft + BOX.horizontal.repeat(innerWidth) + BOX.topRight);

  // Status line with progress bar
  const stateLabel = pc.dim('Status:');
  let stateIcon: string;
  let stateText: string;

  switch (state) {
    case 'running':
      stateIcon = STATUS.running;
      stateText = pc.cyan('Waiting for prompt...');
      break;
    case 'responding':
      stateIcon = STATUS.running;
      stateText = pc.cyan('Generating response...');
      break;
    case 'waiting_for_input':
      stateIcon = STATUS.running;
      stateText = pc.yellow('Awaiting input...');
      break;
    case 'completed':
      stateIcon = STATUS.completed;
      stateText = pc.green('Session complete');
      break;
    case 'timeout':
      stateIcon = STATUS.timeout;
      stateText = pc.yellow('Session timed out');
      break;
    case 'failed':
      stateIcon = STATUS.failed;
      stateText = pc.red('Session failed');
      break;
    default:
      stateIcon = STATUS.pending;
      stateText = pc.dim(state);
  }

  lines.push(BOX.vertical + '  ' + stateLabel + ' ' + stateIcon + ' ' + truncate(stateText, innerWidth - 15) + BOX.vertical);

  // Progress bar
  const progressLabel = pc.dim('Progress:');
  const progressBar = createProgressBar(interaction, maxInteractions, innerWidth - 15);
  lines.push(BOX.vertical + '  ' + progressLabel + ' ' + progressBar + BOX.vertical);

  // Bottom
  lines.push(BOX.bottomLeft + BOX.horizontal.repeat(innerWidth) + BOX.bottomRight);

  return lines;
}

/**
 * Render an interaction with polished formatting
 */
export function renderInteraction(
  index: number,
  maxInteractions: number,
  prompt: { type: string; text: string },
  response: { response: string; reasoning?: string }
): string[] {
  const termWidth = Math.min(process.stdout.columns || 80, 100);
  const boxWidth = Math.min(termWidth - 2, 90);
  const innerWidth = boxWidth - 4;

  const lines: string[] = [];

  // Header with interaction number
  const progress = pc.dim(`[${index}/${maxInteractions}]`);
  const header = pc.bold(pc.cyan(' INCOMING ')) + pc.dim(prompt.type.toUpperCase());
  lines.push('');
  lines.push(progress + ' ' + header);
  lines.push(pc.dim('─'.repeat(Math.min(50, boxWidth))));

  // Prompt content
  const promptLines = wrapText(prompt.text, innerWidth - 2);
  for (const line of promptLines) {
    lines.push(pc.yellow('  ' + line));
  }

  lines.push('');

  // Response header
  lines.push(pc.green('  Response:'));

  // Response content
  const responseLines = wrapText(response.response, innerWidth - 4);
  for (const line of responseLines) {
    lines.push(pc.white('    ' + line));
  }

  // Reasoning if verbose
  if (response.reasoning) {
    lines.push('');
    lines.push(pc.dim('    Reasoning:'));
    const reasonLines = wrapText(response.reasoning, innerWidth - 6);
    for (const line of reasonLines) {
      lines.push(pc.dim('      ' + line));
    }
  }

  lines.push(pc.dim('─'.repeat(Math.min(50, boxWidth))));

  return lines;
}

/**
 * Render session summary with statistics
 */
export function renderSessionSummary(result: {
  success: boolean;
  state: string;
  interactions: number;
  duration: number;
  error?: string;
}): string[] {
  const termWidth = Math.min(process.stdout.columns || 80, 100);
  const boxWidth = Math.min(termWidth - 2, 70);
  const innerWidth = boxWidth - 4;

  const lines: string[] = [];

  lines.push('');
  lines.push(pc.dim('═'.repeat(Math.min(50, boxWidth))));
  lines.push('');

  // Summary header
  const statusIcon = result.success ? pc.green('✓') : pc.red('✗');
  const statusText = result.success ? pc.green('SESSION COMPLETE') : pc.red('SESSION FAILED');
  lines.push('  ' + statusIcon + ' ' + pc.bold(statusText));
  lines.push('');

  // Stats grid
  const stats = [
    { label: 'Status', value: result.success ? pc.green('Success') : pc.red('Failed') },
    { label: 'State', value: pc.dim(result.state) },
    { label: 'Interactions', value: pc.bold(String(result.interactions)) },
    { label: 'Duration', value: pc.bold(formatDuration(result.duration)) },
  ];

  const colWidth = Math.floor((innerWidth - 4) / 2) - 2;
  for (let i = 0; i < stats.length; i += 2) {
    const left = stats[i];
    const right = stats[i + 1];

    const leftLine = pc.dim(left.label) + ': ' + left.value;
    const rightLine = right ? pc.dim(right.label) + ': ' + right.value : '';

    lines.push(
      '  ' +
      truncate(leftLine, colWidth) +
      ' '.repeat(Math.max(0, colWidth - stripAnsi(leftLine).length)) +
      '  ' +
      truncate(rightLine, colWidth)
    );
  }

  // Error if any
  if (result.error) {
    lines.push('');
    lines.push(pc.red('  Error:'));
    const errorLines = wrapText(result.error, innerWidth - 6);
    for (const line of errorLines) {
      lines.push(pc.red('    ' + line));
    }
  }

  lines.push('');
  lines.push(pc.dim('═'.repeat(Math.min(50, boxWidth))));
  lines.push('');

  return lines;
}

/**
 * Render interaction history summary
 */
export function renderHistorySummary(history: Array<{ prompt: { type: string }; response: { response: string } }>): string[] {
  if (history.length === 0) return [];

  const lines: string[] = [];
  lines.push(pc.dim(''));
  lines.push(pc.dim('Interaction History:'));
  lines.push(pc.dim('─'.repeat(30)));

  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    const num = pc.dim(String(i + 1).padStart(2, ' '));
    const type = pc.cyan(`[${h.prompt.type}]`);
    const response = truncate(h.response.response, 50);
    lines.push(num + '  ' + type + ' ' + pc.white(response));
  }

  return lines;
}

/**
 * Create a progress bar with filled/empty blocks
 */
export function createProgressBar(completed: number, total: number, width = 20): string {
  const percent = total > 0 ? completed / total : 0;
  const filled = Math.round(percent * width);
  const empty = width - filled;

  const bar = pc.cyan('▓'.repeat(filled)) + pc.dim('░'.repeat(empty));
  const pct = Math.round(percent * 100);

  return `${bar} ${pct}%`;
}

/**
 * Format duration in human-readable format
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Truncate text to fit width
 */
export function truncate(text: string, maxWidth: number): string {
  const stripped = stripAnsi(text);
  if (stripped.length <= maxWidth) return text;
  return text.slice(0, maxWidth - 3) + '...';
}

/**
 * Wrap text to specified width
 */
export function wrapText(text: string, width: number): string[] {
  if (!text) return [''];
  const lines: string[] = [];
  const paragraphs = text.split('\n');

  for (const para of paragraphs) {
    if (para.length <= width) {
      lines.push(para);
    } else {
      let remaining = para;
      while (remaining.length > 0) {
        if (remaining.length <= width) {
          lines.push(remaining);
          break;
        }
        let breakPoint = remaining.lastIndexOf(' ', width);
        if (breakPoint === -1 || breakPoint === 0) breakPoint = width;
        lines.push(remaining.slice(0, breakPoint));
        remaining = remaining.slice(breakPoint).trimStart();
      }
    }
  }

  return lines.length > 0 ? lines : [''];
}

/**
 * Strip ANSI escape codes from text
 */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Print a section divider
 */
export function printDivider(char = '─', length = 50): void {
  console.log(pc.dim(char.repeat(Math.min(length, process.stdout.columns || 80))));
}

/**
 * Print a blank line
 */
export function printSpacer(lines = 1): void {
  for (let i = 0; i < lines; i++) {
    console.log('');
  }
}
