import { describe, expect, it, vi } from "vitest";

vi.mock("../db/index.js", () => ({
  getDb: vi.fn(),
  schema: { deckVersions: {} },
}));

import { deckVersionChatContextFromAction } from "./deck-versions.js";

describe("deck version action context", () => {
  it("preserves WebMCP thread, run, and turn metadata", () => {
    expect(
      deckVersionChatContextFromAction({
        caller: "webmcp",
        threadId: "thread-webmcp",
        runId: "run-webmcp",
        turnId: "turn-webmcp",
      }),
    ).toEqual({
      threadId: "thread-webmcp",
      runId: "run-webmcp",
      turnId: "turn-webmcp",
    });
  });
});
