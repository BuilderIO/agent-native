import { callAgent } from "@agent-native/core/a2a";
import { buildDeepLink } from "@agent-native/core/server";
import {
  discoverAgents,
  type DiscoveredAgent,
} from "@agent-native/core/server/agent-discovery";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { getOrgA2ASecret, getOrgDomain } from "@agent-native/core/org";
import {
  getDispatchMcpAppAccessSettings,
  isAppAllowedByMcpAccess,
  type DispatchMcpAppAccessSettings,
} from "./mcp-access-store.js";

export interface DispatchMcpAccessibleApp {
  id: string;
  name: string;
  description: string;
  url: string;
  color: string;
  granted: boolean;
}

function normalizeAppId(value: string): string {
  return value.trim().toLowerCase();
}

function toAccessibleApp(
  agent: DiscoveredAgent,
  settings: DispatchMcpAppAccessSettings,
): DispatchMcpAccessibleApp {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    url: agent.url,
    color: agent.color,
    granted: isAppAllowedByMcpAccess(agent.id, settings),
  };
}

export async function listDispatchMcpApps(): Promise<{
  settings: DispatchMcpAppAccessSettings;
  apps: DispatchMcpAccessibleApp[];
}> {
  const [settings, agents] = await Promise.all([
    getDispatchMcpAppAccessSettings(),
    discoverAgents("dispatch"),
  ]);
  return {
    settings,
    apps: agents.map((agent) => toAccessibleApp(agent, settings)),
  };
}

export async function listGrantedDispatchMcpApps(): Promise<
  DispatchMcpAccessibleApp[]
> {
  const { apps } = await listDispatchMcpApps();
  return apps.filter((app) => app.granted);
}

export async function resolveGrantedDispatchMcpApp(
  app: string,
): Promise<DispatchMcpAccessibleApp> {
  const target = normalizeAppId(app);
  if (!target) throw new Error("app is required");
  const { apps } = await listDispatchMcpApps();
  const match = apps.find(
    (candidate) =>
      candidate.id === target || candidate.name.toLowerCase() === target,
  );
  if (!match) {
    throw new Error(
      `Unknown app "${app}". Call list_apps to see apps available through Dispatch MCP.`,
    );
  }
  if (!match.granted) {
    throw new Error(
      `Dispatch MCP access to "${match.id}" is not granted. Open Dispatch > Agents to change MCP app access.`,
    );
  }
  return match;
}

export async function askGrantedDispatchMcpApp(
  app: string,
  message: string,
): Promise<{ app: string; routedVia: "a2a"; response: string }> {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) throw new Error("message is required");
  const target = await resolveGrantedDispatchMcpApp(app);
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");

  const orgId = getRequestOrgId();
  const [orgDomain, orgSecret] = orgId
    ? await Promise.all([
        getOrgDomain(orgId).catch(() => null),
        getOrgA2ASecret(orgId).catch(() => null),
      ])
    : [null, null];

  const response = await callAgent(target.url, trimmedMessage, {
    userEmail,
    orgDomain: orgDomain ?? undefined,
    orgSecret: orgSecret ?? undefined,
    timeoutMs: 5 * 60_000,
  });
  return { app: target.id, routedVia: "a2a", response };
}

export async function openGrantedDispatchMcpApp(input: {
  app: string;
  view: string;
  params?: Record<string, string | number | boolean>;
}): Promise<{ app: string; view: string; url: string }> {
  const view = input.view.trim();
  if (!view) throw new Error("view is required");
  const target = await resolveGrantedDispatchMcpApp(input.app);
  const relUrl = buildDeepLink({
    app: target.id,
    view,
    params: input.params,
  });
  return {
    app: target.id,
    view,
    url: `${target.url.replace(/\/+$/, "")}${relUrl}`,
  };
}
