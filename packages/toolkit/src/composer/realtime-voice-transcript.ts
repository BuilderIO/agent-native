export type RealtimeVoiceTranscriptRole = "user" | "assistant";

export interface RealtimeVoiceTranscriptMessage {
  id: string;
  threadId: string;
  role: RealtimeVoiceTranscriptRole;
  text: string;
  createdAt: string;
}

export interface RealtimeVoiceTranscriptSink {
  threadId: string;
  active: boolean;
  append: (message: RealtimeVoiceTranscriptMessage) => boolean;
}

export interface RealtimeVoiceTranscriptRegistry {
  activeThreadId: () => string | undefined;
  publish: (message: RealtimeVoiceTranscriptMessage) => void;
  register: (sink: RealtimeVoiceTranscriptSink) => () => void;
  pendingCount: () => number;
}

export function appendRealtimeVoiceTranscriptToRepository(
  value: unknown,
  transcript: RealtimeVoiceTranscriptMessage,
): { appended: boolean; repository: Record<string, unknown> } {
  const repository =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const messages = Array.isArray(repository.messages)
    ? [...repository.messages]
    : [];
  const duplicate = messages.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const record = entry as Record<string, unknown>;
    const message =
      record.message && typeof record.message === "object"
        ? (record.message as Record<string, unknown>)
        : record;
    return message.id === transcript.id;
  });
  if (duplicate) return { appended: false, repository };

  const parentId =
    typeof repository.headId === "string" ? repository.headId : null;
  const createdAt = new Date(transcript.createdAt);
  const message = {
    id: transcript.id,
    role: transcript.role,
    content: [{ type: "text", text: transcript.text }],
    createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
    metadata: {
      custom: {
        source: "realtime-voice",
      },
    },
    ...(transcript.role === "assistant"
      ? { status: { type: "complete", reason: "stop" } }
      : {}),
  };

  return {
    appended: true,
    repository: {
      ...repository,
      messages: [...messages, { message, parentId }],
      headId: transcript.id,
    },
  };
}

export function createRealtimeVoiceTranscriptRegistry(): RealtimeVoiceTranscriptRegistry {
  const sinks = new Map<
    symbol,
    RealtimeVoiceTranscriptSink & { order: number }
  >();
  const pending = new Map<string, RealtimeVoiceTranscriptMessage>();
  const delivered = new Set<string>();
  let order = 0;

  const flush = () => {
    for (const [id, message] of pending) {
      let consumed = false;
      for (const sink of sinks.values()) {
        if (sink.threadId !== message.threadId) continue;
        try {
          consumed = sink.append(message) || consumed;
        } catch {
          // Keep the completed transcript queued until the chat can import it.
        }
      }
      if (!consumed) continue;
      pending.delete(id);
      delivered.add(id);
      if (delivered.size > 1_000) {
        const oldest = delivered.values().next().value;
        if (typeof oldest === "string") delivered.delete(oldest);
      }
    }
  };

  return {
    activeThreadId() {
      let active: (RealtimeVoiceTranscriptSink & { order: number }) | undefined;
      for (const sink of sinks.values()) {
        if (!sink.active || (active && sink.order <= active.order)) continue;
        active = sink;
      }
      return active?.threadId;
    },
    publish(message) {
      const id = message.id.trim();
      const threadId = message.threadId.trim();
      const text = message.text.trim();
      if (!id || !threadId || !text || delivered.has(id) || pending.has(id)) {
        return;
      }
      pending.set(id, { ...message, id, threadId, text });
      flush();
    },
    register(sink) {
      const token = Symbol("realtime-voice-transcript-sink");
      sinks.set(token, { ...sink, order: ++order });
      flush();
      return () => sinks.delete(token);
    },
    pendingCount: () => pending.size,
  };
}

export const realtimeVoiceTranscriptRegistry =
  createRealtimeVoiceTranscriptRegistry();
