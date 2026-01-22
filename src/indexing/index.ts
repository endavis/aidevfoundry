/**
 * Codebase Indexing (Phase 12)
 *
 * Index entire codebases for:
 * - Semantic code search (via Phase 11 memory)
 * - Dependency graphs (import/export relationships)
 * - Project configuration (AGENTS.md, etc.)
 * - Agentic context injection
 */

// Re-export all modules
export * from './ast-parser';
export * from './dependency-graph';
export * from './embedder';
export * from './searcher';
export * from './config-detector';

import { globSync } from 'glob';
import { parseFiles, type FileStructure } from './ast-parser';
import { buildDependencyGraph, type DependencyGraph } from './dependency-graph';
import { embedFileStructures, type EmbedResult } from './embedder';
import { detectProjectConfig, type ProjectConfig } from './config-detector';

export interface IndexOptions {
  /** File patterns to include */
  include?: string[];
  /** File patterns to exclude */
  exclude?: string[];
  /** Maximum files to index */
  maxFiles?: number;
  /** Skip embedding (just parse structure) */
  skipEmbedding?: boolean;
}

export interface IndexResult {
  /** Parsed file structures */
  structures: FileStructure[];
  /** Dependency graph */
  graph: DependencyGraph;
  /** Project configuration */
  config: ProjectConfig;
  /** Embedding results (if not skipped) */
  embedResult?: EmbedResult;
  /** Time taken in ms */
  duration: number;
}

const DEFAULT_OPTIONS: Required<IndexOptions> = {
  include: [
    '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx',
    '**/*.py', '**/*.go', '**/*.rs', '**/*.java',
    '**/*.c', '**/*.cpp', '**/*.h',
  ],
  exclude: [
    '**/node_modules/**', '**/dist/**', '**/build/**',
    '**/.git/**', '**/coverage/**', '**/__pycache__/**',
    '**/vendor/**', '**/target/**',
  ],
  maxFiles: 1000,
  skipEmbedding: false,
};

/**
 * Index an entire codebase
 */
export async function indexCodebase(
  rootDir: string,
  options: IndexOptions = {}
): Promise<IndexResult> {
  const startTime = Date.now();
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Find files to index
  const files: string[] = [];
  for (const pattern of opts.include) {
    const matches = globSync(pattern, {
      cwd: rootDir,
      absolute: true,
      ignore: opts.exclude,
    });
    files.push(...matches);
  }

  // Limit files
  const filesToIndex = files.slice(0, opts.maxFiles);

  // Parse all files
  const structures = parseFiles(filesToIndex, rootDir);

  // Build dependency graph
  const graph = buildDependencyGraph(structures, rootDir);

  // Detect project config
  const config = detectProjectConfig(rootDir);

  // Embed to vector store (optional)
  let embedResult: EmbedResult | undefined;
  if (!opts.skipEmbedding) {
    embedResult = await embedFileStructures(structures, rootDir);
  }

  return {
    structures,
    graph,
    config,
    embedResult,
    duration: Date.now() - startTime,
  };
}

/**
 * Quick index - just parse structure without embedding
 */
export async function quickIndex(rootDir: string): Promise<IndexResult> {
  return indexCodebase(rootDir, { skipEmbedding: true });
}

/**
 * Get a summary of the index
 */
export function getIndexSummary(result: IndexResult): string {
  const lines: string[] = [];

  lines.push(`Indexed ${result.structures.length} files in ${result.duration}ms`);

  // Count totals
  let totalFunctions = 0;
  let totalClasses = 0;
  let totalInterfaces = 0;

  for (const s of result.structures) {
    totalFunctions += s.functions.length;
    totalClasses += s.classes.length;
    totalInterfaces += s.interfaces.length;
  }

  lines.push(`  Functions: ${totalFunctions}`);
  lines.push(`  Classes: ${totalClasses}`);
  lines.push(`  Interfaces: ${totalInterfaces}`);

  if (result.embedResult) {
    lines.push(`  Embedded: ${result.embedResult.embedded} files, ${result.embedResult.chunks} chunks`);
    if (result.embedResult.skipped > 0) {
      lines.push(`  Skipped: ${result.embedResult.skipped} (unchanged/unsupported)`);
    }
  }

  if (result.config.configFiles.length > 0) {
    lines.push(`  Config: ${result.config.configFiles.join(', ')}`);
  }

  return lines.join('\n');
}
