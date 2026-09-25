import { describe, expect, it } from "vitest";

import {
  buildAnalyticsGeneralSettingsSearchEntries,
  buildAnalyticsSettingsCommandItems,
} from "./settings-search";

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
};

const t = (key: string) => translations[key] ?? key;

describe("Analytics settings command items", () => {
  it("reuses general and agent setting metadata with deep links", () => {
    const items = buildAnalyticsSettingsCommandItems(
      t,
      buildAnalyticsGeneralSettingsSearchEntries(t, true),
    );

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Integrations",
          href: "/settings/integrations",
        }),
        expect.objectContaining({
          label: "Voice Transcription",
          keywords: expect.stringContaining("microphone"),
          href: "/settings/agent/voice",
        }),
      ]),
    );
    expect(items.some((item) => item.href === "/settings/general/about")).toBe(
      false,
    );
  });

  it("merges duplicate destinations without dropping shared search metadata", () => {
    const items = buildAnalyticsSettingsCommandItems(
      t,
      buildAnalyticsGeneralSettingsSearchEntries(t, false),
    );
    const labels = items.map((item) => item.label);
    const account = items.find((item) => item.label === "Account");

    expect(labels.filter((label) => label === "Account")).toHaveLength(1);
    expect(account).toMatchObject({
      href: "/settings/account",
      keywords: expect.stringContaining("profile photo avatar"),
    });
    expect(account?.keywords).toContain("General settings");
    expect(account?.keywords).not.toContain("Workspace settings");
    expect(labels).not.toContain("Language");
    expect(labels).not.toContain("Replay storage");
  });

  it("keeps duplicate labels when they point to different destinations", () => {
    const generalEntries = buildAnalyticsGeneralSettingsSearchEntries(t, false);
    const items = buildAnalyticsSettingsCommandItems(t, [
      ...generalEntries,
      {
        id: "analytics-account-security",
        label: "Account",
        keywords: "account security",
        hash: "account-security",
      },
    ]);

    expect(items.filter((item) => item.label === "Account")).toEqual([
      expect.objectContaining({ href: "/settings/account" }),
      expect.objectContaining({ href: "/settings/general/account-security" }),
    ]);
  });
  it("links to the redesigned pages when the settings redesign is on", () => {
    const items = buildAnalyticsSettingsCommandItems(
      t,
      buildAnalyticsGeneralSettingsSearchEntries(t, true),
      { redesign: true },
    );
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
});
