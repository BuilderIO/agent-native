import { ClientId, writeHttpEntryForClient } from "./mcp-config-writers.js";

const DEVICE_START_PATH = "/mcp/connect/device/start";
const DEVICE_POLL_PATH = "/mcp/connect/device/poll";
const MCP_PATH = "/mcp";
const LEGACY_MCP_PATH = "/_agent-native/mcp";

const REMOTE_MCP_OAUTH_CLIENTS = new Set<ClientId>([
  "claude-code",
  "claude-code-cli",
  "cursor",
  "opencode",
  "github-copilot",
]);

const CLIENT_LABELS: Record<ClientId, string> = {
  "claude-code": "Claude Code",
  "claude-code-cli": "Claude Code CLI",
  codex: "Codex",
  cowork: "Claude Cowork",
  cursor: "Cursor",
  opencode: "OpenCode",
  "github-copilot": "GitHub Copilot / VS Code",
};

export interface McpDescriptor {
  serverName: string;
  mcpUrl: string;
  aliases?: string[];
  authMode?: "oauth" | "device" | "none";
  hostedUrl?: string;
}

export interface RegisterMcpOptions {
  descriptor: McpDescriptor;
  clients: ClientId[];
  scope: "user" | "project";
  baseDir: string;
  interactive: boolean;
  log?: (m: string) => void;
  deviceFlowTimeoutMs?: number;
  deps?: {
    fetchImpl?: typeof fetch;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  };
}

export interface RegisterMcpResult {
  written: { client: ClientId; file: string }[];
  authenticated: boolean;
  guidance: string[];
}

interface DeviceStartResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  interval?: number;
  expires_in?: number;
}

interface DevicePollResponse {
  status:
    | "pending"
    | "approved"
    | "expired"
    | "consumed"
    | "error"
    | "not_found";
  token?: string;
  mcpUrl?: string;
  serverName?: string;
  mcpServerEntry?: Record<string, unknown>;
  message?: string;
  error?: string;
}

interface DeviceGrant {
  token?: string;
  mcpUrl: string;
  serverName: string;
  headers?: Record<string, string>;
}

export function supportsRemoteMcpOAuth(client: ClientId): boolean {
  return REMOTE_MCP_OAUTH_CLIENTS.has(client);
}

const DEFAULT_DEVICE_FLOW_TIMEOUT_MS = 90_000;

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function canonicalAgentNativeMcpUrl(url: string): string {
  const trimmed = stripTrailingSlash(url);
  if (trimmed.endsWith(LEGACY_MCP_PATH)) {
    return `${trimmed.slice(0, -LEGACY_MCP_PATH.length)}${MCP_PATH}`;
  }
  return trimmed;
}

function resolveMcpUrl(descriptor: McpDescriptor): string | undefined {
  if (descriptor.mcpUrl && descriptor.mcpUrl.trim()) {
    return canonicalAgentNativeMcpUrl(descriptor.mcpUrl.trim());
  }
  if (descriptor.hostedUrl && descriptor.hostedUrl.trim()) {
    const base = stripTrailingSlash(descriptor.hostedUrl.trim());
    return `${base}${MCP_PATH}`;
  }
  return undefined;
}

function resolveBaseUrl(descriptor: McpDescriptor): string | undefined {
  if (descriptor.hostedUrl && descriptor.hostedUrl.trim()) {
    return stripTrailingSlash(descriptor.hostedUrl.trim());
  }
  if (descriptor.mcpUrl && descriptor.mcpUrl.trim()) {
    const trimmed = stripTrailingSlash(descriptor.mcpUrl.trim());
    if (trimmed.endsWith(LEGACY_MCP_PATH)) {
      return trimmed.slice(0, -LEGACY_MCP_PATH.length);
    }
    if (trimmed.endsWith(MCP_PATH)) {
      return trimmed.slice(0, -MCP_PATH.length);
    }
  }
  return undefined;
}

function configKeys(descriptor: McpDescriptor): string[] {
  const keys: string[] = [descriptor.serverName];
  for (const alias of descriptor.aliases ?? []) {
    if (alias && alias !== descriptor.serverName && !keys.includes(alias)) {
      keys.push(alias);
    }
  }
  return keys;
}

function responseMessage(json: any, fallback: string): string {
  const message =
    typeof json?.message === "string"
      ? json.message
      : typeof json?.error === "string"
        ? json.error
        : "";
  return message.trim() || fallback;
}

async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  body: unknown,
): Promise<{ status: number; json: any }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    let json: any = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    return { status: response.status, json };
  } finally {
    clearTimeout(timeout);
  }
}

function clientArgForClients(clients: ClientId[]): string {
  return clients.length === 1 ? clients[0] : clients.join(",");
}

function fallbackConnectCommand(
  baseUrl: string,
  clients: ClientId[],
  scope: string,
): string {
  return `npx @agent-native/core@latest connect ${baseUrl} --client ${clientArgForClients(
    clients,
  )} --scope ${scope}`;
}

function writeUrlOnlyEntries(
  clients: ClientId[],
  keys: string[],
  mcpUrl: string,
  scope: string,
  baseDir: string,
  written: { client: ClientId; file: string }[],
  errors: string[],
): void {
  for (const client of clients) {
    for (const key of keys) {
      try {
        const file = writeHttpEntryForClient(
          client,
          key,
          mcpUrl,
          undefined,
          baseDir,
          scope,
          undefined,
        );
        written.push({ client, file });
      } catch (err: any) {
        errors.push(
          `Could not write ${key} for ${client}: ${err?.message ?? err}`,
        );
      }
    }
  }
}

function manualConnectGuidance(
  baseUrl: string,
  clients: ClientId[],
  scope: string,
): string {
  return (
    `To authenticate ${describeClients(clients)}, run: ` +
    fallbackConnectCommand(baseUrl, clients, scope)
  );
}

function oauthNextStepsForClients(
  clients: ClientId[],
  serverName?: string,
): string[] {
  const lines: string[] = [];
  if (clients.includes("claude-code") || clients.includes("claude-code-cli")) {
    lines.push(
      "Claude Code: restart Claude Code, run /mcp, and choose Authenticate.",
    );
  }
  if (clients.includes("cursor")) {
    lines.push(
      "Cursor: restart or reload Cursor, then authenticate the MCP server from Cursor MCP settings if prompted.",
    );
  }
  if (clients.includes("opencode")) {
    lines.push(
      `OpenCode: run opencode mcp auth ${serverName ?? "<server-name>"} or authenticate on first use.`,
    );
  }
  if (clients.includes("github-copilot")) {
    lines.push(
      "GitHub Copilot / VS Code: reload VS Code, open the MCP config, and use the Auth action above the server if prompted.",
    );
  }
  return lines;
}

function writeAuthedEntries(
  clients: ClientId[],
  keys: string[],
  mcpUrl: string,
  token: string | undefined,
  headers: Record<string, string> | undefined,
  scope: string,
  baseDir: string,
  written: { client: ClientId; file: string }[],
  errors: string[],
): void {
  for (const client of clients) {
    for (const key of keys) {
      try {
        const file = writeHttpEntryForClient(
          client,
          key,
          mcpUrl,
          token,
          baseDir,
          scope,
          headers,
        );
        written.push({ client, file });
      } catch (err: any) {
        errors.push(
          `Could not write ${key} for ${client}: ${err?.message ?? err}`,
        );
      }
    }
  }
}

async function runDeviceFlow(
  baseUrl: string,
  appSlug: string,
  clientArg: string,
  log: (m: string) => void,
  timeoutMs: number | undefined,
  deps: RegisterMcpOptions["deps"] = {},
): Promise<DeviceGrant | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? (() => Date.now());

  let start: DeviceStartResponse;
  try {
    const { status, json } = await postJson(
      fetchImpl,
      `${baseUrl}${DEVICE_START_PATH}`,
      { client: clientArg, app: appSlug },
    );
    if (status < 200 || status >= 300 || !json?.device_code) {
      log(
        `  Could not start the connect flow on ${baseUrl} (HTTP ${status}). ` +
          `Is this an agent-native app, and is it deployed with the connect ` +
          `endpoint enabled?`,
      );
      return null;
    }
    start = json as DeviceStartResponse;
  } catch (err: any) {
    log(
      `  Could not reach ${baseUrl} (${err?.message ?? err}). ` +
        `Check the URL and your network.`,
    );
    return null;
  }

  const interval = Math.max(1, Number(start.interval) || 5);
  const expiresIn = Math.max(interval, Number(start.expires_in) || 600);
  const serverDeadlineMs = expiresIn * 1000;
  const installerDeadlineMs = Math.max(
    0,
    timeoutMs ?? DEFAULT_DEVICE_FLOW_TIMEOUT_MS,
  );
  const waitMs = Math.min(serverDeadlineMs, installerDeadlineMs);
  const waitWasCapped = waitMs < serverDeadlineMs;
  const deadline = now() + waitMs;

  log("");
  log(`  Connecting to ${baseUrl}`);
  log("");
  log(`  Your code:  ${start.user_code}`);
  log(`  Open:       ${start.verification_uri_complete}`);
  log("");
  log("  Approve in the browser to finish.");

  while (now() < deadline) {
    let poll: DevicePollResponse;
    try {
      const { status, json } = await postJson(
        fetchImpl,
        `${baseUrl}${DEVICE_POLL_PATH}`,
        { device_code: start.device_code },
      );
      if (status < 200 || status >= 300) {
        if (isTerminalPollBody(json)) {
          poll = json as DevicePollResponse;
        } else {
          log(
            `  Connect polling failed (HTTP ${status}): ` +
              responseMessage(json, "server returned an error."),
          );
          return null;
        }
      } else {
        poll = (json ?? { status: "pending" }) as DevicePollResponse;
      }
    } catch {
      poll = { status: "pending" };
    }

    if (poll.status === "approved") {
      const token = poll.token ?? "";
      const mcpUrl = canonicalAgentNativeMcpUrl(
        poll.mcpUrl ?? `${baseUrl}${MCP_PATH}`,
      );
      const serverName = poll.serverName ?? appSlug;
      const headers =
        poll.mcpServerEntry &&
        typeof poll.mcpServerEntry === "object" &&
        poll.mcpServerEntry.headers &&
        typeof poll.mcpServerEntry.headers === "object"
          ? (poll.mcpServerEntry.headers as Record<string, string>)
          : undefined;
      log("  Approved.");
      return { token: token || undefined, mcpUrl, serverName, headers };
    }
    if (poll.status === "expired") {
      log("  The connect request expired before it was approved.");
      log("  Run the command again to retry.");
      return null;
    }
    if (poll.status === "consumed") {
      log("  This connect code was already used. Run the command again.");
      return null;
    }
    if (poll.status === "error" || poll.status === "not_found") {
      log(
        `  Connect polling failed: ${responseMessage(
          poll,
          poll.status === "not_found"
            ? "device code was not found."
            : "server returned an error.",
        )}`,
      );
      return null;
    }

    const remainingMs = deadline - now();
    if (remainingMs <= 0) break;
    await sleep(Math.min(interval * 1000, remainingMs));
  }

  if (waitWasCapped) {
    log(
      `  Stopped waiting after ${Math.round(waitMs / 1000)}s so installation can finish.`,
    );
    log("  You can authenticate later with the command below.");
  } else {
    log("  Timed out waiting for approval. Run the command again to retry.");
  }
  return null;
}

function isTerminalPollBody(json: any): boolean {
  return (
    json?.status === "not_found" ||
    json?.status === "error" ||
    json?.status === "expired" ||
    json?.status === "consumed"
  );
}

export async function registerMcpServer(
  opts: RegisterMcpOptions,
): Promise<RegisterMcpResult> {
  const { descriptor, scope, baseDir, interactive } = opts;
  const log = opts.log ?? (() => {});
  const deps = opts.deps ?? {};

  const written: { client: ClientId; file: string }[] = [];
  const guidance: string[] = [];
  const errors: string[] = [];
  let authenticated = false;

  const keys = configKeys(descriptor);
  const mcpUrl = resolveMcpUrl(descriptor);
  if (!mcpUrl) {
    return {
      written,
      authenticated,
      guidance: [
        `Cannot register "${descriptor.serverName}": no mcpUrl or hostedUrl supplied.`,
      ],
    };
  }

  const authMode = descriptor.authMode ?? "device";

  if (authMode === "none") {
    writeUrlOnlyEntries(
      opts.clients,
      keys,
      mcpUrl,
      scope,
      baseDir,
      written,
      errors,
    );
    return { written, authenticated, guidance: [...guidance, ...errors] };
  }

  const oauthClients = opts.clients.filter((c) => supportsRemoteMcpOAuth(c));
  const deviceClients = opts.clients.filter((c) => !supportsRemoteMcpOAuth(c));

  if (oauthClients.length > 0) {
    writeUrlOnlyEntries(
      oauthClients,
      keys,
      mcpUrl,
      scope,
      baseDir,
      written,
      errors,
    );
    guidance.push(
      `${describeClients(oauthClients)}: wrote URL-only MCP config (no bearer headers).`,
      ...oauthNextStepsForClients(oauthClients, descriptor.serverName),
    );
  }

  if (deviceClients.length > 0) {
    const baseUrl = resolveBaseUrl(descriptor);

    // We only reach here for authMode "oauth"/"device" (authMode "none" returned
    // earlier). Run the flow only when interactive AND we have a hosted URL to
    // authenticate against. Device-code clients such as Codex cannot use a
    // URL-only hosted entry: writing one would overwrite a working bearer token
    // and leave new sessions unauthenticated. If auth cannot complete, keep the
    // existing config untouched and surface the explicit connect command.
    const canRunFlow = interactive && !!baseUrl;

    if (!canRunFlow) {
      if (baseUrl) {
        guidance.push(
          `${describeClients(deviceClients)}: skipped MCP config because this client needs a bearer token.`,
          manualConnectGuidance(baseUrl, deviceClients, scope),
        );
      } else {
        guidance.push(
          `${describeClients(deviceClients)}: skipped MCP config because no hosted URL was available for authentication.`,
        );
      }
    } else {
      const appSlug = appSlugFor(descriptor, baseUrl!);
      const clientArg = deviceClients.length === 1 ? deviceClients[0] : "all";
      const grant = await runDeviceFlow(
        baseUrl!,
        appSlug,
        clientArg,
        log,
        opts.deviceFlowTimeoutMs,
        deps,
      );

      if (grant && grant.token) {
        const resolvedUrl = grant.mcpUrl || mcpUrl;
        writeAuthedEntries(
          deviceClients,
          keys,
          resolvedUrl,
          grant.token,
          grant.headers,
          scope,
          baseDir,
          written,
          errors,
        );
        authenticated = true;
      } else {
        // Flow failed (or approved with no token). Do not downgrade device-code
        // clients to a URL-only hosted entry; keep any existing bearer config.
        guidance.push(
          `${describeClients(deviceClients)}: authentication did not complete; existing MCP config was left unchanged.`,
          manualConnectGuidance(baseUrl!, deviceClients, scope),
        );
      }
    }
  }

  return { written, authenticated, guidance: [...guidance, ...errors] };
}

function describeClients(clients: ClientId[]): string {
  return clients.map((client) => CLIENT_LABELS[client]).join(", ");
}

function appSlugFor(descriptor: McpDescriptor, baseUrl: string): string {
  const name = descriptor.serverName.replace(/^agent-native-/, "");
  if (name) return name;
  try {
    const host = new URL(baseUrl).hostname;
    const first = host.split(".")[0];
    return first && first !== "www" ? first : "app";
  } catch {
    return "app";
  }
}
