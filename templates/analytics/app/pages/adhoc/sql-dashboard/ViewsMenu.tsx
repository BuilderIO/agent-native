import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  IconChevronDown,
  IconDeviceFloppy,
  IconTrash,
  IconLayoutGrid,
} from "@tabler/icons-react";
import {
  useDashboardViews,
  type DashboardView,
} from "@/hooks/use-dashboard-views";
import { FILTER_PARAM_PREFIX } from "./DashboardFilterBar";

interface ViewsMenuProps {
  dashboardId: string;
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

export function ViewsMenu({ dashboardId }: ViewsMenuProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { views, saveView, deleteView } = useDashboardViews(dashboardId);

  const [menuOpen, setMenuOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [savingView, setSavingView] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DashboardView | null>(null);

  const currentFilters = useMemo(
    () => extractCurrentFilters(searchParams),
    [searchParams],
  );

  const activeView = useMemo(() => {
    const paramViewId = searchParams.get("view");
    if (paramViewId) {
      const v = views.find((x) => x.id === paramViewId);
      if (v && filtersMatch(currentFilters, v.filters)) return v;
    }
    // Fall back to any view whose filter set matches exactly.
    return views.find((v) => filtersMatch(currentFilters, v.filters)) ?? null;
  }, [searchParams, views, currentFilters]);

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
    if (!name || savingView) return;
    setSavingView(true);
    try {
      await saveView({
        id: slugify(name),
        name,
        filters: currentFilters,
      });
      setViewName("");
      setSaveDialogOpen(false);
    } finally {
      setSavingView(false);
    }
  };

  const handleDeleteView = async () => {
    if (!deleteTarget) return;
    await deleteView(deleteTarget.id);
    setDeleteTarget(null);
  };

  const triggerLabel = activeView ? activeView.name : "Views";

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs gap-1.5"
            title="Saved views"
          >
            <IconLayoutGrid className="h-3.5 w-3.5" />
            <span className="max-w-[160px] truncate">{triggerLabel}</span>
            <IconChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Saved views
          </DropdownMenuLabel>
          {views.length === 0 ? (
            <div className="px-2 py-2 text-xs text-muted-foreground">
              No saved views yet.
            </div>
          ) : (
            views.map((v) => (
              <DropdownMenuItem
                key={v.id}
                className="group flex items-center justify-between gap-2"
                onSelect={(e) => {
                  e.preventDefault();
                  applyView(v);
                }}
              >
                <span className="truncate flex-1">{v.name}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDeleteTarget(v);
                    setMenuOpen(false);
                  }}
                  title={`Delete ${v.name}`}
                >
                  <IconTrash className="h-3 w-3" />
                </Button>
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setMenuOpen(false);
              setSaveDialogOpen(true);
            }}
          >
            <IconDeviceFloppy className="h-4 w-4 mr-2" />
            Save current view
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Save view</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Input
              placeholder="View name (e.g. 'Enterprise only')"
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveView();
              }}
              autoFocus
            />
            {Object.keys(currentFilters).length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                No filters are currently active — this view will apply the
                default filter state.
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
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSaveView}
              disabled={!viewName.trim() || savingView}
            >
              {savingView ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete view?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete view "{deleteTarget?.name}"? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteView}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
