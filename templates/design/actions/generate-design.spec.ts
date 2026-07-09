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
  // `where()` must behave both as a directly-awaited result (this action's
  // own existingFiles/select lookups) AND as a chain that supports a
  // trailing `.limit(1)` (writeInlineSourceFile's internal re-select in
  // server/source-workspace.ts, now used by the existing-file update path).
  // Returning a real Promise with an extra `.limit()` method attached covers
  // both call shapes with the same mocked resolved rows.
  function makeWhereResult(rows: unknown[]) {
    const promise = Promise.resolve(rows) as Promise<unknown[]> & {
      limit: (n: number) => Promise<unknown[]>;
    };
    promise.limit = vi.fn().mockResolvedValue(rows);
    return promise;
  }

  // Backing rows for the design's files. The action's own lookup filters by
  // designId only (the fake `eq` doesn't narrow further in that shape);
  // writeInlineSourceFile's internal re-select filters by a single file id
  // (`eq(designFiles.id, file.id)`), which this fake `where` recognizes by
  // predicate shape and narrows to.
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

  // select() is called with either no args (designFiles lookups) or a
  // projection object (the tx.select({ data: ... }) design-data read).
  // Dispatch on whether a projection was requested to the right chain.
  const select = vi.fn((projection?: Record<string, unknown>) => {
    if (projection && "data" in projection) return designSelectChain;
    return fileSelectChain;
  });

  const insert = vi.fn(() => ({
    values: vi.fn().mockResolvedValue(undefined),
  }));

  const fileUpdateChain = { set: vi.fn(), where: vi.fn() };
  fileUpdateChain.set.mockReturnValue(fileUpdateChain);
  fileUpdateChain.where.mockResolvedValue(undefined);

  const designUpdateChain = { set: vi.fn(), where: vi.fn() };
  designUpdateChain.set.mockReturnValue(designUpdateChain);
  designUpdateChain.where.mockResolvedValue(undefined);

  const update = vi.fn((table: unknown) => {
    if (table === schemaRef.designs) return designUpdateChain;
    return fileUpdateChain;
  });

  // Populated after the db.mock schema object is constructed below (needed
  // so `update()` can dispatch by table identity).
  const schemaRef: { designFiles?: unknown; designs?: unknown } = {};

  const tx = {
    select,
    update,
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

  // Shared with the @agent-native/core/collab mock below: writeInlineSourceFile
  // (used by the existing-file update path) re-reads getText() right after
  // seedFromText/applyText to persist the "authoritative" collab content back
  // to SQL, so seedFromText must actually store what getText reads back.
  // Cleared per-test in beforeEach (the vi.mock factory only runs once per
  // file, so without an explicit reset this map would leak across tests).
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
    eq: vi.fn((left, right) => ({ left, right })),
    readAppState: vi.fn().mockResolvedValue(null),
    writeAppState: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  eq: mocks.eq,
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: mocks.readAppState,
  writeAppState: mocks.writeAppState,
}));

vi.mock("@agent-native/core/collab", () => {
  const seeded = mocks.seededCollabText;
  return {
    hasCollabState: vi.fn(async (docId: string) => seeded.has(docId)),
    getText: vi.fn(async (docId: string) => seeded.get(docId) ?? ""),
    applyText: vi.fn(async (docId: string, text: string) => {
      seeded.set(docId, text);
      return text;
    }),
    seedFromText: vi.fn(async (docId: string, text: string) => {
      if (!seeded.has(docId)) seeded.set(docId, text);
    }),
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

describe("generate-design: existing-file update path (hash-guarded write)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.seededCollabText.clear();
    mocks.setFileRows([]);
    mocks.setDesignRows([{ id: "design-1", data: null }]);
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.fileUpdateChain.where.mockResolvedValue(undefined);
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
    // writeInlineSourceFile persists the authoritative collab content via
    // db.update(schema.designFiles).set({ content, updatedAt }). Content is
    // annotated with data-agent-native-node-id before persisting (see
    // shared/screen-annotation.ts), so the saved html/body tags carry stamped
    // ids rather than the byte-exact input string.
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

  it("rejects the update when the live content changed since it was read (concurrent write)", async () => {
    setExistingFile("<html><body>old</body></html>");

    // Simulate a concurrent writer's collab mutation landing in the exact
    // race window this fix closes: AFTER this action's own
    // readLiveSourceFile() call (which establishes expectedVersionHash from
    // the then-current base) but BEFORE writeInlineSourceFile's internal
    // re-check. hasCollabState() flips true and getText() returns the
    // concurrent content on the FIRST read (inside the action's own
    // readLiveSourceFile) so the captured expectedVersionHash reflects the
    // pre-race base; a second, different value on the SECOND read (inside
    // writeInlineSourceFile) simulates the concurrent write having landed in
    // between, so writeInlineSourceFile's own hash re-check must reject it.
    const collab = await import("@agent-native/core/collab");
    let hasCollabCalls = 0;
    (collab.hasCollabState as any).mockImplementation(async () => {
      hasCollabCalls += 1;
      return hasCollabCalls > 0; // collab doc already exists from the start
    });
    let getTextCalls = 0;
    (collab.getText as any).mockImplementation(async () => {
      getTextCalls += 1;
      // First call: the action's pre-write read (establishes the base hash).
      // Second call: writeInlineSourceFile's internal re-check, after a
      // concurrent write has landed.
      return getTextCalls === 1
        ? "<html><body>old</body></html>"
        : "<html><body>concurrent-edit</body></html>";
    });

    await expect(
      action.run({
        designId: "design-1",
        prompt: "Update copy",
        files: [
          {
            filename: "index.html",
            fileType: "html",
            content: "<html><body>stale-generated</body></html>",
          },
        ],
      }),
    ).rejects.toThrow(/changed since it was read/);

    // Must fail loud: the stale content must never be persisted.
    expect(mocks.fileUpdateChain.set).not.toHaveBeenCalled();
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
});

describe("generate-design: new-file creation path (unchanged)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.seededCollabText.clear();
    mocks.setFileRows([]);
    mocks.setDesignRows([{ id: "design-1", data: null }]);
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.fileUpdateChain.where.mockResolvedValue(undefined);
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
    // The new-file path seeds collab state directly; it must not go through
    // the update path's db.update(designFiles) content write.
    expect(mocks.fileUpdateChain.set).not.toHaveBeenCalled();
    // Content is annotated with data-agent-native-node-id before persisting
    // (see shared/screen-annotation.ts) so the new screen is fully
    // addressable by id-keyed editor operations immediately, instead of the
    // byte-exact unannotated input string.
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
});
