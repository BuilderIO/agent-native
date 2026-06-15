import { describe, expect, it } from "vitest";
import { resolveCalendarEventRange } from "./list-events.js";

describe("resolveCalendarEventRange", () => {
  it("uses the requested timezone when resolving date-only bounds", () => {
    const range = resolveCalendarEventRange({
      from: "2026-05-26",
      to: "2026-05-27",
      timezone: "America/Los_Angeles",
    });

    expect(range.from).toBe("2026-05-26T07:00:00.000Z");
    expect(range.to).toBe("2026-05-27T07:00:00.000Z");
  });
});
