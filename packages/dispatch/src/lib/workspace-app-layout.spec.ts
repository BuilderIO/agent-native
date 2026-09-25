import { describe, expect, it } from "vitest";

import {
  normalizeWorkspaceAppLayout,
  orderWorkspaceApps,
  toggleWorkspaceAppPinned,
  workspaceAppMatchesQuery,
} from "./workspace-app-layout";

describe("workspace app layout", () => {
  it("keeps pinned apps first without changing the remaining catalog order", () => {
    const apps = [
      { id: "mail", name: "Mail" },
      { id: "analytics", name: "Analytics" },
      { id: "calendar", name: "Calendar" },
    ];

    expect(
      orderWorkspaceApps(apps, {
        pinnedIds: ["calendar", "calendar"],
        orderedIds: ["mail", "analytics", "calendar"],
      }).map((app) => app.id),
    ).toEqual(["calendar", "mail", "analytics"]);
  });

  it("matches app names and descriptions case-insensitively", () => {
    expect(
      workspaceAppMatchesQuery(
        { name: "Analytics", description: "Explore product health" },
        "PRODUCT",
      ),
    ).toBe(true);
    expect(workspaceAppMatchesQuery({ name: "Mail" }, "calendar")).toBe(false);
  });

  it("normalizes persisted layout ids and toggles pin state", () => {
    const layout = normalizeWorkspaceAppLayout({
      pinnedIds: ["mail", "mail", 42],
      orderedIds: ["calendar", "", "calendar"],
    });

    expect(toggleWorkspaceAppPinned(layout, "calendar")).toEqual({
      pinnedIds: ["calendar", "mail"],
      orderedIds: ["calendar"],
    });
  });
});
