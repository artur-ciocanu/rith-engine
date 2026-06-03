import { describe, expect, test } from 'bun:test';

import { parseProviderConfig } from './config';

describe('parseProviderConfig', () => {
  test('parses valid model string', () => {
    expect(parseProviderConfig({ model: 'google/gemini-2.5-pro' })).toEqual({
      model: 'google/gemini-2.5-pro',
    });
  });

  test('drops invalid model type silently', () => {
    expect(parseProviderConfig({ model: 123 })).toEqual({});
  });

  test('ignores unknown keys', () => {
    expect(parseProviderConfig({ futureField: 'x', model: 'google/gemini-2.5-pro' })).toEqual({
      model: 'google/gemini-2.5-pro',
    });
  });

  test('returns empty object for empty input', () => {
    expect(parseProviderConfig({})).toEqual({});
  });

  test('does not throw on malformed input', () => {
    expect(() => parseProviderConfig({ model: null })).not.toThrow();
    expect(() => parseProviderConfig({ model: [] })).not.toThrow();
  });

  test('parses enableExtensions: true', () => {
    expect(parseProviderConfig({ enableExtensions: true })).toEqual({
      enableExtensions: true,
    });
  });

  test('parses enableExtensions: false', () => {
    expect(parseProviderConfig({ enableExtensions: false })).toEqual({
      enableExtensions: false,
    });
  });

  test('drops non-boolean enableExtensions silently', () => {
    expect(parseProviderConfig({ enableExtensions: 'yes' })).toEqual({});
    expect(parseProviderConfig({ enableExtensions: 1 })).toEqual({});
    expect(parseProviderConfig({ enableExtensions: null })).toEqual({});
  });

  test('combines model and enableExtensions', () => {
    expect(parseProviderConfig({ model: 'google/gemini-2.5-pro', enableExtensions: true })).toEqual(
      {
        model: 'google/gemini-2.5-pro',
        enableExtensions: true,
      }
    );
  });

  test('parses interactive: true', () => {
    expect(parseProviderConfig({ interactive: true })).toEqual({ interactive: true });
  });

  test('parses interactive: false', () => {
    expect(parseProviderConfig({ interactive: false })).toEqual({ interactive: false });
  });

  test('drops non-boolean interactive silently', () => {
    expect(parseProviderConfig({ interactive: 'yes' })).toEqual({});
    expect(parseProviderConfig({ interactive: 1 })).toEqual({});
    expect(parseProviderConfig({ interactive: null })).toEqual({});
  });

  test('combines all three fields', () => {
    expect(
      parseProviderConfig({
        model: 'google/gemini-2.5-pro',
        enableExtensions: true,
        interactive: true,
      })
    ).toEqual({
      model: 'google/gemini-2.5-pro',
      enableExtensions: true,
      interactive: true,
    });
  });

  test('parses extensionFlags with boolean and string values', () => {
    expect(parseProviderConfig({ extensionFlags: { plan: true, profile: 'Default' } })).toEqual({
      extensionFlags: { plan: true, profile: 'Default' },
    });
  });

  test('drops non-boolean/string extensionFlags values silently', () => {
    expect(
      parseProviderConfig({
        extensionFlags: { plan: true, bogus: 42, nested: { x: 1 }, nullish: null },
      })
    ).toEqual({ extensionFlags: { plan: true } });
  });

  test('drops extensionFlags when all entries are invalid', () => {
    expect(parseProviderConfig({ extensionFlags: { bogus: 42, nested: {} } })).toEqual({});
  });

  test('drops non-object extensionFlags silently', () => {
    expect(parseProviderConfig({ extensionFlags: 'plan=true' })).toEqual({});
    expect(parseProviderConfig({ extensionFlags: ['plan', 'true'] })).toEqual({});
    expect(parseProviderConfig({ extensionFlags: null })).toEqual({});
  });

  test('combines extensionFlags with other fields', () => {
    expect(
      parseProviderConfig({
        model: 'openai-codex/gpt-5.1-codex-mini',
        enableExtensions: true,
        interactive: true,
        extensionFlags: { plan: true },
      })
    ).toEqual({
      model: 'openai-codex/gpt-5.1-codex-mini',
      enableExtensions: true,
      interactive: true,
      extensionFlags: { plan: true },
    });
  });

  test('parses env with string values', () => {
    expect(parseProviderConfig({ env: { PLANNOTATOR_REMOTE: '1', FOO: 'bar' } })).toEqual({
      env: { PLANNOTATOR_REMOTE: '1', FOO: 'bar' },
    });
  });

  test('drops non-string env values silently', () => {
    expect(
      parseProviderConfig({
        env: { GOOD: 'yes', BOOL: true, NUM: 42, NESTED: { x: 1 }, NULLISH: null },
      })
    ).toEqual({ env: { GOOD: 'yes' } });
  });

  test('drops env when all entries are invalid', () => {
    expect(parseProviderConfig({ env: { NUM: 42, NESTED: {} } })).toEqual({});
  });

  test('drops non-object env silently', () => {
    expect(parseProviderConfig({ env: 'PLANNOTATOR_REMOTE=1' })).toEqual({});
    expect(parseProviderConfig({ env: ['A=1'] })).toEqual({});
    expect(parseProviderConfig({ env: null })).toEqual({});
  });

  test('combines env with other fields', () => {
    expect(
      parseProviderConfig({
        model: 'openai-codex/gpt-5.4-mini',
        enableExtensions: true,
        interactive: true,
        extensionFlags: { plan: true },
        env: { PLANNOTATOR_REMOTE: '1' },
      })
    ).toEqual({
      model: 'openai-codex/gpt-5.4-mini',
      enableExtensions: true,
      interactive: true,
      extensionFlags: { plan: true },
      env: { PLANNOTATOR_REMOTE: '1' },
    });
  });

  test('parses maxConcurrent as positive integer', () => {
    expect(parseProviderConfig({ maxConcurrent: 4 })).toEqual({ maxConcurrent: 4 });
    expect(parseProviderConfig({ maxConcurrent: 1 })).toEqual({ maxConcurrent: 1 });
  });

  test('drops invalid maxConcurrent values silently', () => {
    expect(parseProviderConfig({ maxConcurrent: 0 })).toEqual({});
    expect(parseProviderConfig({ maxConcurrent: -1 })).toEqual({});
    expect(parseProviderConfig({ maxConcurrent: 1.5 })).toEqual({});
    expect(parseProviderConfig({ maxConcurrent: 'four' })).toEqual({});
    expect(parseProviderConfig({ maxConcurrent: null })).toEqual({});
  });

  test('combines maxConcurrent with model and other fields', () => {
    expect(
      parseProviderConfig({
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
