import { describe, test, expect } from 'bun:test';
import { factoryAiDroidAdapter } from './factory-ai-droid';

describe('Factory AI Droid Adapter', () => {
  describe('Initialization', () => {
    test('creates game with correct initial state', () => {
      const state = factoryAiDroidAdapter.initializeGame({ difficulty: 'easy' });

      expect(state.status).toBe('playing');
      expect(state.data.ore).toBe(10);
      expect(state.data.energy).toBe(5);
      expect(state.data.credits).toBe(50);
      expect(state.data.droids).toEqual([]);
      expect(state.data.turn).toBe(0);
      expect(state.data.maxTurns).toBe(20);
      expect(state.data.targetCredits).toBe(100);
    });

    test('respects difficulty settings', () => {
      const easy = factoryAiDroidAdapter.initializeGame({ difficulty: 'easy' });
      const medium = factoryAiDroidAdapter.initializeGame({ difficulty: 'medium' });
      const hard = factoryAiDroidAdapter.initializeGame({ difficulty: 'hard' });

      expect(easy.data.maxTurns).toBe(20);
      expect(easy.data.targetCredits).toBe(100);

      expect(medium.data.maxTurns).toBe(15);
      expect(medium.data.targetCredits).toBe(150);

      expect(hard.data.maxTurns).toBe(10);
      expect(hard.data.targetCredits).toBe(200);
    });
  });

  describe('Command Parsing', () => {
    test('handles normal whitespace in build command', async () => {
      const state = factoryAiDroidAdapter.initializeGame({ difficulty: 'easy' });
      const response = await factoryAiDroidAdapter.run('build droid miner', { state });

      expect(response.state!.status).toBe('playing');
      expect(response.state!.data.droids).toHaveLength(1);
      expect(response.state!.data.droids[0].type).toBe('miner');
    });

    test('handles extra whitespace in build command', async () => {
      const state = factoryAiDroidAdapter.initializeGame({ difficulty: 'easy' });
      const response = await factoryAiDroidAdapter.run('build  droid   miner', { state });

      expect(response.state!.status).toBe('playing');
      expect(response.state!.data.droids).toHaveLength(1);
      expect(response.state!.data.droids[0].type).toBe('miner');
    });

    test('rejects invalid droid type', async () => {
      const state = factoryAiDroidAdapter.initializeGame({ difficulty: 'easy' });
      const response = await factoryAiDroidAdapter.run('build droid invalid', { state });

      expect(response.state!.status).toBe('invalid');
      expect(response.state!.message).toContain('Invalid droid type');
    });
  });

  describe('Game Mechanics', () => {
    test('building droid deducts credits', async () => {
      const state = factoryAiDroidAdapter.initializeGame({ difficulty: 'easy' });
      const response = await factoryAiDroidAdapter.run('build droid miner', { state });

      expect(response.state!.data.credits).toBe(40); // 50 - 10
    });

    test('production generates resources', async () => {
      let state = factoryAiDroidAdapter.initializeGame({ difficulty: 'easy' });

      // Build a miner
      let response = await factoryAiDroidAdapter.run('build droid miner', { state });
      state = response.state!;

      // Run production
      response = await factoryAiDroidAdapter.run('produce', { state });
      state = response.state!;

      expect(state.data.ore).toBe(15); // 10 + 5
      expect(state.data.turn).toBe(1);
    });

    test('refinery converts ore to credits', async () => {
      let state = factoryAiDroidAdapter.initializeGame({ difficulty: 'easy' });

      // Build a refinery
      let response = await factoryAiDroidAdapter.run('build droid refinery', { state });
      state = response.state!;

      const oreBefore = state.data.ore;
      const creditsBefore = state.data.credits;

      // Run production
      response = await factoryAiDroidAdapter.run('produce', { state });
      state = response.state!;

      // Refinery converts 3 ore → 5 credits, limited by available ore
      expect(state.data.ore).toBe(oreBefore - 3); // 3 ore consumed
      expect(state.data.credits).toBe(creditsBefore + 5); // 5 credits gained
    });
  });

  describe('Win/Lose Conditions', () => {
    test('detects win when reaching target credits', async () => {
      let state = factoryAiDroidAdapter.initializeGame({ difficulty: 'easy' });

      // Set credits just below target and give lots of ore
      state.data.credits = 95;
      state.data.ore = 100;
      state.data.droids = [{ type: 'refinery', count: 1 }];

      // Run production to convert ore to credits and win
      const response = await factoryAiDroidAdapter.run('produce', { state });
      state = response.state!;

      expect(state.status).toBe('won');
      expect(state.data.credits).toBeGreaterThanOrEqual(100);
    });

    test('detects loss when running out of turns', async () => {
      let state = factoryAiDroidAdapter.initializeGame({ difficulty: 'easy' });
      state.data.turn = 19; // One turn before limit
      state.data.droids = [{ type: 'miner', count: 1 }];

      const response = await factoryAiDroidAdapter.run('produce', { state });

      expect(response.state!.status).toBe('lost');
      expect(response.state!.data.turn).toBe(20);
    });
  });

  describe('Validation', () => {
    test('validates commands correctly when playing', () => {
      const state = factoryAiDroidAdapter.initializeGame({ difficulty: 'easy' });

      expect(factoryAiDroidAdapter.validateCommand!('build droid miner', state)).toBe(true);
      expect(factoryAiDroidAdapter.validateCommand!('produce', state)).toBe(true);
      expect(factoryAiDroidAdapter.validateCommand!('status', state)).toBe(true);
      expect(factoryAiDroidAdapter.validateCommand!('help', state)).toBe(true);
      expect(factoryAiDroidAdapter.validateCommand!('invalid', state)).toBe(false);
    });

    test('rejects commands when game is over', () => {
      const state = factoryAiDroidAdapter.initializeGame({ difficulty: 'easy' });
      state.status = 'won';

      expect(factoryAiDroidAdapter.validateCommand!('build droid miner', state)).toBe(false);
      expect(factoryAiDroidAdapter.validateCommand!('produce', state)).toBe(false);
    });
  });

  describe('State Persistence', () => {
    test('returns state in response', async () => {
      const state = factoryAiDroidAdapter.initializeGame({ difficulty: 'easy' });
      const response = await factoryAiDroidAdapter.run('build droid miner', { state });

      expect(response.state).toBeDefined();
      expect(response.state!.data.droids).toHaveLength(1);
    });

    test('state changes are deterministic', async () => {
      const state1 = factoryAiDroidAdapter.initializeGame({ difficulty: 'easy' });
      const state2 = JSON.parse(JSON.stringify(state1));

      const response1 = await factoryAiDroidAdapter.run('build droid miner', { state: state1 });
      const response2 = await factoryAiDroidAdapter.run('build droid miner', { state: state2 });

      expect(response1.state).toEqual(response2.state);
    });
  });
});
