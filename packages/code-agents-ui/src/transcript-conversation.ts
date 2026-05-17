import type {
  AgentConversationArtifact,
  AgentConversationMessage,
  AgentConversationMessagePart,
  AgentConversationNotice,
  AgentConversationToolCall,
} from "@agent-native/core/client";
import {
  normalizeCodeAgentTranscript,
  type CodeAgentTranscriptEvent as CoreCodeAgentTranscriptEvent,
  type NormalizedCodeAgentStatusEvent,
  type NormalizedCodeAgentToolEvent,
  type NormalizedCodeAgentTranscriptItem,
} from "@agent-native/core/code-agents/transcript-normalizer";
import type { CodeAgentTranscriptEvent } from "./types.js";

export interface NormalizeCodeAgentTranscriptOptions {
  hideCredentialMessages?: boolean;
}

export function normalizeCodeAgentTranscriptForConversation(
  events: CodeAgentTranscriptEvent[],
  options: NormalizeCodeAgentTranscriptOptions = {},
): AgentConversationMessage[] {
  const normalized = normalizeCodeAgentTranscript(
    events.map(toCoreTranscriptEvent),
  );
  const messages: AgentConversationMessage[] = [];
  const assistantByTurn = new Map<number, AgentConversationMessage>();

  const assistantForItem = (item: NormalizedCodeAgentTranscriptItem) => {
    const existing = assistantByTurn.get(item.turnIndex);
    if (existing) return existing;
    const message: AgentConversationMessage = {
      id: `assistant-${item.id}`,
      role: "assistant",
      createdAt: item.createdAt,
      text: "",
      parts: [],
      tools: [],
      notices: [],
      artifacts: [],
    };
    assistantByTurn.set(item.turnIndex, message);
    messages.push(message);
    return message;
  };

  for (const item of normalized.items) {
    if (item.type === "user") {
      messages.push({
        id: item.id,
        role: "user",
        text: item.text,
        createdAt: item.createdAt,
        pending: item.events.some((event) => event.metadata?.pending === true),
      });
      continue;
    }

    const assistant = assistantForItem(item);
    if (item.type === "assistant") {
      appendPart(assistant, {
        id: item.id,
        type: "text",
        text: item.text,
      });
      assistant.text = `${assistant.text ?? ""}${item.text}`;
    } else if (item.type === "tool") {
      const tool = toConversationTool(item);
      appendPart(assistant, {
        id: item.id,
        type: "tool",
        tool,
      });
      assistant.tools = [...(assistant.tools ?? []), tool];
    } else if (item.type === "status") {
      const artifact = toConversationArtifact(item);
      if (artifact) {
        appendPart(assistant, {
          id: item.id,
          type: "artifact",
          artifact,
        });
        assistant.artifacts = [...(assistant.artifacts ?? []), artifact];
      } else {
        const notice = toConversationNotice(item, options);
        if (notice) {
          appendPart(assistant, {
            id: item.id,
            type: "notice",
            notice,
          });
          assistant.notices = [...(assistant.notices ?? []), notice];
        }
      }
    }
  }

  return messages.filter(
    (message) =>
      message.text?.trim() ||
      message.parts?.length ||
      message.tools?.length ||
      message.notices?.length ||
      message.artifacts?.length,
  );
}

function appendPart(
  message: AgentConversationMessage,
  part: AgentConversationMessagePart,
): void {
  message.parts = [...(message.parts ?? []), part];
}

function toCoreTranscriptEvent(
  event: CodeAgentTranscriptEvent,
): CoreCodeAgentTranscriptEvent {
  return {
    schemaVersion: 1,
    id: event.id,
    runId: event.runId,
    kind: event.type as CoreCodeAgentTranscriptEvent["kind"],
    message: event.text,
    createdAt: event.createdAt,
    metadata: {
      ...(event.metadata ?? {}),
      ...(event.title ? { title: event.title } : {}),
      ...(event.artifactPath ? { artifactPath: event.artifactPath } : {}),
      ...(event.artifactUrl ? { artifactUrl: event.artifactUrl } : {}),
    },
  };
}

function toConversationTool(
  item: NormalizedCodeAgentToolEvent,
): AgentConversationToolCall {
  return {
    id: item.id,
    name: item.tool ?? "tool",
    state:
      item.state === "completed"
        ? "completed"
        : item.state === "activity"
          ? "activity"
          : "running",
    input: preview(item.input),
    result: preview(item.result),
    summary:
      item.state === "completed"
        ? "finished"
        : item.state === "activity"
          ? "working"
          : "started",
  };
}

function toConversationNotice(
  item: NormalizedCodeAgentStatusEvent,
  options: NormalizeCodeAgentTranscriptOptions,
): AgentConversationNotice | null {
  if (options.hideCredentialMessages && isCredentialText(item.text))
    return null;
  if (item.level === "info" && item.statusKind !== "note") return null;
  return {
    id: item.id,
    tone:
      item.level === "error"
        ? "error"
        : item.level === "warning" || item.level === "approval"
          ? "warning"
          : "info",
    title:
      item.level === "approval"
        ? "Approval pending"
        : item.statusKind === "note"
          ? "Note"
          : undefined,
    text: item.text,
  };
}

function toConversationArtifact(
  item: NormalizedCodeAgentStatusEvent,
): AgentConversationArtifact | null {
  if (item.statusKind !== "artifact") return null;
  const event = item.events[0];
  const artifactPath =
    stringMetadata(event?.metadata, "artifactPath") ??
    stringMetadata(event?.metadata, "path");
  const artifactUrl = stringMetadata(event?.metadata, "artifactUrl");
  return {
    id: item.id,
    label: item.text || "Artifact",
    path: artifactPath,
    url: artifactUrl,
  };
}

function preview(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text =
    typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "");
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed.length > 1800 ? `${trimmed.slice(0, 1800)}\n...` : trimmed;
}

function stringMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isCredentialText(value: string): boolean {
  return /No LLM provider key was found|Missing credentials/i.test(value);
}
