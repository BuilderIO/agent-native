import { getAppConfig } from "@agent-native/core/server";
import { getBuiltinAgents } from "@agent-native/core/server/agent-discovery";
import { resolveLaneEndpoint } from "@agent-native/core/shared/environment-lanes";

function hostnameOf(url: string | undefined): string | undefined {
  if (!url || !URL.canParse(url)) return undefined;
  return new URL(url).hostname;
}

function peerApp(appId: string) {
  const app = getBuiltinAgents("mail").find((entry) => entry.id === appId);
  if (!app?.url || !URL.canParse(app.url)) return undefined;
  const builtinUrl = app.url.replace(/\/+$/, "");
  const laneUrl = resolveLaneEndpoint(
    builtinUrl,
    hostnameOf(getAppConfig().app.url),
  ).replace(/\/+$/, "");
  return { builtinUrl, laneUrl };
}

export function peerAppTarget(appId: string): string {
  const app = peerApp(appId);
  if (!app) return appId;
  return app.laneUrl === app.builtinUrl ? appId : app.laneUrl;
}

export function peerAppUrl(appId: string): string | undefined {
  return peerApp(appId)?.laneUrl;
}
