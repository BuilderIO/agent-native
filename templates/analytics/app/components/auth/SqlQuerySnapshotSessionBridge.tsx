import { useSession } from "@agent-native/core/client/hooks";
import { useEffect } from "react";

import { dashboardCacheScope } from "@/lib/prefetch-keys";
import { syncSqlQuerySnapshotsToSession } from "@/lib/sql-query-snapshot-session";

/**
 * Keeps saved SQL results tied to the signed-in account. Mount it outside
 * `RequireSession`: that gate unmounts everything under it as soon as a
 * sign-out begins, so a cleanup effect inside it never sees the new status.
 * Unmounting this component clears nothing, which is what lets a reload or an
 * ordinary navigation keep the results it is about to restore.
 */
export function SqlQuerySnapshotSessionBridge() {
  const { session, status } = useSession();
  const scope = session ? dashboardCacheScope(session) : null;

  useEffect(() => {
    syncSqlQuerySnapshotsToSession({ status, session });
    // `scope` stands for the account: the session object changes identity on
    // every re-read without changing who is signed in.
  }, [status, scope]);

  return null;
}
