import { fetchOrgApps } from "@agent-native/core/mcp";
import {
  isFirstPartyRemoteEndpointTrusted,
  listRemoteServers,
} from "@agent-native/core/mcp-client";
import { registerOnboardingStep } from "@agent-native/core/onboarding";
import { defineNitroPlugin } from "@agent-native/core/server";

const SERVER_NAME = "assets";

async function hasAssetsServer(orgId: string) {
  const apps = await fetchOrgApps({ selfId: "design" });
  const assets = apps.find((app) => app.id === "assets");
  if (!assets?.url) return false;
  const currentUrl = `${assets.url.replace(/\/+$/, "")}/_agent-native/mcp`;
  const servers = await listRemoteServers("org", orgId);
  for (const server of servers) {
    if (server.name !== SERVER_NAME || server.firstParty !== true) continue;
    if (server.url.replace(/\/+$/, "") !== currentUrl) continue;
    const trust = await isFirstPartyRemoteEndpointTrusted(
      orgId,
      "assets",
      server.url,
    );
    if (trust.ok) return true;
  }
  return false;
}

async function ensureAssetsServer(ctx?: {
  userEmail?: string;
  orgId?: string | null;
}) {
  if (!ctx?.userEmail || !ctx.orgId) return false;
  return hasAssetsServer(ctx.orgId);
}

export default defineNitroPlugin(() => {
  registerOnboardingStep({
    id: "assets-mcp",
    order: 70,
    title: "Connect Assets",
    description:
      "Enable first-party Assets MCP tools so Design can generate and insert on-brand media.",
    required: false,
    methods: [
      {
        id: "agent",
        kind: "agent-task",
        label: "Connect Assets",
        primary: true,
        payload: {
          prompt:
            "Call connect-assets-mcp to connect the first-party Assets MCP server for this Design organization, then verify generate-asset is visible.",
        },
      },
    ],
    isComplete: ensureAssetsServer,
  });
});
