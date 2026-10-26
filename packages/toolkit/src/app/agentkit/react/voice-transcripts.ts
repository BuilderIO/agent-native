import {
  hasActiveAgentRuns,
  type AgentKitController,
} from "@agent-native/agentkit/client";
import {
  inferAgentActivityKind,
  type AgentActivity,
  type AgentEvent,
  type AgentMessage,
  type AgentToolCall,
} from "@agent-native/agentkit/protocol";
import { useEffect } from "react";

import {
  realtimeVoiceTranscriptRegistry,
  type RealtimeVoiceTranscriptMessage,
  type RealtimeVoiceWorkUpdate,
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

function voiceWorkLabel(name: string): string {
  const label = name.replace(/[_-]+/g, " ").trim();
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : name;
}

/**
 * The events of a local run for one voice tool call, so the transcript shows
 * it as work. The run never starts on the server, so it never counts as an
 * active run that would hold the composer or the transcript.
 */
export function realtimeVoiceWorkEvents(
  update: RealtimeVoiceWorkUpdate,
): AgentEvent[] {
  const runId = `voice:${update.id}`;
  const toolCall: AgentToolCall = {
    id: update.id,
    name: update.name,
    status: "running",
    runId,
    ...(update.input ? { input: update.input } : {}),
  };
  const activity: AgentActivity = {
    id: update.id,
    kind: inferAgentActivityKind(update.name),
    label: voiceWorkLabel(update.name),
    status: "running",
    runId,
    startedAt: update.startedAt,
  };
  const base = (sequence: number, occurredAt: string) => ({
    id: `${runId}:${sequence}`,
    threadId: update.threadId,
    runId,
    sequence,
    occurredAt,
  });
  const events: AgentEvent[] = [
    { ...base(1, update.startedAt), type: "tool.started", toolCall },
    { ...base(2, update.startedAt), type: "activity.started", activity },
  ];
  const { completedAt } = update;
  if (!completedAt || update.status === "running") return events;
  events.push(
    {
      ...base(3, completedAt),
      type: "tool.updated",
      toolCall: {
        ...toolCall,
        status: update.status,
        ...(update.output !== undefined ? { output: update.output } : {}),
      },
    },
    {
      ...base(4, completedAt),
      type: "activity.completed",
      activity: { ...activity, status: update.status, completedAt },
    },
    { ...base(5, completedAt), type: "run.completed" },
  );
  return events;
}

/** A voice chat turn still being spoken; hosts must not save it. */
export function isStreamingVoiceMessage(message: AgentMessage): boolean {
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
    const appendEvents = controller.appendLocalEvents?.bind(controller);
    const persist = () => {
      const messages = controller
        .getThread(threadId)
        .messages.filter((message) => !isStreamingVoiceMessage(message));
      // A failed save surfaces through the controller's connection error;
      // a host without transport persistence saves the thread itself.
      void controller.persistThreadSnapshotWithResult?.(threadId, messages);
    };
    return realtimeVoiceTranscriptRegistry.register({
      threadId,
      active: () => isChatThreadViewed(threadId),
      ...(appendEvents
        ? {
            appendWork: (update: RealtimeVoiceWorkUpdate) => {
              if (hasActiveAgentRuns(controller.getThread(threadId))) {
                return false;
              }
              appendEvents(threadId, realtimeVoiceWorkEvents(update));
              if (update.completedAt) persist();
              return true;
            },
          }
        : {}),
      append: (transcript) => {
        // A run owns the thread snapshot while it streams; the turn waits in
        // the registry and lands when this sink re-registers after the run.
        if (hasActiveAgentRuns(controller.getThread(threadId))) return false;
        upsert(threadId, [realtimeVoiceTranscriptMessage(transcript)]);
        if (transcript.status === "streaming") return true;
        persist();
        return true;
      },
    });
  }, [controller, threadId, running]);
}
