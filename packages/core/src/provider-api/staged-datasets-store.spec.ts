import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MetaRow = {
  id: string;
  app_id: string;
  owner_email: string;
  name: string;
  columns: string;
  row_count: number;
  byte_size: number;
  created_at: number;
  updated_at: number;
};

const _metaStore = new Map<string, MetaRow>();
const _rowStore = new Map<string, string[]>();
const _log: { tx: number | null; sql: string; args: unknown[] }[] = [];
let _txCounter = 0;

function makeExec(tx: number | null) {
  return {
    execute: async (stmt: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof stmt === "string" ? stmt : stmt.sql;
      const args = typeof stmt === "string" ? [] : (stmt.args ?? []);
      _log.push({ tx, sql, args });

      if (
        /DELETE FROM staged_dataset_rows WHERE dataset_id = \? AND EXISTS/i.test(
          sql,
        )
      ) {
        const entry = _metaStore.get(args[1] as string);
        if (entry?.app_id !== args[2] || entry.updated_at !== args[3]) {
          return { rows: [], rowsAffected: 0 };
        }
        _rowStore.delete(args[0] as string);
        return { rows: [], rowsAffected: 1 };
      }
      if (/pg_advisory_xact_lock/i.test(sql)) {
        return { rows: [], rowsAffected: 0 };
      }
      if (
        /DELETE FROM staged_datasets WHERE id = \? AND app_id = \?$/i.test(sql)
      ) {
        const entry = _metaStore.get(args[0] as string);
        if (entry?.app_id !== args[1]) return { rows: [], rowsAffected: 0 };
        _metaStore.delete(args[0] as string);
        return { rows: [], rowsAffected: 1 };
      }
      if (/DELETE FROM staged_dataset_rows WHERE dataset_id/i.test(sql)) {
        _rowStore.delete(args[0] as string);
        return { rows: [], rowsAffected: 1 };
      }
      if (
        /DELETE FROM staged_datasets WHERE id = \? AND app_id = \? AND updated_at = \?/i.test(
          sql,
        )
      ) {
        const entry = _metaStore.get(args[0] as string);
        if (entry?.app_id !== args[1] || entry.updated_at !== args[2]) {
          return { rows: [], rowsAffected: 0 };
        }
        _metaStore.delete(args[0] as string);
        return { rows: [], rowsAffected: 1 };
      }
      if (/INSERT INTO staged_dataset_rows/i.test(sql)) {
        const id = args[0] as string;
        if (!_rowStore.has(id)) _rowStore.set(id, []);
        _rowStore.get(id)![args[1] as number] = args[2] as string;
        return { rows: [], rowsAffected: 1 };
      }
      if (
        /INSERT INTO staged_datasets/i.test(sql) &&
        /ON CONFLICT/i.test(sql)
      ) {
        const [id, appId, owner, name, columns, rowCount, byteSize, c, u] =
          args;
        _metaStore.set(id as string, {
          id: id as string,
          app_id: appId as string,
          owner_email: owner as string,
          name: name as string,
          columns: columns as string,
          row_count: rowCount as number,
          byte_size: byteSize as number,
          created_at: c as number,
          updated_at: u as number,
        });
        return { rows: [], rowsAffected: 1 };
      }
      if (/SELECT row_data FROM staged_dataset_rows/i.test(sql)) {
        const rows = _rowStore.get(args[0] as string) ?? [];
        return {
          rows: rows.map((row_data) => ({ row_data })),
          rowsAffected: 0,
        };
      }
      if (
        /SELECT id FROM staged_datasets WHERE id = \? AND app_id/i.test(sql)
      ) {
        const entry = _metaStore.get(args[0] as string);
        if (entry?.app_id === args[1] && entry.owner_email === args[2]) {
          return { rows: [{ id: entry.id }], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 0 };
      }
      if (
        /SELECT id, owner_email, byte_size, row_count, updated_at FROM staged_datasets/i.test(
          sql,
        )
      ) {
        const rows = Array.from(_metaStore.values()).filter(
          (e) => e.app_id === args[0] && e.id !== args[1],
        );
        return { rows, rowsAffected: 0 };
      }
      if (
        /SELECT app_id, owner_email FROM staged_datasets WHERE id/i.test(sql)
      ) {
        const entry = _metaStore.get(args[0] as string);
        return {
          rows: entry
            ? [{ app_id: entry.app_id, owner_email: entry.owner_email }]
            : [],
          rowsAffected: 0,
        };
      }
      if (
        /AS total_rows, COALESCE\(SUM\(byte_size\), 0\) AS total_bytes/i.test(
          sql,
        )
      ) {
        const others = Array.from(_metaStore.values()).filter(
          (e) => e.app_id === args[0] && e.id !== args[1],
        );
        return {
          rows: [
            {
              total_rows: others.reduce((n, e) => n + e.row_count, 0),
              total_bytes: others.reduce((n, e) => n + e.byte_size, 0),
            },
          ],
          rowsAffected: 0,
        };
      }
      const sum = /SELECT COALESCE\(SUM\((row_count|byte_size)\)/i.exec(sql);
      if (sum) {
        const column = sum[1] as "row_count" | "byte_size";
        const total = Array.from(_metaStore.values())
          .filter((e) => e.app_id === args[0])
          .reduce((acc, e) => acc + e[column], 0);
        return { rows: [{ total }], rowsAffected: 0 };
      }
      const single =
        /SELECT (row_count|byte_size) FROM staged_datasets WHERE id/i.exec(sql);
      if (single) {
        const entry = _metaStore.get(args[0] as string);
        const column = single[1] as "row_count" | "byte_size";
        const visible =
          entry && entry.app_id === args[1] && entry.owner_email === args[2];
        return {
          rows: visible ? [{ [column]: entry[column] }] : [],
          rowsAffected: 0,
        };
      }
      return { rows: [], rowsAffected: 0 };
    },
  };
}

vi.mock("../db/client.js", () => ({
  isProductionServerlessFunctionRuntime: () => false,
  getDbExec: () => ({
    ...makeExec(null),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(makeExec(++_txCounter)),
  }),
}));

const {
  MAX_BYTES_PER_APP,
  MAX_ROWS_PER_APP,
  STAGED_DATASET_MAX_AGE_MS,
  selectStagedDatasetsToEvict,
  upsertStagedDataset,
  _resetInitPromiseForTests,
} = await import("./staged-datasets-store.js");

const MB = 1024 * 1024;
const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function candidate(
  id: string,
  byte_size: number,
  updated_at: number,
  row_count = 0,
  owner_email = "ada@example.com",
) {
  return { id, owner_email, byte_size, row_count, updated_at };
}

function seed(
  id: string,
  fields: Partial<MetaRow> & { updated_at: number; byte_size: number },
) {
  _metaStore.set(id, {
    id,
    app_id: "analytics",
    owner_email: "ada@example.com",
    name: id,
    columns: "[]",
    row_count: 0,
    created_at: fields.updated_at,
    ...fields,
  });
  _rowStore.set(id, ['{"seed":true}']);
}

describe("selectStagedDatasetsToEvict", () => {
  it("evicts nothing when the projected totals already fit", () => {
    expect(
      selectStagedDatasetsToEvict({
        candidates: [candidate("a", 10 * MB, 1)],
        ownerEmail: "ada@example.com",
        projectedBytes: MAX_BYTES_PER_APP,
        projectedRows: 0,
      }),
    ).toEqual({ evictIds: [], fits: true });
  });

  it("evicts least recently updated first until bytes fit", () => {
    const result = selectStagedDatasetsToEvict({
      candidates: [
        candidate("newest", 10 * MB, 300),
        candidate("oldest", 10 * MB, 100),
        candidate("middle", 10 * MB, 200),
      ],
      ownerEmail: "ada@example.com",
      projectedBytes: MAX_BYTES_PER_APP + 15 * MB,
      projectedRows: 0,
    });
    expect(result).toEqual({ evictIds: ["oldest", "middle"], fits: true });
  });

  it("keeps evicting while the row cap is the one still exceeded", () => {
    const result = selectStagedDatasetsToEvict({
      candidates: [
        candidate("a", 1, 100, 100),
        candidate("b", 1, 200, 100),
        candidate("c", 1, 300, 100),
      ],
      ownerEmail: "ada@example.com",
      projectedBytes: 3,
      projectedRows: MAX_ROWS_PER_APP + 150,
    });
    expect(result).toEqual({ evictIds: ["a", "b"], fits: true });
  });

  it("always drops stale datasets but stops at the first fresh one that fits", () => {
    const result = selectStagedDatasetsToEvict({
      candidates: [
        candidate("fresh", 10 * MB, 900),
        candidate("stale-new", 1, 500),
        candidate("stale-old", 1, 100),
      ],
      ownerEmail: "ada@example.com",
      projectedBytes: MAX_BYTES_PER_APP + 1,
      projectedRows: 0,
      staleBefore: 600,
    });
    expect(result).toEqual({
      evictIds: ["stale-old", "stale-new"],
      fits: true,
    });
  });

  it("reports fits=false when dropping every candidate is not enough", () => {
    const result = selectStagedDatasetsToEvict({
      candidates: [candidate("a", 1 * MB, 1), candidate("b", 1 * MB, 2)],
      ownerEmail: "ada@example.com",
      projectedBytes: MAX_BYTES_PER_APP + 10 * MB,
      projectedRows: 0,
    });
    expect(result).toEqual({ evictIds: ["a", "b"], fits: false });
  });

  it("evicts the writer's own datasets before other owners' once nothing is stale", () => {
    const result = selectStagedDatasetsToEvict({
      candidates: [
        candidate("others-oldest", 10 * MB, 100, 0, "linus@example.com"),
        candidate("mine-newer", 10 * MB, 300, 0, "ada@example.com"),
        candidate("mine-newest", 10 * MB, 400, 0, "ada@example.com"),
      ],
      ownerEmail: "ada@example.com",
      projectedBytes: MAX_BYTES_PER_APP + 15 * MB,
      projectedRows: 0,
    });
    expect(result).toEqual({
      evictIds: ["mine-newer", "mine-newest"],
      fits: true,
    });
  });

  it("does not mutate the candidates it is given", () => {
    const candidates = [candidate("b", 1, 2), candidate("a", 1, 1)];
    selectStagedDatasetsToEvict({
      ownerEmail: "ada@example.com",
      candidates,
      projectedBytes: MAX_BYTES_PER_APP + 1,
      projectedRows: 0,
    });
    expect(candidates.map((c) => c.id)).toEqual(["b", "a"]);
  });
});

describe("upsertStagedDataset eviction", () => {
  beforeEach(() => {
    _metaStore.clear();
    _rowStore.clear();
    _log.length = 0;
    _txCounter = 0;
    _resetInitPromiseForTests();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const write = (id: string, rows: Record<string, unknown>[]) =>
    upsertStagedDataset({
      id,
      appId: "analytics",
      ownerEmail: "grace@example.com",
      name: id,
      rows,
      columns: [],
    });

  it("evicts the oldest datasets of other owners when the writer has none", async () => {
    seed("ds_old", {
      owner_email: "ada@example.com",
      byte_size: 25 * MB,
      updated_at: NOW - 3 * DAY,
    });
    seed("ds_mid", {
      owner_email: "linus@example.com",
      byte_size: 20 * MB,
      updated_at: NOW - 2 * DAY,
    });
    seed("ds_new", {
      owner_email: "ada@example.com",
      byte_size: 5 * MB - 10,
      updated_at: NOW - DAY,
    });

    const rowsToStage = Array.from({ length: 3 }, (_, i) => ({
      blob: "x".repeat(100) + i,
    }));
    const meta = await write("ds_fresh", rowsToStage);

    expect(meta.rowCount).toBe(3);
    expect(_metaStore.has("ds_old")).toBe(false);
    expect(_rowStore.has("ds_old")).toBe(false);
    expect(_metaStore.has("ds_mid")).toBe(true);
    expect(_metaStore.has("ds_new")).toBe(true);
    expect(_metaStore.get("ds_fresh")?.row_count).toBe(3);
    expect(_rowStore.get("ds_fresh")).toHaveLength(3);
  });

  it("evicts inside the same transaction as the write it makes room for", async () => {
    seed("ds_a", { byte_size: 20 * MB, updated_at: NOW - 3 * DAY });
    seed("ds_b", { byte_size: 20 * MB, updated_at: NOW - 2 * DAY });
    seed("ds_c", { byte_size: 10 * MB, updated_at: NOW - DAY });

    await write("ds_big", [{ blob: "x".repeat(25 * MB) }]);

    expect(_metaStore.has("ds_a")).toBe(false);
    expect(_metaStore.has("ds_b")).toBe(false);
    expect(_metaStore.has("ds_c")).toBe(true);

    const writeTx = _log.find((e) =>
      /INSERT INTO staged_datasets/i.test(e.sql),
    )?.tx;
    expect(writeTx).toBeTypeOf("number");
    for (const id of ["ds_a", "ds_b"]) {
      const victimDeletes = _log.filter(
        (e) =>
          /DELETE FROM staged_datasets WHERE id/i.test(e.sql) &&
          e.args[0] === id,
      );
      expect(victimDeletes).toHaveLength(1);
      expect(victimDeletes[0]?.tx).toBe(writeTx);
    }
  });

  it("evicts to satisfy the row cap", async () => {
    seed("ds_rows_old", {
      row_count: MAX_ROWS_PER_APP - 10,
      byte_size: 1,
      updated_at: NOW - 2 * DAY,
    });
    seed("ds_rows_new", { row_count: 10, byte_size: 1, updated_at: NOW - DAY });

    await write(
      "ds_next",
      Array.from({ length: 20 }, (_, i) => ({ i })),
    );

    expect(_metaStore.has("ds_rows_old")).toBe(false);
    expect(_metaStore.has("ds_rows_new")).toBe(true);
    expect(_metaStore.get("ds_next")?.row_count).toBe(20);
  });

  it("never evicts other apps' datasets", async () => {
    seed("ds_other_app", {
      app_id: "mail",
      byte_size: 40 * MB,
      updated_at: NOW - 30 * DAY,
    });
    seed("ds_mine", { byte_size: 40 * MB, updated_at: NOW - DAY });

    await write("ds_next", [{ blob: "x".repeat(15 * MB) }]);

    expect(_metaStore.has("ds_other_app")).toBe(true);
    expect(_metaStore.has("ds_mine")).toBe(false);
  });

  it("does not evict anything when replacing a dataset in place stays under the cap", async () => {
    seed("ds_self", { byte_size: 30 * MB, updated_at: NOW - DAY });
    seed("ds_peer", { byte_size: 19 * MB, updated_at: NOW - 5 * DAY });

    await upsertStagedDataset({
      id: "ds_self",
      appId: "analytics",
      ownerEmail: "ada@example.com",
      name: "ds_self",
      rows: [{ blob: "x".repeat(30 * MB) }],
      columns: [],
    });

    expect(_metaStore.has("ds_peer")).toBe(true);
    expect(_metaStore.get("ds_self")?.updated_at).toBe(NOW);
  });

  it("never evicts the dataset being written when it must make room", async () => {
    seed("ds_self", { byte_size: 5 * MB, updated_at: NOW - 20 * DAY });
    seed("ds_peer", { byte_size: 45 * MB, updated_at: NOW - 10 * DAY });

    await upsertStagedDataset({
      id: "ds_self",
      appId: "analytics",
      ownerEmail: "ada@example.com",
      name: "ds_self",
      rows: [{ blob: "x".repeat(20 * MB) }],
      columns: [],
    });

    expect(_metaStore.has("ds_peer")).toBe(false);
    expect(_metaStore.get("ds_self")?.byte_size).toBeGreaterThan(20 * MB);
    expect(_rowStore.get("ds_self")).toHaveLength(1);
  });

  it("drops datasets older than the max age during an over-cap write only", async () => {
    seed("ds_stale", {
      byte_size: 1,
      updated_at: NOW - STAGED_DATASET_MAX_AGE_MS - DAY,
    });
    seed("ds_big", { byte_size: 49 * MB, updated_at: NOW - 2 * DAY });

    await write("ds_small", [{ a: 1 }]);
    expect(_metaStore.has("ds_stale")).toBe(true);
    expect(_log.some((e) => /SELECT id, owner_email/i.test(e.sql))).toBe(false);

    await write("ds_large", [{ blob: "x".repeat(3 * MB) }]);
    expect(_metaStore.has("ds_stale")).toBe(false);
    expect(_metaStore.has("ds_big")).toBe(false);
  });

  it("evicts only as many datasets as needed when none are past the max age", async () => {
    seed("ds_a", { byte_size: 30 * MB, updated_at: NOW - 13 * DAY });
    seed("ds_b", { byte_size: 19 * MB, updated_at: NOW - 12 * DAY });

    await write("ds_next", [{ blob: "x".repeat(2 * MB) }]);

    expect(_metaStore.has("ds_a")).toBe(false);
    expect(_metaStore.has("ds_b")).toBe(true);
  });

  it("refuses to overwrite a dataset id that belongs to another owner", async () => {
    seed("ds_shared", {
      owner_email: "ada@example.com",
      byte_size: 1 * MB,
      updated_at: NOW - DAY,
    });

    await expect(write("ds_shared", [{ a: 1 }])).rejects.toThrow(
      /belongs to another owner/,
    );
    expect(_metaStore.get("ds_shared")?.owner_email).toBe("ada@example.com");
    expect(_rowStore.get("ds_shared")).toEqual(['{"seed":true}']);
  });

  it("takes the app lock before reading totals, in the write's own transaction", async () => {
    seed("ds_peer", { byte_size: 1 * MB, updated_at: NOW - DAY });

    await write("ds_next", [{ a: 1 }]);

    const lock = _log.findIndex((e) => /pg_advisory_xact_lock/i.test(e.sql));
    const totals = _log.findIndex((e) => /AS total_rows/i.test(e.sql));
    const insert = _log.findIndex((e) =>
      /INSERT INTO staged_datasets/i.test(e.sql),
    );
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(totals);
    expect(totals).toBeLessThan(insert);
    expect(_log[lock]?.args).toEqual(["staged-datasets:analytics"]);
    expect(_log[lock]?.tx).toBe(_log[insert]?.tx);
  });

  it("names the single-dataset cause and evicts nothing when bytes cannot fit", async () => {
    seed("ds_peer", { byte_size: 10 * MB, updated_at: NOW - DAY });

    await expect(
      write("ds_huge", [{ blob: "x".repeat(MAX_BYTES_PER_APP + 1) }]),
    ).rejects.toThrow(
      /Staged dataset byte cap exceeded: this dataset alone is 50\.0 MB \(limit 50 MB per app/,
    );

    expect(_metaStore.has("ds_peer")).toBe(true);
    expect(_rowStore.has("ds_peer")).toBe(true);
    expect(_metaStore.has("ds_huge")).toBe(false);
  });

  it("names the single-dataset cause and evicts nothing when rows cannot fit", async () => {
    seed("ds_peer", { byte_size: 10 * MB, updated_at: NOW - DAY });

    await expect(
      write(
        "ds_many",
        Array.from({ length: MAX_ROWS_PER_APP + 1 }, () => ({})),
      ),
    ).rejects.toThrow(
      new RegExp(
        `Staged dataset cap exceeded: this dataset alone has ${MAX_ROWS_PER_APP + 1} rows`,
      ),
    );

    expect(_metaStore.has("ds_peer")).toBe(true);
    expect(_metaStore.has("ds_many")).toBe(false);
  });
});
