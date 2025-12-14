/**
 * CLI Observe Commands
 *
 * Manage and export observations from the command line.
 */

import {
  exportObservations,
  exportPreferencePairs,
  getExportSummary
} from '../../observation/exporter';
import { getRecentObservations } from '../../observation/logger';

/**
 * Show observation summary
 */
export function observeSummaryCommand(agent?: string): void {
  const summary = getExportSummary({ agent });

  console.log(agent ? `\nObservations (${agent}):` : '\nAll Observations:');
  console.log('─'.repeat(60));
  console.log(`Total observations: ${summary.observations}`);
  console.log(`Preference pairs: ${summary.preferencePairs}`);

  if (Object.keys(summary.bySignalType).length > 0) {
    console.log('\nBy signal type:');
    for (const [type, count] of Object.entries(summary.bySignalType)) {
      console.log(`  ${type}: ${count}`);
    }
  }
}

/**
 * List recent observations
 */
export function observeListCommand(options: { agent?: string; limit?: number }): void {
  const { agent, limit = 10 } = options;
  const observations = getRecentObservations({ agent, limit });

  if (observations.length === 0) {
    console.log(agent ? `No observations found for agent: ${agent}` : 'No observations found.');
    return;
  }

  console.log(agent ? `\nRecent Observations (${agent}):` : '\nRecent Observations:');
  console.log('─'.repeat(60));

  observations.forEach((obs, i) => {
    const date = new Date(obs.timestamp).toLocaleString();
    const prompt = obs.prompt?.slice(0, 80) || '(no prompt)';
    console.log(`${i + 1}. [${date}] ${obs.agent}/${obs.model}`);
    console.log(`   ${obs.tokensIn || 0} in / ${obs.tokensOut || 0} out | ${obs.durationMs || 0}ms`);
    console.log(`   ${prompt}${obs.prompt && obs.prompt.length > 80 ? '...' : ''}`);
    console.log('');
  });
}

/**
 * Export observations to file
 */
export function observeExportCommand(
  outputPath: string,
  options: {
    format?: 'jsonl' | 'json' | 'csv';
    agent?: string;
    limit?: number;
    type?: 'observations' | 'preferences';
    noContent?: boolean;
  }
): void {
  const {
    format = 'jsonl',
    agent,
    limit = 10000,
    type = 'observations',
    noContent = false
  } = options;

  console.log(`Exporting ${type} to ${outputPath} (${format})...`);

  const result = type === 'preferences'
    ? exportPreferencePairs({ outputPath, format, agent, limit })
    : exportObservations({ outputPath, format, agent, limit, includeContent: !noContent });

  if (result.success) {
    console.log(`Exported ${result.count} ${type} to ${result.path}`);
  } else {
    console.error(`Export failed: ${result.error}`);
    process.exit(1);
  }
}
