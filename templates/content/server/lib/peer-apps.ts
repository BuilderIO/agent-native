import { getAppConfig } from "@agent-native/core/server";
import { getBuiltinAgents } from "@agent-native/core/server/agent-discovery";
import {
  resolveEnvironmentTargets,
  resolveLaneEndpoint,
} from "@agent-native/core/shared/environment-lanes";

function hostnameOf(url: string | undefined): string | undefined {
  return url && URL.canParse(url) ? new URL(url).hostname : undefined;
}

export function resolvePeerAppUrl(appId: string): string | null {
  const peer = getBuiltinAgents("content").find((app) => app.id === appId);
  if (!peer?.url || !URL.canParse(peer.url)) return null;
  return resolveLaneEndpoint(
    peer.url,
    hostnameOf(getAppConfig().app.url),
  ).replace(/\/+$/, "");
}

export function peerAppLinkOrigins(appId: string): string[] {
  const appUrl = resolvePeerAppUrl(appId);
  if (!appUrl) return [];
  const url = new URL(appUrl);
  const lanes = resolveEnvironmentTargets(url.hostname);
  const origins = [appUrl];
  for (const host of lanes ? [lanes.betaHost, lanes.productionHost] : []) {
    const lane = new URL(appUrl);
    lane.hostname = host;
    origins.push(lane.toString().replace(/\/+$/, ""));
  }
  return [...new Set(origins)];
}
