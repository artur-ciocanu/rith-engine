/**
 * Scoped `mock.module()` helper for Bun tests.
 *
 * Bun's module mocks are process-global and irreversible by default: a
 * `mock.module()` call persists across every test file that runs later in the
 * same `bun test` invocation. A partial override (e.g. stubbing only
 * `createLogger` on `@rith/paths`) therefore silently strips the rest of the
 * module for unrelated files — which is why this suite historically had to run
 * each file in its own process to stay green.
 *
 * `mockModuleScoped` captures the real namespace before overriding and
 * re-registers it in `afterAll`, making each file's mocks self-contained so the
 * whole suite can run in a single process.
 */
import { mock, afterAll } from 'bun:test';

/**
 * Apply a `mock.module()` override for the current test file, then revert
 * `specifier` to its real implementation once the file finishes.
 *
 * The override is registered verbatim — identical to what a bare
 * `mock.module(specifier, () => override)` would install — so per-file mock
 * behavior is unchanged; only the cross-file leak is fixed.
 *
 * @param specifier Module specifier, exactly as passed to `mock.module`.
 *   Relative specifiers resolve against `src/` (where this helper and every
 *   workflow test live), so they match the caller's resolution.
 * @param realNamespace The real module, captured via
 *   `import * as real from '<specifier>'` in the SAME file, BEFORE this call.
 * @param override The mock exports, applied verbatim (no merge with real).
 */
export function mockModuleScoped(
  specifier: string,
  realNamespace: Record<string, unknown>,
  override: Record<string, unknown>
): void {
  const realSnapshot = { ...realNamespace };
  mock.module(specifier, () => override);
  afterAll(() => {
    mock.module(specifier, () => realSnapshot);
  });
}
