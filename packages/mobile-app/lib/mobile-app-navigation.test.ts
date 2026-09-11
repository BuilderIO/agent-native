import { describe, expect, it } from "vitest";

import {
  filterAvailableMobileTabAppIds,
  getAppRoute,
  getDefaultMobileTabAppIds,
  MOBILE_BOTTOM_TAB_LIMIT,
  toggleMobileTabAppId,
} from "./mobile-app-navigation";

describe("mobile chat-first navigation", () => {
  it("uses the shared chat-first app order for the default slots", () => {
    expect(
      getDefaultMobileTabAppIds([
        { id: "analytics" },
        { id: "mail" },
        { id: "design" },
        { id: "content" },
        { id: "calendar" },
        { id: "clips" },
      ]),
    ).toEqual(["mail", "calendar"]);
  });

  it("fills missing preferred slots with the next registered app", () => {
    // Only one preferred app is available, so the spare slot falls through to
    // an unpreferred one rather than being left empty.
    expect(
      getDefaultMobileTabAppIds([{ id: "clips" }, { id: "calendar" }]),
    ).toEqual(["calendar", "clips"]);
  });

  it("does not choose disabled apps for default slots", () => {
    // `content` outranks `design` in the preferred order, so it would take the
    // second slot if being disabled were ignored.
    expect(
      getDefaultMobileTabAppIds([
        { id: "content", enabled: false },
        { id: "design", enabled: true },
        { id: "mail", enabled: true },
      ]),
    ).toEqual(["mail", "design"]);
  });

  it("keeps Chat, More and the action button outside the app slots", () => {
    expect(MOBILE_BOTTOM_TAB_LIMIT).toBe(2);
    expect(toggleMobileTabAppId(["mail", "calendar"], "clips")).toEqual({
      ids: ["mail", "calendar"],
      changed: false,
      limitReached: true,
    });
  });

  it("filters stale saved ids before applying the tab limit", () => {
    const currentIds = filterAvailableMobileTabAppIds(
      ["mail", "removed"],
      new Set(["mail", "analytics"]),
    );

    // "removed" is gone, so the second slot is free and the toggle lands.
    expect(toggleMobileTabAppId(currentIds, "analytics")).toEqual({
      ids: ["mail", "analytics"],
      changed: true,
      limitReached: false,
    });
  });

  it("uses the tab route for registered apps and the secure fallback for custom apps", () => {
    expect(getAppRoute("mail")).toBe("/mail");
    expect(getAppRoute("custom-notes")).toBe("/app/custom-notes");
  });
});
