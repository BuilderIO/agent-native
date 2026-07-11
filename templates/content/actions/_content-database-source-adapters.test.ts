import { describe, expect, it } from "vitest";

import { getContentDatabaseSourceAdapter } from "./_content-database-source-adapters.js";

describe("content database source adapter registry", () => {
  it("registers Builder, local-table, and read-only Notion adapters", () => {
    expect(getContentDatabaseSourceAdapter("builder-cms")?.sourceType).toBe(
      "builder-cms",
    );
    expect(getContentDatabaseSourceAdapter("local-table")?.sourceType).toBe(
      "local-table",
    );
    expect(getContentDatabaseSourceAdapter("notion-database")?.sourceType).toBe(
      "notion-database",
    );
    expect(getContentDatabaseSourceAdapter("mock-local")).toBeNull();
  });
});
