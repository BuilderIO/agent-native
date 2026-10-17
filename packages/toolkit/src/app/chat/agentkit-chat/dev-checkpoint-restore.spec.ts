import type { AgentMessage } from "@agent-native/agentkit/protocol";
import { describe, expect, it } from "vitest";

import {
  shouldLoadAgentKitDevCheckpoints,
  shouldOfferAgentKitDevCheckpointRestore,
} from "./history.js";

const base = {
  isDevMode: true,
  isComplete: true,
  isLastMessage: false,
  isBusy: false,
  runId: "run-1",
  checkpointRunIds: new Set(["run-1"]),
  hostname: "localhost",
};

describe("shouldOfferAgentKitDevCheckpointRestore", () => {
  it("offers a checkpoint restore only for a completed non-latest local Code turn", () => {
    expect(shouldOfferAgentKitDevCheckpointRestore(base)).toBe(true);
  });

  it("hides restore when its checkpoint or required state is missing", () => {
    for (const patch of [
      { isDevMode: false },
      { isComplete: false },
      { isLastMessage: true },
      { isBusy: true },
      { runId: undefined },
      { checkpointRunIds: new Set<string>() },
      { hostname: "app.agent-native.com" },
    ]) {
      expect(
        shouldOfferAgentKitDevCheckpointRestore({ ...base, ...patch }),
      ).toBe(false);
    }
  });
});

describe("shouldLoadAgentKitDevCheckpoints", () => {
  const userMessage: AgentMessage = {
    id: "message-user",
    role: "user",
    createdAt: "2026-10-14T00:00:00.000Z",
    status: "complete",
    parts: [{ type: "text", text: "Hello" }],
  };
  const replyMessage: AgentMessage = {
    id: "message-reply",
    role: "assistant",
    createdAt: "2026-10-14T00:00:01.000Z",
    status: "complete",
    parts: [{ type: "text", text: "Hi" }],
    metadata: { runId: "run-1" },
  };
  const loaded = {
    isDevMode: true,
    threadId: "thread-1",
    messages: [userMessage, replyMessage],
    hasActiveRuns: false,
  };

  it("loads checkpoints once a turn's runId shows the thread was saved", () => {
    expect(shouldLoadAgentKitDevCheckpoints(loaded)).toBe(true);
  });

  it("does not request checkpoints for a new chat whose first run has not started", () => {
    expect(
      shouldLoadAgentKitDevCheckpoints({ ...loaded, messages: [userMessage] }),
    ).toBe(false);
  });

  it("does not request checkpoints while a run is active or outside dev mode", () => {
    for (const patch of [
      { hasActiveRuns: true },
      { isDevMode: false },
      { threadId: "" },
    ]) {
      expect(shouldLoadAgentKitDevCheckpoints({ ...loaded, ...patch })).toBe(
        false,
      );
    }
  });
});
