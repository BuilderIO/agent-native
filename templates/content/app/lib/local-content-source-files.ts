import type { Document, DocumentSourceInfo } from "@shared/api";
import {
  CONTENT_SOURCE_ROOT,
  parseContentSourceFile,
  serializeContentSourceDocument,
} from "@shared/content-source";

import { getDesktopContentFiles } from "./desktop-content-files";

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
    }
  | { ok: false; error: string; unavailable?: boolean };

export type LocalSourceDocumentReadResult =
  | {
      ok: true;
      path: string;
      content: string;
      document: Document;
      updatedAt: string;
      runtime: "browser" | "desktop";
    }
  | { ok: false; error: string; unavailable?: boolean };

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

async function resolveDesktopSourceForPath(filePath: string) {
  const desktopFiles = getDesktopContentFiles();
  if (!desktopFiles) return null;
  const result = await desktopFiles.getFolder();
  if (!result.ok) return null;
  const folders =
    result.folders && result.folders.length > 0
      ? result.folders
      : [result.folder];
  const resolved = resolveSourcePathForFolders(filePath, folders);
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

function joinDesktopAbsolutePath(folderPath: string, filePath: string) {
  const folder = folderPath.replace(/[\\/]+$/, "");
  const separator = folder.includes("\\") ? "\\" : "/";
  const folderParts = folder.split(/[\\/]/).filter(Boolean);
  const folderName = folderParts[folderParts.length - 1];
  let relativePath = filePath;
  if (
    folderName === CONTENT_SOURCE_ROOT &&
    relativePath.startsWith(`${CONTENT_SOURCE_ROOT}/`)
  ) {
    relativePath = relativePath.slice(CONTENT_SOURCE_ROOT.length + 1);
  }
  return `${folder}${separator}${relativePath.replace(/\//g, separator)}`;
}

function sourceFileContent(document: Document) {
  return serializeContentSourceDocument({
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

  const content = sourceFileContent(document);
  const desktopSource = await resolveDesktopSourceForPath(filePath);
  if (desktopSource) {
    const result = await desktopSource.api.writeFile({
      folderId: desktopSource.folder.id,
      path: desktopSource.path,
      content,
    });
    if (!result.ok) return { ok: false, error: result.error };
    return {
      ok: true,
      path: filePath,
      absolutePath: result.folder.path
        ? joinDesktopAbsolutePath(result.folder.path, desktopSource.path)
        : undefined,
      runtime: "desktop",
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
  await writeBrowserFile(browserSource.handle, browserSource.path, content);
  return { ok: true, path: filePath, runtime: "browser" };
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

  const desktopSource = await resolveDesktopSourceForPath(filePath);
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
    return read.ok ? { ...read, runtime: "desktop" } : read;
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

  const desktopSource = await resolveDesktopSourceForPath(filePath);
  if (!desktopSource?.folder.path) return null;
  return joinDesktopAbsolutePath(desktopSource.folder.path, desktopSource.path);
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

  const desktopSource = await resolveDesktopSourceForPath(filePath);
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
    absolutePath: result.folder.path
      ? joinDesktopAbsolutePath(result.folder.path, desktopSource.path)
      : undefined,
    runtime: "desktop",
  };
}
