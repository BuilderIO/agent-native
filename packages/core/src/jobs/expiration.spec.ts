import { describe, expect, it } from "vitest";

import { buildJobResourceContent, parseJobResource } from "./frontmatter.js";

// An end date is a promise: the scheduler disables a task whose expiration has
// passed, and the value must survive a write so the task can say when it ended.
describe("automation expiration", () => {
  it("round-trips expiresAt through the frontmatter", () => {
    const content = buildJobResourceContent(
      {
        schedule: "0 9 * * 1",
        enabled: true,
        triggerType: "schedule",
        expiresAt: "2026-12-01T00:00:00.000Z",
      } as Parameters<typeof buildJobResourceContent>[0],
      "Reply with OK.",
    );
    const parsed = parseJobResource(content).meta;
    expect(parsed.expiresAt).toBe("2026-12-01T00:00:00.000Z");
  });

  it("keeps expiresAt out of the body", () => {
    const content = buildJobResourceContent(
      {
        schedule: "0 9 * * 1",
        enabled: true,
        expiresAt: "2026-12-01T00:00:00.000Z",
      } as Parameters<typeof buildJobContent>[0],
      "Reply with OK.",
    );
    expect(parseJobResource(content).body).not.toContain("expiresAt");
  });
});
