/**
 * MCP-server registration + authentication for `@agent-native/skills`.
 *
 * This is a dependency-free port of the MCP-config-writing + device-code/OAuth
 * flow that lives in `@agent-native/core`'s `cli/connect.ts`. The skills package
 * ships standalone (no `@agent-native/core` dependency), so this module
 * re-implements just the registration surface against the shared on-disk
 * writers in `./mcp-config-writers.js`. It writes the SAME config and speaks the
 * SAME device-code/OAuth protocol as core.
 *
 * Two client families, exactly as in core:
 *   - OAuth-capable (claude-code, claude-code-cli): get a URL-only HTTP MCP
 *     entry (no bearer headers). The user authenticates in-host via standard
 *     remote MCP OAuth: restart Claude Code, run /mcp, choose Authenticate.
 *   - Device-code (codex, cowork): run the browser device-code flow against the
 *     descriptor's hosted URL, then write the entry WITH the minted bearer token
 *     + headers. Non-interactive (or no TTY) skips the flow and writes a
 *     URL-only entry, surfacing the exact `agent-native connect <url> --token`
 *     fallback command.
 *
 * Server contract (identical paths + JSON field names to core):
 *   POST <hostedUrl>/_agent-native/mcp/connect/device/start  (no auth)
 *     body { client?, app? }
 *     → { device_code, user_code, verification_uri,
 *         verification_uri_complete, interval, expires_in }
 *   POST <hostedUrl>/_agent-native/mcp/connect/device/poll   (no auth)
 *     body { device_code }
 *     → { status: "pending" }
 *     | { status: "approved", token, mcpUrl, serverName, mcpServerEntry }
 *     | { status: "expired" } | { status: "consumed" }
 *     | { status: "error" | "not_found", message? }
 *
 * Node-only. Node built-ins + global fetch only; no npm deps.
 */

import { ClientId, writeHttpEntryForClient } from "./mcp-config-writers.js";

const DEVICE_START_PATH = "/_agent-native/mcp/connect/device/start";
const DEVICE_POLL_PATH = "/_agent-native/mcp/connect/device/poll";
const MCP_PATH = "/_agent-native/mcp";

/** OAuth-capable clients (in-host remote MCP OAuth, never a local bearer). */
const REMOTE_MCP_OAUTH_CLIENTS = new Set<ClientId>([
  "claude-code",
  "claude-code-cli",
]);

/** Identical to core: ask the deployed app to expose the full action catalog. */
const MCP_FULL_CATALOG_HEADER = "X-Agent-Native-MCP-Full-Catalog";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Describes one MCP server to register. `serverName` is the canonical config
 * key; `aliases` are additional config keys that point at the same MCP URL
 * (e.g. `plan` + `agent-native-plans`). `hostedUrl` is the deployed app origin
 * the device-code flow authenticates against; `mcpUrl` is the resolved MCP
 * endpoint written into the config (defaults to `<hostedUrl>/_agent-native/mcp`
 * when only `hostedUrl` is supplied).
 */
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

// ---------------------------------------------------------------------------
// Device-code protocol shapes (field names match core EXACTLY).
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function supportsRemoteMcpOAuth(client: ClientId): boolean {
  return REMOTE_MCP_OAUTH_CLIENTS.has(client);
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Trailing-slash-stripped origin+path for a hosted app URL. */
function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Resolve the MCP endpoint URL for a descriptor. Prefers an explicit `mcpUrl`,
 * otherwise derives `<hostedUrl>/_agent-native/mcp` (mirrors core's
 * `mcpUrlForBaseUrl`). Returns `undefined` when neither is usable.
 */
function resolveMcpUrl(descriptor: McpDescriptor): string | undefined {
  if (descriptor.mcpUrl && descriptor.mcpUrl.trim()) {
    return descriptor.mcpUrl.trim();
  }
  if (descriptor.hostedUrl && descriptor.hostedUrl.trim()) {
    const base = stripTrailingSlash(descriptor.hostedUrl.trim());
    return `${base}${MCP_PATH}`;
  }
  return undefined;
}

/** Base (origin) URL of the deployed app the device flow runs against. */
function resolveBaseUrl(descriptor: McpDescriptor): string | undefined {
  if (descriptor.hostedUrl && descriptor.hostedUrl.trim()) {
    return stripTrailingSlash(descriptor.hostedUrl.trim());
  }
  // Fall back to stripping the MCP path off an explicit mcpUrl.
  if (descriptor.mcpUrl && descriptor.mcpUrl.trim()) {
    const trimmed = stripTrailingSlash(descriptor.mcpUrl.trim());
    if (trimmed.endsWith(MCP_PATH)) {
      return trimmed.slice(0, -MCP_PATH.length);
    }
  }
  return undefined;
}

/** All config keys to register: the canonical name plus any aliases (deduped). */
function configKeys(descriptor: McpDescriptor): string[] {
  const keys: string[] = [descriptor.serverName];
  for (const alias of descriptor.aliases ?? []) {
    if (alias && alias !== descriptor.serverName && !keys.includes(alias)) {
      keys.push(alias);
    }
  }
  return keys;
}

/** Always tag bearer-bearing entries so the client sees the full catalog. */
function withFullCatalogHeader(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  return { ...(headers ?? {}), [MCP_FULL_CATALOG_HEADER]: "1" };
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

/**
 * The exact no-browser fallback command core prints. Surfaced as guidance when
 * a device-code client is asked to register non-interactively.
 */
function fallbackConnectCommand(baseUrl: string): string {
  return `npx @agent-native/core@latest connect ${baseUrl} --token <token>`;
}

/** Write a URL-only entry (no bearer) for every config key, collecting files. */
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

/** Write a token+headers entry for every config key, collecting files. */
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
          withFullCatalogHeader(headers),
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

// ---------------------------------------------------------------------------
// Device-code flow (dependency-free port of core's runDeviceFlow)
// ---------------------------------------------------------------------------

/**
 * Run the device-code flow against `baseUrl` and return the approved grant, or
 * `null` (after logging a clear message) on expiry/consumed/error/timeout. Same
 * state machine and field handling as core; the spinner/browser-open are
 * dropped since this runs inside a non-interactive installer context.
 */
async function runDeviceFlow(
  baseUrl: string,
  appSlug: string,
  clientArg: string,
  log: (m: string) => void,
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
  const deadline = now() + expiresIn * 1000;

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
        log(
          `  Connect polling failed (HTTP ${status}): ` +
            responseMessage(json, "server returned an error."),
        );
        return null;
      }
      poll = (json ?? { status: "pending" }) as DevicePollResponse;
    } catch {
      // Transient network error — keep polling until the deadline.
      poll = { status: "pending" };
    }

    if (poll.status === "approved") {
      const token = poll.token ?? "";
      const mcpUrl = poll.mcpUrl ?? `${baseUrl}${MCP_PATH}`;
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

    await sleep(interval * 1000);
  }

  log("  Timed out waiting for approval. Run the command again to retry.");
  return null;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Register an MCP server (plus aliases) into the requested client configs,
 * authenticating device-code clients via the browser flow when interactive.
 *
 * Idempotent: re-running replaces the same named entries. Never throws on a
 * single client/key failing — failures are collected into `guidance`.
 */
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

  // authMode "none" (e.g. context-xray): URL-only for ALL clients, no auth.
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

  // Split into OAuth-capable and device-code clients, exactly like core.
  const oauthClients = opts.clients.filter((c) => supportsRemoteMcpOAuth(c));
  const deviceClients = opts.clients.filter((c) => !supportsRemoteMcpOAuth(c));

  // OAuth clients always get URL-only entries (in-host OAuth, no local bearer).
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
      "Next: restart Claude Code, run /mcp, and choose Authenticate.",
    );
  }

  // Device-code clients.
  if (deviceClients.length > 0) {
    const baseUrl = resolveBaseUrl(descriptor);

    // We only reach here for authMode "oauth"/"device" (authMode "none" returned
    // earlier). Run the flow only when interactive AND we have a hosted URL to
    // authenticate against; otherwise fall back to URL-only.
    const canRunFlow = interactive && !!baseUrl;

    if (!canRunFlow) {
      writeUrlOnlyEntries(
        deviceClients,
        keys,
        mcpUrl,
        scope,
        baseDir,
        written,
        errors,
      );
      if (baseUrl) {
        guidance.push(
          `${describeClients(deviceClients)}: wrote URL-only MCP config (no token).`,
          `To authenticate non-interactively, run: ${fallbackConnectCommand(baseUrl)}`,
        );
      } else {
        guidance.push(
          `${describeClients(deviceClients)}: wrote URL-only MCP config (no hosted URL to authenticate against).`,
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
        deps,
      );

      if (grant && grant.token) {
        // Write authed entries; honour the server's resolved mcpUrl when given.
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
        // Flow failed (or approved with no token) — fall back to URL-only and
        // surface the exact recovery command.
        writeUrlOnlyEntries(
          deviceClients,
          keys,
          mcpUrl,
          scope,
          baseDir,
          written,
          errors,
        );
        guidance.push(
          `${describeClients(deviceClients)}: authentication did not complete; wrote URL-only MCP config.`,
          `To finish, run: ${fallbackConnectCommand(baseUrl!)}`,
        );
      }
    }
  }

  return { written, authenticated, guidance: [...guidance, ...errors] };
}

function describeClients(clients: ClientId[]): string {
  return clients.join(", ");
}

/** Derive the `app` slug the device-start endpoint expects. */
function appSlugFor(descriptor: McpDescriptor, baseUrl: string): string {
  // Prefer the descriptor's server name without the agent-native prefix.
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
