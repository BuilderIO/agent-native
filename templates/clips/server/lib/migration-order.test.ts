import { describe, expect, it } from "vitest";

import { orderMigrationsByVersion } from "./migration-order";

describe("orderMigrationsByVersion", () => {
  it("keeps newer numbered migrations after older entries from the base branch", () => {
    const ordered = orderMigrationsByVersion([
      { version: 91, name: "feature" },
      { version: 85, name: "base-tail" },
      { version: 86, name: "base-next" },
      { version: 90, name: "base-last" },
    ]);

    expect(ordered.map((migration) => migration.version)).toEqual([
      85, 86, 90, 91,
    ]);
    expect(ordered.map((migration) => migration.name)).toEqual([
      "base-tail",
      "base-next",
      "base-last",
      "feature",
    ]);
  });
});
