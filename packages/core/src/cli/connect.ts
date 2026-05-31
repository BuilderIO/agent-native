/**
 * `agent-native connect <url>` — wire your local Claude Code / Codex / Cowork
 * to a DEPLOYED agent-native app. OAuth-capable clients receive a standard
 * remote MCP URL entry and authenticate in the host. Fallback clients use the
 * browser device-code flow: open the verification URL, approve in the browser,
 * and the minted HTTP MCP server entry is written idempotently.
 *
 *   agent-native connect <url> [--client all|claude-code|claude-code-cli|
 *                               codex|cowork] [--scope user|project]
 *                               [--name <serverName>]
 *   agent-native connect <url> --token <token>   (no-browser fallback)
 *   agent-native connect        [--client ...]   (pick first-party apps)
 *   agent-native connect --all  [--client ...]   (separate first-party app MCP resources)
 *
 * Server contract (implemented by another agent on `<url>`):
 *   POST <url>/_agent-native/mcp/connect/device/start  (no auth)
 *     body { client?, app? }
 *     → { device_code, user_code, verification_uri,
 *         verification_uri_complete, interval, expires_in }
 *   POST <url>/_agent-native/mcp/connect/device/poll   (no auth)
 *     body { device_code }
 *     → { status: "pending" }
 *     | { status: "approved", token, mcpUrl, serverName, mcpServerEntry }
 *     | { status: "expired" }
 *     | { status: "consumed" }
 *     | { status: "error" | "not_found", message? }
 *
 * Node-only CLI module. Uses Node built-ins, @clack/prompts, and global fetch.
 */

import fs from "node:fs";
import os from "node:os";
import { spawn } from "node:child_process";
import path from "node:path";

import { findWorkspaceRoot } from "../mcp/workspace-resolve.js";
import {
  CLIENTS,
  ClientId,
  configPathFor,
  writeCodexBlock,
  writeHttpEntryForClient,
  writeJsonMcpEntry,
} from "./mcp-config-writers.js";
import { TEMPLATES, visibleTemplates } from "./templates-meta.js";

const DEVICE_START_PATH = "/_agent-native/mcp/connect/device/start";
const DEVICE_POLL_PATH = "/_agent-native/mcp/connect/device/poll";
const MCP_PATH = "/_agent-native/mcp";
const SERVER_NAME_PREFIX = "agent-native";
const CONNECT_PREFERENCES_VERSION = 1;
const CONNECT_PROFILES_VERSION = 1;
const DEFAULT_DEV_GATEWAY = "http://127.0.0.1:8080";
const MCP_FULL_CATALOG_HEADER = "X-Agent-Native-MCP-Full-Catalog";

const CLIENT_LABELS: Record<ClientId, string> = {
  "claude-code": "Claude Code",
  "claude-code-cli": "Claude Code CLI",
  codex: "Codex",
  cowork: "Claude Cowork",
};

const CLIENT_HINTS: Record<ClientId, string> = {
  "claude-code": ".mcp.json or ~/.claude.json",
  "claude-code-cli": ".mcp.json or ~/.claude.json",
  codex: "$CODEX_HOME/config.toml or ~/.codex/config.toml",
  cowork: "~/.cowork/mcp.json",
};

const REMOTE_MCP_OAUTH_CLIENTS = new Set<ClientId>([
  "claude-code",
  "claude-code-cli",
]);

function logOut(msg: string): void {
  process.stdout.write(`${msg}\n`);
}
function logErr(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

export interface ParsedConnectArgs {
  /** Developer profile switch: local dev gateway or saved production config. */
  mode?: "dev" | "prod";
  /** Positional URL (the deployed app origin). Undefined for `--all`. */
  url?: string;
  /** all | claude-code | claude-code-cli | codex | cowork (default "all"). */
  client: string;
  /** True when the user passed --client explicitly, so we skip the picker. */
  clientExplicit: boolean;
  /** user | project (default "user"). */
  scope: string;
  /** Override the minted MCP server name. */
  name?: string;
  /** No-browser fallback: skip device flow, use this token directly. */
  token?: string;
  /** Connect every first-party hosted app. */
  all: boolean;
  /** Comma-separated app names for profile switching. */
  apps?: string;
  /** Local dev-lazy gateway URL for `connect dev`. */
  gateway?: string;
  /** Shorthand for a local dev-lazy gateway port. */
  port?: number;
  /** Local owner email override for dev entries. */
  ownerEmail?: string;
}

export function parseConnectArgs(argv: string[]): ParsedConnectArgs {
  const out: ParsedConnectArgs = {
    client: "all",
    clientExplicit: false,
    scope: "user",
    all: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eat = (flag: string): string | undefined => {
      if (a === flag) return argv[++i];
      if (a.startsWith(`${flag}=`)) return a.slice(flag.length + 1);
      return undefined;
    };
    let v: string | undefined;
    if (a === "--all") out.all = true;
    else if ((v = eat("--apps")) !== undefined) out.apps = v;
    else if ((v = eat("--gateway")) !== undefined) out.gateway = v;
    else if ((v = eat("--gateway-url")) !== undefined) out.gateway = v;
    else if ((v = eat("--port")) !== undefined) out.port = Number(v);
    else if ((v = eat("--owner-email")) !== undefined) out.ownerEmail = v;
    else if ((v = eat("--client")) !== undefined) {
      out.client = v;
      out.clientExplicit = true;
    } else if ((v = eat("--scope")) !== undefined) out.scope = v;
    else if ((v = eat("--name")) !== undefined) out.name = v;
    else if ((v = eat("--token")) !== undefined) out.token = v;
    else if (!a.startsWith("-") && !out.url) {
      if (!out.mode && (a === "dev" || a === "prod")) out.mode = a;
      else out.url = a;
    }
  }
  return out;
}

/**
 * Normalize a user-supplied app URL: trim, require http/https, strip the
 * trailing slash. Throws a friendly Error otherwise.
 */
export function normalizeUrl(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    throw new Error("Missing app URL. Usage: agent-native connect <url>");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      `Not a valid URL: "${raw}". Pass a full origin, e.g. ` +
        `agent-native connect https://mail.agent-native.com`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Unsupported URL scheme "${parsed.protocol}". Use http:// or https://`,
    );
  }
  const host = parsed.hostname.toLowerCase();
  const isLoopback =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host.startsWith("127.");
  if (parsed.protocol === "http:" && !isLoopback) {
    throw new Error(
      `Refusing plaintext HTTP for non-loopback host "${parsed.hostname}". ` +
        `Use https:// so bearer tokens are not sent in cleartext.`,
    );
  }
  // origin + pathname, trailing slash stripped (origin keeps no path).
  const base = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
  return base;
}

/** Resolve the requested clients list. "all" → every supported client. */
export function resolveClients(client: string): ClientId[] {
  const c = (client ?? "all").toLowerCase();
  if (c === "all" || c === "") return [...CLIENTS];
  if ((CLIENTS as string[]).includes(c)) return [c as ClientId];
  throw new Error(
    `Unknown --client "${client}". Use: all, ${CLIENTS.join(", ")}`,
  );
}

export function connectPreferencesPath(): string {
  return path.join(os.homedir(), ".agent-native", "connect.json");
}

function normalizeClientIds(values: unknown): ClientId[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<ClientId>();
  const out: ClientId[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const id = value.toLowerCase();
    if (!(CLIENTS as string[]).includes(id)) continue;
    const client = id as ClientId;
    if (seen.has(client)) continue;
    seen.add(client);
    out.push(client);
  }
  return out;
}

export function readConnectClientPreferences(
  file: string = connectPreferencesPath(),
): ClientId[] | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    const clients = normalizeClientIds(
      parsed?.defaultClients ?? parsed?.clients,
    );
    return clients.length > 0 ? clients : null;
  } catch {
    return null;
  }
}

export function writeConnectClientPreferences(
  clients: ClientId[],
  file: string = connectPreferencesPath(),
): void {
  const normalized = normalizeClientIds(clients);
  if (normalized.length === 0) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        version: CONNECT_PREFERENCES_VERSION,
        defaultClients: normalized,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  );
}

export interface ConnectClientPromptContext {
  initialClients: ClientId[];
  options: { value: ClientId; label: string; hint: string }[];
  preferencesFile: string;
}

export interface HostedApp {
  name: string;
  label: string;
  url: string;
}

export interface ConnectHostedAppsPromptContext {
  apps: HostedApp[];
  initialApps: string[];
}

function clientPromptOptions(): ConnectClientPromptContext["options"] {
  return CLIENTS.map((client) => ({
    value: client,
    label: CLIENT_LABELS[client],
    hint: CLIENT_HINTS[client],
  }));
}

function shouldPrompt(deps: ConnectDeps): boolean {
  if (deps.isInteractive) return deps.isInteractive();
  if (process.env.AGENT_NATIVE_NO_PROMPT === "1") return false;
  if (process.env.CI === "true") return false;
  return !!process.stdin.isTTY && !!process.stdout.isTTY;
}

function shouldPromptForClients(deps: ConnectDeps): boolean {
  return shouldPrompt(deps);
}

async function promptForClients(
  context: ConnectClientPromptContext,
): Promise<ClientId[] | null> {
  const clack = await import("@clack/prompts");
  const result = await clack.multiselect({
    message:
      "Write MCP config for which local agents?\n" +
      "  (space toggles, enter confirms; saved for next time)",
    options: context.options,
    initialValues: context.initialClients,
    required: true,
  });
  if (clack.isCancel(result)) {
    clack.cancel("Cancelled.");
    return null;
  }
  return normalizeClientIds(result);
}

function normalizeHostedAppNames(values: unknown, apps: HostedApp[]): string[] {
  if (!Array.isArray(values)) return [];
  const byName = new Map(apps.map((app) => [app.name, app]));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const app = byName.get(value);
    if (!app || seen.has(app.name)) continue;
    seen.add(app.name);
    out.push(app.name);
  }
  return out;
}

async function promptForHostedApps(
  context: ConnectHostedAppsPromptContext,
): Promise<string[] | null> {
  const clack = await import("@clack/prompts");
  const result = await clack.multiselect({
    message:
      "Which Agent Native apps do you want to connect?\n" +
      "  (all are selected by default; space toggles, enter confirms)",
    options: context.apps.map((app) => ({
      value: app.name,
      label: app.label,
      hint: app.url,
    })),
    initialValues: context.initialApps,
    required: true,
  });
  if (clack.isCancel(result)) {
    clack.cancel("Cancelled.");
    return null;
  }
  return normalizeHostedAppNames(result, context.apps);
}

async function resolveConnectClients(
  parsed: ParsedConnectArgs,
  deps: ConnectDeps,
): Promise<ClientId[] | null> {
  if (parsed.clientExplicit) return resolveClients(parsed.client);

  const defaultClients = resolveClients(parsed.client);
  if (!shouldPromptForClients(deps)) return defaultClients;

  const preferencesFile = deps.preferencesFile ?? connectPreferencesPath();
  const initialClients =
    readConnectClientPreferences(preferencesFile) ?? defaultClients;
  const prompt = deps.promptClients ?? promptForClients;
  const selected = normalizeClientIds(
    await prompt({
      initialClients,
      options: clientPromptOptions(),
      preferencesFile,
    }),
  );
  if (selected.length === 0) return null;

  try {
    writeConnectClientPreferences(selected, preferencesFile);
  } catch (err: any) {
    logErr(
      `  Could not save connect client preference (${err?.message ?? err}).`,
    );
  }
  return selected;
}

async function resolveHostedAppsFromPrompt(
  deps: ConnectDeps,
): Promise<HostedApp[] | null> {
  const apps = hostedApps();
  if (apps.length === 0) {
    logErr("  No hosted first-party apps found in the template registry.");
    return null;
  }
  if (!shouldPrompt(deps)) return null;

  const prompt = deps.promptHostedApps ?? promptForHostedApps;
  const selectedNames = normalizeHostedAppNames(
    await prompt({
      apps,
      initialApps: apps.map((app) => app.name),
    }),
    apps,
  );
  if (selectedNames.length === 0) return [];

  const selected = new Set(selectedNames);
  return apps.filter((app) => selected.has(app.name));
}

function clientArgForDeviceFlow(clients: ClientId[]): string {
  return clients.length === 1 ? clients[0] : "all";
}

export function supportsRemoteMcpOAuth(client: ClientId): boolean {
  return REMOTE_MCP_OAUTH_CLIENTS.has(client);
}

function clientLabelList(clients: ClientId[]): string {
  return clients.map((client) => CLIENT_LABELS[client]).join(", ");
}

function withFullCatalogHeader(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  return { ...(headers ?? {}), [MCP_FULL_CATALOG_HEADER]: "1" };
}

/** Derive an app slug from a deployed origin, e.g. mail.agent-native.com → mail. */
function appSlugFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname;
    const first = host.split(".")[0];
    return first && first !== "www" ? first : "app";
  } catch {
    return "app";
  }
}

function defaultServerName(url: string): string {
  return `${SERVER_NAME_PREFIX}-${appSlugFromUrl(url)}`;
}

// ---------------------------------------------------------------------------
// Browser open (mirrors workspace-dev.ts openBrowser)
// ---------------------------------------------------------------------------

function openInBrowser(url: string): void {
  if (process.env.AGENT_NATIVE_NO_OPEN === "1") return;
  try {
    const command =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "cmd"
          : "xdg-open";
    const openArgs =
      process.platform === "win32" ? ["/c", "start", "", url] : [url];
    const child = spawn(command, openArgs, {
      stdio: "ignore",
      detached: true,
    });
    child.unref();
  } catch {
    // Non-fatal: the user can open the URL manually (we already printed it).
  }
}

// ---------------------------------------------------------------------------
// Device-code flow
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

/** Injectable hooks so the poll state machine is unit-testable. */
export interface ConnectDeps {
  /** Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Sleep between polls (ms). Defaults to real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Open the verification URL. Defaults to the platform browser opener. */
  openBrowser?: (url: string) => void;
  /** Override "now" for the expiry cap (ms epoch). Defaults to Date.now. */
  now?: () => number;
  /** Tests/embedders can force or suppress the interactive client picker. */
  isInteractive?: () => boolean;
  /** Injectable client picker. Defaults to @clack/prompts multiselect. */
  promptClients?: (
    context: ConnectClientPromptContext,
  ) => Promise<ClientId[] | null>;
  /** Injectable hosted app picker. Defaults to @clack/prompts multiselect. */
  promptHostedApps?: (
    context: ConnectHostedAppsPromptContext,
  ) => Promise<string[] | null>;
  /** Override the persisted connect preferences file. */
  preferencesFile?: string;
  /** Override the saved dev/prod profile file. */
  profilesFile?: string;
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function responseMessage(json: any, fallback: string): string {
  const message =
    typeof json?.message === "string"
      ? json.message
      : typeof json?.error === "string"
        ? json.error
        : "";
  return message.trim() || fallback;
}

function stripMcpPath(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  const pathname = parsed.pathname.replace(/\/+$/, "");
  if (pathname === MCP_PATH || pathname.endsWith(MCP_PATH)) {
    parsed.pathname = pathname.slice(0, -MCP_PATH.length) || "/";
    parsed.search = "";
    parsed.hash = "";
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
  }
  return baseUrl;
}

function mcpUrlForBaseUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  const pathname = parsed.pathname.replace(/\/+$/, "");
  if (pathname === MCP_PATH || pathname.endsWith(MCP_PATH)) {
    parsed.pathname = pathname;
    parsed.search = "";
    parsed.hash = "";
    return `${parsed.origin}${parsed.pathname}`;
  }
  return `${baseUrl.replace(/\/+$/, "")}${MCP_PATH}`;
}

async function validateOAuthMcpServer(
  baseUrl: string,
  mcpUrl: string,
  deps: ConnectDeps,
): Promise<boolean> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const metadataUrl = `${baseUrl}/.well-known/oauth-protected-resource`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(metadataUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      logErr(
        `  Could not validate OAuth MCP support at ${metadataUrl} ` +
          `(HTTP ${response.status}).`,
      );
      return false;
    }
    const metadata = (await response.json().catch(() => null)) as {
      resource?: unknown;
    } | null;
    if (metadata?.resource !== mcpUrl) {
      logErr(
        `  ${metadataUrl} did not advertise the expected MCP resource ` +
          `${mcpUrl}.`,
      );
      return false;
    }
    return true;
  } catch (err: any) {
    logErr(
      `  Could not reach ${metadataUrl} (${err?.message ?? err}). ` +
        `Check the URL and your network.`,
    );
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Run the device-code flow against `baseUrl` and return the approved grant.
 * Resolves with `null` (and prints a clear message) on expired/consumed or
 * other terminal failure — the caller maps that to a non-zero exit.
 */
export async function runDeviceFlow(
  baseUrl: string,
  appSlug: string,
  clientArg: string,
  deps: ConnectDeps = {},
): Promise<{
  token?: string;
  mcpUrl: string;
  serverName: string;
  headers?: Record<string, string>;
} | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? realSleep;
  const open = deps.openBrowser ?? openInBrowser;
  const now = deps.now ?? (() => Date.now());

  let start: DeviceStartResponse;
  try {
    const { status, json } = await postJson(
      fetchImpl,
      `${baseUrl}${DEVICE_START_PATH}`,
      { client: clientArg, app: appSlug },
    );
    if (status < 200 || status >= 300 || !json?.device_code) {
      logErr(
        `  Could not start the connect flow on ${baseUrl} ` +
          `(HTTP ${status}). Is this an agent-native app, and is it ` +
          `deployed with the connect endpoint enabled?`,
      );
      return null;
    }
    start = json as DeviceStartResponse;
  } catch (err: any) {
    logErr(
      `  Could not reach ${baseUrl} (${err?.message ?? err}). ` +
        `Check the URL and your network.`,
    );
    return null;
  }

  const interval = Math.max(1, Number(start.interval) || 5);
  const expiresIn = Math.max(interval, Number(start.expires_in) || 600);
  const deadline = now() + expiresIn * 1000;

  logOut("");
  logOut(`  Connecting to ${baseUrl}`);
  logOut("");
  logOut(`  Your code:  ${start.user_code}`);
  logOut(`  Open:       ${start.verification_uri_complete}`);
  logOut("");
  logOut("  Approve in the browser to finish. Opening it now…");
  open(start.verification_uri_complete);

  let spin = 0;
  const isTTY = !!process.stdout.isTTY;
  while (now() < deadline) {
    let poll: DevicePollResponse;
    try {
      const { status, json } = await postJson(
        fetchImpl,
        `${baseUrl}${DEVICE_POLL_PATH}`,
        { device_code: start.device_code },
      );
      if (status < 200 || status >= 300) {
        if (isTTY) process.stdout.write("\r\x1b[K");
        logErr(
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
      if (isTTY) process.stdout.write("\r\x1b[K");
      const token = poll.token ?? "";
      const mcpUrl = poll.mcpUrl ?? `${baseUrl}/_agent-native/mcp`;
      const serverName = poll.serverName ?? `${SERVER_NAME_PREFIX}-${appSlug}`;
      const headers =
        poll.mcpServerEntry &&
        typeof poll.mcpServerEntry === "object" &&
        poll.mcpServerEntry.headers &&
        typeof poll.mcpServerEntry.headers === "object"
          ? (poll.mcpServerEntry.headers as Record<string, string>)
          : undefined;
      logOut("  Approved.");
      return { token: token || undefined, mcpUrl, serverName, headers };
    }
    if (poll.status === "expired") {
      if (isTTY) process.stdout.write("\r\x1b[K");
      logErr("  The connect request expired before it was approved.");
      logErr("  Run the command again to retry.");
      return null;
    }
    if (poll.status === "consumed") {
      if (isTTY) process.stdout.write("\r\x1b[K");
      logErr("  This connect code was already used. Run the command again.");
      return null;
    }
    if (poll.status === "error" || poll.status === "not_found") {
      if (isTTY) process.stdout.write("\r\x1b[K");
      logErr(
        `  Connect polling failed: ${responseMessage(
          poll,
          poll.status === "not_found"
            ? "device code was not found."
            : "server returned an error.",
        )}`,
      );
      return null;
    }

    if (isTTY) {
      process.stdout.write(
        `\r  ${SPINNER[spin++ % SPINNER.length]} Waiting for approval…`,
      );
    }
    await sleep(interval * 1000);
  }

  if (isTTY) process.stdout.write("\r\x1b[K");
  logErr("  Timed out waiting for approval. Run the command again to retry.");
  return null;
}

// ---------------------------------------------------------------------------
// Writing config(s)
// ---------------------------------------------------------------------------

function projectBaseDir(): string {
  const cwd = process.cwd();
  return findWorkspaceRoot(cwd) ?? path.resolve(cwd);
}

/**
 * Write the HTTP MCP entry into every requested client config idempotently.
 * Returns the list of files written so the caller can print them.
 */
export function writeConfigs(
  clients: ClientId[],
  serverName: string,
  mcpUrl: string,
  token: string | undefined,
  scope: string,
  baseDir: string = projectBaseDir(),
  headers?: Record<string, string>,
): { client: ClientId; file: string }[] {
  const written: { client: ClientId; file: string }[] = [];
  for (const client of clients) {
    const file = writeHttpEntryForClient(
      client,
      serverName,
      mcpUrl,
      token,
      baseDir,
      scope,
      headers,
    );
    written.push({ client, file });
  }
  return written;
}

// ---------------------------------------------------------------------------
// Developer profile switcher (`connect dev` / `connect prod`)
// ---------------------------------------------------------------------------

type SavedMcpEntry =
  | {
      kind: "json";
      entry: Record<string, unknown>;
      savedAt: string;
    }
  | {
      kind: "codex";
      block: string;
      savedAt: string;
    };

interface ConnectProfiles {
  version: number;
  updatedAt?: string;
  prodEntries?: Record<string, Record<string, Record<string, SavedMcpEntry>>>;
}

interface CurrentMcpEntry {
  file: string;
  saved?: SavedMcpEntry;
}

interface ConnectableApp extends HostedApp {
  core: boolean;
}

export function connectProfilesPath(): string {
  return path.join(os.homedir(), ".agent-native", "connect-profiles.json");
}

function readConnectProfiles(file: string): ConnectProfiles {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (parsed && typeof parsed === "object") {
      return {
        version: Number(parsed.version) || CONNECT_PROFILES_VERSION,
        updatedAt:
          typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
        prodEntries:
          parsed.prodEntries && typeof parsed.prodEntries === "object"
            ? parsed.prodEntries
            : {},
      };
    }
  } catch {
    // no saved profiles yet
  }
  return { version: CONNECT_PROFILES_VERSION, prodEntries: {} };
}

function writeConnectProfiles(file: string, profiles: ConnectProfiles): void {
  profiles.version = CONNECT_PROFILES_VERSION;
  profiles.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(profiles, null, 2) + "\n", "utf-8");
}

function savedProfileEntry(
  profiles: ConnectProfiles,
  serverName: string,
  client: ClientId,
  file: string,
): SavedMcpEntry | undefined {
  return profiles.prodEntries?.[serverName]?.[client]?.[file];
}

function setSavedProfileEntry(
  profiles: ConnectProfiles,
  serverName: string,
  client: ClientId,
  file: string,
  entry: SavedMcpEntry,
): void {
  profiles.prodEntries ??= {};
  profiles.prodEntries[serverName] ??= {};
  profiles.prodEntries[serverName][client] ??= {};
  profiles.prodEntries[serverName][client][file] = entry;
}

function readJsonMcpServerEntry(
  file: string,
  serverName: string,
): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    const entry = parsed?.mcpServers?.[serverName];
    return entry && typeof entry === "object" ? entry : undefined;
  } catch {
    return undefined;
  }
}

function tomlQuoteForRead(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function codexHeadersForRead(name: string): string[] {
  const headers = [`[mcp_servers.${tomlQuoteForRead(name)}]`];
  if (/^[A-Za-z0-9_-]+$/.test(name)) headers.push(`[mcp_servers.${name}]`);
  return headers;
}

function readCodexMcpBlock(
  file: string,
  serverName: string,
): string | undefined {
  let content = "";
  try {
    content = fs.readFileSync(file, "utf-8");
  } catch {
    return undefined;
  }
  const headers = new Set(codexHeadersForRead(serverName));
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!headers.has(lines[i].trim())) continue;
    const block: string[] = [lines[i]];
    i++;
    while (i < lines.length && !/^\s*\[/.test(lines[i])) {
      block.push(lines[i]);
      i++;
    }
    return block.join("\n").replace(/\n*$/, "") + "\n";
  }
  return undefined;
}

function readCurrentMcpEntry(
  client: ClientId,
  serverName: string,
  baseDir: string,
  scope: string,
): CurrentMcpEntry {
  const file = configPathFor(client, baseDir, scope);
  if (client === "codex") {
    const block = readCodexMcpBlock(file, serverName);
    return {
      file,
      saved: block
        ? { kind: "codex", block, savedAt: new Date().toISOString() }
        : undefined,
    };
  }
  const entry = readJsonMcpServerEntry(file, serverName);
  return {
    file,
    saved: entry
      ? { kind: "json", entry, savedAt: new Date().toISOString() }
      : undefined,
  };
}

function writeSavedMcpEntry(
  client: ClientId,
  file: string,
  serverName: string,
  saved: SavedMcpEntry,
): void {
  if (client === "codex") {
    if (saved.kind !== "codex") return;
    writeCodexBlock(file, serverName, saved.block);
    return;
  }
  if (saved.kind !== "json") return;
  writeJsonMcpEntry(file, serverName, saved.entry);
}

function unescapeTomlString(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function parseCodexHeaders(block: string): Record<string, string> {
  const line = block
    .split(/\r?\n/)
    .find((candidate) => /^\s*http_headers\s*=/.test(candidate));
  if (!line) return {};
  const match = line.match(/\{(.*)\}/);
  if (!match) return {};
  const headers: Record<string, string> = {};
  const pairRe = /"((?:\\.|[^"])*)"\s*=\s*"((?:\\.|[^"])*)"/g;
  let pair: RegExpExecArray | null;
  while ((pair = pairRe.exec(match[1]))) {
    headers[unescapeTomlString(pair[1])] = unescapeTomlString(pair[2]);
  }
  return headers;
}

function savedEntryUrl(saved: SavedMcpEntry | undefined): string | undefined {
  if (!saved) return undefined;
  if (saved.kind === "json") {
    return typeof saved.entry.url === "string" ? saved.entry.url : undefined;
  }
  const match = saved.block.match(/^\s*url\s*=\s*"((?:\\.|[^"])*)"/m);
  return match ? unescapeTomlString(match[1]) : undefined;
}

function savedEntryHeaders(
  saved: SavedMcpEntry | undefined,
): Record<string, string> {
  if (!saved) return {};
  if (saved.kind === "json") {
    const headers = saved.entry.headers;
    return headers && typeof headers === "object"
      ? Object.fromEntries(
          Object.entries(headers as Record<string, unknown>)
            .filter((entry): entry is [string, string] => {
              return typeof entry[1] === "string";
            })
            .map(([key, value]) => [key, value]),
        )
      : {};
  }
  return parseCodexHeaders(saved.block);
}

function isLoopbackMcpUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1" ||
      url.hostname.startsWith("127.")
    );
  } catch {
    return false;
  }
}

function decodeJwtSub(authHeader: string | undefined): string | undefined {
  if (!authHeader?.startsWith("Bearer ")) return undefined;
  const token = authHeader.slice("Bearer ".length);
  const [, payload] = token.split(".");
  if (!payload) return undefined;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const parsed = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    return typeof parsed.sub === "string" && parsed.sub.includes("@")
      ? parsed.sub
      : undefined;
  } catch {
    return undefined;
  }
}

function ownerEmailFromEntry(
  saved: SavedMcpEntry | undefined,
): string | undefined {
  const headers = savedEntryHeaders(saved);
  return (
    headers["X-Agent-Native-Owner-Email"] || decodeJwtSub(headers.Authorization)
  );
}

function readEnvFile(file: string): string {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return "";
  }
}

function readEnvValue(content: string, key: string): string | undefined {
  let found: string | undefined;
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (match?.[1] === key) {
      found = match[2].replace(/^["']|["']$/g, "");
    }
  }
  return found;
}

function workspaceEnvContent(baseDir: string): string {
  return (
    readEnvFile(path.join(baseDir, ".env.local")) +
    "\n" +
    readEnvFile(path.join(baseDir, ".env"))
  );
}

function localAccessToken(baseDir: string): string | undefined {
  const content = workspaceEnvContent(baseDir);
  const single = readEnvValue(content, "ACCESS_TOKEN");
  if (single) return single;
  const multi = readEnvValue(content, "ACCESS_TOKENS");
  return multi
    ?.split(",")
    .map((token) => token.trim())
    .find(Boolean);
}

function localA2ASecret(baseDir: string): string | undefined {
  return (
    process.env.A2A_SECRET ||
    readEnvValue(workspaceEnvContent(baseDir), "A2A_SECRET")
  );
}

async function mintLocalA2AToken(
  ownerEmail: string | undefined,
  baseDir: string,
): Promise<string | undefined> {
  const secret = ownerEmail ? localA2ASecret(baseDir) : undefined;
  if (!secret) return undefined;
  const jose = await import("jose");
  return new jose.SignJWT({ sub: ownerEmail })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("agent-native-connect-dev")
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(new TextEncoder().encode(secret));
}

async function devHeadersForApp(params: {
  ownerEmail?: string;
  sourceEntry?: SavedMcpEntry;
  baseDir: string;
}): Promise<Record<string, string> | undefined> {
  const ownerEmail =
    params.ownerEmail ||
    process.env.AGENT_NATIVE_OWNER_EMAIL ||
    ownerEmailFromEntry(params.sourceEntry);
  const headers: Record<string, string> = {};
  const accessToken = localAccessToken(params.baseDir);
  const a2aToken = accessToken
    ? undefined
    : await mintLocalA2AToken(ownerEmail, params.baseDir);
  if (accessToken || a2aToken) {
    headers.Authorization = `Bearer ${accessToken || a2aToken}`;
  }
  if (ownerEmail) {
    headers["X-Agent-Native-Owner-Email"] = ownerEmail;
  }
  return Object.keys(headers).length
    ? withFullCatalogHeader(headers)
    : undefined;
}

function connectableApps(includeHidden = false): ConnectableApp[] {
  const source = includeHidden ? TEMPLATES : visibleTemplates();
  return source
    .filter((template) => typeof template.prodUrl === "string")
    .map((template) => ({
      name: template.name,
      label: template.label,
      url: template.prodUrl as string,
      core: !!template.core,
    }));
}

function profileDefaultApps(): ConnectableApp[] {
  const core = connectableApps(false).filter((app) => app.core);
  return core.length ? core : connectableApps(false);
}

function parseAppsList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((app) => app.trim())
    .filter(Boolean);
}

async function resolveProfileApps(
  parsed: ParsedConnectArgs,
  deps: ConnectDeps,
): Promise<ConnectableApp[] | null> {
  const allVisible = connectableApps(false);
  const allIncludingHidden = connectableApps(true);

  if (parsed.apps) {
    const requested = parseAppsList(parsed.apps);
    if (requested.includes("all")) return allVisible;
    const byName = new Map(allIncludingHidden.map((app) => [app.name, app]));
    const unknown = requested.filter((name) => !byName.has(name));
    if (unknown.length) {
      throw new Error(
        `Unknown app(s): ${unknown.join(", ")}. Known apps: ${allIncludingHidden
          .map((app) => app.name)
          .join(", ")}`,
      );
    }
    return requested.map((name) => byName.get(name)!);
  }

  if (parsed.all) return allVisible;

  if (shouldPrompt(deps)) {
    const prompt = deps.promptHostedApps ?? promptForHostedApps;
    const initialApps = profileDefaultApps().map((app) => app.name);
    const selectedNames = normalizeHostedAppNames(
      await prompt({ apps: allVisible, initialApps }),
      allVisible,
    );
    if (selectedNames.length === 0) return [];
    const selected = new Set(selectedNames);
    return allVisible.filter((app) => selected.has(app.name));
  }

  return profileDefaultApps();
}

function defaultDevGateway(): string {
  if (process.env.WORKSPACE_GATEWAY_URL)
    return process.env.WORKSPACE_GATEWAY_URL;
  const port = process.env.WORKSPACE_PORT || process.env.PORT;
  return port ? `http://127.0.0.1:${port}` : DEFAULT_DEV_GATEWAY;
}

function normalizeDevGateway(parsed: ParsedConnectArgs): string {
  const raw =
    parsed.gateway ||
    (Number.isFinite(parsed.port) && parsed.port
      ? `http://127.0.0.1:${parsed.port}`
      : defaultDevGateway());
  const normalized = normalizeUrl(raw);
  return normalized.replace(/\/+$/, "");
}

async function gatewayAppUrls(
  gatewayUrl: string,
  deps: ConnectDeps,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${gatewayUrl}/_workspace/apps`, {
      signal: AbortSignal.timeout(1200),
    });
    if (!response.ok) return out;
    const apps = (await response.json()) as unknown;
    if (!Array.isArray(apps)) return out;
    for (const app of apps) {
      if (!app || typeof app !== "object") continue;
      const id = (app as { id?: unknown }).id;
      const url = (app as { url?: unknown }).url;
      if (typeof id === "string" && typeof url === "string") {
        out.set(id, normalizeUrl(url));
      }
    }
  } catch {
    // The gateway may not be running yet; still write deterministic dev URLs.
  }
  return out;
}

function devMcpUrl(
  app: ConnectableApp,
  gatewayUrl: string,
  gatewayUrls: Map<string, string>,
): string {
  const base = gatewayUrls.get(app.name) ?? `${gatewayUrl}/${app.name}`;
  return `${base.replace(/\/+$/, "")}/_agent-native/mcp`;
}

function serverNameForApp(app: ConnectableApp): string {
  return `${SERVER_NAME_PREFIX}-${app.name}`;
}

async function connectDevProfile(
  parsed: ParsedConnectArgs,
  clients: ClientId[],
  deps: ConnectDeps,
): Promise<boolean> {
  const apps = await resolveProfileApps(parsed, deps);
  if (!apps || apps.length === 0) return true;

  const baseDir = projectBaseDir();
  const scope = parsed.scope === "project" ? "project" : "user";
  const gatewayUrl = normalizeDevGateway(parsed);
  const gatewayUrls = await gatewayAppUrls(gatewayUrl, deps);
  const profilesFile = deps.profilesFile ?? connectProfilesPath();
  const profiles = readConnectProfiles(profilesFile);
  const rows: { app: string; client: string; status: string; file: string }[] =
    [];
  const ownerWarnings = new Set<string>();

  for (const app of apps) {
    const serverName = serverNameForApp(app);
    const mcpUrl = devMcpUrl(app, gatewayUrl, gatewayUrls);

    for (const client of clients) {
      const current = readCurrentMcpEntry(client, serverName, baseDir, scope);
      const backup = savedProfileEntry(
        profiles,
        serverName,
        client,
        current.file,
      );
      if (current.saved && !isLoopbackMcpUrl(savedEntryUrl(current.saved))) {
        setSavedProfileEntry(
          profiles,
          serverName,
          client,
          current.file,
          current.saved,
        );
      }
      const sourceEntry =
        current.saved && !isLoopbackMcpUrl(savedEntryUrl(current.saved))
          ? current.saved
          : backup;
      const headers = await devHeadersForApp({
        ownerEmail: parsed.ownerEmail,
        sourceEntry,
        baseDir,
      });
      if (!headers?.["X-Agent-Native-Owner-Email"]) {
        ownerWarnings.add(app.name);
      }
      const file = writeHttpEntryForClient(
        client,
        serverName,
        mcpUrl,
        undefined,
        baseDir,
        scope,
        headers,
      );
      rows.push({
        app: app.name,
        client,
        status: "dev",
        file,
      });
    }
  }

  writeConnectProfiles(profilesFile, profiles);

  logOut("");
  logOut(`  Switched ${apps.length} app(s) to dev via ${gatewayUrl}`);
  for (const row of rows) {
    logOut(`    ${row.app.padEnd(12)} ${row.client.padEnd(18)} ${row.file}`);
  }
  if (ownerWarnings.size) {
    logOut("");
    logOut(
      `  Tip: pass --owner-email <you@example.com> if local tools look sparse ` +
        `for ${Array.from(ownerWarnings).join(", ")}.`,
    );
  }
  logOut("");
  logOut("  Restart your coding agent to pick up the dev MCP servers.");
  return true;
}

async function connectProdProfile(
  parsed: ParsedConnectArgs,
  clients: ClientId[],
  deps: ConnectDeps,
): Promise<boolean> {
  const apps = await resolveProfileApps(parsed, deps);
  if (!apps || apps.length === 0) return true;

  const baseDir = projectBaseDir();
  const scope = parsed.scope === "project" ? "project" : "user";
  const profilesFile = deps.profilesFile ?? connectProfilesPath();
  const profiles = readConnectProfiles(profilesFile);
  const restored: { app: string; client: string; file: string }[] = [];
  const missing: { app: string; client: string }[] = [];

  for (const app of apps) {
    const serverName = serverNameForApp(app);
    for (const client of clients) {
      const file = configPathFor(client, baseDir, scope);
      const saved = savedProfileEntry(profiles, serverName, client, file);
      if (!saved) {
        missing.push({ app: app.name, client });
        continue;
      }
      writeSavedMcpEntry(client, file, serverName, saved);
      restored.push({ app: app.name, client, file });
    }
  }

  logOut("");
  if (restored.length) {
    logOut(
      `  Restored ${restored.length} production MCP entr${restored.length === 1 ? "y" : "ies"}.`,
    );
    for (const row of restored) {
      logOut(`    ${row.app.padEnd(12)} ${row.client.padEnd(18)} ${row.file}`);
    }
  }
  if (missing.length) {
    logOut("");
    logOut("  No saved production entry for:");
    for (const row of missing) {
      const app = apps.find((candidate) => candidate.name === row.app);
      logOut(
        `    ${row.app.padEnd(12)} ${row.client.padEnd(18)} ` +
          `run: agent-native connect ${app?.url ?? "<url>"} --client ${row.client}`,
      );
    }
  }
  logOut("");
  logOut("  Restart your coding agent to pick up the production MCP servers.");
  return missing.length === 0;
}

// ---------------------------------------------------------------------------
// Single-app connect
// ---------------------------------------------------------------------------

async function connectOne(
  rawUrl: string,
  parsed: ParsedConnectArgs,
  clients: ClientId[],
  deps: ConnectDeps,
): Promise<{ ok: boolean; serverName?: string; files?: string[] }> {
  const normalizedUrl = normalizeUrl(rawUrl);
  const baseUrl = stripMcpPath(normalizedUrl);
  const normalizedMcpUrl = mcpUrlForBaseUrl(normalizedUrl);
  const appSlug = appSlugFromUrl(baseUrl);
  const scope = parsed.scope === "user" ? "user" : "project";
  const baseDir = projectBaseDir();
  const allWritten: { client: ClientId; file: string }[] = [];
  const oauthClients = parsed.token
    ? []
    : clients.filter((client) => supportsRemoteMcpOAuth(client));
  const deviceFlowClients = parsed.token
    ? clients
    : clients.filter((client) => !supportsRemoteMcpOAuth(client));
  const oauthMigrations: ClientId[] = [];

  let token: string | undefined;
  let mcpUrl: string;
  let serverName: string;
  let headers: Record<string, string> | undefined;

  if (parsed.token) {
    // No-browser fallback: skip the device flow entirely.
    token = parsed.token;
    mcpUrl = normalizedMcpUrl;
    serverName = parsed.name ?? defaultServerName(baseUrl);
    logOut("");
    logOut(`  Using supplied --token for ${baseUrl} (skipping browser flow).`);
  } else if (deviceFlowClients.length === 0) {
    token = undefined;
    mcpUrl = normalizedMcpUrl;
    serverName = parsed.name ?? defaultServerName(baseUrl);
  } else {
    const grant = await runDeviceFlow(
      baseUrl,
      appSlug,
      clientArgForDeviceFlow(deviceFlowClients),
      deps,
    );
    if (!grant) return { ok: false };
    token = grant.token;
    mcpUrl = grant.mcpUrl;
    serverName = parsed.name ?? grant.serverName ?? defaultServerName(baseUrl);
    headers = grant.headers;
  }

  if (oauthClients.length > 0 && !parsed.token) {
    if (!(await validateOAuthMcpServer(baseUrl, mcpUrl, deps))) {
      return { ok: false };
    }
  }

  if (deviceFlowClients.length > 0) {
    allWritten.push(
      ...writeConfigs(
        deviceFlowClients,
        serverName,
        mcpUrl,
        token,
        scope,
        baseDir,
        withFullCatalogHeader(headers),
      ),
    );
  }

  if (oauthClients.length > 0) {
    for (const client of oauthClients) {
      const current = readCurrentMcpEntry(client, serverName, baseDir, scope);
      const currentHeaders = savedEntryHeaders(current.saved);
      if (typeof currentHeaders.Authorization === "string") {
        oauthMigrations.push(client);
      }
    }
    allWritten.push(
      ...writeConfigs(
        oauthClients,
        serverName,
        mcpUrl,
        undefined,
        scope,
        baseDir,
        undefined,
      ),
    );
  }

  logOut("");
  logOut(`  Configured "${serverName}" → ${mcpUrl}`);
  for (const w of allWritten) {
    logOut(`    ${w.client.padEnd(18)} ${w.file}`);
  }
  if (oauthClients.length > 0 && !parsed.token) {
    logOut("");
    if (oauthMigrations.length > 0) {
      logOut(
        `  Replaced legacy bearer headers for ${clientLabelList(
          oauthMigrations,
        )}; it will reconnect with standard MCP OAuth.`,
      );
    }
    logOut(
      `  ${clientLabelList(
        oauthClients,
      )}: wrote URL-only MCP config (no bearer headers).`,
    );
    logOut("  Next: restart Claude Code, run /mcp, and choose Authenticate.");
  }
  logOut("");
  logOut("  Restart your coding agent to pick up the new MCP server.");
  return { ok: true, serverName, files: allWritten.map((w) => w.file) };
}

// ---------------------------------------------------------------------------
// --all : connect every first-party hosted app
// ---------------------------------------------------------------------------

/** Hosted first-party apps: visible (non-hidden) templates with a prodUrl. */
export function hostedApps(): HostedApp[] {
  return visibleTemplates()
    .filter((t) => typeof t.prodUrl === "string" && t.prodUrl.length > 0)
    .map((t) => ({
      name: t.name,
      label: t.label,
      url: t.prodUrl as string,
    }));
}

async function connectApps(
  apps: HostedApp[],
  parsed: ParsedConnectArgs,
  clients: ClientId[],
  deps: ConnectDeps,
): Promise<boolean> {
  if (apps.length === 0) {
    logErr("  No hosted first-party apps found in the template registry.");
    return false;
  }
  logOut("");
  logOut(`  Connecting ${apps.length} first-party hosted apps…`);

  const results: { name: string; status: string; files: string[] }[] = [];
  for (const app of apps) {
    logOut("");
    logOut(`  ── ${app.label} (${app.url}) ──`);
    try {
      const res = await connectOne(app.url, parsed, clients, deps);
      results.push({
        name: app.label,
        status: res.ok ? "connected" : "skipped",
        files: res.files ?? [],
      });
    } catch (err: any) {
      logErr(`  ${app.name}: ${err?.message ?? err}`);
      results.push({ name: app.name, status: "error", files: [] });
    }
  }

  logOut("");
  logOut("  Summary");
  for (const r of results) {
    const files = r.files.length ? r.files.join(", ") : "—";
    logOut(`    ${r.name.padEnd(14)} ${r.status.padEnd(10)} ${files}`);
  }
  return results.every((r) => r.status === "connected");
}

async function connectAll(
  parsed: ParsedConnectArgs,
  clients: ClientId[],
  deps: ConnectDeps,
): Promise<boolean> {
  return connectApps(hostedApps(), parsed, clients, deps);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const HELP = `agent-native connect — wire your coding agent to a deployed app

Usage:
  agent-native connect [--client <c>] [--scope user|project]
      With no URL, opens a picker for the built-in hosted apps
      (mail.agent-native.com, calendar.agent-native.com, and friends).

  agent-native connect <url> [--client <c>] [--scope user|project] [--name <n>]
      Writes the HTTP MCP entry into your selected client config(s). Claude
      Code / Claude Code CLI use standard remote MCP OAuth: restart Claude,
      run /mcp, and choose Authenticate. Codex / Cowork use the browser
      device-code fallback: the command prints a code, opens the verification
      URL, polls until approved, then writes bearer headers. With no --client,
      opens a brief picker preselected from ~/.agent-native/connect.json, or
      all clients on first run. Idempotent — re-running replaces the same entry.
      Re-running over an older Claude bearer entry upgrades it to URL-only
      OAuth config and prompts you to authenticate with /mcp.

      For cross-app access, prefer the unified Dispatch gateway:
      agent-native connect https://dispatch.agent-native.com

  agent-native connect <url> --token <token>
      No-browser fallback. Skip the device flow and write the entry with
      the supplied token (get it from the app's Connect page).

  agent-native connect --all [--client <c>] [--scope user|project]
      Connect every first-party hosted app as separate MCP resources.

Developer:
  agent-native connect dev [--apps mail,calendar] [--client <c>]
      Switch selected first-party MCP entries to a local dev-lazy gateway.
      Defaults to ${DEFAULT_DEV_GATEWAY}; override with --gateway or --port.

  agent-native connect prod [--apps mail,calendar] [--client <c>]
      Restore production MCP entries saved before the dev switch.

Clients:  all (default), claude-code, claude-code-cli, codex, cowork
Scope:    user (default, ~/.claude.json) or project (.mcp.json)`;

/**
 * `agent-native connect` entry point. `deps` is injectable for tests; the
 * dispatcher in index.ts calls it with just `args`.
 *
 * Sets `process.exitCode = 1` on failure (so the process exits non-zero
 * once the event loop drains) rather than calling `process.exit`, keeping
 * the function testable — same pattern as `audit-agent-web`.
 */
export async function runConnect(
  args: string[],
  deps: ConnectDeps = {},
): Promise<void> {
  if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    logOut(HELP);
    return;
  }

  const parsed = parseConnectArgs(args);

  try {
    if (parsed.mode) {
      const clients = await resolveConnectClients(parsed, deps);
      if (!clients) return;
      const ok =
        parsed.mode === "dev"
          ? await connectDevProfile(parsed, clients, deps)
          : await connectProdProfile(parsed, clients, deps);
      if (!ok) process.exitCode = 1;
      return;
    }

    if (parsed.all) {
      const clients = await resolveConnectClients(parsed, deps);
      if (!clients) return;
      const ok = await connectAll(parsed, clients, deps);
      if (!ok) process.exitCode = 1;
      return;
    }

    if (!parsed.url) {
      const apps = await resolveHostedAppsFromPrompt(deps);
      if (apps) {
        if (apps.length === 0) return;
        const clients = await resolveConnectClients(parsed, deps);
        if (!clients) return;
        const ok = await connectApps(apps, parsed, clients, deps);
        if (!ok) process.exitCode = 1;
        return;
      }

      logErr("  Missing app URL.");
      logErr("");
      logOut(HELP);
      process.exitCode = 1;
      return;
    }

    const clients = await resolveConnectClients(parsed, deps);
    if (!clients) return;
    const res = await connectOne(parsed.url, parsed, clients, deps);
    if (!res.ok) process.exitCode = 1;
  } catch (err: any) {
    logErr(`  ${err?.message ?? err}`);
    process.exitCode = 1;
  }
}
