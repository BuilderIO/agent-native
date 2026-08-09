import { describe, expect, it } from "vitest";

import {
  resolveNewSessionExtensionComposerState,
  shouldCloseWatchedChatFirstSession,
  type CodeAgentsNewSessionExtension,
} from "./CodeAgentsApp.js";
import {
  mergeSessionWatchTranscriptEvents,
  SESSION_WATCH_TRANSCRIPT_EVENT_LIMIT,
} from "./SessionWatchPanel.js";
import type { CodeAgentTranscriptEvent } from "./types.js";

const extension: CodeAgentsNewSessionExtension = {
  active: true,
  async submit() {
    return { ok: true };
  },
};

describe("CodeAgentsApp new-session extension seam", () => {
  it("hands an active extension the existing composer without showing a second model selector", () => {
    expect(resolveNewSessionExtensionComposerState(extension)).toEqual({
      active: true,
      useDefaultModeControl: false,
      showModelSelector: false,
    });
  });

  it("keeps the standard composer available when no extension is installed", () => {
    expect(resolveNewSessionExtensionComposerState()).toEqual({
      active: false,
      useDefaultModeControl: true,
      showModelSelector: true,
    });
  });
});

describe("session watch transcript reconciliation", () => {
  it("keeps a live event that arrives before an older snapshot resolves", () => {
    const liveEvent: CodeAgentTranscriptEvent = {
      id: "live",
      runId: "run-1",
      type: "status",
      createdAt: "2026-08-09T20:00:02.000Z",
      text: "live update",
      metadata: { seq: 2 },
    };
    const snapshotEvent: CodeAgentTranscriptEvent = {
      id: "snapshot",
      runId: "run-1",
      type: "status",
      createdAt: "2026-08-09T20:00:01.000Z",
      text: "initial snapshot",
      metadata: { seq: 1 },
    };

    expect(
      mergeSessionWatchTranscriptEvents([liveEvent], [snapshotEvent]).map(
        (event) => event.id,
      ),
    ).toEqual(["snapshot", "live"]);
  });

  it("bounds long-running watched transcripts", () => {
    const events = Array.from(
      { length: SESSION_WATCH_TRANSCRIPT_EVENT_LIMIT + 1 },
      (_, index) => ({
        id: `event-${index}`,
        runId: "run-1",
        type: "status" as const,
        createdAt: "2026-08-09T20:00:00.000Z",
        text: `event ${index}`,
        metadata: { seq: index },
      }),
    );

    const merged = mergeSessionWatchTranscriptEvents([], events);
    expect(merged).toHaveLength(SESSION_WATCH_TRANSCRIPT_EVENT_LIMIT);
    expect(merged[0]?.id).toBe("event-1");
    expect(merged.at(-1)?.id).toBe(
      `event-${SESSION_WATCH_TRANSCRIPT_EVENT_LIMIT}`,
    );
  });
});

describe("chat-first session watch bounds", () => {
  it("only closes when runs have loaded and a code-agent watch target is still missing", () => {
    expect(
      shouldCloseWatchedChatFirstSession({
        runsLoaded: false,
        targetSessionId: "run-1",
        targetKind: "code-agent",
        watchedRunPresent: false,
      }),
    ).toBe(false);
    expect(
      shouldCloseWatchedChatFirstSession({
        runsLoaded: true,
        targetSessionId: "run-1",
        targetKind: "agent-chat",
        watchedRunPresent: false,
      }),
    ).toBe(false);
    expect(
      shouldCloseWatchedChatFirstSession({
        runsLoaded: true,
        targetSessionId: "run-1",
        targetKind: "external",
        watchedRunPresent: false,
      }),
    ).toBe(false);
    expect(
      shouldCloseWatchedChatFirstSession({
        runsLoaded: true,
        targetSessionId: "run-1",
        targetKind: "code-agent",
        watchedRunPresent: false,
      }),
    ).toBe(true);
    expect(
      shouldCloseWatchedChatFirstSession({
        runsLoaded: true,
        targetSessionId: "run-1",
        targetKind: "code-agent",
        watchedRunPresent: true,
      }),
    ).toBe(false);
  });
});
