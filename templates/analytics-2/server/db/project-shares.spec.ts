import { getShareableResource } from "@agent-native/core/sharing";
import { describe, expect, it } from "vitest";

import "./index.js";
import { analyticsMigrations } from "./migrations.js";
import { projectShares, schema } from "./schema.js";

describe("project shares table", () => {
  it("restricts sharing to workspace members and disables public access", () => {
    expect(getShareableResource("analytics-project")).toMatchObject({
      allowPublic: false,
      requireOrgMemberForUserShares: true,
    });
    expect(
      getShareableResource("analytics-project")?.supportsGroupShares,
    ).not.toBe(true);
  });
  it("carries the framework's shares columns", () => {
    const columns = Object.keys(projectShares);
    expect(columns).toEqual(
      expect.arrayContaining([
        "id",
        "resourceId",
        "principalType",
        "principalId",
        "role",
        "createdBy",
        "createdAt",
      ]),
    );
  });

  it("is part of the workspace schema the database handle is typed against", () => {
    expect(schema.projectShares).toBe(projectShares);
  });

  it("arrives as one additive migration that creates only its own table", () => {
    const migration = analyticsMigrations.find(
      (step) => step.name === "analytics2-project-shares",
    );
    expect(migration).toBeDefined();
    const sql = String(migration?.sql ?? "");
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS "analytics2_project_shares"',
    );
    expect(sql).toContain("ON DELETE CASCADE");
    // Additive only: no statement that drops, rewrites or truncates anything.
    // (ON DELETE CASCADE is a constraint on the new table's own rows.)
    expect(sql).not.toMatch(/^\s*(DROP|DELETE|ALTER\s+TABLE|TRUNCATE)\b/im);
  });

  it("keeps the migration versions strictly ascending", () => {
    const versions = analyticsMigrations.map((step) => step.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
  });
});
