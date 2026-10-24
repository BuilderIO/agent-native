import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_AWARENESS_CLIENT_SEQUENCE,
  MAX_AWARENESS_CLIENT_SEQUENCE_ADVANCE,
} from "./awareness-sequence.js";

const dbRows = vi.hoisted(
  () =>
    new Map<
      string,
      {
        state: string;
        last_seen: number;
        client_sequence: number;
        client_sequence_raw: number;
        cleared: boolean;
        actor_email: string | null;
      }
    >(),
);
const dbAvailable = vi.hoisted(() => ({ value: true }));
const purgeCalls = vi.hoisted(() => ({ count: 0 }));
const purgeFails = vi.hoisted(() => ({ value: false }));

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
        let clientSequence = Number(args[4]);
        const rawSequence = Number(args[6]);
        const actorEmail =
          typeof args[7] === "string"
            ? String(args[7]).trim().toLowerCase()
            : null;
        const previous = dbRows.get(key);
        let applies = false;
        if (!previous) {
          applies =
            rawSequence > 0 ||
            clientSequence <= MAX_AWARENESS_CLIENT_SEQUENCE_ADVANCE;
        } else if (rawSequence > 0) {
          applies =
            previous.client_sequence_raw > 0
              ? rawSequence > previous.client_sequence_raw
              : previous.client_sequence > MAX_AWARENESS_CLIENT_SEQUENCE
                ? rawSequence > previous.client_sequence
                : previous.client_sequence === 0 && !previous.cleared;
          if (applies) {
            clientSequence =
              previous.client_sequence >= MAX_AWARENESS_CLIENT_SEQUENCE
                ? 1
                : previous.client_sequence + 1;
          }
        } else if (clientSequence > 0) {
          applies =
            !previous.cleared &&
            (previous.client_sequence_raw > 0 ||
            previous.client_sequence > MAX_AWARENESS_CLIENT_SEQUENCE
              ? clientSequence <= MAX_AWARENESS_CLIENT_SEQUENCE_ADVANCE
              : clientSequence > previous.client_sequence &&
                clientSequence <=
                  previous.client_sequence +
                    MAX_AWARENESS_CLIENT_SEQUENCE_ADVANCE);
        } else {
          applies =
            previous.client_sequence_raw === 0 &&
            previous.client_sequence === 0 &&
            !previous.cleared;
        }
        if (
          applies &&
          previous &&
          previous.actor_email !== actorEmail &&
          previous.last_seen >=
            Number(args[3]) - (previous.cleared ? 60_000 : 30_000)
        ) {
          applies = false;
        }
        if (applies) {
          dbRows.set(key, {
            state: String(args[2]),
            last_seen: Number(args[3]),
            client_sequence: clientSequence,
            client_sequence_raw: rawSequence,
            cleared: Boolean(args[5]),
            actor_email: actorEmail,
          });
          return { rows: [{ client_id: Number(args[1]) }], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: 0 };
      }
      if (/^\s*SELECT client_sequence, client_sequence_raw/i.test(sql)) {
        const row = dbRows.get(rowKey(String(args[0]), Number(args[1])));
        return {
          rows: row
            ? [
                {
                  client_sequence: row.client_sequence,
                  client_sequence_raw: row.client_sequence_raw,
                },
              ]
            : [],
          rowsAffected: 0,
        };
      }
      if (/^\s*SELECT client_sequence, cleared/i.test(sql)) {
        const row = dbRows.get(rowKey(String(args[0]), Number(args[1])));
        return {
          rows: row
            ? [
                {
                  client_sequence: row.client_sequence,
                  cleared: row.cleared,
                  actor_email: row.actor_email,
                },
              ]
            : [],
          rowsAffected: 0,
        };
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
      if (/^\s*DELETE FROM _collab_awareness WHERE last_seen < \?/i.test(sql)) {
        purgeCalls.count += 1;
        if (purgeFails.value) throw new Error("purge unavailable");
        for (const [key, row] of dbRows) {
          if (row.last_seen < Number(args[0])) dbRows.delete(key);
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
  loadAwarenessClientSequence,
  loadAwarenessRows,
  loadAwarenessRowsStrict,
  upsertAwarenessRow,
  writeAwarenessRow,
} from "./awareness-store.js";

beforeEach(() => {
  dbRows.clear();
  dbAvailable.value = true;
  purgeCalls.count = 0;
  purgeFails.value = false;
  _resetAwarenessStoreForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
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

  it("returns rows when best-effort expiry cleanup fails", async () => {
    const cleanupFailure = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    dbRows.set(rowKey("doc-purge-read", 3), {
      state: "active-state",
      last_seen: 60_000,
      client_sequence: 1,
      client_sequence_raw: 0,
      cleared: false,
    });
    purgeFails.value = true;

    await expect(
      loadAwarenessRows("doc-purge-read", 60_000),
    ).resolves.toMatchObject([{ clientId: 3, state: "active-state" }]);

    expect(cleanupFailure).toHaveBeenCalledWith(
      "Failed to purge expired collaboration awareness rows",
      expect.objectContaining({ message: "purge unavailable" }),
    );
  });

  it("keeps an applied presence write successful when expiry cleanup fails", async () => {
    const cleanupFailure = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    purgeFails.value = true;

    await expect(
      writeAwarenessRow("doc-purge-write", 4, "active-state", 60_000, 1, false),
    ).resolves.toBe(true);

    expect(dbRows.get(rowKey("doc-purge-write", 4))).toMatchObject({
      state: "active-state",
      client_sequence: 1,
      cleared: false,
    });
    expect(cleanupFailure).toHaveBeenCalledWith(
      "Failed to purge expired collaboration awareness rows",
      expect.objectContaining({ message: "purge unavailable" }),
    );
  });

  it("purges expired tombstones across documents on unrelated reads", async () => {
    await writeAwarenessRow("abandoned-doc", 7, "", 1_000, 10, true);

    await expect(
      loadAwarenessRowsStrict("active-doc", 70_000),
    ).resolves.toEqual([]);

    expect(dbRows.has(rowKey("abandoned-doc", 7))).toBe(false);
  });

  it("shares a global purge across concurrent document reads", async () => {
    await Promise.all([
      loadAwarenessRowsStrict("doc-a", 70_000),
      loadAwarenessRowsStrict("doc-b", 70_000),
    ]);

    expect(purgeCalls.count).toBe(1);
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

  it("does not let legacy sequence-zero writes replace clear tombstones", async () => {
    await writeAwarenessRow("doc-legacy", 3, "", 1_000, 0, true);

    await upsertAwarenessRow("doc-legacy", 3, '{"visible":true}', 2_000);

    expect(dbRows.get(rowKey("doc-legacy", 3))).toEqual({
      state: "",
      last_seen: 1_000,
      client_sequence: 0,
      client_sequence_raw: 0,
      cleared: true,
      actor_email: null,
    });
  });

  it("keeps an active client id bound to its first authenticated actor", async () => {
    await expect(
      writeAwarenessRow(
        "doc-actor",
        9,
        "owner-state",
        1_000,
        1,
        false,
        "owner@example.com",
      ),
    ).resolves.toBe(true);

    await expect(
      writeAwarenessRow(
        "doc-actor",
        9,
        "forged-state",
        2_000,
        2,
        false,
        "viewer@example.com",
      ),
    ).resolves.toBe(false);

    await expect(loadAwarenessClientSequence("doc-actor", 9)).resolves.toEqual({
      clientSequence: 1,
      cleared: false,
      actorEmail: "owner@example.com",
    });
    await expect(loadAwarenessRows("doc-actor", 2_000)).resolves.toMatchObject([
      { clientId: 9, state: "owner-state" },
    ]);
  });

  it("lets a client claim a legacy row after its presence expires", async () => {
    await upsertAwarenessRow("doc-legacy-owner", 9, "expired-state", 1_000);

    await expect(
      writeAwarenessRow(
        "doc-legacy-owner",
        9,
        "new-owner-state",
        31_001,
        1,
        false,
        "owner@example.com",
      ),
    ).resolves.toBe(true);

    expect(dbRows.get(rowKey("doc-legacy-owner", 9))).toMatchObject({
      state: "new-owner-state",
      actor_email: "owner@example.com",
    });
  });

  it("serves awareness when the best-effort expiry purge fails", async () => {
    const cleanupFailure = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    purgeFails.value = true;

    await expect(
      writeAwarenessRow(
        "doc-purge-failure",
        9,
        "visible-state",
        40_000,
        1,
        false,
      ),
    ).resolves.toBe(true);

    await expect(
      loadAwarenessRowsStrict("doc-purge-failure", 40_000),
    ).resolves.toMatchObject([{ clientId: 9, state: "visible-state" }]);
    expect(cleanupFailure).toHaveBeenCalledWith(
      "Failed to purge expired collaboration awareness rows",
      expect.any(Error),
    );
    expect(purgeCalls.count).toBe(2);

    cleanupFailure.mockRestore();
  });

  it("normalizes accepted legacy wall clocks before storing their sequence", async () => {
    const legacyClock = 2_000_000_000_000;
    await writeAwarenessRow(
      "doc-clock-skew",
      7,
      "legacy-state",
      1_000,
      legacyClock,
      false,
    );

    expect(dbRows.get(rowKey("doc-clock-skew", 7))).toMatchObject({
      client_sequence: 1,
      client_sequence_raw: legacyClock,
      cleared: false,
    });

    await expect(
      writeAwarenessRow("doc-clock-skew", 7, "new-state", 2_000, 1, false),
    ).resolves.toBe(true);

    expect(dbRows.get(rowKey("doc-clock-skew", 7))).toMatchObject({
      state: "new-state",
      client_sequence: 1,
      client_sequence_raw: 0,
    });

    await expect(
      writeAwarenessRow(
        "doc-clock-skew",
        7,
        "stale-legacy-state",
        3_000,
        2_000_000_000_000,
        false,
      ),
    ).resolves.toBe(false);
  });

  it("rejects a legacy clock far beyond the configured skew window", async () => {
    await expect(
      writeAwarenessRow(
        "doc-clock-limit",
        7,
        "attacker-state",
        1_000,
        Number.MAX_SAFE_INTEGER,
        false,
      ),
    ).resolves.toBe(false);

    expect(dbRows.has(rowKey("doc-clock-limit", 7))).toBe(false);
  });

  it("caps first counter writes so a client cannot poison a client id", async () => {
    await expect(
      writeAwarenessRow(
        "doc-sequence-cap",
        7,
        "attacker-state",
        1_000,
        MAX_AWARENESS_CLIENT_SEQUENCE,
        false,
      ),
    ).resolves.toBe(false);

    await expect(
      writeAwarenessRow("doc-sequence-cap", 7, "valid-state", 2_000, 1, false),
    ).resolves.toBe(true);

    expect(dbRows.get(rowKey("doc-sequence-cap", 7))).toMatchObject({
      state: "valid-state",
      client_sequence: 1,
      client_sequence_raw: 0,
    });
  });

  it("preserves legacy clock ordering around clear tombstones", async () => {
    await writeAwarenessRow(
      "doc-clock-tombstone",
      7,
      "",
      1_000,
      2_000_000_000_000,
      true,
    );

    await expect(
      writeAwarenessRow(
        "doc-clock-tombstone",
        7,
        "stale-state",
        2_000,
        1_900_000_000_000,
        false,
      ),
    ).resolves.toBe(false);

    await expect(
      writeAwarenessRow(
        "doc-clock-tombstone",
        7,
        "fresh-state",
        3_000,
        2_100_000_000_000,
        false,
      ),
    ).resolves.toBe(true);

    expect(dbRows.get(rowKey("doc-clock-tombstone", 7))).toMatchObject({
      state: "fresh-state",
      client_sequence: 2,
      client_sequence_raw: 2_100_000_000_000,
      cleared: false,
    });
  });

  it("does not let bounded writes replace legacy clear tombstones", async () => {
    await writeAwarenessRow(
      "doc-bounded-tombstone",
      7,
      "",
      1_000,
      2_000_000_000_000,
      true,
    );

    await expect(
      writeAwarenessRow(
        "doc-bounded-tombstone",
        7,
        "stale-state",
        2_000,
        2,
        false,
      ),
    ).resolves.toBe(false);

    expect(dbRows.get(rowKey("doc-bounded-tombstone", 7))).toMatchObject({
      state: "",
      client_sequence_raw: 2_000_000_000_000,
      cleared: true,
    });
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

  it("fails agent presence writes, deletes, and ordered reads loudly", async () => {
    dbAvailable.value = false;
    await expect(upsertAwarenessRow("doc-6", 1, "{}", 1000)).rejects.toThrow(
      "db not configured",
    );
    await expect(deleteAwarenessRow("doc-6", 1)).rejects.toThrow(
      "db not configured",
    );
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
