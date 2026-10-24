import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { runRecurringSweepHandlers } from "../jobs/sweep-hooks.js";
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
        clear_token_hash: string | null;
        actor_email_expires_at?: number | null;
      }
    >(),
);
const dbAvailable = vi.hoisted(() => ({ value: true }));
const purgeCalls = vi.hoisted(() => ({ count: 0 }));
const purgeFails = vi.hoisted(() => ({ value: false }));
const purgeHang = vi.hoisted(() => ({
  promise: undefined as Promise<void> | undefined,
}));
const purgeStarted = vi.hoisted(() => ({
  signal: undefined as (() => void) | undefined,
}));
const clearRace = vi.hoisted(() => ({ value: false }));
const clearUpsertQuery = vi.hoisted(() => ({
  value: null as null | { sql: string; args: unknown[] },
}));
const executedSql = vi.hoisted(() => [] as string[]);
const purgeQueries = vi.hoisted(() => ({
  value: [] as Array<{ kind: string; sql: string; args: unknown[] }>,
}));
const expiryIndexSql = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; sql: string }>,
}));

function rowKey(docId: string, clientId: number): string {
  return `${docId}|${clientId}`;
}

function compareAwarenessKeys(left: string, right: string): number {
  const [leftDocId, leftClientId] = left.split("|");
  const [rightDocId, rightClientId] = right.split("|");
  return (
    leftDocId!.localeCompare(rightDocId!) ||
    Number(leftClientId) - Number(rightClientId)
  );
}

vi.mock("../db/client.js", async () => {
  const { storeLedgerResult } =
    await import("../db/store-ledger.test-helpers.js");
  const exec = {
    execute: async (query: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof query === "string" ? query : query.sql;
      const args = typeof query === "string" ? [] : (query.args ?? []);
      executedSql.push(sql);
      const ledger = storeLedgerResult(sql);
      if (ledger) return ledger;

      if (/^\s*CREATE TABLE/i.test(sql)) {
        return { rows: [], rowsAffected: 0 };
      }
      if (
        /^\s*INSERT INTO _collab_awareness/i.test(sql) &&
        /ON CONFLICT\s*\(\s*doc_id\s*,\s*client_id\s*\) DO NOTHING/i.test(sql)
      ) {
        const key = rowKey(String(args[0]), Number(args[1]));
        if (dbRows.has(key)) return { rows: [], rowsAffected: 0 };
        dbRows.set(key, {
          state: "",
          last_seen: Number(args[2]),
          client_sequence: Number(args[3]),
          client_sequence_raw: Number(args[4]),
          cleared: true,
          actor_email:
            typeof args[5] === "string" ? String(args[5]).toLowerCase() : null,
          clear_token_hash: null,
          actor_email_expires_at:
            typeof args[6] === "number" ? Number(args[6]) : null,
        });
        return {
          rows: [{ client_id: Number(args[1]) }],
          rowsAffected: 1,
        };
      }
      if (
        /^\s*INSERT INTO _collab_awareness/i.test(sql) &&
        /ON CONFLICT\s*\(\s*doc_id\s*,\s*client_id\s*\)\s+DO UPDATE SET\s+state = ''/i.test(
          sql,
        )
      ) {
        const hasExistingRowGuard =
          /WHERE EXISTS \(\s*SELECT 1 FROM _collab_awareness\s+WHERE doc_id = \? AND client_id = \?\s*\)/i.test(
            sql,
          );
        if (
          hasExistingRowGuard &&
          !dbRows.has(rowKey(String(args[7]), Number(args[8])))
        ) {
          return { rows: [], rowsAffected: 0 };
        }
        if (typeof query !== "string") {
          clearUpsertQuery.value = { sql, args: [...args] };
        }
        const key = rowKey(String(args[0]), Number(args[1]));
        const lastSeen = Number(args[2]);
        const incomingSequence = Number(args[3]);
        const incomingRawSequence = Number(args[4]);
        const actorEmail =
          typeof args[5] === "string"
            ? String(args[5]).trim().toLowerCase()
            : null;
        const actorEmailExpiresAt =
          typeof args[6] === "number" ? Number(args[6]) : null;
        const isLegacyClockSequence = sql.includes("client_sequence + 1");
        let argumentIndex = 7;
        if (hasExistingRowGuard) argumentIndex += 2;
        if (isLegacyClockSequence) argumentIndex++;
        const tokenActorEmail = args[argumentIndex++];
        const tokenHashPresent = args[argumentIndex++];
        const tokenHash = args[argumentIndex++];
        const sequenceArguments = args.slice(argumentIndex).map(Number);

        const row = dbRows.get(key);
        if (clearRace.value && row) {
          clearRace.value = false;
          row.state = "concurrent-presence";
          row.last_seen = 2_000;
          row.client_sequence = 2;
          row.client_sequence_raw = 0;
        }

        if (!row) {
          dbRows.set(key, {
            state: "",
            last_seen: lastSeen,
            client_sequence: incomingSequence,
            client_sequence_raw: incomingRawSequence,
            cleared: true,
            actor_email: actorEmail,
            clear_token_hash: null,
            actor_email_expires_at: actorEmailExpiresAt,
          });
          return { rows: [{ client_id: Number(args[1]) }], rowsAffected: 1 };
        }

        const sameActor = row.actor_email === actorEmail;
        const ownsClearToken =
          tokenActorEmail != null &&
          tokenHashPresent != null &&
          row.actor_email !== null &&
          row.clear_token_hash === tokenHash &&
          row.last_seen >= lastSeen - 60_000;
        const sequence = isLegacyClockSequence
          ? sequenceArguments[0]
          : incomingSequence;
        const canAdvance =
          sequence > MAX_AWARENESS_CLIENT_SEQUENCE
            ? row.client_sequence_raw > 0
              ? sequence > row.client_sequence_raw
              : row.client_sequence > MAX_AWARENESS_CLIENT_SEQUENCE
                ? sequence > row.client_sequence
                : row.client_sequence === 0
            : sequence > 0
              ? row.client_sequence_raw > 0 ||
                row.client_sequence > MAX_AWARENESS_CLIENT_SEQUENCE
                ? sequence <= MAX_AWARENESS_CLIENT_SEQUENCE_ADVANCE
                : sequence > row.client_sequence &&
                  sequence <=
                    row.client_sequence + MAX_AWARENESS_CLIENT_SEQUENCE_ADVANCE
              : row.client_sequence_raw === 0 && row.client_sequence === 0;

        if (
          row.cleared ||
          (!sameActor && !ownsClearToken) ||
          (sameActor && !canAdvance)
        ) {
          return { rows: [], rowsAffected: 0 };
        }

        row.state = "";
        row.last_seen = Math.max(row.last_seen, lastSeen);
        row.client_sequence = sameActor
          ? sequence > MAX_AWARENESS_CLIENT_SEQUENCE
            ? row.client_sequence >= MAX_AWARENESS_CLIENT_SEQUENCE
              ? 1
              : row.client_sequence + 1
            : incomingSequence
          : row.client_sequence;
        row.client_sequence_raw = sameActor
          ? sequence > MAX_AWARENESS_CLIENT_SEQUENCE
            ? sequence
            : 0
          : row.client_sequence_raw;
        row.cleared = true;
        row.clear_token_hash = null;
        row.actor_email_expires_at = row.actor_email
          ? row.last_seen + 60_000
          : null;
        return { rows: [{ client_id: Number(args[1]) }], rowsAffected: 1 };
      }
      if (
        /^\s*INSERT INTO _collab_awareness/i.test(sql) &&
        /ON CONFLICT\s*\(\s*doc_id\s*,\s*client_id\s*\)/i.test(sql)
      ) {
        const hasExistingRowGuard =
          /WHERE EXISTS \(\s*SELECT 1 FROM _collab_awareness\s+WHERE doc_id = \? AND client_id = \?\s*\)/i.test(
            sql,
          );
        if (
          hasExistingRowGuard &&
          !dbRows.has(rowKey(String(args[10]), Number(args[11])))
        ) {
          return { rows: [], rowsAffected: 0 };
        }
        const key = rowKey(String(args[0]), Number(args[1]));
        let clientSequence = Number(args[4]);
        const rawSequence = Number(args[6]);
        const actorEmail =
          typeof args[7] === "string"
            ? String(args[7]).trim().toLowerCase()
            : null;
        const clearTokenHash =
          typeof args[8] === "string" ? String(args[8]) : null;
        const actorEmailExpiresAt =
          typeof args[9] === "number" ? Number(args[9]) : null;
        const previous = dbRows.get(key);
        let applies = false;
        if (!previous) {
          applies =
            rawSequence > 0 ||
            clientSequence <= MAX_AWARENESS_CLIENT_SEQUENCE_ADVANCE;
        } else if (
          previous.actor_email !== actorEmail &&
          previous.actor_email !== null &&
          (previous.actor_email_expires_at ?? previous.last_seen + 60_000) <=
            Number(args[3])
        ) {
          applies = true;
          clientSequence = Number(args[4]);
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
          ((previous.actor_email !== null &&
            (previous.actor_email_expires_at ?? previous.last_seen + 60_000) >
              Number(args[3])) ||
            previous.last_seen >=
              Number(args[3]) - (previous.cleared ? 60_000 : 30_000))
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
            clear_token_hash: clearTokenHash,
            actor_email_expires_at: actorEmailExpiresAt,
          });
          return { rows: [{ client_id: Number(args[1]) }], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: 0 };
      }
      if (
        /^\s*SELECT client_sequence, client_sequence_raw, cleared, actor_email,\s+clear_token_hash, actor_email_expires_at, last_seen/i.test(
          sql,
        )
      ) {
        const row = dbRows.get(rowKey(String(args[0]), Number(args[1])));
        return {
          rows: row ? [{ ...row }] : [],
          rowsAffected: 0,
        };
      }
      if (
        /^\s*UPDATE _collab_awareness\s+SET state = '', last_seen = \?, client_sequence = \?,/i.test(
          sql,
        )
      ) {
        const [
          lastSeen,
          clientSequence,
          rawSequence,
          actorEmailExpiresAt,
          docId,
          clientId,
          expectedSequence,
          expectedRawSequence,
          expectedActorEmail,
          expectedClearTokenHash,
          expectedActorEmailExpiresAt,
          expectedLastSeen,
        ] = args;
        const row = dbRows.get(rowKey(String(docId), Number(clientId)));
        if (
          row &&
          !row.cleared &&
          row.client_sequence === Number(expectedSequence) &&
          row.client_sequence_raw === Number(expectedRawSequence) &&
          row.actor_email === expectedActorEmail &&
          row.clear_token_hash === expectedClearTokenHash &&
          row.actor_email_expires_at === expectedActorEmailExpiresAt &&
          row.last_seen === Number(expectedLastSeen)
        ) {
          row.state = "";
          row.last_seen = Number(lastSeen);
          row.client_sequence = Number(clientSequence);
          row.client_sequence_raw = Number(rawSequence);
          row.cleared = true;
          row.clear_token_hash = null;
          row.actor_email_expires_at =
            actorEmailExpiresAt == null ? null : Number(actorEmailExpiresAt);
          return {
            rows: [{ client_id: Number(clientId) }],
            rowsAffected: 1,
          };
        }
        return { rows: [], rowsAffected: 0 };
      }
      if (
        /^\s*SELECT client_sequence, client_sequence_raw, cleared/i.test(sql)
      ) {
        const row = dbRows.get(rowKey(String(args[0]), Number(args[1])));
        return {
          rows: row
            ? [
                {
                  client_sequence: row.client_sequence,
                  client_sequence_raw: row.client_sequence_raw,
                  cleared: row.cleared,
                  actor_email: row.actor_email,
                  last_seen: row.last_seen,
                  clear_token_hash: row.clear_token_hash,
                },
              ]
            : [],
          rowsAffected: 0,
        };
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
      if (
        /^\s*WITH batch AS MATERIALIZED \([\s\S]+\)\s+UPDATE _collab_awareness/i.test(
          sql,
        )
      ) {
        purgeQueries.value.push({ kind: "update", sql, args: [...args] });
        purgeCalls.count += 1;
        purgeStarted.signal?.();
        if (purgeFails.value) throw new Error("purge unavailable");
        if (purgeHang.promise) await purgeHang.promise;
        const expiredBefore = Number(args[0]);
        const batchSize = Number(/LIMIT\s+(\d+)/i.exec(sql)?.[1] ?? 0);
        const batch = [...dbRows.entries()]
          .filter(
            ([, row]) =>
              row.actor_email !== null &&
              row.state !== "" &&
              row.last_seen < expiredBefore,
          )
          .sort(
            ([leftKey, left], [rightKey, right]) =>
              left.last_seen - right.last_seen ||
              compareAwarenessKeys(leftKey, rightKey),
          )
          .slice(0, batchSize);
        for (const [, row] of batch) {
          row.state = "";
          row.clear_token_hash = null;
        }
        return { rows: [], rowsAffected: batch.length };
      }
      if (
        /^\s*WITH batch AS MATERIALIZED \([\s\S]+\)\s+DELETE FROM _collab_awareness/i.test(
          sql,
        ) &&
        /actor_email IS NOT NULL/i.test(sql)
      ) {
        purgeQueries.value.push({ kind: "actor-delete", sql, args: [...args] });
        const expiredAt = Number(args[0]);
        const batchSize = Number(/LIMIT\s+(\d+)/i.exec(sql)?.[1] ?? 0);
        const batch = [...dbRows.entries()]
          .filter(
            ([, row]) =>
              row.actor_email !== null &&
              (row.actor_email_expires_at ?? row.last_seen + 60_000) <=
                expiredAt,
          )
          .sort(
            ([leftKey, left], [rightKey, right]) =>
              (left.actor_email_expires_at ?? left.last_seen + 60_000) -
                (right.actor_email_expires_at ?? right.last_seen + 60_000) ||
              compareAwarenessKeys(leftKey, rightKey),
          )
          .slice(0, batchSize);
        for (const [key] of batch) dbRows.delete(key);
        return { rows: [], rowsAffected: batch.length };
      }
      if (
        /^\s*WITH batch AS MATERIALIZED \([\s\S]+\)\s+DELETE FROM _collab_awareness/i.test(
          sql,
        ) &&
        /actor_email IS NULL/i.test(sql)
      ) {
        purgeQueries.value.push({
          kind: "legacy-delete",
          sql,
          args: [...args],
        });
        const expiredBefore = Number(args[0]);
        const batchSize = Number(/LIMIT\s+(\d+)/i.exec(sql)?.[1] ?? 0);
        const batch = [...dbRows.entries()]
          .filter(
            ([, row]) =>
              row.actor_email === null && row.last_seen < expiredBefore,
          )
          .sort(
            ([leftKey, left], [rightKey, right]) =>
              left.last_seen - right.last_seen ||
              compareAwarenessKeys(leftKey, rightKey),
          )
          .slice(0, batchSize);
        for (const [key] of batch) dbRows.delete(key);
        return { rows: [], rowsAffected: batch.length };
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
          client_sequence_raw: number;
          actor_email: string | null;
          clear_token_hash: string | null;
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
              client_sequence_raw: row.client_sequence_raw,
              actor_email: row.actor_email,
              clear_token_hash: row.clear_token_hash,
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
  ensureIndexExists: vi.fn((name: string, sql: string) => {
    expiryIndexSql.calls.push({ name, sql });
    return Promise.resolve(true);
  }),
}));

import {
  _resetAwarenessStoreForTests,
  collabAwarenessStore,
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
  purgeHang.promise = undefined;
  purgeStarted.signal = undefined;
  clearRace.value = false;
  clearUpsertQuery.value = null;
  executedSql.length = 0;
  purgeQueries.value = [];
  expiryIndexSql.calls = [];
  _resetAwarenessStoreForTests();
});

afterEach(() => {
  vi.useRealTimers();
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
        clientSequenceRaw: 0,
        actorEmail: null,
        clearTokenHash: null,
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

  it("keeps reads off the scheduled expiry purge", async () => {
    dbRows.set(rowKey("doc-purge-read", 3), {
      state: "active-state",
      last_seen: 60_000,
      client_sequence: 1,
      client_sequence_raw: 0,
      cleared: false,
      actor_email: null,
      clear_token_hash: null,
    });
    purgeFails.value = true;

    await expect(
      loadAwarenessRows("doc-purge-read", 60_000),
    ).resolves.toMatchObject([{ clientId: 3, state: "active-state" }]);

    expect(purgeCalls.count).toBe(0);
  });

  it("keeps writes off the scheduled expiry purge", async () => {
    purgeFails.value = true;

    await expect(
      writeAwarenessRow("doc-purge-write", 4, "active-state", 60_000, 1, false),
    ).resolves.toBe(true);

    expect(dbRows.get(rowKey("doc-purge-write", 4))).toMatchObject({
      state: "active-state",
      client_sequence: 1,
      cleared: false,
    });
    expect(purgeCalls.count).toBe(0);
  });

  it("purges expired tombstones in the recurring sweep, not on unrelated reads", async () => {
    await writeAwarenessRow("abandoned-doc", 7, "", 1_000, 10, true);

    await expect(
      loadAwarenessRowsStrict("active-doc", 70_000),
    ).resolves.toEqual([]);
    expect(dbRows.has(rowKey("abandoned-doc", 7))).toBe(true);
    expect(purgeCalls.count).toBe(0);

    await runRecurringSweepHandlers({ deadlineAt: Date.now() + 60_000 });

    expect(dbRows.has(rowKey("abandoned-doc", 7))).toBe(false);
    expect(purgeCalls.count).toBe(1);
  });

  it("drains bounded expiry batches through indexed plans", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    for (let clientId = 0; clientId < 150; clientId++) {
      dbRows.set(rowKey(`actor-${clientId}`, clientId), {
        state: "presence",
        last_seen: 5_000,
        client_sequence: 1,
        client_sequence_raw: 0,
        cleared: false,
        actor_email: "actor@example.com",
        clear_token_hash: "token-hash",
        actor_email_expires_at: 65_000,
      });
      dbRows.set(rowKey(`legacy-${clientId}`, clientId), {
        state: "legacy-presence",
        last_seen: 5_000,
        client_sequence: 0,
        client_sequence_raw: 0,
        cleared: false,
        actor_email: null,
        clear_token_hash: null,
      });
    }

    await expect(
      loadAwarenessRowsStrict("unrelated-doc", 70_000),
    ).resolves.toEqual([]);
    expect(purgeQueries.value).toHaveLength(0);

    await runRecurringSweepHandlers({ deadlineAt: Date.now() + 60_000 });

    const remainingActorRows = [...dbRows.values()].filter(
      (row) => row.actor_email !== null,
    );
    const remainingLegacyRows = [...dbRows.values()].filter(
      (row) => row.actor_email === null,
    );
    expect(remainingActorRows).toHaveLength(50);
    expect(remainingActorRows.every((row) => row.state !== "")).toBe(true);
    expect(remainingLegacyRows).toHaveLength(50);
    expect(purgeQueries.value.slice(0, 3).map((query) => query.kind)).toEqual([
      "update",
      "actor-delete",
      "legacy-delete",
    ]);

    vi.setSystemTime(130_000);
    await runRecurringSweepHandlers({ deadlineAt: Date.now() + 60_000 });
    expect(dbRows.size).toBe(0);
    expect(purgeQueries.value).toHaveLength(6);
    for (const { sql } of purgeQueries.value) {
      expect(sql).toMatch(/WITH batch AS MATERIALIZED/i);
      expect(sql).toMatch(/ORDER BY/i);
      expect(sql).toMatch(/LIMIT 100/i);
      expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/i);
    }

    const expiryMigration = collabAwarenessStore.migrations.find(
      (migration) => migration.name === "expiry-indexes",
    );
    expect(expiryMigration?.run).toBeTypeOf("function");
    expiryIndexSql.calls = [];
    await expiryMigration!.run!({
      execute: async () => ({ rows: [], rowsAffected: 0 }),
    });
    expect(expiryIndexSql.calls.map(({ name }) => name)).toEqual([
      "_collab_awareness_active_actor_expiry_idx",
      "_collab_awareness_actor_reservation_expiry_idx",
      "_collab_awareness_anonymous_expiry_idx",
    ]);

    const pglite = await createTestPglite();
    try {
      await pglite.exec(`
        CREATE TABLE _collab_awareness (
          doc_id TEXT NOT NULL,
          client_id BIGINT NOT NULL,
          state TEXT NOT NULL,
          last_seen BIGINT NOT NULL,
          client_sequence BIGINT NOT NULL DEFAULT 0,
          cleared BOOLEAN NOT NULL DEFAULT FALSE,
          client_sequence_raw BIGINT NOT NULL DEFAULT 0,
          actor_email TEXT,
          clear_token_hash TEXT,
          actor_email_expires_at BIGINT,
          PRIMARY KEY (doc_id, client_id)
        )
      `);
      for (const { sql } of expiryIndexSql.calls) await pglite.exec(sql);
      await pglite.exec(`
        INSERT INTO _collab_awareness
          (doc_id, client_id, state, last_seen, actor_email,
           actor_email_expires_at)
        SELECT 'doc-' || n::text, n,
               CASE WHEN n % 3 = 0 THEN 'presence' ELSE '' END,
               5000,
               CASE WHEN n % 3 = 2 THEN NULL ELSE 'actor@example.com' END,
               CASE WHEN n % 3 = 2 THEN NULL ELSE 65000 END
        FROM generate_series(1, 3000) AS n
      `);
      await pglite.exec("ANALYZE _collab_awareness");
      await pglite.exec(
        "SET enable_seqscan = off; SET enable_bitmapscan = off",
      );

      for (const [index, query] of purgeQueries.value.slice(0, 3).entries()) {
        const expectedIndex = [
          "_collab_awareness_active_actor_expiry_idx",
          "_collab_awareness_actor_reservation_expiry_idx",
          "_collab_awareness_anonymous_expiry_idx",
        ][index]!;
        const plan = await pglite.query(
          `EXPLAIN (FORMAT JSON) ${query.sql}`,
          query.args,
        );
        expect(JSON.stringify(plan.rows)).toContain(expectedIndex);
      }
    } finally {
      await pglite.close();
    }
  });

  it("shares a global purge across concurrent recurring sweeps", async () => {
    await Promise.all([
      runRecurringSweepHandlers({ deadlineAt: Date.now() + 60_000 }),
      runRecurringSweepHandlers({ deadlineAt: Date.now() + 60_000 }),
    ]);

    expect(purgeCalls.count).toBe(1);
  });

  it("does not let a stalled scheduled purge block awareness reads and writes", async () => {
    let releasePurge!: () => void;
    purgeHang.promise = new Promise<void>((resolve) => {
      releasePurge = resolve;
    });
    let markPurgeStarted!: () => void;
    const didStartPurge = new Promise<void>((resolve) => {
      markPurgeStarted = resolve;
    });
    purgeStarted.signal = markPurgeStarted;

    try {
      const pendingSweep = runRecurringSweepHandlers({
        deadlineAt: Date.now() + 60_000,
      });
      await didStartPurge;
      const otherRead = loadAwarenessRowsStrict("other-doc", 40_000);
      const otherWrite = writeAwarenessRow(
        "third-doc",
        8,
        "visible",
        40_000,
        1,
        false,
      );
      await expect(Promise.all([otherRead, otherWrite])).resolves.toEqual([
        [],
        true,
      ]);
      expect(purgeCalls.count).toBe(1);

      releasePurge();
      purgeHang.promise = undefined;
      await pendingSweep;
    } finally {
      releasePurge();
      purgeHang.promise = undefined;
      purgeStarted.signal = undefined;
    }
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
        clientSequenceRaw: 0,
        actorEmail: null,
        clearTokenHash: null,
        cleared: true,
      },
    ]);
  });

  it("atomically clears a same-actor write that wins the disposal race", async () => {
    await writeAwarenessRow(
      "doc-clear-race",
      9,
      "initial-state",
      1_000,
      1,
      false,
      "owner@example.com",
    );
    clearRace.value = true;

    await expect(
      writeAwarenessRow(
        "doc-clear-race",
        9,
        "",
        1_500,
        MAX_AWARENESS_CLIENT_SEQUENCE_ADVANCE + 2,
        true,
        "owner@example.com",
      ),
    ).resolves.toBe(true);

    expect(dbRows.get(rowKey("doc-clear-race", 9))).toMatchObject({
      state: "",
      last_seen: 2_000,
      client_sequence: MAX_AWARENESS_CLIENT_SEQUENCE_ADVANCE + 2,
      client_sequence_raw: 0,
      cleared: true,
      actor_email: "owner@example.com",
    });

    const pglite = await createTestPglite();
    try {
      await pglite.exec(`
        CREATE TABLE _collab_awareness (
          doc_id TEXT NOT NULL,
          client_id BIGINT NOT NULL,
          state TEXT NOT NULL,
          last_seen BIGINT NOT NULL,
          client_sequence BIGINT NOT NULL DEFAULT 0,
          cleared BOOLEAN NOT NULL DEFAULT FALSE,
          client_sequence_raw BIGINT NOT NULL DEFAULT 0,
          actor_email TEXT,
          clear_token_hash TEXT,
          actor_email_expires_at BIGINT,
          PRIMARY KEY (doc_id, client_id)
        )
      `);
      await pglite.query(
        `INSERT INTO _collab_awareness
           (doc_id, client_id, state, last_seen, client_sequence, cleared,
            client_sequence_raw, actor_email, clear_token_hash,
            actor_email_expires_at)
         VALUES (?, ?, ?, ?, ?, FALSE, 0, ?, NULL, NULL)`,
        ["doc-clear-race", 9, "initial-state", 1_000, 1, "owner@example.com"],
      );
      await pglite.query(
        `UPDATE _collab_awareness
         SET state = ?, last_seen = ?, client_sequence = ?
         WHERE doc_id = ? AND client_id = ?`,
        ["concurrent-presence", 2_000, 2, "doc-clear-race", 9],
      );

      const atomicClear = clearUpsertQuery.value;
      expect(atomicClear).toBeTruthy();
      const result = await pglite.query(atomicClear!.sql, atomicClear!.args);
      expect(result.rows).toEqual([{ client_id: 9 }]);
      await expect(
        pglite.query(
          `SELECT state, last_seen, client_sequence, cleared
           FROM _collab_awareness WHERE doc_id = ? AND client_id = ?`,
          ["doc-clear-race", 9],
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            state: "",
            last_seen: 2_000,
            client_sequence: MAX_AWARENESS_CLIENT_SEQUENCE_ADVANCE + 2,
            cleared: true,
          },
        ],
      });
    } finally {
      await pglite.close();
    }
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
      clear_token_hash: null,
      actor_email_expires_at: null,
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
      clientSequenceRaw: 0,
      cleared: false,
      actorEmail: "owner@example.com",
      lastSeen: 1_000,
      clearTokenHash: null,
    });
    await expect(loadAwarenessRows("doc-actor", 2_000)).resolves.toMatchObject([
      {
        clientId: 9,
        state: "owner-state",
        clientSequenceRaw: 0,
        actorEmail: "owner@example.com",
      },
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

  it("retains actor ownership after clearing expired presence state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(59_000);
    await writeAwarenessRow(
      "doc-expired-owner",
      9,
      "owner-state",
      1_000,
      1,
      false,
      "owner@example.com",
    );

    await expect(
      loadAwarenessRowsStrict("doc-expired-owner", 59_000),
    ).resolves.toEqual([]);
    await runRecurringSweepHandlers({ deadlineAt: Date.now() + 60_000 });
    expect(dbRows.get(rowKey("doc-expired-owner", 9))).toMatchObject({
      state: "",
      cleared: false,
      actor_email: "owner@example.com",
    });

    await expect(
      writeAwarenessRow(
        "doc-expired-owner",
        9,
        "forged-state",
        59_001,
        2,
        false,
        "viewer@example.com",
      ),
    ).resolves.toBe(false);

    await expect(
      writeAwarenessRow(
        "doc-expired-owner",
        9,
        "owner-resumed",
        59_002,
        2,
        false,
        "owner@example.com",
      ),
    ).resolves.toBe(true);
    expect(dbRows.get(rowKey("doc-expired-owner", 9))).toMatchObject({
      state: "owner-resumed",
      actor_email: "owner@example.com",
    });
  });

  it("reclaims actor reservations after the stale-request window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(62_000);
    await writeAwarenessRow(
      "doc-expired-reservation",
      9,
      "owner-state",
      1_000,
      1,
      false,
      "owner@example.com",
    );

    await expect(
      loadAwarenessRowsStrict("doc-expired-reservation", 62_000),
    ).resolves.toEqual([]);
    await runRecurringSweepHandlers({ deadlineAt: Date.now() + 60_000 });
    expect(dbRows.has(rowKey("doc-expired-reservation", 9))).toBe(false);

    await expect(
      writeAwarenessRow(
        "doc-expired-reservation",
        9,
        "new-owner-state",
        62_001,
        1,
        false,
        "viewer@example.com",
      ),
    ).resolves.toBe(true);
    expect(dbRows.get(rowKey("doc-expired-reservation", 9))).toMatchObject({
      state: "new-owner-state",
      actor_email: "viewer@example.com",
    });
  });

  it("expires legacy actor reservations from their last presence time", async () => {
    dbRows.set(rowKey("doc-legacy-reservation", 9), {
      state: "",
      last_seen: 1_000,
      client_sequence: 1,
      client_sequence_raw: 0,
      cleared: false,
      actor_email: "owner@example.com",
      clear_token_hash: null,
    });

    await expect(
      writeAwarenessRow(
        "doc-legacy-reservation",
        9,
        "new-owner-state",
        62_001,
        1,
        false,
        "viewer@example.com",
      ),
    ).resolves.toBe(true);
    expect(dbRows.get(rowKey("doc-legacy-reservation", 9))).toMatchObject({
      state: "new-owner-state",
      actor_email: "viewer@example.com",
    });
  });

  it("allows only a live clear token to remove another actor's presence", async () => {
    await expect(
      writeAwarenessRow(
        "doc-account-switch",
        9,
        "owner-state",
        1_000,
        1,
        false,
        "owner@example.com",
        "owner-clear-token-hash",
      ),
    ).resolves.toBe(true);

    await expect(
      writeAwarenessRow(
        "doc-account-switch",
        9,
        "",
        2_000,
        1,
        true,
        "viewer@example.com",
        "owner-clear-token-hash",
      ),
    ).resolves.toBe(true);
    expect(dbRows.get(rowKey("doc-account-switch", 9))).toMatchObject({
      state: "",
      cleared: true,
      actor_email: "owner@example.com",
      clear_token_hash: null,
    });

    await expect(
      writeAwarenessRow(
        "doc-account-switch",
        9,
        "forged-state",
        2_001,
        2,
        false,
        "viewer@example.com",
        "owner-clear-token-hash",
      ),
    ).resolves.toBe(false);
  });

  it("rejects expired or mismatched cross-actor clear tokens", async () => {
    await writeAwarenessRow(
      "doc-expired-clear-token",
      9,
      "owner-state",
      1_000,
      1,
      false,
      "owner@example.com",
      "owner-clear-token-hash",
    );

    await expect(
      writeAwarenessRow(
        "doc-expired-clear-token",
        9,
        "",
        62_000,
        1,
        true,
        "viewer@example.com",
        "owner-clear-token-hash",
      ),
    ).resolves.toBe(false);
    await expect(
      writeAwarenessRow(
        "doc-expired-clear-token",
        9,
        "",
        2_000,
        1,
        true,
        "viewer@example.com",
        "wrong-clear-token-hash",
      ),
    ).resolves.toBe(false);
    expect(dbRows.get(rowKey("doc-expired-clear-token", 9))).toMatchObject({
      state: "owner-state",
      cleared: false,
      actor_email: "owner@example.com",
    });
  });

  it("reports scheduled expiry purge failures without blocking awareness requests", async () => {
    const cleanupFailure = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    purgeFails.value = true;

    const sweep = await runRecurringSweepHandlers({
      deadlineAt: Date.now() + 60_000,
    });

    expect(sweep.failed).toContain("collaboration-awareness-expiry");
    expect(cleanupFailure).toHaveBeenCalledWith(
      "[recurring-sweep] handler collaboration-awareness-expiry failed:",
      expect.any(Error),
    );

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
    expect(cleanupFailure).toHaveBeenCalledTimes(1);
    expect(purgeCalls.count).toBe(1);

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

  it("checks large bounded sequence jumps in the upsert statement", async () => {
    await writeAwarenessRow(
      "doc-sequence-jump",
      7,
      "old-state",
      1_000,
      1,
      false,
    );
    executedSql.length = 0;

    await expect(
      writeAwarenessRow(
        "doc-sequence-jump",
        7,
        "new-state",
        2_000,
        MAX_AWARENESS_CLIENT_SEQUENCE_ADVANCE + 1,
        false,
      ),
    ).resolves.toBe(true);

    expect(
      executedSql.filter((sql) =>
        /SELECT client_sequence, client_sequence_raw/i.test(sql),
      ),
    ).toHaveLength(0);
    expect(executedSql).toHaveLength(1);
    expect(executedSql[0]).toMatch(
      /WHERE EXISTS \(\s*SELECT 1 FROM _collab_awareness/i,
    );
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
