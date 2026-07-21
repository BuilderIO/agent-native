import type { CodeAgentTranscriptEvent } from "../../shared/ipc-channels.js";

export const CODE_AGENT_TRANSCRIPT_SNAPSHOT_EVENT_LIMIT = 200;
export const CODE_AGENT_TRANSCRIPT_SNAPSHOT_BYTE_LIMIT = 512 * 1024;

const CODE_AGENT_TRANSCRIPT_TRUNCATION_MARKER_BYTE_RESERVE = 1024;

export interface CodeAgentTranscriptWindowOptions {
  eventLimit?: number;
  byteLimit?: number;
}

export interface CodeAgentTranscriptTruncation {
  reason: "event-limit" | "byte-limit" | "event-and-byte-limit";
  omittedEventCount: number;
  retainedEventCount: number;
  eventLimit: number;
  byteLimit: number;
}

export interface CodeAgentTranscriptWindow<T> {
  events: T[];
  truncation?: CodeAgentTranscriptTruncation;
}

export function boundedCodeAgentTranscriptSnapshot<T>(
  events: readonly T[],
  limit = CODE_AGENT_TRANSCRIPT_SNAPSHOT_EVENT_LIMIT,
): T[] {
  return boundedCodeAgentTranscriptWindow(events, { eventLimit: limit }).events;
}

export function boundedCodeAgentTranscriptWindow<T>(
  events: readonly T[],
  options: CodeAgentTranscriptWindowOptions = {},
): CodeAgentTranscriptWindow<T> {
  const eventLimit = normalizeLimit(
    options.eventLimit,
    CODE_AGENT_TRANSCRIPT_SNAPSHOT_EVENT_LIMIT,
  );
  const byteLimit = normalizeLimit(
    options.byteLimit,
    CODE_AGENT_TRANSCRIPT_SNAPSHOT_BYTE_LIMIT,
  );
  const countLimited = events.slice(-eventLimit);
  const omittedByEventLimit = events.length - countLimited.length;
  const eventByteBudget = Math.max(
    0,
    byteLimit - CODE_AGENT_TRANSCRIPT_TRUNCATION_MARKER_BYTE_RESERVE,
  );
  let firstRetainedIndex = countLimited.length;
  let serializedBytes = 2;
  for (let index = countLimited.length - 1; index >= 0; index -= 1) {
    const eventBytes = serializedCodeAgentTranscriptEventBytes(
      countLimited[index],
    );
    const separatorBytes = firstRetainedIndex === countLimited.length ? 0 : 1;
    if (serializedBytes + separatorBytes + eventBytes > eventByteBudget) break;
    serializedBytes += separatorBytes + eventBytes;
    firstRetainedIndex = index;
  }
  const snapshot = countLimited.slice(firstRetainedIndex);
  const omittedEventCount = omittedByEventLimit + firstRetainedIndex;
  if (omittedEventCount === 0) return { events: snapshot };

  return {
    events: snapshot,
    truncation: {
      reason:
        omittedByEventLimit > 0 && firstRetainedIndex > 0
          ? "event-and-byte-limit"
          : omittedByEventLimit > 0
            ? "event-limit"
            : "byte-limit",
      omittedEventCount,
      retainedEventCount: snapshot.length,
      eventLimit,
      byteLimit,
    },
  };
}

export function serializedCodeAgentTranscriptEventsBytes(
  events: readonly unknown[],
): number {
  return Buffer.byteLength(JSON.stringify(events), "utf8");
}

function serializedCodeAgentTranscriptEventBytes(event: unknown): number {
  return Buffer.byteLength(JSON.stringify(event), "utf8");
}

export function boundedCodeAgentTranscriptEvents(
  events: readonly CodeAgentTranscriptEvent[],
  runId: string | undefined,
): CodeAgentTranscriptEvent[] {
  const window = boundedCodeAgentTranscriptWindow(events);
  if (!window.truncation || !runId) return window.events;
  let retainedEvents = window.events;
  let truncation = window.truncation;
  if (retainedEvents.length >= CODE_AGENT_TRANSCRIPT_SNAPSHOT_EVENT_LIMIT) {
    retainedEvents = retainedEvents.slice(1);
    truncation = {
      ...truncation,
      omittedEventCount: truncation.omittedEventCount + 1,
      retainedEventCount: retainedEvents.length,
    };
  }
  const firstRetained = retainedEvents[0];
  const tailEvent = events.at(-1);
  if (!tailEvent) return window.events;
  const marker = createTruncationMarker(
    runId,
    tailEvent,
    firstRetained,
    truncation,
  );
  const snapshot = [marker, ...retainedEvents];
  return serializedCodeAgentTranscriptEventsBytes(snapshot) <=
    CODE_AGENT_TRANSCRIPT_SNAPSHOT_BYTE_LIMIT
    ? snapshot
    : [
        createTruncationMarker(runId, tailEvent, undefined, {
          ...truncation,
          omittedEventCount: events.length,
          retainedEventCount: 0,
        }),
      ];
}

function createTruncationMarker(
  runId: string,
  tailEvent: CodeAgentTranscriptEvent,
  firstRetained: CodeAgentTranscriptEvent | undefined,
  truncation: CodeAgentTranscriptTruncation,
): CodeAgentTranscriptEvent {
  return {
    id: `transcript-truncated-${runId}-${tailEvent.id}`,
    runId,
    type: "status",
    title: "Transcript truncated",
    text: "Earlier transcript events were omitted from this renderer update.",
    createdAt: firstRetained?.createdAt ?? tailEvent.createdAt,
    metadata: {
      source: "desktop-transcript-window",
      transcriptTruncation: truncation,
    },
  };
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;
}
