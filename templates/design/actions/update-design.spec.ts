import { beforeEach, describe, expect, it, vi } from "vitest";

import { screenRestoreContentHashes } from "../server/lib/screen-restore-claims.js";
import { annotateScreenHtmlForPersist } from "../shared/screen-annotation.js";

type Predicate =
  | { kind: "eq"; left: unknown; right: unknown }
  | { kind: "and"; conditions: Predicate[] }
  | { kind: "isNull"; value: unknown }
  | { kind: "inArray"; value: unknown; values: unknown[] };

interface ConnectionRow {
  id: string;
  ownerEmail: string;
  orgId: string | null;
}

interface DesignRow {
  id: string;
  title: string;
  data: string | null;
  dataOperationRevisions: string | null;
  updatedAt: string;
}

interface RestoreClaimRow {
  id: string;
  designId: string;
  sourceFileId: string;
  snapshot: string;
  consumedAt: string | null;
  restoredFileId: string | null;
}

interface DesignFileRow {
  id: string;
  designId: string;
  filename: string;
  fileType: string;
  content: string;
}

type ResultShape =
  | "rowsAffected"
  | "affectedRows"
  | "rowCount"
  | "count"
  | "changes"
  | "d1-meta"
  | "missing";

const mocks = vi.hoisted(() => {
  const state = {
    row: {
      id: "design-1",
      title: "Untitled",
      data: "{}",
      dataOperationRevisions: "{}",
      updatedAt: "2026-07-09T00:00:00.000Z",
    } as DesignRow,
    gatedReadsRemaining: 0,
    gatedReadCount: 0,
    releaseGatedReads: null as (() => void) | null,
    resultShape: "changes" as ResultShape,
    connections: [] as ConnectionRow[],
    restoreClaims: [] as RestoreClaimRow[],
    designFiles: [] as DesignFileRow[],
    selectForUpdateTables: [] as string[],
    resolveScope: vi.fn(),
  };

  const resetReadGate = (count: number) => {
    state.gatedReadsRemaining = count;
    state.gatedReadCount = 0;
    state.releaseGatedReads = null;
  };

  const waitAtReadGate = async () => {
    if (state.gatedReadsRemaining <= 0) return;
    state.gatedReadsRemaining -= 1;
    state.gatedReadCount += 1;
    if (state.gatedReadCount === 2) {
      state.releaseGatedReads?.();
      return;
    }
    await new Promise<void>((resolve) => {
      state.releaseGatedReads = resolve;
    });
  };

  return {
    state,
    resetReadGate,
    waitAtReadGate,
    assertAccess: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
  fail: (message: string, options: Record<string, unknown>) => {
    throw Object.assign(new Error(message), options);
  },
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  eq: (left: unknown, right: unknown): Predicate => ({
    kind: "eq",
    left,
    right,
  }),
  and: (...conditions: Predicate[]): Predicate => ({
    kind: "and",
    conditions,
  }),
  sql: vi.fn(),
  isNull: (value: unknown): Predicate => ({ kind: "isNull", value }),
  inArray: (value: unknown, values: unknown[]): Predicate => ({
    kind: "inArray",
    value,
    values,
  }),
}));

vi.mock("../server/lib/localhost-connection.js", () => ({
  resolveLocalhostConnectionScope: mocks.state.resolveScope,
}));

vi.mock("../server/db/index.js", () => {
  const schema = {
    designs: {
      id: "designs.id",
      data: "designs.data",
      dataOperationRevisions: "designs.dataOperationRevisions",
    },
    designLocalhostConnections: {
      id: "connections.id",
      ownerEmail: "connections.ownerEmail",
      orgId: "connections.orgId",
    },
    designScreenRestoreClaims: {
      id: "restoreClaims.id",
      designId: "restoreClaims.designId",
      sourceFileId: "restoreClaims.sourceFileId",
      snapshot: "restoreClaims.snapshot",
      consumedAt: "restoreClaims.consumedAt",
      restoredFileId: "restoreClaims.restoredFileId",
    },
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      fileType: "designFiles.fileType",
      content: "designFiles.content",
    },
  };

  const matches = (
    predicate: Predicate,
    row: DesignRow | ConnectionRow | RestoreClaimRow | DesignFileRow,
  ): boolean => {
    if (predicate.kind === "and") {
      return predicate.conditions.every((condition) => matches(condition, row));
    }
    if (predicate.kind === "inArray") {
      return (
        [
          schema.designLocalhostConnections.id,
          schema.designScreenRestoreClaims.id,
          schema.designFiles.id,
        ].includes(predicate.value as string) &&
        predicate.values.includes(row.id)
      );
    }
    if (predicate.kind === "isNull") {
      if (predicate.value === schema.designLocalhostConnections.orgId) {
        return "orgId" in row && row.orgId === null;
      }
      if (predicate.value === schema.designs.data) {
        return "data" in row && row.data === null;
      }
      if (predicate.value === schema.designs.dataOperationRevisions) {
        return (
          "dataOperationRevisions" in row && row.dataOperationRevisions === null
        );
      }
      if (predicate.value === schema.designScreenRestoreClaims.consumedAt) {
        return "consumedAt" in row && row.consumedAt === null;
      }
      return true;
    }
    if (predicate.left === schema.designLocalhostConnections.id) {
      return "id" in row && row.id === predicate.right;
    }
    if (predicate.left === schema.designLocalhostConnections.ownerEmail) {
      return "ownerEmail" in row && row.ownerEmail === predicate.right;
    }
    if (predicate.left === schema.designLocalhostConnections.orgId) {
      return "orgId" in row && row.orgId === predicate.right;
    }
    if (
      predicate.left === schema.designScreenRestoreClaims.id ||
      predicate.left === schema.designFiles.id
    ) {
      return "id" in row && row.id === predicate.right;
    }
    if (
      predicate.left === schema.designScreenRestoreClaims.designId ||
      predicate.left === schema.designFiles.designId
    ) {
      return "designId" in row && row.designId === predicate.right;
    }
    if (predicate.left === schema.designScreenRestoreClaims.consumedAt) {
      return "consumedAt" in row && row.consumedAt === predicate.right;
    }
    if (predicate.left === schema.designScreenRestoreClaims.sourceFileId) {
      return "sourceFileId" in row && row.sourceFileId === predicate.right;
    }
    if (predicate.left === schema.designs.id) {
      return row.id === predicate.right;
    }
    if (predicate.left === schema.designs.data) {
      return "data" in row && row.data === predicate.right;
    }
    if (predicate.left === schema.designs.dataOperationRevisions) {
      return (
        "dataOperationRevisions" in row &&
        row.dataOperationRevisions === predicate.right
      );
    }
    return true;
  };

  const select = () => ({
    from: (table: unknown) => ({
      where: (predicate: Predicate) => {
        const result = (async () => {
          if (table === schema.designLocalhostConnections) {
            return mocks.state.connections.filter((connection) =>
              matches(predicate, connection),
            );
          }
          if (table === schema.designScreenRestoreClaims) {
            return mocks.state.restoreClaims.filter((claim) =>
              matches(predicate, claim),
            );
          }
          if (table === schema.designFiles) {
            return mocks.state.designFiles.filter((file) =>
              matches(predicate, file),
            );
          }
          const snapshot = { ...mocks.state.row };
          await mocks.waitAtReadGate();
          return matches(predicate, snapshot)
            ? [
                {
                  id: snapshot.id,
                  data: snapshot.data,
                  dataOperationRevisions: snapshot.dataOperationRevisions,
                },
              ]
            : [];
        })();
        return Object.assign(result, {
          for: (lock: "update") => {
            if (lock === "update" && table === schema.designFiles) {
              mocks.state.selectForUpdateTables.push("designFiles");
            }
            return result;
          },
        });
      },
    }),
  });

  const update = (table: unknown) => ({
    set: (updates: Partial<DesignRow>) => ({
      where: async (predicate: Predicate) => {
        if (table === schema.designScreenRestoreClaims) {
          let affected = 0;
          for (const claim of mocks.state.restoreClaims) {
            if (matches(predicate, claim)) {
              Object.assign(claim, updates);
              affected += 1;
            }
          }
          return { changes: affected };
        }
        const affected = matches(predicate, mocks.state.row) ? 1 : 0;
        if (affected > 0) Object.assign(mocks.state.row, updates);
        switch (mocks.state.resultShape) {
          case "rowsAffected":
            return { rowsAffected: affected };
          case "affectedRows":
            return { affectedRows: affected };
          case "rowCount":
            return { rowCount: affected };
          case "count":
            return { count: affected };
          case "changes":
            return { changes: affected };
          case "d1-meta":
            return { meta: { changes: affected } };
          case "missing":
            return {};
        }
      },
    }),
  });

  const tx = { select, update };
  const db = {
    select,
    update,
    transaction: async (run: (transaction: typeof tx) => Promise<unknown>) =>
      run(tx),
  };

  return { getDb: () => db, schema };
});

import action from "./update-design.js";

const BASE_DATA = {
  canvasFrames: {
    "frame-a": { x: 0, y: 0, width: 400, height: 300 },
    "frame-b": { x: 500, y: 0, width: 400, height: 300 },
  },
  screenMetadata: {
    "frame-a": { title: "A" },
    "frame-b": { title: "B" },
  },
};

describe("update-design data concurrency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.row = {
      id: "design-1",
      title: "Untitled",
      data: JSON.stringify(BASE_DATA),
      dataOperationRevisions: "{}",
      updatedAt: "2026-07-09T00:00:00.000Z",
    };
    mocks.resetReadGate(0);
    mocks.state.resultShape = "changes";
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.state.connections = [];
    mocks.state.restoreClaims = [];
    mocks.state.designFiles = [];
    mocks.state.selectForUpdateTables = [];
    mocks.state.resolveScope.mockReset();
    mocks.state.resolveScope.mockResolvedValue({
      ownerEmail: "editor@example.com",
      orgId: null,
    });
  });

  it("accepts a restore claim for every file in the supported delete batch", () => {
    const restoreClaims = Array.from({ length: 101 }, (_, index) => ({
      claimId: `claim-${index}`,
      sourceFileId: `source-${index}`,
      targetFileId: `target-${index}`,
    }));
    const input = {
      id: "design-1",
      dataOperations: [
        {
          op: "set",
          path: ["canvasFrames", "frame-a"],
          value: { x: 0, y: 0, width: 400, height: 300 },
        },
      ],
      restoreClaims,
      operationSource: "restore-batch-test",
      operationRevision: 1,
    };

    expect(action.schema.safeParse(input).success).toBe(true);
    expect(
      action.schema.safeParse({
        ...input,
        restoreClaims: [
          ...restoreClaims,
          {
            claimId: "claim-101",
            sourceFileId: "source-101",
            targetFileId: "target-101",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects an ID-only update instead of reporting a content change", async () => {
    const previousUpdatedAt = mocks.state.row.updatedAt;

    await expect(action.run({ id: "design-1" } as never)).rejects.toThrow(
      "At least one design field or data operation is required.",
    );
    expect(mocks.state.row.updatedAt).toBe(previousUpdatedAt);
  });

  it("rejects a shared editor adding another user's localhost connection", async () => {
    mocks.assertAccess.mockResolvedValueOnce({ role: "editor" });
    mocks.state.connections = [
      {
        id: "owner-connection",
        ownerEmail: "design-owner@example.com",
        orgId: null,
      },
    ];

    await expect(
      action.run({
        id: "design-1",
        dataOperations: [
          {
            op: "set",
            path: ["screenMetadata", "frame-a"],
            value: { title: "A", connectionId: "owner-connection" },
          },
        ],
      } as never),
    ).rejects.toMatchObject({
      message:
        "Only local app connections in your workspace can be added to this design.",
      statusCode: 403,
    });

    expect(JSON.parse(mocks.state.row.data!)).toEqual(BASE_DATA);
  });

  it("rejects assigning a foreign connection to another Screen in the same design", async () => {
    mocks.assertAccess.mockResolvedValueOnce({ role: "editor" });
    mocks.state.connections = [
      {
        id: "owner-connection",
        ownerEmail: "design-owner@example.com",
        orgId: null,
      },
    ];
    mocks.state.row.data = JSON.stringify({
      ...BASE_DATA,
      screenMetadata: {
        ...BASE_DATA.screenMetadata,
        "frame-a": { title: "A", connectionId: "owner-connection" },
      },
    });

    await expect(
      action.run({
        id: "design-1",
        dataOperations: [
          {
            op: "set",
            path: ["screenMetadata", "frame-b"],
            value: { title: "B", connectionId: "owner-connection" },
          },
        ],
      } as never),
    ).rejects.toMatchObject({
      message:
        "Only local app connections in your workspace can be added to this design.",
      statusCode: 403,
    });
  });

  it("allows a shared editor to copy an existing Screen connection to its duplicate", async () => {
    mocks.assertAccess.mockResolvedValueOnce({ role: "editor" });
    mocks.state.connections = [
      {
        id: "owner-connection",
        ownerEmail: "design-owner@example.com",
        orgId: null,
      },
    ];
    mocks.state.row.data = JSON.stringify({
      ...BASE_DATA,
      screenMetadata: {
        ...BASE_DATA.screenMetadata,
        source: { title: "Source", connectionId: "owner-connection" },
      },
    });
    mocks.state.designFiles = [
      {
        id: "source",
        designId: "design-1",
        filename: "source.html",
        fileType: "html",
        content: "<main>Source</main>",
      },
      {
        id: "copy",
        designId: "design-1",
        filename: "source copy.html",
        fileType: "html",
        content: "<main>Source</main>",
      },
    ];

    await expect(
      action.run({
        id: "design-1",
        duplicateSourceFileId: "source",
        dataOperations: [
          {
            op: "set",
            path: ["screenMetadata", "copy"],
            value: { title: "Copy", connectionId: "owner-connection" },
          },
        ],
      } as never),
    ).resolves.toMatchObject({ changed: true });

    expect(
      JSON.parse(mocks.state.row.data!).screenMetadata.copy.connectionId,
    ).toBe("owner-connection");
  });

  it("does not turn a connection-scope service failure into an authorization error", async () => {
    mocks.assertAccess.mockResolvedValueOnce({ role: "editor" });
    mocks.state.resolveScope.mockRejectedValueOnce(
      new Error("workspace lookup unavailable"),
    );

    await expect(
      action.run({
        id: "design-1",
        dataOperations: [
          {
            op: "set",
            path: ["screenMetadata", "frame-a"],
            value: { title: "A", connectionId: "editor-connection" },
          },
        ],
      } as never),
    ).rejects.toThrow("workspace lookup unavailable");
  });

  it("allows a shared editor to add their own localhost connection", async () => {
    mocks.assertAccess.mockResolvedValueOnce({ role: "editor" });
    mocks.state.connections = [
      {
        id: "editor-connection",
        ownerEmail: "editor@example.com",
        orgId: null,
      },
    ];

    await expect(
      action.run({
        id: "design-1",
        dataOperations: [
          {
            op: "set",
            path: ["screenMetadata", "frame-a"],
            value: { title: "A", connectionId: "editor-connection" },
          },
        ],
      } as never),
    ).resolves.toMatchObject({ changed: true });

    expect(
      JSON.parse(mocks.state.row.data!).screenMetadata["frame-a"].connectionId,
    ).toBe("editor-connection");
  });

  it("allows the design owner to add a local app connection", async () => {
    mocks.assertAccess.mockResolvedValueOnce({ role: "owner" });

    await expect(
      action.run({
        id: "design-1",
        dataOperations: [
          {
            op: "set",
            path: ["screenMetadata", "frame-a"],
            value: { title: "A", connectionId: "owner-connection" },
          },
        ],
      } as never),
    ).resolves.toMatchObject({ changed: true });

    expect(
      JSON.parse(mocks.state.row.data!).screenMetadata["frame-a"].connectionId,
    ).toBe("owner-connection");
  });

  it("allows exact one-use restoration of deleted Screen connection metadata", async () => {
    const snapshot = {
      filename: "restored.html",
      fileType: "html",
      content: "<html><body><main>Restored</main></body></html>",
      screenMetadata: {
        title: "Restored",
        connectionId: "owner-connection",
      },
    };
    const claimSnapshot = {
      filename: snapshot.filename,
      fileType: snapshot.fileType,
      contentHashes: screenRestoreContentHashes(
        snapshot.content,
        snapshot.fileType,
      ),
      screenMetadata: snapshot.screenMetadata,
    };
    const editedMetadata = {
      ...snapshot.screenMetadata,
      title: "Renamed after restore",
      description: "Preserved while the restore is pending",
    };
    mocks.assertAccess.mockResolvedValueOnce({ role: "editor" });
    mocks.state.connections = [
      {
        id: "owner-connection",
        ownerEmail: "design-owner@example.com",
        orgId: null,
      },
    ];
    mocks.state.restoreClaims = [
      {
        id: "restore-claim-1",
        designId: "design-1",
        sourceFileId: "deleted-file-1",
        snapshot: JSON.stringify(claimSnapshot),
        consumedAt: null,
        restoredFileId: "restored-file-1",
      },
    ];
    mocks.state.designFiles = [
      {
        id: "restored-file-1",
        designId: "design-1",
        filename: snapshot.filename,
        fileType: snapshot.fileType,
        content: annotateScreenHtmlForPersist(
          snapshot.content,
          snapshot.fileType,
        ),
      },
    ];

    await expect(
      action.run({
        id: "design-1",
        dataOperations: [
          {
            op: "set",
            path: ["screenMetadata", "restored-file-1"],
            value: editedMetadata,
          },
          {
            op: "set",
            path: ["screenMetadata", "frame-b"],
            value: { title: "B", connectionId: "owner-connection" },
          },
        ],
        restoreClaims: [
          {
            claimId: "restore-claim-1",
            sourceFileId: "deleted-file-1",
            targetFileId: "restored-file-1",
          },
        ],
        operationSource: "undo-session",
        operationRevision: 1,
      } as never),
    ).rejects.toMatchObject({
      errorCode: "localhost_connection_scope_mismatch",
      statusCode: 403,
      details: { restoreTargetFileIds: [] },
    });
    expect(mocks.state.restoreClaims[0]?.consumedAt).toBeNull();

    mocks.assertAccess.mockResolvedValueOnce({ role: "editor" });
    await expect(
      action.run({
        id: "design-1",
        dataOperations: [
          {
            op: "set",
            path: ["screenMetadata", "restored-file-1"],
            value: editedMetadata,
          },
        ],
        restoreClaims: [
          {
            claimId: "restore-claim-1",
            sourceFileId: "deleted-file-1",
            targetFileId: "restored-file-1",
          },
        ],
        operationSource: "undo-session",
        operationRevision: 1,
      } as never),
    ).resolves.toMatchObject({ changed: true });
    expect(mocks.state.selectForUpdateTables).toContain("designFiles");
    expect(
      JSON.parse(mocks.state.row.data!).screenMetadata["restored-file-1"],
    ).toEqual(editedMetadata);
    expect(mocks.state.restoreClaims[0]).toMatchObject({
      restoredFileId: "restored-file-1",
    });
    expect(mocks.state.restoreClaims[0]?.consumedAt).toEqual(
      expect.any(String),
    );

    mocks.state.designFiles.push({
      id: "restored-file-2",
      designId: "design-1",
      filename: snapshot.filename,
      fileType: snapshot.fileType,
      content: annotateScreenHtmlForPersist(
        snapshot.content,
        snapshot.fileType,
      ),
    });
    mocks.assertAccess.mockResolvedValueOnce({ role: "editor" });
    await expect(
      action.run({
        id: "design-1",
        dataOperations: [
          {
            op: "set",
            path: ["screenMetadata", "restored-file-2"],
            value: snapshot.screenMetadata,
          },
        ],
        restoreClaims: [
          {
            claimId: "restore-claim-1",
            sourceFileId: "deleted-file-1",
            targetFileId: "restored-file-2",
          },
        ],
        operationSource: "undo-session",
        operationRevision: 2,
      } as never),
    ).rejects.toMatchObject({
      errorCode: "localhost_connection_scope_mismatch",
      statusCode: 403,
      details: { restoreTargetFileIds: ["restored-file-2"] },
    });
  });

  it("rejects a restore claim that is not bound to the target Screen", async () => {
    const snapshot = {
      filename: "restored.html",
      fileType: "html",
      content: "<html><body><main>Restored</main></body></html>",
      screenMetadata: {
        title: "Restored",
        connectionId: "owner-connection",
      },
    };
    mocks.assertAccess.mockResolvedValue({ role: "editor" });
    mocks.state.connections = [
      {
        id: "owner-connection",
        ownerEmail: "design-owner@example.com",
        orgId: null,
      },
    ];
    mocks.state.restoreClaims = [
      {
        id: "restore-claim-1",
        designId: "design-1",
        sourceFileId: "deleted-file-1",
        snapshot: JSON.stringify({
          filename: snapshot.filename,
          fileType: snapshot.fileType,
          contentHashes: screenRestoreContentHashes(
            snapshot.content,
            snapshot.fileType,
          ),
          screenMetadata: snapshot.screenMetadata,
        }),
        consumedAt: null,
        restoredFileId: null,
      },
    ];
    mocks.state.designFiles = [
      {
        id: "restored-file-1",
        designId: "design-1",
        filename: snapshot.filename,
        fileType: snapshot.fileType,
        content: annotateScreenHtmlForPersist(
          "<html><body><main>Changed</main></body></html>",
          snapshot.fileType,
        ),
      },
    ];

    await expect(
      action.run({
        id: "design-1",
        dataOperations: [
          {
            op: "set",
            path: ["screenMetadata", "restored-file-1"],
            value: snapshot.screenMetadata,
          },
        ],
        restoreClaims: [
          {
            claimId: "restore-claim-1",
            sourceFileId: "deleted-file-1",
            targetFileId: "restored-file-1",
          },
        ],
        operationSource: "undo-session",
        operationRevision: 1,
      } as never),
    ).rejects.toMatchObject({
      errorCode: "localhost_connection_scope_mismatch",
      statusCode: 403,
    });
    expect(mocks.state.restoreClaims[0]?.consumedAt).toBeNull();
  });

  it("does not let a pending restore claim block unrelated design data", async () => {
    const snapshot = {
      filename: "restored.html",
      fileType: "html",
      content: "<html><body><main>Restored</main></body></html>",
      screenMetadata: {
        title: "Restored",
        connectionId: "owner-connection",
      },
    };
    mocks.assertAccess.mockResolvedValue({ role: "editor" });
    mocks.state.restoreClaims = [
      {
        id: "restore-claim-1",
        designId: "design-1",
        sourceFileId: "deleted-file-1",
        snapshot: JSON.stringify({
          filename: snapshot.filename,
          fileType: snapshot.fileType,
          contentHashes: screenRestoreContentHashes(
            snapshot.content,
            snapshot.fileType,
          ),
          screenMetadata: snapshot.screenMetadata,
        }),
        consumedAt: null,
        restoredFileId: null,
      },
    ];

    await expect(
      action.run({
        id: "design-1",
        dataOperations: [
          {
            op: "set",
            path: ["canvasFrames", "frame-a"],
            value: { x: 40, y: 0, width: 400, height: 300 },
          },
        ],
        restoreClaims: [
          {
            claimId: "restore-claim-1",
            sourceFileId: "deleted-file-1",
            targetFileId: "deleted-file-1",
          },
        ],
        operationSource: "undo-session",
        operationRevision: 2,
      } as never),
    ).resolves.toMatchObject({ changed: true });

    expect(JSON.parse(mocks.state.row.data!).canvasFrames["frame-a"].x).toBe(
      40,
    );
    expect(mocks.state.restoreClaims[0]?.consumedAt).toBeNull();
  });

  it("rejects a restored connection when the restored Screen content changes before save", async () => {
    const snapshot = {
      filename: "restored.html",
      fileType: "html",
      content: "<html><body><main>Restored</main></body></html>",
      screenMetadata: {
        title: "Restored",
        connectionId: "owner-connection",
      },
    };
    mocks.assertAccess.mockResolvedValue({ role: "editor" });
    mocks.state.connections = [
      {
        id: "owner-connection",
        ownerEmail: "design-owner@example.com",
        orgId: null,
      },
    ];
    mocks.state.restoreClaims = [
      {
        id: "restore-claim-1",
        designId: "design-1",
        sourceFileId: "deleted-file-1",
        snapshot: JSON.stringify({
          filename: snapshot.filename,
          fileType: snapshot.fileType,
          contentHashes: screenRestoreContentHashes(
            snapshot.content,
            snapshot.fileType,
          ),
          screenMetadata: snapshot.screenMetadata,
        }),
        consumedAt: null,
        restoredFileId: "restored-file-1",
      },
    ];
    mocks.state.designFiles = [
      {
        id: "restored-file-1",
        designId: "design-1",
        filename: snapshot.filename,
        fileType: snapshot.fileType,
        content: annotateScreenHtmlForPersist(
          "<html><body><main>Edited</main></body></html>",
          snapshot.fileType,
        ),
      },
    ];

    await expect(
      action.run({
        id: "design-1",
        dataOperations: [
          {
            op: "set",
            path: ["screenMetadata", "restored-file-1"],
            value: {
              title: "Edited after Undo",
              connectionId: "owner-connection",
            },
          },
        ],
        restoreClaims: [
          {
            claimId: "restore-claim-1",
            sourceFileId: "deleted-file-1",
            targetFileId: "restored-file-1",
          },
        ],
        operationSource: "undo-session",
        operationRevision: 2,
      } as never),
    ).rejects.toMatchObject({
      errorCode: "localhost_connection_scope_mismatch",
      statusCode: 403,
    });
    expect(mocks.state.restoreClaims[0]?.consumedAt).toBeNull();
    expect(
      JSON.parse(mocks.state.row.data!).screenMetadata["restored-file-1"],
    ).toBeUndefined();
  });

  it("does not let a consumed restore claim reapply a removed connection", async () => {
    const snapshot = {
      filename: "restored.html",
      fileType: "html",
      content: "<html><body><main>Restored</main></body></html>",
      screenMetadata: {
        title: "Restored",
        connectionId: "owner-connection",
      },
    };
    mocks.assertAccess.mockResolvedValue({ role: "editor" });
    mocks.state.connections = [
      {
        id: "owner-connection",
        ownerEmail: "design-owner@example.com",
        orgId: null,
      },
    ];
    mocks.state.restoreClaims = [
      {
        id: "restore-claim-1",
        designId: "design-1",
        sourceFileId: "deleted-file-1",
        snapshot: JSON.stringify({
          filename: snapshot.filename,
          fileType: snapshot.fileType,
          contentHashes: screenRestoreContentHashes(
            snapshot.content,
            snapshot.fileType,
          ),
          screenMetadata: snapshot.screenMetadata,
        }),
        consumedAt: "2026-10-08T00:00:00.000Z",
        restoredFileId: "deleted-file-1",
      },
    ];
    mocks.state.designFiles = [
      {
        id: "deleted-file-1",
        designId: "design-1",
        filename: snapshot.filename,
        fileType: snapshot.fileType,
        content: annotateScreenHtmlForPersist(
          snapshot.content,
          snapshot.fileType,
        ),
      },
    ];

    await expect(
      action.run({
        id: "design-1",
        dataOperations: [
          {
            op: "set",
            path: ["screenMetadata", "deleted-file-1"],
            value: snapshot.screenMetadata,
          },
        ],
        restoreClaims: [
          {
            claimId: "restore-claim-1",
            sourceFileId: "deleted-file-1",
            targetFileId: "deleted-file-1",
          },
        ],
        operationSource: "undo-session",
        operationRevision: 3,
      } as never),
    ).rejects.toMatchObject({
      errorCode: "localhost_connection_scope_mismatch",
      statusCode: 403,
    });
  });

  it("rejects one ambiguous legacy snapshot instead of silently losing a concurrent frame edit", async () => {
    mocks.resetReadGate(2);
    const moveA = {
      ...BASE_DATA,
      canvasFrames: {
        ...BASE_DATA.canvasFrames,
        "frame-a": { ...BASE_DATA.canvasFrames["frame-a"], x: 40 },
      },
    };
    const moveB = {
      ...BASE_DATA,
      canvasFrames: {
        ...BASE_DATA.canvasFrames,
        "frame-b": { ...BASE_DATA.canvasFrames["frame-b"], x: 560 },
      },
    };

    const results = await Promise.allSettled([
      action.run({ id: "design-1", data: JSON.stringify(moveA) } as never),
      action.run({ id: "design-1", data: JSON.stringify(moveB) } as never),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(Error);
    expect((rejected?.reason as Error).message).toContain(
      "Design data changed while this snapshot was being saved",
    );
    const persisted = JSON.parse(mocks.state.row.data!) as typeof BASE_DATA;
    expect([
      [40, 500],
      [0, 560],
    ]).toContainEqual([
      persisted.canvasFrames["frame-a"].x,
      persisted.canvasFrames["frame-b"].x,
    ]);
  });

  it("CAS-retries explicit path operations so concurrent edits to different frame entries both persist", async () => {
    mocks.resetReadGate(2);

    await Promise.all([
      action.run({
        id: "design-1",
        dataOperations: [
          {
            op: "set",
            path: ["canvasFrames", "frame-a"],
            value: { ...BASE_DATA.canvasFrames["frame-a"], x: 40 },
          },
        ],
      } as never),
      action.run({
        id: "design-1",
        dataOperations: [
          {
            op: "set",
            path: ["canvasFrames", "frame-b"],
            value: { ...BASE_DATA.canvasFrames["frame-b"], x: 560 },
          },
        ],
      } as never),
    ]);

    const persisted = JSON.parse(mocks.state.row.data!) as typeof BASE_DATA;
    expect(persisted.canvasFrames["frame-a"].x).toBe(40);
    expect(persisted.canvasFrames["frame-b"].x).toBe(560);
  });

  it("rejects an older same-client operation that arrives after a newer keepalive", async () => {
    const newer = await action.run({
      id: "design-1",
      dataOperations: [
        {
          op: "set",
          path: ["canvasFrames", "frame-a"],
          value: { ...BASE_DATA.canvasFrames["frame-a"], x: 80 },
        },
      ],
      operationSource: "tab-a",
      operationRevision: 2,
    } as never);
    const stale = await action.run({
      id: "design-1",
      dataOperations: [
        {
          op: "set",
          path: ["canvasFrames", "frame-a"],
          value: { ...BASE_DATA.canvasFrames["frame-a"], x: 40 },
        },
      ],
      operationSource: "tab-a",
      operationRevision: 1,
    } as never);

    expect(newer).toEqual({ id: "design-1", updated: true, changed: true });
    expect(stale).toEqual({ id: "design-1", updated: true, stale: true });
    expect(
      (JSON.parse(mocks.state.row.data!) as typeof BASE_DATA).canvasFrames[
        "frame-a"
      ].x,
    ).toBe(80);
    expect(JSON.parse(mocks.state.row.dataOperationRevisions!)).toEqual({
      "tab-a": 2,
    });
  });

  it("uses an explicit delete operation so a concurrent write cannot resurrect a removed frame", async () => {
    mocks.resetReadGate(2);

    await Promise.all([
      action.run({
        id: "design-1",
        dataOperations: [{ op: "delete", path: ["canvasFrames", "frame-a"] }],
      } as never),
      action.run({
        id: "design-1",
        dataOperations: [
          {
            op: "set",
            path: ["canvasFrames", "frame-b"],
            value: { ...BASE_DATA.canvasFrames["frame-b"], x: 560 },
          },
        ],
      } as never),
    ]);

    const persisted = JSON.parse(mocks.state.row.data!) as typeof BASE_DATA;
    expect(persisted.canvasFrames).not.toHaveProperty("frame-a");
    expect(persisted.canvasFrames["frame-b"].x).toBe(560);
  });

  it("rejects unsafe patch paths and mixing legacy snapshots with path operations", () => {
    expect(
      action.schema.safeParse({
        id: "design-1",
        dataOperations: [
          { op: "set", path: ["__proto__", "polluted"], value: true },
        ],
      }).success,
    ).toBe(false);
    expect(
      action.schema.safeParse({
        id: "design-1",
        dataOperations: [{ op: "delete", path: ["canvasFrames", "frame-a"] }],
        operationSource: "tab-a",
      }).success,
    ).toBe(false);
    expect(
      action.schema.safeParse({
        id: "design-1",
        operationSource: "tab-a",
        operationRevision: 1,
      }).success,
    ).toBe(false);
    expect(
      action.schema.safeParse({
        id: "design-1",
        data: "{}",
        dataOperations: [{ op: "delete", path: ["canvasFrames", "frame-a"] }],
      }).success,
    ).toBe(false);
    expect(
      action.schema.safeParse({
        id: "design-1",
        dataOperations: [{ op: "set", path: ["canvasFrames", "frame-a"] }],
      }).success,
    ).toBe(false);
  });

  it("rejects string frame dimensions", async () => {
    expect(
      action.schema.safeParse({
        id: "design-1",
        dataOperations: [
          {
            op: "set",
            path: ["canvasFrames", "frame-a"],
            value: { x: 0, y: 0, width: "800", height: 600 },
          },
        ],
      }).success,
    ).toBe(false);

    await expect(
      action.run({
        id: "design-1",
        data: JSON.stringify({
          canvasFrames: { "frame-a": { width: "800" } },
        }),
      } as never),
    ).rejects.toThrow(/must be a finite JSON number/);
  });

  it("rejects nested operations that leave empty or unknown-only frames", async () => {
    const nestedUnknown = {
      id: "design-1",
      dataOperations: [
        {
          op: "set",
          path: ["canvasFrames", "missing-frame", "label"],
          value: "Home",
        },
      ],
    };
    expect(action.schema.safeParse(nestedUnknown).success).toBe(true);
    await expect(action.run(nestedUnknown as never)).rejects.toThrow(
      /at least one geometry field/,
    );

    const nestedDelete = {
      id: "design-1",
      dataOperations: [
        { op: "set", path: ["canvasFrames", "new-frame"], value: { x: 1 } },
        { op: "delete", path: ["canvasFrames", "new-frame", "x"] },
      ],
    };
    await expect(action.run(nestedDelete as never)).rejects.toThrow(
      /at least one geometry field/,
    );
  });

  it("preserves legacy empty frames during unrelated map updates", async () => {
    mocks.state.row.data = JSON.stringify({
      canvasFrames: { "legacy-frame": {} },
      lastPrompt: "old",
    });

    await action.run({
      id: "design-1",
      dataOperations: [{ op: "set", path: ["lastPrompt"], value: "new" }],
    } as never);

    const persisted = JSON.parse(mocks.state.row.data!);
    expect(persisted.canvasFrames["legacy-frame"]).toEqual({});
    expect(persisted.lastPrompt).toBe("new");
  });

  it("preserves a legacy empty sibling during a valid frame edit", async () => {
    mocks.state.row.data = JSON.stringify({
      canvasFrames: {
        "valid-frame": { x: 0, y: 0, width: 400, height: 300 },
        "legacy-frame": {},
      },
    });

    await action.run({
      id: "design-1",
      dataOperations: [
        {
          op: "set",
          path: ["canvasFrames", "valid-frame", "x"],
          value: 40,
        },
      ],
    } as never);

    const persisted = JSON.parse(mocks.state.row.data!);
    expect(persisted.canvasFrames["valid-frame"].x).toBe(40);
    expect(persisted.canvasFrames["legacy-frame"]).toEqual({});
  });

  it("rejects array frames through the action schema and legacy snapshots without writing", async () => {
    const before = { ...mocks.state.row };
    const input = {
      id: "design-1",
      dataOperations: [
        {
          op: "set",
          path: ["canvasFrames", "frame-a"],
          value: ["390", "auto"],
        },
      ],
    };
    expect(action.schema.safeParse(input).success).toBe(false);
    await expect(action.run(input as never)).rejects.toThrow(
      /must be an object/,
    );
    await expect(
      action.run({
        id: "design-1",
        data: JSON.stringify({ canvasFrames: { "frame-a": ["390", "auto"] } }),
      } as never),
    ).rejects.toThrow(/must be an object/);
    expect(mocks.state.row).toEqual(before);
  });

  it("rejects malformed tweak definitions through action and snapshot writes", async () => {
    const before = { ...mocks.state.row };
    const operation = {
      op: "set",
      path: ["tweaks"],
      value: [{}, {}, {}],
    };
    const input = { id: "design-1", dataOperations: [operation] };

    expect(action.schema.safeParse(input).success).toBe(false);
    expect(action.agentInputSchema.safeParse(input).success).toBe(false);
    await expect(action.run(input as never)).rejects.toThrow(
      /invalid tweak definitions/,
    );
    await expect(
      action.run({
        id: "design-1",
        data: JSON.stringify({ tweaks: [[""]] }),
      } as never),
    ).rejects.toThrow(/tweaks must be an array of valid definitions/);
    expect(mocks.state.row).toEqual(before);
  });

  it("accepts a well-formed tweak definition", async () => {
    const tweaks = [
      {
        id: "accent",
        label: "Accent",
        type: "color-swatch",
        options: [{ label: "Blue", value: "#2563eb", color: "#2563eb" }],
        defaultValue: "#2563eb",
        cssVar: "--color-accent",
      },
    ];

    await action.run({
      id: "design-1",
      dataOperations: [{ op: "set", path: ["tweaks"], value: tweaks }],
    } as never);

    expect(JSON.parse(mocks.state.row.data!).tweaks).toEqual(tweaks);
  });

  it("CAS-matches a legacy null data row", async () => {
    mocks.state.row.data = null;

    await action.run({
      id: "design-1",
      data: JSON.stringify({
        canvasFrames: {
          "frame-a": { ...BASE_DATA.canvasFrames["frame-a"], x: 40 },
        },
      }),
    } as never);

    const persisted = JSON.parse(mocks.state.row.data!) as typeof BASE_DATA;
    expect(persisted.canvasFrames["frame-a"].x).toBe(40);
  });

  it.each(["{broken-json", "[]", '"primitive"'])(
    "fails loud instead of overwriting malformed persisted data: %s",
    async (persistedData) => {
      mocks.state.row.data = persistedData;

      await expect(
        action.run({
          id: "design-1",
          dataOperations: [
            {
              op: "set",
              path: ["canvasFrames", "frame-a"],
              value: BASE_DATA.canvasFrames["frame-a"],
            },
          ],
        } as never),
      ).rejects.toThrow("invalid data JSON");
      expect(mocks.state.row.data).toBe(persistedData);
    },
  );

  it.each<ResultShape>([
    "rowsAffected",
    "affectedRows",
    "rowCount",
    "count",
    "changes",
    "d1-meta",
  ])("normalizes the %s affected-row result shape", async (resultShape) => {
    mocks.state.resultShape = resultShape;

    await action.run({
      id: "design-1",
      dataOperations: [
        {
          op: "set",
          path: ["canvasFrames", "frame-a"],
          value: { ...BASE_DATA.canvasFrames["frame-a"], x: 40 },
        },
      ],
    } as never);

    const persisted = JSON.parse(mocks.state.row.data!) as typeof BASE_DATA;
    expect(persisted.canvasFrames["frame-a"].x).toBe(40);
  });

  it("fails loud when a driver cannot report whether the CAS matched", async () => {
    mocks.state.resultShape = "missing";

    await expect(
      action.run({
        id: "design-1",
        dataOperations: [
          {
            op: "set",
            path: ["canvasFrames", "frame-a"],
            value: { ...BASE_DATA.canvasFrames["frame-a"], x: 40 },
          },
        ],
      } as never),
    ).rejects.toThrow("did not report an affected-row count");
  });
});
