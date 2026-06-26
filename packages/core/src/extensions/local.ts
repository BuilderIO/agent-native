import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import {
  loadAgentNativeManifest,
  resolveAgentNativeDataMode,
  type AgentNativeManifestApp,
  type LoadAgentNativeManifestOptions,
} from "../local-artifacts/index.js";
import type { ExtensionRow } from "./store.js";

export interface LocalExtensionPermissions {
  appActions: string[];
  extensionData: boolean;
  sql: boolean;
  externalFetch: boolean;
}

export interface LocalExtensionSource {
  mode: "local-files";
  appId: string;
  rootPath: string;
  extensionPath: string;
  manifestPath: string;
  entryPath: string;
  permissions: LocalExtensionPermissions;
  slots: string[];
}

export interface LocalExtensionRow extends ExtensionRow {
  source: LocalExtensionSource;
}

interface LocalExtensionManifest {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  icon?: unknown;
  entry?: unknown;
  main?: unknown;
  slots?: unknown;
  slot?: unknown;
  permissions?: unknown;
}

const LOCAL_EXTENSION_ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;

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
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`${label} must be a safe relative path`);
  }
  return normalized;
}

function resolveInside(basePath: string, relativePath: string, label: string) {
  const safePath = normalizeRelativePath(relativePath, label);
  const absolutePath = path.resolve(basePath, safePath);
  const relative = path.relative(basePath, absolutePath);
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${label} "${relativePath}" is outside the workspace`);
  }
  return { safePath, absolutePath };
}

function noFollowOpenFlags(): number {
  return fsSync.constants.O_RDONLY | (fsSync.constants.O_NOFOLLOW ?? 0);
}

function assertNoSymlinkPathSync(rootPath: string, absolutePath: string): void {
  const relative = path.relative(rootPath, absolutePath);
  const segments = relative.split(path.sep).filter(Boolean);
  let current = rootPath;
  const pathsToCheck = [
    current,
    ...segments.map((segment) => {
      current = path.join(current, segment);
      return current;
    }),
  ];

  for (const candidate of pathsToCheck) {
    const stat = fsSync.lstatSync(candidate);
    if (stat.isSymbolicLink()) {
      throw new Error(`Path "${candidate}" must not traverse a symlink`);
    }
  }
}

function readTextFileWithoutSymlink(rootPath: string, filePath: string) {
  assertNoSymlinkPathSync(rootPath, filePath);
  const fd = fsSync.openSync(filePath, noFollowOpenFlags());
  try {
    return {
      content: fsSync.readFileSync(fd, "utf8"),
      stat: fsSync.fstatSync(fd),
    };
  } finally {
    fsSync.closeSync(fd);
  }
}

function normalizeExtensionId(rawId: string, manifestPath: string): string {
  const id = rawId.trim();
  if (!LOCAL_EXTENSION_ID_RE.test(id)) {
    throw new Error(
      `Local extension id in ${manifestPath} must match ${LOCAL_EXTENSION_ID_RE}`,
    );
  }
  return id;
}

function titleFromId(id: string): string {
  return (
    id
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase()) || id
  );
}

function normalizeActionPermission(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === "*") return "*";
  if (/^[A-Za-z0-9_.:-]+$/.test(trimmed)) return trimmed;
  return null;
}

function normalizePermissions(value: unknown): LocalExtensionPermissions {
  const permissions: LocalExtensionPermissions = {
    appActions: [],
    extensionData: true,
    sql: false,
    externalFetch: false,
  };
  const appActions = new Set<string>();

  const addAction = (action: string) => {
    const normalized = normalizeActionPermission(action);
    if (normalized) appActions.add(normalized);
  };

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== "string") continue;
      if (item === "extensionData" || item === "storage") {
        permissions.extensionData = true;
        continue;
      }
      if (item === "sql" || item === "dbQuery" || item === "dbExec") {
        permissions.sql = true;
        continue;
      }
      if (item === "externalFetch" || item === "extensionFetch") {
        permissions.externalFetch = true;
        continue;
      }
      const actionMatch = item.match(/^(?:appAction|action):(.+)$/);
      if (actionMatch?.[1]) addAction(actionMatch[1]);
    }
  } else if (isRecord(value)) {
    const rawActions =
      value.appActions === "*" || value.actions === "*"
        ? ["*"]
        : [...asStringArray(value.appActions), ...asStringArray(value.actions)];
    for (const action of rawActions) addAction(action);
    if (typeof value.extensionData === "boolean") {
      permissions.extensionData = value.extensionData;
    }
    if (typeof value.storage === "boolean") {
      permissions.extensionData = value.storage;
    }
    if (typeof value.sql === "boolean") permissions.sql = value.sql;
    if (typeof value.externalFetch === "boolean") {
      permissions.externalFetch = value.externalFetch;
    }
    if (typeof value.extensionFetch === "boolean") {
      permissions.externalFetch = value.extensionFetch;
    }
  }

  permissions.appActions = [...appActions].sort();
  return permissions;
}

function manifestAppExtensions(app: AgentNativeManifestApp): string[] {
  return asStringArray(app.extensions);
}

function readJsonFile(
  rootPath: string,
  filePath: string,
): { value: unknown; stat: fsSync.Stats } | null {
  try {
    const { content, stat } = readTextFileWithoutSymlink(rootPath, filePath);
    return { value: JSON.parse(content) as unknown, stat };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

async function readLocalExtensionFolder(options: {
  appId: string;
  workspaceRoot: string;
  rootPath: string;
  rootAbsolutePath: string;
  folderName: string;
}): Promise<LocalExtensionRow | null> {
  const extensionAbsolutePath = path.join(
    options.rootAbsolutePath,
    options.folderName,
  );
  const extensionRelativePath = normalizeSlash(
    path.relative(options.workspaceRoot, extensionAbsolutePath),
  );
  const manifestAbsolutePath = path.join(
    extensionAbsolutePath,
    "extension.json",
  );
  const manifestRead = readJsonFile(
    extensionAbsolutePath,
    manifestAbsolutePath,
  );
  if (!manifestRead) return null;
  const rawManifest = manifestRead.value;
  if (!isRecord(rawManifest)) {
    throw new Error(
      `Local extension manifest must be an object: ${manifestAbsolutePath}`,
    );
  }
  const manifest = rawManifest as LocalExtensionManifest;
  const manifestRelativePath = normalizeSlash(
    path.relative(options.workspaceRoot, manifestAbsolutePath),
  );
  const id = normalizeExtensionId(
    typeof manifest.id === "string" ? manifest.id : options.folderName,
    manifestAbsolutePath,
  );
  const entry = String(
    typeof manifest.entry === "string"
      ? manifest.entry
      : typeof manifest.main === "string"
        ? manifest.main
        : "index.html",
  );
  const { safePath: entrySafePath, absolutePath: entryAbsolutePath } =
    resolveInside(extensionAbsolutePath, entry, "entry");
  const { content, stat: entryStat } = readTextFileWithoutSymlink(
    extensionAbsolutePath,
    entryAbsolutePath,
  );
  const manifestStat = manifestRead.stat;
  const updatedAt = new Date(
    Math.max(manifestStat.mtimeMs, entryStat.mtimeMs),
  ).toISOString();
  const createdAt = new Date(
    Math.min(manifestStat.birthtimeMs, entryStat.birthtimeMs),
  ).toISOString();
  const slots = [
    ...new Set([
      ...asStringArray(manifest.slots),
      ...asStringArray(manifest.slot),
    ]),
  ].sort();
  const permissions = normalizePermissions(manifest.permissions);
  const name =
    typeof manifest.name === "string" && manifest.name.trim()
      ? manifest.name.trim()
      : titleFromId(id);

  return {
    id,
    name,
    description:
      typeof manifest.description === "string" ? manifest.description : "",
    content,
    icon: typeof manifest.icon === "string" ? manifest.icon : null,
    createdAt,
    updatedAt,
    hiddenAt: null,
    hiddenBy: null,
    ownerEmail: "local-files",
    orgId: null,
    visibility: "private",
    source: {
      mode: "local-files",
      appId: options.appId,
      rootPath: options.rootPath,
      extensionPath: extensionRelativePath,
      manifestPath: manifestRelativePath,
      entryPath: normalizeSlash(
        path.posix.join(extensionRelativePath, entrySafePath),
      ),
      permissions,
      slots,
    },
  };
}

async function listLocalExtensionsForRoot(options: {
  appId: string;
  workspaceRoot: string;
  rootPath: string;
  rootAbsolutePath: string;
}): Promise<LocalExtensionRow[]> {
  let rootStat;
  try {
    rootStat = await fs.lstat(options.rootAbsolutePath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return [];

  const entries = await fs.readdir(options.rootAbsolutePath, {
    withFileTypes: true,
  });
  const rows: LocalExtensionRow[] = [];
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      entry.name.startsWith(".")
    ) {
      continue;
    }
    const row = await readLocalExtensionFolder({
      appId: options.appId,
      workspaceRoot: options.workspaceRoot,
      rootPath: options.rootPath,
      rootAbsolutePath: options.rootAbsolutePath,
      folderName: entry.name,
    });
    if (row) rows.push(row);
  }
  return rows;
}

export async function listLocalExtensions(
  options: LoadAgentNativeManifestOptions = {},
): Promise<LocalExtensionRow[]> {
  const loaded = await loadAgentNativeManifest({ ...options, optional: true });
  if (!loaded) return [];

  const rows: LocalExtensionRow[] = [];
  const seenIds = new Map<string, string>();
  for (const [appId, app] of Object.entries(loaded.manifest.apps ?? {})) {
    const extensionRoots = manifestAppExtensions(app);
    if (extensionRoots.length === 0) continue;
    const mode = await resolveAgentNativeDataMode({
      ...options,
      manifestPath: loaded.path,
      appId,
      defaults: { mode: app.mode },
    });
    if (mode !== "local-files") continue;

    for (const root of extensionRoots) {
      const { safePath, absolutePath } = resolveInside(
        loaded.rootDir,
        root,
        "extensions",
      );
      rows.push(
        ...(await listLocalExtensionsForRoot({
          appId,
          workspaceRoot: loaded.rootDir,
          rootPath: safePath,
          rootAbsolutePath: absolutePath,
        })),
      );
    }
  }

  for (const row of rows) {
    const existingPath = seenIds.get(row.id);
    if (existingPath) {
      throw new Error(
        `Duplicate local extension id "${row.id}" in ${existingPath} and ${row.source.manifestPath}`,
      );
    }
    seenIds.set(row.id, row.source.manifestPath);
  }

  return rows.sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
}

export async function getLocalExtension(
  id: string,
  options: LoadAgentNativeManifestOptions = {},
): Promise<LocalExtensionRow | null> {
  const rows = await listLocalExtensions(options);
  return rows.find((row) => row.id === id) ?? null;
}

export function isLocalExtensionRow(
  row: ExtensionRow | LocalExtensionRow | null | undefined,
): row is LocalExtensionRow {
  return (
    isRecord(row) && isRecord(row.source) && row.source.mode === "local-files"
  );
}

export function localExtensionSourceSummary(row: LocalExtensionRow) {
  return {
    mode: row.source.mode,
    appId: row.source.appId,
    rootPath: row.source.rootPath,
    extensionPath: row.source.extensionPath,
    manifestPath: row.source.manifestPath,
    entryPath: row.source.entryPath,
    slots: row.source.slots,
    permissions: row.source.permissions,
  };
}
