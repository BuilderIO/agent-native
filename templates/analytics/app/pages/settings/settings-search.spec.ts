import { describe, expect, it } from "vitest";

import {
  buildAnalyticsGeneralSettingsSearchEntries,
  buildAnalyticsSettingsCommandItems,
} from "./settings-search";

const translations: Record<string, string> = {
  "settings.account": "Account",
  "settings.credentials": "Credentials",
  "settings.dashboardTemplates": "Dashboard templates",
  "sessions.storageSetupTitle": "Replay storage",
  "settings.languageTitle": "Language",
  "settings.about": "About",
  "settings.alertsTitle": "Alert rules",
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
          label: "Dashboard templates",
          href: "/settings#dashboard-templates",
        }),
        expect.objectContaining({
          label: "Connections",
          href: "/settings#connections",
        }),
        expect.objectContaining({
          label: "Voice Transcription",
          keywords: expect.stringContaining("microphone"),
          href: "/settings#voice",
        }),
      ]),
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
      href: "/settings#account",
      keywords: expect.stringContaining("profile photo avatar"),
    });
    expect(account?.keywords).toContain("General settings");
    expect(account?.keywords).toContain("Workspace settings");
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
      expect.objectContaining({ href: "/settings#account" }),
      expect.objectContaining({ href: "/settings#account-security" }),
    ]);
  });
});
