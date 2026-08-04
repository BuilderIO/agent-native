import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  resolveAccess: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => testState.resolveAccess(...args),
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));

vi.mock("../server/db/index.js", () => ({
  schema: {
    designs: { table: "designs" },
    designTemplateFiles: {
      table: "designTemplateFiles",
      id: "designTemplateFiles.id",
      templateId: "designTemplateFiles.templateId",
      filename: "designTemplateFiles.filename",
      fileType: "designTemplateFiles.fileType",
      content: "designTemplateFiles.content",
    },
  },
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => [
          {
            id: "template-file",
            filename: "index.html",
            fileType: "html",
            content:
              '<main style="font-family:Sora,sans-serif"><div data-agent-native-locked="true" id="brand">Brand</div><p>Editable</p></main>',
          },
        ],
      }),
    }),
  }),
}));

import action from "./get-design-template.js";

const TEMPLATE_RESOURCE = {
  id: "saved-template",
  title: "Saved campaign",
  description: "Reusable campaign",
  category: "social",
  designSystemId: null,
  width: 1080,
  height: 1080,
  data: JSON.stringify({
    canvasFrames: {
      "template-file": { x: 0, y: 0, width: 1080, height: 1080 },
    },
  }),
};

function designResource(data: unknown) {
  return {
    role: "owner",
    resource: {
      id: "design-1",
      title: "Summer promo",
      data: JSON.stringify(data),
    },
  };
}

describe("get-design-template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.resolveAccess.mockImplementation(
      async (type: string, id: string) => {
        if (type === "design-template" && id === "saved-template") {
          return { role: "owner", resource: TEMPLATE_RESOURCE };
        }
        return null;
      },
    );
  });

  it("returns the original template behind a design whose screens were already edited", async () => {
    testState.resolveAccess.mockImplementation(
      async (type: string, id: string) => {
        if (type === "design" && id === "design-1") {
          return designResource({
            // The design's own frame has drifted away from the template.
            canvasFrames: { "copied-file": { width: 800, height: 600 } },
            templateSource: {
              templateId: "saved-template",
              title: "Saved campaign",
              instantiatedAt: "2026-07-14T00:00:00.000Z",
              files: [
                {
                  designFileId: "copied-file",
                  templateFileId: "template-file",
                },
              ],
            },
          });
        }
        if (type === "design-template" && id === "saved-template") {
          return { role: "owner", resource: TEMPLATE_RESOURCE };
        }
        return null;
      },
    );

    const result = await action.run({ designId: "design-1" });

    expect(result).toMatchObject({
      templateId: "saved-template",
      fromTemplate: true,
      fileCount: 1,
    });
    expect(result.files?.[0]).toMatchObject({
      templateFileId: "template-file",
      designFileId: "copied-file",
      width: 1080,
      height: 1080,
    });
    expect(result.files?.[0]?.content).toContain("font-family:Sora");
    expect(result.files?.[0]?.lockedLayers).toHaveLength(1);
  });

  it("reports designs that were never created from a template", async () => {
    testState.resolveAccess.mockImplementation(async (type: string) =>
      type === "design" ? designResource({ canvasFrames: {} }) : null,
    );

    const result = await action.run({ designId: "design-1" });

    expect(result).toMatchObject({ fromTemplate: false });
  });

  it("fails loudly when a design claims an unreadable template", async () => {
    testState.resolveAccess.mockImplementation(async (type: string) =>
      type === "design"
        ? designResource({ templateSource: { title: "Saved campaign" } })
        : null,
    );

    await expect(action.run({ designId: "design-1" })).rejects.toThrow(
      "readable templateId",
    );
  });

  it("reads a built-in preset directly by template id", async () => {
    const result = await action.run({ templateId: "preset-social-square" });

    expect(result).toMatchObject({ isBuiltIn: true, fileCount: 1 });
    expect(result.files?.[0]?.width).toBeGreaterThan(0);
  });

  it("rejects a template id that does not match the design's template", async () => {
    testState.resolveAccess.mockImplementation(async (type: string) =>
      type === "design"
        ? designResource({
            templateSource: { templateId: "saved-template", files: [] },
          })
        : null,
    );

    await expect(
      action.run({ designId: "design-1", templateId: "other-template" }),
    ).rejects.toThrow("was created from template");
  });
});
