/**
 * Unified Session Storage
 *
 * SQLite-backed session storage using the unified message format.
 * Enables seamless agent switching while preserving full context.
 */

import { getDatabase } from '../memory/database';
import type { UnifiedMessage, MessagePart } from './unified-message';
import { estimateMessageTokens } from './unified-message';

/**
 * Unified session - agent-agnostic conversation container
 */
export interface UnifiedSession {
  id: string;
  name?: string;
  messages: UnifiedMessage[];
  summary: string;
  summaryTokens: number;
  totalTokens: number;
  messageCount: number;
  // Track which agents have been used
  agentsUsed: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Session metadata for listing
 */
export interface UnifiedSessionMeta {
  id: string;
  name?: string;
  messageCount: number;
  totalTokens: number;
  agentsUsed: string[];
  createdAt: number;
  updatedAt: number;
  preview: string;
}

/**
 * Initialize unified messages table (called automatically via database migration)
 * This is a no-op now since migration 3 handles table creation.
 */
export function initUnifiedMessagesTable(): void {
  // Tables are created by migration 3 in database.ts
  // This function is kept for backwards compatibility
  getDatabase(); // Ensure database is initialized with migrations
}

/**
 * Generate session ID
 */
function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 6);
  return `unified_${timestamp}_${random}`;
}

/**
 * Create a new unified session
 */
export function createUnifiedSession(name?: string): UnifiedSession {
  const db = getDatabase();
  const now = Date.now();
  const id = generateSessionId();

  db.prepare(`
    INSERT INTO unified_sessions (id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(id, name ?? null, now, now);

  return {
    id,
    name,
    messages: [],
    summary: '',
    summaryTokens: 0,
    totalTokens: 0,
    messageCount: 0,
    agentsUsed: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Load a unified session by ID
 */
export function loadUnifiedSession(sessionId: string): UnifiedSession | null {
  const db = getDatabase();

  const row = db.prepare(`
    SELECT id, name, summary, summary_tokens, total_tokens, message_count,
           agents_used, created_at, updated_at
    FROM unified_sessions WHERE id = ?
  `).get(sessionId) as {
    id: string;
    name: string | null;
    summary: string;
    summary_tokens: number;
    total_tokens: number;
    message_count: number;
    agents_used: string;
    created_at: number;
    updated_at: number;
  } | undefined;

  if (!row) return null;

  // Load messages
  const messageRows = db.prepare(`
    SELECT id, session_id, role, content, agent, model,
           tokens_input, tokens_output, timestamp
    FROM unified_messages
    WHERE session_id = ?
    ORDER BY timestamp ASC
  `).all(sessionId) as Array<{
    id: number;
    session_id: string;
    role: string;
    content: string;
    agent: string | null;
    model: string | null;
    tokens_input: number;
    tokens_output: number;
    timestamp: number;
  }>;

  const messages: UnifiedMessage[] = messageRows.map(m => ({
    id: m.id,
    sessionId: m.session_id,
    role: m.role as UnifiedMessage['role'],
    content: JSON.parse(m.content) as MessagePart[],
    agent: m.agent ?? undefined,
    model: m.model ?? undefined,
    tokens: m.tokens_input || m.tokens_output ? {
      input: m.tokens_input,
      output: m.tokens_output,
    } : undefined,
    timestamp: m.timestamp,
  }));

  return {
    id: row.id,
    name: row.name ?? undefined,
    messages,
    summary: row.summary,
    summaryTokens: row.summary_tokens,
    totalTokens: row.total_tokens,
    messageCount: row.message_count,
    agentsUsed: JSON.parse(row.agents_used),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Save session metadata (not messages - use addUnifiedMessage for that)
 */
export function saveUnifiedSession(session: UnifiedSession): void {
  const db = getDatabase();

  db.prepare(`
    UPDATE unified_sessions SET
      name = ?,
      summary = ?,
      summary_tokens = ?,
      total_tokens = ?,
      message_count = ?,
      agents_used = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    session.name ?? null,
    session.summary,
    session.summaryTokens,
    session.totalTokens,
    session.messageCount,
    JSON.stringify(session.agentsUsed),
    session.updatedAt,
    session.id
  );
}

/**
 * Add a message to a session
 */
export function addUnifiedMessage(
  session: UnifiedSession,
  message: Omit<UnifiedMessage, 'id' | 'sessionId'>
): UnifiedSession {
  const db = getDatabase();
  const now = Date.now();

  // Insert message
  const result = db.prepare(`
    INSERT INTO unified_messages
    (session_id, role, content, agent, model, tokens_input, tokens_output, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    session.id,
    message.role,
    JSON.stringify(message.content),
    message.agent ?? null,
    message.model ?? null,
    message.tokens?.input ?? 0,
    message.tokens?.output ?? 0,
    message.timestamp
  );

  const fullMessage: UnifiedMessage = {
    id: Number(result.lastInsertRowid),
    sessionId: session.id,
    ...message,
  };

  // Update agents used
  const agentsUsed = [...session.agentsUsed];
  if (message.agent && !agentsUsed.includes(message.agent)) {
    agentsUsed.push(message.agent);
  }

  // Calculate new totals
  const messageTokens = estimateMessageTokens(fullMessage);
  const updatedSession: UnifiedSession = {
    ...session,
    messages: [...session.messages, fullMessage],
    totalTokens: session.totalTokens + messageTokens,
    messageCount: session.messageCount + 1,
    agentsUsed,
    updatedAt: now,
  };

  // Save session metadata
  saveUnifiedSession(updatedSession);

  return updatedSession;
}

/**
 * List all unified sessions
 */
export function listUnifiedSessions(): UnifiedSessionMeta[] {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT s.*,
      COALESCE(
        (SELECT SUBSTR(content, 1, 200) FROM unified_messages
         WHERE session_id = s.id ORDER BY timestamp LIMIT 1),
        SUBSTR(s.summary, 1, 200),
        '(empty)'
      ) as preview
    FROM unified_sessions s
    ORDER BY s.updated_at DESC
  `).all() as Array<{
    id: string;
    name: string | null;
    message_count: number;
    total_tokens: number;
    agents_used: string;
    created_at: number;
    updated_at: number;
    preview: string;
  }>;

  return rows.map(row => {
    // Try to parse preview as JSON (it's the content field)
    let preview = row.preview;
    try {
      const content = JSON.parse(preview) as MessagePart[];
      const textPart = content.find(p => p.type === 'text');
      if (textPart && 'content' in textPart) {
        preview = textPart.content.slice(0, 100);
      }
    } catch {
      // Keep as-is if not JSON
      preview = preview.slice(0, 100);
    }

    return {
      id: row.id,
      name: row.name ?? undefined,
      messageCount: row.message_count,
      totalTokens: row.total_tokens,
      agentsUsed: JSON.parse(row.agents_used),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      preview: preview.length >= 100 ? preview + '...' : preview,
    };
  });
}

/**
 * Delete a unified session
 */
export function deleteUnifiedSession(sessionId: string): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM unified_sessions WHERE id = ?').run(sessionId);
  return result.changes > 0;
}

/**
 * Get or create the latest unified session
 */
export function getLatestUnifiedSession(): UnifiedSession {
  const sessions = listUnifiedSessions();

  if (sessions.length > 0) {
    const latest = loadUnifiedSession(sessions[0].id);
    if (latest) return latest;
  }

  return createUnifiedSession();
}

/**
 * Clear session messages but keep metadata
 */
export function clearUnifiedSessionMessages(session: UnifiedSession): UnifiedSession {
  const db = getDatabase();
  const now = Date.now();

  // Delete all messages
  db.prepare('DELETE FROM unified_messages WHERE session_id = ?').run(session.id);

  const cleared: UnifiedSession = {
    ...session,
    messages: [],
    summary: '',
    summaryTokens: 0,
    totalTokens: 0,
    messageCount: 0,
    updatedAt: now,
  };

  saveUnifiedSession(cleared);
  return cleared;
}

/**
 * Update session summary (after compaction)
 */
export function updateUnifiedSessionSummary(
  session: UnifiedSession,
  summary: string,
  summaryTokens: number
): UnifiedSession {
  const updated: UnifiedSession = {
    ...session,
    summary,
    summaryTokens,
    updatedAt: Date.now(),
  };

  saveUnifiedSession(updated);
  return updated;
}

/**
 * Get session statistics
 */
export function getUnifiedSessionStats(session: UnifiedSession): {
  messageCount: number;
  totalTokens: number;
  agentBreakdown: Record<string, number>;
  avgTokensPerMessage: number;
} {
  const agentBreakdown: Record<string, number> = {};

  for (const msg of session.messages) {
    const agent = msg.agent ?? 'unknown';
    agentBreakdown[agent] = (agentBreakdown[agent] ?? 0) + 1;
  }

  return {
    messageCount: session.messageCount,
    totalTokens: session.totalTokens,
    agentBreakdown,
    avgTokensPerMessage: session.messageCount > 0
      ? Math.round(session.totalTokens / session.messageCount)
      : 0,
  };
}
