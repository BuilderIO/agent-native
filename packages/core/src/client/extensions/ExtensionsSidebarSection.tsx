import { agentNativePath } from "../api-path.js";
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
  IconGripVertical,
} from "@tabler/icons-react";
import { cn } from "../utils.js";
import { sendToAgentChat } from "../agent-chat.js";
import { PromptComposer } from "../composer/PromptComposer.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import {
  applyToolsOrder,
  getToolsOrder,
  setToolsOrder,
} from "./extension-order.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip.js";

interface Extension {
  id: string;
  name: string;
  description?: string;
  icon?: string;
}

const FAVORITES_KEY = "extensions-favorites";

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

export function ExtensionsSidebarSection() {
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
  const [toolOrderState, setToolOrderState] = useState<string[]>(() =>
    typeof window !== "undefined" ? getToolsOrder() : [],
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const { data: extensions, isLoading } = useQuery<Extension[]>({
    queryKey: ["extensions"],
    queryFn: async () => {
      const res = await fetch(agentNativePath("/_agent-native/extensions"));
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
    async (extensionId: string) => {
      setMenuOpenId(null);
      const prev = queryClient.getQueryData<Extension[]>(["extensions"]);
      queryClient.setQueryData<Extension[]>(["extensions"], (old) =>
        (old ?? []).filter((t) => t.id !== extensionId),
      );
      try {
        const res = await fetch(
          agentNativePath(`/_agent-native/extensions/${extensionId}`),
          {
            method: "DELETE",
          },
        );
        if (!res.ok) throw new Error("Delete failed");
        queryClient.removeQueries({ queryKey: ["extension", extensionId] });
        queryClient.invalidateQueries({ queryKey: ["extensions"] });
        setFavoriteIds((prev) => {
          const next = new Set(prev);
          next.delete(extensionId);
          saveFavorites(next);
          return next;
        });
        setToolOrderState((prev) => {
          const next = prev.filter((id) => id !== extensionId);
          if (next.length !== prev.length) setToolsOrder(next);
          return next;
        });
        if (
          location.pathname === `/extensions/${extensionId}` ||
          location.pathname === `/extensions/${extensionId}/edit`
        ) {
          navigate("/extensions");
        }
      } catch {
        if (prev) queryClient.setQueryData(["extensions"], prev);
      }
    },
    [location.pathname, navigate, queryClient],
  );

  const startRename = useCallback((extension: Extension) => {
    setMenuOpenId(null);
    setRenameValue(extension.name);
    setRenamingId(extension.id);
  }, []);

  const submitRename = useCallback(
    async (extensionId: string) => {
      const trimmed = renameValue.trim();
      setRenamingId(null);
      if (!trimmed) return;
      const prev = queryClient.getQueryData<Extension[]>(["extensions"]);
      const existing = prev?.find((t) => t.id === extensionId);
      if (!existing || trimmed === existing.name) return;
      queryClient.setQueryData<Extension[]>(["extensions"], (old) =>
        (old ?? []).map((t) =>
          t.id === extensionId ? { ...t, name: trimmed } : t,
        ),
      );
      queryClient.setQueryData<Extension>(["extension", extensionId], (old) =>
        old ? { ...old, name: trimmed } : old,
      );
      try {
        await fetch(
          agentNativePath(`/_agent-native/extensions/${extensionId}`),
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: trimmed }),
          },
        );
        queryClient.invalidateQueries({ queryKey: ["extensions"] });
        queryClient.invalidateQueries({ queryKey: ["extension", extensionId] });
      } catch {
        if (prev) queryClient.setQueryData(["extensions"], prev);
        queryClient.invalidateQueries({ queryKey: ["extension", extensionId] });
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
    if (!extensions) return [];
    const defaultSorted = [...extensions].sort((a, b) => {
      const aFav = favoriteIds.has(a.id) ? 0 : 1;
      const bFav = favoriteIds.has(b.id) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;
      return a.name.localeCompare(b.name);
    });
    return toolOrderState.length > 0
      ? applyToolsOrder(defaultSorted, toolOrderState)
      : defaultSorted;
  }, [extensions, favoriteIds, toolOrderState]);

  const reorderTool = useCallback(
    (activeId: string, overId: string) => {
      if (activeId === overId) return;
      const ids = sortedTools.map((extension) => extension.id);
      const oldIndex = ids.indexOf(activeId);
      const newIndex = ids.indexOf(overId);
      if (oldIndex === -1 || newIndex === -1) return;
      const next = [...ids];
      const [moved] = next.splice(oldIndex, 1);
      if (!moved) return;
      next.splice(newIndex, 0, moved);
      setToolsOrder(next);
      setToolOrderState(next);
    },
    [sortedTools],
  );

  const handleCreate = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    sendToAgentChat({
      message: `Create a extension: ${trimmed}`,
      submit: true,
      openSidebar: true,
      newTab: true,
    });
    setShowCreate(false);
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="group/help relative min-w-0 py-2">
        <div
          className={cn(
            "flex items-center justify-between px-3",
            sortedTools.length > 0 && "mb-1",
          )}
        >
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <IconTool className="h-3.5 w-3.5 shrink-0" />
            Extensions
            <a
              href="https://agent-native.com/docs/extensions"
              target="_blank"
              rel="noopener noreferrer"
              className="opacity-0 group-hover/help:opacity-100 transition-opacity text-muted-foreground/50 hover:text-muted-foreground"
              aria-label="Extensions documentation"
            >
              <IconHelpCircle className="h-3 w-3" />
            </a>
          </span>
          <Popover open={showCreate} onOpenChange={setShowCreate}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                aria-label="New extension"
              >
                <IconPlus className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="right"
              align="start"
              className="w-[420px] p-3"
            >
              <p className="px-1 pb-2 text-sm font-semibold text-foreground">
                New extension
              </p>
              <PromptComposer
                autoFocus
                placeholder="Describe what you'd like to build..."
                draftScope="extensions:sidebar-create"
                onSubmit={handleCreate}
              />
            </PopoverContent>
          </Popover>
        </div>

        {isLoading ? (
          <div className="min-w-0 space-y-0.5 px-1">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center rounded-md px-2 py-1.5">
                <div
                  className="h-3 rounded bg-muted animate-pulse"
                  style={{ width: `${60 + i * 20}px` }}
                />
              </div>
            ))}
          </div>
        ) : sortedTools.length === 0 ? null : (
          <div className="min-w-0 space-y-0.5 px-1">
            {sortedTools.map((extension) => {
              const isActive =
                location.pathname === `/extensions/${extension.id}` ||
                location.pathname === `/extensions/${extension.id}/edit`;
              const isFav = favoriteIds.has(extension.id);
              const isRenamingThis = renamingId === extension.id;
              const actionsVisible =
                menuOpenId === extension.id || isRenamingThis;

              return (
                <div
                  key={extension.id}
                  onDragOver={(e) => {
                    if (!draggingId || draggingId === extension.id) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDragOverId(extension.id);
                  }}
                  onDragLeave={() => {
                    setDragOverId((current) =>
                      current === extension.id ? null : current,
                    );
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const activeId =
                      draggingId || e.dataTransfer.getData("text/plain");
                    setDraggingId(null);
                    setDragOverId(null);
                    if (activeId) reorderTool(activeId, extension.id);
                  }}
                  className={cn(
                    "group/extension relative flex items-center min-w-0 rounded-md",
                    draggingId === extension.id && "opacity-50",
                    dragOverId === extension.id &&
                      draggingId !== extension.id &&
                      "bg-accent/60",
                  )}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          setDraggingId(extension.id);
                          setDragOverId(null);
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", extension.id);
                        }}
                        onDragEnd={() => {
                          setDraggingId(null);
                          setDragOverId(null);
                        }}
                        className="-ml-2 cursor-grab rounded p-0.5 text-muted-foreground/30 opacity-0 transition-colors hover:text-muted-foreground/70 active:cursor-grabbing group-hover/extension:opacity-100 group-focus-within/extension:opacity-100"
                        aria-label={`Reorder ${extension.name}`}
                      >
                        <IconGripVertical className="h-3 w-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Drag to reorder</TooltipContent>
                  </Tooltip>
                  <Link
                    to={`/extensions/${extension.id}`}
                    className={cn(
                      "flex min-w-0 flex-1 items-center rounded-md px-2 py-1.5 pr-12 text-xs transition-[padding,color,background-color] md:pr-2 md:group-hover/extension:pr-12 md:group-focus-within/extension:pr-12",
                      actionsVisible && "md:pr-12",
                      isActive
                        ? "bg-accent text-accent-foreground font-medium"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground",
                    )}
                  >
                    {isRenamingThis ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => submitRename(extension.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitRename(extension.id);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        className="min-w-0 flex-1 truncate border-b border-primary bg-transparent px-0 py-0 text-xs outline-none"
                      />
                    ) : (
                      <span className="block truncate">{extension.name}</span>
                    )}
                  </Link>

                  <div
                    className={cn(
                      "pointer-events-none absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover/extension:opacity-100 md:group-focus-within/extension:opacity-100",
                      actionsVisible && "md:opacity-100",
                    )}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleFavorite(extension.id);
                      }}
                      className={cn(
                        "pointer-events-auto cursor-pointer rounded p-0.5 transition-colors",
                        isFav
                          ? "text-yellow-500"
                          : "text-muted-foreground/40 hover:text-yellow-500",
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
                          setMenuOpenId(
                            menuOpenId === extension.id ? null : extension.id,
                          );
                        }}
                        className="pointer-events-auto cursor-pointer rounded p-0.5 text-muted-foreground/40 transition-colors hover:text-foreground"
                        aria-label="Extension actions"
                      >
                        <IconDots className="h-3 w-3" />
                      </button>

                      {menuOpenId === extension.id && (
                        <div
                          className="absolute right-0 top-full z-50 mt-1 min-w-[120px] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => startRename(extension)}
                            className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                          >
                            <IconPencil className="h-3.5 w-3.5" />
                            Rename
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(extension.id)}
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
    </TooltipProvider>
  );
}
