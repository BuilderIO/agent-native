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
  realtimeVoiceToolLabel,
  realtimeVoiceTranscriptRegistry,
  type RealtimeVoiceTranscriptMessage,
  type RealtimeVoiceWorkCall,
  type RealtimeVoiceWorkUpdate,
} from "../../../composer/realtime-voice-transcript.js";
import { isChatThreadViewed } from "./viewed-threads.js";

const REALTIME_VOICE_MESSAGE_SOURCE = "realtime-voice";
const VOICE_RUN_PREFIX = "voice:";

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
  const runId = `${VOICE_RUN_PREFIX}${update.id}`;
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
      label: realtimeVoiceToolLabel(call.name),
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
 * Voice work this page is still running, by thread. Saved work that is not
 * here can never finish, so it is closed instead of waited on.
 */
const runningVoiceWork = new Map<string, Set<string>>();

interface VoiceRunThread {
  events: readonly AgentEvent[];
  runs: Readonly<Record<string, { lastSequence: number }>>;
}

function voiceRunPosition(thread: VoiceRunThread, runId: string) {
  return {
    existingIds: new Set(
      thread.events
        .filter((event) => event.runId === runId)
        .map((event) => event.id),
    ),
    lastSequence:
      new Map(Object.entries(thread.runs)).get(runId)?.lastSequence ?? 0,
  };
}

/**
 * The events that end, as cancelled, every voice run in `thread` with no
 * terminal event. A snapshot saved while a call ran keeps such a run after a
 * reload, and nothing is left to finish it.
 */
export function orphanedVoiceWorkEvents(
  thread: VoiceRunThread,
  threadId: string,
  completedAt = new Date().toISOString(),
): AgentEvent[] {
  const runs = new Map<
    string,
    { calls: RealtimeVoiceWorkCall[]; completed: boolean }
  >();
  for (const event of thread.events) {
    if (!event.runId.startsWith(VOICE_RUN_PREFIX)) continue;
    const run = runs.get(event.runId) ?? { calls: [], completed: false };
    runs.set(event.runId, run);
    if (event.type === "run.completed") run.completed = true;
    if (event.type !== "tool.started") continue;
    const { input } = event.toolCall;
    run.calls.push({
      id: event.toolCall.id,
      name: event.toolCall.name,
      status: "cancelled",
      startedAt: event.occurredAt,
      completedAt,
      ...(input && typeof input === "object" && !Array.isArray(input)
        ? { input: input as Record<string, unknown> }
        : {}),
    });
  }
  return [...runs]
    .filter(([, run]) => !run.completed)
    .flatMap(([runId, run]) => {
      const { existingIds, lastSequence } = voiceRunPosition(thread, runId);
      return realtimeVoiceWorkEvents(
        {
          id: runId.slice(VOICE_RUN_PREFIX.length),
          threadId,
          calls: run.calls,
          completedAt,
        },
        existingIds,
        lastSequence,
      );
    });
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
    /** False when the thread could not be checked yet. */
    const closeOrphanedWork = (): boolean => {
      if (!appendEvents || runningVoiceWork.get(threadId)?.size) return false;
      const thread = controller.getThread(threadId);
      if (hasActiveAgentRuns(thread)) return false;
      const events = orphanedVoiceWorkEvents(thread, threadId);
      if (events.length > 0) appendEvents(threadId, events);
      return true;
    };
    const persist = () => {
      // The work's completion saves the thread, this turn included.
      if (runningVoiceWork.get(threadId)?.size) return;
      closeOrphanedWork();
      const messages = controller
        .getThread(threadId)
        .messages.filter((message) => !isStreamingVoiceMessage(message));
      // A failed save surfaces through the controller's connection error;
      // a host without transport persistence saves the thread itself.
      void controller.persistThreadSnapshotWithResult?.(threadId, messages);
    };
    // The thread's snapshot can land after this mounts, so check each time
    // its events change rather than once.
    let checkedEventCount = -1;
    const closeOrphanedWorkOnChange = () => {
      const { length } = controller.getThread(threadId).events;
      if (length === checkedEventCount) return;
      if (closeOrphanedWork()) checkedEventCount = length;
    };
    closeOrphanedWorkOnChange();
    const unsubscribe = controller.subscribe(closeOrphanedWorkOnChange);
    const unregister = realtimeVoiceTranscriptRegistry.register({
      threadId,
      active: () => isChatThreadViewed(threadId),
      ...(appendEvents
        ? {
            appendWork: (update: RealtimeVoiceWorkUpdate) => {
              if (hasActiveAgentRuns(controller.getThread(threadId))) {
                return false;
              }
              const runId = `${VOICE_RUN_PREFIX}${update.id}`;
              const { existingIds, lastSequence } = voiceRunPosition(
                controller.getThread(threadId),
                runId,
              );
              const running = runningVoiceWork.get(threadId) ?? new Set();
              runningVoiceWork.set(threadId, running);
              // Marked before the append notifies, so its own events never
              // read as orphaned.
              if (!update.completedAt) running.add(runId);
              appendEvents(
                threadId,
                realtimeVoiceWorkEvents(update, existingIds, lastSequence),
              );
              if (update.completedAt) {
                running.delete(runId);
                persist();
              }
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
    return () => {
      unsubscribe();
      unregister();
    };
  }, [controller, threadId, running]);
}
