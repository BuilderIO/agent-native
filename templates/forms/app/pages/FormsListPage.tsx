import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { format } from "date-fns";
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { VisibilityBadge } from "@agent-native/core/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useForms,
  useCreateForm,
  useDeleteForm,
  useRestoreForm,
  useUpdateForm,
} from "@/hooks/use-forms";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { useDbStatus } from "@/hooks/use-db-status";
import { CloudUpgrade } from "@/components/CloudUpgrade";
import {
  useSetHeaderActions,
  useSetPageTitle,
} from "@/components/layout/HeaderActions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const statusColors: Record<string, string> = {
  draft:
    "bg-amber-600/10 text-amber-600 dark:text-amber-400 border-amber-600/20",
  published:
    "bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 border-emerald-600/20",
  closed: "bg-destructive/10 text-destructive border-destructive/20",
};

export function FormsListPage() {
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
      const visibleIds = new Set(forms.map((form) => form.id));
      const next = new Set([...prev].filter((id) => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [forms]);

  function handleCreate() {
    const tempId = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
    navigate(`/forms/${tempId}`);
    createForm.mutate(
      { title: "Untitled Form" },
      { onSuccess: (form) => navigate(`/forms/${form.id}`, { replace: true }) },
    );
  }

  useSetPageTitle("Forms");

  const headerActions = useMemo(
    () => (
      <Button onClick={handleCreate} className="gap-2 shrink-0 cursor-pointer">
        <IconPlus className="h-4 w-4" />
        <span className="hidden sm:inline">New Form</span>
        <span className="sm:hidden">New</span>
      </Button>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useSetHeaderActions(headerActions);

  function handleDuplicate(form: (typeof forms)[0]) {
    createForm.mutate(
      {
        title: `${form.title} (copy)`,
        description: form.description,
        fields: form.fields,
        settings: form.settings,
      },
      {
        onSuccess: (newForm) => {
          toast.success("Form duplicated");
          navigate(`/forms/${newForm.id}`);
        },
      },
    );
  }

  function handleDelete(id: string) {
    deleteForm.mutate(
      { id },
      {
        onSuccess: () => toast.success("Form moved to Archive"),
      },
    );
  }

  function handleRestore(id: string) {
    restoreForm.mutate(
      { id },
      {
        onSuccess: () => toast.success("Form restored"),
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
        onSuccess: () => toast.success("Form permanently deleted"),
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
      if (forms.length > 0 && forms.every((form) => prev.has(form.id))) {
        return new Set();
      }
      return new Set(forms.map((form) => form.id));
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
            ? "Form permanently deleted"
            : "Form moved to Archive"
          : purge
            ? `${ids.length} forms permanently deleted`
            : `${ids.length} forms moved to Archive`,
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
            newStatus === "published" ? "Form published" : "Form unpublished",
          ),
      },
    );
  }

  if (isLoading) {
    return (
      <div className="p-3 sm:p-6 max-w-5xl mx-auto">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="border border-border rounded-xl p-4 sm:p-5 bg-card"
            >
              <div className="flex items-start justify-between mb-3 gap-2">
                <div className="flex-1 min-w-0 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-8 w-8 rounded-md shrink-0" />
              </div>
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-4 w-14 rounded-full" />
                <div className="flex items-center gap-3">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-10" />
                </div>
              </div>
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
            Sign in to see your forms.
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
            Sign in
          </Button>
        </div>
      );
    }
    const reason =
      error instanceof Error
        ? error.message.replace(/^Action list-forms failed:\s*/, "")
        : "Couldn't load forms";
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
          Retry
        </Button>
      </div>
    );
  }

  const isArchive = view === "archive";
  const selectedCount = selectedIds.size;
  const allFormsSelected =
    forms.length > 0 && forms.every((form) => selectedIds.has(form.id));

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Tabs
          value={view}
          onValueChange={(v) => setView(v as "active" | "archive")}
        >
          <TabsList>
            <TabsTrigger value="active" className="text-xs gap-1.5">
              Forms
            </TabsTrigger>
            <TabsTrigger value="archive" className="text-xs gap-1.5">
              <IconArchive className="h-3.5 w-3.5" />
              Archive
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
            {selectionMode ? "Done" : "Select"}
          </Button>
        )}
      </div>

      {selectionMode && forms.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
          <span className="text-xs font-medium text-foreground">
            {selectedCount} selected
          </span>
          <div className="h-4 w-px bg-border" />
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={toggleSelectAll}
          >
            {allFormsSelected ? "Clear all" : "Select all"}
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
            {isArchive ? "Delete forever" : "Move to Archive"}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-8 w-8"
            onClick={clearSelection}
            aria-label="Exit selection mode"
          >
            <IconX className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {forms.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 border border-dashed border-border rounded-xl">
          {isArchive ? (
            <>
              <h3 className="font-medium mb-1">Archive is empty</h3>
              <p className="text-sm text-muted-foreground">
                Deleted forms appear here. Their responses are kept until you
                permanently delete them.
              </p>
            </>
          ) : (
            <>
              <h3 className="font-medium mb-1">No forms yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Create your first form to get started
              </p>
              <Button onClick={handleCreate} size="sm" className="gap-2">
                <IconPlus className="h-4 w-4" />
                Create Form
              </Button>
            </>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {forms.map((form) => {
            const selected = selectedIds.has(form.id);

            return (
              <div
                key={form.id}
                className={cn(
                  "group relative border border-border rounded-xl p-4 sm:p-5 cursor-pointer bg-card",
                  isArchive
                    ? "opacity-80 hover:opacity-100 hover:border-border"
                    : "hover:border-primary/30",
                  selectionMode && "hover:border-primary/40 hover:bg-accent/20",
                  selected && "border-primary/60 ring-1 ring-primary/20",
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
                <div className="flex items-start justify-between gap-2 mb-3 min-w-0">
                  <div className="flex flex-1 items-start gap-2 min-w-0">
                    {selectionMode && (
                      <Checkbox
                        checked={selected}
                        onCheckedChange={() => toggleSelection(form.id)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Select ${form.title}`}
                        className="mt-0.5 shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <h3 className="font-medium truncate flex-1 min-w-0">
                          {form.title}
                        </h3>
                        <VisibilityBadge
                          visibility={(form as any).visibility}
                          className="shrink-0"
                        />
                      </div>
                      {form.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {form.description}
                        </p>
                      )}
                    </div>
                  </div>
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
                          aria-label="Form actions"
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
                              <IconChartBar className="h-4 w-4 mr-2" />
                              View Responses
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRestore(form.id);
                              }}
                            >
                              <IconArchiveOff className="h-4 w-4 mr-2" />
                              Restore
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPurgeId(form.id);
                              }}
                            >
                              <IconTrash className="h-4 w-4 mr-2" />
                              Delete forever
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
                                  <IconExternalLink className="h-4 w-4 mr-2" />
                                  Open
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
                                  <IconChartBar className="h-4 w-4 mr-2" />
                                  View Responses
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleTogglePublish(form);
                                  }}
                                >
                                  <IconExternalLink className="h-4 w-4 mr-2" />
                                  {form.status === "published"
                                    ? "Unpublish"
                                    : "Publish"}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDuplicate(form);
                                  }}
                                >
                                  <IconCopy className="h-4 w-4 mr-2" />
                                  Duplicate
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDelete(form.id);
                                  }}
                                >
                                  <IconTrash className="h-4 w-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </>
                            );
                          })()
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] shrink-0",
                      statusColors[form.status],
                    )}
                  >
                    {form.status}
                  </Badge>
                  <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="block min-w-0 max-w-full truncate">
                      {form.responseCount ?? 0} responses
                    </span>
                    <span className="block min-w-0 max-w-full truncate">
                      {isArchive && (form as any).deletedAt
                        ? `Deleted ${format(new Date((form as any).deletedAt), "MMM d")}`
                        : format(new Date(form.createdAt), "MMM d")}
                    </span>
                  </div>
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
            <AlertDialogTitle>Permanently delete this form?</AlertDialogTitle>
            <AlertDialogDescription>
              The form and all its responses will be deleted forever. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handlePurge}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkPurgeOpen} onOpenChange={setBulkPurgeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Permanently delete selected forms?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The {selectedCount} selected{" "}
              {selectedCount === 1 ? "form" : "forms"} and their responses will
              be deleted forever. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeletePending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleBulkDelete(true)}
              disabled={bulkDeletePending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {showCloudUpgrade && (
        <CloudUpgrade
          title="Publish Form"
          description="To publish forms publicly, connect a cloud database so submissions can be received from anywhere."
          onClose={() => setShowCloudUpgrade(false)}
        />
      )}
    </div>
  );
}
