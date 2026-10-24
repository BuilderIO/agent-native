import { describe, expect, it, vi } from "vitest";

import {
  BUILDER_CMS_BODY_BLOCK_COUNT_KEY,
  BUILDER_CMS_BODY_BLOCKS_HASH_KEY,
  BUILDER_CMS_BODY_CONTENT_KEY,
  BUILDER_CMS_BODY_LOSSLESS_CONTENT_KEY,
  BUILDER_CMS_HAS_AUTOSAVES_KEY,
} from "./_builder-cms-source-adapter";
import {
  BUILDER_CMS_PUBLICATION_INTENT_KEY,
  BUILDER_CMS_UNPUBLISHED_CHANGES_KEY,
  builderCmsEntryStatus,
  builderCmsLiveBaselineValues,
  builderCmsLiveBodyBaseline,
  builderCmsShownEntryStatus,
  builderCmsUnpublishedChangesAfterWrite,
  builderSourceValuesKeepingUnpublishedChanges,
  readBuilderCmsPublicationIntent,
  readBuilderCmsUnpublishedChanges,
  withBuilderCmsPublicationIntent,
  withBuilderCmsUnpublishedChanges,
} from "./_builder-cms-unpublished-changes";

function saved(
  values: Record<string, string | number | null>,
  changes: {
    liveValues: Record<string, string | null>;
    liveLastUpdated?: number;
    liveBlocksHash?: string;
    liveBodyLastUpdated?: number;
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

  it("drops the record when a read made after the save says nothing is pending", () => {
    const existing = saved(
      { published: "published", "data.title": "Saved title" },
      { liveValues: { "data.title": "Live title" }, liveLastUpdated: 1000 },
    );
    const read = (lastUpdated: number) =>
      builderSourceValuesKeepingUnpublishedChanges({
        incoming: {
          published: "published",
          lastUpdated,
          "data.title": "Live title",
          [BUILDER_CMS_HAS_AUTOSAVES_KEY]: false,
        },
        existing,
      });

    const afterSave = read(2000);
    expect(afterSave["data.title"]).toBe("Live title");
    expect(afterSave).not.toHaveProperty(BUILDER_CMS_UNPUBLISHED_CHANGES_KEY);
    // An autosave leaves lastUpdated alone, so a read with the save's own
    // time may be from just before it.
    expect(read(1000)["data.title"]).toBe("Saved title");
  });

  it("keeps the record through a read made before Content's latest save", () => {
    const existing = saved(
      { published: "published", "data.title": "Second save" },
      {
        liveValues: { "data.title": "First save, published in Builder" },
        liveLastUpdated: 2000,
      },
    );

    const next = builderSourceValuesKeepingUnpublishedChanges({
      incoming: {
        published: "draft",
        lastUpdated: 1000,
        "data.title": "Title before the first save",
        [BUILDER_CMS_HAS_AUTOSAVES_KEY]: false,
      },
      existing,
    });

    expect(next["data.title"]).toBe("Second save");
    expect(readBuilderCmsUnpublishedChanges(next)).toEqual(
      readBuilderCmsUnpublishedChanges(existing),
    );
  });

  it("reads the entry's status from Builder's own values, not the row's", () => {
    const existing = saved(
      {
        published: "published",
        "data.title": "Saved title",
        [BUILDER_CMS_HAS_AUTOSAVES_KEY]: false,
      },
      { liveValues: { "data.title": "Live title" }, liveLastUpdated: 1000 },
    );
    const builderValues = {
      published: "published",
      lastUpdated: 2000,
      "data.title": "Live title",
    };

    const next = builderSourceValuesKeepingUnpublishedChanges({
      incoming: { ...existing, ...builderValues },
      existing,
      incomingFilledFromRow: true,
      builderValues,
    });

    expect(next["data.title"]).toBe("Saved title");
    expect(next).toHaveProperty(BUILDER_CMS_UNPUBLISHED_CHANGES_KEY);
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

  it("lets Builder win and keeps the unreadable record until a save replaces it", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const existing = {
        published: "published",
        "data.title": "Saved title",
        [BUILDER_CMS_UNPUBLISHED_CHANGES_KEY]: "{not json",
      };
      const next = builderSourceValuesKeepingUnpublishedChanges({
        incoming: {
          published: "published",
          "data.title": "Live title",
          "data.blurb": "New Builder field",
        },
        existing,
      });

      expect(next["data.title"]).toBe("Live title");
      expect(next["data.blurb"]).toBe("New Builder field");
      expect(next[BUILDER_CMS_UNPUBLISHED_CHANGES_KEY]).toBe("{not json");
      expect(readBuilderCmsUnpublishedChanges(next)).toEqual({
        state: "invalid",
      });
      expect(error).toHaveBeenCalledTimes(1);

      expect(
        builderCmsUnpublishedChangesAfterWrite({
          existing,
          effect: "autosave",
          writtenFieldKeys: ["data.title"],
          wroteBody: false,
          live: {
            values: { "data.title": "Live title" },
            blocksHash: null,
            lastUpdated: 1000,
          },
        }),
      ).toEqual({
        liveValues: { "data.title": "Live title" },
        liveLastUpdated: 1000,
      });
    } finally {
      error.mockRestore();
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

  it("keeps a saved body as one unit, including an empty one", () => {
    const existing = saved(
      {
        published: "published",
        [BUILDER_CMS_BODY_CONTENT_KEY]: "",
        [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "saved-empty-hash",
        [BUILDER_CMS_BODY_BLOCK_COUNT_KEY]: 0,
      },
      { liveValues: {}, liveBlocksHash: "live-hash" },
    );

    const kept = builderSourceValuesKeepingUnpublishedChanges({
      incoming: {
        published: "published",
        [BUILDER_CMS_BODY_CONTENT_KEY]: "Live body",
        [BUILDER_CMS_BODY_LOSSLESS_CONTENT_KEY]: "Live body, lossless",
        [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "live-hash",
        [BUILDER_CMS_BODY_BLOCK_COUNT_KEY]: 3,
      },
      existing,
    });

    expect(kept[BUILDER_CMS_BODY_CONTENT_KEY]).toBe("");
    expect(kept[BUILDER_CMS_BODY_BLOCKS_HASH_KEY]).toBe("saved-empty-hash");
    expect(kept[BUILDER_CMS_BODY_BLOCK_COUNT_KEY]).toBe(0);
    expect(kept).not.toHaveProperty(BUILDER_CMS_BODY_LOSSLESS_CONTENT_KEY);
    expect(kept).toHaveProperty(BUILDER_CMS_UNPUBLISHED_CHANGES_KEY);
  });

  it("keeps a saved body when a read hashes it differently but Builder saved nothing since", () => {
    const existing = saved(
      {
        published: "published",
        [BUILDER_CMS_BODY_CONTENT_KEY]: "Saved body",
        [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "saved-hash",
      },
      {
        liveValues: {},
        liveBlocksHash: "live-hash",
        liveBodyLastUpdated: 1000,
      },
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
      builderValues: {
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
      liveLastUpdated: 1000,
      liveBlocksHash: "live-hash",
      liveBodyLastUpdated: 1000,
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
      liveLastUpdated: 2000,
      liveBlocksHash: "live-hash",
      liveBodyLastUpdated: 1000,
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
      liveLastUpdated: 1000,
    });
  });

  it("keeps a body saved over an empty live body while Builder's body stays empty", () => {
    const changes = builderCmsUnpublishedChangesAfterWrite({
      existing: { published: "published" },
      effect: "autosave",
      writtenFieldKeys: [],
      wroteBody: true,
      live: {
        values: {},
        blocksHash: null,
        bodyEmpty: true,
        lastUpdated: 1000,
      },
    });
    expect(changes).toEqual({
      liveValues: {},
      liveLastUpdated: 1000,
      liveBodyEmpty: true,
      liveBodyLastUpdated: 1000,
    });
    const existing = withBuilderCmsUnpublishedChanges(
      {
        published: "published",
        [BUILDER_CMS_BODY_CONTENT_KEY]: "Saved body",
        [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "saved-hash",
      },
      changes,
    );
    expect(readBuilderCmsUnpublishedChanges(existing)).toEqual({
      state: "pending",
      changes,
    });

    // Builder saved another field since, and its body is still empty.
    const stillEmpty = builderSourceValuesKeepingUnpublishedChanges({
      incoming: {
        published: "published",
        lastUpdated: 2000,
        [BUILDER_CMS_BODY_BLOCK_COUNT_KEY]: 0,
      },
      existing,
    });
    expect(stillEmpty[BUILDER_CMS_BODY_CONTENT_KEY]).toBe("Saved body");
    // And through every refresh after that one.
    const laterStillEmpty = builderSourceValuesKeepingUnpublishedChanges({
      incoming: {
        published: "published",
        lastUpdated: 3000,
        [BUILDER_CMS_BODY_BLOCK_COUNT_KEY]: 0,
      },
      existing: stillEmpty,
    });
    expect(laterStillEmpty[BUILDER_CMS_BODY_CONTENT_KEY]).toBe("Saved body");
    expect(builderCmsLiveBodyBaseline(laterStillEmpty)).toEqual({
      blocksHash: null,
    });

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
  });

  it("tracks a body saved over one the live check didn't read by Builder's update time", () => {
    const changes = builderCmsUnpublishedChangesAfterWrite({
      existing: { published: "published" },
      effect: "autosave",
      writtenFieldKeys: [],
      wroteBody: true,
      live: { values: {}, blocksHash: null, lastUpdated: 1000 },
    });
    expect(changes).toEqual({
      liveValues: {},
      liveLastUpdated: 1000,
      liveBodyLastUpdated: 1000,
    });
    const existing = withBuilderCmsUnpublishedChanges(
      {
        published: "published",
        [BUILDER_CMS_BODY_CONTENT_KEY]: "Saved body",
        [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "saved-hash",
      },
      changes,
    );

    const unchanged = builderSourceValuesKeepingUnpublishedChanges({
      incoming: {
        published: "published",
        lastUpdated: 1000,
        [BUILDER_CMS_BODY_BLOCK_COUNT_KEY]: 0,
      },
      existing,
    });
    expect(unchanged[BUILDER_CMS_BODY_CONTENT_KEY]).toBe("Saved body");

    // The body Content saved over is unknown, so an empty one Builder saved
    // later replaces Content's.
    const emptied = builderSourceValuesKeepingUnpublishedChanges({
      incoming: {
        published: "published",
        lastUpdated: 2000,
        [BUILDER_CMS_BODY_BLOCK_COUNT_KEY]: 0,
      },
      existing,
    });
    expect(emptied).not.toHaveProperty(BUILDER_CMS_BODY_CONTENT_KEY);

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

  it("lets an empty body Builder published win over a saved body", () => {
    const existing = saved(
      {
        published: "published",
        [BUILDER_CMS_BODY_CONTENT_KEY]: "Saved body",
        [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "saved-hash",
      },
      {
        liveValues: {},
        liveLastUpdated: 1000,
        liveBlocksHash: "live-hash",
        liveBodyLastUpdated: 1000,
      },
    );
    const emptyRead = (lastUpdated: number) =>
      builderSourceValuesKeepingUnpublishedChanges({
        incoming: {
          published: "published",
          lastUpdated,
          [BUILDER_CMS_BODY_BLOCK_COUNT_KEY]: 0,
        },
        existing,
      });

    const emptied = emptyRead(2000);
    expect(emptied).not.toHaveProperty(BUILDER_CMS_BODY_CONTENT_KEY);
    expect(emptied).not.toHaveProperty(BUILDER_CMS_UNPUBLISHED_CHANGES_KEY);
    // A read without the body at all still keeps it.
    expect(
      builderSourceValuesKeepingUnpublishedChanges({
        incoming: { published: "published", lastUpdated: 2000 },
        existing,
      })[BUILDER_CMS_BODY_CONTENT_KEY],
    ).toBe("Saved body");
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
        liveLastUpdated: 900,
        liveBlocksHash: "live-hash",
        liveBodyLastUpdated: 1000,
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
    ).toEqual({
      liveValues: { "data.blurb": "Live blurb" },
      liveLastUpdated: 900,
    });
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
    expect(
      builderCmsEntryStatus({
        published: "published",
        [BUILDER_CMS_UNPUBLISHED_CHANGES_KEY]: "{not json",
      }),
    ).toBe("unpublished_changes");
    expect(builderCmsEntryStatus({ published: "archived" })).toBeNull();
    expect(builderCmsEntryStatus(undefined)).toBeNull();
  });
});

describe("Builder staged publication changes", () => {
  it("shows a staged publish or unpublish only while the source allows it", () => {
    const allowed = { publicationTransitionsAllowed: true };
    const off = { publicationTransitionsAllowed: false };
    const stagedPublish = withBuilderCmsPublicationIntent(
      { published: "draft" },
      "publish",
    );
    const stagedUnpublish = withBuilderCmsPublicationIntent(
      { published: "published", [BUILDER_CMS_HAS_AUTOSAVES_KEY]: true },
      "unpublish",
    );

    expect(builderCmsShownEntryStatus(stagedPublish, allowed)).toBe(
      "published",
    );
    expect(builderCmsShownEntryStatus(stagedUnpublish, allowed)).toBe("draft");
    expect(builderCmsShownEntryStatus(stagedPublish, off)).toBe("draft");
    expect(builderCmsShownEntryStatus(stagedUnpublish, off)).toBe(
      "unpublished_changes",
    );
    expect(
      builderCmsShownEntryStatus(
        withBuilderCmsPublicationIntent({ published: "archived" }, "publish"),
        allowed,
      ),
    ).toBeNull();
  });

  it("tells an unreadable staged change apart from none", () => {
    expect(readBuilderCmsPublicationIntent({ published: "draft" })).toEqual({
      state: "none",
    });
    expect(
      readBuilderCmsPublicationIntent({
        [BUILDER_CMS_PUBLICATION_INTENT_KEY]: "archive",
      }),
    ).toEqual({ state: "invalid" });
    expect(
      builderCmsShownEntryStatus(
        { published: "draft", [BUILDER_CMS_PUBLICATION_INTENT_KEY]: "archive" },
        { publicationTransitionsAllowed: true },
      ),
    ).toBe("draft");
  });

  it("keeps a staged change through a refresh until Builder reaches it", () => {
    const existing = withBuilderCmsPublicationIntent(
      { published: "draft", "data.title": "Title" },
      "publish",
    );

    const stillDraft = builderSourceValuesKeepingUnpublishedChanges({
      incoming: { published: "draft", "data.title": "Title" },
      existing,
    });
    expect(readBuilderCmsPublicationIntent(stillDraft)).toEqual({
      state: "staged",
      transition: "publish",
    });

    const publishedInBuilder = builderSourceValuesKeepingUnpublishedChanges({
      incoming: { published: "published", "data.title": "Title" },
      existing,
    });
    expect(readBuilderCmsPublicationIntent(publishedInBuilder)).toEqual({
      state: "none",
    });
  });

  it("keeps a staged publish over unpublished changes until they go live", () => {
    const existing = withBuilderCmsPublicationIntent(
      saved(
        { published: "published", "data.title": "Saved title" },
        { liveValues: { "data.title": "Live title" } },
      ),
      "publish",
    );

    const refreshed = builderSourceValuesKeepingUnpublishedChanges({
      incoming: { published: "published", "data.title": "Live title" },
      existing,
    });

    expect(refreshed["data.title"]).toBe("Saved title");
    expect(readBuilderCmsPublicationIntent(refreshed)).toEqual({
      state: "staged",
      transition: "publish",
    });
  });

  it("settles a staged change by Builder's own status in a body read", () => {
    const existing = withBuilderCmsPublicationIntent(
      { published: "published", "data.title": "Title" },
      "unpublish",
    );

    const refreshed = builderSourceValuesKeepingUnpublishedChanges({
      incoming: { published: "published", "data.title": "Title" },
      existing,
      incomingFilledFromRow: true,
      builderValues: { published: "draft" },
    });

    expect(readBuilderCmsPublicationIntent(refreshed)).toEqual({
      state: "none",
    });
  });

  it("drops a staged change once the entry leaves published and draft", () => {
    const refreshed = builderSourceValuesKeepingUnpublishedChanges({
      incoming: { published: "archived" },
      existing: withBuilderCmsPublicationIntent(
        { published: "published" },
        "unpublish",
      ),
    });

    expect(readBuilderCmsPublicationIntent(refreshed)).toEqual({
      state: "none",
    });
  });

  it("drops an unreadable staged change on refresh and says so", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const refreshed = builderSourceValuesKeepingUnpublishedChanges({
        incoming: { published: "draft" },
        existing: {
          published: "draft",
          [BUILDER_CMS_PUBLICATION_INTENT_KEY]: "archive",
        },
      });

      expect(readBuilderCmsPublicationIntent(refreshed)).toEqual({
        state: "none",
      });
      expect(error).toHaveBeenCalledOnce();
    } finally {
      error.mockRestore();
    }
  });

  it("reviews a staged change against Builder's live values and body", () => {
    const values = withBuilderCmsUnpublishedChanges(
      {
        published: "published",
        "data.title": "Saved title",
        "data.note": "Kept note",
      },
      {
        liveValues: { "data.title": "Live title" },
        liveBlocksHash: "live-hash",
      },
    );

    expect(builderCmsLiveBaselineValues(values)).toMatchObject({
      "data.title": "Live title",
      "data.note": "Kept note",
    });
    expect(builderCmsLiveBodyBaseline(values)).toEqual({
      blocksHash: "live-hash",
    });
    expect(
      builderCmsLiveBodyBaseline(
        withBuilderCmsUnpublishedChanges(
          { published: "published" },
          { liveValues: {}, liveBodyEmpty: true },
        ),
      ),
    ).toEqual({ blocksHash: null });
    expect(builderCmsLiveBodyBaseline({ published: "draft" })).toBeNull();
    expect(builderCmsLiveBaselineValues({ published: "draft" })).toEqual({
      published: "draft",
    });
  });
});
