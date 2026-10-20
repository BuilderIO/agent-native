import { describe, expect, it } from "vitest";

import {
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
});
