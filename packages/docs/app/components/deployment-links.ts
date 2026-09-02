import {
  resolveEnvironmentTargets,
} from "@agent-native/core/shared";

const BETA_DOCS_HOST = "beta.agent-native.com";
const BUILD_ENVIRONMENT =
  import.meta.env.VITE_AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT?.trim().toLowerCase();

function currentHostname(): string | undefined {
  return typeof window === "undefined" ? undefined : window.location.hostname;
}

export function isBetaDocsDeployment(
  hostname = currentHostname(),
  environment = BUILD_ENVIRONMENT,
): boolean {
  return (
    environment === "beta" ||
    hostname?.trim().toLowerCase().replace(/\.$/, "") === BETA_DOCS_HOST
  );
}

export function firstPartyAppUrl(
  url: string,
  beta = isBetaDocsDeployment(),
): string {
  if (!beta) return url;

  try {
    const parsed = new URL(url);
    const targets = resolveEnvironmentTargets(parsed.hostname);
    if (!targets) return url;
    parsed.protocol = "https:";
    parsed.hostname = targets.betaHost;
    parsed.port = "";
    return parsed.toString();
  } catch {
    return url;
  }
}
