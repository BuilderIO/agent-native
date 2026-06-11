/**
 * Shared MCP client-config writers.
 *
 * Extracted so both `agent-native mcp install` (see `mcp.ts`) and
 * `agent-native connect` (see `connect.ts`) write the EXACT same on-disk
 * config file targets and formats for every supported client. `mcp.ts`
 * intentionally keeps its own hand-rolled copies of these writers (its
 * external behavior is unchanged); new code should import from here so the
 * formats never diverge.
 *
 * Supported clients and their config files:
 *   - claude-code / claude-code-cli → `.mcp.json` (project) or
 *     `~/.claude.json` (user). JSON `mcpServers[name] = entry`.
 *   - cowork                        → `~/.cowork/mcp.json`. Same JSON shape.
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

export type ClientId = "claude-code" | "claude-code-cli" | "codex" | "cowork";

export const CLIENTS: ClientId[] = [
  "claude-code",
  "claude-code-cli",
  "codex",
  "cowork",
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
export function writeJsonMcpEntry(
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

export function hasJsonMcpEntry(file: string, name: string): boolean {
  const config = readJsonFile(file);
  return !!config?.mcpServers && name in config.mcpServers;
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

function legacyCodexMcpHeader(name: string): string | null {
  return /^[A-Za-z0-9_-]+$/.test(name) ? `[mcp_servers.${name}]` : null;
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

/**
 * Replace (or append) the `[mcp_servers.<name>]` block in a TOML file
 * without disturbing other content. A block is the header line plus every
 * following line until the next top-level `[` table header or EOF. Pass
 * `block === null` to remove the block. Identical algorithm to `mcp.ts`'s
 * `writeCodexBlock` so the two never diverge.
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

export function codexHasBlock(file: string, name: string): boolean {
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
    writeJsonMcpEntry(
      file,
      serverName,
      buildHttpMcpEntry(mcpUrl, token, headers) as unknown as Record<
        string,
        unknown
      >,
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
export function removeJsonSameUrlDuplicates(
  file: string,
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
  const servers = config?.mcpServers;
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

/**
 * After writing the canonical `keepName` Codex block, remove any OTHER
 * `[mcp_servers.*]` blocks in the same TOML file whose `url =` line
 * normalises to the same value as `mcpUrl`. Returns removed entry names.
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
  const out: string[] = [];
  const removed: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    const quoted = trimmed.match(/^\[mcp_servers\."((?:\\.|[^"])*)"\]$/);
    const bare = trimmed.match(/^\[mcp_servers\.([A-Za-z0-9_-]+)\]$/);
    const serverName = quoted
      ? quoted[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\")
      : bare?.[1];
    if (serverName !== undefined && serverName !== keepName) {
      // Collect the block
      const block: string[] = [line];
      i++;
      while (i < lines.length && !/^\s*\[/.test(lines[i])) {
        block.push(lines[i]);
        i++;
      }
      // Check url in block
      const urlMatch = block
        .join("\n")
        .match(/^\s*url\s*=\s*"((?:\\.|[^"])*)"/m);
      const blockUrl = urlMatch
        ? urlMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\")
        : undefined;
      if (canonicalUrl(blockUrl) === targetCanonical) {
        removed.push(serverName);
        // Skip this block (don't push to out)
        continue;
      }
      // Not a duplicate — keep it
      for (const l of block) out.push(l);
      continue;
    }
    out.push(line);
    i++;
  }

  if (removed.length === 0) return [];
  const next = out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n*$/, "\n");
  writeFileAtomic(file, next);
  return removed;
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
  return removeJsonSameUrlDuplicates(file, mcpUrl, serverName);
}
