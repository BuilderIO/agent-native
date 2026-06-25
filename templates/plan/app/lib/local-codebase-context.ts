import { agentNativePath } from "@agent-native/core/client";

import { collectLocalControlResourceFiles } from "./local-control-resources";

type PermissionState = "granted" | "denied" | "prompt";

type LocalFileHandle = {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
};

type LocalDirectoryHandle = {
  kind: "directory";
  name: string;
  values(): AsyncIterable<LocalFileHandle | LocalDirectoryHandle>;
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<LocalDirectoryHandle>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<LocalFileHandle>;
  queryPermission?(descriptor: { mode: "read" }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: "read" }): Promise<PermissionState>;
  isSameEntry?(other: LocalDirectoryHandle): Promise<boolean>;
};

type WindowWithDirectoryPicker = Window & {
  showDirectoryPicker?: (options?: {
    mode?: "read" | "readwrite";
  }) => Promise<LocalDirectoryHandle>;
};

type PersistedLocalCodebase = {
  id: string;
  name: string;
  handle: LocalDirectoryHandle;
  updatedAt?: string;
  latest?: LocalCodebaseSummary;
};

type ResourceMeta = {
  id: string;
  path: string;
  metadata?: Record<string, unknown> | string | null;
};

type InternalCodebaseCandidate = {
  path: string;
  size: number;
  handle: LocalFileHandle;
  priority: number;
};

export type LocalCodebaseFileEntry = {
  path: string;
  size: number;
  captured: boolean;
  resourcePath?: string;
  skippedReason?: string;
};

export type LocalCodebaseSummary = {
  id: string;
  name: string;
  resourcePrefix: string;
  snapshotPrefix: string;
  instructionPath: string;
  latestPath: string;
  indexPath: string;
  treePath: string;
  indexedFileCount: number;
  capturedFileCount: number;
  skippedFileCount: number;
  totalCapturedBytes: number;
  updatedAt: string;
};

export type LocalCodebaseSnapshot = LocalCodebaseSummary & {
  files: LocalCodebaseFileEntry[];
  capturedFiles: Array<{
    path: string;
    resourcePath: string;
    content: string;
    mimeType: string;
    size: number;
  }>;
  controlResources: Record<string, string>;
};

export type LocalCodebasePickerResult =
  | {
      ok: true;
      handle: LocalDirectoryHandle;
      id: string;
      name: string;
    }
  | {
      ok: false;
      canceled?: boolean;
      error: string;
    };

const LOCAL_CODEBASE_DB_NAME = "plan-local-codebases";
const LOCAL_CODEBASE_DB_VERSION = 1;
const LOCAL_CODEBASE_STORE_NAME = "handles";
const SELECTED_CODEBASE_KEY = "selected-codebase";

const MAX_INDEXED_FILES = 2_500;
const MAX_CAPTURED_FILES = 140;
const MAX_CAPTURED_BYTES = 1_000_000;
const MAX_FILE_BYTES = 160_000;
const LOCAL_CODEBASE_RESOURCE_SOURCE = "local-codebase-folder";

const IGNORED_DIRECTORIES = new Set([
  ".cache",
  ".git",
  ".hg",
  ".next",
  ".nuxt",
  ".output",
  ".parcel-cache",
  ".pnpm-store",
  ".react-router",
  ".svelte-kit",
  ".turbo",
  ".vercel",
  ".vite",
  ".yarn",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

const SENSITIVE_FILE_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  ".npmrc",
  ".netrc",
  ".pypirc",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
]);

const SENSITIVE_EXTENSIONS = new Set([
  ".cer",
  ".crt",
  ".der",
  ".key",
  ".p12",
  ".pem",
  ".pfx",
]);

const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cjs",
  ".clj",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".dart",
  ".diff",
  ".Dockerfile",
  ".erl",
  ".ex",
  ".exs",
  ".go",
  ".graphql",
  ".gql",
  ".h",
  ".hpp",
  ".htm",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".less",
  ".lua",
  ".md",
  ".mdx",
  ".mjs",
  ".php",
  ".proto",
  ".py",
  ".rb",
  ".rs",
  ".sass",
  ".scala",
  ".scss",
  ".sh",
  ".sql",
  ".svelte",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
  ".zig",
]);

const EXTENSION_MIME_MAP: Record<string, string> = {
  ".css": "text/css",
  ".csv": "text/csv",
  ".graphql": "text/graphql",
  ".gql": "text/graphql",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".jsx": "text/javascript",
  ".md": "text/markdown",
  ".mdx": "text/markdown",
  ".mjs": "text/javascript",
  ".py": "text/x-python",
  ".sh": "text/x-shellscript",
  ".sql": "text/sql",
  ".toml": "text/toml",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".txt": "text/plain",
  ".xml": "application/xml",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
};

const TEXT_BASENAMES = new Set([
  ".gitignore",
  ".mcp.json",
  "AGENTS.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "Dockerfile",
  "Gemfile",
  "LICENSE",
  "Makefile",
  "README",
  "README.md",
  "agent-native.json",
  "components.json",
  "go.mod",
  "go.sum",
  "mcp.config.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "pyproject.toml",
  "requirements.txt",
  "tsconfig.json",
  "vite.config.ts",
]);

function supportsDirectoryPersistence() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

export function supportsLocalCodebasePicker() {
  return (
    typeof window !== "undefined" &&
    typeof (window as WindowWithDirectoryPicker).showDirectoryPicker ===
      "function"
  );
}

function openLocalCodebaseDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(
      LOCAL_CODEBASE_DB_NAME,
      LOCAL_CODEBASE_DB_VERSION,
    );
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LOCAL_CODEBASE_STORE_NAME)) {
        db.createObjectStore(LOCAL_CODEBASE_STORE_NAME);
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function slugifyResourceSegment(value: string) {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "codebase";
}

function newCodebaseId(name: string) {
  return `${slugifyResourceSegment(name)}-${crypto.randomUUID().slice(0, 8)}`;
}

function normalizeLocalPath(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/");
  if (
    !normalized ||
    normalized.includes("\0") ||
    /[\u0000-\u001f]/.test(normalized) ||
    parts.some((part) => !part || part === "." || part === "..")
  ) {
    return null;
  }
  return parts.join("/");
}

function basenameForPath(path: string) {
  return path.split("/").pop() ?? path;
}

function extensionForPath(path: string) {
  const basename = basenameForPath(path);
  const dot = basename.lastIndexOf(".");
  return dot === -1 ? "" : basename.slice(dot);
}

export function isIgnoredCodebaseDirectory(name: string) {
  return IGNORED_DIRECTORIES.has(name);
}

export function isSensitiveCodebasePath(path: string) {
  const parts = path.split("/");
  const basename = parts[parts.length - 1] ?? path;
  const lower = basename.toLowerCase();
  if (SENSITIVE_FILE_NAMES.has(basename) || SENSITIVE_FILE_NAMES.has(lower)) {
    return true;
  }
  if (/^\.env[.\w-]*$/i.test(basename)) return true;
  if (SENSITIVE_EXTENSIONS.has(extensionForPath(path).toLowerCase())) {
    return true;
  }
  return parts.some((part) =>
    /(^|[-_.])(secret|secrets|credential|credentials|private-key)([-_.]|$)/i.test(
      part,
    ),
  );
}

export function isCodebaseTextPath(path: string) {
  const basename = basenameForPath(path);
  if (TEXT_BASENAMES.has(basename)) return true;
  const ext = extensionForPath(path);
  return TEXT_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(ext.toLowerCase());
}

function mimeTypeForPath(path: string) {
  return (
    EXTENSION_MIME_MAP[extensionForPath(path).toLowerCase()] ?? "text/plain"
  );
}

function priorityForPath(path: string) {
  const lower = path.toLowerCase();
  const basename = basenameForPath(path);
  let priority = 10;

  if (
    basename === "AGENTS.md" ||
    basename === "README.md" ||
    basename === "package.json" ||
    basename === "agent-native.json"
  ) {
    priority += 90;
  }
  if (
    lower.includes("/actions/") ||
    lower.includes("/api/") ||
    lower.includes("/routes/") ||
    lower.includes("/server/") ||
    lower.includes("/schemas/") ||
    lower.includes("/schema.")
  ) {
    priority += 75;
  }
  if (
    lower.includes("openapi") ||
    lower.includes("swagger") ||
    lower.endsWith(".graphql") ||
    lower.endsWith(".gql") ||
    lower.endsWith(".proto") ||
    lower.endsWith(".sql")
  ) {
    priority += 70;
  }
  if (
    lower.includes("/app/") ||
    lower.includes("/src/") ||
    lower.includes("/components/")
  ) {
    priority += 35;
  }
  if (
    lower.includes(".spec.") ||
    lower.includes(".test.") ||
    lower.includes("/test/") ||
    lower.includes("/tests/")
  ) {
    priority -= 20;
  }
  return priority;
}

export function resourcePathForLocalCodebaseFile(
  snapshotPrefix: string,
  path: string,
) {
  const normalized = normalizeLocalPath(path);
  if (!normalized) {
    throw new Error(`Invalid local codebase path: ${path}`);
  }
  return `${snapshotPrefix}/files/${normalized}`;
}

function summaryFromSnapshot(
  snapshot: LocalCodebaseSnapshot,
): LocalCodebaseSummary {
  const {
    files: _files,
    capturedFiles: _capturedFiles,
    controlResources: _controlResources,
    ...summary
  } = snapshot;
  return summary;
}

async function readPersistedSelectedCodebase() {
  if (!supportsDirectoryPersistence()) return null;
  const db = await openLocalCodebaseDb();
  try {
    return await new Promise<PersistedLocalCodebase | null>(
      (resolve, reject) => {
        const transaction = db.transaction(
          LOCAL_CODEBASE_STORE_NAME,
          "readonly",
        );
        const store = transaction.objectStore(LOCAL_CODEBASE_STORE_NAME);
        const request = store.get(SELECTED_CODEBASE_KEY);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const result = request.result as PersistedLocalCodebase | undefined;
          resolve(result?.handle?.kind === "directory" ? result : null);
        };
      },
    );
  } finally {
    db.close();
  }
}

async function persistSelectedCodebase(value: PersistedLocalCodebase | null) {
  if (!supportsDirectoryPersistence()) return;
  const db = await openLocalCodebaseDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(
        LOCAL_CODEBASE_STORE_NAME,
        "readwrite",
      );
      const store = transaction.objectStore(LOCAL_CODEBASE_STORE_NAME);
      if (value) {
        store.put(value, SELECTED_CODEBASE_KEY);
      } else {
        store.delete(SELECTED_CODEBASE_KEY);
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

async function isSameDirectory(
  a: LocalDirectoryHandle,
  b: LocalDirectoryHandle,
) {
  try {
    return (await a.isSameEntry?.(b)) ?? false;
  } catch {
    return false;
  }
}

async function ensureReadPermission(handle: LocalDirectoryHandle) {
  const descriptor = { mode: "read" as const };
  if ((await handle.queryPermission?.(descriptor)) === "granted") return true;
  return (await handle.requestPermission?.(descriptor)) === "granted";
}

async function walkCodebaseFiles(
  handle: LocalDirectoryHandle,
  prefix = "",
  files: InternalCodebaseCandidate[] = [],
): Promise<InternalCodebaseCandidate[]> {
  for await (const entry of handle.values()) {
    const localPath = normalizeLocalPath(`${prefix}${entry.name}`);
    if (!localPath) continue;
    if (entry.kind === "directory") {
      if (isIgnoredCodebaseDirectory(entry.name)) continue;
      await walkCodebaseFiles(entry, `${localPath}/`, files);
      if (files.length >= MAX_INDEXED_FILES) return files;
      continue;
    }

    let file: File;
    try {
      file = await entry.getFile();
    } catch {
      continue;
    }
    if (!isCodebaseTextPath(localPath) || isSensitiveCodebasePath(localPath)) {
      continue;
    }
    files.push({
      path: localPath,
      size: file.size,
      handle: entry,
      priority: priorityForPath(localPath),
    });
    if (files.length >= MAX_INDEXED_FILES) return files;
  }
  return files;
}

function sortCandidates(candidates: InternalCodebaseCandidate[]) {
  return [...candidates].sort((a, b) => {
    const priority = b.priority - a.priority;
    if (priority !== 0) return priority;
    if (a.size !== b.size) return a.size - b.size;
    return a.path.localeCompare(b.path);
  });
}

export function renderCodebaseTree(files: LocalCodebaseFileEntry[]) {
  if (files.length === 0) return "No text files were indexed.";
  return files
    .map((file) => {
      const marker = file.captured ? "*" : "-";
      const detail = file.captured
        ? ` -> ${file.resourcePath}`
        : file.skippedReason
          ? ` (${file.skippedReason})`
          : "";
      return `${marker} ${file.path}${detail}`;
    })
    .join("\n");
}

export function buildLocalCodebaseInstruction(snapshot: LocalCodebaseSummary) {
  return [
    `# Local Codebase: ${snapshot.name}`,
    "",
    "The user selected this local codebase from the Plan chat home.",
    "",
    `- Codebase id: \`${snapshot.id}\``,
    `- Latest snapshot: \`${snapshot.snapshotPrefix}\``,
    `- Index: \`${snapshot.indexPath}\``,
    `- File tree: \`${snapshot.treePath}\``,
    `- Captured files: ${snapshot.capturedFileCount} of ${snapshot.indexedFileCount}`,
    `- Updated: ${snapshot.updatedAt}`,
    "",
    "When answering questions about this codebase:",
    "",
    '1. Read the index first with the `resources` tool using `action: "read"`, `scope: "personal"`, and the index path above.',
    "2. Read relevant captured files by exact `resourcePath` before making claims. Do not infer API contracts, schema shape, or UI behavior from file names alone.",
    "3. If a needed file is not captured, ask the user to re-sync the folder or attach the file instead of guessing.",
    "4. For visual answers, call `get-plan-blocks` or `list-plan-components` before `visual-answer`, then publish diagrams, API specs/endpoints, data models, file trees, tabs, or annotated code backed by the files you read.",
    "",
  ].join("\n");
}

function parseResourceMetadata(resource: ResourceMeta) {
  if (!resource.metadata) return null;
  if (typeof resource.metadata === "object") return resource.metadata;
  try {
    const parsed = JSON.parse(resource.metadata) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function resourceMatchesLocalCodebase(
  resource: ResourceMeta,
  codebaseId: string,
) {
  const metadata = parseResourceMetadata(resource);
  if (
    metadata?.source === LOCAL_CODEBASE_RESOURCE_SOURCE &&
    metadata.codebaseId === codebaseId
  ) {
    return true;
  }
  return (
    resource.path === `instructions/local-codebases/${codebaseId}.md` ||
    resource.path.startsWith(`codebases/${codebaseId}/`)
  );
}

export async function deleteLocalCodebaseResources(options: { id: string }) {
  const response = await fetch(
    agentNativePath("/_agent-native/resources?scope=personal"),
  );
  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = (await response.json()) as { error?: string };
      message = body.error || message;
    } catch {
      // Keep the HTTP status text when the response is not JSON.
    }
    throw new Error(`Local codebase resource cleanup failed: ${message}`);
  }

  const body = (await response.json()) as { resources?: ResourceMeta[] };
  const resources = (body.resources ?? []).filter((resource) =>
    resourceMatchesLocalCodebase(resource, options.id),
  );

  for (const resource of resources) {
    const deleteResponse = await fetch(
      agentNativePath(
        `/_agent-native/resources/${encodeURIComponent(resource.id)}`,
      ),
      { method: "DELETE" },
    );
    if (!deleteResponse.ok && deleteResponse.status !== 404) {
      let message = deleteResponse.statusText;
      try {
        const body = (await deleteResponse.json()) as { error?: string };
        message = body.error || message;
      } catch {
        // Keep the HTTP status text when the response is not JSON.
      }
      throw new Error(`Local codebase resource cleanup failed: ${message}`);
    }
  }

  return { count: resources.length, paths: resources.map((r) => r.path) };
}

async function writeResource(input: {
  path: string;
  content: string;
  mimeType: string;
  metadata?: Record<string, unknown>;
}) {
  const response = await fetch(agentNativePath("/_agent-native/resources"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: input.path,
      content: input.content,
      mimeType: input.mimeType,
      metadata: input.metadata,
    }),
  });
  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = (await response.json()) as { error?: string };
      message = body.error || message;
    } catch {
      // Keep the HTTP status text when the response is not JSON.
    }
    throw new Error(`Could not write codebase resource: ${message}`);
  }
}

export async function chooseLocalCodebase(): Promise<LocalCodebasePickerResult> {
  if (!supportsLocalCodebasePicker()) {
    return {
      ok: false,
      error: "Folder access is unavailable in this browser.",
    };
  }
  const picker = (window as WindowWithDirectoryPicker).showDirectoryPicker;
  if (!picker) {
    return {
      ok: false,
      error: "Folder access is unavailable in this browser.",
    };
  }

  try {
    const handle = await picker({ mode: "read" });
    const existing = await readPersistedSelectedCodebase();
    const sameExisting = existing
      ? await isSameDirectory(existing.handle, handle)
      : false;
    return {
      ok: true,
      handle,
      id: sameExisting ? existing.id : newCodebaseId(handle.name),
      name: handle.name,
    };
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    if (name === "AbortError") {
      return { ok: false, canceled: true, error: "No folder selected." };
    }
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Could not choose local folder.",
    };
  }
}

export async function restoreLocalCodebaseSummary() {
  const persisted = await readPersistedSelectedCodebase();
  return persisted?.latest ?? null;
}

export async function restoreLocalCodebaseSelection() {
  const persisted = await readPersistedSelectedCodebase();
  if (!persisted) return null;
  return {
    id: persisted.id,
    name: persisted.name,
    handle: persisted.handle,
    latest: persisted.latest ?? null,
  };
}

export async function collectLocalCodebaseSnapshot(input: {
  id: string;
  name: string;
  handle: LocalDirectoryHandle;
}): Promise<LocalCodebaseSnapshot> {
  if (!(await ensureReadPermission(input.handle))) {
    throw new Error("Folder permission was not granted.");
  }

  const updatedAt = new Date().toISOString();
  const snapshotId = updatedAt.replace(/[-:.TZ]/g, "").slice(0, 14);
  const resourcePrefix = `codebases/${input.id}`;
  const snapshotPrefix = `${resourcePrefix}/snapshots/${snapshotId}`;
  const instructionPath = `instructions/local-codebases/${input.id}.md`;
  const latestPath = `${resourcePrefix}/latest.json`;
  const indexPath = `${snapshotPrefix}/index.json`;
  const treePath = `${snapshotPrefix}/tree.md`;
  const candidates = sortCandidates(await walkCodebaseFiles(input.handle));
  const files: LocalCodebaseFileEntry[] = [];
  const capturedFiles: LocalCodebaseSnapshot["capturedFiles"] = [];
  let totalCapturedBytes = 0;

  for (const candidate of candidates) {
    const overFileLimit = candidate.size > MAX_FILE_BYTES;
    const overCountLimit = capturedFiles.length >= MAX_CAPTURED_FILES;
    const overByteLimit =
      totalCapturedBytes + candidate.size > MAX_CAPTURED_BYTES;
    const shouldCapture = !overFileLimit && !overCountLimit && !overByteLimit;

    if (!shouldCapture) {
      files.push({
        path: candidate.path,
        size: candidate.size,
        captured: false,
        skippedReason: overFileLimit
          ? "larger than sync limit"
          : "outside current sync budget",
      });
      continue;
    }

    const file = await candidate.handle.getFile();
    const content = await file.text();
    const resourcePath = resourcePathForLocalCodebaseFile(
      snapshotPrefix,
      candidate.path,
    );
    totalCapturedBytes += candidate.size;
    files.push({
      path: candidate.path,
      size: candidate.size,
      captured: true,
      resourcePath,
    });
    capturedFiles.push({
      path: candidate.path,
      resourcePath,
      content,
      mimeType: mimeTypeForPath(candidate.path),
      size: candidate.size,
    });
  }

  const summary: LocalCodebaseSummary = {
    id: input.id,
    name: input.name,
    resourcePrefix,
    snapshotPrefix,
    instructionPath,
    latestPath,
    indexPath,
    treePath,
    indexedFileCount: files.length,
    capturedFileCount: capturedFiles.length,
    skippedFileCount: files.length - capturedFiles.length,
    totalCapturedBytes,
    updatedAt,
  };

  return {
    ...summary,
    files,
    capturedFiles,
    controlResources: await collectLocalControlResourceFiles(input.handle),
  };
}

export async function syncLocalCodebaseSnapshot(
  snapshot: LocalCodebaseSnapshot,
) {
  const metadata = {
    source: LOCAL_CODEBASE_RESOURCE_SOURCE,
    codebaseId: snapshot.id,
    folderName: snapshot.name,
    updatedAt: snapshot.updatedAt,
  };
  const summary = summaryFromSnapshot(snapshot);

  await writeResource({
    path: snapshot.instructionPath,
    content: buildLocalCodebaseInstruction(snapshot),
    mimeType: "text/markdown",
    metadata,
  });
  await writeResource({
    path: snapshot.latestPath,
    content: JSON.stringify(summary, null, 2),
    mimeType: "application/json",
    metadata,
  });
  await writeResource({
    path: snapshot.indexPath,
    content: JSON.stringify(
      {
        ...summary,
        files: snapshot.files,
      },
      null,
      2,
    ),
    mimeType: "application/json",
    metadata,
  });
  await writeResource({
    path: snapshot.treePath,
    content: renderCodebaseTree(snapshot.files),
    mimeType: "text/markdown",
    metadata,
  });

  for (const file of snapshot.capturedFiles) {
    await writeResource({
      path: file.resourcePath,
      content: file.content,
      mimeType: file.mimeType,
      metadata: {
        ...metadata,
        sourcePath: file.path,
      },
    });
  }

  return {
    summary,
    resourceCount: snapshot.capturedFiles.length + 4,
  };
}

export async function rememberLocalCodebaseSelection(input: {
  id: string;
  name: string;
  handle: LocalDirectoryHandle;
  latest: LocalCodebaseSummary;
}) {
  await persistSelectedCodebase({
    id: input.id,
    name: input.name,
    handle: input.handle,
    updatedAt: input.latest.updatedAt,
    latest: input.latest,
  });
}

export async function clearLocalCodebaseSelection() {
  await persistSelectedCodebase(null);
}

export function localCodebaseAppState(summary: LocalCodebaseSummary | null) {
  if (!summary) return null;
  return {
    selected: true,
    id: summary.id,
    name: summary.name,
    resourcePrefix: summary.resourcePrefix,
    snapshotPrefix: summary.snapshotPrefix,
    instructionPath: summary.instructionPath,
    latestPath: summary.latestPath,
    indexPath: summary.indexPath,
    treePath: summary.treePath,
    indexedFileCount: summary.indexedFileCount,
    capturedFileCount: summary.capturedFileCount,
    skippedFileCount: summary.skippedFileCount,
    totalCapturedBytes: summary.totalCapturedBytes,
    updatedAt: summary.updatedAt,
  };
}
