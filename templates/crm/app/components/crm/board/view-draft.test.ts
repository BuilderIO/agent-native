import { describe, expect, it } from "vitest";

import {
  BoardDraftError,
  buildSaveFork,
  clearBoardDraft,
  draftIsDirty,
  effectiveView,
  groupSavedViews,
  readBoardDraft,
  writeBoardDraft,
  type SavedViewShape,
} from "./view-draft";

const view: SavedViewShape = {
  id: "view-1",
  name: "Active pipeline",
  viewKind: "board",
  targetKind: "list",
  targetId: "list-1",
  groupByAttributeId: "attr-stage",
  filters: { op: "and", conditions: [] },
  sort: [],
  columns: [{ attributeId: "attr-owner" }],
  audience: "shared",
  updatedAt: "2026-07-26T10:00:00.000Z",
};

describe("board draft in search params", () => {
  it("round-trips a draft through the URL and nowhere else", () => {
    const params = writeBoardDraft(new URLSearchParams("view=view-1"), {
      mode: "table",
      groupByAttributeId: "attr-priority",
      filter: {
        op: "and",
        conditions: [{ field: "stage", condition: "is", value: "won" }],
      },
      sort: [{ field: "updatedAt", direction: "desc" }],
    });

    expect(params.get("view")).toBe("view-1");
    expect(readBoardDraft(params)).toEqual({
      mode: "table",
      groupByAttributeId: "attr-priority",
      filter: {
        op: "and",
        conditions: [{ field: "stage", condition: "is", value: "won" }],
      },
      sort: [{ field: "updatedAt", direction: "desc" }],
    });
  });

  it("reverts to the saved view once the draft params are gone (a reload)", () => {
    const dirty = writeBoardDraft(new URLSearchParams("view=view-1"), {
      mode: "table",
    });
    expect(draftIsDirty(view, readBoardDraft(dirty))).toBe(true);

    const reloaded = new URLSearchParams(clearBoardDraft(dirty).toString());
    expect(readBoardDraft(reloaded)).toEqual({});
    expect(draftIsDirty(view, readBoardDraft(reloaded))).toBe(false);
    expect(effectiveView(view, readBoardDraft(reloaded)).viewKind).toBe(
      "board",
    );
  });

  it("surfaces an unreadable draft param instead of silently dropping the filter", () => {
    const params = new URLSearchParams("view=view-1&filter=%7Bnope");
    expect(() => readBoardDraft(params)).toThrow(BoardDraftError);
    expect(() => readBoardDraft(new URLSearchParams("mode=kanban"))).toThrow(
      BoardDraftError,
    );
    expect(() => readBoardDraft(new URLSearchParams("sort=%7B%7D"))).toThrow(
      BoardDraftError,
    );
  });

  it("is not dirty when the draft restates the saved values", () => {
    const params = writeBoardDraft(new URLSearchParams(), {
      mode: "board",
      groupByAttributeId: "attr-stage",
      filter: { op: "and", conditions: [] },
      sort: [],
    });
    expect(draftIsDirty(view, readBoardDraft(params))).toBe(false);
  });
});

describe("three-way save fork", () => {
  const draft = {
    mode: "table" as const,
    filter: {
      op: "and",
      conditions: [{ field: "stage", condition: "is", value: "won" }],
    },
  };

  it("save for everyone updates the same view with its audience and a concurrency guard", () => {
    const mutation = buildSaveFork("update", { view, draft });
    expect(mutation).toEqual({
      action: "save-crm-saved-view",
      input: {
        id: "view-1",
        name: "Active pipeline",
        viewKind: "table",
        targetKind: "list",
        targetId: "list-1",
        filter: draft.filter,
        sort: [],
        columns: [{ attributeId: "attr-owner" }],
        audience: "shared",
        expectedUpdatedAt: "2026-07-26T10:00:00.000Z",
      },
    });
  });

  it("keeps board grouping only while the effective view is a board", () => {
    const asBoard = buildSaveFork("update", { view, draft: {} });
    expect(asBoard?.input.groupByAttributeId).toBe("attr-stage");
    expect(
      buildSaveFork("update", { view, draft }).input.groupByAttributeId,
    ).toBeUndefined();
  });

  it("save as new view creates a personal copy with no id and no expectedUpdatedAt", () => {
    const mutation = buildSaveFork("new", {
      view,
      draft,
      name: "  Won this quarter  ",
    });
    expect(mutation?.input).toMatchObject({
      name: "Won this quarter",
      audience: "personal",
      viewKind: "table",
      targetKind: "list",
      targetId: "list-1",
    });
    expect(mutation?.input.id).toBeUndefined();
    expect(mutation?.input.expectedUpdatedAt).toBeUndefined();
  });

  it("refuses an unnamed new view", () => {
    expect(() => buildSaveFork("new", { view, draft, name: "   " })).toThrow(
      /needs a name/,
    );
  });

  it("discard writes nothing at all", () => {
    expect(buildSaveFork("discard", { view, draft })).toBeNull();
  });
});

describe("groupSavedViews", () => {
  it("groups by target and pins first inside a group", () => {
    const groups = groupSavedViews([
      { ...view, id: "v1", name: "Zebra", pinned: false },
      { ...view, id: "v2", name: "Alpha", pinned: true },
      {
        ...view,
        id: "v3",
        name: "Accounts",
        targetKind: "object",
        targetId: undefined,
        kind: "account",
      },
    ]);
    expect(groups.map((group) => group.targetId)).toEqual([
      "account",
      "list-1",
    ]);
    expect(groups[1]?.views.map((entry) => entry.name)).toEqual([
      "Alpha",
      "Zebra",
    ]);
  });
});
