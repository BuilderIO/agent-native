import { describe, expect, it } from "vitest";

import {
  resolveNewSessionExtensionComposerState,
  type CodeAgentsNewSessionExtension,
} from "./CodeAgentsApp.js";
import { mergeSessionWatchTranscriptEvents } from "./SessionWatchPanel.js";
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
});
