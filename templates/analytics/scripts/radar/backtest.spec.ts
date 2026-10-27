import { describe, expect, it } from "vitest";

import { backtestHourOf } from "./backtest.ts";

describe("backtestHourOf", () => {
  it("formats BigQuery Date values in UTC hour buckets", () => {
    expect(backtestHourOf(new Date("2026-10-09T05:47:00.000Z"))).toBe(
      "2026-10-09T05",
    );
  });

  it("normalizes timestamp strings to their hour bucket", () => {
    expect(backtestHourOf("2026-10-09 05:47:00+00")).toBe("2026-10-09T05");
  });
});
