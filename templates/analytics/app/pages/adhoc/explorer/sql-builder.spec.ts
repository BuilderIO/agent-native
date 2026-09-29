import { describe, expect, it } from "vitest";

import { buildSql } from "./sql-builder";
import { createDefaultConfig } from "./types";

describe("buildSql custom dates", () => {
  it("uses the full inclusive custom date range and rejects invalid dates", () => {
    const config = createDefaultConfig();
    config.events[0]!.event = "login";
    config.dateRange = "custom";
    config.customDateStart = "2026-09-01";
    config.customDateEnd = "2026-09-10";

    expect(buildSql(config)).toContain(
      "createdDate >= TIMESTAMP('2026-09-01') AND createdDate < TIMESTAMP(DATE_ADD(DATE('2026-09-10'), INTERVAL 1 DAY))",
    );

    config.customDateStart = "2026-09-10";
    config.customDateEnd = "2026-09-01";
    expect(buildSql(config)).toBe("");

    config.customDateEnd = "2026-02-31";
    expect(buildSql(config)).toBe("");
  });
});
