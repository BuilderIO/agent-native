import {
  actionErrorMessage,
  getBrowserTabId,
  setClientAppState,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useFileUploadStatus } from "@agent-native/core/client/uploads";
import { appStateKeyForBrowserTab } from "@shared/app-state-tabs";
import type {
  ImportContentDatabaseResult,
  ImportContentFileInput,
  ImportContentPageResult,
  ImportContentResult,
} from "@shared/import/api";
import {
  importAttachmentMediaType,
  importFileFormat,
  importFileKind,
  importImageMediaType,
  type ImportSkippedFile,
  MAX_IMPORT_ATTACHMENT_BYTES,
  MAX_IMPORT_FILES,
  MAX_IMPORT_IMAGE_BYTES,
  MAX_IMPORT_MARKDOWN_BYTES,
  MAX_IMPORT_TOTAL_MARKDOWN_BYTES,
  normalizeImportPath,
} from "@shared/import/plan";
import type { ImportNoteKind, ImportPageStatus } from "@shared/import/types";
import {
  IMPORT_ZIP_LIMITS,
  ImportZipError,
  newImportZipUsage,
  readImportZip,
} from "@shared/import/zip";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconDatabase,
  IconFileImport,
  IconFileOff,
  IconFileText,
  IconInfoCircle,
  IconLoader2,
} from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useImportContent, useUndoContentImport } from "@/hooks/use-documents";
import { cn } from "@/lib/utils";

import { FileStorageStatusGate } from "./FileStorageStatusGate";
import {
  ImageStorageUnavailableError,
  uploadImageFile,
  uploadLinkedFile,
} from "./image-upload";
import { uploadPickedImages } from "./import-image-uploads";

const IMPORT_APP_STATE_KEY = "content-import";
const FILE_ACCEPT = ".md,.markdown,.mdx,.zip,.pdf,.csv,image/*";
// Long enough to reach Open or Undo after the dialog closes.
const IMPORTED_TOAST_MS = 10_000;

type Translate = ReturnType<typeof useT>;

const NOTE_MESSAGE_KEYS: Record<ImportNoteKind, string> = {
  "footnotes-moved-to-end": "contentImport.noteFootnotesMovedToEnd",
  "github-alert-to-callout": "contentImport.noteGithubAlertToCallout",
  "html-formatting-converted": "contentImport.noteHtmlFormattingConverted",
  "html-tag-removed": "contentImport.noteHtmlTagRemoved",
  "html-block-flattened": "contentImport.noteHtmlBlockFlattened",
  "inline-image-moved-to-own-line":
    "contentImport.noteInlineImageMovedToOwnLine",
  "ordered-task-list-unnumbered": "contentImport.noteOrderedTaskListUnnumbered",
  "title-formatting-removed": "contentImport.noteTitleFormattingRemoved",
  "callout-icon-replaced": "contentImport.noteCalloutIconReplaced",
  "expiring-link-rehosted": "contentImport.noteExpiringLinkRehosted",
  "frontmatter-not-shown": "contentImport.noteFrontmatterNotShown",
  "frontmatter-unreadable": "contentImport.noteFrontmatterUnreadable",
  "asset-missing": "contentImport.noteAssetMissing",
  "link-target-not-imported": "contentImport.noteLinkTargetNotImported",
  "expiring-link-not-rehosted": "contentImport.noteExpiringLinkNotRehosted",
  "link-removed": "contentImport.noteLinkRemoved",
  "image-title-dropped": "contentImport.noteImageTitleDropped",
  "link-title-dropped": "contentImport.noteLinkTitleDropped",
  "code-block-info-dropped": "contentImport.noteCodeBlockInfoDropped",
  "hidden-html-dropped": "contentImport.noteHiddenHtmlDropped",
  "blocks-field-not-imported": "contentImport.noteBlocksFieldNotImported",
  "export-manifest-unreadable": "contentImport.noteExportManifestUnreadable",
  "unsupported-markdown": "contentImport.noteUnsupportedMarkdown",
  "text-not-landed": "contentImport.noteTextNotLanded",
  "structure-changed-on-save": "contentImport.noteStructureChangedOnSave",
};

const SKIP_MESSAGE_KEYS: Record<ImportSkippedFile["reason"], string> = {
  "unsupported-format": "contentImport.skipUnsupported",
  "unused-image": "contentImport.skipUnusedImage",
  "unused-file": "contentImport.skipUnusedFile",
  "too-large": "contentImport.skipTooLarge",
  "not-text": "contentImport.skipNotText",
  "duplicate-name": "contentImport.skipDuplicateName",
  "invalid-name": "contentImport.skipInvalidName",
  "nested-archive": "contentImport.skipNestedArchive",
};

const STATUS_MESSAGE_KEYS: Record<
  Exclude<ImportPageStatus, "preserved">,
  string
> = {
  converted: "contentImport.statusConverted",
  lost: "contentImport.statusLost",
};

type ImportPhase =
  | "choosing"
  | "planning"
  | "previewing"
  | "importing"
  | "imported"
  | "failed";

/**
 * What the agent sees of an import through `view-screen`: names, sizes, and
 * counts only. File contents never go into application state.
 */
function writeImportState(value: Record<string, unknown> | null) {
  const tabId = getBrowserTabId();
  for (const key of [
    appStateKeyForBrowserTab(IMPORT_APP_STATE_KEY, tabId),
    IMPORT_APP_STATE_KEY,
  ]) {
    void setClientAppState(key, value, {
      keepalive: true,
      requestSource: tabId,
    });
  }
}

interface ImportSource {
  name: string;
  size: number;
  file: File;
}

const IMPORT_SIZE_LIMITS: Partial<
  Record<ReturnType<typeof importFileKind>, number>
> = {
  markdown: MAX_IMPORT_MARKDOWN_BYTES,
  image: MAX_IMPORT_IMAGE_BYTES,
  attachment: MAX_IMPORT_ATTACHMENT_BYTES,
};

function importSource(name: string, file: File): ImportSource {
  const type = importImageMediaType(name) ?? importAttachmentMediaType(name);
  return {
    name,
    size: file.size,
    file:
      type && file.type !== type ? new File([file], file.name, { type }) : file,
  };
}

async function expandPickedFiles(files: File[], t: Translate) {
  const sources: ImportSource[] = [];
  const skipped: ImportSkippedFile[] = [];
  const usage = newImportZipUsage();
  let together = false;
  for (const file of files) {
    if (!/\.zip$/i.test(file.name)) {
      sources.push(importSource(file.name, file));
      continue;
    }
    let read: Awaited<ReturnType<typeof readImportZip>>;
    try {
      read = await readImportZip(file, IMPORT_ZIP_LIMITS, usage);
    } catch (zipError) {
      throw new Error(zipErrorMessage(zipError, file.name, t, together));
    }
    together = true;
    for (const entry of read.entries) {
      const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
      sources.push(importSource(entry.path, new File([entry.data], name)));
    }
    for (const entry of read.skipped) {
      skipped.push({
        name: entry.name,
        reason: entry.reason,
        format: importFileFormat(entry.name),
      });
    }
  }
  return { sources, skipped };
}

function zipErrorMessage(
  error: unknown,
  name: string,
  t: Translate,
  together: boolean,
) {
  const megabytes = (bytes: number) => Math.round(bytes / 1024 / 1024);
  if (!(error instanceof ImportZipError)) {
    return t("contentImport.zipUnreadable", { name });
  }
  switch (error.code) {
    case "too-large":
      return t("contentImport.zipTooLarge", {
        name,
        max: megabytes(IMPORT_ZIP_LIMITS.compressedBytes),
      });
    case "too-many-entries":
      return together
        ? t("contentImport.tooManyFiles", { max: IMPORT_ZIP_LIMITS.entries })
        : t("contentImport.zipTooManyFiles", {
            name,
            max: IMPORT_ZIP_LIMITS.entries,
          });
    case "expands-too-large":
      return together
        ? t("contentImport.zipsExpandTooLarge", {
            max: megabytes(IMPORT_ZIP_LIMITS.uncompressedBytes),
          })
        : t("contentImport.zipExpandsTooLarge", {
            name,
            max: megabytes(IMPORT_ZIP_LIMITS.uncompressedBytes),
          });
    case "unreadable":
      return t("contentImport.zipUnreadable", { name });
  }
}

async function readImportFiles(sources: ImportSource[]) {
  const skipped: ImportSkippedFile[] = [];
  const kept: Array<{ source: ImportSource; markdown: boolean }> = [];
  let markdownBytes = 0;
  for (const source of sources) {
    const kind = importFileKind(
      normalizeImportPath(source.name) ?? source.name,
    );
    if (source.size > (IMPORT_SIZE_LIMITS[kind] ?? Infinity)) {
      skipped.push({
        name: source.name,
        reason: "too-large",
        format: importFileFormat(source.name),
      });
      continue;
    }
    if (kind === "markdown") markdownBytes += source.size;
    kept.push({ source, markdown: kind === "markdown" });
  }
  if (markdownBytes > MAX_IMPORT_TOTAL_MARKDOWN_BYTES) {
    return { payload: [], skipped, markdownBytes };
  }
  const payload: ImportContentFileInput[] = [];
  for (const { source, markdown } of kept) {
    payload.push(
      markdown
        ? { name: source.name, text: await source.file.text() }
        : { name: source.name },
    );
  }
  return { payload, skipped, markdownBytes };
}

function uploadImportSource(
  source: ImportSource,
  parentId: string,
): Promise<string> {
  return importFileKind(source.name) === "image"
    ? uploadImageFile(source.file, { documentId: parentId })
    : uploadLinkedFile(source.file);
}

function skipReasonLabel(file: ImportSkippedFile, t: Translate) {
  if (file.reason === "unsupported-format" && file.format) {
    return t("contentImport.skipUnsupportedFormat", {
      format: file.format.toUpperCase(),
    });
  }
  return t(SKIP_MESSAGE_KEYS[file.reason]);
}

export function ContentImportDialog({
  request,
  parentId,
  parentTitle,
  onClose,
}: {
  /** Files dropped on the page, or an empty list when opened from the menu; null when closed. */
  request: { files: File[] } | null;
  parentId: string;
  parentTitle: string;
  onClose: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const importContent = useImportContent();
  const undoImport = useUndoContentImport();
  const fileUploadStatus = useFileUploadStatus();
  const inputRef = useRef<HTMLInputElement>(null);
  const planRequest = useRef(0);
  // The import whose toast still owns the published state; a newer dialog
  // session takes it over so a closing toast cannot erase that session.
  const toastImportId = useRef<string | null>(null);
  // One key per pick or drop, kept when the same files are planned again, so
  // an import that already created pages finishes instead of duplicating them.
  const idempotencyKey = useRef("");
  const imageUploads = useRef(new Map<ImportSource, Promise<string>>());
  const [files, setFiles] = useState<ImportSource[]>([]);
  const [archiveSkipped, setArchiveSkipped] = useState<ImportSkippedFile[]>([]);
  const [payload, setPayload] = useState<ImportContentFileInput[]>([]);
  const [localSkipped, setLocalSkipped] = useState<ImportSkippedFile[]>([]);
  const [plan, setPlan] = useState<ImportContentResult | null>(null);
  const [phase, setPhase] = useState<ImportPhase>("choosing");
  const [error, setError] = useState<string | null>(null);
  const [storageSetupOpen, setStorageSetupOpen] = useState(false);
  const open = request !== null;
  const destinationTitle = parentTitle.trim();

  const publishState = useCallback(
    (
      next: ImportPhase,
      details: {
        files?: Array<{ name: string; size: number }>;
        plan?: ImportContentResult | null;
        createdPageIds?: string[];
        error?: string | null;
      } = {},
    ) => {
      toastImportId.current = null;
      writeImportState({
        status: next,
        destination: { parentId, title: destinationTitle || null },
        files: (details.files ?? []).map((file) => ({
          name: file.name,
          size: file.size,
          format: importFileFormat(file.name),
        })),
        ...(details.plan
          ? {
              importId: details.plan.importId,
              counts: details.plan.counts,
              databases: details.plan.databases.length,
              storageReady: details.plan.storageReady,
            }
          : {}),
        ...(details.createdPageIds
          ? { createdPageIds: details.createdPageIds }
          : {}),
        ...(details.error ? { error: details.error } : {}),
      });
    },
    [destinationTitle, parentId],
  );

  const previewFiles = useCallback(
    async (picked: ImportSource[], fromArchives: ImportSkippedFile[]) => {
      const requestId = ++planRequest.current;
      const key = idempotencyKey.current;
      setFiles(picked);
      setArchiveSkipped(fromArchives);
      setPlan(null);
      setError(null);
      if (picked.length === 0 && fromArchives.length === 0) {
        setPhase("choosing");
        publishState("choosing");
        return;
      }
      if (picked.length > MAX_IMPORT_FILES) {
        const message = t("contentImport.tooManyFiles", {
          max: MAX_IMPORT_FILES,
        });
        setPhase("failed");
        setError(message);
        publishState("failed", { files: picked, error: message });
        return;
      }
      setPhase("planning");
      publishState("planning", { files: picked });
      try {
        const read = await readImportFiles(picked);
        if (requestId !== planRequest.current) return;
        if (read.markdownBytes > MAX_IMPORT_TOTAL_MARKDOWN_BYTES) {
          const message = t("contentImport.markdownTooLarge", {
            max: Math.round(MAX_IMPORT_TOTAL_MARKDOWN_BYTES / 1024 / 1024),
          });
          setPhase("failed");
          setError(message);
          publishState("failed", { files: picked, error: message });
          return;
        }
        setPayload(read.payload);
        setLocalSkipped(read.skipped);
        const result =
          read.payload.length > 0
            ? await importContent.mutateAsync({
                files: read.payload,
                parentId,
                dryRun: true,
                idempotencyKey: key,
              })
            : null;
        if (requestId !== planRequest.current) return;
        setPlan(result);
        setPhase("previewing");
        publishState("previewing", { files: picked, plan: result });
      } catch (planError) {
        if (requestId !== planRequest.current) return;
        const message =
          actionErrorMessage(planError) ?? t("contentImport.importFailed");
        setPhase("failed");
        setError(message);
        publishState("failed", { files: picked, error: message });
      }
    },
    [importContent, parentId, publishState, t],
  );

  const planFiles = useCallback(
    async (picked: File[]) => {
      idempotencyKey.current = crypto.randomUUID();
      imageUploads.current = new Map();
      if (!picked.some((file) => /\.zip$/i.test(file.name))) {
        return previewFiles(
          picked.map((file) => importSource(file.name, file)),
          [],
        );
      }
      const requestId = ++planRequest.current;
      setPlan(null);
      setError(null);
      setPhase("planning");
      publishState("planning", { files: picked });
      try {
        const expanded = await expandPickedFiles(picked, t);
        if (requestId !== planRequest.current) return;
        return previewFiles(expanded.sources, expanded.skipped);
      } catch (zipError) {
        if (requestId !== planRequest.current) return;
        const message =
          zipError instanceof Error
            ? zipError.message
            : t("contentImport.importFailed");
        setFiles([]);
        setPhase("failed");
        setError(message);
        publishState("failed", { files: picked, error: message });
      }
    },
    [previewFiles, publishState, t],
  );

  const planFilesRef = useRef(planFiles);
  planFilesRef.current = planFiles;
  const [shownRequest, setShownRequest] = useState(request);
  if (request !== shownRequest) {
    setShownRequest(request);
    if (request) {
      setFiles([]);
      setArchiveSkipped([]);
      setPayload([]);
      setLocalSkipped([]);
      setPlan(null);
      setError(null);
      setPhase("choosing");
    }
  }
  useEffect(() => {
    if (request) void planFilesRef.current(request.files);
  }, [request]);

  const close = useCallback(() => {
    planRequest.current += 1;
    writeImportState(null);
    onClose();
  }, [onClose]);

  const undo = useCallback(
    async (importId: string) => {
      try {
        await undoImport.mutateAsync({ importId });
        toast(t("contentImport.undone"));
      } catch (undoError) {
        const changed =
          (undoError as { errorCode?: unknown } | null)?.errorCode ===
          "IMPORT_PAGE_CHANGED";
        toast.error(
          changed
            ? t("contentImport.undoChanged")
            : t("contentImport.undoFailed"),
          changed ? undefined : { description: actionErrorMessage(undoError) },
        );
      }
    },
    [t, undoImport],
  );

  const runImport = useCallback(async () => {
    if (!plan) return;
    setPhase("importing");
    setError(null);
    publishState("importing", { files, plan });
    try {
      const urls = await uploadPickedImages(
        plan.uploads.flatMap((name) => {
          const file = files.find((candidate) => candidate.name === name);
          return file ? [file] : [];
        }),
        imageUploads.current,
        (source) =>
          uploadImportSource(source, parentId).catch((uploadError: unknown) => {
            if (uploadError instanceof ImageStorageUnavailableError) {
              throw uploadError;
            }
            const reason =
              uploadError instanceof Error
                ? uploadError.message
                : String(uploadError);
            throw new Error(`${source.name}: ${reason}`);
          }),
      );
      const result = await importContent.mutateAsync({
        files: payload.map((file) =>
          urls.has(file.name) ? { ...file, url: urls.get(file.name) } : file,
        ),
        parentId,
        dryRun: false,
        idempotencyKey: idempotencyKey.current,
      });
      const created = result.pages.flatMap((page) =>
        page.urlPath ? [page] : [],
      );
      publishState("imported", {
        files,
        plan: result,
        createdPageIds: created.map((page) => page.id!),
      });
      planRequest.current += 1;
      onClose();
      toastImportId.current = result.importId;
      const clearState = () => {
        if (toastImportId.current !== result.importId) return;
        toastImportId.current = null;
        writeImportState(null);
      };
      toast(t("contentImport.importedPages", { count: created.length }), {
        action: {
          label: t("contentImport.open"),
          onClick: () => {
            clearState();
            void navigate(created[0]!.urlPath!);
          },
        },
        cancel: {
          label: t("contentImport.undo"),
          onClick: () => {
            clearState();
            void undo(result.importId);
          },
        },
        duration: IMPORTED_TOAST_MS,
        onDismiss: clearState,
        onAutoClose: clearState,
      });
    } catch (importError) {
      if (
        importError instanceof ImageStorageUnavailableError ||
        (importError as { errorCode?: unknown } | null)?.errorCode ===
          "IMPORT_STORAGE_UNAVAILABLE"
      ) {
        setPhase("previewing");
        setPlan({ ...plan, storageReady: false });
        setStorageSetupOpen(true);
        publishState("previewing", {
          files,
          plan: { ...plan, storageReady: false },
        });
        return;
      }
      const message =
        actionErrorMessage(importError) ??
        (importError instanceof Error ? importError.message : null) ??
        t("contentImport.importFailed");
      // An import that stopped partway names the pages it already created;
      // importing again with the same key finishes it.
      const incomplete =
        (importError as { errorCode?: unknown } | null)?.errorCode ===
        "IMPORT_INCOMPLETE";
      const recorded = (
        importError as { details?: { documentIds?: unknown } } | null
      )?.details?.documentIds;
      setPhase("previewing");
      setError(incomplete ? t("contentImport.importIncomplete") : message);
      publishState("failed", {
        files,
        plan,
        error: message,
        ...(Array.isArray(recorded)
          ? { createdPageIds: recorded.map(String) }
          : {}),
      });
    }
  }, [
    files,
    importContent,
    navigate,
    onClose,
    parentId,
    payload,
    plan,
    publishState,
    t,
    undo,
  ]);

  const skipped = [
    ...archiveSkipped,
    ...localSkipped,
    ...(plan?.skipped ?? []),
  ];
  const pages = plan?.pages ?? [];
  const databases = plan?.databases ?? [];
  const pageDepths = new Map<string, number>();
  for (const page of pages) {
    const parentDepth = page.parentSourceName
      ? pageDepths.get(page.parentSourceName)
      : undefined;
    pageDepths.set(
      page.sourceName,
      parentDepth === undefined ? 0 : parentDepth + 1,
    );
  }
  const importedBefore = pages.flatMap((page) =>
    page.alreadyImportedAt ? [page.alreadyImportedAt] : [],
  );
  const lastImportedAt = importedBefore.reduce<string | null>(
    (latest, at) => (latest === null || at > latest ? at : latest),
    null,
  );
  const allImportedBefore =
    pages.length > 0 && importedBefore.length === pages.length;
  const busy = phase === "planning" || phase === "importing";
  const showingPlan = phase === "previewing" || phase === "importing";
  const storageReady = plan?.storageReady ?? true;
  const canImport =
    phase === "previewing" && pages.length > 0 && storageReady && !busy;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && phase !== "importing") close();
      }}
    >
      <DialogContent data-content-import-dialog>
        <DialogHeader>
          <DialogTitle>
            {destinationTitle
              ? t("contentImport.title", { title: destinationTitle })
              : t("contentImport.titleUntitled")}
          </DialogTitle>
        </DialogHeader>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept={FILE_ACCEPT}
          className="hidden"
          onChange={(event) => {
            const picked = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (picked.length > 0) void planFiles(picked);
          }}
        />

        {phase === "choosing" ? (
          <div
            className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border px-4 py-8 text-center"
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes("Files")) {
                event.preventDefault();
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              const dropped = Array.from(event.dataTransfer.files);
              if (dropped.length > 0) void planFiles(dropped);
            }}
          >
            <IconFileImport className="size-6 text-muted-foreground" />
            <p className="text-sm text-balance text-muted-foreground">
              {t("contentImport.dropZone")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
            >
              {t("contentImport.chooseFiles")}
            </Button>
          </div>
        ) : null}

        {phase === "planning" ? (
          <div
            className="grid gap-3"
            role="status"
            aria-label={t("contentImport.reading")}
          >
            {["first", "second"].map((key) => (
              <div key={key} className="flex items-start gap-3">
                <Skeleton className="mt-0.5 size-4" />
                <div className="grid flex-1 gap-1.5">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {lastImportedAt && showingPlan ? (
          <div className="flex items-start gap-2 rounded-md border border-warning-border bg-warning px-3 py-2 text-sm text-warning-foreground">
            <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p className="text-pretty">
              {t(
                allImportedBefore
                  ? "contentImport.alreadyImportedAll"
                  : "contentImport.alreadyImportedSome",
                {
                  date: new Date(lastImportedAt).toLocaleDateString(undefined, {
                    dateStyle: "medium",
                  }),
                },
              )}
            </p>
          </div>
        ) : null}

        {pages.length > 0 &&
        showingPlan &&
        pages.every((page) => page.status === "preserved") ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <IconCircleCheck className="size-3.5 shrink-0" />
            {databases.length > 0
              ? t("contentImport.allPreservedExceptDatabases")
              : t("contentImport.allPreserved")}
          </p>
        ) : null}

        {pages.length > 0 && showingPlan ? (
          <ul className="grid max-h-[50vh] gap-3 overflow-y-auto">
            {pages.map((page) => (
              <ImportPageRow
                key={page.sourceName}
                page={page}
                depth={pageDepths.get(page.sourceName) ?? 0}
                t={t}
              />
            ))}
          </ul>
        ) : null}

        {databases.length > 0 &&
        (phase === "previewing" || phase === "importing") ? (
          <section className="grid gap-1.5">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("contentImport.databasesNotImported")}
            </h3>
            <ul className="grid gap-1">
              {databases.map((database) => (
                <ImportDatabaseRow
                  key={database.sourceName}
                  database={database}
                  t={t}
                />
              ))}
            </ul>
          </section>
        ) : null}

        {skipped.length > 0 &&
        (phase === "previewing" || phase === "importing") ? (
          <section className="grid gap-1.5">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("contentImport.notImported")}
            </h3>
            <ul className="grid max-h-[30vh] gap-1 overflow-y-auto">
              {skipped.map((file, index) => (
                <li
                  key={`${index}:${file.name}:${file.reason}`}
                  className="flex min-w-0 items-center gap-2 text-sm"
                >
                  <IconFileOff className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{file.name}</span>
                  <span className="ms-auto shrink-0 text-xs text-muted-foreground">
                    {skipReasonLabel(file, t)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {plan && !storageReady ? (
          <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm">
            <IconAlertTriangle className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1">{t("contentImport.storageMissing")}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setStorageSetupOpen(true)}
            >
              {t("contentImport.setUpStorage")}
            </Button>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter className="sm:justify-between">
          {phase !== "choosing" ? (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {t("contentImport.chooseOtherFiles")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={phase === "importing"}
              onClick={close}
            >
              {t("contentImport.cancel")}
            </Button>
            <Button
              type="button"
              disabled={!canImport}
              onClick={() => void runImport()}
            >
              {phase === "importing" ? (
                <IconLoader2 className="me-2 size-4 animate-spin" />
              ) : null}
              {allImportedBefore
                ? t("contentImport.importAgain")
                : t("contentImport.import")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
      <FileStorageStatusGate
        status={fileUploadStatus}
        open={storageSetupOpen}
        onOpenChange={(next, reason) => {
          setStorageSetupOpen(next);
          if (!next && reason === "connected" && files.length > 0) {
            void previewFiles(files, archiveSkipped);
          }
        }}
      />
    </Dialog>
  );
}

function ImportPageRow({
  page,
  depth,
  t,
}: {
  page: ImportContentPageResult;
  depth: number;
  t: Translate;
}) {
  const StatusIcon =
    page.status === "converted" ? IconInfoCircle : IconAlertTriangle;
  return (
    <li
      className="flex min-w-0 items-start gap-3"
      style={depth > 0 ? { paddingInlineStart: `${depth * 1.25}rem` } : {}}
    >
      <IconFileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="grid min-w-0 flex-1 gap-1">
        <span className="truncate text-sm font-medium" title={page.sourceName}>
          {page.title}
        </span>
        {page.status !== "preserved" ? (
          <div
            className={cn(
              "flex items-center gap-1.5 text-xs",
              page.status === "lost"
                ? "text-foreground"
                : "text-muted-foreground",
            )}
          >
            <StatusIcon className="size-3.5 shrink-0" />
            {t(STATUS_MESSAGE_KEYS[page.status])}
          </div>
        ) : null}
        {page.notes.length > 0 ? (
          <ul className="grid gap-0.5 ps-5 text-xs text-muted-foreground">
            {page.notes.map((note) => (
              <li key={note.kind} className="min-w-0 truncate">
                {t(NOTE_MESSAGE_KEYS[note.kind])}
                {note.samples.length > 0 ? ` · ${note.samples.join(", ")}` : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

function ImportDatabaseRow({
  database,
  t,
}: {
  database: ImportContentDatabaseResult;
  t: Translate;
}) {
  return (
    <li className="flex min-w-0 items-center gap-2 text-sm">
      <IconDatabase className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{database.name}</span>
      <span className="ms-auto shrink-0 text-xs text-muted-foreground">
        {t("contentImport.databaseRows", { count: database.rows })}
        {" · "}
        {database.csvKept
          ? t("contentImport.databaseCsvKept")
          : t("contentImport.databaseCsvNotKept")}
      </span>
    </li>
  );
}
