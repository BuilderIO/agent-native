import { describe, expect, it, vi } from "vitest";

import {
  BUILDER_CMS_BODY_BLOCKS_HASH_KEY,
  BUILDER_CMS_BODY_CONTENT_KEY,
  BUILDER_CMS_HAS_AUTOSAVES_KEY,
} from "./_builder-cms-source-adapter";
import {
  BUILDER_CMS_UNPUBLISHED_CHANGES_KEY,
  builderCmsEntryStatus,
  builderCmsUnpublishedChangesAfterWrite,
  builderSourceValuesKeepingUnpublishedChanges,
  readBuilderCmsUnpublishedChanges,
  withBuilderCmsUnpublishedChanges,
} from "./_builder-cms-unpublished-changes";

function saved(
  values: Record<string, string | null>,
  changes: {
    liveValues: Record<string, string | null>;
    liveBlocksHash?: string;
    liveLastUpdated?: number;
  },
) {
  return withBuilderCmsUnpublishedChanges(values, changes);
}

describe("Builder unpublished changes", () => {
  it("keeps a saved value while Builder still reports the value it was saved over", () => {
    const existing = saved(
      { published: "published", "data.title": "Saved title" },
      { liveValues: { "data.title": "Live title" } },
    );

    const next = builderSourceValuesKeepingUnpublishedChanges({
      incoming: { published: "published", "data.title": "Live title" },
      existing,
    });

    expect(next["data.title"]).toBe("Saved title");
    expect(readBuilderCmsUnpublishedChanges(next)).toEqual({
      state: "pending",
      changes: { liveValues: { "data.title": "Live title" } },
    });
  });

  it("lets Builder's value win once that field changes in Builder", () => {
    const existing = saved(
      {
        published: "published",
        "data.title": "Saved title",
        "data.blurb": "Saved blurb",
      },
      {
        liveValues: { "data.title": "Live title", "data.blurb": "Live blurb" },
      },
    );

    const next = builderSourceValuesKeepingUnpublishedChanges({
      incoming: {
        published: "published",
        "data.title": "Published in Builder",
        "data.blurb": "Live blurb",
      },
      existing,
    });

    expect(next["data.title"]).toBe("Published in Builder");
    expect(next["data.blurb"]).toBe("Saved blurb");
    expect(readBuilderCmsUnpublishedChanges(next)).toEqual({
      state: "pending",
      changes: { liveValues: { "data.blurb": "Live blurb" } },
    });
  });

  it("keeps a saved value Builder did not return", () => {
    const existing = saved(
      { published: "published", "data.title": "Saved title" },
      { liveValues: { "data.title": "Live title" } },
    );

    const next = builderSourceValuesKeepingUnpublishedChanges({
      incoming: { published: "published" },
      existing,
    });

    expect(next["data.title"]).toBe("Saved title");
  });

  it("keeps saved fields through a body read that fills missing fields from the row", () => {
    const existing = saved(
      { published: "published", "data.blurb": "Saved blurb" },
      { liveValues: { "data.blurb": null } },
    );

    const next = builderSourceValuesKeepingUnpublishedChanges({
      incoming: { ...existing, published: "published" },
      existing,
      incomingFilledFromRow: true,
    });

    expect(next["data.blurb"]).toBe("Saved blurb");
    expect(readBuilderCmsUnpublishedChanges(next)).toEqual({
      state: "pending",
      changes: { liveValues: { "data.blurb": null } },
    });
  });

  it("lets a field Builder changed win through a body read that fills from the row", () => {
    const existing = saved(
      { published: "published", "data.title": "Saved title" },
      { liveValues: { "data.title": "Live title" } },
    );

    const next = builderSourceValuesKeepingUnpublishedChanges({
      incoming: { published: "published", "data.title": "Published title" },
      existing,
      incomingFilledFromRow: true,
    });

    expect(next["data.title"]).toBe("Published title");
    expect(next).not.toHaveProperty(BUILDER_CMS_UNPUBLISHED_CHANGES_KEY);
  });

  it("keeps the reference id that goes with a kept reference value", () => {
    const existing = saved(
      {
        published: "published",
        "data.author": "Saved author",
        "__agent_native_builder_reference_id:data.author": "author-2",
      },
      {
        liveValues: {
          "data.author": "Live author",
          "__agent_native_builder_reference_id:data.author": "author-1",
        },
      },
    );

    const next = builderSourceValuesKeepingUnpublishedChanges({
      incoming: {
        published: "published",
        "data.author": "Live author",
        "__agent_native_builder_reference_id:data.author": "author-1",
      },
      existing,
    });

    expect(next["data.author"]).toBe("Saved author");
    expect(next["__agent_native_builder_reference_id:data.author"]).toBe(
      "author-2",
    );
  });

  it("compares a reference by id, so a new reference with the same label wins", () => {
    const existing = saved(
      {
        published: "published",
        "data.author": "Saved author",
        "__agent_native_builder_reference_id:data.author": "author-2",
      },
      {
        liveValues: {
          "data.author": "Sam Lee",
          "__agent_native_builder_reference_id:data.author": "author-1",
        },
      },
    );

    const next = builderSourceValuesKeepingUnpublishedChanges({
      incoming: {
        published: "published",
        "data.author": "Sam Lee",
        "__agent_native_builder_reference_id:data.author": "author-3",
      },
      existing,
    });

    expect(next["data.author"]).toBe("Sam Lee");
    expect(next["__agent_native_builder_reference_id:data.author"]).toBe(
      "author-3",
    );
    expect(next).not.toHaveProperty(BUILDER_CMS_UNPUBLISHED_CHANGES_KEY);
  });

  it("drops the record when the entry is no longer published", () => {
    const existing = saved(
      { published: "published", "data.title": "Saved title" },
      { liveValues: { "data.title": "Live title" } },
    );

    const next = builderSourceValuesKeepingUnpublishedChanges({
      incoming: { published: "draft", "data.title": "Live title" },
      existing,
    });

    expect(next["data.title"]).toBe("Live title");
    expect(next).not.toHaveProperty(BUILDER_CMS_UNPUBLISHED_CHANGES_KEY);
  });

  it("drops the record when Builder says the entry has no unpublished changes", () => {
    const existing = saved(
      { published: "published", "data.title": "Saved title" },
      { liveValues: { "data.title": "Live title" } },
    );

    const next = builderSourceValuesKeepingUnpublishedChanges({
      incoming: {
        published: "published",
        "data.title": "Live title",
        [BUILDER_CMS_HAS_AUTOSAVES_KEY]: false,
      },
      existing,
    });

    expect(next["data.title"]).toBe("Live title");
    expect(next).not.toHaveProperty(BUILDER_CMS_UNPUBLISHED_CHANGES_KEY);
  });

  it("keeps the record when Builder does not report whether changes are pending", () => {
    const existing = saved(
      { published: "published", "data.title": "Saved title" },
      { liveValues: { "data.title": "Live title" } },
    );

    const next = builderSourceValuesKeepingUnpublishedChanges({
      incoming: {
        published: "published",
        "data.title": "Live title",
        [BUILDER_CMS_HAS_AUTOSAVES_KEY]: true,
      },
      existing,
    });

    expect(next["data.title"]).toBe("Saved title");
  });

  it("warns and lets Builder win when the record cannot be read", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const next = builderSourceValuesKeepingUnpublishedChanges({
        incoming: { published: "published", "data.title": "Live title" },
        existing: {
          published: "published",
          "data.title": "Saved title",
          [BUILDER_CMS_UNPUBLISHED_CHANGES_KEY]: "{not json",
        },
      });

      expect(next["data.title"]).toBe("Live title");
      expect(next).not.toHaveProperty(BUILDER_CMS_UNPUBLISHED_CHANGES_KEY);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("tells an unreadable record apart from no record", () => {
    expect(readBuilderCmsUnpublishedChanges({})).toEqual({ state: "none" });
    expect(
      readBuilderCmsUnpublishedChanges({
        [BUILDER_CMS_UNPUBLISHED_CHANGES_KEY]: JSON.stringify({
          liveValues: [],
        }),
      }),
    ).toEqual({ state: "invalid" });
  });

  it("keeps a saved body while Builder still reports the body it was saved over", () => {
    const existing = saved(
      {
        published: "published",
        [BUILDER_CMS_BODY_CONTENT_KEY]: "Saved body",
        [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "saved-hash",
      },
      { liveValues: {}, liveBlocksHash: "live-hash" },
    );

    const kept = builderSourceValuesKeepingUnpublishedChanges({
      incoming: {
        published: "published",
        [BUILDER_CMS_BODY_CONTENT_KEY]: "Live body",
        [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "live-hash",
      },
      existing,
    });
    expect(kept[BUILDER_CMS_BODY_CONTENT_KEY]).toBe("Saved body");
    expect(kept[BUILDER_CMS_BODY_BLOCKS_HASH_KEY]).toBe("saved-hash");

    const replaced = builderSourceValuesKeepingUnpublishedChanges({
      incoming: {
        published: "published",
        [BUILDER_CMS_BODY_CONTENT_KEY]: "Published body",
        [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "published-hash",
      },
      existing,
    });
    expect(replaced[BUILDER_CMS_BODY_CONTENT_KEY]).toBe("Published body");
    expect(replaced).not.toHaveProperty(BUILDER_CMS_UNPUBLISHED_CHANGES_KEY);
  });

  it("keeps a saved body when a read hashes it differently but Builder saved nothing since", () => {
    const existing = saved(
      {
        published: "published",
        [BUILDER_CMS_BODY_CONTENT_KEY]: "Saved body",
        [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "saved-hash",
      },
      { liveValues: {}, liveBlocksHash: "live-hash", liveLastUpdated: 1000 },
    );
    const read = (lastUpdated: number) =>
      builderSourceValuesKeepingUnpublishedChanges({
        incoming: {
          published: "published",
          lastUpdated,
          [BUILDER_CMS_BODY_CONTENT_KEY]: "Live body",
          [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "other-projection-hash",
        },
        existing,
      });

    expect(read(1000)[BUILDER_CMS_BODY_CONTENT_KEY]).toBe("Saved body");
    expect(read(2000)[BUILDER_CMS_BODY_CONTENT_KEY]).toBe("Live body");
  });

  it("checks the body against Builder's values when the stored body was put back", () => {
    const existing = saved(
      {
        published: "published",
        [BUILDER_CMS_BODY_CONTENT_KEY]: "Saved body",
        [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "saved-hash",
      },
      { liveValues: {}, liveBlocksHash: "live-hash" },
    );

    const next = builderSourceValuesKeepingUnpublishedChanges({
      incoming: existing,
      existing,
      builderBodyValues: {
        published: "published",
        [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "live-hash",
      },
    });

    expect(next[BUILDER_CMS_BODY_CONTENT_KEY]).toBe("Saved body");
    expect(readBuilderCmsUnpublishedChanges(next)).toEqual({
      state: "pending",
      changes: { liveValues: {}, liveBlocksHash: "live-hash" },
    });
  });

  it("records the live values each save read before it wrote", () => {
    const first = builderCmsUnpublishedChangesAfterWrite({
      existing: { published: "published" },
      effect: "autosave",
      writtenFieldKeys: ["data.title", "data.blurb"],
      wroteBody: true,
      live: {
        values: { "data.title": "Live title" },
        blocksHash: "live-hash",
        lastUpdated: 1000,
      },
    });
    expect(first).toEqual({
      liveValues: { "data.title": "Live title", "data.blurb": null },
      liveBlocksHash: "live-hash",
      liveLastUpdated: 1000,
    });

    const second = builderCmsUnpublishedChangesAfterWrite({
      existing: withBuilderCmsUnpublishedChanges(
        { published: "published" },
        first,
      ),
      effect: "autosave",
      writtenFieldKeys: ["data.title"],
      wroteBody: false,
      live: {
        values: { "data.title": "First save, published in Builder" },
        blocksHash: "published-hash",
        lastUpdated: 2000,
      },
    });
    expect(second).toEqual({
      liveValues: {
        "data.title": "First save, published in Builder",
        "data.blurb": null,
      },
      liveBlocksHash: "live-hash",
      liveLastUpdated: 1000,
    });
  });

  it("keeps a second save after Builder published the first", () => {
    const afterSecondSave = withBuilderCmsUnpublishedChanges(
      { published: "published", "data.title": "Second save" },
      builderCmsUnpublishedChangesAfterWrite({
        existing: saved(
          { published: "published", "data.title": "First save" },
          { liveValues: { "data.title": "Live title" } },
        ),
        effect: "autosave",
        writtenFieldKeys: ["data.title"],
        wroteBody: false,
        live: {
          values: { "data.title": "First save" },
          blocksHash: null,
          lastUpdated: 2000,
        },
      }),
    );

    const next = builderSourceValuesKeepingUnpublishedChanges({
      incoming: { published: "published", "data.title": "First save" },
      existing: afterSecondSave,
    });

    expect(next["data.title"]).toBe("Second save");
  });

  it("records a reference's live id with its value", () => {
    expect(
      builderCmsUnpublishedChangesAfterWrite({
        existing: { published: "published" },
        effect: "autosave",
        writtenFieldKeys: ["data.author"],
        wroteBody: false,
        live: {
          values: {
            "data.author": "Sam Lee",
            "__agent_native_builder_reference_id:data.author": "author-1",
          },
          blocksHash: null,
          lastUpdated: 1000,
        },
      }),
    ).toEqual({
      liveValues: {
        "data.author": "Sam Lee",
        "__agent_native_builder_reference_id:data.author": "author-1",
      },
    });
  });

  it("tracks a body saved over an empty live body by Builder's update time", () => {
    const changes = builderCmsUnpublishedChangesAfterWrite({
      existing: { published: "published" },
      effect: "autosave",
      writtenFieldKeys: [],
      wroteBody: true,
      live: { values: {}, blocksHash: null, lastUpdated: 1000 },
    });
    expect(changes).toEqual({ liveValues: {}, liveLastUpdated: 1000 });
    const existing = withBuilderCmsUnpublishedChanges(
      {
        published: "published",
        [BUILDER_CMS_BODY_CONTENT_KEY]: "Saved body",
        [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "saved-hash",
      },
      changes,
    );

    const stillEmpty = builderSourceValuesKeepingUnpublishedChanges({
      incoming: { published: "published", lastUpdated: 1000 },
      existing,
    });
    expect(stillEmpty[BUILDER_CMS_BODY_CONTENT_KEY]).toBe("Saved body");

    const published = builderSourceValuesKeepingUnpublishedChanges({
      incoming: {
        published: "published",
        lastUpdated: 2000,
        [BUILDER_CMS_BODY_CONTENT_KEY]: "Published body",
        [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "published-hash",
      },
      existing,
    });
    expect(published[BUILDER_CMS_BODY_CONTENT_KEY]).toBe("Published body");
    expect(published).not.toHaveProperty(BUILDER_CMS_UNPUBLISHED_CHANGES_KEY);
  });

  it("refuses to record an autosave without the live values", () => {
    expect(() =>
      builderCmsUnpublishedChangesAfterWrite({
        existing: { published: "published" },
        effect: "autosave",
        writtenFieldKeys: ["data.title"],
        wroteBody: false,
        live: { values: null, blocksHash: null, lastUpdated: null },
      }),
    ).toThrow("live values were not recorded");
  });

  it("removes fields a live write put live, and clears the record on publication changes", () => {
    const existing = saved(
      { published: "published" },
      {
        liveValues: { "data.title": "Live title", "data.blurb": "Live blurb" },
        liveBlocksHash: "live-hash",
        liveLastUpdated: 1000,
      },
    );

    expect(
      builderCmsUnpublishedChangesAfterWrite({
        existing,
        effect: "update_in_place",
        writtenFieldKeys: ["data.title"],
        wroteBody: true,
        live: { values: null, blocksHash: null, lastUpdated: null },
      }),
    ).toEqual({ liveValues: { "data.blurb": "Live blurb" } });
    for (const effect of ["publish", "unpublish"] as const) {
      expect(
        builderCmsUnpublishedChangesAfterWrite({
          existing,
          effect,
          writtenFieldKeys: [],
          wroteBody: false,
          live: { values: null, blocksHash: null, lastUpdated: null },
        }),
      ).toBeNull();
    }
  });

  it("reports Builder's status words for an entry", () => {
    expect(builderCmsEntryStatus({ published: "draft" })).toBe("draft");
    expect(builderCmsEntryStatus({ published: "published" })).toBe("published");
    expect(
      builderCmsEntryStatus({
        published: "published",
        [BUILDER_CMS_HAS_AUTOSAVES_KEY]: true,
      }),
    ).toBe("unpublished_changes");
    expect(
      builderCmsEntryStatus(
        saved(
          { published: "published" },
          { liveValues: { "data.title": "Live title" } },
        ),
      ),
    ).toBe("unpublished_changes");
    expect(builderCmsEntryStatus({ published: "archived" })).toBeNull();
    expect(builderCmsEntryStatus(undefined)).toBeNull();
  });
});
