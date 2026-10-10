import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(),
  resolveAccess: vi.fn(),
}));
vi.mock("../db/index.js", () => ({ getDb: vi.fn(), schema: {} }));

import {
  bindNativeTextureGrantsInSourceTransaction,
  type NativeTextureTransferGrant,
} from "./design-native-texture-bindings";

const id = "12345678-1234-4123-8123-123456789abc";
const path = `/api/design-native-texture/${id}.png`;
const grant: NativeTextureTransferGrant = {
  id,
  path,
  sha256: "a".repeat(64),
  providerUrl: "https://owned.example.test/image.png",
  sourceDesignId: "source",
  sourceFileId: "source-file",
  retained: false,
};
const databases: PGlite[] = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

async function database() {
  const db = new PGlite();
  databases.push(db);
  await db.exec(`
    CREATE TABLE designs(id TEXT PRIMARY KEY);
    CREATE TABLE design_files(
      id TEXT PRIMARY KEY, design_id TEXT NOT NULL REFERENCES designs(id),
      file_type TEXT NOT NULL, content TEXT NOT NULL
    );
    CREATE TABLE design_native_texture_objects(
      id TEXT PRIMARY KEY, provider_url TEXT NOT NULL, sha256 TEXT NOT NULL
    );
    CREATE TABLE design_native_texture_bindings(
      asset_id TEXT NOT NULL REFERENCES design_native_texture_objects(id),
      design_id TEXT NOT NULL REFERENCES designs(id), file_id TEXT NOT NULL,
      PRIMARY KEY(asset_id, design_id, file_id)
    );
    INSERT INTO designs VALUES ('source'),('copy');
    INSERT INTO design_files VALUES
      ('source-file','source','html','<img src="${path}">'),
      ('copy-file','copy','html','<img src="${path}">');
    INSERT INTO design_native_texture_objects VALUES
      ('${id}','https://owned.example.test/image.png','${"a".repeat(64)}');
    INSERT INTO design_native_texture_bindings VALUES
      ('${id}','source','source-file');
  `);
  const tx = {
    async execute(statement: { sql: string; args?: unknown[] }) {
      let index = 0;
      const sql = statement.sql.replace(/\?/g, () => `$${++index}`);
      return db.query<Record<string, unknown>>(sql, statement.args);
    },
  };
  return { db, tx };
}

describe("transactional native texture copy bindings", () => {
  it("rechecks the source and adds one idempotent destination grant", async () => {
    const { db, tx } = await database();
    await bindNativeTextureGrantsInSourceTransaction(
      tx as never,
      { designId: "copy", fileId: "copy-file" },
      [grant],
    );
    await bindNativeTextureGrantsInSourceTransaction(
      tx as never,
      { designId: "copy", fileId: "copy-file" },
      [grant],
    );
    const rows = await db.query<{ design_id: string }>(
      "SELECT design_id FROM design_native_texture_bindings ORDER BY design_id",
    );
    expect(rows.rows.map((row) => row.design_id)).toEqual(["copy", "source"]);
  });

  it("rejects a forged URL when the source file no longer contains an exact live reference", async () => {
    const { db, tx } = await database();
    await db.query(
      "UPDATE design_files SET content='<main>No asset</main>' WHERE id='source-file'",
    );
    await expect(
      bindNativeTextureGrantsInSourceTransaction(
        tx as never,
        { designId: "copy", fileId: "copy-file" },
        [grant],
      ),
    ).rejects.toMatchObject({ code: "unavailable" });
    const rows = await db.query<{ design_id: string }>(
      "SELECT design_id FROM design_native_texture_bindings ORDER BY design_id",
    );
    expect(rows.rows.map((row) => row.design_id)).toEqual(["source"]);
  });

  it("rejects source growth after preflight before loading locked content", async () => {
    const { db, tx } = await database();
    await db.query(
      "UPDATE design_files SET content = $1 WHERE id = 'source-file'",
      [`<img src="${path}">` + "x".repeat(4_000_000)],
    );
    await expect(
      bindNativeTextureGrantsInSourceTransaction(
        tx as never,
        { designId: "copy", fileId: "copy-file" },
        [grant],
      ),
    ).rejects.toMatchObject({ code: "limit" });
    const rows = await db.query<{ design_id: string }>(
      "SELECT design_id FROM design_native_texture_bindings ORDER BY design_id",
    );
    expect(rows.rows.map((row) => row.design_id)).toEqual(["source"]);
  });

  it.each([
    [
      "source length",
      "octet_length(file.content) AS byte_length",
      "byte_length",
    ],
    ["binding count", "count(*)::int AS count", "count"],
  ])("does not coerce a missing %s to zero", async (_label, query, field) => {
    const { db, tx } = await database();
    const unreadable = {
      async execute(statement: { sql: string; args?: unknown[] }) {
        const result = await tx.execute(statement);
        if (!statement.sql.includes(query)) return result;
        return {
          ...result,
          rows: result.rows.map((row) => ({ ...row, [field]: null })),
        };
      },
    };
    await expect(
      bindNativeTextureGrantsInSourceTransaction(
        unreadable as never,
        { designId: "copy", fileId: "copy-file" },
        [grant],
      ),
    ).rejects.toMatchObject({ code: "unavailable" });
    const rows = await db.query<{ design_id: string }>(
      "SELECT design_id FROM design_native_texture_bindings ORDER BY design_id",
    );
    expect(rows.rows.map((row) => row.design_id)).toEqual(["source"]);
  });
});
