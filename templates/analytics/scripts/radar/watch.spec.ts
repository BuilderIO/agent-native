import { describe, expect, it } from "vitest";

import { safeRadarEventLabel } from "./event-labels.ts";
import { safeCampaignLabel } from "./watch.ts";

describe("campaign label output", () => {
  it("preserves the reviewed outage campaign and redacts arbitrary labels", () => {
    expect(safeCampaignLabel("outage_recovery_20261026")).toBe(
      "outage_recovery_20261026",
    );
    expect(safeCampaignLabel("alice@example.com | private note")).toBe("other");
    expect(safeCampaignLabel("newsletter_alice@example.com")).toBe("other");
  });
});

describe("radar event labels", () => {
  it("redacts unreviewed event names before report output", () => {
    expect(safeRadarEventLabel("signup")).toBe("signup");
    expect(safeRadarEventLabel("alice@example.com | private note")).toBe(
      "unreviewed event",
    );
  });
});
