/**
 * Dependency Graph (Phase 12)
 *
 * Builds a graph of file relationships:
 * - Which files import which
 * - Which files export what
 * - Find all dependents/dependencies of a file
 */

import { resolve, dirname, join } from 'path';
import { existsSync, readFileSync } from 'fs';
import type { FileStructure } from './ast-parser';
import { isAbsolutePath } from '../lib/paths';

export interface DependencyNode {
  /** Absolute path to the file */
  path: string;
  /** Relative path from project root */
  relativePath: string;
  /** Files this file imports */
  imports: string[];
  /** Files that import this file */
  importedBy: string[];
  /** What this file exports */
  exports: string[];
}

export interface DependencyGraph {
  /** Map of file path to node */
  nodes: Map<string, DependencyNode>;
  /** Project root */
  rootDir: string;
  /** Path aliases from tsconfig */
  pathAliases: Map<string, string>;
}

/**
 * Build a dependency graph from parsed file structures
 */
export function buildDependencyGraph(
  structures: FileStructure[],
  rootDir: string
): DependencyGraph {
  const nodes = new Map<string, DependencyNode>();
  const pathAliases = loadPathAliases(rootDir);

  // First pass: create nodes
  for (const structure of structures) {
    nodes.set(structure.path, {
      path: structure.path,
      relativePath: structure.relativePath,
      imports: [],
      importedBy: [],
      exports: structure.exports.map(e => e.name),
    });
  }

  // Second pass: resolve imports and build edges
  for (const structure of structures) {
    const node = nodes.get(structure.path)!;
    const fileDir = dirname(structure.path);

    for (const imp of structure.imports) {
      const resolvedPath = resolveImportPath(
        imp.moduleSpecifier,
        fileDir,
        rootDir,
        pathAliases
      );

      if (resolvedPath && nodes.has(resolvedPath)) {
        // Add edge: this file imports resolvedPath
        node.imports.push(resolvedPath);

        // Add reverse edge: resolvedPath is imported by this file
        const targetNode = nodes.get(resolvedPath)!;
        targetNode.importedBy.push(structure.path);
      }
    }
  }

  return { nodes, rootDir, pathAliases };
}

/**
 * Load path aliases from tsconfig.json
 */
function loadPathAliases(rootDir: string): Map<string, string> {
  const aliases = new Map<string, string>();
  const tsconfigPath = join(rootDir, 'tsconfig.json');

  if (!existsSync(tsconfigPath)) {
    return aliases;
  }

  try {
    const content = readFileSync(tsconfigPath, 'utf-8');
    // Remove comments (simple approach)
    const cleaned = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const config = JSON.parse(cleaned);

    const paths = config.compilerOptions?.paths || {};
    const baseUrl = config.compilerOptions?.baseUrl || '.';
    const basePath = resolve(rootDir, baseUrl);

    for (const [alias, targets] of Object.entries(paths)) {
      if (Array.isArray(targets) && targets.length > 0) {
        // Remove trailing /* from alias and target
        const cleanAlias = alias.replace(/\/\*$/, '');
        const cleanTarget = (targets[0] as string).replace(/\/\*$/, '');
        aliases.set(cleanAlias, resolve(basePath, cleanTarget));
      }
    }
  } catch {
    // Ignore parse errors
  }

  return aliases;
}

/**
 * Resolve an import path to an absolute file path
 */
function resolveImportPath(
  moduleSpecifier: string,
  fromDir: string,
  _rootDir: string,
  pathAliases: Map<string, string>
): string | null {
  // Try different extensions
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', ''];
  const indexFiles = ['index.ts', 'index.tsx', 'index.js', 'index.jsx'];

  let basePath: string;

  // Check if it's a relative import (handles Windows paths too)
  if (moduleSpecifier.startsWith('.') || isAbsolutePath(moduleSpecifier)) {
    basePath = resolve(fromDir, moduleSpecifier);
  } else {
    // Check path aliases
    for (const [alias, target] of pathAliases) {
      if (moduleSpecifier === alias || moduleSpecifier.startsWith(alias + '/')) {
        const remainder = moduleSpecifier.slice(alias.length);
        basePath = join(target, remainder);
        break;
      }
    }

    // External package if no alias matched
    if (!basePath!) {
      return null;
    }
  }

  // Try direct path with extensions
  for (const ext of extensions) {
    const fullPath = basePath + ext;
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }

  // Try as directory with index file
  for (const indexFile of indexFiles) {
    const fullPath = join(basePath, indexFile);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }

  return null;
}

/**
 * Get all files that depend on a given file (direct and transitive)
 */
export function getDependents(
  graph: DependencyGraph,
  filePath: string,
  transitive: boolean = false
): string[] {
  const node = graph.nodes.get(filePath);
  if (!node) return [];

  if (!transitive) {
    return [...node.importedBy];
  }

  // BFS for transitive dependents
  const visited = new Set<string>();
  const queue = [...node.importedBy];
  const result: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    result.push(current);

    const currentNode = graph.nodes.get(current);
    if (currentNode) {
      queue.push(...currentNode.importedBy);
    }
  }

  return result;
}

/**
 * Get all files that a given file depends on (direct and transitive)
 */
export function getDependencies(
  graph: DependencyGraph,
  filePath: string,
  transitive: boolean = false
): string[] {
  const node = graph.nodes.get(filePath);
  if (!node) return [];

  if (!transitive) {
    return [...node.imports];
  }

  // BFS for transitive dependencies
  const visited = new Set<string>();
  const queue = [...node.imports];
  const result: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    result.push(current);

    const currentNode = graph.nodes.get(current);
    if (currentNode) {
      queue.push(...currentNode.imports);
    }
  }

  return result;
}

/**
 * Find files related to a given file (imports + importedBy)
 */
export function getRelatedFiles(
  graph: DependencyGraph,
  filePath: string,
  depth: number = 1
): string[] {
  const related = new Set<string>();
  const queue: Array<{ path: string; currentDepth: number }> = [
    { path: filePath, currentDepth: 0 }
  ];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const { path: current, currentDepth } = queue.shift()!;
    if (visited.has(current) || currentDepth > depth) continue;
    visited.add(current);

    if (current !== filePath) {
      related.add(current);
    }

    if (currentDepth < depth) {
      const node = graph.nodes.get(current);
      if (node) {
        for (const imp of node.imports) {
          queue.push({ path: imp, currentDepth: currentDepth + 1 });
        }
        for (const dep of node.importedBy) {
          queue.push({ path: dep, currentDepth: currentDepth + 1 });
        }
      }
    }
  }

  return [...related];
}

/**
 * Find the most connected files (potential "core" files)
 */
export function getMostConnectedFiles(
  graph: DependencyGraph,
  limit: number = 10
): Array<{ path: string; connections: number }> {
  const connections: Array<{ path: string; connections: number }> = [];

  for (const [_path, node] of graph.nodes) {
    connections.push({
      path: node.relativePath,
      connections: node.imports.length + node.importedBy.length,
    });
  }

  connections.sort((a, b) => b.connections - a.connections);
  return connections.slice(0, limit);
}

/**
 * Find circular dependencies
 */
export function findCircularDependencies(graph: DependencyGraph): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function dfs(path: string, stack: string[]): void {
    if (recursionStack.has(path)) {
      // Found a cycle
      const cycleStart = stack.indexOf(path);
      if (cycleStart !== -1) {
        cycles.push(stack.slice(cycleStart));
      }
      return;
    }

    if (visited.has(path)) return;

    visited.add(path);
    recursionStack.add(path);
    stack.push(path);

    const node = graph.nodes.get(path);
    if (node) {
      for (const imp of node.imports) {
        dfs(imp, [...stack]);
      }
    }

    recursionStack.delete(path);
  }

  for (const path of graph.nodes.keys()) {
    if (!visited.has(path)) {
      dfs(path, []);
    }
  }

  return cycles;
}

/**
 * Get a summary of the dependency graph
 */
export function getGraphSummary(graph: DependencyGraph): string {
  const lines: string[] = [];
  const fileCount = graph.nodes.size;
  let totalImports = 0;
  let maxImports = 0;
  let maxImportsFile = '';

  for (const [_path, node] of graph.nodes) {
    totalImports += node.imports.length;
    if (node.imports.length > maxImports) {
      maxImports = node.imports.length;
      maxImportsFile = node.relativePath;
    }
  }

  lines.push(`Files: ${fileCount}`);
  lines.push(`Total import edges: ${totalImports}`);
  lines.push(`Average imports per file: ${(totalImports / fileCount).toFixed(1)}`);
  lines.push(`Most imports: ${maxImportsFile} (${maxImports})`);

  if (graph.pathAliases.size > 0) {
    lines.push(`Path aliases: ${graph.pathAliases.size}`);
  }

  const cycles = findCircularDependencies(graph);
  if (cycles.length > 0) {
    lines.push(`Circular dependencies: ${cycles.length}`);
  }

  lines.push('\nMost connected files:');
  const topConnected = getMostConnectedFiles(graph, 5);
  for (const { path, connections } of topConnected) {
    lines.push(`  ${path}: ${connections} connections`);
  }

  return lines.join('\n');
}
