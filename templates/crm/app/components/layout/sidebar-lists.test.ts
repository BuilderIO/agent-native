import { describe, expect, it } from "vitest";

import {
  normalizeCrmLists,
  normalizeCrmSavedViews,
  savedViewHref,
} from "./sidebar-lists";

describe("normalizeCrmLists", () => {
  it("reads a bare array and an envelope alike", () => {
    const rows = [{ id: "l1", name: "Hot leads", parentObjectType: "account" }];

    expect(normalizeCrmLists(rows)).toEqual(normalizeCrmLists({ lists: rows }));
    expect(normalizeCrmLists(rows)[0]).toEqual({
      id: "l1",
      name: "Hot leads",
      parentObjectType: "account",
    });
  });

  it("drops archived and malformed rows without throwing", () => {
    expect(
      normalizeCrmLists({
        lists: [
          { id: "l1", name: "Kept" },
          { id: "l2", name: "Gone", archived: true },
          { id: "l3" },
          { name: "No id" },
          null,
          "nope",
        ],
      }).map((list) => list.id),
    ).toEqual(["l1"]);
  });

  it("returns nothing for an unrecognized payload", () => {
    expect(normalizeCrmLists(undefined)).toEqual([]);
    expect(normalizeCrmLists({ unexpected: true })).toEqual([]);
  });
});

describe("normalizeCrmSavedViews", () => {
  it("defaults viewKind and targetKind conservatively", () => {
    expect(normalizeCrmSavedViews([{ id: "v1", name: "Renewals" }])[0]).toEqual(
      {
        id: "v1",
        name: "Renewals",
        viewKind: "table",
        targetKind: "object",
        pinned: false,
      },
    );
  });

  it("falls back to the legacy kind field for the object target", () => {
    expect(
      normalizeCrmSavedViews([
        { id: "v1", name: "Pipeline", kind: "opportunity" },
      ])[0]?.targetId,
    ).toBe("opportunity");
  });

  it("keeps board and list targets", () => {
    expect(
      normalizeCrmSavedViews({
        views: [
          {
            id: "v2",
            name: "Board",
            viewKind: "board",
            targetKind: "list",
            targetId: "l9",
            pinned: true,
          },
        ],
      })[0],
    ).toEqual({
      id: "v2",
      name: "Board",
      viewKind: "board",
      targetKind: "list",
      targetId: "l9",
      pinned: true,
    });
  });
});

describe("savedViewHref", () => {
  const base = { id: "v 1", name: "View", viewKind: "table" } as const;

  it("routes a list-targeted view at the list", () => {
    expect(
      savedViewHref({
        ...base,
        targetKind: "list",
        targetId: "l/9",
        pinned: false,
      }),
    ).toBe("/lists/l%2F9?view=v%201");
  });

  it("routes an object-targeted view at its object page", () => {
    expect(
      savedViewHref({
        ...base,
        targetKind: "object",
        targetId: "person",
        pinned: false,
      }),
    ).toBe("/people?view=v%201");
  });

  it("falls back to the saved-views index when the target is unknown", () => {
    expect(
      savedViewHref({ ...base, targetKind: "object", pinned: false }),
    ).toBe("/views?view=v%201");
    expect(
      savedViewHref({
        ...base,
        targetKind: "object",
        targetId: "widget",
        pinned: false,
      }),
    ).toBe("/views?view=v%201");
  });
});
