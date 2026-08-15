import { describe, expect, it } from "vitest";

import {
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
    ).toEqual(["content", "design", "mail"]);
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

  it("keeps Chat and More outside the three app slots", () => {
    expect(MOBILE_BOTTOM_TAB_LIMIT).toBe(3);
    expect(
      toggleMobileTabAppId(["content", "design", "mail"], "calendar"),
    ).toEqual({
      ids: ["content", "design", "mail"],
      changed: false,
      limitReached: true,
    });
  });

  it("uses the tab route for registered apps and the secure fallback for custom apps", () => {
    expect(getAppRoute("mail")).toBe("/mail");
    expect(getAppRoute("custom-notes")).toBe("/app/custom-notes");
  });
});
