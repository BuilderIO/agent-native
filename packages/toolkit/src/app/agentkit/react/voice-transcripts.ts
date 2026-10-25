import {
  hasActiveAgentRuns,
  type AgentKitController,
} from "@agent-native/agentkit/client";
import type { AgentMessage } from "@agent-native/agentkit/protocol";
import { useEffect } from "react";

import {
  realtimeVoiceTranscriptRegistry,
  type RealtimeVoiceTranscriptMessage,
} from "../../../composer/realtime-voice-transcript.js";
import { isChatThreadViewed } from "./viewed-threads.js";

const REALTIME_VOICE_MESSAGE_SOURCE = "realtime-voice";

function realtimeVoiceTranscriptMessage(
  transcript: RealtimeVoiceTranscriptMessage,
): AgentMessage {
  const createdAt = new Date(transcript.createdAt);
  return {
    id: transcript.id,
    role: transcript.role,
    parts: [{ type: "text", text: transcript.text }],
    status: transcript.status === "streaming" ? "streaming" : "complete",
    createdAt: Number.isNaN(createdAt.getTime())
      ? new Date().toISOString()
      : createdAt.toISOString(),
    metadata: { custom: { source: REALTIME_VOICE_MESSAGE_SOURCE } },
  };
}

function isStreamingVoiceMessage(message: AgentMessage): boolean {
  const custom = message.metadata?.custom as { source?: unknown } | undefined;
  return (
    message.status === "streaming" &&
    custom?.source === REALTIME_VOICE_MESSAGE_SOURCE
  );
}

/**
 * Streams voice chat turns into `threadId`'s transcript as messages, in every
 * host that renders the chat. Each final turn is saved with the thread, so a
 * reload shows the conversation; a turn still being spoken is never saved.
 */
export function useRealtimeVoiceTranscripts(
  controller: AgentKitController,
  threadId: string | undefined,
  running: boolean,
): void {
  useEffect(() => {
    if (!threadId || !controller.upsertLocalMessages) return;
    const upsert = controller.upsertLocalMessages.bind(controller);
    return realtimeVoiceTranscriptRegistry.register({
      threadId,
      active: () => isChatThreadViewed(threadId),
      append: (transcript) => {
        // A run owns the thread snapshot while it streams; the turn waits in
        // the registry and lands when this sink re-registers after the run.
        if (hasActiveAgentRuns(controller.getThread(threadId))) return false;
        upsert(threadId, [realtimeVoiceTranscriptMessage(transcript)]);
        if (transcript.status === "streaming") return true;
        const messages = controller
          .getThread(threadId)
          .messages.filter((message) => !isStreamingVoiceMessage(message));
        // A failed save surfaces through the controller's connection error;
        // a host without transport persistence saves the thread itself.
        void controller.persistThreadSnapshotWithResult?.(threadId, messages);
        return true;
      },
    });
  }, [controller, threadId, running]);
}
