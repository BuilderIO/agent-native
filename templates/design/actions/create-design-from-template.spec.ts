import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  resolveAccess: vi.fn(),
  assertAccess: vi.fn(),
  nanoidValues: ["copied-design", "copied-file"],
  templateData: null as string | null,
  insertedDesign: null as Record<string, unknown> | null,
  insertedFiles: [] as Array<Record<string, unknown>>,
  updatedDesign: null as Record<string, unknown> | null,
  targetDesignFiles: [] as Array<Record<string, unknown>>,
  targetDesignRows: [] as Array<Record<string, unknown>>,
  transactionCount: 0,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "owner@example.com",
  getRequestOrgId: () => "org-1",
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => testState.resolveAccess(...args),
  assertAccess: (...args: unknown[]) => testState.assertAccess(...args),
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (column: unknown, value: unknown) => ({ column, value }),
  ne: (column: unknown, value: unknown) => ({ column, value, op: "ne" }),
  and: (...parts: unknown[]) => ({ parts }),
}));

vi.mock("nanoid", () => ({
  nanoid: () => testState.nanoidValues.shift() ?? "generated-id",
}));

vi.mock("../server/db/index.js", () => {
  const schema = {
    designs: { table: "designs", data: "designs.data" },
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
        '<link href="https://fonts.googleapis.com/css2?family=Sora:wght@700" rel="stylesheet">' +
        '<main style="width:1080px;height:1080px;font-family:Sora,sans-serif"><div data-agent-native-locked="true">Brand</div><p>Editable</p></main>',
    },
  ];
  const select = () => ({
    from: (table: { table: string }) => ({
      where: () => {
        const rows =
          table.table === "designFiles"
            ? testState.targetDesignFiles
            : table.table === "designs"
              ? testState.targetDesignRows
              : templateFiles;
        const result = Promise.resolve(rows) as Promise<unknown[]> & {
          limit: (n: number) => Promise<unknown[]>;
        };
        result.limit = async () => rows;
        return result;
      },
    }),
  });
  return {
    schema,
    getDb: () => ({
      select,
      transaction: async (
        run: (tx: {
          select: typeof select;
          insert: (table: { table: string }) => {
            values: (values: unknown) => Promise<void>;
          };
          update: (table: { table: string }) => {
            set: (values: unknown) => {
              where: (condition: unknown) => Promise<void>;
            };
          };
          execute: (query: unknown) => Promise<{ rows: unknown[] }>;
        }) => Promise<void>,
      ) => {
        testState.transactionCount += 1;
        await run({
          select,
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
          update: () => ({
            set: (values) => ({
              where: async () => {
                testState.updatedDesign = values as Record<string, unknown>;
              },
            }),
          }),
          execute: async () => ({ rows: [] }),
        });
      },
    }),
  };
});

import { designTemplateRetryKey } from "../shared/design-template-retry.js";
import action from "./create-design-from-template.js";

describe("create-design-from-template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.nanoidValues = ["copied-design", "copied-file"];
    testState.templateData = null;
    testState.insertedDesign = null;
    testState.insertedFiles = [];
    testState.updatedDesign = null;
    testState.targetDesignFiles = [];
    testState.targetDesignRows = [];
    testState.transactionCount = 0;
    testState.assertAccess.mockResolvedValue(undefined);
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
              data:
                testState.templateData ??
                JSON.stringify({
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

  it("copies screens and dimensions, preserves locks, and links an override without adaptation", async () => {
    const result = await action.run({
      templateId: "saved-template",
      designSystemId: "override-system",
    });

    expect(result).toMatchObject({
      id: "copied-design",
      designSystemId: "override-system",
      designSystemOverridden: true,
      adaptationPending: false,
      lockedLayerCount: 1,
    });
    expect(result.nextRequiredAction).toBeNull();
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
    expect(data.templateSource.files).toEqual([
      {
        designFileId: "copied-file",
        templateFileId: "template-file",
        filename: "index.html",
        width: 1080,
        height: 1080,
      },
    ]);
    expect(data.templateSource.fonts).toEqual(["Sora"]);
    expect(testState.insertedFiles[0]?.content).toContain(
      'data-agent-native-locked="true"',
    );
  });

  it.each([
    { mode: "creating a design", targetDesignId: undefined },
    { mode: "filling an empty design", targetDesignId: "existing-design" },
  ])(
    "removes legacy localhost bindings when $mode",
    async ({ targetDesignId }) => {
      testState.templateData = JSON.stringify({
        sourceType: "dev-server",
        sourceMode: "localhost",
        connectionId: "foreign-root-connection",
        bridgeUrl: "http://127.0.0.1:7331",
        bridgeToken: "foreign-root-bridge-token",
        previewToken: "foreign-root-preview-token",
        localhostScreens: {
          "template-file": {
            connectionId: "foreign-screen-connection",
            bridgeUrl: "http://127.0.0.1:7331",
          },
        },
        url: "http://127.0.0.1:3000/",
        previewUrl: "http://127.0.0.1:3000/preview",
        canvasFrames: {
          "template-file": { x: 10, y: 20, width: 1080, height: 1080 },
        },
        screenMetadata: {
          "template-file": {
            sourceType: "local-file",
            connectionId: "foreign-screen-connection",
            bridgeUrl: "http://127.0.0.1:7331",
            bridgeToken: "foreign-screen-bridge-token",
            previewToken: "foreign-screen-preview-token",
            url: "http://127.0.0.1:3000/route",
            previewUrl: "http://127.0.0.1:3000/preview",
            title: "Live home screen",
            width: 1080,
            height: 720,
            nested: {
              connectionId: "nested-foreign-connection",
              bridgeUrl: "http://127.0.0.1:7331",
            },
          },
          "static-file": {
            sourceType: "inline",
            url: "https://example.com/static-preview.png",
            previewUrl: "https://example.com/preview",
            title: "Static screen",
          },
          "legacy-local-source-file": {
            source: "localhost",
            url: "http://127.0.0.1:3000/legacy-route",
            previewUrl: "http://127.0.0.1:3000/legacy-preview",
            title: "Legacy local screen",
          },
        },
      });

      if (targetDesignId) {
        testState.targetDesignRows = [
          {
            data: JSON.stringify({
              boardFileId: "existing-board",
              editorPreference: "preserve-me",
            }),
          },
        ];
      }

      await action.run({ templateId: "saved-template", targetDesignId });

      const copiedData = JSON.parse(
        String(
          targetDesignId
            ? testState.updatedDesign?.data
            : testState.insertedDesign?.data,
        ),
      ) as Record<string, unknown>;
      if (targetDesignId) {
        expect(testState.assertAccess).toHaveBeenCalledWith(
          "design",
          "existing-design",
          "editor",
        );
        expect(copiedData).toMatchObject({
          boardFileId: "existing-board",
          editorPreference: "preserve-me",
        });
      }
      expect(copiedData).toMatchObject({
        sourceType: "inline",
        sourceMode: "inline",
      });
      expect(copiedData).not.toHaveProperty("connectionId");
      expect(copiedData).not.toHaveProperty("localhostScreens");
      expect(copiedData).not.toHaveProperty("bridgeUrl");
      expect(copiedData).not.toHaveProperty("bridgeToken");
      expect(copiedData).not.toHaveProperty("previewToken");
      expect(copiedData).not.toHaveProperty("url");
      expect(copiedData).not.toHaveProperty("previewUrl");

      const copiedMetadata = copiedData.screenMetadata as Record<
        string,
        Record<string, unknown>
      >;
      const copiedFileId = targetDesignId ? "copied-design" : "copied-file";
      expect(copiedMetadata[copiedFileId]).toMatchObject({
        sourceType: "inline",
        title: "Live home screen",
        width: 1080,
        height: 720,
        nested: {},
      });
      expect(copiedMetadata[copiedFileId]).not.toHaveProperty("connectionId");
      expect(copiedMetadata[copiedFileId]).not.toHaveProperty("bridgeUrl");
      expect(copiedMetadata[copiedFileId]).not.toHaveProperty("bridgeToken");
      expect(copiedMetadata[copiedFileId]).not.toHaveProperty("previewToken");
      expect(copiedMetadata[copiedFileId]).not.toHaveProperty("url");
      expect(copiedMetadata[copiedFileId]).not.toHaveProperty("previewUrl");
      expect(copiedMetadata["static-file"]).toMatchObject({
        sourceType: "inline",
        url: "https://example.com/static-preview.png",
        previewUrl: "https://example.com/preview",
        title: "Static screen",
      });
      expect(copiedMetadata["legacy-local-source-file"]).toMatchObject({
        source: "inline",
        title: "Legacy local screen",
      });
      expect(copiedMetadata["legacy-local-source-file"]).not.toHaveProperty(
        "url",
      );
      expect(copiedMetadata["legacy-local-source-file"]).not.toHaveProperty(
        "previewUrl",
      );
    },
  );

  it("requests adaptation only when an explicit prompt is supplied", async () => {
    const result = await action.run({
      templateId: "saved-template",
      designSystemId: "override-system",
      prompt: "Adapt the unlocked content for a summer campaign",
    });

    expect(result).toMatchObject({
      designSystemId: "override-system",
      designSystemOverridden: true,
      promptPending: true,
      adaptationPending: true,
    });
    expect(result.nextRequiredAction).toContain("Do not call generate-design");
  });

  it("fills the design the caller already created instead of making a second one", async () => {
    const result = await action.run({
      templateId: "saved-template",
      targetDesignId: "existing-design",
    } as never);

    expect(testState.assertAccess).toHaveBeenCalledWith(
      "design",
      "existing-design",
      "editor",
    );
    expect(testState.insertedDesign).toBeNull();
    expect(testState.updatedDesign).toMatchObject({
      title: "Saved campaign",
      designSystemId: "linked-system",
    });
    expect(result.id).toBe("existing-design");
    expect(
      testState.insertedFiles.every(
        (file) => file.designId === "existing-design",
      ),
    ).toBe(true);
  });

  it("treats a design holding only the board row as empty", async () => {
    testState.targetDesignFiles = [];

    const result = await action.run({
      templateId: "saved-template",
      targetDesignId: "existing-design",
    } as never);

    expect(result.id).toBe("existing-design");
    expect(testState.insertedFiles.length).toBe(1);
  });

  it("keeps the target's own editor state instead of replacing its data blob", async () => {
    testState.targetDesignRows = [
      { data: JSON.stringify({ boardFileId: "board-1", keepMe: true }) },
    ];

    await action.run({
      templateId: "saved-template",
      targetDesignId: "existing-design",
    } as never);

    const written = JSON.parse(
      String(testState.updatedDesign?.data ?? "{}"),
    ) as Record<string, unknown>;
    expect(written.boardFileId).toBe("board-1");
    expect(written.keepMe).toBe(true);
    expect(written.templateSource).toBeTruthy();
  });

  it("refuses to overwrite a target that already has screens", async () => {
    testState.targetDesignFiles = [{ id: "existing-file" }];

    await expect(
      action.run({
        templateId: "saved-template",
        targetDesignId: "existing-design",
      } as never),
    ).rejects.toThrow(/only fill an empty design/i);

    expect(testState.transactionCount).toBe(1);
    expect(testState.updatedDesign).toBeNull();
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

  it("preserves stable retries without requiring callers to build the fingerprint", async () => {
    const first = await action.run({
      templateId: "saved-template",
      newId: "retry-id",
    });
    expect(first.id).toBe("retry-id");

    await expect(
      action.run({
        templateId: "saved-template",
        newId: "retry-id",
        retryKey: "wrong-key",
      }),
    ).rejects.toThrow(/cannot be reused/i);

    const retryKey = designTemplateRetryKey({
      templateId: "saved-template",
      title: "Saved campaign",
    });
    expect(retryKey.length).toBeLessThanOrEqual(128);
  });
});
