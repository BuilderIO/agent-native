import { useState, useCallback, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "react-router";
import {
  IconTool,
  IconPlus,
  IconStar,
  IconStarFilled,
  IconTrash,
  IconDots,
} from "@tabler/icons-react";
import { cn } from "../utils.js";
import { sendToAgentChat } from "../agent-chat.js";

interface Tool {
  id: string;
  name: string;
  description?: string;
  icon?: string;
}

const FAVORITES_KEY = "tools-favorites";

function getFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveFavorites(ids: Set<string>) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // localStorage unavailable — ignore
  }
}

export function ToolsSidebarSection() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() =>
    typeof window !== "undefined" ? getFavorites() : new Set(),
  );
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createPrompt, setCreatePrompt] = useState("");

  const { data: tools } = useQuery<Tool[]>({
    queryKey: ["tools"],
    queryFn: async () => {
      const res = await fetch("/_agent-native/tools");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const toggleFavorite = useCallback((id: string) => {
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      saveFavorites(next);
      return next;
    });
  }, []);

  const handleDelete = useCallback(
    async (toolId: string) => {
      setMenuOpenId(null);
      const prev = queryClient.getQueryData<Tool[]>(["tools"]);
      queryClient.setQueryData<Tool[]>(["tools"], (old) =>
        (old ?? []).filter((t) => t.id !== toolId),
      );
      try {
        const res = await fetch(`/_agent-native/tools/${toolId}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error("Delete failed");
        queryClient.invalidateQueries({ queryKey: ["tools"] });
      } catch {
        if (prev) queryClient.setQueryData(["tools"], prev);
      }
    },
    [queryClient],
  );

  // Close menu on click outside
  useEffect(() => {
    if (!menuOpenId) return;
    const handler = () => setMenuOpenId(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [menuOpenId]);

  const sortedTools = useMemo(() => {
    if (!tools) return [];
    return [...tools].sort((a, b) => {
      const aFav = favoriteIds.has(a.id) ? 0 : 1;
      const bFav = favoriteIds.has(b.id) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;
      return a.name.localeCompare(b.name);
    });
  }, [tools, favoriteIds]);

  return (
    <div className="relative py-2">
      <div className="flex items-center justify-between px-3 mb-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Tools
        </span>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          aria-label="New tool"
        >
          <IconPlus className="h-3.5 w-3.5" />
        </button>
      </div>

      {showCreate && (
        <div className="absolute left-0 right-0 z-50 mt-1 rounded-lg border bg-popover p-3 shadow-lg">
          <input
            autoFocus
            value={createPrompt}
            onChange={(e) => setCreatePrompt(e.target.value)}
            placeholder="What would you like to build?"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
            onKeyDown={(e) => {
              if (e.key === "Enter" && createPrompt.trim()) {
                sendToAgentChat({
                  message: `Create a tool called "${createPrompt.trim()}"`,
                  submit: true,
                  openSidebar: true,
                });
                setCreatePrompt("");
                setShowCreate(false);
              }
              if (e.key === "Escape") setShowCreate(false);
            }}
          />
          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (createPrompt.trim()) {
                  sendToAgentChat({
                    message: `Create a tool called "${createPrompt.trim()}"`,
                    submit: true,
                    openSidebar: true,
                  });
                  setCreatePrompt("");
                  setShowCreate(false);
                }
              }}
              className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 cursor-pointer"
            >
              Create
            </button>
          </div>
        </div>
      )}

      {sortedTools.length === 0 ? (
        <div className="px-3 py-2">
          <p className="text-xs text-muted-foreground/60">No tools yet</p>
        </div>
      ) : (
        <div className="space-y-0.5">
          {sortedTools.map((tool) => {
            const isActive =
              location.pathname === `/tools/${tool.id}` ||
              location.pathname === `/tools/${tool.id}/edit`;
            const isFav = favoriteIds.has(tool.id);

            return (
              <div
                key={tool.id}
                className="group/tool relative flex items-center px-1"
              >
                <Link
                  to={`/tools/${tool.id}`}
                  className={cn(
                    "flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                    "hover:bg-accent hover:text-accent-foreground",
                    isActive && "bg-accent text-accent-foreground font-medium",
                  )}
                >
                  <IconTool className="h-4 w-4 shrink-0" />
                  <span className="truncate">{tool.name}</span>
                </Link>

                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleFavorite(tool.id);
                    }}
                    className={cn(
                      "cursor-pointer rounded p-0.5",
                      isFav
                        ? "text-yellow-500"
                        : "text-muted-foreground/40 opacity-0 group-hover/tool:opacity-100 hover:text-yellow-500",
                    )}
                    aria-label={isFav ? "Unfavorite" : "Favorite"}
                  >
                    {isFav ? (
                      <IconStarFilled className="h-3 w-3" />
                    ) : (
                      <IconStar className="h-3 w-3" />
                    )}
                  </button>

                  <div className="relative">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setMenuOpenId(menuOpenId === tool.id ? null : tool.id);
                      }}
                      className="cursor-pointer rounded p-0.5 text-muted-foreground/40 opacity-0 group-hover/tool:opacity-100 hover:text-foreground"
                      aria-label="Tool actions"
                    >
                      <IconDots className="h-3 w-3" />
                    </button>

                    {menuOpenId === tool.id && (
                      <div
                        className="absolute right-0 top-full z-50 mt-1 min-w-[120px] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => handleDelete(tool.id)}
                          className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-accent"
                        >
                          <IconTrash className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
