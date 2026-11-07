export const TRAFFIC_ENVIRONMENTS = ["production", "beta"] as const;
export type TrafficEnvironment = (typeof TRAFFIC_ENVIRONMENTS)[number];

// Beta, PR previews and local runs count together as not production. This runs
// in JavaScript and in Postgres, so keep it to syntax both read the same way.
export const NON_PRODUCTION_HOST_PATTERN =
  "^(beta\\.|localhost$|127\\.0\\.0\\.1$|0\\.0\\.0\\.0$|\\[::1\\]$)|(\\.localhost|\\.local|\\.test|\\.netlify\\.app)$";

const NON_PRODUCTION_HOST = new RegExp(NON_PRODUCTION_HOST_PATTERN, "i");

export function readTrafficEnvironment(
  value: string | null | undefined,
): TrafficEnvironment | undefined {
  return TRAFFIC_ENVIRONMENTS.find((environment) => environment === value);
}

/** The traffic a host belongs to, or null when no host was recorded. */
export function trafficEnvironmentOfHost(
  hostname: string | null | undefined,
): TrafficEnvironment | null {
  if (!hostname) return null;
  return NON_PRODUCTION_HOST.test(hostname) ? "beta" : "production";
}
