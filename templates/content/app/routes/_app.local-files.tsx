import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { callAction, setClientAppState } from "@agent-native/core/client";
import {
  IconAlertCircle,
  IconCircleCheck,
  IconDownload,
  IconFileText,
  IconFolderPlus,
  IconFolderOpen,
  IconRefresh,
  IconStarFilled,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useSetPageTitle } from "@/components/layout/HeaderActions";
import {
  getDesktopContentFiles,
  type DesktopContentFilesFolder,
} from "@/lib/desktop-content-files";
import {
  rememberLinkedLocalSourceDirectories,
  rememberLinkedLocalSourceDirectory,
} from "@/lib/local-content-source-files";
import {
  collectLocalControlResourceFiles,
  syncLocalControlResources,
  type LocalControlResourceFiles,
} from "@/lib/local-control-resources";
import { CONTENT_SOURCE_ROOT } from "@shared/content-source";

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
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  queryPermission?(descriptor: {
    mode: "read" | "readwrite";
  }): Promise<PermissionState>;
  requestPermission?(descriptor: {
    mode: "read" | "readwrite";
  }): Promise<PermissionState>;
  isSameEntry?(other: LocalDirectoryHandle): Promise<boolean>;
};
type WindowWithDirectoryPicker = Window & {
  showDirectoryPicker?: (options?: {
    mode?: "read" | "readwrite";
  }) => Promise<LocalDirectoryHandle>;
};
type SelectedDirectory =
  | {
      id: string;
      kind: "browser";
      name: string;
      sourcePrefix: string;
      handle: LocalDirectoryHandle;
      updatedAt?: string;
    }
  | {
      id: string;
      kind: "desktop";
      name: string;
      sourcePrefix: string;
      folder: DesktopContentFilesFolder;
      updatedAt?: string;
    };

type PersistedSourceDirectory = Extract<SelectedDirectory, { kind: "browser" }>;

interface ExportContentSourceResult {
  count: number;
  files: Record<string, string>;
  exportedAt: string;
}

interface ImportContentSourceResult {
  dryRun: boolean;
  filesSeen: number;
  created: Array<{ id: string; path: string; title: string }>;
  updated: Array<{ id: string; path: string; title: string }>;
  unchanged: Array<{ id: string; path: string; title: string }>;
  skipped: Array<{ path: string; reason: string }>;
  errors: Array<{ path: string; reason: string }>;
}

interface RegisterLocalComponentWorkspaceResult {
  ok: true;
  workspace: {
    id: string;
    workspacePath: string;
    componentPaths: string[];
  };
  componentDirs: string[];
  componentCount: number;
  reloadRequired: boolean;
}

type SyncStatus =
  | { kind: "idle" }
  | { kind: "success"; title: string; detail: string }
  | { kind: "error"; title: string; detail: string }
  | { kind: "preview"; result: ImportContentSourceResult };

type BusyState =
  | "choose"
  | `pull:${string}`
  | `check:${string}`
  | `push:${string}`
  | `remove:${string}`;

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "dist",
  "node_modules",
]);
const LOCAL_FILES_DB_NAME = "content-local-files";
const LOCAL_FILES_DB_VERSION = 1;
const LOCAL_FILES_STORE_NAME = "handles";
const SOURCE_DIRECTORY_KEY = "source-directory";
const SOURCE_DIRECTORIES_KEY = "source-directories";

function supportsDirectoryPicker() {
  return (
    typeof window !== "undefined" &&
    typeof (window as WindowWithDirectoryPicker).showDirectoryPicker ===
      "function" &&
    !getDesktopContentFiles() &&
    !isElectronLikeBrowser()
  );
}

function supportsLocalFolderSync() {
  return Boolean(getDesktopContentFiles()) || supportsDirectoryPicker();
}

function isElectronLikeBrowser() {
  if (typeof navigator === "undefined") return false;
  return /\bElectron\//.test(navigator.userAgent);
}

function unsupportedLocalFolderSyncMessage() {
  if (isElectronLikeBrowser()) {
    return "Local folder sync is unavailable in this Electron browser. Use Agent Native Desktop or a browser with folder access.";
  }
  return "Folder access is unavailable in this browser.";
}

function supportsDirectoryPersistence() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function sourcePrefixBase(name: string) {
  const prefix = name
    .replace(/[\\/]/g, "-")
    .replace(/\0/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return !prefix || prefix === "." || prefix === ".." ? "Local folder" : prefix;
}

function uniqueSourcePrefix(
  name: string,
  directories: SelectedDirectory[],
  existingId?: string,
) {
  const base = sourcePrefixBase(name);
  const used = new Set(
    directories
      .filter((directory) => directory.id !== existingId)
      .map((directory) => directory.sourcePrefix),
  );
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

function browserDirectoryId() {
  return `browser-${crypto.randomUUID()}`;
}

function desktopDirectoryFromFolder(
  folder: DesktopContentFilesFolder,
  directories: SelectedDirectory[] = [],
): SelectedDirectory {
  const id = folder.id ?? `desktop-${folder.path ?? folder.name}`;
  return {
    id,
    kind: "desktop",
    name: folder.name,
    sourcePrefix:
      folder.sourcePrefix ?? uniqueSourcePrefix(folder.name, directories, id),
    folder,
    updatedAt: folder.updatedAt,
  };
}

function browserDirectoryToPersisted(
  directory: SelectedDirectory,
): PersistedSourceDirectory | null {
  if (directory.kind !== "browser") return null;
  return {
    id: directory.id,
    kind: "browser",
    name: directory.name,
    sourcePrefix: directory.sourcePrefix,
    handle: directory.handle,
    updatedAt: directory.updatedAt,
  };
}

function directoryUpdatedLabel(directory: SelectedDirectory) {
  if (!directory.updatedAt) return "Not synced yet";
  return new Date(directory.updatedAt).toLocaleString();
}

function directoriesAppState(directories: SelectedDirectory[]) {
  return {
    view: "local-files",
    count: directories.length,
    folders: directories.map((directory) => ({
      id: directory.id,
      name: directory.name,
      sourcePrefix: directory.sourcePrefix,
      runtime: directory.kind,
      updatedAt: directory.updatedAt,
    })),
  };
}

async function isSameBrowserDirectory(
  a: LocalDirectoryHandle,
  b: LocalDirectoryHandle,
) {
  try {
    return (await a.isSameEntry?.(b)) ?? false;
  } catch {
    return false;
  }
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

async function readPersistedSourceDirectories() {
  if (!supportsDirectoryPersistence()) return [];
  const db = await openLocalFilesDb();
  try {
    return await new Promise<PersistedSourceDirectory[]>((resolve, reject) => {
      const transaction = db.transaction(LOCAL_FILES_STORE_NAME, "readonly");
      const store = transaction.objectStore(LOCAL_FILES_STORE_NAME);
      const request = store.get(SOURCE_DIRECTORIES_KEY);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const persisted = Array.isArray(request.result)
          ? (request.result as PersistedSourceDirectory[])
              .filter((entry) => entry?.handle?.kind === "directory")
              .map((entry) => ({
                id: entry.id,
                kind: "browser" as const,
                name: entry.name,
                sourcePrefix: entry.sourcePrefix,
                handle: entry.handle,
                updatedAt: entry.updatedAt,
              }))
          : [];
        if (persisted.length > 0) {
          resolve(persisted);
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
                    kind: "browser",
                    name: handle.name,
                    sourcePrefix: sourcePrefixBase(handle.name),
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

async function persistSourceDirectories(directories: SelectedDirectory[]) {
  const browserDirectories = directories
    .map(browserDirectoryToPersisted)
    .filter((directory): directory is PersistedSourceDirectory =>
      Boolean(directory),
    );
  rememberLinkedLocalSourceDirectories(browserDirectories);
  if (!supportsDirectoryPersistence()) return;
  const db = await openLocalFilesDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const writeTransaction = db.transaction(
        LOCAL_FILES_STORE_NAME,
        "readwrite",
      );
      writeTransaction
        .objectStore(LOCAL_FILES_STORE_NAME)
        .put(browserDirectories, SOURCE_DIRECTORIES_KEY);
      writeTransaction.oncomplete = () => resolve();
      writeTransaction.onerror = () => reject(writeTransaction.error);
      writeTransaction.onabort = () => reject(writeTransaction.error);
    });
  } finally {
    db.close();
  }
}

function isMarkdownPath(path: string) {
  return /\.(md|mdx)$/i.test(path);
}

async function ensureReadWritePermission(handle: LocalDirectoryHandle) {
  const descriptor = { mode: "readwrite" as const };
  if ((await handle.queryPermission?.(descriptor)) === "granted") return true;
  return (await handle.requestPermission?.(descriptor)) === "granted";
}

async function hasBrowserComponentsDirectory(handle: LocalDirectoryHandle) {
  try {
    await handle.getDirectoryHandle("components");
    return true;
  } catch {
    return false;
  }
}

async function chooseDirectory(
  directories: SelectedDirectory[],
): Promise<SelectedDirectory> {
  const desktopFiles = getDesktopContentFiles();
  if (desktopFiles) {
    const result = await desktopFiles.chooseFolder();
    if (!result.ok) throw new Error(result.error);
    return desktopDirectoryFromFolder(result.folder, directories);
  }

  const picker = (window as WindowWithDirectoryPicker).showDirectoryPicker;
  if (!picker || isElectronLikeBrowser()) {
    throw new Error(unsupportedLocalFolderSyncMessage());
  }
  const handle = await picker({ mode: "readwrite" });
  const existing = await Promise.all(
    directories
      .filter((directory) => directory.kind === "browser")
      .map(async (directory) => ({
        directory,
        same: await isSameBrowserDirectory(directory.handle, handle),
      })),
  );
  const sameDirectory = existing.find((candidate) => candidate.same)?.directory;
  return {
    id: sameDirectory?.id ?? browserDirectoryId(),
    kind: "browser" as const,
    name: handle.name,
    sourcePrefix:
      sameDirectory?.sourcePrefix ??
      uniqueSourcePrefix(handle.name, directories),
    handle,
    updatedAt: new Date().toISOString(),
  };
}

async function sourceReadRoot(handle: LocalDirectoryHandle): Promise<{
  handle: LocalDirectoryHandle;
  prefix: string;
}> {
  if (handle.name === CONTENT_SOURCE_ROOT) {
    return { handle, prefix: `${CONTENT_SOURCE_ROOT}/` };
  }
  try {
    const contentHandle = await handle.getDirectoryHandle(CONTENT_SOURCE_ROOT);
    return { handle: contentHandle, prefix: `${CONTENT_SOURCE_ROOT}/` };
  } catch {
    return { handle, prefix: "" };
  }
}

async function collectMarkdownFiles(
  handle: LocalDirectoryHandle,
  prefix = "",
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for await (const entry of handle.values()) {
    const path = `${prefix}${entry.name}`;
    if (entry.kind === "directory") {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      Object.assign(files, await collectMarkdownFiles(entry, `${path}/`));
      continue;
    }

    if (!isMarkdownPath(path)) continue;
    const file = await entry.getFile();
    if (file.size > 2 * 1024 * 1024) continue;
    files[path] = await file.text();
  }
  return files;
}

async function writeFile(
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
  if (!filename) return;

  let dir = root;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  const file = await dir.getFileHandle(filename, { create: true });
  const writable = await file.createWritable();
  await writable.write(content);
  await writable.close();
}

async function sourceWriteRoot(
  handle: LocalDirectoryHandle,
): Promise<{ handle: LocalDirectoryHandle; prefix: string }> {
  if (handle.name === CONTENT_SOURCE_ROOT) {
    return { handle, prefix: `${CONTENT_SOURCE_ROOT}/` };
  }
  const contentHandle = await handle.getDirectoryHandle(CONTENT_SOURCE_ROOT, {
    create: true,
  });
  return { handle: contentHandle, prefix: `${CONTENT_SOURCE_ROOT}/` };
}

async function removeStaleMarkdownFiles(
  handle: LocalDirectoryHandle,
  prefix: string,
  expectedPaths: Set<string>,
) {
  for await (const entry of handle.values()) {
    const path = `${prefix}${entry.name}`;
    if (entry.kind === "directory") {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      await removeStaleMarkdownFiles(entry, `${path}/`, expectedPaths);
      continue;
    }

    if (isMarkdownPath(path) && !expectedPaths.has(path)) {
      await handle.removeEntry(entry.name);
    }
  }
}

async function readSourceFilesFromDirectory(
  directory: SelectedDirectory,
  {
    includeControlResources = false,
  }: { includeControlResources?: boolean } = {},
): Promise<{
  directory: SelectedDirectory;
  files: Record<string, string>;
  controlResources?: LocalControlResourceFiles;
}> {
  if (directory.kind === "desktop") {
    const desktopFiles = getDesktopContentFiles();
    if (!desktopFiles) {
      throw new Error("Desktop folder access is no longer available.");
    }
    const result = await desktopFiles.readFiles({ folderId: directory.id });
    if (!result.ok) throw new Error(result.error);
    return {
      directory: desktopDirectoryFromFolder(result.folder),
      files: result.sources ?? {},
      controlResources: includeControlResources
        ? result.controlResources
        : undefined,
    };
  }

  const handle = directory.handle;
  if (!(await ensureReadWritePermission(handle))) {
    throw new Error("Folder permission was not granted.");
  }
  const root = await sourceReadRoot(handle);
  return {
    directory,
    files: await collectMarkdownFiles(root.handle, root.prefix),
    controlResources: includeControlResources
      ? await collectLocalControlResourceFiles(handle)
      : undefined,
  };
}

function isMainDirectory(
  selected: SelectedDirectory,
  activeDirectories: SelectedDirectory[],
) {
  return activeDirectories[0]?.id === selected.id;
}

function upsertDirectory(
  directories: SelectedDirectory[],
  selected: SelectedDirectory,
) {
  const existingIndex = directories.findIndex(
    (directory) => directory.id === selected.id,
  );
  if (existingIndex === -1) return [...directories, selected];
  return directories.map((directory, index) =>
    index === existingIndex ? selected : directory,
  );
}

function sourcePathForDirectoryFile(
  directory: SelectedDirectory,
  filePath: string,
  directoryCount: number,
) {
  if (directoryCount <= 1) return filePath;
  return `${directory.sourcePrefix}/${filePath}`;
}

function filesForImport(
  directory: SelectedDirectory,
  files: Record<string, string>,
  directoryCount: number,
) {
  return Object.fromEntries(
    Object.entries(files).map(([path, content]) => [
      sourcePathForDirectoryFile(directory, path, directoryCount),
      content,
    ]),
  );
}

function filesForDirectoryExport(
  directory: SelectedDirectory,
  files: Record<string, string>,
  directoryCount: number,
) {
  if (directoryCount <= 1) return files;
  const prefix = `${directory.sourcePrefix}/`;
  return Object.fromEntries(
    Object.entries(files)
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, content]) => [path.slice(prefix.length), content]),
  );
}

function resultSummary(result: ImportContentSourceResult) {
  return [
    `${result.created.length} created`,
    `${result.updated.length} updated`,
    `${result.unchanged.length} unchanged`,
    `${result.skipped.length} skipped`,
    `${result.errors.length} errors`,
  ].join(" | ");
}

export function meta() {
  return [{ title: "Local files - Content" }];
}

export default function LocalFilesRoute() {
  const queryClient = useQueryClient();
  const [directories, setDirectories] = useState<SelectedDirectory[]>([]);
  const [status, setStatus] = useState<SyncStatus>({ kind: "idle" });
  const [busy, setBusy] = useState<BusyState | null>(null);
  const [restoringDirectory, setRestoringDirectory] = useState(false);
  const supported = useMemo(supportsLocalFolderSync, []);

  useSetPageTitle(
    <h1 className="text-lg font-semibold tracking-tight truncate">
      Local files
    </h1>,
  );

  useEffect(() => {
    void setClientAppState("local-files", directoriesAppState(directories), {
      requestSource: "content-local-files",
    }).catch(() => {
      // Application-state sync is best-effort; local sync still works without it.
    });
  }, [directories]);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    setRestoringDirectory(true);
    const desktopFiles = getDesktopContentFiles();
    const restoreDirectories = async () => {
      if (desktopFiles) {
        const result = await desktopFiles.getFolder();
        if (cancelled || !result.ok) return;
        const restoredDirectories = (
          result.folders && result.folders.length > 0
            ? result.folders
            : [result.folder]
        ).reduce<SelectedDirectory[]>(
          (items, folder) => [
            ...items,
            desktopDirectoryFromFolder(folder, items),
          ],
          [],
        );
        setDirectories(restoredDirectories);
        setStatus({
          kind: "success",
          title: "Folders remembered",
          detail: `${restoredDirectories.length} linked`,
        });
        await pullDirectories(restoredDirectories, {
          showToast: false,
          syncControlResources: false,
        });
        await connectLocalComponentWorkspaces(restoredDirectories, {
          showToast: false,
        });
        return;
      }

      const restoredDirectories = await readPersistedSourceDirectories();
      if (cancelled || restoredDirectories.length === 0) return;
      rememberLinkedLocalSourceDirectories(restoredDirectories);
      setDirectories(restoredDirectories);
      setStatus({
        kind: "success",
        title: "Folders remembered",
        detail: `${restoredDirectories.length} linked`,
      });
      await pullDirectories(restoredDirectories, {
        showToast: false,
        syncControlResources: false,
      });
      await connectLocalComponentWorkspaces(restoredDirectories, {
        showToast: false,
      });
    };
    restoreDirectories()
      .catch((err) => {
        if (!cancelled) {
          setStatus({
            kind: "error",
            title: "Folder restore failed",
            detail:
              err instanceof Error
                ? err.message
                : "Choose another folder or try again.",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setRestoringDirectory(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supported]);

  function updateDirectory(
    currentDirectories: SelectedDirectory[],
    refreshedDirectory: SelectedDirectory,
  ) {
    return currentDirectories.map((directory) =>
      directory.id === refreshedDirectory.id ? refreshedDirectory : directory,
    );
  }

  async function pullDirectoryFiles(
    selected: SelectedDirectory,
    activeDirectories: SelectedDirectory[],
    {
      dryRun = false,
      syncControlResources = true,
    }: { dryRun?: boolean; syncControlResources?: boolean } = {},
  ): Promise<{
    directories: SelectedDirectory[];
    result: ImportContentSourceResult;
  }> {
    const includeControlResources =
      syncControlResources &&
      !dryRun &&
      isMainDirectory(selected, activeDirectories);
    const {
      directory: refreshedDirectory,
      files,
      controlResources,
    } = await readSourceFilesFromDirectory(selected, {
      includeControlResources,
    });
    const nextDirectories = updateDirectory(
      activeDirectories,
      refreshedDirectory,
    );
    setDirectories(nextDirectories);
    if (refreshedDirectory.kind === "browser") {
      await persistSourceDirectories(nextDirectories);
    }
    if (includeControlResources) {
      const synced = await syncLocalControlResources({
        folderName: refreshedDirectory.sourcePrefix || refreshedDirectory.name,
        files: controlResources,
      });
      if (synced.count > 0) {
        queryClient.invalidateQueries({ queryKey: ["resources"] });
      }
    }
    if (Object.keys(files).length === 0) {
      return {
        directories: nextDirectories,
        result: {
          dryRun,
          filesSeen: 0,
          created: [],
          updated: [],
          unchanged: [],
          skipped: [],
          errors: [],
        },
      };
    }
    const result = await callAction<ImportContentSourceResult>(
      "import-content-source" as never,
      {
        files: filesForImport(
          refreshedDirectory,
          files,
          nextDirectories.length,
        ),
        dryRun,
      } as never,
    );
    if (!dryRun) {
      queryClient.invalidateQueries({ queryKey: ["action", "list-documents"] });
    }
    return { directories: nextDirectories, result };
  }

  async function pullDirectories(
    selectedDirectories: SelectedDirectory[],
    {
      showToast = true,
      syncControlResources = true,
    }: { showToast?: boolean; syncControlResources?: boolean } = {},
  ) {
    let activeDirectories = selectedDirectories;
    let latestResult: ImportContentSourceResult | null = null;
    for (const directory of selectedDirectories) {
      const pulled = await pullDirectoryFiles(directory, activeDirectories, {
        syncControlResources,
      });
      latestResult = pulled.result;
      activeDirectories = pulled.directories;
    }
    if (latestResult) {
      setStatus({
        kind: "success",
        title: "Folders pulled",
        detail: resultSummary(latestResult),
      });
      if (showToast) toast.success("Pulled local files");
    }
  }

  async function connectLocalComponentWorkspaces(
    selectedDirectories: SelectedDirectory[],
    { showToast = true }: { showToast?: boolean } = {},
  ) {
    for (const directory of selectedDirectories) {
      if (directory.kind === "desktop") {
        const workspacePath = directory.folder.path;
        if (!workspacePath) continue;
        try {
          const result =
            await callAction<RegisterLocalComponentWorkspaceResult>(
              "register-local-component-workspace" as never,
              { workspacePath } as never,
            );
          if (result.componentCount > 0 && showToast) {
            toast.success("Local components connected", {
              description:
                "Component previews and the slash menu will reload from this folder.",
            });
          }
        } catch (error) {
          if (showToast) {
            toast.info("Local files linked", {
              description:
                error instanceof Error
                  ? error.message
                  : "Component previews need the local dev bridge.",
            });
          }
        }
        continue;
      }

      if (
        showToast &&
        (await hasBrowserComponentsDirectory(directory.handle))
      ) {
        toast.info("MDX files linked", {
          description:
            "This browser can edit the files, but React component previews need Agent Native Desktop or a local dev server.",
        });
      }
    }
  }

  async function handleChooseFolder() {
    setBusy("choose");
    try {
      const selected = await chooseDirectory(directories);
      const nextDirectories = upsertDirectory(directories, selected);
      if (selected.kind === "browser") {
        rememberLinkedLocalSourceDirectory(selected.handle);
        await persistSourceDirectories(nextDirectories);
      }
      setDirectories(nextDirectories);
      setStatus({
        kind: "success",
        title: "Folder added",
        detail: selected.name,
      });

      setBusy(`pull:${selected.id}`);
      await pullDirectories(nextDirectories);
      await connectLocalComponentWorkspaces([selected]);
    } catch (err) {
      setStatus({
        kind: "error",
        title: "Folder add failed",
        detail:
          err instanceof Error
            ? err.message
            : "Choose another folder or try again.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handlePush(directory: SelectedDirectory) {
    setBusy(`push:${directory.id}`);
    try {
      if (
        directory.kind === "browser" &&
        !(await ensureReadWritePermission(directory.handle))
      ) {
        throw new Error("Write permission was not granted.");
      }
      const bundle = await callAction<ExportContentSourceResult>(
        "export-content-source" as never,
        {} as never,
        { method: "GET" },
      );
      const files = filesForDirectoryExport(
        directory,
        bundle.files,
        directories.length,
      );
      if (directory.kind === "desktop") {
        const desktopFiles = getDesktopContentFiles();
        if (!desktopFiles) {
          throw new Error("Desktop folder access is no longer available.");
        }
        const result = await desktopFiles.writeFiles({
          folderId: directory.id,
          files,
        });
        if (!result.ok) throw new Error(result.error);
        setDirectories((current) =>
          updateDirectory(current, desktopDirectoryFromFolder(result.folder)),
        );
      } else {
        const expectedPaths = new Set(Object.keys(files));
        await Promise.all(
          Object.entries(files).map(([path, content]) =>
            writeFile(directory.handle, path, content),
          ),
        );
        const writeRoot = await sourceWriteRoot(directory.handle);
        await removeStaleMarkdownFiles(
          writeRoot.handle,
          writeRoot.prefix,
          expectedPaths,
        );
      }
      setStatus({
        kind: "success",
        title: "Pushed to folder",
        detail: `${bundle.count} files written at ${new Date(
          bundle.exportedAt,
        ).toLocaleTimeString()}`,
      });
      toast.success("Pushed Content documents");
    } catch (err) {
      setStatus({
        kind: "error",
        title: "Push failed",
        detail: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleCheck(directory: SelectedDirectory) {
    setBusy(`check:${directory.id}`);
    try {
      const { result } = await pullDirectoryFiles(directory, directories, {
        dryRun: true,
      });
      setStatus({ kind: "preview", result });
    } catch (err) {
      setStatus({
        kind: "error",
        title: "Check failed",
        detail: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handlePull(directory: SelectedDirectory) {
    setBusy(`pull:${directory.id}`);
    try {
      const { result } = await pullDirectoryFiles(directory, directories);
      setStatus({
        kind: "success",
        title: "Pulled from folder",
        detail: resultSummary(result),
      });
      toast.success("Pulled local files");
    } catch (err) {
      setStatus({
        kind: "error",
        title: "Pull failed",
        detail: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleRemove(directory: SelectedDirectory) {
    setBusy(`remove:${directory.id}`);
    try {
      const nextDirectories = directories.filter(
        (candidate) => candidate.id !== directory.id,
      );
      if (directory.kind === "desktop") {
        const desktopFiles = getDesktopContentFiles();
        const result = await desktopFiles?.clearFolder({
          folderId: directory.id,
        });
        if (result && !result.ok) throw new Error(result.error);
      } else {
        await persistSourceDirectories(nextDirectories);
      }
      setDirectories(nextDirectories);
      setStatus({
        kind: "success",
        title: "Folder removed",
        detail: directory.name,
      });
      if (nextDirectories.length === 1) {
        await pullDirectories(nextDirectories, {
          showToast: false,
          syncControlResources: false,
        });
      }
    } catch (err) {
      setStatus({
        kind: "error",
        title: "Remove failed",
        detail: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy !== null || restoringDirectory;

  return (
    <div className="flex-1 overflow-auto bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-8">
        <div className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold tracking-tight">
              Local folders
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {directories.length === 0
                ? "No folders linked"
                : `${directories.length} folder${directories.length === 1 ? "" : "s"} linked`}
            </p>
          </div>
          <Button
            size="sm"
            className="w-fit"
            onClick={handleChooseFolder}
            disabled={!supported || disabled}
            aria-label="Choose folder"
          >
            <IconFolderPlus />
            {busy === "choose"
              ? "Adding..."
              : restoringDirectory
                ? "Restoring..."
                : "Add folder"}
          </Button>
        </div>

        {!supported && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {unsupportedLocalFolderSyncMessage()}
          </div>
        )}

        {status.kind !== "idle" && (
          <div
            aria-live="polite"
            className={cn(
              "rounded-md border px-3 py-2.5 text-sm",
              status.kind === "error"
                ? "border-destructive/30 bg-destructive/5"
                : "border-border bg-muted/20",
            )}
          >
            {status.kind === "success" && (
              <div className="flex items-center gap-2">
                <IconCircleCheck className="size-4 shrink-0 text-primary" />
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-medium">{status.title}</span>
                  <span className="text-muted-foreground">{status.detail}</span>
                </div>
              </div>
            )}
            {status.kind === "error" && (
              <div className="flex items-center gap-2">
                <IconAlertCircle className="size-4 shrink-0 text-destructive" />
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-medium text-destructive">
                    {status.title}
                  </span>
                  <span className="text-muted-foreground">{status.detail}</span>
                </div>
              </div>
            )}
            {status.kind === "preview" && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <IconFileText className="size-4 shrink-0 text-primary" />
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-medium">Preview ready</span>
                    <span className="text-muted-foreground">
                      {resultSummary(status.result)}
                    </span>
                  </div>
                </div>
                {(status.result.skipped.length > 0 ||
                  status.result.errors.length > 0) && (
                  <>
                    <Separator />
                    <div className="grid gap-1 text-xs">
                      {[...status.result.errors, ...status.result.skipped]
                        .slice(0, 6)
                        .map((item) => (
                          <div
                            key={`${item.path}:${item.reason}`}
                            className="min-w-0"
                          >
                            <span className="font-medium">{item.path}</span>
                            <span className="text-muted-foreground">
                              {" "}
                              - {item.reason}
                            </span>
                          </div>
                        ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        <div className="overflow-hidden rounded-md border border-border">
          <Table className="min-w-[640px] sm:min-w-0">
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">Folder</TableHead>
                <TableHead className="hidden w-36 md:table-cell">
                  Sidebar
                </TableHead>
                <TableHead className="hidden w-44 lg:table-cell">
                  Last sync
                </TableHead>
                <TableHead className="w-72 whitespace-nowrap text-right sm:w-80">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {directories.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="h-24 text-center text-sm text-muted-foreground"
                  >
                    <div className="ml-0 mr-auto max-w-[calc(100vw-4rem)] text-left sm:mx-auto sm:max-w-none sm:text-center">
                      Add a folder to sync local Markdown and MDX files.
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                directories.map((directory, index) => {
                  const isBusy = busy?.endsWith(`:${directory.id}`) ?? false;
                  const isMain = index === 0;
                  return (
                    <TableRow key={directory.id}>
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-2">
                          <IconFolderOpen className="size-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate font-medium">
                                {directory.name}
                              </span>
                              {isMain && (
                                <IconStarFilled
                                  aria-label="Main folder"
                                  className="size-3.5 shrink-0 text-primary"
                                />
                              )}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {directory.kind === "desktop"
                                ? (directory.folder.path ?? "Desktop folder")
                                : "Browser folder"}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        {directories.length > 1
                          ? directory.sourcePrefix
                          : "Flat"}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">
                        {directoryUpdatedLabel(directory)}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handlePull(directory)}
                            disabled={disabled || isBusy}
                          >
                            <IconDownload />
                            {busy === `pull:${directory.id}`
                              ? "Pulling..."
                              : "Pull"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleCheck(directory)}
                            disabled={disabled || isBusy}
                          >
                            <IconRefresh />
                            {busy === `check:${directory.id}`
                              ? "Checking..."
                              : "Check"}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handlePush(directory)}
                            disabled={disabled || isBusy}
                          >
                            <IconUpload />
                            {busy === `push:${directory.id}`
                              ? "Pushing..."
                              : "Push"}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Remove ${directory.name}`}
                            onClick={() => handleRemove(directory)}
                            disabled={disabled || isBusy}
                          >
                            <IconTrash />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
