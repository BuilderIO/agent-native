import type {
  ChatModelAdapter,
  ChatModelRunOptions,
  ChatModelRunResult,
} from "@assistant-ui/react";

import {
  normalizeCodeAgentTranscript,
  type CodeAgentTranscriptEvent as CoreCodeAgentTranscriptEvent,
  type NormalizedCodeAgentStatusEvent,
  type NormalizedCodeAgentThinkingEvent,
  type NormalizedCodeAgentToolEvent,
  type NormalizedCodeAgentTranscriptItem,
} from "../code-agents/transcript-normalizer.js";
import {
  compareCodeAgentTranscriptEvents,
  isCodeAgentRunActive,
  type CodeAgentRunStateLike,
} from "../code-agents/transcript-order.js";
import type { ReasoningEffort } from "../shared/reasoning-effort.js";
import { unwrapAttachmentEnvelope } from "./composer/pasted-text.js";
import type { AgentPromptAttachment } from "./composer/prompt-attachments.js";
import type { ContentPart } from "./sse-event-processor.js";

export type CodeAgentChatFollowUpMode = "immediate" | "queued";

export interface CodeAgentChatTranscriptEvent {
  id: string;
  runId: string;
  kind?: CoreCodeAgentTranscriptEvent["kind"];
  type?: CoreCodeAgentTranscriptEvent["kind"] | "note";
  message?: string;
  text?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
  artifactPath?: string;
  artifactUrl?: string;
}

export interface CodeAgentChatControlResult {
  ok: boolean;
  run?: CodeAgentRunStateLike | null;
  queued?: boolean;
  message?: string;
  error?: string;
}

export interface CodeAgentChatController {
  get(runId: string): Promise<CodeAgentRunStateLike | null>;
  transcript(runId: string): Promise<CodeAgentChatTranscriptEvent[]>;
  sendFollowUp(input: {
    runId: string;
    prompt: string;
    mode?: CodeAgentChatFollowUpMode;
    permissionMode?: string;
    engine?: string;
    model?: string;
    reasoningEffort?: ReasoningEffort;
    source?: string;
    metadata?: Record<string, unknown>;
  }): Promise<CodeAgentChatControlResult>;
  control(input: {
    runId: string;
    command: "stop";
  }): Promise<CodeAgentChatControlResult>;
}

export interface CreateCodeAgentChatAdapterOptions {
  controller: CodeAgentChatController;
  runIdRef: { current: string | null };
  permissionModeRef?: { current: string | undefined };
  modelRef?: { current: string | undefined };
  engineRef?: { current: string | undefined };
  effortRef?: { current: ReasoningEffort | undefined };
  followUpModeRef?: { current: CodeAgentChatFollowUpMode | undefined };
  attachOnlyRef?: { current: boolean };
  tabId?: string;
  pollIntervalMs?: number;
  idlePollIntervalMs?: number;
  terminalIdlePolls?: number;
  /**
   * Assistant-ui may abort a run for UI lifecycle reasons, such as switching
   * selected sessions. Code sessions keep running unless the host sends an
   * explicit stop command.
   */
  stopOnAbort?: boolean;
}

type AssistantUiAttachment = {
  name?: string;
  contentType?: string;
  content?: readonly Record<string, unknown>[];
};

export function createCodeAgentChatAdapter(
  options: CreateCodeAgentChatAdapterOptions,
): ChatModelAdapter {
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  const idlePollIntervalMs = options.idlePollIntervalMs ?? 5000;
  const terminalIdlePolls = options.terminalIdlePolls ?? 3;
  const stopOnAbort = options.stopOnAbort === true;

  return {
    async *run({ messages, abortSignal }: ChatModelRunOptions) {
      const runId = options.runIdRef.current;
      if (!runId) {
        yield errorResult("Select an Agent-Native Code session first.");
        return;
      }

      const lastUserMessage = latestUserMessage(messages);
      const attachments = lastUserMessage
        ? extractPromptAttachmentsFromAssistantMessage(lastUserMessage)
        : [];
      const prompt =
        latestUserText(messages).trim() ||
        (attachments.length > 0 ? "Use the attached context." : "");
      if (!prompt.trim()) {
        yield errorResult("Enter a follow-up prompt.");
        return;
      }

      let stoppedFromAbort = false;
      const stopForAbort = () => {
        stoppedFromAbort = true;
        if (stopOnAbort) {
          void options.controller.control({ runId, command: "stop" });
        }
      };
      if (abortSignal.aborted) {
        stopForAbort();
        return;
      }
      abortSignal.addEventListener("abort", stopForAbort, { once: true });

      try {
        const initialEvents = await options.controller.transcript(runId);
        const seenEventIds = new Set(initialEvents.map((event) => event.id));
        const tailedEvents: CodeAgentChatTranscriptEvent[] = [];

        if (!options.attachOnlyRef?.current) {
          const beforeSendRun = await options.controller.get(runId);
          const response = await options.controller.sendFollowUp({
            runId,
            prompt,
            mode:
              options.followUpModeRef?.current ??
              (beforeSendRun && isCodeAgentRunActive(beforeSendRun)
                ? "queued"
                : "immediate"),
            permissionMode: options.permissionModeRef?.current,
            engine: options.engineRef?.current,
            model: options.modelRef?.current,
            reasoningEffort: options.effortRef?.current,
            source: "code-agent-chat",
            metadata: attachments.length > 0 ? { attachments } : undefined,
          });
          if (!response.ok) {
            yield errorResult(
              response.error ?? response.message ?? "Could not send follow-up.",
              runId,
            );
            return;
          }
        }

        let yieldedContent = false;
        let idleTerminalPolls = 0;
        while (!abortSignal.aborted) {
          const [events, run] = await Promise.all([
            options.controller.transcript(runId),
            options.controller.get(runId),
          ]);
          const nextEvents = events
            .filter((event) => !seenEventIds.has(event.id))
            .sort(compareCodeAgentTranscriptEvents);
          for (const event of nextEvents) {
            seenEventIds.add(event.id);
            tailedEvents.push(event);
          }

          const content = codeAgentTranscriptEventsToContent(tailedEvents);
          if (content.length > 0 && nextEvents.length > 0) {
            yieldedContent = true;
            yield withRunMetadata({ content: [...content] }, runId);
          }

          if (run && isCodeAgentRunActive(run)) {
            idleTerminalPolls = 0;
          } else if (nextEvents.length === 0) {
            idleTerminalPolls += 1;
          } else {
            idleTerminalPolls = 0;
          }

          if (idleTerminalPolls >= terminalIdlePolls) {
            if (content.length > 0 && !yieldedContent) {
              yield withRunMetadata({ content: [...content] }, runId);
            }
            return;
          }

          await sleep(
            run && isCodeAgentRunActive(run)
              ? pollIntervalMs
              : idlePollIntervalMs,
            abortSignal,
          );
        }
      } finally {
        abortSignal.removeEventListener("abort", stopForAbort);
        if (stoppedFromAbort) {
          return;
        }
      }
    },
  };
}

export function codeAgentTranscriptEventsToContent(
  events: readonly CodeAgentChatTranscriptEvent[],
): ContentPart[] {
  const normalized = normalizeCodeAgentTranscript(
    events.map(toCoreCodeAgentTranscriptEvent),
  );
  const content: ContentPart[] = [];

  const appendText = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const last = content.at(-1);
    if (last?.type === "text") {
      last.text = `${last.text}${last.text ? "\n\n" : ""}${trimmed}`;
    } else {
      content.push({ type: "text", text: trimmed });
    }
  };

  for (const item of normalized.items) {
    const part = contentPartForCodeAgentTranscriptItem(item);
    if (!part) continue;
    if (part.type === "text") {
      appendText(part.text);
    } else {
      content.push(part);
    }
  }

  return content;
}

function latestUserMessage(
  messages: ChatModelRunOptions["messages"],
): ChatModelRunOptions["messages"][number] | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === "user") return message;
  }
  return undefined;
}

function latestUserText(messages: ChatModelRunOptions["messages"]): string {
  const message = latestUserMessage(messages);
  return (
    message?.content
      .filter(
        (part): part is { type: "text"; text: string } => part.type === "text",
      )
      .map((part) => part.text)
      .join("\n") ?? ""
  );
}

function extractPromptAttachmentsFromAssistantMessage(message: {
  attachments?: readonly AssistantUiAttachment[];
}): AgentPromptAttachment[] {
  const attachments: AgentPromptAttachment[] = [];
  for (const att of message.attachments ?? []) {
    const name = att.name ?? "attachment";
    for (const part of att.content ?? []) {
      if (part.type === "image" && typeof part.image === "string") {
        attachments.push({
          name,
          type: att.contentType,
          dataUrl: part.image,
        });
      } else if (part.type === "file" && typeof part.data === "string") {
        attachments.push({
          name,
          type:
            att.contentType ??
            (typeof part.mimeType === "string" ? part.mimeType : undefined),
          ...(part.data.startsWith("data:")
            ? { dataUrl: part.data }
            : { text: part.data }),
        });
      } else if (part.type === "text" && typeof part.text === "string") {
        attachments.push({
          name,
          type: att.contentType,
          text: unwrapAttachmentEnvelope(part.text),
        });
      }
    }
  }
  return attachments;
}

function toCoreCodeAgentTranscriptEvent(
  event: CodeAgentChatTranscriptEvent,
): CoreCodeAgentTranscriptEvent {
  return {
    schemaVersion: 1,
    id: event.id,
    runId: event.runId,
    kind: (event.kind ??
      event.type ??
      "status") as CoreCodeAgentTranscriptEvent["kind"],
    message: event.message ?? event.text ?? "",
    createdAt: event.createdAt,
    metadata: {
      ...(event.metadata ?? {}),
      ...(event.artifactPath ? { artifactPath: event.artifactPath } : {}),
      ...(event.artifactUrl ? { artifactUrl: event.artifactUrl } : {}),
    },
  };
}

function contentPartForCodeAgentTranscriptItem(
  item: NormalizedCodeAgentTranscriptItem,
): ContentPart | null {
  if (item.type === "assistant") {
    return item.text.trim() ? { type: "text", text: item.text.trim() } : null;
  }
  if (item.type === "tool") {
    return toolContentPartForCodeAgentTranscriptItem(item);
  }
  if (item.type === "thinking") {
    return thinkingContentPartForCodeAgentTranscriptItem(item);
  }
  if (item.type === "status") {
    const text = statusTextForCodeAgentTranscriptItem(item);
    return text ? { type: "text", text } : null;
  }
  return null;
}

function thinkingContentPartForCodeAgentTranscriptItem(
  item: NormalizedCodeAgentThinkingEvent,
): ContentPart | null {
  const text = item.text.trim();
  if (!text) return null;
  // Surface as a special "thinking" tool-call-like part so the chat renderer
  // can display a collapsed-by-default "Thinking…" cell.  Using a distinct
  // toolName makes it easy to style in AssistantChat without a new content type.
  return {
    type: "tool-call",
    toolCallId: `thinking-${item.id}`,
    toolName: "thinking",
    argsText: "",
    args: {},
    result: text,
  };
}

function toolContentPartForCodeAgentTranscriptItem(
  item: NormalizedCodeAgentToolEvent,
): ContentPart {
  return {
    type: "tool-call",
    toolCallId: `code-tool-${item.id}`,
    toolName: item.tool ?? item.label ?? "code-agent",
    argsText: previewValue(item.input) ?? "",
    args: recordArgs(item.input),
    ...(item.result !== undefined
      ? { result: previewValue(item.result) ?? "" }
      : {}),
    ...(item.mcpApp ? { mcpApp: item.mcpApp } : {}),
    ...(item.structuredMeta ? { structuredMeta: item.structuredMeta } : {}),
  };
}

function statusTextForCodeAgentTranscriptItem(
  item: NormalizedCodeAgentStatusEvent,
): string | null {
  if (item.statusKind === "artifact") {
    const event = item.events[0];
    const path =
      stringMetadata(event?.metadata, "artifactPath") ??
      stringMetadata(event?.metadata, "path");
    const url = stringMetadata(event?.metadata, "artifactUrl");
    const target = url ?? path;
    return target
      ? `Artifact: ${item.text}\n${target}`
      : `Artifact: ${item.text}`;
  }
  if (item.level === "info" && item.statusKind !== "note") return null;
  return item.text;
}

function recordArgs(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] =
      typeof entry === "string" ? entry : (previewValue(entry) ?? "");
  }
  return result;
}

function previewValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text =
    typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "");
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed.length > 4000 ? `${trimmed.slice(0, 4000)}\n...` : trimmed;
}

function stringMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function withRunMetadata(
  result: ChatModelRunResult,
  runId: string,
): ChatModelRunResult {
  const metadata = (result.metadata ?? {}) as Record<string, unknown>;
  const custom =
    metadata.custom && typeof metadata.custom === "object"
      ? (metadata.custom as Record<string, unknown>)
      : {};
  return {
    ...result,
    metadata: {
      ...metadata,
      custom: { ...custom, runId },
    },
  };
}

function errorResult(message: string, runId?: string): ChatModelRunResult {
  return withRunMetadata(
    {
      content: [{ type: "text", text: message }],
      status: { type: "incomplete", reason: "error" },
    } as ChatModelRunResult,
    runId ?? "code-agent",
  );
}

function sleep(ms: number, abortSignal: AbortSignal): Promise<void> {
  if (abortSignal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    abortSignal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}
