/**
 * Tests for the provider-api staging layer (P0: stageAs, P1: fetchAll).
 *
 * Covers:
 *  - Auto-detection of items shape
 *  - Staging caps (row count + byte size)
 *  - fetchAll cursor loop with mocked 429 + Retry-After
 *  - Scoping: dataset from app A not readable from app B
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// DB mock — use in-memory Map instead of real SQLite
// ---------------------------------------------------------------------------

const _metaStore = new Map<string, Record<string, unknown>>();
const _rowStore = new Map<string, Record<string, unknown>[]>();

vi.mock("../db/client.js", () => ({
  getDialect: () => "sqlite",
  isPostgres: () => false,
  intType: () => "INTEGER",
  getDbExec: () => ({
    execute: async (sql: string | { sql: string; args: unknown[] }) => {
      const rawSql = typeof sql === "string" ? sql : sql.sql;
      const args = typeof sql === "string" ? [] : (sql.args as unknown[]);

      // CREATE TABLE — no-op
      if (/CREATE TABLE/i.test(rawSql)) return { rows: [], rowsAffected: 0 };
      // CREATE INDEX — no-op
      if (/CREATE INDEX/i.test(rawSql)) return { rows: [], rowsAffected: 0 };

      // staged_dataset_rows DELETE
      if (/DELETE FROM staged_dataset_rows WHERE dataset_id/i.test(rawSql)) {
        _rowStore.delete(args[0] as string);
        return { rows: [], rowsAffected: 1 };
      }
      // staged_dataset_rows INSERT
      if (/INSERT INTO staged_dataset_rows/i.test(rawSql)) {
        const id = args[0] as string;
        const idx = args[1] as number;
        const data = args[2] as string;
        if (!_rowStore.has(id)) _rowStore.set(id, []);
        _rowStore.get(id)![idx] = JSON.parse(data) as Record<string, unknown>;
        return { rows: [], rowsAffected: 1 };
      }
      // staged_dataset_rows SELECT
      if (
        /SELECT row_data FROM staged_dataset_rows WHERE dataset_id/i.test(
          rawSql,
        )
      ) {
        const id = args[0] as string;
        const r = _rowStore.get(id) ?? [];
        return {
          rows: r.map((d) => ({ row_data: JSON.stringify(d) })),
          rowsAffected: 0,
        };
      }

      // staged_datasets SELECT (scope check)
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
      // staged_datasets SELECT (full meta)
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
      // staged_datasets SELECT (list)
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
      // staged_datasets SELECT row_count (cap check)
      if (
        /SELECT.*COALESCE.*SUM.*row_count.*FROM staged_datasets WHERE app_id/i.test(
          rawSql,
        )
      ) {
        const appId = args[0] as string;
        const total = Array.from(_metaStore.values())
          .filter((e) => e.app_id === appId)
          .reduce((sum, e) => sum + Number(e.row_count), 0);
        return { rows: [{ total }], rowsAffected: 0 };
      }
      // staged_datasets SELECT byte_size (cap check)
      if (
        /SELECT.*COALESCE.*SUM.*byte_size.*FROM staged_datasets WHERE app_id/i.test(
          rawSql,
        )
      ) {
        const appId = args[0] as string;
        const total = Array.from(_metaStore.values())
          .filter((e) => e.app_id === appId)
          .reduce((sum, e) => sum + Number(e.byte_size), 0);
        return { rows: [{ total }], rowsAffected: 0 };
      }
      // staged_datasets SELECT (check existing)
      if (
        /SELECT id FROM staged_datasets WHERE id = \?$/i.test(rawSql.trim())
      ) {
        const id = args[0] as string;
        const found = _metaStore.has(id) ? [{ id }] : [];
        return { rows: found, rowsAffected: 0 };
      }
      // staged_datasets row_count SELECT (for append)
      if (/SELECT row_count FROM staged_datasets WHERE id/i.test(rawSql)) {
        const id = args[0] as string;
        const entry = _metaStore.get(id);
        return {
          rows: entry ? [{ row_count: entry.row_count }] : [],
          rowsAffected: 0,
        };
      }
      // staged_datasets byte_size SELECT (for append)
      if (/SELECT byte_size FROM staged_datasets WHERE id/i.test(rawSql)) {
        const id = args[0] as string;
        const entry = _metaStore.get(id);
        return {
          rows: entry ? [{ byte_size: entry.byte_size }] : [],
          rowsAffected: 0,
        };
      }
      // staged_datasets INSERT OR REPLACE / INSERT ... ON CONFLICT
      if (
        /INSERT (OR REPLACE INTO|INTO) staged_datasets/i.test(rawSql) ||
        /INSERT INTO staged_datasets.*ON CONFLICT/i.test(rawSql)
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
        _metaStore.set(id as string, {
          id,
          app_id: appId,
          owner_email: owner,
          name,
          columns,
          row_count: rowCount,
          byte_size: byteSize,
          created_at: createdAt,
          updated_at: updatedAt,
        });
        return { rows: [], rowsAffected: 1 };
      }
      // staged_datasets UPDATE
      if (/UPDATE staged_datasets SET/i.test(rawSql)) {
        const [name, columns, rowCount, byteSize, updatedAt, id] = args;
        const entry = _metaStore.get(id as string);
        if (entry) {
          entry.name = name;
          entry.columns = columns;
          entry.row_count = rowCount;
          entry.byte_size = byteSize;
          entry.updated_at = updatedAt;
        }
        return { rows: [], rowsAffected: 1 };
      }
      // staged_datasets DELETE
      if (
        /DELETE FROM staged_datasets WHERE id.*AND app_id.*AND owner_email/i.test(
          rawSql,
        )
      ) {
        const id = args[0] as string;
        _metaStore.delete(id);
        return { rows: [], rowsAffected: 1 };
      }

      return { rows: [], rowsAffected: 0 };
    },
  }),
  isPostgres: () => false,
}));

// ---------------------------------------------------------------------------
// Credential context mock
// ---------------------------------------------------------------------------

vi.mock("../server/request-context.js", () => ({
  getCredentialContext: () => ({
    userEmail: "ada@example.com",
    orgId: "org-1",
  }),
}));

// ---------------------------------------------------------------------------
// SSRF mock (needed by executeProviderApiRequest)
// ---------------------------------------------------------------------------

vi.mock("../extensions/url-safety.js", () => ({
  createSsrfSafeDispatcher: vi.fn().mockResolvedValue(null),
  isBlockedExtensionUrlWithDns: vi.fn().mockResolvedValue(false),
}));

// ---------------------------------------------------------------------------
// Credentials mock
// ---------------------------------------------------------------------------

vi.mock("../credentials/index.js", () => ({
  resolveCredential: vi.fn().mockResolvedValue("test-token"),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

const { extractItemsArray } = await import("./staging.js");
const { stagingExecuteRequest } = await import("./staging.js");
const {
  upsertStagedDataset,
  getStagedDatasetRows,
  MAX_ROWS_PER_APP,
  _resetInitPromiseForTests,
} = await import("./staged-datasets-store.js");
const { createProviderApiRuntime } = await import("./index.js");
import type { ProviderApiRequestArgs } from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeExecutor(_appId = "testapp") {
  const runtime = createProviderApiRuntime({
    appId: _appId,
    getCredentialContext: () => ({
      userEmail: "ada@example.com",
      orgId: "org-1",
    }),
    resolveCredential: async () => ({
      key: "TEST_TOKEN",
      value: "test-token",
      source: "local",
      provider: "stripe",
    }),
  });
  return (args: ProviderApiRequestArgs) => runtime.executeRequest(args);
}

// ---------------------------------------------------------------------------
// 1. Auto-detection of items shape
// ---------------------------------------------------------------------------

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
    expect(extractItemsArray({ meta: { cursor: "abc" } })).toEqual([]); // no array values
  });
});

// ---------------------------------------------------------------------------
// 2. Staging caps
// ---------------------------------------------------------------------------

describe("staging caps", () => {
  beforeEach(() => {
    _metaStore.clear();
    _rowStore.clear();
    _resetInitPromiseForTests();
  });

  it("rejects when row count would exceed MAX_ROWS_PER_APP", async () => {
    // Fake an existing dataset using most of the row budget
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

    // A new dataset with 5 rows should push over the limit
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
});

// ---------------------------------------------------------------------------
// 3. fetchAll cursor loop + 429 + Retry-After
// ---------------------------------------------------------------------------

describe("stagingExecuteRequest — cursor pagination + 429", () => {
  beforeEach(() => {
    _metaStore.clear();
    _rowStore.clear();
    _resetInitPromiseForTests();
    vi.restoreAllMocks();
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

  it("handles 429 with Retry-After and retries successfully", async () => {
    vi.useFakeTimers();

    // Use mockImplementation so each call gets a fresh Response (body is consume-once)
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

    // Advance timers to cover the back-off sleep
    await vi.runAllTimersAsync();
    const result = await stagePromise;

    expect(result.dataset.rowCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("throws after max retry attempts on persistent 429", async () => {
    vi.useFakeTimers();

    // Each call must return a FRESH Response — body is consume-once
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response("Too Many Requests", {
        status: 429,
        headers: { "content-type": "text/plain" },
      });
    });

    // Attach a .catch immediately to prevent unhandled rejection before we await
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

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// 4. Scoping: dataset from app A not readable from app B
// ---------------------------------------------------------------------------

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

    // App B tries to read app A's dataset
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
