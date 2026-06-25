import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  useDroppable,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import type { Document, DocumentTreeNode } from "@shared/api";
import {
  IconDatabase,
  IconFileText,
  IconPlus,
  IconSearch,
  IconStar,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconFolderOpen,
  IconChevronRight,
  IconRestore,
  IconTrashX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ThemeToggle } from "@/components/ThemeToggle";
import { OrgSwitcher } from "@agent-native/core/client/org";
import {
  DevDatabaseLink,
  FeedbackButton,
  appPath,
  useCodeMode,
} from "@agent-native/core/client";
import {
  ExtensionSlot,
  ExtensionsSidebarSection,
} from "@agent-native/core/client/extensions";
import { NotionButton } from "./NotionButton";
import { DocumentSidebarIcon, DocumentTreeItem } from "./DocumentTreeItem";
import {
  documentSection,
  isDocumentDropTargetId,
  resolveDocumentSidebarMove,
  type SidebarDocumentSection,
} from "./document-sidebar-dnd";
import {
  useDocuments,
  useCreateDocument,
  useDeleteDocument,
  useMoveDocument,
  useUpdateDocument,
  buildDocumentTree,
  filterDocumentTreeDocuments,
} from "@/hooks/use-documents";
import {
  useCreateContentDatabase,
  useRestoreContentDatabase,
  useTrashedContentDatabases,
} from "@/hooks/use-content-database";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

function isDirectLocalDocument(document: Pick<Document, "id" | "source">) {
  return (
    document.source?.mode === "local-files" &&
    (document.id.startsWith("local-file:") ||
      document.id.startsWith("local-folder:"))
  );
}

function isImportedLocalSourceDocument(
  document: Pick<Document, "id" | "source">,
) {
  return (
    document.source?.mode === "local-files" && !isDirectLocalDocument(document)
  );
}

type SidebarSectionId =
  | "local-files"
  | "shared-copies"
  | "private"
  | "organization"
  | "trash";

function rootDropSectionForSidebarSection(
  id: SidebarSectionId,
): SidebarDocumentSection | null {
  if (id === "private") return "private";
  if (id === "organization") return "org";
  return null;
}

function RootDropZone({
  section,
  activeDropTargetId,
  activeDragSection,
  children,
}: {
  section: SidebarDocumentSection;
  activeDropTargetId: string | null;
  activeDragSection: SidebarDocumentSection | null;
  children: ReactNode;
}) {
  const id = `root:${section}`;
  const { setNodeRef } = useDroppable({
    id,
    disabled: !!activeDragSection && activeDragSection !== section,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-md",
        activeDropTargetId === id && "bg-primary/10 ring-1 ring-primary/30",
      )}
    >
      {children}
    </div>
  );
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
  const createDatabase = useCreateContentDatabase(null);
  const deleteDocument = useDeleteDocument();
  const moveDocument = useMoveDocument();
  const restoreContentDatabase = useRestoreContentDatabase();
  const { data: trashedDatabases } = useTrashedContentDatabases();
  const { isCodeMode } = useCodeMode();
  const updateDocument = useUpdateDocument();
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  // Track user-expanded nodes only; active ancestors are derived below so they
  // do not stay open after navigation unless the user explicitly expanded them.
  const expandedIdsRef = useRef(new Set<string>());
  const [, forceUpdate] = useState(0);
  const [isResizing, setIsResizing] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<
    Record<SidebarSectionId, boolean>
  >({
    "local-files": false,
    "shared-copies": false,
    private: false,
    organization: false,
    trash: false,
  });
  const [activeDropTargetId, setActiveDropTargetId] = useState<string | null>(
    null,
  );
  const [activeDragSection, setActiveDragSection] =
    useState<SidebarDocumentSection | null>(null);
  const localFilesActive = location.pathname.startsWith("/local-files");
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

  const treeDocuments = filterDocumentTreeDocuments(documents);
  const localFileMode = documents.some(isDirectLocalDocument);
  const localSourceDocuments = localFileMode
    ? treeDocuments.filter(isDirectLocalDocument)
    : treeDocuments.filter(isImportedLocalSourceDocument);
  const databaseDocuments = localFileMode
    ? treeDocuments.filter((document) => !isDirectLocalDocument(document))
    : treeDocuments.filter(
        (document) => !isImportedLocalSourceDocument(document),
      );
  const localFileTree = buildDocumentTree(localSourceDocuments);
  const databaseTree = buildDocumentTree(databaseDocuments);
  const privateTree = databaseTree.filter((node) => node.visibility !== "org");
  const organizationTree = databaseTree.filter(
    (node) => node.visibility === "org",
  );
  const favorites = documents.filter(
    (d) => d.isFavorite && (localFileMode || !isImportedLocalSourceDocument(d)),
  );
  const activeDocument = activeDocumentId
    ? documents.find((doc) => doc.id === activeDocumentId)
    : null;
  const trashItems = trashedDatabases?.databases ?? [];
  const sortableDocumentIds = useMemo(
    () => treeDocuments.map((document) => document.id),
    [treeDocuments],
  );
  const parentByDocumentId = useMemo(
    () => new Map(documents.map((doc) => [doc.id, doc.parentId])),
    [documents],
  );
  const sidebarCollisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerCollisions = pointerWithin(args).filter((collision) =>
      isDocumentDropTargetId(String(collision.id)),
    );
    if (pointerCollisions.length > 0) return pointerCollisions;
    return rectIntersection(args).filter((collision) =>
      isDocumentDropTargetId(String(collision.id)),
    );
  }, []);

  const activeAncestorIds = useMemo(() => {
    const ids = new Set<string>();
    let parentId = activeDocumentId
      ? (parentByDocumentId.get(activeDocumentId) ?? null)
      : null;
    while (parentId && !ids.has(parentId)) {
      ids.add(parentId);
      parentId = parentByDocumentId.get(parentId) ?? null;
    }
    return ids;
  }, [activeDocumentId, parentByDocumentId]);

  const expandedIds = new Set(expandedIdsRef.current);
  for (const id of activeAncestorIds) expandedIds.add(id);

  const handleToggleExpanded = useCallback(
    (id: string) => {
      if (activeAncestorIds.has(id)) return;
      if (expandedIdsRef.current.has(id)) {
        expandedIdsRef.current.delete(id);
      } else {
        expandedIdsRef.current.add(id);
      }
      forceUpdate((n) => n + 1);
    },
    [activeAncestorIds],
  );

  const navigateToDocument = useCallback(
    (id: string) => {
      navigate(`/page/${id}`, { flushSync: true });
    },
    [navigate],
  );

  const handleCreatePage = useCallback(
    async (parentId?: string) => {
      if (localFileMode) {
        try {
          const created = await createDocument.mutateAsync({
            title: "",
            parentId: parentId ?? undefined,
          });
          queryClient.setQueryData(
            ["action", "get-document", { id: created.id }],
            created,
          );
          queryClient.invalidateQueries({
            queryKey: ["action", "list-documents"],
          });
          navigateToDocument(created.id);
          onNavigate?.();
        } catch (err) {
          toast.error("Failed to create page", {
            description:
              err instanceof Error ? err.message : "Something went wrong",
          });
        }
        return;
      }

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
        const created = await createDocument.mutateAsync({
          id,
          title: "",
          parentId: parentId ?? undefined,
        });
        const nextId = created?.id || id;
        if (nextId !== id) {
          queryClient.removeQueries({
            queryKey: ["action", "get-document", { id }],
          });
          queryClient.setQueryData(
            ["action", "get-document", { id: nextId }],
            created,
          );
          navigateToDocument(nextId);
        }
        // Replace optimistic doc with real server doc + clear any 404 error
        // state from the in-flight fetch that ran before create completed.
        queryClient.invalidateQueries({
          queryKey: ["action", "get-document", { id: nextId }],
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
    [
      createDocument,
      localFileMode,
      navigate,
      navigateToDocument,
      onNavigate,
      queryClient,
    ],
  );

  const handleCreateDatabase = useCallback(
    async (parentId?: string) => {
      try {
        const result = await createDatabase.mutateAsync({
          parentId: parentId ?? null,
          title: "Untitled database",
        });
        navigateToDocument(result.database.documentId);
        onNavigate?.();
      } catch (err) {
        toast.error("Failed to create database", {
          description:
            err instanceof Error ? err.message : "Something went wrong",
        });
      }
    },
    [createDatabase, navigateToDocument, onNavigate],
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
      const navigationCandidates = localFileMode
        ? survivingDocuments.filter((doc) => doc.source?.kind !== "folder")
        : survivingDocuments;
      const nextDocument =
        navigationCandidates.find((doc) => doc.isFavorite) ??
        [...navigationCandidates].sort(compareDocumentsByPosition)[0] ??
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
    [
      activeDocumentId,
      deleteDocument,
      documents,
      localFileMode,
      navigate,
      queryClient,
    ],
  );

  const clearDragState = useCallback(() => {
    setActiveDragSection(null);
    setActiveDropTargetId(null);
  }, []);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const activeDocument = documents.find(
        (document) => document.id === String(event.active.id),
      );
      setActiveDragSection(
        activeDocument ? documentSection(activeDocument) : null,
      );
    },
    [documents],
  );

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const overId = event.over ? String(event.over.id) : null;
    setActiveDropTargetId(
      overId && isDocumentDropTargetId(overId) ? overId : null,
    );
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const activeId = String(active.id);
      const overId = over ? String(over.id) : null;
      clearDragState();
      if (!overId || !isDocumentDropTargetId(overId)) return;
      const resolution = resolveDocumentSidebarMove({
        activeId,
        dropTargetId: overId,
        documents: treeDocuments,
      });
      if (!resolution.ok) {
        return;
      }
      void moveDocument
        .mutateAsync({
          id: activeId,
          parentId: resolution.move.parentId,
          position: resolution.move.position,
        })
        .catch((err) => {
          queryClient.invalidateQueries({
            queryKey: ["action", "list-documents"],
          });
          toast.error("Failed to move page", {
            description:
              err instanceof Error ? err.message : "Something went wrong",
          });
        });
    },
    [clearDragState, moveDocument, queryClient, treeDocuments],
  );

  const handleToggleFavorite = useCallback(
    (id: string, isFavorite: boolean) => {
      updateDocument.mutate({ id, isFavorite });
    },
    [updateDocument],
  );

  const handleRestoreDatabase = useCallback(
    async (databaseId: string) => {
      try {
        await restoreContentDatabase.mutateAsync({ databaseId });
        toast.success("Database restored");
      } catch (err) {
        toast.error("Failed to restore database", {
          description:
            err instanceof Error ? err.message : "Something went wrong",
        });
      }
    },
    [restoreContentDatabase],
  );

  const handlePermanentDeleteDatabase = useCallback(
    async (documentId: string) => {
      try {
        await deleteDocument.mutateAsync({ id: documentId });
        queryClient.invalidateQueries({
          queryKey: ["action", "list-documents"],
        });
        queryClient.invalidateQueries({
          queryKey: ["action", "list-trashed-content-databases"],
        });
        toast.success("Database permanently deleted");
      } catch (err) {
        toast.error("Failed to permanently delete database", {
          description:
            err instanceof Error ? err.message : "Something went wrong",
        });
      }
    },
    [deleteDocument, queryClient],
  );

  const filteredDocuments = searchQuery
    ? documents.filter((d) =>
        d.title.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : null;

  const renderDocumentTree = (nodes: DocumentTreeNode[]) => (
    <>
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
          onCreateChildPage={(parentId) => handleCreatePage(parentId)}
          onCreateChildDatabase={(parentId) => handleCreateDatabase(parentId)}
          onDelete={handleDelete}
          onToggleFavorite={handleToggleFavorite}
          activeDropTargetId={activeDropTargetId}
          activeDragSection={activeDragSection}
        />
      ))}
    </>
  );

  const renderNewButton = () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-3 py-[5px] text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          disabled={createDocument.isPending || createDatabase.isPending}
        >
          <IconPlus size={14} className="shrink-0" />
          <span>New</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuItem
          disabled={createDocument.isPending}
          onClick={() => void handleCreatePage(undefined)}
        >
          <IconFileText className="mr-2 size-4" />
          Page
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={createDatabase.isPending}
          onClick={() => void handleCreateDatabase(undefined)}
        >
          <IconDatabase className="mr-2 size-4" />
          Database
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const renderCollapsedNewButton = () => (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground"
              disabled={createDocument.isPending || createDatabase.isPending}
            >
              <IconPlus size={16} />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>New</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuItem
          disabled={createDocument.isPending}
          onClick={() => void handleCreatePage(undefined)}
        >
          <IconFileText className="mr-2 size-4" />
          Page
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={createDatabase.isPending}
          onClick={() => void handleCreateDatabase(undefined)}
        >
          <IconDatabase className="mr-2 size-4" />
          Database
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const renderLocalFilesNavButton = () => (
    <button
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm",
        localFilesActive
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
      onClick={() => navigate("/local-files")}
    >
      <IconFolderOpen size={15} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">Local files</span>
    </button>
  );

  const toggleSection = (id: SidebarSectionId) => {
    setCollapsedSections((current) => ({
      ...current,
      [id]: !current[id],
    }));
  };

  const renderSectionHeader = (id: SidebarSectionId, label: string) => {
    const collapsed = collapsedSections[id];
    return (
      <button
        type="button"
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-1 rounded-md px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-accent/40 hover:text-foreground"
        onClick={() => toggleSection(id)}
      >
        <IconChevronRight
          size={12}
          className={cn(
            "shrink-0 transition-transform",
            !collapsed && "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
    );
  };

  const renderTreeSkeleton = () => (
    <div className="space-y-1 px-3 py-1">
      {[70, 55, 85, 60, 45].map((w, i) => (
        <div key={i} className="flex items-center gap-2 px-1 py-1.5">
          <div className="h-3.5 w-3.5 shrink-0 animate-pulse rounded bg-muted" />
          <div
            className="h-3.5 animate-pulse rounded bg-muted"
            style={{ width: `${w}%` }}
          />
        </div>
      ))}
    </div>
  );

  const renderTreeSection = ({
    id,
    label,
    nodes,
    emptyLabel,
    className,
    footer,
  }: {
    id: SidebarSectionId;
    label: string;
    nodes: DocumentTreeNode[];
    emptyLabel: string;
    className?: string;
    footer?: ReactNode;
  }) => {
    const collapsed = collapsedSections[id];
    const rootDropSection = rootDropSectionForSidebarSection(id);
    const header = renderSectionHeader(id, label);
    const emptyContent = (
      <div className="px-3 py-4 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
    return (
      <div className={className}>
        {rootDropSection ? (
          <RootDropZone
            section={rootDropSection}
            activeDropTargetId={activeDropTargetId}
            activeDragSection={activeDragSection}
          >
            {header}
            {!collapsed && !isLoading && nodes.length === 0
              ? emptyContent
              : null}
          </RootDropZone>
        ) : (
          header
        )}
        {!collapsed && (
          <>
            {isLoading
              ? renderTreeSkeleton()
              : nodes.length === 0
                ? rootDropSection
                  ? null
                  : emptyContent
                : renderDocumentTree(nodes)}
            {footer}
          </>
        )}
      </div>
    );
  };

  const renderTrashSection = () => {
    if (trashItems.length === 0) return null;
    const collapsed = collapsedSections.trash;

    return (
      <div className="mt-3 border-t border-border/60 pt-2">
        {renderSectionHeader("trash", "Trash")}
        {!collapsed && (
          <div className="px-1 py-1">
            {trashItems.map((database) => (
              <div
                key={database.databaseId}
                className="group flex min-w-0 items-center gap-1 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              >
                <span className="min-w-0 flex-1 truncate">
                  {database.title || "Untitled database"}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Restore ${database.title || "database"}`}
                      className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-50"
                      disabled={restoreContentDatabase.isPending}
                      onClick={() =>
                        void handleRestoreDatabase(database.databaseId)
                      }
                    >
                      <IconRestore size={14} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Restore</TooltipContent>
                </Tooltip>
                <AlertDialog>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <AlertDialogTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Delete ${database.title || "database"} permanently`}
                          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                          disabled={deleteDocument.isPending}
                        >
                          <IconTrashX size={14} />
                        </button>
                      </AlertDialogTrigger>
                    </TooltipTrigger>
                    <TooltipContent>Delete permanently</TooltipContent>
                  </Tooltip>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Delete database permanently?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently deletes{" "}
                        <span className="font-medium text-foreground">
                          {database.title || "this database"}
                        </span>{" "}
                        and its pages. This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() =>
                          void handlePermanentDeleteDatabase(
                            database.documentId,
                          )
                        }
                      >
                        Delete permanently
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

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
        {renderCollapsedNewButton()}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className={cn(
                "w-10 h-10 flex items-center justify-center rounded-lg hover:bg-accent",
                localFilesActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => navigate("/local-files")}
            >
              <IconFolderOpen size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Local files</TooltipContent>
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

      {/* Search */}
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
          {/* Search results */}
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
                        <DocumentSidebarIcon document={doc} />
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {doc.title || "Untitled"}
                      </span>
                    </button>
                  ))
                )}
              </div>
              {renderNewButton()}
            </>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={sidebarCollisionDetection}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragCancel={clearDragState}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={sortableDocumentIds}>
                {/* Favorites */}
                {!localFileMode && favorites.length > 0 && (
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
                          <DocumentSidebarIcon document={doc} />
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {doc.title || "Untitled"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {localFileMode ? (
                  <>
                    {renderTreeSection({
                      id: "local-files",
                      label: "Local files",
                      nodes: localFileTree,
                      emptyLabel: "No files yet",
                      footer: renderNewButton(),
                    })}
                    {databaseTree.length > 0
                      ? renderTreeSection({
                          id: "shared-copies",
                          label: "Shared copies",
                          nodes: databaseTree,
                          emptyLabel: "No shared copies yet",
                          className: "mt-3",
                        })
                      : null}
                    {renderTrashSection()}
                  </>
                ) : (
                  <>
                    {localFileTree.length > 0 &&
                      renderTreeSection({
                        id: "local-files",
                        label: "Local files",
                        nodes: localFileTree,
                        emptyLabel: "No local files yet",
                        className: "mb-2",
                      })}

                    {renderTreeSection({
                      id: "private",
                      label: "Private",
                      nodes: privateTree,
                      emptyLabel: "No private pages yet",
                      footer: renderNewButton(),
                    })}

                    {!isLoading &&
                      renderTreeSection({
                        id: "organization",
                        label: "Organization",
                        nodes: organizationTree,
                        emptyLabel: "No organization pages yet",
                        className: "mt-3",
                      })}
                    {renderTrashSection()}
                  </>
                )}
              </SortableContext>
            </DndContext>
          )}
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t border-border px-3 py-2">
        {renderLocalFilesNavButton()}
      </div>

      <div className="shrink-0 border-t border-border">
        <ExtensionSlot
          id="content.sidebar.bottom"
          context={{
            documentId: activeDocumentId,
            documentTitle: activeDocument?.title ?? null,
            documentSource: activeDocument?.source ?? null,
            localFileMode,
          }}
          className="px-2 py-2"
          toolClassName="overflow-hidden rounded-md"
        />
        <ExtensionsSidebarSection />
      </div>

      {/* Footer */}
      <div className="shrink-0 space-y-2 border-t border-border px-3 py-2">
        <OrgSwitcher />
        {isCodeMode ? <DevDatabaseLink /> : null}
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
