import { useState, useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Bookmark, Plus, X } from "lucide-react";
import type { DashboardSubview } from "@/pages/adhoc/registry";

interface SavedSubview {
  id: string;
  name: string;
  params: Record<string, string>;
}

const STORAGE_KEY = "tf-dashboard-subviews";

function loadUserSubviews(): SavedSubview[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveUserSubviews(subviews: SavedSubview[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(subviews));
}

interface SubviewBarProps {
  builtIn: DashboardSubview[];
  basePath: string;
}

export function SubviewBar({ builtIn, basePath }: SubviewBarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [userSubviews, setUserSubviews] = useState<SavedSubview[]>(loadUserSubviews);
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState("");

  const allSubviews = useMemo(
    () => [
      ...builtIn.map((sv) => ({ ...sv, isBuiltIn: true })),
      ...userSubviews.map((sv) => ({ ...sv, isBuiltIn: false })),
    ],
    [builtIn, userSubviews]
  );

  // Check if a subview matches the current URL params
  const activeId = useMemo(() => {
    const current = new URLSearchParams(location.search);
    for (const sv of allSubviews) {
      const matches = Object.entries(sv.params).every(
        ([k, v]) => current.get(k) === v
      );
      if (matches && Object.keys(sv.params).length > 0) return sv.id;
    }
    return null;
  }, [location.search, allSubviews]);

  const applySubview = useCallback(
    (params: Record<string, string>) => {
      const search = new URLSearchParams(params).toString();
      navigate(`${basePath}${search ? `?${search}` : ""}`);
    },
    [navigate, basePath]
  );

  const clearSubview = useCallback(() => {
    navigate(basePath);
  }, [navigate, basePath]);

  const saveCurrentView = useCallback(() => {
    if (!newName.trim()) return;
    const current = new URLSearchParams(location.search);
    const params: Record<string, string> = {};
    current.forEach((v, k) => {
      if (k !== "tab") params[k] = v;
    });
    const sv: SavedSubview = {
      id: `user-${Date.now()}`,
      name: newName.trim(),
      params,
    };
    const next = [...userSubviews, sv];
    setUserSubviews(next);
    saveUserSubviews(next);
    setNaming(false);
    setNewName("");
  }, [newName, location.search, userSubviews]);

  const deleteSubview = useCallback(
    (id: string) => {
      const next = userSubviews.filter((s) => s.id !== id);
      setUserSubviews(next);
      saveUserSubviews(next);
    },
    [userSubviews]
  );

  if (allSubviews.length === 0 && !naming) {
    return (
      <div className="flex items-center gap-1.5">
        <Bookmark className="h-3.5 w-3.5 text-muted-foreground" />
        <button
          onClick={() => setNaming(true)}
          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-dashed border-border/50 text-muted-foreground hover:text-foreground hover:border-border transition-colors"
        >
          <Plus className="h-3 w-3" />
          Save view
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Bookmark className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />

      {allSubviews.map((sv) => (
        <span key={sv.id} className="inline-flex items-center gap-0">
          <button
            onClick={() =>
              activeId === sv.id ? clearSubview() : applySubview(sv.params)
            }
            className={`text-xs px-2 py-1 rounded-md border transition-colors ${
              activeId === sv.id
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted/50 text-muted-foreground border-border/50 hover:bg-muted hover:text-foreground"
            }`}
          >
            {sv.name}
          </button>
          {!sv.isBuiltIn && (
            <button
              onClick={() => deleteSubview(sv.id)}
              className="ml-0.5 p-0.5 text-muted-foreground/50 hover:text-red-400 transition-colors"
              title="Delete subview"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}

      {naming ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveCurrentView();
          }}
          className="inline-flex items-center gap-1"
        >
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="View name..."
            className="h-6 w-32 rounded border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            disabled={!newName.trim()}
          >
            Save
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-1 text-xs"
            onClick={() => {
              setNaming(false);
              setNewName("");
            }}
          >
            <X className="h-3 w-3" />
          </Button>
        </form>
      ) : (
        <button
          onClick={() => setNaming(true)}
          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-dashed border-border/50 text-muted-foreground hover:text-foreground hover:border-border transition-colors"
          title="Save current filters as a subview"
        >
          <Plus className="h-3 w-3" />
          Save view
        </button>
      )}
    </div>
  );
}
