import { beforeEach, describe, expect, it, vi } from "vitest";

const _metaStore = new Map<string, Record<string, unknown>>();
const _rowStore = new Map<string, Record<string, unknown>[]>();
const _executedSql: string[] = [];
const _hiddenStagedDatasetLookupId: { value: string | null } = { value: null };

vi.mock("../db/client.js", () => {
  const advisoryLockTails = new Map<string, Promise<void>>();

  type MockTransaction = {
    metaBefore: Map<string, Record<string, unknown> | undefined>;
    rowsBefore: Map<string, Record<string, unknown>[] | undefined>;
    releaseLocks: Array<() => void>;
  };

  const rememberMeta = (id: string, transaction?: MockTransaction) => {
    if (!transaction || transaction.metaBefore.has(id)) return;
    const entry = _metaStore.get(id);
    transaction.metaBefore.set(id, entry ? { ...entry } : undefined);
  };

  const rememberRows = (id: string, transaction?: MockTransaction) => {
    if (!transaction || transaction.rowsBefore.has(id)) return;
    const rows = _rowStore.get(id);
    transaction.rowsBefore.set(
      id,
      rows ? rows.map((row) => ({ ...row })) : undefined,
    );
  };

  const execute = async (
    sql: string | { sql: string; args: unknown[] },
    transaction?: MockTransaction,
  ) => {
    const rawSql = typeof sql === "string" ? sql : sql.sql;
    const args = typeof sql === "string" ? [] : (sql.args as unknown[]);
    _executedSql.push(rawSql);

    if (/pg_advisory_xact_lock/i.test(rawSql)) {
      const key = args[0] as string;
      const previous = advisoryLockTails.get(key) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      advisoryLockTails.set(key, current);
      await previous;
      const releaseLock = () => {
        release();
        if (advisoryLockTails.get(key) === current) {
          advisoryLockTails.delete(key);
        }
      };
      if (transaction) transaction.releaseLocks.push(releaseLock);
      else releaseLock();
      return { rows: [], rowsAffected: 1 };
    }

    if (/CREATE TABLE/i.test(rawSql)) return { rows: [], rowsAffected: 0 };
    if (/CREATE INDEX/i.test(rawSql)) return { rows: [], rowsAffected: 0 };

    if (/DELETE FROM staged_dataset_rows WHERE dataset_id/i.test(rawSql)) {
      const id = args[0] as string;
      rememberRows(id, transaction);
      _rowStore.delete(id);
      return { rows: [], rowsAffected: 1 };
    }
    if (/INSERT INTO staged_dataset_rows/i.test(rawSql)) {
      const id = args[0] as string;
      const idx = args[1] as number;
      const data = args[2] as string;
      rememberRows(id, transaction);
      if (!_rowStore.has(id)) _rowStore.set(id, []);
      _rowStore.get(id)![idx] = JSON.parse(data) as Record<string, unknown>;
      return { rows: [], rowsAffected: 1 };
    }
    if (
      /SELECT row_data FROM staged_dataset_rows WHERE dataset_id/i.test(rawSql)
    ) {
      const id = args[0] as string;
      const r = _rowStore.get(id) ?? [];
      return {
        rows: r.map((d) => ({ row_data: JSON.stringify(d) })),
        rowsAffected: 0,
      };
    }

    if (
      /SELECT id FROM staged_datasets WHERE id.*AND app_id.*AND owner_email/i.test(
        rawSql,
      )
    ) {
      const id = args[0] as string;
      const appId = args[1] as string;
      const owner = args[2] as string;
      const entry = _metaStore.get(id);
      const found =
        entry && entry.app_id === appId && entry.owner_email === owner
          ? [entry]
          : [];
      return { rows: found, rowsAffected: 0 };
    }
    if (
      /SELECT id, app_id, owner_email, name, columns, row_count, byte_size, created_at, updated_at FROM staged_datasets WHERE id/i.test(
        rawSql,
      )
    ) {
      const id = args[0] as string;
      const appId = args[1] as string;
      const owner = args[2] as string;
      const entry = _metaStore.get(id);
      const found =
        entry && entry.app_id === appId && entry.owner_email === owner
          ? [entry]
          : [];
      return { rows: found, rowsAffected: 0 };
    }
    if (
      /SELECT id, app_id, owner_email.*FROM staged_datasets WHERE app_id.*AND owner_email.*ORDER/i.test(
        rawSql,
      )
    ) {
      const appId = args[0] as string;
      const owner = args[1] as string;
      const entries = Array.from(_metaStore.values()).filter(
        (e) => e.app_id === appId && e.owner_email === owner,
      );
      return { rows: entries, rowsAffected: 0 };
    }
    if (
      /SELECT.*COALESCE.*SUM.*row_count.*FROM staged_datasets WHERE app_id.*AND owner_email/i.test(
        rawSql,
      )
    ) {
      const appId = args[0] as string;
      const owner = args[1] as string;
      const excludingId = args[2] as string;
      const total = Array.from(_metaStore.values())
        .filter(
          (e) =>
            e.app_id === appId &&
            e.owner_email === owner &&
            e.id !== excludingId,
        )
        .reduce((sum, e) => sum + Number(e.row_count), 0);
      return { rows: [{ total }], rowsAffected: 0 };
    }
    if (
      /SELECT.*COALESCE.*SUM\(OCTET_LENGTH\(r\.row_data\)\).*FROM staged_dataset_rows r INNER JOIN staged_datasets d/i.test(
        rawSql,
      )
    ) {
      const [appId, owner, excludingId] = args as string[];
      const total = Array.from(_metaStore.entries())
        .filter(
          ([id, entry]) =>
            id !== excludingId &&
            entry.app_id === appId &&
            entry.owner_email === owner,
        )
        .reduce(
          (sum, [id]) =>
            sum +
            (_rowStore.get(id) ?? []).reduce(
              (datasetSum, row) =>
                datasetSum + Buffer.byteLength(JSON.stringify(row), "utf8"),
              0,
            ),
          0,
        );
      return { rows: [{ total }], rowsAffected: 0 };
    }
    if (
      /SELECT app_id, owner_email FROM staged_datasets WHERE id = \?/i.test(
        rawSql,
      )
    ) {
      const id = args[0] as string;
      const entry =
        _hiddenStagedDatasetLookupId.value === id
          ? undefined
          : _metaStore.get(id);
      if (_hiddenStagedDatasetLookupId.value === id) {
        _hiddenStagedDatasetLookupId.value = null;
      }
      return { rows: entry ? [entry] : [], rowsAffected: 0 };
    }
    if (/SELECT id FROM staged_datasets WHERE id = \?$/i.test(rawSql.trim())) {
      const id = args[0] as string;
      const found = _metaStore.has(id) ? [{ id }] : [];
      return { rows: found, rowsAffected: 0 };
    }
    if (/SELECT row_count FROM staged_datasets WHERE id/i.test(rawSql)) {
      const id = args[0] as string;
      const entry = _metaStore.get(id);
      return {
        rows: entry ? [{ row_count: entry.row_count }] : [],
        rowsAffected: 0,
      };
    }
    if (/SELECT byte_size FROM staged_datasets WHERE id/i.test(rawSql)) {
      const id = args[0] as string;
      const entry = _metaStore.get(id);
      return {
        rows: entry ? [{ byte_size: entry.byte_size }] : [],
        rowsAffected: 0,
      };
    }
    if (
      /INSERT INTO staged_datasets/i.test(rawSql) &&
      /ON CONFLICT/i.test(rawSql)
    ) {
      const [
        id,
        appId,
        owner,
        name,
        columns,
        rowCount,
        byteSize,
        createdAt,
        updatedAt,
      ] = args;
      const previous = _metaStore.get(id as string);
      if (
        previous &&
        (previous.app_id !== appId || previous.owner_email !== owner)
      ) {
        return { rows: [], rowsAffected: 0 };
      }
      rememberMeta(id as string, transaction);
      _metaStore.set(id as string, {
        id,
        app_id: previous?.app_id ?? appId,
        owner_email: previous?.owner_email ?? owner,
        name,
        columns,
        row_count: rowCount,
        byte_size: byteSize,
        created_at: previous?.created_at ?? createdAt,
        updated_at: updatedAt,
      });
      return { rows: [], rowsAffected: 1 };
    }
    if (/UPDATE staged_datasets SET/i.test(rawSql)) {
      const [name, columns, rowCount, byteSize, updatedAt, id] = args;
      const entry = _metaStore.get(id as string);
      if (entry) {
        rememberMeta(id as string, transaction);
        entry.name = name;
        entry.columns = columns;
        entry.row_count = rowCount;
        entry.byte_size = byteSize;
        entry.updated_at = updatedAt;
      }
      return { rows: [], rowsAffected: 1 };
    }
    if (
      /DELETE FROM staged_datasets WHERE id.*AND app_id.*AND owner_email/i.test(
        rawSql,
      )
    ) {
      const id = args[0] as string;
      rememberMeta(id, transaction);
      _metaStore.delete(id);
      return { rows: [], rowsAffected: 1 };
    }

    return { rows: [], rowsAffected: 0 };
  };

  return {
    isProductionServerlessFunctionRuntime: () => false,
    getDbExec: () => ({
      execute: (sql: string | { sql: string; args: unknown[] }) => execute(sql),
      transaction: async <T>(
        run: (tx: { execute: typeof execute }) => Promise<T>,
      ) => {
        const transaction: MockTransaction = {
          metaBefore: new Map(),
          rowsBefore: new Map(),
          releaseLocks: [],
        };
        try {
          return await run({
            execute: (sql) => execute(sql, transaction),
          });
        } catch (error) {
          for (const [id, entry] of transaction.metaBefore) {
            if (entry) _metaStore.set(id, { ...entry });
            else _metaStore.delete(id);
          }
          for (const [id, rows] of transaction.rowsBefore) {
            if (rows)
              _rowStore.set(
                id,
                rows.map((row) => ({ ...row })),
              );
            else _rowStore.delete(id);
          }
          throw error;
        } finally {
          for (const release of transaction.releaseLocks.reverse()) release();
        }
      },
    }),
  };
});

vi.mock("../server/request-context.js", () => ({
  getCredentialContext: () => ({
    userEmail: "ada@example.com",
    orgId: "org-1",
  }),
}));

vi.mock("../extensions/url-safety.js", () => ({
  createSsrfSafeDispatcher: vi.fn().mockResolvedValue(null),
  isBlockedExtensionUrlWithDns: vi.fn().mockResolvedValue(false),
}));

vi.mock("../credentials/index.js", () => ({
  resolveCredential: vi.fn().mockResolvedValue("test-token"),
}));

const { extractItemsArray } = await import("./staging.js");
const { stagingExecuteRequest } = await import("./staging.js");
const {
  upsertStagedDataset,
  getStagedDatasetRows,
  MAX_ROWS_PER_APP,
  MAX_BYTES_PER_APP,
  _resetInitPromiseForTests,
} = await import("./staged-datasets-store.js");
const { createProviderApiRuntime } = await import("./index.js");
const { createProviderApiRequestAction } =
  await import("./actions/provider-api.js");
import type { ProviderApiRequestArgs } from "./index.js";

beforeEach(() => {
  _executedSql.length = 0;
  _hiddenStagedDatasetLookupId.value = null;
});

function makeExecutor(_appId = "testapp") {
  const runtime = createProviderApiRuntime({
    appId: _appId,
    getCredentialContext: () => ({
      userEmail: "ada@example.com",
      orgId: "org-1",
    }),
    resolveCredential: async ({ key, provider }) => {
      if (key === "GONG_API_BASE") return null;
      return {
        key,
        value: "test-token",
        source: "local",
        provider,
      };
    },
  });
  return (args: ProviderApiRequestArgs) => runtime.executeRequest(args);
}

describe("extractItemsArray", () => {
  it("returns top-level array unchanged", () => {
    const rows = [{ id: 1 }, { id: 2 }];
    expect(extractItemsArray(rows)).toEqual(rows);
  });

  it("detects { data: [] }", () => {
    expect(extractItemsArray({ data: [{ id: 1 }], total: 1 })).toEqual([
      { id: 1 },
    ]);
  });

  it("detects { results: [] }", () => {
    expect(extractItemsArray({ results: [{ id: 2 }] })).toEqual([{ id: 2 }]);
  });

  it("detects { items: [] }", () => {
    expect(extractItemsArray({ items: [{ id: 3 }] })).toEqual([{ id: 3 }]);
  });

  it("detects { records: [] }", () => {
    expect(extractItemsArray({ records: [{ x: "a" }] })).toEqual([{ x: "a" }]);
  });

  it("detects a single top-level array field alongside metadata", () => {
    expect(
      extractItemsArray({
        providerSpecificRecords: [{ id: "record-1" }],
        records: { cursor: "next" },
      }),
    ).toEqual([{ id: "record-1" }]);
    expect(
      extractItemsArray({
        providerSpecificEvents: [{ eventId: "event-1" }],
      }),
    ).toEqual([{ eventId: "event-1" }]);
  });

  it("detects single-key object wrapping an array", () => {
    expect(extractItemsArray({ charges: [{ amount: 100 }] })).toEqual([
      { amount: 100 },
    ]);
  });

  it("uses explicit itemsPath when provided", () => {
    const body = { meta: { page: 1 }, payload: { events: [{ e: "click" }] } };
    expect(extractItemsArray(body, "payload.events")).toEqual([{ e: "click" }]);
  });

  it("returns [] for empty / non-object bodies", () => {
    expect(extractItemsArray(null)).toEqual([]);
    expect(extractItemsArray("string")).toEqual([]);
    expect(extractItemsArray({ meta: { cursor: "abc" } })).toEqual([]);
  });
});

describe("staging caps", () => {
  beforeEach(() => {
    _metaStore.clear();
    _rowStore.clear();
    _resetInitPromiseForTests();
  });

  it("rejects when row count would exceed MAX_ROWS_PER_APP", async () => {
    const existingRows = Array.from(
      { length: MAX_ROWS_PER_APP - 1 },
      (_, i) => ({
        id: i,
      }),
    );
    await upsertStagedDataset({
      id: "ds_existing",
      appId: "cappedapp",
      ownerEmail: "ada@example.com",
      name: "existing",
      rows: existingRows,
      columns: ["id"],
    });

    await expect(
      upsertStagedDataset({
        id: "ds_new",
        appId: "cappedapp",
        ownerEmail: "ada@example.com",
        name: "new",
        rows: Array.from({ length: 5 }, (_, i) => ({
          id: i + MAX_ROWS_PER_APP,
        })),
        columns: ["id"],
      }),
    ).rejects.toThrow(/cap exceeded/i);
  });

  it("serializes concurrent writes at the row quota boundary", async () => {
    _metaStore.set("ds_near_limit", {
      id: "ds_near_limit",
      app_id: "cappedapp",
      owner_email: "ada@example.com",
      name: "near limit",
      columns: '["id"]',
      row_count: MAX_ROWS_PER_APP - 1,
      byte_size: 0,
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    const results = await Promise.allSettled([
      upsertStagedDataset({
        id: "ds_concurrent_a",
        appId: "cappedapp",
        ownerEmail: "ada@example.com",
        name: "concurrent a",
        rows: [{ id: "a" }],
        columns: ["id"],
      }),
      upsertStagedDataset({
        id: "ds_concurrent_b",
        appId: "cappedapp",
        ownerEmail: "ada@example.com",
        name: "concurrent b",
        rows: [{ id: "b" }],
        columns: ["id"],
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") {
      expect(rejected.reason.message).toMatch(/cap exceeded/i);
    }
    const storedRows = Array.from(_metaStore.values())
      .filter(
        (entry) =>
          entry.app_id === "cappedapp" &&
          entry.owner_email === "ada@example.com",
      )
      .reduce((sum, entry) => sum + Number(entry.row_count), 0);
    expect(storedRows).toBeLessThanOrEqual(MAX_ROWS_PER_APP);
    expect(
      _executedSql.filter((sql) => /pg_advisory_xact_lock/i.test(sql)),
    ).toHaveLength(2);
  });

  it("does not count another owner's rows or bytes against the caller", async () => {
    _metaStore.set("ds_other_owner", {
      id: "ds_other_owner",
      app_id: "analytics",
      owner_email: "bob@example.com",
      name: "other owner's data",
      columns: '["id"]',
      row_count: MAX_ROWS_PER_APP,
      byte_size: MAX_BYTES_PER_APP,
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    await expect(
      upsertStagedDataset({
        id: "ds_ada_data",
        appId: "analytics",
        ownerEmail: "ada@example.com",
        name: "ada_data",
        rows: [{ id: 1 }],
        columns: ["id"],
      }),
    ).resolves.toMatchObject({ ownerEmail: "ada@example.com", rowCount: 1 });
  });

  it("credits existing dataset bytes when replacing it", async () => {
    const previousBytes = 30 * 1024 * 1024;
    _metaStore.set("ds_replace", {
      id: "ds_replace",
      app_id: "analytics",
      owner_email: "ada@example.com",
      name: "old data",
      columns: '["payload"]',
      row_count: 1,
      byte_size: previousBytes,
      created_at: Date.now(),
      updated_at: Date.now(),
    });
    const replacementRows = [{ payload: "x".repeat(25 * 1024 * 1024) }];

    const result = await upsertStagedDataset({
      id: "ds_replace",
      appId: "analytics",
      ownerEmail: "ada@example.com",
      name: "new data",
      rows: replacementRows,
      columns: ["payload"],
    });

    expect(result.byteSize).toBe(
      Buffer.byteLength(JSON.stringify(replacementRows[0]), "utf8"),
    );
    expect(result.byteSize).toBeLessThan(MAX_BYTES_PER_APP);
    expect(
      _executedSql.some(
        (sql) =>
          /ON CONFLICT \(id\) DO UPDATE/i.test(sql) &&
          /WHERE staged_datasets\.app_id = EXCLUDED\.app_id AND staged_datasets\.owner_email = EXCLUDED\.owner_email/i.test(
            sql,
          ),
      ),
    ).toBe(true);
  });

  it("counts serialized rows in UTF-8 bytes", async () => {
    const row = { label: "café 😀" };
    const result = await upsertStagedDataset({
      id: "ds_unicode",
      appId: "analytics",
      ownerEmail: "ada@example.com",
      name: "unicode",
      rows: [row],
      columns: ["label"],
    });

    expect(result.byteSize).toBe(
      Buffer.byteLength(JSON.stringify(row), "utf8"),
    );
    expect(result.byteSize).toBeGreaterThan(JSON.stringify(row).length);
    expect(
      _executedSql.some((sql) => /OCTET_LENGTH\(r\.row_data\)/i.test(sql)),
    ).toBe(true);
  });

  it("does not replace a dataset from another owner with a colliding ID", async () => {
    _metaStore.set("ds_collision", {
      id: "ds_collision",
      app_id: "analytics",
      owner_email: "bob@example.com",
      name: "bob_data",
      columns: '["val"]',
      row_count: 1,
      byte_size: JSON.stringify({ val: "original" }).length,
      created_at: Date.now(),
      updated_at: Date.now(),
    });
    _rowStore.set("ds_collision", [{ val: "original" }]);
    _hiddenStagedDatasetLookupId.value = "ds_collision";

    await expect(
      upsertStagedDataset({
        id: "ds_collision",
        appId: "analytics",
        ownerEmail: "ada@example.com",
        name: "ada_data",
        rows: [{ val: "replacement" }],
        columns: ["val"],
      }),
    ).rejects.toThrow(/already exists/i);
    expect(_metaStore.get("ds_collision")?.owner_email).toBe("bob@example.com");
    expect(_rowStore.get("ds_collision")).toEqual([{ val: "original" }]);
    expect(
      _executedSql.some(
        (sql) =>
          /ON CONFLICT \(id\) DO UPDATE/i.test(sql) &&
          /WHERE staged_datasets\.app_id = EXCLUDED\.app_id AND staged_datasets\.owner_email = EXCLUDED\.owner_email/i.test(
            sql,
          ),
      ),
    ).toBe(true);
  });
});

describe("staged dataset DDL", () => {
  beforeEach(() => {
    _metaStore.clear();
    _rowStore.clear();
    _resetInitPromiseForTests();
  });

  it("uses 64-bit integer columns and widens existing Postgres tables", async () => {
    await upsertStagedDataset({
      id: "ds_postgres_ddl",
      appId: "analytics",
      ownerEmail: "ada@example.com",
      name: "postgres-ddl",
      rows: [{ id: "row-1" }],
      columns: ["id"],
    });

    expect(
      _executedSql.some((sql) => /created_at\s+BIGINT\s+NOT NULL/i.test(sql)),
    ).toBe(true);
    expect(
      _executedSql.some((sql) => /updated_at\s+BIGINT\s+NOT NULL/i.test(sql)),
    ).toBe(true);
    expect(
      _executedSql.some((sql) =>
        /ALTER TABLE staged_datasets ALTER COLUMN created_at TYPE BIGINT/i.test(
          sql,
        ),
      ),
    ).toBe(true);
    expect(
      _executedSql.some((sql) =>
        /ALTER TABLE staged_dataset_rows ALTER COLUMN row_index TYPE BIGINT/i.test(
          sql,
        ),
      ),
    ).toBe(true);
  });
});

describe("stagingExecuteRequest — cursor pagination + 429", () => {
  beforeEach(() => {
    _metaStore.clear();
    _rowStore.clear();
    _resetInitPromiseForTests();
    vi.restoreAllMocks();
  });

  it.each([
    { status: 200, laterPage: false, code: "provider_api_rejected" },
    { status: 503, laterPage: false, code: "http_503" },
    { status: 200, laterPage: true, code: "provider_api_rejected" },
    { status: 503, laterPage: true, code: "http_503" },
  ])(
    "rejects failed staged provider pages: %j",
    async ({ status, laterPage, code }) => {
      const executeRequest = vi.fn();
      if (laterPage) {
        executeRequest.mockResolvedValueOnce({
          response: {
            ok: true,
            status: 200,
            json: { data: [{ id: "first" }], next_cursor: "second" },
          },
        });
      }
      executeRequest.mockResolvedValue({
        response: { ok: false, status, json: { error: "provider_rejected" } },
      });
      const action = createProviderApiRequestAction(
        { executeRequest },
        { appId: "testapp", getOwnerEmail: () => "ada@example.com" },
      );
      await expect(
        action.run({
          provider: "example",
          path: "/records",
          stageAs: "failed_pages",
          pagination: { nextCursorPath: "next_cursor", cursorParam: "cursor" },
        }),
      ).rejects.toMatchObject({
        errorCode: code,
        statusCode: status >= 400 ? status : 400,
      });
      expect(executeRequest).toHaveBeenCalledTimes(laterPage ? 2 : 1);
      expect(_metaStore.size).toBe(0);
      expect(_rowStore.size).toBe(0);
    },
  );

  it("preserves a quota cooldown code without retrying or staging", async () => {
    const executeRequest = vi.fn(async () => ({
      response: {
        ok: false,
        status: 429,
        json: { error: "provider_quota_exhausted" },
      },
    }));
    const action = createProviderApiRequestAction(
      { executeRequest },
      { appId: "testapp", getOwnerEmail: () => "ada@example.com" },
    );
    await expect(
      action.run({ provider: "example", path: "/records", stageAs: "quota" }),
    ).rejects.toMatchObject({ errorCode: "http_429", statusCode: 429 });
    expect(executeRequest).toHaveBeenCalledTimes(1);
    expect(_metaStore.size).toBe(0);
  });

  it("preserves the exhausted retry code after six rate-limited attempts", async () => {
    vi.useFakeTimers();
    try {
      const executeRequest = vi.fn(async () => ({
        response: {
          ok: false,
          status: 429,
          headers: { "retry-after": "0.01" },
        },
      }));
      const action = createProviderApiRequestAction(
        { executeRequest },
        { appId: "testapp", getOwnerEmail: () => "ada@example.com" },
      );
      const rejected = expect(
        action.run({
          provider: "example",
          path: "/records",
          stageAs: "rate_limited",
        }),
      ).rejects.toMatchObject({ errorCode: "http_429", statusCode: 429 });
      await vi.runAllTimersAsync();
      await rejected;
      expect(executeRequest).toHaveBeenCalledTimes(6);
      expect(_metaStore.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fetches two pages via cursor and stages combined rows", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { id: "ch_1", amount: 100 },
              { id: "ch_2", amount: 200 },
            ],
            next_cursor: "ch_2",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: "ch_3", amount: 300 }],
            next_cursor: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const result = await stagingExecuteRequest(
      {
        provider: "stripe",
        path: "/charges",
        stageAs: "stripe_charges",
        pagination: {
          nextCursorPath: "next_cursor",
          cursorParam: "starting_after",
          maxPages: 10,
        },
      },
      makeExecutor(),
      { appId: "testapp", ownerEmail: "ada@example.com" },
    );

    expect(result.dataset.rowCount).toBe(3);
    expect(result.dataset.columns).toContain("id");
    expect(result.dataset.sampleRows).toHaveLength(3);
    expect(result.pages).toBe(2);
    expect(result.truncated).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("can send next cursors through a POST body path", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_url, init) => {
        requestBodies.push(JSON.parse(String(init?.body ?? "{}")));
        const isFirstPage = requestBodies.length === 1;
        return new Response(
          JSON.stringify({
            calls: [
              {
                id: isFirstPage ? "call-1" : "call-2",
                title: isFirstPage ? "First call" : "Second call",
              },
            ],
            records: { cursor: isFirstPage ? "cursor-2" : null },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      });

    const result = await stagingExecuteRequest(
      {
        provider: "gong",
        method: "POST",
        path: "/calls/extensive",
        body: {
          filter: { fromDateTime: "2026-01-01T00:00:00.000Z" },
          contentSelector: { exposedFields: { parties: true } },
        },
        stageAs: "gong_calls",
        itemsPath: "calls",
        pagination: {
          nextCursorPath: "records.cursor",
          cursorBodyPath: "cursor",
          maxPages: 10,
        },
      },
      makeExecutor(),
      { appId: "testapp", ownerEmail: "ada@example.com" },
    );

    expect(result.dataset.rowCount).toBe(2);
    expect(result.pages).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBodies[0]).not.toHaveProperty("cursor");
    expect(requestBodies[1]).toMatchObject({
      cursor: "cursor-2",
      filter: { fromDateTime: "2026-01-01T00:00:00.000Z" },
    });
  });

  it("handles 429 with Retry-After and retries successfully", async () => {
    vi.useFakeTimers();

    let callCount = 0;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return new Response("Too Many Requests", {
            status: 429,
            headers: { "retry-after": "0.01", "content-type": "text/plain" },
          });
        }
        return new Response(
          JSON.stringify({ data: [{ id: "ch_1", amount: 100 }] }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      });

    const stagePromise = stagingExecuteRequest(
      {
        provider: "stripe",
        path: "/charges",
        stageAs: "stripe_charges_429",
      },
      makeExecutor(),
      { appId: "testapp", ownerEmail: "ada@example.com" },
    );

    await vi.runAllTimersAsync();
    const result = await stagePromise;

    expect(result.dataset.rowCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("throws after max retry attempts on persistent 429", async () => {
    vi.useFakeTimers();

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response("Too Many Requests", {
        status: 429,
        headers: { "content-type": "text/plain" },
      });
    });

    let caughtError: Error | null = null;
    const stagePromise = stagingExecuteRequest(
      {
        provider: "stripe",
        path: "/charges",
        stageAs: "stripe_charges_forever429",
      },
      makeExecutor(),
      { appId: "testapp", ownerEmail: "ada@example.com" },
    ).catch((e: Error) => {
      caughtError = e;
    });

    await vi.runAllTimersAsync();
    await stagePromise;

    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toMatch(/429/);
    expect(caughtError).toMatchObject({
      errorCode: "http_429",
      statusCode: 429,
    });

    vi.useRealTimers();
  });
});

describe("staged dataset scoping", () => {
  beforeEach(() => {
    _metaStore.clear();
    _rowStore.clear();
    _resetInitPromiseForTests();
  });

  it("does not return a dataset to a different app", async () => {
    await upsertStagedDataset({
      id: "ds_scope_test",
      appId: "app_a",
      ownerEmail: "ada@example.com",
      name: "app_a_data",
      rows: [{ val: 1 }],
      columns: ["val"],
    });

    const rows = await getStagedDatasetRows({
      id: "ds_scope_test",
      appId: "app_b",
      ownerEmail: "ada@example.com",
    });
    expect(rows).toEqual([]);
  });

  it("does not return a dataset to a different owner within the same app", async () => {
    await upsertStagedDataset({
      id: "ds_owner_test",
      appId: "analytics",
      ownerEmail: "ada@example.com",
      name: "ada_data",
      rows: [{ val: 42 }],
      columns: ["val"],
    });

    const rows = await getStagedDatasetRows({
      id: "ds_owner_test",
      appId: "analytics",
      ownerEmail: "bob@example.com",
    });
    expect(rows).toEqual([]);
  });

  it("allows the correct owner to read their dataset", async () => {
    await upsertStagedDataset({
      id: "ds_correct_owner",
      appId: "analytics",
      ownerEmail: "ada@example.com",
      name: "ada_correct",
      rows: [{ val: 99 }],
      columns: ["val"],
    });

    const rows = await getStagedDatasetRows({
      id: "ds_correct_owner",
      appId: "analytics",
      ownerEmail: "ada@example.com",
    });
    expect(rows).toEqual([{ val: 99 }]);
  });
});
