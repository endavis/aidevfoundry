/**
 * API Schema Definitions for Swagger/OpenAPI Documentation
 */

// Task Submission
export const taskSubmissionSchema = {
  type: 'object',
  required: ['prompt'],
  properties: {
    prompt: { type: 'string', minLength: 1, description: 'The task prompt to execute' },
    agent: { 
      type: 'string', 
      enum: ['claude', 'gemini', 'codex', 'ollama', 'mistral'],
      description: 'Optional: Specific agent to use'
    },
  },
};

// Task Response
export const taskResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Unique task identifier' },
    status: { 
      type: 'string', 
      enum: ['queued', 'running', 'completed', 'failed'],
      description: 'Current task status'
    },
    queuePosition: { type: 'integer', description: 'Position in task queue' },
  },
};

// Task Status Response
export const taskStatusResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    prompt: { type: 'string' },
    agent: { type: 'string' },
    status: { type: 'string' },
    result: { type: 'string' },
    error: { type: 'string' },
    model: { type: 'string' },
    startedAt: { type: 'integer' },
    completedAt: { type: 'integer' },
    duration: { type: 'integer' },
    queueMetrics: {
      type: 'object',
      properties: {
        running: { type: 'integer' },
        pending: { type: 'integer' },
        total: { type: 'integer' },
      },
    },
  },
};

// Health Check Response
export const healthResponseSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok'] },
    timestamp: { type: 'string', format: 'date-time' },
  },
};

// Agents List Response
export const agentsResponseSchema = {
  type: 'object',
  properties: {
    agents: { type: 'array', items: { type: 'string' } },
    available: { type: 'array', items: { type: 'string' } },
  },
};

// Error Response
export const errorResponseSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
  },
};
