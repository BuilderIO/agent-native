import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

// Real PGlite behind getDbExec, so quota totals, eviction, stale removal and
// the removed markers run their genuine SQL inside the write's transaction.
let pglite: Awaited<ReturnType<typeof createTestPglite>>;
// Every statement the store sends, with the transaction it ran in (null when
// outside one), so ordering under the app lock can be asserted.
const log: { tx: number | null; sql: string; args: unknown[] }[] = [];
let txCounter = 0;

type Statement = string | { sql: string; args?: unknown[] };
const record = (tx: number | null, input: Statement) =>
  log.push({
    tx,
    sql: typeof input === "string" ? input : input.sql,
    args: typeof input === "string" ? [] : (input.args ?? []),
  });

vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: () => ({
    execute: async (input: Statement) => {
      record(null, input);
      if (typeof input === "string") {
        await pglite.exec(input);
        return { rows: [], rowsAffected: 0 };
      }
      const result = await pglite.query(input.sql, input.args ?? []);
      return {
        rows: result.rows as Record<string, unknown>[],
        rowsAffected: result.affectedRows ?? 0,
      };
    },
    transaction: <T>(
      fn: (tx: {
        execute: (input: Statement) => Promise<unknown>;
      }) => Promise<T>,
    ) => {
      const id = ++txCounter;
      return pglite.transaction((tx) =>
        fn({
          execute: (input: Statement) => {
            record(id, input);
            return tx.execute(input as never);
          },
        }),
      );
    },
  }),
}));

const {
  MAX_BYTES_PER_APP,
  MAX_BYTES_PER_OWNER,
  MAX_ROWS_PER_OWNER,
  STAGED_DATASET_MAX_AGE_MS,
  StagedDatasetRemovedError,
  deleteStagedDataset,
  getStagedDatasetMeta,
  getStagedDatasetRows,
  listStagedDatasets,
  upsertStagedDataset,
  _resetInitPromiseForTests,
} = await import("./staged-datasets-store.js");
const { createQueryStagedDatasetAction } =
  await import("./actions/staged-datasets.js");

const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;
const APP = "analytics";

// Writes a dataset's metadata straight into the table with a claimed size, so a
// quota can be filled without staging hundreds of megabytes of real rows.
async function seed(
  id: string,
  ownerEmail: string,
  byteSize: number,
  updatedAt: number,
  extra: {
    removedAt?: number;
    removedReason?: string;
    rowCount?: number;
    appId?: string;
  } = {},
) {
  await pglite.query(
    `INSERT INTO staged_datasets (id, app_id, owner_email, name, columns, row_count, byte_size, byte_size_utf8_updated_at, created_at, updated_at, removed_at, removed_reason) VALUES (?, ?, ?, ?, '["seed"]', ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      extra.appId ?? APP,
      ownerEmail,
      id,
      extra.rowCount ?? 1,
      byteSize,
      updatedAt,
      updatedAt,
      updatedAt,
      extra.removedAt ?? null,
      extra.removedReason ?? null,
    ],
  );
  await pglite.query(
    `INSERT INTO staged_dataset_rows (dataset_id, row_index, row_data) VALUES (?, 0, '{"seed":true}')`,
    [id],
  );
}

function stage(id: string, ownerEmail: string) {
  return upsertStagedDataset({
    id,
    appId: APP,
    ownerEmail,
    name: id,
    rows: [{ value: 1 }, { value: 2 }],
    columns: [],
  });
}

async function liveIds(): Promise<string[]> {
  const { rows } = await pglite.query(
    `SELECT id FROM staged_datasets WHERE app_id = ? AND removed_at IS NULL ORDER BY id`,
    [APP],
  );
  return rows.map((r) => (r as { id: string }).id);
}

async function removedReason(id: string): Promise<string | null> {
  const { rows } = await pglite.query(
    `SELECT removed_reason FROM staged_datasets WHERE id = ?`,
    [id],
  );
  return (
    (rows[0] as { removed_reason: string | null } | undefined)
      ?.removed_reason ?? null
  );
}

async function rowCount(id: string): Promise<number> {
  const { rows } = await pglite.query(
    `SELECT COUNT(*)::int AS n FROM staged_dataset_rows WHERE dataset_id = ?`,
    [id],
  );
  return (rows[0] as { n: number }).n;
}

beforeEach(async () => {
  pglite = await createTestPglite();
  _resetInitPromiseForTests();
  // Creates the tables through the store's own migrations.
  await listStagedDatasets({ appId: APP, ownerEmail: "setup@example.com" });
  log.length = 0;
  txCounter = 0;
});

afterEach(async () => {
  vi.useRealTimers();
  await pglite.close();
});

const indexOf = (pattern: RegExp) =>
  log.findIndex((entry) => pattern.test(entry.sql));

describe("staged dataset quotas on Postgres", () => {
  it("never evicts another owner's fresh dataset to fit a write", async () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      await seed(
        `ada_${i}`,
        "ada@example.com",
        MAX_BYTES_PER_OWNER / 5,
        now - 1000 + i,
      );
    }

    await stage("bea_new", "bea@example.com");

    expect(await liveIds()).toEqual([
      "ada_0",
      "ada_1",
      "ada_2",
      "ada_3",
      "ada_4",
      "bea_new",
    ]);
  });

  it("evicts only the writer's own oldest dataset when the writer is over quota", async () => {
    const now = Date.now();
    await seed("bea_oldest", "bea@example.com", 10 * MB, now - 5000);
    for (let i = 0; i < 5; i++) {
      await seed(
        `ada_${i}`,
        "ada@example.com",
        MAX_BYTES_PER_OWNER / 5,
        now - 1000 + i,
      );
    }

    await stage("ada_new", "ada@example.com");

    expect(await liveIds()).toEqual([
      "ada_1",
      "ada_2",
      "ada_3",
      "ada_4",
      "ada_new",
      "bea_oldest",
    ]);
    expect(await removedReason("ada_0")).toBe("capacity");
    expect(await rowCount("ada_0")).toBe(0);
  });

  it("removes datasets past the max age on a write that is under every quota", async () => {
    const now = Date.now();
    await seed(
      "cy_stale",
      "cy@example.com",
      1024,
      now - STAGED_DATASET_MAX_AGE_MS - DAY,
    );
    await seed("cy_fresh", "cy@example.com", 1024, now - DAY);
    await seed(
      "cy_old_marker",
      "cy@example.com",
      0,
      now - 3 * STAGED_DATASET_MAX_AGE_MS,
      {
        removedAt: now - STAGED_DATASET_MAX_AGE_MS - DAY,
        removedReason: "capacity",
      },
    );

    await stage("dee_new", "dee@example.com");

    expect(await liveIds()).toEqual(["cy_fresh", "dee_new"]);
    expect(await removedReason("cy_stale")).toBe("stale");
    expect(await rowCount("cy_stale")).toBe(0);
    const { rows: marker } = await pglite.query(
      `SELECT id FROM staged_datasets WHERE id = 'cy_old_marker'`,
    );
    expect(marker).toEqual([]);
    expect(
      (
        await listStagedDatasets({ appId: APP, ownerEmail: "cy@example.com" })
      ).map((d) => d.id),
    ).toEqual(["cy_fresh"]);
  });

  it("leaves other owners alone while the app is under the backstop", async () => {
    const now = Date.now();
    const perOwner = MAX_BYTES_PER_OWNER - MB;
    const owners = Math.floor(MAX_BYTES_PER_APP / perOwner) - 1;
    for (let i = 0; i < owners; i++) {
      await seed(
        `owner_${i}`,
        `owner${i}@example.com`,
        perOwner,
        now - 1000 + i,
      );
    }

    await stage("ada_new", "ada@example.com");

    expect(await liveIds()).toHaveLength(owners + 1);
  });

  it("evicts the writer's own data, then other owners' oldest, once the app passes the backstop", async () => {
    const now = Date.now();
    const perOwner = MAX_BYTES_PER_APP / 10;
    for (let i = 0; i < 10; i++) {
      // Each other owner is past the per-owner quota only through seeding; the
      // app total is what this write runs into.
      await seed(
        `owner_${i}`,
        `owner${i}@example.com`,
        perOwner,
        now - 1000 + i,
      );
    }
    await seed("ada_small", "ada@example.com", 64, now);

    await stage("ada_new", "ada@example.com");

    const live = await liveIds();
    expect(live).not.toContain("ada_small");
    expect(live).not.toContain("owner_0");
    expect(live).toContain("owner_1");
    expect(live).toContain("ada_new");
    expect(await removedReason("ada_small")).toBe("capacity");
    expect(await removedReason("owner_0")).toBe("capacity");
  });

  it("refuses a single dataset over the per-user quota and names that limit", async () => {
    const pad = "x".repeat(1024 * 1024);
    await expect(
      upsertStagedDataset({
        id: "ada_huge",
        appId: APP,
        ownerEmail: "ada@example.com",
        name: "huge",
        rows: Array.from({ length: 51 }, (_, i) => ({ i, pad })),
        columns: [],
      }),
    ).rejects.toThrow(/byte cap exceeded: this dataset alone is .* per user/);
    expect(await liveIds()).toEqual([]);
  });
});

describe("removed staged datasets on Postgres", () => {
  it("reports an evicted dataset as removed to make room, not as unknown", async () => {
    const now = Date.now();
    await seed(
      "ada_victim",
      "ada@example.com",
      MAX_BYTES_PER_OWNER,
      now - 1000,
    );
    await stage("ada_new", "ada@example.com");

    await expect(
      getStagedDatasetMeta({
        id: "ada_victim",
        appId: APP,
        ownerEmail: "ada@example.com",
      }),
    ).rejects.toBeInstanceOf(StagedDatasetRemovedError);

    const query = createQueryStagedDatasetAction({
      appId: APP,
      getOwnerEmail: () => "ada@example.com",
    });
    await expect(query.run({ datasetId: "ada_victim" })).rejects.toMatchObject({
      errorCode: "staged_dataset_removed",
      statusCode: 410,
      message: expect.stringMatching(/removed to make room.*Stage it again/),
    });
    await expect(query.run({ datasetId: "never_staged" })).rejects.toThrow(
      /not found/,
    );
  });

  it("names the max age when a dataset was removed as stale", async () => {
    const now = Date.now();
    await seed(
      "ada_stale",
      "ada@example.com",
      64,
      now - STAGED_DATASET_MAX_AGE_MS - DAY,
    );
    await stage("bea_new", "bea@example.com");

    await expect(
      getStagedDatasetMeta({
        id: "ada_stale",
        appId: APP,
        ownerEmail: "ada@example.com",
      }),
    ).rejects.toThrow(/removed after 14 days without an update/);
  });

  it("makes a removed id live again when it is staged again", async () => {
    const now = Date.now();
    await seed(
      "ada_victim",
      "ada@example.com",
      MAX_BYTES_PER_OWNER,
      now - 1000,
    );
    await stage("ada_new", "ada@example.com");
    await stage("ada_victim", "ada@example.com");

    const meta = await getStagedDatasetMeta({
      id: "ada_victim",
      appId: APP,
      ownerEmail: "ada@example.com",
    });
    expect(meta?.rowCount).toBe(2);
    expect(await removedReason("ada_victim")).toBeNull();
  });

  it("refuses to append to a removed dataset instead of restarting it", async () => {
    const now = Date.now();
    await seed(
      "ada_victim",
      "ada@example.com",
      MAX_BYTES_PER_OWNER,
      now - 1000,
    );
    await stage("ada_new", "ada@example.com");

    await expect(
      upsertStagedDataset({
        id: "ada_victim",
        appId: APP,
        ownerEmail: "ada@example.com",
        name: "ada_victim",
        rows: [{ value: 3 }],
        columns: [],
        append: true,
      }),
    ).rejects.toBeInstanceOf(StagedDatasetRemovedError);
  });
});

describe("staged dataset writes on Postgres", () => {
  it("takes the app lock before reading totals and evicts in the write's own transaction", async () => {
    await seed(
      "ada_victim",
      "ada@example.com",
      MAX_BYTES_PER_OWNER,
      Date.now() - 1000,
    );

    await stage("ada_new", "ada@example.com");

    const lock = indexOf(/pg_advisory_xact_lock/);
    const totals = indexOf(/AS owner_bytes/);
    const evict = indexOf(/removed_reason = 'capacity'/);
    const insert = indexOf(/INSERT INTO staged_datasets/);
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(totals);
    expect(totals).toBeLessThan(evict);
    expect(evict).toBeLessThan(insert);
    expect(log[lock]?.args).toEqual([`staged-datasets:${APP}`]);
    expect(log[lock]?.tx).toBeTypeOf("number");
    for (const i of [totals, evict, insert]) {
      expect(log[i]?.tx).toBe(log[lock]?.tx);
    }
  });

  it("evicts the writer's own oldest dataset to satisfy the per-user row quota", async () => {
    const now = Date.now();
    await seed("ada_rows_old", "ada@example.com", 1, now - 2000, {
      rowCount: MAX_ROWS_PER_OWNER - 1,
    });
    await seed("ada_rows_new", "ada@example.com", 1, now - 1000);

    await stage("ada_next", "ada@example.com");

    expect(await liveIds()).toEqual(["ada_next", "ada_rows_new"]);
  });

  it("never touches another app's datasets, even stale ones", async () => {
    const now = Date.now();
    await seed("mail_stale", "ada@example.com", 10 * MB, now - 30 * DAY, {
      appId: "mail",
    });
    await seed(
      "ada_victim",
      "ada@example.com",
      MAX_BYTES_PER_OWNER,
      now - 1000,
    );

    await stage("ada_new", "ada@example.com");

    const { rows } = await pglite.query(
      `SELECT removed_at FROM staged_datasets WHERE id = 'mail_stale'`,
    );
    expect(rows).toEqual([{ removed_at: null }]);
    expect(await rowCount("mail_stale")).toBe(1);
    expect(await removedReason("ada_victim")).toBe("capacity");
  });

  it("never removes the dataset being written, even when it is stale", async () => {
    const now = Date.now();
    await seed("ada_self", "ada@example.com", 5 * MB, now - 20 * DAY);
    await seed(
      "ada_peer",
      "ada@example.com",
      MAX_BYTES_PER_OWNER - MB,
      now - 1000,
    );

    await upsertStagedDataset({
      id: "ada_self",
      appId: APP,
      ownerEmail: "ada@example.com",
      name: "ada_self",
      rows: [{ blob: "x".repeat(2 * MB) }],
      columns: [],
    });

    expect(await liveIds()).toEqual(["ada_self"]);
    expect(await removedReason("ada_peer")).toBe("capacity");
    expect(
      await getStagedDatasetRows({
        id: "ada_self",
        appId: APP,
        ownerEmail: "ada@example.com",
      }),
    ).toHaveLength(1);
  });

  it("refuses to overwrite a dataset id that belongs to another owner", async () => {
    await seed("shared_id", "ada@example.com", 1024, Date.now() - 1000);

    await expect(stage("shared_id", "bea@example.com")).rejects.toThrow(
      /belongs to another owner/,
    );
    const { rows } = await pglite.query(
      `SELECT owner_email FROM staged_datasets WHERE id = 'shared_id'`,
    );
    expect(rows).toEqual([{ owner_email: "ada@example.com" }]);
    expect(await rowCount("shared_id")).toBe(1);
  });

  it("moves updated_at on every replacement, even inside one millisecond", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = 1_800_000_000_000;
    vi.setSystemTime(now);

    const first = await stage("ada_same", "ada@example.com");
    const second = await stage("ada_same", "ada@example.com");
    const third = await stage("ada_same", "ada@example.com");

    expect([first.updatedAt, second.updatedAt, third.updatedAt]).toEqual([
      now,
      now + 1,
      now + 2,
    ]);
  });

  it("stays ahead of a previous writer whose clock was later", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = 1_800_000_000_000;
    vi.setSystemTime(now);
    await seed("ada_same", "ada@example.com", 1, now + 5_000);

    const replaced = await stage("ada_same", "ada@example.com");

    expect(replaced.updatedAt).toBe(now + 5_001);
  });

  it("refuses a single over-quota dataset without evicting anything", async () => {
    await seed("ada_peer", "ada@example.com", 10 * MB, Date.now() - 1000);

    await expect(
      upsertStagedDataset({
        id: "ada_huge",
        appId: APP,
        ownerEmail: "ada@example.com",
        name: "ada_huge",
        rows: [{ blob: "x".repeat(MAX_BYTES_PER_OWNER + 1) }],
        columns: [],
      }),
    ).rejects.toThrow(
      /Staged dataset byte cap exceeded: this dataset alone is 50\.0 MB \(limit 50 MB per user\)/,
    );
    expect(await liveIds()).toEqual(["ada_peer"]);
  });

  it("reads the stored rows for an append under the app lock, in the write's transaction", async () => {
    await stage("ada_log", "ada@example.com");
    log.length = 0;

    const meta = await upsertStagedDataset({
      id: "ada_log",
      appId: APP,
      ownerEmail: "ada@example.com",
      name: "ada_log",
      rows: [{ value: 3 }],
      columns: [],
      append: true,
    });

    expect(meta.rowCount).toBe(3);
    const lock = indexOf(/pg_advisory_xact_lock/);
    const read = indexOf(/SELECT row_data FROM staged_dataset_rows/);
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(read).toBeGreaterThan(lock);
    expect(log[read]?.tx).toBe(log[lock]?.tx);
    expect(
      await getStagedDatasetRows({
        id: "ada_log",
        appId: APP,
        ownerEmail: "ada@example.com",
      }),
    ).toEqual([{ value: 1 }, { value: 2 }, { value: 3 }]);
  });

  it("takes the app lock before deleting, in the delete's own transaction", async () => {
    await stage("ada_mine", "ada@example.com");
    log.length = 0;

    await expect(
      deleteStagedDataset({
        id: "ada_mine",
        appId: APP,
        ownerEmail: "ada@example.com",
      }),
    ).resolves.toBe(true);

    const lock = indexOf(/pg_advisory_xact_lock/);
    const dropMeta = indexOf(/DELETE FROM staged_datasets WHERE id/);
    const dropRows = indexOf(/DELETE FROM staged_dataset_rows/);
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(dropMeta);
    expect(dropMeta).toBeLessThan(dropRows);
    expect(log[lock]?.tx).toBeTypeOf("number");
    expect(log[dropMeta]?.tx).toBe(log[lock]?.tx);
    expect(log[dropRows]?.tx).toBe(log[lock]?.tx);
    expect(await liveIds()).toEqual([]);
    expect(await rowCount("ada_mine")).toBe(0);
  });
});
