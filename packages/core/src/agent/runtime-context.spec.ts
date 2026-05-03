import { describe, expect, it } from "vitest";

import { buildRuntimeContextPrompt } from "./runtime-context.js";

describe("buildRuntimeContextPrompt", () => {
  it("includes authoritative UTC and local dates for relative date resolution", () => {
    const prompt = buildRuntimeContextPrompt({
      now: new Date("2026-05-03T18:30:00Z"),
      timezone: "America/New_York",
    });

    expect(prompt).toContain("<runtime-context>");
    expect(prompt).toContain("currentUtc: 2026-05-03T18:30:00.000Z");
    expect(prompt).toContain("currentDateUtc: 2026-05-03");
    expect(prompt).toContain("currentTimezone: America/New_York");
    expect(prompt).toContain("currentDateInTimezone: 2026-05-03");
    expect(prompt).toContain("relative dates");
  });

  it("falls back to UTC when the timezone is invalid", () => {
    const prompt = buildRuntimeContextPrompt({
      now: new Date("2026-05-03T18:30:00Z"),
      timezone: "not/a-zone",
    });

    expect(prompt).toContain("currentTimezone: UTC");
    expect(prompt).toContain("currentDateInTimezone: 2026-05-03");
  });
});
