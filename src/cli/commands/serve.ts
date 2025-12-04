import { execa } from 'execa';
import { spawn } from 'child_process';
import pc from 'picocolors';
import { resolve } from 'path';
import { getConfig } from '../../lib/config';
import { startServer } from '../../api/server';

interface ServeOptions {
  port?: number;
  host?: string;
  web?: boolean;
  terminalPort?: number;
}

export async function serveCommand(options: ServeOptions): Promise<void> {
  const config = getConfig();
  const port = options.port || config.api.port;
  const host = options.host || config.api.host;

  console.log(pc.bold('\nStarting PulzdAI Server\n'));

  try {
    await startServer({ port, host });

    console.log(pc.green(`✓ API server running at http://${host}:${port}`));
    console.log(pc.dim(`  POST /task - Submit a task`));
    console.log(pc.dim(`  GET  /task/:id - Get task result`));
    console.log(pc.dim(`  GET  /task/:id/stream - SSE stream`));
    console.log(pc.dim(`  GET  /agents - List agents`));
    console.log(pc.dim(`  GET  /health - Health check`));

    if (options.web && config.ttyd.enabled) {
      const ttydPort = options.terminalPort || config.ttyd.port;
      try {
        await execa('which', ['ttyd']);

        // Use the current runtime and script to launch agent mode
        const runtime = process.argv[0]; // bun or node
        const script = resolve(process.cwd(), 'src/cli/index.ts');

        // Use native spawn for detached process to avoid execa tracking
        // -W enables writable mode (client can send input)
        const ttyd = spawn('ttyd', ['-W', '-p', String(ttydPort), runtime, script, 'agent'], {
          stdio: 'ignore',
          detached: true
        });
        ttyd.unref();

        console.log(pc.green(`\n✓ Terminal at http://${host}:${ttydPort}`));
      } catch {
        console.log(pc.yellow('\n⚠ ttyd not available (run "ai check" for details)'));
      }
    }

    console.log(pc.dim('\nPress Ctrl+C to stop'));
  } catch (err: unknown) {
    const error = err as Error;
    console.error(pc.red(`Failed to start server: ${error.message}`));
    process.exit(1);
  }
}
