// These three must stay ordered with headroom (DB timeout < action timeout <
// page-ready timeout) so the innermost layer's own, more specific error
// surfaces before an outer layer gives up for an unrelated reason.
export const FIRST_PARTY_ANALYTICS_QUERY_TIMEOUT_MS = 45_000;
export const DASHBOARD_REPORT_ACTION_TIMEOUT_MS = 50_000;
export const DASHBOARD_REPORT_READY_TIMEOUT_MS = 75_000;
