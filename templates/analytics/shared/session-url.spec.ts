import { describe, expect, it } from "vitest";

import { sessionDateBound, sessionDateForDisplay } from "./session-date-bounds";
import { readSessionPage, SESSION_PAGE_SIZE } from "./session-page";

describe("Sessions URL bounds", () => {
  it("interprets date-only shared bounds as complete UTC calendar days", () => {
    expect(sessionDateBound("2026-09-25")).toBe("2026-09-25T00:00:00.000Z");
    expect(sessionDateBound("2026-09-25", true)).toBe(
      "2026-09-25T23:59:59.999Z",
    );
    expect(sessionDateBound("2026-02-30")).toBeUndefined();
    expect(sessionDateForDisplay("2026-09-25", null)).toBe("2026-09-25");
  });

  it("displays explicit ISO bounds by their UTC calendar date", () => {
    const iso = "2026-09-25T01:00:00.000Z";
    expect(sessionDateForDisplay(null, iso)).toBe("2026-09-25");
    expect(sessionDateForDisplay(null, "2026-09-25T00:00:00+04:00")).toBe(
      "2026-09-24",
    );
    expect(
      sessionDateForDisplay("2026-09-25", "2026-09-26T03:59:59.999Z"),
    ).toBe("2026-09-25");
    expect(sessionDateForDisplay(null, "invalid")).toBe("");
  });

  it("accepts bounded page numbers and rejects malformed or unsafe values", () => {
    expect(readSessionPage(null)).toBe(1);
    expect(readSessionPage("101")).toBe(101);
    expect(readSessionPage("10001")).toBe(10001);
    const largestSafePage =
      Math.floor(Number.MAX_SAFE_INTEGER / SESSION_PAGE_SIZE) + 1;
    expect(readSessionPage(String(largestSafePage))).toBe(largestSafePage);
    for (const invalid of [
      "0",
      "-1",
      "1.5",
      "2garbage",
      "1e3",
      String(largestSafePage + 1),
      "9007199254740993",
    ]) {
      expect(readSessionPage(invalid)).toBe(1);
    }
  });
});
