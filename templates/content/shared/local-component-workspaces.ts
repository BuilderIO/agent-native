import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export interface LocalComponentWorkspace {
  id: string;
  workspacePath: string;
  componentPaths: string[];
  updatedAt: string;
}

export interface LocalComponentFile {
  workspaceId: string;
  workspacePath: string;
  componentRoot: string;
  path: string;
  absolutePath: string;
  sizeBytes: number;
  updatedAt: string;
}

const STORE_VERSION = 1;
const STORE_DIRECTORY = ".agent-native";
const STORE_FILE_PREFIX = "content-local-components";
const STORE_FILE_EXTENSION = ".json";
const STORE_FILE_NAME = `${STORE_FILE_PREFIX}${STORE_FILE_EXTENSION}`;
const COMPONENT_EXTENSIONS = new Set([".tsx", ".jsx", ".ts", ".js"]);
const COMPONENT_FILE_MAX_BYTES = 512 * 1024;
const ALLOW_PRODUCTION_LOCAL_FILES_ENV =
  "AGENT_NATIVE_ALLOW_LOCAL_FILES_IN_PRODUCTION";
const LOCAL_COMPONENT_ACCESS_ERROR =
  "Local component workspaces are only available in local development or a trusted local file bridge.";
const localComponentWorkspaceWriteQueues = new Map<string, Promise<void>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeSlash(value: string) {
  return value.replace(/\\/g, "/");
}

function stringArraysEqual(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function localComponentWorkspaceId(workspacePath: string) {
  return `workspace-${createHash("sha256")
    .update(path.resolve(workspacePath))
    .digest("base64url")
    .slice(0, 24)}`;
}

function ensureLocalFileAccessAllowed() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env[ALLOW_PRODUCTION_LOCAL_FILES_ENV] !== "true"
  ) {
    throw new Error(LOCAL_COMPONENT_ACCESS_ERROR);
  }
}

export function isLocalComponentAccessError(error: unknown) {
  return (
    error instanceof Error && error.message === LOCAL_COMPONENT_ACCESS_ERROR
  );
}

function scopedStoreFileName(scope?: string | null) {
  const normalizedScope = scope?.trim().toLowerCase();
  if (!normalizedScope) return STORE_FILE_NAME;
  const scopeHash = createHash("sha256")
    .update(normalizedScope)
    .digest("base64url")
    .slice(0, 16);
  return `${STORE_FILE_PREFIX}.${scopeHash}${STORE_FILE_EXTENSION}`;
}

export function localComponentWorkspaceScope(userEmail?: string | null) {
  return userEmail?.trim().toLowerCase() || "local";
}

export function localComponentWorkspaceStoreDir(cwd = process.cwd()) {
  return path.join(cwd, STORE_DIRECTORY);
}

export function localComponentWorkspaceStorePath(
  cwd = process.cwd(),
  scope?: string | null,
) {
  return path.join(
    localComponentWorkspaceStoreDir(cwd),
    scopedStoreFileName(scope),
  );
}

export function isLocalComponentWorkspaceStoreFile(filePath: string) {
  const basename = path.basename(filePath);
  return (
    basename === STORE_FILE_NAME ||
    (basename.startsWith(`${STORE_FILE_PREFIX}.`) &&
      basename.endsWith(STORE_FILE_EXTENSION))
  );
}

function safeRelativePath(value: string, label: string) {
  const normalized = normalizeSlash(
    path.posix.normalize(normalizeSlash(value)),
  );
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("\0") ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`${label} must be a safe relative path.`);
  }
  return normalized;
}

function safeComponentFilePath(value: string) {
  const normalized = safeRelativePath(value, "Component file path");
  if (!COMPONENT_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase())) {
    throw new Error("Component files must be .tsx, .jsx, .ts, or .js.");
  }
  return normalized;
}

function resolveInside(root: string, candidate: string) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, candidate);
  const relative = path.relative(resolvedRoot, resolved);
  if (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    return resolved;
  }
  throw new Error("Path escaped the registered component workspace.");
}

function resolveUsableDirectory(value: string, label: string) {
  const resolved = path.resolve(value);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be an existing non-symlink directory.`);
  }
  return fs.realpathSync(resolved);
}

export function resolveLocalComponentWorkspacePath(workspacePath: string) {
  const resolved = path.resolve(workspacePath);
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error("Workspace must be an existing directory.");
  }
  return fs.realpathSync(resolved);
}

function componentPathsFromManifest(workspacePath: string) {
  const manifestPath = path.join(workspacePath, "agent-native.json");
  let manifest: unknown;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return ["components"];
  }

  const app = isRecord(manifest)
    ? isRecord(manifest.apps)
      ? manifest.apps.content
      : undefined
    : undefined;
  const components = isRecord(app) ? app.components : undefined;
  const values =
    typeof components === "string"
      ? [components]
      : Array.isArray(components)
        ? components.filter((item): item is string => typeof item === "string")
        : ["components"];
  return values.length > 0
    ? values.map((item) => safeRelativePath(item, "components path"))
    : ["components"];
}

function normalizeStoredWorkspace(
  value: unknown,
): LocalComponentWorkspace | null {
  if (!isRecord(value)) return null;
  const workspacePath =
    typeof value.workspacePath === "string" ? value.workspacePath : "";
  if (!workspacePath) return null;
  let resolvedWorkspace: string;
  try {
    resolvedWorkspace = resolveUsableDirectory(workspacePath, "Workspace");
  } catch {
    return null;
  }

  const storedComponentPaths = Array.isArray(value.componentPaths)
    ? value.componentPaths
        .filter((item): item is string => typeof item === "string")
        .map((item) => safeRelativePath(item, "components path"))
    : [];
  const componentPaths =
    storedComponentPaths.length > 0
      ? storedComponentPaths
      : componentPathsFromManifest(resolvedWorkspace);
  return {
    id:
      typeof value.id === "string" && value.id
        ? value.id
        : localComponentWorkspaceId(resolvedWorkspace),
    workspacePath: resolvedWorkspace,
    componentPaths,
    updatedAt:
      typeof value.updatedAt === "string"
        ? value.updatedAt
        : new Date().toISOString(),
  };
}

export function readLocalComponentWorkspacesSync(
  cwd = process.cwd(),
  scope?: string | null,
): LocalComponentWorkspace[] {
  ensureLocalFileAccessAllowed();
  const storePath = localComponentWorkspaceStorePath(cwd, scope);
  return readLocalComponentWorkspacesFromStorePath(storePath);
}

function readLocalComponentWorkspacesFromStorePath(
  storePath: string,
): LocalComponentWorkspace[] {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(storePath, "utf8"));
  } catch {
    return [];
  }
  const workspaces =
    isRecord(raw) && Array.isArray(raw.workspaces) ? raw.workspaces : [];
  return workspaces
    .map(normalizeStoredWorkspace)
    .filter((item): item is LocalComponentWorkspace => Boolean(item));
}

export function readAllLocalComponentWorkspacesSync(cwd = process.cwd()) {
  ensureLocalFileAccessAllowed();
  const storeDir = localComponentWorkspaceStoreDir(cwd);
  let entries: string[];
  try {
    entries = fs.readdirSync(storeDir);
  } catch {
    return [];
  }
  const workspaces = entries
    .filter((entry) => isLocalComponentWorkspaceStoreFile(entry))
    .flatMap((entry) =>
      readLocalComponentWorkspacesFromStorePath(path.join(storeDir, entry)),
    );
  const deduped = new Map<string, LocalComponentWorkspace>();
  for (const workspace of workspaces) deduped.set(workspace.id, workspace);
  return [...deduped.values()];
}

async function writeLocalComponentWorkspacesToStorePath(
  workspaces: LocalComponentWorkspace[],
  storePath: string,
) {
  await fsp.mkdir(path.dirname(storePath), { recursive: true });
  await fsp.writeFile(
    storePath,
    `${JSON.stringify({ version: STORE_VERSION, workspaces }, null, 2)}\n`,
    "utf8",
  );
}

async function updateLocalComponentWorkspaces(options: {
  cwd?: string;
  scope?: string | null;
  update: (
    workspaces: LocalComponentWorkspace[],
  ) => LocalComponentWorkspace[] | null;
}) {
  ensureLocalFileAccessAllowed();
  const storePath = localComponentWorkspaceStorePath(
    options.cwd,
    options.scope,
  );
  const previous =
    localComponentWorkspaceWriteQueues.get(storePath) ?? Promise.resolve();
  let nextWorkspaces: LocalComponentWorkspace[] = [];
  const queued = previous.then(async () => {
    const current = readLocalComponentWorkspacesFromStorePath(storePath);
    const updated = options.update(current);
    if (!updated) {
      nextWorkspaces = current;
      return;
    }
    nextWorkspaces = updated;
    await writeLocalComponentWorkspacesToStorePath(nextWorkspaces, storePath);
  });
  const stored = queued
    .catch(() => undefined)
    .finally(() => {
      if (localComponentWorkspaceWriteQueues.get(storePath) === stored) {
        localComponentWorkspaceWriteQueues.delete(storePath);
      }
    });
  localComponentWorkspaceWriteQueues.set(storePath, stored);
  await queued;
  return nextWorkspaces;
}

export async function registerLocalComponentWorkspace(options: {
  workspacePath: string;
  cwd?: string;
  scope?: string | null;
}): Promise<{
  workspace: LocalComponentWorkspace;
  componentDirs: string[];
}> {
  ensureLocalFileAccessAllowed();
  const workspacePath = resolveUsableDirectory(
    options.workspacePath,
    "Workspace",
  );
  const componentPaths = componentPathsFromManifest(workspacePath);
  const workspace: LocalComponentWorkspace = {
    id: localComponentWorkspaceId(workspacePath),
    workspacePath,
    componentPaths,
    updatedAt: new Date().toISOString(),
  };
  let registeredWorkspace = workspace;
  await updateLocalComponentWorkspaces({
    cwd: options.cwd,
    scope: options.scope,
    update: (current) => {
      const existing = current.find((item) => item.id === workspace.id);
      if (
        existing &&
        existing.workspacePath === workspace.workspacePath &&
        stringArraysEqual(existing.componentPaths, workspace.componentPaths)
      ) {
        registeredWorkspace = existing;
        return null;
      }
      return [workspace, ...current.filter((item) => item.id !== workspace.id)];
    },
  });
  return {
    workspace: registeredWorkspace,
    componentDirs: componentDirsForWorkspace(registeredWorkspace),
  };
}

export function componentRootsForWorkspace(workspace: LocalComponentWorkspace) {
  return workspace.componentPaths
    .map((componentPath) =>
      resolveInside(workspace.workspacePath, componentPath),
    )
    .map((componentRoot) =>
      safeComponentRootForWorkspace(workspace.workspacePath, componentRoot),
    )
    .filter((componentRoot): componentRoot is string => Boolean(componentRoot));
}

export function componentDirsForWorkspace(workspace: LocalComponentWorkspace) {
  return componentRootsForWorkspace(workspace).filter((componentDir) => {
    try {
      const stat = fs.lstatSync(componentDir);
      return !stat.isSymbolicLink() && stat.isDirectory();
    } catch {
      return false;
    }
  });
}

function firstComponentRootForWorkspace(workspace: LocalComponentWorkspace) {
  const componentRoot = componentRootsForWorkspace(workspace)[0];
  if (!componentRoot) {
    throw new Error("Registered workspace does not have a component root.");
  }
  return componentRoot;
}

function componentRootForWrite(
  workspace: LocalComponentWorkspace,
  filePath: string,
  requestedComponentRoot?: string | null,
) {
  const componentRoots = componentRootsForWorkspace(workspace);
  if (requestedComponentRoot?.trim()) {
    const resolvedRequestedRoot = path.resolve(requestedComponentRoot);
    const matchingRoot = componentRoots.find(
      (componentRoot) => path.resolve(componentRoot) === resolvedRequestedRoot,
    );
    if (!matchingRoot) {
      throw new Error("Target component root is not registered for workspace.");
    }
    return matchingRoot;
  }

  for (const componentRoot of componentRoots) {
    const absolutePath = resolveInside(componentRoot, filePath);
    try {
      const stat = fs.lstatSync(absolutePath);
      if (stat.isFile() && !stat.isSymbolicLink()) return componentRoot;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  return (
    componentDirsForWorkspace(workspace)[0] ??
    firstComponentRootForWorkspace(workspace)
  );
}

function safeComponentRootForWorkspace(
  workspacePath: string,
  componentRoot: string,
) {
  const resolvedRoot = resolveInside(workspacePath, ".");
  const resolvedComponentRoot = resolveInside(resolvedRoot, componentRoot);
  try {
    return validateSafeDirectoryPathSync(resolvedRoot, resolvedComponentRoot, {
      allowMissing: true,
    });
  } catch {
    return null;
  }
}

function validateSafeDirectoryPathSync(
  root: string,
  directory: string,
  { allowMissing = false }: { allowMissing?: boolean } = {},
) {
  const resolvedRoot = path.resolve(root);
  const resolvedDirectory = resolveInside(resolvedRoot, directory);
  const rootStat = fs.lstatSync(resolvedRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(
      "Component workspace root must be a non-symlink directory.",
    );
  }
  const realRoot = fs.realpathSync(resolvedRoot);
  const relativePath = path.relative(resolvedRoot, resolvedDirectory);
  const segments = relativePath
    ? relativePath.split(path.sep).filter(Boolean)
    : [];
  let current = resolvedRoot;
  for (const segment of segments) {
    current = path.join(current, segment);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") {
        return resolvedDirectory;
      }
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("Component paths must not contain symlinks.");
    }
  }
  const realDirectory = fs.realpathSync(resolvedDirectory);
  const realRelativePath = path.relative(realRoot, realDirectory);
  if (realRelativePath.startsWith("..") || path.isAbsolute(realRelativePath)) {
    throw new Error("Component path escaped the registered workspace.");
  }
  return realDirectory;
}

async function ensureSafeDirectoryPath(root: string, directory: string) {
  const resolvedRoot = path.resolve(root);
  const resolvedDirectory = resolveInside(resolvedRoot, directory);
  const rootStat = await fsp.lstat(resolvedRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("Component root must be a non-symlink directory.");
  }

  const relativePath = path.relative(resolvedRoot, resolvedDirectory);
  const segments = relativePath
    ? relativePath.split(path.sep).filter(Boolean)
    : [];
  let current = resolvedRoot;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const stat = await fsp.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error("Component paths must not contain symlinks.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await fsp.mkdir(current);
      const stat = await fsp.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error("Component paths must not contain symlinks.");
      }
    }
  }
  const realRoot = await fsp.realpath(resolvedRoot);
  const realDirectory = await fsp.realpath(resolvedDirectory);
  const realRelativePath = path.relative(realRoot, realDirectory);
  if (realRelativePath.startsWith("..") || path.isAbsolute(realRelativePath)) {
    throw new Error("Component path escaped the registered workspace.");
  }
}

export function registeredLocalComponentDirsSync(cwd = process.cwd()) {
  return readAllLocalComponentWorkspacesSync(cwd).flatMap(
    componentDirsForWorkspace,
  );
}

export function registeredLocalComponentRootsSync(cwd = process.cwd()) {
  return readAllLocalComponentWorkspacesSync(cwd).flatMap(
    componentRootsForWorkspace,
  );
}

export async function listLocalComponentFiles(
  options: {
    cwd?: string;
    scope?: string | null;
    workspaces?: LocalComponentWorkspace[];
  } = {},
): Promise<LocalComponentFile[]> {
  ensureLocalFileAccessAllowed();
  const workspaces =
    options.workspaces ??
    readLocalComponentWorkspacesSync(options.cwd, options.scope);
  const files: LocalComponentFile[] = [];
  for (const workspace of workspaces) {
    for (const componentRoot of componentDirsForWorkspace(workspace)) {
      await collectComponentFiles(
        workspace,
        componentRoot,
        componentRoot,
        files,
      );
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function collectComponentFiles(
  workspace: LocalComponentWorkspace,
  componentRoot: string,
  directory: string,
  files: LocalComponentFile[],
  prefix = "",
) {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = resolveInside(componentRoot, relativePath);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "build"].includes(entry.name)) continue;
      await collectComponentFiles(
        workspace,
        componentRoot,
        absolutePath,
        files,
        relativePath,
      );
      continue;
    }
    if (
      !entry.isFile() ||
      !COMPONENT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    ) {
      continue;
    }
    const stat = await fsp.stat(absolutePath);
    if (stat.size > COMPONENT_FILE_MAX_BYTES) continue;
    files.push({
      workspaceId: workspace.id,
      workspacePath: workspace.workspacePath,
      componentRoot,
      path: relativePath,
      absolutePath,
      sizeBytes: stat.size,
      updatedAt: stat.mtime.toISOString(),
    });
  }
}

export async function writeLocalComponentFile(options: {
  workspaceId: string;
  filePath: string;
  componentRoot?: string | null;
  content: string;
  cwd?: string;
  scope?: string | null;
  workspaces?: LocalComponentWorkspace[];
}) {
  ensureLocalFileAccessAllowed();
  if (Buffer.byteLength(options.content, "utf8") > COMPONENT_FILE_MAX_BYTES) {
    throw new Error("Component file content is larger than 512 KB.");
  }
  const workspaces =
    options.workspaces ??
    readLocalComponentWorkspacesSync(options.cwd, options.scope);
  const workspace = workspaces.find((item) => item.id === options.workspaceId);
  if (!workspace) throw new Error("Registered component workspace not found.");
  const filePath = safeComponentFilePath(options.filePath);
  const componentRoot = componentRootForWrite(
    workspace,
    filePath,
    options.componentRoot,
  );
  const absolutePath = resolveInside(componentRoot, filePath);
  await ensureSafeDirectoryPath(workspace.workspacePath, componentRoot);
  await ensureSafeDirectoryPath(componentRoot, path.dirname(absolutePath));
  try {
    const stat = await fsp.lstat(absolutePath);
    if (stat.isSymbolicLink()) {
      throw new Error("Cannot write through symlinked component files.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await fsp.writeFile(absolutePath, options.content, "utf8");
  return {
    workspaceId: workspace.id,
    workspacePath: workspace.workspacePath,
    componentRoot,
    path: filePath,
    absolutePath,
  };
}
