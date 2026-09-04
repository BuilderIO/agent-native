import { describe, expect, it } from "vitest";

import type { CrmGridAttribute } from "./model";
import {
  listRecordsParams,
  moveGridColumn,
  normalizeGridColumns,
  patchRecordValues,
  resolveGridColumns,
  setGridColumnHidden,
  setGridColumnWidth,
  type CrmRecordValuesPayload,
} from "./query";

function attribute(apiSlug: string): CrmGridAttribute {
  return {
    id: apiSlug,
    apiSlug,
    label: apiSlug,
    attributeType: "text",
    multi: false,
    authority: "local-authoritative",
    storagePolicy: "local-authoritative",
    updateable: true,
  };
}

describe("listRecordsParams", () => {
  it("sends the filter, sort, search, and cursor to the server", () => {
    const params = listRecordsParams(
      {
        kind: "account",
        search: "  acme  ",
        filter: {
          op: "and",
          conditions: [{ attributeId: "stage", condition: "is", value: "won" }],
        },
        sort: [{ field: "updatedAt", direction: "desc" }],
      },
      "cursor-1",
    );
    expect(params).toEqual({
      kind: "account",
      query: "acme",
      filter: {
        op: "and",
        conditions: [{ attributeId: "stage", condition: "is", value: "won" }],
      },
      sort: [{ field: "updatedAt", direction: "desc" }],
      limit: 50,
      cursor: "cursor-1",
    });
  });

  it("never sends an empty filter or a blank search", () => {
    expect(
      listRecordsParams({
        filter: { op: "and", conditions: [] },
        search: "   ",
      }),
    ).toEqual({ limit: 50 });
  });

  it("lets a saved view own its filter", () => {
    const params = listRecordsParams({
      viewId: "view-1",
      filter: {
        op: "and",
        conditions: [{ field: "stage", condition: "is", value: "won" }],
      },
    });
    expect(params).toEqual({ viewId: "view-1", limit: 50 });
  });
});

describe("column configuration", () => {
  it("reads both the legacy string[] and the typed columns_json", () => {
    expect(normalizeGridColumns(["a", "b"])).toEqual([
      { attributeId: "a" },
      { attributeId: "b" },
    ]);
    expect(
      normalizeGridColumns([
        { attributeId: "a", width: 240, hidden: true },
        { attributeId: "b", width: 5 },
        { nope: 1 },
      ]),
    ).toEqual([
      { attributeId: "a", width: 240, hidden: true },
      { attributeId: "b", width: 80 },
    ]);
    expect(normalizeGridColumns("nonsense")).toEqual([]);
  });

  it("keeps saved order, drops unknown columns, and appends new attributes", () => {
    const resolved = resolveGridColumns(
      [
        { attributeId: "b", width: 200 },
        { attributeId: "gone" },
        { attributeId: "a" },
      ],
      [attribute("a"), attribute("b"), attribute("c")],
    );
    expect(resolved).toEqual([
      { attributeId: "b", width: 200 },
      { attributeId: "a" },
      { attributeId: "c" },
    ]);
  });

  it("clamps a resize and round-trips hide/show", () => {
    const columns = [{ attributeId: "a" }];
    expect(setGridColumnWidth(columns, "a", 4_000)).toEqual([
      { attributeId: "a", width: 720 },
    ]);
    const hidden = setGridColumnHidden(
      [{ attributeId: "a", width: 200 }],
      "a",
      true,
    );
    expect(hidden).toEqual([{ attributeId: "a", width: 200, hidden: true }]);
    expect(setGridColumnHidden(hidden, "a", false)).toEqual([
      { attributeId: "a", width: 200 },
    ]);
  });

  it("reorders a column", () => {
    const columns = [
      { attributeId: "a" },
      { attributeId: "b" },
      { attributeId: "c" },
    ];
    expect(moveGridColumn(columns, "c", 0).map((c) => c.attributeId)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(moveGridColumn(columns, "missing", 0)).toBe(columns);
  });
});

describe("optimistic cell write", () => {
  const payload: CrmRecordValuesPayload = {
    records: [
      { recordId: "r1", values: { stage: "new" } },
      { recordId: "r2", values: { stage: "won" } },
    ],
  };

  it("patches only the target row and leaves the previous payload intact", () => {
    const snapshot = structuredClone(payload);
    const next = patchRecordValues(payload, "r1", "stage", "won");
    expect(next?.records[0]?.values.stage).toBe("won");
    expect(next?.records[1]).toBe(payload.records[1]);
    // Rollback is restoring the previous payload — which is only safe because
    // the patch did not mutate it.
    expect(payload).toEqual(snapshot);
  });

  it("returns the same payload when the row is not cached", () => {
    expect(patchRecordValues(payload, "missing", "stage", "won")).toBe(payload);
    expect(patchRecordValues(undefined, "r1", "stage", "won")).toBeUndefined();
  });
});
