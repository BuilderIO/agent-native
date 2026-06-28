import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { minimatch } from "minimatch";

export type AgentNativeDataMode = "database" | "local-files";

export interface AgentNativeManifestRoot {
  name?: string;
  path: string;
  kind?: string;
  profile?: string;
  extensions?: string[];
  include?: string[];
  hide?: string[];
}

export interface AgentNativeManifestApp {
  mode?: AgentNativeDataMode;
  profile?: string;
  roots?: AgentNativeManifestRoot[];
  components?: string | string[];
  extensions?: string | string[];
  hide?: string[];
}

export interface AgentNativeManifest {
  version?: number;
  mode?: AgentNativeDataMode;
  apps?: Record<string, AgentNativeManifestApp>;
}

export interface LoadedAgentNativeManifest {
  path: string;
  rootDir: string;
  manifest: AgentNativeManifest;
}

export interface LocalArtifactAppDefaults {
  mode?: AgentNativeDataMode;
  profile?: string;
  roots: AgentNativeManifestRoot[];
  hide?: string[];
  components?: string | string[];
  extensions?: string | string[];
}

export interface LoadAgentNativeManifestOptions {
  cwd?: string;
  manifestPath?: string;
  optional?: boolean;
}

export interface ResolveAgentNativeModeOptions extends LoadAgentNativeManifestOptions {
  appId?: string;
  defaults?: Pick<LocalArtifactAppDefaults, "mode">;
}

export interface LocalArtifactOptions extends LoadAgentNativeManifestOptions {
  appId: string;
  defaults?: LocalArtifactAppDefaults;
}

export interface LoadedLocalArtifactRoot {
  name: string;
  path: string;
  absolutePath: string;
  kind?: string;
  profile?: string;
  extensions: string[];
  hide: string[];
  include: string[];
}

export interface LoadedLocalArtifactApp {
  appId: string;
  mode: AgentNativeDataMode;
  profile?: string;
  manifestPath: string | null;
  workspaceRoot: string;
  roots: LoadedLocalArtifactRoot[];
  components: string[];
  extensions: string[];
  hide: string[];
}

export interface LocalArtifactFileMeta {
  path: string;
  absolutePath: string;
  rootName: string;
  rootPath: string;
  kind?: string;
  profile?: string;
  extension: string;
  contentType: string;
  sizeBytes: number;
  hash: string;
  createdAt: string;
  updatedAt: string;
  mtimeMs: number;
}

export interface LocalArtifactFile extends LocalArtifactFileMeta {
  content: string;
}

export interface WriteLocalArtifactFileOptions extends LocalArtifactOptions {
  content: string;
  expectedHash?: string | null;
  ifNotExists?: boolean;
}

export interface LocalWorkspaceResourceMeta {
  id: string;
  path: string;
  absolutePath: string;
  mimeType: string;
  sizeBytes: number;
  hash: string;
  createdAt: string;
  updatedAt: string;
  mtimeMs: number;
}

export interface LocalWorkspaceResourceFile extends LocalWorkspaceResourceMeta {
  content: string;
}

export interface LocalWorkspaceResourceOptions extends LoadAgentNativeManifestOptions {}

export interface WriteLocalWorkspaceResourceOptions extends LocalWorkspaceResourceOptions {
  path: string;
  content: string;
  expectedHash?: string | null;
  ifNotExists?: boolean;
}

const MANIFEST_FILE = "agent-native.json";
const ENV_MODE_NAMES = ["AGENT_NATIVE_MODE", "AGENT_NATIVE_DATA_MODE"];
const ENV_MANIFEST_NAMES = [
  "AGENT_NATIVE_MANIFEST",
  "AGENT_NATIVE_MANIFEST_PATH",
];
const ALLOW_PRODUCTION_LOCAL_FILES_ENV =
  "AGENT_NATIVE_ALLOW_LOCAL_FILES_IN_PRODUCTION";
const DEFAULT_HIDE_PATTERNS = [
  "**/.git/**",
  "**/.agent-native/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
];
export const LOCAL_WORKSPACE_RESOURCE_ID_PREFIX = "local-workspace-resource:";
const LOCAL_WORKSPACE_RESOURCE_MAX_BYTES = 2 * 1024 * 1024;
const LOCAL_WORKSPACE_CONTROL_FILES = new Set([
  "AGENTS.md",
  "agent-native.json",
  "mcp.config.json",
  ".mcp.json",
]);
const LOCAL_WORKSPACE_SKILL_ROOTS = [".agents/skills", ".agent/skills"];
const LOCAL_WORKSPACE_TEXT_EXTENSIONS = new Set([
  ".css",
  ".csv",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mdx",
  ".py",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === "string"
    ? error.code
    : undefined;
}

function asStringArray(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeMode(value: unknown): AgentNativeDataMode | undefined {
  if (value === "database" || value === "local-files") return value;
  return undefined;
}

function normalizeProfile(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeSlash(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function normalizeRelativePath(filePath: string, label = "path"): string {
  if (!filePath || typeof filePath !== "string") {
    throw new Error(`${label} is required`);
  }
  if (filePath.includes("\0")) {
    throw new Error(`${label} must not contain null bytes`);
  }
  if (path.isAbsolute(filePath)) {
    throw new Error(`${label} must be relative`);
  }
  const normalized = normalizeSlash(
    path.posix.normalize(normalizeSlash(filePath)),
  );
  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized === ".." ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`${label} must be a safe relative path`);
  }
  return normalized;
}

function extensionOf(filePath: string): string {
  return path.posix.extname(filePath).toLowerCase();
}

function normalizeExtensions(value: unknown): string[] {
  const extensions = asStringArray(value)
    .map((ext) => ext.trim().toLowerCase())
    .filter(Boolean)
    .map((ext) => (ext.startsWith(".") ? ext : `.${ext}`));
  return [...new Set(extensions)];
}

function rootNameFromPath(rootPath: string): string {
  return (
    rootPath
      .split("/")
      .filter(Boolean)
      .at(-1)
      ?.replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase()) || rootPath
  );
}

function normalizeManifestRoot(value: unknown): AgentNativeManifestRoot | null {
  if (typeof value === "string") return { path: value };
  if (!isRecord(value) || typeof value.path !== "string") return null;
  return {
    name: typeof value.name === "string" ? value.name : undefined,
    path: value.path,
    kind: typeof value.kind === "string" ? value.kind : undefined,
    profile: normalizeProfile(value.profile),
    extensions: normalizeExtensions(value.extensions),
    include: asStringArray(value.include),
    hide: asStringArray(value.hide),
  };
}

function normalizeManifestApp(value: unknown): AgentNativeManifestApp {
  if (Array.isArray(value)) {
    return {
      roots: value
        .map(normalizeManifestRoot)
        .filter((root): root is AgentNativeManifestRoot => !!root),
    };
  }
  if (!isRecord(value)) return {};
  const roots = Array.isArray(value.roots)
    ? value.roots
        .map(normalizeManifestRoot)
        .filter((root): root is AgentNativeManifestRoot => !!root)
    : [];
  return {
    mode: normalizeMode(value.mode),
    profile: normalizeProfile(value.profile),
    roots,
    components:
      typeof value.components === "string" || Array.isArray(value.components)
        ? asStringArray(value.components)
        : undefined,
    extensions:
      typeof value.extensions === "string" || Array.isArray(value.extensions)
        ? asStringArray(value.extensions)
        : undefined,
    hide: asStringArray(value.hide),
  };
}

function normalizeManifest(value: unknown): AgentNativeManifest {
  const record = isRecord(value) ? value : {};
  const appsRecord = isRecord(record.apps) ? record.apps : {};
  const apps: Record<string, AgentNativeManifestApp> = {};
  for (const [appId, appValue] of Object.entries(appsRecord)) {
    apps[appId] = normalizeManifestApp(appValue);
  }
  return {
    version:
      typeof record.version === "number" && Number.isFinite(record.version)
        ? record.version
        : undefined,
    mode: normalizeMode(record.mode),
    apps,
  };
}

function firstEnvValue(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function envMode(): AgentNativeDataMode | undefined {
  return normalizeMode(firstEnvValue(ENV_MODE_NAMES));
}

function envFlag(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function assertLocalFilesRuntimeAllowed(mode: AgentNativeDataMode) {
  if (mode !== "local-files") return;
  if (process.env.NODE_ENV !== "production") return;
  if (envFlag(ALLOW_PRODUCTION_LOCAL_FILES_ENV)) return;
  throw new Error(
    `Local file mode is only enabled for local development runtimes. Set ${ALLOW_PRODUCTION_LOCAL_FILES_ENV}=true only for a trusted single-tenant local file bridge.`,
  );
}

function envManifestPath(): string | undefined {
  return firstEnvValue(ENV_MANIFEST_NAMES);
}

export function findAgentNativeManifest(
  startDir = process.cwd(),
): string | null {
  let current = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(current, MANIFEST_FILE);
    if (fsSync.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function loadAgentNativeManifest(
  options: LoadAgentNativeManifestOptions = {},
): Promise<LoadedAgentNativeManifest | null> {
  const manifestPath =
    options.manifestPath ??
    envManifestPath() ??
    findAgentNativeManifest(options.cwd ?? process.cwd());

  if (!manifestPath) {
    if (options.optional) return null;
    throw new Error(`Could not find ${MANIFEST_FILE}`);
  }

  const resolvedPath = path.resolve(options.cwd ?? process.cwd(), manifestPath);
  try {
    const raw = await fs.readFile(resolvedPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return {
      path: resolvedPath,
      rootDir: path.dirname(resolvedPath),
      manifest: normalizeManifest(parsed),
    };
  } catch (error) {
    if (options.optional && errorCode(error) === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function resolveAgentNativeDataMode(
  options: ResolveAgentNativeModeOptions = {},
): Promise<AgentNativeDataMode> {
  const explicitMode = envMode();
  if (explicitMode) {
    assertLocalFilesRuntimeAllowed(explicitMode);
    return explicitMode;
  }

  const loaded = await loadAgentNativeManifest({ ...options, optional: true });
  const appMode = options.appId
    ? loaded?.manifest.apps?.[options.appId]?.mode
    : undefined;
  const mode =
    appMode ?? loaded?.manifest.mode ?? options.defaults?.mode ?? "database";
  assertLocalFilesRuntimeAllowed(mode);
  return mode;
}

export async function isAgentNativeLocalFileMode(
  options: ResolveAgentNativeModeOptions = {},
): Promise<boolean> {
  return (await resolveAgentNativeDataMode(options)) === "local-files";
}

function mergeAppConfig(
  manifestApp: AgentNativeManifestApp | undefined,
  defaults: LocalArtifactAppDefaults | undefined,
): AgentNativeManifestApp {
  return {
    mode: manifestApp?.mode ?? defaults?.mode,
    profile: manifestApp?.profile ?? defaults?.profile,
    roots:
      manifestApp?.roots && manifestApp.roots.length > 0
        ? manifestApp.roots
        : (defaults?.roots ?? []),
    components: manifestApp?.components ?? defaults?.components,
    extensions: manifestApp?.extensions ?? defaults?.extensions,
    hide: [...(defaults?.hide ?? []), ...(manifestApp?.hide ?? [])],
  };
}

function resolveInsideWorkspace(workspaceRoot: string, relativePath: string) {
  const safePath = normalizeRelativePath(relativePath);
  const absolutePath = path.resolve(workspaceRoot, safePath);
  const relative = path.relative(workspaceRoot, absolutePath);
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Path "${relativePath}" is outside the workspace`);
  }
  return { safePath, absolutePath };
}

export async function getLocalArtifactApp(
  options: LocalArtifactOptions,
): Promise<LoadedLocalArtifactApp> {
  const loaded = await loadAgentNativeManifest({ ...options, optional: true });
  const workspaceRoot =
    loaded?.rootDir ?? path.resolve(options.cwd ?? process.cwd());
  const manifestApp = loaded?.manifest.apps?.[options.appId];
  const app = mergeAppConfig(manifestApp, options.defaults);
  const mode = await resolveAgentNativeDataMode({
    ...options,
    appId: options.appId,
    defaults: app,
  });

  const roots = (app.roots ?? []).map((root) => {
    const { safePath, absolutePath } = resolveInsideWorkspace(
      workspaceRoot,
      root.path,
    );
    const extensions = normalizeExtensions(root.extensions);
    return {
      name: root.name || rootNameFromPath(safePath),
      path: safePath,
      absolutePath,
      kind: root.kind,
      profile: root.profile ?? app.profile,
      extensions,
      hide: [...DEFAULT_HIDE_PATTERNS, ...asStringArray(root.hide)],
      include: asStringArray(root.include),
    };
  });

  return {
    appId: options.appId,
    mode,
    profile: app.profile,
    manifestPath: loaded?.path ?? null,
    workspaceRoot,
    roots,
    components: asStringArray(app.components),
    extensions: asStringArray(app.extensions),
    hide: [...DEFAULT_HIDE_PATTERNS, ...asStringArray(app.hide)],
  };
}

function matchesPatterns(filePath: string, patterns: string[]) {
  return patterns.some((pattern) =>
    minimatch(filePath, pattern, { dot: true, nocase: true }),
  );
}

function contentTypeForExtension(extension: string): string {
  if (extension === ".md") return "text/markdown";
  if (extension === ".mdx") return "text/mdx";
  if (extension === ".json") return "application/json";
  if (extension === ".txt") return "text/plain";
  return "application/octet-stream";
}

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

const writeLocks = new Map<string, Promise<void>>();

function noFollowOpenFlags(): number {
  return fsSync.constants.O_RDONLY | (fsSync.constants.O_NOFOLLOW ?? 0);
}

async function withWriteLock<T>(
  absolutePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = writeLocks.get(absolutePath) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const current = previous.catch(() => {}).then(() => next);
  writeLocks.set(absolutePath, current);
  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (writeLocks.get(absolutePath) === current) {
      writeLocks.delete(absolutePath);
    }
  }
}

function assertNoSymlinkPathSync(
  root: LoadedLocalArtifactRoot,
  absolutePath: string,
  options: { allowMissingLeaf?: boolean } = {},
) {
  const relative = path.relative(root.absolutePath, absolutePath);
  const segments = relative.split(path.sep).filter(Boolean);
  let current = root.absolutePath;
  const pathsToCheck = [
    current,
    ...segments.map((segment) => {
      current = path.join(current, segment);
      return current;
    }),
  ];

  for (let index = 0; index < pathsToCheck.length; index += 1) {
    const candidate = pathsToCheck[index]!;
    try {
      const stat = fsSync.lstatSync(candidate);
      if (stat.isSymbolicLink()) {
        throw new Error(`Path "${candidate}" must not traverse a symlink`);
      }
      if (index < pathsToCheck.length - 1 && !stat.isDirectory()) {
        throw new Error(`Path "${candidate}" is not a directory`);
      }
    } catch (error) {
      if (errorCode(error) === "ENOENT" && options.allowMissingLeaf) return;
      throw error;
    }
  }
}

function readTextFileWithoutSymlink(
  root: LoadedLocalArtifactRoot,
  absolutePath: string,
): { content: string; stat: fsSync.Stats } {
  assertNoSymlinkPathSync(root, absolutePath);
  const fd = fsSync.openSync(absolutePath, noFollowOpenFlags());
  try {
    return {
      content: fsSync.readFileSync(fd, "utf8"),
      stat: fsSync.fstatSync(fd),
    };
  } finally {
    fsSync.closeSync(fd);
  }
}

async function fileMetaForPath(
  root: LoadedLocalArtifactRoot,
  artifactPath: string,
  absolutePath: string,
  contentOverride?: string,
  statOverride?: fsSync.Stats,
): Promise<LocalArtifactFileMeta> {
  const read =
    contentOverride === undefined
      ? readTextFileWithoutSymlink(root, absolutePath)
      : undefined;
  const content = contentOverride ?? read!.content;
  const stat = statOverride ?? read?.stat ?? (await fs.stat(absolutePath));
  const extension = extensionOf(artifactPath);
  return {
    path: artifactPath,
    absolutePath,
    rootName: root.name,
    rootPath: root.path,
    kind: root.kind,
    profile: root.profile,
    extension,
    contentType: contentTypeForExtension(extension),
    sizeBytes: Buffer.byteLength(content, "utf8"),
    hash: hashContent(content),
    createdAt: stat.birthtime.toISOString(),
    updatedAt: stat.mtime.toISOString(),
    mtimeMs: stat.mtimeMs,
  };
}

function rootAllowsPath(root: LoadedLocalArtifactRoot, artifactPath: string) {
  const extension = extensionOf(artifactPath);
  if (root.extensions.length > 0 && !root.extensions.includes(extension)) {
    return false;
  }
  if (matchesPatterns(artifactPath, root.hide)) return false;
  if (root.include.length === 0) return true;
  return matchesPatterns(artifactPath, root.include);
}

async function walkRoot(
  root: LoadedLocalArtifactRoot,
  directory = root.absolutePath,
): Promise<LocalArtifactFileMeta[]> {
  let entries: fsSync.Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return [];
    }
    throw error;
  }

  const files: LocalArtifactFileMeta[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const relativeToRoot = normalizeSlash(
      path.relative(root.absolutePath, absolutePath),
    );
    const artifactPath = normalizeSlash(
      path.posix.join(root.path, relativeToRoot),
    );
    if (matchesPatterns(artifactPath, root.hide)) continue;

    if (entry.isDirectory()) {
      files.push(...(await walkRoot(root, absolutePath)));
      continue;
    }
    if (!entry.isFile() || !rootAllowsPath(root, artifactPath)) continue;
    files.push(await fileMetaForPath(root, artifactPath, absolutePath));
  }
  return files;
}

export async function listLocalArtifactFiles(
  options: LocalArtifactOptions,
): Promise<LocalArtifactFileMeta[]> {
  const app = await getLocalArtifactApp(options);
  if (app.mode !== "local-files") return [];

  const files = (await Promise.all(app.roots.map((root) => walkRoot(root))))
    .flat()
    .filter((file) => !matchesPatterns(file.path, app.hide));

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function rootForArtifactPath(
  app: LoadedLocalArtifactApp,
  artifactPath: string,
): LoadedLocalArtifactRoot {
  const safePath = normalizeRelativePath(artifactPath);
  const root = app.roots.find(
    (candidate) =>
      safePath === candidate.path || safePath.startsWith(`${candidate.path}/`),
  );
  if (!root) {
    throw new Error(`Path "${artifactPath}" is not in a configured local root`);
  }
  if (!rootAllowsPath(root, safePath) || matchesPatterns(safePath, app.hide)) {
    throw new Error(`Path "${artifactPath}" is not allowed for this app`);
  }
  return root;
}

async function resolveArtifactPath(
  app: LoadedLocalArtifactApp,
  artifactPath: string,
): Promise<{
  root: LoadedLocalArtifactRoot;
  safePath: string;
  absolutePath: string;
}> {
  const safePath = normalizeRelativePath(artifactPath);
  const root = rootForArtifactPath(app, safePath);
  const absolutePath = path.resolve(app.workspaceRoot, safePath);
  const relative = path.relative(root.absolutePath, absolutePath);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    relative === ""
  ) {
    throw new Error(`Path "${artifactPath}" is outside its configured root`);
  }
  return { root, safePath, absolutePath };
}

async function assertNoSymlinkPath(
  root: LoadedLocalArtifactRoot,
  absolutePath: string,
  options: { allowMissingLeaf?: boolean } = {},
) {
  assertNoSymlinkPathSync(root, absolutePath, options);
}

export async function readLocalArtifactFile(
  options: LocalArtifactOptions & { path: string },
): Promise<LocalArtifactFile | null> {
  const app = await getLocalArtifactApp(options);
  if (app.mode !== "local-files") return null;
  const { root, safePath, absolutePath } = await resolveArtifactPath(
    app,
    options.path,
  );
  try {
    const { content, stat } = readTextFileWithoutSymlink(root, absolutePath);
    const meta = await fileMetaForPath(
      root,
      safePath,
      absolutePath,
      content,
      stat,
    );
    return { ...meta, content };
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeLocalArtifactFile(
  options: WriteLocalArtifactFileOptions & { path: string },
): Promise<LocalArtifactFileMeta> {
  const app = await getLocalArtifactApp(options);
  if (app.mode !== "local-files") {
    throw new Error("Local file mode is not enabled");
  }
  const { root, safePath, absolutePath } = await resolveArtifactPath(
    app,
    options.path,
  );
  return withWriteLock(absolutePath, async () => {
    const existing = await readLocalArtifactFile({
      ...options,
      path: safePath,
    });
    if (options.ifNotExists && existing) {
      throw new Error(`File "${safePath}" already exists`);
    }
    if (
      options.expectedHash &&
      (!existing || existing.hash !== options.expectedHash)
    ) {
      throw new Error(
        `File "${safePath}" changed on disk. Reload before saving again.`,
      );
    }

    await assertNoSymlinkPath(root, absolutePath, { allowMissingLeaf: true });
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    const tempPath = path.join(
      path.dirname(absolutePath),
      `.${path.basename(absolutePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
    );
    await fs.writeFile(tempPath, options.content, "utf8");
    await fs.rename(tempPath, absolutePath);
    return fileMetaForPath(root, safePath, absolutePath, options.content);
  });
}

export async function deleteLocalArtifactFile(
  options: LocalArtifactOptions & { path: string },
): Promise<boolean> {
  const app = await getLocalArtifactApp(options);
  if (app.mode !== "local-files") {
    throw new Error("Local file mode is not enabled");
  }
  const { root, absolutePath } = await resolveArtifactPath(app, options.path);
  try {
    await assertNoSymlinkPath(root, absolutePath);
    await fs.unlink(absolutePath);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function ensureLocalArtifactRoot(
  options: LocalArtifactOptions,
): Promise<LoadedLocalArtifactRoot> {
  const app = await getLocalArtifactApp(options);
  if (app.mode !== "local-files") {
    throw new Error("Local file mode is not enabled");
  }
  const root = app.roots[0];
  if (!root) {
    throw new Error(`No local roots configured for app "${options.appId}"`);
  }
  await fs.mkdir(root.absolutePath, { recursive: true });
  return root;
}

export function createTempWorkspaceDir(prefix = "agent-native-local-"): string {
  return fsSync.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function localWorkspaceResourcesEnabled(
  loaded: LoadedAgentNativeManifest | null,
): boolean {
  const explicitMode = envMode();
  if (explicitMode) {
    assertLocalFilesRuntimeAllowed(explicitMode);
    return explicitMode === "local-files";
  }
  const manifest = loaded?.manifest;
  const mode = manifest?.mode;
  if (mode) {
    assertLocalFilesRuntimeAllowed(mode);
    if (mode === "local-files") return true;
  }
  return false;
}

async function resolveLocalWorkspaceRoot(
  options: LocalWorkspaceResourceOptions = {},
): Promise<string | null> {
  const loaded = await loadAgentNativeManifest({ ...options, optional: true });
  if (localWorkspaceResourcesEnabled(loaded)) {
    return loaded?.rootDir ?? path.resolve(options.cwd ?? process.cwd());
  }
  return null;
}

export async function isLocalWorkspaceResourcesEnabled(
  options: LocalWorkspaceResourceOptions = {},
): Promise<boolean> {
  return !!(await resolveLocalWorkspaceRoot(options));
}

export function localWorkspaceResourceId(resourcePath: string): string {
  const normalized = normalizeSlash(resourcePath).replace(/^\/+/, "");
  return `${LOCAL_WORKSPACE_RESOURCE_ID_PREFIX}${Buffer.from(
    normalized,
    "utf8",
  ).toString("base64url")}`;
}

export function isLocalWorkspaceResourceId(id: string): boolean {
  return id.startsWith(LOCAL_WORKSPACE_RESOURCE_ID_PREFIX);
}

export function localWorkspaceResourcePathFromId(id: string): string | null {
  if (!isLocalWorkspaceResourceId(id)) return null;
  const encoded = id.slice(LOCAL_WORKSPACE_RESOURCE_ID_PREFIX.length);
  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    return normalizeLocalWorkspaceResourcePath(decoded);
  } catch {
    return null;
  }
}

function mimeTypeForLocalWorkspaceResource(resourcePath: string): string {
  const extension = extensionOf(resourcePath);
  if (extension === ".md") return "text/markdown";
  if (extension === ".mdx") return "text/mdx";
  if (extension === ".json") return "application/json";
  if (extension === ".yaml" || extension === ".yml") return "application/yaml";
  if (extension === ".toml") return "text/toml";
  if (extension === ".ts" || extension === ".tsx") return "text/typescript";
  if (extension === ".js" || extension === ".jsx") return "text/javascript";
  if (extension === ".html") return "text/html";
  if (extension === ".css") return "text/css";
  if (extension === ".xml") return "application/xml";
  if (extension === ".csv") return "text/csv";
  if (extension === ".sql") return "text/sql";
  if (extension === ".sh") return "text/x-shellscript";
  if (extension === ".py") return "text/x-python";
  return "text/plain";
}

function isSupportedLocalWorkspaceTextFile(resourcePath: string): boolean {
  return LOCAL_WORKSPACE_TEXT_EXTENSIONS.has(extensionOf(resourcePath));
}

export function normalizeLocalWorkspaceResourcePath(resourcePath: string) {
  const safePath = normalizeRelativePath(
    normalizeSlash(resourcePath).replace(/^\/+/, ""),
    "resource path",
  );
  if (LOCAL_WORKSPACE_CONTROL_FILES.has(safePath)) return safePath;
  if (safePath.startsWith(".agents/skills/")) {
    const relativeSkillPath = normalizeRelativePath(
      safePath.slice(".agents/skills/".length),
      "resource path",
    );
    return normalizeSlash(path.posix.join("skills", relativeSkillPath));
  }
  if (safePath.startsWith(".agent/skills/")) {
    const relativeSkillPath = normalizeRelativePath(
      safePath.slice(".agent/skills/".length),
      "resource path",
    );
    return normalizeSlash(path.posix.join("skills", relativeSkillPath));
  }
  if (safePath.startsWith("skills/")) return safePath;
  throw new Error(
    `Local workspace resource "${resourcePath}" must be AGENTS.md, agent-native.json, mcp.config.json, .mcp.json, or under skills/.`,
  );
}

export function canUseLocalWorkspaceResourcePath(
  resourcePath: string,
): boolean {
  try {
    normalizeLocalWorkspaceResourcePath(resourcePath);
    return true;
  } catch {
    return false;
  }
}

function localWorkspaceResourceAbsolutePath(
  workspaceRoot: string,
  resourcePath: string,
  options: { preferExisting?: boolean } = {},
): { resourcePath: string; absolutePath: string } {
  const normalized = normalizeLocalWorkspaceResourcePath(resourcePath);
  const safePath = normalizeRelativePath(
    normalizeSlash(resourcePath).replace(/^\/+/, ""),
    "resource path",
  );
  let relativePath = normalized;
  if (
    safePath.startsWith(".agents/skills/") ||
    safePath.startsWith(".agent/skills/")
  ) {
    relativePath = safePath;
  } else if (normalized.startsWith("skills/")) {
    const skillPath = normalized.slice("skills/".length);
    const candidates = LOCAL_WORKSPACE_SKILL_ROOTS.map((root) =>
      normalizeSlash(path.posix.join(root, skillPath)),
    );
    relativePath = candidates[0]!;
    if (options.preferExisting) {
      relativePath =
        candidates.find((candidate) =>
          fsSync.existsSync(path.resolve(workspaceRoot, candidate)),
        ) ?? relativePath;
    }
  }
  const { absolutePath } = resolveInsideWorkspace(workspaceRoot, relativePath);
  return { resourcePath: normalized, absolutePath };
}

function localWorkspaceResourceDeletePaths(
  workspaceRoot: string,
  resourcePath: string,
): string[] {
  const normalized = normalizeLocalWorkspaceResourcePath(resourcePath);
  const safePath = normalizeRelativePath(
    normalizeSlash(resourcePath).replace(/^\/+/, ""),
    "resource path",
  );
  if (
    safePath.startsWith(".agents/skills/") ||
    safePath.startsWith(".agent/skills/") ||
    !normalized.startsWith("skills/")
  ) {
    const { absolutePath } = localWorkspaceResourceAbsolutePath(
      workspaceRoot,
      resourcePath,
    );
    return [absolutePath];
  }

  const skillPath = normalized.slice("skills/".length);
  return LOCAL_WORKSPACE_SKILL_ROOTS.map((root) => {
    const relativePath = normalizeSlash(path.posix.join(root, skillPath));
    return resolveInsideWorkspace(workspaceRoot, relativePath).absolutePath;
  });
}

function assertNoSymlinkAbsolutePathSync(
  workspaceRoot: string,
  absolutePath: string,
  options: { allowMissingLeaf?: boolean } = {},
) {
  const relative = path.relative(workspaceRoot, absolutePath);
  const segments = relative.split(path.sep).filter(Boolean);
  let current = workspaceRoot;
  const pathsToCheck = [
    current,
    ...segments.map((segment) => {
      current = path.join(current, segment);
      return current;
    }),
  ];

  for (let index = 0; index < pathsToCheck.length; index += 1) {
    const candidate = pathsToCheck[index]!;
    try {
      const stat = fsSync.lstatSync(candidate);
      if (stat.isSymbolicLink()) {
        throw new Error(`Path "${candidate}" must not traverse a symlink`);
      }
      if (index < pathsToCheck.length - 1 && !stat.isDirectory()) {
        throw new Error(`Path "${candidate}" is not a directory`);
      }
    } catch (error) {
      if (errorCode(error) === "ENOENT" && options.allowMissingLeaf) return;
      throw error;
    }
  }
}

function readLocalWorkspaceTextFile(
  workspaceRoot: string,
  absolutePath: string,
): { content: string; stat: fsSync.Stats } {
  assertNoSymlinkAbsolutePathSync(workspaceRoot, absolutePath);
  const fd = fsSync.openSync(absolutePath, noFollowOpenFlags());
  try {
    const stat = fsSync.fstatSync(fd);
    if (!stat.isFile()) {
      throw new Error(`Path "${absolutePath}" is not a file`);
    }
    if (stat.size > LOCAL_WORKSPACE_RESOURCE_MAX_BYTES) {
      throw new Error(
        `Local workspace resource "${absolutePath}" is too large to load`,
      );
    }
    return {
      content: fsSync.readFileSync(fd, "utf8"),
      stat,
    };
  } finally {
    fsSync.closeSync(fd);
  }
}

function localWorkspaceResourceMeta(
  resourcePath: string,
  absolutePath: string,
  content: string,
  stat: fsSync.Stats,
): LocalWorkspaceResourceMeta {
  return {
    id: localWorkspaceResourceId(resourcePath),
    path: resourcePath,
    absolutePath,
    mimeType: mimeTypeForLocalWorkspaceResource(resourcePath),
    sizeBytes: Buffer.byteLength(content, "utf8"),
    hash: hashContent(content),
    createdAt: stat.birthtime.toISOString(),
    updatedAt: stat.mtime.toISOString(),
    mtimeMs: stat.mtimeMs,
  };
}

async function maybeLocalWorkspaceResourceMeta(
  workspaceRoot: string,
  resourcePath: string,
  absolutePath: string,
): Promise<LocalWorkspaceResourceMeta | null> {
  if (!isSupportedLocalWorkspaceTextFile(resourcePath)) return null;
  try {
    const { content, stat } = readLocalWorkspaceTextFile(
      workspaceRoot,
      absolutePath,
    );
    return localWorkspaceResourceMeta(
      resourcePath,
      absolutePath,
      content,
      stat,
    );
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

async function walkLocalWorkspaceSkillRoot(
  workspaceRoot: string,
  skillRoot: string,
  seenPaths: Set<string>,
): Promise<LocalWorkspaceResourceMeta[]> {
  const absoluteRoot = path.join(workspaceRoot, skillRoot);
  try {
    assertNoSymlinkAbsolutePathSync(workspaceRoot, absoluteRoot);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }

  const files: LocalWorkspaceResourceMeta[] = [];
  async function walk(directory: string): Promise<void> {
    let entries: fsSync.Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === "ENOENT") return;
      throw error;
    }

    for (const entry of entries) {
      if (entry.name === ".DS_Store") continue;
      const absolutePath = path.join(directory, entry.name);
      const relativeToSkillRoot = normalizeSlash(
        path.relative(absoluteRoot, absolutePath),
      );
      const resourcePath = normalizeSlash(
        path.posix.join("skills", relativeToSkillRoot),
      );
      if (seenPaths.has(resourcePath)) continue;
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const meta = await maybeLocalWorkspaceResourceMeta(
        workspaceRoot,
        resourcePath,
        absolutePath,
      );
      if (!meta) continue;
      seenPaths.add(resourcePath);
      files.push(meta);
    }
  }

  await walk(absoluteRoot);
  return files;
}

export async function listLocalWorkspaceResources(
  options: LocalWorkspaceResourceOptions = {},
): Promise<LocalWorkspaceResourceMeta[]> {
  const workspaceRoot = await resolveLocalWorkspaceRoot(options);
  if (!workspaceRoot) return [];

  const seenPaths = new Set<string>();
  const resources: LocalWorkspaceResourceMeta[] = [];
  for (const resourcePath of LOCAL_WORKSPACE_CONTROL_FILES) {
    const { absolutePath } = localWorkspaceResourceAbsolutePath(
      workspaceRoot,
      resourcePath,
    );
    const meta = await maybeLocalWorkspaceResourceMeta(
      workspaceRoot,
      resourcePath,
      absolutePath,
    );
    if (!meta) continue;
    seenPaths.add(resourcePath);
    resources.push(meta);
  }

  for (const skillRoot of LOCAL_WORKSPACE_SKILL_ROOTS) {
    resources.push(
      ...(await walkLocalWorkspaceSkillRoot(
        workspaceRoot,
        skillRoot,
        seenPaths,
      )),
    );
  }

  return resources.sort((a, b) => a.path.localeCompare(b.path));
}

export async function readLocalWorkspaceResource(
  options: LocalWorkspaceResourceOptions & { path: string },
): Promise<LocalWorkspaceResourceFile | null> {
  const workspaceRoot = await resolveLocalWorkspaceRoot(options);
  if (!workspaceRoot) return null;
  const { resourcePath, absolutePath } = localWorkspaceResourceAbsolutePath(
    workspaceRoot,
    options.path,
    { preferExisting: true },
  );
  if (!isSupportedLocalWorkspaceTextFile(resourcePath)) return null;
  try {
    const { content, stat } = readLocalWorkspaceTextFile(
      workspaceRoot,
      absolutePath,
    );
    return {
      ...localWorkspaceResourceMeta(resourcePath, absolutePath, content, stat),
      content,
    };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

export async function writeLocalWorkspaceResource(
  options: WriteLocalWorkspaceResourceOptions,
): Promise<LocalWorkspaceResourceMeta> {
  const workspaceRoot = await resolveLocalWorkspaceRoot(options);
  if (!workspaceRoot) {
    throw new Error("Local file mode is not enabled");
  }
  const { resourcePath, absolutePath } = localWorkspaceResourceAbsolutePath(
    workspaceRoot,
    options.path,
    { preferExisting: true },
  );
  if (!isSupportedLocalWorkspaceTextFile(resourcePath)) {
    throw new Error(`Local workspace resource "${resourcePath}" is not text`);
  }
  return withWriteLock(absolutePath, async () => {
    const existing = await readLocalWorkspaceResource({
      ...options,
      path: resourcePath,
    });
    if (options.ifNotExists && existing) {
      throw new Error(`File "${resourcePath}" already exists`);
    }
    if (
      options.expectedHash &&
      (!existing || existing.hash !== options.expectedHash)
    ) {
      throw new Error(
        `File "${resourcePath}" changed on disk. Reload before saving again.`,
      );
    }

    assertNoSymlinkAbsolutePathSync(workspaceRoot, absolutePath, {
      allowMissingLeaf: true,
    });
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    const tempPath = path.join(
      path.dirname(absolutePath),
      `.${path.basename(absolutePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
    );
    await fs.writeFile(tempPath, options.content, "utf8");
    await fs.rename(tempPath, absolutePath);
    const stat = await fs.stat(absolutePath);
    return localWorkspaceResourceMeta(
      resourcePath,
      absolutePath,
      options.content,
      stat,
    );
  });
}

export async function deleteLocalWorkspaceResource(
  options: LocalWorkspaceResourceOptions & { path: string },
): Promise<boolean> {
  const workspaceRoot = await resolveLocalWorkspaceRoot(options);
  if (!workspaceRoot) {
    throw new Error("Local file mode is not enabled");
  }
  const absolutePaths = localWorkspaceResourceDeletePaths(
    workspaceRoot,
    options.path,
  );
  let deleted = false;
  for (const absolutePath of absolutePaths) {
    try {
      assertNoSymlinkAbsolutePathSync(workspaceRoot, absolutePath);
      await fs.unlink(absolutePath);
      deleted = true;
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue;
      throw error;
    }
  }
  return deleted;
}
