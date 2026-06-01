/**
 * Resolve the default AI assistant for a newly registered codebase.
 *
 * Pi is the sole provider — this always returns 'pi'.
 */
export async function resolveDefaultAssistant(_repoPath: string): Promise<string> {
  return 'pi';
}
