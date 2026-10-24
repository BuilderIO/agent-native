import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbRows = vi.hoisted(
  () =>
    new Map<
      string,
      {
        state: string;
        last_seen: number;
        client_sequence: number;
        cleared: boolean;
      }
    >(),
);
const dbAvailable = vi.hoisted(() => ({ value: true }));

function rowKey(docId: string, clientId: number): string {
  return `${docId}|${clientId}`;
}

vi.mock("../db/client.js", async () => {
  const { storeLedgerResult } =
    await import("../db/store-ledger.test-helpers.js");
  const exec = {
    execute: async (query: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof query === "string" ? query : query.sql;
      const args = typeof query === "string" ? [] : (query.args ?? []);
      const ledger = storeLedgerResult(sql);
      if (ledger) return ledger;

      if (/^\s*CREATE TABLE/i.test(sql)) {
        return { rows: [], rowsAffected: 0 };
      }
      if (
        /^\s*INSERT INTO _collab_awareness/i.test(sql) &&
        /ON CONFLICT\s*\(\s*doc_id\s*,\s*client_id\s*\)/i.test(sql)
      ) {
        const key = rowKey(String(args[0]), Number(args[1]));
        const clientSequence = Number(args[4]);
        const previous = dbRows.get(key);
        if (
          !previous ||
          clientSequence > previous.client_sequence ||
          (clientSequence === 0 && previous.client_sequence === 0)
        ) {
          dbRows.set(key, {
            state: String(args[2]),
            last_seen: Number(args[3]),
            client_sequence: clientSequence,
            cleared: Boolean(args[5]),
          });
          return { rows: [{ client_id: Number(args[1]) }], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: 0 };
      }
      if (/last_seen <= \?/i.test(sql)) {
        const key = rowKey(String(args[0]), Number(args[1]));
        const row = dbRows.get(key);
        if (row && row.last_seen <= Number(args[2])) {
          dbRows.delete(key);
        }
        return { rows: [], rowsAffected: 1 };
      }
      if (
        /^\s*DELETE FROM _collab_awareness WHERE doc_id = \? AND client_id = \?\s*$/i.test(
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
        const activeMin = Number(args[1]);
        const clearMin = Number(args[2]);
        const rows: Array<{
          client_id: number;
          state: string;
          last_seen: number;
          client_sequence: number;
          cleared: boolean;
        }> = [];
        for (const [key, row] of dbRows) {
          const [d, c] = key.split("|");
          if (
            d === docId &&
            row.last_seen >= (row.cleared ? clearMin : activeMin)
          ) {
            rows.push({
              client_id: Number(c),
              state: row.state,
              last_seen: row.last_seen,
              client_sequence: row.client_sequence,
              cleared: row.cleared,
            });
          }
        }
        return { rows, rowsAffected: 0 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  return {
    getDbExec: () => {
      if (!dbAvailable.value) throw new Error("db not configured");
      return exec;
    },
  };
});

vi.mock("../db/ddl-guard.js", () => ({
  ensureTableExists: vi.fn().mockResolvedValue(undefined),
  ensureColumnExists: vi.fn().mockResolvedValue(undefined),
}));

import {
  _resetAwarenessStoreForTests,
  deleteAwarenessRow,
  loadAwarenessRows,
  loadAwarenessRowsStrict,
  upsertAwarenessRow,
  writeAwarenessRow,
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
      {
        clientId: 42,
        state: '{"user":{"name":"A"}}',
        lastSeen: 1000,
        clientSequence: 0,
        cleared: false,
      },
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
    await upsertAwarenessRow("doc-3", 7, "{}", 1500);
    expect(dbRows.get(rowKey("doc-3", 7))?.last_seen).toBe(1000);

    await upsertAwarenessRow("doc-3", 7, '{"x":1}', 1600);
    expect(dbRows.get(rowKey("doc-3", 7))?.last_seen).toBe(1600);

    await upsertAwarenessRow("doc-3", 7, '{"x":1}', 10_000);
    expect(dbRows.get(rowKey("doc-3", 7))?.last_seen).toBe(10_000);
  });

  it("deletes rows and allows immediate rewrite", async () => {
    await upsertAwarenessRow("doc-4", 9, "{}", 1000);
    await deleteAwarenessRow("doc-4", 9);
    expect(dbRows.size).toBe(0);

    await upsertAwarenessRow("doc-4", 9, "{}", 1100);
    expect(dbRows.size).toBe(1);
  });

  it("bounds deletes so stale clears cannot remove newer rows", async () => {
    await upsertAwarenessRow("doc-4b", 9, "{}", 2000);

    await deleteAwarenessRow("doc-4b", 9, 1000);
    expect(dbRows.has(rowKey("doc-4b", 9))).toBe(true);

    await deleteAwarenessRow("doc-4b", 9, 2000);
    expect(dbRows.has(rowKey("doc-4b", 9))).toBe(false);
  });

  it("rejects stale requests and preserves clear sequences across writes", async () => {
    await expect(
      writeAwarenessRow("doc-ordered", 9, "", 2000, 20, true),
    ).resolves.toBe(true);

    await expect(
      writeAwarenessRow("doc-ordered", 9, '{"visible":true}', 3000, 19, false),
    ).resolves.toBe(false);

    const rows = await loadAwarenessRows("doc-ordered", 3000);
    expect(rows).toEqual([
      {
        clientId: 9,
        state: "",
        lastSeen: 2000,
        clientSequence: 20,
        cleared: true,
      },
    ]);
  });

  it("persists higher sequences even when the awareness payload is unchanged", async () => {
    await writeAwarenessRow("doc-heartbeat", 3, "{}", 1000, 4, false);
    await writeAwarenessRow("doc-heartbeat", 3, "{}", 1500, 5, false);

    const rows = await loadAwarenessRows("doc-heartbeat", 1500);
    expect(rows[0]).toMatchObject({
      lastSeen: 1500,
      clientSequence: 5,
      cleared: false,
    });
  });

  it("supports Yjs client ids above int32 range", async () => {
    const bigClientId = 3_000_000_000;
    await upsertAwarenessRow("doc-5", bigClientId, "{}", 1000);
    const rows = await loadAwarenessRows("doc-5", 1000);
    expect(rows[0].clientId).toBe(bigClientId);
  });

  it("keeps legacy agent writes best-effort and fails ordered reads and writes loudly", async () => {
    dbAvailable.value = false;
    await expect(
      upsertAwarenessRow("doc-6", 1, "{}", 1000),
    ).resolves.toBeUndefined();
    await expect(deleteAwarenessRow("doc-6", 1)).resolves.toBeUndefined();
    await expect(
      writeAwarenessRow("doc-6", 1, "{}", 1000, 1, false),
    ).rejects.toThrow("db not configured");
    await expect(loadAwarenessRows("doc-6")).rejects.toThrow(
      "db not configured",
    );
    await expect(loadAwarenessRowsStrict("doc-6")).rejects.toThrow(
      "db not configured",
    );
  });
});
