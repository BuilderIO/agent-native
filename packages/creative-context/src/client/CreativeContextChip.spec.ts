import { describe, expect, it } from "vitest";

import {
  hasCreativeContextConfiguration,
  resolveCreativeContextChipSelection,
} from "./CreativeContextChip.js";

function context(memberCount: number) {
  return { memberCount };
}

function pack(memberCount: number) {
  return { memberCount };
}

describe("hasCreativeContextConfiguration", () => {
  it("ignores an empty Default context and empty packs", () => {
    expect(hasCreativeContextConfiguration([pack(0)], [context(0)])).toBe(
      false,
    );
  });

  it("shows the chip when a context has reusable resources", () => {
    expect(hasCreativeContextConfiguration([], [context(1)])).toBe(true);
  });

  it("shows the chip when a pack has reusable resources", () => {
    expect(hasCreativeContextConfiguration([pack(1)], [])).toBe(true);
  });
});

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
