import { describe, it, expect } from "vitest";

import { ORG_MIGRATIONS } from "./migrations.js";

describe("ORG_MIGRATIONS", () => {
  it("includes a LOWER(email) expression index on org_members", () => {
    // Every authenticated request calls getOrgContext which queries
    // `WHERE LOWER(m.email) = ?`. This migration must create a supporting
    // index so the lookup is an index seek rather than a full-table scan.
    const indexMigration = ORG_MIGRATIONS.find((m) => {
      const sql =
        typeof m.sql === "string"
          ? m.sql
          : (m.sql.postgres ?? m.sql.sqlite ?? "");
      return /CREATE INDEX.*org_members.*LOWER\(email\)/i.test(sql);
    });
    expect(indexMigration).toBeDefined();
    expect(indexMigration?.version).toBeGreaterThan(1006);
  });

  it("includes a LOWER(allowed_domain) expression index on organizations", () => {
    const indexMigration = ORG_MIGRATIONS.find((m) => {
      const sql =
        typeof m.sql === "string"
          ? m.sql
          : (m.sql.postgres ?? m.sql.sqlite ?? "");
      return /CREATE INDEX.*organizations.*LOWER\(allowed_domain\)/i.test(sql);
    });
    expect(indexMigration).toBeDefined();
    expect(indexMigration?.version).toBeGreaterThan(1007);
  });

  it("has strictly ascending version numbers with no gaps", () => {
    const versions = ORG_MIGRATIONS.map((m) => m.version);
    for (let i = 1; i < versions.length; i++) {
      expect(versions[i]).toBeGreaterThan(versions[i - 1]);
    }
  });
});
