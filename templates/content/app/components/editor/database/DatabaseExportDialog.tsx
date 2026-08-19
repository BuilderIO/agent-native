import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type {
  ContentDatabaseFilter,
  ContentDatabaseFilterMode,
  ContentDatabaseSort,
} from "@shared/api";
import { IconDownload, IconLoader2 } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

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

export type DatabaseExportScopeKind = "all_members" | "current_view";

export interface DatabaseExportProperty {
  id: string;
  name: string;
  type: string;
  visible: boolean;
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

interface DatabaseCsvResult {
  filename: string;
  mimeType: string;
  content: string;
}

export function defaultDatabaseCsvPropertyIds(
  properties: DatabaseExportProperty[],
) {
  return properties
    .filter((property) => property.visible && property.type !== "blocks")
    .map((property) => property.id);
}

export function databaseCsvRequest(args: {
  id: string;
  context: DatabaseExportContext;
  scope: DatabaseExportScopeKind;
  propertyIds: string[];
}) {
  return {
    id: args.id,
    format: "csv" as const,
    collection: {
      scope:
        args.scope === "current_view"
          ? {
              kind: "current_view" as const,
              viewId: args.context.viewId,
              query: args.context.query,
            }
          : { kind: "all_members" as const },
      propertyIds: args.propertyIds,
    },
  };
}

function downloadCsv(result: DatabaseCsvResult) {
  const blob = new Blob([result.content], { type: result.mimeType });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = result.filename;
  window.document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function DatabaseExportDialog({
  documentId,
  context,
  defaultScope,
  open,
  onOpenChange,
}: {
  documentId: string;
  context: DatabaseExportContext | null;
  defaultScope: DatabaseExportScopeKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const exportDocument = useActionMutation("export-document");
  const [scope, setScope] = useState<DatabaseExportScopeKind>(defaultScope);
  const [propertyIds, setPropertyIds] = useState<string[]>([]);
  const defaultPropertyIds = useMemo(
    () => defaultDatabaseCsvPropertyIds(context?.properties ?? []),
    [context],
  );

  useEffect(() => {
    if (!open) return;
    setScope(defaultScope);
    setPropertyIds(defaultPropertyIds);
  }, [defaultPropertyIds, defaultScope, open]);

  const toggleProperty = (id: string, checked: boolean) => {
    setPropertyIds((current) =>
      checked
        ? [...new Set([...current, id])]
        : current.filter((x) => x !== id),
    );
  };

  const handleExport = async () => {
    if (!context || exportDocument.isPending) return;
    try {
      const result = (await exportDocument.mutateAsync(
        databaseCsvRequest({ id: documentId, context, scope, propertyIds }),
      )) as DatabaseCsvResult;
      downloadCsv(result);
      toast.success(t("editor.toolbar.exportedCsv"));
      onOpenChange(false);
    } catch (error) {
      toast.error(t("editor.toolbar.exportFailed"), {
        description:
          error instanceof Error ? error.message : t("empty.genericError"),
      });
    }
  };

  if (!context) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 sm:max-w-md" data-database-export-dialog>
        <DialogHeader>
          <DialogTitle>{t("editor.toolbar.exportDatabase")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div
            className="grid grid-cols-2 gap-2"
            role="radiogroup"
            aria-label={t("editor.toolbar.exportScope")}
          >
            <button
              type="button"
              role="radio"
              aria-checked={scope === "current_view"}
              onClick={() => setScope("current_view")}
              className={cn(
                "rounded-md border px-3 py-2 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
              onClick={() => setScope("all_members")}
              className={cn(
                "rounded-md border px-3 py-2 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("editor.toolbar.exportColumns")}
            </div>
            <div className="max-h-56 space-y-1 overflow-y-auto pe-1">
              <label className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm">
                <Checkbox
                  checked
                  disabled
                  aria-label={t("editor.toolbar.titleColumn")}
                />
                <span>{t("editor.toolbar.titleColumn")}</span>
              </label>
              {context.properties.map((property) => {
                const checked = propertyIds.includes(property.id);
                const isBlocks = property.type === "blocks";
                return (
                  <label
                    key={property.id}
                    className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) =>
                        toggleProperty(property.id, value === true)
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {property.name}
                    </span>
                    {isBlocks ? (
                      <span className="text-xs text-muted-foreground">
                        {t("editor.toolbar.blocksColumn")}
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
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
              ? t("editor.toolbar.exporting")
              : t("editor.toolbar.exportCsv")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
