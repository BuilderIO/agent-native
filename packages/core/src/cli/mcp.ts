/**
 * `agent-native mcp <subcommand>` — connect external coding agents (Claude
 * Code desktop & CLI, Claude Cowork, Codex) to this agent-native app/workspace
 * over MCP.
 *
 *   serve      Run the MCP stdio transport (this is what client configs spawn).
 *   install    Provision a token + write the client's MCP config idempotently.
 *   uninstall  Remove the named entry from a client's MCP config.
 *   status     Print resolved MCP URL/port, token state, and per-client entries.
 *   token      Print or rotate the local ACCESS_TOKEN in the workspace .env.
 *
 * Node-only CLI module. Hand-rolled `.env` upsert + minimal TOML block merge
 * keep this dependency-free (no new npm deps).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runMCPStdio } from "../mcp/stdio.js";
import { writeFileAtomic } from "./mcp-config-writers.js";
import {
  findWorkspaceRoot,
  resolveLocalAppOrigin,
  resolveWorkspace,
} from "../mcp/workspace-resolve.js";

const SERVER_NAME_PREFIX = "agent-native";

type ClientId = "claude-code" | "claude-code-cli" | "codex" | "cowork";
const CLIENTS: ClientId[] = [
  "claude-code",
  "claude-code-cli",
  "codex",
  "cowork",
];

interface ParsedArgs {
  _: string[];
  client?: string;
  app?: string;
  port?: number;
  scope?: string;
  standalone: boolean;
  rotate: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { _: [], standalone: false, rotate: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eat = (flag: string): string | undefined => {
      if (a === flag) return argv[++i];
      if (a.startsWith(`${flag}=`)) return a.slice(flag.length + 1);
      return undefined;
    };
    let v: string | undefined;
    if ((v = eat("--client")) !== undefined) out.client = v;
    else if ((v = eat("--app")) !== undefined) out.app = v;
    else if ((v = eat("--port")) !== undefined) out.port = Number(v);
    else if ((v = eat("--scope")) !== undefined) out.scope = v;
    else if (a === "--standalone") out.standalone = true;
    else if (a === "--rotate") out.rotate = true;
    else if (!a.startsWith("-")) out._.push(a);
  }
  return out;
}

function logErr(msg: string): void {
  process.stderr.write(`${msg}\n`);
}
function logOut(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

// ---------------------------------------------------------------------------
// .env token provisioning (local dev) — hand-rolled idempotent upsert
// ---------------------------------------------------------------------------

/** Workspace root (or cwd for a standalone app) — where .env lives. */
function envBaseDir(cwd = process.cwd()): string {
  return findWorkspaceRoot(cwd) ?? path.resolve(cwd);
}

/** Prefer .env.local, else .env. Returns the path we should write to. */
function envFilePath(baseDir: string): string {
  const local = path.join(baseDir, ".env.local");
  if (fs.existsSync(local)) return local;
  return path.join(baseDir, ".env");
}

function readEnvFile(file: string): string {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return "";
  }
}

/** Read a single key from a dotenv-format string (last assignment wins). */
function getEnvValue(content: string, key: string): string | undefined {
  let found: string | undefined;
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && m[1] === key) {
      found = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return found;
}

/**
 * Idempotently set `key=value` in the dotenv file. If the key already exists
 * we leave it untouched unless `force` is set (used by `token --rotate`).
 * Never clobbers an existing token implicitly.
 */
function upsertEnv(
  file: string,
  key: string,
  value: string,
  force = false,
): { changed: boolean; value: string } {
  const content = readEnvFile(file);
  const existing = getEnvValue(content, key);
  if (existing && !force) return { changed: false, value: existing };

  const line = `${key}=${value}`;
  let next: string;
  if (new RegExp(`^\\s*${key}\\s*=`, "m").test(content)) {
    next = content.replace(new RegExp(`^\\s*${key}\\s*=.*$`, "m"), line);
  } else {
    next =
      content.length === 0
        ? `${line}\n`
        : `${content.replace(/\n*$/, "")}\n${line}\n`;
  }
  writeFileAtomic(file, next);
  return { changed: true, value };
}

function generateToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/**
 * Ensure a local ACCESS_TOKEN exists in the workspace .env and return it.
 * Existing tokens are reused (never clobbered). Set `rotate` to replace it.
 */
function ensureLocalToken(
  cwd: string,
  rotate = false,
): { token: string; file: string; created: boolean } {
  const baseDir = envBaseDir(cwd);
  const file = envFilePath(baseDir);
  const content = readEnvFile(file);
  const existing = getEnvValue(content, "ACCESS_TOKEN");
  if (existing && !rotate) {
    return { token: existing, file, created: false };
  }
  const token = generateToken();
  upsertEnv(file, "ACCESS_TOKEN", token, true);
  return { token, file, created: true };
}

// ---------------------------------------------------------------------------
// Hosted vs local detection
// ---------------------------------------------------------------------------

/**
 * Detect a hosted deployment URL. When the workspace .env points at a hosted
 * origin (APP_URL / BETTER_AUTH_URL with a non-localhost host) we write an
 * `http` client entry pointing at `<origin>/_agent-native/mcp` with a JWT
 * bearer instead of a stdio entry.
 */
function detectHostedUrl(cwd: string): string | undefined {
  const baseDir = envBaseDir(cwd);
  const content =
    readEnvFile(path.join(baseDir, ".env.local")) +
    "\n" +
    readEnvFile(path.join(baseDir, ".env"));
  for (const key of ["AGENT_NATIVE_MCP_URL", "APP_URL", "BETTER_AUTH_URL"]) {
    const v = getEnvValue(content, key);
    if (!v) continue;
    try {
      const u = new URL(v);
      if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)) {
        return `${u.origin}/_agent-native/mcp`;
      }
    } catch {
      // not a URL — skip
    }
  }
  return undefined;
}

async function mintHostedJwt(cwd: string): Promise<string | undefined> {
  // Reuse the existing A2A signer — do not reinvent JWT minting.
  const owner =
    process.env.AGENT_NATIVE_OWNER_EMAIL ||
    process.env.OWNER_EMAIL ||
    "owner@localhost";
  if (!process.env.A2A_SECRET) {
    const baseDir = envBaseDir(cwd);
    const content =
      readEnvFile(path.join(baseDir, ".env.local")) +
      "\n" +
      readEnvFile(path.join(baseDir, ".env"));
    const secret = getEnvValue(content, "A2A_SECRET");
    if (secret) process.env.A2A_SECRET = secret;
  }
  try {
    const { signA2AToken } = await import("../a2a/client.js");
    return await signA2AToken(owner, undefined, undefined, {
      preferGlobalSecret: true,
      expiresIn: "30d",
    });
  } catch (err: any) {
    logErr(
      `  Could not mint a hosted JWT (${err?.message ?? err}). ` +
        `Set A2A_SECRET in your workspace .env, or use the local stdio entry.`,
    );
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Client config file locations + writers
// ---------------------------------------------------------------------------

/**
 * Cowork consumes MCP exactly like Claude Code (same JSON server-entry
 * shape). The exact on-disk config path for Cowork may differ across builds —
 * this is the best-known location. **Confirm before relying on it in
 * production.** It is validated against the Claude Code JSON format below.
 *
 * Resolved lazily (not as a module-level constant) so `os.homedir()` reflects
 * the current `$HOME` rather than the value at module-load time.
 */
function coworkConfigPath(): string {
  return path.join(os.homedir(), ".cowork", "mcp.json");
}

function claudeCodeProjectConfig(cwd: string): string {
  return path.join(envBaseDir(cwd), ".mcp.json");
}
function claudeCodeUserConfig(): string {
  return path.join(os.homedir(), ".claude.json");
}
function codexConfigPath(): string {
  const codexHome = process.env.CODEX_HOME?.trim();
  if (codexHome) return path.join(codexHome, "config.toml");
  return path.join(os.homedir(), ".codex", "config.toml");
}

interface ServerEntryInputs {
  serverName: string;
  appId: string;
  token?: string;
  ownerEmail?: string;
  hostedUrl?: string;
  standalone: boolean;
}

/** The stdio (or http) server entry — shared by Claude Code & Cowork JSON. */
function buildJsonServerEntry(i: ServerEntryInputs): Record<string, unknown> {
  if (i.hostedUrl) {
    return {
      type: "http",
      url: i.hostedUrl,
      ...(i.token ? { headers: { Authorization: `Bearer ${i.token}` } } : {}),
    };
  }
  const args = ["mcp", "serve"];
  if (i.appId) args.push("--app", i.appId);
  if (i.standalone) args.push("--standalone");
  const env: Record<string, string> = {};
  if (i.token) env.ACCESS_TOKEN = i.token;
  if (i.ownerEmail) env.AGENT_NATIVE_OWNER_EMAIL = i.ownerEmail;
  return {
    command: "agent-native",
    args,
    ...(Object.keys(env).length ? { env } : {}),
  };
}

function readJsonFile(file: string): Record<string, any> {
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Idempotently write `mcpServers[name] = entry` into a JSON config file. */
function writeJsonMcpEntry(
  file: string,
  name: string,
  entry: Record<string, unknown> | null,
): void {
  const config = readJsonFile(file);
  if (!config.mcpServers || typeof config.mcpServers !== "object") {
    config.mcpServers = {};
  }
  if (entry === null) {
    delete config.mcpServers[name];
  } else {
    config.mcpServers[name] = entry;
  }
  writeFileAtomic(file, JSON.stringify(config, null, 2) + "\n");
}

function hasJsonMcpEntry(file: string, name: string): boolean {
  const config = readJsonFile(file);
  return !!config?.mcpServers && name in config.mcpServers;
}

// --- Codex TOML (hand-rolled minimal block merge, no new dep) -------------

function tomlQuote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function codexMcpHeader(name: string): string {
  return `[mcp_servers.${tomlQuote(name)}]`;
}

function legacyCodexMcpHeader(name: string): string | null {
  return /^[A-Za-z0-9_-]+$/.test(name) ? `[mcp_servers.${name}]` : null;
}

function buildCodexBlock(name: string, i: ServerEntryInputs): string {
  const lines: string[] = [codexMcpHeader(name)];
  if (i.hostedUrl) {
    lines.push(`url = ${tomlQuote(i.hostedUrl)}`);
    if (i.token) {
      lines.push(
        `http_headers = { "Authorization" = ${tomlQuote(
          `Bearer ${i.token}`,
        )} }`,
      );
    }
    return lines.join("\n") + "\n";
  }

  const args = ["mcp", "serve"];
  if (i.appId) args.push("--app", i.appId);
  if (i.standalone) args.push("--standalone");
  lines.push(`command = "agent-native"`);
  lines.push(`args = [${args.map(tomlQuote).join(", ")}]`);
  const env: Record<string, string> = {};
  if (i.token) env.ACCESS_TOKEN = i.token;
  if (i.ownerEmail) env.AGENT_NATIVE_OWNER_EMAIL = i.ownerEmail;
  if (Object.keys(env).length) {
    const inline = Object.entries(env)
      .map(([k, v]) => `${k} = ${tomlQuote(v)}`)
      .join(", ");
    lines.push(`env = { ${inline} }`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Replace (or append) the `[mcp_servers.<name>]` block in a TOML file
 * without disturbing other content. We treat a block as the header line plus
 * every following line until the next top-level `[` table header or EOF.
 */
function writeCodexBlock(
  file: string,
  name: string,
  block: string | null,
): void {
  let content = "";
  try {
    content = fs.readFileSync(file, "utf-8");
  } catch {
    content = "";
  }

  const headers = new Set(
    [codexMcpHeader(name), legacyCodexMcpHeader(name)].filter(
      Boolean,
    ) as string[],
  );
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  let removed = false;
  while (i < lines.length) {
    const line = lines[i];
    if (headers.has(line.trim())) {
      // Skip this block entirely (header + body until next table header).
      removed = true;
      i++;
      while (i < lines.length && !/^\s*\[/.test(lines[i])) i++;
      continue;
    }
    out.push(line);
    i++;
  }

  let next = out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n*$/, "\n");
  if (block !== null) {
    next = next.replace(/\n*$/, "\n");
    if (next.trim().length) next += "\n";
    next += block;
  }
  if (block === null && !removed) return; // nothing to do

  writeFileAtomic(file, next);
}

function codexHasBlock(file: string, name: string): boolean {
  try {
    const content = fs.readFileSync(file, "utf-8");
    const headers = new Set(
      [codexMcpHeader(name), legacyCodexMcpHeader(name)].filter(
        Boolean,
      ) as string[],
    );
    return content.split(/\r?\n/).some((line) => headers.has(line.trim()));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Per-client install/uninstall/status
// ---------------------------------------------------------------------------

function configPathFor(
  client: ClientId,
  cwd: string,
  scope: string | undefined,
): string {
  switch (client) {
    case "claude-code":
    case "claude-code-cli":
      return scope === "user"
        ? claudeCodeUserConfig()
        : claudeCodeProjectConfig(cwd);
    case "cowork":
      return coworkConfigPath();
    case "codex":
      return codexConfigPath();
  }
}

function serverNameFor(appId: string): string {
  return `${SERVER_NAME_PREFIX}-${appId}`;
}

function installForClient(
  client: ClientId,
  inputs: ServerEntryInputs,
  cwd: string,
  scope: string | undefined,
): string {
  const name = inputs.serverName;
  const file = configPathFor(client, cwd, scope);
  if (client === "codex") {
    writeCodexBlock(file, name, buildCodexBlock(name, inputs));
  } else {
    writeJsonMcpEntry(file, name, buildJsonServerEntry(inputs));
  }
  return file;
}

function uninstallForClient(
  client: ClientId,
  appId: string,
  cwd: string,
  scope: string | undefined,
): { file: string; removed: boolean } {
  const name = serverNameFor(appId);
  const file = configPathFor(client, cwd, scope);
  if (client === "codex") {
    const had = codexHasBlock(file, name);
    if (had) writeCodexBlock(file, name, null);
    return { file, removed: had };
  }
  const had = hasJsonMcpEntry(file, name);
  if (had) writeJsonMcpEntry(file, name, null);
  return { file, removed: had };
}

function clientHasEntry(client: ClientId, appId: string, cwd: string): boolean {
  const name = serverNameFor(appId);
  // Check both scopes for Claude Code so `status` is informative.
  if (client === "claude-code" || client === "claude-code-cli") {
    return (
      hasJsonMcpEntry(claudeCodeProjectConfig(cwd), name) ||
      hasJsonMcpEntry(claudeCodeUserConfig(), name)
    );
  }
  if (client === "cowork") return hasJsonMcpEntry(coworkConfigPath(), name);
  return codexHasBlock(codexConfigPath(), name);
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function cmdServe(p: ParsedArgs): Promise<void> {
  await runMCPStdio({
    appId: p.app,
    port: p.port,
    standalone: p.standalone,
  });
}

async function cmdInstall(p: ParsedArgs): Promise<void> {
  const client = (p.client ?? "").toLowerCase() as ClientId;
  if (!CLIENTS.includes(client)) {
    logErr(
      `Usage: npx @agent-native/core@latest mcp install --client ${CLIENTS.join("|")} ` +
        `[--app <id>] [--scope user|project]`,
    );
    process.exit(1);
  }
  const cwd = process.cwd();

  // Resolve which app this entry targets (default = workspace default app).
  let appId = p.app;
  if (!appId) {
    try {
      const resolved = await resolveLocalAppOrigin({ cwd });
      appId = resolved.appId;
    } catch {
      appId = "app";
    }
  }
  const serverName = serverNameFor(appId);

  const hostedUrl = detectHostedUrl(cwd);
  const ownerEmail = process.env.AGENT_NATIVE_OWNER_EMAIL;

  let token: string | undefined;
  if (hostedUrl) {
    token = await mintHostedJwt(cwd);
    logOut(`Detected hosted deployment: ${hostedUrl}`);
  } else {
    const t = ensureLocalToken(cwd, false);
    token = t.token;
    logOut(
      t.created
        ? `Provisioned ACCESS_TOKEN in ${t.file}`
        : `Reusing existing ACCESS_TOKEN from ${t.file}`,
    );
  }

  const inputs: ServerEntryInputs = {
    serverName,
    appId: appId!,
    token,
    ownerEmail,
    hostedUrl,
    standalone: p.standalone,
  };

  const file = installForClient(client, inputs, cwd, p.scope);
  logOut(`Installed "${serverName}" for ${client} → ${file}`);
  logOut(
    hostedUrl
      ? `  Mode: http (${hostedUrl})`
      : `  Mode: stdio (npx @agent-native/core@latest mcp serve --app ${appId}${
          p.standalone ? " --standalone" : ""
        })`,
  );
  logOut(`  Restart ${client} to pick up the new MCP server.`);
}

function cmdUninstall(p: ParsedArgs): void {
  const client = (p.client ?? "").toLowerCase() as ClientId;
  if (!CLIENTS.includes(client)) {
    logErr(
      `Usage: npx @agent-native/core@latest mcp uninstall --client ${CLIENTS.join("|")} ` +
        `[--app <id>]`,
    );
    process.exit(1);
  }
  const cwd = process.cwd();
  const appId = p.app ?? "app";
  const { file, removed } = uninstallForClient(client, appId, cwd, p.scope);
  logOut(
    removed
      ? `Removed "${serverNameFor(appId)}" from ${client} → ${file}`
      : `No "${serverNameFor(appId)}" entry found for ${client} (${file}) — nothing to do.`,
  );
}

async function cmdStatus(): Promise<void> {
  const cwd = process.cwd();
  let appId = "app";
  let origin = "(app not running)";
  let port: number | undefined;
  try {
    const resolved = await resolveLocalAppOrigin({ cwd });
    appId = resolved.appId;
    origin = resolved.origin;
    const ws = await resolveWorkspace(cwd);
    port = ws.apps.find((a) => a.id === appId)?.port;
  } catch (err: any) {
    logErr(`  Could not resolve app: ${err?.message ?? err}`);
  }

  const hostedUrl = detectHostedUrl(cwd);
  const baseDir = envBaseDir(cwd);
  const envContent =
    readEnvFile(path.join(baseDir, ".env.local")) +
    "\n" +
    readEnvFile(path.join(baseDir, ".env"));
  const hasToken = !!getEnvValue(envContent, "ACCESS_TOKEN");
  const hasA2A =
    !!process.env.A2A_SECRET || !!getEnvValue(envContent, "A2A_SECRET");

  logOut(`Agent-Native MCP status`);
  logOut(`  App:        ${appId}`);
  logOut(
    hostedUrl
      ? `  MCP URL:    ${hostedUrl} (hosted)`
      : `  MCP URL:    ${origin}/_agent-native/mcp${
          port ? ` (port ${port})` : ""
        }`,
  );
  logOut(`  ACCESS_TOKEN: ${hasToken ? "set" : "not set"} (.env)`);
  logOut(`  A2A_SECRET:   ${hasA2A ? "set" : "not set"}`);
  logOut(`  Clients:`);
  for (const client of CLIENTS) {
    const present = clientHasEntry(client, appId, cwd);
    logOut(`    ${client.padEnd(18)} ${present ? "configured" : "—"}`);
  }
}

function cmdToken(p: ParsedArgs): void {
  const cwd = process.cwd();
  const t = ensureLocalToken(cwd, p.rotate);
  logOut(
    p.rotate
      ? `Rotated ACCESS_TOKEN in ${t.file}`
      : t.created
        ? `Provisioned ACCESS_TOKEN in ${t.file}`
        : `ACCESS_TOKEN (${t.file}):`,
  );
  logOut(t.token);
  if (p.rotate) {
    logOut(
      `  Re-run \`npx @agent-native/core@latest mcp install --client <c>\` so client configs ` +
        `pick up the new token.`,
    );
  }
}

const HELP = `npx @agent-native/core@latest mcp — connect external coding agents over MCP

Usage:
  npx @agent-native/core@latest mcp serve [--app <id>] [--port <n>] [--standalone]
      Run the MCP stdio transport (what client configs spawn).
      Default: proxy to the running local app; --standalone builds from disk.

  npx @agent-native/core@latest mcp install --client <c> [--app <id>] [--scope user|project]
      Provision a token and write the client's MCP config (idempotent).
      Clients: claude-code, claude-code-cli, codex, cowork

  npx @agent-native/core@latest mcp uninstall --client <c> [--app <id>]
      Remove the named MCP entry from a client's config (idempotent).

  npx @agent-native/core@latest mcp status
      Show resolved MCP URL/port, token state, and per-client entries.

  npx @agent-native/core@latest mcp token [--rotate]
      Print (or rotate) the local ACCESS_TOKEN in the workspace .env.`;

export async function runMcp(args: string[]): Promise<void> {
  const p = parseArgs(args);
  const sub = p._[0];

  switch (sub) {
    case "serve":
      await cmdServe(p);
      return;
    case "install":
      await cmdInstall(p);
      return;
    case "uninstall":
      cmdUninstall(p);
      return;
    case "status":
      await cmdStatus();
      return;
    case "token":
      cmdToken(p);
      return;
    case undefined:
    case "--help":
    case "-h":
    case "help":
      logOut(HELP);
      return;
    default:
      logErr(`Unknown mcp subcommand: ${sub}`);
      logOut(HELP);
      process.exit(1);
  }
}
