
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MCP_LEGACY_ROUTE_PREFIX = "/_agent-native/mcp";
const MCP_PUBLIC_ROUTE_PREFIX = "/mcp";

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

export interface HttpMcpEntry {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

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
  command = "agent-native",
): Record<string, unknown> {
  const cleanEnv = env ? Object.fromEntries(Object.entries(env)) : {};
  if (client === "opencode") {
    return {
      type: "local",
      command: [command, ...args],
      enabled: true,
      ...(Object.keys(cleanEnv).length ? { environment: cleanEnv } : {}),
    };
  }
  if (client === "github-copilot") {
    return {
      type: "stdio",
      command,
      args,
      ...(Object.keys(cleanEnv).length ? { env: cleanEnv } : {}),
    };
  }
  return {
    command,
    args,
    ...(Object.keys(cleanEnv).length ? { env: cleanEnv } : {}),
  };
}


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


function readExistingConfigFile(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    const detail = error instanceof Error ? ` (${error.message})` : "";
    throw new Error(
      `Cannot read MCP config file: ${file}\n` +
        `Check that the file is readable and re-run. The file has not been modified.${detail}`,
    );
  }
}

function readJsonFile(file: string): Record<string, any> {
  const raw = readExistingConfigFile(file);
  if (raw === undefined) return {};
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

export function writeFileAtomic(file: string, data: string): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  // Preserve the target's existing permission bits. A fresh temp file would
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


function tomlQuote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function codexMcpHeader(name: string): string {
  return `[mcp_servers.${tomlQuote(name)}]`;
}

function parseTomlTableHeader(line: string): string[] | null {
  const trimmed = line.trim();
  if (trimmed.length < 2 || trimmed[0] !== "[") return null;
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
      if (expectKey) return null;
      expectKey = true;
      i++;
      continue;
    }
    if (!expectKey) return null;
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
      if (i >= inner.length) return null;
      i++;
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
      return null;
    }
  }
  if (expectKey) return null;
  return keys.length ? keys : null;
}

function codexServerNameOfHeader(line: string): string | undefined {
  const keys = parseTomlTableHeader(line);
  if (!keys || keys.length < 2 || keys[0] !== "mcp_servers") return undefined;
  return keys[1];
}

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
  command = "agent-native",
): string {
  const lines: string[] = [codexMcpHeader(name)];
  lines.push(`command = ${tomlQuote(command)}`);
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

export function writeCodexBlock(
  file: string,
  name: string,
  block: string | null,
): void {
  const content = readExistingConfigFile(file) ?? "";

  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  let removed = false;
  while (i < lines.length) {
    const line = lines[i];
    if (codexServerNameOfHeader(line) === name) {
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
  if (block === null && !removed) return;

  writeFileAtomic(file, next);
}

export function codexHasBlock(file: string, name: string): boolean {
  const content = readExistingConfigFile(file);
  return (
    content
      ?.split(/\r?\n/)
      .some((line) => codexServerNameOfHeader(line) === name) ?? false
  );
}


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


export function canonicalUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const u = new URL(value);
    u.hash = "";
    u.search = "";
    const pathname = u.pathname.replace(/\/+$/, "");
    if (
      pathname === MCP_LEGACY_ROUTE_PREFIX ||
      pathname.endsWith(MCP_LEGACY_ROUTE_PREFIX)
    ) {
      u.pathname = `${pathname.slice(0, -MCP_LEGACY_ROUTE_PREFIX.length)}${MCP_PUBLIC_ROUTE_PREFIX}`;
    }
    return u.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

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
