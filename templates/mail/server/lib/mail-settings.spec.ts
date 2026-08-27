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

  it("preserves an explicit reorder while merging concurrent additions", () => {
    expect(
      mergePinnedLabels(
        ["inbox", "travel", "sent"],
        ["sent", "inbox"],
        ["inbox", "sent"],
      ),
    ).toEqual(["sent", "inbox", "travel"]);
  });

  it("preserves the latest order for membership-only updates", () => {
    expect(
      mergePinnedLabels(
        ["sent", "travel", "inbox"],
        ["inbox", "sent", "archive"],
        ["inbox", "sent"],
      ),
    ).toEqual(["sent", "travel", "inbox", "archive"]);
  });
});
