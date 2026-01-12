/**
 * PuzldAI Audit Command
 *
 * Comprehensive system audit for pk-puzldai that checks:
 * - Adapter availability and configuration
 * - Model setup and compatibility
 * - Environment and PATH configuration
 * - Common issues and recommendations
 *
 * Designed to feel as natural as Claude Code's audit functionality,
 * abstracting all CLI tool differences from the user.
 */

import { execa } from 'execa';
import { readFileSync, existsSync } from 'fs';
import pc from 'picocolors';
import { createSpinner } from 'nanospinner';
import { getConfig, getConfigPath, saveConfig, type PulzdConfig } from '../../lib/config';
import type { CheckResult } from '../../lib/types';

interface AuditIssue {
  severity: 'critical' | 'warning' | 'info';
  category: string;
  message: string;
  fix?: string;
  autoFixable?: boolean;
  fixAction?: (config: PulzdConfig) => PulzdConfig;
  installCmd?: string; // npm/shell command to install missing tool
}

interface AuditReport {
  score: number;
  summary: string;
  issues: AuditIssue[];
  checks: {
    adapters: CheckResult[];
    models: { name: string; expected: string; actual?: string; status: 'ok' | 'missing' | 'mismatch' }[];
    config: { name: string; status: 'ok' | 'warning'; message: string }[];
    environment: { name: string; status: 'ok' | 'warning'; message: string }[];
  };
  recommendations: string[];
}

const ADAPTER_PRIORITY = [
  { name: 'Claude', key: 'claude', path: 'claude', flags: ['--version'], installCmd: 'npm install -g @anthropic-ai/claude-code' },
  { name: 'Gemini', key: 'gemini', path: 'gemini', flags: ['--version'], installCmd: 'npm install -g @anthropic-ai/gemini-cli' },
  { name: 'Codex', key: 'codex', path: 'codex', flags: ['--version'], installCmd: 'npm install -g codex-cli' },
  { name: 'Ollama', key: 'ollama', path: 'ollama', flags: ['--version'], installCmd: null }, // Requires separate install
  { name: 'Factory (droid)', key: 'factory', path: 'droid', flags: ['--version'], installCmd: 'npm install -g @anthropic-ai/factory' },
  { name: 'Crush', key: 'crush', path: 'crush', flags: ['--version'], installCmd: 'npm install -g @charmland/crush' },
];

const RECOMMENDED_MODELS: Record<string, string> = {
  claude: 'sonnet',
  gemini: 'gemini-2.0-flash-exp',
  codex: 'gpt-4o',
  ollama: 'llama3.2',
  factory: 'GLM-4.7',
  crush: 'default',
};

export interface AuditOptions {
  json?: boolean;
  verbose?: boolean;
  fix?: boolean;
}

/**
 * Main audit command
 */
export async function auditCommand(options: AuditOptions = {}): Promise<void> {
  const startTime = Date.now();
  const config = getConfig();

  // Header
  if (!options.json) {
    console.log(pc.bold('\n' + '═'.repeat(60)));
    console.log(pc.cyan('  PuzldAI System Audit'));
    console.log(pc.dim('  Comprehensive health check for your AI toolkit'));
    console.log('═'.repeat(60) + '\n');
  }

  // Only use spinner in non-JSON mode
  const spinner = options.json ? null : createSpinner('Running diagnostics...').start();

  // Run all checks in parallel
  const [adapterResults, modelResults, configIssues, envIssues] = await Promise.all([
    checkAdapters(config),
    checkModels(config),
    checkConfigIssues(config),
    checkEnvironment(),
  ]);

  if (spinner) {
    spinner.stop();
  }

  // Collect all issues
  const issues: AuditIssue[] = [];

  // Adapter issues
  for (const result of adapterResults) {
    if (!result.available) {
      const adapterKey = ADAPTER_PRIORITY.find(a => a.name === result.name)?.key;

      // Skip Ollama - it's optional (local inference requires significant resources)
      if (adapterKey === 'ollama') {
        continue;
      }

      const isDisabled = result.error?.includes('disabled');
      const isNotFound = result.error?.includes('not found') ||
                        result.error?.includes('not recognized') ||
                        result.error?.includes('ENOENT') ||
                        result.error?.includes('exit code');

      // Determine fix action based on the issue type
      let autoFixable = false;
      let fixAction: ((cfg: PulzdConfig) => PulzdConfig) | undefined;
      let fixMessage: string;

      if (isDisabled && adapterKey) {
        // Adapter is disabled in config - can auto-enable
        autoFixable = true;
        fixMessage = `Enable ${result.name} in config`;
        fixAction = (cfg: PulzdConfig) => {
          const adapter = cfg.adapters[adapterKey as keyof typeof cfg.adapters];
          if (adapter && typeof adapter === 'object') {
            (adapter as { enabled: boolean }).enabled = true;
          }
          return cfg;
        };
      } else if (isNotFound && adapterKey) {
        // Adapter is enabled but CLI not found - try to install it
        const adapterInfo = ADAPTER_PRIORITY.find(a => a.key === adapterKey);
        if (adapterInfo?.installCmd) {
          autoFixable = true;
          fixMessage = `Install ${result.name} via npm`;
          // No config fixAction needed - installation happens separately
        } else {
          // Can't auto-install (e.g., Ollama needs manual setup)
          autoFixable = false;
          fixMessage = `Install ${result.name} manually (requires separate installation)`;
        }
      } else {
        fixMessage = `Install ${result.name} or update PATH`;
      }

      // Get install command for this adapter
      const adapterInstallCmd = ADAPTER_PRIORITY.find(a => a.key === adapterKey)?.installCmd;

      issues.push({
        severity: isDisabled ? 'info' : 'critical',
        category: 'Adapter',
        message: `${result.name} is not available: ${result.error || 'unknown error'}`,
        fix: fixMessage,
        autoFixable,
        fixAction,
        installCmd: isNotFound ? adapterInstallCmd ?? undefined : undefined
      });
    }
  }

  // Model issues (skip Router Model - it depends on optional Ollama)
  for (const model of modelResults) {
    if (model.status === 'missing' && model.name !== 'Router Model') {
      issues.push({
        severity: 'warning',
        category: 'Model',
        message: `Model "${model.name}" is not available`,
        fix: `Pull model with appropriate CLI or update config`
      });
    }
  }

  // Config issues
  for (const issue of configIssues) {
    issues.push({
      severity: issue.status === 'warning' ? 'warning' : 'info',
      category: 'Configuration',
      message: issue.message,
    });
  }

  // Environment issues
  for (const issue of envIssues) {
    if (issue.status === 'warning') {
      issues.push({
        severity: 'info',
        category: 'Environment',
        message: issue.message,
      });
    }
  }

  // Calculate score
  const totalChecks = adapterResults.length + modelResults.length + configIssues.length + envIssues.length;
  const passedChecks = adapterResults.filter(r => r.available).length +
    modelResults.filter(m => m.status === 'ok').length +
    configIssues.filter(c => c.status === 'ok').length +
    envIssues.filter(e => e.status === 'ok').length;
  const score = Math.round((passedChecks / totalChecks) * 100);

  // Generate recommendations
  const recommendations = generateRecommendations(issues, adapterResults, modelResults, config);

  const report: AuditReport = {
    score,
    summary: score >= 90 ? 'Excellent' : score >= 70 ? 'Good' : score >= 50 ? 'Needs Attention' : 'Critical',
    issues,
    checks: {
      adapters: adapterResults,
      models: modelResults,
      config: configIssues,
      environment: envIssues,
    },
    recommendations,
  };

  // Output
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    renderTextReport(report, options.verbose ?? false);
  }

  const duration = Date.now() - startTime;
  if (!options.json) {
    console.log(pc.dim(`\nAudit completed in ${(duration / 1000).toFixed(2)}s`));
  }

  // Handle --fix option
  if (options.fix && !options.json) {
    const fixableIssues = issues.filter(i => i.autoFixable && (i.fixAction || i.installCmd));

    if (fixableIssues.length === 0) {
      console.log(pc.yellow('\nNo auto-fixable issues found.'));
      console.log(pc.dim('Some issues require manual intervention:'));
      const manualIssues = issues.filter(i => !i.autoFixable && i.fix);
      for (const issue of manualIssues.slice(0, 5)) {
        console.log(pc.dim(`  • ${issue.message}`));
        console.log(pc.dim(`    → ${issue.fix}`));
      }
    } else {
      console.log(pc.cyan('\n═══ Auto-Fix Mode ═══\n'));
      console.log(pc.bold(`Found ${fixableIssues.length} fixable issue(s):\n`));

      // Show what will be fixed
      for (const issue of fixableIssues) {
        console.log(`  ${pc.yellow('→')} ${issue.message}`);
        if (issue.installCmd) {
          console.log(`    ${pc.dim('Install: ' + issue.installCmd)}`);
        } else if (issue.fix) {
          console.log(`    ${pc.dim('Fix: ' + issue.fix)}`);
        }
      }

      // Apply fixes
      console.log(pc.cyan('\nApplying fixes...\n'));
      let currentConfig = { ...config };

      // First, run any installation commands
      const installIssues = fixableIssues.filter(i => i.installCmd);
      for (const issue of installIssues) {
        if (issue.installCmd) {
          const toolName = issue.message.split(' is not')[0];
          console.log(`  ${pc.blue('⧗')} Installing ${toolName}...`);
          try {
            await execa('npm', ['install', '-g', issue.installCmd.replace('npm install -g ', '')], {
              timeout: 120000,
              stdio: 'pipe'
            });
            console.log(`  ${pc.green('✓')} Installed: ${toolName}`);
          } catch (err) {
            const error = err as Error & { stderr?: string };
            console.log(`  ${pc.red('✗')} Failed to install: ${toolName}`);
            console.log(`    ${pc.dim(error.stderr || error.message)}`);
            console.log(`    ${pc.dim('Try manually: ' + issue.installCmd)}`);
          }
        }
      }

      // Then, apply config fixes
      const configIssues = fixableIssues.filter(i => i.fixAction);
      for (const issue of configIssues) {
        if (issue.fixAction) {
          try {
            currentConfig = issue.fixAction(currentConfig);
            console.log(`  ${pc.green('✓')} Fixed: ${issue.message.split(':')[0]}`);
          } catch (err) {
            console.log(`  ${pc.red('✗')} Failed to fix: ${issue.message.split(':')[0]}`);
            console.log(`    ${pc.dim((err as Error).message)}`);
          }
        }
      }

      // Save config if any config changes were made
      if (configIssues.length > 0) {
        try {
          saveConfig(currentConfig);
          console.log(pc.green('\n✓ Configuration saved successfully!'));
          console.log(pc.dim(`  Config path: ${getConfigPath()}`));
        } catch (err) {
          console.log(pc.red('\n✗ Failed to save configuration:'));
          console.log(pc.dim(`  ${(err as Error).message}`));
        }
      }

      console.log(pc.cyan('\nRun "pk-puzldai audit" again to verify fixes.'));
    }
  } else {
    // Exit with error code if critical issues found
    const hasCritical = issues.some(i => i.severity === 'critical');
    const hasFixable = issues.some(i => i.autoFixable);

    if (hasCritical && !options.json) {
      if (hasFixable) {
        console.log(pc.red('\n[!] Critical issues detected. Run with --fix for automated fixes.'));
      } else {
        console.log(pc.red('\n[!] Critical issues detected. Manual intervention required.'));
      }
    }
  }
}

/**
 * Render text report
 */
function renderTextReport(report: AuditReport, verbose: boolean): void {
  // Score header
  const scoreColor = report.score >= 90 ? 'green' : report.score >= 70 ? 'yellow' : 'red';
  console.log(pc.bold(`Health Score: ${pc[scoreColor](`${report.score}%`)} (${report.summary})`));
  console.log('');

  // Summary section
  console.log(pc.bold(pc.underline('Summary')));
  const adapterCount = report.checks.adapters.filter(a => a.available).length;
  const modelCount = report.checks.models.filter(m => m.status === 'ok').length;
  console.log(`  Adapters: ${adapterCount}/${report.checks.adapters.length} available`);
  console.log(`  Models: ${modelCount}/${report.checks.models.length} configured`);
  console.log(`  Issues: ${report.issues.length} found`);
  console.log('');

  // Issues section
  if (report.issues.length > 0) {
    console.log(pc.bold(pc.underline('Issues')));
    const byCategory = groupBy(report.issues, 'category');
    for (const [category, items] of Object.entries(byCategory)) {
      console.log(`\n  ${pc.cyan(category)}:`);
      for (const issue of items) {
        const icon = issue.severity === 'critical' ? '✗' : issue.severity === 'warning' ? '!' : 'i';
        const color = issue.severity === 'critical' ? 'red' : issue.severity === 'warning' ? 'yellow' : 'blue';
        console.log(`    ${pc[color](icon)} ${issue.message}`);
        if (verbose && issue.fix) {
          console.log(`       ${pc.dim('Fix: ' + issue.fix)}`);
        }
      }
    }
    console.log('');
  }

  // Recommendations section
  if (report.recommendations.length > 0) {
    console.log(pc.bold(pc.underline('Recommendations')));
    for (const rec of report.recommendations) {
      console.log(`  ${pc.cyan('→')} ${rec}`);
    }
    console.log('');
  }

  // Verbose section - detailed checks
  if (verbose) {
    console.log(pc.bold(pc.underline('Detailed Checks')));

    // Adapters
    console.log('\n  Adapters:');
    for (const result of report.checks.adapters) {
      const icon = result.available ? pc.green('✓') : pc.red('✗');
      const name = result.available ? result.name : pc.dim(result.name);
      const version = result.version ? pc.dim(` (${result.version})`) : '';
      const error = result.error ? pc.red(` - ${result.error}`) : '';
      console.log(`    ${icon} ${name}${version}${error}`);
    }

    // Models
    console.log('\n  Models:');
    for (const model of report.checks.models) {
      const icon = model.status === 'ok' ? pc.green('✓') : pc.yellow('!');
      const name = model.status === 'ok' ? model.name : pc.yellow(model.name);
      const actual = model.actual ? pc.dim(` (${model.actual})`) : '';
      console.log(`    ${icon} ${name}: ${model.expected}${actual}`);
    }

    // Config
    console.log('\n  Configuration:');
    for (const cfg of report.checks.config) {
      const icon = cfg.status === 'ok' ? pc.green('✓') : pc.yellow('!');
      const message = cfg.status === 'ok' ? cfg.message : pc.yellow(cfg.message);
      console.log(`    ${icon} ${cfg.name}: ${message}`);
    }

    // Environment
    console.log('\n  Environment:');
    for (const env of report.checks.environment) {
      const icon = env.status === 'ok' ? pc.green('✓') : pc.yellow('!');
      const message = env.status === 'ok' ? env.message : pc.yellow(env.message);
      console.log(`    ${icon} ${env.name}: ${message}`);
    }

    console.log('');
  }
}

/**
 * Check all adapters
 */
async function checkAdapters(config: PulzdConfig): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const adapter of ADAPTER_PRIORITY) {
    const cfg = config.adapters[adapter.key as keyof typeof config.adapters] as { enabled: boolean; path: string; model?: string } | undefined;
    const enabled = cfg?.enabled ?? false;

    if (!enabled) {
      results.push({ name: adapter.name, available: false, error: 'disabled in config' });
      continue;
    }

    try {
      const { stdout } = await execa(adapter.path, adapter.flags, { timeout: 15000 });
      const version = stdout.trim().split('\n')[0].slice(0, 50);
      results.push({ name: adapter.name, available: true, version });
    } catch (err: unknown) {
      const error = err as Error & { code?: string };
      const msg = error.code === 'ENOENT' ? 'not found in PATH' : error.message;
      results.push({ name: adapter.name, available: false, error: msg });
    }
  }

  return results;
}

/**
 * Check model configurations
 */
async function checkModels(config: PulzdConfig): Promise<{ name: string; expected: string; actual?: string; status: 'ok' | 'missing' | 'mismatch' }[]> {
  const results: { name: string; expected: string; actual?: string; status: 'ok' | 'missing' | 'mismatch' }[] = [];

  for (const adapter of ADAPTER_PRIORITY) {
    const cfg = config.adapters[adapter.key as keyof typeof config.adapters] as { enabled: boolean; model?: string } | undefined;
    const enabled = cfg?.enabled ?? false;

    if (!enabled) continue;

    const expected = RECOMMENDED_MODELS[adapter.key] || 'default';
    const actual = cfg?.model;

    if (actual && actual !== expected && expected !== undefined) {
      results.push({
        name: adapter.name,
        expected,
        actual,
        status: 'mismatch'
      });
    } else {
      results.push({
        name: adapter.name,
        expected: actual || expected,
        status: actual ? 'ok' : 'ok'
      });
    }
  }

  // Check Ollama models specifically
  if (config.adapters.ollama.enabled) {
    try {
      const response = await fetch(`${config.adapters.ollama.host}/api/tags`, {
        signal: AbortSignal.timeout(3000)
      });
      if (response.ok) {
        const data = await response.json() as { models: Array<{ name: string }> };
        const routerBase = config.routerModel.split(':')[0];
        const hasRouter = data.models?.some(m => m.name.includes(routerBase));
        results.push({
          name: 'Router Model',
          expected: config.routerModel,
          actual: hasRouter ? config.routerModel : undefined,
          status: hasRouter ? 'ok' : 'missing'
        });
      }
    } catch {
      results.push({
        name: 'Router Model',
        expected: config.routerModel,
        status: 'missing'
      });
    }
  }

  return results;
}

/**
 * Check configuration issues
 */
function checkConfigIssues(config: PulzdConfig): { name: string; status: 'ok' | 'warning'; message: string }[] {
  const issues: { name: string; status: 'ok' | 'warning'; message: string }[] = [];

  // Check default agent
  if (config.defaultAgent === 'auto') {
    issues.push({ name: 'Default Agent', status: 'ok', message: 'Auto-routing enabled' });
  } else {
    issues.push({ name: 'Default Agent', status: 'warning', message: `Fixed to ${config.defaultAgent} (auto-routing recommended)` });
  }

  // Check confidence threshold
  if (config.confidenceThreshold > 0.7) {
    issues.push({ name: 'Confidence Threshold', status: 'warning', message: `High threshold (${config.confidenceThreshold}) may cause more fallbacks` });
  } else if (config.confidenceThreshold < 0.4) {
    issues.push({ name: 'Confidence Threshold', status: 'warning', message: `Low threshold (${config.confidenceThreshold}) may cause misrouting` });
  } else {
    issues.push({ name: 'Confidence Threshold', status: 'ok', message: `Optimized (${config.confidenceThreshold})` });
  }

  // Check timeout
  if (config.timeout > 300000) {
    issues.push({ name: 'Timeout', status: 'warning', message: `Very long timeout (${config.timeout}ms) - consider reducing` });
  } else if (config.timeout < 60000) {
    issues.push({ name: 'Timeout', status: 'warning', message: `Short timeout (${config.timeout}ms) - complex tasks may fail` });
  } else {
    issues.push({ name: 'Timeout', status: 'ok', message: `Configured (${config.timeout}ms)` });
  }

  // Check factory autonomy level
  const factory = config.adapters.factory;
  if (factory?.enabled && factory.autonomy === 'high' && !factory.skipPermissions) {
    issues.push({ name: 'Factory Autonomy', status: 'warning', message: 'High autonomy without skipPermissions may cause permission prompts' });
  }

  // Check ttyd enabled but no MCP
  if (config.ttyd.enabled && !config.mcp) {
    issues.push({ name: 'Web UI', status: 'warning', message: 'ttyd enabled but MCP not configured - Web UI may not work fully' });
  }

  return issues;
}

/**
 * Check environment
 */
async function checkEnvironment(): Promise<{ name: string; status: 'ok' | 'warning'; message: string }[]> {
  const issues: { name: string; status: 'ok' | 'warning'; message: string }[] = [];

  // Check Node.js version
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
  if (majorVersion >= 20) {
    issues.push({ name: 'Node.js', status: 'ok', message: `v${nodeVersion} (supported)` });
  } else {
    issues.push({ name: 'Node.js', status: 'warning', message: `v${nodeVersion} (v20+ recommended)` });
  }

  // Check config file
  const configPath = getConfigPath();
  if (existsSync(configPath)) {
    try {
      const configContent = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configContent);
      issues.push({ name: 'Config File', status: 'ok', message: `Valid JSON (${Object.keys(config).length} keys)` });
    } catch {
      issues.push({ name: 'Config File', status: 'warning', message: 'Invalid JSON - may cause issues' });
    }
  } else {
    issues.push({ name: 'Config File', status: 'warning', message: 'Not found - will use defaults' });
  }

  // Check terminal type
  if (process.env.TERM) {
    issues.push({ name: 'Terminal', status: 'ok', message: process.env.TERM });
  } else {
    issues.push({ name: 'Terminal', status: 'warning', message: 'TERM not set - some features may not work' });
  }

  // Check for CI environment
  if (process.env.CI) {
    issues.push({ name: 'Environment', status: 'ok', message: 'CI mode detected' });
  }

  return issues;
}

/**
 * Generate recommendations based on issues
 */
function generateRecommendations(
  issues: AuditIssue[],
  adapters: CheckResult[],
  models: { name: string; expected: string; actual?: string; status: string }[],
  config: PulzdConfig
): string[] {
  const recommendations: string[] = [];

  // Adapter recommendations (skip Ollama - it's optional)
  const disabledAdapters = adapters.filter(a =>
    !a.available &&
    !a.error?.includes('disabled') &&
    a.name !== 'Ollama'
  );
  if (disabledAdapters.length > 0) {
    const names = disabledAdapters.map(a => a.name).join(', ');
    recommendations.push(`Install or configure PATH for: ${names}`);
  }

  // Model recommendations (skip Router Model - it depends on optional Ollama)
  const missingModels = models.filter(m => m.status === 'missing' && m.name !== 'Router Model');
  if (missingModels.length > 0) {
    const names = missingModels.map(m => m.name).join(', ');
    recommendations.push(`Pull missing models: ${names}`);
  }

  // Configuration recommendations
  if (config.defaultAgent !== 'auto') {
    recommendations.push('Use "auto" as defaultAgent for intelligent routing');
  }

  if (config.confidenceThreshold > 0.7) {
    recommendations.push('Consider lowering confidenceThreshold to 0.6 for better routing');
  }

  // Factory recommendations
  const factory = config.adapters.factory;
  if (factory?.enabled && factory.autonomy === 'high' && !factory.skipPermissions) {
    recommendations.push('Set factory.skipPermissions: true for CI/CD pipelines');
  }

  // Ollama is optional - don't recommend it (requires local resources)

  return recommendations;
}

/**
 * Utility: Group array by key
 */
function groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
  return array.reduce((acc, item) => {
    const k = String(item[key]);
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}
