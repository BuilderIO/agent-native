import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  db: null as Record<string, unknown> | null,
  design: {} as Record<string, unknown>,
  files: [] as Array<Record<string, unknown>>,
  targetVersion: {} as Record<string, unknown>,
  checkpoints: [] as Array<Record<string, unknown>>,
  designVersionSelects: 0,
  designSelects: 0,
  failFinalDesignConfirmation: false,
  failCommitAfterCallback: false,
  currentSnapshot: {
    designId: "design-1",
    files: [
      {
        id: "file-1",
        filename: "index.html",
        fileType: "html",
        content: "<main>current</main>",
        source: "stored" as const,
      },
    ],
    tweaks: [],
    appliedTweaks: {},
    resolvedCssVars: {},
  },
  events: [] as string[],
  buildDesignSnapshot: vi.fn(),
  assertAccess: vi.fn(),
  hasCollabState: vi.fn(),
  seedFromText: vi.fn(),
  writeAppState: vi.fn(),
}));

const schema = vi.hoisted(() => {
  const column = (name: string) => ({ name });
  return {
    designs: {
      id: column("id"),
      data: column("data"),
      title: column("title"),
      description: column("description"),
      projectType: column("projectType"),
      designSystemId: column("designSystemId"),
      updatedAt: column("updatedAt"),
    },
    designFiles: {
      id: column("id"),
      designId: column("designId"),
      filename: column("filename"),
      fileType: column("fileType"),
      content: column("content"),
      updatedAt: column("updatedAt"),
    },
    designVersions: {
      id: column("id"),
      designId: column("designId"),
      snapshot: column("snapshot"),
      label: column("label"),
      chatContext: column("chatContext"),
      fileCount: column("fileCount"),
      createdAt: column("createdAt"),
    },
  };
});

function selectRows(table: unknown): Array<Record<string, unknown>> {
  if (table === schema.designVersions) {
    state.designVersionSelects += 1;
    if (state.designVersionSelects === 1) return [state.targetVersion];
    if (state.designVersionSelects === 2) return [];
    return state.checkpoints.slice(-1);
  }
  if (table === schema.designFiles)
    return state.files.map((file) => ({ ...file }));
  if (table === schema.designs) {
    state.designSelects += 1;
    const design = { ...state.design };
    if (state.failFinalDesignConfirmation && state.designSelects >= 3) {
      design.updatedAt = "wrong-revision";
    }
    return [design];
  }
  return [];
}

function queryChain(tableHolder: { table: unknown }): Record<string, unknown> {
  const chain: Record<string, unknown> = {
    from: (table: unknown) => {
      tableHolder.table = table;
      return chain;
    },
    where: () => chain,
    orderBy: () => chain,
    for: () => chain,
    limit: async () => selectRows(tableHolder.table),
    then: (
      resolve: (value: unknown) => unknown,
      reject?: (error: unknown) => unknown,
    ) => Promise.resolve(selectRows(tableHolder.table)).then(resolve, reject),
  };
  return chain;
}

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: state.writeAppState,
}));

vi.mock("@agent-native/core/collab", () => ({
  AGENT_CLIENT_ID: "agent-client",
  applyText: vi.fn(),
  getText: vi.fn(),
  hasCollabState: state.hasCollabState,
  loadAwarenessRowsStrict: vi.fn(async () => []),
  seedFromText: state.seedFromText,
  withPreparedYDocMutation: async (
    _fileId: string,
    _source: string | undefined,
    callback: (lease: unknown) => Promise<unknown>,
  ) =>
    callback({
      baseVersion: 1,
      doc: {
        getText: () => ({
          toString: () => state.currentSnapshot.files[0]?.content ?? "",
        }),
      },
      persist: vi.fn(),
    }),
}));

vi.mock("@agent-native/core/private-blob", () => ({
  deletePrivateBlob: vi.fn(),
  putPrivateBlob: vi.fn(),
  readPrivateBlob: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: vi.fn(() => "owner@example.com"),
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(() => undefined),
  assertAccess: state.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  asc: (value: unknown) => ({ asc: value }),
  desc: (value: unknown) => ({ desc: value }),
  eq: (left: unknown, right: unknown) => ({ left, right }),
  isNull: (value: unknown) => ({ isNull: value }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
}));

vi.mock("nanoid", () => ({ nanoid: vi.fn(() => "restored-file-id") }));

vi.mock("../source-workspace.js", () => ({
  affectedRowCount: (result: { rowCount?: unknown } | undefined) =>
    typeof result?.rowCount === "number" ? result.rowCount : undefined,
  designSourceMutationLockKey: (designId: string) =>
    `agent-native:design-source:${designId}`,
  getDesignSourceMutationExec: () => ({
    execute: vi.fn(async () => ({ rows: [] })),
  }),
  lockPreparedSourceCollaboration: vi.fn(async () => ({
    hasState: true,
    needsSeed: false,
  })),
  lockDesignSourceMutation: vi.fn(async () => {
    state.events.push("advisory");
  }),
  lockDesignFilesTable: vi.fn(async () => {
    state.events.push("table");
  }),
  readPreparedSourceText: (lease: {
    doc: { getText: () => { toString: () => string } };
  }) => lease.doc.getText().toString(),
  withDesignSourceMutationTransaction: async (
    _designId: string,
    callback: (tx: Record<string, unknown>) => Promise<unknown>,
    outcome?: { callbackCompleted: boolean; rollbackConfirmed: boolean },
  ) => {
    state.events.push("advisory");
    let callbackError: unknown;
    let callbackThrew = false;
    try {
      return await (state.db as any).transaction(
        async (tx: Record<string, unknown>) => {
          try {
            const result = await callback(tx);
            if (outcome) outcome.callbackCompleted = true;
            return result;
          } catch (error) {
            callbackThrew = true;
            callbackError = error;
            throw error;
          }
        },
      );
    } catch (error) {
      if (outcome && callbackThrew && callbackError === error) {
        outcome.rollbackConfirmed = true;
      }
      throw error;
    }
  },
  withSourceFileWriteLock: async (
    _fileId: string,
    work: () => Promise<unknown>,
  ) => {
    state.events.push("file-lock");
    return work();
  },
}));

vi.mock("./design-snapshot.js", () => ({
  buildDesignSnapshot: state.buildDesignSnapshot,
}));

vi.mock("../db/index.js", () => {
  const db: Record<string, unknown> = {
    select: () => queryChain({ table: undefined }),
    insert: () => {
      let values: Record<string, unknown> = {};
      const query = {
        values: (next: Record<string, unknown>) => {
          values = next;
          return query;
        },
        onConflictDoNothing: () => {
          state.events.push("checkpoint");
          state.checkpoints.push({ ...values });
          return query;
        },
        returning: async () => [{ id: values.id }],
      };
      return query;
    },
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          if (table === schema.designFiles) {
            Object.assign(state.files[0]!, values);
            state.events.push("file-update");
          } else if (table === schema.designs) {
            Object.assign(state.design, values);
            state.events.push("design-update");
          }
          return { rowCount: 1 };
        },
      }),
    }),
    delete: () => ({ where: async () => ({ rowCount: 1 }) }),
    execute: async () => ({ rows: [] }),
    transaction: async (
      callback: (tx: Record<string, unknown>) => Promise<unknown>,
    ) => {
      state.events.push("transaction");
      const files = state.files.map((file) => ({ ...file }));
      const design = { ...state.design };
      const checkpoints = state.checkpoints.map((checkpoint) => ({
        ...checkpoint,
      }));
      try {
        const result = await callback(db);
        if (state.failCommitAfterCallback) {
          state.failCommitAfterCallback = false;
          throw new Error("commit outcome unknown");
        }
        return result;
      } catch (error) {
        state.files = files;
        state.design = design;
        state.checkpoints = checkpoints;
        throw error;
      }
    },
  };
  state.db = db;
  return { getDb: () => db, schema };
});

import { restoreDesignVersion } from "./design-versions.js";

beforeEach(() => {
  vi.clearAllMocks();
  state.events = [];
  state.files = [
    {
      id: "file-1",
      designId: "design-1",
      filename: "index.html",
      fileType: "html",
      content: "<main>current</main>",
      createdAt: "2026-07-08T00:00:00.000Z",
      updatedAt: "2026-07-08T00:00:00.000Z",
    },
  ];
  state.design = {
    id: "design-1",
    data: JSON.stringify({}),
    title: "Landing page",
    description: null,
    projectType: "prototype",
    designSystemId: null,
    updatedAt: "2026-07-08T00:00:00.000Z",
    ownerEmail: "owner@example.com",
  };
  state.targetVersion = {
    id: "version-1",
    designId: "design-1",
    snapshot: JSON.stringify({
      schemaVersion: 1,
      snapshotKind: "design-history",
      designId: "design-1",
      designData: JSON.stringify({}),
      designTitle: "Landing page",
      designDescription: null,
      projectType: "prototype",
      designSystemId: null,
      files: [
        {
          id: "file-1",
          filename: "index.html",
          fileType: "html",
          content: "<main>restored</main>",
        },
      ],
    }),
  };
  state.checkpoints = [];
  state.designVersionSelects = 0;
  state.designSelects = 0;
  state.failFinalDesignConfirmation = false;
  state.failCommitAfterCallback = false;
  state.assertAccess.mockResolvedValue({ resource: { ...state.design } });
  state.hasCollabState.mockResolvedValue(true);
  state.buildDesignSnapshot.mockImplementation(async (...args: unknown[]) => {
    state.events.push("snapshot");
    return state.currentSnapshot;
  });
});

describe("restoreDesignVersion transaction boundary", () => {
  it("captures Before restore on the active transaction before rewriting files", async () => {
    const result = await restoreDesignVersion({
      designId: "design-1",
      versionId: "version-1",
    });

    expect(result.restoredFileCount).toBe(1);
    expect(state.files[0]?.content).toBe("<main>restored</main>");
    expect(state.checkpoints).toHaveLength(1);
    expect(state.events.indexOf("snapshot")).toBeLessThan(
      state.events.indexOf("transaction"),
    );
    expect(state.events.indexOf("advisory")).toBeLessThan(
      state.events.indexOf("table"),
    );
    expect(state.events.indexOf("table")).toBeLessThan(
      state.events.indexOf("checkpoint"),
    );
    expect(state.events.indexOf("checkpoint")).toBeLessThan(
      state.events.indexOf("file-update"),
    );
    expect(state.buildDesignSnapshot).toHaveBeenCalledWith(
      "design-1",
      expect.any(String),
      {
        preparedFiles: [
          expect.objectContaining({ id: "file-1", source: "collab" }),
        ],
      },
    );
  });

  it("preserves a staged blob when the database commit outcome is unknown", async () => {
    const blob = {
      id: "staged-blob",
      provider: "test",
      opaque: true as const,
      encrypted: true,
    };
    state.currentSnapshot = {
      ...state.currentSnapshot,
      files: [
        {
          ...state.currentSnapshot.files[0]!,
          content: "x".repeat(300 * 1024),
        },
      ],
    };
    state.failCommitAfterCallback = true;
    const privateBlob = await import("@agent-native/core/private-blob");
    vi.mocked(privateBlob.putPrivateBlob).mockResolvedValue(blob);
    vi.mocked(privateBlob.deletePrivateBlob).mockResolvedValue({
      deleted: true,
      provider: "test",
    });

    await expect(
      restoreDesignVersion({
        designId: "design-1",
        versionId: "version-1",
      }),
    ).rejects.toThrow("commit outcome unknown");

    expect(state.checkpoints).toEqual([]);
    expect(state.files[0]?.content).toBe("<main>current</main>");
    expect(privateBlob.deletePrivateBlob).not.toHaveBeenCalled();
  });

  it("deletes the staged blob after a confirmed callback rollback", async () => {
    const blob = {
      id: "staged-blob",
      provider: "test",
      opaque: true as const,
      encrypted: true,
    };
    state.currentSnapshot = {
      ...state.currentSnapshot,
      files: [
        {
          ...state.currentSnapshot.files[0]!,
          content: "x".repeat(300 * 1024),
        },
      ],
    };
    state.failFinalDesignConfirmation = true;
    const privateBlob = await import("@agent-native/core/private-blob");
    vi.mocked(privateBlob.putPrivateBlob).mockResolvedValue(blob);
    vi.mocked(privateBlob.deletePrivateBlob).mockResolvedValue({
      deleted: true,
      provider: "test",
    });

    await expect(
      restoreDesignVersion({
        designId: "design-1",
        versionId: "version-1",
      }),
    ).rejects.toThrow(/Design changed while history was being restored/i);

    expect(state.checkpoints).toEqual([]);
    expect(privateBlob.deletePrivateBlob).toHaveBeenCalledWith(blob);
  });

  it("rolls back the checkpoint and file rewrite when the design CAS fails", async () => {
    state.failFinalDesignConfirmation = true;

    await expect(
      restoreDesignVersion({
        designId: "design-1",
        versionId: "version-1",
      }),
    ).rejects.toThrow(/Design changed while history was being restored/i);

    expect(state.checkpoints).toEqual([]);
    expect(state.files[0]?.content).toBe("<main>current</main>");
  });
});
