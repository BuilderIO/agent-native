import { removeDashboard } from "../dashboards-store.js";
import {
  failExternalDashboard,
  holdExternalDashboardClaim,
  listExternalDashboards,
  type ExternalDashboardFailureCode,
} from "./external-dashboards-store.js";

/**
 * Record a Sigma import that did not finish, and delete the dashboard left at
 * its id when nothing would track it. Only a first import's dashboard is
 * deleted. When the claimed record already had a dashboard (a re-import, a
 * recovery, or a retry of either), the id belongs to the migrator's tracked
 * dashboard.
 *
 * The delete happens while this run still holds the claim. Dashboard ids
 * include the importer's email, so a same-user retry claimed after the
 * release would write the same id, and a later delete would remove it.
 *
 * Never throws: the caller rethrows the import's own error, and a row left
 * `migrating` by a failed release becomes claimable once the claim is stale.
 */
export async function abandonSigmaImport(input: {
  workbookId: string;
  claimToken: string;
  failureCode: ExternalDashboardFailureCode;
  dashboardId: string;
  wroteDashboard: boolean;
  /** The claimed record's targetDashboardId, not the request's flags. */
  previousDashboardId: string | null;
  ctx: { email: string; orgId: string };
}): Promise<void> {
  const claim = {
    provider: "sigma" as const,
    sourceId: input.workbookId,
    claimToken: input.claimToken,
  };
  const firstImport = input.previousDashboardId === null;
  try {
    if (await holdExternalDashboardClaim(claim)) {
      // An earlier run of a taken-over first import may have written this id
      // too, so delete it even when this run wrote nothing. A dashboard the
      // delete misses is overwritten or deleted by the next import of the id.
      if (firstImport) {
        await removeDashboard(input.dashboardId, input.ctx).catch((error) =>
          console.warn("Failed to delete an unfinished Sigma import", error),
        );
      }
      await failExternalDashboard({
        ...claim,
        failureCode: input.failureCode,
        preservePreviousMigration: !input.wroteDashboard,
      });
      return;
    }

    // Someone took over the claim. A teammate's run writes a different id,
    // so this run's dashboard is orphaned unless the same person took over.
    if (input.wroteDashboard && firstImport) {
      const [migration] = await listExternalDashboards({
        provider: "sigma",
        sourceIds: [input.workbookId],
        limit: 1,
      });
      if (!migration?.migratedByCurrentUser) {
        await removeDashboard(input.dashboardId, input.ctx);
      }
    }
  } catch (error) {
    console.warn("Failed to clean up an unfinished Sigma import", error);
  }
}
