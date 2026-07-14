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
  fileUpdateChain.where.mockResolvedValue({ rowsAffected: 1 });

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
    and: vi.fn((...conditions) => ({ conditions })),
    eq: vi.fn((left, right) => ({ left, right })),
    isNull: vi.fn((value) => ({ isNull: value })),
    readAppState: vi.fn().mockResolvedValue(null),
    writeAppState: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  eq: mocks.eq,
  isNull: mocks.isNull,
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

describe("generate-design: canvasFrames duplicate-target rejection", () => {
  // mergeCanvasFramePlacements folds two placements for the same target into
  // one canvasFrames[fileId] value (last one wins), but the mutateDesignData
  // isApplied check verifies EVERY placedFrames entry against that single
  // folded value, so the earlier (now-overwritten) entry always mismatches.
  // Since the mutate callback is deterministic, every retry recomputes the
  // same mismatch, so the action would always fail with a "concurrent write
  // conflicts" error after burning through every retry. Reject the malformed
  // input up front instead.
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
    mocks.setDesignRows([{ id: "design-1", data: null }]);
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

  // generate-screens' own tool description recommends fanning out parallel
  // generate-design calls per returned frame. Both calls read-modify-write
  // the same design-generation-session:<designId> application-state key with
  // no CAS/versioning primitive available, so without in-process
  // serialization, whichever write lands second silently discards the first
  // call's frame-done update (classic lost-update race). Artificial delays on
  // the mocked readAppState/writeAppState make the race deterministic: without
  // the lock, both reads land on the same pre-update session before either
  // write commits.
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

describe("generate-design: new-file creation path (unchanged)", () => {
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
      height: 1024,
    });
    expect(data.breakpointSet).toMatchObject({
      breakpoints: [
        expect.objectContaining({ label: "Mobile", widthPx: 390 }),
        expect.objectContaining({ label: "Tablet", widthPx: 768 }),
        expect.objectContaining({ label: "Desktop", widthPx: 1440 }),
      ],
    });
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
});
