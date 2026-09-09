import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { DbExec, DbExecStatement } from "../db/client.js";
import { registerCollabLifecycle } from "./lifecycle.js";
import { loadYDocRecord, saveYDocState, trySaveYDocState } from "./storage.js";

const runtime = vi.hoisted(() => ({ client: undefined as DbExec | undefined }));
vi.mock("../db/client.js", () => ({
  getDbExec: () => runtime.client,
  isProductionServerlessFunctionRuntime: () => false,
}));

describe("collaboration source lifecycle persistence", () => {
  let db: Awaited<ReturnType<typeof createTestPglite>>;
  let unregister: (() => void) | undefined;
  let beforeTransaction: (() => Promise<void>) | undefined;
  let failCommit = false;

  beforeEach(async () => {
    db = await createTestPglite();
    await db.exec(
      "CREATE TABLE documents (id TEXT PRIMARY KEY, trashed_at TEXT)",
    );
    await db.exec(
      "CREATE TABLE _collab_docs (doc_id TEXT PRIMARY KEY, yjs_state TEXT NOT NULL, text_snapshot TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL)",
    );
    await db
      .prepare("INSERT INTO documents VALUES (?, NULL)")
      .run("example-doc");
    const execute = async (query: DbExecStatement) => {
      const sql = typeof query === "string" ? query : query.sql;
      const args = typeof query === "string" ? [] : (query.args ?? []);
      const result = await db.query(sql, args);
      return {
        rows: result.rows,
        rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
      };
    };
    runtime.client = {
      execute,
      transaction: async (fn) => {
        await beforeTransaction?.();
        return db.db.transaction(async (transaction) => {
          const result = await fn({
            execute: async (query) => {
              const sql = typeof query === "string" ? query : query.sql;
              const args = typeof query === "string" ? [] : (query.args ?? []);
              let index = 0;
              const row = await transaction.query(
                sql.replace(/\?/g, () => `$${++index}`),
                args,
              );
              return { rows: row.rows, rowsAffected: row.affectedRows ?? 0 };
            },
          });
          if (failCommit) throw new Error("example commit failure");
          return result;
        });
      },
    };
    unregister = registerCollabLifecycle({
      table: "documents",
      idColumn: "id",
      deletedAtColumn: "trashed_at",
    });
  });

  afterEach(async () => {
    unregister?.();
    beforeTransaction = undefined;
    failCommit = false;
    await db.close();
  });

  it("rolls back collab persistence if the guarded transaction cannot commit", async () => {
    failCommit = true;
    await expect(
      saveYDocState("example-doc", new Uint8Array([1]), "rejected"),
    ).rejects.toThrow("example commit failure");
    expect(await loadYDocRecord("example-doc")).toBeNull();
    failCommit = false;
    await saveYDocState("example-doc", new Uint8Array([2]), "accepted");
    expect((await loadYDocRecord("example-doc"))?.state).toEqual(
      new Uint8Array([2]),
    );
  });
  it.each(["save", "insert", "cas"])(
    "rejects %s if trash commits after the caller's live read",
    async (operation) => {
      await saveYDocState("example-doc", new Uint8Array([1]), "initial");
      expect(
        await db.prepare("SELECT trashed_at FROM documents").get(),
      ).toEqual({
        trashed_at: null,
      });
      beforeTransaction = async () => {
        await db
          .prepare("UPDATE documents SET trashed_at = 'example-trash'")
          .run();
      };
      const write =
        operation === "save"
          ? saveYDocState("example-doc", new Uint8Array([2]), "rejected")
          : trySaveYDocState(
              "example-doc",
              new Uint8Array([2]),
              "rejected",
              operation === "cas" ? 0 : null,
            );
      await expect(write).rejects.toMatchObject({
        code: "DOCUMENT_TRASHED",
        statusCode: 409,
      });
      expect((await loadYDocRecord("example-doc"))?.state).toEqual(
        new Uint8Array([1]),
      );
    },
  );

  it("cannot recreate collab state after permanent deletion", async () => {
    await db.prepare("DELETE FROM documents").run();
    await expect(
      saveYDocState("example-doc", new Uint8Array([1]), "late seed"),
    ).rejects.toMatchObject({
      errorCode: "DOCUMENT_NOT_FOUND",
      statusCode: 404,
    });
    expect(await loadYDocRecord("example-doc")).toBeNull();
  });

  it("guards the resolved source row and rejects unmapped IDs", async () => {
    unregister?.();
    unregister = registerCollabLifecycle({
      table: "documents",
      idColumn: "id",
      deletedAtColumn: "trashed_at",
      resolveSourceId: (id) => (id === "mapped-example" ? "example-doc" : null),
    });
    await saveYDocState("mapped-example", new Uint8Array([1]), "saved");
    await db.prepare("UPDATE documents SET trashed_at = 'example-trash'").run();
    await expect(
      saveYDocState("mapped-example", new Uint8Array([2]), "late"),
    ).rejects.toMatchObject({ errorCode: "DOCUMENT_TRASHED" });
    await expect(
      saveYDocState("unmapped-example", new Uint8Array([2]), "late"),
    ).rejects.toMatchObject({ errorCode: "DOCUMENT_NOT_FOUND" });
  });

  it("preserves unconfigured stores and rejects unsafe identifiers", async () => {
    unregister?.();
    await saveYDocState("unscoped-example", new Uint8Array([1]), "generic app");
    expect(await loadYDocRecord("unscoped-example")).not.toBeNull();
    expect(() =>
      registerCollabLifecycle({
        table: "documents; DROP TABLE documents",
        idColumn: "id",
        deletedAtColumn: "trashed_at",
      }),
    ).toThrow(/SQL identifier/);
  });

  it("fails loudly when an adapter cannot run interactive transactions", async () => {
    runtime.client = { execute: runtime.client!.execute };
    await expect(
      saveYDocState("example-doc", new Uint8Array([1]), "rejected"),
    ).rejects.toThrow(/interactive database transactions/);
    expect(await loadYDocRecord("example-doc")).toBeNull();
  });
});
