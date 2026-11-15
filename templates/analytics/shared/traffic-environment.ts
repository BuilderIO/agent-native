export const TRAFFIC_ENVIRONMENTS = ["production", "beta"] as const;
export type TrafficEnvironment = (typeof TRAFFIC_ENVIRONMENTS)[number];

// Beta, PR previews and local runs count together as not production.
export const NON_PRODUCTION_HOSTS = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
];
export const NON_PRODUCTION_HOST_PREFIXES = ["beta."];
export const NON_PRODUCTION_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".test",
  ".netlify.app",
];

/**
 * A dashboard's traffic choice is an ordinary filter, so the address bar, saved
 * views and report filters keep it. It never appears in panel SQL: reads apply
 * it through the query scope.
 */
export const TRAFFIC_FILTER_ID = "traffic_environment";
export const TRAFFIC_FILTER_PARAM = `f_${TRAFFIC_FILTER_ID}`;
export const ALL_TRAFFIC = "all";

/** The traffic filter a new dashboard starts with. Older ones show all traffic. */
export function newDashboardTrafficFilter() {
  return {
    id: TRAFFIC_FILTER_ID,
    label: "Traffic",
    type: "select" as const,
    default: "production",
    options: [
      { value: ALL_TRAFFIC, label: "All traffic" },
      { value: "production", label: "Production" },
      { value: "beta", label: "Beta" },
    ],
  };
}

function filtersOf(config: { filters?: unknown }): unknown[] {
  return Array.isArray(config.filters) ? config.filters : [];
}

function trafficFilterOf(config: { filters?: unknown }): unknown {
  return filtersOf(config).find(
    (filter) =>
      typeof filter === "object" &&
      filter !== null &&
      "id" in filter &&
      filter.id === TRAFFIC_FILTER_ID,
  );
}

function withTrafficFilter<T extends { filters?: unknown }>(
  config: T,
  trafficFilter: unknown,
): T {
  return trafficFilterOf(config)
    ? config
    : { ...config, filters: [...filtersOf(config), trafficFilter] };
}

/** Adds the traffic filter to a dashboard being created, unless it chose one. */
export function withNewDashboardTrafficFilter<T extends { filters?: unknown }>(
  config: T,
): T {
  return withTrafficFilter(config, newDashboardTrafficFilter());
}

/** Carries a dashboard's traffic choice over a rebuild of its config. */
export function withTrafficFilterOf<T extends { filters?: unknown }>(
  previous: { filters?: unknown },
  config: T,
): T {
  const trafficFilter = trafficFilterOf(previous);
  return trafficFilter ? withTrafficFilter(config, trafficFilter) : config;
}

export function readTrafficEnvironment(
  value: string | null | undefined,
): TrafficEnvironment | undefined {
  return TRAFFIC_ENVIRONMENTS.find((environment) => environment === value);
}

/** True for a value the traffic filter offers: all traffic, production or beta. */
export function isTrafficFilterValue(value: string): boolean {
  return value === ALL_TRAFFIC || readTrafficEnvironment(value) !== undefined;
}

/**
 * The traffic a dashboard's traffic filter value reads, undefined for all
 * traffic or no choice. Throws on a value the filter doesn't offer, which
 * readTrafficEnvironment would read as all traffic.
 */
export function readTrafficFilterValue(
  value: string | undefined,
): TrafficEnvironment | undefined {
  if (!value || value === ALL_TRAFFIC) return undefined;
  const environment = readTrafficEnvironment(value);
  if (!environment) {
    throw new Error(
      `The traffic filter is ${JSON.stringify(value)}. Set ${TRAFFIC_FILTER_PARAM} to all, production or beta.`,
    );
  }
  return environment;
}

/** The traffic a host belongs to, or null when no host was recorded. */
export function trafficEnvironmentOfHost(
  hostname: string | null | undefined,
): TrafficEnvironment | null {
  if (!hostname) return null;
  const host = hostname.toLowerCase();
  return NON_PRODUCTION_HOSTS.includes(host) ||
    NON_PRODUCTION_HOST_PREFIXES.some((prefix) => host.startsWith(prefix)) ||
    NON_PRODUCTION_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
    ? "beta"
    : "production";
}
