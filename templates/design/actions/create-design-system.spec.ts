import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  existing: [] as Array<{ id: string }>,
  insertedValues: null as Record<string, unknown> | null,
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
    eq: (...values: unknown[]) => ({ eq: values }),
    isNull: (value: unknown) => ({ isNull: value }),
  };
});

vi.mock("nanoid", () => ({ nanoid: () => "design_system_example" }));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(testState.existing),
        }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        testState.insertedValues = values;
        return Promise.resolve();
      },
    }),
  }),
  schema: {
    designSystems: {
      id: "designSystems.id",
      ownerEmail: "designSystems.ownerEmail",
      orgId: "designSystems.orgId",
    },
  },
}));

import action, { createDesignSystemSchema } from "./create-design-system.js";

beforeEach(() => {
  testState.existing = [];
  testState.insertedValues = null;
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
    testState.existing = [{ id: "existing_system" }];

    await action.run({ templateId: "primer-light", title: "Team Primer" });

    expect(testState.insertedValues).toMatchObject({
      title: "Team Primer",
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
