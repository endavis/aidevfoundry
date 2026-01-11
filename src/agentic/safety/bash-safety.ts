// Bash Safety Classifier - Risk assessment for shell commands

export type RiskLevel = 'low' | 'medium' | 'high';

export interface SafetyAssessment {
  riskLevel: RiskLevel;
  reason: string;
  requiresConfirmation: boolean;
  matchedPattern?: string;
}

// Patterns that indicate destructive or dangerous operations
const DESTRUCTIVE_PATTERNS: { pattern: RegExp; reason: string }[] = [
  // File destruction
  { pattern: /rm\s+-rf\b/i, reason: 'Recursive force delete' },
  { pattern: /rm\s+-r\b/i, reason: 'Recursive delete' },
  { pattern: /del\s+\/s\b/i, reason: 'Windows recursive delete' },
  { pattern: /del\s+\/q\b/i, reason: 'Windows quiet delete' },
  { pattern: /rd\s+\/s\b/i, reason: 'Windows remove directory recursive' },
  
  // Disk/formats
  { pattern: /\bformat\s+[a-z]:/i, reason: 'Disk format command' },
  { pattern: /\bformat\b.*\/(?:fs:|q|u|y|c|p)/i, reason: 'Disk format command' },
  { pattern: /\bmkfs\b/i, reason: 'Filesystem creation' },
  { pattern: /\bdiskpart\b/i, reason: 'Disk partitioning utility' },
  { pattern: /\bfdisk\b/i, reason: 'Disk partitioning utility' },
  
  // System manipulation
  { pattern: /\bshutdown\b/i, reason: 'System shutdown/restart' },
  { pattern: /\breboot\b/i, reason: 'System reboot' },
  { pattern: /\breg\s+delete\b/i, reason: 'Registry deletion' },
  { pattern: /\breg\s+add\b.*\/f\b/i, reason: 'Force registry addition' },
  
  // Dangerous redirects
  { pattern: />\s*\S+\s*$/m, reason: 'Output redirection to file (potential overwrite)' },
  { pattern: /2>\s*\S+/i, reason: 'Error redirection to file' },
  { pattern: /&\&\s*rm\b/i, reason: 'Chained deletion after command' },
  
  // Remote execution
  { pattern: /curl\s+.*\|\s*sh\b/i, reason: 'Pipe curl to shell (remote code execution)' },
  { pattern: /wget\s+.*\|\s*sh\b/i, reason: 'Pipe wget to shell (remote code execution)' },
  { pattern: /python\s+.*http.*\|\s*py\b/i, reason: 'Remote python script execution' },
  
  // Package manipulation
  { pattern: /npm\s+delete\b/i, reason: 'NPM package removal' },
  { pattern: /pip\s+uninstall\b/i, reason: 'Python package removal' },
  { pattern: /apt-get\s+remove\b/i, reason: 'APT package removal' },
  { pattern: /apt-get\s+purge\b/i, reason: 'APT package purge' },
  { pattern: /yum\s+remove\b/i, reason: 'YUM package removal' },
  { pattern: /brew\s+uninstall\b/i, reason: 'Homebrew package removal' },
];

// Commands that are generally safe (read-only or non-destructive)
const SAFE_ALLOWLIST: RegExp[] = [
  // Git operations (read-only)
  /^git\s+status$/i,
  /^git\s+status\s+/i,
  /^git\s+diff$/i,
  /^git\s+diff\s+/i,
  /^git\s+log$/i,
  /^git\s+log\s+/i,
  /^git\s+show$/i,
  /^git\s+show\s+/i,
  /^git\s+branch$/i,
  /^git\s+branch\s+/i,
  /^git\s+checkout\s+--\s*/i,
  /^git\s+reset\s+--\s*$/i,
  /^git\s+reset\s+HEAD\b/i,
  /^git\s+stash\s+list$/i,
  /^git\s+stash\s+show/i,
  /^git\s+remote\s+-v$/i,
  /^git\s+remote\s+show/i,
  /^git\s+fetch$/i,
  /^git\s+fetch\s+/i,
  /^git\s+pull$/i,
  /^git\s+pull\s+/i,
  /^git\s+push\s+--\s*dry\s*-\s*run$/i,
  /^git\s+push\s+-n\b/i,
  
  // File system read operations
  /^ls\b/i,
  /^ls\s+/i,
  /^dir\b/i,
  /^dir\s+/i,
  /^cat\b/i,
  /^cat\s+/i,
  /^type\b/i,
  /^type\s+/i,
  /^head\b/i,
  /^head\s+/i,
  /^tail\b/i,
  /^tail\s+/i,
  /^wc\b/i,
  /^wc\s+/i,
  /^grep\b/i,
  /^grep\s+/i,
  /^find\b.*-type\s+f/i,
  /^pwd$/i,
  /^pwd\s+/i,
  /^echo\b/i,
  /^echo\s+/i,
  
  // Build/test commands (generally safe when in project context)
  /^npm\s+test\b/i,
  /^npm\s+run\b/i,
  /^npm\s+run\s+build\b/i,
  /^npm\s+run\s+test\b/i,
  /^npm\s+run\s+lint\b/i,
  /^bun\s+test\b/i,
  /^bun\s+run\b/i,
  /^yarn\s+test\b/i,
  /^yarn\s+run\b/i,
  /^pnpm\s+test\b/i,
  /^pnpm\s+run\b/i,
  /^make\b/i,
  /^make\s+/i,
  /^pytest\b/i,
  /^pytest\s+/i,
  /^cargo\s+test\b/i,
  /^cargo\s+check\b/i,
  /^cargo\s+build\b/i,
  /^go\s+test\b/i,
  /^go\s+build\b/i,
  
  // Version/info commands
  /^node\s+-v$/i,
  /^node\s+--version$/i,
  /^npm\s+-v$/i,
  /^npm\s+--version$/i,
  /^python3?\s+-V$/i,
  /^python3?\s+--version$/i,
  /^git\s+--version$/i,
  /^lsb_release\b/i,
];

// Additional denylist for commands that need explicit confirmation
const CONFIRMATION_DENYLIST: RegExp[] = [
  /\bsudo\b/i,
  /\bchmod\s+777\b/i,
  /\bchmod\s+000\b/i,
  /\bchown\b/i,
  /\bmount\b/i,
  /\bunmount\b/i,
  /\bdd\b/i,
];

export function assessBashSafety(command: string): SafetyAssessment {
  const trimmed = command.trim();

  // Check destructive patterns
  for (const { pattern, reason } of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        riskLevel: 'high',
        reason: `Dangerous pattern detected: ${reason}`,
        requiresConfirmation: true,
        matchedPattern: reason,
      };
    }
  }

  // Check allowlist - if matches, return low risk
  for (const allowPattern of SAFE_ALLOWLIST) {
    if (allowPattern.test(trimmed)) {
      return {
        riskLevel: 'low',
        reason: 'Allowlisted safe command',
        requiresConfirmation: false,
      };
    }
  }
  
  // Check confirmation-required denylist
  for (const pattern of CONFIRMATION_DENYLIST) {
    if (pattern.test(trimmed)) {
      return {
        riskLevel: 'medium',
        reason: 'Command requires elevated privileges or permission change',
        requiresConfirmation: true,
      };
    }
  }
  
  // Default: medium risk for unknown commands
  return {
    riskLevel: 'medium',
    reason: 'Non-allowlisted command - review before execution',
    requiresConfirmation: true,
  };
}

export function getRiskLevelColor(level: RiskLevel): string {
  switch (level) {
    case 'low': return 'green';
    case 'medium': return 'yellow';
    case 'high': return 'red';
  }
}

export function formatSafetyMessage(assessment: SafetyAssessment): string {
  const color = getRiskLevelColor(assessment.riskLevel);
  const confirmationHint = assessment.requiresConfirmation 
    ? ' (requires explicit confirmation)' 
    : '';
  return `[${color.toUpperCase()}] ${assessment.riskLevel}${confirmationHint}: ${assessment.reason}`;
}
