import { describe, expect, it } from "vitest";

import { mergePinnedLabels } from "./mail-settings.js";

describe("mergePinnedLabels", () => {
  it("keeps concurrent additions while preserving an existing pin", () => {
    expect(
      mergePinnedLabels(
        ["important", "travel"],
        ["important", "sent"],
        ["important"],
      ),
    ).toEqual(["important", "travel", "sent"]);
  });

  it("does not resurrect a label that another tab removed", () => {
    expect(
      mergePinnedLabels(
        ["important"],
        ["important", "travel", "sent"],
        ["important", "travel"],
      ),
    ).toEqual(["important", "sent"]);
  });

  it("keeps a concurrent add when the caller's next state omitted it", () => {
    expect(
      mergePinnedLabels(["important", "travel"], ["important"], ["important"]),
    ).toEqual(["important", "travel"]);
  });
});
