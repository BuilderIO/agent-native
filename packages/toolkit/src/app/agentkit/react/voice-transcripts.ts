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
 * The events a voice reply's work still needs in its thread, as one local
 * run. The run never starts on the server, so it never counts as an active
 * run that would hold the composer or the transcript. `existingIds` and
 * `lastSequence` describe the run as the thread already has it.
 */
export function realtimeVoiceWorkEvents(
  update: RealtimeVoiceWorkUpdate,
  existingIds: ReadonlySet<string> = new Set(),
  lastSequence = 0,
): AgentEvent[] {
  const runId = `voice:${update.id}`;
  const base = (id: string, occurredAt: string) => ({
    id: `${runId}:${id}`,
    threadId: update.threadId,
    runId,
    // Numbered below, once the events this run already has are left out.
    sequence: 0,
    occurredAt,
  });
  const steps: { at: string; event: AgentEvent }[] = [];
  for (const call of update.calls) {
    const toolCall: AgentToolCall = {
      id: call.id,
      name: call.name,
      status: "running",
      runId,
      ...(call.input ? { input: call.input } : {}),
    };
    const activity: AgentActivity = {
      id: call.id,
      kind: inferAgentActivityKind(call.name),
      label: voiceWorkLabel(call.name),
      status: "running",
      runId,
      startedAt: call.startedAt,
    };
    steps.push(
      {
        at: call.startedAt,
        event: {
          ...base(`${call.id}:tool-started`, call.startedAt),
          type: "tool.started",
          toolCall,
        },
      },
      {
        at: call.startedAt,
        event: {
          ...base(`${call.id}:activity-started`, call.startedAt),
          type: "activity.started",
          activity,
        },
      },
    );
    const { completedAt } = call;
    if (!completedAt || call.status === "running") continue;
    steps.push(
      {
        at: completedAt,
        event: {
          ...base(`${call.id}:tool-ended`, completedAt),
          type: "tool.updated",
          toolCall: {
            ...toolCall,
            status: call.status,
            ...(call.output !== undefined ? { output: call.output } : {}),
          },
        },
      },
      {
        at: completedAt,
        event: {
          ...base(`${call.id}:activity-ended`, completedAt),
          type: "activity.completed",
          activity: { ...activity, status: call.status, completedAt },
        },
      },
    );
  }
  // Stable: a call's start keeps its place before its end at the same time.
  steps.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  if (update.completedAt) {
    steps.push({
      at: update.completedAt,
      event: {
        ...base("completed", update.completedAt),
        type: "run.completed",
      },
    });
  }
  let sequence = lastSequence;
  return steps
    .filter(({ event }) => !existingIds.has(event.id))
    .map(({ event }) => ({ ...event, sequence: ++sequence }));
}

/**
 * Whether a voice reply's work has started but not completed. A snapshot saved
 * now would keep that run with no terminal event, queued after a reload.
 */
function hasOpenVoiceWork(events: readonly AgentEvent[]): boolean {
  const open = new Set<string>();
  for (const event of events) {
    if (!event.runId.startsWith("voice:")) continue;
    if (event.type === "run.completed") open.delete(event.runId);
    else open.add(event.runId);
  }
  return open.size > 0;
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
      const thread = controller.getThread(threadId);
      // The work's completion saves the thread, this turn included.
      if (hasOpenVoiceWork(thread.events)) return;
      const messages = thread.messages.filter(
        (message) => !isStreamingVoiceMessage(message),
      );
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
              const thread = controller.getThread(threadId);
              const runId = `voice:${update.id}`;
              appendEvents(
                threadId,
                realtimeVoiceWorkEvents(
                  update,
                  new Set(
                    thread.events
                      .filter((event) => event.runId === runId)
                      .map((event) => event.id),
                  ),
                  new Map(Object.entries(thread.runs)).get(runId)
                    ?.lastSequence ?? 0,
                ),
              );
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
