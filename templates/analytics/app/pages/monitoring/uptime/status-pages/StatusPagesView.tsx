/**
 * Status-pages config sub-view. Query-param driven, consistent with the monitor
 * sub-views:
 *   - index:  ?view=uptime&statuspage=list
 *   - create: ?view=uptime&statuspage=new
 *   - edit:   ?view=uptime&statuspage=<id>
 * The index lists existing pages (with copy-link / open / edit / delete); the
 * editor (StatusPageEditor) handles create + edit with a live preview.
 */
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import {
  IconArrowLeft,
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconLink,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { fmt, useStatusPagesT } from "./i18n";
import { StatusPageEditor } from "./StatusPageEditor";
import type { StatusPage } from "./types";

function statusPageOrigin(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

export function StatusPagesView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const param = searchParams.get("statuspage");

  const updateParams = (
    mutate: (params: URLSearchParams) => void,
    options?: { replace?: boolean },
  ) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        mutate(params);
        return params;
      },
      { replace: options?.replace ?? false },
    );
  };

  const goToMonitors = () =>
    updateParams((params) => {
      params.delete("statuspage");
      params.delete("monitor");
      params.delete("edit");
    });
  const goToIndex = (options?: { replace?: boolean }) =>
    updateParams((params) => params.set("statuspage", "list"), options);
  const goToNew = () =>
    updateParams((params) => params.set("statuspage", "new"));
  const goToEdit = (id: string, options?: { replace?: boolean }) =>
    updateParams((params) => params.set("statuspage", id), options);

  if (param && param !== "list") {
    return (
      <StatusPageEditor
        pageId={param === "new" ? null : param}
        onBack={goToIndex}
        onCreated={(id) => goToEdit(id, { replace: true })}
      />
    );
  }

  return (
    <StatusPagesIndex onBack={goToMonitors} onNew={goToNew} onEdit={goToEdit} />
  );
}

function StatusPagesIndex({
  onBack,
  onNew,
  onEdit,
}: {
  onBack: () => void;
  onNew: () => void;
  onEdit: (id: string) => void;
}) {
  const t = useStatusPagesT();
  const { data, isLoading } = useActionQuery<StatusPage[]>(
    "list-status-pages",
    undefined,
    { staleTime: 15_000 },
  );
  const deletePage = useActionMutation<{ id: string }, { id: string }>(
    "delete-status-page",
    { method: "DELETE" },
  );
  const [toDelete, setToDelete] = useState<StatusPage | null>(null);
  const pages = Array.isArray(data) ? data : [];

  const confirmDelete = async () => {
    if (!toDelete) return;
    const target = toDelete;
    setToDelete(null);
    try {
      await deletePage.mutateAsync({ id: target.id });
      toast.success(t.deletedToast);
    } catch (err) {
      toast.error(
        fmt(t.deleteFailed, {
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  };

  return (
    <div className="space-y-5">
      <Button
        variant="ghost"
        size="sm"
        className="-ms-2 w-fit text-muted-foreground"
        onClick={onBack}
      >
        <IconArrowLeft className="size-3.5" />
        {t.back}
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{t.title}</h2>
          <p className="max-w-xl text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
        <Button size="sm" onClick={onNew} className="shrink-0">
          <IconPlus className="size-3.5" />
          {t.newPage}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : pages.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-16 text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10">
            <IconLink className="size-7 text-primary" />
          </div>
          <h3 className="text-lg font-semibold">{t.emptyTitle}</h3>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
            {t.emptyDescription}
          </p>
          <Button className="mt-5" size="sm" onClick={onNew}>
            <IconPlus className="size-3.5" />
            {t.emptyCta}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {pages.map((page) => (
            <StatusPageRow
              key={page.id}
              page={page}
              onEdit={() => onEdit(page.id)}
              onDelete={() => setToDelete(page)}
            />
          ))}
        </div>
      )}

      <AlertDialog
        open={!!toDelete}
        onOpenChange={(open) => !open && setToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {fmt(t.deleteDescription, {
                title: toDelete?.title ?? "",
                slug: toDelete?.slug ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t.deleteConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatusPageRow({
  page,
  onEdit,
  onDelete,
}: {
  page: StatusPage;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useStatusPagesT();
  const [copied, setCopied] = useState(false);
  const publicUrl = `${statusPageOrigin()}/status/${page.slug}`;
  const count = page.monitors.length;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t.copyFailed);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onEdit();
        }
      }}
      className="group flex cursor-pointer items-center gap-4 rounded-lg border border-border/50 bg-card px-4 py-3 transition-colors hover:border-border hover:bg-muted/30"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{page.title}</span>
          <Badge
            variant={page.published ? "default" : "secondary"}
            className="shrink-0 text-[10px]"
          >
            {page.published ? t.publishedBadge : t.draftBadge}
          </Badge>
        </div>
        <div className="truncate text-xs text-muted-foreground">
          /status/{page.slug}
          <span className="text-muted-foreground/70">
            {" · "}
            {count === 0
              ? t.noMonitorsOnPage
              : fmt(count === 1 ? t.oneMonitor : t.monitorsCount, { count })}
          </span>
        </div>
      </div>

      <div
        className="flex shrink-0 items-center gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              onClick={copyLink}
              aria-label={t.copyLink}
            >
              {copied ? (
                <IconCheck className="size-3.5" />
              ) : (
                <IconCopy className="size-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copied ? t.copied : t.copyLink}</TooltipContent>
        </Tooltip>
        {page.published ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground"
                asChild
              >
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={t.openPage}
                >
                  <IconExternalLink className="size-3.5" />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t.openPage}</TooltipContent>
          </Tooltip>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              onClick={onEdit}
              aria-label={t.edit}
            >
              <IconPencil className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t.edit}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
              aria-label={t.delete}
            >
              <IconTrash className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t.delete}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
