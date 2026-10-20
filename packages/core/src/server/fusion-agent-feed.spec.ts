import { describe, expect, it } from "vitest";

import {
  createFusionToolCallMemory,
  fusionStepToAgentChatEvents,
} from "./fusion-agent-feed.js";

describe("fusionStepToAgentChatEvents tool results", () => {
  it("names a result after the call it completes", () => {
    const memory = createFusionToolCallMemory();
    fusionStepToAgentChatEvents(
      { type: "tool", name: "Glob", id: "t1", content: "{}" },
      memory,
    );
    const [done] = fusionStepToAgentChatEvents(
      { type: "tool_result", result: { tool_use_id: "t1", content: "ok" } },
      memory,
    );
    expect(done).toMatchObject({ type: "tool_done", tool: "Glob", id: "t1" });
  });

  it("completes the oldest open call when a result has no id", () => {
    const memory = createFusionToolCallMemory();
    fusionStepToAgentChatEvents(
      { type: "tool", name: "Read", id: "r1", content: "{}" },
      memory,
    );
    fusionStepToAgentChatEvents(
      { type: "tool", name: "Grep", id: "g1", content: "{}" },
      memory,
    );
    const [done] = fusionStepToAgentChatEvents(
      { type: "tool_result", result: { content: "ok" } },
      memory,
    );
    expect(done).toMatchObject({ type: "tool_done", tool: "Read", id: "r1" });
  });
});
