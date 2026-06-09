/**
 * Shared constants and policy helpers used by more than one node runner.
 *
 * Kept in a neutral `dag/` module (owned by no single runner) so the runner
 * files never import sideways from each other.
 */

/** Default timeout for subprocess nodes (bash, script): 2 minutes */
export const SUBPROCESS_DEFAULT_TIMEOUT = 120_000;

/**
 * Policy for the during-streaming cancel check: should the currently-streaming
 * node be allowed to continue for a given observed run status?
 *
 * - `running`: the normal case → continue.
 * - `paused`: a concurrent approval node in the same topological layer has
 *   transitioned the run to paused. The streaming node should finish its own
 *   output; workflow progression is gated by the approval node, not by tearing
 *   down unrelated in-flight streams.
 * - `null` (run deleted), `cancelled`, `failed`, `completed`, or any other
 *   state → abort the stream.
 *
 * Exported for unit testing; the full streaming-cancel branch in
 * `executeNodeInternal` only fires once per 10s (CANCEL_CHECK_INTERVAL_MS), so
 * integration-level coverage of the policy is timing-sensitive and flaky.
 */
export function shouldContinueStreamingForStatus(status: string | null): boolean {
  return status === 'running' || status === 'paused';
}
