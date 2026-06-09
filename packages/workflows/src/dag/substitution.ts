/**
 * Node-output reference substitution for DAG prompts and bash scripts.
 *
 * `substituteNodeOutputRefs` replaces `$node_id.output` / `$node_id.output.field`
 * references after the standard workflow-variable pass. For bash nodes it shell-
 * quotes values inline, or spills oversized values to a temp file referenced via
 * `$(cat ...)` to avoid silent argv corruption.
 */
import { writeFileSync } from 'fs';
import { join as joinPath } from 'path';
import type { NodeOutput } from '../schemas';
import { getLog } from './log';

/** Threshold (bytes) above which $nodeId.output values are written to a temp file
 *  instead of inlined as bash -c arguments, to avoid silent data corruption. */
export const NODE_OUTPUT_FILE_THRESHOLD = 32_768;

/**
 * Single-quote a string for safe inline shell use.
 * Replaces each ' with '\'' (end quote, literal single-quote, re-open quote).
 */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Shell-quote a value for bash, or write it to a file and return a $(cat ...) reference
 * when the value exceeds the inline size threshold.
 */
function shellQuoteOrFile(
  value: string,
  nodeId: string,
  field: string | undefined,
  outputFileDir: string | undefined
): string {
  if (outputFileDir && value.length > NODE_OUTPUT_FILE_THRESHOLD) {
    const filename = field ? `${nodeId}.${field}.nodeoutput` : `${nodeId}.nodeoutput`;
    const filePath = joinPath(outputFileDir, filename);
    try {
      writeFileSync(filePath, value);
      return `$(cat ${shellQuote(filePath)})`;
    } catch (fileErr) {
      const err = fileErr as Error;
      getLog().error(
        { err, nodeId, field, valueSize: value.length, filePath },
        'dag.large_output_file_write_failed'
      );
      return shellQuote(value); // fallback: inline (pre-file-spill behavior)
    }
  }
  return shellQuote(value);
}

/**
 * Substitute $node_id.output and $node_id.output.field references in a prompt.
 * Called AFTER the standard substituteWorkflowVariables pass.
 *
 * @param escapedForBash - When true, wraps substituted values in single quotes so
 *   they are safe to embed in bash scripts passed to `bash -c`. Set true only for
 *   bash node script substitution; AI/command prompt substitution should use false.
 */
export function substituteNodeOutputRefs(
  prompt: string,
  nodeOutputs: Map<string, NodeOutput>,
  escapedForBash = false,
  outputFileDir?: string
): string {
  return prompt.replace(
    /\$([a-zA-Z_][a-zA-Z0-9_-]*)\.output(?:\.([a-zA-Z_][a-zA-Z0-9_]*))?/g,
    (match, nodeId: string, field: string | undefined) => {
      const nodeOutput = nodeOutputs.get(nodeId);
      if (!nodeOutput) {
        getLog().warn({ nodeId, match }, 'dag_node_output_ref_unknown_node');
        return escapedForBash ? "''" : '';
      }
      if (!field) {
        return escapedForBash
          ? shellQuoteOrFile(nodeOutput.output, nodeId, undefined, outputFileDir)
          : nodeOutput.output;
      }
      // Prefer the provider-supplied structured payload when present. Providers that emit
      // fence-wrapped or preamble-prefixed JSON (Pi/Minimax) parse it onto the result chunk
      // via tryParseStructuredOutput; consuming that object directly avoids re-parsing prose
      // here. Falls back to JSON.parse on output for providers that don't normalize
      // (or for older NodeOutput rows from before this field existed).
      const structured = 'structuredOutput' in nodeOutput ? nodeOutput.structuredOutput : undefined;
      if (
        structured !== undefined &&
        structured !== null &&
        typeof structured === 'object' &&
        !Array.isArray(structured)
      ) {
        const value = (structured as Record<string, unknown>)[field];
        if (typeof value === 'string')
          return escapedForBash ? shellQuoteOrFile(value, nodeId, field, outputFileDir) : value;
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        if (Array.isArray(value) || typeof value === 'object') {
          const json = JSON.stringify(value);
          return escapedForBash ? shellQuoteOrFile(json, nodeId, field, outputFileDir) : json;
        }
        return escapedForBash ? "''" : '';
      }
      try {
        const parsed = JSON.parse(nodeOutput.output) as Record<string, unknown>;
        const value = parsed[field];
        if (typeof value === 'string')
          return escapedForBash ? shellQuoteOrFile(value, nodeId, field, outputFileDir) : value;
        // numbers and booleans from JSON.parse are shell-safe without quoting:
        // JSON disallows NaN/Infinity, so String(number) contains only digits, sign, and '.'.
        // String(boolean) is 'true' or 'false' — no shell metacharacters.
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        // arrays and objects: JSON-stringify. Bash passes substitution as a single
        // argument, so downstream tools (jq, etc.) receive a JSON literal they can parse.
        if (Array.isArray(value) || typeof value === 'object') {
          const json = JSON.stringify(value);
          return escapedForBash ? shellQuoteOrFile(json, nodeId, field, outputFileDir) : json;
        }
        return escapedForBash ? "''" : ''; // undefined, symbol, bigint → empty (null is caught above by typeof check)
      } catch (jsonErr) {
        getLog().warn(
          { nodeId, field, outputPreview: nodeOutput.output.slice(0, 100), err: jsonErr as Error },
          'dag_node_output_ref_json_parse_failed'
        );
        return escapedForBash ? "''" : '';
      }
    }
  );
}
