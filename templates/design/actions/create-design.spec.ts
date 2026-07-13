import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const testState = vi.hoisted(() => ({
  currentOrgId: "org_1" as string | undefined,
  defaultDesignSystems: [] as Array<{ id: string }>,
  insertedValues: null as Record<string, unknown> | null,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "user@example.com",
  getRequestOrgId: () => testState.currentOrgId,
}));

vi.mock("nanoid", () => ({ nanoid: () => "generated_design_id" }));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: () => ({ kind: "access" }),
  assertAccess: vi.fn().mockResolvedValue(undefined),
  resolveAccess: vi.fn().mockResolvedValue(null),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  desc: (value: unknown) => ({ kind: "desc", value }),
  eq: (left: unknown, right: unknown) => ({ kind: "eq", left, right }),
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => Promise.resolve(testState.defaultDesignSystems),
        }),
      }),
    }),
    insert: () => ({
      values: (vals: Record<string, unknown>) => {
        testState.insertedValues = vals;
        return Promise.resolve();
      },
    }),
  }),
  schema: {
    designs: {},
    designSystems: {
      id: "designSystems.id",
      isDefault: "designSystems.isDefault",
      updatedAt: "designSystems.updatedAt",
    },
    designSystemShares: {},
  },
}));

import action from "./create-design.js";

beforeEach(() => {
  testState.currentOrgId = "org_1";
  testState.defaultDesignSystems = [];
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

  it("preserves an explicit null design system instead of applying the default", async () => {
    testState.defaultDesignSystems = [{ id: "default_system" }];

    await action.run({ title: "Unbranded design", designSystemId: null });

    expect(testState.insertedValues).toMatchObject({
      designSystemId: null,
    });
  });

  it("applies the accessible default design system when the field is omitted", async () => {
    testState.defaultDesignSystems = [{ id: "default_system" }];

    await action.run({ title: "Branded design" });

    expect(testState.insertedValues).toMatchObject({
      designSystemId: "default_system",
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
