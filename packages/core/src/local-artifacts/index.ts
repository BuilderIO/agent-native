import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { minimatch } from "minimatch";

export type AgentNativeDataMode = "database" | "local-files";

export interface AgentNativeManifestRoot {
  name?: string;
  path: string;
  kind?: string;
  extensions?: string[];
  include?: string[];
  hide?: string[];
}

export interface AgentNativeManifestApp {
  mode?: AgentNativeDataMode;
  roots?: AgentNativeManifestRoot[];
  components?: string | string[];
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
  roots: AgentNativeManifestRoot[];
  hide?: string[];
  components?: string | string[];
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
  extensions: string[];
  hide: string[];
  include: string[];
}

export interface LoadedLocalArtifactApp {
  appId: string;
  mode: AgentNativeDataMode;
  manifestPath: string | null;
  workspaceRoot: string;
  roots: LoadedLocalArtifactRoot[];
  components: string[];
  hide: string[];
}

export interface LocalArtifactFileMeta {
  path: string;
  rootName: string;
  rootPath: string;
  kind?: string;
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
    roots,
    components:
      typeof value.components === "string" || Array.isArray(value.components)
        ? asStringArray(value.components)
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
    roots:
      manifestApp?.roots && manifestApp.roots.length > 0
        ? manifestApp.roots
        : (defaults?.roots ?? []),
    components: manifestApp?.components ?? defaults?.components,
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
      extensions,
      hide: [...DEFAULT_HIDE_PATTERNS, ...asStringArray(root.hide)],
      include: asStringArray(root.include),
    };
  });

  return {
    appId: options.appId,
    mode,
    manifestPath: loaded?.path ?? null,
    workspaceRoot,
    roots,
    components: asStringArray(app.components),
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

async function fileMetaForPath(
  root: LoadedLocalArtifactRoot,
  artifactPath: string,
  absolutePath: string,
  contentOverride?: string,
): Promise<LocalArtifactFileMeta> {
  const content =
    contentOverride === undefined
      ? await fs.readFile(absolutePath, "utf8")
      : contentOverride;
  const stat = await fs.stat(absolutePath);
  const extension = extensionOf(artifactPath);
  return {
    path: artifactPath,
    rootName: root.name,
    rootPath: root.path,
    kind: root.kind,
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
      const stat = await fs.lstat(candidate);
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
    await assertNoSymlinkPath(root, absolutePath);
    const content = await fs.readFile(absolutePath, "utf8");
    const meta = await fileMetaForPath(root, safePath, absolutePath, content);
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
