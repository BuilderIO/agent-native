import type { DocumentPropertiesResponse, DocumentProperty } from "@shared/api";
import { describe, expect, it } from "vitest";

import {
  blockFieldChangedSinceSeen,
  blockFieldContentHash,
  blockFieldTabDropGap,
  blockFieldTabIndexForKey,
  blockFieldTabSwitchState,
  blockFieldVisit,
  createdBlocksFieldId,
  documentIdFromPagePath,
  markBlockFieldsSeen,
  observeBlockFields,
  readBlockFieldSeen,
  rememberBlockFieldSeen,
  resolveSelectedBlockFieldId,
  searchParamsForBlockField,
  type BlockFieldSeen,
} from "./blockFieldTabs";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  writes = 0;
  failWrites = false;

  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.writes += 1;
    this.values.set(key, value);
  }
}

function blocksProperty(id: string): DocumentProperty {
  return {
    definition: {
      id,
      databaseId: "db-1",
      name: id,
      type: "blocks",
      visibility: "always_show",
      options: { blocks: { primary: false } },
      position: 0,
      createdAt: "2026-10-18T00:00:00.000Z",
      updatedAt: "2026-10-18T00:00:00.000Z",
    },
    value: "",
    editable: true,
  };
}

const hash = blockFieldContentHash;

describe("documentIdFromPagePath", () => {
  it("reads the page id from a page route only", () => {
    expect(documentIdFromPagePath("/page/doc-1")).toBe("doc-1");
    expect(documentIdFromPagePath("/page")).toBeNull();
    expect(documentIdFromPagePath("/p/doc-1")).toBeNull();
    expect(documentIdFromPagePath("/home")).toBeNull();
  });
});

describe("resolveSelectedBlockFieldId", () => {
  const ids = ["content", "notes", "outline"];

  it("selects the named field", () => {
    expect(resolveSelectedBlockFieldId(ids, "outline")).toBe("outline");
  });

  it("falls back to the first field for a missing or unknown id", () => {
    expect(resolveSelectedBlockFieldId(ids, null)).toBe("content");
    expect(resolveSelectedBlockFieldId(ids, "")).toBe("content");
    expect(resolveSelectedBlockFieldId(ids, "deleted-field")).toBe("content");
  });

  it("selects nothing without fields", () => {
    expect(resolveSelectedBlockFieldId([], "notes")).toBeNull();
  });
});

describe("searchParamsForBlockField", () => {
  const ids = ["content", "notes"];

  it("names any tab but the first and keeps other parameters", () => {
    const next = searchParamsForBlockField(
      new URLSearchParams("databaseId=db-1"),
      ids,
      "notes",
    );
    expect(next.toString()).toBe("databaseId=db-1&field=notes");
  });

  it("drops the parameter for the first tab", () => {
    const next = searchParamsForBlockField(
      new URLSearchParams("databaseId=db-1&field=notes"),
      ids,
      "content",
    );
    expect(next.toString()).toBe("databaseId=db-1");
  });

  it("does not change the params it was given", () => {
    const current = new URLSearchParams("field=notes");
    searchParamsForBlockField(current, ids, "content");
    expect(current.get("field")).toBe("notes");
  });
});

describe("blockFieldVisit", () => {
  const tabSwitch = blockFieldTabSwitchState(null);

  it("keeps the visit through a tab switch", () => {
    const first = blockFieldVisit(null, {
      key: "a",
      search: "?suggestion=s1",
      state: null,
    });
    expect(first).toEqual({ key: "a", search: "suggestion=s1" });

    const switched = blockFieldVisit(first, {
      key: "b",
      search: "?suggestion=s1&field=notes",
      state: tabSwitch,
    });
    expect(switched).toBe(first);

    const back = blockFieldVisit(switched, {
      key: "c",
      search: "?suggestion=s1",
      state: tabSwitch,
    });
    expect(back).toBe(first);
  });

  it("starts a new visit on any other navigation", () => {
    const first = blockFieldVisit(null, { key: "a", search: "", state: null });

    expect(
      blockFieldVisit(first, { key: "b", search: "", state: null }),
    ).toEqual({ key: "b", search: "" });
    // A tab switch that also changed another parameter is a new visit too.
    expect(
      blockFieldVisit(first, {
        key: "c",
        search: "?comment=t1&field=notes",
        state: tabSwitch,
      }),
    ).toEqual({ key: "c", search: "comment=t1" });
  });

  it("keeps the same object while the location is unchanged", () => {
    const location = { key: "a", search: "?field=notes", state: null };
    const first = blockFieldVisit(null, location);
    expect(blockFieldVisit(first, location)).toBe(first);
  });
});

describe("blockFieldTabSwitchState", () => {
  it("adds the marker and keeps other history state", () => {
    expect(blockFieldTabSwitchState({ from: "/home" })).toEqual({
      from: "/home",
      blockFieldTabSwitch: true,
    });
    expect(blockFieldTabSwitchState("not a record")).toEqual({
      blockFieldTabSwitch: true,
    });
  });
});

describe("blockFieldTabIndexForKey", () => {
  it("moves with the arrows and wraps at both ends", () => {
    expect(blockFieldTabIndexForKey("ArrowRight", 0, 3, "ltr")).toBe(1);
    expect(blockFieldTabIndexForKey("ArrowRight", 2, 3, "ltr")).toBe(0);
    expect(blockFieldTabIndexForKey("ArrowLeft", 0, 3, "ltr")).toBe(2);
    expect(blockFieldTabIndexForKey("ArrowLeft", 2, 3, "ltr")).toBe(1);
  });

  it("follows reading order in right-to-left text", () => {
    expect(blockFieldTabIndexForKey("ArrowLeft", 0, 3, "rtl")).toBe(1);
    expect(blockFieldTabIndexForKey("ArrowRight", 0, 3, "rtl")).toBe(2);
  });

  it("jumps with Home and End", () => {
    expect(blockFieldTabIndexForKey("Home", 2, 3, "ltr")).toBe(0);
    expect(blockFieldTabIndexForKey("End", 0, 3, "ltr")).toBe(2);
  });

  it("ignores every other key", () => {
    expect(blockFieldTabIndexForKey("ArrowDown", 0, 3, "ltr")).toBeNull();
    expect(blockFieldTabIndexForKey("1", 0, 3, "ltr")).toBeNull();
    expect(blockFieldTabIndexForKey("Enter", 0, 3, "ltr")).toBeNull();
    expect(blockFieldTabIndexForKey("ArrowRight", 0, 0, "ltr")).toBeNull();
  });
});

describe("blockFieldTabDropGap", () => {
  const ltrTabs = [
    { left: 0, right: 100 },
    { left: 100, right: 200 },
    { left: 200, right: 300 },
  ];

  it("picks the gap before the first tab whose middle is past the pointer", () => {
    expect(blockFieldTabDropGap(ltrTabs, 10, "ltr")).toBe(0);
    expect(blockFieldTabDropGap(ltrTabs, 60, "ltr")).toBe(1);
    expect(blockFieldTabDropGap(ltrTabs, 160, "ltr")).toBe(2);
    expect(blockFieldTabDropGap(ltrTabs, 260, "ltr")).toBe(3);
    expect(blockFieldTabDropGap(ltrTabs, 900, "ltr")).toBe(3);
  });

  it("reads right-to-left rows from the right", () => {
    const rtlTabs = [
      { left: 200, right: 300 },
      { left: 100, right: 200 },
      { left: 0, right: 100 },
    ];
    expect(blockFieldTabDropGap(rtlTabs, 290, "rtl")).toBe(0);
    expect(blockFieldTabDropGap(rtlTabs, 240, "rtl")).toBe(1);
    expect(blockFieldTabDropGap(rtlTabs, 10, "rtl")).toBe(3);
  });
});

describe("createdBlocksFieldId", () => {
  it("finds the new Blocks field in a properties response", () => {
    const response: DocumentPropertiesResponse = {
      documentId: "doc-1",
      databaseId: "db-1",
      properties: [
        blocksProperty("content"),
        blocksProperty("notes"),
        {
          ...blocksProperty("status"),
          definition: {
            ...blocksProperty("status").definition,
            type: "status",
          },
        },
        blocksProperty("blocks-3"),
      ],
    };
    expect(createdBlocksFieldId(response, new Set(["content", "notes"]))).toBe(
      "blocks-3",
    );
  });

  it("reads a guarded create's value", () => {
    expect(
      createdBlocksFieldId({ value: { id: "blocks-3" } }, new Set(["content"])),
    ).toBe("blocks-3");
    expect(
      createdBlocksFieldId({ value: { id: "content" } }, new Set(["content"])),
    ).toBeNull();
  });

  it("returns null when nothing new came back", () => {
    expect(
      createdBlocksFieldId(
        {
          documentId: "doc-1",
          databaseId: "db-1",
          properties: [blocksProperty("content")],
        },
        new Set(["content"]),
      ),
    ).toBeNull();
  });
});

describe("blockFieldChangedSinceSeen", () => {
  const seen: BlockFieldSeen = { revision: 3, contentHash: hash("Seen") };

  it("shows nothing for a field never seen", () => {
    expect(
      blockFieldChangedSinceSeen(undefined, {
        revision: 9,
        savedHash: hash("Other"),
        localHash: () => hash("Other"),
      }),
    ).toBe(false);
  });

  it("flags a newer revision with different content", () => {
    expect(
      blockFieldChangedSinceSeen(seen, {
        revision: 4,
        savedHash: hash("Remote"),
        localHash: () => hash("Remote"),
      }),
    ).toBe(true);
  });

  it("ignores the same revision", () => {
    expect(
      blockFieldChangedSinceSeen(seen, {
        revision: 3,
        savedHash: hash("Remote"),
        localHash: () => hash("Remote"),
      }),
    ).toBe(false);
  });

  it("ignores an own save that lands after leaving the tab", () => {
    expect(
      blockFieldChangedSinceSeen(seen, {
        revision: 4,
        savedHash: hash("Seen"),
        localHash: () => hash("Seen"),
      }),
    ).toBe(false);
  });

  it("ignores a newer read while the editor still shows what was seen", () => {
    expect(
      blockFieldChangedSinceSeen(seen, {
        revision: 4,
        savedHash: hash("Remote"),
        localHash: () => hash("Seen"),
      }),
    ).toBe(false);
  });

  it("does not hash the editor's text unless the revision moved", () => {
    let hashed = 0;
    blockFieldChangedSinceSeen(seen, {
      revision: 3,
      savedHash: hash("Remote"),
      localHash: () => {
        hashed += 1;
        return hash("Remote");
      },
    });
    expect(hashed).toBe(0);
  });
});

describe("observeBlockFields", () => {
  const field = (
    id: string,
    revision: number,
    saved: string,
    local = saved,
  ) => ({
    id,
    revision,
    savedHash: hash(saved),
    localHash: () => hash(local),
  });

  it("counts a field's first observation as seen", () => {
    expect(
      observeBlockFields({}, [field("content", 2, "Body")], "content"),
    ).toEqual({ content: { revision: 2, contentHash: hash("Body") } });
    expect(
      observeBlockFields({}, [field("notes", 5, "Notes")], "content"),
    ).toEqual({ notes: { revision: 5, contentHash: hash("Notes") } });
  });

  it("keeps a viewed field seen as it changes", () => {
    const seen = { content: { revision: 2, contentHash: hash("Body") } };
    expect(
      observeBlockFields(
        seen,
        [field("content", 3, "Body 2", "Body 3")],
        "content",
      ),
    ).toEqual({ content: { revision: 3, contentHash: hash("Body 3") } });
  });

  it("advances an unviewed field past its own landed save", () => {
    const seen = { notes: { revision: 2, contentHash: hash("Mine") } };
    expect(
      observeBlockFields(seen, [field("notes", 3, "Mine")], "content"),
    ).toEqual({ notes: { revision: 3, contentHash: hash("Mine") } });
  });

  it("leaves an unviewed field's record alone when someone else changed it", () => {
    const seen = { notes: { revision: 2, contentHash: hash("Mine") } };
    expect(
      observeBlockFields(seen, [field("notes", 3, "Theirs")], "content"),
    ).toBe(seen);
  });

  it("returns the same record when nothing moved", () => {
    const seen = { notes: { revision: 2, contentHash: hash("Mine") } };
    expect(observeBlockFields(seen, [field("notes", 2, "Mine")], "notes")).toBe(
      seen,
    );
  });
});

describe("markBlockFieldsSeen", () => {
  const fields = [
    { id: "content", revision: 4, localHash: () => hash("Body") },
    { id: "notes", revision: 7, localHash: () => hash("Notes") },
  ];

  it("records only the named fields as shown now", () => {
    const seen = {
      content: { revision: 1, contentHash: hash("Old") },
      notes: { revision: 1, contentHash: hash("Old") },
    };
    expect(markBlockFieldsSeen(seen, fields, ["notes", null])).toEqual({
      content: { revision: 1, contentHash: hash("Old") },
      notes: { revision: 7, contentHash: hash("Notes") },
    });
  });

  it("returns the same record when it already matches", () => {
    const seen = { notes: { revision: 7, contentHash: hash("Notes") } };
    expect(markBlockFieldsSeen(seen, fields, ["notes"])).toBe(seen);
  });
});

describe("block field seen storage", () => {
  it("round-trips one document's fields", () => {
    const storage = new MemoryStorage();
    const seen = { notes: { revision: 2, contentHash: hash("Notes") } };
    rememberBlockFieldSeen("doc-1", seen, storage);
    expect(readBlockFieldSeen("doc-1", storage)).toEqual(seen);
    expect(readBlockFieldSeen("doc-2", storage)).toEqual({});
  });

  it("drops malformed entries and unreadable storage", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "content-block-field-seen-v1",
      JSON.stringify({
        "doc-1": {
          notes: { revision: 2, contentHash: "nfm_x" },
          broken: { revision: "2" },
        },
      }),
    );
    expect(readBlockFieldSeen("doc-1", storage)).toEqual({
      notes: { revision: 2, contentHash: "nfm_x" },
    });
    storage.setItem("content-block-field-seen-v1", "{not json");
    expect(readBlockFieldSeen("doc-1", storage)).toEqual({});
    expect(readBlockFieldSeen("doc-1", undefined)).toEqual({});
  });

  it("keeps the 200 most recently written documents", () => {
    const storage = new MemoryStorage();
    const seen = { notes: { revision: 1, contentHash: "nfm_x" } };
    for (let index = 0; index < 201; index += 1) {
      rememberBlockFieldSeen(`doc-${index}`, seen, storage);
    }
    expect(readBlockFieldSeen("doc-0", storage)).toEqual({});
    expect(readBlockFieldSeen("doc-1", storage)).toEqual(seen);
    rememberBlockFieldSeen("doc-1", seen, storage);
    rememberBlockFieldSeen("doc-201", seen, storage);
    expect(readBlockFieldSeen("doc-1", storage)).toEqual(seen);
    expect(readBlockFieldSeen("doc-2", storage)).toEqual({});
  });

  it("survives storage that refuses writes", () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    expect(() =>
      rememberBlockFieldSeen(
        "doc-1",
        { notes: { revision: 1, contentHash: "nfm_x" } },
        storage,
      ),
    ).not.toThrow();
  });
});
