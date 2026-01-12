import { randomUUID, randomBytes, createHash } from 'crypto';
import bcrypt from 'bcrypt';
import { FastifyInstance } from 'fastify';
import { User, AuthTokens } from './types';
import * as persistence from './persistence';
import { AppError } from '../errors';

const SALT_ROUNDS = 10;
// 7 days for refresh token
const REFRESH_TOKEN_EXPIRY = 7 * 24 * 60 * 60 * 1000;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateRefreshTokenString(): string {
  return randomBytes(32).toString('hex');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function registerUser(username: string, password: string): Promise<User> {
  const existing = persistence.getUserByUsername(username);
  if (existing) {
    throw new AppError('Username already exists', 409, 'USER_EXISTS');
  }

  const passwordHash = await hashPassword(password);
  const now = Date.now();
  const user: User = {
    id: randomUUID(),
    username,
    passwordHash,
    createdAt: now,
    updatedAt: now,
  };

  persistence.createUser(user);
  return user;
}

export async function loginUser(username: string, password: string, fastify: FastifyInstance): Promise<AuthTokens> {
  const user = persistence.getUserByUsername(username);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new AppError('Invalid username or password', 401, 'INVALID_CREDENTIALS');
  }

  return generateTokens(user, fastify);
}

export async function refreshTokens(refreshToken: string, fastify: FastifyInstance): Promise<AuthTokens> {
  const tokenHash = hashRefreshToken(refreshToken);
  const storedToken = persistence.getRefreshToken(tokenHash);

  if (!storedToken) {
    throw new AppError('Invalid refresh token', 401, 'INVALID_TOKEN');
  }

  if (storedToken.revoked) {
    // Revoked token usage - potential theft!
    throw new AppError('Token revoked', 401, 'TOKEN_REVOKED');
  }

  if (Date.now() > storedToken.expiresAt) {
    throw new AppError('Token expired', 401, 'TOKEN_EXPIRED');
  }

  // Revoke the used refresh token (Rotation)
  persistence.revokeRefreshToken(storedToken.id);

  const user = persistence.getUserById(storedToken.userId);
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  return generateTokens(user, fastify);
}

async function generateTokens(user: User, fastify: FastifyInstance): Promise<AuthTokens> {
  // Access Token (JWT)
  // Payload follows OAuth2/OIDC conventions where possible
  const accessToken = fastify.jwt.sign(
    { 
      sub: user.id, 
      username: user.username 
    }, 
    { expiresIn: '15m' }
  );

  // Refresh Token (Opaque)
  const refreshTokenString = generateRefreshTokenString();
  const refreshTokenHash = hashRefreshToken(refreshTokenString);
  const now = Date.now();

  persistence.storeRefreshToken({
    id: randomUUID(),
    userId: user.id,
    tokenHash: refreshTokenHash,
    expiresAt: now + REFRESH_TOKEN_EXPIRY,
    revoked: false,
    createdAt: now,
  });

  return {
    accessToken,
    refreshToken: refreshTokenString,
    expiresIn: 900, // 15 mins
  };
}
