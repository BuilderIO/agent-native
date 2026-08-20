const ENVIRONMENT_BETA_HOSTS = {
  "agent-workspace.builder.io": "beta.agent-workspace.builder.io",
  "analytics.agent-native.com": "beta.analytics.agent-native.com",
  "assets.agent-native.com": "beta.assets.agent-native.com",
  "brain.agent-native.com": "beta.brain.agent-native.com",
  "calendar.agent-native.com": "beta.calendar.agent-native.com",
  "chat.agent-native.com": "beta.chat.agent-native.com",
  "clips.agent-native.com": "beta.clips.agent-native.com",
  "content.agent-native.com": "beta.content.agent-native.com",
  "crm.agent-native.com": "beta.crm.agent-native.com",
  "design.agent-native.com": "beta.design.agent-native.com",
  "dispatch.agent-native.com": "beta.dispatch.agent-native.com",
  "factory.agent-native.com": "beta.factory.agent-native.com",
  "forms.agent-native.com": "beta.forms.agent-native.com",
  "macros.agent-native.com": "beta.macros.agent-native.com",
  "mail.agent-native.com": "beta.mail.agent-native.com",
  "plan.agent-native.com": "beta.plan.agent-native.com",
  "slides.agent-native.com": "beta.slides.agent-native.com",
} as const;

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

/**
 * Return the paired environment origin for a known first-party app origin.
 * Custom workspace app hosts intentionally have no inferred lane.
 */
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
