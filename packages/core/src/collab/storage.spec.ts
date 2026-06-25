import { afterEach, describe, expect, it, vi } from "vitest";

import { loadYDocRecord, saveYDocState, trySaveYDocState } from "./storage.js";

const rows = vi.hoisted(
  () =>
    new Map<
      string,
      { yjs_state: string; text_snapshot: string; version: number }
    >(),
);

function toBase64(arr: Uint8Array): string {
  return Buffer.from(arr).toString("base64");
}

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({
    execute: async (query: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof query === "string" ? query : query.sql;
      const args = typeof query === "string" ? [] : (query.args ?? []);

      if (/^\s*CREATE TABLE/i.test(sql) || /^\s*ALTER TABLE/i.test(sql)) {
        return { rows: [], rowsAffected: 0 };
      }

      if (/^\s*SELECT yjs_state, version FROM _collab_docs/i.test(sql)) {
        const row = rows.get(String(args[0]));
        return { rows: row ? [row] : [], rowsAffected: 0 };
      }

      if (/^\s*UPDATE _collab_docs\b/i.test(sql)) {
        const hasVersionGuard = /\bAND version = \?/i.test(sql);
        const docId = String(args[2]);
        const row = rows.get(docId);
        if (!row) return { rows: [], rowsAffected: 0 };
        if (hasVersionGuard && row.version !== Number(args[3])) {
          return { rows: [], rowsAffected: 0 };
        }
        rows.set(docId, {
          yjs_state: String(args[0]),
          text_snapshot: String(args[1]),
          version: row.version + 1,
        });
        return { rows: [], rowsAffected: 1 };
      }

      if (/^\s*INSERT (OR IGNORE )?INTO _collab_docs/i.test(sql)) {
        const docId = String(args[0]);
        if (rows.has(docId)) return { rows: [], rowsAffected: 0 };
        rows.set(docId, {
          yjs_state: String(args[1]),
          text_snapshot: String(args[2]),
          version: 0,
        });
        return { rows: [], rowsAffected: 1 };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    },
  }),
  isPostgres: () => false,
}));

describe("collab storage optimistic saves", () => {
  afterEach(() => {
    rows.clear();
  });

  it("rejects stale version writes so callers can merge and retry", async () => {
    await saveYDocState("doc-1", new Uint8Array([1]), "one");
    const firstRead = await loadYDocRecord("doc-1");

    expect(firstRead?.version).toBe(0);
    expect(
      await trySaveYDocState(
        "doc-1",
        new Uint8Array([2]),
        "two",
        firstRead!.version,
      ),
    ).toBe(true);
    expect(
      await trySaveYDocState(
        "doc-1",
        new Uint8Array([3]),
        "three",
        firstRead!.version,
      ),
    ).toBe(false);

    const latest = await loadYDocRecord("doc-1");
    expect(latest?.version).toBe(1);
    expect(latest?.state).toEqual(new Uint8Array([2]));
    expect(rows.get("doc-1")?.yjs_state).toBe(toBase64(new Uint8Array([2])));
  });
});
