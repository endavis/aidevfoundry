/**
 * Mermaid to ASCII Diagram Rendering
 *
 * Converts simple mermaid diagrams to ASCII art.
 * Supports: flowchart/graph, basic sequence diagrams.
 */

import pc from 'picocolors';

// Box drawing
const BOX = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
  arrow: '──>',
  arrowLeft: '<──',
  arrowBoth: '<─>',
};

export interface FlowNode {
  id: string;
  label: string;
  shape: 'box' | 'round' | 'diamond' | 'circle';
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
  direction: 'forward' | 'back' | 'both';
}

export interface FlowChart {
  direction: 'LR' | 'TB' | 'RL' | 'BT';
  nodes: Map<string, FlowNode>;
  edges: FlowEdge[];
}

/**
 * Detect if text contains a mermaid block
 */
export function hasMermaidBlock(text: string): boolean {
  return /```mermaid\s*\n/i.test(text);
}

/**
 * Extract mermaid blocks from text
 */
export function extractMermaidBlocks(text: string): string[] {
  const blocks: string[] = [];
  const regex = /```mermaid\s*\n([\s\S]*?)```/gi;
  let match;

  while ((match = regex.exec(text)) !== null) {
    blocks.push(match[1].trim());
  }

  return blocks;
}

/**
 * Parse a flowchart/graph definition
 */
export function parseFlowchart(content: string): FlowChart | null {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l);

  if (lines.length === 0) return null;

  // Check for graph/flowchart declaration
  const firstLine = lines[0].toLowerCase();
  let direction: 'LR' | 'TB' | 'RL' | 'BT' = 'TB';

  if (firstLine.startsWith('graph') || firstLine.startsWith('flowchart')) {
    const match = firstLine.match(/(?:graph|flowchart)\s+(lr|tb|rl|bt)/i);
    if (match) {
      direction = match[1].toUpperCase() as 'LR' | 'TB' | 'RL' | 'BT';
    }
    lines.shift();
  } else {
    return null; // Not a flowchart
  }

  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.startsWith('%%') || !line) continue;

    // Parse node definitions and edges
    // Pattern: A[Label] --> B[Label]
    // Pattern: A --> B
    // Pattern: A[Label]

    const edgeMatch = line.match(
      /(\w+)(?:\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\})?\s*(-->|---|-\.->|==>|<-->)\s*(\w+)(?:\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\})?/
    );

    if (edgeMatch) {
      const fromId = edgeMatch[1];
      const fromLabel = edgeMatch[2] || edgeMatch[3] || edgeMatch[4] || fromId;
      const arrow = edgeMatch[5];
      const toId = edgeMatch[6];
      const toLabel = edgeMatch[7] || edgeMatch[8] || edgeMatch[9] || toId;

      // Add nodes
      if (!nodes.has(fromId)) {
        nodes.set(fromId, { id: fromId, label: fromLabel, shape: 'box' });
      }
      if (!nodes.has(toId)) {
        nodes.set(toId, { id: toId, label: toLabel, shape: 'box' });
      }

      // Add edge
      edges.push({
        from: fromId,
        to: toId,
        direction: arrow === '<-->' ? 'both' : 'forward',
      });

      continue;
    }

    // Single node definition: A[Label]
    const nodeMatch = line.match(/(\w+)(?:\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\})/);
    if (nodeMatch) {
      const id = nodeMatch[1];
      const label = nodeMatch[2] || nodeMatch[3] || nodeMatch[4] || id;
      const shape = nodeMatch[2] ? 'box' : nodeMatch[3] ? 'round' : 'diamond';
      nodes.set(id, { id, label, shape });
    }
  }

  return { direction, nodes, edges };
}

/**
 * Render a single node as ASCII box
 */
function renderNode(node: FlowNode, width: number): string[] {
  const content = node.label;
  const innerWidth = Math.max(content.length + 2, width);

  const top = BOX.topLeft + BOX.horizontal.repeat(innerWidth) + BOX.topRight;
  const mid = BOX.vertical + ' ' + content.padEnd(innerWidth - 2) + ' ' + BOX.vertical;
  const bot = BOX.bottomLeft + BOX.horizontal.repeat(innerWidth) + BOX.bottomRight;

  return [top, mid, bot];
}

/**
 * Render flowchart as ASCII (left-to-right layout)
 */
export function renderFlowchartLR(chart: FlowChart): string {
  const nodeList = Array.from(chart.nodes.values());
  if (nodeList.length === 0) return '[Empty flowchart]';

  // Calculate node width
  const maxLabel = Math.max(...nodeList.map(n => n.label.length));
  const nodeWidth = maxLabel + 4;

  // Build visual representation
  const lines: string[] = [];

  // Create ordered list based on edges
  const orderedNodes: FlowNode[] = [];
  const visited = new Set<string>();

  // Find starting nodes (no incoming edges)
  const hasIncoming = new Set(chart.edges.map(e => e.to));
  for (const node of nodeList) {
    if (!hasIncoming.has(node.id) && !visited.has(node.id)) {
      orderedNodes.push(node);
      visited.add(node.id);
    }
  }

  // Add remaining nodes
  for (const node of nodeList) {
    if (!visited.has(node.id)) {
      orderedNodes.push(node);
      visited.add(node.id);
    }
  }

  // Render in a horizontal line
  const boxes = orderedNodes.map(n => renderNode(n, nodeWidth));
  const height = 3;

  for (let row = 0; row < height; row++) {
    let line = '';
    for (let i = 0; i < boxes.length; i++) {
      line += boxes[i][row];
      if (i < boxes.length - 1) {
        // Add arrow between boxes
        line += row === 1 ? '────>' : '     ';
      }
    }
    lines.push(line);
  }

  return lines.join('\n');
}

/**
 * Render flowchart as ASCII (top-to-bottom layout)
 */
export function renderFlowchartTB(chart: FlowChart): string {
  const nodeList = Array.from(chart.nodes.values());
  if (nodeList.length === 0) return '[Empty flowchart]';

  // Calculate node width
  const maxLabel = Math.max(...nodeList.map(n => n.label.length));
  const nodeWidth = maxLabel + 4;

  const lines: string[] = [];

  for (let i = 0; i < nodeList.length; i++) {
    const box = renderNode(nodeList[i], nodeWidth);
    lines.push(...box);

    // Add arrow between nodes
    if (i < nodeList.length - 1) {
      const pad = Math.floor(nodeWidth / 2) + 1;
      lines.push(' '.repeat(pad) + '│');
      lines.push(' '.repeat(pad) + '▼');
    }
  }

  return lines.join('\n');
}

/**
 * Render flowchart based on direction
 */
export function renderFlowchart(chart: FlowChart): string {
  if (chart.direction === 'LR' || chart.direction === 'RL') {
    return renderFlowchartLR(chart);
  }
  return renderFlowchartTB(chart);
}

/**
 * Render mermaid content as ASCII
 */
export function renderMermaid(content: string): string {
  // Try to parse as flowchart
  const flowchart = parseFlowchart(content);
  if (flowchart) {
    return renderFlowchart(flowchart);
  }

  // Unknown diagram type - show as code block
  return pc.dim('```mermaid (unsupported diagram type)\n') + content + pc.dim('\n```');
}

/**
 * Transform mermaid blocks in text to ASCII
 */
export function transformMermaid(text: string): string {
  if (!hasMermaidBlock(text)) return text;

  return text.replace(
    /```mermaid\s*\n([\s\S]*?)```/gi,
    (_match, content) => {
      const trimmed = content.trim();
      const ascii = renderMermaid(trimmed);
      return '\n' + ascii + '\n';
    }
  );
}
