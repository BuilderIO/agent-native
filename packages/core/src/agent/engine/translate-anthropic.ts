/**
 * Translation helpers between the AgentEngine normalized types and
 * @anthropic-ai/sdk's wire types.
 *
 * AnthropicEngine does very little translation because the framework's
 * EngineMessage / EngineTool shapes were modeled on Anthropic's types.
 * The main differences are: camelCase vs snake_case, and that
 * Anthropic uses `input_schema` while we use `inputSchema`.
 *
 * Builder's Gemini-backed gateway requires `tool_name` and `tool_input` on
 * every `tool_result` block. Use `engineMessagesToBuilderGatewayAnthropic` for
 * that path. The native Anthropic API keeps the strict `tool_result` shape
 * (`engineMessagesToAnthropic`).
 */

import type Anthropic from "@anthropic-ai/sdk";
import type {
  EngineTool,
  EngineMessage,
  EngineContentPart,
  EngineEvent,
} from "./types.js";

// ---------------------------------------------------------------------------
// EngineTool → Anthropic.Tool
// ---------------------------------------------------------------------------

export function engineToolToAnthropic(tool: EngineTool): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool["input_schema"],
  };
}

export function engineToolsToAnthropic(tools: EngineTool[]): Anthropic.Tool[] {
  return tools.map(engineToolToAnthropic);
}

// ---------------------------------------------------------------------------
// Tool result backfill (Gemini / Builder gateway)
// ---------------------------------------------------------------------------

/** JSON.stringify for tool_use inputs; never throws. */
export function stringifyToolUseInputForGateway(input: unknown): string {
  try {
    if (input === undefined || input === null) return "{}";
    return JSON.stringify(input);
  } catch {
    return "{}";
  }
}

/** Same lead-in as structured-history replay when a tool_result cannot be paired. */
export const UNMATCHED_TOOL_RESULT_REPLAY_PREFIX =
  "(Omitted unmatched tool results from replayed history.)";

/**
 * Human/LLM-visible note when a tool_result cannot be matched to a tool_use
 * (replay from DB, or malformed engine history). Preserves tool_use_id and
 * a truncated payload instead of silently dropping the turn.
 */
export function unmatchedToolResultReplayText(part: {
  toolCallId: string;
  content: unknown;
  isError?: boolean;
}): string {
  const max = 2000;
  let body =
    typeof part.content === "string"
      ? part.content
      : part.content === undefined || part.content === null
        ? ""
        : (() => {
            try {
              return JSON.stringify(part.content);
            } catch {
              return String(part.content);
            }
          })();
  if (body.length > max) body = `${body.slice(0, max)}…`;
  const err = part.isError ? " isError=true" : "";
  return `${UNMATCHED_TOOL_RESULT_REPLAY_PREFIX} [tool_use_id=${part.toolCallId}${err}] ${body}`;
}

function interruptedToolResultPart(part: {
  id: string;
  name: string;
  input: unknown;
}): EngineContentPart {
  return {
    type: "tool-result",
    toolCallId: part.id,
    toolName: part.name,
    toolInput: stringifyToolUseInputForGateway(part.input),
    content: "Interrupted before this tool returned a result.",
  };
}

/**
 * Ensure every `tool-result` has a non-empty `toolName` and `toolInput` string,
 * using the matching assistant `tool-call` in the same conversation.
 * Assistant `tool-call` blocks without an immediately following result get a
 * synthetic interrupted result so replayed history stays provider-protocol safe.
 * Orphan tool-results (no resolvable tool name) become `text` notes so nothing
 * is silently dropped from replayed history.
 */
export function backfillEngineMessagesToolResults(
  messages: EngineMessage[],
): EngineMessage[] {
  // Walk messages in order. User tool-result blocks are valid only when they
  // answer the immediately preceding assistant tool-call turn. This prevents
  // older tool-results from being backfilled with later, unrelated tool-calls
  // when ids are reused (e.g. `continuation_tc_1` reset across adapter
  // recreations).
  const toolUseById = new Map<string, { name: string; input: unknown }>();
  const out: EngineMessage[] = [];
  let pendingToolUses: Array<{ id: string; name: string; input: unknown }> = [];

  const flushInterruptedToolResults = () => {
    if (pendingToolUses.length === 0) return;
    out.push({
      role: "user",
      content: pendingToolUses.map(interruptedToolResultPart),
    });
    pendingToolUses = [];
  };

  for (const msg of messages) {
    if (msg.role === "assistant") {
      flushInterruptedToolResults();
      for (const part of msg.content) {
        if (part.type === "tool-call") {
          toolUseById.set(part.id, { name: part.name, input: part.input });
        }
      }
      out.push(msg);
      pendingToolUses = msg.content
        .filter(
          (part): part is Extract<EngineContentPart, { type: "tool-call" }> =>
            part.type === "tool-call",
        )
        .map((part) => ({
          id: part.id,
          name: part.name,
          input: part.input,
        }));
      continue;
    }
    if (msg.role !== "user") {
      flushInterruptedToolResults();
      out.push(msg);
      continue;
    }
    const newContent: EngineContentPart[] = [];
    const pendingById = new Map(
      pendingToolUses.map((part) => [part.id, part] as const),
    );
    const matchedPendingToolResults = new Map<string, EngineContentPart>();
    for (const part of msg.content) {
      if (part.type !== "tool-result") {
        newContent.push(part);
        continue;
      }
      const lookup = toolUseById.get(part.toolCallId);
      const pendingLookup = pendingById.get(part.toolCallId);
      const toolName =
        typeof part.toolName === "string" && part.toolName.trim().length > 0
          ? part.toolName
          : pendingLookup?.name;
      if (!toolName?.trim()) {
        const id =
          typeof part.toolCallId === "string"
            ? part.toolCallId.trim()
            : part.toolCallId != null
              ? String(part.toolCallId).trim()
              : "";
        newContent.push({
          type: "text",
          text: unmatchedToolResultReplayText({
            toolCallId: id.length > 0 ? id : "(missing)",
            content: part.content,
            isError: part.isError,
          }),
        });
        continue;
      }
      if (pendingToolUses.length > 0 && !pendingLookup) {
        const id =
          typeof part.toolCallId === "string"
            ? part.toolCallId.trim()
            : part.toolCallId != null
              ? String(part.toolCallId).trim()
              : "";
        newContent.push({
          type: "text",
          text: unmatchedToolResultReplayText({
            toolCallId: id.length > 0 ? id : "(missing)",
            content: part.content,
            isError: part.isError,
          }),
        });
        continue;
      }
      const toolInput =
        typeof part.toolInput === "string" && part.toolInput.length > 0
          ? part.toolInput
          : stringifyToolUseInputForGateway(
              pendingLookup?.input ?? lookup?.input,
            );
      const filled: EngineContentPart = {
        type: "tool-result",
        toolCallId: part.toolCallId,
        toolName,
        toolInput,
        content: part.content,
        ...(part.isError ? { isError: true } : {}),
      };
      if (pendingLookup) {
        matchedPendingToolResults.set(part.toolCallId, filled);
      } else {
        newContent.push(filled);
      }
    }
    if (pendingToolUses.length > 0) {
      const pairedResults = pendingToolUses.map(
        (part) =>
          matchedPendingToolResults.get(part.id) ??
          interruptedToolResultPart(part),
      );
      newContent.unshift(...pairedResults);
      pendingToolUses = [];
    }
    if (newContent.length === 0) {
      out.push({
        role: "user",
        content: [
          {
            type: "text",
            text: UNMATCHED_TOOL_RESULT_REPLAY_PREFIX,
          },
        ],
      });
      continue;
    }
    out.push({ role: "user", content: newContent });
  }

  flushInterruptedToolResults();

  return out;
}

// ---------------------------------------------------------------------------
// EngineMessage → Anthropic.MessageParam
// ---------------------------------------------------------------------------

export function engineMessageToAnthropic(
  msg: EngineMessage,
  opts?: { builderGateway?: boolean },
): Anthropic.MessageParam {
  const builderGateway = opts?.builderGateway === true;
  return {
    role: msg.role,
    content: msg.content.map((p) => enginePartToAnthropic(p, builderGateway)),
  };
}

/** Messages for the Anthropic HTTP API (strict schema — no extra tool_result fields). */
export function engineMessagesToAnthropic(
  messages: EngineMessage[],
): Anthropic.MessageParam[] {
  const normalized = backfillEngineMessagesToolResults(messages);
  return normalized.map((m) => engineMessageToAnthropic(m));
}

/**
 * Messages for the Builder LLM gateway (Gemini-backed). Same Anthropic-shaped
 * envelope, but every `tool_result` includes `tool_name` and `tool_input`.
 */
export function engineMessagesToBuilderGatewayAnthropic(
  messages: EngineMessage[],
): Anthropic.MessageParam[] {
  const normalized = backfillEngineMessagesToolResults(messages);
  return normalized.map((m) =>
    engineMessageToAnthropic(m, { builderGateway: true }),
  );
}

function enginePartToAnthropic(
  part: EngineContentPart,
  builderGateway: boolean,
): Anthropic.ContentBlockParam {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };

    case "image":
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: part.mediaType,
          data: part.data,
        },
      };

    case "file":
      if (part.mediaType === "application/pdf") {
        return {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: part.data,
          },
          ...(part.filename ? { title: part.filename } : {}),
        } as any;
      }
      return {
        type: "text",
        text: `[Attached file: ${part.filename ?? "attachment"} (${part.mediaType})]`,
      };

    case "tool-call":
      return {
        type: "tool_use",
        id: part.id,
        name: part.name,
        input: part.input as Record<string, unknown>,
      } as any; // tool_use is a ContentBlockParam in Anthropic SDK

    case "tool-result": {
      if (builderGateway) {
        const tool_name = part.toolName.trim();
        const tool_input = part.toolInput;
        return {
          type: "tool_result",
          tool_use_id: part.toolCallId,
          tool_name,
          tool_input,
          content: part.content,
          ...(part.isError ? { is_error: true } : {}),
        } as any;
      }
      return {
        type: "tool_result",
        tool_use_id: part.toolCallId,
        content: part.content,
        ...(part.isError ? { is_error: true } : {}),
      } as any;
    }

    case "thinking":
      // Anthropic thinking blocks — pass through with signature for context window continuity
      return {
        type: "thinking",
        thinking: part.text,
        signature: part.signature ?? "",
      } as any;
  }
}

// ---------------------------------------------------------------------------
// Anthropic.ContentBlock → EngineContentPart (from final message)
// ---------------------------------------------------------------------------

export function anthropicContentToEngine(
  content: Anthropic.ContentBlock[],
): EngineContentPart[] {
  return content
    .map((block) => {
      if (block.type === "text") {
        return { type: "text" as const, text: block.text };
      }
      if (block.type === "tool_use") {
        return {
          type: "tool-call" as const,
          id: block.id,
          name: block.name,
          input: block.input,
        };
      }
      if ((block as any).type === "thinking") {
        const b = block as any;
        return {
          type: "thinking" as const,
          text: b.thinking ?? "",
          signature: b.signature,
        };
      }
      // Unknown block type — skip
      return { type: "text" as const, text: "" };
    })
    .filter((p) => !(p.type === "text" && p.text === ""));
}

// ---------------------------------------------------------------------------
// Anthropic stream chunk → EngineEvent
// ---------------------------------------------------------------------------

/**
 * Translate an Anthropic stream chunk into zero or more EngineEvents.
 * Called in a loop as chunks arrive from client.messages.stream().
 */
export function anthropicChunkToEngineEvents(chunk: any): EngineEvent[] {
  const events: EngineEvent[] = [];

  if (chunk.type === "content_block_delta") {
    if (chunk.delta?.type === "text_delta") {
      events.push({ type: "text-delta", text: chunk.delta.text });
    } else if (chunk.delta?.type === "thinking_delta") {
      events.push({ type: "thinking-delta", text: chunk.delta.thinking ?? "" });
    } else if (chunk.delta?.type === "signature_delta") {
      // Signature arrives after thinking — emit as a thinking-delta with empty text
      // but carry the signature for the caller to store
      events.push({
        type: "thinking-delta",
        text: "",
        signature: chunk.delta.signature,
      });
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Build tool_result blocks to append to messages after tool dispatch
// ---------------------------------------------------------------------------

export function buildToolResultPart(
  toolCallId: string,
  toolName: string,
  content: string,
  toolInput: unknown = {},
  isError = false,
): EngineContentPart {
  return {
    type: "tool-result",
    toolCallId,
    toolName,
    toolInput: stringifyToolUseInputForGateway(toolInput),
    content,
    ...(isError ? { isError } : {}),
  };
}
