import { execa } from 'execa';
import pc from 'picocolors';
import { createSpinner } from 'nanospinner';
import type { CheckResult } from '../../lib/types';
import { getConfig } from '../../lib/config';

export async function checkCommand(): Promise<void> {
  console.log(pc.bold('\nPulzdAI Dependency Check\n'));

  const spinner = createSpinner('Checking dependencies...').start();
  const results = await checkDependencies();
  spinner.stop();

  for (const result of results) {
    const status = result.available ? pc.green('✓') : pc.red('✗');
    const name = result.available ? result.name : pc.dim(result.name);
    const version = result.version ? pc.dim(` (${result.version})`) : '';
    const error = result.error ? pc.red(` - ${result.error}`) : '';

    console.log(`${status} ${name}${version}${error}`);
  }

  const allGood = results.every(r => r.available);
  const available = results.filter(r => r.available).length;

  console.log('');
  if (allGood) {
    console.log(pc.green('✓ All dependencies ready!'));
  } else {
    console.log(pc.yellow(`${available}/${results.length} dependencies available`));
  }
}

async function checkDependencies(): Promise<CheckResult[]> {
  const config = getConfig();
  const results: CheckResult[] = [];

  const cliChecks = [
    { name: 'claude', cmd: config.adapters.claude.path, args: ['--version'] },
    { name: 'gemini', cmd: config.adapters.gemini.path, args: ['--version'] },
    { name: 'codex', cmd: config.adapters.codex.path, args: ['--version'] },
    { name: 'ollama', cmd: 'ollama', args: ['--version'] },
    { name: 'ttyd', cmd: 'ttyd', args: ['--version'] },
  ];

  for (const { name, cmd, args } of cliChecks) {
    try {
      const { stdout } = await execa(cmd, args, { timeout: 5000 });
      const version = stdout.trim().split('\n')[0].slice(0, 50);
      results.push({ name, available: true, version });
    } catch (err: unknown) {
      const error = err as Error & { code?: string };
      const msg = error.code === 'ENOENT' ? 'not found' : error.message;
      results.push({ name, available: false, error: msg });
    }
  }

  // Check Ollama server and router model in one fetch
  try {
    const response = await fetch(`${config.adapters.ollama.host}/api/tags`, {
      signal: AbortSignal.timeout(3000)
    });
    if (response.ok) {
      results.push({ name: 'ollama-server', available: true });

      const data = await response.json() as { models: Array<{ name: string }> };
      const routerBase = config.routerModel.split(':')[0];
      const hasRouter = data.models?.some(m => m.name.includes(routerBase));
      results.push({
        name: `router-model (${config.routerModel})`,
        available: hasRouter,
        error: hasRouter ? undefined : 'model not found'
      });
    } else {
      results.push({ name: 'ollama-server', available: false, error: 'bad response' });
      results.push({ name: `router-model (${config.routerModel})`, available: false, error: 'cannot check' });
    }
  } catch {
    results.push({ name: 'ollama-server', available: false, error: 'not running' });
    results.push({ name: `router-model (${config.routerModel})`, available: false, error: 'cannot check' });
  }

  return results;
}
