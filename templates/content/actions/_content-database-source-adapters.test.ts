import { describe, expect, it } from "vitest";

import { getContentDatabaseSourceAdapter } from "./_content-database-source-adapters.js";

describe("content database source adapter registry", () => {
  it("registers remote, local-table, and bridge-mediated adapters", () => {
    expect(getContentDatabaseSourceAdapter("builder-cms")?.sourceType).toBe(
      "builder-cms",
    );
    expect(getContentDatabaseSourceAdapter("local-table")?.sourceType).toBe(
      "local-table",
    );
    expect(getContentDatabaseSourceAdapter("notion-database")?.sourceType).toBe(
      "notion-database",
    );
    expect(getContentDatabaseSourceAdapter("local-folder")?.sourceType).toBe(
      "local-folder",
    );
    expect(getContentDatabaseSourceAdapter("mock-local")).toBeNull();
  });
});
