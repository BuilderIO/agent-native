import { useState, useCallback, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "react-router";
import {
  IconTool,
  IconPlus,
  IconStar,
  IconStarFilled,
  IconTrash,
  IconDots,
  IconHelpCircle,
  IconPencil,
} from "@tabler/icons-react";
import { cn } from "../utils.js";
import { sendToAgentChat } from "../agent-chat.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";

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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() =>
    typeof window !== "undefined" ? getFavorites() : new Set(),
  );
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createPrompt, setCreatePrompt] = useState("");

  const { data: tools, isLoading } = useQuery<Tool[]>({
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
        queryClient.removeQueries({ queryKey: ["tool", toolId] });
        queryClient.invalidateQueries({ queryKey: ["tools"] });
        setFavoriteIds((prev) => {
          const next = new Set(prev);
          next.delete(toolId);
          saveFavorites(next);
          return next;
        });
        if (
          location.pathname === `/tools/${toolId}` ||
          location.pathname === `/tools/${toolId}/edit`
        ) {
          navigate("/tools");
        }
      } catch {
        if (prev) queryClient.setQueryData(["tools"], prev);
      }
    },
    [location.pathname, navigate, queryClient],
  );

  const startRename = useCallback((tool: Tool) => {
    setMenuOpenId(null);
    setRenameValue(tool.name);
    setRenamingId(tool.id);
  }, []);

  const submitRename = useCallback(
    async (toolId: string) => {
      const trimmed = renameValue.trim();
      setRenamingId(null);
      if (!trimmed) return;
      const prev = queryClient.getQueryData<Tool[]>(["tools"]);
      const existing = prev?.find((t) => t.id === toolId);
      if (!existing || trimmed === existing.name) return;
      queryClient.setQueryData<Tool[]>(["tools"], (old) =>
        (old ?? []).map((t) => (t.id === toolId ? { ...t, name: trimmed } : t)),
      );
      queryClient.setQueryData<Tool>(["tool", toolId], (old) =>
        old ? { ...old, name: trimmed } : old,
      );
      try {
        await fetch(`/_agent-native/tools/${toolId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        });
        queryClient.invalidateQueries({ queryKey: ["tools"] });
        queryClient.invalidateQueries({ queryKey: ["tool", toolId] });
      } catch {
        if (prev) queryClient.setQueryData(["tools"], prev);
      }
    },
    [renameValue, queryClient],
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

  const handleCreate = () => {
    if (!createPrompt.trim()) return;
    sendToAgentChat({
      message: `Create a tool: ${createPrompt.trim()}`,
      submit: true,
      openSidebar: true,
      newTab: true,
    });
    setCreatePrompt("");
    setShowCreate(false);
  };

  return (
    <div className="group/help relative py-2">
      <div
        className={cn(
          "flex items-center justify-between px-3",
          sortedTools.length > 0 && "mb-1",
        )}
      >
        <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Tools
          <a
            href="https://agent-native.com/docs/tools"
            target="_blank"
            rel="noopener noreferrer"
            className="opacity-0 group-hover/help:opacity-100 transition-opacity text-muted-foreground/50 hover:text-muted-foreground"
            aria-label="Tools documentation"
          >
            <IconHelpCircle className="h-3 w-3" />
          </a>
        </span>
        <Popover open={showCreate} onOpenChange={setShowCreate}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              aria-label="New tool"
            >
              <IconPlus className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="right" align="start" className="w-80 p-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleCreate();
              }}
            >
              <textarea
                autoFocus
                value={createPrompt}
                onChange={(e) => setCreatePrompt(e.target.value)}
                placeholder="Describe what you'd like to build..."
                className="flex w-full rounded-md border border-input bg-background px-3 py-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 min-h-[100px] resize-y"
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    handleCreate();
                  }
                }}
              />
              <div className="flex items-center justify-end gap-2 mt-3">
                <span className="text-[11px] text-muted-foreground/75">
                  {/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl"}
                  +Enter
                </span>
                <button
                  type="submit"
                  disabled={!createPrompt.trim()}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  Create
                </button>
              </div>
            </form>
          </PopoverContent>
        </Popover>
      </div>

      {isLoading ? (
        <div className="space-y-0.5 px-1">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-md px-2 py-1.5"
            >
              <div className="h-4 w-4 rounded bg-muted animate-pulse" />
              <div
                className="h-3.5 rounded bg-muted animate-pulse"
                style={{ width: `${60 + i * 20}px` }}
              />
            </div>
          ))}
        </div>
      ) : sortedTools.length === 0 ? null : (
        <div className="space-y-0.5 px-1">
          {sortedTools.map((tool) => {
            const isActive =
              location.pathname === `/tools/${tool.id}` ||
              location.pathname === `/tools/${tool.id}/edit`;
            const isFav = favoriteIds.has(tool.id);
            const isRenamingThis = renamingId === tool.id;

            return (
              <div key={tool.id} className="group/tool relative">
                <Link
                  to={`/tools/${tool.id}`}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                    "hover:bg-accent hover:text-accent-foreground",
                    isActive && "bg-accent text-accent-foreground font-medium",
                  )}
                >
                  <IconTool className="h-4 w-4 shrink-0" />
                  {isRenamingThis ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => submitRename(tool.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitRename(tool.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      className="flex-1 min-w-0 truncate text-sm bg-transparent border-b border-primary outline-none py-0 px-0"
                    />
                  ) : (
                    <span className="truncate">{tool.name}</span>
                  )}
                </Link>

                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
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
                        : "text-muted-foreground/40 opacity-100 hover:text-yellow-500 md:opacity-0 md:group-hover/tool:opacity-100 md:group-focus-within/tool:opacity-100",
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
                      className="cursor-pointer rounded p-0.5 text-muted-foreground/40 opacity-100 hover:text-foreground md:opacity-0 md:group-hover/tool:opacity-100 md:group-focus-within/tool:opacity-100"
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
                          onClick={() => startRename(tool)}
                          className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                        >
                          <IconPencil className="h-3.5 w-3.5" />
                          Rename
                        </button>
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
