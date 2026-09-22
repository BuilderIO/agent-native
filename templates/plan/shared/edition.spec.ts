import { describe, expect, it } from "vitest";

import { dayKeyInZone, editionDateKey } from "./edition.js";

describe("editionDateKey", () => {
  it("names a single 24h window as one day, not a two-day range", () => {
    expect(
      editionDateKey(
        "2026-09-20T00:00:00.000Z",
        "2026-09-21T00:00:00.000Z",
        "UTC",
      ),
    ).toBe("2026-09-20");
  });

  it("names a catch-up window as an inclusive range", () => {
    expect(
      editionDateKey(
        "2026-09-08T00:00:00.000Z",
        "2026-09-22T00:00:00.000Z",
        "UTC",
      ),
    ).toBe("2026-09-08_2026-09-21");
  });

  it("reads the window in the requested zone, not the host zone", () => {
    // 07:00 Amsterdam (UTC+2) on the 21st is 05:00Z; the same instant is still
    // the 20th in Los Angeles, so the day key must differ by zone.
    const instant = "2026-09-21T05:00:00.000Z";
    expect(dayKeyInZone(instant, "Europe/Amsterdam")).toBe("2026-09-21");
    expect(dayKeyInZone(instant, "America/Los_Angeles")).toBe("2026-09-20");
  });

  it("keeps a sub-day window on its own day", () => {
    expect(
      editionDateKey(
        "2026-09-20T06:00:00.000Z",
        "2026-09-20T18:00:00.000Z",
        "UTC",
      ),
    ).toBe("2026-09-20");
  });
});
