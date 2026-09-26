import { ENVIRONMENT_BETA_HOSTS } from "@agent-native/core/shared";

function productionEnvironmentHost(hostname: string): string | null {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  const productionHost = normalized.replace(/^beta\./, "");
  return ENVIRONMENT_BETA_HOSTS[
    productionHost as keyof typeof ENVIRONMENT_BETA_HOSTS
  ]
    ? productionHost
    : null;
}

function isEnvironmentLaneHost(hostname: string, productionHost: string) {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  return (
    normalized === productionHost || normalized === `beta.${productionHost}`
  );
}

export function resolveEnvironmentLaneOrigins(origin: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    // coercion-ok: malformed origins cannot identify a trusted environment lane.
    return [];
  }
  if (parsed.protocol !== "https:") return [];

  const normalizedHost = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const productionHost = productionEnvironmentHost(normalizedHost);
  if (!productionHost) return [];

  const betaHost =
    ENVIRONMENT_BETA_HOSTS[
      productionHost as keyof typeof ENVIRONMENT_BETA_HOSTS
    ];
  const alternate = new URL(parsed.origin);
  alternate.hostname =
    normalizedHost === productionHost ? betaHost : productionHost;
  return [alternate.origin];
}

export function isAllowedEnvironmentNavigation(
  current: URL,
  next: URL,
): boolean {
  if (current.protocol !== "https:" || next.protocol !== "https:") return false;
  if (current.port !== next.port || current.hostname === next.hostname) {
    return false;
  }

  const currentProductionHost = productionEnvironmentHost(current.hostname);
  const nextProductionHost = productionEnvironmentHost(next.hostname);
  return (
    currentProductionHost !== null &&
    currentProductionHost === nextProductionHost &&
    isEnvironmentLaneHost(current.hostname, currentProductionHost) &&
    isEnvironmentLaneHost(next.hostname, currentProductionHost)
  );
}
