import { resolveAgentInvocationTarget } from "@agent-native/core/a2a";
import { getAppConfig } from "@agent-native/core/server";
import { resolveLaneEndpoint } from "@agent-native/core/shared/environment-lanes";

export interface ContentPeer {
  appUrl: string;
  target: string;
}

export async function resolveContentPeer(): Promise<ContentPeer> {
  const found = await resolveAgentInvocationTarget("content", {
    selfAppId: "design",
  });
  const foundUrl = found.url.replace(/\/+$/, "");
  const selfUrl = getAppConfig().app.url;
  const url = resolveLaneEndpoint(
    foundUrl,
    selfUrl && URL.canParse(selfUrl) ? new URL(selfUrl).hostname : undefined,
  ).replace(/\/+$/, "");
  return {
    appUrl: url.replace(/\/(?:_agent-native\/)?a2a$/, ""),
    target: url === foundUrl ? "content" : url,
  };
}
