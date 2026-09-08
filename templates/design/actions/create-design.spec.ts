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

vi.mock("../server/lib/design-system-defaults.js", () => ({
  resolveDefaultDesignSystemId: async () => null,
  resolveDesignSystemIdByTitle: async () => {
    throw new Error("not mocked");
  },
}));

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

describe("create-design description and next-step steering", () => {
  it("does not steer callers toward show-design-questions or waiting for the user", () => {
    expect(action.tool.description).not.toMatch(/wait for the user/i);
    expect(action.tool.description).not.toMatch(/show-design-questions/);
  });

  it("points nextRequiredAction at authoring and saving the screen directly", async () => {
    const result = await action.run({ title: "Todo app" });

    expect(result.nextRequiredAction).not.toMatch(/wait for the user/i);
    expect(result.nextRequiredAction).not.toMatch(/show-design-questions/);
    expect(result.nextRequiredAction).toMatch(/generate-design|create-file/);
  });
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
