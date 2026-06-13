import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

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
const STORE_RELATIVE_PATH = path.join(
  ".agent-native",
  "content-local-components.json",
);
const COMPONENT_EXTENSIONS = new Set([".tsx", ".jsx", ".ts", ".js"]);
const COMPONENT_FILE_MAX_BYTES = 512 * 1024;
const ALLOW_PRODUCTION_LOCAL_FILES_ENV =
  "AGENT_NATIVE_ALLOW_LOCAL_FILES_IN_PRODUCTION";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeSlash(value: string) {
  return value.replace(/\\/g, "/");
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
    throw new Error(
      "Local component workspaces are only available in local development or a trusted local file bridge.",
    );
  }
}

export function localComponentWorkspaceStorePath(cwd = process.cwd()) {
  return path.join(cwd, STORE_RELATIVE_PATH);
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
  return resolved;
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
): LocalComponentWorkspace[] {
  ensureLocalFileAccessAllowed();
  const storePath = localComponentWorkspaceStorePath(cwd);
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

async function writeLocalComponentWorkspaces(
  workspaces: LocalComponentWorkspace[],
  cwd = process.cwd(),
) {
  ensureLocalFileAccessAllowed();
  const storePath = localComponentWorkspaceStorePath(cwd);
  await fsp.mkdir(path.dirname(storePath), { recursive: true });
  await fsp.writeFile(
    storePath,
    `${JSON.stringify({ version: STORE_VERSION, workspaces }, null, 2)}\n`,
    "utf8",
  );
}

export async function registerLocalComponentWorkspace(options: {
  workspacePath: string;
  cwd?: string;
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
  const current = readLocalComponentWorkspacesSync(options.cwd);
  const next = [
    workspace,
    ...current.filter((item) => item.id !== workspace.id),
  ];
  await writeLocalComponentWorkspaces(next, options.cwd);
  return {
    workspace,
    componentDirs: componentDirsForWorkspace(workspace),
  };
}

export function componentRootsForWorkspace(workspace: LocalComponentWorkspace) {
  return workspace.componentPaths
    .map((componentPath) =>
      resolveInside(workspace.workspacePath, componentPath),
    )
    .map((componentRoot) => path.resolve(componentRoot));
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

export function registeredLocalComponentDirsSync(cwd = process.cwd()) {
  return readLocalComponentWorkspacesSync(cwd).flatMap(
    componentDirsForWorkspace,
  );
}

export function registeredLocalComponentRootsSync(cwd = process.cwd()) {
  return readLocalComponentWorkspacesSync(cwd).flatMap(
    componentRootsForWorkspace,
  );
}

export async function listLocalComponentFiles(
  options: {
    cwd?: string;
    workspaces?: LocalComponentWorkspace[];
  } = {},
): Promise<LocalComponentFile[]> {
  ensureLocalFileAccessAllowed();
  const workspaces =
    options.workspaces ?? readLocalComponentWorkspacesSync(options.cwd);
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
  content: string;
  cwd?: string;
  workspaces?: LocalComponentWorkspace[];
}) {
  ensureLocalFileAccessAllowed();
  if (Buffer.byteLength(options.content, "utf8") > COMPONENT_FILE_MAX_BYTES) {
    throw new Error("Component file content is larger than 512 KB.");
  }
  const workspaces =
    options.workspaces ?? readLocalComponentWorkspacesSync(options.cwd);
  const workspace = workspaces.find((item) => item.id === options.workspaceId);
  if (!workspace) throw new Error("Registered component workspace not found.");
  const componentRoot =
    componentDirsForWorkspace(workspace)[0] ??
    firstComponentRootForWorkspace(workspace);
  await fsp.mkdir(componentRoot, { recursive: true });
  const rootStat = await fsp.lstat(componentRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("Component root must be a non-symlink directory.");
  }
  const filePath = safeComponentFilePath(options.filePath);
  const absolutePath = resolveInside(componentRoot, filePath);
  await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
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
