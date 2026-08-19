function productionEnvironmentHost(hostname: string): string | null {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  const productionHost = normalized.replace(/^beta\./, "");
  if (
    productionHost.endsWith(".agent-native.com") ||
    productionHost === "agent-workspace.builder.io"
  ) {
    return productionHost;
  }
  return null;
}

function isEnvironmentLaneHost(hostname: string, productionHost: string) {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  return (
    normalized === productionHost || normalized === `beta.${productionHost}`
  );
}

/**
 * Keep the internal beta/prod switch in the current Electron webview. The
 * host pair is intentionally exact so arbitrary cross-origin links still open
 * in the system browser.
 */
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
