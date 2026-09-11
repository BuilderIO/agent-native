/**
 * Real-SQL coverage for the all-or-nothing screen rename mutation. These tests
 * exercise the framework's async PGlite transaction patch so a failure
 * after the target row updates proves the earlier write is actually rolled
 * back, not merely hidden by a mocked Drizzle chain.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const localDb = vi.hoisted(() => ({
  pglite: null as null | {
    close(): Promise<void>;
    exec(sql: string): Promise<void>;
    prepare(sql: string): {
      run(...args: unknown[]): unknown;
      get(...args: unknown[]): unknown;
      all(...args: unknown[]): unknown[];
    };
  },
}));
const collab = vi.hoisted(() => ({
  applyText: vi.fn().mockResolvedValue(""),
  seedFromText: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@agent-native/core/collab", () => ({
  hasCollabState: vi.fn().mockResolvedValue(true),
  applyText: collab.applyText,
  seedFromText: collab.seedFromText,
}));

const sharing = vi.hoisted(() => ({
  assertAccess: vi.fn().mockResolvedValue({ role: "editor" }),
}));
vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: () => undefined,
  assertAccess: sharing.assertAccess,
}));

vi.mock("../server/db/index.js", async () => {
  const [{ createRequire }, { drizzle }, pgliteCore, coreDb] =
    await Promise.all([
      import("node:module"),
      import("drizzle-orm/pglite"),
      import("drizzle-orm/pg-core"),
      import("@agent-native/core/testing"),
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

  await pglite.exec(`CREATE TABLE designs (
    id TEXT PRIMARY KEY,
    updated_at TEXT
  )`);
  await pglite.exec(`CREATE TABLE design_files (
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
    )`);
  const rawDb = drizzle(pglite as never, {
    schema: { designs, designFiles },
  });
  const db = rawDb;
  localDb.pglite = pglite;
  return {
    getDb: () => db,
    schema: { designs, designFiles, designShares: {} },
  };
});

import { sourceContentHash } from "../shared/source-workspace.js";
import renameScreenAction from "./rename-screen.js";

const DESIGN_ID = "design_rename_1";
const INDEX_ID = "screen_index";
const OTHER_ID = "screen_other";
const LOCAL_ID = "screen_localhost";
const CSS_ID = "styles";
const BASE_TIME = "2026-07-09T00:00:00.000Z";
const INDEX_HTML =
  '<main><a data-screen="index.html">Self</a><a data-screen="index-old.html">Partial</a></main>';
const OTHER_HTML = "<main><a data-screen = 'index.html'>Home</a></main>";

async function insertFile(
  id: string,
  filename: string,
  content: string,
  fileType = "html",
) {
  await localDb.pglite
    ?.prepare(
      `INSERT INTO design_files
       (id, design_id, filename, content, file_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, DESIGN_ID, filename, content, fileType, BASE_TIME, BASE_TIME);
}

async function persistedFiles(): Array<{
  id: string;
  filename: string;
  content: string;
}> {
  return localDb.pglite
    ?.prepare(
      `SELECT id, filename, content FROM design_files
       ORDER BY CASE id WHEN '${INDEX_ID}' THEN 1 WHEN '${OTHER_ID}' THEN 2
       WHEN '${LOCAL_ID}' THEN 3 ELSE 4 END`,
    )
    .all() as Array<{ id: string; filename: string; content: string }>;
}

async function rename(
  name: string,
  contentOverrides: Array<{
    fileId: string;
    content: string;
    expectedVersionHash: string;
  }> = [],
) {
  return renameScreenAction.run({
    id: INDEX_ID,
    name,
    requestSource: "test-tab",
    contentOverrides,
  } as never);
}

beforeEach(async () => {
  collab.applyText.mockClear();
  collab.seedFromText.mockClear();
  sharing.assertAccess.mockClear();
  await localDb.pglite?.exec("DELETE FROM design_files");
  await localDb.pglite?.exec("DELETE FROM designs");
  await localDb.pglite
    ?.prepare("INSERT INTO designs (id, updated_at) VALUES (?, ?)")
    .run(DESIGN_ID, BASE_TIME);
  await insertFile(INDEX_ID, "index.html", INDEX_HTML);
  await insertFile(OTHER_ID, "other.html", OTHER_HTML);
  await insertFile(
    LOCAL_ID,
    "local-settings.html",
    "http://127.0.0.1:4173/settings",
  );
  await insertFile(
    CSS_ID,
    "styles.css",
    ".example::after { content: 'data-screen=\"index.html\"'; }",
    "css",
  );
});

afterAll(async () => {
  await localDb.pglite?.close();
});

describe("rename-screen with real PostgreSQL", () => {
  it("is exposed as the agent action used by the editor", () => {
    expect(renameScreenAction.agentTool).not.toBe(false);
  });

  it("renames once and atomically rewrites self-links and cross-screen links", async () => {
    const result = await rename("Dashboard");
    const [index, other, local, css] = await persistedFiles();

    expect(result).toMatchObject({
      previousFilename: "index.html",
      filename: "Dashboard.html",
      renamed: true,
      rewrittenFileIds: [INDEX_ID, OTHER_ID],
      collabReconcilePending: [],
    });
    expect(index).toEqual({
      id: INDEX_ID,
      filename: "Dashboard.html",
      content:
        '<main><a data-screen="Dashboard.html">Self</a><a data-screen="index-old.html">Partial</a></main>',
    });
    expect(other).toEqual({
      id: OTHER_ID,
      filename: "other.html",
      content: "<main><a data-screen = 'Dashboard.html'>Home</a></main>",
    });
    expect(local).toEqual({
      id: LOCAL_ID,
      filename: "local-settings.html",
      content: "http://127.0.0.1:4173/settings",
    });
    expect(css).toEqual({
      id: CSS_ID,
      filename: "styles.css",
      content: ".example::after { content: 'data-screen=\"index.html\"'; }",
    });
    expect(collab.applyText).toHaveBeenCalledTimes(2);
    expect(sharing.assertAccess).toHaveBeenCalledWith(
      "design",
      DESIGN_ID,
      "editor",
    );
  });

  it("persists a guarded unsaved HTML snapshot in the same transaction before rewriting it", async () => {
    const unsaved =
      '<main data-new="true"><a data-screen="index.html">Fresh self</a></main>';
    await rename("Dashboard", [
      {
        fileId: INDEX_ID,
        content: unsaved,
        expectedVersionHash: sourceContentHash(INDEX_HTML),
      },
    ]);

    expect((await persistedFiles())[0]).toEqual({
      id: INDEX_ID,
      filename: "Dashboard.html",
      content:
        '<main data-new="true"><a data-screen="Dashboard.html">Fresh self</a></main>',
    });
  });

  it("rejects rendered HTML overrides for URL-backed localhost markers", async () => {
    const before = persistedFiles();

    await expect(
      rename("Dashboard", [
        {
          fileId: LOCAL_ID,
          content: "<html><body>Rendered local app</body></html>",
          expectedVersionHash: sourceContentHash(
            "http://127.0.0.1:4173/settings",
          ),
        },
      ]),
    ).rejects.toThrow(/URL-backed screen.*cannot be replaced with inline HTML/);
    expect(persistedFiles()).toEqual(before);
  });

  it("rejects duplicate filenames without changing any row", async () => {
    await insertFile("duplicate", "Dashboard.html", "<main>duplicate</main>");
    const before = persistedFiles();

    await expect(rename("Dashboard")).rejects.toThrow(
      /Dashboard\.html.*already exists/,
    );
    expect(persistedFiles()).toEqual(before);
    expect(collab.applyText).not.toHaveBeenCalled();
  });

  it("rolls back the target rename and self-link rewrite when a later referenced file update fails", async () => {
    await localDb.pglite
      ?.exec(`CREATE OR REPLACE FUNCTION fail_other_screen_update_fn()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.id = '${OTHER_ID}' AND NEW.content <> OLD.content THEN
          RAISE EXCEPTION 'forced cross-screen update failure';
        END IF;
        RETURN NEW;
      END;
      $$`);
    await localDb.pglite?.exec(`CREATE TRIGGER fail_other_screen_update
      BEFORE UPDATE OF content ON design_files
      FOR EACH ROW EXECUTE FUNCTION fail_other_screen_update_fn()`);
    const before = persistedFiles();

    await expect(rename("Dashboard")).rejects.toThrow(
      /forced cross-screen update failure|Failed query/,
    );
    expect(persistedFiles()).toEqual(before);
    expect(collab.applyText).not.toHaveBeenCalled();
  });
});
