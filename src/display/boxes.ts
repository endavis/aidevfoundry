/**
 * Box drawing utilities for CLI output
 *
 * Displays agent responses in side-by-side or stacked boxes
 */

import pc from 'picocolors';

export interface ResponseData {
  agent: string;
  content: string;
  error?: string;
  model?: string;
  duration?: number;
}

// Box drawing characters
const BOX = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
  teeDown: '┬',
  teeUp: '┴',
  teeRight: '├',
  teeLeft: '┤',
  cross: '┼'
};

/**
 * Draw compare results in boxes
 */
export function drawCompareBoxes(
  responses: ResponseData[],
  _prompt: string
): void {
  const termWidth = process.stdout.columns || 80;

  // Decide layout: side-by-side if 2 agents and wide terminal, else stacked
  const sideBySide = responses.length === 2 && termWidth >= 100;

  if (sideBySide) {
    drawSideBySide(responses, termWidth);
  } else {
    drawStacked(responses, termWidth);
  }
}

/**
 * Draw two responses side by side
 */
function drawSideBySide(responses: ResponseData[], termWidth: number): void {
  const boxWidth = Math.floor((termWidth - 3) / 2);
  const contentWidth = boxWidth - 4;

  const left = responses[0];
  const right = responses[1];

  const leftLines = wrapText(left.error || left.content, contentWidth);
  const rightLines = wrapText(right.error || right.content, contentWidth);

  const maxLines = Math.max(leftLines.length, rightLines.length);

  while (leftLines.length < maxLines) leftLines.push('');
  while (rightLines.length < maxLines) rightLines.push('');

  const leftHeader = formatHeader(left, boxWidth);
  const rightHeader = formatHeader(right, boxWidth);

  console.log(
    BOX.topLeft + BOX.horizontal.repeat(boxWidth - 2) + BOX.topRight + ' ' +
    BOX.topLeft + BOX.horizontal.repeat(boxWidth - 2) + BOX.topRight
  );

  console.log(
    BOX.vertical + leftHeader + BOX.vertical + ' ' +
    BOX.vertical + rightHeader + BOX.vertical
  );

  console.log(
    BOX.teeRight + BOX.horizontal.repeat(boxWidth - 2) + BOX.teeLeft + ' ' +
    BOX.teeRight + BOX.horizontal.repeat(boxWidth - 2) + BOX.teeLeft
  );

  for (let i = 0; i < maxLines; i++) {
    const leftContent = padRight(leftLines[i], contentWidth);
    const rightContent = padRight(rightLines[i], contentWidth);

    const leftColor = left.error ? pc.red(leftContent) : leftContent;
    const rightColor = right.error ? pc.red(rightContent) : rightContent;

    console.log(
      BOX.vertical + ' ' + leftColor + ' ' + BOX.vertical + ' ' +
      BOX.vertical + ' ' + rightColor + ' ' + BOX.vertical
    );
  }

  const leftFooter = formatFooter(left, boxWidth);
  const rightFooter = formatFooter(right, boxWidth);

  console.log(
    BOX.teeRight + BOX.horizontal.repeat(boxWidth - 2) + BOX.teeLeft + ' ' +
    BOX.teeRight + BOX.horizontal.repeat(boxWidth - 2) + BOX.teeLeft
  );

  console.log(
    BOX.vertical + leftFooter + BOX.vertical + ' ' +
    BOX.vertical + rightFooter + BOX.vertical
  );

  console.log(
    BOX.bottomLeft + BOX.horizontal.repeat(boxWidth - 2) + BOX.bottomRight + ' ' +
    BOX.bottomLeft + BOX.horizontal.repeat(boxWidth - 2) + BOX.bottomRight
  );
}

/**
 * Draw responses stacked vertically
 */
function drawStacked(responses: ResponseData[], termWidth: number): void {
  const boxWidth = Math.min(termWidth - 2, 100);
  const contentWidth = boxWidth - 4;

  for (const response of responses) {
    const lines = wrapText(response.error || response.content, contentWidth);

    console.log(BOX.topLeft + BOX.horizontal.repeat(boxWidth - 2) + BOX.topRight);
    console.log(BOX.vertical + formatHeader(response, boxWidth) + BOX.vertical);
    console.log(BOX.teeRight + BOX.horizontal.repeat(boxWidth - 2) + BOX.teeLeft);

    for (const line of lines) {
      const content = padRight(line, contentWidth);
      const colored = response.error ? pc.red(content) : content;
      console.log(BOX.vertical + ' ' + colored + ' ' + BOX.vertical);
    }

    console.log(BOX.teeRight + BOX.horizontal.repeat(boxWidth - 2) + BOX.teeLeft);
    console.log(BOX.vertical + formatFooter(response, boxWidth) + BOX.vertical);
    console.log(BOX.bottomLeft + BOX.horizontal.repeat(boxWidth - 2) + BOX.bottomRight);

    console.log();
  }
}

function formatHeader(response: ResponseData, boxWidth: number): string {
  const agent = response.agent.toUpperCase();
  const status = response.error ? pc.red(' [FAILED]') : pc.green(' [OK]');
  const header = ` ${agent}${status}`;
  const plainLength = 1 + agent.length + (response.error ? 9 : 5);
  const padding = boxWidth - 2 - plainLength;
  return header + ' '.repeat(Math.max(0, padding));
}

function formatFooter(response: ResponseData, boxWidth: number): string {
  const parts: string[] = [];
  if (response.model) parts.push(response.model);
  if (response.duration) parts.push(`${(response.duration / 1000).toFixed(1)}s`);
  const footer = parts.length > 0 ? ` ${parts.join(' | ')} ` : ' ';
  const padding = boxWidth - 2 - footer.length;
  return footer + ' '.repeat(Math.max(0, padding));
}

function wrapText(text: string, width: number): string[] {
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

function padRight(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  return str + ' '.repeat(width - str.length);
}
