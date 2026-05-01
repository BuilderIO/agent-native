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
  status: { type: "complete"; reason: "stop" };
  metadata: Record<string, unknown>;
} | null {
  const content: ContentPart[] = [];
  let toolCallCounter = 0;
  let loopLimit: { maxIterations?: number } | null = null;

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
      loopLimit = {
        ...(event.maxIterations ? { maxIterations: event.maxIterations } : {}),
      };
      appendText(
        `${content.length > 0 ? "\n\n" : ""}${
          event.maxIterations
            ? `I reached the ${event.maxIterations}-step limit before finishing.`
            : "I reached the step limit before finishing."
        }`,
      );
      continue;
    }

    // done, error, missing_api_key — terminal signals, not content
  }

  if (content.length === 0) return null;

  const metadata: Record<string, unknown> = {};
  if (runId) metadata.runId = runId;
  if (loopLimit) metadata.custom = { loopLimit };

  return {
    id: `server-${runId ?? Date.now()}`,
    role: "assistant",
    content,
    status: { type: "complete" as const, reason: "stop" as const },
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
