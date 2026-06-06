import type { PiDefaults } from './types';

export type { PiDefaults };

/**
 * Parse raw YAML-derived config into typed Pi defaults.
 * Defensive: invalid fields are dropped silently so broken user config can't
 * prevent provider registration or workflow discovery.
 */
export function parsePiConfig(raw: Record<string, unknown>): PiDefaults {
  const result: PiDefaults = {};

  if (typeof raw.model === 'string') {
    result.model = raw.model;
  }

  if (typeof raw.enableExtensions === 'boolean') {
    result.enableExtensions = raw.enableExtensions;
  }

  if (
    raw.extensionFlags &&
    typeof raw.extensionFlags === 'object' &&
    !Array.isArray(raw.extensionFlags)
  ) {
    const flags: Record<string, boolean | string> = {};
    for (const [key, value] of Object.entries(raw.extensionFlags as Record<string, unknown>)) {
      if (typeof value === 'boolean' || typeof value === 'string') {
        flags[key] = value;
      }
    }
    if (Object.keys(flags).length > 0) {
      result.extensionFlags = flags;
    }
  }

  if (
    typeof raw.maxConcurrent === 'number' &&
    Number.isInteger(raw.maxConcurrent) &&
    raw.maxConcurrent > 0
  ) {
    result.maxConcurrent = raw.maxConcurrent;
  }

  return result;
}
