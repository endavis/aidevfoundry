/**
 * MCP Status Command
 *
 * Shows the current MCP bridge status including:
 * - Connection state (connected/disconnected/local)
 * - Local bridge availability
 * - Cloud vs local mode
 */

import pc from 'picocolors';
import { getConfig } from '../../lib/config';
import { getBridgeState, getCapabilities } from '../../mcp/bridge';
import { isConnected, getConnectionState } from '../../mcp/ws-client';

interface McpStatus {
  mode: 'cloud' | 'local' | 'offline';
  connectionState: {
    connected: boolean;
    reconnectAttempts: number;
    busy: boolean;
    currentExecutionId: string | null;
  };
  localBridge: {
    running: boolean;
    port: number;
    host: string;
  };
  machineId?: string;
}

export async function mcpStatusCommand(): Promise<void> {
  const config = getConfig();
  const hasToken = !!config.cloud?.token;
  const cloudConnected = isConnected();
  const bridgeState = getBridgeState();
  const connectionState = getConnectionState();

  // Determine mode
  let mode: 'cloud' | 'local' | 'offline';
  if (cloudConnected && hasToken) {
    mode = 'cloud';
  } else if (bridgeState.running) {
    mode = 'local';
  } else {
    mode = 'offline';
  }

  // Get capabilities if local bridge is running
  let capabilities: Awaited<ReturnType<typeof getCapabilities>> | undefined;
  if (bridgeState.running) {
    try {
      capabilities = await getCapabilities();
    } catch {
      // Bridge might not be fully initialized
    }
  }

  // Get machine ID
  const machineId = config.cloud?.machineId || 'not configured';

  const _status: McpStatus = {
    mode,
    connectionState,
    localBridge: {
      running: bridgeState.running,
      port: bridgeState.port,
      host: bridgeState.host
    },
    machineId
  };

  // Display status
  console.log(pc.bold('\nPuzldAI MCP Status\n'));
  console.log(`${pc.dim('Machine ID:')} ${machineId}`);
  console.log('');

  // Mode indicator
  const modeIndicator = () => {
    switch (mode) {
      case 'cloud':
        return `${pc.green('●')} Cloud (WebSocket connected)`;
      case 'local':
        return `${pc.yellow('●')} Local (HTTP bridge)`;
      case 'offline':
        return `${pc.red('●')} Offline`;
    }
  };
  console.log(`${pc.dim('Mode:')} ${modeIndicator()}`);

  // Connection details
  if (mode === 'cloud') {
    console.log(`${pc.dim('Endpoint:')} ${config.cloud?.endpoint || 'https://api.puzld.cc'}`);
    if (connectionState.reconnectAttempts > 0) {
      console.log(`${pc.dim('Reconnects:')} ${connectionState.reconnectAttempts}`);
    }
  }

  // Local bridge details
  if (mode === 'local') {
    console.log(`${pc.dim('Local Bridge:')} http://${bridgeState.host}:${bridgeState.port}`);
    console.log(`${pc.dim('Endpoints:')}`);
    console.log(`  ${pc.dim('GET  /mcp/health')} - Health check`);
    console.log(`  ${pc.dim('GET  /mcp/capabilities')} - Capabilities`);
    console.log(`  ${pc.dim('POST /mcp/execute')} - Execute intent`);
    if (!hasToken) {
      console.log(`\n${pc.yellow('Tip:')} Run ${pc.cyan('"puzld login"')} to enable cloud mode`);
    }
  }

  // Capabilities
  if (capabilities) {
    console.log('');
    console.log(`${pc.dim('Agents:')} ${capabilities.agents.join(', ') || 'none'}`);
    console.log(`${pc.dim('Modes:')} ${capabilities.modes.join(', ')}`);
    console.log(`${pc.dim('Version:')} ${capabilities.version}`);
  }

  // Busy indicator
  if (connectionState.busy) {
    console.log(`\n${pc.yellow('● Busy executing:')} ${connectionState.currentExecutionId || 'unknown'}`);
  }

  // Token status
  console.log('');
  const tokenStatus = hasToken
    ? `${pc.green('✓')} Token configured`
    : `${pc.red('✗')} No token (run "puzld login")`;
  console.log(`${pc.dim('Auth:')} ${tokenStatus}`);

  // Instructions
  console.log('');
  console.log(pc.dim('Commands:'));
  console.log(`  ${pc.cyan('pk-puzldai serve --mcp')}   Start MCP bridge`);
  console.log(`  ${pc.cyan('pk-puzldai mcp-status')}    Show this status`);
  console.log(`  ${pc.cyan('pk-puzldai login')}         Connect to cloud`);
  console.log('');
}
