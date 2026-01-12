import type { PromptEvent, PermissionPromptEvent } from '../lib/types';

export type PermissionPolicy = 'ask' | 'auto_approve' | 'auto_deny' | 'smart';

/**
 * Check if a PromptEvent is a PermissionPromptEvent
 */
function isPermissionEvent(event: PromptEvent): event is PermissionPromptEvent {
  return event.type === 'permission';
}

/**
 * Get tool name from event if it's a permission event
 */
function getToolFromEvent(event: PromptEvent): string | undefined {
  return isPermissionEvent(event) ? event.tool : undefined;
}

export interface PermissionDecision {
  response: string;
  policy: PermissionPolicy;
  reason: string;
  timestamp: number;
}

export interface PermissionRouterConfig {
  defaultPolicy: PermissionPolicy;
  adapterOverrides: Record<string, PermissionPolicy>;
  trustedTools: string[];
  dangerousTools: string[];
}

const DANGEROUS_TOOLS = new Set([
  'bash', 'exec', 'run', 'shell', 'delete', 'remove', 'rm',
  'destroy', 'format', 'sudo', 'chmod', 'chown',
]);

const SAFE_TOOLS = new Set([
  'view', 'read', 'cat', 'glob', 'find', 'ls', 'grep',
  'search', 'ask', 'comment',
]);

const DEFAULT_CONFIG: PermissionRouterConfig = {
  defaultPolicy: 'ask',
  adapterOverrides: {},
  trustedTools: [],
  dangerousTools: [],
};

export class PermissionRouter {
  private config: PermissionRouterConfig;
  private auditLog: PermissionDecision[] = [];

  constructor(config?: Partial<PermissionRouterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  route(event: PromptEvent): PermissionDecision {
    const policy = this.getPolicy(event);
    const decision = this.applyPolicy(event, policy);
    this.auditLog.push(decision);
    return decision;
  }

  private getPolicy(event: PromptEvent): PermissionPolicy {
    const tool = getToolFromEvent(event);
    if (tool && this.config.adapterOverrides[tool]) {
      return this.config.adapterOverrides[tool];
    }
    return this.config.defaultPolicy;
  }

  private applyPolicy(event: PromptEvent, policy: PermissionPolicy): PermissionDecision {
    const timestamp = Date.now();

    switch (policy) {
      case 'auto_approve':
        return { response: 'y', policy, reason: 'Auto-approved', timestamp };
      case 'auto_deny':
        return { response: 'n', policy, reason: 'Auto-denied', timestamp };
      case 'smart':
        return this.smartDecide(event, timestamp);
      default:
        return { response: '', policy, reason: 'Requires user', timestamp };
    }
  }

  private smartDecide(event: PromptEvent, timestamp: number): PermissionDecision {
    const tool = getToolFromEvent(event);
    const toolLower = tool?.toLowerCase() || '';
    if (DANGEROUS_TOOLS.has(toolLower)) {
      return { response: '', policy: 'smart', reason: `Dangerous: ${tool}`, timestamp };
    }
    if (SAFE_TOOLS.has(toolLower)) {
      return { response: 'y', policy: 'smart', reason: `Safe: ${tool}`, timestamp };
    }
    return { response: '', policy: 'smart', reason: `Unknown: ${tool || 'n/a'}`, timestamp };
  }

  getAuditLog(): PermissionDecision[] {
    return [...this.auditLog];
  }

  clearAuditLog(): void {
    this.auditLog = [];
  }

  updateConfig(updates: Partial<PermissionRouterConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  getConfig(): PermissionRouterConfig {
    return { ...this.config };
  }
}

/**
 * Create a permission router with default config
 * TODO: INT-014 will add interactive config to PulzdConfig
 */
export function createPermissionRouter(
  defaultPolicy: PermissionPolicy = 'ask'
): PermissionRouter {
  return new PermissionRouter({ defaultPolicy });
}
