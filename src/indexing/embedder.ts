/**
 * Codebase Embedder (Phase 12)
 *
 * Embeds code files into the vector store for semantic search.
 * Uses the existing Phase 11 memory infrastructure.
 */

import { readFileSync, existsSync } from 'fs';
import { relative, extname } from 'path';
import { createHash } from 'crypto';
import { addMemory, initVectorStore } from '../memory/vector-store';
import { getDatabase } from '../memory/database';
import type { FileStructure } from './ast-parser';
import { getStructureSummary } from './ast-parser';

export interface EmbedOptions {
  /** Maximum file size to embed (bytes) */
  maxFileSize?: number;
  /** Maximum tokens per chunk */
  chunkSize?: number;
  /** Overlap between chunks (tokens) */
  chunkOverlap?: number;
  /** Include file content or just structure */
  includeContent?: boolean;
  /** Filter by file extension */
  extensions?: string[];
}

export interface EmbedResult {
  /** Files successfully embedded */
  embedded: number;
  /** Files skipped (too large, wrong type, etc.) */
  skipped: number;
  /** Total chunks created */
  chunks: number;
  /** Errors encountered */
  errors: string[];
}

const DEFAULT_OPTIONS: Required<EmbedOptions> = {
  maxFileSize: 100 * 1024, // 100KB
  chunkSize: 512,
  chunkOverlap: 50,
  includeContent: true,
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h'],
};

/**
 * Embed parsed file structures into the memory store
 */
export async function embedFileStructures(
  structures: FileStructure[],
  _rootDir: string,
  options: EmbedOptions = {}
): Promise<EmbedResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  await initVectorStore();

  const result: EmbedResult = {
    embedded: 0,
    skipped: 0,
    chunks: 0,
    errors: [],
  };

  for (const structure of structures) {
    try {
      // Check extension
      const ext = extname(structure.path).toLowerCase();
      if (!opts.extensions.includes(ext)) {
        result.skipped++;
        continue;
      }

      // Check file size
      if (!existsSync(structure.path)) {
        result.skipped++;
        continue;
      }

      const content = readFileSync(structure.path, 'utf-8');
      if (content.length > opts.maxFileSize) {
        result.skipped++;
        continue;
      }

      // Check if file needs re-indexing
      const contentHash = hashContent(content);
      if (!needsReindex(structure.relativePath, contentHash)) {
        result.skipped++;
        continue;
      }

      // Remove existing embeddings for this file
      await removeFileEmbeddings(structure.relativePath);

      // Create structure summary
      const summary = getStructureSummary(structure);

      // Embed structure summary (always)
      await addMemory({
        type: 'code',
        content: summary,
        metadata: {
          path: structure.relativePath,
          kind: 'structure',
          hash: contentHash,
          exports: structure.exports.map(e => e.name),
          functions: structure.functions.map(f => f.name),
          classes: structure.classes.map(c => c.name),
          lineCount: structure.lineCount,
        },
      });
      result.chunks++;

      // Embed file content (chunked if needed)
      if (opts.includeContent) {
        const chunks = chunkContent(content, opts.chunkSize, opts.chunkOverlap);
        for (let i = 0; i < chunks.length; i++) {
          await addMemory({
            type: 'code',
            content: `File: ${structure.relativePath}\n\n${chunks[i]}`,
            metadata: {
              path: structure.relativePath,
              kind: 'content',
              hash: contentHash,
              chunkIndex: i,
              totalChunks: chunks.length,
            },
          });
          result.chunks++;
        }
      }

      result.embedded++;
    } catch (err) {
      result.errors.push(`${structure.relativePath}: ${(err as Error).message}`);
    }
  }

  return result;
}

/**
 * Embed a single file
 */
export async function embedFile(
  filePath: string,
  rootDir: string,
  options: EmbedOptions = {}
): Promise<boolean> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  await initVectorStore();

  const ext = extname(filePath).toLowerCase();
  if (!opts.extensions.includes(ext)) {
    return false;
  }

  if (!existsSync(filePath)) {
    return false;
  }

  const content = readFileSync(filePath, 'utf-8');
  if (content.length > opts.maxFileSize) {
    return false;
  }

  const relativePath = relative(rootDir, filePath);
  const contentHash = hashContent(content);

  // Check if file needs re-indexing
  if (!needsReindex(relativePath, contentHash)) {
    return false;
  }

  // Remove existing embeddings for this file
  await removeFileEmbeddings(relativePath);

  // Add file content
  const chunks = chunkContent(content, opts.chunkSize, opts.chunkOverlap);
  for (let i = 0; i < chunks.length; i++) {
    await addMemory({
      type: 'code',
      content: `File: ${relativePath}\n\n${chunks[i]}`,
      metadata: {
        path: relativePath,
        kind: 'content',
        hash: contentHash,
        chunkIndex: i,
        totalChunks: chunks.length,
      },
    });
  }

  return true;
}

/**
 * Remove embeddings for a file
 */
export async function removeFileEmbeddings(relativePath: string): Promise<void> {
  const db = getDatabase();
  db.prepare(`
    DELETE FROM memory
    WHERE type = 'code'
    AND json_extract(metadata, '$.path') = ?
  `).run(relativePath);
}

/**
 * Get all indexed file paths
 */
export function getIndexedFiles(): string[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT DISTINCT json_extract(metadata, '$.path') as path
    FROM memory
    WHERE type = 'code'
  `).all() as Array<{ path: string }>;

  return rows.map(r => r.path).filter(Boolean);
}

/**
 * Get indexing stats
 */
export function getIndexStats(): {
  totalFiles: number;
  totalChunks: number;
  byKind: Record<string, number>;
} {
  const db = getDatabase();

  const totalFiles = (db.prepare(`
    SELECT COUNT(DISTINCT json_extract(metadata, '$.path')) as count
    FROM memory WHERE type = 'code'
  `).get() as { count: number }).count;

  const totalChunks = (db.prepare(`
    SELECT COUNT(*) as count FROM memory WHERE type = 'code'
  `).get() as { count: number }).count;

  const kindRows = db.prepare(`
    SELECT json_extract(metadata, '$.kind') as kind, COUNT(*) as count
    FROM memory WHERE type = 'code'
    GROUP BY kind
  `).all() as Array<{ kind: string; count: number }>;

  const byKind: Record<string, number> = {};
  for (const row of kindRows) {
    byKind[row.kind || 'unknown'] = row.count;
  }

  return { totalFiles, totalChunks, byKind };
}

/**
 * Clear all code embeddings
 */
export function clearCodeIndex(): void {
  const db = getDatabase();
  db.prepare("DELETE FROM memory WHERE type = 'code'").run();
}

/**
 * Hash content for change detection
 */
function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Check if a file needs re-indexing (content changed)
 */
export function needsReindex(relativePath: string, newHash?: string): boolean {
  const db = getDatabase();

  // Get existing hash from index
  const existing = db.prepare(`
    SELECT json_extract(metadata, '$.hash') as hash
    FROM memory
    WHERE type = 'code' AND json_extract(metadata, '$.path') = ?
    LIMIT 1
  `).get(relativePath) as { hash: string } | undefined;

  if (!existing) {
    return true; // Not indexed yet
  }

  if (newHash && existing.hash !== newHash) {
    return true; // Content changed
  }

  return false;
}

/**
 * Chunk content into smaller pieces
 * Uses a simple approach: split by lines, group into chunks
 */
function chunkContent(
  content: string,
  chunkSize: number,
  overlap: number
): string[] {
  const lines = content.split('\n');
  const chunks: string[] = [];

  // Estimate ~4 chars per token
  const charsPerChunk = chunkSize * 4;
  const overlapChars = overlap * 4;

  let currentChunk = '';
  let currentSize = 0;

  for (const line of lines) {
    const lineWithNewline = line + '\n';
    const lineSize = lineWithNewline.length;

    if (currentSize + lineSize > charsPerChunk && currentChunk) {
      chunks.push(currentChunk.trim());

      // Keep overlap from end of current chunk
      if (overlapChars > 0) {
        currentChunk = currentChunk.slice(-overlapChars);
        currentSize = currentChunk.length;
      } else {
        currentChunk = '';
        currentSize = 0;
      }
    }

    currentChunk += lineWithNewline;
    currentSize += lineSize;
  }

  // Don't forget the last chunk
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}
