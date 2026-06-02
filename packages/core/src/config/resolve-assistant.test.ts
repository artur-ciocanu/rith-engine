import { describe, test, expect } from 'bun:test';
import { resolveDefaultAssistant } from './resolve-assistant';

describe('resolveDefaultAssistant', () => {
  test('always returns pi', async () => {
    expect(await resolveDefaultAssistant('/any/repo')).toBe('pi');
  });
});
