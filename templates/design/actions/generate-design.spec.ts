/**
 * Tests for generate-design.
 *
 * Coverage focus (in addition to the pre-existing tool-schema test): the
 * existing-file UPDATE path now goes through writeInlineSourceFile with a
 * freshly-read expectedVersionHash, closing the stale-diff-base race where
 * `file.content` is LLM-generated content that can be arbitrarily stale by
 * the time this action persists it (the same bug class already fixed in
 * insert-design-native-asset.ts / insert-asset.ts). The NEW-file creation
 * path (db.insert + seedFromText) uses the same core write mechanics as
 * before. Both paths now also stamp missing data-agent-native-node-id
 * attributes before persisting (shared/screen-annotation.ts) so generated
 * screens are born fully addressable by id-keyed editor operations instead
 * of depending on a client-side backfill the first time someone opens them.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  function makeWhereResult(rows: unknown[]) {
    const promise = Promise.resolve(rows) as Promise<unknown[]> & {
      limit: (n: number) => Promise<unknown[]>;
    };
    promise.limit = vi.fn().mockResolvedValue(rows);
    return promise;
  }

  let fileRows: Array<Record<string, unknown>> = [];
  let designRows: Array<Record<string, unknown>> = [
    { id: "design-1", data: null },
  ];
  let designData: Record<string, unknown> = {};

  const fileSelectChain = { from: vi.fn(), where: vi.fn() };
  fileSelectChain.from.mockReturnValue(fileSelectChain);
  fileSelectChain.where.mockImplementation(
    (predicate?: { left?: unknown; right?: unknown }) => {
      if (predicate && predicate.left === "designFiles.id") {
        return makeWhereResult(
          fileRows.filter((row) => row.id === predicate.right),
        );
      }
      if (predicate && predicate.left === "designFiles.designId") {
        return makeWhereResult(
          fileRows.filter((row) => row.designId === predicate.right),
        );
      }
      return makeWhereResult(fileRows);
    },
  );

  const designSelectChain = { from: vi.fn(), where: vi.fn() };
  designSelectChain.from.mockReturnValue(designSelectChain);
  designSelectChain.where.mockImplementation(
    (predicate?: { left?: unknown; right?: unknown }) => {
      if (predicate && predicate.left === "designs.id") {
        return makeWhereResult(
          designRows.filter((row) => row.id === predicate.right),
        );
      }
      return makeWhereResult(designRows);
    },
  );

  const select = vi.fn((projection?: Record<string, unknown>) => {
    if (projection && "data" in projection) return designSelectChain;
    return fileSelectChain;
  });

  const insert = vi.fn(() => ({
    values: vi.fn().mockResolvedValue(undefined),
  }));

  const fileUpdateChain = { set: vi.fn(), where: vi.fn() };
  fileUpdateChain.set.mockReturnValue(fileUpdateChain);
  fileUpdateChain.where.mockResolvedValue({ rowsAffected: 1 });

  const designUpdateChain = { set: vi.fn(), where: vi.fn() };
  designUpdateChain.set.mockReturnValue(designUpdateChain);
  designUpdateChain.where.mockResolvedValue(undefined);

  const update = vi.fn((table: unknown) => {
    if (table === schemaRef.designs) return designUpdateChain;
    return fileUpdateChain;
  });

  const schemaRef: { designFiles?: unknown; designs?: unknown } = {};

  const tx = {
    select,
    insert,
    update,
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  };

  const transaction = vi.fn(async (fn: (tx: typeof tx) => Promise<void>) => {
    await fn(tx);
  });

  const db = {
    select,
    insert,
    update,
    transaction,
  };

  const seededCollabText = new Map<string, string>();

  return {
    db,
    schemaRef,
    fileSelectChain,
    designSelectChain,
    fileUpdateChain,
    designUpdateChain,
    insert,
    transaction,
    seededCollabText,
    setFileRows: (next: Array<Record<string, unknown>>) => {
      fileRows = next;
    },
    setDesignRows: (next: Array<Record<string, unknown>>) => {
      designRows = next;
    },
    setDesignData: (next: Record<string, unknown>) => {
      designData = next;
    },
    getDesignData: () => designData,
    mutateDesignData: vi.fn(),
    assertAccess: vi.fn().mockResolvedValue(undefined),
    and: vi.fn((...conditions) => ({ conditions })),
    inArray: vi.fn((column, values) => ({ column, values })),
    eq: vi.fn((left, right) => ({ left, right })),
    isNull: vi.fn((value) => ({ isNull: value })),
    readAppState: vi.fn().mockResolvedValue(null),
    writeAppState: vi.fn().mockResolvedValue(undefined),
    getGenerationCreativeContext: vi.fn().mockResolvedValue(null),
    recordGenerationCreativeContext: vi.fn().mockResolvedValue(undefined),
    resolveGenerationCreativeContext: vi.fn().mockResolvedValue({
      contextMode: "auto",
      contextPackId: null,
      reuseLabels: [],
      results: [],
    }),
    validateGenerationCreativeContext: vi.fn(
      async (input: {
        contextPackId?: string | null;
        contextModeOverride?: "off";
        reuseLabels?: Array<Record<string, unknown>>;
      }) => ({
        contextMode:
          input.contextModeOverride === "off"
            ? "off"
            : input.contextPackId
              ? "pinned"
              : "auto",
        contextPackId:
          input.contextModeOverride === "off"
            ? null
            : (input.contextPackId ?? null),
        reuseLabels: input.reuseLabels ?? [],
        results: [],
      }),
    ),
  };
});

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  eq: mocks.eq,
  inArray: mocks.inArray,
  isNull: mocks.isNull,
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: mocks.readAppState,
  writeAppState: mocks.writeAppState,
}));

vi.mock("@agent-native/core/collab", () => {
  const seeded = mocks.seededCollabText;
  const hasCollabState = vi.fn(async (docId: string) => seeded.has(docId));
  const getText = vi.fn(async (docId: string) => seeded.get(docId) ?? "");
  return {
    CollabBaseVersionConflictError: class CollabBaseVersionConflictError extends Error {},
    hasCollabState,
    getText,
    applyText: vi.fn(async (docId: string, text: string) => {
      seeded.set(docId, text);
      return text;
    }),
    seedFromText: vi.fn(async (docId: string, text: string) => {
      if (!seeded.has(docId)) seeded.set(docId, text);
    }),
    applyTextToYDoc: vi.fn(
      (doc: { content: string }, _fieldName: string, text: string) => {
        doc.content = text;
      },
    ),
    withPreparedYDocMutation: vi.fn(
      async (
        docId: string,
        _requestSource: string | undefined,
        run: (lease: {
          doc: { content: string; getText: () => { toString: () => string } };
          baseVersion: number | null;
          persist: (_tx: unknown, text: string) => Promise<void>;
        }) => Promise<unknown>,
      ) => {
        const hasLiveDoc = await hasCollabState(docId);
        const doc = {
          content: hasLiveDoc ? await getText(docId) : "",
          getText: () => ({ toString: () => doc.content }),
        };
        const result = await run({
          doc,
          baseVersion: hasLiveDoc ? 0 : null,
          persist: async (_tx, text) => {
            seeded.set(docId, text);
          },
        });
        return result;
      },
    ),
    agentEnterDocument: vi.fn(),
    agentLeaveDocument: vi.fn(),
    agentUpdateSelection: vi.fn(),
  };
});

vi.mock("../server/db/index.js", () => {
  const schema = {
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      fileType: "designFiles.fileType",
      content: "designFiles.content",
    },
    designs: {
      id: "designs.id",
      title: "designs.title",
      data: "designs.data",
    },
  };
  mocks.schemaRef.designFiles = schema.designFiles;
  mocks.schemaRef.designs = schema.designs;
  return {
    getDb: () => mocks.db,
    schema,
  };
});

vi.mock("../server/lib/design-data-mutation.js", () => ({
  mutateDesignData: mocks.mutateDesignData,
}));

vi.mock("@agent-native/creative-context/server", () => ({
  getGenerationCreativeContext: mocks.getGenerationCreativeContext,
  recordGenerationCreativeContext: mocks.recordGenerationCreativeContext,
  resolveGenerationCreativeContext: mocks.resolveGenerationCreativeContext,
  validateGenerationCreativeContext: mocks.validateGenerationCreativeContext,
  validateCreativeContextReuseLabels: (
    labels: Array<Record<string, unknown>>,
  ) => labels,
  mergeCreativeContextReuseLabels: (
    previous: Array<Record<string, unknown>>,
    next: Array<Record<string, unknown>>,
  ) => [...previous, ...next],
  replaceCreativeContextElementProvenance: (
    previous: Array<{ elementId: string }>,
    next: Array<{ elementId: string }>,
  ) => {
    const replaced = new Set(next.map((entry) => entry.elementId));
    return [
      ...previous.filter((entry) => !replaced.has(entry.elementId)),
      ...next,
    ];
  },
}));

import action from "./generate-design.js";

function resetDesignDataMutation() {
  mocks.setDesignData({ concurrentSibling: { keep: true } });
  mocks.mutateDesignData.mockImplementation(
    async (options: {
      mutate: (
        current: Record<string, unknown>,
        context: { updatedAt: string },
      ) => Record<string, unknown>;
      isApplied: (current: Record<string, unknown>) => boolean;
    }) => {
      const updatedAt = "2026-07-09T12:00:00.000Z";
      const next = options.mutate(mocks.getDesignData(), { updatedAt });
      mocks.setDesignData(next);
      expect(options.isApplied(next)).toBe(true);
      return { data: next, updatedAt };
    },
  );
}

function setExistingFile(
  content: string,
  overrides: Partial<{
    id: string;
    designId: string;
    filename: string;
    fileType: string;
  }> = {},
) {
  mocks.setFileRows([
    {
      id: overrides.id ?? "file-1",
      designId: overrides.designId ?? "design-1",
      filename: overrides.filename ?? "index.html",
      fileType: overrides.fileType ?? "html",
      content,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
}

describe("generate-design action tool schema", () => {
  it("exposes a lean native-tool schema while retaining Zod validation", () => {
    const parameters = action.tool.parameters as {
      properties?: Record<
        string,
        { type?: string | readonly string[]; description?: string }
      >;
      required?: string[];
    };

    expect(parameters.required).toEqual(["designId", "prompt", "files"]);
    expect(parameters.properties?.files?.type).toBe("string");
    expect(parameters.properties?.files?.description).toContain(
      "Do not use generate-design to replace a selected variant screen",
    );
    expect(parameters.properties?.files?.description).toContain("edit-design");
    expect(parameters.properties?.designSystemId?.type).toEqual([
      "string",
      "null",
    ]);
    expect(parameters.properties?.tweaks?.type).toBe("string");
    expect(parameters.properties?.canvasFrames?.type).toBe("string");
    expect(parameters.properties?.reuseLabels?.type).toBe("string");
    expect(parameters.properties?.contextModeOverride?.type).toBe("string");

    const parsed = (action as any).schema.safeParse({
      designId: "design_123",
      prompt: "Dark SaaS landing page",
      designSystemId: null,
      files: JSON.stringify([
        {
          filename: "index.html",
          fileType: "html",
          content: "<!doctype html><html><body>Hello</body></html>",
        },
      ]),
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data.designSystemId).toBeNull();
    expect(parsed.data.files).toEqual([
      {
        filename: "index.html",
        fileType: "html",
        content: "<!doctype html><html><body>Hello</body></html>",
      },
    ]);
  });
});

describe("generate-design: canvasFrames duplicate-target rejection", () => {
  it("rejects two canvasFrames entries targeting the same fileId", () => {
    const parsed = (action as any).schema.safeParse({
      designId: "design-1",
      prompt: "Add a screen",
      files: [
        { filename: "index.html", fileType: "html", content: "<html></html>" },
      ],
      canvasFrames: JSON.stringify([
        { fileId: "file-1", x: 0, y: 0, width: 100, height: 100 },
        { fileId: "file-1", x: 50, y: 50, width: 100, height: 100 },
      ]),
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects two canvasFrames entries targeting the same filename", () => {
    const parsed = (action as any).schema.safeParse({
      designId: "design-1",
      prompt: "Add a screen",
      files: [
        { filename: "index.html", fileType: "html", content: "<html></html>" },
      ],
      canvasFrames: JSON.stringify([
        { filename: "index.html", x: 0, y: 0, width: 100, height: 100 },
        { filename: "index.html", x: 50, y: 50, width: 100, height: 100 },
      ]),
    });
    expect(parsed.success).toBe(false);
  });

  it("still accepts distinct canvasFrames targets", () => {
    const parsed = (action as any).schema.safeParse({
      designId: "design-1",
      prompt: "Add screens",
      files: [
        { filename: "index.html", fileType: "html", content: "<html></html>" },
        {
          filename: "details.html",
          fileType: "html",
          content: "<html></html>",
        },
      ],
      canvasFrames: JSON.stringify([
        { filename: "index.html", x: 0, y: 0, width: 100, height: 100 },
        { filename: "details.html", x: 200, y: 0, width: 100, height: 100 },
      ]),
    });
    expect(parsed.success).toBe(true);
  });
});

describe("generate-design: existing-file update path (hash-guarded write)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.seededCollabText.clear();
    mocks.setFileRows([]);
    mocks.setDesignRows([
      { id: "design-1", title: "Untitled Design", data: null },
    ]);
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.fileUpdateChain.where.mockResolvedValue({ rowsAffected: 1 });
    mocks.designUpdateChain.where.mockResolvedValue(undefined);
    resetDesignDataMutation();
  });

  it("updates an existing file's content via the hash-guarded write path", async () => {
    setExistingFile("<html><body>old</body></html>");

    const result = await action.run({
      designId: "design-1",
      prompt: "Update copy",
      files: [
        {
          filename: "index.html",
          fileType: "html",
          content: "<html><body>new</body></html>",
        },
      ],
    });

    expect(result.savedFiles).toEqual([
      { id: "file-1", filename: "index.html", fileType: "html" },
    ]);
    expect(mocks.fileUpdateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(
          /^<html data-agent-native-node-id="[^"]+"><body data-agent-native-node-id="[^"]+">new<\/body><\/html>$/,
        ),
      }),
    );
    expect(mocks.seededCollabText.get("file-1")).toEqual(
      expect.stringContaining("new</body></html>"),
    );
    expect(mocks.seededCollabText.get("file-1")).toContain(
      "data-agent-native-node-id",
    );
  });

  it("reports (never throws) the conflict when the live content changed since it was read (concurrent write)", async () => {
    setExistingFile("<html><body>old</body></html>");

    const collab = await import("@agent-native/core/collab");
    let hasCollabCalls = 0;
    (collab.hasCollabState as any).mockImplementation(async () => {
      hasCollabCalls += 1;
      return hasCollabCalls > 0;
    });
    let getTextCalls = 0;
    (collab.getText as any).mockImplementation(async () => {
      getTextCalls += 1;
      return getTextCalls === 1
        ? "<html><body>old</body></html>"
        : "<html><body>concurrent-edit</body></html>";
    });

    const result = await action.run({
      designId: "design-1",
      prompt: "Update copy",
      files: [
        {
          filename: "index.html",
          fileType: "html",
          content: "<html><body>stale-generated</body></html>",
        },
      ],
    });

    expect(mocks.fileUpdateChain.set).not.toHaveBeenCalled();
    expect(result.savedFiles).toEqual([]);
    expect(result.fileErrors).toEqual([
      {
        filename: "index.html",
        message: expect.stringContaining("changed since it was read"),
      },
    ]);
  });

  it("keeps an earlier file's save and reports a later file's write conflict instead of discarding both", async () => {
    mocks.setFileRows([
      {
        id: "file-1",
        designId: "design-1",
        filename: "index.html",
        fileType: "html",
        content: "<html><body>old-1</body></html>",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "file-2",
        designId: "design-1",
        filename: "details.html",
        fileType: "html",
        content: "<html><body>old-2</body></html>",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    // Only file-2 gets the "concurrent write" race from the test above: its
    const collab = await import("@agent-native/core/collab");
    let file2GetTextCalls = 0;
    (collab.hasCollabState as any).mockImplementation(
      async (docId: string) => docId === "file-2",
    );
    (collab.getText as any).mockImplementation(async (docId: string) => {
      if (docId !== "file-2") return mocks.seededCollabText.get(docId) ?? "";
      file2GetTextCalls += 1;
      return file2GetTextCalls === 1
        ? "<html><body>old-2</body></html>"
        : "<html><body>concurrent-edit</body></html>";
    });

    const result = await action.run({
      designId: "design-1",
      prompt: "Update two screens",
      files: [
        {
          filename: "index.html",
          fileType: "html",
          content: "<html><body>new-1</body></html>",
        },
        {
          filename: "details.html",
          fileType: "html",
          content: "<html><body>new-2</body></html>",
        },
      ],
    });

    expect(result.savedFiles).toEqual([
      { id: "file-1", filename: "index.html", fileType: "html" },
    ]);
    expect(mocks.fileUpdateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("new-1") }),
    );
    const data = mocks.getDesignData();
    expect(
      (data.canvasFrames as Record<string, unknown> | undefined)?.["file-1"],
    ).toBeDefined();

    expect(result.fileErrors).toEqual([
      {
        filename: "details.html",
        message: expect.stringContaining("changed since it was read"),
      },
    ]);
  });

  it("updates fileType separately when it changes, alongside the guarded content write", async () => {
    setExistingFile("<html><body>old</body></html>", { fileType: "html" });

    await action.run({
      designId: "design-1",
      prompt: "Convert to jsx",
      files: [
        {
          filename: "index.html",
          fileType: "jsx",
          content: "<html><body>new</body></html>",
        },
      ],
    });

    const fileTypeCall = mocks.fileUpdateChain.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>).fileType === "jsx",
    );
    expect(fileTypeCall).toBeDefined();
  });

  it("rethrows an unclassified infrastructure failure instead of reporting it as a fileError", async () => {
    setExistingFile("<html><body>old</body></html>");

    mocks.assertAccess
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("ECONNREFUSED: connection lost"));

    await expect(
      action.run({
        designId: "design-1",
        prompt: "Update copy",
        files: [
          {
            filename: "index.html",
            fileType: "html",
            content: "<html><body>new</body></html>",
          },
        ],
      }),
    ).rejects.toThrow("ECONNREFUSED");

    expect(mocks.fileUpdateChain.set).not.toHaveBeenCalled();
  });
});

describe("generate-design: generation-session lock guards concurrent fan-out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.seededCollabText.clear();
    mocks.setFileRows([]);
    mocks.setDesignRows([{ id: "design-1", data: null }]);
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.fileUpdateChain.where.mockResolvedValue({ rowsAffected: 1 });
    mocks.designUpdateChain.where.mockResolvedValue(undefined);
    resetDesignDataMutation();
  });

  it("marks both fanned-out frames done instead of losing one to a last-write-wins race", async () => {
    const sessionStore = new Map<string, Record<string, unknown>>();
    const key = "design-generation-session:design-1";
    sessionStore.set(key, {
      designId: "design-1",
      status: "generating",
      prompt: "Build two screens",
      contextRefs: [],
      frames: [
        {
          frameId: "frame-1",
          filename: "index.html",
          agentId: "agent-1",
          agentName: "Atlas",
          agentColor: "red",
          region: { x: 0, y: 0, width: 100, height: 100 },
          role: "screen",
          status: "queued",
          progress: 0,
        },
        {
          frameId: "frame-2",
          filename: "details.html",
          agentId: "agent-2",
          agentName: "Nova",
          agentColor: "blue",
          region: { x: 0, y: 0, width: 100, height: 100 },
          role: "screen",
          status: "queued",
          progress: 0,
        },
      ],
      startedAt: "2026-07-09T00:00:00.000Z",
    });

    mocks.readAppState.mockImplementation(async (k: string) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return sessionStore.get(k) ?? null;
    });
    mocks.writeAppState.mockImplementation(
      async (k: string, value: Record<string, unknown>) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        sessionStore.set(k, value);
      },
    );

    await Promise.all([
      action.run({
        designId: "design-1",
        prompt: "Build two screens",
        files: [
          {
            filename: "index.html",
            fileType: "html",
            content: "<html><body>index</body></html>",
          },
        ],
      }),
      action.run({
        designId: "design-1",
        prompt: "Build two screens",
        files: [
          {
            filename: "details.html",
            fileType: "html",
            content: "<html><body>details</body></html>",
          },
        ],
      }),
    ]);

    const finalSession = sessionStore.get(key) as {
      status: string;
      frames: Array<{ filename?: string; status: string }>;
    };
    expect(
      finalSession.frames.find((f) => f.filename === "index.html")?.status,
    ).toBe("done");
    expect(
      finalSession.frames.find((f) => f.filename === "details.html")?.status,
    ).toBe("done");
    expect(finalSession.status).toBe("done");
  });
});

describe("generate-design: new-file creation path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.seededCollabText.clear();
    mocks.setFileRows([]);
    mocks.setDesignRows([{ id: "design-1", data: null }]);
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.fileUpdateChain.where.mockResolvedValue({ rowsAffected: 1 });
    mocks.designUpdateChain.where.mockResolvedValue(undefined);
    resetDesignDataMutation();
  });

  it("creates a brand-new file via insert + seedFromText, with no pre-existing base to race against", async () => {
    const result = await action.run({
      designId: "design-1",
      prompt: "New landing page",
      files: [
        {
          filename: "index.html",
          fileType: "html",
          content: "<!doctype html><html><body>Hello</body></html>",
        },
      ],
    });

    expect(result.savedFiles).toHaveLength(1);
    expect(mocks.insert).toHaveBeenCalled();
    expect(mocks.fileUpdateChain.set).not.toHaveBeenCalled();
    const seededValues = Array.from(mocks.seededCollabText.values());
    expect(seededValues).toHaveLength(1);
    expect(seededValues[0]).toContain("<body");
    expect(seededValues[0]).toContain("Hello</body></html>");
    expect(seededValues[0]).toContain("data-agent-native-node-id");
    expect(mocks.getDesignData()).toMatchObject({
      concurrentSibling: { keep: true },
      lastPrompt: "New landing page",
      fileCount: 1,
    });
  });

  it("replaces a placeholder title from the generation prompt", async () => {
    await action.run({
      designId: "design-1",
      prompt: "A warm editorial journal for book lovers\nUse cream and rust",
      files: [
        {
          filename: "index.html",
          fileType: "html",
          content: "<!doctype html><html><body>Reading list</body></html>",
        },
      ],
    });

    expect(mocks.designUpdateChain.set).toHaveBeenCalledWith({
      title: "A warm editorial journal for book lovers",
    });
    expect(mocks.designUpdateChain.where).toHaveBeenCalledWith({
      conditions: [
        { left: "designs.id", right: "design-1" },
        {
          column: "designs.title",
          values: ["Untitled", "Untitled Design"],
        },
      ],
    });
  });

  it("lands urlPath and the deep link on the overview canvas focused on the new screen", async () => {
    const result = await action.run({
      designId: "design-1",
      prompt: "New landing page",
      files: [
        {
          filename: "index.html",
          fileType: "html",
          content: "<!doctype html><html><body>Hello</body></html>",
        },
      ],
    });

    const savedFileId = result.savedFiles[0]!.id;
    expect(result.urlPath).toBe(
      `/design/design-1?editorView=overview&screen=${savedFileId}`,
    );
    const link = action.link?.({ args: {}, result });
    expect(link?.url).toContain(`screen=${savedFileId}`);
    expect(link?.url).toContain("view=editor");
  });

  it("defaults a generated web screen to a desktop canvas and responsive breakpoints", async () => {
    await action.run({
      designId: "design-1",
      prompt: "Create a task manager",
      files: [
        {
          filename: "index.html",
          fileType: "html",
          content: "<!doctype html><html><body>Tasks</body></html>",
        },
      ],
    });

    const data = mocks.getDesignData();
    const [frame] = Object.values(
      data.canvasFrames as Record<string, Record<string, unknown>>,
    );
    expect(frame).toMatchObject({
      x: 0,
      y: 0,
      width: 1440,
      height: 900,
    });
    expect(data.breakpointSet).toMatchObject({
      breakpoints: [expect.objectContaining({ label: "Mobile", widthPx: 390 })],
    });
    expect(
      (data.breakpointSet as { breakpoints: unknown[] }).breakpoints,
    ).toHaveLength(1);
  });

  it("uses the requested mobile viewport when the agent supplies it", async () => {
    await action.run({
      designId: "design-1",
      prompt: "Create a mobile task manager",
      primaryViewport: "mobile",
      files: [
        {
          filename: "index.html",
          fileType: "html",
          content: "<!doctype html><html><body>Tasks</body></html>",
        },
      ],
    });

    const data = mocks.getDesignData();
    const [frame] = Object.values(
      data.canvasFrames as Record<string, Record<string, unknown>>,
    );
    expect(frame).toMatchObject({ width: 390, height: 844 });
  });

  it("persists an explicit canvas target's viewport metadata", async () => {
    const result = await action.run({
      designId: "design-1",
      prompt: "Create a mobile onboarding screen",
      files: [
        {
          filename: "onboarding.html",
          fileType: "html",
          content: "<!doctype html><html><body>Onboarding</body></html>",
        },
      ],
      canvasFrames: [
        {
          filename: "onboarding.html",
          x: 0,
          y: 0,
          width: 390,
          height: 844,
        },
      ],
    });

    const data = mocks.getDesignData();
    const metadata = data.screenMetadata as Record<string, unknown>;
    expect(metadata[result.savedFiles[0]!.id]).toMatchObject({
      width: 390,
      height: 844,
    });
  });

  it("derives the base frame and breakpoint set from an explicit devices list", async () => {
    await action.run({
      designId: "design-1",
      prompt: "Create a responsive landing page",
      devices: ["mobile", "tablet", "desktop"],
      files: [
        {
          filename: "index.html",
          fileType: "html",
          content: "<!doctype html><html><body>Landing</body></html>",
        },
      ],
    });

    const data = mocks.getDesignData();
    const [frame] = Object.values(
      data.canvasFrames as Record<string, Record<string, unknown>>,
    );
    expect(frame).toMatchObject({ width: 1440, height: 900 });
    expect(data.breakpointSet).toMatchObject({
      breakpoints: [
        expect.objectContaining({ label: "Mobile", widthPx: 390 }),
        expect.objectContaining({ label: "Tablet", widthPx: 768 }),
      ],
    });
    expect(
      (data.breakpointSet as { breakpoints: unknown[] }).breakpoints,
    ).toHaveLength(2);
  });

  it("produces a single frame with no breakpoints for a one-device request", async () => {
    await action.run({
      designId: "design-1",
      prompt: "Create a phone-only screen",
      devices: ["mobile"],
      files: [
        {
          filename: "index.html",
          fileType: "html",
          content: "<!doctype html><html><body>Phone</body></html>",
        },
      ],
    });

    const data = mocks.getDesignData();
    const [frame] = Object.values(
      data.canvasFrames as Record<string, Record<string, unknown>>,
    );
    expect(frame).toMatchObject({ width: 390, height: 844 });
    expect(data.breakpointSet).toBeUndefined();
  });

  it("pins session evidence to the saved frame and preserves exact versions", async () => {
    const evidence = {
      itemId: "item-1",
      itemVersionId: "version-1",
      kind: "figma-frame",
      label: "Pricing hero",
      dataRole: "untrusted-reference" as const,
    };
    mocks.readAppState.mockResolvedValue({
      id: "session-1",
      designId: "design-1",
      status: "generating",
      prompt: "Pricing",
      contextRefs: [],
      creativeContext: {
        contextMode: "pinned",
        contextPackId: "pack-1",
        reuseLabels: [evidence],
      },
      frames: [
        {
          frameId: "frame-1",
          filename: "index.html",
          agentId: "agent-1",
          agentName: "Atlas",
          agentColor: "red",
          region: { x: 0, y: 0, width: 1440, height: 1024 },
          role: "screen",
          status: "queued",
        },
      ],
      startedAt: "2026-07-16T00:00:00.000Z",
    });

    await action.run({
      designId: "design-1",
      prompt: "Pricing",
      files: [
        {
          filename: "index.html",
          fileType: "html",
          content: "<html><body>Pricing</body></html>",
        },
      ],
    });

    expect(mocks.validateGenerationCreativeContext).toHaveBeenCalledWith({
      contextPackId: "pack-1",
      contextPackSource: "inherited",
      reuseLabels: [evidence],
      reuseLabelsSource: "inherited",
    });
    expect(mocks.recordGenerationCreativeContext).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "design",
        artifactType: "design",
        artifactId: "design-1",
        contextPackId: "pack-1",
        elementProvenance: [
          expect.objectContaining({
            elementId: "frame-1",
            influence: "reference-conditioned",
            itemId: "item-1",
            itemVersionId: "version-1",
          }),
        ],
      }),
    );
  });

  it("makes a one-generation off override structural even with a pinned session", async () => {
    mocks.readAppState.mockResolvedValue({
      designId: "design-1",
      creativeContext: {
        contextMode: "pinned",
        contextPackId: "pack-1",
        reuseLabels: [],
      },
      frames: [],
    });

    await action.run({
      designId: "design-1",
      prompt: "Unbranded concept",
      contextModeOverride: "off",
      files: [
        {
          filename: "index.html",
          fileType: "html",
          content: "<html><body>Concept</body></html>",
        },
      ],
    });

    expect(mocks.resolveGenerationCreativeContext).not.toHaveBeenCalled();
    expect(mocks.getGenerationCreativeContext).not.toHaveBeenCalled();
    expect(mocks.validateGenerationCreativeContext).toHaveBeenCalledWith({
      contextPackId: undefined,
      contextModeOverride: "off",
      reuseLabels: [],
    });
    expect(mocks.recordGenerationCreativeContext).toHaveBeenCalledWith(
      expect.objectContaining({
        contextMode: "off",
        contextPackId: null,
        elementProvenance: [
          expect.objectContaining({ influence: "generated" }),
        ],
      }),
    );
  });
});

describe("generate-design: new screens never stack on existing frames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.seededCollabText.clear();
    mocks.setFileRows([]);
    mocks.setDesignRows([{ id: "design-1", data: null }]);
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.fileUpdateChain.where.mockResolvedValue({ rowsAffected: 1 });
    mocks.designUpdateChain.where.mockResolvedValue(undefined);
    resetDesignDataMutation();
  });

  it("relocates a second screen that requests the first screen's coordinates", async () => {
    mocks.setDesignData({
      canvasFrames: {
        "file-1": { x: 0, y: 0, width: 1440, height: 900, z: 0 },
      },
    });

    await action.run({
      designId: "design-1",
      prompt: "Add a pricing screen",
      files: [
        {
          filename: "pricing.html",
          fileType: "html",
          content: "<!doctype html><html><body>Pricing</body></html>",
        },
      ],
      canvasFrames: [
        { filename: "pricing.html", x: 0, y: 0, width: 1440, height: 900 },
      ],
    });

    const frames = mocks.getDesignData().canvasFrames as Record<
      string,
      { x: number; y: number; width: number; height: number }
    >;
    const first = frames["file-1"]!;
    const second = Object.entries(frames).find(([id]) => id !== "file-1")![1];

    expect(first).toMatchObject({ x: 0, y: 0 });
    const overlaps =
      first.x < second.x + second.width &&
      first.x + first.width > second.x &&
      first.y < second.y + second.height &&
      first.y + first.height > second.y;
    expect(overlaps).toBe(false);
    expect(second.x).toBeGreaterThanOrEqual(1440);
  });

  it("spaces generated screens after their responsive previews", async () => {
    const result = await action.run({
      designId: "design-1",
      prompt: "Create a responsive product flow",
      devices: ["desktop", "tablet", "mobile"],
      files: [
        {
          filename: "home.html",
          fileType: "html",
          content: "<!doctype html><html><body>Home</body></html>",
        },
        {
          filename: "details.html",
          fileType: "html",
          content: "<!doctype html><html><body>Details</body></html>",
        },
      ],
    });

    const frames = mocks.getDesignData().canvasFrames as Record<
      string,
      { x: number; y: number; width: number; height: number }
    >;
    const first = frames[result.savedFiles[0]!.id]!;
    const second = frames[result.savedFiles[1]!.id]!;
    expect(second.x - first.x).toBeCloseTo(1440 + 24 + 768 + 24 + 390 + 96);
  });

  it("does not add responsive previews to primitive board frames", async () => {
    mocks.setFileRows([
      {
        id: "board",
        designId: "design-1",
        filename: "__board__.html",
        fileType: "html",
        content: "<!doctype html><html><body>Board</body></html>",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    mocks.setDesignData({
      breakpointSet: {
        id: "responsive",
        breakpoints: [{ id: "mobile", label: "Mobile", widthPx: 390 }],
      },
      canvasFrames: {
        board: { x: 0, y: 0, width: 1440, height: 900 },
      },
    });

    const result = await action.run({
      designId: "design-1",
      prompt: "Add another screen",
      files: [
        {
          filename: "details.html",
          fileType: "html",
          content: "<!doctype html><html><body>Details</body></html>",
        },
      ],
    });

    const frames = mocks.getDesignData().canvasFrames as Record<
      string,
      { x: number }
    >;
    expect(frames[result.savedFiles[0]!.id]?.x).toBe(1440 + 96);
  });

  it("does not count JSX support files as responsive screen occupancy", async () => {
    mocks.setFileRows([
      {
        id: "support",
        designId: "design-1",
        filename: "support.jsx",
        fileType: "jsx",
        content: "export default function Support() {}",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    mocks.setDesignData({
      breakpointSet: {
        id: "responsive",
        breakpoints: [{ id: "mobile", label: "Mobile", widthPx: 390 }],
      },
      canvasFrames: {
        support: { x: 0, y: 0, width: 1440, height: 100 },
      },
    });

    const result = await action.run({
      designId: "design-1",
      prompt: "Add a screen",
      files: [
        {
          filename: "next.html",
          fileType: "html",
          content: "<!doctype html><html><body>Next</body></html>",
        },
      ],
    });

    const frames = mocks.getDesignData().canvasFrames as Record<
      string,
      { x: number }
    >;
    expect(frames[result.savedFiles[0]!.id]?.x).toBe(1440 + 96);
  });

  it("uses responsive bounds for existing screens without metadata", async () => {
    setExistingFile("<html><body>existing</body></html>");
    mocks.setDesignData({
      breakpointSet: {
        id: "responsive",
        breakpoints: [{ id: "tablet", label: "Tablet", widthPx: 768 }],
      },
      canvasFrames: {
        "file-1": { x: 0, y: 0, width: 1440, height: 900 },
      },
    });

    const result = await action.run({
      designId: "design-1",
      prompt: "Add another screen",
      files: [
        {
          filename: "details.html",
          fileType: "html",
          content: "<!doctype html><html><body>Details</body></html>",
        },
      ],
    });

    const frames = mocks.getDesignData().canvasFrames as Record<
      string,
      { x: number }
    >;
    expect(frames[result.savedFiles[0]!.id]?.x).toBeGreaterThan(1440 + 96);
  });

  it("reserves the final responsive footprint when an existing frame is resized", async () => {
    mocks.setFileRows([
      {
        id: "file-1",
        designId: "design-1",
        filename: "index.html",
        fileType: "html",
        content: "<html><body>old</body></html>",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    mocks.setDesignData({
      screenMetadata: {
        "file-1": { width: 1280, height: 800 },
      },
      canvasFrames: {
        "file-1": { x: 0, y: 0, width: 390, height: 844 },
      },
    });

    const result = await action.run({
      designId: "design-1",
      prompt: "Regenerate this responsive flow",
      devices: ["desktop", "mobile"],
      files: [
        {
          filename: "index.html",
          fileType: "html",
          content: "<html><body>updated</body></html>",
        },
        {
          filename: "details.html",
          fileType: "html",
          content: "<html><body>details</body></html>",
        },
      ],
    });

    const frames = mocks.getDesignData().canvasFrames as Record<
      string,
      { x: number; width: number; height: number }
    >;
    const newFile = result.savedFiles.find(
      (file) => file.filename === "details.html",
    );
    expect(newFile).toBeDefined();
    expect(frames["file-1"]).toMatchObject({ width: 1440, height: 900 });
    expect(frames[newFile!.id]?.x).toBeCloseTo(1440 + 24 + 390 + 96);
    const metadata = mocks.getDesignData().screenMetadata as Record<
      string,
      { width: number; height: number }
    >;
    expect(metadata["file-1"]).toMatchObject({ width: 1440, height: 900 });
  });

  it("reserves rotated breakpoints around the primary after an aspect-changing regeneration", async () => {
    setExistingFile("<html><body>old</body></html>");
    mocks.setDesignData({
      screenMetadata: {
        "file-1": {
          width: 1440,
          height: 900,
          breakpointHeights: { "390": 2200 },
        },
      },
      canvasFrames: {
        "file-1": {
          x: 0,
          y: 0,
          width: 1440,
          height: 900,
          rotation: -90,
        },
      },
    });

    const result = await action.run({
      designId: "design-1",
      prompt: "Regenerate for tablet and mobile",
      devices: ["tablet", "mobile"],
      files: [
        {
          filename: "index.html",
          fileType: "html",
          content: "<html><body>updated</body></html>",
        },
        {
          filename: "details.html",
          fileType: "html",
          content: "<html><body>details</body></html>",
        },
      ],
    });

    const frames = mocks.getDesignData().canvasFrames as Record<
      string,
      { x: number; width: number; height: number; rotation?: number }
    >;
    const newFile = result.savedFiles.find(
      (file) => file.filename === "details.html",
    );
    expect(newFile).toBeDefined();
    expect(frames["file-1"]).toMatchObject({
      width: 768,
      height: 1024,
      rotation: -90,
    });
    expect(frames[newFile!.id]?.x).toBeCloseTo(2072 + 96);
  });
});

describe("generate-design: single-device regen clears stale breakpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.seededCollabText.clear();
    mocks.setFileRows([]);
    mocks.setDesignRows([{ id: "design-1", data: null }]);
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.fileUpdateChain.where.mockResolvedValue({ rowsAffected: 1 });
    mocks.designUpdateChain.where.mockResolvedValue(undefined);
    resetDesignDataMutation();
  });

  const responsiveData = () => ({
    breakpointSet: {
      id: "old",
      breakpoints: [{ id: "m", label: "Mobile", widthPx: 390 }],
    },
  });
  const oneFile = [
    {
      filename: "index.html",
      fileType: "html",
      content: "<!doctype html><html><body>x</body></html>",
    },
  ];

  it("removes an existing breakpointSet on an explicit single-device request", async () => {
    mocks.setDesignData(responsiveData());
    await action.run({
      designId: "design-1",
      prompt: "Make it desktop only",
      devices: ["desktop"],
      files: oneFile,
    });
    expect(mocks.getDesignData().breakpointSet).toBeUndefined();
  });

  it("keeps the breakpointSet when devices is not explicitly narrowed", async () => {
    mocks.setDesignData(responsiveData());
    await action.run({
      designId: "design-1",
      prompt: "Tweak the copy",
      files: oneFile,
    });
    expect(mocks.getDesignData().breakpointSet).toBeDefined();
  });

  it("does not overwrite a malformed breakpointSet when seeding generated-responsive breakpoints", async () => {
    mocks.setDesignData({
      breakpointSet: {
        id: "broken",
        breakpoints: "not-an-array",
      },
    });

    await action.run({
      designId: "design-1",
      prompt: "Seed responsive screens",
      files: oneFile,
    });

    expect(mocks.getDesignData().breakpointSet).toEqual({
      id: "broken",
      breakpoints: "not-an-array",
    });
  });

  it("does not overwrite a breakpointSet object with no breakpoint array", async () => {
    mocks.setDesignData({
      breakpointSet: { id: "broken" },
    });

    await action.run({
      designId: "design-1",
      prompt: "Seed responsive screens",
      files: oneFile,
    });

    expect(mocks.getDesignData().breakpointSet).toEqual({ id: "broken" });
  });
});

describe("generate-design: placement clears rotated existing frames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.seededCollabText.clear();
    mocks.setFileRows([]);
    mocks.setDesignRows([{ id: "design-1", data: null }]);
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.fileUpdateChain.where.mockResolvedValue({ rowsAffected: 1 });
    mocks.designUpdateChain.where.mockResolvedValue(undefined);
    resetDesignDataMutation();
  });

  it("relocates a new screen clear of a rotated frame's real footprint", async () => {
    mocks.setDesignData({
      canvasFrames: {
        "file-1": {
          x: 0,
          y: 1000,
          width: 1440,
          height: 100,
          rotation: 90,
          z: 0,
        },
      },
    });
    await action.run({
      designId: "design-1",
      prompt: "Add a screen",
      files: [
        {
          filename: "b.html",
          fileType: "html",
          content: "<!doctype html><html><body>b</body></html>",
        },
      ],
      canvasFrames: [
        { filename: "b.html", x: 0, y: 0, width: 1440, height: 900 },
      ],
    });
    const frames = mocks.getDesignData().canvasFrames as Record<
      string,
      { x: number; width: number }
    >;
    const placed = Object.entries(frames).find(([id]) => id !== "file-1")![1];
    expect(placed.x).toBeGreaterThanOrEqual(770);
  });
});

describe("generate-design: explicit device requests reconcile breakpoints & rotated placement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.seededCollabText.clear();
    mocks.setFileRows([]);
    mocks.setDesignRows([{ id: "design-1", data: null }]);
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.fileUpdateChain.where.mockResolvedValue({ rowsAffected: 1 });
    mocks.designUpdateChain.where.mockResolvedValue(undefined);
    resetDesignDataMutation();
  });

  const oneFile = [
    {
      filename: "index.html",
      fileType: "html",
      content: "<!doctype html><html><body>x</body></html>",
    },
  ];

  it("replaces a stale set when an explicit multi-device request adds a device", async () => {
    mocks.setDesignData({
      breakpointSet: {
        id: "old",
        breakpoints: [{ id: "m", label: "Mobile", widthPx: 390 }],
      },
    });
    await action.run({
      designId: "design-1",
      prompt: "Make it responsive across devices",
      devices: ["mobile", "tablet", "desktop"],
      files: oneFile,
    });
    const set = mocks.getDesignData().breakpointSet as {
      breakpoints: Array<{ widthPx: number }>;
    };
    expect(set.breakpoints.map((b) => b.widthPx).sort((a, b) => a - b)).toEqual(
      [390, 768],
    );
  });

  it("relocates a new ROTATED screen whose rotated footprint overlaps", async () => {
    mocks.setDesignData({
      canvasFrames: {
        "file-1": { x: 0, y: 0, width: 1440, height: 900, z: 0 },
      },
    });
    await action.run({
      designId: "design-1",
      prompt: "Add a rotated screen",
      files: [
        {
          filename: "b.html",
          fileType: "html",
          content: "<!doctype html><html><body>b</body></html>",
        },
      ],
      canvasFrames: [
        {
          filename: "b.html",
          x: 1450,
          y: 0,
          width: 200,
          height: 200,
          rotation: 45,
        },
      ],
    });
    const frames = mocks.getDesignData().canvasFrames as Record<
      string,
      { x: number }
    >;
    const placed = Object.entries(frames).find(([id]) => id !== "file-1")![1];
    expect(placed.x).not.toBe(1450);
  });

  it("advances a rotated responsive screen until its AABB clears the layout", async () => {
    setExistingFile("<html><body>existing</body></html>");
    mocks.setDesignData({
      breakpointSet: {
        id: "responsive",
        breakpoints: [{ id: "mobile", label: "Mobile", widthPx: 390 }],
      },
      screenMetadata: {
        "file-1": { width: 1440, height: 900 },
      },
      canvasFrames: {
        "file-1": { x: 0, y: 0, width: 1440, height: 900, z: 0 },
      },
    });

    await action.run({
      designId: "design-1",
      prompt: "Add a rotated responsive screen",
      files: [
        {
          filename: "rotated.html",
          fileType: "html",
          content: "<!doctype html><html><body>Rotated</body></html>",
        },
      ],
      canvasFrames: [
        {
          filename: "rotated.html",
          x: 1450,
          y: 0,
          width: 200,
          height: 200,
          rotation: 90,
        },
      ],
    });

    const frames = mocks.getDesignData().canvasFrames as Record<
      string,
      { x: number }
    >;
    const placed = Object.entries(frames).find(([id]) => id !== "file-1")![1];
    expect(placed.x).toBeCloseTo(2140);
  });
});

describe("generate-design: explicit device request resizes an existing frame", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.seededCollabText.clear();
    mocks.setFileRows([]);
    mocks.setDesignRows([{ id: "design-1", data: null }]);
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.fileUpdateChain.where.mockResolvedValue({ rowsAffected: 1 });
    mocks.designUpdateChain.where.mockResolvedValue(undefined);
    resetDesignDataMutation();
  });

  it("resizes a persisted desktop frame to mobile (keeping position) on devices:[mobile]", async () => {
    setExistingFile("<html><body>old</body></html>");
    mocks.setDesignData({
      screenMetadata: {
        "file-1": { width: 1440, height: 900 },
      },
      canvasFrames: {
        "file-1": { x: 300, y: 120, width: 1440, height: 900, z: 0 },
      },
    });
    await action.run({
      designId: "design-1",
      prompt: "Make this a mobile screen",
      devices: ["mobile"],
      files: [
        {
          filename: "index.html",
          fileType: "html",
          content: "<!doctype html><html><body>x</body></html>",
        },
      ],
    });
    const frame = (
      mocks.getDesignData().canvasFrames as Record<
        string,
        { x: number; y: number; width: number; height: number }
      >
    )["file-1"];
    expect(frame).toMatchObject({ x: 300, y: 120, width: 390, height: 844 });
    const metadata = mocks.getDesignData().screenMetadata as Record<
      string,
      { width: number; height: number }
    >;
    expect(metadata["file-1"]).toMatchObject({ width: 390, height: 844 });
  });
});
