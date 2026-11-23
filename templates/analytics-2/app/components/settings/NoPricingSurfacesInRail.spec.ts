import { describe, expect, it } from "vitest";

import {
  analyticsSettingsNavigationSections,
  settingsNavigationForDisplay,
} from "./AnalyticsWorkspaceSettings";

// Steve's 11/5 rule: no pricing, plans, tiers or promos. The reference's settings rail ends with a
// PLAN & BILLING group holding a Credits row; the rail this app renders must not name either. The
// navigation model keeps the reference's group order because a frozen check pins that shape, so the
// assertion below is about what the rail is built from, not about the model.
const PRICING_GROUP = "plan";
const PRICING_LABEL =
  /plan|billing|credits|upgrade|trial|pricing|paywall|subscribe/i;

describe("no pricing surfaces in the settings rail", () => {
  const t = (key: string) =>
    // The labels the app ships, so the assertion reads real copy rather than keys.
    ({
      "analytics.settings.rail.plan": "Plan & Billing",
      "analytics.settings.rail.credits": "Credits",
    })[key] ?? key;

  it("drops the reference's Plan & Billing group from what the rail renders", () => {
    const sections = settingsNavigationForDisplay(t);
    expect(sections.map((section) => section.id)).not.toContain(PRICING_GROUP);
  });

  it("leaves no plan, tier or credits label anywhere in the rendered rail", () => {
    const sections = settingsNavigationForDisplay(t);
    for (const section of sections) {
      expect(section.label).not.toMatch(PRICING_LABEL);
      for (const item of section.items) {
        expect(item.id).not.toMatch(PRICING_LABEL);
        const label = "label" in item ? String(item.label ?? "") : "";
        expect(label).not.toMatch(PRICING_LABEL);
      }
    }
  });

  it("drops exactly that group and keeps every other one the model describes", () => {
    const model = analyticsSettingsNavigationSections(t);
    const shown = settingsNavigationForDisplay(t);
    expect(model.map((section) => section.id)).toContain(PRICING_GROUP);
    expect(shown.map((section) => section.id)).toEqual(
      model.map((section) => section.id).filter((id) => id !== PRICING_GROUP),
    );
  });
});
