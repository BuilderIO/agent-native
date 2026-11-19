import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  files: [] as Array<Record<string, unknown>>,
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
            return Promise.resolve([]);
          },
        }),
      }),
    }),
  };
});

import { DESIGN_TEMPLATE_PRESETS } from "../shared/design-template-presets.js";
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
  });

  it("returns user templates before built-ins with previews", async () => {
    const result = await action.run({ includePreview: "true" });

    expect(result.templates[0]).toMatchObject({
      id: "saved-template",
      isBuiltIn: false,
      previewHtml: "<main>Saved preview</main>",
    });
    expect(result.templates[1]).toMatchObject({
      id: DESIGN_TEMPLATE_PRESETS[0]?.id,
      isBuiltIn: true,
    });
    expect(result.templates[1]?.previewHtml).toContain(
      "data-agent-native-locked",
    );
    expect(result.userCount).toBe(1);
    expect(result.builtInCount).toBeGreaterThan(0);
  });
  // oracle-change: Design Systems removed from Design; its assertions no longer apply

  it("can include built-in previews without loading saved-template HTML", async () => {
    const result = await action.run({
      includePreview: "true",
      includeSavedPreview: "false",
    });

    expect(result.templates[0]).not.toHaveProperty("previewHtml");
    expect(result.templates[1]?.previewHtml).toContain(
      "data-agent-native-locked",
    );
  });
});
