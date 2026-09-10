import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type {
  ContentDatabaseFilter,
  ContentDatabaseFilterMode,
  ContentDatabaseSort,
} from "@shared/api";
import { IconDownload, IconLoader2 } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type DatabaseExportFormat = "csv" | "markdown" | "html" | "pdf";
export type DatabaseExportScopeKind = "all_members" | "current_view";

export interface DatabaseExportProperty {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  primaryBody?: boolean;
}

export interface DatabaseExportContext {
  viewId: string;
  viewName: string;
  query: {
    search: string;
    filters: ContentDatabaseFilter[];
    sorts: ContentDatabaseSort[];
    filterMode: ContentDatabaseFilterMode;
  };
  properties: DatabaseExportProperty[];
}

export interface DatabaseExportSelection {
  propertyIds: string[];
  includePrimaryBody: boolean;
  blockPropertyIds: string[];
}

type DatabaseExportSelections = Record<
  DatabaseExportFormat,
  DatabaseExportSelection
>;

export interface CollectionExportArchiveFile {
  path: string;
  content: string;
}

export interface CollectionExportResult {
  filename: string;
  mimeType: string;
  content: string;
  format: DatabaseExportFormat;
  print: boolean;
  archiveFiles?: CollectionExportArchiveFile[];
}

const EXPORT_FORMATS: DatabaseExportFormat[] = [
  "csv",
  "markdown",
  "html",
  "pdf",
];

export function defaultDatabaseExportPropertyIds(
  properties: DatabaseExportProperty[],
) {
  return properties
    .filter((property) => property.visible && property.type !== "blocks")
    .map((property) => property.id);
}

export function additionalDatabaseExportBlockProperties(
  properties: DatabaseExportProperty[],
) {
  return properties.filter(
    (property) => property.type === "blocks" && !property.primaryBody,
  );
}

export function defaultDatabaseExportSelections(
  properties: DatabaseExportProperty[],
): DatabaseExportSelections {
  const propertyIds = defaultDatabaseExportPropertyIds(properties);
  const selection = (includePrimaryBody: boolean) => ({
    propertyIds: [...propertyIds],
    includePrimaryBody,
    blockPropertyIds: [],
  });
  return {
    csv: selection(false),
    markdown: selection(true),
    html: selection(true),
    pdf: selection(true),
  };
}

export function shouldInitializeDatabaseExportDialog(
  wasOpen: boolean,
  open: boolean,
) {
  return open && !wasOpen;
}

export function updateDatabaseExportSelection(
  selections: DatabaseExportSelections,
  format: DatabaseExportFormat,
  patch: Partial<DatabaseExportSelection>,
) {
  return {
    ...selections,
    [format]: { ...selections[format], ...patch },
  };
}

export function databaseExportRequest(args: {
  id: string;
  format: DatabaseExportFormat;
  context: DatabaseExportContext;
  scope: DatabaseExportScopeKind;
  selection: DatabaseExportSelection;
}) {
  return {
    id: args.id,
    format: args.format,
    collection: {
      scope:
        args.scope === "current_view"
          ? {
              kind: "current_view" as const,
              viewId: args.context.viewId,
              query: args.context.query,
            }
          : { kind: "all_members" as const },
      propertyIds: args.selection.propertyIds,
      includePrimaryBody: args.selection.includePrimaryBody,
      blockPropertyIds: args.selection.blockPropertyIds,
    },
  };
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function buildStoreOnlyZip(files: CollectionExportArchiveFile[]) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.path);
    const content = encoder.encode(file.content);
    const checksum = crc32(content);
    const local = new Uint8Array(30);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(12, 0x0021, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, content.length, true);
    localView.setUint32(22, content.length, true);
    localView.setUint16(26, name.length, true);
    localParts.push(local, name, content);

    const central = new Uint8Array(46);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(14, 0x0021, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, content.length, true);
    centralView.setUint32(24, content.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    centralParts.push(central, name);
    offset += local.length + name.length + content.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);

  const output = new Uint8Array(centralOffset + centralSize + end.length);
  let writeOffset = 0;
  for (const part of [...localParts, ...centralParts, end]) {
    output.set(part, writeOffset);
    writeOffset += part.length;
  }
  return output;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = filename;
  window.document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function printExportHtml(result: CollectionExportResult) {
  const iframe = window.document.createElement("iframe");
  const url = URL.createObjectURL(
    new Blob([result.content], { type: "text/html;charset=utf-8" }),
  );
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.insetInlineEnd = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    URL.revokeObjectURL(url);
    iframe.remove();
  };
  iframe.addEventListener("load", () => {
    const frameWindow = iframe.contentWindow;
    if (!frameWindow) {
      cleanup();
      return;
    }
    frameWindow.addEventListener(
      "afterprint",
      () => window.setTimeout(cleanup, 500),
      { once: true },
    );
    frameWindow.focus();
    frameWindow.print();
  });
  iframe.src = url;
  window.document.body.appendChild(iframe);
  window.setTimeout(cleanup, 60_000);
}

export function deliverCollectionExport(result: CollectionExportResult) {
  if (result.format === "pdf" && result.print) {
    printExportHtml(result);
    return;
  }
  if (result.format === "markdown") {
    if (!result.archiveFiles?.length) {
      throw new Error("Markdown export did not include package files.");
    }
    const archive = buildStoreOnlyZip(result.archiveFiles);
    const archiveBuffer = archive.buffer.slice(
      archive.byteOffset,
      archive.byteOffset + archive.byteLength,
    ) as ArrayBuffer;
    downloadBlob(
      new Blob([archiveBuffer], { type: "application/zip" }),
      result.filename,
    );
    return;
  }
  downloadBlob(
    new Blob([result.content], { type: result.mimeType }),
    result.filename,
  );
}

export function DatabaseExportDialog({
  documentId,
  context,
  open,
  onOpenChange,
}: {
  documentId: string;
  context: DatabaseExportContext | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const exportDocument = useActionMutation("export-document");
  const [format, setFormat] = useState<DatabaseExportFormat>("csv");
  const [scope, setScope] = useState<DatabaseExportScopeKind>("current_view");
  const [selections, setSelections] = useState(() =>
    defaultDatabaseExportSelections(context?.properties ?? []),
  );
  const [error, setError] = useState<string | null>(null);
  const wasOpenRef = useRef(false);
  const hasCurrentView = Boolean(context?.viewId.trim());
  const defaults = useMemo(
    () => defaultDatabaseExportSelections(context?.properties ?? []),
    [context],
  );
  const selection = selections[format];
  const scalarProperties =
    context?.properties.filter((property) => property.type !== "blocks") ?? [];
  const blockProperties = additionalDatabaseExportBlockProperties(
    context?.properties ?? [],
  );
  const formatLabels: Record<DatabaseExportFormat, string> = {
    csv: t("editor.toolbar.exportFormatCsv"),
    markdown: t("editor.toolbar.exportFormatMarkdown"),
    html: t("editor.toolbar.exportFormatHtml"),
    pdf: t("editor.toolbar.exportFormatPdf"),
  };

  useEffect(() => {
    if (shouldInitializeDatabaseExportDialog(wasOpenRef.current, open)) {
      setFormat("csv");
      setScope(hasCurrentView ? "current_view" : "all_members");
      setSelections(defaults);
      setError(null);
    }
    wasOpenRef.current = open;
  }, [defaults, hasCurrentView, open]);

  const updateSelection = (patch: Partial<DatabaseExportSelection>) => {
    setError(null);
    setSelections((current) =>
      updateDatabaseExportSelection(current, format, patch),
    );
  };

  const toggleId = (
    key: "propertyIds" | "blockPropertyIds",
    id: string,
    checked: boolean,
  ) => {
    const current = selection[key];
    updateSelection({
      [key]: checked
        ? [...new Set([...current, id])]
        : current.filter((candidate) => candidate !== id),
    });
  };

  const handleExport = async () => {
    if (!context || exportDocument.isPending) return;
    setError(null);
    try {
      const result = (await exportDocument.mutateAsync(
        databaseExportRequest({
          id: documentId,
          format,
          context,
          scope,
          selection,
        }),
      )) as CollectionExportResult;
      deliverCollectionExport(result);
      onOpenChange(false);
    } catch (caught) {
      setError(
        actionErrorMessage(caught) ??
          (caught instanceof Error
            ? caught.message
            : t("editor.toolbar.exportFailed")),
      );
    }
  };

  if (!context) return null;

  const setDialogOpen = (nextOpen: boolean) => {
    if (!nextOpen && exportDocument.isPending) return;
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={setDialogOpen}>
      <DialogContent
        className="max-h-[min(42rem,calc(100vh-2rem))] gap-5 overflow-y-auto sm:max-w-lg"
        data-database-export-dialog
      >
        <DialogHeader>
          <DialogTitle>{t("editor.toolbar.exportDatabase")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-5">
          <fieldset disabled={exportDocument.isPending}>
            <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("editor.toolbar.exportFormat")}
            </legend>
            <div
              className="grid grid-cols-2 gap-2 sm:grid-cols-4"
              role="radiogroup"
            >
              {EXPORT_FORMATS.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  role="radio"
                  aria-checked={format === candidate}
                  onClick={() => {
                    setError(null);
                    setFormat(candidate);
                  }}
                  className={cn(
                    "rounded-md border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                    format === candidate
                      ? "border-foreground bg-muted"
                      : "border-border hover:bg-muted/60",
                  )}
                >
                  {formatLabels[candidate]}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset disabled={exportDocument.isPending}>
            <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("editor.toolbar.exportScope")}
            </legend>
            {hasCurrentView ? (
              <div
                className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                role="radiogroup"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={scope === "current_view"}
                  onClick={() => {
                    setError(null);
                    setScope("current_view");
                  }}
                  className={cn(
                    "rounded-md border px-3 py-2 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                    scope === "current_view"
                      ? "border-foreground bg-muted"
                      : "border-border hover:bg-muted/60",
                  )}
                >
                  <span className="block font-medium">
                    {t("editor.toolbar.currentView")}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {context.viewName}
                  </span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={scope === "all_members"}
                  onClick={() => {
                    setError(null);
                    setScope("all_members");
                  }}
                  className={cn(
                    "rounded-md border px-3 py-2 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                    scope === "all_members"
                      ? "border-foreground bg-muted"
                      : "border-border hover:bg-muted/60",
                  )}
                >
                  <span className="block font-medium">
                    {t("editor.toolbar.allDatabaseMembers")}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t("editor.toolbar.allDatabaseMembersDetail")}
                  </span>
                </button>
              </div>
            ) : (
              <div className="rounded-md border border-foreground bg-muted px-3 py-2 text-sm font-medium">
                {t("editor.toolbar.allDatabaseMembers")}
              </div>
            )}
          </fieldset>

          <fieldset disabled={exportDocument.isPending}>
            <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("editor.toolbar.exportProperties")}
            </legend>
            <div className="max-h-44 overflow-y-auto pe-1">
              <label className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm">
                <Checkbox
                  checked
                  disabled
                  aria-label={t("editor.toolbar.titleColumn")}
                />
                <span>{t("editor.toolbar.titleColumn")}</span>
              </label>
              {scalarProperties.map((property) => (
                <label
                  key={property.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
                >
                  <Checkbox
                    checked={selection.propertyIds.includes(property.id)}
                    onCheckedChange={(value) =>
                      toggleId("propertyIds", property.id, value === true)
                    }
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {property.name}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset disabled={exportDocument.isPending}>
            <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("editor.toolbar.exportPageContent")}
            </legend>
            <div className="max-h-44 overflow-y-auto pe-1">
              <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60">
                <Checkbox
                  checked={selection.includePrimaryBody}
                  onCheckedChange={(value) =>
                    updateSelection({ includePrimaryBody: value === true })
                  }
                />
                <span>{t("editor.toolbar.primaryPageBody")}</span>
              </label>
              {blockProperties.map((property) => (
                <label
                  key={property.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
                >
                  <Checkbox
                    checked={selection.blockPropertyIds.includes(property.id)}
                    onCheckedChange={(value) =>
                      toggleId("blockPropertyIds", property.id, value === true)
                    }
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {property.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("editor.toolbar.blocksColumn")}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {error ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setDialogOpen(false)}
            disabled={exportDocument.isPending}
          >
            {t("comments.cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => void handleExport()}
            disabled={exportDocument.isPending}
          >
            {exportDocument.isPending ? (
              <IconLoader2 className="me-2 size-4 animate-spin" />
            ) : (
              <IconDownload className="me-2 size-4" />
            )}
            {exportDocument.isPending
              ? t("editor.toolbar.preparingExport", {
                  format: formatLabels[format],
                })
              : t("editor.toolbar.export")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
