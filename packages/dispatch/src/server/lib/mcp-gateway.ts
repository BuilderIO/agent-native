import { callAgent } from "@agent-native/core/a2a";
import { signA2AToken } from "@agent-native/core/a2a";
import {
  buildMcpToolName,
  McpClientManager,
} from "@agent-native/core/mcp-client";
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

const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]");

function safeAppPath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const value = raw.trim();
  if (CONTROL_CHARS.test(value)) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  return value;
}

function appendParamsToPath(
  path: string,
  params: Record<string, string | number | boolean> | undefined,
): string {
  if (!params || Object.keys(params).length === 0) return path;
  const url = new URL(path, "http://agent-native.invalid");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function viewToAppPath(view: string | undefined): string | null {
  const value = String(view ?? "").trim();
  if (!value) return null;
  return safeAppPath(value.startsWith("/") ? value : `/${value}`);
}

function appOrigin(app: DispatchMcpAccessibleApp): string {
  return new URL(app.url).origin;
}

function appBaseUrl(app: DispatchMcpAccessibleApp): string {
  return app.url.replace(/\/+$/, "");
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
  view?: string;
  path?: string;
  params?: Record<string, string | number | boolean>;
  embed?: boolean;
  chrome?: "full" | "minimal";
}): Promise<{
  app: string;
  view?: string;
  path?: string;
  url: string;
  embed: boolean;
}> {
  const view = input.view?.trim();
  const path = safeAppPath(input.path);
  if (!view && !path) throw new Error("open_app requires view or path");
  const target = await resolveGrantedDispatchMcpApp(input.app);
  const embed = input.embed === true;
  const directViewPath = embed && view ? viewToAppPath(view) : null;
  const relUrl = path
    ? appendParamsToPath(path, input.params)
    : directViewPath
      ? appendParamsToPath(directViewPath, input.params)
      : buildDeepLink({
          app: target.id,
          view: view!,
          params: input.params,
        });
  return {
    app: target.id,
    ...(view ? { view } : {}),
    ...(path ? { path } : {}),
    url: `${appBaseUrl(target)}${relUrl}`,
    embed,
  };
}

function parseMcpToolTextResult(result: unknown): Record<string, unknown> {
  if (result && typeof result === "object") {
    const structured = (result as any).structuredContent;
    if (structured && typeof structured === "object") return structured;
    const parts = Array.isArray((result as any).content)
      ? ((result as any).content as Array<Record<string, unknown>>)
      : [];
    const text = parts.find(
      (part) => part?.type === "text" && typeof part.text === "string",
    )?.text;
    if (typeof text === "string" && text.trim()) {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") return parsed;
    }
  }
  throw new Error("Target app did not return an embed session.");
}

async function resolveDispatchEmbedTarget(input: {
  app?: string;
  url?: string;
  path?: string;
}): Promise<{ app: DispatchMcpAccessibleApp; path: string; url: string }> {
  const explicitApp = input.app?.trim()
    ? await resolveGrantedDispatchMcpApp(input.app)
    : null;
  if (explicitApp && input.path) {
    const path = safeAppPath(input.path);
    if (!path) throw new Error("path must be a safe app-relative route");
    return {
      app: explicitApp,
      path,
      url: `${appBaseUrl(explicitApp)}${path}`,
    };
  }

  if (!input.url) {
    throw new Error("create_embed_session requires a url or app + path.");
  }

  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    if (!explicitApp) {
      throw new Error("Relative embed paths require an app id.");
    }
    const path = safeAppPath(input.url);
    if (!path) throw new Error("url must be a safe app route.");
    return {
      app: explicitApp,
      path,
      url: `${appBaseUrl(explicitApp)}${path}`,
    };
  }

  const apps = explicitApp ? [explicitApp] : await listGrantedDispatchMcpApps();
  const target = apps.find((app) => parsed.origin === appOrigin(app));
  if (!target) {
    throw new Error(
      "Embed URL must belong to an app granted through Dispatch.",
    );
  }
  const path = safeAppPath(`${parsed.pathname}${parsed.search}${parsed.hash}`);
  if (!path) throw new Error("Embed URL path is not safe.");
  return { app: target, path, url: `${appBaseUrl(target)}${path}` };
}

export async function createGrantedDispatchMcpEmbedSession(input: {
  app?: string;
  url?: string;
  path?: string;
  chrome?: "full" | "minimal";
}): Promise<{
  startUrl: string;
  targetPath?: string;
  expiresAt?: number;
  app: string;
}> {
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  const target = await resolveDispatchEmbedTarget(input);

  const orgId = getRequestOrgId();
  const [orgDomain, orgSecret] = orgId
    ? await Promise.all([
        getOrgDomain(orgId).catch(() => null),
        getOrgA2ASecret(orgId).catch(() => null),
      ])
    : [null, null];
  const token = await signA2AToken(
    userEmail,
    orgDomain ?? undefined,
    orgSecret ?? undefined,
    {
      expiresIn: "5m",
      preferGlobalSecret: !orgSecret,
    },
  );

  const serverId = "target";
  const manager = new McpClientManager({
    servers: {
      [serverId]: {
        type: "http",
        url: `${appBaseUrl(target.app)}/_agent-native/mcp`,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    },
  });
  await manager.start();
  try {
    const result = await manager.callTool(
      buildMcpToolName(serverId, "create_embed_session"),
      {
        url: target.url,
        chrome: input.chrome ?? "full",
      },
    );
    const parsed = parseMcpToolTextResult(result) as {
      startUrl?: string;
      targetPath?: string;
      expiresAt?: number;
    };
    if (!parsed.startUrl) {
      throw new Error("Target app did not return an embed start URL.");
    }
    return {
      startUrl: parsed.startUrl,
      targetPath: parsed.targetPath,
      expiresAt: parsed.expiresAt,
      app: target.app.id,
    };
  } finally {
    await manager.stop();
  }
}
