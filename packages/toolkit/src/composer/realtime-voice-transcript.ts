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

/** A tool call a voice turn made, so the chat can show it as work. */
export interface RealtimeVoiceWorkUpdate {
  /** The provider's call id; every update for one call repeats it. */
  id: string;
  threadId: string;
  name: string;
  input?: Record<string, unknown>;
  status: "running" | "completed" | "failed" | "cancelled";
  output?: string;
  startedAt: string;
  /** Set once the call has finished. */
  completedAt?: string;
}

export interface RealtimeVoiceTranscriptSink {
  threadId: string;
  /** Read when a voice session starts, so a sink can report whether it is on screen. */
  active: boolean | (() => boolean);
  /** False keeps the message queued, newest text per id, until the sink re-registers. */
  append: (message: RealtimeVoiceTranscriptMessage) => boolean;
  /** False keeps the update queued, newest per call, until the sink re-registers. */
  appendWork?: (update: RealtimeVoiceWorkUpdate) => boolean;
}

export interface RealtimeVoiceTranscriptRegistry {
  activeThreadId: () => string | undefined;
  publish: (message: RealtimeVoiceTranscriptMessage) => void;
  publishWork: (update: RealtimeVoiceWorkUpdate) => void;
  register: (sink: RealtimeVoiceTranscriptSink) => () => void;
  pendingCount: () => number;
}

export function createRealtimeVoiceTranscriptRegistry(): RealtimeVoiceTranscriptRegistry {
  const sinks = new Map<
    symbol,
    RealtimeVoiceTranscriptSink & { order: number }
  >();
  const pending = new Map<string, RealtimeVoiceTranscriptMessage>();
  const pendingWork = new Map<string, RealtimeVoiceWorkUpdate>();
  const delivered = new Set<string>();
  let order = 0;

  const flush = () => {
    for (const [id, update] of pendingWork) {
      let consumed = false;
      for (const sink of sinks.values()) {
        if (sink.threadId !== update.threadId || !sink.appendWork) continue;
        try {
          consumed = sink.appendWork(update) || consumed;
        } catch {
          // coercion-ok: a throwing sink leaves the update queued for the next flush.
        }
      }
      if (consumed) pendingWork.delete(id);
    }
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
    publishWork(update) {
      const id = update.id.trim();
      const threadId = update.threadId.trim();
      if (!id || !threadId) return;
      // A finished call outranks a late "running" update for it.
      if (pendingWork.get(id)?.completedAt && !update.completedAt) return;
      pendingWork.set(id, { ...update, id, threadId });
      flush();
    },
    register(sink) {
      const token = Symbol("realtime-voice-transcript-sink");
      sinks.set(token, { ...sink, order: ++order });
      flush();
      return () => sinks.delete(token);
    },
    pendingCount: () => pending.size + pendingWork.size,
  };
}

export const realtimeVoiceTranscriptRegistry =
  createRealtimeVoiceTranscriptRegistry();
