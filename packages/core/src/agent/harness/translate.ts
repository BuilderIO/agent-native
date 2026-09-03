import type { AgentChatEvent } from "../types.js";
import type { AgentHarnessEvent } from "./types.js";

const MAX_TOOL_RESULT_CHARS = 12_000;

export function agentHarnessEventToAgentChatEvents(
  event: AgentHarnessEvent,
): AgentChatEvent[] {
  switch (event.type) {
    case "text-delta":
      return event.text ? [{ type: "text", text: event.text }] : [];
    case "thinking-delta":
      return event.text ? [{ type: "thinking", text: event.text }] : [];
    case "activity":
      return [
        {
          type: "activity",
          label: event.label,
          ...(event.tool ? { tool: event.tool } : {}),
        },
      ];
    case "tool-start":
      return [
        {
          type: "tool_start",
          tool: event.name,
          input: normalizeToolInput(event.input),
        },
      ];
    case "tool-done":
      return [
        {
          type: "tool_done",
          tool: event.name,
          ...(event.input !== undefined
            ? { input: normalizeToolInput(event.input) }
            : {}),
          result: stringifyResult(event.result),
          ...(event.mcpApp ? { mcpApp: event.mcpApp } : {}),
        },
      ];
    case "approval-request":
      return [
        {
          type: "activity",
          label: event.message || "Waiting for harness approval",
          ...(event.tool ? { tool: event.tool } : {}),
        },
      ];
    case "file-change":
      return [
        {
          type: "activity",
          label: fileChangeLabel(event),
          tool: "harness:file",
        },
      ];
    case "compaction":
      return [
        {
          type: "activity",
          label: event.summary
            ? `Harness compacted context: ${event.summary}`
            : "Harness compacted context",
          tool: "harness:compaction",
        },
      ];
    case "error":
      return [
        {
          type: "error",
          error: event.error,
          ...(event.code ? { errorCode: event.code } : {}),
          ...(event.recoverable !== undefined
            ? { recoverable: event.recoverable }
            : {}),
        },
      ];
    case "usage":
    case "done":
      return [];
  }
}

export function stringifyResult(value: unknown): string {
  let result: string;
  if (typeof value === "string") {
    result = value;
  } else if (value === undefined) {
    result = "";
  } else {
    try {
      result = JSON.stringify(value, null, 2);
    } catch {
      result = String(value);
    }
  }
  if (result.length <= MAX_TOOL_RESULT_CHARS) return result;
  return `${result.slice(0, MAX_TOOL_RESULT_CHARS)}\n...[truncated at ${MAX_TOOL_RESULT_CHARS} chars]`;
}

function normalizeToolInput(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return input === undefined ? {} : { input: stringifyResult(input) };
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    out[key] = typeof value === "string" ? value : stringifyResult(value);
  }
  return out;
}

function fileChangeLabel(
  event: Extract<AgentHarnessEvent, { type: "file-change" }>,
): string {
  const operation = event.operation ?? "unknown";
  const prefix =
    operation === "create"
      ? "Created"
      : operation === "update"
        ? "Updated"
        : operation === "delete"
          ? "Deleted"
          : operation === "rename"
            ? "Renamed"
            : "Changed";
  return event.summary
    ? `${prefix} ${event.path}: ${event.summary}`
    : `${prefix} ${event.path}`;
}
