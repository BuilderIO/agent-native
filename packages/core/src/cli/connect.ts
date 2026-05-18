/**
 * `agent-native connect <url>` — wire your local Claude Code / Codex / Cowork
 * to a DEPLOYED agent-native app using a browser device-code flow. No token
 * copying: open the verification URL, approve in the browser, and the minted
 * HTTP MCP server entry is written into your client config(s) idempotently.
 *
 *   agent-native connect <url> [--client all|claude-code|claude-code-cli|
 *                               codex|cowork] [--scope user|project]
 *                               [--name <serverName>]
 *   agent-native connect <url> --token <token>   (no-browser fallback)
 *   agent-native connect --all  [--client ...]   (every first-party app)
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
  writeHttpEntryForClient,
} from "./mcp-config-writers.js";
import { visibleTemplates } from "./templates-meta.js";

const DEVICE_START_PATH = "/_agent-native/mcp/connect/device/start";
const DEVICE_POLL_PATH = "/_agent-native/mcp/connect/device/poll";
const SERVER_NAME_PREFIX = "agent-native";
const CONNECT_PREFERENCES_VERSION = 1;

const CLIENT_LABELS: Record<ClientId, string> = {
  "claude-code": "Claude Code",
  "claude-code-cli": "Claude Code CLI",
  codex: "Codex",
  cowork: "Claude Cowork",
};

const CLIENT_HINTS: Record<ClientId, string> = {
  "claude-code": ".mcp.json or ~/.claude.json",
  "claude-code-cli": ".mcp.json or ~/.claude.json",
  codex: "~/.codex/config.toml",
  cowork: "~/.cowork/mcp.json",
};

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
    else if ((v = eat("--client")) !== undefined) {
      out.client = v;
      out.clientExplicit = true;
    } else if ((v = eat("--scope")) !== undefined) out.scope = v;
    else if ((v = eat("--name")) !== undefined) out.name = v;
    else if ((v = eat("--token")) !== undefined) out.token = v;
    else if (!a.startsWith("-") && !out.url) out.url = a;
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

function clientPromptOptions(): ConnectClientPromptContext["options"] {
  return CLIENTS.map((client) => ({
    value: client,
    label: CLIENT_LABELS[client],
    hint: CLIENT_HINTS[client],
  }));
}

function shouldPromptForClients(deps: ConnectDeps): boolean {
  if (deps.isInteractive) return deps.isInteractive();
  if (process.env.AGENT_NATIVE_NO_PROMPT === "1") return false;
  if (process.env.CI === "true") return false;
  return !!process.stdin.isTTY && !!process.stdout.isTTY;
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

function clientArgForDeviceFlow(clients: ClientId[]): string {
  return clients.length === 1 ? clients[0] : "all";
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
  /** Override the persisted connect preferences file. */
  preferencesFile?: string;
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
// Single-app connect
// ---------------------------------------------------------------------------

async function connectOne(
  rawUrl: string,
  parsed: ParsedConnectArgs,
  clients: ClientId[],
  deps: ConnectDeps,
): Promise<{ ok: boolean; serverName?: string; files?: string[] }> {
  const baseUrl = normalizeUrl(rawUrl);
  const appSlug = appSlugFromUrl(baseUrl);
  const scope = parsed.scope === "user" ? "user" : "project";

  let token: string | undefined;
  let mcpUrl: string;
  let serverName: string;
  let headers: Record<string, string> | undefined;

  if (parsed.token) {
    // No-browser fallback: skip the device flow entirely.
    token = parsed.token;
    mcpUrl = `${baseUrl}/_agent-native/mcp`;
    serverName = parsed.name ?? defaultServerName(baseUrl);
    logOut("");
    logOut(`  Using supplied --token for ${baseUrl} (skipping browser flow).`);
  } else {
    const grant = await runDeviceFlow(
      baseUrl,
      appSlug,
      clientArgForDeviceFlow(clients),
      deps,
    );
    if (!grant) return { ok: false };
    token = grant.token;
    mcpUrl = grant.mcpUrl;
    serverName = parsed.name ?? grant.serverName ?? defaultServerName(baseUrl);
    headers = grant.headers;
  }

  const written = writeConfigs(
    clients,
    serverName,
    mcpUrl,
    token,
    scope,
    undefined,
    headers,
  );

  logOut("");
  logOut(`  Connected "${serverName}" → ${mcpUrl}`);
  for (const w of written) {
    logOut(`    ${w.client.padEnd(18)} ${w.file}`);
  }
  logOut("");
  logOut("  Restart your coding agent to pick up the new MCP server.");
  return { ok: true, serverName, files: written.map((w) => w.file) };
}

// ---------------------------------------------------------------------------
// --all : connect every first-party hosted app
// ---------------------------------------------------------------------------

/** Hosted first-party apps: visible (non-hidden) templates with a prodUrl. */
export function hostedApps(): { name: string; url: string }[] {
  return visibleTemplates()
    .filter((t) => typeof t.prodUrl === "string" && t.prodUrl.length > 0)
    .map((t) => ({ name: t.name, url: t.prodUrl as string }));
}

async function connectAll(
  parsed: ParsedConnectArgs,
  clients: ClientId[],
  deps: ConnectDeps,
): Promise<boolean> {
  const apps = hostedApps();
  if (apps.length === 0) {
    logErr("  No hosted first-party apps found in the template registry.");
    return false;
  }
  logOut("");
  logOut(`  Connecting ${apps.length} first-party hosted apps…`);

  const results: { name: string; status: string; files: string[] }[] = [];
  for (const app of apps) {
    logOut("");
    logOut(`  ── ${app.name} (${app.url}) ──`);
    try {
      const res = await connectOne(app.url, parsed, clients, deps);
      results.push({
        name: app.name,
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

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const HELP = `agent-native connect — wire your coding agent to a deployed app

Usage:
  agent-native connect <url> [--client <c>] [--scope user|project] [--name <n>]
      Browser device-code flow. Prints a code, opens the verification URL,
      polls until approved, then writes the HTTP MCP entry into your
      selected client config(s). With no --client, opens a brief picker
      preselected from ~/.agent-native/connect.json, or all clients on first
      run. Idempotent — re-running replaces the same entry.

  agent-native connect <url> --token <token>
      No-browser fallback. Skip the device flow and write the entry with
      the supplied token (get it from the app's Connect page).

  agent-native connect --all [--client <c>] [--scope user|project]
      Connect every first-party hosted app at once.

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
    if (parsed.all) {
      const clients = await resolveConnectClients(parsed, deps);
      if (!clients) return;
      const ok = await connectAll(parsed, clients, deps);
      if (!ok) process.exitCode = 1;
      return;
    }

    if (!parsed.url) {
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
