import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  existing: [] as Array<{ id: string; isDefault?: boolean }>,
  insertedValues: null as Record<string, unknown> | null,
  clearedDefaults: [] as Array<Record<string, unknown>>,
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

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
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
            testState.insertedValues = values;
            return Promise.resolve();
          },
        }),
      }),
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
  testState.insertedValues = null;
  testState.clearedDefaults = [];
});

describe("create-design-system production templates", () => {
  it("copies the exact template data and guidance into a normal owned system", async () => {
    const result = await action.run({ templateId: "carbon-white" });

    const inserted = testState.insertedValues;
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

    expect(testState.insertedValues).toMatchObject({
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
    expect(testState.insertedValues).toMatchObject({ isDefault: true });
  });

  it("heals a scope that already holds duplicate defaults", async () => {
    testState.existing = [
      { id: "older_default", isDefault: true },
      { id: "racing_default", isDefault: true },
    ];

    await action.run({ templateId: "primer-light", title: "Team Primer" });

    expect(testState.clearedDefaults).toEqual([
      expect.objectContaining({ isDefault: false }),
    ]);
    expect(testState.insertedValues).toMatchObject({ isDefault: false });
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
