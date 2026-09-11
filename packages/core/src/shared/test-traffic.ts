/**
 * Header used by synthetic browser checks to keep their telemetry out of
 * production analytics. The exact value avoids accidental suppression from
 * unrelated truthy headers; it is an operational marker, not a credential.
 */
export const SYNTHETIC_TRAFFIC_HEADER = "X-Agent-Native-Test-Traffic";
export const SYNTHETIC_TRAFFIC_BETA_E2E = "beta-e2e";

export function isSyntheticTrafficValue(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.trim().toLowerCase() === SYNTHETIC_TRAFFIC_BETA_E2E
  );
}
