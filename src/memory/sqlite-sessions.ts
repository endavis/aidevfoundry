/**
 * SQLite-backed Session Storage (Phase 8)
 *
 * Drop-in replacement for JSON-based sessions.ts with SQLite persistence.
 * All methods are synchronous except addMessage (uses async summarizer).
 *
 * Timestamps are Unix epoch milliseconds (Date.now()).
 */

import { getDatabase } from './database';
import { estimateTokens } from '../context/tokens';
import { summarizeIfNeeded, isSummarizerAvailable } from '../context/summarizer';

/**
 * Message in a session (includes DB id for deletion)
 */
export interface Message {
  id?: number;                // DB primary key (optional for new messages)
  role: 'user' | 'assistant' | 'system';
  content: string;
  tokens: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * Agent session with conversation history
 */
export interface AgentSession {
  id: string;
  agent: string;
  messages: Message[];
  summary: string;
  summaryTokens: number;
  totalTokens: number;
  messageCount: number;
  templateId?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Session metadata for listing (lightweight)
 */
export interface SessionMeta {
  id: string;
  agent: string;
  messageCount: number;
  totalTokens: number;
  createdAt: number;
  updatedAt: number;
  preview: string;
}

/**
 * Session manager configuration
 */
export interface SessionConfig {
  maxTokens?: number;
  keepRecentMessages?: number;
  autoSave?: boolean;
}

const DEFAULT_CONFIG: Required<SessionConfig> = {
  maxTokens: 8000,
  keepRecentMessages: 10,
  autoSave: true
};

/**
 * Generate a session ID
 */
function generateSessionId(agent: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 6);
  return `${agent}_${timestamp}_${random}`;
}

/**
 * Create a new session
 */
export function createSession(agent: string, templateId?: string): AgentSession {
  const db = getDatabase();
  const now = Date.now();
  const id = generateSessionId(agent);

  db.prepare(`
    INSERT INTO sessions (id, agent, summary, summary_tokens, total_tokens, message_count, template_id, created_at, updated_at)
    VALUES (?, ?, '', 0, 0, 0, ?, ?, ?)
  `).run(id, agent, templateId ?? null, now, now);

  return {
    id,
    agent,
    messages: [],
    summary: '',
    summaryTokens: 0,
    totalTokens: 0,
    messageCount: 0,
    templateId,
    createdAt: now,
    updatedAt: now
  };
}

/**
 * Load a session by ID
 */
export function loadSession(sessionId: string): AgentSession | null {
  const db = getDatabase();

  const row = db.prepare(`
    SELECT id, agent, summary, summary_tokens, total_tokens, message_count, template_id, created_at, updated_at
    FROM sessions WHERE id = ?
  `).get(sessionId) as {
    id: string;
    agent: string;
    summary: string;
    summary_tokens: number;
    total_tokens: number;
    message_count: number;
    template_id: string | null;
    created_at: number;
    updated_at: number;
  } | undefined;

  if (!row) return null;

  // Load messages
  const messages = db.prepare(`
    SELECT id, role, content, tokens, timestamp, metadata
    FROM messages WHERE session_id = ? ORDER BY timestamp ASC
  `).all(sessionId) as Array<{
    id: number;
    role: 'user' | 'assistant' | 'system';
    content: string;
    tokens: number;
    timestamp: number;
    metadata: string | null;
  }>;

  return {
    id: row.id,
    agent: row.agent,
    messages: messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      tokens: m.tokens,
      timestamp: m.timestamp,
      metadata: m.metadata ? JSON.parse(m.metadata) : undefined
    })),
    summary: row.summary,
    summaryTokens: row.summary_tokens,
    totalTokens: row.total_tokens,
    messageCount: row.message_count,
    templateId: row.template_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Save a session (updates session row, does NOT sync messages - use addMessage for that)
 */
export function saveSession(session: AgentSession): void {
  const db = getDatabase();

  db.prepare(`
    UPDATE sessions SET
      summary = ?,
      summary_tokens = ?,
      total_tokens = ?,
      message_count = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    session.summary,
    session.summaryTokens,
    session.totalTokens,
    session.messageCount,
    session.updatedAt,
    session.id
  );
}

/**
 * Delete a session and all its messages (CASCADE)
 */
export function deleteSession(sessionId: string): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  return result.changes > 0;
}

/**
 * List all sessions with preview (single efficient query)
 */
export function listSessions(agent?: string): SessionMeta[] {
  const db = getDatabase();

  // Use subquery for preview to avoid N+1
  const query = agent
    ? `
      SELECT s.*,
        COALESCE(
          (SELECT SUBSTR(content, 1, 100) FROM messages WHERE session_id = s.id AND role = 'user' ORDER BY timestamp LIMIT 1),
          SUBSTR(s.summary, 1, 100),
          '(empty)'
        ) as preview
      FROM sessions s
      WHERE s.agent = ?
      ORDER BY s.updated_at DESC
    `
    : `
      SELECT s.*,
        COALESCE(
          (SELECT SUBSTR(content, 1, 100) FROM messages WHERE session_id = s.id AND role = 'user' ORDER BY timestamp LIMIT 1),
          SUBSTR(s.summary, 1, 100),
          '(empty)'
        ) as preview
      FROM sessions s
      ORDER BY s.updated_at DESC
    `;

  const rows = agent
    ? db.prepare(query).all(agent)
    : db.prepare(query).all();

  return (rows as Array<{
    id: string;
    agent: string;
    message_count: number;
    total_tokens: number;
    created_at: number;
    updated_at: number;
    preview: string;
  }>).map(row => ({
    id: row.id,
    agent: row.agent,
    messageCount: row.message_count,
    totalTokens: row.total_tokens,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    preview: row.preview.length >= 100 ? row.preview + '...' : row.preview
  }));
}

/**
 * Get or create the latest session for an agent
 */
export function getLatestSession(agent: string): AgentSession {
  const sessions = listSessions(agent);

  if (sessions.length > 0) {
    const latest = loadSession(sessions[0].id);
    if (latest) return latest;
  }

  return createSession(agent);
}

/**
 * Add a message to a session
 */
export async function addMessage(
  session: AgentSession,
  role: 'user' | 'assistant' | 'system',
  content: string,
  config: SessionConfig = {},
  metadata?: Record<string, unknown>
): Promise<AgentSession> {
  const db = getDatabase();
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const tokens = estimateTokens(content);
  const now = Date.now();

  // Insert message
  const result = db.prepare(`
    INSERT INTO messages (session_id, role, content, tokens, timestamp, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    session.id,
    role,
    content,
    tokens,
    now,
    metadata ? JSON.stringify(metadata) : null
  );

  const message: Message = {
    id: Number(result.lastInsertRowid),
    role,
    content,
    tokens,
    timestamp: now,
    metadata
  };

  // Update session in memory
  const messages = [...session.messages, message];
  const totalTokens = session.totalTokens + tokens;

  let updatedSession: AgentSession = {
    ...session,
    messages,
    totalTokens,
    messageCount: session.messageCount + 1,
    updatedAt: now
  };

  // Check if we need to compress
  if (totalTokens > cfg.maxTokens) {
    updatedSession = await compressSession(updatedSession, cfg);
  }

  // Save session metadata
  if (cfg.autoSave) {
    saveSession(updatedSession);
  }

  return updatedSession;
}

/**
 * Compress session by summarizing old messages
 */
async function compressSession(
  session: AgentSession,
  config: Required<SessionConfig>
): Promise<AgentSession> {
  const db = getDatabase();
  const { keepRecentMessages, maxTokens } = config;

  // Split messages: old (to summarize) and recent (to keep)
  const splitIndex = Math.max(0, session.messages.length - keepRecentMessages);
  const oldMessages = session.messages.slice(0, splitIndex);
  const recentMessages = session.messages.slice(splitIndex);

  if (oldMessages.length === 0) {
    return session;
  }

  // Build text to summarize
  const oldText = oldMessages
    .map(m => `${m.role}: ${m.content}`)
    .join('\n\n');

  const textToSummarize = session.summary
    ? `Previous summary:\n${session.summary}\n\nNew messages:\n${oldText}`
    : oldText;

  // Target summary size
  const recentTokens = recentMessages.reduce((sum, m) => sum + m.tokens, 0);
  const targetSummaryTokens = Math.floor((maxTokens - recentTokens) * 0.3);

  let newSummary = session.summary;
  let summaryTokens = session.summaryTokens;

  // Try to summarize if Ollama is available
  if (await isSummarizerAvailable()) {
    try {
      newSummary = await summarizeIfNeeded(textToSummarize, targetSummaryTokens);
      summaryTokens = estimateTokens(newSummary);
    } catch {
      newSummary = textToSummarize.slice(0, targetSummaryTokens * 4);
      summaryTokens = estimateTokens(newSummary);
    }
  } else {
    newSummary = textToSummarize.slice(0, targetSummaryTokens * 4);
    summaryTokens = estimateTokens(newSummary);
  }

  // Delete old messages from DB by ID
  const oldMessageIds = oldMessages
    .filter(m => m.id !== undefined)
    .map(m => m.id);

  if (oldMessageIds.length > 0) {
    const placeholders = oldMessageIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).run(...oldMessageIds);
  }

  const newTotalTokens = summaryTokens + recentTokens;

  return {
    ...session,
    messages: recentMessages,
    summary: newSummary,
    summaryTokens,
    totalTokens: newTotalTokens,
    updatedAt: Date.now()
  };
}

/**
 * Get conversation history formatted for agent
 */
export function getConversationHistory(
  session: AgentSession,
  includeSystem: boolean = false
): string {
  const parts: string[] = [];

  if (session.summary) {
    parts.push(`<conversation_summary>\n${session.summary}\n</conversation_summary>`);
  }

  for (const msg of session.messages) {
    if (msg.role === 'system' && !includeSystem) continue;
    parts.push(`${msg.role}: ${msg.content}`);
  }

  return parts.join('\n\n');
}

/**
 * Search sessions by keyword (uses FTS-like LIKE query)
 */
export function searchSessions(keyword: string, agent?: string): SessionMeta[] {
  const db = getDatabase();
  const lowerKeyword = `%${keyword.toLowerCase()}%`;

  // Search in messages and summary with single query
  const query = agent
    ? `
      SELECT DISTINCT s.id, s.agent, s.message_count, s.total_tokens, s.created_at, s.updated_at,
        COALESCE(
          (SELECT SUBSTR(content, 1, 100) FROM messages WHERE session_id = s.id AND role = 'user' ORDER BY timestamp LIMIT 1),
          SUBSTR(s.summary, 1, 100),
          '(empty)'
        ) as preview
      FROM sessions s
      LEFT JOIN messages m ON m.session_id = s.id
      WHERE s.agent = ?
        AND (LOWER(m.content) LIKE ? OR LOWER(s.summary) LIKE ?)
      ORDER BY s.updated_at DESC
    `
    : `
      SELECT DISTINCT s.id, s.agent, s.message_count, s.total_tokens, s.created_at, s.updated_at,
        COALESCE(
          (SELECT SUBSTR(content, 1, 100) FROM messages WHERE session_id = s.id AND role = 'user' ORDER BY timestamp LIMIT 1),
          SUBSTR(s.summary, 1, 100),
          '(empty)'
        ) as preview
      FROM sessions s
      LEFT JOIN messages m ON m.session_id = s.id
      WHERE LOWER(m.content) LIKE ? OR LOWER(s.summary) LIKE ?
      ORDER BY s.updated_at DESC
    `;

  const rows = agent
    ? db.prepare(query).all(agent, lowerKeyword, lowerKeyword)
    : db.prepare(query).all(lowerKeyword, lowerKeyword);

  return (rows as Array<{
    id: string;
    agent: string;
    message_count: number;
    total_tokens: number;
    created_at: number;
    updated_at: number;
    preview: string;
  }>).map(row => ({
    id: row.id,
    agent: row.agent,
    messageCount: row.message_count,
    totalTokens: row.total_tokens,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    preview: row.preview.length >= 100 ? row.preview + '...' : row.preview
  }));
}

/**
 * Get session stats
 */
export function getSessionStats(session: AgentSession): {
  messageCount: number;
  totalTokens: number;
  summaryTokens: number;
  recentTokens: number;
  compressionRatio: number;
  oldestMessage: number | null;
  newestMessage: number | null;
} {
  const recentTokens = session.messages.reduce((sum, m) => sum + m.tokens, 0);
  const timestamps = session.messages.map(m => m.timestamp);

  // Safe compression ratio calculation
  const compressedTokens = session.totalTokens - recentTokens + session.summaryTokens;
  const compressionRatio = session.summaryTokens > 0 && compressedTokens > 0
    ? Math.round((1 - session.summaryTokens / compressedTokens) * 100)
    : 0;

  return {
    messageCount: session.messageCount,
    totalTokens: session.totalTokens,
    summaryTokens: session.summaryTokens,
    recentTokens,
    compressionRatio,
    oldestMessage: timestamps.length > 0 ? Math.min(...timestamps) : null,
    newestMessage: timestamps.length > 0 ? Math.max(...timestamps) : null
  };
}

/**
 * Clear session history but keep session identity
 */
export function clearSessionHistory(session: AgentSession): AgentSession {
  const db = getDatabase();
  const now = Date.now();

  // Delete all messages
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(session.id);

  // Update session
  db.prepare(`
    UPDATE sessions SET
      summary = '',
      summary_tokens = 0,
      total_tokens = 0,
      message_count = 0,
      updated_at = ?
    WHERE id = ?
  `).run(now, session.id);

  return {
    ...session,
    messages: [],
    summary: '',
    summaryTokens: 0,
    totalTokens: 0,
    messageCount: 0,
    updatedAt: now
  };
}

/**
 * Get total session count
 */
export function getSessionCount(agent?: string): number {
  const db = getDatabase();

  if (agent) {
    const row = db.prepare('SELECT COUNT(*) as count FROM sessions WHERE agent = ?').get(agent) as { count: number };
    return row.count;
  }

  const row = db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
  return row.count;
}
