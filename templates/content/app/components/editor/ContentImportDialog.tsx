import {
  actionErrorMessage,
  getBrowserTabId,
  setClientAppState,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useFileUploadStatus } from "@agent-native/core/client/uploads";
import { appStateKeyForBrowserTab } from "@shared/app-state-tabs";
import type {
  ImportContentFileInput,
  ImportContentPageResult,
  ImportContentResult,
} from "@shared/import/api";
import {
  importFileFormat,
  importFileKind,
  type ImportSkippedFile,
  MAX_IMPORT_FILES,
  MAX_IMPORT_MARKDOWN_BYTES,
  normalizeImportPath,
} from "@shared/import/plan";
import type { ImportNoteKind, ImportPageStatus } from "@shared/import/types";
import {
  IconAlertTriangle,
  IconCircleCheck,
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
import { uploadImageFile } from "./image-upload";

const IMPORT_APP_STATE_KEY = "content-import";
const FILE_ACCEPT = ".md,.markdown,.mdx,image/*";
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
  "frontmatter-not-shown": "contentImport.noteFrontmatterNotShown",
  "frontmatter-unreadable": "contentImport.noteFrontmatterUnreadable",
  "asset-missing": "contentImport.noteAssetMissing",
  "link-target-not-imported": "contentImport.noteLinkTargetNotImported",
  "link-removed": "contentImport.noteLinkRemoved",
  "image-title-dropped": "contentImport.noteImageTitleDropped",
  "link-title-dropped": "contentImport.noteLinkTitleDropped",
  "code-block-info-dropped": "contentImport.noteCodeBlockInfoDropped",
  "hidden-html-dropped": "contentImport.noteHiddenHtmlDropped",
  "unsupported-markdown": "contentImport.noteUnsupportedMarkdown",
  "text-not-landed": "contentImport.noteTextNotLanded",
  "structure-changed-on-save": "contentImport.noteStructureChangedOnSave",
};

const SKIP_MESSAGE_KEYS: Record<ImportSkippedFile["reason"], string> = {
  "unsupported-format": "contentImport.skipUnsupported",
  "unused-image": "contentImport.skipUnusedImage",
  "too-large": "contentImport.skipTooLarge",
  "not-text": "contentImport.skipNotText",
  "duplicate-name": "contentImport.skipDuplicateName",
  "invalid-name": "contentImport.skipInvalidName",
};

const STATUS_MESSAGE_KEYS: Record<ImportPageStatus, string> = {
  preserved: "contentImport.statusPreserved",
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

async function readImportFiles(files: File[]) {
  const payload: ImportContentFileInput[] = [];
  const skipped: ImportSkippedFile[] = [];
  for (const file of files) {
    const kind = importFileKind(normalizeImportPath(file.name) ?? file.name);
    if (kind !== "markdown") {
      payload.push({ name: file.name });
      continue;
    }
    if (file.size > MAX_IMPORT_MARKDOWN_BYTES) {
      skipped.push({
        name: file.name,
        reason: "too-large",
        format: importFileFormat(file.name),
      });
      continue;
    }
    payload.push({ name: file.name, text: await file.text() });
  }
  return { payload, skipped };
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
  const [files, setFiles] = useState<File[]>([]);
  const [payload, setPayload] = useState<ImportContentFileInput[]>([]);
  const [localSkipped, setLocalSkipped] = useState<ImportSkippedFile[]>([]);
  const [plan, setPlan] = useState<ImportContentResult | null>(null);
  const [phase, setPhase] = useState<ImportPhase>("choosing");
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [storageSetupOpen, setStorageSetupOpen] = useState(false);
  const open = request !== null;
  const destinationTitle = parentTitle.trim();

  const publishState = useCallback(
    (
      next: ImportPhase,
      details: {
        files?: File[];
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

  const planFiles = useCallback(
    async (picked: File[]) => {
      const requestId = ++planRequest.current;
      setFiles(picked);
      setPlan(null);
      setError(null);
      const key = crypto.randomUUID();
      setIdempotencyKey(key);
      if (picked.length === 0) {
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

  const planFilesRef = useRef(planFiles);
  planFilesRef.current = planFiles;
  useEffect(() => {
    if (request) void planFilesRef.current(request.files);
  }, [request]);

  const close = useCallback(() => {
    planRequest.current += 1;
    setFiles([]);
    setPayload([]);
    setLocalSkipped([]);
    setPlan(null);
    setError(null);
    setPhase("choosing");
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
      const urls = new Map<string, string>();
      await Promise.all(
        plan.uploads.map(async (name) => {
          const file = files.find((candidate) => candidate.name === name);
          if (file) urls.set(name, await uploadImageFile(file));
        }),
      );
      const result = await importContent.mutateAsync({
        files: payload.map((file) =>
          urls.has(file.name) ? { ...file, url: urls.get(file.name) } : file,
        ),
        parentId,
        dryRun: false,
        idempotencyKey,
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
      setFiles([]);
      setPayload([]);
      setLocalSkipped([]);
      setPlan(null);
      setPhase("choosing");
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
      setPhase("previewing");
      setError(message);
      publishState("failed", { files, plan, error: message });
    }
  }, [
    files,
    idempotencyKey,
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

  const skipped = [...localSkipped, ...(plan?.skipped ?? [])];
  const pages = plan?.pages ?? [];
  const busy = phase === "planning" || phase === "importing";
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
            <p className="text-sm text-muted-foreground">
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

        {pages.length > 0 &&
        (phase === "previewing" || phase === "importing") ? (
          <ul className="grid gap-3">
            {pages.map((page) => (
              <ImportPageRow key={page.sourceName} page={page} t={t} />
            ))}
          </ul>
        ) : null}

        {skipped.length > 0 &&
        (phase === "previewing" || phase === "importing") ? (
          <section className="grid gap-1.5">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("contentImport.notImported")}
            </h3>
            <ul className="grid gap-1">
              {skipped.map((file) => (
                <li
                  key={`${file.name}:${file.reason}`}
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
              {t("contentImport.import")}
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
            void planFiles(files);
          }
        }}
      />
    </Dialog>
  );
}

function ImportPageRow({
  page,
  t,
}: {
  page: ImportContentPageResult;
  t: Translate;
}) {
  const StatusIcon =
    page.status === "preserved"
      ? IconCircleCheck
      : page.status === "converted"
        ? IconInfoCircle
        : IconAlertTriangle;
  return (
    <li className="flex min-w-0 items-start gap-3">
      <IconFileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-medium">{page.title}</span>
          <span className="ms-auto shrink-0 truncate text-xs text-muted-foreground">
            {page.sourceName}
          </span>
        </div>
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
