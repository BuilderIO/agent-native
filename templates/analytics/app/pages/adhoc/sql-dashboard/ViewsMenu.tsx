import { useT } from "@agent-native/core/client";
import {
  IconCheck,
  IconChevronDown,
  IconDeviceFloppy,
  IconLayoutGrid,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import { ResourceLoadError } from "@/components/ResourceLoadError";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useDashboardViews,
  type DashboardView,
} from "@/hooks/use-dashboard-views";
import { cn } from "@/lib/utils";

import { FILTER_PARAM_PREFIX } from "./DashboardFilterBar";

interface ViewsMenuProps {
  dashboardId: string;
  canEdit?: boolean;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || `view-${Math.random().toString(36).slice(2, 7)}`
  );
}

/** Extract all f_-prefixed filter params from the current URL. */
function extractCurrentFilters(
  searchParams: URLSearchParams,
): Record<string, string> {
  const result: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    if (key.startsWith(FILTER_PARAM_PREFIX)) {
      result[key] = value;
    }
  });
  return result;
}

/** Check if the saved view's filter map matches the current URL filter state. */
function filtersMatch(
  current: Record<string, string>,
  saved: Record<string, string>,
): boolean {
  const savedKeys = Object.keys(saved);
  const currentKeys = Object.keys(current);
  if (savedKeys.length !== currentKeys.length) return false;
  for (const k of savedKeys) {
    if (current[k] !== saved[k]) return false;
  }
  return true;
}

export function ViewsMenu({ dashboardId, canEdit = true }: ViewsMenuProps) {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const { views, error, refetch, saveView, deleteView } =
    useDashboardViews(dashboardId);

  const [menuOpen, setMenuOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [savingView, setSavingView] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DashboardView | null>(null);

  const currentFilters = useMemo(
    () => extractCurrentFilters(searchParams),
    [searchParams],
  );

  const selectedView = useMemo(() => {
    const paramViewId = searchParams.get("view");
    if (paramViewId) {
      const found = views.find((x) => x.id === paramViewId);
      if (found) return found;
    }
    return views.find((v) => filtersMatch(currentFilters, v.filters)) ?? null;
  }, [searchParams, views, currentFilters]);

  const hasFilterChanges = useMemo(() => {
    if (!selectedView) return false;
    return !filtersMatch(currentFilters, selectedView.filters);
  }, [selectedView, currentFilters]);

  const slugExists = useMemo(() => {
    const name = viewName.trim().toLowerCase();
    if (!name) return false;

    const baseSlug = viewName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);

    return views.some((v) => {
      const existingName = v.name.trim().toLowerCase();
      if (existingName === name) return true;
      if (baseSlug && v.id === baseSlug) return true;
      return false;
    });
  }, [viewName, views]);

  const handleUpdateActiveView = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedView) return;
    try {
      await saveView({
        id: selectedView.id,
        name: selectedView.name,
        filters: currentFilters,
      });
      toast.success(
        t("sqlDashboard.savedFiltersTo", { name: selectedView.name }),
      );
    } catch {
      toast.error(t("sqlDashboard.failedToSave"));
    }
  };

  const applyView = (view: DashboardView) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      // Strip all existing f_ params first, then apply the view's filters.
      const toDelete: string[] = [];
      next.forEach((_, k) => {
        if (k.startsWith(FILTER_PARAM_PREFIX)) toDelete.push(k);
      });
      toDelete.forEach((k) => next.delete(k));
      for (const [k, v] of Object.entries(view.filters)) {
        if (v) next.set(k, v);
      }
      next.set("view", view.id);
      return next;
    });
    setMenuOpen(false);
  };

  const handleSaveView = async () => {
    const name = viewName.trim();
    if (!name || savingView || slugExists) return;
    setSavingView(true);
    try {
      const newId = slugify(name);
      await saveView({
        id: newId,
        name,
        filters: currentFilters,
      });
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("view", newId);
          return next;
        },
        { replace: true },
      );
      setViewName("");
      setSaveDialogOpen(false);
    } finally {
      setSavingView(false);
    }
  };

  const handleDeleteView = async () => {
    if (!deleteTarget) return;
    const viewId = deleteTarget.id;
    await deleteView(viewId);
    if (searchParams.get("view") === viewId || views.length <= 1) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("view");
          return next;
        },
        { replace: true },
      );
    }
    setDeleteTarget(null);
  };

  const triggerLabel = selectedView
    ? selectedView.name
    : t("sqlDashboard.views");

  return (
    <>
      <div className="flex items-center gap-1.5">
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs gap-1.5"
                >
                  <IconLayoutGrid className="h-3.5 w-3.5" />
                  <span className="max-w-[160px] truncate">{triggerLabel}</span>
                  <IconChevronDown className="h-3 w-3 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t("sqlDashboard.savedViews")}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuLabel className="flex items-center justify-between text-xs text-muted-foreground font-semibold">
              <span>{t("sqlDashboard.savedViews")}</span>
              {canEdit && (
                <button
                  type="button"
                  className="h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground rounded hover:bg-muted"
                  onClick={(e) => {
                    e.preventDefault();
                    setMenuOpen(false);
                    setViewName("");
                    setSaveDialogOpen(true);
                  }}
                  title={t("sqlDashboard.saveAsView")}
                >
                  <IconPlus className="h-3.5 w-3.5" />
                </button>
              )}
            </DropdownMenuLabel>
            {error ? (
              <ResourceLoadError
                inline
                message={t("commandPalette.loadFailed")}
                retryLabel={t("sidebar.retry")}
                onRetry={() => void refetch()}
              />
            ) : views.length === 0 ? (
              <div className="px-2 py-2 text-xs text-muted-foreground">
                {t("sqlDashboard.noSavedViews")}
              </div>
            ) : (
              views.map((v) => (
                <DropdownMenuItem
                  key={v.id}
                  className={cn(
                    "group flex items-center justify-between gap-2",
                    selectedView?.id === v.id && "bg-muted font-medium",
                  )}
                  onSelect={(e) => {
                    e.preventDefault();
                    applyView(v);
                  }}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {selectedView?.id === v.id && (
                      <IconCheck className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="truncate">{v.name}</span>
                  </div>
                  {canEdit ? (
                    <div className="flex items-center gap-1 shrink-0">
                      {v.id === selectedView?.id && hasFilterChanges && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 text-muted-foreground hover:text-foreground"
                          onClick={async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            try {
                              await saveView({
                                id: v.id,
                                name: v.name,
                                filters: currentFilters,
                              });
                              toast.success(
                                t("sqlDashboard.savedFiltersTo", {
                                  name: v.name,
                                }),
                              );
                            } catch {
                              toast.error(t("sqlDashboard.failedToSave"));
                            }
                          }}
                          title={t("sqlDashboard.saveCurrentFiltersTo", {
                            name: v.name,
                          })}
                        >
                          <IconDeviceFloppy className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDeleteTarget(v);
                              setMenuOpen(false);
                            }}
                          >
                            <IconTrash className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("sqlDashboard.deleteView", { name: v.name })}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  ) : null}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {canEdit && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0 border border-input bg-background hover:bg-accent"
                onClick={(e) => {
                  e.preventDefault();
                  setViewName("");
                  setSaveDialogOpen(true);
                }}
              >
                <IconPlus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("sqlDashboard.saveAsView")}</TooltipContent>
          </Tooltip>
        )}

        {canEdit && selectedView && hasFilterChanges && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0 border border-input bg-background hover:bg-accent"
                onClick={handleUpdateActiveView}
              >
                <IconDeviceFloppy className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t("sqlDashboard.saveCurrentFiltersTo", {
                name: selectedView.name,
              })}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      <Dialog open={canEdit && saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t("sqlDashboard.saveView")}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Input
              placeholder={t("sqlDashboard.viewNameEnterprisePlaceholder")}
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSaveView();
              }}
              autoFocus
            />
            {slugExists && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400 font-medium">
                {t("sqlDashboard.viewNameExists")}
              </p>
            )}
            {Object.keys(currentFilters).length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("sqlDashboard.noActiveFilters")}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSaveDialogOpen(false)}
              disabled={savingView}
            >
              {t("sidebar.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={handleSaveView}
              disabled={!viewName.trim() || savingView || slugExists}
            >
              {savingView ? t("sqlDashboard.saving") : t("sqlDashboard.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={canEdit && !!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("sqlDashboard.deleteViewTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("sqlDashboard.deleteViewDescription", {
                name: deleteTarget?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("sidebar.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteView}>
              {t("sidebar.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
