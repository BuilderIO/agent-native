import { describe, expect, it } from "vitest";

import catalog from "./catalogs/en-US";

/**
 * the shared run-summary counts failed tool attempts inside a run that
 * still answered. "{{count}} failed" reads as the run failing, so the default
 * catalog says what failed instead.
 */
describe("shared agent run summary copy", () => {
  const summary = (catalog as Record<string, string>)[
    "message.workSummaryFailedCount"
  ];

  it("names the attempts, not the run", () => {
    expect(summary).toContain("{{summary}}");
    expect(summary).toContain("failed attempts: {{count}}");
    expect(summary).not.toContain("{{count}} failed");
  });
});
