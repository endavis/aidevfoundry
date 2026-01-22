import { FastifyInstance } from 'fastify';
import * as authService from './service';

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: { username: string; password: string } }>('/auth/register', {
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', minLength: 3 },
          password: { type: 'string', minLength: 8 }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            username: { type: 'string' },
            message: { type: 'string' }
          }
        }
      }
    }
  }, async (request, _reply) => {
    const { username, password } = request.body;
    const user = await authService.registerUser(username, password);
    return { 
      id: user.id, 
      username: user.username,
      message: 'User registered successfully' 
    };
  });

  fastify.post<{ Body: { username: string; password: string } }>('/auth/login', {
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string' },
          password: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            accessToken: { type: 'string' },
            refreshToken: { type: 'string' },
            expiresIn: { type: 'number' }
          }
        }
      }
    }
  }, async (request, _reply) => {
    const { username, password } = request.body;
    return authService.loginUser(username, password, fastify);
  });

  fastify.post<{ Body: { refreshToken: string } }>('/auth/refresh', {
    schema: {
      body: {
        type: 'object',
        required: ['refreshToken'],
        properties: {
          refreshToken: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            accessToken: { type: 'string' },
            refreshToken: { type: 'string' },
            expiresIn: { type: 'number' }
          }
        }
      }
    }
  }, async (request, _reply) => {
    const { refreshToken } = request.body;
    return authService.refreshTokens(refreshToken, fastify);
  });

  // Example protected route
  fastify.get('/auth/me', {
    onRequest: [fastify.authenticate],
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            sub: { type: 'string' },
            username: { type: 'string' },
            iat: { type: 'number' },
            exp: { type: 'number' }
          }
        }
      }
    }
  }, async (request) => {
    return request.user;
  });
}
