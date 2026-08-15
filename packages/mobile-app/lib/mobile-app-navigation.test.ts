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
    ).toEqual(["content", "design", "mail", "calendar"]);
  });

  it("fills missing preferred slots with the next registered app", () => {
    expect(
      getDefaultMobileTabAppIds([
        { id: "analytics" },
        { id: "calendar" },
        { id: "clips" },
      ]),
    ).toEqual(["calendar", "clips", "analytics"]);
  });

  it("does not choose disabled apps for default slots", () => {
    expect(
      getDefaultMobileTabAppIds([
        { id: "content", enabled: false },
        { id: "design", enabled: true },
        { id: "mail", enabled: true },
        { id: "calendar", enabled: true },
      ]),
    ).toEqual(["design", "mail", "calendar"]);
  });

  it("keeps Chat and More outside the four app slots", () => {
    expect(MOBILE_BOTTOM_TAB_LIMIT).toBe(4);
    expect(
      toggleMobileTabAppId(
        ["content", "design", "mail", "calendar"],
        "clips",
      ),
    ).toEqual({
      ids: ["content", "design", "mail", "calendar"],
      changed: false,
      limitReached: true,
    });
  });

  it("filters stale saved ids before applying the tab limit", () => {
    const currentIds = filterAvailableMobileTabAppIds(
      ["content", "design", "removed"],
      new Set(["content", "design", "calendar"]),
    );

    expect(toggleMobileTabAppId(currentIds, "calendar")).toEqual({
      ids: ["content", "design", "calendar"],
      changed: true,
      limitReached: false,
    });
  });

  it("uses the tab route for registered apps and the secure fallback for custom apps", () => {
    expect(getAppRoute("mail")).toBe("/mail");
    expect(getAppRoute("custom-notes")).toBe("/app/custom-notes");
  });
});
