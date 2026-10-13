import { beforeEach, describe, expect, it, vi } from "vitest";

const readPrivateBlob = vi.hoisted(() => vi.fn());
const deletePrivateBlob = vi.hoisted(() => vi.fn());
const putPrivateBlob = vi.hoisted(() => vi.fn());
const captureError = vi.hoisted(() => vi.fn());
const captureMocks = vi.hoisted(() => ({
  revisions: [] as Array<Record<string, unknown>>,
  design: {
    data: JSON.stringify({ breakpointSet: { breakpoints: [] } }),
    title: "Landing page",
    description: null,
    projectType: "prototype",
    designSystemId: "system-1",
    ownerEmail: "owner@example.com",
  },
  liveSnapshot: {
    files: [
      {
        id: "file-1",
        filename: "index.html",
        fileType: "html",
        content: "<main>Hello</main>",
        source: "stored" as const,
      },
    ],
    tweaks: [],
    appliedTweaks: {},
    resolvedCssVars: {},
  },
  forceInsertConflict: false,
  persistConcurrentInsertOnConflict: false,
  failReturningAfterInsert: false,
  sourceMutationActive: false,
  transactionRollbackMode: "confirmed" as "confirmed" | "unknown",
  collaborationVersion: 1 as number | null,
  collaborationContent: "<main>Hello</main>" as string | null,
  emptyCollaborationRow: false,
  concurrentCollaborationSeed: false,
  SourceWorkspaceEditConflictError: class SourceWorkspaceEditConflictError extends Error {
    readonly statusCode = 409;

    constructor(message = "Source file changed.") {
      super(message);
      this.name = "SourceWorkspaceEditConflictError";
    }
  },
  hasCollabState: vi.fn(),
  rejectSourceMutationAccess: false,
  acceptedAccessRole: null as "editor" | "viewer" | null,
  rejectPersistence: false,
  sourceMutationEvents: [] as string[],
  mutationDatabase: null as unknown,
  assertAccess: vi.fn(),
  buildDesignSnapshot: vi.fn(),
  nanoid: vi.fn(),
}));

vi.mock("@agent-native/core/private-blob", () => ({
  deletePrivateBlob,
  putPrivateBlob,
  readPrivateBlob,
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  asc: (value: unknown) => ({ asc: value }),
  desc: (value: unknown) => ({ desc: value }),
  eq: (left: unknown, right: unknown) => ({ left, right }),
  isNull: (value: unknown) => ({ isNull: value }),
  like: (left: unknown, right: unknown) => ({ left, right }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core/collab", () => ({
  AGENT_CLIENT_ID: "agent-client",
  applyText: vi.fn(),
  applyTextToYDoc: vi.fn(
    (_doc: unknown, _field: string, content: string, _source: string) => {
      captureMocks.liveSnapshot.files = captureMocks.liveSnapshot.files.map(
        (file) => ({ ...file, content }),
      );
    },
  ),
  hasCollabState: captureMocks.hasCollabState,
  loadAwarenessRowsStrict: vi.fn(),
  seedFromText: vi.fn(),
  withPreparedYDocMutation: async (
    _fileId: string,
    _source: string | undefined,
    callback: (lease: unknown) => Promise<unknown>,
  ) =>
    callback({
      baseVersion: captureMocks.collaborationVersion,
      doc: {
        getText: () => ({
          toString: () =>
            captureMocks.liveSnapshot.files.find((file) => file.id === _fileId)
              ?.content ?? "",
        }),
      },
      persist: vi.fn(async () => {
        captureMocks.collaborationVersion =
          (captureMocks.collaborationVersion ?? 0) + 1;
        captureMocks.collaborationContent =
          captureMocks.liveSnapshot.files.find((file) => file.id === _fileId)
            ?.content ?? "";
        captureMocks.emptyCollaborationRow = false;
      }),
    }),
}));

vi.mock("@agent-native/core/server", () => ({
  captureError,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(() => undefined),
  assertAccess: captureMocks.assertAccess,
}));

vi.mock("nanoid", () => ({ nanoid: captureMocks.nanoid }));

vi.mock("../source-workspace.js", () => ({
  SourceWorkspaceEditConflictError:
    captureMocks.SourceWorkspaceEditConflictError,
  lockDesignSourceMutation: vi.fn(),
  getDesignSourceMutationExec: vi.fn(() => ({
    execute: vi.fn(async () => ({ rows: [] })),
  })),
  lockPreparedSourceCollaboration: vi.fn(
    async (
      _transaction: unknown,
      _fileId: string,
      lease: { baseVersion: number | null },
    ) => {
      if (
        captureMocks.concurrentCollaborationSeed &&
        lease.baseVersion === null
      ) {
        captureMocks.collaborationVersion = 1;
        captureMocks.collaborationContent = "<main>Peer content</main>";
        captureMocks.emptyCollaborationRow = false;
        throw new captureMocks.SourceWorkspaceEditConflictError(
          "The source file's live collaboration document changed while it was being read. Re-read the design and retry.",
        );
      }
      if (lease.baseVersion !== captureMocks.collaborationVersion) {
        throw new Error("Source collaboration version changed.");
      }
      const hasState =
        captureMocks.collaborationContent !== null &&
        captureMocks.collaborationContent.length > 0 &&
        !captureMocks.emptyCollaborationRow;
      return { hasState, needsSeed: !hasState };
    },
  ),
  readPreparedSourceText: (lease: {
    doc: { getText: () => { toString: () => string } };
  }) => lease.doc.getText().toString(),
  withDesignSourceMutationTransaction: async (
    _designId: string,
    callback: (database: unknown) => Promise<unknown>,
    outcome?: { callbackCompleted: boolean; rollbackConfirmed: boolean },
  ) => {
    captureMocks.sourceMutationEvents.push("lock");
    captureMocks.sourceMutationActive = true;
    const revisionsBefore = [...captureMocks.revisions];
    try {
      const result = await callback(captureMocks.mutationDatabase);
      if (outcome) outcome.callbackCompleted = true;
      return result;
    } catch (error) {
      if (outcome && captureMocks.transactionRollbackMode === "confirmed") {
        captureMocks.revisions = revisionsBefore;
        outcome.rollbackConfirmed = true;
      }
      throw error;
    } finally {
      captureMocks.sourceMutationActive = false;
    }
  },
  withSourceFileWriteLock: async (
    _fileId: string,
    work: () => Promise<unknown>,
  ) => work(),
}));

vi.mock("./design-snapshot.js", () => ({
  buildDesignSnapshot: captureMocks.buildDesignSnapshot,
}));

vi.mock("../db/index.js", () => {
  const schema = {
    designVersions: {
      id: { name: "id" },
      designId: { name: "designId" },
      label: { name: "label" },
      snapshot: { name: "snapshot" },
      chatContext: { name: "chatContext" },
      fileCount: { name: "fileCount" },
      createdAt: { name: "createdAt" },
    },
    designFiles: {
      id: { name: "id" },
      designId: { name: "designId" },
      filename: { name: "filename" },
      fileType: { name: "fileType" },
      content: { name: "content" },
    },
    designShares: {},
    designs: {},
  };
  const queryResult = (rows: unknown[]) => {
    const result: any = Promise.resolve(rows);
    result.orderBy = () => result;
    result.for = () => result;
    result.limit = (limit: number) => queryResult(rows.slice(0, limit));
    return result;
  };
  const findConstraint = (condition: any, column: string): unknown => {
    if (condition?.left?.name === column) return condition.right;
    for (const nested of condition?.and ?? []) {
      const found = findConstraint(nested, column);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: (condition: unknown) => {
          if (table === schema.designFiles) {
            const id = findConstraint(condition, "id");
            const designId = findConstraint(condition, "designId");
            const rows = captureMocks.liveSnapshot.files.map((file) => ({
              ...file,
              designId: "design-1",
            }));
            return queryResult(
              rows.filter(
                (row) =>
                  (id === undefined || row.id === id) &&
                  (designId === undefined || row.designId === designId),
              ),
            );
          }
          if (table === schema.designVersions) {
            const id = findConstraint(condition, "id");
            const designId = findConstraint(condition, "designId");
            const rows = captureMocks.revisions.filter(
              (row) =>
                (id === undefined || row.id === id) &&
                (designId === undefined || row.designId === designId),
            );
            return queryResult(id === undefined ? rows.slice(-1) : rows);
          }
          return queryResult(
            table === schema.designs ? [captureMocks.design] : [],
          );
        },
      }),
    }),
    insert: (table: unknown) => {
      const query: any = {
        values: (value: Record<string, unknown>) => {
          query.value = value;
          return query;
        },
        onConflictDoNothing: () => {
          if (captureMocks.rejectPersistence) {
            captureMocks.sourceMutationEvents.push(
              captureMocks.sourceMutationActive
                ? "persist-failure-inside"
                : "persist-failure-outside",
            );
            throw new Error("version persistence outcome is unknown");
          }
          query.conflicted = captureMocks.forceInsertConflict;
          if (
            table === schema.designVersions &&
            (!captureMocks.forceInsertConflict ||
              captureMocks.persistConcurrentInsertOnConflict) &&
            !captureMocks.revisions.some(
              (revision) => revision.id === query.value.id,
            )
          ) {
            captureMocks.sourceMutationEvents.push(
              captureMocks.sourceMutationActive
                ? "insert-inside"
                : "insert-outside",
            );
            captureMocks.revisions.push(query.value);
          }
          captureMocks.forceInsertConflict = false;
          return query;
        },
        returning: async () => {
          if (captureMocks.failReturningAfterInsert) {
            captureMocks.failReturningAfterInsert = false;
            throw new Error("checkpoint confirmation failed");
          }
          return query.conflicted ? [] : [{ id: query.value.id }];
        },
      };
      return query;
    },
  };
  captureMocks.mutationDatabase = db;
  return { getDb: () => db, schema };
});

import { applyTextToYDoc } from "@agent-native/core/collab";

import {
  __clearEditorCheckpointSkipsForTests,
  createDesignChatBeginningSnapshot,
  createDesignVersionSnapshot,
  createDesignVersionSnapshotForCreativeContextCapture,
  createDesignVersionSnapshotWithSourceMutationLock,
  DesignVersionCheckpointChangedError,
  listDesignVersions,
  parseDesignVersionSnapshot,
  readDesignVersionSnapshot,
  snapshotDesignBeforeAgentEdit,
  snapshotDesignBeforeAgentEditInVersionLock,
  withDesignVersionLock,
} from "./design-versions.js";

beforeEach(() => {
  __clearEditorCheckpointSkipsForTests();
  captureMocks.revisions = [];
  captureMocks.forceInsertConflict = false;
  captureMocks.persistConcurrentInsertOnConflict = false;
  captureMocks.failReturningAfterInsert = false;
  captureMocks.assertAccess.mockReset();
  captureMocks.sourceMutationActive = false;
  captureMocks.transactionRollbackMode = "confirmed";
  captureMocks.collaborationVersion = 1;
  captureMocks.collaborationContent = "<main>Hello</main>";
  captureMocks.emptyCollaborationRow = false;
  captureMocks.concurrentCollaborationSeed = false;
  captureMocks.hasCollabState.mockReset();
  captureMocks.hasCollabState.mockImplementation(
    async () =>
      captureMocks.collaborationContent !== null &&
      captureMocks.collaborationContent.length > 0 &&
      !captureMocks.emptyCollaborationRow,
  );
  vi.mocked(applyTextToYDoc).mockClear();
  captureMocks.rejectSourceMutationAccess = false;
  captureMocks.acceptedAccessRole = null;
  captureMocks.rejectPersistence = false;
  captureMocks.sourceMutationEvents = [];
  captureMocks.assertAccess.mockImplementation(async (...args: unknown[]) => {
    captureMocks.sourceMutationEvents.push(
      captureMocks.sourceMutationActive ? "access-inside" : "access-outside",
    );
    if (
      captureMocks.sourceMutationActive &&
      captureMocks.rejectSourceMutationAccess
    ) {
      throw new Error("editor access revoked");
    }
    if (
      captureMocks.acceptedAccessRole &&
      args[2] !== captureMocks.acceptedAccessRole
    ) {
      throw new Error(`${captureMocks.acceptedAccessRole} access required`);
    }
    return { resource: { ...captureMocks.design } };
  });
  captureMocks.buildDesignSnapshot.mockReset();
  captureMocks.buildDesignSnapshot.mockImplementation(
    async (
      _designId: string,
      _designData: unknown,
      options?: { preparedFiles?: typeof captureMocks.liveSnapshot.files },
    ) => {
      captureMocks.sourceMutationEvents.push("snapshot");
      return {
        ...captureMocks.liveSnapshot,
        files: options?.preparedFiles ?? captureMocks.liveSnapshot.files,
      };
    },
  );
  captureMocks.nanoid.mockReset();
  captureMocks.nanoid.mockImplementation(
    () => `design-version-${captureMocks.revisions.length + 1}`,
  );
  captureMocks.liveSnapshot = {
    files: [
      {
        id: "file-1",
        filename: "index.html",
        fileType: "html",
        content: "<main>Hello</main>",
        source: "stored",
      },
    ],
    tweaks: [],
    appliedTweaks: {},
    resolvedCssVars: {},
  };
  putPrivateBlob.mockReset();
  putPrivateBlob.mockImplementation(async () => {
    captureMocks.sourceMutationEvents.push(
      captureMocks.sourceMutationActive ? "blob-inside" : "blob-outside",
    );
    return {
      id: "blob-1",
      provider: "test",
      opaque: true,
      encrypted: true,
    };
  });
  deletePrivateBlob.mockReset();
  captureError.mockReset();
});

describe("parseDesignVersionSnapshot", () => {
  it("accepts buildDesignSnapshot files and preserves restore metadata", () => {
    const snapshot = parseDesignVersionSnapshot(
      JSON.stringify({
        designId: "design-1",
        designData: JSON.stringify({ breakpointSet: { breakpoints: [] } }),
        designTitle: "Landing page",
        designDescription: null,
        projectType: "prototype",
        designSystemId: "system-1",
        tweaks: [{ id: "color", cssVar: "--color" }],
        appliedTweaks: { color: "blue" },
        resolvedCssVars: { "--color": "blue" },
        deletionGeometry: {
          fileId: "file-1",
          mainNodeId: "main-1",
          sourceVersionHash: "hash-1",
          boundingRect: { x: 10, y: 20, width: 100, height: 70 },
        },
        files: [
          {
            id: "file-1",
            filename: "src/index.html",
            fileType: "html",
            content: "<main>Hello</main>",
            source: "collab",
          },
        ],
        chatContext: { threadId: "thread-1", turnId: "turn-1" },
      }),
      "design-1",
    );

    expect(snapshot).toMatchObject({
      designId: "design-1",
      designTitle: "Landing page",
      designSystemId: "system-1",
      tweaks: [{ id: "color", cssVar: "--color" }],
      appliedTweaks: { color: "blue" },
      resolvedCssVars: { "--color": "blue" },
      deletionGeometry: {
        fileId: "file-1",
        mainNodeId: "main-1",
        sourceVersionHash: "hash-1",
        boundingRect: { x: 10, y: 20, width: 100, height: 70 },
      },
      chatContext: { threadId: "thread-1", turnId: "turn-1" },
    });
    expect(snapshot.files).toEqual([
      {
        id: "file-1",
        filename: "src/index.html",
        fileType: "html",
        content: "<main>Hello</main>",
      },
    ]);
  });

  it("rejects snapshots that can cross a design or map two files to one name", () => {
    expect(() =>
      parseDesignVersionSnapshot(
        JSON.stringify({
          designId: "other-design",
          files: [],
        }),
        "design-1",
      ),
    ).toThrow("different design");

    expect(() =>
      parseDesignVersionSnapshot(
        JSON.stringify({
          designId: "design-1",
          files: [
            { filename: "index.html", fileType: "html", content: "one" },
            { filename: "index.html", fileType: "html", content: "two" },
          ],
        }),
        "design-1",
      ),
    ).toThrow("duplicate file");
  });

  it("reads large snapshots through their private blob reference", async () => {
    const handle = {
      id: "blob-1",
      provider: "test",
      opaque: true as const,
      encrypted: true,
    };
    readPrivateBlob.mockResolvedValue({
      data: Buffer.from(
        JSON.stringify({
          designId: "design-1",
          files: [
            {
              filename: "index.html",
              fileType: "html",
              content: "<main>Restored</main>",
            },
          ],
        }),
      ),
      handle,
    });

    await expect(
      readDesignVersionSnapshot(
        JSON.stringify({
          snapshotKind: "design-history-blob",
          designId: "design-1",
          blob: handle,
        }),
        "design-1",
      ),
    ).resolves.toMatchObject({
      designId: "design-1",
      files: [{ content: "<main>Restored</main>" }],
    });
    expect(readPrivateBlob).toHaveBeenCalledWith(handle);
  });
});

describe("createDesignVersionSnapshot", () => {
  it("seeds a legacy stored source before capturing its first checkpoint", async () => {
    captureMocks.collaborationVersion = null;
    captureMocks.collaborationContent = null;

    await createDesignVersionSnapshot("design-1", {
      label: "Legacy source baseline",
    });

    expect(applyTextToYDoc).toHaveBeenCalledWith(
      expect.anything(),
      "content",
      "<main>Hello</main>",
      "agent",
    );
    expect(captureMocks.collaborationVersion).toBe(1);
    expect(captureMocks.collaborationContent).toBe("<main>Hello</main>");
    expect(captureMocks.revisions).toHaveLength(1);
    expect(
      JSON.parse(captureMocks.revisions[0]!.snapshot as string).files,
    ).toMatchObject([{ content: "<main>Hello</main>" }]);
  });

  it("seeds an existing empty collaboration row from locked stored content", async () => {
    captureMocks.collaborationVersion = 3;
    captureMocks.collaborationContent = "";
    captureMocks.emptyCollaborationRow = true;

    await createDesignVersionSnapshot("design-1", {
      label: "Empty collaboration baseline",
    });

    expect(applyTextToYDoc).toHaveBeenCalledWith(
      expect.anything(),
      "content",
      "<main>Hello</main>",
      "agent",
    );
    expect(captureMocks.collaborationVersion).toBe(4);
    expect(captureMocks.collaborationContent).toBe("<main>Hello</main>");
    expect(captureMocks.revisions).toHaveLength(1);
  });

  it("preserves a concurrent first collaboration seed and returns a retryable conflict", async () => {
    captureMocks.collaborationVersion = null;
    captureMocks.collaborationContent = null;
    captureMocks.concurrentCollaborationSeed = true;

    await expect(
      createDesignVersionSnapshot("design-1", {
        label: "Concurrent legacy baseline",
      }),
    ).rejects.toBeInstanceOf(DesignVersionCheckpointChangedError);

    expect(captureMocks.collaborationContent).toBe("<main>Peer content</main>");
    expect(applyTextToYDoc).not.toHaveBeenCalled();
    expect(captureMocks.revisions).toHaveLength(0);
  });

  it("uses one deterministic ordering for mixed-case source file ids", async () => {
    const previousSnapshot = captureMocks.liveSnapshot;
    try {
      captureMocks.liveSnapshot = {
        ...captureMocks.liveSnapshot,
        files: [
          {
            id: "a",
            filename: "lower.html",
            fileType: "html",
            content: "<main>lower</main>",
            source: "stored",
          },
          {
            id: "A",
            filename: "upper.html",
            fileType: "html",
            content: "<main>upper</main>",
            source: "stored",
          },
        ],
      };

      await createDesignVersionSnapshot("design-1", {
        label: "Mixed-case sources",
      });

      expect(
        JSON.parse(captureMocks.revisions[0]!.snapshot as string).files.map(
          (file: { id: string }) => file.id,
        ),
      ).toEqual(["A", "a"]);
    } finally {
      captureMocks.liveSnapshot = previousSnapshot;
    }
  });

  it("allows viewer-authorized Creative Context capture while normal checkpoints require editor access", async () => {
    captureMocks.acceptedAccessRole = "viewer";

    await createDesignVersionSnapshotForCreativeContextCapture("design-1", {
      label: "Creative Context submission",
    });

    expect(captureMocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design-1",
      "viewer",
    );
    expect(captureMocks.revisions).toHaveLength(1);
    expect(captureMocks.sourceMutationEvents).toEqual([
      "access-outside",
      "snapshot",
      "access-outside",
      "lock",
      "access-inside",
      "insert-inside",
    ]);

    captureMocks.assertAccess.mockClear();
    await expect(
      createDesignVersionSnapshotWithSourceMutationLock("design-1", {
        label: "Standard history checkpoint",
      }),
    ).rejects.toThrow("viewer access required");

    expect(captureMocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design-1",
      "editor",
    );
    expect(captureMocks.revisions).toHaveLength(1);
  });

  it("captures source under lock and revalidates it before persistence", async () => {
    captureMocks.liveSnapshot = {
      files: [
        {
          id: "file-1",
          filename: "index.html",
          fileType: "html",
          content: "x".repeat(300 * 1024),
          source: "stored",
        },
      ],
      tweaks: [],
      appliedTweaks: {},
      resolvedCssVars: {},
    };

    await createDesignVersionSnapshotWithSourceMutationLock("design-1", {
      label: "Before editor screen delete",
    });

    expect(captureMocks.sourceMutationEvents).toEqual([
      "access-outside",
      "snapshot",
      "blob-outside",
      "access-outside",
      "lock",
      "access-inside",
      "insert-inside",
    ]);
    expect(captureMocks.revisions).toHaveLength(1);
  });

  it("deletes a staged blob after checkpoint persistence is rolled back", async () => {
    const blob = {
      id: "staged-blob",
      provider: "test",
      opaque: true as const,
      encrypted: true,
    };
    captureMocks.liveSnapshot = {
      ...captureMocks.liveSnapshot,
      files: [
        {
          ...captureMocks.liveSnapshot.files[0]!,
          content: "x".repeat(300 * 1024),
        },
      ],
    };
    captureMocks.failReturningAfterInsert = true;
    putPrivateBlob.mockResolvedValue(blob);
    deletePrivateBlob.mockResolvedValue({ deleted: true, provider: "test" });

    await expect(
      createDesignVersionSnapshotWithSourceMutationLock("design-1", {
        label: "Before failed persistence confirmation",
      }),
    ).rejects.toThrow("checkpoint confirmation failed");

    expect(captureMocks.revisions).toEqual([]);
    expect(deletePrivateBlob).toHaveBeenCalledWith(blob);
  });

  it("coalesces unchanged source-locked snapshots but records the next edit", async () => {
    const first = await createDesignVersionSnapshotWithSourceMutationLock(
      "design-1",
      {
        label: "Chat autosave",
      },
    );
    const same = await createDesignVersionSnapshotWithSourceMutationLock(
      "design-1",
      {
        label: "Chat autosave",
      },
    );

    expect(same).toEqual(first);
    expect(captureMocks.revisions).toHaveLength(1);

    captureMocks.liveSnapshot = {
      ...captureMocks.liveSnapshot,
      files: [
        {
          ...captureMocks.liveSnapshot.files[0],
          content: "<main>Changed</main>",
        },
      ],
    };
    const changed = await createDesignVersionSnapshotWithSourceMutationLock(
      "design-1",
      {
        label: "Chat autosave",
      },
    );

    expect(changed.id).not.toBe(first.id);
    expect(captureMocks.revisions).toHaveLength(2);
  });

  it("does not persist a chat-start snapshot after editor access is revoked", async () => {
    captureMocks.rejectSourceMutationAccess = true;

    await expect(
      createDesignChatBeginningSnapshot("design-1", {
        threadId: "thread-revoked",
        runId: "run-revoked",
      }),
    ).rejects.toThrow("editor access revoked");

    expect(captureMocks.revisions).toHaveLength(0);
    expect(captureMocks.sourceMutationEvents).toEqual([
      "access-outside",
      "snapshot",
      "access-outside",
      "lock",
      "access-inside",
    ]);
    expect(captureMocks.sourceMutationActive).toBe(false);
  });

  it("captures the start of a chat once per thread", async () => {
    const run = { threadId: 'thread "%_\\path', runId: "run-1" };

    const first = await createDesignChatBeginningSnapshot("design-1", run);

    expect(first).not.toBeNull();
    expect(captureMocks.sourceMutationEvents).toEqual([
      "access-outside",
      "snapshot",
      "access-outside",
      "lock",
      "access-inside",
      "insert-inside",
    ]);

    captureMocks.sourceMutationEvents = [];
    const retry = await createDesignChatBeginningSnapshot("design-1", run);
    expect(captureMocks.sourceMutationEvents).toEqual([]);

    expect(retry).toBeNull();
    expect(captureMocks.revisions).toHaveLength(1);
    expect(
      JSON.parse(captureMocks.revisions[0]!.chatContext as string),
    ).toMatchObject({ ...run, phase: "start" });

    await expect(
      listDesignVersions("design-1", 10, run.threadId),
    ).resolves.toMatchObject({
      versions: [
        expect.objectContaining({
          id: expect.any(String),
          chatContext: { ...run, phase: "start" },
        }),
      ],
    });

    captureMocks.revisions[0]!.chatContext = `{"threadId":${JSON.stringify(run.threadId)},"phase":"start",broken}`;
    await expect(
      listDesignVersions("design-1", 10, run.threadId),
    ).resolves.toMatchObject({
      versions: [],
      invalidCount: 1,
    });
  });

  it("uses the database primary key to deduplicate concurrent thread baselines", async () => {
    captureMocks.forceInsertConflict = true;
    captureMocks.persistConcurrentInsertOnConflict = true;

    const result = await createDesignChatBeginningSnapshot("design-1", {
      threadId: "thread-race",
      runId: "run-race",
    });
    const retry = await createDesignChatBeginningSnapshot("design-1", {
      threadId: "thread-race",
      runId: "different-run",
    });

    expect(result).not.toBeNull();
    expect(retry).toBeNull();
    expect(captureMocks.revisions).toHaveLength(1);
    expect(captureMocks.revisions[0]).toMatchObject({
      id: expect.stringMatching(/^design-version-/),
      chatContext: JSON.stringify({
        threadId: "thread-race",
        runId: "run-race",
        phase: "start",
      }),
    });
  });

  it("records a tweak-only edit as a new checkpoint", async () => {
    const first = await createDesignVersionSnapshot("design-1", {
      label: "Chat autosave",
    });

    captureMocks.liveSnapshot = {
      ...captureMocks.liveSnapshot,
      appliedTweaks: { density: "compact" },
      resolvedCssVars: { "--density": "compact" },
    };
    const changed = await createDesignVersionSnapshot("design-1", {
      label: "Chat autosave",
    });

    expect(changed.id).not.toBe(first.id);
    expect(captureMocks.revisions).toHaveLength(2);
  });

  it("includes deletion geometry in snapshot dedupe and identity", async () => {
    const geometry = {
      fileId: "file-1",
      mainNodeId: "main-1",
      sourceVersionHash: "hash-1",
      boundingRect: { x: 10, y: 20, width: 100, height: 70 },
    };
    const first = await createDesignVersionSnapshot("design-1", {
      label: "Before component delete",
    });
    const withGeometry = await createDesignVersionSnapshot("design-1", {
      label: "Before component delete",
      deletionGeometry: geometry,
    });
    const sameGeometry = await createDesignVersionSnapshot("design-1", {
      label: "Before component delete",
      deletionGeometry: geometry,
    });

    expect(withGeometry.id).not.toBe(first.id);
    expect(sameGeometry).toEqual(withGeometry);
    expect(captureMocks.revisions).toHaveLength(2);
    expect(
      JSON.parse(captureMocks.revisions[1]!.snapshot as string),
    ).toMatchObject({
      deletionGeometry: geometry,
    });
  });

  it("keeps a new chat turn's pre-edit checkpoint when state is unchanged", async () => {
    await createDesignVersionSnapshot("design-1", {
      label: "Chat autosave",
    });
    const context = {
      caller: "tool" as const,
      threadId: "thread-1",
      turnId: "turn-1",
      actionName: "edit-design",
    };

    const checkpoint = (await snapshotDesignBeforeAgentEdit(
      "design-1",
      context,
    )) as { id: string; createdAt: string; label: string } | null;
    const retry = await snapshotDesignBeforeAgentEdit("design-1", context);

    expect(checkpoint?.id).not.toBe(captureMocks.revisions[0]?.id);
    expect(retry).toEqual(checkpoint);
    expect(captureMocks.revisions).toHaveLength(2);
    expect(captureMocks.revisions[1]?.chatContext).toContain(
      '"turnId":"turn-1"',
    );
  });

  it("persists browser checkpoints from live collaborative content", async () => {
    captureMocks.liveSnapshot = {
      ...captureMocks.liveSnapshot,
      files: [
        {
          ...captureMocks.liveSnapshot.files[0],
          content: "<main>Latest Yjs edit</main>",
        },
      ],
    };
    const checkpoint = (await snapshotDesignBeforeAgentEdit("design-1", {
      caller: "frontend",
      actionName: "update-file",
    })) as { id: string; createdAt: string; label: string } | null;

    expect(checkpoint).toBeTruthy();
    expect(captureMocks.buildDesignSnapshot).toHaveBeenCalledWith(
      "design-1",
      expect.any(String),
      { preparedFiles: expect.any(Array) },
    );
    expect(captureMocks.revisions[0]?.snapshot).toContain("Latest Yjs edit");
    expect(
      JSON.parse(captureMocks.revisions[0]!.chatContext as string),
    ).toEqual({
      surface: "editor",
      caller: "frontend",
      actionName: "update-file",
    });

    await expect(listDesignVersions("design-1", 10)).resolves.toMatchObject({
      versions: [
        {
          id: checkpoint?.id,
          source: "editor",
          editable: true,
          chatContext: {
            surface: "editor",
            caller: "frontend",
            actionName: "update-file",
          },
        },
      ],
    });
  });

  it("persists a required-mode checkpoint through the source mutation transaction", async () => {
    await snapshotDesignBeforeAgentEditInVersionLock("design-1", {
      caller: "frontend",
      actionName: "delete-file",
    });

    expect(captureMocks.sourceMutationEvents).toEqual([
      "access-outside",
      "access-outside",
      "snapshot",
      "access-outside",
      "lock",
      "access-inside",
      "insert-inside",
    ]);
    expect(captureMocks.revisions).toHaveLength(1);
  });

  it("required-mode checkpoint is never throttled by a just-created editor checkpoint, and a null-blob failure propagates instead of skipping", async () => {
    const first = (await snapshotDesignBeforeAgentEdit("design-1", {
      caller: "frontend",
      actionName: "update-file",
    })) as { id: string; createdAt: string; label: string } | null;
    expect(captureMocks.revisions).toHaveLength(1);

    captureMocks.liveSnapshot = {
      ...captureMocks.liveSnapshot,
      files: [
        {
          ...captureMocks.liveSnapshot.files[0],
          content: "<main>changed before delete</main>",
        },
      ],
    };

    const second = await withDesignVersionLock("design-1", () =>
      snapshotDesignBeforeAgentEditInVersionLock("design-1", {
        caller: "frontend",
        actionName: "delete-file",
      }),
    );

    expect(captureMocks.revisions).toHaveLength(2);
    expect((second as { id: string } | null)?.id).not.toBe(first?.id);

    putPrivateBlob.mockResolvedValue(null);
    captureMocks.liveSnapshot = {
      ...captureMocks.liveSnapshot,
      files: [
        {
          ...captureMocks.liveSnapshot.files[0],
          content: "z".repeat(300 * 1024),
        },
      ],
    };

    await expect(
      withDesignVersionLock("design-1", () =>
        snapshotDesignBeforeAgentEditInVersionLock("design-1", {
          caller: "frontend",
          actionName: "delete-file",
        }),
      ),
    ).rejects.toThrow("Private blob storage is required");
  });

  it("coalesces concurrent browser checkpoints through the shared version lock", async () => {
    captureMocks.buildDesignSnapshot.mockImplementation(async () => {
      await Promise.resolve();
      return captureMocks.liveSnapshot;
    });

    const [first, second] = await Promise.all([
      snapshotDesignBeforeAgentEdit("design-1", {
        caller: "frontend",
        actionName: "update-file",
      }),
      snapshotDesignBeforeAgentEdit("design-1", {
        caller: "frontend",
        actionName: "update-file",
      }),
    ]);

    expect(second).toEqual(first);
    expect(captureMocks.revisions).toHaveLength(1);
  });

  it("cleans up an uploaded blob when in-lock access is rejected before persistence", async () => {
    const blob = {
      id: "blob-1",
      provider: "test",
      opaque: true as const,
      encrypted: true,
    };
    putPrivateBlob.mockImplementation(async () => {
      captureMocks.sourceMutationEvents.push(
        captureMocks.sourceMutationActive
          ? "blob-upload-inside"
          : "blob-upload-outside",
      );
      return blob;
    });
    deletePrivateBlob.mockImplementation(async () => {
      captureMocks.sourceMutationEvents.push(
        captureMocks.sourceMutationActive
          ? "blob-delete-inside"
          : "blob-delete-outside",
      );
      return { deleted: true, provider: "test" };
    });
    captureMocks.liveSnapshot = {
      ...captureMocks.liveSnapshot,
      files: [
        {
          ...captureMocks.liveSnapshot.files[0],
          content: "x".repeat(300 * 1024),
        },
      ],
    };
    let sourceMutationAccessChecks = 0;
    captureMocks.assertAccess.mockImplementation(async () => {
      captureMocks.sourceMutationEvents.push(
        captureMocks.sourceMutationActive ? "access-inside" : "access-outside",
      );
      if (
        captureMocks.sourceMutationActive &&
        ++sourceMutationAccessChecks === 1
      ) {
        throw new Error("editor access revoked");
      }
      return { resource: { ...captureMocks.design } };
    });

    await expect(
      createDesignChatBeginningSnapshot("design-1", {
        threadId: "thread-revoked-large",
        runId: "run-revoked-large",
      }),
    ).rejects.toThrow("editor access revoked");

    expect(deletePrivateBlob).toHaveBeenCalledWith(blob);
    expect(captureMocks.sourceMutationEvents).toEqual([
      "access-outside",
      "snapshot",
      "blob-upload-outside",
      "access-outside",
      "lock",
      "access-inside",
      "blob-delete-outside",
    ]);
    expect(captureMocks.revisions).toHaveLength(0);
  });

  it("preserves an uploaded blob when persistence outcome is uncertain", async () => {
    const blob = {
      id: "blob-1",
      provider: "test",
      opaque: true as const,
      encrypted: true,
    };
    putPrivateBlob.mockImplementation(async () => {
      captureMocks.sourceMutationEvents.push(
        captureMocks.sourceMutationActive
          ? "blob-upload-inside"
          : "blob-upload-outside",
      );
      return blob;
    });
    captureMocks.liveSnapshot = {
      ...captureMocks.liveSnapshot,
      files: [
        {
          ...captureMocks.liveSnapshot.files[0],
          content: "x".repeat(300 * 1024),
        },
      ],
    };
    captureMocks.rejectPersistence = true;
    captureMocks.transactionRollbackMode = "unknown";

    await expect(
      createDesignChatBeginningSnapshot("design-1", {
        threadId: "thread-uncertain-large",
        runId: "run-uncertain-large",
      }),
    ).rejects.toThrow("version persistence outcome is unknown");

    expect(deletePrivateBlob).not.toHaveBeenCalled();
    expect(captureMocks.sourceMutationEvents).toEqual([
      "access-outside",
      "snapshot",
      "blob-upload-outside",
      "access-outside",
      "lock",
      "access-inside",
      "persist-failure-inside",
    ]);
    expect(captureMocks.revisions).toHaveLength(0);
  });

  it("aborts and cleans the blob when source changes during upload", async () => {
    const blob = {
      id: "blob-1",
      provider: "test",
      opaque: true as const,
      encrypted: true,
    };
    captureMocks.liveSnapshot = {
      ...captureMocks.liveSnapshot,
      files: [
        {
          ...captureMocks.liveSnapshot.files[0],
          content: "x".repeat(300 * 1024),
        },
      ],
    };
    putPrivateBlob.mockImplementation(async () => {
      captureMocks.sourceMutationEvents.push("blob-upload-outside");
      captureMocks.collaborationVersion =
        (captureMocks.collaborationVersion ?? 0) + 1;
      return blob;
    });
    deletePrivateBlob.mockImplementation(async () => {
      captureMocks.sourceMutationEvents.push("blob-delete-outside");
      return { deleted: true, provider: "test" };
    });

    await expect(
      createDesignChatBeginningSnapshot("design-1", {
        threadId: "thread-source-changed",
        runId: "run-source-changed",
      }),
    ).rejects.toMatchObject({
      name: "DesignVersionCheckpointChangedError",
      statusCode: 409,
      retryable: true,
      errorCode: "design-version-checkpoint-changed",
    });

    expect(deletePrivateBlob).toHaveBeenCalledWith(blob);
    expect(captureMocks.sourceMutationEvents).toEqual([
      "access-outside",
      "snapshot",
      "blob-upload-outside",
      "access-outside",
      "lock",
      "access-inside",
      "blob-delete-outside",
    ]);
    expect(captureMocks.revisions).toHaveLength(0);
  });

  it("aborts when the latest checkpoint changes during upload", async () => {
    const blob = {
      id: "blob-1",
      provider: "test",
      opaque: true as const,
      encrypted: true,
    };
    captureMocks.liveSnapshot = {
      ...captureMocks.liveSnapshot,
      files: [
        {
          ...captureMocks.liveSnapshot.files[0],
          content: "x".repeat(300 * 1024),
        },
      ],
    };
    putPrivateBlob.mockImplementation(async () => {
      captureMocks.sourceMutationEvents.push("blob-upload-outside");
      captureMocks.revisions.push({
        id: "concurrent-version",
        designId: "design-1",
        snapshot: JSON.stringify({ stateHash: "different-state" }),
        createdAt: "2026-10-11T12:00:00.000Z",
        label: "Concurrent checkpoint",
        chatContext: JSON.stringify({
          threadId: "thread-latest-changed",
          runId: "run-latest-changed",
          phase: "start",
        }),
      });
      return blob;
    });
    deletePrivateBlob.mockImplementation(async () => {
      captureMocks.sourceMutationEvents.push("blob-delete-outside");
      return { deleted: true, provider: "test" };
    });

    await expect(
      createDesignChatBeginningSnapshot("design-1", {
        threadId: "thread-latest-changed",
        runId: "run-latest-changed",
      }),
    ).rejects.toBeInstanceOf(DesignVersionCheckpointChangedError);

    expect(deletePrivateBlob).toHaveBeenCalledWith(blob);
    expect(captureMocks.sourceMutationEvents).toEqual([
      "access-outside",
      "snapshot",
      "blob-upload-outside",
      "access-outside",
      "lock",
      "access-inside",
      "blob-delete-outside",
    ]);
    expect(captureMocks.revisions).toEqual([
      expect.objectContaining({ id: "concurrent-version" }),
    ]);
  });

  it("cleans up a large blob when a duplicate insert loses the race", async () => {
    const blob = {
      id: "blob-1",
      provider: "test",
      opaque: true as const,
      encrypted: true,
    };
    putPrivateBlob.mockResolvedValue(blob);
    deletePrivateBlob.mockResolvedValue({ deleted: true, provider: "test" });
    captureMocks.liveSnapshot = {
      ...captureMocks.liveSnapshot,
      files: [
        {
          ...captureMocks.liveSnapshot.files[0],
          content: "x".repeat(300 * 1024),
        },
      ],
    };

    await createDesignVersionSnapshot("design-1", {
      label: "Chat autosave",
    });
    captureMocks.liveSnapshot = {
      ...captureMocks.liveSnapshot,
      files: [
        {
          ...captureMocks.liveSnapshot.files[0],
          content: "y".repeat(300 * 1024),
        },
      ],
    };
    captureMocks.forceInsertConflict = true;
    captureMocks.persistConcurrentInsertOnConflict = true;

    await createDesignVersionSnapshot("design-1", {
      label: "Chat autosave",
    });

    expect(deletePrivateBlob).toHaveBeenCalledWith(blob);
  });

  it("reports a skipped checkpoint instead of throwing for an opt-in caller when an editor-surface checkpoint's blob upload fails", async () => {
    putPrivateBlob.mockResolvedValue(null);
    captureMocks.liveSnapshot = {
      ...captureMocks.liveSnapshot,
      files: [
        {
          ...captureMocks.liveSnapshot.files[0],
          content: "x".repeat(300 * 1024),
        },
      ],
    };

    const result = await snapshotDesignBeforeAgentEdit(
      "design-1",
      { caller: "frontend", actionName: "update-file" },
      { allowCheckpointFailureSkip: true },
    );

    expect(result).toEqual({
      skipped: true,
      reason: "blob-storage-unavailable",
    });
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        extra: expect.objectContaining({ designId: "design-1" }),
      }),
    );
    expect(captureMocks.revisions).toHaveLength(0);
  });

  it("throws instead of failing open for a non-opt-in frontend caller when an editor-surface checkpoint's blob upload fails", async () => {
    putPrivateBlob.mockResolvedValue(null);
    captureMocks.liveSnapshot = {
      ...captureMocks.liveSnapshot,
      files: [
        {
          ...captureMocks.liveSnapshot.files[0],
          content: "x".repeat(300 * 1024),
        },
      ],
    };

    await expect(
      snapshotDesignBeforeAgentEdit("design-1", {
        caller: "frontend",
        actionName: "add-breakpoint",
      }),
    ).rejects.toThrow("Private blob storage is required");

    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureMocks.revisions).toHaveLength(0);
  });

  it("still throws when a 'tool' (agent) checkpoint's blob upload fails — it is that turn's rollback point", async () => {
    putPrivateBlob.mockResolvedValue(null);
    captureMocks.liveSnapshot = {
      ...captureMocks.liveSnapshot,
      files: [
        {
          ...captureMocks.liveSnapshot.files[0],
          content: "x".repeat(300 * 1024),
        },
      ],
    };

    await expect(
      snapshotDesignBeforeAgentEdit("design-1", {
        caller: "tool",
        threadId: "thread-1",
        turnId: "turn-1",
        actionName: "edit-design",
      }),
    ).rejects.toThrow("Private blob storage is required");
  });

  it("throttles a second editor-surface checkpoint within the window, even if content changed", async () => {
    const first = (await snapshotDesignBeforeAgentEdit("design-1", {
      caller: "frontend",
      actionName: "update-file",
    })) as { id: string; createdAt: string; label: string } | null;
    expect(captureMocks.buildDesignSnapshot).toHaveBeenCalledTimes(1);
    expect(captureMocks.revisions).toHaveLength(1);

    captureMocks.liveSnapshot = {
      ...captureMocks.liveSnapshot,
      files: [
        {
          ...captureMocks.liveSnapshot.files[0],
          content: "<main>changed inside the throttle window</main>",
        },
      ],
    };

    const second = await snapshotDesignBeforeAgentEdit("design-1", {
      caller: "frontend",
      actionName: "update-file",
    });

    expect(captureMocks.buildDesignSnapshot).toHaveBeenCalledTimes(1);
    expect(captureMocks.revisions).toHaveLength(1);
    expect(second).toEqual({
      id: first!.id,
      createdAt: first!.createdAt,
      label: first!.label,
    });
  });

  it("captures a new editor checkpoint once the throttle window has elapsed", async () => {
    vi.useFakeTimers();
    try {
      await snapshotDesignBeforeAgentEdit("design-1", {
        caller: "frontend",
        actionName: "update-file",
      });
      expect(captureMocks.revisions).toHaveLength(1);

      captureMocks.liveSnapshot = {
        ...captureMocks.liveSnapshot,
        files: [
          {
            ...captureMocks.liveSnapshot.files[0],
            content: "<main>changed after the throttle window</main>",
          },
        ],
      };
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      await snapshotDesignBeforeAgentEdit("design-1", {
        caller: "frontend",
        actionName: "update-file",
      });

      expect(captureMocks.buildDesignSnapshot).toHaveBeenCalledTimes(2);
      expect(captureMocks.revisions).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throttles a repeat capture attempt after a failed editor checkpoint instead of re-running buildDesignSnapshot", async () => {
    putPrivateBlob.mockResolvedValue(null);
    captureMocks.liveSnapshot = {
      ...captureMocks.liveSnapshot,
      files: [
        {
          ...captureMocks.liveSnapshot.files[0],
          content: "x".repeat(300 * 1024),
        },
      ],
    };

    const first = await snapshotDesignBeforeAgentEdit(
      "design-1",
      { caller: "frontend", actionName: "update-file" },
      { allowCheckpointFailureSkip: true },
    );
    const second = await snapshotDesignBeforeAgentEdit(
      "design-1",
      { caller: "frontend", actionName: "update-file" },
      { allowCheckpointFailureSkip: true },
    );

    expect(first).toEqual({
      skipped: true,
      reason: "blob-storage-unavailable",
    });
    expect(second).toEqual(first);
    expect(captureMocks.buildDesignSnapshot).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledTimes(1);
  });

  it("does not throttle a webmcp (agent-driven) editor checkpoint against a recent frontend one", async () => {
    await snapshotDesignBeforeAgentEdit("design-1", {
      caller: "frontend",
      actionName: "update-file",
    });
    expect(captureMocks.revisions).toHaveLength(1);

    captureMocks.liveSnapshot = {
      ...captureMocks.liveSnapshot,
      files: [
        {
          ...captureMocks.liveSnapshot.files[0],
          content:
            "<main>webmcp edit inside the frontend throttle window</main>",
        },
      ],
    };

    const webmcpCheckpoint = await snapshotDesignBeforeAgentEdit("design-1", {
      caller: "webmcp",
      actionName: "update-file",
    });

    expect(webmcpCheckpoint).not.toBeNull();
    expect(webmcpCheckpoint).not.toMatchObject({ skipped: true });
    expect(captureMocks.buildDesignSnapshot).toHaveBeenCalledTimes(2);
    expect(captureMocks.revisions).toHaveLength(2);
  });

  it("does not throttle a frontend save against a recent webmcp checkpoint", async () => {
    await snapshotDesignBeforeAgentEdit("design-1", {
      caller: "webmcp",
      actionName: "update-file",
    });
    expect(captureMocks.revisions).toHaveLength(1);

    captureMocks.liveSnapshot = {
      ...captureMocks.liveSnapshot,
      files: [
        {
          ...captureMocks.liveSnapshot.files[0],
          content:
            "<main>frontend edit inside the webmcp throttle window</main>",
        },
      ],
    };

    const frontendCheckpoint = await snapshotDesignBeforeAgentEdit("design-1", {
      caller: "frontend",
      actionName: "update-file",
    });

    expect(frontendCheckpoint).not.toBeNull();
    expect(frontendCheckpoint).not.toMatchObject({ skipped: true });
    expect(captureMocks.buildDesignSnapshot).toHaveBeenCalledTimes(2);
    expect(captureMocks.revisions).toHaveLength(2);
  });

  it("captures a pre-edit checkpoint for a scoped widget editor write", async () => {
    const checkpoint = await snapshotDesignBeforeAgentEdit("design-1", {
      caller: "mcp-widget-write",
      actionName: "update-file",
      mcpDirectoryWidgetWrite: {
        appId: "design",
        resourceIds: { designId: "design-1" },
        actionNames: ["update-file"],
      },
    });

    expect(checkpoint).not.toBeNull();
    expect(checkpoint).not.toMatchObject({ skipped: true });
    expect(captureMocks.revisions).toHaveLength(1);
    expect(
      JSON.parse(captureMocks.revisions[0]!.chatContext as string),
    ).toMatchObject({
      surface: "editor",
      caller: "mcp-widget-write",
      actionName: "update-file",
    });
  });

  it("throttles repeated scoped widget editor saves within the five-minute window", async () => {
    const context = {
      caller: "mcp-widget-write" as const,
      actionName: "update-file",
      mcpDirectoryWidgetWrite: {
        appId: "design",
        resourceIds: { designId: "design-1" },
        actionNames: ["update-file"],
      },
    };
    const first = await snapshotDesignBeforeAgentEdit("design-1", context);

    captureMocks.liveSnapshot = {
      ...captureMocks.liveSnapshot,
      files: [
        {
          ...captureMocks.liveSnapshot.files[0],
          content: "<main>changed inside the widget throttle window</main>",
        },
      ],
    };
    const second = await snapshotDesignBeforeAgentEdit("design-1", context);

    expect(second).toEqual(first);
    expect(captureMocks.buildDesignSnapshot).toHaveBeenCalledTimes(1);
    expect(captureMocks.revisions).toHaveLength(1);
  });

  it("captures another scoped widget checkpoint after the five-minute window", async () => {
    vi.useFakeTimers();
    try {
      const context = {
        caller: "mcp-widget-write" as const,
        actionName: "update-file",
        mcpDirectoryWidgetWrite: {
          appId: "design",
          resourceIds: { designId: "design-1" },
          actionNames: ["update-file"],
        },
      };
      await snapshotDesignBeforeAgentEdit("design-1", context);

      captureMocks.liveSnapshot = {
        ...captureMocks.liveSnapshot,
        files: [
          {
            ...captureMocks.liveSnapshot.files[0],
            content: "<main>changed after the widget throttle window</main>",
          },
        ],
      };
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      await snapshotDesignBeforeAgentEdit("design-1", context);

      expect(captureMocks.buildDesignSnapshot).toHaveBeenCalledTimes(2);
      expect(captureMocks.revisions).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["frontend", "mcp-widget-write"],
    ["mcp-widget-write", "frontend"],
  ] as const)(
    "shares the editor checkpoint throttle between %s and %s saves",
    async (firstCaller, secondCaller) => {
      const snapshot = (caller: typeof firstCaller | typeof secondCaller) =>
        caller === "mcp-widget-write"
          ? snapshotDesignBeforeAgentEdit("design-1", {
              caller,
              actionName: "update-file",
              mcpDirectoryWidgetWrite: {
                appId: "design",
                resourceIds: { designId: "design-1" },
                actionNames: ["update-file"],
              },
            })
          : snapshotDesignBeforeAgentEdit("design-1", {
              caller,
              actionName: "update-file",
            });
      const first = await snapshot(firstCaller);

      captureMocks.liveSnapshot = {
        ...captureMocks.liveSnapshot,
        files: [
          {
            ...captureMocks.liveSnapshot.files[0],
            content: "<main>changed between editor surfaces</main>",
          },
        ],
      };
      const second = await snapshot(secondCaller);

      expect(second).toEqual(first);
      expect(captureMocks.buildDesignSnapshot).toHaveBeenCalledTimes(1);
      expect(captureMocks.revisions).toHaveLength(1);
    },
  );

  it("shares the recent failed-checkpoint skip with scoped widget writes", async () => {
    putPrivateBlob.mockResolvedValue(null);
    captureMocks.liveSnapshot = {
      ...captureMocks.liveSnapshot,
      files: [
        {
          ...captureMocks.liveSnapshot.files[0],
          content: "x".repeat(300 * 1024),
        },
      ],
    };
    const context = {
      caller: "mcp-widget-write" as const,
      actionName: "update-file",
      mcpDirectoryWidgetWrite: {
        appId: "design",
        resourceIds: { designId: "design-1" },
        actionNames: ["update-file"],
      },
    };

    const first = await snapshotDesignBeforeAgentEdit("design-1", context, {
      allowCheckpointFailureSkip: true,
    });
    const second = await snapshotDesignBeforeAgentEdit("design-1", context, {
      allowCheckpointFailureSkip: true,
    });

    expect(first).toEqual({
      skipped: true,
      reason: "blob-storage-unavailable",
    });
    expect(second).toEqual(first);
    expect(captureMocks.buildDesignSnapshot).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledTimes(1);
  });

  it("does not throttle a frontend save against a legacy editor checkpoint recorded before caller tracking existed", async () => {
    await snapshotDesignBeforeAgentEdit("design-1", {
      caller: "frontend",
      actionName: "update-file",
    });
    expect(captureMocks.revisions).toHaveLength(1);

    const legacyContext = JSON.parse(
      captureMocks.revisions[0]!.chatContext as string,
    );
    delete legacyContext.caller;
    captureMocks.revisions[0]!.chatContext = JSON.stringify(legacyContext);

    captureMocks.liveSnapshot = {
      ...captureMocks.liveSnapshot,
      files: [
        {
          ...captureMocks.liveSnapshot.files[0],
          content: "<main>frontend edit after a legacy checkpoint</main>",
        },
      ],
    };

    const checkpoint = await snapshotDesignBeforeAgentEdit("design-1", {
      caller: "frontend",
      actionName: "update-file",
    });

    expect(checkpoint).not.toMatchObject({ skipped: true });
    expect(captureMocks.buildDesignSnapshot).toHaveBeenCalledTimes(2);
    expect(captureMocks.revisions).toHaveLength(2);
  });

  it("dedupes a large checkpoint by its stored state hash without reading the blob", async () => {
    const blob = {
      id: "blob-1",
      provider: "test",
      opaque: true as const,
      encrypted: true,
    };
    putPrivateBlob.mockResolvedValue(blob);
    readPrivateBlob.mockReset();
    captureMocks.liveSnapshot = {
      ...captureMocks.liveSnapshot,
      files: [
        {
          ...captureMocks.liveSnapshot.files[0],
          content: "x".repeat(300 * 1024),
        },
      ],
    };

    const first = await createDesignVersionSnapshot("design-1", {
      label: "Chat autosave",
    });
    const same = await createDesignVersionSnapshot("design-1", {
      label: "Chat autosave",
    });

    expect(same).toEqual(first);
    expect(captureMocks.revisions).toHaveLength(1);
    expect(readPrivateBlob).not.toHaveBeenCalled();

    captureMocks.liveSnapshot = {
      ...captureMocks.liveSnapshot,
      files: [
        {
          ...captureMocks.liveSnapshot.files[0],
          content: "y".repeat(300 * 1024),
        },
      ],
    };
    const changed = await createDesignVersionSnapshot("design-1", {
      label: "Chat autosave",
    });

    expect(changed.id).not.toBe(first.id);
    expect(captureMocks.revisions).toHaveLength(2);
    expect(readPrivateBlob).not.toHaveBeenCalled();
  });

  it("still dedupes against a checkpoint written before state hashes", async () => {
    const legacySnapshot = {
      schemaVersion: 1,
      snapshotKind: "design-history",
      designId: "design-1",
      designData: JSON.stringify({ breakpointSet: { breakpoints: [] } }),
      designTitle: "Landing page",
      designDescription: null,
      projectType: "prototype",
      designSystemId: "system-1",
      files: captureMocks.liveSnapshot.files,
      tweaks: [],
      appliedTweaks: {},
      resolvedCssVars: {},
    };
    captureMocks.revisions.push({
      id: "legacy-version",
      designId: "design-1",
      label: "Chat autosave",
      snapshot: JSON.stringify(legacySnapshot),
      chatContext: null,
      createdAt: "2026-07-08T00:00:00.000Z",
    });

    const same = await createDesignVersionSnapshot("design-1", {
      label: "Chat autosave",
    });

    expect(same.id).toBe("legacy-version");
    expect(captureMocks.revisions).toHaveLength(1);
  });
});
