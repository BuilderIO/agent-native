export const BETA_OPT_OUT_QUERY_PARAM = "agentNativeBetaOptOut";
export const BETA_OPT_OUT_DURATION_MS = 24 * 60 * 60 * 1000;

export const ENVIRONMENT_BETA_HOSTS = {
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

export interface EnvironmentBadgeTargets {
  betaHost: string;
  productionHost: string;
}

export function resolveEnvironmentTargets(
  hostname: string | undefined,
): EnvironmentBadgeTargets | null {
  const normalized = hostname?.trim().toLowerCase().replace(/\.$/, "");
  if (!normalized) return null;

  const productionHost = normalized.replace(/^beta\./, "");
  const betaHost =
    ENVIRONMENT_BETA_HOSTS[
      productionHost as keyof typeof ENVIRONMENT_BETA_HOSTS
    ];
  if (!betaHost) return null;

  return {
    betaHost,
    productionHost,
  };
}

export function buildEnvironmentUrl(
  sourceHref: string,
  targetHost: string,
): string | null {
  try {
    const target = new URL(sourceHref);
    target.protocol = "https:";
    target.hostname = targetHost;
    target.port = "";
    return target.toString();
  } catch {
    // coercion-ok: Invalid navigation input is an explicit absent target.
    return null;
  }
}

export function buildEnvironmentOptOutUrl(
  sourceHref: string,
  targetHost: string,
  now = Date.now(),
): string | null {
  const targetHref = buildEnvironmentUrl(sourceHref, targetHost);
  if (!targetHref) return null;

  try {
    const target = new URL(targetHref);
    target.searchParams.set(
      BETA_OPT_OUT_QUERY_PARAM,
      String(now + BETA_OPT_OUT_DURATION_MS),
    );
    return target.toString();
  } catch {
    // coercion-ok: buildEnvironmentUrl already validated the URL.
    return null;
  }
}
