import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  files: [] as Array<Record<string, unknown>>,
  designSystems: [] as Array<{ id: string }>,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "owner@example.com",
  getRequestOrgId: () => "org-1",
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: () => ({ scoped: true }),
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  and: (...conditions: unknown[]) => ({ conditions }),
  desc: (column: unknown) => ({ column }),
  eq: (column: unknown, value: unknown) => ({ column, value }),
  inArray: (column: unknown, values: unknown[]) => ({ column, values }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
}));

vi.mock("../server/db/index.js", () => {
  const schema = {
    designTemplates: {
      table: "designTemplates",
      id: "designTemplates.id",
      title: "designTemplates.title",
      description: "designTemplates.description",
      category: "designTemplates.category",
      width: "designTemplates.width",
      height: "designTemplates.height",
      lockedLayerCount: "designTemplates.lockedLayerCount",
      designSystemId: "designTemplates.designSystemId",
      visibility: "designTemplates.visibility",
      ownerEmail: "designTemplates.ownerEmail",
      createdAt: "designTemplates.createdAt",
      updatedAt: "designTemplates.updatedAt",
    },
    designTemplateShares: { table: "designTemplateShares" },
    designTemplateFiles: {
      table: "designTemplateFiles",
      templateId: "designTemplateFiles.templateId",
      filename: "designTemplateFiles.filename",
      fileType: "designTemplateFiles.fileType",
      content: "designTemplateFiles.content",
    },
    designSystems: {
      table: "designSystems",
      id: "designSystems.id",
    },
    designSystemShares: { table: "designSystemShares" },
  };

  return {
    schema,
    getDb: () => ({
      select: () => ({
        from: (table: { table?: string }) => ({
          where: () => {
            if (table.table === "designTemplates") {
              return { orderBy: async () => testState.rows };
            }
            if (table.table === "designTemplateFiles") {
              return Promise.resolve(testState.files);
            }
            if (table.table === "designSystems") {
              return Promise.resolve(testState.designSystems);
            }
            return Promise.resolve([]);
          },
        }),
      }),
    }),
  };
});

import action from "./list-design-templates.js";

describe("list-design-templates", () => {
  beforeEach(() => {
    testState.rows = [
      {
        id: "saved-template",
        title: "Saved campaign",
        description: "Reusable launch campaign",
        category: "social",
        width: 1080,
        height: 1080,
        lockedLayerCount: 1,
        designSystemId: "accessible-system",
        visibility: "private",
        ownerEmail: "owner@example.com",
        createdAt: "2026-07-14T00:00:00.000Z",
        updatedAt: "2026-07-14T00:00:00.000Z",
      },
    ];
    testState.files = [
      {
        templateId: "saved-template",
        filename: "index.html",
        fileType: "html",
        content: "<main>Saved preview</main>",
      },
    ];
    testState.designSystems = [{ id: "accessible-system" }];
  });

  it("returns user templates before built-ins with previews and access-safe linked systems", async () => {
    const result = await action.run({ includePreview: "true" });

    expect(result.templates[0]).toMatchObject({
      id: "saved-template",
      isBuiltIn: false,
      designSystemId: "accessible-system",
      previewHtml: "<main>Saved preview</main>",
    });
    expect(result.templates[1]).toMatchObject({
      id: "preset-social-square",
      isBuiltIn: true,
      designSystemId: null,
    });
    expect(result.templates[1]?.previewHtml).toContain(
      "data-agent-native-locked",
    );
    expect(result.userCount).toBe(1);
    expect(result.builtInCount).toBeGreaterThan(0);
  });

  it("does not expose an inaccessible linked design-system id", async () => {
    testState.designSystems = [];

    const result = await action.run({ includePreview: "false" });

    expect(result.templates[0]).toMatchObject({
      id: "saved-template",
      designSystemId: null,
    });
  });
});
