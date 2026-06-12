import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { callAction } from "@agent-native/core/client";
import {
  IconAlertCircle,
  IconDownload,
  IconFileText,
  IconFolderOpen,
  IconRefresh,
  IconUpload,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useSetPageTitle } from "@/components/layout/HeaderActions";
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

function supportsDirectoryPicker() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

function isMarkdownPath(path: string) {
  return /\.(md|mdx)$/i.test(path);
}

async function ensureReadWritePermission(handle: LocalDirectoryHandle) {
  const descriptor = { mode: "readwrite" as const };
  if ((await handle.queryPermission?.(descriptor)) === "granted") return true;
  return (await handle.requestPermission?.(descriptor)) === "granted";
}

async function chooseDirectory() {
  const picker = (window as WindowWithDirectoryPicker).showDirectoryPicker;
  if (!picker) throw new Error("Folder access is not available here.");
  return picker({ mode: "readwrite" });
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
  const [directory, setDirectory] = useState<LocalDirectoryHandle | null>(null);
  const [status, setStatus] = useState<SyncStatus>({ kind: "idle" });
  const [busy, setBusy] = useState<
    "choose" | "export" | "preview" | "import" | null
  >(null);
  const supported = useMemo(supportsDirectoryPicker, []);

  useSetPageTitle(
    <h1 className="text-lg font-semibold tracking-tight truncate">
      Local files
    </h1>,
  );

  async function handleChooseFolder() {
    setBusy("choose");
    try {
      const handle = await chooseDirectory();
      setDirectory(handle);
      setStatus({
        kind: "success",
        title: "Folder selected",
        detail: handle.name,
      });
    } catch (err) {
      setStatus({
        kind: "error",
        title: "Folder selection failed",
        detail: err instanceof Error ? err.message : "Choose another folder.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleExport() {
    if (!directory) return;
    setBusy("export");
    try {
      if (!(await ensureReadWritePermission(directory))) {
        throw new Error("Write permission was not granted.");
      }
      const bundle = await callAction<ExportContentSourceResult>(
        "export-content-source" as never,
        {} as never,
        { method: "GET" },
      );
      const expectedPaths = new Set(Object.keys(bundle.files));
      await Promise.all(
        Object.entries(bundle.files).map(([path, content]) =>
          writeFile(directory, path, content),
        ),
      );
      const writeRoot = await sourceWriteRoot(directory);
      await removeStaleMarkdownFiles(
        writeRoot.handle,
        writeRoot.prefix,
        expectedPaths,
      );
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
    const root = await sourceReadRoot(directory);
    return collectMarkdownFiles(root.handle, root.prefix);
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

  const disabled = !directory || busy !== null;

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold tracking-tight">Source folder</h2>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {directory ? directory.name : "No folder selected"}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={handleChooseFolder}
            disabled={!supported || busy !== null}
          >
            <IconFolderOpen />
            {busy === "choose" ? "Choosing..." : "Choose folder"}
          </Button>
        </div>

        {!supported && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            Folder access is unavailable in this browser.
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <Button onClick={handleExport} disabled={disabled}>
            <IconDownload />
            {busy === "export" ? "Exporting..." : "Export"}
          </Button>
          <Button
            variant="outline"
            onClick={handlePreviewImport}
            disabled={disabled}
          >
            <IconRefresh />
            {busy === "preview" ? "Previewing..." : "Preview"}
          </Button>
          <Button
            variant="secondary"
            onClick={handleImport}
            disabled={disabled}
          >
            <IconUpload />
            {busy === "import" ? "Importing..." : "Import"}
          </Button>
        </div>

        <Separator />

        <div className="rounded-md border border-border bg-background p-4">
          {status.kind === "idle" && (
            <div className="flex items-start gap-3 text-sm text-muted-foreground">
              <IconFileText className="mt-0.5 size-4" />
              <span>Pick a folder to sync Markdown source files.</span>
            </div>
          )}
          {status.kind === "success" && (
            <div className="flex items-start gap-3 text-sm">
              <IconFileText className="mt-0.5 size-4 text-primary" />
              <div>
                <div className="font-medium">{status.title}</div>
                <div className="mt-1 text-muted-foreground">
                  {status.detail}
                </div>
              </div>
            </div>
          )}
          {status.kind === "error" && (
            <div className="flex items-start gap-3 text-sm">
              <IconAlertCircle className="mt-0.5 size-4 text-destructive" />
              <div>
                <div className="font-medium text-destructive">
                  {status.title}
                </div>
                <div className="mt-1 text-muted-foreground">
                  {status.detail}
                </div>
              </div>
            </div>
          )}
          {status.kind === "preview" && (
            <div className="space-y-4 text-sm">
              <div className="flex items-start gap-3">
                <IconFileText className="mt-0.5 size-4 text-primary" />
                <div>
                  <div className="font-medium">Preview ready</div>
                  <div className="mt-1 text-muted-foreground">
                    {resultSummary(status.result)}
                  </div>
                </div>
              </div>
              {(status.result.skipped.length > 0 ||
                status.result.errors.length > 0) && (
                <div className="space-y-2 rounded-md bg-muted/40 p-3">
                  {[...status.result.errors, ...status.result.skipped]
                    .slice(0, 6)
                    .map((item) => (
                      <div key={`${item.path}:${item.reason}`}>
                        <span className="font-medium">{item.path}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          - {item.reason}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
