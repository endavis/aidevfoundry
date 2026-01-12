/**
 * Attach Command
 *
 * Magic attach for PDFs and URLs.
 * Usage: pk-puzldai attach <file.pdf|url>
 */

import { readFile, stat } from 'fs/promises';
import { basename, extname } from 'path';
import pc from 'picocolors';

interface AttachOptions {
  preview?: boolean;
  maxLength?: number;
}

interface AttachmentResult {
  type: 'pdf' | 'url' | 'file';
  source: string;
  content: string;
  preview: string;
  metadata: Record<string, unknown>;
}

/**
 * Attach command handler
 */
export async function attachCommand(
  target: string,
  options: AttachOptions
): Promise<void> {
  if (!target) {
    console.log(pc.yellow('Usage: pk-puzldai attach <file.pdf|url|file>'));
    console.log('');
    console.log('Examples:');
    console.log('  pk-puzldai attach document.pdf');
    console.log('  pk-puzldai attach https://example.com/page');
    console.log('  pk-puzldai attach ./src/file.ts');
    return;
  }

  try {
    let result: AttachmentResult;

    if (isUrl(target)) {
      result = await attachUrl(target, options);
    } else if (isPdf(target)) {
      result = await attachPdf(target, options);
    } else {
      result = await attachFile(target, options);
    }

    // Display result
    console.log('');
    console.log(pc.cyan(`=== Attached: ${result.type.toUpperCase()} ===`));
    console.log(pc.dim(`Source: ${result.source}`));

    if (result.metadata.pages) {
      console.log(pc.dim(`Pages: ${result.metadata.pages}`));
    }
    if (result.metadata.title) {
      console.log(pc.dim(`Title: ${result.metadata.title}`));
    }

    console.log('');

    // Show preview or full content
    if (options.preview) {
      console.log(pc.dim('Preview:'));
      console.log(result.preview);
      console.log(pc.dim(`\n... (${result.content.length} chars total)`));
    } else {
      console.log(result.content);
    }

    console.log('');
    console.log(pc.green('✓ Content ready for context injection'));

  } catch (err: unknown) {
    console.error(pc.red(`Failed to attach: ${(err as Error).message}`));
    process.exit(1);
  }
}

/**
 * Check if target is a URL
 */
function isUrl(target: string): boolean {
  return /^https?:\/\//i.test(target);
}

/**
 * Check if target is a PDF
 */
function isPdf(target: string): boolean {
  return extname(target).toLowerCase() === '.pdf';
}

/**
 * Attach a URL (scrape content)
 */
async function attachUrl(url: string, options: AttachOptions): Promise<AttachmentResult> {
  console.log(pc.dim(`Fetching: ${url}...`));

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const html = await response.text();

  // Extract main content (simple extraction)
  const content = extractMainContent(html);
  const title = extractTitle(html);
  const maxLen = options.maxLength || 10000;
  const truncated = content.length > maxLen ? content.slice(0, maxLen) + '...' : content;

  return {
    type: 'url',
    source: url,
    content: truncated,
    preview: truncated.slice(0, 500) + '...',
    metadata: {
      title,
      length: content.length,
      url,
    },
  };
}

/**
 * Attach a PDF file
 */
async function attachPdf(filePath: string, options: AttachOptions): Promise<AttachmentResult> {
  // Check file exists
  try {
    await stat(filePath);
  } catch {
    throw new Error(`File not found: ${filePath}`);
  }

  console.log(pc.dim(`Reading PDF: ${filePath}...`));

  // Try to use pdf-parse if available (optional dependency)
  try {
    // Dynamic import with type assertion for optional dependency
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = (await import(/* webpackIgnore: true */ 'pdf-parse' as string)) as {
      default: (buffer: Buffer) => Promise<{ text: string; numpages: number; info: Record<string, unknown> }>;
    };
    const buffer = await readFile(filePath);
    const data = await pdfParse.default(buffer);

    const maxLen = options.maxLength || 10000;
    const content = data.text;
    const truncated = content.length > maxLen ? content.slice(0, maxLen) + '...' : content;

    return {
      type: 'pdf',
      source: basename(filePath),
      content: truncated,
      preview: truncated.slice(0, 500) + '...',
      metadata: {
        pages: data.numpages,
        info: data.info,
        length: content.length,
      },
    };
  } catch {
    // Fallback: return info about PDF without parsing
    const stats = await stat(filePath);

    return {
      type: 'pdf',
      source: basename(filePath),
      content: `[PDF file: ${basename(filePath)}, ${formatBytes(stats.size)}]\n\nNote: Install pdf-parse to extract text content:\n  npm install pdf-parse`,
      preview: `[PDF: ${basename(filePath)}]`,
      metadata: {
        size: stats.size,
        note: 'pdf-parse not installed',
      },
    };
  }
}

/**
 * Attach a regular file
 */
async function attachFile(filePath: string, options: AttachOptions): Promise<AttachmentResult> {
  try {
    await stat(filePath);
  } catch {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = await readFile(filePath, 'utf-8');
  const maxLen = options.maxLength || 50000;
  const truncated = content.length > maxLen ? content.slice(0, maxLen) + '...' : content;

  return {
    type: 'file',
    source: basename(filePath),
    content: truncated,
    preview: truncated.slice(0, 500) + '...',
    metadata: {
      path: filePath,
      length: content.length,
      extension: extname(filePath),
    },
  };
}

/**
 * Extract main content from HTML (simple approach)
 */
function extractMainContent(html: string): string {
  // Remove scripts, styles, nav, footer, aside
  let content = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');

  // Find main/article content
  const mainMatch = content.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ||
                   content.match(/<article[^>]*>([\s\S]*?)<\/article>/i);

  if (mainMatch) {
    content = mainMatch[1];
  }

  // Strip remaining HTML tags
  content = content.replace(/<[^>]+>/g, ' ');

  // Clean up whitespace
  content = content
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();

  // Decode HTML entities
  content = content
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  return content;
}

/**
 * Extract title from HTML
 */
function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (match) {
    return match[1].trim();
  }
  return '';
}

/**
 * Format bytes as human readable
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
