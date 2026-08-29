/**
 * Header used by synthetic browser checks to keep their telemetry out of
 * production analytics. The value is intentionally explicit so an arbitrary
 * caller cannot suppress events by sending a truthy header.
 */
export const SYNTHETIC_TRAFFIC_HEADER = "X-Agent-Native-Test-Traffic";
export const SYNTHETIC_TRAFFIC_BETA_E2E = "beta-e2e";

export function isSyntheticTrafficValue(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.trim().toLowerCase() === SYNTHETIC_TRAFFIC_BETA_E2E
  );
}
