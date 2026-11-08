import {
  BUILTIN_DASHBOARD_HIDDEN_BY,
  builtinDashboardIdFor,
} from "../../shared/builtin-dashboard-ids.js";
import {
  builtinDashboardVisibility,
  loadBuiltinDashboard,
  type BuiltinDashboard,
} from "./builtin-dashboards.js";
import { getDashboard, type DashboardRecord } from "./dashboards-store.js";

interface Scope {
  email: string;
  orgId: string | null;
}

/** A dashboard a reader opens: their saved one, or the built-in it serves. */
export type OpenedDashboard =
  | { saved: DashboardRecord; builtin?: undefined }
  | { builtin: BuiltinDashboard; saved?: undefined };

/**
 * What a reader in `scope` opens at `id`, as `get-sql-dashboard` serves it:
 * a saved dashboard wins, except a copy the deploy pass hid, which serves its
 * built-in. Null when there is neither.
 */
export async function openDashboard(
  id: string,
  scope: Scope,
): Promise<OpenedDashboard | null> {
  const saved = await getDashboard(id, scope);
  if (saved && saved.hiddenBy !== BUILTIN_DASHBOARD_HIDDEN_BY) return { saved };
  const builtinId = builtinDashboardIdFor(id);
  const builtin = builtinId
    ? await loadBuiltinDashboard(builtinId, scope)
    : null;
  return builtin ? { builtin } : null;
}

/**
 * Who in the reader's organization can open `opened`: a saved dashboard's
 * sharing, or how its built-in was installed. Sharing with an organization
 * reaches only the dashboard's own, so another organization's dashboard,
 * opened by its owner or through a share, reads as private here.
 */
export async function openedDashboardVisibility(
  opened: OpenedDashboard,
  scope: Scope,
): Promise<DashboardRecord["visibility"]> {
  if (!opened.saved)
    return builtinDashboardVisibility(opened.builtin.id, scope);
  const { visibility, orgId } = opened.saved;
  return visibility === "org" && orgId !== scope.orgId ? "private" : visibility;
}
