import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  existing: [] as Array<{ id: string; isDefault?: boolean }>,
  insertedValues: [] as Array<Record<string, unknown>>,
  clearedDefaults: [] as Array<Record<string, unknown>>,
  failNextDefaultInsert: false,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "designer@example.com",
  getRequestOrgId: () => "org_example",
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...original,
    and: (...values: unknown[]) => ({ and: values }),
    asc: (value: unknown) => ({ asc: value }),
    eq: (...values: unknown[]) => ({ eq: values }),
    isNull: (value: unknown) => ({ isNull: value }),
    ne: (...values: unknown[]) => ({ ne: values }),
  };
});

vi.mock("nanoid", () => ({ nanoid: () => "design_system_example" }));

function makeMockTx(): {
  select: () => unknown;
  update: () => unknown;
  insert: () => unknown;
  transaction: (
    callback: (tx: unknown) => Promise<unknown>,
  ) => Promise<unknown>;
} {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => Promise.resolve(testState.existing),
        }),
      }),
    }),
    update: () => ({
      set: (fields: Record<string, unknown>) => {
        testState.clearedDefaults.push(fields);
        return { where: () => Promise.resolve() };
      },
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        if (testState.failNextDefaultInsert && values.isDefault) {
          testState.failNextDefaultInsert = false;
          const err = new Error(
            'duplicate key value violates unique constraint "design_systems_one_default_per_scope_idx"',
          );
          (err as { code?: string }).code = "23505";
          return Promise.reject(err);
        }
        testState.insertedValues.push(values);
        return Promise.resolve();
      },
    }),
    // Nested tx.transaction() is a real Drizzle savepoint feature (see
    // design-system-defaults.ts) — the mock just runs the callback against a
    // fresh mock tx, since this spec isn't asserting rollback semantics.
    transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(makeMockTx()),
  };
}

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(makeMockTx()),
  }),
  schema: {
    designSystems: {
      id: "designSystems.id",
      isDefault: "designSystems.isDefault",
      createdAt: "designSystems.createdAt",
      ownerEmail: "designSystems.ownerEmail",
      orgId: "designSystems.orgId",
    },
  },
}));

import action, { createDesignSystemSchema } from "./create-design-system.js";

beforeEach(() => {
  testState.existing = [];
  testState.insertedValues = [];
  testState.clearedDefaults = [];
  testState.failNextDefaultInsert = false;
});

describe("create-design-system production templates", () => {
  it("copies the exact template data and guidance into a normal owned system", async () => {
    const result = await action.run({ templateId: "carbon-white" });

    const inserted = testState.insertedValues.at(-1);
    expect(inserted).toMatchObject({
      id: "design_system_example",
      title: "Carbon Design System",
      ownerEmail: "designer@example.com",
      orgId: "org_example",
      visibility: "org",
      isDefault: true,
    });

    const data = JSON.parse(String(inserted?.data));
    expect(data.colors).toMatchObject({
      primary: "#0F62FE",
      surface: "#F4F4F4",
      text: "#161616",
    });
    expect(data.customCSS).toContain("--cds-spacing-13: 160px");
    expect(String(inserted?.customInstructions)).toContain(
      "Follow IBM Carbon Design System v11 White theme",
    );
    expect(result).toMatchObject({
      id: "design_system_example",
      templateId: "carbon-white",
      version: "@carbon/themes 11.76.1",
    });
  });

  it("keeps the existing default behavior when another system already exists", async () => {
    testState.existing = [{ id: "existing_system", isDefault: true }];

    await action.run({ templateId: "primer-light", title: "Team Primer" });

    expect(testState.insertedValues.at(-1)).toMatchObject({
      title: "Team Primer",
      isDefault: false,
    });
    expect(testState.clearedDefaults).toEqual([]);
  });

  it("clears the scope in the same transaction that claims the default", async () => {
    await action.run({ templateId: "carbon-white" });

    expect(testState.clearedDefaults).toEqual([
      expect.objectContaining({ isDefault: false }),
    ]);
    expect(testState.insertedValues.at(-1)).toMatchObject({
      isDefault: true,
    });
  });

  it("drops the default flag instead of failing when a concurrent insert wins the race", async () => {
    // Scope reads as empty (this call guesses it should claim the default),
    // but the insert itself hits the unique-per-scope index because another
    // transaction committed its own default in between — the exact race the
    // read-then-write guess cannot see on its own.
    testState.failNextDefaultInsert = true;

    const result = await action.run({
      templateId: "primer-light",
      title: "Late arrival",
    });

    expect(result).toMatchObject({ isDefault: false });
    // Exactly one row ends up persisted — the retry, not a duplicate.
    expect(testState.insertedValues).toHaveLength(1);
    expect(testState.insertedValues[0]).toMatchObject({
      title: "Late arrival",
      isDefault: false,
    });
  });

  it("rejects data overrides that would turn a named template into a lookalike", () => {
    const parsed = createDesignSystemSchema.safeParse({
      templateId: "material-3",
      data: JSON.stringify({ colors: {} }),
    });

    expect(parsed.success).toBe(false);
    expect(
      parsed.error?.issues.some(
        (issue) =>
          issue.path.join(".") === "data" &&
          issue.message.includes("cannot override"),
      ),
    ).toBe(true);
  });

  it("still accepts fully custom design systems", () => {
    expect(
      createDesignSystemSchema.safeParse({
        title: "Custom brand",
        data: JSON.stringify({ colors: { primary: "#123456" } }),
      }).success,
    ).toBe(true);
  });
});
