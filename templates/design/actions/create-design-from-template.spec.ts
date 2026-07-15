import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  resolveAccess: vi.fn(),
  nanoidValues: ["copied-design", "copied-file"],
  insertedDesign: null as Record<string, unknown> | null,
  insertedFiles: [] as Array<Record<string, unknown>>,
  transactionCount: 0,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "owner@example.com",
  getRequestOrgId: () => "org-1",
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => testState.resolveAccess(...args),
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));

vi.mock("nanoid", () => ({
  nanoid: () => testState.nanoidValues.shift() ?? "generated-id",
}));

vi.mock("../server/db/index.js", () => {
  const schema = {
    designs: { table: "designs" },
    designFiles: { table: "designFiles" },
    designTemplateFiles: {
      table: "designTemplateFiles",
      id: "designTemplateFiles.id",
      templateId: "designTemplateFiles.templateId",
      filename: "designTemplateFiles.filename",
      fileType: "designTemplateFiles.fileType",
      content: "designTemplateFiles.content",
    },
  };
  const templateFiles = [
    {
      id: "template-file",
      filename: "index.html",
      fileType: "html",
      content:
        '<main style="width:1080px;height:1080px"><div data-agent-native-locked="true">Brand</div><p>Editable</p></main>',
    },
  ];
  return {
    schema,
    getDb: () => ({
      select: () => ({
        from: () => ({ where: async () => templateFiles }),
      }),
      transaction: async (
        run: (tx: {
          insert: (table: { table: string }) => {
            values: (values: unknown) => Promise<void>;
          };
        }) => Promise<void>,
      ) => {
        testState.transactionCount += 1;
        await run({
          insert: (table) => ({
            values: async (values) => {
              if (table.table === "designs") {
                testState.insertedDesign = values as Record<string, unknown>;
              } else {
                testState.insertedFiles = values as Array<
                  Record<string, unknown>
                >;
              }
            },
          }),
        });
      },
    }),
  };
});

import action from "./create-design-from-template.js";

describe("create-design-from-template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.nanoidValues = ["copied-design", "copied-file"];
    testState.insertedDesign = null;
    testState.insertedFiles = [];
    testState.transactionCount = 0;
    testState.resolveAccess.mockImplementation(
      async (type: string, id: string) => {
        if (type === "design-template" && id === "saved-template") {
          return {
            role: "owner",
            resource: {
              id,
              title: "Saved campaign",
              description: "Reusable campaign",
              category: "social",
              designSystemId: "linked-system",
              updatedAt: "2026-07-14T00:00:00.000Z",
              data: JSON.stringify({
                canvasFrames: {
                  "template-file": {
                    x: 10,
                    y: 20,
                    width: 1080,
                    height: 1080,
                  },
                },
              }),
            },
          };
        }
        if (type === "design-system" && id === "override-system") {
          return { role: "viewer", resource: { id } };
        }
        if (type === "design-system" && id === "linked-system") {
          return { role: "viewer", resource: { id } };
        }
        return null;
      },
    );
  });

  it("copies screens and dimensions, preserves locks, and carries a safe override into adaptation", async () => {
    const result = await action.run({
      templateId: "saved-template",
      designSystemId: "override-system",
    });

    expect(result).toMatchObject({
      id: "copied-design",
      designSystemId: "override-system",
      designSystemOverridden: true,
      adaptationPending: true,
      lockedLayerCount: 1,
    });
    expect(result.nextRequiredAction).toContain("Do not call generate-design");
    expect(testState.insertedDesign).toMatchObject({
      id: "copied-design",
      designSystemId: "override-system",
    });
    const data = JSON.parse(String(testState.insertedDesign?.data));
    expect(data.canvasFrames["copied-file"]).toEqual({
      x: 10,
      y: 20,
      width: 1080,
      height: 1080,
    });
    expect(data.templateSource).toMatchObject({
      templateId: "saved-template",
      templateDesignSystemId: "linked-system",
      appliedDesignSystemId: "override-system",
      designSystemOverridden: true,
    });
    expect(testState.insertedFiles[0]?.content).toContain(
      'data-agent-native-locked="true"',
    );
  });

  it("rejects an inaccessible explicit override before inserting anything", async () => {
    await expect(
      action.run({
        templateId: "saved-template",
        designSystemId: "inaccessible-system",
      }),
    ).rejects.toThrow("Design system not found");

    expect(testState.transactionCount).toBe(0);
    expect(testState.insertedDesign).toBeNull();
  });
});
