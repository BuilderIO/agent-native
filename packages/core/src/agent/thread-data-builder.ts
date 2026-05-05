import type { RunEvent } from "./types.js";

interface ContentPart {
  type: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  argsText?: string;
  args?: Record<string, string>;
  result?: string;
}

function isInternalContinuationError(event: {
  error: string;
  errorCode?: string;
  recoverable?: boolean;
}): boolean {
  const code = String(event.errorCode ?? "").toLowerCase();
  const msg = event.error.toLowerCase();
  return (
    event.recoverable === true ||
    code === "builder_gateway_timeout" ||
    code === "stale_run" ||
    code === "timeout" ||
    code === "timeout_error" ||
    code === "http_408" ||
    code === "http_429" ||
    code === "http_500" ||
    code === "http_502" ||
    code === "http_503" ||
    code === "http_504" ||
    code === "rate_limited" ||
    code === "too_many_concurrent_requests" ||
    code === "overloaded_error" ||
    msg.includes("timeout") ||
    msg.includes("gateway timeout") ||
    msg.includes("inactivity timeout") ||
    msg.includes("stream ended") ||
    msg.includes("stream closed") ||
    msg.includes("temporarily unavailable") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("529")
  );
}

/**
 * Reconstruct an assistant-ui message from raw agent run events.
 * Mirrors the client-side processEvent logic so the server can persist
 * the assistant's response even if the frontend is disconnected.
 */
export function buildAssistantMessage(
  events: RunEvent[],
  runId?: string,
): {
  id: string;
  role: "assistant";
  content: ContentPart[];
  status:
    | { type: "complete"; reason: "stop" }
    | { type: "incomplete"; reason: "error" };
  metadata: Record<string, unknown>;
} | null {
  const content: ContentPart[] = [];
  let toolCallCounter = 0;
  let runError: {
    message: string;
    errorCode?: string;
    details?: string;
    recoverable?: boolean;
  } | null = null;
  let endedAtInternalContinuationBoundary = false;

  const appendText = (text: string) => {
    const last = content[content.length - 1];
    if (last && last.type === "text") {
      last.text = (last.text ?? "") + text;
    } else {
      content.push({ type: "text", text });
    }
  };

  for (const { event } of events) {
    if (event.type === "clear") {
      content.length = 0;
      toolCallCounter = 0;
      continue;
    }

    if (event.type === "text") {
      appendText(event.text ?? "");
      continue;
    }

    if (event.type === "tool_start") {
      const toolCallId = `tc_${++toolCallCounter}`;
      const args = (event.input ?? {}) as Record<string, string>;
      content.push({
        type: "tool-call",
        toolCallId,
        toolName: event.tool ?? "unknown",
        argsText: JSON.stringify(args),
        args,
      });
      continue;
    }

    if (event.type === "tool_done") {
      for (let i = content.length - 1; i >= 0; i--) {
        const part = content[i];
        if (
          part.type === "tool-call" &&
          part.toolName === event.tool &&
          part.result === undefined
        ) {
          part.result = event.result ?? "";
          break;
        }
      }
      continue;
    }

    if (event.type === "loop_limit") {
      // Older servers emitted this as a user-visible terminal event. Treat it
      // as an internal continuation boundary when rebuilding persisted turns.
      endedAtInternalContinuationBoundary = true;
      continue;
    }

    if (event.type === "auto_continue") {
      endedAtInternalContinuationBoundary = true;
      continue;
    }

    if (event.type === "error") {
      if (isInternalContinuationError(event)) {
        endedAtInternalContinuationBoundary = true;
        continue;
      }
      runError = {
        message: event.error,
        ...(event.errorCode ? { errorCode: event.errorCode } : {}),
        ...(event.details ? { details: event.details } : {}),
        ...(event.recoverable ? { recoverable: event.recoverable } : {}),
      };
      appendText(`${content.length > 0 ? "\n\n" : ""}Error: ${event.error}`);
      continue;
    }

    // done, missing_api_key — terminal signals, not content
  }

  if (content.length === 0 || endedAtInternalContinuationBoundary) return null;

  const metadata: Record<string, unknown> = {};
  if (runId) metadata.runId = runId;
  if (runError) {
    metadata.custom = {
      runError: {
        ...runError,
        ...(runId ? { runId } : {}),
      },
    };
  }

  return {
    id: `server-${runId ?? Date.now()}`,
    role: "assistant",
    content,
    status: runError
      ? { type: "incomplete" as const, reason: "error" as const }
      : { type: "complete" as const, reason: "stop" as const },
    metadata,
  };
}

/**
 * Extract title and preview from a thread runtime export.
 * Isomorphic — works on both server and client.
 */
export function extractThreadMeta(repo: any): {
  title: string;
  preview: string;
} {
  const msgs = repo?.messages;
  if (!Array.isArray(msgs) || msgs.length === 0)
    return { title: "", preview: "" };

  let title = "";
  let preview = "";
  for (const entry of msgs) {
    // Support both wrapped ({ message: { role, content } }) and flat ({ role, content }) formats
    const msg = entry?.message ?? entry;
    if (msg.role !== "user") continue;
    const textParts = Array.isArray(msg.content)
      ? msg.content
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text)
          .join(" ")
      : typeof msg.content === "string"
        ? msg.content
        : "";
    if (textParts.trim()) {
      if (!title) title = textParts.trim().slice(0, 80);
      preview = textParts.trim().slice(0, 120);
    }
  }
  return { title, preview };
}
