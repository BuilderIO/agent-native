/**
 * Shared MCP client-config writers.
 *
 * Extracted so both `agent-native mcp install` (see `mcp.ts`) and
 * `agent-native connect` (see `connect.ts`) write the EXACT same on-disk
 * config file targets and formats for every supported client.
 *
 * Supported clients and their config files:
 *   - claude-code / claude-code-cli → `.mcp.json` (project) or
 *     `~/.claude.json` (user). JSON `mcpServers[name] = entry`.
 *   - cowork                        → `~/.cowork/mcp.json`. Same JSON shape.
 *   - cursor                        → `.cursor/mcp.json` (project) or
 *     `~/.cursor/mcp.json` (user). JSON `mcpServers[name] = entry`.
 *   - opencode                      → `opencode.json` (project) or
 *     `~/.config/opencode/opencode.json` (user). JSON `mcp[name] = entry`.
 *   - github-copilot                → `.vscode/mcp.json` (project) or the
 *     VS Code user `mcp.json`. JSON `servers[name] = entry`.
 *   - codex                         → `$CODEX_HOME/config.toml` when set,
 *     otherwise `~/.codex/config.toml`.
 *     `[mcp_servers.<name>]` block.
 *
 * Node-only. No new npm deps — hand-rolled JSON merge + minimal TOML block
 * merge, mirroring `mcp.ts`.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type ClientId =
  | "claude-code"
  | "claude-code-cli"
  | "codex"
  | "cowork"
  | "cursor"
  | "opencode"
  | "github-copilot";

export const CLIENTS: ClientId[] = [
  "claude-code",
  "claude-code-cli",
  "codex",
  "cowork",
  "cursor",
  "opencode",
  "github-copilot",
];

/** The HTTP MCP server entry written into a JSON client config. */
export interface HttpMcpEntry {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

/** Build the HTTP MCP server entry for a deployed agent-native app. */
export function buildHttpMcpEntry(
  mcpUrl: string,
  token?: string,
  headers?: Record<string, string>,
): HttpMcpEntry {
  const mergedHeaders = {
    ...(headers ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  return {
    type: "http",
    url: mcpUrl,
    ...(Object.keys(mergedHeaders).length ? { headers: mergedHeaders } : {}),
  };
}

function mergedHeadersFor(
  token?: string,
  headers?: Record<string, string>,
): Record<string, string> {
  return {
    ...(headers ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function buildHttpMcpEntryForClient(
  client: ClientId,
  mcpUrl: string,
  token?: string,
  headers?: Record<string, string>,
): Record<string, unknown> {
  const mergedHeaders = mergedHeadersFor(token, headers);
  if (client === "cursor") {
    return {
      url: mcpUrl,
      ...(Object.keys(mergedHeaders).length ? { headers: mergedHeaders } : {}),
    };
  }
  if (client === "opencode") {
    return {
      type: "remote",
      url: mcpUrl,
      enabled: true,
      ...(Object.keys(mergedHeaders).length ? { headers: mergedHeaders } : {}),
    };
  }
  if (client === "github-copilot") {
    return {
      type: "http",
      url: mcpUrl,
      ...(Object.keys(mergedHeaders).length
        ? { requestInit: { headers: mergedHeaders } }
        : {}),
    };
  }
  return buildHttpMcpEntry(mcpUrl, token, headers) as unknown as Record<
    string,
    unknown
  >;
}

export function buildLocalMcpEntryForClient(
  client: ClientId,
  args: string[],
  env?: Record<string, string>,
): Record<string, unknown> {
  const cleanEnv = env ? Object.fromEntries(Object.entries(env)) : {};
  if (client === "opencode") {
    return {
      type: "local",
      command: ["agent-native", ...args],
      enabled: true,
      ...(Object.keys(cleanEnv).length ? { environment: cleanEnv } : {}),
    };
  }
  if (client === "github-copilot") {
    return {
      type: "stdio",
      command: "agent-native",
      args,
      ...(Object.keys(cleanEnv).length ? { env: cleanEnv } : {}),
    };
  }
  return {
    command: "agent-native",
    args,
    ...(Object.keys(cleanEnv).length ? { env: cleanEnv } : {}),
  };
}

// ---------------------------------------------------------------------------
// Config file locations — kept identical to `mcp.ts`.
// ---------------------------------------------------------------------------

/**
 * Cowork consumes MCP exactly like Claude Code (same JSON server-entry
 * shape). Resolved lazily so `os.homedir()` reflects the current `$HOME`.
 */
export function coworkConfigPath(): string {
  return path.join(os.homedir(), ".cowork", "mcp.json");
}

export function claudeCodeProjectConfig(baseDir: string): string {
  return path.join(baseDir, ".mcp.json");
}

export function claudeCodeUserConfig(): string {
  return path.join(os.homedir(), ".claude.json");
}

export function codexConfigPath(): string {
  const codexHome = process.env.CODEX_HOME?.trim();
  if (codexHome) return path.join(codexHome, "config.toml");
  return path.join(os.homedir(), ".codex", "config.toml");
}

export function cursorProjectConfig(baseDir: string): string {
  return path.join(baseDir, ".cursor", "mcp.json");
}

export function cursorUserConfig(): string {
  return path.join(os.homedir(), ".cursor", "mcp.json");
}

export function opencodeProjectConfig(baseDir: string): string {
  return path.join(baseDir, "opencode.json");
}

export function opencodeUserConfig(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();
  const configRoot = xdgConfigHome || path.join(os.homedir(), ".config");
  return path.join(configRoot, "opencode", "opencode.json");
}

export function githubCopilotProjectConfig(baseDir: string): string {
  return path.join(baseDir, ".vscode", "mcp.json");
}

export function githubCopilotUserConfig(): string {
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Code",
      "User",
      "mcp.json",
    );
  }
  if (process.platform === "win32") {
    const appData =
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Code", "User", "mcp.json");
  }
  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();
  const configRoot = xdgConfigHome || path.join(os.homedir(), ".config");
  return path.join(configRoot, "Code", "User", "mcp.json");
}

/**
 * Resolve the on-disk config path for a client.
 *
 * `scope` only affects Claude Code / Claude Code CLI: `"user"` → the global
 * `~/.claude.json`, anything else → the project-local `.mcp.json` rooted at
 * `baseDir`.
 */
export function configPathFor(
  client: ClientId,
  baseDir: string,
  scope: string | undefined,
): string {
  switch (client) {
    case "claude-code":
    case "claude-code-cli":
      return scope === "user"
        ? claudeCodeUserConfig()
        : claudeCodeProjectConfig(baseDir);
    case "cowork":
      return coworkConfigPath();
    case "codex":
      return codexConfigPath();
    case "cursor":
      return scope === "user"
        ? cursorUserConfig()
        : cursorProjectConfig(baseDir);
    case "opencode":
      return scope === "user"
        ? opencodeUserConfig()
        : opencodeProjectConfig(baseDir);
    case "github-copilot":
      return scope === "user"
        ? githubCopilotUserConfig()
        : githubCopilotProjectConfig(baseDir);
  }
}

// ---------------------------------------------------------------------------
// JSON client configs (Claude Code, Claude Code CLI, Cowork)
// ---------------------------------------------------------------------------

/**
 * Read and parse a JSON config file.
 *
 * - Missing file → returns `{}` (fresh config).
 * - Empty file   → returns `{}` (treat as not-yet-initialised).
 * - Non-empty file that fails to parse → throws a descriptive Error so the
 *   caller can surface it to the user instead of silently overwriting the
 *   file with only the new MCP entry (data-loss hazard).
 */
function readJsonFile(file: string): Record<string, any> {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch {
    // Missing (ENOENT) or unreadable file — treat as empty.
    return {};
  }
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    throw new Error(
      `Cannot parse JSON config file: ${file}\n` +
        `Fix or move the file and re-run. The file has not been modified.`,
    );
  }
}

/**
 * Write `data` to `file` atomically: write a sibling temp file, then rename it
 * over the target. `rename(2)` is atomic on the same filesystem, so a crash or
 * `kill` mid-write can never leave a half-written/truncated file. This matters
 * most for `~/.claude.json`, which is Claude Code's entire user state (projects,
 * history, auth) — a torn write there would corrupt the user's whole config,
 * not just our MCP entry. The temp file lives in the target's directory so the
 * rename stays within one filesystem.
 */
export function writeFileAtomic(file: string, data: string): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  // Preserve the target's existing permission bits. A fresh temp file would
  // otherwise be created with the umask default (typically 0644), silently
  // loosening a secret-bearing file the user locked down to 0600 (e.g. .env).
  let mode: number | undefined;
  try {
    mode = fs.statSync(file).mode & 0o777;
  } catch {
    // Target doesn't exist yet — let the default creation mode apply.
  }
  const tmp = path.join(dir, `.${path.basename(file)}.tmp-${process.pid}`);
  try {
    fs.writeFileSync(tmp, data, "utf-8");
    if (mode !== undefined) fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {}
    throw err;
  }
}

/**
 * Idempotently write `mcpServers[name] = entry` into a JSON config file.
 * Pass `entry === null` to delete the named entry. Re-running with the same
 * name replaces the existing entry in place — never duplicates.
 */
export function jsonMcpConfigKeyForClient(client: ClientId): string {
  if (client === "opencode") return "mcp";
  if (client === "github-copilot") return "servers";
  return "mcpServers";
}

function writeJsonMcpEntryAtKey(
  file: string,
  serversKey: string,
  name: string,
  entry: Record<string, unknown> | null,
): void {
  const config = readJsonFile(file);
  if (!config[serversKey] || typeof config[serversKey] !== "object") {
    config[serversKey] = {};
  }
  const servers = config[serversKey] as Record<string, unknown>;
  if (entry === null) {
    delete servers[name];
  } else {
    servers[name] = entry;
  }
  writeFileAtomic(file, JSON.stringify(config, null, 2) + "\n");
}

export function writeJsonMcpEntry(
  file: string,
  name: string,
  entry: Record<string, unknown> | null,
): void {
  writeJsonMcpEntryAtKey(file, "mcpServers", name, entry);
}

export function writeJsonMcpEntryForClient(
  client: ClientId,
  file: string,
  name: string,
  entry: Record<string, unknown> | null,
): void {
  writeJsonMcpEntryAtKey(file, jsonMcpConfigKeyForClient(client), name, entry);
}

export function hasJsonMcpEntry(file: string, name: string): boolean {
  const config = readJsonFile(file);
  return !!config?.mcpServers && name in config.mcpServers;
}

export function hasJsonMcpEntryForClient(
  client: ClientId,
  file: string,
  name: string,
): boolean {
  const config = readJsonFile(file);
  const servers = config?.[jsonMcpConfigKeyForClient(client)];
  return !!servers && typeof servers === "object" && name in servers;
}

// ---------------------------------------------------------------------------
// Codex TOML (hand-rolled minimal block merge, no new dep)
// ---------------------------------------------------------------------------

function tomlQuote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function codexMcpHeader(name: string): string {
  return `[mcp_servers.${tomlQuote(name)}]`;
}

/**
 * Parse a TOML table-header line such as `[mcp_servers."plan".http_headers]`
 * or `[mcp_servers.plan] # local note` into its decoded dotted-key components
 * (`["mcp_servers", "plan", "http_headers"]`). Returns `null` when the line is
 * not a single `[table]` header — blank lines, key/value pairs, comments,
 * invalid trailing content, and `[[array-of-tables]]` headers all return `null`,
 * so the result doubles as a reliable "is this line a table boundary?" check.
 *
 * Handles bare keys (`A-Za-z0-9_-`) and quoted keys (basic `"..."` with `\`
 * escapes, and literal `'...'`), tolerating whitespace around the dot
 * separators per the TOML spec. Quoted-key escape handling mirrors the inverse
 * of `tomlQuote` (`\"` → `"`, `\\` → `\`).
 */
function parseTomlTableHeader(line: string): string[] | null {
  const trimmed = line.trim();
  if (trimmed.length < 2 || trimmed[0] !== "[") return null;
  // `[[array-of-tables]]` is a different construct — leave it untouched.
  if (trimmed[1] === "[") return null;

  let quote: '"' | "'" | null = null;
  let escaped = false;
  let closeIndex = -1;
  for (let i = 1; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (quote === '"') {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (ch === "'") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "]") {
      closeIndex = i;
      break;
    }
  }
  if (closeIndex < 0) return null;
  const trailing = trimmed.slice(closeIndex + 1).trim();
  if (trailing && !trailing.startsWith("#")) return null;

  const inner = trimmed.slice(1, closeIndex);
  const keys: string[] = [];
  const isWs = (c: string) => c === " " || c === "\t";
  const isBare = (c: string) => /[A-Za-z0-9_-]/.test(c);
  let i = 0;
  let expectKey = true;
  while (i < inner.length) {
    while (i < inner.length && isWs(inner[i])) i++;
    if (i >= inner.length) break;
    const ch = inner[i];
    if (ch === ".") {
      if (expectKey) return null; // leading or doubled dot
      expectKey = true;
      i++;
      continue;
    }
    if (!expectKey) return null; // two keys with no dot between them
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      let key = "";
      while (i < inner.length && inner[i] !== quote) {
        if (quote === '"' && inner[i] === "\\" && i + 1 < inner.length) {
          const next = inner[i + 1];
          key += next === '"' ? '"' : next === "\\" ? "\\" : `\\${next}`;
          i += 2;
          continue;
        }
        key += inner[i];
        i++;
      }
      if (i >= inner.length) return null; // unterminated quote
      i++; // consume the closing quote
      keys.push(key);
      expectKey = false;
    } else if (isBare(ch)) {
      let key = "";
      while (i < inner.length && isBare(inner[i])) {
        key += inner[i];
        i++;
      }
      keys.push(key);
      expectKey = false;
    } else {
      return null; // unexpected character — not a table header
    }
  }
  if (expectKey) return null; // empty header or trailing dot
  return keys.length ? keys : null;
}

/**
 * The MCP server name a TOML table header belongs to, or `undefined` when the
 * header is not under `[mcp_servers.*]`. The server's own table
 * (`[mcp_servers.<name>]`) AND every sub-table of it
 * (`[mcp_servers.<name>.http_headers]`, `[mcp_servers.<name>.env]`, …) resolve
 * to the same `<name>`, so callers can treat a server and all its sub-tables as
 * one removable unit. This is what prevents a re-install from orphaning a stale
 * `[mcp_servers.<name>.http_headers]` sub-table that would then collide with the
 * freshly written inline `http_headers` (a TOML duplicate-key error).
 */
function codexServerNameOfHeader(line: string): string | undefined {
  const keys = parseTomlTableHeader(line);
  if (!keys || keys.length < 2 || keys[0] !== "mcp_servers") return undefined;
  return keys[1];
}

/** Build a `[mcp_servers.<name>]` block for an HTTP-type MCP server. */
export function buildCodexHttpBlock(
  name: string,
  mcpUrl: string,
  token?: string,
  headers?: Record<string, string>,
): string {
  const lines: string[] = [codexMcpHeader(name)];
  lines.push(`url = ${tomlQuote(mcpUrl)}`);
  const mergedHeaders = {
    ...(headers ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const headerEntries = Object.entries(mergedHeaders);
  if (headerEntries.length) {
    lines.push(
      `http_headers = { ${headerEntries
        .map(([key, value]) => `${tomlQuote(key)} = ${tomlQuote(value)}`)
        .join(", ")} }`,
    );
  }
  return lines.join("\n") + "\n";
}

export function buildCodexLocalBlock(
  name: string,
  args: string[],
  env?: Record<string, string>,
): string {
  const lines: string[] = [codexMcpHeader(name)];
  lines.push(`command = "agent-native"`);
  lines.push(`args = [${args.map(tomlQuote).join(", ")}]`);
  const cleanEnv = env ? Object.fromEntries(Object.entries(env)) : {};
  if (Object.keys(cleanEnv).length) {
    const inline = Object.entries(cleanEnv)
      .map(([key, value]) => `${key} = ${tomlQuote(value)}`)
      .join(", ");
    lines.push(`env = { ${inline} }`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Replace (or append) the entire `[mcp_servers.<name>]` footprint in a TOML
 * file without disturbing other content. The footprint is the server's own
 * table AND every sub-table of it (`[mcp_servers.<name>.http_headers]`,
 * `[mcp_servers.<name>.env]`, …), each spanning its header line plus every
 * following line until the next table header or EOF. Removing the whole
 * footprint — wherever the pieces sit in the file — is what keeps a re-install
 * from leaving a stale sub-table that collides with the freshly written inline
 * block (a TOML duplicate-key error). Matches both the canonical quoted header
 * and the legacy bare header. Pass `block === null` to remove the footprint.
 * Identical algorithm to `mcp.ts`'s `writeCodexBlock` so the two never diverge.
 */
export function writeCodexBlock(
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

  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  let removed = false;
  while (i < lines.length) {
    const line = lines[i];
    if (codexServerNameOfHeader(line) === name) {
      // Skip this table and its body (until the next table header), covering
      // the server table itself and any of its sub-tables.
      removed = true;
      i++;
      while (i < lines.length && parseTomlTableHeader(lines[i]) === null) i++;
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

export function codexHasBlock(file: string, name: string): boolean {
  try {
    const content = fs.readFileSync(file, "utf-8");
    return content
      .split(/\r?\n/)
      .some((line) => codexServerNameOfHeader(line) === name);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Unified write helper
// ---------------------------------------------------------------------------

/**
 * Idempotently write the HTTP MCP server entry for `serverName` into the
 * given client's config file and return the file path that was written.
 * Re-running replaces the same named entry — never duplicates.
 */
export function writeHttpEntryForClient(
  client: ClientId,
  serverName: string,
  mcpUrl: string,
  token: string | undefined,
  baseDir: string,
  scope: string | undefined,
  headers?: Record<string, string>,
): string {
  const file = configPathFor(client, baseDir, scope);
  if (client === "codex") {
    writeCodexBlock(
      file,
      serverName,
      buildCodexHttpBlock(serverName, mcpUrl, token, headers),
    );
  } else {
    writeJsonMcpEntryForClient(
      client,
      file,
      serverName,
      buildHttpMcpEntryForClient(client, mcpUrl, token, headers),
    );
  }
  return file;
}

// ---------------------------------------------------------------------------
// Same-URL duplicate removal
// ---------------------------------------------------------------------------

/**
 * Canonicalise a URL for comparison: strip hash, search params, and trailing
 * slashes. Returns `undefined` for invalid URLs.
 */
export function canonicalUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const u = new URL(value);
    u.hash = "";
    u.search = "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

/**
 * After writing the canonical `keepName` entry into a JSON config file,
 * remove any OTHER entries whose URL normalises to the same value as
 * `mcpUrl`. This cleans up stale alias names, legacy default names, and
 * leftover custom names that all pointed at the same server.
 *
 * Returns the list of entry names that were removed.
 */
function removeJsonSameUrlDuplicatesAtKey(
  file: string,
  serversKey: string,
  mcpUrl: string,
  keepName: string,
): string[] {
  let config: Record<string, any>;
  try {
    const raw = fs.readFileSync(file, "utf-8");
    if (!raw.trim()) return [];
    config = JSON.parse(raw);
  } catch {
    return [];
  }
  const servers = config?.[serversKey];
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    return [];
  }
  const targetCanonical = canonicalUrl(mcpUrl);
  if (!targetCanonical) return [];

  const toRemove: string[] = [];
  for (const name of Object.keys(servers)) {
    if (name === keepName) continue;
    const entry = servers[name];
    if (!entry || typeof entry !== "object") continue;
    const entryUrl = typeof entry.url === "string" ? entry.url : undefined;
    if (canonicalUrl(entryUrl) === targetCanonical) {
      toRemove.push(name);
    }
  }
  if (toRemove.length === 0) return [];
  for (const name of toRemove) {
    delete servers[name];
  }
  writeFileAtomic(file, JSON.stringify(config, null, 2) + "\n");
  return toRemove;
}

export function removeJsonSameUrlDuplicates(
  file: string,
  mcpUrl: string,
  keepName: string,
): string[] {
  return removeJsonSameUrlDuplicatesAtKey(file, "mcpServers", mcpUrl, keepName);
}

/**
 * After writing the canonical `keepName` Codex block, remove any OTHER
 * `[mcp_servers.*]` servers in the same TOML file whose `url =` line normalises
 * to the same value as `mcpUrl`. A server's entire footprint is removed — its
 * own table AND any sub-tables (`.http_headers`, `.env`, …), even when they are
 * not contiguous — so cleanup never leaves an orphaned sub-table behind.
 * Returns removed entry names in first-seen order.
 */
export function removeCodexSameUrlDuplicates(
  file: string,
  mcpUrl: string,
  keepName: string,
): string[] {
  let content = "";
  try {
    content = fs.readFileSync(file, "utf-8");
  } catch {
    return [];
  }
  const targetCanonical = canonicalUrl(mcpUrl);
  if (!targetCanonical) return [];

  const lines = content.split(/\r?\n/);

  // Pass 1: map each server name to the canonical URL declared on its own
  // table, preserving first-seen order. Sub-tables don't carry the URL, so they
  // only register the name.
  const serverUrls = new Map<string, string | undefined>();
  let i = 0;
  while (i < lines.length) {
    const keys = parseTomlTableHeader(lines[i]);
    const name =
      keys && keys.length >= 2 && keys[0] === "mcp_servers"
        ? keys[1]
        : undefined;
    if (name === undefined) {
      i++;
      continue;
    }
    const isServerTable = keys!.length === 2;
    const body: string[] = [];
    i++;
    while (i < lines.length && parseTomlTableHeader(lines[i]) === null) {
      body.push(lines[i]);
      i++;
    }
    if (isServerTable) {
      const urlMatch = body
        .join("\n")
        .match(/^\s*url\s*=\s*"((?:\\.|[^"])*)"/m);
      const blockUrl = urlMatch
        ? urlMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\")
        : undefined;
      serverUrls.set(name, canonicalUrl(blockUrl));
    } else if (!serverUrls.has(name)) {
      serverUrls.set(name, undefined);
    }
  }

  const removeSet = new Set<string>();
  for (const [name, canonical] of serverUrls) {
    if (name !== keepName && canonical && canonical === targetCanonical) {
      removeSet.add(name);
    }
  }
  if (removeSet.size === 0) return [];

  // Pass 2: rebuild, dropping every table/sub-table belonging to a removed
  // server.
  const out: string[] = [];
  i = 0;
  while (i < lines.length) {
    const name = codexServerNameOfHeader(lines[i]);
    if (name !== undefined && removeSet.has(name)) {
      i++;
      while (i < lines.length && parseTomlTableHeader(lines[i]) === null) i++;
      continue;
    }
    out.push(lines[i]);
    i++;
  }

  const next = out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n*$/, "\n");
  writeFileAtomic(file, next);
  return [...removeSet];
}

/**
 * Unified helper: after writing the canonical `serverName` entry for the
 * given `client`, remove same-URL duplicates from its config file.
 * Returns the list of removed names (empty if nothing was cleaned up).
 */
export function removeSameUrlDuplicatesForClient(
  client: ClientId,
  serverName: string,
  mcpUrl: string,
  baseDir: string,
  scope: string | undefined,
): string[] {
  const file = configPathFor(client, baseDir, scope);
  if (client === "codex") {
    return removeCodexSameUrlDuplicates(file, mcpUrl, serverName);
  }
  return removeJsonSameUrlDuplicatesAtKey(
    file,
    jsonMcpConfigKeyForClient(client),
    mcpUrl,
    serverName,
  );
}
