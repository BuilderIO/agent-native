import { describe, expect, it } from "vitest";

import {
  analyticsSettingsNavigationSections,
  analyticsWorkspaceSettingsPages,
} from "./AnalyticsWorkspaceSettings";

// team-QA row 126 follow-up. The source's settings rail lists ACCOUNT as
// Preferences, Notifications, Connected apps, API keys (settings rail label
// list in the original's settings chunk). This app now ships Connected apps
// between Preferences and API keys, backed by the shared connections surface;
// Notifications is still unbacked, so it must NOT appear as a dead rail row.
const ACCOUNT_EXPECTED = [
  "profile",
  "preferences",
  "notifications",
  "connected-apps",
  "api-keys",
];

describe("settings rail connected apps (row 126)", () => {
  const sections = analyticsSettingsNavigationSections((key) => key);

  it("orders ACCOUNT as the source does", () => {
    const account = sections.find((section) => section.id === "account");
    expect(account?.items.map((item) => item.id)).toEqual(ACCOUNT_EXPECTED);
    expect(
      account?.items.find((item) => item.id === "connected-apps")?.label,
    ).toBe("analytics.settings.rail.connectedApps");
  });

  it("backs the Connected apps row with a real page definition", () => {
    const pageIds = analyticsWorkspaceSettingsPages.map((page) => page.id);
    expect(pageIds).toContain("analytics-connected-apps");
  });

  it("backs every app-owned ACCOUNT row with a page definition", () => {
    // profile / preferences / api-keys are core page ids this app does not define;
    // anything in this app's own namespace must resolve, or it is a dead row.
    const pageIds = analyticsWorkspaceSettingsPages.map((page) => page.id);
    const account = sections.find((section) => section.id === "account");
    for (const item of account?.items ?? []) {
      if (item.type !== "page" || !item.pageId) continue;
      if (!item.pageId.startsWith("analytics-")) continue;
      expect(pageIds, `${item.id} opens ${item.pageId}`).toContain(item.pageId);
    }
  });
});
