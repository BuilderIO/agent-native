export type RealtimeVoiceTranscriptRole = "user" | "assistant";

export interface RealtimeVoiceTranscriptMessage {
  id: string;
  threadId: string;
  role: RealtimeVoiceTranscriptRole;
  text: string;
  createdAt: string;
  /** Streaming updates repeat the id with longer text until the final one. */
  status?: "streaming" | "complete";
}

export interface RealtimeVoiceTranscriptSink {
  threadId: string;
  /** Read when a voice session starts, so a sink can report whether it is on screen. */
  active: boolean | (() => boolean);
  /** False keeps the message queued, newest text per id, until the sink re-registers. */
  append: (message: RealtimeVoiceTranscriptMessage) => boolean;
}

export interface RealtimeVoiceTranscriptRegistry {
  activeThreadId: () => string | undefined;
  publish: (message: RealtimeVoiceTranscriptMessage) => void;
  register: (sink: RealtimeVoiceTranscriptSink) => () => void;
  pendingCount: () => number;
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
          // coercion-ok: a throwing sink leaves the transcript queued for the next flush.
        }
      }
      if (!consumed) continue;
      pending.delete(id);
      if (message.status === "streaming") continue;
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
        const isActive =
          typeof sink.active === "function" ? sink.active() : sink.active;
        if (!isActive || (active && sink.order <= active.order)) continue;
        active = sink;
      }
      return active?.threadId;
    },
    publish(message) {
      const id = message.id.trim();
      const threadId = message.threadId.trim();
      const text = message.text.trim();
      if (!id || !threadId || !text || delivered.has(id)) return;
      const queued = pending.get(id);
      const streaming = message.status === "streaming";
      // A final transcript already queued outranks a late streaming update.
      if (queued && queued.status !== "streaming" && streaming) return;
      if (queued && !streaming && queued.status !== "streaming") return;
      pending.set(id, {
        ...message,
        id,
        threadId,
        text,
        status: streaming ? "streaming" : "complete",
      });
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
