import { describe, expect, it, vi } from "vitest";

import {
  executeAgentToolCall,
  type ActionEntry,
} from "../../../packages/core/src/agent/production-agent.js";
import addSlide from "./add-slide.js";

describe("add-slide padded tool input", () => {
  it("runs a call that pads unused fields with null and reuseLabels with []", async () => {
    const run = vi.fn(async () => ({ slideId: "cover" }));
    const result = await executeAgentToolCall({
      actions: {
        "add-slide": { ...addSlide, run } as unknown as ActionEntry,
      },
      name: "add-slide",
      callId: "padded-by-model",
      input: {
        contextModeOverride: "off",
        deckId: "deck-1",
        content: '<div class="fmd-slide"><h1>Cover</h1></div>',
        slideId: "cover",
        layout: "title",
        notes: null,
        background: "#0A0A0A",
        transition: "none",
        transitionSpeed: null,
        skipped: false,
        position: null,
        targetSlideCountOverride: null,
        generationComplete: false,
        contextPackId: null,
        reuseLabels: [],
      },
    });

    expect(result.status).toBe("completed");
    const received = run.mock.calls[0]?.[0] as unknown as Record<
      string,
      unknown
    >;
    expect(received).toMatchObject({ slideId: "cover", reuseLabels: [] });
    for (const dropped of [
      "notes",
      "transitionSpeed",
      "position",
      "targetSlideCountOverride",
      "contextPackId",
    ]) {
      expect(received[dropped], dropped).toBeUndefined();
    }
  });
});
