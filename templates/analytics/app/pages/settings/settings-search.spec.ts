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

  it("omits duplicate account and language commands", () => {
    const items = buildAnalyticsSettingsCommandItems(
      t,
      buildAnalyticsGeneralSettingsSearchEntries(t, false),
    );
    const labels = items.map((item) => item.label);

    expect(labels.filter((label) => label === "Account")).toHaveLength(1);
    expect(labels).not.toContain("Language");
    expect(labels).not.toContain("Replay storage");
  });
});
