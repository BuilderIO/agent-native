// The query timeout must stay below the per-panel report timeout so a slow
// query reports its own, more specific error instead of the report layer
// giving up first for an unrelated reason.
export const FIRST_PARTY_ANALYTICS_QUERY_TIMEOUT_MS = 45_000;
export const DASHBOARD_REPORT_ACTION_TIMEOUT_MS = 50_000;
/** A dashboard save must fail clearly if warehouse SQL validation stalls. */
export const DASHBOARD_SQL_VALIDATION_TIMEOUT_MS = 10_000;
