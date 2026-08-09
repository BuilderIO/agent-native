/**
 * Import and validate the portable Agent Plugin format.
 *
 * The importer intentionally handles only local plugin directories. Skills are
 * copied as inert files, and remote Streamable HTTP MCP entries are translated
 * to the Agent-Native `mcp.config.json` shape without copying package headers.
 * A plugin package is not a credential store and this command never executes
 * a plugin's scripts or stdio servers.
 */

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { validateRemoteUrl } from "../mcp-client/remote-url.js";
import {
  getFrontmatterValue,
  parseFrontmatter,
} from "../resources/metadata.js";
import {
  withFileLockSync,
  writeJsonFileAtomically,
} from "./atomic-json-file.js";

export const AGENT_PLUGIN_SCHEMA =
  "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
export const AGENT_PLUGIN_MCP_SCHEMA =
  "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

const PLUGIN_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/;
const SKILL_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const MAX_PLUGIN_DESCRIPTION_LENGTH = 1024;
const MAX_SKILL_DESCRIPTION_LENGTH = 1024;
const MAX_SKILL_FILES = 512;
const MAX_SKILL_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SKILL_BYTES = 10 * 1024 * 1024;

const PLUGIN_MANIFEST_FIELDS = new Set([
  "$schema",
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "extensions",
]);

type JsonRecord = Record<string, unknown>;

export interface AgentPluginManifest {
  name: string;
  version?: string;
  description?: string;
  author?: string | { name: string; url?: string };
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
}

export interface AgentPluginSkillFile {
  relativePath: string;
  content: Buffer;
  mode: number;
}

export interface LoadedAgentPluginSkill {
  name: string;
  description: string;
  relativePath: string;
  directory: string;
  files: AgentPluginSkillFile[];
}

export type AgentPluginMcpTransport = "streamable-http" | "sse" | "stdio";

export interface LoadedAgentPluginMcpServer {
  name: string;
  type: AgentPluginMcpTransport;
  url?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  headerCount: number;
}

export interface AgentPluginSkippedComponent {
  component: "skill" | "mcp";
  name?: string;
  reason: string;
}

export interface LoadedAgentPlugin {
  rootDir: string;
  manifestFile: string;
  mcpFile?: string;
  manifest: AgentPluginManifest;
  pluginHash: string;
  skills: LoadedAgentPluginSkill[];
  mcpServers: LoadedAgentPluginMcpServer[];
  skipped: AgentPluginSkippedComponent[];
  warnings: string[];
}

export interface AgentPluginImportOptions {
  targetDir?: string;
  /** Optional skills root used by hosts whose agent cwd is a child workspace. */
  skillsTargetDir?: string;
  force?: boolean;
  dryRun?: boolean;
}

export type AgentPluginImportItemStatus =
  | "imported"
  | "unchanged"
  | "overwritten"
  | "would-import"
  | "would-overwrite";

export interface AgentPluginImportSkillResult {
  name: string;
  sourcePath: string;
  destination: string;
  files: number;
  status: AgentPluginImportItemStatus;
}

export interface AgentPluginImportMcpResult {
  name: string;
  id: string;
  url: string;
  headersIgnored: number;
  status: AgentPluginImportItemStatus;
}

export interface AgentPluginImportResult {
  plugin: {
    name: string;
    version?: string;
    hash: string;
    sourceDir: string;
  };
  targetDir: string;
  metadataPath: string;
  mcpConfigPath: string;
  skills: AgentPluginImportSkillResult[];
  mcpServers: AgentPluginImportMcpResult[];
  skipped: AgentPluginSkippedComponent[];
  warnings: string[];
  dryRun: boolean;
}

export interface ParsedAgentPluginArgs {
  command: "import" | "help";
  source?: string;
  into?: string;
  force: boolean;
  dryRun: boolean;
  printJson: boolean;
  yes: boolean;
}

const HELP = `agent-native plugin

Usage:
  agent-native plugin import <path> [--into <workspace>] [--yes] [--force] [--dry-run] [--json]

Commands:
  import   Import a standard Agent Plugin's Skills and remote MCP servers into an Agent-Native workspace.

The importer copies Skills into a namespaced skills/<plugin>/<skill> path and
maps Streamable HTTP MCP servers into mcp.config.json. Package headers are
never imported as credentials; configure authentication through the app's
normal Connections flow. Stdio and SSE servers are reported and skipped.`;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function pathExists(file: string): boolean {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

function assertRegularFile(file: string, label: string): void {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(
      `${label} must be a regular file, not a symlink or directory.`,
    );
  }
}

function validateName(value: unknown, label: string, pattern: RegExp): string {
  const name = nonEmptyString(value);
  if (!name || name.length > 64 || !pattern.test(name)) {
    throw new Error(
      `${label} must be 1-64 lowercase letters, numbers, and allowed separators.`,
    );
  }
  if (name.includes("--") || name.includes("..")) {
    throw new Error(`${label} must not contain repeated separators.`);
  }
  return name;
}

function validateOptionalUrl(
  value: unknown,
  label: string,
): string | undefined {
  if (value === undefined) return undefined;
  const raw = nonEmptyString(value);
  if (!raw) throw new Error(`${label} must be a non-empty string.`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must use http:// or https://.`);
  }
  return url.href;
}

function validatePluginManifest(raw: unknown): {
  manifest: AgentPluginManifest;
  warnings: string[];
} {
  if (!isRecord(raw)) throw new Error("plugin.json must contain an object.");

  const name = validateName(raw.name, "plugin.json name", PLUGIN_NAME_PATTERN);
  const warnings: string[] = [];
  for (const key of Object.keys(raw)) {
    if (!PLUGIN_MANIFEST_FIELDS.has(key)) {
      warnings.push(`Ignored unsupported plugin.json field "${key}".`);
    }
  }

  if (raw.$schema !== undefined && typeof raw.$schema !== "string") {
    throw new Error("plugin.json $schema must be a string when provided.");
  }
  if (typeof raw.$schema === "string" && raw.$schema !== AGENT_PLUGIN_SCHEMA) {
    warnings.push(
      "plugin.json uses a schema URL different from Agent Plugin 1.0.",
    );
  }

  const version =
    raw.version === undefined ? undefined : nonEmptyString(raw.version);
  if (raw.version !== undefined && !version) {
    throw new Error("plugin.json version must be a non-empty string.");
  }
  if (version && version.length > 128) {
    throw new Error("plugin.json version is too long.");
  }

  const description =
    raw.description === undefined ? undefined : nonEmptyString(raw.description);
  if (raw.description !== undefined && !description) {
    throw new Error("plugin.json description must be a non-empty string.");
  }
  if (description && description.length > MAX_PLUGIN_DESCRIPTION_LENGTH) {
    throw new Error("plugin.json description is too long.");
  }

  let author: AgentPluginManifest["author"];
  if (raw.author !== undefined) {
    if (typeof raw.author === "string") {
      author = nonEmptyString(raw.author);
      if (!author) throw new Error("plugin.json author must not be empty.");
    } else if (isRecord(raw.author)) {
      const authorName = nonEmptyString(raw.author.name);
      if (!authorName) throw new Error("plugin.json author.name is required.");
      author = {
        name: authorName,
        ...(raw.author.url === undefined
          ? {}
          : {
              url: validateOptionalUrl(
                raw.author.url,
                "plugin.json author.url",
              ),
            }),
      };
    } else {
      throw new Error("plugin.json author must be a string or object.");
    }
  }

  const homepage = validateOptionalUrl(raw.homepage, "plugin.json homepage");
  const repository = validateOptionalUrl(
    raw.repository,
    "plugin.json repository",
  );
  const license =
    raw.license === undefined ? undefined : nonEmptyString(raw.license);
  if (raw.license !== undefined && !license) {
    throw new Error("plugin.json license must be a non-empty string.");
  }

  let keywords: string[] | undefined;
  if (raw.keywords !== undefined) {
    if (!Array.isArray(raw.keywords)) {
      throw new Error("plugin.json keywords must be an array of strings.");
    }
    keywords = raw.keywords.map((keyword, index) => {
      const value = nonEmptyString(keyword);
      if (!value) throw new Error(`plugin.json keywords[${index}] is invalid.`);
      return value;
    });
  }

  if (raw.extensions !== undefined && !isRecord(raw.extensions)) {
    throw new Error("plugin.json extensions must be an object when provided.");
  }

  return {
    manifest: {
      name,
      ...(version ? { version } : {}),
      ...(description ? { description } : {}),
      ...(author ? { author } : {}),
      ...(homepage ? { homepage } : {}),
      ...(repository ? { repository } : {}),
      ...(license ? { license } : {}),
      ...(keywords ? { keywords } : {}),
    },
    warnings,
  };
}

function resolvePluginRoot(input: string): string {
  const requested = path.resolve(input);
  if (!pathExists(requested)) {
    throw new Error(`Agent Plugin path does not exist: ${requested}`);
  }
  const stat = fs.lstatSync(requested);
  const candidate =
    stat.isFile() && path.basename(requested) === "plugin.json"
      ? path.dirname(requested)
      : requested;
  if (!fs.statSync(candidate).isDirectory()) {
    throw new Error(`Agent Plugin path must be a directory: ${candidate}`);
  }
  return fs.realpathSync(candidate);
}

function readJsonObject(file: string, label: string): JsonRecord {
  assertRegularFile(file, label);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(raw)) throw new Error(`${label} must contain an object.`);
  return raw;
}

function isSensitivePathPart(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower === "node_modules" ||
    lower === ".git" ||
    lower === "secrets" ||
    lower === "private" ||
    lower === ".npmrc" ||
    lower === ".dev.vars" ||
    lower === ".env" ||
    lower.startsWith(".env.") ||
    lower.endsWith(".pem") ||
    lower.endsWith(".key") ||
    lower.endsWith(".crt") ||
    lower.endsWith(".p12") ||
    lower.endsWith(".pfx")
  );
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function readSkillFiles(
  directory: string,
  skillName: string,
  warnings: string[],
): AgentPluginSkillFile[] {
  const files: AgentPluginSkillFile[] = [];
  let totalBytes = 0;

  const walk = (current: string, prefix: string): void => {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`contains a symbolic link at ${relativePath}`);
      }
      if (isSensitivePathPart(entry.name)) {
        warnings.push(
          `Skipped sensitive file from skill "${skillName}": ${relativePath}.`,
        );
        continue;
      }
      if (entry.isDirectory()) {
        walk(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`contains a non-regular file at ${relativePath}`);
      }
      if (files.length >= MAX_SKILL_FILES) {
        throw new Error(`contains more than ${MAX_SKILL_FILES} files`);
      }
      const stat = fs.lstatSync(absolutePath);
      if (stat.size > MAX_SKILL_FILE_BYTES) {
        throw new Error(
          `contains a file larger than ${MAX_SKILL_FILE_BYTES} bytes at ${relativePath}`,
        );
      }
      totalBytes += stat.size;
      if (totalBytes > MAX_SKILL_BYTES) {
        throw new Error(`exceeds the ${MAX_SKILL_BYTES}-byte size limit`);
      }
      files.push({
        relativePath: toPosixPath(relativePath),
        content: fs.readFileSync(absolutePath),
        mode: stat.mode & 0o777,
      });
    }
  };

  walk(directory, "");
  return files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

function discoverSkills(
  rootDir: string,
  warnings: string[],
  skipped: AgentPluginSkippedComponent[],
): LoadedAgentPluginSkill[] {
  const skillsDir = path.join(rootDir, "skills");
  if (!pathExists(skillsDir)) return [];
  if (fs.lstatSync(skillsDir).isSymbolicLink()) {
    skipped.push({
      component: "skill",
      reason: "The plugin skills directory is a symbolic link.",
    });
    return [];
  }
  if (!fs.statSync(skillsDir).isDirectory()) {
    skipped.push({
      component: "skill",
      reason: "The plugin skills path is not a directory.",
    });
    return [];
  }

  const skills: LoadedAgentPluginSkill[] = [];
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      warnings.push(`Ignored non-directory entry in skills/: ${entry.name}.`);
      continue;
    }
    const directory = path.join(skillsDir, entry.name);
    try {
      const skillName = validateName(
        entry.name,
        `Skill directory ${entry.name}`,
        SKILL_NAME_PATTERN,
      );
      const skillFile = path.join(directory, "SKILL.md");
      assertRegularFile(skillFile, `Skill ${skillName}/SKILL.md`);
      const content = fs.readFileSync(skillFile, "utf-8");
      const frontmatter = parseFrontmatter(content);
      const declaredName = getFrontmatterValue(frontmatter, "name");
      if (!declaredName) throw new Error("SKILL.md frontmatter needs name");
      if (declaredName !== skillName) {
        throw new Error(
          `SKILL.md name must match its directory (${skillName})`,
        );
      }
      const description = getFrontmatterValue(frontmatter, "description");
      if (!description) {
        throw new Error("SKILL.md frontmatter needs description");
      }
      if (description.length > MAX_SKILL_DESCRIPTION_LENGTH) {
        throw new Error("SKILL.md description is too long");
      }
      const files = readSkillFiles(directory, skillName, warnings);
      skills.push({
        name: skillName,
        description,
        relativePath: `skills/${skillName}`,
        directory,
        files,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      skipped.push({ component: "skill", name: entry.name, reason });
    }
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

function validateMcpUrl(raw: unknown, label: string): string {
  const value = nonEmptyString(raw);
  if (!value) throw new Error(`${label} URL is required.`);
  const result = validateRemoteUrl(value);
  if (!result.ok || !result.url) {
    throw new Error(
      `${label} URL is not allowed: ${result.error ?? "invalid URL"}.`,
    );
  }
  if (result.url.username || result.url.password || result.url.hash) {
    throw new Error(`${label} URL must not contain credentials or a fragment.`);
  }
  return result.url.href;
}

function headerCount(value: unknown, label: string): number {
  if (value === undefined) return 0;
  if (!isRecord(value)) throw new Error(`${label} headers must be an object.`);
  for (const headerValue of Object.values(value)) {
    if (typeof headerValue !== "string") {
      throw new Error(`${label} headers must contain string values.`);
    }
  }
  return Object.keys(value).length;
}

function discoverMcpServers(
  rootDir: string,
  warnings: string[],
  skipped: AgentPluginSkippedComponent[],
): { file?: string; servers: LoadedAgentPluginMcpServer[] } {
  const file = path.join(rootDir, "mcp.json");
  if (!pathExists(file)) return { servers: [] };
  if (fs.lstatSync(file).isSymbolicLink()) {
    skipped.push({
      component: "mcp",
      reason: "mcp.json is a symbolic link and was not read.",
    });
    return { servers: [] };
  }
  let parsed: JsonRecord;
  try {
    parsed = readJsonObject(file, "mcp.json");
  } catch (error) {
    skipped.push({
      component: "mcp",
      reason: error instanceof Error ? error.message : String(error),
    });
    return { file, servers: [] };
  }
  if (parsed.$schema !== undefined && typeof parsed.$schema !== "string") {
    skipped.push({
      component: "mcp",
      reason: "mcp.json $schema must be a string when provided.",
    });
    return { file, servers: [] };
  }
  if (
    typeof parsed.$schema === "string" &&
    parsed.$schema !== AGENT_PLUGIN_MCP_SCHEMA
  ) {
    warnings.push(
      "mcp.json uses a schema URL different from Agent Plugin 1.0.",
    );
  }
  if (!isRecord(parsed.mcpServers)) {
    skipped.push({
      component: "mcp",
      reason: "mcp.json must contain an mcpServers object.",
    });
    return { file, servers: [] };
  }

  const servers: LoadedAgentPluginMcpServer[] = [];
  for (const [name, raw] of Object.entries(parsed.mcpServers)) {
    try {
      if (!name.trim() || name.length > 128 || /[\u0000-\u001f]/.test(name)) {
        throw new Error(
          "server name is empty, too long, or contains control characters",
        );
      }
      if (!isRecord(raw)) throw new Error("server entry must be an object");
      const type = raw.type;
      const headers = headerCount(raw.headers, `MCP server "${name}"`);
      if (headers > 0) {
        warnings.push(
          `MCP server "${name}" declares ${headers} package header(s); headers are not imported as credentials.`,
        );
      }
      if (type === "streamable-http" || type === "sse") {
        const url = validateMcpUrl(raw.url, `MCP server "${name}"`);
        const server: LoadedAgentPluginMcpServer = {
          name,
          type,
          url,
          headerCount: headers,
        };
        servers.push(server);
        if (type === "sse") {
          skipped.push({
            component: "mcp",
            name,
            reason:
              "SSE servers are not imported; only Streamable HTTP is supported.",
          });
        }
        continue;
      }
      if (type === "stdio") {
        const command = nonEmptyString(raw.command);
        if (!command || /\s|[;&|<>`$]/.test(command)) {
          throw new Error("stdio command must be one executable token");
        }
        const args = raw.args;
        if (
          args !== undefined &&
          (!Array.isArray(args) || args.some((arg) => typeof arg !== "string"))
        ) {
          throw new Error("stdio args must be an array of strings");
        }
        if (raw.cwd !== undefined && typeof raw.cwd !== "string") {
          throw new Error("stdio cwd must be a string when provided");
        }
        skipped.push({
          component: "mcp",
          name,
          reason: "Stdio servers are not imported or executed by this command.",
        });
        continue;
      }
      throw new Error(
        `unsupported transport ${typeof type === "string" ? type : "(missing type)"}`,
      );
    } catch (error) {
      skipped.push({
        component: "mcp",
        name,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    file,
    servers: servers.filter((server) => server.type === "streamable-http"),
  };
}

function hashPlugin(
  manifestFile: string,
  mcpFile: string | undefined,
  skills: LoadedAgentPluginSkill[],
): string {
  const hash = createHash("sha256");
  const addFile = (relativePath: string, content: Buffer): void => {
    hash.update(relativePath);
    hash.update("\u0000");
    hash.update(content);
    hash.update("\u0000");
  };
  addFile("plugin.json", fs.readFileSync(manifestFile));
  if (mcpFile) addFile("mcp.json", fs.readFileSync(mcpFile));
  for (const skill of skills) {
    for (const file of skill.files) {
      addFile(`${skill.relativePath}/${file.relativePath}`, file.content);
    }
  }
  return hash.digest("hex");
}

export function loadAgentPlugin(input: string): LoadedAgentPlugin {
  const rootDir = resolvePluginRoot(input);
  const manifestFile = path.join(rootDir, "plugin.json");
  if (!pathExists(manifestFile)) {
    throw new Error(`Agent Plugin is missing required ${manifestFile}.`);
  }
  let rawManifest: JsonRecord;
  try {
    rawManifest = readJsonObject(manifestFile, "plugin.json");
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
  const normalized = validatePluginManifest(rawManifest);
  const warnings = [...normalized.warnings];
  const skipped: AgentPluginSkippedComponent[] = [];
  const skills = discoverSkills(rootDir, warnings, skipped);
  const mcp = discoverMcpServers(rootDir, warnings, skipped);
  return {
    rootDir,
    manifestFile,
    mcpFile: mcp.file,
    manifest: normalized.manifest,
    pluginHash: hashPlugin(manifestFile, mcp.file, skills),
    skills,
    mcpServers: mcp.servers,
    skipped,
    warnings,
  };
}

function canonicalPathForComparison(input: string): string {
  const absolute = path.resolve(input);
  if (pathExists(absolute)) return fs.realpathSync(absolute);
  const missing: string[] = [];
  let current = absolute;
  while (!pathExists(current)) {
    const parent = path.dirname(current);
    if (parent === current) return absolute;
    missing.push(path.basename(current));
    current = parent;
  }
  return path.resolve(fs.realpathSync(current), ...missing.reverse());
}

function isPathInside(
  root: string,
  target: string,
  includeRoot = false,
): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative) return includeRoot;
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function assertPathInside(root: string, target: string, label: string): void {
  if (!isPathInside(root, target, true)) {
    throw new Error(`${label} must remain inside ${root}.`);
  }
}

function assertPathOutside(root: string, target: string, label: string): void {
  if (isPathInside(root, target, true)) {
    throw new Error(
      `${label} must not be inside the imported plugin directory.`,
    );
  }
}

function assertNoSymlinkInExistingPath(target: string, label: string): void {
  const absolute = path.resolve(target);
  const parts = absolute.split(path.sep);
  let current = parts[0] === "" ? path.sep : parts[0];
  for (let index = 1; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    if (!pathExists(current)) break;
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`${label} contains a symbolic link: ${current}.`);
    }
  }
}

function pluginSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  return slug || "plugin";
}

function serverSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "server";
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

export function importedMcpServerId(
  pluginName: string,
  serverName: string,
  existingIds: Iterable<string> = [],
): string {
  const base =
    `agent-plugin-${pluginSlug(pluginName)}-${serverSlug(serverName)}`.slice(
      0,
      96,
    );
  const existing = new Set(existingIds);
  if (!existing.has(base)) return base;
  return `${base}-${shortHash(`${pluginName}\u0000${serverName}`)}`.slice(
    0,
    110,
  );
}

function listExistingSkillFiles(directory: string): string[] {
  const files: string[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(
          `existing skill contains a symbolic link at ${relativePath}`,
        );
      }
      if (entry.isDirectory()) walk(absolutePath, relativePath);
      else if (entry.isFile()) files.push(toPosixPath(relativePath));
      else
        throw new Error(
          `existing skill contains a non-regular file at ${relativePath}`,
        );
    }
  };
  walk(directory, "");
  return files.sort();
}

function skillFilesMatch(
  source: AgentPluginSkillFile[],
  destination: string,
): boolean {
  const sourcePaths = source.map((file) => file.relativePath).sort();
  const destinationPaths = listExistingSkillFiles(destination);
  if (
    sourcePaths.length !== destinationPaths.length ||
    sourcePaths.some((file, index) => file !== destinationPaths[index])
  ) {
    return false;
  }
  return source.every((file) => {
    const target = path.join(destination, ...file.relativePath.split("/"));
    return (
      fs.readFileSync(target).equals(file.content) &&
      (fs.lstatSync(target).mode & 0o777) === file.mode
    );
  });
}

interface PlannedSkill {
  skill: LoadedAgentPluginSkill;
  destination: string;
  status: "imported" | "unchanged" | "overwritten";
}

interface ExistingMcpConfig {
  fileExists: boolean;
  value: JsonRecord;
  servers: JsonRecord;
}

function readExistingMcpConfig(file: string): ExistingMcpConfig {
  if (!pathExists(file)) {
    return { fileExists: false, value: { servers: {} }, servers: {} };
  }
  assertRegularFile(file, "mcp.config.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (error) {
    throw new Error(
      `mcp.config.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed) || !isRecord(parsed.servers)) {
    throw new Error("mcp.config.json must contain a servers object.");
  }
  for (const [id, entry] of Object.entries(parsed.servers)) {
    if (!isRecord(entry)) {
      throw new Error(`mcp.config.json server "${id}" must be an object.`);
    }
  }
  return {
    fileExists: true,
    value: parsed,
    servers: parsed.servers,
  };
}

function sameMcpEndpoint(value: unknown, url: string): boolean {
  return isRecord(value) && value.type === "http" && value.url === url;
}

interface PlannedMcp {
  server: LoadedAgentPluginMcpServer;
  id: string;
  entry: { type: "http"; url: string; description: string };
  status: "imported" | "unchanged" | "overwritten";
}

function planMcpServers(
  plugin: LoadedAgentPlugin,
  existing: ExistingMcpConfig,
  force: boolean,
): PlannedMcp[] {
  const planned: PlannedMcp[] = [];
  const plannedIds = new Set<string>();
  const pluginName = plugin.manifest.name;
  for (const server of plugin.mcpServers) {
    const baseId = importedMcpServerId(pluginName, server.name).slice(0, 96);
    let id = baseId;
    const existingEntry = existing.servers[id];
    const plannedCollision = plannedIds.has(id);
    if (
      plannedCollision ||
      (existingEntry && !sameMcpEndpoint(existingEntry, server.url!))
    ) {
      if (!plannedCollision && existingEntry && force) {
        // A caller explicitly approved replacing an existing entry with the
        // stable id. Preserve the id so updates do not accumulate stale names.
      } else {
        const stem =
          `${baseId}-${shortHash(`${pluginName}\u0000${server.name}\u0000${server.url}`)}`.slice(
            0,
            105,
          );
        id = stem;
        for (
          let suffix = 2;
          plannedIds.has(id) ||
          (existing.servers[id] &&
            !sameMcpEndpoint(existing.servers[id], server.url!));
          suffix++
        ) {
          id = `${stem}-${suffix}`.slice(0, 110);
          if (suffix > 20) {
            throw new Error(
              `MCP server id collision for "${server.name}". Re-run with a different workspace or resolve the existing id first.`,
            );
          }
        }
      }
    }
    const current = existing.servers[id];
    planned.push({
      server,
      id,
      entry: {
        type: "http",
        url: server.url!,
        description: `Imported Agent Plugin: ${pluginName}/${server.name}`,
      },
      status: current
        ? sameMcpEndpoint(current, server.url!)
          ? "unchanged"
          : "overwritten"
        : "imported",
    });
    plannedIds.add(id);
  }
  return planned;
}

function planSkills(
  plugin: LoadedAgentPlugin,
  skillsRoot: string,
  force: boolean,
): PlannedSkill[] {
  return plugin.skills.map((skill) => {
    const destination = path.join(skillsRoot, skill.name);
    assertPathInside(skillsRoot, destination, "Imported skill destination");
    assertPathOutside(
      plugin.rootDir,
      destination,
      "Imported skill destination",
    );
    assertNoSymlinkInExistingPath(
      path.dirname(destination),
      "Imported skill destination",
    );
    if (!pathExists(destination)) {
      return { skill, destination, status: "imported" };
    }
    const stat = fs.lstatSync(destination);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(
        `Imported skill destination already exists and is not a regular directory: ${destination}`,
      );
    }
    const unchanged = skillFilesMatch(skill.files, destination);
    if (!unchanged && !force) {
      throw new Error(
        `Imported skill destination differs: ${destination}. Re-run with --force to replace it.`,
      );
    }
    return {
      skill,
      destination,
      status: unchanged ? "unchanged" : "overwritten",
    };
  });
}

function replaceDirectory(
  staging: string,
  destination: string,
  replaceExisting: boolean,
): void {
  const parent = path.dirname(destination);
  fs.mkdirSync(parent, { recursive: true });
  if (!pathExists(destination)) {
    fs.renameSync(staging, destination);
    return;
  }
  if (!replaceExisting) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw new Error(`Refusing to replace existing directory: ${destination}`);
  }
  const backup = path.join(
    parent,
    `.${path.basename(destination)}.backup-${process.pid}-${randomUUID()}`,
  );
  fs.renameSync(destination, backup);
  try {
    fs.renameSync(staging, destination);
    fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (!pathExists(destination) && pathExists(backup)) {
      fs.renameSync(backup, destination);
    }
    throw error;
  }
}

function writeSkill(planned: PlannedSkill, dryRun: boolean): void {
  if (dryRun || planned.status === "unchanged") return;
  const parent = path.dirname(planned.destination);
  fs.mkdirSync(parent, { recursive: true });
  const staging = fs.mkdtempSync(
    path.join(parent, `.${path.basename(planned.destination)}.tmp-`),
  );
  try {
    for (const file of planned.skill.files) {
      const target = path.join(staging, ...file.relativePath.split("/"));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.content, { mode: file.mode });
      fs.chmodSync(target, file.mode);
    }
    replaceDirectory(
      staging,
      planned.destination,
      planned.status === "overwritten",
    );
  } catch (error) {
    if (pathExists(staging))
      fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function safeManifestMetadata(manifest: AgentPluginManifest): JsonRecord {
  const author =
    typeof manifest.author === "object" && manifest.author
      ? {
          name: manifest.author.name,
          ...(manifest.author.url ? { url: manifest.author.url } : {}),
        }
      : manifest.author;
  return {
    name: manifest.name,
    ...(manifest.version ? { version: manifest.version } : {}),
    ...(manifest.description ? { description: manifest.description } : {}),
    ...(author ? { author } : {}),
    ...(manifest.homepage ? { homepage: manifest.homepage } : {}),
    ...(manifest.repository ? { repository: manifest.repository } : {}),
    ...(manifest.license ? { license: manifest.license } : {}),
    ...(manifest.keywords ? { keywords: manifest.keywords } : {}),
  };
}

function buildImportMetadata(
  plugin: LoadedAgentPlugin,
  targetDir: string,
  skillPlans: PlannedSkill[],
  mcpPlans: PlannedMcp[],
): JsonRecord {
  return {
    schemaVersion: 1,
    source: "agent-plugin",
    plugin: safeManifestMetadata(plugin.manifest),
    pluginHash: plugin.pluginHash,
    sourceDir: plugin.rootDir,
    importedAt: new Date().toISOString(),
    skills: skillPlans.map((plan) => ({
      name: plan.skill.name,
      sourcePath: plan.skill.relativePath,
      path: toPosixPath(path.relative(targetDir, plan.destination)),
      destination: plan.destination,
    })),
    mcpServers: mcpPlans.map((plan) => ({
      sourceName: plan.server.name,
      id: plan.id,
      type: plan.server.type,
      url: plan.server.url,
      headersIgnored: plan.server.headerCount,
    })),
    skipped: plugin.skipped,
    warnings: plugin.warnings,
  };
}

function readExistingMetadata(file: string): JsonRecord | undefined {
  if (!pathExists(file)) return undefined;
  assertRegularFile(file, "Agent Plugin import metadata");
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (error) {
    throw new Error(
      `Agent Plugin import metadata is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new Error("Agent Plugin import metadata must contain an object.");
  }
  return parsed;
}

function metadataMatches(
  metadata: JsonRecord | undefined,
  plugin: LoadedAgentPlugin,
): boolean {
  return (
    metadata?.pluginHash === plugin.pluginHash &&
    isRecord(metadata.plugin) &&
    metadata.plugin.name === plugin.manifest.name
  );
}

function applyMcpConfig(
  file: string,
  plans: PlannedMcp[],
  force: boolean,
): void {
  if (plans.length === 0) return;
  withFileLockSync(file, () => {
    const current = readExistingMcpConfig(file);
    const nextServers = { ...current.servers };
    for (const plan of plans) {
      const existing = nextServers[plan.id];
      if (existing && sameMcpEndpoint(existing, plan.entry.url)) continue;
      if (existing && !force && plan.status === "overwritten") {
        throw new Error(
          `MCP server id "${plan.id}" already points to another URL. Re-run with --force to replace it.`,
        );
      }
      nextServers[plan.id] = plan.entry;
    }
    const changed =
      JSON.stringify(nextServers) !== JSON.stringify(current.servers);
    if (changed || !current.fileExists) {
      writeJsonFileAtomically(file, { ...current.value, servers: nextServers });
    }
  });
}

function verifyImport(
  plugin: LoadedAgentPlugin,
  skillPlans: PlannedSkill[],
  mcpPlans: PlannedMcp[],
  metadataFile: string,
  mcpFile: string,
): void {
  for (const plan of skillPlans) {
    if (!pathExists(plan.destination)) {
      throw new Error(
        `Imported skill is missing after write: ${plan.destination}`,
      );
    }
    if (!skillFilesMatch(plan.skill.files, plan.destination)) {
      throw new Error(
        `Imported skill verification failed: ${plan.destination}`,
      );
    }
  }
  if (mcpPlans.length > 0) {
    const config = readExistingMcpConfig(mcpFile);
    for (const plan of mcpPlans) {
      if (!sameMcpEndpoint(config.servers[plan.id], plan.entry.url)) {
        throw new Error(`Imported MCP verification failed: ${plan.id}`);
      }
    }
  }
  const metadata = readExistingMetadata(metadataFile);
  if (!metadataMatches(metadata, plugin)) {
    throw new Error(
      `Imported Agent Plugin metadata verification failed: ${metadataFile}`,
    );
  }
}

export function importAgentPlugin(
  input: string,
  options: AgentPluginImportOptions = {},
): AgentPluginImportResult {
  const plugin = loadAgentPlugin(input);
  const targetDir = canonicalPathForComparison(
    options.targetDir ?? process.cwd(),
  );
  if (pathExists(targetDir) && !fs.statSync(targetDir).isDirectory()) {
    throw new Error(
      `Agent-Native import target must be a directory: ${targetDir}`,
    );
  }
  if (isPathInside(plugin.rootDir, targetDir, true)) {
    throw new Error(
      "Agent Plugin import target must not be the plugin directory or one of its children.",
    );
  }
  assertNoSymlinkInExistingPath(targetDir, "Agent-Native import target");

  const slug = pluginSlug(plugin.manifest.name);
  const skillsTargetDir = canonicalPathForComparison(
    options.skillsTargetDir ?? path.join(targetDir, "skills"),
  );
  if (
    pathExists(skillsTargetDir) &&
    !fs.statSync(skillsTargetDir).isDirectory()
  ) {
    throw new Error(
      `Agent-Native skills target must be a directory: ${skillsTargetDir}`,
    );
  }
  assertPathOutside(plugin.rootDir, skillsTargetDir, "Imported skills target");
  assertNoSymlinkInExistingPath(skillsTargetDir, "Imported skills target");
  const skillsRoot = path.join(skillsTargetDir, slug);
  const metadataFile = path.join(
    targetDir,
    ".agent-native",
    "plugins",
    `${slug}.json`,
  );
  const mcpFile = path.join(targetDir, "mcp.config.json");
  assertPathInside(targetDir, metadataFile, "Imported metadata path");
  assertPathInside(targetDir, mcpFile, "Imported MCP config path");
  assertPathInside(skillsTargetDir, skillsRoot, "Imported skills root");
  assertPathOutside(plugin.rootDir, skillsRoot, "Imported skills root");
  assertPathOutside(plugin.rootDir, metadataFile, "Imported metadata path");
  assertPathOutside(plugin.rootDir, mcpFile, "Imported MCP config path");
  assertNoSymlinkInExistingPath(
    path.dirname(metadataFile),
    "Imported metadata path",
  );
  assertNoSymlinkInExistingPath(mcpFile, "Imported MCP config path");

  const force = options.force ?? false;
  const dryRun = options.dryRun ?? false;
  const existingMcp = readExistingMcpConfig(mcpFile);
  const skillPlans = planSkills(plugin, skillsRoot, force);
  const mcpPlans = planMcpServers(plugin, existingMcp, force);
  const existingMetadata = readExistingMetadata(metadataFile);
  const metadataIsSame = metadataMatches(existingMetadata, plugin);
  if (existingMetadata && !metadataIsSame && !force) {
    throw new Error(
      `Agent Plugin import metadata differs: ${metadataFile}. Re-run with --force to replace it.`,
    );
  }
  const metadata = metadataIsSame
    ? existingMetadata!
    : buildImportMetadata(plugin, targetDir, skillPlans, mcpPlans);

  const result: AgentPluginImportResult = {
    plugin: {
      name: plugin.manifest.name,
      ...(plugin.manifest.version ? { version: plugin.manifest.version } : {}),
      hash: plugin.pluginHash,
      sourceDir: plugin.rootDir,
    },
    targetDir,
    metadataPath: metadataFile,
    mcpConfigPath: mcpFile,
    skills: skillPlans.map((plan) => ({
      name: plan.skill.name,
      sourcePath: plan.skill.relativePath,
      destination: plan.destination,
      files: plan.skill.files.length,
      status: dryRun
        ? plan.status === "overwritten"
          ? "would-overwrite"
          : plan.status === "unchanged"
            ? "unchanged"
            : "would-import"
        : plan.status,
    })),
    mcpServers: mcpPlans.map((plan) => ({
      name: plan.server.name,
      id: plan.id,
      url: plan.server.url!,
      headersIgnored: plan.server.headerCount,
      status: dryRun
        ? plan.status === "overwritten"
          ? "would-overwrite"
          : plan.status === "unchanged"
            ? "unchanged"
            : "would-import"
        : plan.status,
    })),
    skipped: plugin.skipped,
    warnings: plugin.warnings,
    dryRun,
  };

  if (dryRun) return result;

  for (const plan of skillPlans) writeSkill(plan, false);
  applyMcpConfig(mcpFile, mcpPlans, force);
  if (!metadataIsSame || !pathExists(metadataFile)) {
    writeJsonFileAtomically(metadataFile, metadata);
  }
  verifyImport(plugin, skillPlans, mcpPlans, metadataFile, mcpFile);
  return result;
}

export function parseAgentPluginArgs(argv: string[]): ParsedAgentPluginArgs {
  const first = argv[0];
  if (first === "help" || first === "--help" || first === "-h") {
    return {
      command: "help",
      force: false,
      dryRun: false,
      printJson: false,
      yes: false,
    };
  }
  if (first !== "import") {
    throw new Error(`Unknown plugin command: ${first ?? "(missing command)"}`);
  }

  const out: ParsedAgentPluginArgs = {
    command: "import",
    force: false,
    dryRun: false,
    printJson: false,
    yes: false,
  };
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index];
    const eat = (flag: string): string | undefined => {
      if (arg === flag) {
        const next = argv[++index];
        if (!next || next.startsWith("-"))
          throw new Error(`Missing value for ${flag}.`);
        return next;
      }
      if (arg.startsWith(`${flag}=`)) {
        const value = arg.slice(flag.length + 1);
        if (!value) throw new Error(`Missing value for ${flag}.`);
        return value;
      }
      return undefined;
    };
    const into = eat("--into");
    if (into !== undefined) out.into = into;
    else if (arg === "--force") out.force = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--json") out.printJson = true;
    else if (arg === "--yes" || arg === "-y") out.yes = true;
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else if (!out.source) out.source = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!out.source) throw new Error("Missing Agent Plugin path to import.");
  return out;
}

async function confirmPluginImport(
  plugin: LoadedAgentPlugin,
  targetDir: string,
  result: AgentPluginImportResult,
): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "Refusing to import an Agent Plugin without confirmation. Re-run with --yes to approve.",
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
        `Import Agent Plugin ${plugin.manifest.name}?`,
        `  Skills: ${result.skills.length}`,
        `  Remote MCP servers: ${result.mcpServers.length}`,
        `  Target: ${targetDir}`,
        "Package headers are ignored and are not stored as credentials.",
        "Proceed? [y/N] ",
      ].join("\n"),
    );
    if (!/^(y|yes)$/i.test(answer.trim()))
      throw new Error("Cancelled Agent Plugin import.");
  } finally {
    rl.close();
  }
}

export async function runAgentPlugin(argv: string[]): Promise<void> {
  try {
    const parsed = parseAgentPluginArgs(argv);
    if (parsed.command === "help") {
      process.stdout.write(`${HELP}\n`);
      return;
    }
    if (!parsed.source) throw new Error("Missing Agent Plugin path to import.");
    const loaded = loadAgentPlugin(parsed.source);
    const preview = importAgentPlugin(parsed.source, {
      targetDir: parsed.into,
      force: parsed.force,
      dryRun: true,
    });
    if (!parsed.dryRun && !parsed.yes) {
      await confirmPluginImport(loaded, preview.targetDir, preview);
    }
    const result = parsed.dryRun
      ? preview
      : importAgentPlugin(parsed.source, {
          targetDir: parsed.into,
          force: parsed.force,
        });
    if (parsed.printJson) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    const action = parsed.dryRun ? "Would import" : "Imported";
    process.stdout.write(
      `${action} ${result.plugin.name} into ${result.targetDir}: ${result.skills.length} skill(s), ${result.mcpServers.length} remote MCP server(s).\n`,
    );
    for (const warning of result.warnings)
      process.stdout.write(`Warning: ${warning}\n`);
    for (const skipped of result.skipped) {
      process.stdout.write(
        `Skipped ${skipped.component}${skipped.name ? ` "${skipped.name}"` : ""}: ${skipped.reason}\n`,
      );
    }
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
