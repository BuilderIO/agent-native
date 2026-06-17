/**
 * `agent-native connect <url>` — wire your local MCP-capable coding agent
 * to a DEPLOYED agent-native app. OAuth-capable clients receive a standard
 * remote MCP URL entry and authenticate in the host. Fallback clients use the
 * browser device-code flow: open the verification URL, approve in the browser,
 * and the minted HTTP MCP server entry is written idempotently.
 *
 *   agent-native connect <url> [--client all|claude-code|
 *                               codex|cowork|cursor|opencode|github-copilot]
 *                               [--scope user|project]
 *                               [--name <serverName>]
 *   agent-native reconnect [<url>] [--client ...] [--name <serverName>]
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
  jsonMcpConfigKeyForClient,
  removeSameUrlDuplicatesForClient,
  writeCodexBlock,
  writeHttpEntryForClient,
  writeJsonMcpEntryForClient,
} from "./mcp-config-writers.js";
import {
  isFirstPartyPlanHost,
  writePlanPublishAuth,
} from "./plan-publish-store.js";
import { TEMPLATES, visibleTemplates } from "./templates-meta.js";

const DEVICE_START_PATH = "/_agent-native/mcp/connect/device/start";
const DEVICE_POLL_PATH = "/_agent-native/mcp/connect/device/poll";
const MCP_PATH = "/_agent-native/mcp";
const SERVER_NAME_PREFIX = "agent-native";
const CONNECT_PREFERENCES_VERSION = 1;

/**
 * Maps a normalised hosted MCP URL to the canonical server name for that
 * first-party app. Kept in sync with BUILT_IN_APP_SKILLS in skills.ts (we
 * cannot import from there — it imports connect.ts, which would be circular).
 */
const CANONICAL_SERVER_NAME_BY_MCP_URL: Readonly<Record<string, string>> = {
  "https://plan.agent-native.com/_agent-native/mcp": "plan",
  "https://assets.agent-native.com/_agent-native/mcp": "agent-native-assets",
  "https://design.agent-native.com/_agent-native/mcp": "agent-native-design",
  "https://context-xray.agent-native.com/_agent-native/mcp":
    "agent-native-context-xray",
};
const LEGACY_SERVER_NAMES_BY_MCP_URL: Readonly<
  Record<string, readonly string[]>
> = {
  "https://plan.agent-native.com/_agent-native/mcp": [
    "agent-native-plan",
    "agent-native-plans",
    "agent-native-visual-plans",
  ],
};
const CONNECT_PROFILES_VERSION = 1;
const DEFAULT_DEV_GATEWAY = "http://127.0.0.1:8080";

const CLIENT_LABELS: Record<ClientId, string> = {
  "claude-code": "Claude Code",
  "claude-code-cli": "Claude Code CLI",
  codex: "Codex",
  cowork: "Claude Cowork",
  cursor: "Cursor",
  opencode: "OpenCode",
  "github-copilot": "GitHub Copilot / VS Code",
};

const CLIENT_HINTS: Record<ClientId, string> = {
  "claude-code": ".mcp.json or ~/.claude.json",
  "claude-code-cli": ".mcp.json or ~/.claude.json",
  codex: "$CODEX_HOME/config.toml or ~/.codex/config.toml",
  cowork: "~/.cowork/mcp.json",
  cursor: ".cursor/mcp.json or ~/.cursor/mcp.json",
  opencode: "opencode.json or ~/.config/opencode/opencode.json",
  "github-copilot": ".vscode/mcp.json or VS Code user mcp.json",
};

const REMOTE_MCP_OAUTH_CLIENTS = new Set<ClientId>([
  "claude-code",
  "claude-code-cli",
  "cursor",
  "opencode",
  "github-copilot",
]);

let logOutImpl = (msg: string) => process.stdout.write(`${msg}\n`);
let logErrImpl = (msg: string) => process.stderr.write(`${msg}\n`);

function logOut(msg: string): void {
  logOutImpl(msg);
}
function logErr(msg: string): void {
  logErrImpl(msg);
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

export interface ParsedConnectArgs {
  /** Developer profile switch: local dev gateway or saved production config. */
  mode?: "dev" | "prod" | "reauth" | "reconnect";
  /** Positional URL (the deployed app origin). Undefined for `--all`. */
  url?: string;
  /** all | claude-code | codex | cowork | cursor | opencode | github-copilot (default "all"). claude-code-cli is accepted as a legacy alias for claude-code. */
  client: string;
  /** True when the user passed --client explicitly, so we skip the picker. */
  clientExplicit: boolean;
  /** user | project (default "user"). */
  scope: string;
  /** Override the minted MCP server name. */
  name?: string;
  /** No-browser fallback: skip device flow, use this token directly. */
  token?: string;
  /**
   * Mint an ORG SERVICE token with this service name (e.g. "ci") instead of
   * writing local MCP configs. Authenticates the human via the device flow,
   * then calls the app's `create-org-service-token` action and prints the
   * token once — for CI secrets like PLAN_RECAP_TOKEN.
   */
  serviceToken?: string;
  /** Optional token TTL in days (1–365) for --service-token. */
  ttlDays?: number;
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
  /**
   * Embed `catalog_scope: "full"` in the minted token so the connected client
   * bypasses the connector-catalog tier and sees the complete action surface.
   * Matches the `fullCatalog` body param on the app's token-mint route.
   */
  fullCatalog?: boolean;
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
    else if ((v = eat("--service-token")) !== undefined) out.serviceToken = v;
    else if ((v = eat("--ttl-days")) !== undefined) out.ttlDays = Number(v);
    else if ((v = eat("--token")) !== undefined) out.token = v;
    else if (a === "--full-catalog") out.fullCatalog = true;
    else if (!a.startsWith("-") && !out.url) {
      if (
        !out.mode &&
        (a === "dev" || a === "prod" || a === "reauth" || a === "reconnect")
      ) {
        out.mode = a;
      } else out.url = a;
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
    throw new Error(
      "Missing app URL. Usage: npx @agent-native/core@latest connect <url>",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      `Not a valid URL: "${raw}". Pass a full origin, e.g. ` +
        `npx @agent-native/core@latest connect https://mail.agent-native.com`,
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

// Clients offered in the interactive picker and expanded by "all". Excludes
// the `claude-code-cli` alias so users only ever see a single "Claude Code"
// option (it still works if passed explicitly via --client).
const SELECTABLE_CLIENTS: ClientId[] = CLIENTS.filter(
  (c) => c !== "claude-code-cli",
);

/** Resolve the requested clients list. "all" → every supported client. */
export function resolveClients(client: string): ClientId[] {
  const c = normalizeClientAlias(client ?? "all");
  if (c === "all" || c === "") return [...SELECTABLE_CLIENTS];
  if (c.includes(",")) {
    const clients = normalizeClientIds(c.split(",").map((part) => part.trim()));
    if (clients.length > 0) return clients;
  }
  if ((CLIENTS as string[]).includes(c)) return [c as ClientId];
  throw new Error(
    `Unknown --client "${client}". Use: all, ${CLIENTS.join(", ")}`,
  );
}

function normalizeClientAlias(value: string): string {
  const id = value.trim().toLowerCase();
  // The Claude Code CLI and desktop share ~/.claude.json, so they are one
  // client. `claude-code-cli` stays accepted for back-compat but collapses to
  // the single "Claude Code" option everywhere it surfaces.
  if (
    id === "claude" ||
    id === "claude-code-desktop" ||
    id === "claude-code-cli"
  )
    return "claude-code";
  if (id === "copilot" || id === "vscode" || id === "vs-code") {
    return "github-copilot";
  }
  return id;
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
    const id = normalizeClientAlias(value);
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
  return SELECTABLE_CLIENTS.map((client) => ({
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

function sentenceClientLabelList(clients: ClientId[]): string {
  const labels = clients.map((client) => CLIENT_LABELS[client]);
  if (labels.length <= 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
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

function clientsNotIn(
  requestedClients: ClientId[],
  effectiveClients: ClientId[],
): ClientId[] {
  const effective = new Set(effectiveClients);
  return requestedClients.filter((client) => !effective.has(client));
}

function displayMcpServerName(serverName: string | undefined): string {
  if (!serverName) return "Agent Native MCP";
  if (serverName === "plan") return "Plan MCP";
  return `"${serverName}" MCP`;
}

async function showReconnectSuccessOutro({
  serverName,
  clients,
}: {
  serverName: string | undefined;
  clients: ClientId[];
}): Promise<void> {
  const lines = [`✅ Reconnected ${displayMcpServerName(serverName)}.`];
  if (clients.includes("codex")) {
    lines.push(
      "Codex: start a new Codex session now; the MCP tools should be available there.",
    );
  }
  const oauthClients = clients.filter((client) =>
    supportsRemoteMcpOAuth(client),
  );
  if (oauthClients.length > 0) {
    lines.push(...oauthNextStepsForClients(oauthClients, serverName));
  }
  if (!clients.includes("codex") && oauthClients.length === 0) {
    lines.push(
      `Restart or reload ${sentenceClientLabelList(
        clients,
      )} before using the MCP tools.`,
    );
  }

  const message = lines.join("\n");
  try {
    const clack = await import("@clack/prompts");
    clack.outro(message);
  } catch {
    logOut("");
    for (const line of lines) logOut(`  ${line}`);
  }
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
  const canonical = canonicalServerNameForMcpUrl(mcpUrlForBaseUrl(url));
  if (canonical) return canonical;
  return `${SERVER_NAME_PREFIX}-${appSlugFromUrl(url)}`;
}

function canonicalServerNameForMcpUrl(
  mcpUrl: string | undefined,
): string | undefined {
  const key = canonicalMcpUrl(mcpUrl);
  return key ? CANONICAL_SERVER_NAME_BY_MCP_URL[key] : undefined;
}

function reconnectServerNameForMcpUrl(
  mcpUrl: string | undefined,
  serverName: string | undefined,
): string | undefined {
  const key = canonicalMcpUrl(mcpUrl);
  if (!key || !serverName) return serverName;
  const canonical = CANONICAL_SERVER_NAME_BY_MCP_URL[key];
  if (!canonical || serverName === canonical) return serverName;
  const legacyNames = LEGACY_SERVER_NAMES_BY_MCP_URL[key] ?? [];
  return legacyNames.includes(serverName) ? canonical : serverName;
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
  /** Optional output hooks used when another clack-based command embeds connect. */
  logOut?: (message: string) => void;
  logErr?: (message: string) => void;
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
  const sleep = deps.sleep ?? realSleep;
  const metadataUrl = `${baseUrl}/.well-known/oauth-protected-resource`;
  let lastFailure = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetchImpl(metadataUrl, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        lastFailure = `HTTP ${response.status}`;
      } else {
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
      }
    } catch (err: any) {
      lastFailure = err?.message ?? String(err);
    } finally {
      clearTimeout(timeout);
    }

    if (attempt === 0) await sleep(500);
  }

  logErr(
    `  Could not validate OAuth MCP support at ${metadataUrl}` +
      (lastFailure ? ` (${lastFailure}).` : "."),
  );
  return false;
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
  options: { fullCatalog?: boolean } = {},
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

  let start: DeviceStartResponse | null = null;
  // A cold/propagating Plan instance can briefly 404/5xx before its connect
  // route is registered (async plugin init). Retry a few times so a recoverable
  // blip doesn't kill the connect before polling even begins.
  const START_ATTEMPTS = 4;
  for (let attempt = 0; attempt < START_ATTEMPTS; attempt++) {
    try {
      const { status, json } = await postJson(
        fetchImpl,
        `${baseUrl}${DEVICE_START_PATH}`,
        {
          client: clientArg,
          app: appSlug,
          ...(options.fullCatalog ? { fullCatalog: true } : {}),
        },
      );
      if (status >= 200 && status < 300 && json?.device_code) {
        start = json as DeviceStartResponse;
        break;
      }
      if ((status === 404 || status >= 500) && attempt < START_ATTEMPTS - 1) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      logErr(
        `  Could not start the connect flow on ${baseUrl} ` +
          `(HTTP ${status}). Is this an agent-native app, and is it ` +
          `deployed with the connect endpoint enabled?`,
      );
      return null;
    } catch (err: any) {
      if (attempt < START_ATTEMPTS - 1) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      logErr(
        `  Could not reach ${baseUrl} (${err?.message ?? err}). ` +
          `Check the URL and your network.`,
      );
      return null;
    }
  }
  if (!start) return null;

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
  let transientStreak = 0;
  // Ride out brief cold-instance blips, but don't poll a persistently-dead
  // endpoint forever: give up after this many consecutive transient (404/5xx
  // or network-error) polls. Reset as soon as one poll responds normally.
  const MAX_TRANSIENT_POLLS = 20;
  const isTTY = !!process.stdout.isTTY;
  while (now() < deadline) {
    let poll: DevicePollResponse;
    let transient = false;
    try {
      const { status, json } = await postJson(
        fetchImpl,
        `${baseUrl}${DEVICE_POLL_PATH}`,
        { device_code: start.device_code },
      );
      if (status < 200 || status >= 300) {
        if (isTerminalPollBody(json)) {
          poll = json as DevicePollResponse;
        } else if (status === 404 || status >= 500) {
          // Transient: a cold/propagating Plan instance can briefly serve a
          // bare 404 (the MCP route isn't registered until async plugin init
          // settles) or a 5xx before it's healthy. The next poll usually lands
          // on a warm instance, so keep polling until the deadline instead of
          // hard-failing the whole connect on a recoverable blip. (This is the
          // recurring "Cannot find any route matching [POST] .../mcp" case.)
          poll = { status: "pending" };
          transient = true;
        } else {
          if (isTTY) process.stdout.write("\r\x1b[K");
          logErr(
            `  Connect polling failed (HTTP ${status}): ` +
              responseMessage(json, "server returned an error."),
          );
          return null;
        }
      } else {
        poll = (json ?? { status: "pending" }) as DevicePollResponse;
      }
    } catch {
      // Transient network error — keep polling.
      poll = { status: "pending" };
      transient = true;
    }

    if (transient) {
      if (++transientStreak > MAX_TRANSIENT_POLLS) {
        if (isTTY) process.stdout.write("\r\x1b[K");
        logErr(
          "  Connect endpoint is not responding (repeated 404/5xx). It may be " +
            "mid-deploy — wait a minute and run the command again.",
        );
        return null;
      }
    } else {
      transientStreak = 0;
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

function isTerminalPollBody(json: any): boolean {
  return (
    json?.status === "not_found" ||
    json?.status === "error" ||
    json?.status === "expired" ||
    json?.status === "consumed"
  );
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
  client: ClientId,
  file: string,
  serverName: string,
): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    const entry = parsed?.[jsonMcpConfigKeyForClient(client)]?.[serverName];
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
  const entry = readJsonMcpServerEntry(client, file, serverName);
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
  writeJsonMcpEntryForClient(client, file, serverName, saved.entry);
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

interface ExistingMcpEntry {
  client: ClientId;
  serverName: string;
  file: string;
  saved: SavedMcpEntry;
  url: string;
}

function readJsonMcpServerEntries(
  client: ClientId,
  file: string,
): { serverName: string; saved: SavedMcpEntry }[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    const servers = parsed?.[jsonMcpConfigKeyForClient(client)];
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
      return [];
    }
    return Object.entries(servers).flatMap(([serverName, entry]) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return [];
      }
      return [
        {
          serverName,
          saved: {
            kind: "json" as const,
            entry: entry as Record<string, unknown>,
            savedAt: new Date().toISOString(),
          },
        },
      ];
    });
  } catch {
    return [];
  }
}

function parseCodexMcpServerName(line: string): string | undefined {
  const trimmed = line.trim();
  const quoted = trimmed.match(/^\[mcp_servers\."((?:\\.|[^"])*)"\]$/);
  if (quoted) return unescapeTomlString(quoted[1]);
  const bare = trimmed.match(/^\[mcp_servers\.([A-Za-z0-9_-]+)\]$/);
  return bare?.[1];
}

function readCodexMcpServerEntries(
  file: string,
): { serverName: string; saved: SavedMcpEntry }[] {
  let content = "";
  try {
    content = fs.readFileSync(file, "utf-8");
  } catch {
    return [];
  }
  const lines = content.split(/\r?\n/);
  const entries: { serverName: string; saved: SavedMcpEntry }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const serverName = parseCodexMcpServerName(lines[i]);
    if (!serverName) continue;
    const block: string[] = [lines[i]];
    i++;
    while (i < lines.length && !/^\s*\[/.test(lines[i])) {
      block.push(lines[i]);
      i++;
    }
    i--;
    entries.push({
      serverName,
      saved: {
        kind: "codex",
        block: block.join("\n").replace(/\n*$/, "") + "\n",
        savedAt: new Date().toISOString(),
      },
    });
  }
  return entries;
}

function readExistingMcpEntries(
  clients: ClientId[],
  baseDir: string,
  scope: string,
): ExistingMcpEntry[] {
  const entries: ExistingMcpEntry[] = [];
  for (const client of clients) {
    const file = configPathFor(client, baseDir, scope);
    const rawEntries =
      client === "codex"
        ? readCodexMcpServerEntries(file)
        : readJsonMcpServerEntries(client, file);
    for (const { serverName, saved } of rawEntries) {
      const url = savedEntryUrl(saved);
      if (!url) continue;
      entries.push({ client, serverName, file, saved, url });
    }
  }
  return entries;
}

function canonicalMcpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function sameMcpUrl(a: string | undefined, b: string | undefined): boolean {
  const left = canonicalMcpUrl(a);
  const right = canonicalMcpUrl(b);
  return !!left && !!right && left === right;
}

function savedEntryHeaders(
  saved: SavedMcpEntry | undefined,
): Record<string, string> {
  if (!saved) return {};
  if (saved.kind === "json") {
    const headers =
      saved.entry.headers ??
      (saved.entry.requestInit &&
      typeof saved.entry.requestInit === "object" &&
      !Array.isArray(saved.entry.requestInit)
        ? (saved.entry.requestInit as Record<string, unknown>).headers
        : undefined);
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
  // Local dev defaults to the compact/connector catalog + tool-search, same as
  // every other client. The local server still honors AGENT_NATIVE_MCP_FULL_CATALOG=1
  // for an explicit full-catalog opt-in, so we don't force the header here.
  return Object.keys(headers).length ? headers : undefined;
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
          `run: npx @agent-native/core@latest connect ${app?.url ?? "<url>"} --client ${row.client}`,
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

interface ReconnectTarget {
  rawUrl: string;
  serverName?: string;
  clients?: ClientId[];
}

function distinctReconnectEntries(
  entries: ExistingMcpEntry[],
): ExistingMcpEntry[] {
  const seen = new Set<string>();
  const out: ExistingMcpEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.serverName}\0${canonicalMcpUrl(entry.url) ?? entry.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

function uniqueClients(entries: ExistingMcpEntry[]): ClientId[] {
  return [...new Set(entries.map((entry) => entry.client))];
}

function preferredReconnectEntry(
  url: string,
  entries: ExistingMcpEntry[],
): ExistingMcpEntry | undefined {
  const canonicalName = CANONICAL_SERVER_NAME_BY_MCP_URL[url];
  return (
    (canonicalName
      ? entries.find((entry) => entry.serverName === canonicalName)
      : undefined) ??
    entries.find((entry) => !entry.serverName.startsWith("agent-native-")) ??
    entries[0]
  );
}

/**
 * Return true when `url` is an agent-native MCP endpoint.
 * Matches any URL whose path ends with `/_agent-native/mcp` (after stripping
 * trailing slashes), regardless of the MCP server's name in the config.
 */
function isAgentNativeMcpUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const pathname = new URL(url).pathname.replace(/\/+$/, "");
    return pathname === MCP_PATH || pathname.endsWith(MCP_PATH);
  } catch {
    return false;
  }
}

async function resolveReconnectTarget(
  parsed: ParsedConnectArgs,
  clients: ClientId[],
  deps: ConnectDeps,
): Promise<ReconnectTarget | null> {
  const baseDir = projectBaseDir();
  const scope = parsed.scope === "user" ? "user" : "project";
  const entries = readExistingMcpEntries(clients, baseDir, scope);

  if (parsed.url) {
    const normalizedUrl = normalizeUrl(parsed.url);
    const mcpUrl = mcpUrlForBaseUrl(normalizedUrl);
    const matches = distinctReconnectEntries(
      entries.filter((entry) => sameMcpUrl(entry.url, mcpUrl)),
    );

    if (matches.length === 0) {
      logErr(`  No existing Agent Native MCP entry found for ${mcpUrl}.`);
      logErr(
        "  First-time setup still uses: npx @agent-native/core@latest connect <url> --client <client>",
      );
      return null;
    }

    if (parsed.name) {
      const namedMatches = matches.filter(
        (entry) => entry.serverName === parsed.name,
      );
      if (namedMatches.length === 0) {
        logErr(
          `  No existing MCP entry named "${parsed.name}" found for ${mcpUrl}.`,
        );
        logErr("  Re-run without --name to use the existing entry name.");
        return null;
      }
      return {
        rawUrl: parsed.url,
        serverName: parsed.name,
        clients: uniqueClients(namedMatches),
      };
    }

    const key = canonicalMcpUrl(mcpUrl) ?? mcpUrl;
    const preferred = preferredReconnectEntry(key, matches);
    if (preferred) {
      const names = [...new Set(matches.map((entry) => entry.serverName))];
      if (names.length > 1) {
        logOut(
          `  Found duplicate MCP entries for ${mcpUrl}: ${names.join(", ")}.`,
        );
        logOut(
          `  Reconnecting "${preferred.serverName}" and removing the duplicate names.`,
        );
      }
      return {
        rawUrl: parsed.url,
        serverName:
          reconnectServerNameForMcpUrl(mcpUrl, preferred.serverName) ??
          preferred.serverName,
        clients: uniqueClients(matches),
      };
    }

    const names = [...new Set(matches.map((entry) => entry.serverName))];
    if (names.length > 1) {
      logErr(
        `  Found multiple MCP entries for ${mcpUrl}: ${names.join(", ")}.`,
      );
      logErr("  Re-run with --name <serverName> to choose one.");
      return null;
    }
    return {
      rawUrl: parsed.url,
      serverName: names[0],
      clients: uniqueClients(matches),
    };
  }

  // No URL provided: scan all configs for agent-native MCP entries by URL
  // pattern, not by server name prefix. This finds the canonical "plan" entry
  // (and any other custom-named entries) that the old prefix scan missed.
  const agentNativeEntries = distinctReconnectEntries(
    parsed.name
      ? entries.filter((entry) => entry.serverName === parsed.name)
      : entries.filter((entry) => isAgentNativeMcpUrl(entry.url)),
  );

  // Group by normalised URL so we can detect multi-app situations.
  const byUrl = new Map<string, ExistingMcpEntry[]>();
  for (const entry of agentNativeEntries) {
    const key = canonicalMcpUrl(entry.url) ?? entry.url;
    const bucket = byUrl.get(key) ?? [];
    bucket.push(entry);
    byUrl.set(key, bucket);
  }

  if (byUrl.size === 0) {
    logErr("  No existing Agent Native MCP entry found to reconnect.");
    logErr(
      "  Pass a URL, or use --name <serverName> if the entry has a custom name.",
    );
    logErr(
      "  First-time setup still uses: npx @agent-native/core@latest connect <url> --client <client>",
    );
    return null;
  }

  if (byUrl.size === 1) {
    // Exactly one distinct URL: prefer the entry whose serverName matches the
    // canonical name for this app (e.g. "plan" over "agent-native-plans").
    // Fall back to any entry whose name doesn't start with "agent-native-"
    // (short canonical names like "plan"), then bucket[0].
    const [url, bucket] = [...byUrl.entries()][0];
    const preferred = preferredReconnectEntry(url, bucket) ?? bucket[0];
    return {
      rawUrl: preferred.url,
      serverName:
        reconnectServerNameForMcpUrl(preferred.url, preferred.serverName) ??
        preferred.serverName,
      clients: uniqueClients(bucket),
    };
  }

  // Multiple distinct URLs: pick interactively when TTY, else list with hints.
  const urlList = [...byUrl.keys()];
  if (shouldPrompt(deps)) {
    const clack = await import("@clack/prompts");
    const result = await clack.select<
      { value: string; label: string; hint: string }[],
      string
    >({
      message:
        "Multiple Agent Native apps found. Which one do you want to reconnect?",
      options: urlList.map((u) => {
        const representativeEntry = byUrl.get(u)![0];
        return {
          value: u,
          label: representativeEntry.serverName,
          hint: u,
        };
      }),
    });
    if (clack.isCancel(result)) {
      clack.cancel("Cancelled.");
      return null;
    }
    const bucket = byUrl.get(result as string);
    const chosen = bucket
      ? (preferredReconnectEntry(result as string, bucket) ?? bucket[0])
      : undefined;
    if (!chosen || !bucket) return null;
    return {
      rawUrl: chosen.url,
      serverName:
        reconnectServerNameForMcpUrl(chosen.url, chosen.serverName) ??
        chosen.serverName,
      clients: uniqueClients(bucket),
    };
  }

  logErr("  Found multiple Agent Native MCP entries:");
  for (const [u, bucket] of byUrl) {
    logErr(`    ${bucket[0].serverName} → ${u}`);
  }
  logErr("  Re-run with a URL or --name <serverName>. For example:");
  for (const u of urlList) {
    // Strip the MCP path suffix for a cleaner reconnect URL suggestion.
    const baseUrl = u.replace(/\/_agent-native\/mcp$/, "");
    logErr(`    npx -y @agent-native/core@latest reconnect ${baseUrl}`);
  }
  return null;
}

async function reconnectOne(
  parsed: ParsedConnectArgs,
  clients: ClientId[],
  deps: ConnectDeps,
): Promise<boolean> {
  const target = await resolveReconnectTarget(parsed, clients, deps);
  if (!target) return false;
  const effectiveParsed: ParsedConnectArgs = {
    ...parsed,
    url: target.rawUrl,
    name: target.serverName ?? parsed.name,
  };
  const effectiveClients = target.clients?.length ? target.clients : clients;
  logOut("");
  logOut(
    `  Reconnecting${effectiveParsed.name ? ` "${effectiveParsed.name}"` : ""}...`,
  );
  const res = await connectOne(
    target.rawUrl,
    effectiveParsed,
    effectiveClients,
    deps,
  );
  const skippedClients = clientsNotIn(clients, effectiveClients);
  if (res.ok && skippedClients.length > 0) {
    const baseUrl = stripMcpPath(normalizeUrl(target.rawUrl));
    logOut("");
    logOut(
      `  Reconnected existing client configs for ${clientLabelList(effectiveClients)}.`,
    );
    logOut(
      `  Did not touch ${clientLabelList(skippedClients)} because no matching MCP entry was found.`,
    );
    logOut(
      `  To add another client, run: npx @agent-native/core@latest connect ${baseUrl} --client CLIENT --scope ${effectiveParsed.scope}`,
    );
  }
  if (res.ok) {
    await showReconnectSuccessOutro({
      serverName: res.serverName ?? effectiveParsed.name,
      clients: effectiveClients,
    });
  }
  return res.ok;
}

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
  let oauthClients = parsed.token
    ? []
    : clients.filter((client) => supportsRemoteMcpOAuth(client));
  let deviceFlowClients = parsed.token
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
      { fullCatalog: parsed.fullCatalog },
    );
    if (!grant) return { ok: false };
    token = grant.token;
    mcpUrl = grant.mcpUrl;
    serverName =
      parsed.name ??
      reconnectServerNameForMcpUrl(grant.mcpUrl, grant.serverName) ??
      grant.serverName ??
      defaultServerName(baseUrl);
    headers = grant.headers;
  }

  if (oauthClients.length > 0 && !parsed.token) {
    if (!(await validateOAuthMcpServer(baseUrl, mcpUrl, deps))) {
      if (parsed.mode !== "reconnect") {
        return { ok: false };
      }

      logOut("");
      logOut(
        `  OAuth metadata was unavailable; falling back to bearer-token reconnect for ${clientLabelList(
          oauthClients,
        )}.`,
      );

      if (!token) {
        const grant = await runDeviceFlow(
          baseUrl,
          appSlug,
          clientArgForDeviceFlow(oauthClients),
          deps,
          { fullCatalog: parsed.fullCatalog },
        );
        if (!grant) return { ok: false };
        token = grant.token;
        mcpUrl = grant.mcpUrl;
        serverName =
          parsed.name ??
          reconnectServerNameForMcpUrl(grant.mcpUrl, grant.serverName) ??
          grant.serverName ??
          defaultServerName(baseUrl);
        headers = grant.headers;
      }

      deviceFlowClients = [...deviceFlowClients, ...oauthClients];
      oauthClients = [];
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
        headers,
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

  // After writing the canonical entry, remove any same-URL duplicates (alias
  // names, legacy default names, stale custom names) from the same config
  // files so each app has exactly one MCP session.
  const allRemovedNames: string[] = [];
  for (const client of clients) {
    const removed = removeSameUrlDuplicatesForClient(
      client,
      serverName,
      mcpUrl,
      baseDir,
      scope,
    );
    allRemovedNames.push(...removed);
  }
  if (allRemovedNames.length > 0) {
    logOut(
      `  Removed duplicate MCP entries: ${[...new Set(allRemovedNames)].join(", ")}`,
    );
  }

  // Canonical publish-token write: when we have a real minted bearer token for
  // a first-party Plans app, also persist `{ url, token }` to
  // `~/.agent-native/plan-publish.json` so the local Plans server can read the
  // same token for a server-to-server publish (publish-on-share). This is an
  // ADDITIONAL write alongside the per-client MCP config; Best-effort and
  // merge-not-clobber — never fails the connect.
  //
  // OAuth clients authenticate in-host via standard MCP OAuth, so they never
  // mint a local bearer token. To still populate the publish store for them, we
  // run a supplemental device-flow mint using a non-OAuth client arg so the
  // Plans server gets a usable token and `publish-visual-plan` doesn't send the
  // user back to `agent-native connect` right after they just ran it.
  let publishToken = token;
  if (
    !publishToken &&
    oauthClients.length > 0 &&
    isFirstPartyPlanHost(baseUrl)
  ) {
    try {
      logOut("");
      logOut(
        `  Minting a publish token for the local Plans server (device flow)…`,
      );
      const grant = await runDeviceFlow(
        baseUrl,
        appSlug,
        // Use a non-OAuth client arg so the server mints a bearer token even
        // though our primary clients are OAuth-native. "codex" is a stable,
        // always-supported non-OAuth client identifier.
        "codex",
        deps,
      );
      if (grant?.token) {
        publishToken = grant.token;
      } else {
        logOut(
          `  Warning: could not mint a publish token for the local Plans ` +
            `server. You can still publish via the hosted UI.`,
        );
      }
    } catch {
      logOut(
        `  Warning: publish-token mint failed. You can still publish via the ` +
          `hosted UI.`,
      );
    }
  }
  if (publishToken && isFirstPartyPlanHost(baseUrl)) {
    const canonicalPath = writePlanPublishAuth({
      url: baseUrl,
      token: publishToken,
    });
    if (canonicalPath) {
      logOut("");
      logOut(
        `  Saved publish token for the local Plans server → ${canonicalPath}`,
      );
    }
  }

  logOut("");
  logOut(`  Configured "${serverName}" → ${mcpUrl}`);
  for (const w of allWritten) {
    logOut(`    ${w.client.padEnd(18)} ${w.file}`);
  }
  logOut(
    `  Auth/config is per client: this command updated ${clientLabelList(clients)} only.`,
  );
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
    for (const line of oauthNextStepsForClients(oauthClients, serverName)) {
      logOut(`  Next: ${line}`);
    }
  }
  logOut("");
  logOut(
    `  Restart or reload ${sentenceClientLabelList(clients)} to pick up the new MCP server.`,
  );
  if (clients.includes("codex")) {
    logOut(
      "  Codex sessions load MCP tools at startup; start a new Codex session if the tools are still missing.",
    );
  }
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
// Org service-token mint (--service-token <name>)
// ---------------------------------------------------------------------------

/** `postJson` with a bearer Authorization header (action-route calls). */
async function postJsonAuthed(
  fetchImpl: typeof fetch,
  url: string,
  body: unknown,
  bearerToken: string,
): Promise<{ status: number; json: any }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bearerToken}`,
      },
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
 * `agent-native connect <url> --service-token <name>` — mint an ORG service
 * token for CI (e.g. the PLAN_RECAP_TOKEN GitHub secret).
 *
 * Flow: authenticate the human via the existing browser device flow, then use
 * that short-lived grant to call the app's `create-org-service-token` action
 * (org owner/admin gated server-side). The service token is printed exactly
 * once and never written to any local config file.
 */
export async function runServiceTokenMint(
  parsed: ParsedConnectArgs,
  deps: ConnectDeps = {},
): Promise<boolean> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const serviceName = parsed.serviceToken?.trim() ?? "";
  if (!parsed.url) {
    logErr("  --service-token requires the app URL.");
    logErr(
      "  Usage: npx @agent-native/core@latest connect <url> --service-token <name> [--ttl-days <1-365>]",
    );
    return false;
  }
  if (!serviceName) {
    logErr(
      "  --service-token requires a service name, e.g. --service-token ci",
    );
    return false;
  }

  const normalizedUrl = normalizeUrl(parsed.url);
  const baseUrl = stripMcpPath(normalizedUrl);
  const appSlug = appSlugFromUrl(baseUrl);

  logOut("");
  logOut(`  Creating org service token "${serviceName}" on ${baseUrl}`);
  logOut("  First, verify it's you (the token will belong to your org)…");

  // Use a non-OAuth client arg so the server mints a bearer grant we can use
  // against the action route (same approach as the Plans publish-token mint).
  const grant = await runDeviceFlow(baseUrl, appSlug, "codex", deps);
  if (!grant?.token) {
    logErr("  Could not authenticate (the server returned no bearer token).");
    logErr("  Org service tokens require a deployed app with auth configured.");
    return false;
  }

  let status: number;
  let json: any;
  try {
    ({ status, json } = await postJsonAuthed(
      fetchImpl,
      `${baseUrl}/_agent-native/actions/create-org-service-token`,
      {
        name: serviceName,
        ...(Number.isFinite(parsed.ttlDays) && parsed.ttlDays
          ? { ttlDays: parsed.ttlDays }
          : {}),
      },
      grant.token,
    ));
  } catch (err: any) {
    logErr(`  Could not reach ${baseUrl} (${err?.message ?? err}).`);
    return false;
  }

  if (status === 404) {
    logErr(
      "  This app does not expose the create-org-service-token action yet.",
    );
    logErr("  Redeploy it with a current @agent-native/core, then retry.");
    return false;
  }
  if (status < 200 || status >= 300 || typeof json?.token !== "string") {
    logErr(
      `  Could not create the service token (HTTP ${status}): ` +
        responseMessage(json, "server returned an error."),
    );
    if (status === 403) {
      logErr("  Only org owners or admins can create service tokens.");
    }
    return false;
  }

  logOut("");
  logOut("  Org service token created.");
  logOut("");
  logOut(`    Name:     ${json.serviceName ?? serviceName}`);
  if (typeof json.serviceEmail === "string") {
    logOut(`    Acts as:  ${json.serviceEmail}`);
  }
  if (Number.isFinite(Number(json.ttlDays))) {
    logOut(`    Expires:  in ${json.ttlDays} days`);
  }
  logOut("");
  // The ONLY place the secret is ever printed. Never logged elsewhere,
  // never written to disk.
  logOut(`  ${json.token}`);
  logOut("");
  logOut("  Shown once — store it now as your CI secret, e.g.:");
  logOut(`    gh secret set PLAN_RECAP_TOKEN --body "<paste token>"`);
  logOut("");
  logOut(
    "  Manage it later with the list-org-service-tokens / " +
      "revoke-org-service-token actions (org owners/admins).",
  );
  return true;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const HELP = `npx @agent-native/core@latest connect — wire your coding agent to a deployed app

Usage:
  npx @agent-native/core@latest connect [--client <c>] [--scope user|project]
      With no URL, opens a picker for the built-in hosted apps
      (mail.agent-native.com, calendar.agent-native.com, and friends).

  npx @agent-native/core@latest connect <url> [--client <c>] [--scope user|project] [--name <n>]
      Writes the HTTP MCP entry into your selected client config(s). Claude
      Code, Cursor, OpenCode, and GitHub Copilot / VS Code use standard remote
      MCP OAuth and get URL-only config. Codex / Cowork use the browser
      device-code fallback: the command prints a code, opens the verification
      URL, polls until approved, then writes bearer headers. With no --client,
      opens a brief picker preselected from ~/.agent-native/connect.json, or
      all clients on first run. Idempotent — re-running replaces the same entry.
      Auth is stored per client config/session; restart or reload each selected
      client before expecting new tools to appear.
      Re-running over an older OAuth-capable bearer entry upgrades it to
      URL-only OAuth config and prompts you to authenticate in that host.

      For cross-app access, prefer the unified Dispatch gateway:
      npx @agent-native/core@latest connect https://dispatch.agent-native.com

  npx @agent-native/core@latest connect <url> --token <token>
      No-browser fallback. Skip the device flow and write the entry with
      the supplied token (get it from the app's Connect page).

  npx @agent-native/core@latest connect <url> --service-token <name> [--ttl-days <1-365>]
      Mint an ORG service token for CI (e.g. the PLAN_RECAP_TOKEN secret for
      PR Visual Recap). Authenticates you via the browser device flow, then
      mints a token owned by your ORGANIZATION — it keeps working if you
      leave or revoke your personal tokens, and CI-created plans are
      org-visible. Org owner/admin only. Printed once; nothing is written
      to local MCP configs.

  npx -y @agent-native/core@latest reconnect [<url>] [--client <c>] [--scope user|project]
  npx -y @agent-native/core@latest connect reconnect [<url>] [--client <c>] [--scope user|project]
      Re-authenticate an existing MCP entry without reinstalling apps/skills.
      With a URL, it reuses the existing server name for that MCP URL when
      possible, reconnecting only clients that already have that entry. Pass
      --client to limit which configs it searches; for Codex recovery, prefer
      --client codex. Without a URL, it reconnects the only matching Agent
      Native entry in local client configs. Use --name for custom server names.

  npx @agent-native/core@latest connect --all [--client <c>] [--scope user|project]
      Connect every first-party hosted app as separate MCP resources.

Developer:
  npx @agent-native/core@latest connect dev [--apps mail,calendar] [--client <c>]
      Switch selected first-party MCP entries to a local dev-lazy gateway.
      Defaults to ${DEFAULT_DEV_GATEWAY}; override with --gateway or --port.

  npx @agent-native/core@latest connect prod [--apps mail,calendar] [--client <c>]
      Restore production MCP entries saved before the dev switch.

Clients:  all (default), claude-code, codex, cowork, cursor, opencode, github-copilot
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
  const previousLogOut = logOutImpl;
  const previousLogErr = logErrImpl;
  logOutImpl = deps.logOut ?? previousLogOut;
  logErrImpl = deps.logErr ?? previousLogErr;
  try {
    if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
      logOut(HELP);
      return;
    }

    const parsed = parseConnectArgs(args);

    if (parsed.mode) {
      let ok: boolean;
      if (parsed.mode === "reconnect" || parsed.mode === "reauth") {
        const clients = resolveClients(parsed.client);
        ok = await reconnectOne(parsed, clients, deps);
      } else {
        const clients = await resolveConnectClients(parsed, deps);
        if (!clients) return;
        ok =
          parsed.mode === "dev"
            ? await connectDevProfile(parsed, clients, deps)
            : await connectProdProfile(parsed, clients, deps);
      }
      if (!ok) process.exitCode = 1;
      return;
    }

    if (parsed.serviceToken !== undefined) {
      const ok = await runServiceTokenMint(parsed, deps);
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
  } finally {
    logOutImpl = previousLogOut;
    logErrImpl = previousLogErr;
  }
}
