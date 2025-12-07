/**
 * CLI Session Commands
 *
 * Manage chat sessions from the command line.
 */

import {
  listSessions,
  loadSession,
  deleteSession,
  clearSessionHistory,
  getSessionStats,
  createSession
} from '../../memory';

/**
 * List all sessions
 */
export function sessionListCommand(agent?: string): void {
  const sessions = listSessions(agent);

  if (sessions.length === 0) {
    console.log(agent ? `No sessions found for agent: ${agent}` : 'No sessions found.');
    return;
  }

  console.log(agent ? `\nSessions (${agent}):` : '\nAll Sessions:');
  console.log('─'.repeat(60));

  sessions.forEach((s, i) => {
    const date = new Date(s.updatedAt).toLocaleString();
    console.log(`${i + 1}. ${s.id}`);
    console.log(`   Agent: ${s.agent} | Messages: ${s.messageCount} | Tokens: ${s.totalTokens}`);
    console.log(`   Updated: ${date}`);
    console.log(`   Preview: ${s.preview}`);
    console.log('');
  });
}

/**
 * Create a new session
 */
export function sessionNewCommand(agent: string = 'auto'): void {
  const session = createSession(agent);
  console.log(`Created new session: ${session.id}`);
  console.log(`Agent: ${session.agent}`);
}

/**
 * Show session details
 */
export function sessionInfoCommand(sessionId: string): void {
  const session = loadSession(sessionId);

  if (!session) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }

  const stats = getSessionStats(session);

  console.log(`\nSession: ${session.id}`);
  console.log('─'.repeat(60));
  console.log(`Agent: ${session.agent}`);
  console.log(`Messages: ${stats.messageCount}`);
  console.log(`Tokens: ${stats.totalTokens} (recent: ${stats.recentTokens}, summary: ${stats.summaryTokens})`);
  console.log(`Compression: ${stats.compressionRatio}%`);
  console.log(`Created: ${new Date(session.createdAt).toLocaleString()}`);
  console.log(`Updated: ${new Date(session.updatedAt).toLocaleString()}`);

  if (session.summary) {
    console.log(`\nSummary:`);
    console.log('─'.repeat(40));
    console.log(session.summary);
  }

  if (session.messages.length > 0) {
    console.log(`\nRecent Messages (${session.messages.length}):`);
    console.log('─'.repeat(40));
    session.messages.slice(-5).forEach(m => {
      const prefix = m.role === 'user' ? '>' : '←';
      const preview = m.content.slice(0, 100) + (m.content.length > 100 ? '...' : '');
      console.log(`${prefix} [${m.role}] ${preview}`);
    });
  }
}

/**
 * Delete a session
 */
export function sessionDeleteCommand(sessionId: string): void {
  if (deleteSession(sessionId)) {
    console.log(`Deleted session: ${sessionId}`);
  } else {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }
}

/**
 * Clear session history (keeps session, removes messages)
 */
export function sessionClearCommand(sessionId: string): void {
  const session = loadSession(sessionId);

  if (!session) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }

  clearSessionHistory(session);
  console.log(`Cleared session history: ${sessionId}`);
}
