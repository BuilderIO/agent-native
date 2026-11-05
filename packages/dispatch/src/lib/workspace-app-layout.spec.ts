import { describe, expect, it } from "vitest";

import {
  normalizeWorkspaceAppLayout,
  setWorkspaceAppPinned,
  orderWorkspaceApps,
  tierWorkspaceApps,
  workspaceAppMatchesQuery,
  workspaceAppsStatus,
  appListsStatus,
} from "./workspace-app-layout";
import { mergeChatFirstWorkspaceApps } from "./workspace-apps";

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

  it("matches lowercase saved order preferences for mixed-case app ids", () => {
    const apps = mergeChatFirstWorkspaceApps(
      [{ id: "Calendar", name: "Calendar", path: "/calendar" }],
      ["mail"],
    );
    const layout = normalizeWorkspaceAppLayout({
      pinnedIds: ["Calendar"],
      orderedIds: ["Calendar", "Mail"],
    });

    expect(
      orderWorkspaceApps(apps, layout)
        .slice(0, 2)
        .map((app) => app.id),
    ).toEqual(["calendar", "mail"]);
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

  it("normalizes persisted layout ids and sets pin state", () => {
    const layout = normalizeWorkspaceAppLayout({
      pinnedIds: ["Mail", "mail", 42],
      orderedIds: ["Calendar", "", "calendar"],
    });

    expect(setWorkspaceAppPinned(layout, "CALENDAR", true)).toEqual({
      pinnedIds: ["calendar", "mail"],
      orderedIds: ["calendar"],
    });
    // Already in the asked-for state: nothing moves.
    expect(
      setWorkspaceAppPinned(
        { pinnedIds: ["a", "b"], orderedIds: [] },
        "b",
        true,
      ),
    ).toEqual({ pinnedIds: ["a", "b"], orderedIds: [] });
    expect(setWorkspaceAppPinned(layout, "mail", false).pinnedIds).toEqual([]);
    expect(setWorkspaceAppPinned(layout, "plan", false).pinnedIds).toEqual([
      "mail",
    ]);
  });

  it("tiers pinned apps in pin order, then apps and hosted apps each A to Z", () => {
    const apps = [
      { id: "gamma", name: "Gamma" },
      { id: "zeta", name: "Zeta" },
      { id: "mail", name: "Mail", source: "builtin" },
      { id: "Alpha", name: "alpha" },
      { id: "calendar", name: "Calendar", source: "builtin" },
      { id: "clips", name: "Clips", source: "builtin" },
      { id: "beta", name: "Beta", source: "connected" },
    ];

    const tiers = tierWorkspaceApps(apps, {
      pinnedIds: ["clips", "zeta", "missing"],
      orderedIds: ["beta", "alpha"],
    });

    expect(tiers.pinned.map((app) => app.id)).toEqual(["clips", "zeta"]);
    expect(tiers.apps.map((app) => app.id)).toEqual(["Alpha", "beta", "gamma"]);
    expect(tiers.hosted.map((app) => app.id)).toEqual(["calendar", "mail"]);
  });

  it.each([
    [{ data: undefined, isError: false }, "loading"],
    [{ data: undefined, isError: true }, "error"],
    [{ data: [], isError: false }, "ready"],
    // A failed refresh keeps the list it already had.
    [{ data: [], isError: true }, "ready"],
  ] as const)("reports %o as %s", (query, status) => {
    expect(workspaceAppsStatus(query)).toBe(status);
  });

  it("keeps the app lists loading until the hosted list settles", () => {
    const ready = { data: [], isError: false };
    const pending = { data: undefined, isError: false };
    const failed = { data: undefined, isError: true };
    expect(appListsStatus(pending, ready)).toBe("loading");
    expect(appListsStatus(failed, ready)).toBe("error");
    expect(appListsStatus(ready, pending)).toBe("loading");
    // A failed hosted list is reported on its own; workspace apps still show.
    expect(appListsStatus(ready, failed)).toBe("ready");
    expect(appListsStatus(ready, ready)).toBe("ready");
  });
});
