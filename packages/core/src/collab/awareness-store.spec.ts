import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbRows = vi.hoisted(
  () => new Map<string, { state: string; last_seen: number }>(),
);
const dbAvailable = vi.hoisted(() => ({ value: true }));

function rowKey(docId: string, clientId: number): string {
  return `${docId}|${clientId}`;
}

vi.mock("../db/client.js", () => ({
  isPostgres: () => false,
  getDbExec: () => {
    if (!dbAvailable.value) throw new Error("db not configured");
    return {
      execute: async (query: string | { sql: string; args?: unknown[] }) => {
        const sql = typeof query === "string" ? query : query.sql;
        const args = typeof query === "string" ? [] : (query.args ?? []);

        if (/^\s*CREATE TABLE/i.test(sql)) {
          return { rows: [], rowsAffected: 0 };
        }
        if (/^\s*INSERT OR REPLACE INTO _collab_awareness/i.test(sql)) {
          dbRows.set(rowKey(String(args[0]), Number(args[1])), {
            state: String(args[2]),
            last_seen: Number(args[3]),
          });
          return { rows: [], rowsAffected: 1 };
        }
        if (
          /^\s*DELETE FROM _collab_awareness WHERE doc_id = \? AND client_id = \?/i.test(
            sql,
          )
        ) {
          dbRows.delete(rowKey(String(args[0]), Number(args[1])));
          return { rows: [], rowsAffected: 1 };
        }
        if (
          /^\s*DELETE FROM _collab_awareness WHERE doc_id = \? AND last_seen < \?/i.test(
            sql,
          )
        ) {
          for (const [key, row] of dbRows) {
            if (
              key.startsWith(`${String(args[0])}|`) &&
              row.last_seen < Number(args[1])
            ) {
              dbRows.delete(key);
            }
          }
          return { rows: [], rowsAffected: 0 };
        }
        if (/^\s*SELECT client_id, state, last_seen/i.test(sql)) {
          const docId = String(args[0]);
          const min = Number(args[1]);
          const rows: Array<{
            client_id: number;
            state: string;
            last_seen: number;
          }> = [];
          for (const [key, row] of dbRows) {
            const [d, c] = key.split("|");
            if (d === docId && row.last_seen >= min) {
              rows.push({
                client_id: Number(c),
                state: row.state,
                last_seen: row.last_seen,
              });
            }
          }
          return { rows, rowsAffected: 0 };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };
  },
}));

import {
  _resetAwarenessStoreForTests,
  deleteAwarenessRow,
  loadAwarenessRows,
  upsertAwarenessRow,
} from "./awareness-store.js";

beforeEach(() => {
  dbRows.clear();
  dbAvailable.value = true;
  _resetAwarenessStoreForTests();
});

afterEach(() => {
  _resetAwarenessStoreForTests();
});

describe("awareness-store", () => {
  it("round-trips awareness rows", async () => {
    await upsertAwarenessRow("doc-1", 42, '{"user":{"name":"A"}}', 1000);
    const rows = await loadAwarenessRows("doc-1", 1000);
    expect(rows).toEqual([
      { clientId: 42, state: '{"user":{"name":"A"}}', lastSeen: 1000 },
    ]);
  });

  it("filters expired rows on load", async () => {
    await upsertAwarenessRow("doc-2", 1, "{}", 1000);
    await upsertAwarenessRow("doc-2", 2, "{}", 50_000);
    const rows = await loadAwarenessRows("doc-2", 60_000);
    expect(rows.map((r) => r.clientId)).toEqual([2]);
  });

  it("throttles unchanged rewrites within the window", async () => {
    await upsertAwarenessRow("doc-3", 7, "{}", 1000);
    // Same state, 500ms later — throttled (row keeps old last_seen).
    await upsertAwarenessRow("doc-3", 7, "{}", 1500);
    expect(dbRows.get(rowKey("doc-3", 7))?.last_seen).toBe(1000);

    // Changed state — written immediately.
    await upsertAwarenessRow("doc-3", 7, '{"x":1}', 1600);
    expect(dbRows.get(rowKey("doc-3", 7))?.last_seen).toBe(1600);

    // Same state past the throttle window — refreshes last_seen.
    await upsertAwarenessRow("doc-3", 7, '{"x":1}', 10_000);
    expect(dbRows.get(rowKey("doc-3", 7))?.last_seen).toBe(10_000);
  });

  it("deletes rows and allows immediate rewrite", async () => {
    await upsertAwarenessRow("doc-4", 9, "{}", 1000);
    await deleteAwarenessRow("doc-4", 9);
    expect(dbRows.size).toBe(0);

    // Rewrite after delete is not throttled away.
    await upsertAwarenessRow("doc-4", 9, "{}", 1100);
    expect(dbRows.size).toBe(1);
  });

  it("supports Yjs client ids above int32 range", async () => {
    const bigClientId = 3_000_000_000; // uint32 territory
    await upsertAwarenessRow("doc-5", bigClientId, "{}", 1000);
    const rows = await loadAwarenessRows("doc-5", 1000);
    expect(rows[0].clientId).toBe(bigClientId);
  });

  it("degrades silently when the DB is unavailable", async () => {
    dbAvailable.value = false;
    await expect(
      upsertAwarenessRow("doc-6", 1, "{}", 1000),
    ).resolves.toBeUndefined();
    await expect(deleteAwarenessRow("doc-6", 1)).resolves.toBeUndefined();
    await expect(loadAwarenessRows("doc-6")).resolves.toEqual([]);
  });
});
