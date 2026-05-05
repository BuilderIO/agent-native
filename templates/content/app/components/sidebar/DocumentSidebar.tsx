import { useCallback, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { Document } from "@shared/api";
import {
  IconPlus,
  IconSearch,
  IconStar,
  IconFileText,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconUsers,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ThemeToggle } from "@/components/ThemeToggle";
import { OrgSwitcher } from "@agent-native/core/client/org";
import { FeedbackButton, appPath } from "@agent-native/core/client";
import { ExtensionsSidebarSection } from "@agent-native/core/client/extensions";
import { NotionButton } from "./NotionButton";
import { DocumentTreeItem } from "./DocumentTreeItem";
import {
  useDocuments,
  useCreateDocument,
  useDeleteDocument,
  useUpdateDocument,
  buildDocumentTree,
} from "@/hooks/use-documents";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function nanoid(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

interface DocumentSidebarProps {
  activeDocumentId: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onNavigate?: () => void;
  width?: number;
  onResize?: (width: number) => void;
}

export function DocumentSidebar({
  activeDocumentId,
  collapsed,
  onToggleCollapsed,
  onNavigate,
  width,
  onResize,
}: DocumentSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { data: documents = [], isLoading } = useDocuments();
  const createDocument = useCreateDocument();
  const deleteDocument = useDeleteDocument();
  const updateDocument = useUpdateDocument();
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  // Track which nodes have been explicitly collapsed by the user.
  // All nodes default to expanded; only collapsed IDs are tracked.
  const collapsedIds = useRef(new Set<string>());
  const [, forceUpdate] = useState(0);
  const [isResizing, setIsResizing] = useState(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!onResize || width === undefined) return;
      e.preventDefault();
      setIsResizing(true);
      const startX = e.clientX;
      const startWidth = width;

      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";

      const handleMouseMove = (e: MouseEvent) => {
        onResize(startWidth + e.clientX - startX);
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [onResize, width],
  );

  const tree = buildDocumentTree(documents);
  const favorites = documents.filter((d) => d.isFavorite);

  // Build expanded set: all document IDs except those explicitly collapsed
  const expandedIds = new Set(
    documents.map((d) => d.id).filter((id) => !collapsedIds.current.has(id)),
  );

  const handleToggleExpanded = useCallback((id: string) => {
    if (collapsedIds.current.has(id)) {
      collapsedIds.current.delete(id);
    } else {
      collapsedIds.current.add(id);
    }
    forceUpdate((n) => n + 1);
  }, []);

  const handleCreatePage = useCallback(
    async (parentId?: string) => {
      const id = nanoid();
      const now = new Date().toISOString();
      const tempDoc: Document = {
        id,
        parentId: parentId ?? null,
        title: "",
        content: "",
        icon: null,
        position: 9999,
        isFavorite: false,
        createdAt: now,
        updatedAt: now,
      };

      // Optimistically inject into caches so UI updates immediately
      queryClient.setQueryData(
        ["action", "list-documents", undefined],
        (old: any) => {
          const docs: Document[] =
            old?.documents ?? (Array.isArray(old) ? old : []);
          return { documents: [...docs, tempDoc] };
        },
      );
      queryClient.setQueryData(["action", "get-document", { id }], tempDoc);

      navigate(`/page/${id}`);
      onNavigate?.();

      try {
        await createDocument.mutateAsync({
          id,
          title: "",
          parentId: parentId ?? undefined,
        });
      } catch (err) {
        // Revert optimistic updates
        queryClient.invalidateQueries({
          queryKey: ["action", "list-documents"],
        });
        queryClient.removeQueries({
          queryKey: ["action", "get-document", { id }],
        });
        navigate("/");
        toast.error("Failed to create page", {
          description:
            err instanceof Error ? err.message : "Something went wrong",
        });
      }
    },
    [createDocument, navigate, onNavigate, queryClient],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteDocument.mutateAsync({ id });
        if (activeDocumentId === id) {
          navigate("/");
        }
      } catch {
        toast.error("Failed to delete page");
      }
    },
    [deleteDocument, activeDocumentId, navigate],
  );

  const handleToggleFavorite = useCallback(
    (id: string, isFavorite: boolean) => {
      updateDocument.mutate({ id, isFavorite });
    },
    [updateDocument],
  );

  const filteredDocuments = searchQuery
    ? documents.filter((d) =>
        d.title.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : null;

  if (collapsed) {
    return (
      <div className="flex flex-col h-full w-12 border-r border-border bg-muted/30 items-center py-3 gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground"
              onClick={onToggleCollapsed}
            >
              <IconLayoutSidebarLeftExpand size={18} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Expand sidebar</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground"
              onClick={() => handleCreatePage()}
            >
              <IconPlus size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent>New page</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative flex flex-col h-full border-r border-border bg-muted/30",
        width === undefined && "w-full",
      )}
      style={width === undefined ? undefined : { width, flexShrink: 0 }}
    >
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2 min-w-0">
          <img
            src={appPath("/agent-native-icon-light.svg")}
            alt=""
            aria-hidden="true"
            className="block h-4 w-auto shrink-0 dark:hidden"
          />
          <img
            src={appPath("/agent-native-icon-dark.svg")}
            alt=""
            aria-hidden="true"
            className="hidden h-4 w-auto shrink-0 dark:block"
          />
          <span className="text-base font-semibold tracking-tight text-foreground">
            Content
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground"
                onClick={() => setIsSearching(!isSearching)}
              >
                <IconSearch size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Search</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground"
                onClick={onToggleCollapsed}
              >
                <IconLayoutSidebarLeftCollapse size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Collapse sidebar</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* IconSearch */}
      {isSearching && (
        <div className="px-3 py-2 border-b border-border">
          <input
            autoFocus
            type="text"
            placeholder="Search pages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setIsSearching(false);
                setSearchQuery("");
              }
            }}
            className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="py-2">
          {/* IconSearch results */}
          {filteredDocuments ? (
            <div>
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Results
              </div>
              {filteredDocuments.length === 0 ? (
                <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                  No pages found
                </div>
              ) : (
                filteredDocuments.map((doc) => (
                  <button
                    key={doc.id}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-[5px] text-sm text-left rounded-md",
                      doc.id === activeDocumentId
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                    onClick={() => {
                      navigate(`/page/${doc.id}`);
                      setIsSearching(false);
                      setSearchQuery("");
                      onNavigate?.();
                    }}
                  >
                    <span className="flex-shrink-0 w-5 text-center">
                      {doc.icon || <IconFileText size={14} />}
                    </span>
                    <span className="truncate">{doc.title || "Untitled"}</span>
                  </button>
                ))
              )}
            </div>
          ) : (
            <>
              {/* Favorites */}
              {favorites.length > 0 && (
                <div className="mb-2">
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <IconStar size={10} />
                    Favorites
                  </div>
                  {favorites.map((doc) => (
                    <button
                      key={doc.id}
                      className={cn(
                        "w-full flex items-center gap-2 px-4 py-[5px] text-sm text-left rounded-md",
                        doc.id === activeDocumentId
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                      )}
                      onClick={() => {
                        navigate(`/page/${doc.id}`);
                        onNavigate?.();
                      }}
                    >
                      <span className="flex-shrink-0 w-5 text-center">
                        {doc.icon || <IconFileText size={14} />}
                      </span>
                      <span className="truncate">
                        {doc.title || "Untitled"}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* Page tree */}
              <div>
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Pages
                </div>
                {isLoading ? (
                  <div className="space-y-1 px-3 py-1">
                    {[70, 55, 85, 60, 45].map((w, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 px-1 py-1.5"
                      >
                        <div className="h-3.5 w-3.5 rounded bg-muted animate-pulse flex-shrink-0" />
                        <div
                          className="h-3.5 rounded bg-muted animate-pulse"
                          style={{ width: `${w}%` }}
                        />
                      </div>
                    ))}
                  </div>
                ) : tree.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                    No pages yet
                  </div>
                ) : (
                  tree.map((node) => (
                    <DocumentTreeItem
                      key={node.id}
                      node={node}
                      depth={0}
                      activeId={activeDocumentId}
                      expandedIds={expandedIds}
                      onToggleExpanded={handleToggleExpanded}
                      onSelect={(id) => {
                        navigate(`/page/${id}`);
                        onNavigate?.();
                      }}
                      onCreateChild={(parentId) => handleCreatePage(parentId)}
                      onDelete={handleDelete}
                      onToggleFavorite={handleToggleFavorite}
                    />
                  ))
                )}
              </div>
            </>
          )}

          {/* New page button — under the list */}
          <button
            className="flex w-full items-center gap-2 rounded-md px-3 py-[5px] text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            onClick={() => handleCreatePage()}
          >
            <IconPlus size={14} className="shrink-0" />
            <span>New page</span>
          </button>
        </div>
      </ScrollArea>

      {/* Pinned nav + footer */}
      <div className="px-3 pt-2">
        <Link
          to="/team"
          onClick={() => onNavigate?.()}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-3 py-[5px] text-sm",
            location.pathname === "/team"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
        >
          <IconUsers size={14} className="shrink-0" />
          <span>Team</span>
        </Link>
      </div>

      <div className="border-t border-border px-3 py-1">
        <ExtensionsSidebarSection />
      </div>

      {/* Footer */}
      <div className="border-t border-border px-3 py-2 space-y-2 mt-2">
        <FeedbackButton />
        <OrgSwitcher />
        <div className="flex items-center justify-end gap-0.5">
          <NotionButton />
          <ThemeToggle />
        </div>
      </div>

      {/* Resize handle */}
      {onResize && (
        <div
          className={cn(
            "absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 active:bg-primary/30",
            isResizing && "bg-primary/30",
          )}
          onMouseDown={handleMouseDown}
        />
      )}
    </div>
  );
}
