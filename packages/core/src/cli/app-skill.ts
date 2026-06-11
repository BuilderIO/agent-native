/**
 * `agent-native app-skill` packages an agent-native app as a distributable
 * skill bundle: instructions + MCP connector + embeddable app surfaces.
 *
 * The manifest intentionally contains no user secrets. Hosted installs write
 * URL-only MCP entries; clients that need auth complete OAuth/device setup in
 * the host. Local installs point at a developer-owned app process.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

import {
  type ClientId,
  buildHttpMcpEntry,
  removeSameUrlDuplicatesForClient,
} from "./mcp-config-writers.js";
import { resolveClients, writeConfigs } from "./connect.js";

export type SkillVisibility = "internal" | "exported" | "both";
export type AppSkillHostAdapter =
  | "codex-plugin"
  | "claude-marketplace"
  | "vercel-skills"
  | "plain-skill"
  | "claude-skill"
  | "chatgpt-mcp"
  | "generic-mcp";

export interface AppSkillManifestSkill {
  path: string;
  visibility: SkillVisibility;
  exportAs?: string;
}

export interface AppSkillSurface {
  id: string;
  action?: string;
  path: string;
  mediaTypes?: string[];
  defaultMediaType?: string;
}

export interface AppSkillManifest {
  schemaVersion: 1;
  id: string;
  displayName: string;
  description: string;
  /**
   * Optional semver base for generated plugin manifests. Codex keys its plugin
   * cache on the version string, so the packer appends a content hash to this
   * base; leave it unset to default to "1.0.0".
   */
  version?: string;
  hosted: {
    url: string;
    mcpUrl: string;
  };
  mcp: {
    serverName: string;
    aliases?: string[];
  };
  local?: {
    template?: string;
    sourcePath?: string;
    defaultUrl?: string;
    commands?: {
      install?: string;
      dev?: string;
      start?: string;
    };
  };
  auth?: {
    mode?: "oauth" | "device" | "none";
    setup?: string;
  };
  surfaces: AppSkillSurface[];
  skills: AppSkillManifestSkill[];
  hostAdapters: AppSkillHostAdapter[];
}

export interface LoadedAppSkillManifest {
  manifest: AppSkillManifest;
  file: string;
  dir: string;
}

export interface ParsedAppSkillArgs {
  command: "ensure" | "launch" | "pack" | "help";
  manifest?: string;
  client: string;
  scope: string;
  serverName?: string;
  out?: string;
  into?: string;
  mode: "hosted" | "local";
  dryRun: boolean;
  skipInstall: boolean;
  noRegister: boolean;
  printJson: boolean;
  yes: boolean;
}

export interface EnsureAppSkillOptions {
  mode?: "hosted" | "local";
  clients?: ClientId[];
  scope?: string;
  serverName?: string;
  baseDir?: string;
  dryRun?: boolean;
  confirm?: boolean;
  yes?: boolean;
  log?: (message: string) => void;
}

export interface EnsureAppSkillResult {
  mode: "hosted" | "local";
  serverName: string;
  mcpUrl: string;
  clients: ClientId[];
  written: { client: ClientId; file: string }[];
}

export interface LaunchAppSkillOptions {
  mode?: "hosted" | "local";
  into?: string;
  dryRun?: boolean;
  skipInstall?: boolean;
  noRegister?: boolean;
  clients?: ClientId[];
  scope?: string;
  serverName?: string;
  baseDir?: string;
  confirm?: boolean;
  yes?: boolean;
  log?: (message: string) => void;
}

export interface AppSkillLaunchPlan {
  mode: "hosted" | "local";
  appId: string;
  appDir?: string;
  sourceDir?: string;
  url: string;
  mcpUrl: string;
  serverName: string;
  commands: {
    install?: string;
    dev?: string;
    start?: string;
  };
}

const HELP = `agent-native app-skill

Usage:
  agent-native app-skill ensure [--manifest <file>] [--hosted|--local] [--client all|codex|claude-code|claude-code-cli|cowork] [--scope user|project] [--name <server>] [--yes] [--dry-run] [--json]
  agent-native app-skill launch [--manifest <file>] [--local|--hosted] [--into <path>] [--client <client>] [--scope user|project] [--name <server>] [--no-register] [--skip-install] [--yes] [--dry-run] [--json]
  agent-native app-skill pack   [--manifest <file>] --out <dir> [--json]

Commands:
  ensure   Register the app skill MCP connector for your local agent clients.
  launch   Open the hosted app, or materialize and start a local editable app.
  pack     Create marketplace-ready skill, MCP, Codex/Claude plugin, and Vercel skills adapters.

Hosted is the default. Use --local when you want editable source, offline work,
or a privacy-sensitive local app instance.`;

const APP_SKILL_COMMANDS = new Set(["ensure", "launch", "pack"]);
const APP_SKILL_SCOPES = new Set(["user", "project"]);
const SAFE_PACKAGE_EXECUTABLES = new Set(["pnpm", "npm", "bun", "yarn"]);
const SAFE_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "TERM",
  "CI",
  "PNPM_HOME",
  "COREPACK_HOME",
  "SystemRoot",
  "ComSpec",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeOriginUrl(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} must be a valid URL.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${field} must use http:// or https://.`);
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

function withMcpPath(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/_agent-native/mcp`;
}

function normalizeSkillVisibility(value: unknown): SkillVisibility {
  if (value === "internal" || value === "exported" || value === "both") {
    return value;
  }
  return "both";
}

function normalizeHostAdapter(value: unknown): AppSkillHostAdapter | null {
  if (
    value === "codex-plugin" ||
    value === "claude-marketplace" ||
    value === "vercel-skills" ||
    value === "plain-skill" ||
    value === "claude-skill" ||
    value === "chatgpt-mcp" ||
    value === "generic-mcp"
  ) {
    return value;
  }
  return null;
}

function defaultHostAdapters(): AppSkillHostAdapter[] {
  return [
    "codex-plugin",
    "claude-marketplace",
    "vercel-skills",
    "plain-skill",
    "claude-skill",
    "chatgpt-mcp",
    "generic-mcp",
  ];
}

function uniqueAdapters(values: AppSkillHostAdapter[]): AppSkillHostAdapter[] {
  const seen = new Set<AppSkillHostAdapter>();
  return values.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export function normalizeAppSkillManifest(raw: unknown): AppSkillManifest {
  if (!isRecord(raw)) throw new Error("App skill manifest must be an object.");
  const schemaVersion = raw.schemaVersion ?? 1;
  if (schemaVersion !== 1) {
    throw new Error(`Unsupported app skill schemaVersion: ${schemaVersion}`);
  }

  const id = stringValue(raw.id);
  if (!id || !/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/.test(id)) {
    throw new Error(
      "App skill manifest id must be kebab-case and 2-64 characters.",
    );
  }

  const hostedRaw = isRecord(raw.hosted) ? raw.hosted : {};
  const hostedUrl = normalizeOriginUrl(
    stringValue(hostedRaw.url) ?? "",
    "hosted.url",
  );
  const hostedMcpUrl = normalizeOriginUrl(
    stringValue(hostedRaw.mcpUrl) ?? withMcpPath(hostedUrl),
    "hosted.mcpUrl",
  );

  const mcpRaw = isRecord(raw.mcp) ? raw.mcp : {};
  const localRaw = isRecord(raw.local) ? raw.local : undefined;
  const commandsRaw = isRecord(localRaw?.commands)
    ? localRaw.commands
    : undefined;
  const surfacesRaw = Array.isArray(raw.surfaces) ? raw.surfaces : [];
  const skillsRaw = Array.isArray(raw.skills) ? raw.skills : [];
  const adaptersRaw = Array.isArray(raw.hostAdapters) ? raw.hostAdapters : [];
  const authRaw = isRecord(raw.auth) ? raw.auth : undefined;

  const adapters = uniqueAdapters(
    adaptersRaw
      .map(normalizeHostAdapter)
      .filter((value): value is AppSkillHostAdapter => Boolean(value)),
  );

  return {
    schemaVersion: 1,
    id,
    displayName: stringValue(raw.displayName) ?? id,
    description:
      stringValue(raw.description) ??
      `Agent-native app-backed skill for ${id}.`,
    ...(stringValue(raw.version) ? { version: stringValue(raw.version) } : {}),
    hosted: {
      url: hostedUrl,
      mcpUrl: hostedMcpUrl,
    },
    mcp: {
      serverName: stringValue(mcpRaw.serverName) ?? `agent-native-${id}`,
      aliases: stringArray(mcpRaw.aliases),
    },
    ...(localRaw
      ? {
          local: {
            ...(stringValue(localRaw.template)
              ? { template: stringValue(localRaw.template) }
              : {}),
            ...(stringValue(localRaw.sourcePath)
              ? { sourcePath: stringValue(localRaw.sourcePath) }
              : {}),
            ...(stringValue(localRaw.defaultUrl)
              ? {
                  defaultUrl: normalizeOriginUrl(
                    stringValue(localRaw.defaultUrl)!,
                    "local.defaultUrl",
                  ),
                }
              : {}),
            commands: {
              install: stringValue(commandsRaw?.install) ?? "pnpm install",
              dev: stringValue(commandsRaw?.dev) ?? "pnpm dev",
              start: stringValue(commandsRaw?.start) ?? "pnpm start",
            },
          },
        }
      : {}),
    ...(authRaw
      ? {
          auth: {
            ...(authRaw.mode === "oauth" ||
            authRaw.mode === "device" ||
            authRaw.mode === "none"
              ? { mode: authRaw.mode }
              : {}),
            ...(stringValue(authRaw.setup)
              ? { setup: stringValue(authRaw.setup) }
              : {}),
          },
        }
      : {}),
    surfaces: surfacesRaw.filter(isRecord).map((surface) => ({
      id: stringValue(surface.id) ?? "app",
      ...(stringValue(surface.action)
        ? { action: stringValue(surface.action) }
        : {}),
      path: stringValue(surface.path) ?? "/",
      mediaTypes: stringArray(surface.mediaTypes),
      ...(stringValue(surface.defaultMediaType)
        ? { defaultMediaType: stringValue(surface.defaultMediaType) }
        : {}),
    })),
    skills: skillsRaw
      .filter(isRecord)
      .map((skill) => ({
        path: stringValue(skill.path) ?? "",
        visibility: normalizeSkillVisibility(skill.visibility),
        ...(stringValue(skill.exportAs)
          ? { exportAs: stringValue(skill.exportAs) }
          : {}),
      }))
      .filter((skill) => skill.path),
    hostAdapters: adapters.length ? adapters : defaultHostAdapters(),
  };
}

export function findAppSkillManifest(startDir: string = process.cwd()): string {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, "agent-native.app-skill.json");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(
    "Could not find agent-native.app-skill.json. Pass --manifest <file>.",
  );
}

export function loadAppSkillManifest(file?: string): LoadedAppSkillManifest {
  const resolved = path.resolve(file ?? findAppSkillManifest());
  const raw = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  return {
    manifest: normalizeAppSkillManifest(raw),
    file: resolved,
    dir: path.dirname(resolved),
  };
}

export function exportedSkills(
  manifest: AppSkillManifest,
): AppSkillManifestSkill[] {
  return manifest.skills.filter(
    (skill) => skill.visibility === "exported" || skill.visibility === "both",
  );
}

export function internalSkills(
  manifest: AppSkillManifest,
): AppSkillManifestSkill[] {
  return manifest.skills.filter(
    (skill) => skill.visibility === "internal" || skill.visibility === "both",
  );
}

export function parseAppSkillArgs(argv: string[]): ParsedAppSkillArgs {
  const first = argv[0];
  let command: ParsedAppSkillArgs["command"] = "ensure";
  let args = argv;
  if (first === "help" || first === "--help" || first === "-h") {
    command = "help";
    args = argv.slice(1);
  } else if (APP_SKILL_COMMANDS.has(first ?? "")) {
    command = first as ParsedAppSkillArgs["command"];
    args = argv.slice(1);
  } else if (first && !first.startsWith("-") && !looksLikeManifestArg(first)) {
    throw new Error(`Unknown app-skill command: ${first}`);
  }
  const out: ParsedAppSkillArgs = {
    command,
    client: "all",
    scope: "user",
    mode: "hosted",
    dryRun: false,
    skipInstall: false,
    noRegister: false,
    printJson: false,
    yes: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const eat = (flag: string): string | undefined => {
      if (arg === flag) {
        const next = args[++i];
        if (!next || next.startsWith("-")) {
          throw new Error(`Missing value for ${flag}.`);
        }
        return next;
      }
      if (arg.startsWith(`${flag}=`)) {
        const value = arg.slice(flag.length + 1);
        if (!value) throw new Error(`Missing value for ${flag}.`);
        return value;
      }
      return undefined;
    };
    let value: string | undefined;
    if ((value = eat("--manifest")) !== undefined) out.manifest = value;
    else if ((value = eat("--client")) !== undefined) out.client = value;
    else if ((value = eat("--scope")) !== undefined) out.scope = value;
    else if ((value = eat("--name")) !== undefined) out.serverName = value;
    else if ((value = eat("--server-name")) !== undefined)
      out.serverName = value;
    else if ((value = eat("--out")) !== undefined) out.out = value;
    else if ((value = eat("--into")) !== undefined) out.into = value;
    else if (arg === "--local") out.mode = "local";
    else if (arg === "--hosted") out.mode = "hosted";
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--skip-install" || arg === "--no-install")
      out.skipInstall = true;
    else if (arg === "--no-register") out.noRegister = true;
    else if (arg === "--json") out.printJson = true;
    else if (arg === "--yes" || arg === "-y") out.yes = true;
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else if (!out.manifest) out.manifest = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }

  if (!APP_SKILL_SCOPES.has(out.scope)) {
    throw new Error("--scope must be either user or project.");
  }

  return out;
}

function looksLikeManifestArg(value: string): boolean {
  return (
    value.endsWith(".json") ||
    value.includes("/") ||
    value.includes("\\") ||
    fs.existsSync(value)
  );
}

function assertPathInside(root: string, target: string, field: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative && (relative.startsWith("..") || path.isAbsolute(relative))) {
    throw new Error(`${field} must resolve inside ${resolvedRoot}.`);
  }
  return resolvedTarget;
}

function resolveSkillSource(manifestDir: string, skill: AppSkillManifestSkill) {
  if (path.isAbsolute(skill.path)) {
    throw new Error(`Skill path must be relative: ${skill.path}`);
  }
  return assertPathInside(
    manifestDir,
    path.resolve(manifestDir, skill.path),
    `Skill path ${skill.path}`,
  );
}

function skillExportName(skill: AppSkillManifestSkill): string {
  if (skill.exportAs) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(skill.exportAs)) {
      throw new Error(`Invalid skill export name: ${skill.exportAs}`);
    }
    return skill.exportAs;
  }
  const normalized = skill.path.replace(/\/+$/, "");
  return path.basename(normalized);
}

function copyDirFiltered(source: string, dest: string): void {
  const sourceRoot = path.resolve(source);
  const destRoot = path.resolve(dest);
  const relativeDest = path.relative(sourceRoot, destRoot);
  const outputRootInsideSource =
    relativeDest &&
    !relativeDest.startsWith("..") &&
    !path.isAbsolute(relativeDest)
      ? path.join(sourceRoot, relativeDest.split(path.sep)[0])
      : destRoot;
  fs.cpSync(source, dest, {
    recursive: true,
    filter: (src) => {
      const resolved = path.resolve(src);
      if (
        resolved === outputRootInsideSource ||
        resolved.startsWith(`${outputRootInsideSource}${path.sep}`)
      ) {
        return false;
      }
      const base = path.basename(src);
      const lower = base.toLowerCase();
      return (
        base !== "node_modules" &&
        base !== ".git" &&
        base !== "dist" &&
        base !== ".output" &&
        base !== ".react-router" &&
        base !== ".netlify" &&
        base !== "secrets" &&
        base !== "private" &&
        !base.startsWith(".env") &&
        base !== ".dev.vars" &&
        base !== ".npmrc" &&
        !lower.endsWith(".db") &&
        !lower.endsWith(".sqlite") &&
        !lower.endsWith(".sqlite3") &&
        !lower.endsWith(".pem") &&
        !lower.endsWith(".key") &&
        !lower.endsWith(".crt") &&
        !lower.endsWith(".p12")
      );
    },
  });
}

function copySkill(
  manifestDir: string,
  skill: AppSkillManifestSkill,
  destRoot: string,
): string {
  const source = resolveSkillSource(manifestDir, skill);
  const exportName = skillExportName(skill);
  const dest = path.join(destRoot, exportName);
  if (!fs.existsSync(source)) {
    throw new Error(`Exported skill source not found: ${source}`);
  }
  fs.mkdirSync(destRoot, { recursive: true });
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    copyDirFiltered(source, dest);
  } else {
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(source, path.join(dest, "SKILL.md"));
  }
  rewriteSkillFrontmatterName(path.join(dest, "SKILL.md"), exportName);
  return dest;
}

function rewriteSkillFrontmatterName(file: string, name: string): void {
  if (!fs.existsSync(file)) return;
  const source = fs.readFileSync(file, "utf-8");
  const lines = source.split("\n");
  if (lines[0]?.trim() !== "---") return;
  const end = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  if (end <= 0) return;
  const nameIndex = lines.findIndex(
    (line, index) => index > 0 && index < end && /^name\s*:/.test(line),
  );
  if (nameIndex === -1) {
    lines.splice(1, 0, `name: ${name}`);
  } else {
    lines[nameIndex] = `name: ${name}`;
  }
  fs.writeFileSync(file, lines.join("\n"), "utf-8");
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf-8");
}

function mcpServerNames(
  manifest: AppSkillManifest,
  serverName?: string,
): string[] {
  if (serverName) return [serverName];
  const names = [manifest.mcp.serverName, ...(manifest.mcp.aliases ?? [])];
  return [...new Set(names.filter(Boolean))];
}

function mcpServerConfig(manifest: AppSkillManifest, serverName?: string) {
  const entry = buildHttpMcpEntry(manifest.hosted.mcpUrl);
  return {
    mcpServers: Object.fromEntries(
      mcpServerNames(manifest, serverName).map((name) => [name, entry]),
    ),
  };
}

function pluginName(manifest: AppSkillManifest): string {
  return `agent-native-${manifest.id}`;
}

function claudeMarketplaceName(): string {
  return "agent-native-apps";
}

export function exportedSkillContentHash(
  manifestDir: string,
  skills: AppSkillManifestSkill[],
  manifest: AppSkillManifest,
): string {
  const parts = skills
    .map((skill) => {
      const skillDir = path.join(manifestDir, skill.path);
      // Hash SKILL.md plus every sibling file under the skill dir (e.g.
      // references/*), so a progressive-disclosure reference edit still changes
      // the content hash and bumps the Codex plugin version for auto-upgrade.
      const body = collectSkillFiles(skillDir)
        .map(
          (rel) =>
            `${rel}\n${fs.readFileSync(path.join(skillDir, rel), "utf-8")}`,
        )
        .join("\n \n");
      return `${skillExportName(skill)}\n${body}`;
    })
    .sort();
  parts.push(
    `mcp:${mcpServerNames(manifest).join(",")}:${manifest.hosted.mcpUrl}`,
  );
  return createHash("sha256")
    .update(parts.join("\n \n"))
    .digest("hex")
    .slice(0, 12);
}

/**
 * List a skill dir's files (SKILL.md + any siblings like references/*) as
 * skill-relative POSIX paths, sorted for a stable content hash. A bare SKILL.md
 * source (file, not dir) falls back to just "SKILL.md".
 */
function collectSkillFiles(skillDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else if (entry.isFile()) out.push(rel);
    }
  };
  walk(skillDir, "");
  if (out.length === 0) {
    // Source resolved to a single SKILL.md file rather than a dir, or is empty.
    return ["SKILL.md"];
  }
  return out.sort();
}

/**
 * Plugin version embeds a content hash of the exported skills + MCP server
 * identity/endpoint.
 * Codex keys its plugin cache on the version string, so a changed skill or MCP
 * URL yields a new version and `codex plugin marketplace upgrade` (which runs
 * on startup) delivers the update automatically — no manual semver bump per
 * edit. Claude Code uses commit-SHA versioning instead (plugin.json omits
 * version), so it auto-updates on every push.
 */
export function resolvePluginVersion(
  manifest: AppSkillManifest,
  manifestDir: string,
  skills: AppSkillManifestSkill[],
): string {
  const base = manifest.version ?? "1.0.0";
  return `${base}+codex.${exportedSkillContentHash(manifestDir, skills, manifest)}`;
}

function writeCodexPluginAdapter(
  manifest: AppSkillManifest,
  outDir: string,
  version: string,
): void {
  const name = pluginName(manifest);
  writeJson(path.join(outDir, ".codex-plugin", "plugin.json"), {
    name,
    version,
    description: manifest.description,
    author: {
      name: "Agent-Native",
      url: "https://agent-native.com",
    },
    homepage: manifest.hosted.url,
    license: "MIT",
    keywords: [
      "agent-native",
      manifest.id,
      "mcp",
      "skills",
      "app-backed-skill",
    ],
    skills: "./skills/",
    mcpServers: "./.mcp.json",
    interface: {
      displayName: manifest.displayName,
      shortDescription: manifest.description,
      longDescription:
        `${manifest.displayName} packages agent instructions, app actions, ` +
        "an MCP connector, and inline UI surfaces as an installable skill.",
      developerName: "Agent-Native",
      category: "Productivity",
      capabilities: ["Interactive", "Read", "Write"],
      websiteURL: manifest.hosted.url,
      defaultPrompt: [
        `Open ${manifest.displayName} where useful`,
        `Use ${manifest.displayName} for app-backed workflows`,
        `Search ${manifest.displayName} and return usable context`,
      ],
      brandColor: "#2563EB",
    },
  });
  writeJson(path.join(outDir, ".mcp.json"), mcpServerConfig(manifest));
}

function writeClaudeMarketplaceAdapter(
  manifest: AppSkillManifest,
  manifestDir: string,
  skills: AppSkillManifestSkill[],
  outDir: string,
): void {
  const adapterDir = path.join(outDir, "adapters", "claude-marketplace");
  const name = pluginName(manifest);
  const marketplaceName = claudeMarketplaceName();
  const pluginDir = path.join(adapterDir, "plugins", name);
  const skillRoot = path.join(pluginDir, "skills");

  for (const skill of skills) copySkill(manifestDir, skill, skillRoot);

  writeJson(path.join(adapterDir, ".claude-plugin", "marketplace.json"), {
    name: marketplaceName,
    description:
      "Agent-Native app-backed skills that bundle instructions, MCP connectors, and UI surfaces.",
    owner: {
      name: "Agent-Native",
    },
    plugins: [
      {
        name,
        displayName: manifest.displayName,
        description: manifest.description,
        source: `./plugins/${name}`,
        autoUpdate: true,
        homepage: manifest.hosted.url,
        keywords: [
          "agent-native",
          manifest.id,
          "mcp",
          "skills",
          "app-backed-skill",
        ],
      },
    ],
  });

  writeJson(path.join(pluginDir, ".claude-plugin", "plugin.json"), {
    name,
    displayName: manifest.displayName,
    description: manifest.description,
    author: {
      name: "Agent-Native",
      url: "https://agent-native.com",
    },
    homepage: manifest.hosted.url,
    repository: "https://github.com/BuilderIO/agent-native",
    license: "MIT",
    keywords: [
      "agent-native",
      manifest.id,
      "mcp",
      "skills",
      "app-backed-skill",
    ],
    skills: "./skills/",
    mcpServers: "./.mcp.json",
  });
  writeJson(path.join(pluginDir, ".mcp.json"), mcpServerConfig(manifest));
  fs.writeFileSync(
    path.join(adapterDir, "README.md"),
    [
      `# ${manifest.displayName} Claude Code Marketplace`,
      "",
      "Install this local marketplace from Claude Code:",
      "",
      "```text",
      `/plugin marketplace add ./dist/${manifest.id}-skill/adapters/claude-marketplace`,
      `/plugin install ${name}@${marketplaceName}`,
      "/reload-plugins",
      "/mcp",
      "```",
      "",
      "Authenticate the MCP connector from `/mcp` after installation. The plugin ships a URL-only MCP config, so no shared secrets are stored in the marketplace package.",
      "",
      "For a published marketplace repo, point `/plugin marketplace add` at the repository URL instead of the local folder.",
      "",
    ].join("\n"),
    "utf-8",
  );
}

function writeMcpAdapter(
  manifest: AppSkillManifest,
  outDir: string,
  adapter: "generic-mcp" | "chatgpt-mcp",
): void {
  const dir = path.join(outDir, "adapters", adapter);
  if (adapter === "generic-mcp") {
    writeJson(path.join(dir, "mcp.json"), mcpServerConfig(manifest));
    return;
  }
  writeJson(path.join(dir, "connector.json"), {
    name: manifest.mcp.serverName,
    title: manifest.displayName,
    url: manifest.hosted.mcpUrl,
    auth: manifest.auth?.mode ?? "oauth",
    surfaces: manifest.surfaces,
  });
}

function copySkillAdapter(
  manifestDir: string,
  skills: AppSkillManifestSkill[],
  outDir: string,
  adapter: "plain-skill" | "claude-skill" | "vercel-skills",
): void {
  const skillRoot = path.join(outDir, "adapters", adapter, "skills");
  for (const skill of skills) copySkill(manifestDir, skill, skillRoot);
}

function writeVercelSkillsAdapter(
  manifest: AppSkillManifest,
  manifestDir: string,
  skills: AppSkillManifestSkill[],
  outDir: string,
): void {
  const adapterDir = path.join(outDir, "adapters", "vercel-skills");
  copySkillAdapter(manifestDir, skills, outDir, "vercel-skills");
  fs.writeFileSync(
    path.join(adapterDir, "README.md"),
    [
      `# ${manifest.displayName} Skills`,
      "",
      "Install instructions only with the Vercel Labs/open skills CLI:",
      "",
      "```bash",
      `npx skills add . --skill ${skills.map(skillExportName).join(" --skill ")} -a codex`,
      "```",
      "",
      "Then register the app-backed MCP connector:",
      "",
      "```bash",
      `npx @agent-native/core@latest app-skill ensure --manifest agent-native.app-skill.json --yes`,
      "```",
      "",
      "The open skills CLI installs instruction files only; it does not run postinstall scripts or register MCP connectors. OAuth or device setup happens in the MCP host; secrets are not stored in skills.",
      "",
    ].join("\n"),
    "utf-8",
  );
  writeJson(path.join(adapterDir, "agent-native.app-skill.json"), manifest);
}

export interface AppSkillPackResult {
  outDir: string;
  exportedSkillNames: string[];
  files: string[];
}

export function buildAppSkillPack(
  loaded: LoadedAppSkillManifest,
  outDir: string,
): AppSkillPackResult {
  const manifest = loaded.manifest;
  const target = path.resolve(outDir);
  const skills = exportedSkills(manifest);
  if (skills.length === 0) {
    throw new Error("Manifest has no exported or both-visibility skills.");
  }
  const pluginVersion = resolvePluginVersion(manifest, loaded.dir, skills);

  fs.mkdirSync(target, { recursive: true });
  const appSource = resolveLocalSourceDir(loaded);
  const packedManifest: AppSkillManifest = appSource
    ? {
        ...manifest,
        local: {
          ...(manifest.local ?? {}),
          sourcePath: "./app",
          commands: manifest.local?.commands ?? {
            install: "pnpm install",
            dev: "pnpm dev",
            start: "pnpm start",
          },
        },
      }
    : manifest;
  writeJson(path.join(target, "agent-native.app-skill.json"), packedManifest);
  if (appSource) {
    copyDirFiltered(appSource, path.join(target, "app"));
  }
  const exportedSkillNames = skills.map(skillExportName);
  for (const skill of skills)
    copySkill(loaded.dir, skill, path.join(target, "skills"));

  const files: string[] = [
    path.join(target, "agent-native.app-skill.json"),
    ...(appSource ? [path.join(target, "app")] : []),
    ...exportedSkillNames.map((name) =>
      path.join(target, "skills", name, "SKILL.md"),
    ),
  ];

  if (manifest.hostAdapters.includes("codex-plugin")) {
    writeCodexPluginAdapter(manifest, target, pluginVersion);
    files.push(
      path.join(target, ".codex-plugin", "plugin.json"),
      path.join(target, ".mcp.json"),
    );
  }
  if (manifest.hostAdapters.includes("claude-marketplace")) {
    writeClaudeMarketplaceAdapter(manifest, loaded.dir, skills, target);
    files.push(
      path.join(
        target,
        "adapters",
        "claude-marketplace",
        ".claude-plugin",
        "marketplace.json",
      ),
      path.join(
        target,
        "adapters",
        "claude-marketplace",
        "plugins",
        pluginName(manifest),
        ".claude-plugin",
        "plugin.json",
      ),
      path.join(
        target,
        "adapters",
        "claude-marketplace",
        "plugins",
        pluginName(manifest),
        ".mcp.json",
      ),
      path.join(
        target,
        "adapters",
        "claude-marketplace",
        "plugins",
        pluginName(manifest),
        "skills",
      ),
      path.join(target, "adapters", "claude-marketplace", "README.md"),
    );
  }
  if (manifest.hostAdapters.includes("vercel-skills")) {
    writeVercelSkillsAdapter(manifest, loaded.dir, skills, target);
    files.push(
      path.join(target, "adapters", "vercel-skills", "skills"),
      path.join(target, "adapters", "vercel-skills", "README.md"),
      path.join(
        target,
        "adapters",
        "vercel-skills",
        "agent-native.app-skill.json",
      ),
    );
  }
  if (manifest.hostAdapters.includes("plain-skill")) {
    copySkillAdapter(loaded.dir, skills, target, "plain-skill");
    files.push(path.join(target, "adapters", "plain-skill", "skills"));
  }
  if (manifest.hostAdapters.includes("claude-skill")) {
    copySkillAdapter(loaded.dir, skills, target, "claude-skill");
    files.push(path.join(target, "adapters", "claude-skill", "skills"));
  }
  if (manifest.hostAdapters.includes("generic-mcp")) {
    writeMcpAdapter(manifest, target, "generic-mcp");
    files.push(path.join(target, "adapters", "generic-mcp", "mcp.json"));
  }
  if (manifest.hostAdapters.includes("chatgpt-mcp")) {
    writeMcpAdapter(manifest, target, "chatgpt-mcp");
    files.push(path.join(target, "adapters", "chatgpt-mcp", "connector.json"));
  }

  return { outDir: target, exportedSkillNames, files };
}

function appSkillCacheDir(appId: string): string {
  return path.join(os.homedir(), ".agent-native", "app-skills", appId, "app");
}

function resolveLocalSourceDir(
  loaded: LoadedAppSkillManifest,
): string | undefined {
  const local = loaded.manifest.local;
  if (local?.sourcePath) {
    if (path.isAbsolute(local.sourcePath)) {
      throw new Error("local.sourcePath must be relative to the manifest.");
    }
    const source = assertPathInside(
      loaded.dir,
      path.resolve(loaded.dir, local.sourcePath),
      "local.sourcePath",
    );
    if (fs.existsSync(source)) return source;
    throw new Error(
      `local.sourcePath "${local.sourcePath}" does not exist. ` +
        "Run pack from the directory containing the app source.",
    );
  }
  if (local?.template) {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(local.template)) {
      throw new Error("local.template must be a direct template name.");
    }
    const repoTemplate = path.resolve(
      process.cwd(),
      "templates",
      local.template,
    );
    if (fs.existsSync(repoTemplate)) return repoTemplate;
  }
  return undefined;
}

export function resolveLaunchPlan(
  loaded: LoadedAppSkillManifest,
  options: LaunchAppSkillOptions = {},
): AppSkillLaunchPlan {
  const manifest = loaded.manifest;
  const mode = options.mode ?? "hosted";
  const serverName = options.serverName ?? manifest.mcp.serverName;
  if (mode === "hosted") {
    return {
      mode,
      appId: manifest.id,
      url: manifest.hosted.url,
      mcpUrl: manifest.hosted.mcpUrl,
      serverName,
      commands: {},
    };
  }

  const defaultUrl = manifest.local?.defaultUrl ?? "http://127.0.0.1:8100";
  const appDir = path.resolve(options.into ?? appSkillCacheDir(manifest.id));
  return {
    mode,
    appId: manifest.id,
    appDir,
    sourceDir: resolveLocalSourceDir(loaded),
    url: defaultUrl,
    mcpUrl: withMcpPath(defaultUrl),
    serverName,
    commands: manifest.local?.commands ?? {
      install: "pnpm install",
      dev: "pnpm dev",
      start: "pnpm start",
    },
  };
}

function printPlan(plan: AppSkillLaunchPlan, log: (message: string) => void) {
  log(`  App:        ${plan.appId}`);
  log(`  Mode:       ${plan.mode}`);
  log(`  URL:        ${plan.url}`);
  log(`  MCP URL:    ${plan.mcpUrl}`);
  log(`  Server:     ${plan.serverName}`);
  if (plan.appDir) log(`  App dir:    ${plan.appDir}`);
  if (plan.sourceDir) log(`  Source:     ${plan.sourceDir}`);
  if (plan.commands.install) log(`  Install:    ${plan.commands.install}`);
  if (plan.commands.dev) log(`  Dev:        ${plan.commands.dev}`);
}

function safeChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function parsePackageCommand(command: string): {
  executable: string;
  args: string[];
} {
  const trimmed = command.trim();
  if (!trimmed) throw new Error("Command cannot be empty.");
  if (/[\n\r;&|<>`$]/.test(trimmed)) {
    throw new Error(
      `Unsafe shell syntax is not allowed in command: ${command}`,
    );
  }
  const parts = trimmed.split(/\s+/);
  const executable = parts[0];
  if (!SAFE_PACKAGE_EXECUTABLES.has(executable)) {
    throw new Error(
      `Unsupported app-skill command executable: ${executable}. Use pnpm, npm, bun, or yarn.`,
    );
  }
  return { executable, args: parts.slice(1) };
}

function runShell(command: string, cwd: string): Promise<number> {
  const { executable, args } = parsePackageCommand(command);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: safeChildEnv(),
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Command "${command}" was terminated by ${signal}.`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

function openUrl(url: string): void {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  child.unref();
}

export async function ensureAppSkill(
  loaded: LoadedAppSkillManifest,
  options: EnsureAppSkillOptions = {},
): Promise<EnsureAppSkillResult> {
  const manifest = loaded.manifest;
  const mode = options.mode ?? "hosted";
  const clients = options.clients ?? resolveClients("all");
  const serverName = options.serverName ?? manifest.mcp.serverName;
  const scope = options.scope ?? "user";
  const plan = resolveLaunchPlan(loaded, { mode, serverName });
  const result: EnsureAppSkillResult = {
    mode,
    serverName,
    mcpUrl: plan.mcpUrl,
    clients,
    written: [],
  };

  if (options.dryRun) return result;

  if (options.confirm && !options.yes) {
    await confirmMcpRegistration(result, loaded.manifest.displayName, scope);
  }

  const baseDir = options.baseDir ?? process.cwd();
  result.written = writeConfigs(
    clients,
    serverName,
    plan.mcpUrl,
    undefined,
    scope,
    baseDir,
  );

  // Aliases are intentionally NOT written as separate entries. Instead,
  // repurpose the alias list as a cleanup list: remove any other entries in
  // the same config files that point at the same URL (covers legacy alias
  // names, old default names like 'agent-native-<slug>', and any stale
  // custom names left from previous installs).
  const allRemovedNames: string[] = [];
  for (const client of clients) {
    const removed = removeSameUrlDuplicatesForClient(
      client,
      serverName,
      plan.mcpUrl,
      baseDir,
      scope,
    );
    allRemovedNames.push(...removed);
  }

  const uniqueRemoved = [...new Set(allRemovedNames)];
  const logMsg =
    uniqueRemoved.length > 0
      ? `Registered "${serverName}" for ${clients.join(", ")} at ${plan.mcpUrl}; removed duplicate entries: ${uniqueRemoved.join(", ")}`
      : `Registered "${serverName}" for ${clients.join(", ")} at ${plan.mcpUrl}`;
  options.log?.(logMsg);
  return result;
}

async function confirmMcpRegistration(
  result: EnsureAppSkillResult,
  displayName: string,
  scope: string,
): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "Refusing to register MCP servers from a manifest without confirmation. Re-run with --yes to approve.",
    );
  }
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question(
      [
        `Register ${displayName} MCP server "${result.serverName}"?`,
        `  URL:     ${result.mcpUrl}`,
        `  Clients: ${result.clients.join(", ")}`,
        `  Scope:   ${scope}`,
        "Proceed? [y/N] ",
      ].join("\n"),
    );
    if (!/^(y|yes)$/i.test(answer.trim())) {
      throw new Error("Cancelled app-skill MCP registration.");
    }
  } finally {
    rl.close();
  }
}

export async function launchAppSkill(
  loaded: LoadedAppSkillManifest,
  options: LaunchAppSkillOptions = {},
): Promise<AppSkillLaunchPlan> {
  const log =
    options.log ?? ((message: string) => process.stdout.write(`${message}\n`));
  const plan = resolveLaunchPlan(loaded, options);

  if (options.dryRun) {
    printPlan(plan, log);
    return plan;
  }

  if (plan.mode === "hosted") {
    log(`Opening ${loaded.manifest.displayName}: ${plan.url}`);
    openUrl(plan.url);
    return plan;
  }

  if (!plan.appDir) throw new Error("Local launch plan is missing appDir.");
  if (!fs.existsSync(path.join(plan.appDir, "package.json"))) {
    if (!plan.sourceDir) {
      throw new Error(
        "Local launch needs bundled app source. Pass --into <path> from a manifest with local.sourcePath.",
      );
    }
    fs.mkdirSync(path.dirname(plan.appDir), { recursive: true });
    copyDirFiltered(plan.sourceDir, plan.appDir);
    log(`Materialized ${loaded.manifest.displayName} at ${plan.appDir}`);
  } else {
    log(`Using existing local app at ${plan.appDir}`);
  }

  if (!options.noRegister) {
    await ensureAppSkill(loaded, {
      mode: "local",
      clients: options.clients,
      scope: options.scope,
      serverName: options.serverName,
      baseDir: options.baseDir,
      confirm: options.confirm,
      yes: options.yes,
      log,
    });
  }

  if (!options.skipInstall && plan.commands.install) {
    const installCode = await runShell(plan.commands.install, plan.appDir);
    if (installCode !== 0) {
      throw new Error(`Install command failed with exit code ${installCode}.`);
    }
  }

  if (plan.commands.dev) {
    const code = await runShell(plan.commands.dev, plan.appDir);
    if (code !== 0) throw new Error(`Dev command exited with code ${code}.`);
  }

  return plan;
}

function resolveArgsClients(parsed: ParsedAppSkillArgs): ClientId[] {
  return resolveClients(parsed.client);
}

export async function runAppSkill(argv: string[]): Promise<void> {
  try {
    const parsed = parseAppSkillArgs(argv);
    if (parsed.command === "help") {
      process.stdout.write(`${HELP}\n`);
      return;
    }

    const loaded = loadAppSkillManifest(parsed.manifest);
    const log = (message: string) =>
      (parsed.printJson ? process.stderr : process.stdout).write(
        `${message}\n`,
      );
    if (parsed.command === "ensure") {
      const result = await ensureAppSkill(loaded, {
        mode: parsed.mode,
        clients: resolveArgsClients(parsed),
        scope: parsed.scope,
        serverName: parsed.serverName,
        dryRun: parsed.dryRun,
        confirm: true,
        yes: parsed.yes,
        log,
      });
      if (parsed.printJson) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else if (parsed.dryRun) {
        process.stdout.write(
          `Would register ${result.serverName} at ${result.mcpUrl} for ${result.clients.join(", ")}\n`,
        );
      }
      return;
    }

    if (parsed.command === "launch") {
      const plan = await launchAppSkill(loaded, {
        mode: parsed.mode,
        into: parsed.into,
        dryRun: parsed.dryRun,
        skipInstall: parsed.skipInstall,
        noRegister: parsed.noRegister,
        clients: resolveArgsClients(parsed),
        scope: parsed.scope,
        serverName: parsed.serverName,
        confirm: true,
        yes: parsed.yes,
        log,
      });
      if (parsed.printJson) {
        process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
      }
      return;
    }

    if (parsed.command === "pack") {
      if (!parsed.out) {
        throw new Error("Missing --out <dir> for app-skill pack.");
      }
      const result = buildAppSkillPack(loaded, parsed.out);
      if (parsed.printJson) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        process.stdout.write(
          `Packed ${loaded.manifest.displayName} app skill at ${result.outDir}\n`,
        );
      }
    }
  } catch (err: any) {
    process.stderr.write(`${err?.message ?? err}\n`);
    process.exitCode = 1;
  }
}
