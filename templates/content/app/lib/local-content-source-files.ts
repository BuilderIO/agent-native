import type { Document, DocumentSourceInfo } from "@shared/api";
import {
  CONTENT_SOURCE_ROOT,
  parseContentSourceFile,
  serializeContentSourceDocument,
} from "@shared/content-source";

import { getDesktopContentFiles } from "./desktop-content-files";
import type {
  DesktopContentFileRevision,
  DesktopContentFilesChange,
  DesktopContentFilesFolder,
} from "./desktop-content-files";

type PermissionState = "granted" | "denied" | "prompt";
type LocalWritable = {
  write(data: string): Promise<void>;
  close(): Promise<void>;
};
type LocalFileHandle = {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<LocalWritable>;
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
  queryPermission?(descriptor: {
    mode: "read" | "readwrite";
  }): Promise<PermissionState>;
  requestPermission?(descriptor: {
    mode: "read" | "readwrite";
  }): Promise<PermissionState>;
};

export type PersistedSourceDirectory = {
  id: string;
  name: string;
  sourcePrefix: string;
  handle: LocalDirectoryHandle;
  updatedAt?: string;
};

type WindowWithContentSourceHandle = Window & {
  __contentLocalSourceDirectoryHandle?: LocalDirectoryHandle;
  __contentLocalSourceDirectoryHandles?: PersistedSourceDirectory[];
};

export type LocalSourceFileResult =
  | {
      ok: true;
      path: string;
      absolutePath?: string;
      runtime: "browser" | "desktop" | "server-local";
      revision?: DesktopContentFileRevision;
    }
  | {
      ok: false;
      error: string;
      unavailable?: boolean;
      conflict?: {
        path: string;
        expectedRevision?: string | null;
        actualRevision?: DesktopContentFileRevision;
      };
    };

export type LocalSourceDocumentReadResult =
  | {
      ok: true;
      path: string;
      content: string;
      document: Document;
      updatedAt: string;
      runtime: "browser" | "desktop";
      revision?: DesktopContentFileRevision;
    }
  | { ok: false; error: string; unavailable?: boolean };

export type LinkedLocalSourceChange = DesktopContentFilesChange & {
  sourcePath: string;
};

export type LinkedLocalSourceWatchResult =
  | { ok: true; unsubscribe(): void }
  | { ok: false; error: string; unavailable?: boolean };

export type LinkedLocalSourceWriteOptions = {
  /** Opaque revision observed when the editor loaded the physical file. */
  expectedRevision?: string;
};

const LOCAL_FILES_DB_NAME = "content-local-files";
const LOCAL_FILES_DB_VERSION = 1;
const LOCAL_FILES_STORE_NAME = "handles";
const SOURCE_DIRECTORY_KEY = "source-directory";
const SOURCE_DIRECTORIES_KEY = "source-directories";

function supportsDirectoryPersistence() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

export function rememberLinkedLocalSourceDirectory(
  handle: LocalDirectoryHandle,
) {
  if (typeof window === "undefined") return;
  (
    window as WindowWithContentSourceHandle
  ).__contentLocalSourceDirectoryHandle = handle;
}

export function rememberLinkedLocalSourceDirectories(
  directories: PersistedSourceDirectory[],
) {
  if (typeof window === "undefined") return;
  (
    window as WindowWithContentSourceHandle
  ).__contentLocalSourceDirectoryHandles = directories;
  const first = directories[0]?.handle;
  if (first) rememberLinkedLocalSourceDirectory(first);
}

function openLocalFilesDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(LOCAL_FILES_DB_NAME, LOCAL_FILES_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LOCAL_FILES_STORE_NAME)) {
        db.createObjectStore(LOCAL_FILES_STORE_NAME);
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function readPersistedSourceDirectories(): Promise<
  PersistedSourceDirectory[]
> {
  const sessionHandles =
    typeof window === "undefined"
      ? null
      : (window as WindowWithContentSourceHandle)
          .__contentLocalSourceDirectoryHandles;
  if (sessionHandles && sessionHandles.length > 0) return sessionHandles;

  const sessionHandle =
    typeof window === "undefined"
      ? null
      : (window as WindowWithContentSourceHandle)
          .__contentLocalSourceDirectoryHandle;
  if (sessionHandle) {
    return [
      {
        id: "browser-session-source",
        name: sessionHandle.name,
        sourcePrefix: sessionHandle.name,
        handle: sessionHandle,
      },
    ];
  }
  if (!supportsDirectoryPersistence()) return [];
  const db = await openLocalFilesDb();
  try {
    return await new Promise<PersistedSourceDirectory[]>((resolve, reject) => {
      const transaction = db.transaction(LOCAL_FILES_STORE_NAME, "readonly");
      const store = transaction.objectStore(LOCAL_FILES_STORE_NAME);
      const directoriesRequest = store.get(SOURCE_DIRECTORIES_KEY);
      directoriesRequest.onerror = () => reject(directoriesRequest.error);
      directoriesRequest.onsuccess = () => {
        const directories = Array.isArray(directoriesRequest.result)
          ? (directoriesRequest.result as PersistedSourceDirectory[]).filter(
              (entry) => entry?.handle?.kind === "directory",
            )
          : [];
        if (directories.length > 0) {
          resolve(directories);
          return;
        }

        const legacyRequest = store.get(SOURCE_DIRECTORY_KEY);
        legacyRequest.onerror = () => reject(legacyRequest.error);
        legacyRequest.onsuccess = () => {
          const handle = legacyRequest.result as
            | LocalDirectoryHandle
            | undefined;
          resolve(
            handle?.kind === "directory"
              ? [
                  {
                    id: "browser-source-legacy",
                    name: handle.name,
                    sourcePrefix: handle.name,
                    handle,
                  },
                ]
              : [],
          );
        };
      };
    });
  } finally {
    db.close();
  }
}

function resolveSourcePathForFolders<T extends { sourcePrefix?: string }>(
  filePath: string,
  folders: T[],
): { folder: T; path: string } | null {
  const parts = filePath.split("/").filter(Boolean);
  const prefix = parts[0];
  if (prefix && parts.length > 1) {
    const folder = folders.find(
      (candidate) => candidate.sourcePrefix === prefix,
    );
    if (folder) return { folder, path: parts.slice(1).join("/") };
  }
  if (folders.length === 1) return { folder: folders[0], path: filePath };
  return null;
}

async function resolveBrowserSourceForPath(filePath: string) {
  const directories = await readPersistedSourceDirectories();
  const resolved = resolveSourcePathForFolders(filePath, directories);
  if (!resolved) return null;
  return {
    handle: resolved.folder.handle,
    path: resolved.path,
  };
}

async function resolveDesktopSourceForPath(
  filePath: string,
  source?: DocumentSourceInfo,
) {
  const desktopFiles = getDesktopContentFiles();
  if (!desktopFiles) return null;
  const result = await desktopFiles.getFolder();
  if (!result.ok) return null;
  const folders =
    result.folders && result.folders.length > 0
      ? result.folders
      : [result.folder];
  const sourceFolder = source?.rootPath
    ? folders.find(
        (folder) =>
          folder.id === source.rootPath ||
          folder.sourcePrefix === source.rootPath ||
          folder.name === source.rootPath,
      )
    : undefined;
  if (sourceFolder) {
    return { api: desktopFiles, folder: sourceFolder, path: filePath };
  }
  const resolved = resolveSourcePathForFolders(filePath, folders);
  if (!resolved && folders.length > 1) {
    const matches: DesktopContentFilesFolder[] = [];
    for (const folder of folders) {
      if (!folder.id) continue;
      const read = await desktopFiles.readFiles({ folderId: folder.id });
      if (read.ok && read.sources?.[filePath] !== undefined) {
        matches.push(folder);
      }
    }
    if (matches.length === 1) {
      return { api: desktopFiles, folder: matches[0]!, path: filePath };
    }
  }
  if (!resolved) {
    throw new Error(`Local source folder for "${filePath}" was not found.`);
  }
  return {
    api: desktopFiles,
    folder: resolved.folder,
    path: resolved.path,
  };
}

function normalizeSourcePath(filePath: string | undefined) {
  const normalized = (filePath ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    return null;
  }
  return /\.(md|mdx)$/i.test(normalized) ? normalized : null;
}

async function ensureReadWritePermission(handle: LocalDirectoryHandle) {
  const descriptor = { mode: "readwrite" as const };
  if ((await handle.queryPermission?.(descriptor)) === "granted") return true;
  return (await handle.requestPermission?.(descriptor)) === "granted";
}

async function writeBrowserFile(
  root: LocalDirectoryHandle,
  filePath: string,
  content: string,
) {
  const writePath =
    root.name === CONTENT_SOURCE_ROOT &&
    filePath.startsWith(`${CONTENT_SOURCE_ROOT}/`)
      ? filePath.slice(CONTENT_SOURCE_ROOT.length + 1)
      : filePath;
  const parts = writePath.split("/").filter(Boolean);
  const filename = parts.pop();
  if (!filename) throw new Error("Invalid content source path.");

  let dir = root;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  const file = await dir.getFileHandle(filename, { create: true });
  const writable = await file.createWritable();
  await writable.write(content);
  await writable.close();
}

async function readBrowserFile(root: LocalDirectoryHandle, filePath: string) {
  const readPath =
    root.name === CONTENT_SOURCE_ROOT &&
    filePath.startsWith(`${CONTENT_SOURCE_ROOT}/`)
      ? filePath.slice(CONTENT_SOURCE_ROOT.length + 1)
      : filePath;
  const parts = readPath.split("/").filter(Boolean);
  const filename = parts.pop();
  if (!filename) throw new Error("Invalid content source path.");

  let dir = root;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part);
  }
  const handle = await dir.getFileHandle(filename);
  const file = await handle.getFile();
  return {
    content: await file.text(),
    updatedAt: new Date(file.lastModified).toISOString(),
  };
}

const MANAGED_SOURCE_FRONTMATTER_KEYS = new Set([
  "id",
  "title",
  "description",
  "parentId",
  "icon",
  "position",
  "isFavorite",
  "hideFromSearch",
  "visibility",
  "updatedAt",
]);

const SOURCE_FRONTMATTER_RE =
  /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n\r?\n|\r?\n|$)/;

export function sourceFileContent(document: Document, existingSource?: string) {
  const serialized = serializeContentSourceDocument({
    id: document.id,
    parentId: document.parentId,
    title: document.title,
    content: document.content,
    icon: document.icon,
    position: document.position,
    isFavorite: document.isFavorite,
    hideFromSearch: document.hideFromSearch,
    visibility: document.visibility,
    updatedAt: document.updatedAt,
  });
  const existingFrontmatter = existingSource?.match(SOURCE_FRONTMATTER_RE)?.[1];
  if (!existingFrontmatter) return serialized;

  const preservedLines = existingFrontmatter.split(/\r?\n/).filter((line) => {
    const key = line.match(/^([A-Za-z][A-Za-z0-9_-]*):/)?.[1];
    return !key || !MANAGED_SOURCE_FRONTMATTER_KEYS.has(key);
  });
  if (preservedLines.length === 0) return serialized;

  return serialized.replace(
    "\n---\n\n",
    `\n${preservedLines.join("\n")}\n---\n\n`,
  );
}

function documentFromSourceContent(input: {
  base: Document;
  path: string;
  source: DocumentSourceInfo | undefined;
  content: string;
  updatedAt: string;
}): LocalSourceDocumentReadResult {
  const parsed = parseContentSourceFile(input.path, input.content);
  if (parsed.errors && parsed.errors.length > 0) {
    return { ok: false, error: parsed.errors.join(" ") };
  }

  return {
    ok: true,
    path: input.path,
    content: input.content,
    updatedAt: input.updatedAt,
    runtime: "browser",
    document: {
      ...input.base,
      parentId:
        parsed.parentId === undefined ? input.base.parentId : parsed.parentId,
      title: parsed.title,
      content: parsed.content,
      icon: parsed.icon === undefined ? null : parsed.icon,
      position: parsed.position ?? input.base.position,
      isFavorite: parsed.isFavorite ?? false,
      hideFromSearch: parsed.hideFromSearch ?? false,
      updatedAt: input.updatedAt,
      source: input.source,
    },
  };
}

export function isServerLocalFileDocumentId(id: string) {
  return id.startsWith("local-file:") || id.startsWith("local-folder:");
}

export function canWriteLinkedLocalSource(
  documentId: string,
  source: DocumentSourceInfo | undefined,
) {
  return (
    source?.mode === "local-files" &&
    source.kind !== "folder" &&
    !!source.path &&
    !isServerLocalFileDocumentId(documentId)
  );
}

export async function writeDocumentToLinkedLocalSource(
  document: Document,
  source: DocumentSourceInfo | undefined = document.source,
  options: LinkedLocalSourceWriteOptions = {},
): Promise<LocalSourceFileResult> {
  const filePath = normalizeSourcePath(source?.path);
  if (!filePath) {
    return {
      ok: false,
      error: "This document is not linked to a source file.",
    };
  }
  if (isServerLocalFileDocumentId(document.id)) {
    return {
      ok: true,
      path: filePath,
      absolutePath: source?.absolutePath,
      runtime: "server-local",
    };
  }

  const desktopSource = await resolveDesktopSourceForPath(filePath, source);
  if (desktopSource) {
    const current = await desktopSource.api.readFiles({
      folderId: desktopSource.folder.id,
    });
    if (!current.ok) {
      return { ok: false, error: current.error };
    }
    const existingSource = current.sources?.[desktopSource.path];
    if (existingSource === undefined) {
      return {
        ok: false,
        error: `Local file "${filePath}" was not found.`,
      };
    }
    const content = sourceFileContent(document, existingSource);
    const result = await desktopSource.api.writeFile({
      folderId: desktopSource.folder.id,
      path: desktopSource.path,
      content,
      expectedRevision: options.expectedRevision,
    });
    if (!result.ok) {
      return {
        ok: false,
        error: result.error,
        unavailable: result.code === "unavailable",
        conflict:
          result.code === "conflict" && result.conflict
            ? {
                path: filePath,
                expectedRevision: result.conflict.expectedRevision,
                actualRevision: result.conflict.actualRevision,
              }
            : undefined,
      };
    }
    return {
      ok: true,
      path: filePath,
      runtime: "desktop",
      revision: result.revisions?.[desktopSource.path],
    };
  }

  const browserSource = await resolveBrowserSourceForPath(filePath);
  if (!browserSource) {
    return {
      ok: false,
      unavailable: true,
      error: "Choose the source folder in Local files before editing.",
    };
  }
  if (!(await ensureReadWritePermission(browserSource.handle))) {
    return {
      ok: false,
      unavailable: true,
      error: "Write permission was not granted for the source folder.",
    };
  }
  const existingSource = await readBrowserFile(
    browserSource.handle,
    browserSource.path,
  );
  const content = sourceFileContent(document, existingSource.content);
  await writeBrowserFile(browserSource.handle, browserSource.path, content);
  return { ok: true, path: filePath, runtime: "browser" };
}

/**
 * Subscribe only through an already-authorized Desktop grant. Browser folder
 * handles intentionally have no ambient watcher capability.
 */
export async function watchLinkedLocalSource(
  source: DocumentSourceInfo | undefined,
  onChange: (change: LinkedLocalSourceChange) => void,
): Promise<LinkedLocalSourceWatchResult> {
  const filePath = normalizeSourcePath(source?.path);
  if (!filePath) {
    return {
      ok: false,
      error: "This document is not linked to a source file.",
    };
  }
  const desktopSource = await resolveDesktopSourceForPath(filePath, source);
  if (desktopSource?.api.watchFiles) {
    return desktopSource.api.watchFiles(
      { folderId: desktopSource.folder.id },
      (change) => {
        const legacyChange = change as DesktopContentFilesChange & {
          path?: string;
          previousPath?: string;
        };
        if (
          legacyChange.path !== desktopSource.path &&
          legacyChange.previousPath !== desktopSource.path
        ) {
          return;
        }
        onChange({ ...change, sourcePath: filePath });
      },
    );
  }
  if (
    !desktopSource?.api.subscribeChanges ||
    !desktopSource.api.unsubscribeChanges ||
    !desktopSource.api.onChange
  ) {
    return {
      ok: false,
      unavailable: true,
      error:
        "Live local file updates require a current Agent Native Desktop bridge.",
    };
  }
  const subscribed = await desktopSource.api.subscribeChanges({
    folderId: desktopSource.folder.id,
  });
  if (!subscribed.ok) return { ok: false, error: subscribed.error };
  const removeListener = desktopSource.api.onChange((change) => {
    if (change.folderId !== desktopSource.folder.id) return;
    onChange({ ...change, sourcePath: filePath });
  });
  return {
    ok: true,
    unsubscribe: () => {
      removeListener();
      void desktopSource.api.unsubscribeChanges?.({
        folderId: desktopSource.folder.id,
      });
    },
  };
}

export async function readDocumentFromLinkedLocalSource(
  document: Document,
  source: DocumentSourceInfo | undefined = document.source,
): Promise<LocalSourceDocumentReadResult> {
  const filePath = normalizeSourcePath(source?.path);
  if (!filePath) {
    return {
      ok: false,
      error: "This document is not linked to a source file.",
    };
  }
  if (isServerLocalFileDocumentId(document.id)) {
    return {
      ok: false,
      unavailable: true,
      error:
        "Server-backed local files are already read by the document action.",
    };
  }

  const desktopSource = await resolveDesktopSourceForPath(filePath, source);
  if (desktopSource) {
    const result = await desktopSource.api.readFiles({
      folderId: desktopSource.folder.id,
    });
    if (!result.ok) return { ok: false, error: result.error };
    const content = result.sources?.[desktopSource.path];
    if (content === undefined) {
      return { ok: false, error: `Local file "${filePath}" was not found.` };
    }
    const updatedAt = result.folder.updatedAt ?? new Date().toISOString();
    const read = documentFromSourceContent({
      base: document,
      path: filePath,
      source,
      content,
      updatedAt,
    });
    return read.ok
      ? {
          ...read,
          runtime: "desktop",
          revision: result.revisions?.[desktopSource.path],
        }
      : read;
  }

  const browserSource = await resolveBrowserSourceForPath(filePath);
  if (!browserSource) {
    return {
      ok: false,
      unavailable: true,
      error:
        "Choose the source folder in Local files before opening this page.",
    };
  }
  if (!(await ensureReadWritePermission(browserSource.handle))) {
    return {
      ok: false,
      unavailable: true,
      error: "Read/write permission was not granted for the source folder.",
    };
  }

  try {
    const file = await readBrowserFile(
      browserSource.handle,
      browserSource.path,
    );
    return documentFromSourceContent({
      base: document,
      path: filePath,
      source,
      content: file.content,
      updatedAt: file.updatedAt,
    });
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : `Local file "${filePath}" could not be read.`,
    };
  }
}

export async function localSourceAbsolutePath(
  source: DocumentSourceInfo | undefined,
) {
  const filePath = normalizeSourcePath(source?.path);
  if (!filePath) return source?.absolutePath ?? null;
  if (source?.absolutePath) return source.absolutePath;

  return null;
}

export async function revealLinkedLocalSourceFile(
  source: DocumentSourceInfo | undefined,
): Promise<LocalSourceFileResult> {
  const filePath = normalizeSourcePath(source?.path);
  if (!filePath) {
    return {
      ok: false,
      error: "This document is not linked to a source file.",
    };
  }

  const desktopSource = await resolveDesktopSourceForPath(filePath, source);
  if (!desktopSource) {
    return {
      ok: false,
      unavailable: true,
      error: "Reveal in Finder is available in Agent Native Desktop.",
    };
  }

  const result = await desktopSource.api.revealFile({
    folderId: desktopSource.folder.id,
    path: desktopSource.path,
  });
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    path: filePath,
    runtime: "desktop",
  };
}
