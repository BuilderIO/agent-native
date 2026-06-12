import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { callAction } from "@agent-native/core/client";
import {
  IconAlertCircle,
  IconCircleCheck,
  IconDownload,
  IconFileText,
  IconFolderOpen,
  IconRefresh,
  IconUpload,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useSetPageTitle } from "@/components/layout/HeaderActions";
import {
  getDesktopContentFiles,
  type DesktopContentFilesFolder,
} from "@/lib/desktop-content-files";
import { rememberLinkedLocalSourceDirectory } from "@/lib/local-content-source-files";
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
};
type WindowWithDirectoryPicker = Window & {
  showDirectoryPicker?: (options?: {
    mode?: "read" | "readwrite";
  }) => Promise<LocalDirectoryHandle>;
};
type SelectedDirectory =
  | { kind: "browser"; handle: LocalDirectoryHandle }
  | { kind: "desktop"; folder: DesktopContentFilesFolder };

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

type SyncStatus =
  | { kind: "idle" }
  | { kind: "success"; title: string; detail: string }
  | { kind: "error"; title: string; detail: string }
  | { kind: "preview"; result: ImportContentSourceResult };

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

function supportsDirectoryPicker() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

function supportsLocalFolderSync() {
  return Boolean(getDesktopContentFiles()) || supportsDirectoryPicker();
}

function selectedDirectoryName(directory: SelectedDirectory | null) {
  if (!directory) return "No folder selected";
  return directory.kind === "desktop"
    ? directory.folder.name
    : directory.handle.name;
}

function supportsDirectoryPersistence() {
  return typeof window !== "undefined" && "indexedDB" in window;
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

async function readPersistedSourceDirectory() {
  if (!supportsDirectoryPersistence()) return null;
  const db = await openLocalFilesDb();
  try {
    return await new Promise<LocalDirectoryHandle | null>((resolve, reject) => {
      const transaction = db.transaction(LOCAL_FILES_STORE_NAME, "readonly");
      const request = transaction
        .objectStore(LOCAL_FILES_STORE_NAME)
        .get(SOURCE_DIRECTORY_KEY);
      request.onerror = () => reject(request.error);
      request.onsuccess = () =>
        resolve((request.result as LocalDirectoryHandle | undefined) ?? null);
    });
  } finally {
    db.close();
  }
}

async function persistSourceDirectory(handle: LocalDirectoryHandle) {
  if (!supportsDirectoryPersistence()) return;
  const db = await openLocalFilesDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(LOCAL_FILES_STORE_NAME, "readwrite");
      transaction
        .objectStore(LOCAL_FILES_STORE_NAME)
        .put(handle, SOURCE_DIRECTORY_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
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

async function chooseDirectory(): Promise<SelectedDirectory> {
  const desktopFiles = getDesktopContentFiles();
  if (desktopFiles) {
    const result = await desktopFiles.chooseFolder();
    if (!result.ok) throw new Error(result.error);
    return { kind: "desktop" as const, folder: result.folder };
  }

  const picker = (window as WindowWithDirectoryPicker).showDirectoryPicker;
  if (!picker) throw new Error("Folder access is not available here.");
  return {
    kind: "browser" as const,
    handle: await picker({ mode: "readwrite" }),
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
): Promise<{ directory: SelectedDirectory; files: Record<string, string> }> {
  if (directory.kind === "desktop") {
    const desktopFiles = getDesktopContentFiles();
    if (!desktopFiles) {
      throw new Error("Desktop folder access is no longer available.");
    }
    const result = await desktopFiles.readFiles();
    if (!result.ok) throw new Error(result.error);
    return {
      directory: { kind: "desktop", folder: result.folder },
      files: result.sources ?? {},
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
  };
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
  const [directory, setDirectory] = useState<SelectedDirectory | null>(null);
  const [status, setStatus] = useState<SyncStatus>({ kind: "idle" });
  const [busy, setBusy] = useState<
    "choose" | "export" | "preview" | "import" | null
  >(null);
  const [restoringDirectory, setRestoringDirectory] = useState(false);
  const supported = useMemo(supportsLocalFolderSync, []);

  useSetPageTitle(
    <h1 className="text-lg font-semibold tracking-tight truncate">
      Local files
    </h1>,
  );

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    setRestoringDirectory(true);
    const desktopFiles = getDesktopContentFiles();
    const restoreDirectory = async () => {
      if (desktopFiles) {
        const result = await desktopFiles.getFolder();
        if (cancelled || !result.ok) return;
        const restoredDirectory: SelectedDirectory = {
          kind: "desktop",
          folder: result.folder,
        };
        setDirectory(restoredDirectory);
        setStatus({
          kind: "success",
          title: "Folder remembered",
          detail: result.folder.name,
        });
        await importDirectoryFiles(restoredDirectory, { showToast: false });
        return;
      }

      const handle = await readPersistedSourceDirectory();
      if (cancelled || !handle) return;
      rememberLinkedLocalSourceDirectory(handle);
      const restoredDirectory: SelectedDirectory = { kind: "browser", handle };
      setDirectory(restoredDirectory);
      setStatus({
        kind: "success",
        title: "Folder remembered",
        detail: handle.name,
      });
      await importDirectoryFiles(restoredDirectory, { showToast: false });
    };
    restoreDirectory()
      .catch((err) => {
        if (!cancelled) {
          setStatus({
            kind: "error",
            title: "Folder import failed",
            detail:
              err instanceof Error
                ? err.message
                : "Choose another folder or try importing again.",
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

  async function importDirectoryFiles(
    selected: SelectedDirectory,
    { showToast = true }: { showToast?: boolean } = {},
  ) {
    const { directory: refreshedDirectory, files } =
      await readSourceFilesFromDirectory(selected);
    setDirectory(refreshedDirectory);
    const result = await callAction<ImportContentSourceResult>(
      "import-content-source" as never,
      { files, dryRun: false } as never,
    );
    setStatus({
      kind: "success",
      title: "Folder imported",
      detail: resultSummary(result),
    });
    queryClient.invalidateQueries({ queryKey: ["action", "list-documents"] });
    if (showToast) toast.success("Imported local files");
    return result;
  }

  async function handleChooseFolder() {
    setBusy("choose");
    try {
      const selected = await chooseDirectory();
      if (selected.kind === "browser") {
        rememberLinkedLocalSourceDirectory(selected.handle);
        try {
          await persistSourceDirectory(selected.handle);
        } catch {
          // Folder handles are still usable for this session if persistence fails.
        }
      }
      setDirectory(selected);
      setStatus({
        kind: "success",
        title: "Folder selected",
        detail: selectedDirectoryName(selected),
      });

      setBusy("import");
      await importDirectoryFiles(selected);
    } catch (err) {
      setStatus({
        kind: "error",
        title: "Folder import failed",
        detail:
          err instanceof Error
            ? err.message
            : "Choose another folder or try importing again.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleExport() {
    if (!directory) return;
    setBusy("export");
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
      if (directory.kind === "desktop") {
        const desktopFiles = getDesktopContentFiles();
        if (!desktopFiles) {
          throw new Error("Desktop folder access is no longer available.");
        }
        const result = await desktopFiles.writeFiles({ files: bundle.files });
        if (!result.ok) throw new Error(result.error);
        setDirectory({ kind: "desktop", folder: result.folder });
      } else {
        const expectedPaths = new Set(Object.keys(bundle.files));
        await Promise.all(
          Object.entries(bundle.files).map(([path, content]) =>
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
        title: "Export complete",
        detail: `${bundle.count} documents written at ${new Date(
          bundle.exportedAt,
        ).toLocaleTimeString()}`,
      });
      toast.success("Exported local files");
    } catch (err) {
      setStatus({
        kind: "error",
        title: "Export failed",
        detail: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function readSelectedSourceFiles() {
    if (!directory) throw new Error("Choose a folder first.");
    const result = await readSourceFilesFromDirectory(directory);
    setDirectory(result.directory);
    return result.files;
  }

  async function handlePreviewImport() {
    setBusy("preview");
    try {
      const files = await readSelectedSourceFiles();
      const result = await callAction<ImportContentSourceResult>(
        "import-content-source" as never,
        { files, dryRun: true } as never,
      );
      setStatus({ kind: "preview", result });
    } catch (err) {
      setStatus({
        kind: "error",
        title: "Preview failed",
        detail: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleImport() {
    setBusy("import");
    try {
      const files = await readSelectedSourceFiles();
      const result = await callAction<ImportContentSourceResult>(
        "import-content-source" as never,
        { files, dryRun: false } as never,
      );
      setStatus({
        kind: "success",
        title: "Import complete",
        detail: resultSummary(result),
      });
      queryClient.invalidateQueries({ queryKey: ["action", "list-documents"] });
      toast.success("Imported local files");
    } catch (err) {
      setStatus({
        kind: "error",
        title: "Import failed",
        detail: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setBusy(null);
    }
  }

  const disabled = !directory || busy !== null || restoringDirectory;

  return (
    <div className="flex-1 overflow-auto bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-8">
        <div className="flex flex-col gap-4 border-b border-border pb-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold tracking-tight">
                Source folder
              </h2>
              <div className="mt-2 inline-flex max-w-full min-w-0 items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1 text-sm text-muted-foreground">
                <IconFolderOpen className="size-4 shrink-0" />
                <span className="min-w-0 truncate">
                  {selectedDirectoryName(directory)}
                </span>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              onClick={handleChooseFolder}
              disabled={!supported || busy !== null || restoringDirectory}
            >
              <IconFolderOpen />
              {busy === "choose"
                ? "Choosing..."
                : restoringDirectory
                  ? "Restoring..."
                  : "Choose folder"}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={handleExport} disabled={disabled}>
              <IconDownload />
              {busy === "export" ? "Exporting..." : "Export"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handlePreviewImport}
              disabled={disabled}
            >
              <IconRefresh />
              {busy === "preview" ? "Previewing..." : "Preview"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleImport}
              disabled={disabled}
            >
              <IconUpload />
              {busy === "import" ? "Importing..." : "Import"}
            </Button>
          </div>
        </div>

        {!supported && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            Folder access is unavailable in this browser.
          </div>
        )}

        <div
          aria-live="polite"
          className={cn(
            "rounded-md border px-3 py-2.5 text-sm",
            status.kind === "error"
              ? "border-destructive/30 bg-destructive/5"
              : status.kind === "idle"
                ? "border-dashed border-border bg-muted/20"
                : "border-border bg-muted/20",
          )}
        >
          {status.kind === "idle" && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <IconFileText className="size-4 shrink-0" />
              <span>Pick a folder to sync Markdown source files.</span>
            </div>
          )}
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
      </div>
    </div>
  );
}
