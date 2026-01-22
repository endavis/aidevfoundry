import { Box, Text } from 'ink';
import type { CampaignTask } from '../../orchestrator/campaign/campaign-state.js';
import type { EnhancedCampaignTask, DomainStatus } from '../../orchestrator/campaign/campaign-types.js';

const COLORS = {
  primary: '#8CA9FF',
  success: 'green',
  warning: 'yellow',
  error: 'red',
  muted: 'gray',
  info: 'cyan'
};

interface DomainData {
  name: string;
  status: DomainStatus;
  pending: number;
  in_progress: number;
  completed: number;
  failed: number;
  blocked: number;
  total: number;
  progress: number;
}

interface DomainProgressProps {
  tasks: CampaignTask[];
  maxVisible?: number;
  showTasks?: boolean;
}

function getStatusIcon(status: DomainStatus): string {
  switch (status) {
    case 'completed': return '✓';
    case 'running': return '●';
    case 'failed': return '✗';
    case 'blocked': return '⊘';
    case 'paused': return '⏸';
    default: return '○';
  }
}

function getStatusColor(status: DomainStatus): string {
  switch (status) {
    case 'completed': return COLORS.success;
    case 'running': return COLORS.warning;
    case 'failed': return COLORS.error;
    case 'blocked': return 'magenta';
    case 'paused': return COLORS.info;
    default: return COLORS.muted;
  }
}

function ProgressBar({ percent, width = 15 }: { percent: number; width?: number }) {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;

  return (
    <Box>
      <Text>[</Text>
      <Text color={COLORS.success}>{'█'.repeat(filled)}</Text>
      <Text dimColor>{'░'.repeat(empty)}</Text>
      <Text>]</Text>
    </Box>
  );
}

/**
 * Extract domains from tasks and calculate per-domain statistics
 */
function extractDomains(tasks: CampaignTask[]): DomainData[] {
  const domainMap = new Map<string, DomainData>();

  for (const task of tasks) {
    // Get domain from enhanced task or fallback to area
    const domainName = ('domain' in task ? (task as EnhancedCampaignTask).domain : task.area) || 'unassigned';

    if (!domainMap.has(domainName)) {
      domainMap.set(domainName, {
        name: domainName,
        status: 'pending',
        pending: 0,
        in_progress: 0,
        completed: 0,
        failed: 0,
        blocked: 0,
        total: 0,
        progress: 0
      });
    }

    const domain = domainMap.get(domainName)!;
    domain.total++;

    switch (task.status) {
      case 'pending': domain.pending++; break;
      case 'in_progress': domain.in_progress++; break;
      case 'completed': domain.completed++; break;
      case 'failed': domain.failed++; break;
      case 'blocked': domain.blocked++; break;
    }
  }

  // Calculate progress and status for each domain
  for (const domain of domainMap.values()) {
    domain.progress = domain.total > 0 ? Math.round((domain.completed / domain.total) * 100) : 0;

    if (domain.completed === domain.total && domain.total > 0) {
      domain.status = 'completed';
    } else if (domain.failed > 0 && domain.pending === 0 && domain.in_progress === 0) {
      domain.status = 'failed';
    } else if (domain.in_progress > 0) {
      domain.status = 'running';
    } else if (domain.blocked > 0 && domain.pending === 0 && domain.in_progress === 0) {
      domain.status = 'blocked';
    }
  }

  // Sort by progress descending
  return Array.from(domainMap.values()).sort((a, b) => b.progress - a.progress);
}

function DomainRow({ domain }: { domain: DomainData }) {
  const icon = getStatusIcon(domain.status);
  const color = getStatusColor(domain.status);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={color}>{icon} </Text>
        <Box width={14}>
          <Text bold>{domain.name.slice(0, 12).padEnd(12)}</Text>
        </Box>
        <Text> </Text>
        <ProgressBar percent={domain.progress} />
        <Text> </Text>
        <Text bold>{domain.progress.toString().padStart(3)}%</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text color={COLORS.success}>✓{domain.completed} </Text>
        <Text color={COLORS.warning}>●{domain.in_progress} </Text>
        <Text dimColor>○{domain.pending} </Text>
        <Text color={COLORS.error}>✗{domain.failed} </Text>
        <Text color="magenta">⊘{domain.blocked}</Text>
      </Box>
    </Box>
  );
}

/**
 * DomainProgress - Shows progress bar and task counts per domain
 *
 * Displays each domain with:
 * - Status icon and name
 * - Progress bar
 * - Task breakdown (completed, in_progress, pending, failed, blocked)
 */
export function DomainProgress({ tasks, maxVisible = 8 }: Pick<DomainProgressProps, 'tasks' | 'maxVisible'>) {
  const domains = extractDomains(tasks);

  if (domains.length === 0) {
    return (
      <Box>
        <Text dimColor>No domains configured</Text>
      </Box>
    );
  }

  const visibleDomains = domains.slice(0, maxVisible);
  const hiddenCount = Math.max(0, domains.length - maxVisible);

  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.primary}>Per-Domain Progress:</Text>
      <Text> </Text>
      {visibleDomains.map((domain) => (
        <DomainRow key={domain.name} domain={domain} />
      ))}
      {hiddenCount > 0 && (
        <Text dimColor>  ... {hiddenCount} more domain(s)</Text>
      )}
    </Box>
  );
}

/**
 * Compact domain summary for space-constrained views
 */
export function DomainSummary({ tasks }: { tasks: CampaignTask[] }) {
  const domains = extractDomains(tasks);

  if (domains.length === 0) {
    return <Text dimColor>No domains</Text>;
  }

  const completed = domains.filter(d => d.status === 'completed').length;
  const running = domains.filter(d => d.status === 'running').length;
  const failed = domains.filter(d => d.status === 'failed').length;

  return (
    <Box>
      <Text>Domains: </Text>
      <Text color={COLORS.success}>{completed}✓</Text>
      <Text dimColor> | </Text>
      <Text color={COLORS.warning}>{running}●</Text>
      <Text dimColor> | </Text>
      <Text color={COLORS.error}>{failed}✗</Text>
      <Text dimColor> | </Text>
      <Text dimColor>{domains.length} total</Text>
    </Box>
  );
}

export default DomainProgress;
