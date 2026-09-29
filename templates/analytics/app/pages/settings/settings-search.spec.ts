import {
  CORE_SETTINGS_PAGES,
  type SettingsPageContext,
} from "@agent-native/core/client/settings";
import { describe, expect, it } from "vitest";

import { buildAnalyticsSettingsCommandItems } from "./settings-search";

const translations: Record<string, string> = {
  "settings.account": "Account",
  "settings.credentials": "Credentials",
  "sessions.storageSetupTitle": "Replay storage",
  "settings.languageTitle": "Language",
  "settings.alertsTitle": "Alert rules",
  "settings.errorEmailNotifications": "Email new error alerts",
  "settings.bellSound": "Bell sound",
  "settings.notificationsTitle": "Notifications",
  "navigation.dataSources": "Data Sources",
  "root.whatsNew": "What's new",
  "agentChat.settingsShell.page.profile": "Profile",
  "agentChat.settingsShell.page.appGeneral": "General",
  "agentChat.settingsShell.page.model": "Model",
  "agentChat.settingsShell.page.notifications": "Notifications",
  "agentChat.settingsShell.page.infra": "Infrastructure",
  "agentChat.settingsShell.search.hosting": "Hosting",
};

const adminContext: SettingsPageContext = {
  role: "admin",
  isOwner: false,
  isAdmin: true,
  hasOrganization: true,
  soloDeploymentAdmin: false,
  appId: null,
  labs: {},
  flags: {},
};

const corePageIds = new Set(CORE_SETTINGS_PAGES.map((page) => page.id));

const t = (key: string) => translations[key] ?? key;

describe("Analytics settings command items", () => {
  it("links to the Settings pages and Analytics' own rows", () => {
    const items = buildAnalyticsSettingsCommandItems(t);
    const hrefs = items.map((item) => item.href);

    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/settings/profile",
        "/settings/app",
        "/settings/app/alerts",
        "/settings/app/data-sources",
        "/settings/app/data-sources#credentials",
        "/settings/notifications",
        "/settings/notifications#error-email-notifications",
        "/settings/notifications#bell-sound",
      ]),
    );
    expect(hrefs.some((href) => href.startsWith("/settings/general"))).toBe(
      false,
    );
    expect(items.map((item) => item.label)).not.toContain("Replay storage");
    expect(items.map((item) => item.label)).not.toContain("Language");
  });

  it("names only the Settings pages, under their nav labels", () => {
    for (const pageContext of [undefined, adminContext]) {
      const items = buildAnalyticsSettingsCommandItems(t, pageContext);
      const labels = items.map((item) => item.label);

      expect(labels).toEqual(
        expect.arrayContaining(["Profile", "General", "Model"]),
      );
      for (const legacy of ["Account", "LLM", "Agent Limits", "Workspace"]) {
        expect(labels).not.toContain(legacy);
      }
      for (const item of items) {
        const page = new URL(item.href, "https://app.test").pathname.split(
          "/",
        )[2];
        expect(corePageIds, `${item.label} -> ${item.href}`).toContain(page);
      }
      expect(items.find((item) => item.label === "Model")?.href).toBe(
        "/settings/model",
      );
    }
  });

  it("shows organization admin pages only to admins", () => {
    const hrefs = (pageContext?: SettingsPageContext) =>
      buildAnalyticsSettingsCommandItems(t, pageContext).map(
        (item) => item.href,
      );

    expect(hrefs()).not.toContain("/settings/infra");
    expect(hrefs(adminContext)).toEqual(
      expect.arrayContaining(["/settings/infra", "/settings/infra#hosting"]),
    );
  });
});
