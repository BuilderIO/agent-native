import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { Document, DocumentTreeNode } from "@shared/api";
import {
  IconPlus,
  IconSearch,
  IconStar,
  IconFileText,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
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
  useMoveDocument,
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

const LIST_DOCUMENTS_QUERY_KEY = [
  "action",
  "list-documents",
  undefined,
] as const;

function withDocumentsCacheShape(old: unknown, documents: Document[]) {
  if (Array.isArray(old)) return documents;
  return {
    ...(old && typeof old === "object" ? old : {}),
    documents,
  };
}

function compareDocumentsByPosition(a: Document, b: Document) {
  return (
    a.position - b.position ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id)
  );
}

function collectDocumentSubtreeIds(documents: Document[], rootId: string) {
  const deletedIds = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (deletedIds.has(id)) continue;
    deletedIds.add(id);
    for (const doc of documents) {
      if (doc.parentId === id) queue.push(doc.id);
    }
  }
  return deletedIds;
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
  const queryClient = useQueryClient();
  const { data: documents = [], isLoading } = useDocuments();
  const createDocument = useCreateDocument();
  const deleteDocument = useDeleteDocument();
  const moveDocument = useMoveDocument();
  const updateDocument = useUpdateDocument();
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  // Track which nodes have been explicitly collapsed by the user.
  // All nodes default to expanded; only collapsed IDs are tracked.
  const collapsedIds = useRef(new Set<string>());
  const [, forceUpdate] = useState(0);
  const [isResizing, setIsResizing] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

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
  const privateTree = tree.filter((node) => node.visibility !== "org");
  const organizationTree = tree.filter((node) => node.visibility === "org");
  const favorites = documents.filter((d) => d.isFavorite);
  const parentByDocumentId = useMemo(
    () => new Map(documents.map((doc) => [doc.id, doc.parentId])),
    [documents],
  );

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

  const navigateToDocument = useCallback(
    (id: string) => {
      navigate(`/page/${id}`, { flushSync: true });
    },
    [navigate],
  );

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
        hideFromSearch: false,
        visibility: "private",
        accessRole: "owner",
        canEdit: true,
        canManage: true,
        createdAt: now,
        updatedAt: now,
      };

      // Optimistically inject into caches so UI updates immediately
      queryClient.setQueryData(LIST_DOCUMENTS_QUERY_KEY, (old: any) => {
        const docs: Document[] =
          old?.documents ?? (Array.isArray(old) ? old : []);
        return { documents: [...docs, tempDoc] };
      });
      queryClient.setQueryData(["action", "get-document", { id }], tempDoc);

      navigateToDocument(id);
      onNavigate?.();

      try {
        await createDocument.mutateAsync({
          id,
          title: "",
          parentId: parentId ?? undefined,
        });
        // Replace optimistic doc with real server doc + clear any 404 error
        // state from the in-flight fetch that ran before create completed.
        queryClient.invalidateQueries({
          queryKey: ["action", "get-document", { id }],
        });
        queryClient.invalidateQueries({
          queryKey: ["action", "list-documents"],
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
    [createDocument, navigate, navigateToDocument, onNavigate, queryClient],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const deletedIds = collectDocumentSubtreeIds(documents, id);
      const activeDeleted = activeDocumentId
        ? deletedIds.has(activeDocumentId)
        : false;
      const survivingDocuments = documents.filter(
        (doc) => !deletedIds.has(doc.id),
      );
      const nextDocument =
        survivingDocuments.find((doc) => doc.isFavorite) ??
        [...survivingDocuments].sort(compareDocumentsByPosition)[0] ??
        null;

      queryClient.setQueryData(LIST_DOCUMENTS_QUERY_KEY, (old: unknown) => {
        const cachedDocs: Document[] =
          (old as { documents?: Document[] })?.documents ??
          (Array.isArray(old) ? old : documents);
        return withDocumentsCacheShape(
          old,
          cachedDocs.filter((doc) => !deletedIds.has(doc.id)),
        );
      });
      for (const deletedId of deletedIds) {
        queryClient.removeQueries({
          queryKey: ["action", "get-document", { id: deletedId }],
        });
      }

      if (activeDeleted) {
        navigate(nextDocument ? `/page/${nextDocument.id}` : "/", {
          replace: true,
          flushSync: true,
        });
      }

      try {
        await deleteDocument.mutateAsync({ id });
        queryClient.invalidateQueries({
          queryKey: ["action", "list-documents"],
        });
      } catch (err) {
        queryClient.invalidateQueries({
          queryKey: ["action", "list-documents"],
        });
        if (activeDeleted && activeDocumentId) {
          navigate(`/page/${activeDocumentId}`, {
            replace: true,
            flushSync: true,
          });
        }
        toast.error("Failed to delete page", {
          description:
            err instanceof Error ? err.message : "Something went wrong",
        });
      }
    },
    [activeDocumentId, deleteDocument, documents, navigate, queryClient],
  );

  const handleReorderPage = useCallback(
    async (id: string, overId: string) => {
      if (id === overId) return;
      const current = documents.find((doc) => doc.id === id);
      const target = documents.find((doc) => doc.id === overId);
      if (!current || !target) return;
      if (current.parentId !== target.parentId) {
        return;
      }

      const siblings = documents
        .filter((doc) => doc.parentId === current.parentId)
        .sort(compareDocumentsByPosition);
      const currentIndex = siblings.findIndex((doc) => doc.id === id);
      const nextIndex = siblings.findIndex((doc) => doc.id === overId);
      if (currentIndex < 0 || nextIndex < 0 || currentIndex === nextIndex) {
        return;
      }

      const reordered = arrayMove(siblings, currentIndex, nextIndex);
      const nextPositionById = new Map(
        reordered.map((doc, index) => [doc.id, index]),
      );
      const changed = reordered.filter(
        (doc) => doc.position !== nextPositionById.get(doc.id),
      );
      if (changed.length === 0) return;
      if (changed.some((doc) => doc.canEdit === false)) {
        toast.error("Cannot reorder pages", {
          description: "One of the affected pages is read-only.",
        });
        return;
      }

      queryClient.setQueryData(LIST_DOCUMENTS_QUERY_KEY, (old: unknown) => {
        const cachedDocs: Document[] =
          (old as { documents?: Document[] })?.documents ??
          (Array.isArray(old) ? old : documents);
        const nextDocs = cachedDocs.map((doc) => {
          const nextPosition = nextPositionById.get(doc.id);
          return nextPosition === undefined
            ? doc
            : { ...doc, position: nextPosition };
        });
        return withDocumentsCacheShape(old, nextDocs);
      });

      try {
        await Promise.all(
          changed.map((doc) =>
            moveDocument.mutateAsync({
              id: doc.id,
              position: nextPositionById.get(doc.id)!,
            }),
          ),
        );
      } catch (err) {
        queryClient.invalidateQueries({
          queryKey: ["action", "list-documents"],
        });
        toast.error("Failed to move page", {
          description:
            err instanceof Error ? err.message : "Something went wrong",
        });
      }
    },
    [documents, moveDocument, queryClient],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const activeId = String(active.id);
      const overId = over ? String(over.id) : null;
      if (!overId || activeId === overId) return;
      if (parentByDocumentId.get(activeId) !== parentByDocumentId.get(overId)) {
        return;
      }
      void handleReorderPage(activeId, overId);
    },
    [handleReorderPage, parentByDocumentId],
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

  const renderDocumentTree = (nodes: DocumentTreeNode[]) => (
    <SortableContext
      items={nodes.map((node) => node.id)}
      strategy={verticalListSortingStrategy}
    >
      {nodes.map((node) => (
        <DocumentTreeItem
          key={node.id}
          node={node}
          depth={0}
          sidebarWidth={width}
          activeId={activeDocumentId}
          expandedIds={expandedIds}
          onToggleExpanded={handleToggleExpanded}
          onSelect={(id) => {
            navigateToDocument(id);
            onNavigate?.();
          }}
          onCreateChild={(parentId) => handleCreatePage(parentId)}
          onDelete={handleDelete}
          onToggleFavorite={handleToggleFavorite}
        />
      ))}
    </SortableContext>
  );

  const renderNewPageButton = () => (
    <button
      className="flex w-full items-center gap-2 rounded-md px-3 py-[5px] text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      onClick={() => handleCreatePage()}
    >
      <IconPlus size={14} className="shrink-0" />
      <span>New page</span>
    </button>
  );

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
        "relative flex h-full min-h-0 flex-col border-r border-border bg-muted/30",
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

      <ScrollArea className="min-h-0 flex-1">
        <div className="min-w-full w-max py-2 pr-2">
          {/* IconSearch results */}
          {filteredDocuments ? (
            <>
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
                        navigateToDocument(doc.id);
                        setIsSearching(false);
                        setSearchQuery("");
                        onNavigate?.();
                      }}
                    >
                      <span className="flex-shrink-0 w-5 text-center">
                        {doc.icon || <IconFileText size={14} />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {doc.title || "Untitled"}
                      </span>
                    </button>
                  ))
                )}
              </div>
              {renderNewPageButton()}
            </>
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
                        navigateToDocument(doc.id);
                        onNavigate?.();
                      }}
                    >
                      <span className="flex-shrink-0 w-5 text-center">
                        {doc.icon || <IconFileText size={14} />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {doc.title || "Untitled"}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* Private page tree */}
              <div>
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Private
                </div>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
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
                  ) : privateTree.length === 0 ? (
                    <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                      No private pages yet
                    </div>
                  ) : (
                    renderDocumentTree(privateTree)
                  )}
                </DndContext>
              </div>

              {/* New page button — private pages are the default */}
              {renderNewPageButton()}

              {!isLoading && (
                <div className="mt-3">
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Organization
                  </div>
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    {organizationTree.length === 0 ? (
                      <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                        No organization pages yet
                      </div>
                    ) : (
                      renderDocumentTree(organizationTree)
                    )}
                  </DndContext>
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t border-border">
        <ExtensionsSidebarSection />
      </div>

      {/* Footer */}
      <div className="shrink-0 space-y-2 border-t border-border px-3 py-2">
        <OrgSwitcher />
        <div className="flex items-center gap-1">
          <FeedbackButton className="h-8 min-w-0 flex-1 gap-2 rounded-md px-2 py-0" />
          <div className="flex shrink-0 items-center gap-0.5">
            <NotionButton />
            <ThemeToggle />
          </div>
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
