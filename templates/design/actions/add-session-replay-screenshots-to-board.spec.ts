import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  createDesign: vi.fn(),
  deleteDesign: vi.fn(),
  deleteVisualEditSnapshotBlobs: vi.fn(),
  deletePrivateBlob: vi.fn(),
  generatedId: 0,
  getDb: vi.fn(),
  isPrivateBlobConfiguredForRequest: vi.fn(),
  getRequestUserEmail: vi.fn(),
  migrateBoardObjectsToFile: vi.fn(),
  putPrivateBlob: vi.fn(),
  queueVisualEditSnapshotBlobCleanup: vi.fn(),
  queueVisualEditSnapshotBlobCleanupInTransaction: vi.fn(),
  readLiveSourceFile: vi.fn(),
  resolveAttachment: vi.fn(),
  withDesignSourceMutationTransaction: vi.fn(),
  writeInlineSourceFile: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (action: unknown) => action,
  ActionContractError: class ActionContractError extends Error {
    readonly actionContractError = true;
    readonly errorCode: string;
    readonly statusCode: number;
    readonly details?: Record<string, unknown>;

    constructor(
      message: string,
      options: {
        errorCode: string;
        statusCode?: number;
        details?: Record<string, unknown>;
      },
    ) {
      super(message);
      this.errorCode = options.errorCode;
      this.statusCode = options.statusCode ?? 409;
      this.details = options.details;
    }
  },
  isActionContractError: (error: unknown) =>
    Boolean(
      error &&
      typeof error === "object" &&
      (error as { actionContractError?: unknown }).actionContractError ===
        true &&
      typeof (error as { errorCode?: unknown }).errorCode === "string",
    ),
  fail: (message: string) => {
    throw new Error(message);
  },
}));

vi.mock("@agent-native/core/private-blob", () => ({
  ATTACHMENT_REF_MAX_CHARS: 1_024,
  deletePrivateBlob: mocks.deletePrivateBlob,
  isPrivateBlobConfiguredForRequest: mocks.isPrivateBlobConfiguredForRequest,
  putPrivateBlob: mocks.putPrivateBlob,
  resolveAttachment: mocks.resolveAttachment,
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(() => "https://design.example.test/board"),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    and: vi.fn((...conditions) => ({ conditions })),
    eq: vi.fn((left, right) => ({ left, right })),
    inArray: vi.fn((left, right) => ({ left, right })),
  };
});

vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => `generated-${++mocks.generatedId}`),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: mocks.getDb,
  schema: {
    designBoardReplayScreenshots: {
      blobHandle: "screenshots.blobHandle",
      designId: "screenshots.designId",
      id: "screenshots.id",
    },
    designs: { id: "designs.id" },
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      fileType: "designFiles.fileType",
      content: "designFiles.content",
      createdAt: "designFiles.createdAt",
      updatedAt: "designFiles.updatedAt",
    },
  },
}));

vi.mock("../server/lib/visual-edit-snapshot-blobs.js", () => ({
  deleteVisualEditSnapshotBlobs: mocks.deleteVisualEditSnapshotBlobs,
  queueVisualEditSnapshotBlobCleanup: mocks.queueVisualEditSnapshotBlobCleanup,
  queueVisualEditSnapshotBlobCleanupInTransaction:
    mocks.queueVisualEditSnapshotBlobCleanupInTransaction,
}));

vi.mock("../server/source-workspace.js", () => ({
  readLiveSourceFile: mocks.readLiveSourceFile,
  withDesignSourceMutationTransaction:
    mocks.withDesignSourceMutationTransaction,
  writeInlineSourceFile: mocks.writeInlineSourceFile,
}));

vi.mock("../shared/board-file.js", () => ({ BOARD_FILENAME: "index.html" }));
vi.mock("./create-design.js", () => ({ default: { run: mocks.createDesign } }));
vi.mock("./delete-design.js", () => ({ default: { run: mocks.deleteDesign } }));
vi.mock("./migrate-board-objects-to-file.js", () => ({
  default: { run: mocks.migrateBoardObjectsToFile },
}));

import action from "./add-session-replay-screenshots-to-board.js";

function selectChain(rows: unknown[] = []) {
  const resultRows = [...rows];
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    for: vi.fn(async () => resultRows),
    limit: vi.fn(async () => resultRows),
    then: (
      resolve: (value: unknown[]) => unknown,
      reject: (error: unknown) => unknown,
    ) => Promise.resolve(resultRows).then(resolve, reject),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  return chain;
}

describe("add-session-replay-screenshots-to-board cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generatedId = 0;
    mocks.getRequestUserEmail.mockReturnValue("designer@example.test");
    mocks.isPrivateBlobConfiguredForRequest.mockResolvedValue(true);
    mocks.resolveAttachment.mockResolvedValue({
      status: "ok",
      file: { data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) },
    });
    mocks.putPrivateBlob.mockResolvedValue({
      id: "blob-id",
      provider: "private-provider",
      opaque: true,
      encrypted: true,
    });
    mocks.deletePrivateBlob.mockResolvedValue({ deleted: true });
    mocks.createDesign.mockImplementation(async ({ id }) => ({ id }));
    mocks.deleteDesign.mockResolvedValue({ id: "design-id", deleted: true });
    mocks.assertAccess.mockResolvedValue({
      role: "editor",
      resource: {
        id: "design-id",
        ownerEmail: "designer@example.test",
        visibility: "private",
        orgId: null,
      },
    });
    mocks.migrateBoardObjectsToFile.mockRejectedValue(
      new Error("board setup failed"),
    );
    mocks.getDb.mockReturnValue({
      select: vi.fn(() => selectChain()),
    });
  });

  it("deletes uploaded blobs when a new Design fails before screenshot metadata is written", async () => {
    const blobHandle = {
      id: "blob-id",
      provider: "private-provider",
      opaque: true,
      encrypted: true,
    };

    await expect(
      action.run(
        {
          screenshots: [
            {
              attachmentRef: "attachment-ref",
              replayId: "replay-id",
              capturedAt: "2026-10-07T12:00:00.000Z",
              app: "clips",
              route: "/library",
              offsetMs: 13_000,
              viewportWidth: 430,
              viewportHeight: 932,
              eventCount: 12,
            },
          ],
        } as never,
        {
          caller: "frontend",
          actionName: "add-session-replay-screenshots-to-board",
        } as never,
      ),
    ).rejects.toThrow("board setup failed");

    expect(mocks.deleteDesign).toHaveBeenCalledWith(
      { id: "generated-1" },
      expect.anything(),
    );
    expect(mocks.deletePrivateBlob).toHaveBeenCalledTimes(1);
    expect(mocks.deletePrivateBlob).toHaveBeenCalledWith(blobHandle);
  });

  it("reports when fallback blob deletion succeeds after queue failure", async () => {
    mocks.deletePrivateBlob
      .mockResolvedValueOnce({ deleted: false })
      .mockResolvedValueOnce({ deleted: true });
    mocks.deleteVisualEditSnapshotBlobs.mockRejectedValueOnce(
      new Error("cleanup queue insert failed"),
    );

    await expect(
      action.run(
        {
          screenshots: [
            {
              attachmentRef: "attachment-ref",
              replayId: "replay-id",
              capturedAt: "2026-10-07T12:00:00.000Z",
              app: "clips",
              route: "/library",
              offsetMs: 13_000,
              viewportWidth: 430,
              viewportHeight: 932,
              eventCount: 12,
            },
          ],
        } as never,
        {
          caller: "frontend",
          actionName: "add-session-replay-screenshots-to-board",
        } as never,
      ),
    ).rejects.toThrow("board setup failed");

    expect(mocks.queueVisualEditSnapshotBlobCleanup).not.toHaveBeenCalled();
  });

  it("durably queues blobs that remain after the cleanup fallback", async () => {
    mocks.deletePrivateBlob
      .mockResolvedValueOnce({ deleted: false })
      .mockResolvedValueOnce({ deleted: false });
    mocks.deleteVisualEditSnapshotBlobs.mockRejectedValueOnce(
      new Error("cleanup queue insert failed"),
    );

    const error = await action
      .run(
        {
          screenshots: [
            {
              attachmentRef: "attachment-ref",
              replayId: "replay-id",
              capturedAt: "2026-10-07T12:00:00.000Z",
              app: "clips",
              route: "/library",
              offsetMs: 13_000,
              viewportWidth: 430,
              viewportHeight: 932,
              eventCount: 12,
            },
          ],
        } as never,
        {
          caller: "frontend",
          actionName: "add-session-replay-screenshots-to-board",
        } as never,
      )
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      actionContractError: true,
      message: "board setup failed",
      details: { cleanupPending: true },
    });
    expect(mocks.queueVisualEditSnapshotBlobCleanup).toHaveBeenCalledWith([
      JSON.stringify({
        id: "blob-id",
        provider: "private-provider",
        opaque: true,
        encrypted: true,
      }),
    ]);
  });

  it("reports private blob cleanup that remains pending after an action failure", async () => {
    mocks.deletePrivateBlob.mockResolvedValueOnce({ deleted: false });
    mocks.deleteVisualEditSnapshotBlobs.mockResolvedValueOnce(true);

    await expect(
      action.run(
        {
          screenshots: [
            {
              attachmentRef: "attachment-ref",
              replayId: "replay-id",
              capturedAt: "2026-10-07T12:00:00.000Z",
              app: "clips",
              route: "/library",
              offsetMs: 13_000,
              viewportWidth: 430,
              viewportHeight: 932,
              eventCount: 12,
            },
          ],
        } as never,
        {
          caller: "frontend",
          actionName: "add-session-replay-screenshots-to-board",
        } as never,
      ),
    ).rejects.toMatchObject({
      actionContractError: true,
      message: "board setup failed",
      details: { cleanupPending: true },
    });
  });

  it("accepts encrypted private upload fallback handles", async () => {
    const fallbackHandle = {
      id: "public-upload:v1:encrypted-descriptor",
      provider: "public-upload:builder-storage",
      opaque: true,
      encrypted: true,
    };
    mocks.putPrivateBlob.mockResolvedValue(fallbackHandle);

    await expect(
      action.run(
        {
          screenshots: [
            {
              attachmentRef: "attachment-ref",
              replayId: "replay-id",
              capturedAt: "2026-10-07T12:00:00.000Z",
              app: "clips",
              route: "/library",
              offsetMs: 13_000,
              viewportWidth: 430,
              viewportHeight: 932,
              eventCount: 12,
            },
          ],
        } as never,
        {
          caller: "frontend",
          actionName: "add-session-replay-screenshots-to-board",
        } as never,
      ),
    ).rejects.toThrow("board setup failed");

    expect(mocks.createDesign).toHaveBeenCalledOnce();
    expect(mocks.deletePrivateBlob).toHaveBeenCalledWith(fallbackHandle);
  });

  it("lays replay screenshots out in compact rows while preserving their viewport ratios", async () => {
    const file = {
      id: "board-file-123",
      designId: "design-id",
      filename: "index.html",
      fileType: "html",
      content: "<html><body></body></html>",
      createdAt: null,
      updatedAt: null,
    };
    const insertValues = vi.fn().mockResolvedValue(undefined);
    mocks.assertAccess.mockResolvedValue({
      role: "editor",
      resource: {
        id: "design-id",
        ownerEmail: "designer@example.test",
        visibility: "private",
        orgId: null,
      },
    });
    mocks.migrateBoardObjectsToFile.mockResolvedValue({
      boardFileId: file.id,
    });
    mocks.getDb.mockReturnValue({
      select: vi.fn(() => selectChain([file])),
      insert: vi.fn(() => ({ values: insertValues })),
    });
    mocks.readLiveSourceFile.mockResolvedValue({
      content: file.content,
      versionHash: "version-before",
    });
    mocks.writeInlineSourceFile.mockResolvedValue({
      versionHash: "version-after",
    });

    const result = await action.run(
      {
        designId: "design-id",
        cohortTotal: 50,
        selectedReplayCount: 1,
        screenshots: [
          {
            attachmentRef: "desktop-ref",
            replayId: "replay-id",
            capturedAt: "2026-10-07T12:00:00.000Z",
            app: "clips",
            route: "/library",
            offsetMs: 1_000,
            viewportWidth: 1536,
            viewportHeight: 864,
            eventCount: 12,
          },
          {
            attachmentRef: "mobile-ref",
            replayId: "replay-id",
            capturedAt: "2026-10-07T12:00:00.000Z",
            app: "clips",
            route: "/record",
            offsetMs: 2_000,
            viewportWidth: 390,
            viewportHeight: 844,
            eventCount: 12,
          },
        ],
      } as never,
      {
        caller: "frontend",
        actionName: "add-session-replay-screenshots-to-board",
      } as never,
    );

    expect(result.summary.screenshotCount).toBe(2);
    expect(insertValues).toHaveBeenCalledOnce();
    const boardContent = mocks.writeInlineSourceFile.mock.calls[0]?.[0]
      ?.content as string;
    expect(boardContent).toContain(
      'data-session-replay-viewport-width="1536" data-session-replay-viewport-height="864"',
    );
    expect(boardContent).toContain('width="360" height="203" loading="lazy"');
    expect(boardContent).toContain(
      'data-session-replay-viewport-width="390" data-session-replay-viewport-height="844"',
    );
    expect(boardContent).toContain(
      "left:420px;top:144px;width:296px;height:640px",
    );
  });

  it("fails before resolving screenshots when private storage is unavailable", async () => {
    mocks.isPrivateBlobConfiguredForRequest.mockResolvedValue(false);

    await expect(
      action.run(
        {
          screenshots: [
            {
              attachmentRef: "attachment-ref",
              replayId: "replay-id",
              capturedAt: "2026-10-07T12:00:00.000Z",
              app: "clips",
              route: "/library",
              offsetMs: 13_000,
              viewportWidth: 430,
              viewportHeight: 932,
              eventCount: 12,
            },
          ],
        } as never,
        {
          caller: "frontend",
          actionName: "add-session-replay-screenshots-to-board",
        } as never,
      ),
    ).rejects.toThrow(
      "Design requires configured private storage for replay screenshots.",
    );

    expect(mocks.resolveAttachment).not.toHaveBeenCalled();
    expect(mocks.putPrivateBlob).not.toHaveBeenCalled();
  });

  it("queues persisted screenshot blobs atomically before draining on an existing Design rollback", async () => {
    const events: string[] = [];
    const metadataRows: Array<Record<string, unknown>> = [];
    const boardFile = {
      id: "board-file",
      designId: "existing-design",
      filename: "index.html",
      fileType: "html",
      content: "<html><body></body></html>",
      createdAt: null,
      updatedAt: null,
    };
    const tx = {
      select: vi.fn(() => selectChain(metadataRows)),
      delete: vi.fn(
        () =>
          ({
            where: vi.fn(async () => {
              events.push("metadata-delete");
              metadataRows.length = 0;
            }),
          }) as never,
      ),
    };
    mocks.withDesignSourceMutationTransaction.mockImplementation(
      async (_designId, callback) => {
        events.push("transaction-start");
        const result = await callback(tx as never);
        events.push("transaction-commit");
        return result;
      },
    );
    mocks.queueVisualEditSnapshotBlobCleanupInTransaction.mockImplementation(
      async (_tx, handles) => {
        events.push("queue-handles");
        expect(handles).toEqual([
          JSON.stringify({
            id: "blob-id",
            provider: "private-provider",
            opaque: true,
            encrypted: true,
          }),
        ]);
      },
    );
    mocks.deleteVisualEditSnapshotBlobs.mockImplementation(async () => {
      events.push("drain-queue");
    });
    mocks.migrateBoardObjectsToFile.mockResolvedValue({
      boardFileId: "board-file",
    });
    mocks.readLiveSourceFile.mockResolvedValue({
      content: "<html><body></body></html>",
      versionHash: "before",
    });
    mocks.writeInlineSourceFile.mockImplementation(async () => {
      events.push("board-write");
      return { versionHash: "after" };
    });
    mocks.getDb.mockReturnValue({
      select: vi.fn(() => selectChain([boardFile])),
      insert: vi.fn(
        () =>
          ({
            values: vi.fn(async (rows: Array<Record<string, unknown>>) => {
              metadataRows.push(...rows);
              events.push("metadata-insert");
              throw new Error("metadata insert failed after persistence");
            }),
          }) as never,
      ),
    });

    await expect(
      action.run(
        {
          designId: "existing-design",
          screenshots: [
            {
              attachmentRef: "attachment-ref",
              replayId: "replay-id",
              capturedAt: "2026-10-07T12:00:00.000Z",
              app: "clips",
              route: "/library",
              offsetMs: 13_000,
              viewportWidth: 430,
              viewportHeight: 932,
              eventCount: 12,
            },
          ],
        } as never,
        {
          caller: "frontend",
          actionName: "add-session-replay-screenshots-to-board",
        } as never,
      ),
    ).rejects.toThrow("metadata insert failed after persistence");

    expect(events).toContain("drain-queue");
    expect(events.indexOf("queue-handles")).toBeLessThan(
      events.indexOf("transaction-commit"),
    );
    expect(events.indexOf("transaction-commit")).toBeLessThan(
      events.indexOf("drain-queue"),
    );
    expect(metadataRows).toHaveLength(0);
    expect(mocks.deletePrivateBlob).not.toHaveBeenCalled();
  });

  it("reports pending blob cleanup when a newly created Design rolls back", async () => {
    const events: string[] = [];
    const metadataRows: Array<Record<string, unknown>> = [];
    const boardFile = {
      id: "board-file",
      designId: "generated-1",
      filename: "index.html",
      fileType: "html",
      content: "<html><body></body></html>",
      createdAt: null,
      updatedAt: null,
    };
    const tx = {
      select: vi.fn(() => selectChain(metadataRows)),
      delete: vi.fn(
        () =>
          ({
            where: vi.fn(async () => {
              metadataRows.length = 0;
            }),
          }) as never,
      ),
    };
    mocks.withDesignSourceMutationTransaction.mockImplementation(
      async (_designId, callback) => {
        const result = await callback(tx as never);
        events.push("transaction-commit");
        return result;
      },
    );
    mocks.queueVisualEditSnapshotBlobCleanupInTransaction.mockImplementation(
      async () => {
        events.push("queue-handles");
      },
    );
    mocks.deleteVisualEditSnapshotBlobs.mockImplementation(async () => {
      events.push("drain-queue");
      return true;
    });
    mocks.migrateBoardObjectsToFile.mockResolvedValue({
      boardFileId: "board-file",
    });
    mocks.readLiveSourceFile.mockResolvedValue({
      content: "<html><body></body></html>",
      versionHash: "before",
    });
    mocks.writeInlineSourceFile.mockResolvedValue({ versionHash: "after" });
    mocks.getDb.mockReturnValue({
      select: vi.fn(() => selectChain([boardFile])),
      insert: vi.fn(
        () =>
          ({
            values: vi.fn(async (rows: Array<Record<string, unknown>>) => {
              metadataRows.push(...rows);
              throw new Error("metadata insert failed after persistence");
            }),
          }) as never,
      ),
    });

    const error = await action
      .run(
        {
          screenshots: [
            {
              attachmentRef: "attachment-ref",
              replayId: "replay-id",
              capturedAt: "2026-10-07T12:00:00.000Z",
              app: "clips",
              route: "/library",
              offsetMs: 13_000,
              viewportWidth: 430,
              viewportHeight: 932,
              eventCount: 12,
            },
          ],
        } as never,
        {
          caller: "frontend",
          actionName: "add-session-replay-screenshots-to-board",
        } as never,
      )
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      actionContractError: true,
      message: "metadata insert failed after persistence",
      details: { cleanupPending: true },
    });
    expect(events.indexOf("queue-handles")).toBeLessThan(
      events.indexOf("transaction-commit"),
    );
    expect(events.indexOf("transaction-commit")).toBeLessThan(
      events.indexOf("drain-queue"),
    );
    expect(mocks.deleteVisualEditSnapshotBlobs).toHaveBeenCalledOnce();
    expect(mocks.deleteDesign).toHaveBeenCalledWith(
      { id: "generated-1" },
      expect.anything(),
    );
  });

  it("queues the blob when a failed metadata insert left no persisted row", async () => {
    const events: string[] = [];
    const boardFile = {
      id: "board-file",
      designId: "existing-design",
      filename: "index.html",
      fileType: "html",
      content: "<html><body></body></html>",
      createdAt: null,
      updatedAt: null,
    };
    const tx = {
      select: vi.fn(() => selectChain()),
      delete: vi.fn(),
    };
    mocks.withDesignSourceMutationTransaction.mockImplementation(
      async (_designId, callback) => {
        events.push("transaction-start");
        const result = await callback(tx as never);
        events.push("transaction-commit");
        return result;
      },
    );
    mocks.queueVisualEditSnapshotBlobCleanupInTransaction.mockImplementation(
      async (_tx, handles) => {
        events.push("queue-handles");
        expect(handles).toEqual([
          JSON.stringify({
            id: "blob-id",
            provider: "private-provider",
            opaque: true,
            encrypted: true,
          }),
        ]);
      },
    );
    mocks.deleteVisualEditSnapshotBlobs.mockImplementation(async () => {
      events.push("drain-queue");
    });
    mocks.migrateBoardObjectsToFile.mockResolvedValue({
      boardFileId: "board-file",
    });
    mocks.readLiveSourceFile.mockResolvedValue({
      content: "<html><body></body></html>",
      versionHash: "before",
    });
    mocks.writeInlineSourceFile.mockResolvedValue({ versionHash: "after" });
    mocks.getDb.mockReturnValue({
      select: vi.fn(() => selectChain([boardFile])),
      insert: vi.fn(
        () =>
          ({
            values: vi.fn(async () => {
              throw new Error("metadata insert failed before persistence");
            }),
          }) as never,
      ),
    });

    await expect(
      action.run(
        {
          designId: "existing-design",
          screenshots: [
            {
              attachmentRef: "attachment-ref",
              replayId: "replay-id",
              capturedAt: "2026-10-07T12:00:00.000Z",
              app: "clips",
              route: "/library",
              offsetMs: 13_000,
              viewportWidth: 430,
              viewportHeight: 932,
              eventCount: 12,
            },
          ],
        } as never,
        {
          caller: "frontend",
          actionName: "add-session-replay-screenshots-to-board",
        } as never,
      ),
    ).rejects.toThrow("metadata insert failed before persistence");

    expect(events.indexOf("queue-handles")).toBeLessThan(
      events.indexOf("transaction-commit"),
    );
    expect(events.indexOf("transaction-commit")).toBeLessThan(
      events.indexOf("drain-queue"),
    );
    expect(
      mocks.queueVisualEditSnapshotBlobCleanupInTransaction,
    ).toHaveBeenCalledOnce();
    expect(mocks.deleteVisualEditSnapshotBlobs).toHaveBeenCalledOnce();
    expect(mocks.deletePrivateBlob).not.toHaveBeenCalled();
  });

  it("retries an ambiguous metadata rollback through the durable queue", async () => {
    const events: string[] = [];
    const metadataRows: Array<Record<string, unknown>> = [];
    const boardFile = {
      id: "board-file",
      designId: "existing-design",
      filename: "index.html",
      fileType: "html",
      content: "<html><body></body></html>",
      createdAt: null,
      updatedAt: null,
    };
    const tx = {
      select: vi.fn(() => selectChain(metadataRows)),
      delete: vi.fn(
        () =>
          ({
            where: vi.fn(async () => {
              events.push("metadata-delete");
              metadataRows.length = 0;
            }),
          }) as never,
      ),
    };
    let transactionCalls = 0;
    mocks.withDesignSourceMutationTransaction.mockImplementation(
      async (_designId, callback) => {
        transactionCalls += 1;
        events.push(`transaction-start-${transactionCalls}`);
        const persistedBeforeTransaction = metadataRows.map((row) => ({
          ...row,
        }));
        try {
          const result = await callback(tx as never);
          if (transactionCalls === 1) {
            throw new Error("metadata rollback commit failed");
          }
          events.push(`transaction-commit-${transactionCalls}`);
          return result;
        } catch (error) {
          metadataRows.splice(
            0,
            metadataRows.length,
            ...persistedBeforeTransaction,
          );
          events.push(`transaction-rollback-${transactionCalls}`);
          throw error;
        }
      },
    );
    mocks.queueVisualEditSnapshotBlobCleanupInTransaction.mockImplementation(
      async () => {
        events.push(`queue-handles-${transactionCalls}`);
      },
    );
    mocks.deleteVisualEditSnapshotBlobs.mockImplementation(async () => {
      events.push("drain-queue");
    });
    mocks.migrateBoardObjectsToFile.mockResolvedValue({
      boardFileId: "board-file",
    });
    mocks.readLiveSourceFile.mockResolvedValue({
      content: "<html><body></body></html>",
      versionHash: "before",
    });
    mocks.writeInlineSourceFile.mockResolvedValue({ versionHash: "after" });
    mocks.getDb.mockReturnValue({
      select: vi
        .fn()
        .mockImplementationOnce(() => selectChain([boardFile]))
        .mockImplementation(() => selectChain(metadataRows)),
      insert: vi.fn(
        () =>
          ({
            values: vi.fn(async (rows: Array<Record<string, unknown>>) => {
              metadataRows.push(...rows);
              throw new Error("metadata insert failed after persistence");
            }),
          }) as never,
      ),
    });

    await expect(
      action.run(
        {
          designId: "existing-design",
          screenshots: [
            {
              attachmentRef: "attachment-ref",
              replayId: "replay-id",
              capturedAt: "2026-10-07T12:00:00.000Z",
              app: "clips",
              route: "/library",
              offsetMs: 13_000,
              viewportWidth: 430,
              viewportHeight: 932,
              eventCount: 12,
            },
          ],
        } as never,
        {
          caller: "frontend",
          actionName: "add-session-replay-screenshots-to-board",
        } as never,
      ),
    ).rejects.toThrow("metadata insert failed after persistence");

    expect(metadataRows).toHaveLength(0);
    expect(
      mocks.queueVisualEditSnapshotBlobCleanupInTransaction,
    ).toHaveBeenCalledTimes(2);
    expect(events.indexOf("transaction-commit-2")).toBeLessThan(
      events.indexOf("drain-queue"),
    );
    expect(mocks.deleteVisualEditSnapshotBlobs).toHaveBeenCalledOnce();
    expect(mocks.deletePrivateBlob).not.toHaveBeenCalled();
  });

  it("reports pending metadata cleanup and an uncertain board after rollback failures", async () => {
    const boardFile = {
      id: "board-file",
      designId: "existing-design",
      filename: "index.html",
      fileType: "html",
      content: "<html><body></body></html>",
      createdAt: null,
      updatedAt: null,
    };
    mocks.migrateBoardObjectsToFile.mockResolvedValue({
      boardFileId: "board-file",
    });
    mocks.readLiveSourceFile.mockResolvedValue({
      content: "<html><body></body></html>",
      versionHash: "before",
    });
    mocks.writeInlineSourceFile
      .mockResolvedValueOnce({ versionHash: "after" })
      .mockRejectedValueOnce(new Error("board rollback failed"));
    mocks.withDesignSourceMutationTransaction.mockRejectedValue(
      new Error("metadata rollback failed"),
    );
    mocks.getDb.mockReturnValue({
      select: vi.fn(() => selectChain([boardFile])),
      insert: vi.fn(
        () =>
          ({
            values: vi.fn(async () => {
              throw new Error("metadata insert failed");
            }),
          }) as never,
      ),
    });

    await expect(
      action.run(
        {
          designId: "existing-design",
          screenshots: [
            {
              attachmentRef: "attachment-ref",
              replayId: "replay-id",
              capturedAt: "2026-10-07T12:00:00.000Z",
              app: "clips",
              route: "/library",
              offsetMs: 13_000,
              viewportWidth: 430,
              viewportHeight: 932,
              eventCount: 12,
            },
          ],
        } as never,
        {
          caller: "frontend",
          actionName: "add-session-replay-screenshots-to-board",
        } as never,
      ),
    ).rejects.toMatchObject({
      actionContractError: true,
      message: "metadata insert failed",
      details: { cleanupPending: true, saveOutcomeUnknown: true },
    });
    expect(mocks.withDesignSourceMutationTransaction).toHaveBeenCalledTimes(2);
    expect(mocks.writeInlineSourceFile).toHaveBeenCalledTimes(2);
  });
});
