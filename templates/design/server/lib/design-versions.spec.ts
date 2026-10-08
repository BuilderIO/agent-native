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
  assertAccess: vi.fn(),
  buildDesignSnapshot: vi.fn(),
  nanoid: vi.fn(),
}));

vi.mock("@agent-native/core/private-blob", () => ({
  deletePrivateBlob,
  putPrivateBlob,
  readPrivateBlob,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core/collab", () => ({
  AGENT_CLIENT_ID: "agent-client",
  applyText: vi.fn(),
  hasCollabState: vi.fn(),
  loadAwarenessRowsStrict: vi.fn(),
  seedFromText: vi.fn(),
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
  lockDesignSourceMutation: vi.fn(),
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
    designFiles: {},
    designShares: {},
    designs: {},
  };
  const queryResult = (rows: unknown[]) => {
    const result: any = Promise.resolve(rows);
    result.orderBy = () => result;
    result.limit = (limit: number) => queryResult(rows.slice(0, limit));
    return result;
  };
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () =>
          queryResult(
            table === schema.designVersions
              ? captureMocks.revisions.slice(-1)
              : [],
          ),
      }),
    }),
    insert: (table: unknown) => {
      const query: any = {
        values: (value: Record<string, unknown>) => {
          query.value = value;
          return query;
        },
        onConflictDoNothing: () => {
          query.conflicted = captureMocks.forceInsertConflict;
          if (
            table === schema.designVersions &&
            (!captureMocks.forceInsertConflict ||
              captureMocks.persistConcurrentInsertOnConflict) &&
            !captureMocks.revisions.some(
              (revision) => revision.id === query.value.id,
            )
          ) {
            captureMocks.revisions.push(query.value);
          }
          captureMocks.forceInsertConflict = false;
          return query;
        },
        returning: async () => {
          return query.conflicted ? [] : [{ id: query.value.id }];
        },
      };
      return query;
    },
  };
  return { getDb: () => db, schema };
});

import {
  __clearEditorCheckpointSkipsForTests,
  createDesignChatBeginningSnapshot,
  createDesignVersionSnapshot,
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
  captureMocks.assertAccess.mockReset();
  captureMocks.assertAccess.mockImplementation(async () => ({
    resource: { ...captureMocks.design },
  }));
  captureMocks.buildDesignSnapshot.mockReset();
  captureMocks.buildDesignSnapshot.mockImplementation(
    async () => captureMocks.liveSnapshot,
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
  it("coalesces unchanged snapshots but records the next real edit", async () => {
    const first = await createDesignVersionSnapshot("design-1", {
      label: "Chat autosave",
    });
    const same = await createDesignVersionSnapshot("design-1", {
      label: "Chat autosave",
    });

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
    const changed = await createDesignVersionSnapshot("design-1", {
      label: "Chat autosave",
    });

    expect(changed.id).not.toBe(first.id);
    expect(captureMocks.revisions).toHaveLength(2);
  });

  it("captures the start of a chat once per thread", async () => {
    const run = { threadId: 'thread "%_\\path', runId: "run-1" };

    const first = await createDesignChatBeginningSnapshot("design-1", run);
    const retry = await createDesignChatBeginningSnapshot("design-1", run);

    expect(first).not.toBeNull();
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
      undefined,
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

  it("uses the caller transaction for hosted-style checkpoint reads and writes, unthrottled (required mode)", async () => {
    let selectCall = 0;
    const transactionDb = {
      select: () => {
        selectCall += 1;
        const rows =
          selectCall === 1
            ? [{ ...captureMocks.design }]
            : selectCall === 2
              ? []
              : [
                  {
                    id: "checkpoint-1",
                    createdAt: "2026-07-08T00:00:00.000Z",
                    label: "Before editor edit",
                  },
                ];
        const chain = {
          from: () => chain,
          where: () => chain,
          orderBy: () => chain,
          limit: async () => rows,
        };
        return chain;
      },
      insert: () => {
        const query = {
          values: () => query,
          onConflictDoNothing: () => query,
          returning: async () => [{ id: "checkpoint-1" }],
        };
        return query;
      },
    };

    await snapshotDesignBeforeAgentEditInVersionLock(
      "design-1",
      { caller: "frontend", actionName: "delete-file" },
      transactionDb as unknown as NonNullable<
        Parameters<typeof snapshotDesignBeforeAgentEditInVersionLock>[2]
      >,
    );

    expect(captureMocks.buildDesignSnapshot).toHaveBeenCalledWith(
      "design-1",
      expect.any(String),
      undefined,
      transactionDb,
    );
    expect(selectCall).toBe(3);
    expect(captureMocks.revisions).toHaveLength(0);
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
