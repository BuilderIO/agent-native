import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

type Column = { table: string; field: string };
type Clause =
  | { kind: "and" | "or"; conditions: Clause[] }
  | { kind: "eq" | "ne"; column: Column; value: unknown }
  | { kind: "inArray"; column: Column; values: unknown[] }
  | { kind: "isNull"; column: Column };
type DbRow = Record<string, unknown>;
type Operation =
  | { kind: "insert"; table: string; values: DbRow[] }
  | {
      kind: "update";
      table: string;
      values: DbRow;
      where: Clause | undefined;
    }
  | { kind: "delete"; table: string; where: Clause | undefined };

const mocks = vi.hoisted(() => {
  const column = (table: string, field: string): Column => ({ table, field });
  const columns = {
    uploadedAssets: {
      name: "uploaded_assets",
      id: column("uploaded_assets", "id"),
      url: column("uploaded_assets", "url"),
      provider: column("uploaded_assets", "provider"),
      providerObjectId: column("uploaded_assets", "provider_object_id"),
    },
    uploadedAssetObjectLifecycle: {
      name: "uploaded_asset_object_lifecycle",
      identityKey: column("uploaded_asset_object_lifecycle", "identityKey"),
      state: column("uploaded_asset_object_lifecycle", "state"),
      deletionLeaseToken: column(
        "uploaded_asset_object_lifecycle",
        "deletionLeaseToken",
      ),
      deletionLeaseExpiresAt: column(
        "uploaded_asset_object_lifecycle",
        "deletionLeaseExpiresAt",
      ),
      updatedAt: column("uploaded_asset_object_lifecycle", "updated_at"),
    },
    uploadedAssetCleanupOutbox: {
      name: "uploaded_asset_cleanup_outbox",
      id: column("uploaded_asset_cleanup_outbox", "id"),
      ownerEmail: column("uploaded_asset_cleanup_outbox", "owner_email"),
      orgId: column("uploaded_asset_cleanup_outbox", "org_id"),
      state: column("uploaded_asset_cleanup_outbox", "state"),
      leaseToken: column("uploaded_asset_cleanup_outbox", "lease_token"),
      leaseExpiresAt: column(
        "uploaded_asset_cleanup_outbox",
        "lease_expires_at",
      ),
    },
  };
  return {
    columns,
    tables: {
      uploaded_assets: [] as DbRow[],
      uploaded_asset_object_lifecycle: [] as DbRow[],
      uploaded_asset_cleanup_outbox: [] as DbRow[],
    },
    lockWaiters: 0,
    getDb: vi.fn(),
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...conditions: Clause[]): Clause => ({ kind: "and", conditions }),
  eq: (column: Column, value: unknown): Clause => ({
    kind: "eq",
    column,
    value,
  }),
  inArray: (column: Column, values: unknown[]): Clause => ({
    kind: "inArray",
    column,
    values,
  }),
  isNull: (column: Column): Clause => ({ kind: "isNull", column }),
  ne: (column: Column, value: unknown): Clause => ({
    kind: "ne",
    column,
    value,
  }),
  or: (...conditions: Clause[]): Clause => ({ kind: "or", conditions }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings: [...strings],
    values,
  }),
}));

vi.mock("../db/index.js", () => ({
  getDb: () => mocks.getDb(),
  schema: mocks.columns,
}));

function matches(clause: Clause | undefined, row: DbRow): boolean {
  if (!clause) return true;
  switch (clause.kind) {
    case "and":
      return clause.conditions.every((condition) => matches(condition, row));
    case "or":
      return clause.conditions.some((condition) => matches(condition, row));
    case "eq":
      return row[clause.column.field] === clause.value;
    case "ne":
      return row[clause.column.field] !== clause.value;
    case "inArray":
      return clause.values.includes(row[clause.column.field]);
    case "isNull":
      return row[clause.column.field] == null;
  }
}

function project(row: DbRow, selection: Record<string, Column>): DbRow {
  return Object.fromEntries(
    Object.entries(selection).map(([key, value]) => [key, row[value.field]]),
  );
}

function createFakeDb() {
  let transactionId = 0;
  const lockOwners = new Map<
    string,
    {
      owner: number | null;
      waiters: Array<{ owner: number; resume: () => void }>;
    }
  >();

  async function acquire(key: string, owner: number): Promise<void> {
    let lock = lockOwners.get(key);
    if (!lock) {
      lock = { owner: null, waiters: [] };
      lockOwners.set(key, lock);
    }
    if (lock.owner === null || lock.owner === owner) {
      lock.owner = owner;
      return;
    }
    mocks.lockWaiters += 1;
    await new Promise<void>((resolve) => {
      lock!.waiters.push({ owner, resume: resolve });
    });
  }

  function release(key: string, owner: number): void {
    const lock = lockOwners.get(key);
    if (!lock || lock.owner !== owner) return;
    const next = lock.waiters.shift();
    if (next) {
      lock.owner = next.owner;
      next.resume();
    } else {
      lock.owner = null;
    }
  }

  function primaryKey(table: string): string {
    return table === "uploaded_asset_object_lifecycle" ? "identityKey" : "id";
  }

  function commitOperation(operation: Operation): void {
    const rows = mocks.tables[operation.table as keyof typeof mocks.tables];
    if (operation.kind === "insert") {
      for (const value of operation.values) {
        if (
          rows.some(
            (row) =>
              row[primaryKey(operation.table)] ===
              value[primaryKey(operation.table)],
          )
        ) {
          continue;
        }
        rows.push({ ...value });
      }
      return;
    }
    if (operation.kind === "update") {
      for (const row of rows) {
        if (matches(operation.where, row)) Object.assign(row, operation.values);
      }
      return;
    }
    mocks.tables[operation.table as keyof typeof mocks.tables] = rows.filter(
      (row) => !matches(operation.where, row),
    );
  }

  const db = {
    transaction: async <T>(
      run: (transaction: any) => Promise<T>,
    ): Promise<T> => {
      const id = ++transactionId;
      const heldLocks = new Set<string>();
      const operations: Operation[] = [];
      const tableRows = (table: string): DbRow[] => {
        let rows = mocks.tables[table as keyof typeof mocks.tables].map(
          (row) => ({ ...row }),
        );
        for (const operation of operations) {
          if (operation.table !== table) continue;
          if (operation.kind === "insert") {
            rows = [...rows, ...operation.values.map((row) => ({ ...row }))];
          } else if (operation.kind === "update") {
            rows = rows.map((row) =>
              matches(operation.where, row)
                ? { ...row, ...operation.values }
                : row,
            );
          } else {
            rows = rows.filter((row) => !matches(operation.where, row));
          }
        }
        return rows;
      };

      const transaction = {
        execute: async (query: { values?: unknown[] }) => {
          const key = String(query.values?.[0] ?? "");
          await acquire(key, id);
          heldLocks.add(key);
        },
        select: (selection: Record<string, Column>) => {
          let table = "";
          let where: Clause | undefined;
          let limit: number | undefined;
          const builder = {
            from: (target: { name: string }) => {
              table = target.name;
              return builder;
            },
            where: (condition: Clause) => {
              where = condition;
              return builder;
            },
            for: () => builder,
            limit: (count: number) => {
              limit = count;
              return Promise.resolve(read());
            },
            then: (
              resolve: (value: DbRow[]) => unknown,
              reject: (error: unknown) => unknown,
            ) => Promise.resolve(read()).then(resolve, reject),
          };
          const read = () => {
            const rows = tableRows(table)
              .filter((row) => matches(where, row))
              .map((row) => project(row, selection));
            return limit === undefined ? rows : rows.slice(0, limit);
          };
          return builder;
        },
        insert: (target: { name: string }) => {
          const builder = {
            values: (values: DbRow | DbRow[]) => {
              operations.push({
                kind: "insert",
                table: target.name,
                values: Array.isArray(values) ? values : [values],
              });
              return builder;
            },
            onConflictDoNothing: () => builder,
            then: (
              resolve: (value: undefined) => unknown,
              reject: (error: unknown) => unknown,
            ) => Promise.resolve(undefined).then(resolve, reject),
          };
          return builder;
        },
        update: (target: { name: string }) => ({
          set: (values: DbRow) => {
            let where: Clause | undefined;
            const builder = {
              where: (condition: Clause) => {
                where = condition;
                operations.push({
                  kind: "update",
                  table: target.name,
                  values,
                  where,
                });
                return builder;
              },
              then: (
                resolve: (value: undefined) => unknown,
                reject: (error: unknown) => unknown,
              ) => Promise.resolve(undefined).then(resolve, reject),
            };
            return builder;
          },
        }),
      };

      try {
        const result = await run(transaction);
        for (const operation of operations) commitOperation(operation);
        return result;
      } finally {
        for (const key of heldLocks) release(key, id);
      }
    },
  };
  return db;
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for the asset identity lock.");
}

import {
  deleteUploadedAssetObject,
  lockUploadedAssetObjectIdentities,
  registerUploadedAssetObjectIdentities,
} from "./uploaded-asset-object-lifecycle.js";

const identity = {
  url: "https://storage.example.test/shared-image.png?signature=caseSensitive",
  provider: "storage",
  providerObjectId: "folder/object-1",
};

function asset(id: string) {
  return {
    id,
    url: identity.url,
    provider: identity.provider,
    provider_object_id: identity.providerObjectId,
  };
}

describe("uploaded asset object lifecycle locking", () => {
  beforeEach(() => {
    for (const rows of Object.values(mocks.tables)) rows.length = 0;
    mocks.lockWaiters = 0;
    mocks.getDb.mockReturnValue(createFakeDb());
  });

  it("releases the object lock during provider deletion while blocking alias attachment", async () => {
    mocks.tables.uploaded_assets.push(asset("asset-being-deleted"));
    const deleteStarted = deferred();
    const releaseDelete = deferred();

    const deletion = deleteUploadedAssetObject({
      identity,
      excludeAssetId: "asset-being-deleted",
      deleteObject: async () => {
        deleteStarted.resolve();
        await releaseDelete.promise;
        return true;
      },
    });
    await deleteStarted.promise;

    const alias = mocks.getDb()!.transaction(async (transaction: any) => {
      await registerUploadedAssetObjectIdentities(transaction, [identity]);
      await transaction
        .insert(mocks.columns.uploadedAssets)
        .values(asset("alias"));
    });
    const aliasOutcome = alias.then(
      () => "resolved" as const,
      () => "rejected" as const,
    );

    const outcomeBeforeProviderReturns = await Promise.race([
      aliasOutcome,
      new Promise<"pending">((resolve) =>
        setTimeout(() => resolve("pending"), 25),
      ),
    ]);
    releaseDelete.resolve();

    await expect(deletion).resolves.toEqual({ status: "deleted" });
    expect(outcomeBeforeProviderReturns).toBe("rejected");
    expect(mocks.lockWaiters).toBe(0);
    await expect(alias).rejects.toThrow("being deleted or was already deleted");
    expect(mocks.tables.uploaded_assets.map((row) => row.id)).toEqual([
      "asset-being-deleted",
    ]);
    expect(mocks.tables.uploaded_asset_object_lifecycle).toEqual(
      expect.arrayContaining([expect.objectContaining({ state: "deleted" })]),
    );
  });

  it("does not start a second provider delete while an object claim is active", async () => {
    const deleteStarted = deferred();
    const releaseDelete = deferred();
    const providerDelete = vi.fn(async () => {
      deleteStarted.resolve();
      await releaseDelete.promise;
      return true;
    });
    const duplicateProviderDelete = vi.fn(async () => true);

    const deletion = deleteUploadedAssetObject({
      identity,
      deleteObject: providerDelete,
    });
    await deleteStarted.promise;

    await expect(
      deleteUploadedAssetObject({
        identity,
        deleteObject: duplicateProviderDelete,
      }),
    ).resolves.toMatchObject({ status: "failed" });
    expect(providerDelete).toHaveBeenCalledOnce();
    expect(duplicateProviderDelete).not.toHaveBeenCalled();

    releaseDelete.resolve();
    await expect(deletion).resolves.toEqual({ status: "deleted" });
  });

  it("keeps a no-lease cleanup retryable when another worker takes over an expired claim", async () => {
    const firstDeleteStarted = deferred();
    const releaseFirstDelete = deferred();
    const secondDeleteStarted = deferred();
    const releaseSecondDelete = deferred();
    const firstProviderDelete = vi.fn(async () => {
      firstDeleteStarted.resolve();
      await releaseFirstDelete.promise;
      return true;
    });
    const secondProviderDelete = vi.fn(async () => {
      secondDeleteStarted.resolve();
      await releaseSecondDelete.promise;
      return true;
    });

    const firstDeletion = deleteUploadedAssetObject({
      identity,
      deleteObject: firstProviderDelete,
    });
    await firstDeleteStarted.promise;
    for (const row of mocks.tables.uploaded_asset_object_lifecycle) {
      row.deletionLeaseExpiresAt = "1970-01-01T00:00:00.000Z";
    }

    const secondDeletion = deleteUploadedAssetObject({
      identity,
      deleteObject: secondProviderDelete,
    });
    await secondDeleteStarted.promise;
    releaseFirstDelete.resolve();

    await expect(firstDeletion).resolves.toMatchObject({ status: "failed" });
    expect(firstProviderDelete).toHaveBeenCalledOnce();
    expect(secondProviderDelete).toHaveBeenCalledOnce();

    releaseSecondDelete.resolve();
    await expect(secondDeletion).resolves.toEqual({ status: "deleted" });
  });

  it("waits for a committing alias and skips provider deletion when it wins the lock", async () => {
    mocks.tables.uploaded_assets.push(asset("asset-being-deleted"));
    const aliasInserted = deferred();
    const releaseAlias = deferred();
    const providerDelete = vi.fn(async () => true);

    const alias = mocks.getDb()!.transaction(async (transaction: any) => {
      await registerUploadedAssetObjectIdentities(transaction, [identity]);
      await transaction
        .insert(mocks.columns.uploadedAssets)
        .values(asset("alias"));
      aliasInserted.resolve();
      await releaseAlias.promise;
    });
    await aliasInserted.promise;

    const deletion = deleteUploadedAssetObject({
      identity,
      excludeAssetId: "asset-being-deleted",
      deleteObject: providerDelete,
    });
    await waitFor(() => mocks.lockWaiters > 0);
    expect(providerDelete).not.toHaveBeenCalled();

    releaseAlias.resolve();
    await alias;
    await expect(deletion).resolves.toEqual({ status: "shared" });
    expect(providerDelete).not.toHaveBeenCalled();
    expect(mocks.tables.uploaded_assets.map((row) => row.id).sort()).toEqual([
      "alias",
      "asset-being-deleted",
    ]);
  });

  it("checks the cleanup lease before calling the provider", async () => {
    mocks.tables.uploaded_asset_cleanup_outbox.push({
      id: "asset-being-deleted",
      owner_email: "owner@example.com",
      org_id: null,
      state: "deleting",
      lease_token: "stale-token",
      lease_expires_at: "1970-01-01T00:00:00.000Z",
    });
    const providerDelete = vi.fn(async () => true);

    await expect(
      deleteUploadedAssetObject({
        identity,
        excludeAssetId: "asset-being-deleted",
        lease: {
          assetId: "asset-being-deleted",
          ownerEmail: "owner@example.com",
          orgId: null,
          token: "stale-token",
        },
        deleteObject: providerDelete,
      }),
    ).resolves.toEqual({ status: "stale" });

    expect(providerDelete).not.toHaveBeenCalled();
  });

  it("rejects a replaced cleanup lease after waiting for the object lock", async () => {
    const leaseExpiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    mocks.tables.uploaded_asset_cleanup_outbox.push({
      id: "asset-being-deleted",
      owner_email: "owner@example.com",
      org_id: null,
      state: "deleting",
      lease_token: "old-token",
      lease_expires_at: leaseExpiresAt,
    });
    const lockStarted = deferred();
    const releaseLock = deferred();
    const providerDelete = vi.fn(async () => true);
    const holder = mocks.getDb()!.transaction(async (transaction: any) => {
      await lockUploadedAssetObjectIdentities(transaction, [identity]);
      lockStarted.resolve();
      await releaseLock.promise;
    });
    await lockStarted.promise;

    const deletion = deleteUploadedAssetObject({
      identity,
      excludeAssetId: "asset-being-deleted",
      lease: {
        assetId: "asset-being-deleted",
        ownerEmail: "owner@example.com",
        orgId: null,
        token: "old-token",
      },
      deleteObject: providerDelete,
    });
    await waitFor(() => mocks.lockWaiters > 0);
    mocks.tables.uploaded_asset_cleanup_outbox[0]!.lease_token =
      "replacement-token";
    mocks.tables.uploaded_asset_cleanup_outbox[0]!.lease_expires_at = new Date(
      Date.now() + 10 * 60_000,
    ).toISOString();
    releaseLock.resolve();
    await holder;

    await expect(deletion).resolves.toEqual({ status: "stale" });
    expect(providerDelete).not.toHaveBeenCalled();
  });

  it("keeps failed provider deletion retryable while blocking new aliases", async () => {
    mocks.tables.uploaded_assets.push(asset("asset-being-deleted"));
    const providerDelete = vi
      .fn(async () => true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(
      deleteUploadedAssetObject({
        identity,
        excludeAssetId: "asset-being-deleted",
        deleteObject: providerDelete,
      }),
    ).resolves.toMatchObject({ status: "failed" });
    expect(mocks.tables.uploaded_asset_object_lifecycle).toEqual(
      expect.arrayContaining([expect.objectContaining({ state: "deleting" })]),
    );
    expect(
      mocks.tables.uploaded_asset_object_lifecycle.every(
        (row) => Date.parse(String(row.deletionLeaseExpiresAt)) <= Date.now(),
      ),
    ).toBe(true);
    await expect(
      mocks.getDb()!.transaction(async (transaction: any) => {
        await registerUploadedAssetObjectIdentities(transaction, [identity]);
        await transaction
          .insert(mocks.columns.uploadedAssets)
          .values(asset("alias"));
      }),
    ).rejects.toThrow("being deleted or was already deleted");

    await expect(
      deleteUploadedAssetObject({
        identity,
        excludeAssetId: "asset-being-deleted",
        deleteObject: providerDelete,
      }),
    ).resolves.toEqual({ status: "deleted" });
    expect(providerDelete).toHaveBeenCalledTimes(2);
    expect(mocks.tables.uploaded_assets.map((row) => row.id)).toEqual([
      "asset-being-deleted",
    ]);
  });

  it("takes over an expired claim after a crash and finalizes an idempotent delete", async () => {
    const identityKeys = [
      JSON.stringify(["url", identity.url]),
      JSON.stringify([
        "provider",
        identity.provider,
        identity.providerObjectId,
      ]),
    ]
      .map((alias) => createHash("sha256").update(alias).digest("hex"))
      .sort();
    mocks.tables.uploaded_asset_object_lifecycle.push(
      ...identityKeys.map((identityKey) => ({
        identityKey,
        state: "deleting",
        deletionLeaseToken: "expired-claim",
        deletionLeaseExpiresAt: "1970-01-01T00:00:00.000Z",
        updated_at: "1970-01-01T00:00:00.000Z",
      })),
    );
    const providerDelete = vi.fn(async () => true);

    await expect(
      deleteUploadedAssetObject({
        identity,
        deleteObject: providerDelete,
      }),
    ).resolves.toEqual({ status: "deleted" });

    expect(providerDelete).toHaveBeenCalledOnce();
    expect(
      mocks.tables.uploaded_asset_object_lifecycle.every(
        (row) =>
          row.state === "deleted" &&
          row.deletionLeaseToken === null &&
          row.deletionLeaseExpiresAt === null,
      ),
    ).toBe(true);
  });

  it("keeps the deleted tombstone when cleanup callback fails and finishes on retry", async () => {
    mocks.tables.uploaded_assets.push(asset("asset-being-deleted"));
    mocks.tables.uploaded_asset_cleanup_outbox.push({
      id: "asset-being-deleted",
      owner_email: "owner@example.com",
      org_id: null,
      state: "deleting",
      lease_token: "cleanup-token",
      lease_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    const lease = {
      assetId: "asset-being-deleted",
      ownerEmail: "owner@example.com",
      orgId: null,
      token: "cleanup-token",
    };
    const providerDelete = vi.fn(async () => true);
    const finishCleanup = vi
      .fn(async () => undefined)
      .mockRejectedValueOnce(new Error("cleanup transaction failed"));

    await expect(
      deleteUploadedAssetObject({
        identity,
        excludeAssetId: "asset-being-deleted",
        lease,
        deleteObject: providerDelete,
        onDeleted: finishCleanup,
        onAlreadyDeleted: finishCleanup,
      }),
    ).resolves.toMatchObject({ status: "failed" });

    expect(providerDelete).toHaveBeenCalledOnce();
    expect(finishCleanup).toHaveBeenCalledOnce();
    expect(
      mocks.tables.uploaded_asset_object_lifecycle.every(
        (row) => row.state === "deleted",
      ),
    ).toBe(true);
    await expect(
      mocks.getDb()!.transaction(async (transaction: any) => {
        await registerUploadedAssetObjectIdentities(transaction, [identity]);
        await transaction
          .insert(mocks.columns.uploadedAssets)
          .values(asset("alias"));
      }),
    ).rejects.toThrow("being deleted or was already deleted");

    await expect(
      deleteUploadedAssetObject({
        identity,
        excludeAssetId: "asset-being-deleted",
        lease,
        deleteObject: providerDelete,
        onDeleted: finishCleanup,
        onAlreadyDeleted: finishCleanup,
      }),
    ).resolves.toEqual({ status: "already-deleted" });

    expect(providerDelete).toHaveBeenCalledOnce();
    expect(finishCleanup).toHaveBeenCalledTimes(2);
  });
});
