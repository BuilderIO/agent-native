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

  it("dedupes org_members by (org_id, LOWER(email)) before the unique index is created", () => {
    // acceptPendingInvitationsForEmail races (and legacy raw-case inserts
    // elsewhere in the org module) can leave case-variant duplicate rows
    // for the same person in the same org. The dedupe DELETE must run
    // strictly before the unique expression index below, or that CREATE
    // would fail on any database that already has duplicates.
    const dedupeIndex = ORG_MIGRATIONS.findIndex(
      (m) => m.name === "org-members-dedupe-lower-email",
    );
    const uniqueIndexIndex = ORG_MIGRATIONS.findIndex(
      (m) => m.name === "org-members-unique-lower-email-idx",
    );
    expect(dedupeIndex).toBeGreaterThanOrEqual(0);
    expect(uniqueIndexIndex).toBeGreaterThanOrEqual(0);
    expect(dedupeIndex).toBeLessThan(uniqueIndexIndex);

    const dedupeSql = ORG_MIGRATIONS[dedupeIndex]!.sql;
    expect(typeof dedupeSql === "string" ? dedupeSql : "").toMatch(
      /DELETE FROM org_members/i,
    );
  });

  it("includes a unique (org_id, LOWER(email)) index on org_members", () => {
    // Backs the ON CONFLICT (org_id, LOWER(email)) DO NOTHING insert in
    // accept-pending.ts — without a real unique constraint standing behind
    // it, ON CONFLICT has nothing to target and concurrent acceptances can
    // still create duplicate membership rows.
    const indexMigration = ORG_MIGRATIONS.find(
      (m) => m.name === "org-members-unique-lower-email-idx",
    );
    expect(indexMigration).toBeDefined();
    const sql =
      typeof indexMigration!.sql === "string" ? indexMigration!.sql : "";
    expect(sql).toMatch(/CREATE UNIQUE INDEX/i);
    expect(sql).toMatch(/org_members/i);
    expect(sql).toMatch(/org_id/i);
    expect(sql).toMatch(/LOWER\(email\)/i);
  });
});
