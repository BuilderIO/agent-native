import { describe, expect, it } from "vitest";

import { creativeContextMigrations } from "./migrations.js";

describe("creative context migrations", () => {
  it("keeps the shared foundation SQL valid for Postgres", () => {
    const foundation = String(creativeContextMigrations[0]?.sql ?? "");
    expect(foundation).not.toContain("datetime('now')");
    expect(foundation.match(/creative_context_\w+_shares/g)?.length).toBe(3);
    expect(foundation).toContain("created_at TEXT NOT NULL");
  });

  it("adds durable brand-profile promotion audit storage", () => {
    const audit = creativeContextMigrations.find(
      (migration) => migration.version === 3,
    );
    expect(String(audit?.sql)).toContain(
      "creative_context_brand_profile_audit",
    );
  });

  it("keeps the legacy job key while adding tenant-scoped deduplication", () => {
    const dedupe = creativeContextMigrations.find(
      (migration) => migration.version === 4,
    );
    expect(String(dedupe?.sql)).toContain("dedupe_key TEXT");
    expect(String(dedupe?.sql)).toContain("creative_context_jobs_dedupe_uidx");

    const scopedDedupe = creativeContextMigrations.find(
      (migration) => migration.version === 5,
    );
    expect(String(scopedDedupe?.sql)).toContain("dedupe_scope TEXT");
    expect(String(scopedDedupe?.sql)).toContain("scoped_dedupe_key TEXT");
    expect(String(scopedDedupe?.sql)).toContain(
      "creative_context_jobs_scoped_dedupe_uidx",
    );
    expect(String(scopedDedupe?.sql)).toContain(
      "(dedupe_scope, scoped_dedupe_key)",
    );
  });
});
