import {
  VisibilityBadge,
  callAction,
  useFormatters,
  useT,
} from "@agent-native/core/client";
import {
  IconPlus,
  IconDots,
  IconTrash,
  IconCopy,
  IconExternalLink,
  IconChartBar,
  IconRefresh,
  IconArchive,
  IconArchiveOff,
  IconChecks,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { CloudUpgrade } from "@/components/CloudUpgrade";
import {
  useSetHeaderActions,
  useSetPageTitle,
} from "@/components/layout/HeaderActions";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDbStatus } from "@/hooks/use-db-status";
import {
  useForms,
  useCreateForm,
  useDeleteForm,
  useRestoreForm,
  useUpdateForm,
} from "@/hooks/use-forms";
import { cn } from "@/lib/utils";

const statusColors: Record<string, string> = {
  draft:
    "bg-amber-600/10 text-amber-600 dark:text-amber-400 border-amber-600/20",
  published:
    "bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 border-emerald-600/20",
  closed: "bg-destructive/10 text-destructive border-destructive/20",
};

export function FormsListPage() {
  const t = useT();
  const { formatDate, formatNumber } = useFormatters();
  const navigate = useNavigate();
  const [view, setView] = useState<"active" | "archive">("active");
  const {
    data: forms = [],
    isLoading,
    error,
    refetch,
  } = useForms({ archived: view === "archive" });
  const createForm = useCreateForm();
  const deleteForm = useDeleteForm();
  const restoreForm = useRestoreForm();
  const updateForm = useUpdateForm();
  const { isLocal } = useDbStatus();
  const [showCloudUpgrade, setShowCloudUpgrade] = useState(false);
  const [purgeId, setPurgeId] = useState<string | null>(null);
  const [bulkPurgeOpen, setBulkPurgeOpen] = useState(false);
  const [bulkDeletePending, setBulkDeletePending] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, [view]);

  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const visibleIds = new Set(forms.map((form: any) => form.id));
      const next = new Set([...prev].filter((id) => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [forms]);

  function handleCreate() {
    const tempId = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
    navigate(`/forms/${tempId}`);
    createForm.mutate(
      { title: t("forms.untitled") },
      { onSuccess: (form) => navigate(`/forms/${form.id}`, { replace: true }) },
    );
  }

  useSetPageTitle(t("header.forms"));

  const headerActions = useMemo(
    () => (
      <Button
        onClick={handleCreate}
        size="sm"
        className="shrink-0 cursor-pointer"
      >
        <IconPlus className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{t("forms.newForm")}</span>
        <span className="sm:hidden">{t("forms.new")}</span>
      </Button>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useSetHeaderActions(headerActions);

  async function handleDuplicate(form: (typeof forms)[0]) {
    // The list payload no longer ships the heavy `fields` / `settings` JSON,
    // so fetch the full form on demand to clone its schema and settings.
    try {
      const full = await callAction("get-form", { id: form.id });
      createForm.mutate(
        {
          title: t("forms.copyTitle", { title: full.title }),
          description: full.description,
          fields: full.fields,
          settings: full.settings,
        },
        {
          onSuccess: (newForm) => {
            toast.success(t("forms.duplicated"));
            navigate(`/forms/${newForm.id}`);
          },
        },
      );
    } catch {
      toast.error(t("forms.duplicateFailed"));
    }
  }

  function handleDelete(id: string) {
    deleteForm.mutate(
      { id },
      {
        onSuccess: () => toast.success(t("forms.movedToArchive")),
      },
    );
  }

  function handleRestore(id: string) {
    restoreForm.mutate(
      { id },
      {
        onSuccess: () => toast.success(t("forms.restored")),
      },
    );
  }

  function handlePurge() {
    if (!purgeId) return;
    const id = purgeId;
    setPurgeId(null);
    deleteForm.mutate(
      { id, purge: true },
      {
        onSuccess: () => toast.success(t("forms.permanentlyDeleted")),
      },
    );
  }

  function toggleSelection(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setSelectionMode(false);
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      if (forms.length > 0 && forms.every((form: any) => prev.has(form.id))) {
        return new Set();
      }
      return new Set(forms.map((form: any) => form.id));
    });
  }

  async function handleBulkDelete(purge = false) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    setBulkDeletePending(true);
    try {
      await Promise.all(
        ids.map((id) =>
          deleteForm.mutateAsync({
            id,
            purge,
          }),
        ),
      );
      toast.success(
        ids.length === 1
          ? purge
            ? t("forms.permanentlyDeleted")
            : t("forms.movedToArchive")
          : purge
            ? t("forms.bulkPermanentlyDeleted", {
                count: ids.length,
                formattedCount: formatNumber(ids.length),
              })
            : t("forms.bulkMovedToArchive", {
                count: ids.length,
                formattedCount: formatNumber(ids.length),
              }),
      );
      setSelectedIds(new Set());
      setSelectionMode(false);
      setBulkPurgeOpen(false);
    } finally {
      setBulkDeletePending(false);
    }
  }

  function handleTogglePublish(form: (typeof forms)[0]) {
    const newStatus = form.status === "published" ? "draft" : "published";
    if (newStatus === "published" && isLocal) {
      setShowCloudUpgrade(true);
      return;
    }
    updateForm.mutate(
      { id: form.id, status: newStatus },
      {
        onSuccess: () =>
          toast.success(
            newStatus === "published"
              ? t("forms.published")
              : t("forms.unpublished"),
          ),
      },
    );
  }

  if (isLoading) {
    return (
      <div className="p-3 sm:p-6 max-w-5xl mx-auto">
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="grid gap-3 border-b border-border px-3 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_120px_120px_80px]"
            >
              <div className="min-w-0 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-8 rounded-md md:ms-auto" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error && !forms?.length) {
    const status = (error as { status?: number })?.status;
    if (status === 401) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3">
          <p className="text-sm text-muted-foreground">
            {t("forms.signInPrompt")}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const next = encodeURIComponent(
                window.location.pathname + window.location.search,
              );
              window.location.href = `/login?next=${next}`;
            }}
          >
            {t("common.signIn")}
          </Button>
        </div>
      );
    }
    const reason =
      error instanceof Error
        ? error.message.replace(/^Action list-forms failed:\s*/, "")
        : t("forms.loadFailed");
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-4 text-center">
        <p className="text-sm text-muted-foreground max-w-sm">{reason}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="gap-2"
        >
          <IconRefresh className="h-3.5 w-3.5" />
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  const isArchive = view === "archive";
  const selectedCount = selectedIds.size;
  const allFormsSelected =
    forms.length > 0 && forms.every((form: any) => selectedIds.has(form.id));

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Tabs
          value={view}
          onValueChange={(v) => setView(v as "active" | "archive")}
        >
          <TabsList>
            <TabsTrigger value="active" className="text-xs gap-1.5">
              {t("header.forms")}
            </TabsTrigger>
            <TabsTrigger value="archive" className="text-xs gap-1.5">
              <IconArchive className="h-3.5 w-3.5" />
              {t("forms.archive")}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {forms.length > 0 && (
          <Button
            variant={selectionMode ? "secondary" : "ghost"}
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => {
              setSelectionMode((current) => {
                if (current) setSelectedIds(new Set());
                return !current;
              });
            }}
          >
            <IconChecks className="h-3.5 w-3.5" />
            {selectionMode ? t("common.done") : t("common.select")}
          </Button>
        )}
      </div>

      {selectionMode && forms.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
          <span className="text-xs font-medium text-foreground">
            {t("forms.selectedCount", {
              count: selectedCount,
              formattedCount: formatNumber(selectedCount),
            })}
          </span>
          <div className="h-4 w-px bg-border" />
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={toggleSelectAll}
          >
            {allFormsSelected ? t("common.clearAll") : t("common.selectAll")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive"
            onClick={() =>
              isArchive ? setBulkPurgeOpen(true) : handleBulkDelete(false)
            }
            disabled={selectedCount === 0 || bulkDeletePending}
          >
            <IconTrash className="h-3.5 w-3.5" />
            {isArchive ? t("forms.deleteForever") : t("forms.moveToArchive")}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="ms-auto h-8 w-8"
            onClick={clearSelection}
            aria-label={t("forms.exitSelectionMode")}
          >
            <IconX className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {forms.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 border border-dashed border-border rounded-xl">
          {isArchive ? (
            <>
              <h3 className="font-medium mb-1">
                {t("forms.archiveEmptyTitle")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("forms.archiveEmptyDescription")}
              </p>
            </>
          ) : (
            <>
              <h3 className="font-medium mb-1">{t("forms.emptyTitle")}</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {t("forms.emptyDescription")}
              </p>
              <Button onClick={handleCreate} size="sm" className="gap-2">
                <IconPlus className="h-4 w-4" />
                {t("forms.createForm")}
              </Button>
            </>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {forms.map((form: any) => {
            const selected = selectedIds.has(form.id);
            const dateLabel =
              isArchive && (form as any).deletedAt
                ? t("forms.deletedDate", {
                    date: formatDate((form as any).deletedAt, {
                      month: "short",
                      day: "numeric",
                    }),
                  })
                : formatDate(form.createdAt, {
                    month: "short",
                    day: "numeric",
                  });

            return (
              <div
                key={form.id}
                className={cn(
                  "group grid cursor-pointer gap-3 border-b border-border px-3 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_110px_140px_88px_40px] md:items-center",
                  isArchive
                    ? "opacity-80 hover:opacity-100 hover:bg-accent/25"
                    : "hover:bg-accent/25",
                  selectionMode && "hover:bg-accent/30",
                  selected && "bg-accent/35 ring-1 ring-inset ring-primary/20",
                )}
                role="button"
                tabIndex={0}
                aria-pressed={selectionMode ? selected : undefined}
                onClick={() => {
                  if (selectionMode) {
                    toggleSelection(form.id);
                    return;
                  }
                  navigate(
                    isArchive
                      ? `/forms/${form.id}/responses`
                      : `/forms/${form.id}`,
                  );
                }}
                onKeyDown={(e) => {
                  if (
                    (e.key === "Enter" || e.key === " ") &&
                    e.target === e.currentTarget
                  ) {
                    e.preventDefault();
                    if (selectionMode) {
                      toggleSelection(form.id);
                      return;
                    }
                    navigate(
                      isArchive
                        ? `/forms/${form.id}/responses`
                        : `/forms/${form.id}`,
                    );
                  }
                }}
              >
                <div className="flex min-w-0 items-start gap-2.5">
                  {selectionMode && (
                    <Checkbox
                      checked={selected}
                      onCheckedChange={() => toggleSelection(form.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={t("forms.selectForm", {
                        title: form.title,
                      })}
                      className="mt-0.5 shrink-0"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <h3 className="min-w-0 flex-1 truncate text-sm font-medium">
                        {form.title}
                      </h3>
                      <VisibilityBadge
                        visibility={(form as any).visibility}
                        className="shrink-0"
                      />
                    </div>
                    {form.description && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {form.description}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center md:justify-start">
                  <Badge
                    variant="outline"
                    className={cn("text-[10px]", statusColors[form.status])}
                  >
                    {form.status}
                  </Badge>
                </div>

                <div className="min-w-0 text-xs text-muted-foreground">
                  {t("responses.totalCount", {
                    count: form.responseCount ?? 0,
                    formattedCount: formatNumber(form.responseCount ?? 0),
                  })}
                </div>

                <div className="min-w-0 text-xs text-muted-foreground">
                  {dateLabel}
                </div>

                <div className="flex justify-end">
                  {!selectionMode && (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        asChild
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-10 w-10 sm:h-8 sm:w-8 p-0 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100"
                          aria-label={t("forms.formActions")}
                        >
                          <IconDots className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {isArchive ? (
                          <>
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/forms/${form.id}/responses`);
                              }}
                            >
                              <IconChartBar className="h-4 w-4 me-2" />
                              {t("forms.viewResponses")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRestore(form.id);
                              }}
                            >
                              <IconArchiveOff className="h-4 w-4 me-2" />
                              {t("forms.restore")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPurgeId(form.id);
                              }}
                            >
                              <IconTrash className="h-4 w-4 me-2" />
                              {t("forms.deleteForever")}
                            </DropdownMenuItem>
                          </>
                        ) : (
                          (() => {
                            // Viewers see a form they were granted access to but
                            // can't manage it: hide Delete, Publish/Unpublish, and
                            // Duplicate. Viewing responses is also editor-only —
                            // submissions are sensitive and view access on the
                            // form structure shouldn't grant access to them.
                            const formRole = (form as any).role as
                              | "owner"
                              | "viewer"
                              | "editor"
                              | "admin"
                              | undefined;
                            const formCanEdit =
                              formRole === "owner" ||
                              formRole === "editor" ||
                              formRole === "admin";
                            if (!formCanEdit) {
                              return (
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigate(`/forms/${form.id}`);
                                  }}
                                >
                                  <IconExternalLink className="h-4 w-4 me-2" />
                                  {t("common.open")}
                                </DropdownMenuItem>
                              );
                            }
                            return (
                              <>
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigate(`/forms/${form.id}/responses`);
                                  }}
                                >
                                  <IconChartBar className="h-4 w-4 me-2" />
                                  {t("forms.viewResponses")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleTogglePublish(form);
                                  }}
                                >
                                  <IconExternalLink className="h-4 w-4 me-2" />
                                  {form.status === "published"
                                    ? t("forms.unpublish")
                                    : t("forms.publish")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDuplicate(form);
                                  }}
                                >
                                  <IconCopy className="h-4 w-4 me-2" />
                                  {t("forms.duplicate")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDelete(form.id);
                                  }}
                                >
                                  <IconTrash className="h-4 w-4 me-2" />
                                  {t("common.delete")}
                                </DropdownMenuItem>
                              </>
                            );
                          })()
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog
        open={purgeId !== null}
        onOpenChange={(open) => {
          if (!open) setPurgeId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("forms.purgeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("forms.purgeDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handlePurge}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("forms.deleteForever")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkPurgeOpen} onOpenChange={setBulkPurgeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("forms.bulkPurgeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("forms.bulkPurgeDescription", {
                count: selectedCount,
                formattedCount: formatNumber(selectedCount),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeletePending}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleBulkDelete(true)}
              disabled={bulkDeletePending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("forms.deleteForever")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {showCloudUpgrade && (
        <CloudUpgrade
          title={t("forms.publishCloudTitle")}
          description={t("forms.publishCloudDescription")}
          onClose={() => setShowCloudUpgrade(false)}
        />
      )}
    </div>
  );
}
