import { isSigningOut } from "@agent-native/core/client/hooks";

import {
  dashboardCacheScope,
  type DashboardCacheSession,
} from "./prefetch-keys";
import {
  clearSqlQuerySnapshots,
  readSqlQuerySnapshot,
  removeSqlQuerySnapshot,
  writeSqlQuerySnapshot,
  type SqlQuerySnapshotClear,
  type SqlQuerySnapshotInput,
  type SqlQuerySnapshotRead,
  type SqlQuerySnapshotWrite,
} from "./sql-query-cache";

/**
 * Ties the saved SQL results to the signed-in account.
 *
 * The scope is module state rather than a hook ref because a late result can
 * land after the component that asked for it is gone: sign-out unmounts the
 * whole app shell, and a ref in an unmounted component would still hold the
 * old scope. `undefined` means nothing has bound a scope yet and `null` means
 * the session ended; both refuse writes.
 */
let boundScope: string | null | undefined;

export type SqlQuerySnapshotSessionStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "unavailable"
  | "signing-out";

/**
 * Called from a component mounted outside the session gate, since the gate
 * unmounts everything under it before a sign-out reaches an effect there.
 * Loading and unavailable are transient and change nothing, so a reload keeps
 * the saved results it is about to restore.
 */
export function syncSqlQuerySnapshotsToSession(input: {
  status: SqlQuerySnapshotSessionStatus;
  session: DashboardCacheSession | null;
}): SqlQuerySnapshotClear | undefined {
  if (input.status === "authenticated" && input.session) {
    const accountScope = dashboardCacheScope(input.session);
    boundScope = accountScope;
    return warnIfNotCleared(
      clearSqlQuerySnapshots({ exceptAccountScope: accountScope }),
    );
  }
  if (input.status === "unauthenticated" || input.status === "signing-out") {
    boundScope = null;
    return warnIfNotCleared(clearSqlQuerySnapshots());
  }
  return undefined;
}

/** Whether a result fetched for `accountScope` may still be saved. */
export function canWriteSqlQuerySnapshot(accountScope: string): boolean {
  return boundScope === accountScope && !isSigningOut();
}

export function readSqlQuerySnapshotForSession(options: {
  accountScope: string;
  queryKey: string;
}): SqlQuerySnapshotRead {
  const read = readSqlQuerySnapshot(options);
  if (read.status === "unavailable") {
    console.warn("[sql-query] saved results unavailable", {
      reason: read.reason,
      errorName: read.errorName,
    });
  } else if (read.status === "miss" && isUnexpectedMiss(read.reason)) {
    console.warn("[sql-query] dropped an unusable saved result", {
      reason: read.reason,
    });
  }
  return read;
}

export function removeSqlQuerySnapshotForSession(options: {
  accountScope: string;
  queryKey: string;
}): SqlQuerySnapshotClear {
  return warnIfNotCleared(removeSqlQuerySnapshot(options));
}

export function writeSqlQuerySnapshotForSession(options: {
  accountScope: string;
  queryKey: string;
  result: SqlQuerySnapshotInput;
  /** A query cancelled after its result arrived must not save it. */
  signal?: AbortSignal;
}): SqlQuerySnapshotWrite | { status: "skipped"; reason: "session-changed" } {
  if (
    options.signal?.aborted ||
    !canWriteSqlQuerySnapshot(options.accountScope)
  ) {
    return { status: "skipped", reason: "session-changed" };
  }
  const write = writeSqlQuerySnapshot({
    accountScope: options.accountScope,
    queryKey: options.queryKey,
    result: options.result,
  });
  if (write.status === "unavailable") {
    console.warn("[sql-query] could not save the result", {
      reason: write.reason,
      errorName: write.errorName,
    });
  } else if (
    write.status === "skipped" &&
    (write.reason === "invalid-result" || write.reason === "invalid-fetched-at")
  ) {
    console.warn("[sql-query] result not saved", { reason: write.reason });
  }
  return write;
}

/** Absent, expired and another account's copy are ordinary; the rest are not. */
function isUnexpectedMiss(reason: string): boolean {
  return (
    reason === "corrupt" ||
    reason === "oversized" ||
    reason === "truncated" ||
    reason === "unsupported-version"
  );
}

function warnIfNotCleared(clear: SqlQuerySnapshotClear): SqlQuerySnapshotClear {
  if (clear.status === "unavailable") {
    console.warn("[sql-query] could not clear saved results", {
      reason: clear.reason,
      errorName: clear.errorName,
    });
  }
  return clear;
}

/** @internal test seam: forgets the bound scope between tests. */
export function resetSqlQuerySnapshotSessionForTests(): void {
  boundScope = undefined;
}
