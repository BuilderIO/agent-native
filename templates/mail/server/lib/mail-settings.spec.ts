import { describe, expect, it } from "vitest";

import {
  mergePinnedLabels,
  mergeSavedFilters,
  normalizeMailSettings,
} from "./mail-settings.js";

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

  it("does not duplicate a concurrent label included in the reorder", () => {
    expect(
      mergePinnedLabels(
        ["inbox", "travel", "sent"],
        ["sent", "inbox", "travel"],
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

describe("normalizeMailSettings", () => {
  it("defaults to split inboxes and preserves the combined-inbox preference", () => {
    expect(normalizeMailSettings(null, "owner@example.com").combineInbox).toBe(
      false,
    );
    expect(
      normalizeMailSettings({ combineInbox: true }, "owner@example.com")
        .combineInbox,
    ).toBe(true);
  });

  it("keeps only bounded, usable saved filters", () => {
    const settings = normalizeMailSettings(
      {
        savedFilters: [
          { id: " github ", name: " Github ", query: " from:github.com " },
          { id: "github", name: "Duplicate", query: "subject:duplicate" },
          { id: "", name: "Missing id", query: "subject:missing" },
          "not-a-filter",
        ] as unknown as Record<string, unknown>,
      },
      "owner@example.com",
    );

    expect(settings.savedFilters).toEqual([
      { id: "github", name: "Github", query: "from:github.com" },
    ]);
  });

  it("drops invalid saved-filter values instead of returning them", () => {
    const settings = normalizeMailSettings(
      { savedFilters: "not-an-array" },
      "owner@example.com",
    );

    expect(settings.savedFilters).toBeUndefined();
  });

  it("deduplicates ids after bounding their normalized length", () => {
    const prefix = "x".repeat(80);
    const settings = normalizeMailSettings(
      {
        savedFilters: [
          {
            id: `${prefix}a`,
            name: "First",
            query: "from:first@example.com",
          },
          {
            id: `${prefix}b`,
            name: "Second",
            query: "from:second@example.com",
          },
        ],
      },
      "owner@example.com",
    );

    expect(settings.savedFilters).toEqual([
      { id: prefix, name: "First", query: "from:first@example.com" },
    ]);
  });
});

describe("mergeSavedFilters", () => {
  const filter = (id: string) => ({
    id,
    name: id,
    query: `subject:${id}`,
  });

  it("keeps concurrent additions while applying a local removal", () => {
    expect(
      mergeSavedFilters(
        [filter("one"), filter("two"), filter("three")],
        [filter("one"), filter("three")],
        [filter("one"), filter("two")],
      ),
    ).toEqual([filter("one"), filter("three")]);
  });

  it("does not overwrite a concurrent filter addition", () => {
    expect(
      mergeSavedFilters(
        [filter("one"), filter("remote")],
        [filter("one"), filter("local")],
        [filter("one")],
      ),
    ).toEqual([filter("one"), filter("remote"), filter("local")]);
  });

  it("reports a concurrent addition that would exceed the filter limit", () => {
    const base = Array.from({ length: 19 }, (_, index) =>
      filter(`base-${index}`),
    );
    const current = [...base, filter("remote")];
    const next = [...base, filter("local")];

    expect(() => mergeSavedFilters(current, next, base)).toThrow(
      "Saved filters changed in another tab; please retry.",
    );
  });
});
