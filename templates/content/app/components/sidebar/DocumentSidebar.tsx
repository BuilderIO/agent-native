import {
  DevDatabaseLink,
  FeedbackButton,
  appPath,
  useCodeMode,
  useT,
} from "@agent-native/core/client";
import {
  ExtensionSlot,
  ExtensionsSidebarSection,
} from "@agent-native/core/client/extensions";
import { OrgSwitcher } from "@agent-native/core/client/org";
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
  IconDatabase,
  IconFileText,
  IconPlus,
  IconRestore,
  IconSearch,
  IconStar,
  IconSettings,
  IconTrashX,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconFolderOpen,
  IconChevronRight,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import { ThemeToggle } from "@/components/ThemeToggle";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useCreateContentDatabase,
  useDeleteContentDatabase,
  useRestoreContentDatabase,
  useTrashedContentDatabases,
} from "@/hooks/use-content-database";
import {
  useDocuments,
  useCreateDocument,
  useDeleteDocument,
  useMoveDocument,
  useUpdateDocument,
  buildDocumentTree,
  filterDocumentTreeDocuments,
} from "@/hooks/use-documents";
import { cn } from "@/lib/utils";

import {
  getDocumentSidebarSections,
  isDirectLocalDocument,
} from "./document-sidebar-sections";
import { DocumentSidebarIcon, DocumentTreeItem } from "./DocumentTreeItem";
import { NotionButton } from "./NotionButton";

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

type SidebarSectionId =
  | "local-files"
  | "shared-copies"
  | "private"
  | "organization"
  | "trash";

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
  const t = useT();
  const { data: documents = [], isLoading } = useDocuments();
  const createDocument = useCreateDocument();
  const createDatabase = useCreateContentDatabase(null);
  const deleteContentDatabase = useDeleteContentDatabase();
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
  const localFilesActive = location.pathname.startsWith("/local-files");
  const settingsActive = location.pathname.startsWith("/settings");
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
  const {
    localFileMode,
    localSourceDocuments,
    databaseDocuments,
    favorites,
    showFavorites,
  } = getDocumentSidebarSections(documents, treeDocuments);
  const localFileTree = buildDocumentTree(localSourceDocuments);
  const databaseTree = buildDocumentTree(databaseDocuments);
  const privateTree = databaseTree.filter((node) => node.visibility !== "org");
  const organizationTree = databaseTree.filter(
    (node) => node.visibility === "org",
  );
  // Match the tree rows' right-side inset so favorite titles clip inside the
  // visible sidebar instead of widening the scroll surface.
  const favoriteRowWidth =
    width === undefined ? undefined : Math.max(224, width - 8);
  const activeDocument = activeDocumentId
    ? documents.find((doc) => doc.id === activeDocumentId)
    : null;
  const trashItems = trashedDatabases?.databases ?? [];
  const parentByDocumentId = useMemo(
    () => new Map(documents.map((doc) => [doc.id, doc.parentId])),
    [documents],
  );

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
          toast.error(t("sidebar.failedCreatePage"), {
            description:
              err instanceof Error ? err.message : t("empty.genericError"),
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
        toast.error(t("sidebar.failedCreatePage"), {
          description:
            err instanceof Error ? err.message : t("empty.genericError"),
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
    async (parentId?: string | null) => {
      try {
        const result = await createDatabase.mutateAsync({
          parentId: parentId ?? null,
          title: t("editor.untitledDatabase"),
        });
        navigateToDocument(result.database.documentId);
        onNavigate?.();
      } catch (err) {
        toast.error(t("sidebar.failedCreateDatabase"), {
          description:
            err instanceof Error ? err.message : t("empty.genericError"),
        });
      }
    },
    [createDatabase, navigateToDocument, onNavigate, t],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const deletedDocument = documents.find((doc) => doc.id === id) ?? null;
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
        if (deletedDocument?.database) {
          await deleteContentDatabase.mutateAsync({
            databaseId: deletedDocument.database.id,
          });
        } else {
          await deleteDocument.mutateAsync({ id });
        }
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
        toast.error(t("sidebar.failedDeletePage"), {
          description:
            err instanceof Error ? err.message : t("empty.genericError"),
        });
      }
    },
    [
      activeDocumentId,
      deleteContentDatabase,
      deleteDocument,
      documents,
      localFileMode,
      navigate,
      queryClient,
    ],
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
        toast.error(t("sidebar.cannotReorderPages"), {
          description: t("sidebar.oneAffectedPageReadOnly"),
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
        toast.error(t("sidebar.failedMovePage"), {
          description:
            err instanceof Error ? err.message : t("empty.genericError"),
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

  const handleRestoreDatabase = useCallback(
    async (databaseId: string) => {
      try {
        await restoreContentDatabase.mutateAsync({ databaseId });
        toast.success(t("sidebar.databaseRestored"));
      } catch (err) {
        toast.error(t("sidebar.failedRestoreDatabase"), {
          description:
            err instanceof Error ? err.message : t("empty.genericError"),
        });
      }
    },
    [restoreContentDatabase, t],
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
        toast.success(t("sidebar.databasePermanentlyDeleted"));
      } catch (err) {
        toast.error(t("sidebar.failedPermanentDeleteDatabase"), {
          description:
            err instanceof Error ? err.message : t("empty.genericError"),
        });
      }
    },
    [deleteDocument, queryClient, t],
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
          onCreateChildPage={(parentId) => handleCreatePage(parentId)}
          onCreateChildDatabase={(parentId) => handleCreateDatabase(parentId)}
          onDelete={handleDelete}
          onToggleFavorite={handleToggleFavorite}
        />
      ))}
    </SortableContext>
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
          <span>{t("sidebar.new")}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuItem
          disabled={createDocument.isPending}
          onClick={() => void handleCreatePage()}
        >
          <IconFileText className="me-2 size-4" />
          {t("sidebar.page")}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={createDatabase.isPending}
          onClick={() => void handleCreateDatabase(null)}
        >
          <IconDatabase className="me-2 size-4" />
          {t("sidebar.database")}
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
        <TooltipContent>{t("sidebar.new")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuItem
          disabled={createDocument.isPending}
          onClick={() => void handleCreatePage()}
        >
          <IconFileText className="me-2 size-4" />
          {t("sidebar.page")}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={createDatabase.isPending}
          onClick={() => void handleCreateDatabase(null)}
        >
          <IconDatabase className="me-2 size-4" />
          {t("sidebar.database")}
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
      <span className="min-w-0 flex-1 truncate text-start">
        {t("sidebar.localFiles")}
      </span>
    </button>
  );

  const renderSettingsNavButton = () => (
    <button
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm",
        settingsActive
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
      onClick={() => navigate("/settings")}
    >
      <IconSettings size={15} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate text-start">
        {t("navigation.settings")}
      </span>
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
        className="flex w-full items-center gap-1 rounded-md px-3 py-1.5 text-start text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-accent/40 hover:text-foreground"
        onClick={() => toggleSection(id)}
      >
        <IconChevronRight
          size={12}
          className={cn(
            "shrink-0 transition-transform",
            !collapsed && "rotate-90",
            "rtl:-scale-x-100",
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
    return (
      <div className={className}>
        {renderSectionHeader(id, label)}
        {!collapsed && (
          <>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              {isLoading ? (
                renderTreeSkeleton()
              ) : nodes.length === 0 ? (
                <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                  {emptyLabel}
                </div>
              ) : (
                renderDocumentTree(nodes)
              )}
            </DndContext>
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
        {renderSectionHeader("trash", t("sidebar.trash"))}
        {!collapsed && (
          <div className="px-1 py-1">
            {trashItems.map((database) => {
              const title = database.title || t("editor.untitledDatabase");
              return (
                <div
                  key={database.databaseId}
                  className="group flex min-w-0 items-center gap-1 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                >
                  <span className="min-w-0 flex-1 truncate">{title}</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={t("sidebar.restoreDatabaseNamed", {
                          title,
                        })}
                        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-50"
                        disabled={restoreContentDatabase.isPending}
                        onClick={() =>
                          void handleRestoreDatabase(database.databaseId)
                        }
                      >
                        <IconRestore size={14} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("sidebar.restoreDatabase")}
                    </TooltipContent>
                  </Tooltip>
                  {database.canPermanentlyDelete && (
                    <AlertDialog>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <AlertDialogTrigger asChild>
                            <button
                              type="button"
                              aria-label={t(
                                "sidebar.deleteDatabaseNamedPermanently",
                                { title },
                              )}
                              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                              disabled={deleteDocument.isPending}
                            >
                              <IconTrashX size={14} />
                            </button>
                          </AlertDialogTrigger>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("sidebar.deletePermanently")}
                        </TooltipContent>
                      </Tooltip>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            {t("sidebar.deleteDatabasePermanentlyQuestion")}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {t("sidebar.deleteDatabasePermanentlyDescription", {
                              title,
                            })}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>
                            {t("comments.cancel")}
                          </AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() =>
                              void handlePermanentDeleteDatabase(
                                database.documentId,
                              )
                            }
                          >
                            {t("sidebar.deletePermanently")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  if (collapsed) {
    return (
      <div className="flex h-full w-12 flex-col items-center gap-1 border-e border-border bg-muted/30 py-3 transition-[width] duration-200 ease-out">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground"
              onClick={onToggleCollapsed}
            >
              <IconLayoutSidebarLeftExpand size={18} />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("sidebar.expand")}</TooltipContent>
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
          <TooltipContent>{t("sidebar.localFiles")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className={cn(
                "w-10 h-10 flex items-center justify-center rounded-lg hover:bg-accent",
                settingsActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => navigate("/settings")}
            >
              <IconSettings size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("navigation.settings")}</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "agent-layout-left-drawer relative flex h-full min-h-0 flex-col border-e border-border bg-muted/30 transition-[width] duration-200 ease-out",
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
            <TooltipContent>{t("sidebar.search")}</TooltipContent>
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
            <TooltipContent>{t("sidebar.collapse")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Search */}
      {isSearching && (
        <div className="px-3 py-2 border-b border-border">
          <input
            autoFocus
            type="text"
            placeholder={t("sidebar.searchPages")}
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
        <div className="min-w-full w-max py-2 pe-2">
          {/* Search results */}
          {filteredDocuments ? (
            <>
              <div>
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("sidebar.results")}
                </div>
                {filteredDocuments.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                    {t("sidebar.noPagesFound")}
                  </div>
                ) : (
                  filteredDocuments.map((doc) => (
                    <button
                      key={doc.id}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-[5px] text-sm text-start rounded-md",
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
                        {doc.title || t("sidebar.untitled")}
                      </span>
                    </button>
                  ))
                )}
              </div>
              {renderNewButton()}
            </>
          ) : (
            <>
              {/* Favorites */}
              {showFavorites && (
                <div className="mb-2 min-w-0">
                  <div className="flex min-w-0 items-center gap-1 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <IconStar size={10} />
                    <span className="min-w-0 flex-1 truncate">
                      {t("sidebar.favorites")}
                    </span>
                  </div>
                  {favorites.map((doc) => (
                    <button
                      key={doc.id}
                      className={cn(
                        "flex w-full min-w-0 items-center gap-2 rounded-md px-4 py-[5px] text-start text-sm",
                        doc.id === activeDocumentId
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                      )}
                      style={{
                        width:
                          favoriteRowWidth === undefined
                            ? undefined
                            : `${favoriteRowWidth}px`,
                      }}
                      onClick={() => {
                        navigateToDocument(doc.id);
                        onNavigate?.();
                      }}
                    >
                      <span className="flex-shrink-0 w-5 text-center">
                        <DocumentSidebarIcon document={doc} />
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {doc.title || t("sidebar.untitled")}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {localFileMode ? (
                <>
                  {renderTreeSection({
                    id: "local-files",
                    label: t("sidebar.localFiles"),
                    nodes: localFileTree,
                    emptyLabel: t("sidebar.noFilesYet"),
                    footer: renderNewButton(),
                  })}
                  {databaseTree.length > 0
                    ? renderTreeSection({
                        id: "shared-copies",
                        label: t("sidebar.sharedCopies"),
                        nodes: databaseTree,
                        emptyLabel: t("sidebar.noSharedCopiesYet"),
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
                      label: t("sidebar.localFiles"),
                      nodes: localFileTree,
                      emptyLabel: t("sidebar.noLocalFilesYet"),
                      className: "mb-2",
                    })}

                  {renderTreeSection({
                    id: "private",
                    label: t("sidebar.private"),
                    nodes: privateTree,
                    emptyLabel: t("sidebar.noPrivatePagesYet"),
                    footer: renderNewButton(),
                  })}

                  {!isLoading &&
                    renderTreeSection({
                      id: "organization",
                      label: t("sidebar.organization"),
                      nodes: organizationTree,
                      emptyLabel: t("sidebar.noOrganizationPagesYet"),
                      className: "mt-3",
                    })}
                  {renderTrashSection()}
                </>
              )}
            </>
          )}
        </div>
      </ScrollArea>

      <div className="shrink-0 px-3 py-2">
        <div className="space-y-1">
          {renderLocalFilesNavButton()}
          {renderSettingsNavButton()}
        </div>
      </div>

      <div className="shrink-0">
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
      <div className="shrink-0 space-y-2 px-3 py-2">
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
            "absolute top-0 end-0 w-1 h-full cursor-col-resize hover:bg-primary/20 active:bg-primary/30",
            isResizing && "bg-primary/30",
          )}
          onMouseDown={handleMouseDown}
        />
      )}
    </div>
  );
}
