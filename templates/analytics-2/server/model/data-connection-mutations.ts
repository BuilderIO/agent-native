import { getDbExec, withDbExec, type DbExec } from "@agent-native/core/db";
import {
  mutateOrgSetting,
  mutateUserSetting,
  getUserSetting,
  type StoreMutationOptions,
} from "@agent-native/core/settings";

import { afterDataCommit } from "./data-change-events.js";
import {
  type MetadataStoreOptions,
  beginConnectionDeletion,
  deleteConnectionAnnotationSettings,
  finishConnectionDeletion,
} from "./data-resource-metadata.js";
import type { WorkspaceScope } from "./scope.js";

const GUARD_PREFIX = "analytics.data.connection-guard:v1";

function guardKey(connectionId: string): string {
  return `${GUARD_PREFIX}:${encodeURIComponent(connectionId)}`;
}

/**
 * App-owned per-organisation/connection write guard.
 *
 * The compare-and-set update always changes the counter, so the settings row is
 * locked until the surrounding transaction commits. Every app save, annotation
 * write and deletion transition joins this guard; the epoch is app coordination
 * evidence, not an expiring lease. It cannot fence an external writer that
 * never takes the guard, which remains a named limitation.
 */
export async function acquireConnectionGuard(
  scope: WorkspaceScope,
  connectionId: string,
  transaction: DbExec,
): Promise<number> {
  const options: StoreMutationOptions = { transaction };
  const next = await mutateOrgSetting(
    scope.orgId,
    guardKey(connectionId),
    (current) => ({
      epoch:
        typeof current?.epoch === "number" &&
        Number.isSafeInteger(current.epoch)
          ? current.epoch + 1
          : 1,
      touchedAt: new Date().toISOString(),
    }),
    options,
  );
  return typeof next.epoch === "number" ? next.epoch : 1;
}

/** Runs the callback inside a plain app DB transaction (no org namespace). */
export async function withDbTransaction<T>(
  run: (transaction: DbExec) => Promise<T>,
): Promise<T> {
  const exec = getDbExec();
  if (!exec.transaction)
    throw new Error(
      "This runtime has no interactive transaction support for the connection save.",
    );
  return afterDataCommit(() =>
    exec.transaction!((tx) => withDbExec(tx, () => run(tx))),
  );
}

/** Runs the callback inside a transaction that holds the connection guard. */
export async function withConnectionGuard<T>(
  scope: WorkspaceScope,
  connectionId: string,
  run: (transaction: DbExec) => Promise<T>,
  transaction?: DbExec,
): Promise<T> {
  const body = async (tx: DbExec): Promise<T> => {
    await acquireConnectionGuard(scope, connectionId, tx);
    return run(tx);
  };
  if (transaction) return withDbExec(transaction, () => body(transaction));
  const exec = getDbExec();
  if (!exec.transaction)
    throw new Error(
      "This runtime has no interactive transaction support for the connection write guard.",
    );
  return afterDataCommit(() =>
    exec.transaction!((tx) => withDbExec(tx, () => body(tx))),
  );
}

export function metadataOptions(transaction: DbExec): MetadataStoreOptions {
  return { transaction, bypassCache: true };
}

/** Phase 1 of deletion: terminal tombstone plus exact annotation cleanup. */
export async function beginConnectionDeletionPhases(
  scope: WorkspaceScope,
  connectionId: string,
  transaction?: DbExec,
): Promise<{ deleted: number }> {
  return withConnectionGuard(
    scope,
    connectionId,
    async (tx) => {
      await beginConnectionDeletion(scope, connectionId, {
        transaction: tx,
      });
      const removed = await deleteConnectionAnnotationSettings(
        scope,
        connectionId,
        { transaction: tx },
      );
      // Loaded only for this lifecycle phase: avoids an initialization cycle
      // between the catalog's source reader and the connection coordinator.
      const { clearDataBrowserCatalog } =
        await import("./data-browser-catalog.js");
      await clearDataBrowserCatalog(scope, connectionId, { transaction: tx });
      return removed;
    },
    transaction,
  );
}

/** Final phase: keep the completed tombstone as coordination evidence. */
export async function finishConnectionDeletionPhases(
  scope: WorkspaceScope,
  connectionId: string,
  transaction?: DbExec,
): Promise<void> {
  await withConnectionGuard(
    scope,
    connectionId,
    async (tx) => {
      await finishConnectionDeletion(scope, connectionId, { transaction: tx });
    },
    transaction,
  );
}

/** Personal rows share a user-scoped guard, never a synthetic organization. */
export async function withPersonalConnectionGuard<T>(
  userEmail: string,
  connectionId: string,
  run: (transaction: DbExec) => Promise<T>,
  transaction?: DbExec,
): Promise<T> {
  const body = async (tx: DbExec) => {
    await mutateUserSetting(
      userEmail,
      guardKey(connectionId),
      (current) => ({
        epoch:
          typeof current?.epoch === "number" &&
          Number.isSafeInteger(current.epoch)
            ? current.epoch + 1
            : 1,
      }),
      { transaction: tx },
    );
    return run(tx);
  };
  if (transaction) return withDbExec(transaction, () => body(transaction));
  // Public reads initialize the settings store before a first transactional write.
  await getUserSetting(userEmail, guardKey(connectionId), {
    bypassCache: true,
  });
  return withDbTransaction(body);
}
