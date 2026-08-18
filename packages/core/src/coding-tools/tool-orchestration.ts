import type { ActionRunContext } from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import {
  executeSandboxCode,
  type ExecuteSandboxCodeResult,
} from "./run-code.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_CHARS = 50_000;
const MAX_OUTPUT_CHARS = 100_000;
const DEFAULT_MAX_TOOL_CALLS = 32;
const MAX_TOOL_CALLS = 128;

/**
 * Create the bounded read-only orchestration tool.
 *
 * This deliberately has a separate registry entry from run-code. The latter
 * retains its existing workspace staging and background-execution contract;
 * this entry is for short fan-out, reduction, and aggregation over tools that
 * the host can prove are read-only for the supplied arguments.
 */
export function createToolOrchestrationEntry(
  getActions: () => Record<string, ActionEntry>,
): ActionEntry {
  return {
    readOnly: true,
    allowInPlanMode: false,
    timeoutMs: MAX_TIMEOUT_MS,
    maxResultChars: MAX_OUTPUT_CHARS,
    tool: {
      description: [
        "Run a bounded JavaScript orchestration script in the existing sandbox.",
        "Use toolSearch(query) to discover read-only or conditionally read-only tools, then toolCall(name, args) to fan out, join, filter, and aggregate their results without putting every intermediate payload into chat. The host rechecks conditional policies against each argument object.",
        "The host rechecks every child call: mutating actions, hidden actions, provider writes, non-GET/HEAD web requests, staging, file saves, and workspace writes are rejected. Call mutations directly as native tools.",
        "The orchestration sandbox has no background mode, a strict child-tool-call budget, and a 20-page cap on each provider fetchAllPages call. It is a bounded orchestration path, not a general-purpose replacement for run-code.",
        "Available globals: toolSearch(query?, options?), toolCall(name, args?), providerFetch(provider, path, init?), providerFetchAll(...), providerSearchAll(...), webFetch(url, init?), webRead(url, init?), workspaceRead(path, opts?), workspaceReadMeta(path, opts?), workspaceList(prefix?), and appAction(name, args?) for eligible read-only actions.",
        "Print only the compact result needed by the conversation with console.log().",
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description:
              "JavaScript source to execute. ESM syntax and top-level await are supported.",
          },
          timeoutMs: {
            type: "number",
            description: `Execution timeout in milliseconds. Default: ${DEFAULT_TIMEOUT_MS}; max: ${MAX_TIMEOUT_MS}.`,
          },
          maxOutputChars: {
            type: "number",
            description: `Maximum combined stdout+stderr characters. Default: ${DEFAULT_MAX_OUTPUT_CHARS}; max: ${MAX_OUTPUT_CHARS}.`,
          },
          maxToolCalls: {
            type: "number",
            description: `Maximum bridged child-tool calls. Default: ${DEFAULT_MAX_TOOL_CALLS}; max: ${MAX_TOOL_CALLS}.`,
          },
        },
        required: ["code"],
      },
    },
    run: async (args: Record<string, unknown>, context?: ActionRunContext) => {
      if (args.background || args.executionId) {
        return "Error: tool-orchestration is foreground-only and does not support background or polling arguments. Use run-code for durable long-running execution.";
      }

      const code = typeof args.code === "string" ? args.code : "";
      if (!code.trim()) return "Error: code is required.";

      const requestedTimeout = Number(args.timeoutMs);
      const timeoutMs =
        Number.isFinite(requestedTimeout) && requestedTimeout > 0
          ? Math.min(requestedTimeout, MAX_TIMEOUT_MS)
          : DEFAULT_TIMEOUT_MS;
      const requestedOutput = Number(args.maxOutputChars);
      const maxOutputChars =
        Number.isFinite(requestedOutput) && requestedOutput > 0
          ? Math.min(requestedOutput, MAX_OUTPUT_CHARS)
          : DEFAULT_MAX_OUTPUT_CHARS;
      const requestedCalls = Number(args.maxToolCalls);
      const maxToolCalls =
        Number.isFinite(requestedCalls) && requestedCalls > 0
          ? Math.min(Math.floor(requestedCalls), MAX_TOOL_CALLS)
          : DEFAULT_MAX_TOOL_CALLS;

      const result = await executeSandboxCode({
        code,
        timeoutMs,
        getActions,
        mode: "tool-orchestration",
        maxToolCalls,
        context,
      });
      return formatResult(result, timeoutMs, maxOutputChars);
    },
  };
}

function formatResult(
  result: ExecuteSandboxCodeResult,
  timeoutMs: number,
  maxOutputChars: number,
): string {
  const combined =
    [
      result.stdout ? `stdout:\n${result.stdout}` : "",
      result.stderr ? `stderr:\n${result.stderr}` : "",
    ]
      .filter(Boolean)
      .join("\n\n") || "(no output)";

  const lines: string[] = [];
  if (result.timedOut) lines.push(`timedOut: true (${timeoutMs}ms)`);
  if (result.exitCode !== 0 && result.exitCode !== null) {
    lines.push(`exitCode: ${result.exitCode}`);
  }
  if (result.bridgeToolsUsed.length) {
    lines.push(`bridgeToolsUsed: ${result.bridgeToolsUsed.join(", ")}`);
  }
  lines.push(combined);

  const full = lines.join("\n\n");
  if (full.length <= maxOutputChars) return full;
  const truncated = full.slice(0, maxOutputChars);
  return `${truncated}\n\n...[truncated ${(full.length - maxOutputChars).toLocaleString()} chars]`;
}
