import { describe, expect, it } from "vitest";

import {
  filterAvailableMobileTabAppIds,
  getAppRoute,
  getDefaultMobileTabAppIds,
  getMobileAppUrl,
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
    expect(
      getDefaultMobileTabAppIds([{ id: "clips" }, { id: "calendar" }]),
    ).toEqual(["calendar", "clips"]);
  });

  it("does not choose disabled apps for default slots", () => {
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

  it("keeps embedded app settings routes on the app origin", () => {
    expect(getMobileAppUrl("https://chat.example", "/settings#uploads")).toBe(
      "https://chat.example/settings#uploads",
    );
    expect(
      getMobileAppUrl("https://chat.example", "https://other.example/"),
    ).toBe("https://chat.example");
  });
});
