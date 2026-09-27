import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const localDb = vi.hoisted(() => ({
  pglite: null as null | {
    query(
      sql: string,
      args?: unknown[],
    ): Promise<{ rows: Array<Record<string, unknown>> }>;
    close(): Promise<void>;
  },
}));

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  commitReceipts: vi.fn(),
  uploadImageRun: vi.fn(),
  listAppState: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(),
  currentAccess: vi.fn(() => ({})),
  assertAccess: vi.fn(async (_type: string, id: string) => {
    const result = await localDb.pglite!.query(
      "SELECT id, data FROM designs WHERE id = $1",
      [id],
    );
    return { role: "editor", resource: result.rows[0] };
  }),
}));

vi.mock("@agent-native/core/org", () => ({
  isMissingOrganizationTableError: vi.fn(() => false),
  orgMembers: {},
}));

vi.mock("@agent-native/core/collab", () => ({
  applyText: vi.fn(),
  hasCollabState: vi.fn(async () => false),
  seedFromText: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  listAppState: mocks.listAppState,
  readAppStateForCurrentTab: vi.fn(async () => null),
}));

vi.mock("@agent-native/core/file-upload/actions/upload-image", () => ({
  default: { run: mocks.uploadImageRun },
  commitUploadReceiptsForImport: mocks.commitReceipts,
  UPLOAD_RECEIPT_PREFIX: "file-upload-receipt:",
}));

vi.mock("../server/lib/design-versions.js", () => ({
  snapshotDesignBeforeAgentEdit: mocks.snapshot,
  snapshotDesignBeforeAgentEditInVersionLock: vi.fn(),
  withDesignVersionLock: (_id: string, work: () => Promise<unknown>) => work(),
  checkpointSkippedResultField: (result: unknown) =>
    result && typeof result === "object" && "skipped" in result
      ? { checkpoint: result }
      : {},
}));

vi.mock("../server/db/index.js", async () => {
  const [{ drizzle }, pgCore, { createRequire }] = await Promise.all([
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pg-core"),
    import("node:module"),
  ]);
  const { PGlite } = createRequire(
    new URL("../../../packages/core/package.json", import.meta.url),
  )("@electric-sql/pglite");
  const designs = pgCore.pgTable("designs", {
    id: pgCore.text("id").primaryKey(),
    data: pgCore.text("data").notNull(),
    updatedAt: pgCore.text("updated_at"),
  });
  const designFiles = pgCore.pgTable("design_files", {
    id: pgCore.text("id").primaryKey(),
    designId: pgCore.text("design_id").notNull(),
    filename: pgCore.text("filename").notNull(),
    content: pgCore.text("content").notNull(),
    fileType: pgCore.text("file_type").notNull(),
    contentOperationSource: pgCore.text("content_operation_source"),
    contentOperationRevision: pgCore.integer("content_operation_revision"),
    contentOperationResultHash: pgCore.text("content_operation_result_hash"),
    createdAt: pgCore.text("created_at"),
    updatedAt: pgCore.text("updated_at"),
  });
  const pglite = await PGlite.create("memory://");
  await pglite.query(
    "CREATE TABLE designs (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT)",
  );
  await pglite.query(
    "CREATE TABLE design_files (id TEXT PRIMARY KEY, design_id TEXT NOT NULL, filename TEXT NOT NULL, content TEXT NOT NULL, file_type TEXT NOT NULL, content_operation_source TEXT, content_operation_revision INTEGER, content_operation_result_hash TEXT, created_at TEXT, updated_at TEXT)",
  );
  await pglite.query(
    "CREATE UNIQUE INDEX design_files_design_operation_source_unique_idx ON design_files (design_id, content_operation_source) WHERE content_operation_source LIKE 'fig-import:%'",
  );
  localDb.pglite = pglite;
  return {
    getDb: () => drizzle(pglite, { schema: { designs, designFiles } }),
    schema: { designs, designFiles, designShares: {} },
  };
});

import importDesignSource from "./import-design-source.js";

const context = { caller: "frontend" as const, actionName: "import" };

function frame(batch: string, index: number, x: number, y: number) {
  return {
    content: `<main>Frame ${index}</main>`,
    originalName: `frame-${index}.html`,
    frameTitle: `Frame ${index}`,
    frameWidth: 200,
    frameHeight: 300,
    frameX: x,
    frameY: y,
    clientImportId: `${batch}:frame:${index}`,
  };
}

async function designData(): Promise<{
  canvasFrames: Record<string, { x: number; y: number }>;
  screenMetadata: Record<string, unknown>;
}> {
  const result = await localDb.pglite!.query(
    "SELECT data FROM designs WHERE id = 'design-1'",
  );
  return JSON.parse(result.rows[0]!.data as string);
}

async function fileIds(): Promise<string[]> {
  const result = await localDb.pglite!.query(
    "SELECT id FROM design_files ORDER BY id",
  );
  return result.rows.map((row) => row.id as string);
}

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.listAppState.mockResolvedValue([]);
  await localDb.pglite!.query("DELETE FROM design_files");
  await localDb.pglite!.query("DELETE FROM designs");
  await localDb.pglite!.query(
    "INSERT INTO designs (id, data, updated_at) VALUES ('design-1', $1, '2026-07-09T00:00:00.000Z')",
    [
      JSON.stringify({
        canvasFrames: {
          existing: { x: 0, y: 0, width: 400, height: 300, z: 0 },
        },
      }),
    ],
  );
  await localDb.pglite!.query(
    "INSERT INTO design_files (id, design_id, filename, content, file_type) VALUES ('existing', 'design-1', 'existing.html', '<main>Existing</main>', 'html')",
  );
});

afterAll(async () => {
  await localDb.pglite?.close();
});

describe("import-design-source fig-frame batches", () => {
  it("saves batches in input order with one checkpoint and one origin", async () => {
    const first = await importDesignSource.run(
      {
        designId: "design-1",
        sourceType: "fig-frame",
        clientImportBatchId: "run-1",
        frames: [frame("run-1", 1, 300, 0), frame("run-1", 0, 0, 400)],
      },
      context,
    );
    const second = await importDesignSource.run(
      {
        designId: "design-1",
        sourceType: "fig-frame",
        clientImportBatchId: "run-1",
        clientImportFinalBatch: true,
        frames: [frame("run-1", 2, 600, 0)],
      },
      context,
    );

    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
    expect(mocks.commitReceipts).toHaveBeenCalledTimes(1);
    expect(mocks.commitReceipts).toHaveBeenCalledWith("run-1");
    expect(first.files.map((file) => file.filename)).toEqual([
      "frame-1.html",
      "frame-0.html",
    ]);
    const [one, zero] = first.files;
    const [two] = second.files;
    const { canvasFrames } = await designData();
    expect(canvasFrames[zero!.id]).toMatchObject({ x: 496, y: 400 });
    expect(canvasFrames[one!.id]).toMatchObject({ x: 796, y: 0 });
    expect(canvasFrames[two!.id]).toMatchObject({ x: 1096, y: 0 });
  });

  it("keeps the origin after a landed frame is edited and a screen is added", async () => {
    const first = await importDesignSource.run(
      {
        designId: "design-1",
        sourceType: "fig-frame",
        clientImportBatchId: "run-1",
        frames: [frame("run-1", 0, 0, 0), frame("run-1", 1, 300, 0)],
      },
      context,
    );
    await localDb.pglite!.query(
      "UPDATE design_files SET content_operation_source = NULL WHERE id = $1",
      [first.files[1]!.id],
    );
    const data = await designData();
    data.canvasFrames.added = { x: 5000, y: 0 };
    await localDb.pglite!.query(
      "UPDATE designs SET data = $1 WHERE id = 'design-1'",
      [JSON.stringify(data)],
    );
    await localDb.pglite!.query(
      "INSERT INTO design_files (id, design_id, filename, content, file_type) VALUES ('added', 'design-1', 'added.html', '<main>Added</main>', 'html')",
    );

    const second = await importDesignSource.run(
      {
        designId: "design-1",
        sourceType: "fig-frame",
        clientImportBatchId: "run-1",
        clientImportFinalBatch: true,
        frames: [frame("run-1", 2, 600, 0)],
      },
      context,
    );

    const { canvasFrames } = await designData();
    expect(canvasFrames[first.files[0]!.id]).toMatchObject({ x: 496 });
    expect(canvasFrames[second.files[0]!.id]).toMatchObject({ x: 1096 });
  });

  it("returns frames that already landed instead of duplicating them", async () => {
    const input = {
      designId: "design-1",
      sourceType: "fig-frame" as const,
      clientImportBatchId: "run-2",
      frames: [frame("run-2", 0, 0, 0), frame("run-2", 1, 300, 0)],
    };
    const first = await importDesignSource.run(input, context);
    const before = await designData();
    const retry = await importDesignSource.run(
      { ...input, frames: [...input.frames, frame("run-2", 2, 600, 0)] },
      context,
    );

    expect(retry.files.slice(0, 2)).toEqual(first.files);
    expect(await fileIds()).toHaveLength(4);
    const after = await designData();
    expect(after.canvasFrames[first.files[0]!.id]).toEqual(
      before.canvasFrames[first.files[0]!.id],
    );
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
  });

  it("aborts every file of the batch and its canvas metadata, idempotently", async () => {
    await importDesignSource.run(
      {
        designId: "design-1",
        sourceType: "fig-frame",
        clientImportBatchId: "run-3",
        frames: [frame("run-3", 0, 0, 0), frame("run-3", 1, 300, 0)],
      },
      context,
    );
    mocks.listAppState.mockResolvedValue([
      { key: "file-upload-receipt:run-3:image-1.png", value: {} },
    ]);

    const aborted = await importDesignSource.run(
      {
        designId: "design-1",
        sourceType: "fig-frame",
        clientImportBatchId: "run-3",
        abort: true,
      },
      context,
    );

    expect(aborted.deletedFileIds).toHaveLength(2);
    expect(await fileIds()).toEqual(["existing"]);
    const data = await designData();
    expect(Object.keys(data.canvasFrames)).toEqual(["existing"]);
    expect(Object.keys(data.screenMetadata)).toEqual([]);
    expect(mocks.uploadImageRun).toHaveBeenCalledWith({
      idempotencyKey: "run-3:image-1.png",
      cleanup: "delete",
    });

    const again = await importDesignSource.run(
      {
        designId: "design-1",
        sourceType: "fig-frame",
        clientImportBatchId: "run-3",
        abort: true,
      },
      context,
    );
    expect(again.deletedFileIds).toEqual([]);
  });

  it("keeps the single-frame agent input working", async () => {
    const result = await importDesignSource.run(
      {
        designId: "design-1",
        sourceType: "fig-frame",
        content: "<main>Solo</main>",
        originalName: "solo.html",
      },
      context,
    );

    expect(result.files).toHaveLength(1);
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
    expect(await fileIds()).toHaveLength(2);
  });

  it("returns a retried lone frame by its own marker", async () => {
    const input = {
      designId: "design-1",
      sourceType: "fig-frame" as const,
      content: "<main>Solo</main>",
      clientImportId: "solo:frame:0",
    };
    const first = await importDesignSource.run(input, context);
    const retry = await importDesignSource.run(input, context);

    expect(retry.files).toEqual(first.files);
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
    expect(await fileIds()).toHaveLength(2);
  });

  it("rejects frames that do not belong to the batch", async () => {
    await expect(
      importDesignSource.run(
        {
          designId: "design-1",
          sourceType: "fig-frame",
          clientImportBatchId: "run-4",
          frames: [frame("other", 0, 0, 0)],
        },
        context,
      ),
    ).rejects.toThrow(/must start with "run-4:"/);
    expect(await fileIds()).toEqual(["existing"]);
  });
});
