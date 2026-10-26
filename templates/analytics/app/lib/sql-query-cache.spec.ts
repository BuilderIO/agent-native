import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearSqlQuerySnapshots,
  readSqlQuerySnapshot,
  SQL_QUERY_SNAPSHOT_MAX_AGE_MS,
  SQL_QUERY_SNAPSHOT_MAX_ENTRIES,
  SQL_QUERY_SNAPSHOT_MAX_ENTRY_LENGTH,
  SQL_QUERY_SNAPSHOT_MAX_TOTAL_LENGTH,
  writeSqlQuerySnapshot,
  type SqlQuerySnapshotInput,
  type SqlQuerySnapshotStorage,
} from "./sql-query-cache";

const NOW = Date.UTC(2026, 9, 14, 12, 0, 0);
const HOUR = 60 * 60 * 1000;
const SCOPE = "user-1:org-1";
const KEY = JSON.stringify(["sql-query", "bigquery", "SELECT 1", SCOPE]);

class MemoryStorage implements SqlQuerySnapshotStorage {
  readonly data = new Map<string, string>();
  /** Total code units (keys + values) the store accepts, like a quota. */
  quota = Number.POSITIVE_INFINITY;
  failWith: Error | null = null;

  get length() {
    return this.data.size;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  getItem(name: string) {
    if (this.failWith) throw this.failWith;
    return this.data.get(name) ?? null;
  }
  setItem(name: string, value: string) {
    if (this.failWith) throw this.failWith;
    let used = name.length + value.length;
    for (const [key, existing] of this.data) {
      if (key !== name) used += key.length + existing.length;
    }
    if (used > this.quota) {
      throw new DOMException("quota", "QuotaExceededError");
    }
    this.data.set(name, value);
  }
  removeItem(name: string) {
    this.data.delete(name);
  }
}

function write(
  storage: SqlQuerySnapshotStorage,
  overrides: {
    accountScope?: string;
    queryKey?: string;
    result?: SqlQuerySnapshotInput;
    now?: number;
  } = {},
) {
  return writeSqlQuerySnapshot({
    accountScope: SCOPE,
    queryKey: KEY,
    result: { rows: [{ n: 1 }] },
    now: NOW,
    storage,
    ...overrides,
  });
}

function read(
  storage: SqlQuerySnapshotStorage,
  overrides: { accountScope?: string; queryKey?: string; now?: number } = {},
) {
  return readSqlQuerySnapshot({
    accountScope: SCOPE,
    queryKey: KEY,
    now: NOW,
    storage,
    ...overrides,
  });
}

function onlyEntry(storage: MemoryStorage) {
  const [name, value] = [...storage.data.entries()][0];
  return { name, value, envelope: JSON.parse(value) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sql query snapshot cache", () => {
  describe("round trip", () => {
    it("restores rows, schema and metadata, keeping storedAt apart from fetchedAt", () => {
      const storage = new MemoryStorage();
      const fetchedAt = new Date(NOW - HOUR).toISOString();
      const written = write(storage, {
        result: {
          rows: [{ id: "a", n: 1, nested: { ok: [1, null, "x"] } }],
          schema: [{ name: "n", type: "INTEGER" }],
          cached: true,
          providerCacheHit: false,
          fetchedAt,
        },
      });
      expect(written).toMatchObject({ status: "written", storedAt: NOW });

      expect(read(storage, { now: NOW + 5000 })).toEqual({
        status: "hit",
        snapshot: {
          storedAt: NOW,
          result: {
            rows: [{ id: "a", n: 1, nested: { ok: [1, null, "x"] } }],
            schema: [{ name: "n", type: "INTEGER" }],
            cached: true,
            providerCacheHit: false,
            fetchedAt,
          },
        },
      });
    });

    it("treats an empty result as a valid hit", () => {
      const storage = new MemoryStorage();
      write(storage, { result: { rows: [], schema: [] } });
      expect(read(storage)).toMatchObject({
        status: "hit",
        snapshot: { result: { rows: [], schema: [] } },
      });
    });

    it("misses when nothing was stored", () => {
      expect(read(new MemoryStorage())).toEqual({
        status: "miss",
        reason: "absent",
      });
    });

    it("keeps a single copy per key and the newest wins", () => {
      const storage = new MemoryStorage();
      write(storage, { result: { rows: [{ n: 1 }] }, now: NOW });
      write(storage, { result: { rows: [{ n: 2 }] }, now: NOW + 1000 });
      expect(storage.data.size).toBe(1);
      expect(read(storage, { now: NOW + 2000 })).toMatchObject({
        status: "hit",
        snapshot: { storedAt: NOW + 1000, result: { rows: [{ n: 2 }] } },
      });
    });

    it("persists only known result fields and never the query text", () => {
      const storage = new MemoryStorage();
      write(storage, {
        queryKey: JSON.stringify(["SELECT secret_column FROM private_table"]),
        result: {
          rows: [{ n: 1 }],
          bytesProcessed: 99,
          token: "do-not-store",
        } as SqlQuerySnapshotInput,
      });
      const { name, value } = onlyEntry(storage);
      expect(name + value).not.toContain("secret_column");
      expect(value).not.toContain("do-not-store");
      expect(value).not.toContain("bytesProcessed");
    });
  });

  describe("exact keys and scope isolation", () => {
    it("separates keys that differ by a single character", () => {
      const storage = new MemoryStorage();
      write(storage, { queryKey: '["q","SELECT 1"]' });
      expect(read(storage, { queryKey: '["q","SELECT 1"]' }).status).toBe(
        "hit",
      );
      for (const other of [
        '["q","SELECT 2"]',
        '["q","SELECT 1 "]',
        '["q","select 1"]',
        '["q","SELECT 1"] ',
        '["Q","SELECT 1"]',
      ]) {
        expect(read(storage, { queryKey: other })).toEqual({
          status: "miss",
          reason: "absent",
        });
      }
    });

    it("never reads another account or org, and has no cross-scope fallback", () => {
      const storage = new MemoryStorage();
      write(storage, { result: { rows: [{ owner: "user-1" }] } });
      for (const accountScope of ["user-2:org-1", "user-1:org-2"]) {
        expect(read(storage, { accountScope })).toEqual({
          status: "miss",
          reason: "absent",
        });
      }
      write(storage, {
        accountScope: "user-2:org-1",
        result: { rows: [{ owner: "user-2" }] },
      });
      expect(storage.data.size).toBe(2);
      expect(read(storage)).toMatchObject({
        snapshot: { result: { rows: [{ owner: "user-1" }] } },
      });
      expect(read(storage, { accountScope: "user-2:org-1" })).toMatchObject({
        snapshot: { result: { rows: [{ owner: "user-2" }] } },
      });
    });

    it("rejects a copied entry whose stored scope differs from the caller's", () => {
      const storage = new MemoryStorage();
      write(storage);
      const { name, envelope } = onlyEntry(storage);
      storage.data.set(
        name,
        JSON.stringify({ ...envelope, scope: "evil:org" }),
      );
      expect(read(storage)).toEqual({
        status: "miss",
        reason: "scope-mismatch",
      });
    });

    it.each([
      "",
      "session-loading",
      "anonymous:personal",
      "just-a-user",
      "a:b:c",
      "user 1:org",
      ":org",
      "user:",
    ])(
      "refuses account scope %j for read, write and no storage is touched",
      (accountScope) => {
        const storage = new MemoryStorage();
        const unavailable = {
          status: "unavailable",
          reason: "invalid-account-scope",
        };
        expect(write(storage, { accountScope })).toEqual(unavailable);
        expect(read(storage, { accountScope })).toEqual(unavailable);
        expect(storage.data.size).toBe(0);
      },
    );

    it("refuses an empty or oversized query key", () => {
      const storage = new MemoryStorage();
      for (const queryKey of ["", "x".repeat(100_001)]) {
        expect(read(storage, { queryKey })).toEqual({
          status: "unavailable",
          reason: "invalid-query-key",
        });
        expect(write(storage, { queryKey })).toEqual({
          status: "unavailable",
          reason: "invalid-query-key",
        });
      }
    });

    it("clears everything on logout, or everything outside the active scope", () => {
      const storage = new MemoryStorage();
      write(storage);
      write(storage, { accountScope: "user-2:org-1" });
      write(storage, { accountScope: "user-1:org-2" });
      storage.data.set("unrelated", "keep");

      expect(
        clearSqlQuerySnapshots({ storage, exceptAccountScope: SCOPE }),
      ).toEqual({ status: "cleared", removed: 2 });
      expect(read(storage).status).toBe("hit");
      expect(read(storage, { accountScope: "user-2:org-1" }).status).toBe(
        "miss",
      );

      expect(clearSqlQuerySnapshots({ storage })).toEqual({
        status: "cleared",
        removed: 1,
      });
      expect(read(storage).status).toBe("miss");
      expect(storage.data.get("unrelated")).toBe("keep");
    });

    it("clears everything when the scope to keep is not a valid account", () => {
      const storage = new MemoryStorage();
      write(storage);
      expect(
        clearSqlQuerySnapshots({
          storage,
          exceptAccountScope: "anonymous:personal",
        }),
      ).toEqual({ status: "cleared", removed: 1 });
    });
  });

  describe("results that are not stored", () => {
    it("skips an error result and never persists it", () => {
      const storage = new MemoryStorage();
      expect(write(storage, { result: { rows: [], error: "boom" } })).toEqual({
        status: "skipped",
        reason: "error-result",
      });
      expect(storage.data.size).toBe(0);
    });

    it.each([
      ["NaN", [{ n: Number.NaN }]],
      ["Infinity", [{ n: Number.POSITIVE_INFINITY }]],
      ["undefined", [{ n: undefined }]],
      ["a Date", [{ at: new Date(NOW) }]],
      ["a bigint", [{ n: BigInt(1) }]],
      ["a non-object row", [1]],
      ["a null row", [null]],
      ["an array row", [[1]]],
    ])("skips rows containing %s rather than altering them", (_label, rows) => {
      const storage = new MemoryStorage();
      expect(
        write(storage, {
          result: { rows } as unknown as SqlQuerySnapshotInput,
        }),
      ).toEqual({ status: "skipped", reason: "invalid-result" });
      expect(storage.data.size).toBe(0);
    });

    it("skips a malformed schema or flags", () => {
      const storage = new MemoryStorage();
      for (const result of [
        { rows: [], schema: [{ name: "a" }] },
        { rows: [], cached: "yes" },
        { rows: [], providerCacheHit: 1 },
        { rows: "nope" },
      ]) {
        expect(
          write(storage, {
            result: result as unknown as SqlQuerySnapshotInput,
          }),
        ).toEqual({ status: "skipped", reason: "invalid-result" });
      }
    });

    it("skips a result over the per-entry bound without truncating, and drops the older copy", () => {
      const storage = new MemoryStorage();
      write(storage, { result: { rows: [{ n: 1 }] } });
      const big = {
        rows: [{ blob: "x".repeat(SQL_QUERY_SNAPSHOT_MAX_ENTRY_LENGTH) }],
      };
      expect(write(storage, { result: big, now: NOW + 1 })).toEqual({
        status: "skipped",
        reason: "too-large",
      });
      expect(storage.data.size).toBe(0);
      expect(read(storage, { now: NOW + 2 })).toEqual({
        status: "miss",
        reason: "absent",
      });
    });

    it("skips a result with too many values before serializing it", () => {
      const storage = new MemoryStorage();
      const rows = Array.from({ length: 200_000 }, () => ({}));
      const stringify = vi.spyOn(JSON, "stringify");
      expect(write(storage, { result: { rows } })).toEqual({
        status: "skipped",
        reason: "too-large",
      });
      expect(stringify).not.toHaveBeenCalled();
    });

    it("accepts a result just under the per-entry bound", () => {
      const storage = new MemoryStorage();
      const overhead = JSON.stringify({
        v: 1,
        scope: SCOPE,
        keyLength: KEY.length,
        storedAt: NOW,
        result: { rows: [{ blob: "" }] },
      }).length;
      const blob = "x".repeat(SQL_QUERY_SNAPSHOT_MAX_ENTRY_LENGTH - overhead);
      expect(write(storage, { result: { rows: [{ blob }] } }).status).toBe(
        "written",
      );
      expect(
        write(storage, { result: { rows: [{ blob: `${blob}x` }] } }).status,
      ).toBe("skipped");
    });
  });

  describe("expiry and dates", () => {
    it("misses as expired after 24 hours and removes the entry", () => {
      const storage = new MemoryStorage();
      write(storage);
      expect(
        read(storage, { now: NOW + SQL_QUERY_SNAPSHOT_MAX_AGE_MS }).status,
      ).toBe("hit");
      expect(
        read(storage, { now: NOW + SQL_QUERY_SNAPSHOT_MAX_AGE_MS + 1 }),
      ).toEqual({ status: "miss", reason: "expired" });
      expect(storage.data.size).toBe(0);
    });

    it("expires on the original fetchedAt even when stored recently", () => {
      const storage = new MemoryStorage();
      const fetchedAt = new Date(NOW - 23 * HOUR).toISOString();
      write(storage, { result: { rows: [], fetchedAt } });
      expect(read(storage, { now: NOW + 30 * 60 * 1000 }).status).toBe("hit");
      expect(read(storage, { now: NOW + 2 * HOUR })).toEqual({
        status: "miss",
        reason: "expired",
      });
    });

    it("does not store a result already older than the TTL", () => {
      const storage = new MemoryStorage();
      const fetchedAt = new Date(NOW - 25 * HOUR).toISOString();
      expect(write(storage, { result: { rows: [], fetchedAt } })).toEqual({
        status: "skipped",
        reason: "stale",
      });
    });

    it.each([
      "not a date",
      "",
      new Date(NOW + 2 * HOUR).toISOString(),
      42 as unknown as string,
    ])("rejects fetchedAt %j on write", (fetchedAt) => {
      const storage = new MemoryStorage();
      expect(write(storage, { result: { rows: [], fetchedAt } })).toEqual({
        status: "skipped",
        reason: "invalid-fetched-at",
      });
    });

    it("tolerates a little clock skew but not a future-dated entry", () => {
      const storage = new MemoryStorage();
      write(storage, {
        result: { rows: [], fetchedAt: new Date(NOW + 60_000).toISOString() },
      });
      expect(read(storage).status).toBe("hit");
      // The clock moved back an hour: the stored copy is from the future.
      expect(read(storage, { now: NOW - HOUR })).toEqual({
        status: "miss",
        reason: "future-dated",
      });
      expect(storage.data.size).toBe(0);
    });

    it("rejects a stored fetchedAt that was tampered into the future", () => {
      const storage = new MemoryStorage();
      write(storage, {
        result: { rows: [], fetchedAt: new Date(NOW).toISOString() },
      });
      const { name, envelope } = onlyEntry(storage);
      envelope.result.fetchedAt = new Date(NOW + 3 * HOUR).toISOString();
      storage.data.set(name, JSON.stringify(envelope));
      expect(read(storage)).toEqual({ status: "miss", reason: "future-dated" });
    });

    it("prunes expired entries when writing another key", () => {
      const storage = new MemoryStorage();
      write(storage, { queryKey: "old" });
      write(storage, {
        queryKey: "new",
        now: NOW + SQL_QUERY_SNAPSHOT_MAX_AGE_MS + 1,
      });
      expect(storage.data.size).toBe(1);
    });
  });

  describe("corrupt entries", () => {
    function corrupt(mutate: (envelope: Record<string, any>) => unknown) {
      const storage = new MemoryStorage();
      write(storage, {
        result: { rows: [{ n: 1 }], schema: [{ name: "n", type: "INTEGER" }] },
      });
      const { name, envelope } = onlyEntry(storage);
      const next = mutate(envelope);
      storage.data.set(
        name,
        typeof next === "string" ? next : JSON.stringify(next),
      );
      return storage;
    }

    it.each([
      ["invalid JSON", () => "{not json"],
      ["a JSON array", () => []],
      ["null", () => "null"],
      [
        "missing result",
        (e: Record<string, any>) => ({ ...e, result: undefined }),
      ],
      [
        "non-array rows",
        (e: Record<string, any>) => ({ ...e, result: { rows: {} } }),
      ],
      [
        "an array among the rows",
        (e: Record<string, any>) => ({ ...e, result: { rows: [[1]] } }),
      ],
      [
        "a null row",
        (e: Record<string, any>) => ({ ...e, result: { rows: [null] } }),
      ],
      [
        "a bad schema entry",
        (e: Record<string, any>) => ({
          ...e,
          result: { rows: [], schema: [{ name: 1, type: "x" }] },
        }),
      ],
      [
        "a non-boolean flag",
        (e: Record<string, any>) => ({
          ...e,
          result: { rows: [], cached: "true" },
        }),
      ],
      [
        "an unparsable fetchedAt",
        (e: Record<string, any>) => ({
          ...e,
          result: { rows: [], fetchedAt: "yesterday-ish" },
        }),
      ],
      [
        "an error field",
        (e: Record<string, any>) => ({
          ...e,
          result: { rows: [], error: "boom" },
        }),
      ],
      [
        "a storedAt that disagrees with the key",
        (e: Record<string, any>) => ({
          ...e,
          storedAt: e.storedAt + 1,
        }),
      ],
      [
        "a different query key length",
        (e: Record<string, any>) => ({
          ...e,
          keyLength: e.keyLength + 1,
        }),
      ],
      ["a missing scope", (e: Record<string, any>) => ({ ...e, scope: 7 })],
    ])(
      "reports %s as corrupt, never as a hit, and removes it",
      (_label, mutate) => {
        const storage = corrupt(mutate);
        expect(read(storage)).toEqual({ status: "miss", reason: "corrupt" });
        expect(storage.data.size).toBe(0);
      },
    );

    it("reports an unknown envelope version as a miss", () => {
      const storage = corrupt((e) => ({ ...e, v: 2, result: "new shape" }));
      expect(read(storage)).toEqual({
        status: "miss",
        reason: "unsupported-version",
      });
      expect(storage.data.size).toBe(0);
    });

    it("removes entries with unparsable storage keys when writing or clearing", () => {
      const storage = new MemoryStorage();
      storage.data.set("an-sql-snapshot/v1/zz/short/short", "x");
      storage.data.set("an-sql-snapshot/v0/legacy", "x");
      storage.data.set("other-feature", "x");
      write(storage);
      expect(
        [...storage.data.keys()].filter((k) => k.endsWith("short")),
      ).toEqual([]);
      expect(storage.data.has("an-sql-snapshot/v0/legacy")).toBe(false);
      expect(storage.data.get("other-feature")).toBe("x");
      expect(clearSqlQuerySnapshots({ storage })).toEqual({
        status: "cleared",
        removed: 1,
      });
      expect(storage.data.get("other-feature")).toBe("x");
    });
  });

  describe("oversized stored entries", () => {
    it("misses on a tampered entry over the bound without parsing it", () => {
      const storage = new MemoryStorage();
      write(storage);
      const { name, envelope } = onlyEntry(storage);
      const padded = JSON.stringify({
        ...envelope,
        padding: "x".repeat(SQL_QUERY_SNAPSHOT_MAX_ENTRY_LENGTH),
      });
      storage.data.set(name, padded);
      const parse = vi.spyOn(JSON, "parse");
      expect(read(storage)).toEqual({ status: "miss", reason: "oversized" });
      expect(parse).not.toHaveBeenCalled();
      expect(storage.data.size).toBe(0);
    });

    it("still reads an entry exactly at the bound", () => {
      const storage = new MemoryStorage();
      write(storage);
      const { name, value } = onlyEntry(storage);
      const padding = SQL_QUERY_SNAPSHOT_MAX_ENTRY_LENGTH - value.length;
      storage.data.set(
        name,
        value.replace("}}", `},"p":"${"x".repeat(padding - 7)}"}`),
      );
      expect(storage.data.get(name)?.length).toBe(
        SQL_QUERY_SNAPSHOT_MAX_ENTRY_LENGTH,
      );
      expect(read(storage).status).toBe("hit");
    });
  });

  describe("truncated results", () => {
    it("skips a truncated result and drops the older complete copy", () => {
      const storage = new MemoryStorage();
      write(storage, { result: { rows: [{ n: 1 }] } });
      expect(
        write(storage, {
          result: { rows: [{ n: 1 }], truncated: true },
          now: NOW + 1,
        }),
      ).toEqual({ status: "skipped", reason: "truncated" });
      expect(storage.data.size).toBe(0);
      expect(read(storage, { now: NOW + 2 })).toEqual({
        status: "miss",
        reason: "absent",
      });
    });

    it.each(["true", 1, null, {}])(
      "rejects a non-boolean truncated flag %j",
      (truncated) => {
        const storage = new MemoryStorage();
        expect(
          write(storage, {
            result: { rows: [], truncated } as unknown as SqlQuerySnapshotInput,
          }),
        ).toEqual({ status: "skipped", reason: "invalid-result" });
        expect(storage.data.size).toBe(0);
      },
    );

    it("keeps an explicit truncated: false as a complete result", () => {
      const storage = new MemoryStorage();
      write(storage, { result: { rows: [{ n: 1 }], truncated: false } });
      expect(read(storage)).toMatchObject({
        status: "hit",
        snapshot: { result: { rows: [{ n: 1 }], truncated: false } },
      });
    });

    it("never restores stored truncated rows as complete", () => {
      const storage = new MemoryStorage();
      write(storage, { result: { rows: [{ n: 1 }] } });
      const { name, envelope } = onlyEntry(storage);
      storage.data.set(
        name,
        JSON.stringify({
          ...envelope,
          result: { ...envelope.result, truncated: true },
        }),
      );
      expect(read(storage)).toEqual({ status: "miss", reason: "truncated" });
      expect(storage.data.size).toBe(0);
    });

    it("reports a non-boolean stored truncated flag as corrupt", () => {
      const storage = new MemoryStorage();
      write(storage, { result: { rows: [{ n: 1 }] } });
      const { name, envelope } = onlyEntry(storage);
      storage.data.set(
        name,
        JSON.stringify({
          ...envelope,
          result: { ...envelope.result, truncated: "no" },
        }),
      );
      expect(read(storage)).toEqual({ status: "miss", reason: "corrupt" });
    });
  });

  describe("bounded traversal", () => {
    const tooLarge = { status: "skipped", reason: "too-large" };
    const invalid = { status: "skipped", reason: "invalid-result" };

    it("rejects a huge array from its length without visiting any element", () => {
      const storage = new MemoryStorage();
      const visited = vi.fn();
      const wide = new Proxy(new Array(10_000_000), {
        getOwnPropertyDescriptor(target, key) {
          visited(key);
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
        get(target, key, receiver) {
          if (key !== "length") visited(key);
          return Reflect.get(target, key, receiver);
        },
      });
      expect(write(storage, { result: { rows: wide } })).toEqual(tooLarge);
      expect(visited).not.toHaveBeenCalled();
    });

    it("stops a wide object at the budget and never runs later getters", () => {
      const storage = new MemoryStorage();
      const row: Record<string, unknown> = {};
      for (let index = 0; index < 70_000; index += 1) row[`k${index}`] = 1;
      const getter = vi.fn(() => 1);
      for (let index = 0; index < 1000; index += 1) {
        Object.defineProperty(row, `late${index}`, {
          enumerable: true,
          get: getter,
        });
      }
      expect(write(storage, { result: { rows: [row] } })).toEqual(tooLarge);
      expect(getter).not.toHaveBeenCalled();
    });

    it("rejects an accessor without invoking it", () => {
      const storage = new MemoryStorage();
      const getter = vi.fn(() => 1);
      const row = {};
      Object.defineProperty(row, "n", { enumerable: true, get: getter });
      expect(write(storage, { result: { rows: [row] } })).toEqual(invalid);
      expect(getter).not.toHaveBeenCalled();

      const rows: unknown[] = [{ n: 1 }];
      Object.defineProperty(rows, 1, { enumerable: true, get: getter });
      expect(write(storage, { result: { rows } as never })).toEqual(invalid);
      expect(getter).not.toHaveBeenCalled();
    });

    it("rejects sparse holes and over-deep nesting", () => {
      const storage = new MemoryStorage();
      // eslint-disable-next-line no-sparse-arrays
      expect(
        write(storage, { result: { rows: [{ list: [1, , 3] }] } }),
      ).toEqual(invalid);
      let deep: unknown = 1;
      for (let index = 0; index < 100; index += 1) deep = { deep };
      expect(
        write(storage, { result: { rows: [deep as Record<string, unknown>] } }),
      ).toEqual(invalid);
    });

    it("reads a top-level field once so the checked rows are the stored rows", () => {
      const storage = new MemoryStorage();
      let reads = 0;
      const result = {
        get rows() {
          reads += 1;
          return reads === 1 ? [{ n: 1 }] : [{ n: Number.NaN }];
        },
      } as SqlQuerySnapshotInput;
      expect(write(storage, { result }).status).toBe("written");
      expect(reads).toBe(1);
      expect(read(storage)).toMatchObject({
        snapshot: { result: { rows: [{ n: 1 }] } },
      });
    });

    it("bounds a wide schema as well as wide rows", () => {
      const storage = new MemoryStorage();
      const schema = Array.from({ length: 200_000 }, () => ({
        name: "a",
        type: "STRING",
      }));
      expect(write(storage, { result: { rows: [], schema } })).toEqual(
        tooLarge,
      );
    });
  });

  describe("bounded storage", () => {
    it("keeps at most the entry limit, evicting the oldest first", () => {
      const storage = new MemoryStorage();
      const total = SQL_QUERY_SNAPSHOT_MAX_ENTRIES + 7;
      for (let index = 0; index < total; index += 1) {
        write(storage, { queryKey: `key-${index}`, now: NOW + index });
      }
      expect(storage.data.size).toBe(SQL_QUERY_SNAPSHOT_MAX_ENTRIES);
      const now = NOW + total;
      expect(read(storage, { queryKey: "key-0", now }).status).toBe("miss");
      expect(read(storage, { queryKey: "key-6", now }).status).toBe("miss");
      expect(read(storage, { queryKey: "key-7", now }).status).toBe("hit");
      expect(read(storage, { queryKey: `key-${total - 1}`, now }).status).toBe(
        "hit",
      );
    });

    it("keeps total serialized length under the cap", () => {
      const storage = new MemoryStorage();
      const blob = "x".repeat(100 * 1024);
      let evicted = 0;
      for (let index = 0; index < 30; index += 1) {
        const result = write(storage, {
          queryKey: `key-${index}`,
          result: { rows: [{ blob }] },
          now: NOW + index,
        });
        expect(result.status).toBe("written");
        if (result.status === "written") evicted += result.evicted;
        const used = [...storage.data].reduce(
          (sum, [k, v]) => sum + k.length + v.length,
          0,
        );
        expect(used).toBeLessThanOrEqual(SQL_QUERY_SNAPSHOT_MAX_TOTAL_LENGTH);
      }
      expect(evicted).toBeGreaterThan(0);
      const now = NOW + 30;
      expect(read(storage, { queryKey: "key-29", now }).status).toBe("hit");
      expect(read(storage, { queryKey: "key-0", now }).status).toBe("miss");
    });

    it("evicts across scopes by age", () => {
      const storage = new MemoryStorage();
      write(storage, { accountScope: "user-2:org-1", now: NOW });
      for (let index = 0; index < SQL_QUERY_SNAPSHOT_MAX_ENTRIES; index += 1) {
        write(storage, { queryKey: `key-${index}`, now: NOW + 1 + index });
      }
      expect(
        read(storage, { accountScope: "user-2:org-1", now: NOW + 100 }).status,
      ).toBe("miss");
    });

    it("evicts older entries and retries when the browser quota is hit", () => {
      const storage = new MemoryStorage();
      write(storage, { queryKey: "a", now: NOW });
      write(storage, { queryKey: "b", now: NOW + 1 });
      const used = [...storage.data].reduce(
        (sum, [k, v]) => sum + k.length + v.length,
        0,
      );
      storage.quota = used + 50;
      const result = write(storage, {
        queryKey: "c",
        result: { rows: [{ blob: "y".repeat(200) }] },
        now: NOW + 2,
      });
      expect(result).toMatchObject({ status: "written" });
      expect(read(storage, { queryKey: "a", now: NOW + 3 }).status).toBe(
        "miss",
      );
      expect(read(storage, { queryKey: "c", now: NOW + 3 }).status).toBe("hit");
    });

    it("reports quota exceeded when nothing is left to evict", () => {
      const storage = new MemoryStorage();
      storage.quota = 10;
      expect(write(storage)).toMatchObject({
        status: "unavailable",
        reason: "quota-exceeded",
        errorName: "QuotaExceededError",
      });
      expect(storage.data.size).toBe(0);
    });
  });

  describe("unavailable storage is not a miss", () => {
    it("reports no storage outside a browser", () => {
      vi.stubGlobal("window", undefined);
      const args = { accountScope: SCOPE, queryKey: KEY };
      expect(readSqlQuerySnapshot(args)).toEqual({
        status: "unavailable",
        reason: "no-storage",
      });
      expect(writeSqlQuerySnapshot({ ...args, result: { rows: [] } })).toEqual({
        status: "unavailable",
        reason: "no-storage",
      });
      expect(clearSqlQuerySnapshots()).toEqual({
        status: "unavailable",
        reason: "no-storage",
      });
    });

    it("reports a storage error when reading window.sessionStorage throws", () => {
      vi.stubGlobal("window", {
        get sessionStorage(): Storage {
          throw new DOMException("denied", "SecurityError");
        },
      });
      expect(
        readSqlQuerySnapshot({ accountScope: SCOPE, queryKey: KEY }),
      ).toEqual({
        status: "unavailable",
        reason: "storage-error",
        errorName: "SecurityError",
      });
    });

    it("uses window.sessionStorage by default", () => {
      const storage = new MemoryStorage();
      vi.stubGlobal("window", { sessionStorage: storage });
      expect(
        writeSqlQuerySnapshot({
          accountScope: SCOPE,
          queryKey: KEY,
          result: { rows: [{ n: 1 }] },
        }).status,
      ).toBe("written");
      expect(
        readSqlQuerySnapshot({ accountScope: SCOPE, queryKey: KEY }).status,
      ).toBe("hit");
      expect(clearSqlQuerySnapshots()).toMatchObject({ status: "cleared" });
      expect(storage.data.size).toBe(0);
    });

    it("reports a storage error when reads, writes or clears throw", () => {
      const storage = new MemoryStorage();
      write(storage);
      storage.failWith = new Error("disk gone");
      const unavailable = {
        status: "unavailable",
        reason: "storage-error",
        errorName: "Error",
      };
      expect(read(storage)).toEqual(unavailable);
      expect(write(storage)).toEqual(unavailable);
      storage.failWith = null;
      const setItem = vi.spyOn(storage, "setItem").mockImplementation(() => {
        throw new Error("not a quota problem");
      });
      expect(write(storage)).toEqual(unavailable);
      setItem.mockRestore();
      write(storage);
      const removeItem = vi
        .spyOn(storage, "removeItem")
        .mockImplementation(() => {
          throw new Error("nope");
        });
      expect(clearSqlQuerySnapshots({ storage })).toEqual(unavailable);
    });
  });
});
