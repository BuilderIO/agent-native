/**
 * Real-SQL regression coverage for browser content-save ordering.
 *
 * A pagehide keepalive may reach the server before an older ordinary fetch.
 * These tests use a real in-memory better-sqlite3 database and the production
 * per-file write lock to prove request arrival order cannot regress content,
 * while a genuinely different writer still trips the hash conflict guard.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const localDb = vi.hoisted(() => ({
  sqlite: null as null | {
    close(): void;
    exec(sql: string): void;
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
  failApplyCount: 0,
}));

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
  },
  seedFromText: async (_id: string, content: string) => {
    if (collabState.failApplyCount > 0) {
      collabState.failApplyCount -= 1;
      throw new Error("simulated collab seed failure");
    }
    collabState.exists = true;
    collabState.content = content;
  },
}));

vi.mock("@agent-native/core/db", () => ({
  isPostgres: () => false,
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: () => undefined,
  assertAccess: vi.fn().mockResolvedValue({ role: "editor" }),
  resolveAccess: vi.fn().mockResolvedValue({
    role: "editor",
    resource: { data: JSON.stringify({ sourceType: "inline" }) },
  }),
}));

// Emulate requests landing on separate serverless instances: each process has
// its own in-memory lock map, so there is no shared JS serialization. The SQL
// CAS in update-file must be sufficient on its own.
vi.mock("../server/source-workspace.js", () => ({
  withSourceFileWriteLock: async <T>(
    _fileId: string,
    run: () => Promise<T>,
  ): Promise<T> => run(),
}));

vi.mock("../server/db/index.js", async () => {
  const [{ createRequire }, { drizzle }, sqliteCore] = await Promise.all([
    import("node:module"),
    import("drizzle-orm/better-sqlite3"),
    import("drizzle-orm/sqlite-core"),
  ]);
  const designs = sqliteCore.sqliteTable("designs", {
    id: sqliteCore.text("id").primaryKey(),
    updatedAt: sqliteCore.text("updated_at"),
  });
  const designFiles = sqliteCore.sqliteTable("design_files", {
    id: sqliteCore.text("id").primaryKey(),
    designId: sqliteCore.text("design_id").notNull(),
    filename: sqliteCore.text("filename").notNull(),
    content: sqliteCore.text("content").notNull(),
    contentOperationSource: sqliteCore.text("content_operation_source"),
    contentOperationRevision: sqliteCore.integer("content_operation_revision"),
    contentOperationResultHash: sqliteCore.text(
      "content_operation_result_hash",
    ),
    fileType: sqliteCore.text("file_type").notNull(),
    createdAt: sqliteCore.text("created_at"),
    updatedAt: sqliteCore.text("updated_at"),
  });
  const requireFromCore = createRequire(
    new URL("../../../packages/core/package.json", import.meta.url),
  );
  const Database = requireFromCore("better-sqlite3") as new (
    filename: string,
  ) => NonNullable<typeof localDb.sqlite>;
  const sqlite = new Database(":memory:");
  sqlite.exec(`
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
  localDb.sqlite = sqlite;
  return {
    getDb: () => drizzle(sqlite as never),
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

function persistedFile(): PersistedFile {
  return localDb.sqlite
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

beforeEach(() => {
  collabReadBarrier.remaining = 0;
  collabReadBarrier.waiters = [];
  collabState.exists = false;
  collabState.content = "";
  collabState.failApplyCount = 0;
  localDb.sqlite?.exec("DELETE FROM design_files; DELETE FROM designs;");
  localDb.sqlite
    ?.prepare("INSERT INTO designs (id, updated_at) VALUES (?, ?)")
    .run(DESIGN_ID, "2026-07-09T00:00:00.000Z");
  localDb.sqlite
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

afterAll(() => {
  localDb.sqlite?.close();
});

describe("update-file browser operation ordering with real SQLite", () => {
  it("keeps the newer keepalive result when the older request arrives afterward", async () => {
    const baseHash = sourceContentHash(BASE);
    const newest = "<main>newest unload snapshot</main>";
    const older = "<main>older in-flight snapshot</main>";

    // Hold both independent server instances after they read the same SQL base
    // but before either can update. Releasing them together exercises the DB
    // CAS/retry path, not the process-local JavaScript lock.
    collabReadBarrier.remaining = 2;
    const newerRequest = save({
      content: newest,
      expectedVersionHash: baseHash,
      operationSource: "tab-a",
      operationRevision: 2,
    });
    const lateOlderRequest = save({
      content: older,
      expectedVersionHash: baseHash,
      operationSource: "tab-a",
      operationRevision: 1,
    });
    const [newerResult, olderResult] = await Promise.all([
      newerRequest,
      lateOlderRequest,
    ]);

    expect(newerResult).toMatchObject({
      updated: true,
      versionHash: sourceContentHash(newest),
    });
    expect(olderResult).toMatchObject({
      updated: true,
    });
    expect(persistedFile()).toMatchObject({
      content: newest,
      content_operation_source: "tab-a",
      content_operation_revision: 2,
      content_operation_result_hash: sourceContentHash(newest),
    });
  });

  it("accepts rapid same-tab successors queued from one acked base", async () => {
    const baseHash = sourceContentHash(BASE);
    const first = "<main>first queued edit</main>";
    const second = "<main>second queued edit</main>";

    const firstRequest = save({
      content: first,
      expectedVersionHash: baseHash,
      operationSource: "tab-a",
      operationRevision: 1,
    });
    await Promise.resolve();
    const secondRequest = save({
      content: second,
      // The second edit entered the debounce queue before rev 1 acked, so it
      // legitimately still carries the original base hash.
      expectedVersionHash: baseHash,
      operationSource: "tab-a",
      operationRevision: 2,
    });
    await Promise.all([firstRequest, secondRequest]);

    expect(persistedFile()).toMatchObject({
      content: second,
      content_operation_source: "tab-a",
      content_operation_revision: 2,
      content_operation_result_hash: sourceContentHash(second),
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
    expect(persistedFile()).toMatchObject({
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

    expect(persistedFile()).toMatchObject({
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
    expect(persistedFile()).toMatchObject({
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
    expect(persistedFile()).toMatchObject({
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
    expect(persistedFile().content).toBe(latestContent);
    expect(collabState.content).toBe(latestContent);
  });
});
