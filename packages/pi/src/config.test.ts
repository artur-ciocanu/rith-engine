import { describe, expect, test } from 'bun:test';

import { parsePiConfig } from './config';

describe('parsePiConfig', () => {
  test('parses valid model string', () => {
    expect(parsePiConfig({ model: 'google/gemini-2.5-pro' })).toEqual({
      model: 'google/gemini-2.5-pro',
    });
  });

  test('drops invalid model type silently', () => {
    expect(parsePiConfig({ model: 123 })).toEqual({});
  });

  test('ignores unknown keys', () => {
    expect(parsePiConfig({ futureField: 'x', model: 'google/gemini-2.5-pro' })).toEqual({
      model: 'google/gemini-2.5-pro',
    });
  });

  test('returns empty object for empty input', () => {
    expect(parsePiConfig({})).toEqual({});
  });

  test('does not throw on malformed input', () => {
    expect(() => parsePiConfig({ model: null })).not.toThrow();
    expect(() => parsePiConfig({ model: [] })).not.toThrow();
  });

  test('parses enableExtensions: true', () => {
    expect(parsePiConfig({ enableExtensions: true })).toEqual({
      enableExtensions: true,
    });
  });

  test('parses enableExtensions: false', () => {
    expect(parsePiConfig({ enableExtensions: false })).toEqual({
      enableExtensions: false,
    });
  });

  test('drops non-boolean enableExtensions silently', () => {
    expect(parsePiConfig({ enableExtensions: 'yes' })).toEqual({});
    expect(parsePiConfig({ enableExtensions: 1 })).toEqual({});
    expect(parsePiConfig({ enableExtensions: null })).toEqual({});
  });

  test('combines model and enableExtensions', () => {
    expect(parsePiConfig({ model: 'google/gemini-2.5-pro', enableExtensions: true })).toEqual({
      model: 'google/gemini-2.5-pro',
      enableExtensions: true,
    });
  });

  test('parses extensionFlags with boolean and string values', () => {
    expect(parsePiConfig({ extensionFlags: { plan: true, profile: 'Default' } })).toEqual({
      extensionFlags: { plan: true, profile: 'Default' },
    });
  });

  test('drops non-boolean/string extensionFlags values silently', () => {
    expect(
      parsePiConfig({
        extensionFlags: { plan: true, bogus: 42, nested: { x: 1 }, nullish: null },
      })
    ).toEqual({ extensionFlags: { plan: true } });
  });

  test('drops extensionFlags when all entries are invalid', () => {
    expect(parsePiConfig({ extensionFlags: { bogus: 42, nested: {} } })).toEqual({});
  });

  test('drops non-object extensionFlags silently', () => {
    expect(parsePiConfig({ extensionFlags: 'plan=true' })).toEqual({});
    expect(parsePiConfig({ extensionFlags: ['plan', 'true'] })).toEqual({});
    expect(parsePiConfig({ extensionFlags: null })).toEqual({});
  });

  test('combines extensionFlags with other fields', () => {
    expect(
      parsePiConfig({
        model: 'openai-codex/gpt-5.1-codex-mini',
        enableExtensions: true,
        extensionFlags: { plan: true },
      })
    ).toEqual({
      model: 'openai-codex/gpt-5.1-codex-mini',
      enableExtensions: true,
      extensionFlags: { plan: true },
    });
  });

  test('parses maxConcurrent as positive integer', () => {
    expect(parsePiConfig({ maxConcurrent: 4 })).toEqual({ maxConcurrent: 4 });
    expect(parsePiConfig({ maxConcurrent: 1 })).toEqual({ maxConcurrent: 1 });
  });

  test('drops invalid maxConcurrent values silently', () => {
    expect(parsePiConfig({ maxConcurrent: 0 })).toEqual({});
    expect(parsePiConfig({ maxConcurrent: -1 })).toEqual({});
    expect(parsePiConfig({ maxConcurrent: 1.5 })).toEqual({});
    expect(parsePiConfig({ maxConcurrent: 'four' })).toEqual({});
    expect(parsePiConfig({ maxConcurrent: null })).toEqual({});
  });

  test('combines maxConcurrent with model and other fields', () => {
    expect(
      parsePiConfig({
        model: 'google/gemini-2.5-pro',
        maxConcurrent: 4,
        enableExtensions: true,
      })
    ).toEqual({
      model: 'google/gemini-2.5-pro',
      maxConcurrent: 4,
      enableExtensions: true,
    });
  });
});
