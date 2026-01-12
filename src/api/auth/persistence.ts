import { getDatabase } from '../../memory/database';
import { createLogger } from '../../lib/logger';
import { DatabaseError } from '../errors';
import { User, RefreshToken } from './types';

const logger = createLogger({ module: 'auth-persistence' });

let createUserStmt: any = null;
let getUserByIdStmt: any = null;
let getUserByUsernameStmt: any = null;
let createRefreshTokenStmt: any = null;
let getRefreshTokenStmt: any = null;
let revokeRefreshTokenStmt: any = null;
let deleteExpiredTokensStmt: any = null;

function initStatements(): void {
  const db = getDatabase();

  createUserStmt = db.prepare(`
    INSERT INTO users (id, username, password_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  getUserByIdStmt = db.prepare('SELECT * FROM users WHERE id = ?');
  getUserByUsernameStmt = db.prepare('SELECT * FROM users WHERE username = ?');

  createRefreshTokenStmt = db.prepare(`
    INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  getRefreshTokenStmt = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?');
  revokeRefreshTokenStmt = db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?');
  deleteExpiredTokensStmt = db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?');
}

function ensureStatements(): void {
  if (!createUserStmt) {
    initStatements();
  }
}

function mapRowToUser(row: any): User {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRowToRefreshToken(row: any): RefreshToken {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    revoked: Boolean(row.revoked),
    createdAt: row.created_at,
  };
}

export function createUser(user: User): void {
  ensureStatements();
  try {
    createUserStmt.run(user.id, user.username, user.passwordHash, user.createdAt, user.updatedAt);
  } catch (error) {
    logger.error({ username: user.username, error }, 'Failed to create user');
    throw new DatabaseError('Failed to create user', error);
  }
}

export function getUserByUsername(username: string): User | null {
  ensureStatements();
  try {
    const row = getUserByUsernameStmt.get(username);
    return row ? mapRowToUser(row) : null;
  } catch (error) {
    logger.error({ username, error }, 'Failed to get user by username');
    throw new DatabaseError('Failed to get user', error);
  }
}

export function getUserById(id: string): User | null {
  ensureStatements();
  try {
    const row = getUserByIdStmt.get(id);
    return row ? mapRowToUser(row) : null;
  } catch (error) {
    logger.error({ userId: id, error }, 'Failed to get user by ID');
    throw new DatabaseError('Failed to get user', error);
  }
}

export function storeRefreshToken(token: RefreshToken): void {
  ensureStatements();
  try {
    createRefreshTokenStmt.run(
      token.id,
      token.userId,
      token.tokenHash,
      token.expiresAt,
      token.revoked ? 1 : 0,
      token.createdAt
    );
  } catch (error) {
    logger.error({ userId: token.userId, error }, 'Failed to store refresh token');
    throw new DatabaseError('Failed to store refresh token', error);
  }
}

export function getRefreshToken(tokenHash: string): RefreshToken | null {
  ensureStatements();
  try {
    const row = getRefreshTokenStmt.get(tokenHash);
    return row ? mapRowToRefreshToken(row) : null;
  } catch (error) {
    logger.error({ error }, 'Failed to get refresh token');
    throw new DatabaseError('Failed to get refresh token', error);
  }
}

export function revokeRefreshToken(id: string): void {
  ensureStatements();
  try {
    revokeRefreshTokenStmt.run(id);
  } catch (error) {
    logger.error({ tokenId: id, error }, 'Failed to revoke refresh token');
    throw new DatabaseError('Failed to revoke refresh token', error);
  }
}

export function cleanupExpiredTokens(): void {
  ensureStatements();
  try {
    deleteExpiredTokensStmt.run(Date.now());
  } catch (error) {
    logger.error({ error }, 'Failed to cleanup expired tokens');
  }
}

export function resetStatements(): void {
  createUserStmt = null;
  getUserByIdStmt = null;
  getUserByUsernameStmt = null;
  createRefreshTokenStmt = null;
  getRefreshTokenStmt = null;
  revokeRefreshTokenStmt = null;
  deleteExpiredTokensStmt = null;
}
