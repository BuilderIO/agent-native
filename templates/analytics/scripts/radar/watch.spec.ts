import { describe, expect, it } from "vitest";

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
