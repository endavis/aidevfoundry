/**
 * ASCII Table Rendering
 *
 * Detects markdown tables and renders them as pretty ASCII tables.
 */

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
  cross: '┼',
};

export interface TableCell {
  content: string;
  align: 'left' | 'center' | 'right';
}

export interface ParsedTable {
  headers: TableCell[];
  rows: TableCell[][];
  alignments: ('left' | 'center' | 'right')[];
}

/**
 * Detect if text contains a markdown table
 */
export function hasMarkdownTable(text: string): boolean {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (isTableRow(lines[i]) && isAlignmentRow(lines[i + 1])) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a line is a table row
 */
function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.split('|').length >= 3;
}

/**
 * Check if a line is an alignment row (|---|---|)
 */
function isAlignmentRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return false;
  const cells = trimmed.split('|').slice(1, -1);
  return cells.every(cell => /^[\s:]*-+[\s:]*$/.test(cell));
}

/**
 * Parse alignment from alignment row cell
 */
function parseAlignment(cell: string): 'left' | 'center' | 'right' {
  const trimmed = cell.trim();
  const hasLeftColon = trimmed.startsWith(':');
  const hasRightColon = trimmed.endsWith(':');

  if (hasLeftColon && hasRightColon) return 'center';
  if (hasRightColon) return 'right';
  return 'left';
}

/**
 * Parse a markdown table from text
 */
export function parseMarkdownTable(text: string): ParsedTable | null {
  const lines = text.split('\n');

  // Find table start
  let startIdx = -1;
  for (let i = 0; i < lines.length - 1; i++) {
    if (isTableRow(lines[i]) && isAlignmentRow(lines[i + 1])) {
      startIdx = i;
      break;
    }
  }

  if (startIdx === -1) return null;

  // Parse header row
  const headerLine = lines[startIdx];
  const headerCells = headerLine.split('|').slice(1, -1).map(c => c.trim());

  // Parse alignment row
  const alignLine = lines[startIdx + 1];
  const alignCells = alignLine.split('|').slice(1, -1);
  const alignments = alignCells.map(parseAlignment);

  // Parse data rows
  const rows: TableCell[][] = [];
  for (let i = startIdx + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!isTableRow(line)) break;

    const cells = line.split('|').slice(1, -1).map((c, idx) => ({
      content: c.trim(),
      align: alignments[idx] || 'left',
    }));
    rows.push(cells);
  }

  const headers = headerCells.map((content, idx) => ({
    content,
    align: alignments[idx] || 'left',
  }));

  return { headers, rows, alignments };
}

/**
 * Render a parsed table as ASCII
 */
export function renderTable(table: ParsedTable): string {
  const { headers, rows } = table;
  const colCount = headers.length;

  // Calculate column widths
  const widths: number[] = headers.map(h => h.content.length);
  for (const row of rows) {
    for (let i = 0; i < colCount; i++) {
      if (row[i]) {
        widths[i] = Math.max(widths[i], row[i].content.length);
      }
    }
  }

  // Add padding
  const paddedWidths = widths.map(w => w + 2);

  // Build output
  const lines: string[] = [];

  // Top border
  lines.push(
    BOX.topLeft +
    paddedWidths.map(w => BOX.horizontal.repeat(w)).join(BOX.teeDown) +
    BOX.topRight
  );

  // Header row
  const headerRow = headers.map((h, i) => {
    return alignCell(h.content, paddedWidths[i], h.align);
  });
  lines.push(BOX.vertical + headerRow.join(BOX.vertical) + BOX.vertical);

  // Header separator
  lines.push(
    BOX.teeRight +
    paddedWidths.map(w => BOX.horizontal.repeat(w)).join(BOX.cross) +
    BOX.teeLeft
  );

  // Data rows
  for (const row of rows) {
    const cells = paddedWidths.map((w, i) => {
      const cell = row[i];
      if (!cell) return ' '.repeat(w);
      return alignCell(cell.content, w, cell.align);
    });
    lines.push(BOX.vertical + cells.join(BOX.vertical) + BOX.vertical);
  }

  // Bottom border
  lines.push(
    BOX.bottomLeft +
    paddedWidths.map(w => BOX.horizontal.repeat(w)).join(BOX.teeUp) +
    BOX.bottomRight
  );

  return lines.join('\n');
}

/**
 * Align cell content within width
 */
function alignCell(content: string, width: number, align: 'left' | 'center' | 'right'): string {
  const padding = width - content.length;
  if (padding <= 0) return content.slice(0, width);

  switch (align) {
    case 'right':
      return ' '.repeat(padding - 1) + content + ' ';
    case 'center': {
      const left = Math.floor((padding - 1) / 2);
      const right = padding - left - 1;
      return ' '.repeat(left + 1) + content + ' '.repeat(right);
    }
    default:
      return ' ' + content + ' '.repeat(padding - 1);
  }
}

/**
 * Transform markdown tables in text to ASCII tables
 */
export function transformTables(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    // Check for table start
    if (i < lines.length - 1 && isTableRow(lines[i]) && isAlignmentRow(lines[i + 1])) {
      // Extract table lines
      const tableLines: string[] = [lines[i], lines[i + 1]];
      i += 2;

      while (i < lines.length && isTableRow(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }

      // Parse and render table
      const table = parseMarkdownTable(tableLines.join('\n'));
      if (table) {
        result.push(renderTable(table));
      } else {
        result.push(...tableLines);
      }
    } else {
      result.push(lines[i]);
      i++;
    }
  }

  return result.join('\n');
}

/**
 * Simple table creation helper
 */
export function createTable(headers: string[], rows: string[][]): string {
  const table: ParsedTable = {
    headers: headers.map(h => ({ content: h, align: 'left' as const })),
    rows: rows.map(row => row.map(c => ({ content: c, align: 'left' as const }))),
    alignments: headers.map(() => 'left' as const),
  };
  return renderTable(table);
}
