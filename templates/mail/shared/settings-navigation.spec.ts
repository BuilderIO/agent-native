import { describe, expect, it } from "vitest";

import {
  legacyMailSettingsTab,
  legacyMailSettingsTabForPath,
  MAIL_SETTINGS_AREA_IDS,
  mailSettingsRedirect,
  mailSettingsRoute,
  mailSettingsSectionFromPath,
} from "./settings-navigation";

describe("Mail settings navigation", () => {
  it.each(MAIL_SETTINGS_AREA_IDS)(
    "routes the %s area to Mail › General",
    (id) => {
      expect(mailSettingsRoute(id)).toBe(`/settings/app/${id}`);
      expect(mailSettingsSectionFromPath(`/settings/app/${id}`)).toBe(id);
    },
  );

  it("sends today's section ids to the page that holds them now", () => {
    expect(mailSettingsRedirect("automations")).toBe("/settings/app/rules");
    expect(mailSettingsRedirect("slack")).toBe("/settings/channels/slack");
    expect(mailSettingsRedirect("team")).toBe("/settings/members");
    expect(mailSettingsRedirect("general")).toBe("/settings/app");
    expect(mailSettingsRedirect("ai-filter")).toBe("/settings/app/ai-filter");
  });

  it("leaves core section ids to the Settings shell", () => {
    expect(mailSettingsRedirect("integrations")).toBeNull();
    expect(mailSettingsRedirect(null)).toBeNull();
    expect(mailSettingsRoute("integrations")).toBe("/settings/integrations");
  });

  it("maps redesigned paths back to today's tabs", () => {
    expect(legacyMailSettingsTabForPath("/settings/app/rules")).toBe(
      "automations",
    );
    expect(legacyMailSettingsTabForPath("/settings/channels/slack")).toBe(
      "slack",
    );
    expect(legacyMailSettingsTabForPath("/settings/app/tracking")).toBe(
      "tracking",
    );
    // Today's tabs already resolve these paths themselves.
    expect(legacyMailSettingsTabForPath("/settings/app")).toBeNull();
    expect(legacyMailSettingsTabForPath("/settings/members")).toBeNull();
    expect(legacyMailSettingsTabForPath("/settings/app/unknown")).toBeNull();
    expect(legacyMailSettingsTabForPath("/inbox")).toBeNull();
  });

  it("maps section ids to today's tab ids", () => {
    expect(legacyMailSettingsTab("rules")).toBe("automations");
    expect(legacyMailSettingsTab("automations")).toBe("automations");
    expect(legacyMailSettingsTab("team")).toBe("organization");
    expect(legacyMailSettingsTab("integrations")).toBeNull();
  });
});
