import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const testState = vi.hoisted(() => ({
  currentOrgId: "org_1" as string | undefined,
  insertedValues: null as Record<string, unknown> | null,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "user@example.com",
  getRequestOrgId: () => testState.currentOrgId,
}));

vi.mock("nanoid", () => ({ nanoid: () => "generated_design_id" }));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    insert: () => ({
      values: (vals: Record<string, unknown>) => {
        testState.insertedValues = vals;
        return Promise.resolve();
      },
    }),
  }),
  schema: {
    designs: {},
  },
}));

import action from "./create-design.js";

beforeEach(() => {
  testState.currentOrgId = "org_1";
  testState.insertedValues = null;
});

describe("create-design org visibility", () => {
  it("creates active-org designs as org-visible", async () => {
    await action.run({ title: "Team design" });

    expect(testState.insertedValues).toMatchObject({
      id: "generated_design_id",
      ownerEmail: "user@example.com",
      orgId: "org_1",
      visibility: "org",
    });
  });

  it("keeps no-org designs private", async () => {
    testState.currentOrgId = undefined;

    await action.run({ title: "Personal design" });

    expect(testState.insertedValues).toMatchObject({
      ownerEmail: "user@example.com",
      orgId: undefined,
      visibility: "private",
    });
  });

  it("does not bulk-promote existing private org-scoped designs", () => {
    const migrationSource = readFileSync(
      resolve(__dirname, "../server/plugins/db.ts"),
      "utf8",
    );

    expect(migrationSource).toContain("version: 18");
    expect(migrationSource).toContain("sql: {}");
    expect(migrationSource).not.toContain("UPDATE designs SET visibility");
  });
});
