import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createServer } from '../server';
import * as persistence from './persistence';
import { closeDatabase } from '../../memory/database';
import { hashRefreshToken } from './service';

const testDbDir = mkdtempSync(join(tmpdir(), 'puzldai-test-'));
process.env.PUZLDAI_DB_PATH = join(testDbDir, 'puzldai.db');

describe('OAuth2 Refresh Token Flow', () => {
  let app: any;

  beforeAll(async () => {
    // Ensure we use a clean test database if possible, 
    // but for now we'll just use the default one and clean up
    app = await createServer({ restoreTasks: false });
    await app.ready();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    closeDatabase();
    rmSync(testDbDir, { recursive: true, force: true });
    delete process.env.PUZLDAI_DB_PATH;
  });

  const testUser = {
    username: `testuser_${Date.now()}`,
    password: 'Password123!'
  };

  it('should register a new user', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: testUser
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.username).toBe(testUser.username);
    expect(body.id).toBeDefined();
  });

  it('should login and return access and refresh tokens', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: testUser
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.accessToken).toBeDefined();
    expect(body.refreshToken).toBeDefined();
    expect(body.expiresIn).toBe(900);
  });

  it('should access protected route with access token', async () => {
    // First login to get token
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: testUser
    });
    const { accessToken } = JSON.parse(loginResponse.body);

    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.username).toBe(testUser.username);
  });

  it('should refresh tokens using a valid refresh token', async () => {
    // First login to get tokens
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: testUser
    });
    const { refreshToken: oldRefreshToken } = JSON.parse(loginResponse.body);

    // Wait a bit to ensure timestamps would be different if they were used for ID
    await new Promise(resolve => setTimeout(resolve, 10));

    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: oldRefreshToken }
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.accessToken).toBeDefined();
    expect(body.refreshToken).toBeDefined();
    expect(body.refreshToken).not.toBe(oldRefreshToken);

    // Verify old refresh token is revoked
    const oldTokenHash = hashRefreshToken(oldRefreshToken);
    const storedOldToken = persistence.getRefreshToken(oldTokenHash);
    expect(storedOldToken?.revoked).toBe(true);
  });

  it('should fail to refresh with a revoked refresh token', async () => {
    // First login to get tokens
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: testUser
    });
    const { refreshToken } = JSON.parse(loginResponse.body);

    // Refresh once (this revokes the first one)
    await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken }
    });

    // Try to refresh again with the same (now revoked) token
    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken }
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('TOKEN_REVOKED');
  });

  it('should fail to refresh with an invalid refresh token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: 'invalid-token-string' }
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('INVALID_TOKEN');
  });
});
