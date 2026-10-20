import { isActionContractError } from "@agent-native/core/action";

import { removeDashboard } from "../dashboards-store.js";
import {
  failExternalDashboard,
  listExternalDashboards,
  type ExternalDashboardFailureCode,
} from "./external-dashboards-store.js";

/**
 * Record a Sigma import that did not finish, and delete the dashboard it wrote
 * when that dashboard would otherwise be left behind. Only a first import's
 * dashboard is deleted. When the claimed record already had a dashboard (a
 * re-import, a recovery, or a retry of either), this run wrote over the
 * migrator's own dashboard, which the mapping row still tracks.
 *
 * Dashboard ids include the importer's email. So when another person has
 * taken over the claim, this run's dashboard is never theirs and is deleted;
 * when the same person took it over, the id is shared and is kept.
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
  let claimLost: unknown = null;
  try {
    await failExternalDashboard({
      provider: "sigma",
      sourceId: input.workbookId,
      claimToken: input.claimToken,
      failureCode: input.failureCode,
      preservePreviousMigration: !input.wroteDashboard,
    });
  } catch (error) {
    if (
      !isActionContractError(error) ||
      error.errorCode !== "migration_claim_expired"
    ) {
      throw error;
    }
    claimLost = error;
  }

  if (input.wroteDashboard && input.previousDashboardId === null) {
    let orphaned = true;
    if (claimLost) {
      const [migration] = await listExternalDashboards({
        provider: "sigma",
        sourceIds: [input.workbookId],
        limit: 1,
      });
      orphaned = !migration?.migratedByCurrentUser;
    }
    if (orphaned) await removeDashboard(input.dashboardId, input.ctx);
  }

  if (claimLost) throw claimLost;
}
