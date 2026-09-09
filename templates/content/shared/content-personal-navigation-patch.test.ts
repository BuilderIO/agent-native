import { describe, expect, it } from "vitest";

import { CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION } from "./api";
import {
  applyContentPersonalNavigationPatch,
  contentPersonalNavigationPatchSchema,
} from "./content-personal-navigation-patch";

describe("personal navigation patch", () => {
  it("requires canonical query data for a first reorder but not for selection", () => {
    const patch = {
      sidebarOrder: {
        viewId: "board",
        mode: "custom" as const,
        itemIds: ["b", "a"],
      },
    };
    expect(() => applyContentPersonalNavigationPatch(null, patch)).toThrow(
      "Shared View query is unavailable",
    );
    expect(
      applyContentPersonalNavigationPatch(null, { activeViewId: "board" })
        .views,
    ).toEqual([]);
    const shared = {
      id: "board",
      sorts: [{ key: "title", label: "Title", direction: "desc" as const }],
      filters: [
        {
          key: "status",
          label: "Status",
          operator: "equals" as const,
          value: "open",
        },
      ],
      filterMode: "or" as const,
    };
    expect(
      applyContentPersonalNavigationPatch(null, patch, [shared]).views,
    ).toEqual([
      { ...shared, sidebarOrder: { mode: "custom", itemIds: ["b", "a"] } },
    ]);
  });
  it("preserves other Views, filters and pin order through overlapping selections and reorders", () => {
    const current = {
      version: CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION,
      activeViewId: "table",
      views: [
        {
          id: "table",
          sorts: [],
          filters: [],
          filterMode: "and" as const,
          sidebarOrder: { mode: "custom" as const, itemIds: ["a", "b"] },
        },
        {
          id: "board",
          sorts: [{ key: "title", label: "Title", direction: "desc" as const }],
          filters: [],
          filterMode: "and" as const,
        },
      ],
    };
    const selection = { activeViewId: "board" };
    const reorder = {
      sidebarOrder: {
        viewId: "table",
        mode: "custom" as const,
        itemIds: ["b", "a"],
      },
    };
    const forward = applyContentPersonalNavigationPatch(
      applyContentPersonalNavigationPatch(current, selection),
      reorder,
    );
    const reverse = applyContentPersonalNavigationPatch(
      applyContentPersonalNavigationPatch(current, reorder),
      selection,
    );
    expect(forward).toEqual(reverse);
    expect(forward.activeViewId).toBe("board");
    expect(forward.views[0].sidebarOrder?.itemIds).toEqual(["b", "a"]);
    expect(forward.views[1]).toEqual(current.views[1]);
  });
  it("rejects empty patches instead of reporting a no-op save", () => {
    expect(() => contentPersonalNavigationPatchSchema.parse({})).toThrow();
  });
});
