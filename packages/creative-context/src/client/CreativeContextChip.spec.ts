import { describe, expect, it } from "vitest";

import { resolveCreativeContextChipSelection } from "./CreativeContextChip.js";

describe("resolveCreativeContextChipSelection", () => {
  it("keeps the documented precedence", () => {
    expect(
      resolveCreativeContextChipSelection({
        contextMode: "off",
        selectedContextId: "context-1",
        pinnedPackId: "pack-1",
      }),
    ).toBe("off");
    expect(
      resolveCreativeContextChipSelection({
        contextMode: "auto",
        selectedContextId: "context-1",
        pinnedPackId: "pack-1",
      }),
    ).toBe("pinned-pack");
    expect(
      resolveCreativeContextChipSelection({
        contextMode: "auto",
        selectedContextId: "context-1",
        pinnedPackId: null,
      }),
    ).toBe("selected-context");
    expect(resolveCreativeContextChipSelection({ contextMode: "auto" })).toBe(
      "automatic",
    );
  });
});
