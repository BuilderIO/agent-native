import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Steve 11/5: no pricing tiers, plans, credits meters or promos. The usage page
 * reports tokens and cost; it does not read or render a credits balance, a
 * purchase link or a referral offer.
 */
const page = readFileSync(new URL("./UsagePage.tsx", import.meta.url), "utf8");
const panel = readFileSync(
  new URL("../UsageSection.tsx", import.meta.url),
  "utf8",
);
const alerts = readFileSync(
  new URL("./UsageAlerts.tsx", import.meta.url),
  "utf8",
);

describe("usage surfaces carry no credits meter", () => {
  it("does not read or render builder credits", () => {
    expect(page).not.toContain("get-builder-credit-usage");
    expect(page).not.toContain("BuilderCreditUsagePanel");
    expect(page).not.toContain("BuilderCreditUsageSkeleton");
  });

  it("does not read the balance or render the panel in the settings panel", () => {
    // The settings panel behind Content's Settings > Model > Usage is the surface a
    // tester actually reaches; the page-level checks above are not enough.
    expect(panel).not.toContain('"get-builder-credit-usage"');
    expect(panel).not.toContain("<BuilderCreditUsagePanel");
    expect(panel).not.toContain("<BuilderCreditUsageSkeleton");
  });

  it("offers no credits unit on an alert rule", () => {
    expect(alerts).not.toContain('"builder-credits"');
    expect(alerts).not.toContain("unitCredits");
  });

  it("still reports usage", () => {
    expect(page).toContain("MetricTile");
    expect(panel).toContain("MetricCard");
  });
});
