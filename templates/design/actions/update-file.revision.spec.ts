import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const localDb = vi.hoisted(() => ({
  pglite: null as null | {
    close(): Promise<void>;
    exec(sql: string): Promise<void>;
    prepare(sql: string): {
      run(...args: unknown[]): unknown;
      get(...args: unknown[]): unknown;
    };
  },
}));
const collabReadBarrier = vi.hoisted(() => ({
  remaining: 0,
  waiters: [] as Array<() => void>,
}));
const collabState = vi.hoisted(() => ({
  exists: false,
  content: "",
  version: 0,
  failApplyCount: 0,
  persistCount: 0,
  peerContentBeforePersist: null as string | null,
}));
const updateControl = vi.hoisted(() => ({
  sqlCasMisses: 0,
}));
const collabConflict = vi.hoisted(
  () =>
    class CollabBaseVersionConflictError extends Error {
      readonly statusCode = 409;
    },
);

async function waitAtCollabReadBarrier(): Promise<void> {
  if (collabReadBarrier.remaining <= 0) return;
  collabReadBarrier.remaining -= 1;
  if (collabReadBarrier.remaining === 0) {
    for (const release of collabReadBarrier.waiters.splice(0)) release();
    return;
  }
  await new Promise<void>((resolve) => {
    collabReadBarrier.waiters.push(resolve);
  });
}

vi.mock("@agent-native/core/collab", () => ({
  CollabBaseVersionConflictError: collabConflict,
  hasCollabState: async () => {
    await waitAtCollabReadBarrier();
    return collabState.exists;
  },
  getText: async () => collabState.content,
  applyText: async (_id: string, content: string) => {
    if (collabState.failApplyCount > 0) {
      collabState.failApplyCount -= 1;
      throw new Error("simulated collab apply failure");
    }
    collabState.exists = true;
    collabState.content = content;
    collabState.version += 1;
  },
  seedFromText: async (_id: string, content: string) => {
    if (collabState.failApplyCount > 0) {
      collabState.failApplyCount -= 1;
      throw new Error("simulated collab seed failure");
    }
    collabState.exists = true;
    collabState.content = content;
    collabState.version += 1;
  },
  applyTextToYDoc: (
    doc: { content: string },
    _fieldName: string,
    text: string,
  ) => {
    if (collabState.failApplyCount > 0) {
      collabState.failApplyCount -= 1;
      throw new Error("simulated collab apply failure");
    }
    doc.content = text;
  },
  withPreparedYDocMutation: async (
    _docId: string,
    _requestSource: string | undefined,
    run: (lease: {
      doc: { content: string; getText: () => { toString: () => string } };
      baseVersion: number | null;
      persist: (_tx: unknown, text: string) => Promise<void>;
    }) => Promise<unknown>,
  ) => {
    const doc = {
      content: collabState.exists ? collabState.content : "",
      getText: () => ({ toString: () => doc.content }),
    };
    let persisted = false;
    const result = await run({
      doc,
      baseVersion: collabState.exists ? collabState.version : null,
      persist: async (_tx, text) => {
        collabState.persistCount += 1;
        if (collabState.peerContentBeforePersist !== null) {
          collabState.exists = true;
          collabState.content = collabState.peerContentBeforePersist;
          collabState.version += 1;
          collabState.peerContentBeforePersist = null;
          throw new collabConflict(
            "collaboration document changed before SQL mirror",
          );
        }
        collabState.exists = true;
        collabState.content = text;
        collabState.version += 1;
        persisted = true;
      },
    });
    if (!persisted) return result;
    return result;
  },
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: () => undefined,
  assertAccess: vi.fn().mockResolvedValue({ role: "editor" }),
  resolveAccess: vi.fn().mockResolvedValue({
    role: "editor",
    resource: { data: JSON.stringify({ sourceType: "inline" }) },
  }),
}));

vi.mock("../server/source-workspace.js", () => ({
  affectedRowCount: (result: unknown) => {
    if (updateControl.sqlCasMisses > 0) {
      updateControl.sqlCasMisses -= 1;
      return 0;
    }
    if (!result || typeof result !== "object") return undefined;
    const candidate = result as {
      rowsAffected?: unknown;
      affectedRows?: unknown;
      rowCount?: unknown;
      count?: unknown;
      changes?: unknown;
      meta?: { changes?: unknown };
    };
    const value =
      candidate.rowsAffected ??
      candidate.affectedRows ??
      candidate.rowCount ??
      candidate.count ??
      candidate.changes ??
      candidate.meta?.changes;
    return typeof value === "number" ? value : undefined;
  },
  SourceWorkspaceEditConflictError: class SourceWorkspaceEditConflictError extends Error {
    statusCode = 409;
  },
  getDesignSourceMutationExec: () => ({ execute: vi.fn() }),
  lockDesignFilesTable: async () => {},
  readLiveSourceFile: async ({ content }: { content?: string | null }) => ({
    content: collabState.exists ? collabState.content : (content ?? ""),
    versionHash: "test-hash",
    language: "html",
  }),
  readPreparedSourceText: (lease: {
    doc: { getText: () => { toString: () => string } };
  }) => lease.doc.getText().toString(),
  withSourceFileWriteLock: async <T>(
    _fileId: string,
    run: () => Promise<T>,
  ): Promise<T> => run(),
  withPreparedSourceFileMutation: async <T>(
    _fileId: string,
    _requestSource: string | undefined,
    run: (lease: unknown) => Promise<T>,
  ): Promise<T> => {
    const doc = {
      content: collabState.exists ? collabState.content : "",
      getText: () => ({ toString: () => doc.content }),
    };
    return run({
      doc,
      baseVersion: collabState.exists ? collabState.version : null,
      persist: async (_tx: unknown, text: string) => {
        collabState.persistCount += 1;
        if (collabState.peerContentBeforePersist !== null) {
          collabState.exists = true;
          collabState.content = collabState.peerContentBeforePersist;
          collabState.version += 1;
          collabState.peerContentBeforePersist = null;
          throw new collabConflict(
            "collaboration document changed before SQL mirror",
          );
        }
        collabState.exists = true;
        collabState.content = text;
        collabState.version += 1;
      },
    });
  },
  withDesignSourceMutationTransaction: async <T>(
    _designId: string,
    run: (tx: unknown) => Promise<T>,
  ): Promise<T> => {
    const { getDb } = await import("../server/db/index.js");
    return run(getDb());
  },
}));

vi.mock("../server/db/index.js", async () => {
  const [{ createRequire }, { drizzle }, pgliteCore] = await Promise.all([
    import("node:module"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pg-core"),
  ]);
  const designs = pgliteCore.pgTable("designs", {
    id: pgliteCore.text("id").primaryKey(),
    updatedAt: pgliteCore.text("updated_at"),
  });
  const designFiles = pgliteCore.pgTable("design_files", {
    id: pgliteCore.text("id").primaryKey(),
    designId: pgliteCore.text("design_id").notNull(),
    filename: pgliteCore.text("filename").notNull(),
    content: pgliteCore.text("content").notNull(),
    contentOperationSource: pgliteCore.text("content_operation_source"),
    contentOperationRevision: pgliteCore.integer("content_operation_revision"),
    contentOperationResultHash: pgliteCore.text(
      "content_operation_result_hash",
    ),
    fileType: pgliteCore.text("file_type").notNull(),
    createdAt: pgliteCore.text("created_at"),
    updatedAt: pgliteCore.text("updated_at"),
  });
  const requireFromCore = createRequire(
    new URL("../../../packages/core/package.json", import.meta.url),
  );
  const Database = requireFromCore("@electric-sql/pglite").PGlite as new (
    filename: string,
  ) => NonNullable<typeof localDb.pglite>;
  const pglite = await Database.create("memory://");
  (pglite as any).prepare = (sql: string) => ({
    run: (...args: unknown[]) =>
      pglite.query(
        sql.replace(
          /\?/g,
          (() => {
            let i = 0;
            return () => "$" + ++i;
          })(),
        ),
        args,
      ),
    all: async (...args: unknown[]) =>
      (
        await pglite.query(
          sql.replace(
            /\?/g,
            (() => {
              let i = 0;
              return () => "$" + ++i;
            })(),
          ),
          args,
        )
      ).rows,
    get: async (...args: unknown[]) =>
      (
        await pglite.query(
          sql.replace(
            /\?/g,
            (() => {
              let i = 0;
              return () => "$" + ++i;
            })(),
          ),
          args,
        )
      ).rows[0],
  });

  await pglite.exec(`
    CREATE TABLE designs (
      id TEXT PRIMARY KEY,
      updated_at TEXT
    );
    CREATE TABLE design_files (
      id TEXT PRIMARY KEY,
      design_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      content TEXT NOT NULL,
      content_operation_source TEXT,
      content_operation_revision INTEGER,
      content_operation_result_hash TEXT,
      file_type TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    );
  `);
  localDb.pglite = pglite;
  return {
    getDb: () => drizzle(pglite as never),
    schema: { designs, designFiles, designShares: {} },
  };
});

import { sourceContentHash } from "../shared/source-workspace.js";
import updateFileAction from "./update-file.js";

const DESIGN_ID = "design_revision_1";
const FILE_ID = "file_revision_1";
const BASE = "<main>base</main>";

interface PersistedFile {
  content: string;
  content_operation_source: string | null;
  content_operation_revision: number | null;
  content_operation_result_hash: string | null;
}

async function persistedFile(): Promise<PersistedFile> {
  return localDb.pglite
    ?.prepare(
      `SELECT content, content_operation_source,
              content_operation_revision, content_operation_result_hash
       FROM design_files WHERE id = ?`,
    )
    .get(FILE_ID) as PersistedFile;
}

async function save(args: {
  content: string;
  syncCollab?: boolean;
  expectedVersionHash?: string;
  operationSource?: string;
  operationRevision?: number;
}) {
  return updateFileAction.run({
    id: FILE_ID,
    content: args.content,
    syncCollab: args.syncCollab ?? false,
    ...args,
  } as never);
}

beforeEach(async () => {
  collabReadBarrier.remaining = 0;
  collabReadBarrier.waiters = [];
  collabState.exists = false;
  collabState.content = "";
  collabState.version = 0;
  collabState.failApplyCount = 0;
  collabState.persistCount = 0;
  collabState.peerContentBeforePersist = null;
  updateControl.sqlCasMisses = 0;
  await localDb.pglite?.exec("DELETE FROM design_files; DELETE FROM designs;");
  await localDb.pglite
    ?.prepare("INSERT INTO designs (id, updated_at) VALUES (?, ?)")
    .run(DESIGN_ID, "2026-07-09T00:00:00.000Z");
  await localDb.pglite
    ?.prepare(
      `INSERT INTO design_files
       (id, design_id, filename, content, file_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      FILE_ID,
      DESIGN_ID,
      "index.html",
      BASE,
      "html",
      "2026-07-09T00:00:00.000Z",
      "2026-07-09T00:00:00.000Z",
    );
});

afterAll(async () => {
  await localDb.pglite?.close();
});

describe("update-file browser operation ordering with real PostgreSQL", () => {
  it("keeps a newer keepalive result when the older request arrives afterward", async () => {
    const baseHash = sourceContentHash(BASE);
    const newest = "<main>newest unload snapshot</main>";
    const older = "<main>older in-flight snapshot</main>";

    const newerResult = await save({
      content: newest,
      expectedVersionHash: baseHash,
      operationSource: "tab-a",
      operationRevision: 2,
    });
    const olderResult = await save({
      content: older,
      expectedVersionHash: baseHash,
      operationSource: "tab-a",
      operationRevision: 1,
    });

    expect(newerResult).toMatchObject({
      updated: true,
      versionHash: sourceContentHash(newest),
    });
    expect(olderResult).toMatchObject({
      updated: true,
    });
    expect(await persistedFile()).toMatchObject({
      content: newest,
      content_operation_source: "tab-a",
      content_operation_revision: 2,
      content_operation_result_hash: sourceContentHash(newest),
    });
  });

  it("lets only one independent writer commit from the same SQL base", async () => {
    const baseHash = sourceContentHash(BASE);
    const tabAContent = "<main>tab a concurrent edit</main>";
    const tabBContent = "<main>tab b concurrent edit</main>";

    collabReadBarrier.remaining = 2;
    const results = await Promise.allSettled([
      save({
        content: tabAContent,
        expectedVersionHash: baseHash,
        operationSource: "tab-a",
        operationRevision: 1,
      }),
      save({
        content: tabBContent,
        expectedVersionHash: baseHash,
        operationSource: "tab-b",
        operationRevision: 1,
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({ reason: expect.objectContaining({ statusCode: 409 }) });
    const persisted = await persistedFile();
    expect([tabAContent, tabBContent]).toContain(persisted.content);
    expect(persisted.content_operation_result_hash).toBe(
      sourceContentHash(persisted.content),
    );
  });

  it("persists the last of three causally dependent rapid saves", async () => {
    const baseHash = sourceContentHash(BASE);
    const first = "<main>first queued edit</main>";
    const second = "<main>second queued edit</main>";
    const third = "<main>third queued edit</main>";

    await save({
      content: first,
      expectedVersionHash: baseHash,
      operationSource: "tab-a",
      operationRevision: 1,
    });
    await save({
      content: second,
      expectedVersionHash: sourceContentHash(first),
      operationSource: "tab-a",
      operationRevision: 2,
    });
    const result = await save({
      content: third,
      expectedVersionHash: sourceContentHash(second),
      operationSource: "tab-a",
      operationRevision: 3,
    });

    expect(result).toMatchObject({
      updated: true,
      versionHash: sourceContentHash(third),
    });
    expect(await persistedFile()).toMatchObject({
      content: third,
      content_operation_source: "tab-a",
      content_operation_revision: 3,
      content_operation_result_hash: sourceContentHash(third),
    });
    const row = (await localDb.pglite
      ?.prepare(`SELECT updated_at FROM design_files WHERE id = ?`)
      .get(FILE_ID)) as { updated_at: string };
    expect((result as { updatedAt?: string }).updatedAt).toBe(row.updated_at);
  });

  it("rejects a higher same-tab revision built from a stale snapshot", async () => {
    const baseHash = sourceContentHash(BASE);
    const first = "<main>first queued edit</main>";
    await save({
      content: first,
      expectedVersionHash: baseHash,
      operationSource: "tab-a",
      operationRevision: 1,
    });

    await expect(
      save({
        content: "<main>stale second snapshot</main>",
        expectedVersionHash: baseHash,
        operationSource: "tab-a",
        operationRevision: 2,
      }),
    ).rejects.toThrow(/changed since it was read/);
    expect(await persistedFile()).toMatchObject({
      content: first,
      content_operation_source: "tab-a",
      content_operation_revision: 1,
      content_operation_result_hash: sourceContentHash(first),
    });
  });

  it("does not let same-tab lineage bypass a different writer's hash conflict", async () => {
    const baseHash = sourceContentHash(BASE);
    const first = "<main>tab a first</main>";
    await save({
      content: first,
      expectedVersionHash: baseHash,
      operationSource: "tab-a",
      operationRevision: 1,
    });

    const otherWriter = "<main>tab b edit</main>";
    await save({
      content: otherWriter,
      expectedVersionHash: sourceContentHash(first),
      operationSource: "tab-b",
      operationRevision: 1,
    });

    await expect(
      save({
        content: "<main>stale tab a successor</main>",
        expectedVersionHash: baseHash,
        operationSource: "tab-a",
        operationRevision: 2,
      }),
    ).rejects.toThrow(/changed since it was read/);
    expect(await persistedFile()).toMatchObject({
      content: otherWriter,
      content_operation_source: "tab-b",
      content_operation_revision: 1,
    });
  });

  it("clears browser lineage when an unversioned content writer succeeds", async () => {
    await save({
      content: "<main>versioned edit</main>",
      expectedVersionHash: sourceContentHash(BASE),
      operationSource: "tab-a",
      operationRevision: 1,
    });

    await save({ content: "<main>agent edit</main>" });

    expect(await persistedFile()).toMatchObject({
      content: "<main>agent edit</main>",
      content_operation_source: null,
      content_operation_revision: null,
      content_operation_result_hash: null,
    });
  });

  it("accepts revision one from a new editor-mount source after an old source reached a high watermark", async () => {
    const oldMountContent = "<main>old editor mount</main>";
    await save({
      content: oldMountContent,
      expectedVersionHash: sourceContentHash(BASE),
      operationSource: "tab-a:save:editor-1",
      operationRevision: 7,
    });

    const remountedContent = "<main>fresh edit after remount</main>";
    const result = await save({
      content: remountedContent,
      expectedVersionHash: sourceContentHash(oldMountContent),
      operationSource: "tab-a:save:editor-2",
      operationRevision: 1,
    });

    expect(result).toMatchObject({
      updated: true,
      versionHash: sourceContentHash(remountedContent),
    });
    expect(await persistedFile()).toMatchObject({
      content: remountedContent,
      content_operation_source: "tab-a:save:editor-2",
      content_operation_revision: 1,
    });
  });

  it("retries exact persisted operations to finish collab convergence but never reapplies an older revision", async () => {
    collabState.exists = true;
    collabState.content = BASE;
    collabState.failApplyCount = 1;
    const firstContent = "<main>sql committed before collab failed</main>";
    const firstRequest = {
      content: firstContent,
      syncCollab: true,
      expectedVersionHash: sourceContentHash(BASE),
      operationSource: "tab-a:save:editor-1",
      operationRevision: 1,
    };

    await expect(save(firstRequest)).rejects.toThrow(
      /simulated collab apply failure/,
    );
    expect(await persistedFile()).toMatchObject({
      content: firstContent,
      content_operation_revision: 1,
    });
    expect(collabState.content).toBe(BASE);

    await expect(save(firstRequest)).resolves.toMatchObject({
      updated: true,
      skippedStaleOperation: true,
      versionHash: sourceContentHash(firstContent),
    });
    expect(collabState.content).toBe(firstContent);

    const latestContent = "<main>newer revision</main>";
    await save({
      content: latestContent,
      syncCollab: true,
      expectedVersionHash: sourceContentHash(firstContent),
      operationSource: firstRequest.operationSource,
      operationRevision: 2,
    });
    expect(collabState.content).toBe(latestContent);

    await expect(save(firstRequest)).resolves.toMatchObject({
      updated: true,
      skippedStaleOperation: true,
      versionHash: sourceContentHash(latestContent),
    });
    expect((await persistedFile()).content).toBe(latestContent);
    expect(collabState.content).toBe(latestContent);
  });

  it("rejects a mirror when a peer commits live collaboration content before the SQL mirror", async () => {
    collabState.exists = true;
    collabState.content = BASE;
    collabState.version = 3;
    const peer = "<main>peer live edit</main>";
    collabState.peerContentBeforePersist = peer;

    await expect(
      save({
        content: "<main>stale SQL mirror</main>",
        syncCollab: false,
        expectedVersionHash: sourceContentHash(BASE),
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(collabState.content).toBe(peer);
    expect((await persistedFile()).content).toBe(BASE);
  });

  it("does not reuse a prepared lease after a SQL content CAS miss", async () => {
    collabState.exists = true;
    collabState.content = BASE;
    collabState.version = 0;
    updateControl.sqlCasMisses = 1;
    const next = "<main>CAS loser</main>";

    await expect(
      save({
        content: next,
        syncCollab: true,
        expectedVersionHash: sourceContentHash(BASE),
        operationSource: "tab-a",
        operationRevision: 1,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(collabState.persistCount).toBe(0);
    expect(collabState.content).toBe(BASE);
  });
});
