import { useCodeMode } from "@agent-native/core/client/agent-chat";
import { appPath } from "@agent-native/core/client/api-path";
import { DevDatabaseLink } from "@agent-native/core/client/db-admin";
import {
  ExtensionSlot,
  ExtensionsSidebarSection,
} from "@agent-native/core/client/extensions";
import {
  setClientAppState,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { FeedbackButton } from "@agent-native/core/client/ui";
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
import type {
  ContentDatabaseItem,
  ContentDatabaseResponse,
  Document,
  DocumentTreeNode,
} from "@shared/api";
import { CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION } from "@shared/api";
import {
  IconBrain,
  IconFolder,
  IconFolderOpen,
  IconPlus,
  IconRestore,
  IconSearch,
  IconSettings,
  IconTrashX,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconChevronDown,
  IconChevronRight,
  IconDots,
  IconTrash,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import { ContentFilesSidebarView } from "@/components/editor/database/sidebar";
import { QueryErrorState } from "@/components/QueryErrorState";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  applyOptimisticItemToContentDatabase,
  contentDatabaseByIdQueryKey,
  removeOptimisticItemFromContentDatabase,
  useContentDatabaseById,
  useContentDatabasePersonalView,
  useUpdateContentDatabasePersonalView,
  useCreateContentDatabase,
  useDeleteContentDatabase,
  useRestoreContentDatabase,
  useTrashedContentDatabases,
} from "@/hooks/use-content-database";
import {
  useCreateContentSpace,
  useContentSpaces,
  useEnsureContentSpaces,
  type ContentSpaceSummary,
} from "@/hooks/use-content-spaces";
import {
  useDocuments,
  useCreateDocument,
  useDeleteDocument,
  useMoveDocument,
  useUpdateDocument,
  buildDocumentTree,
  filterDocumentTreeDocuments,
} from "@/hooks/use-documents";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { cn } from "@/lib/utils";

import {
  getDocumentSidebarSections,
  isDirectLocalDocument,
} from "./document-sidebar-sections";
import {
  DocumentSidebarIcon,
  DocumentTreeItem,
  FavoriteDocumentItem,
} from "./DocumentTreeItem";
import { NotionButton } from "./NotionButton";
import {
  contentSpaceAvailability,
  contentSpaceForStoredSelection,
  createContentSpaceSelectionQueue,
  ensureWorkspaceExpanded,
  SELECTED_CONTENT_SPACE_STORAGE_KEY,
  selectContentSpace,
  toggleExpandedWorkspaceIds,
} from "./select-content-space";

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
  | "favorites"
  | "local-files"
  | "shared-copies"
  | "private"
  | "organization"
  | "trash";

type CollapsedSectionsState = Record<SidebarSectionId, boolean>;

const SIDEBAR_SECTION_COLLAPSE_STORAGE_KEY =
  "content-sidebar-collapsed-sections";
const EXPANDED_WORKSPACES_STORAGE_KEY = "content-sidebar-expanded-workspaces";
const DEFAULT_COLLAPSED_SECTIONS: CollapsedSectionsState = {
  favorites: false,
  "local-files": false,
  "shared-copies": false,
  private: false,
  organization: false,
  trash: false,
};

function normalizeCollapsedSections(
  value: Partial<Record<SidebarSectionId, boolean>> | null | undefined,
): CollapsedSectionsState {
  return {
    favorites: value?.favorites ?? false,
    "local-files": value?.["local-files"] ?? false,
    "shared-copies": value?.["shared-copies"] ?? false,
    private: value?.private ?? false,
    organization: value?.organization ?? false,
    trash: value?.trash ?? false,
  };
}

interface RemoveLocalFileSourceResult {
  success: boolean;
  deleted: number;
}

function WorkspaceFilesSection({
  space,
  selected,
  activeDocumentId,
  onActivate,
  onCreateChildPage,
  onCreateChildDatabase,
  onDeleteItem,
  onToggleFavorite,
}: {
  space: ContentSpaceSummary;
  selected: boolean;
  activeDocumentId: string | null;
  onActivate: (space: ContentSpaceSummary, documentId?: string) => void;
  onCreateChildPage: (
    space: ContentSpaceSummary,
    item: ContentDatabaseItem,
  ) => void;
  onCreateChildDatabase: (
    space: ContentSpaceSummary,
    item: ContentDatabaseItem,
  ) => void;
  onDeleteItem: (item: ContentDatabaseItem) => void;
  onToggleFavorite: (item: ContentDatabaseItem) => void;
}) {
  const t = useT();
  const filesDatabase = useContentDatabaseById(space.filesDatabaseId);
  const filesPersonalView = useContentDatabasePersonalView(
    space.filesDatabaseId,
  );
  const updateFilesPersonalView = useUpdateContentDatabasePersonalView(
    space.filesDatabaseId,
  );
  const failed = filesDatabase.isError || filesPersonalView.isError;

  return (
    <div className="ms-3 border-s border-border/70 pb-1 ps-1">
      {failed ? (
        <QueryErrorState
          compact
          onRetry={() => {
            void filesDatabase.refetch();
            void filesPersonalView.refetch();
          }}
          retrying={filesDatabase.isFetching || filesPersonalView.isFetching}
        />
      ) : (
        <ContentFilesSidebarView
          data={filesDatabase.data}
          overrides={filesPersonalView.data?.overrides}
          isLoading={filesDatabase.isLoading || filesPersonalView.isLoading}
          activeDocumentId={activeDocumentId}
          onSelectView={(viewId) => {
            const current = filesPersonalView.data?.overrides;
            updateFilesPersonalView.mutate({
              databaseId: space.filesDatabaseId,
              overrides: {
                version:
                  current?.version ??
                  CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION,
                activeViewId: viewId,
                views: current?.views ?? [],
              },
            });
          }}
          onOpenItem={(item: ContentDatabaseItem) => {
            if (selected) return false;
            onActivate(space, item.document.id);
            return true;
          }}
          onCreateChildPage={(item) => onCreateChildPage(space, item)}
          onCreateChildDatabase={(item) => onCreateChildDatabase(space, item)}
          onDeleteItem={onDeleteItem}
          onToggleFavorite={onToggleFavorite}
          labels={{
            loadingLabel: t("sidebar.loadingFiles"),
            noMatchesLabel: t("database.noRowsMatchThisView"),
            clearLabel: t("database.clearSearchAndFilters"),
            navigationLabel: `${space.name} ${t("sidebar.files")}`,
            untitledLabel: t("sidebar.untitled"),
          }}
        />
      )}
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
  const t = useT();
  const documentsQuery = useDocuments();
  const { data: documents = [], isLoading } = documentsQuery;
  const createDocument = useCreateDocument();
  const createDatabase = useCreateContentDatabase(null);
  const deleteContentDatabase = useDeleteContentDatabase();
  const deleteDocument = useDeleteDocument();
  const moveDocument = useMoveDocument();
  const restoreContentDatabase = useRestoreContentDatabase();
  const { data: trashedDatabases } = useTrashedContentDatabases();
  const { isCodeMode } = useCodeMode();
  const updateDocument = useUpdateDocument();
  const contentSpacesQuery = useContentSpaces();
  const createContentSpace = useCreateContentSpace();
  const ensureContentSpaces = useEnsureContentSpaces();
  const workspaceSelectionQueueRef = useRef(createContentSpaceSelectionQueue());
  const contentSpaces = contentSpacesQuery.data?.spaces ?? [];
  const workspaceCatalogDatabaseId =
    contentSpacesQuery.data?.catalogDatabaseId ?? null;
  const workspaceCatalogDatabase = useContentDatabaseById(
    workspaceCatalogDatabaseId,
  );
  const workspaceCatalogPersonalView = useContentDatabasePersonalView(
    workspaceCatalogDatabaseId,
  );
  const updateWorkspaceCatalogPersonalView =
    useUpdateContentDatabasePersonalView(workspaceCatalogDatabaseId);
  const spaceProvisionAttemptedRef = useRef(false);
  useEffect(() => {
    if (
      contentSpacesQuery.isSuccess &&
      !spaceProvisionAttemptedRef.current &&
      !ensureContentSpaces.isPending
    ) {
      spaceProvisionAttemptedRef.current = true;
      ensureContentSpaces.mutate({});
    }
  }, [
    contentSpacesQuery.isSuccess,
    ensureContentSpaces,
    ensureContentSpaces.isPending,
  ]);
  const [storedSpaceId, setStoredSpaceId] = useLocalStorage<string | null>(
    SELECTED_CONTENT_SPACE_STORAGE_KEY,
    null,
  );
  const selectedSpace = contentSpaceForStoredSelection({
    spaces: contentSpaces,
    storedSpaceId,
  });
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useLocalStorage<
    string[]
  >(EXPANDED_WORKSPACES_STORAGE_KEY, []);
  const [createWorkspaceDialogOpen, setCreateWorkspaceDialogOpen] =
    useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const createWorkspaceRequestIdRef = useRef<string | null>(null);
  const contentSpaceState = contentSpaceAvailability({
    hasSelectedSpace: Boolean(selectedSpace),
    contentSpacesLoading: contentSpacesQuery.isLoading,
    contentSpacesFetching: contentSpacesQuery.isFetching,
    contentSpacesError: contentSpacesQuery.isError,
    provisioningAttempted: spaceProvisionAttemptedRef.current,
    provisioningPending: ensureContentSpaces.isPending,
    provisioningError: ensureContentSpaces.isError,
  });
  const handleRetryContentSpaces = useCallback(() => {
    if (contentSpacesQuery.isError) {
      spaceProvisionAttemptedRef.current = false;
      void contentSpacesQuery.refetch();
      return;
    }
    spaceProvisionAttemptedRef.current = true;
    ensureContentSpaces.mutate({});
  }, [contentSpacesQuery, ensureContentSpaces]);
  useEffect(() => {
    if (selectedSpace && selectedSpace.id !== storedSpaceId) {
      setStoredSpaceId(selectedSpace.id);
    }
  }, [selectedSpace, setStoredSpaceId, storedSpaceId]);
  useEffect(() => {
    if (!selectedSpace) return;
    setExpandedWorkspaceIds((current) =>
      ensureWorkspaceExpanded(current, selectedSpace.id),
    );
  }, [selectedSpace, setExpandedWorkspaceIds]);
  const handleSelectContentSpace = useCallback(
    async (
      space: (typeof contentSpaces)[number],
      targetDocumentId?: string | null,
    ) => {
      setExpandedWorkspaceIds((current) =>
        ensureWorkspaceExpanded(current, space.id),
      );
      try {
        await workspaceSelectionQueueRef.current(() =>
          selectContentSpace({
            space,
            syncApplicationState: (selected) =>
              setClientAppState(
                "content-space",
                {
                  spaceId: selected.id,
                  name: selected.name,
                  kind: selected.kind,
                  filesDatabaseId: selected.filesDatabaseId,
                },
                { requestSource: "content-sidebar" },
              ),
            persistSelection: setStoredSpaceId,
            openFiles: (documentId) => {
              if (targetDocumentId === null) return;
              navigate(`/page/${targetDocumentId ?? documentId}`, {
                flushSync: true,
              });
            },
          }),
        );
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
        return false;
      }
    },
    [navigate, setExpandedWorkspaceIds, setStoredSpaceId],
  );
  const handleCreateWorkspace = useCallback(async () => {
    const name = newWorkspaceName.trim();
    if (!name) return;
    const requestId = createWorkspaceRequestIdRef.current ?? nanoid();
    createWorkspaceRequestIdRef.current = requestId;
    try {
      const created = await createContentSpace.mutateAsync({ name, requestId });
      const space: ContentSpaceSummary = {
        id: created.spaceId,
        name: created.name,
        kind: created.kind,
        filesDatabaseId: created.filesDatabaseId,
        filesDocumentId: created.filesDocumentId,
        orgId: null,
        role: "owner",
        catalogItemId: created.catalogItemId,
        catalogDocumentId: created.catalogDocumentId,
      };
      const selected = await handleSelectContentSpace(space);
      if (!selected) return;
      setCreateWorkspaceDialogOpen(false);
      setNewWorkspaceName("");
      createWorkspaceRequestIdRef.current = null;
    } catch (error) {
      toast.error(t("sidebar.failedCreateWorkspace"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [createContentSpace, handleSelectContentSpace, newWorkspaceName, t]);
  useEffect(() => {
    if (!selectedSpace) return;
    void setClientAppState(
      "content-space",
      {
        spaceId: selectedSpace.id,
        name: selectedSpace.name,
        kind: selectedSpace.kind,
        filesDatabaseId: selectedSpace.filesDatabaseId,
      },
      { requestSource: "content-sidebar" },
    ).catch(() => {
      // Space selection remains usable when best-effort agent context sync fails.
    });
  }, [selectedSpace]);
  const removeLocalFileSource = useActionMutation<
    RemoveLocalFileSourceResult,
    { sourceRootPath?: string | null }
  >("remove-local-file-source");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  // Track user-expanded nodes only; active ancestors are derived below so they
  // do not stay open after navigation unless the user explicitly expanded them.
  const expandedIdsRef = useRef(new Set<string>());
  const [, forceUpdate] = useState(0);
  const [isResizing, setIsResizing] = useState(false);
  const [storedCollapsedSections, setStoredCollapsedSections] = useLocalStorage<
    Partial<Record<SidebarSectionId, boolean>>
  >(SIDEBAR_SECTION_COLLAPSE_STORAGE_KEY, DEFAULT_COLLAPSED_SECTIONS);
  const collapsedSections = useMemo(
    () => normalizeCollapsedSections(storedCollapsedSections),
    [storedCollapsedSections],
  );
  const [removeLocalFilesDialogOpen, setRemoveLocalFilesDialogOpen] =
    useState(false);
  const agentActive = location.pathname.startsWith("/agent");
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
  const importedLocalFileCount = localFileMode
    ? 0
    : localSourceDocuments.filter(
        (document) => document.source?.kind !== "folder",
      ).length;
  const canRemoveLocalFiles = localFileMode || importedLocalFileCount > 0;
  // Match the tree rows' right-side inset so favorite titles clip inside the
  // visible sidebar instead of widening the scroll surface.
  const favoriteRowWidth =
    width === undefined ? undefined : Math.max(208, width - 24);
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
    async (
      parentId?: string,
      rootSpaceId = selectedSpace?.id,
      optimisticId?: string,
      rootFilesDatabaseId?: string,
    ) => {
      if (localFileMode) {
        try {
          const created = await createDocument.mutateAsync({
            title: "",
            parentId: parentId ?? undefined,
            spaceId: parentId ? undefined : rootSpaceId,
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

      const id = optimisticId ?? nanoid();
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
      if (rootFilesDatabaseId) {
        const optimisticItem: ContentDatabaseItem = {
          id: `optimistic-${id}`,
          databaseId: rootFilesDatabaseId,
          document: tempDoc,
          position: tempDoc.position,
          properties: [],
        };
        queryClient.setQueryData<ContentDatabaseResponse>(
          contentDatabaseByIdQueryKey(rootFilesDatabaseId),
          (current) =>
            applyOptimisticItemToContentDatabase(current, optimisticItem),
        );
      }

      navigateToDocument(id);
      onNavigate?.();

      try {
        const created = await createDocument.mutateAsync({
          id,
          title: "",
          parentId: parentId ?? undefined,
          spaceId: parentId ? undefined : rootSpaceId,
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
        if (rootFilesDatabaseId) {
          queryClient.invalidateQueries({
            queryKey: contentDatabaseByIdQueryKey(rootFilesDatabaseId),
          });
        }
      } catch (err) {
        // Revert optimistic updates
        queryClient.invalidateQueries({
          queryKey: ["action", "list-documents"],
        });
        queryClient.removeQueries({
          queryKey: ["action", "get-document", { id }],
        });
        if (rootFilesDatabaseId) {
          queryClient.setQueryData<ContentDatabaseResponse>(
            contentDatabaseByIdQueryKey(rootFilesDatabaseId),
            (current) => removeOptimisticItemFromContentDatabase(current, id),
          );
        }
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
      selectedSpace?.id,
    ],
  );

  const handleCreateDatabase = useCallback(
    async (parentId?: string | null, rootSpaceId = selectedSpace?.id) => {
      try {
        const result = await createDatabase.mutateAsync({
          parentId: parentId ?? null,
          spaceId: parentId ? undefined : rootSpaceId,
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
    [createDatabase, navigateToDocument, onNavigate, selectedSpace?.id, t],
  );

  const handleCreatePageInSpace = useCallback(
    async (space: ContentSpaceSummary) => {
      const id = nanoid();
      if (selectedSpace?.id !== space.id) {
        void handleSelectContentSpace(space, null);
      }
      await handleCreatePage(undefined, space.id, id, space.filesDatabaseId);
    },
    [handleCreatePage, handleSelectContentSpace, selectedSpace?.id],
  );

  const handleOpenFavorite = useCallback(
    (document: Document) => {
      const space = contentSpaces.find(
        (candidate) =>
          candidate.filesDocumentId ===
          document.databaseMembership?.databaseDocumentId,
      );
      if (space) {
        void handleSelectContentSpace(space, document.id);
        return;
      }
      navigateToDocument(document.id);
    },
    [contentSpaces, handleSelectContentSpace, navigateToDocument],
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
      updateDocument.mutate(
        { id, isFavorite },
        {
          onError: (error) => {
            toast.error(t("sidebar.failedUpdateFavorite"), {
              description:
                error instanceof Error
                  ? error.message
                  : t("empty.genericError"),
            });
          },
        },
      );
    },
    [t, updateDocument],
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

  const handleRemoveLocalFiles = useCallback(async () => {
    try {
      const result = await removeLocalFileSource.mutateAsync({});
      queryClient.invalidateQueries({
        queryKey: ["action", "list-documents"],
      });
      setRemoveLocalFilesDialogOpen(false);
      toast.success(t("sidebar.localFilesRemoved"), {
        description: t("sidebar.localFilesRemovedDescription", {
          count: result.deleted,
        }),
      });
    } catch (err) {
      toast.error(t("sidebar.failedRemoveLocalFiles"), {
        description:
          err instanceof Error ? err.message : t("empty.genericError"),
      });
    }
  }, [queryClient, removeLocalFileSource, t]);

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

  const renderNewButton = (space = selectedSpace) =>
    space ? (
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-2 rounded-md px-3 py-[5px] text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        disabled={createDocument.isPending}
        onClick={() => void handleCreatePageInSpace(space)}
      >
        <IconPlus size={14} className="shrink-0" />
        <span>{t("sidebar.newPage")}</span>
      </button>
    ) : null;

  const renderCollapsedNewButton = () =>
    selectedSpace ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground"
            disabled={createDocument.isPending}
            onClick={() => void handleCreatePageInSpace(selectedSpace)}
          >
            <IconPlus size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("sidebar.newPage")}</TooltipContent>
      </Tooltip>
    ) : null;

  const renderSettingsNavButton = () => (
    <Link
      to="/settings"
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm",
        settingsActive
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <IconSettings size={15} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate text-start">
        {t("navigation.settings")}
      </span>
    </Link>
  );

  const renderAgentNavButton = () => (
    <Link
      to="/agent"
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm",
        agentActive
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <IconBrain size={15} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate text-start">
        {t("navigation.agent")}
      </span>
    </Link>
  );

  const toggleSection = (id: SidebarSectionId) => {
    setStoredCollapsedSections((current) => {
      const normalized = normalizeCollapsedSections(current);
      return {
        ...normalized,
        [id]: !normalized[id],
      };
    });
  };

  const renderLocalFilesSectionActions = () => (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("sidebar.localFilesActions")}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <IconDots size={14} />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("sidebar.localFilesActions")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem asChild>
          <Link to="/local-files">
            <IconFolderOpen className="me-2 size-4" />
            {t("sidebar.manageLocalFolders")}
          </Link>
        </DropdownMenuItem>
        {canRemoveLocalFiles && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              disabled={removeLocalFileSource.isPending}
              onSelect={(event) => {
                event.preventDefault();
                setRemoveLocalFilesDialogOpen(true);
              }}
            >
              <IconTrash className="me-2 size-4" />
              {t("sidebar.removeLocalFilesFromSidebar")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const renderSectionHeader = (
    id: SidebarSectionId,
    label: string,
    actions?: ReactNode,
  ) => {
    const collapsed = collapsedSections[id];
    return (
      <div className="flex min-w-0 items-center gap-1 px-1">
        <button
          type="button"
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-2 py-1.5 text-start text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-accent/40 hover:text-foreground"
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
        {actions}
      </div>
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
    headerActions,
    footer,
  }: {
    id: SidebarSectionId;
    label: string;
    nodes: DocumentTreeNode[];
    emptyLabel: string;
    className?: string;
    headerActions?: ReactNode;
    footer?: ReactNode;
  }) => {
    const collapsed = collapsedSections[id];
    return (
      <div className={className}>
        {renderSectionHeader(id, label, headerActions)}
        {!collapsed && (
          <>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              {isLoading ? (
                renderTreeSkeleton()
              ) : documentsQuery.isError ? (
                <QueryErrorState
                  compact
                  onRetry={() => void documentsQuery.refetch()}
                  retrying={documentsQuery.isFetching}
                />
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

  const renderWorkspaceRoot = (space: ContentSpaceSummary) => {
    const selected = selectedSpace?.id === space.id;
    const expanded = expandedWorkspaceIds.includes(space.id);
    return (
      <div className="min-w-0">
        <div
          className={cn(
            "flex h-7 w-full min-w-0 items-center rounded-md",
            selected
              ? "text-foreground"
              : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
          )}
        >
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={`${expanded ? t("sidebar.collapse") : t("sidebar.expand")} ${space.name}`}
            className="flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-background/60"
            onClick={() =>
              setExpandedWorkspaceIds((current) =>
                toggleExpandedWorkspaceIds(current, space.id),
              )
            }
          >
            {expanded ? (
              <IconChevronDown size={14} />
            ) : (
              <IconChevronRight size={14} />
            )}
          </button>
          <button
            type="button"
            className="h-7 min-w-0 flex-1 truncate pe-2 text-start text-[10px] font-semibold uppercase tracking-wider"
            onClick={() => void handleSelectContentSpace(space)}
          >
            {space.name}
          </button>
          <button
            type="button"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background/60 hover:text-foreground disabled:opacity-50"
            disabled={createDocument.isPending}
            aria-label={`${t("sidebar.newPage")} — ${space.name}`}
            onClick={() => void handleCreatePageInSpace(space)}
          >
            <IconPlus size={14} />
          </button>
        </div>
        {expanded && (
          <WorkspaceFilesSection
            space={space}
            selected={selected}
            activeDocumentId={activeDocumentId}
            onActivate={(nextSpace, documentId) =>
              void handleSelectContentSpace(nextSpace, documentId)
            }
            onCreateChildPage={(nextSpace, item) =>
              void handleCreatePage(
                item.document.id,
                nextSpace.id,
                undefined,
                nextSpace.filesDatabaseId,
              )
            }
            onCreateChildDatabase={(nextSpace, item) =>
              void handleCreateDatabase(item.document.id, nextSpace.id)
            }
            onDeleteItem={(item) => void handleDelete(item.document.id)}
            onToggleFavorite={(item) =>
              handleToggleFavorite(item.document.id, !item.document.isFavorite)
            }
          />
        )}
      </div>
    );
  };

  const renderWorkspaceNavigation = () => (
    <div className="mb-2 min-w-0 overflow-x-hidden px-2">
      {contentSpaceState === "ready" && selectedSpace ? (
        <div className="grid gap-1">
          {workspaceCatalogDatabase.isError ||
          workspaceCatalogPersonalView.isError ? (
            <QueryErrorState
              compact
              onRetry={() => {
                void workspaceCatalogDatabase.refetch();
                void workspaceCatalogPersonalView.refetch();
              }}
              retrying={
                workspaceCatalogDatabase.isFetching ||
                workspaceCatalogPersonalView.isFetching
              }
            />
          ) : (
            <ContentFilesSidebarView
              data={workspaceCatalogDatabase.data}
              overrides={workspaceCatalogPersonalView.data?.overrides}
              isLoading={
                workspaceCatalogDatabase.isLoading ||
                workspaceCatalogPersonalView.isLoading
              }
              onSelectView={(viewId) => {
                if (!workspaceCatalogDatabaseId) return;
                const current = workspaceCatalogPersonalView.data?.overrides;
                updateWorkspaceCatalogPersonalView.mutate({
                  databaseId: workspaceCatalogDatabaseId,
                  overrides: {
                    version:
                      current?.version ??
                      CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION,
                    activeViewId: viewId,
                    views: current?.views ?? [],
                  },
                });
              }}
              renderItem={(item) => {
                const space = contentSpaces.find(
                  (candidate) =>
                    candidate.catalogDocumentId === item.document.id,
                );
                return space
                  ? renderWorkspaceRoot({
                      ...space,
                      name: item.document.title || space.name,
                    })
                  : null;
              }}
              scroll={false}
              labels={{
                loadingLabel: t("sidebar.loadingFiles"),
                noMatchesLabel: t("database.noRowsMatchThisView"),
                clearLabel: t("database.clearSearchAndFilters"),
                navigationLabel: "Content navigation",
                untitledLabel: t("sidebar.untitled"),
              }}
            />
          )}
          <div className="px-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-7 w-full min-w-0 items-center rounded-md text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                  aria-label={t("sidebar.addWorkspace")}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center">
                    <IconPlus size={14} />
                  </span>
                  <span className="truncate text-start text-[10px] font-semibold uppercase tracking-wider">
                    {t("sidebar.addWorkspace")}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                <DropdownMenuItem
                  onSelect={() => setCreateWorkspaceDialogOpen(true)}
                >
                  <IconPlus className="me-2 size-4" />
                  {t("sidebar.newWorkspace")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/local-files">
                    <IconFolder className="me-2 size-4" />
                    {t("sidebar.localFolder")}
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      ) : contentSpaceState === "loading" ? (
        <div className="px-3 py-4 text-center text-sm text-muted-foreground">
          {t("sidebar.loadingFiles")}
        </div>
      ) : (
        <QueryErrorState
          compact
          onRetry={handleRetryContentSpaces}
          retrying={
            contentSpacesQuery.isFetching || ensureContentSpaces.isPending
          }
        />
      )}
    </div>
  );

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
      <div className="agent-layout-left-drawer flex h-full w-12 flex-col items-center gap-1 border-e border-border bg-sidebar py-3 transition-[width] duration-200 ease-out">
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
            <Link
              to="/agent"
              className={cn(
                "w-10 h-10 flex items-center justify-center rounded-lg hover:bg-accent",
                agentActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <IconBrain size={16} />
            </Link>
          </TooltipTrigger>
          <TooltipContent>{t("navigation.agent")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to="/settings"
              className={cn(
                "w-10 h-10 flex items-center justify-center rounded-lg hover:bg-accent",
                settingsActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <IconSettings size={16} />
            </Link>
          </TooltipTrigger>
          <TooltipContent>{t("navigation.settings")}</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "agent-layout-left-drawer relative flex h-full min-h-0 flex-col border-e border-border bg-sidebar",
        !isResizing && "transition-[width] duration-200 ease-out",
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

      <ScrollArea className="min-h-0 flex-1 [&_[data-radix-scroll-area-viewport]]:!overflow-x-hidden">
        <div className="w-full min-w-0 py-2 pe-2">
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
                <div className="mb-2 min-w-0 px-2">
                  <div className="flex h-7 w-full min-w-0 items-center rounded-md px-1 text-muted-foreground hover:bg-accent/40 hover:text-foreground">
                    <button
                      type="button"
                      aria-expanded={!collapsedSections.favorites}
                      aria-label={`${collapsedSections.favorites ? t("sidebar.expand") : t("sidebar.collapse")} ${t("sidebar.favorites")}`}
                      className="flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-background/60"
                      onClick={() => toggleSection("favorites")}
                    >
                      {collapsedSections.favorites ? (
                        <IconChevronRight size={14} />
                      ) : (
                        <IconChevronDown size={14} />
                      )}
                    </button>
                    <Link
                      to="/favorites"
                      className={cn(
                        "h-7 min-w-0 flex-1 truncate pe-2 text-start text-[10px] font-semibold uppercase tracking-wider leading-7",
                        location.pathname === "/favorites" && "text-foreground",
                      )}
                    >
                      {t("sidebar.favorites")}
                    </Link>
                  </div>
                  {!collapsedSections.favorites &&
                    favorites.map((doc) => (
                      <FavoriteDocumentItem
                        key={doc.id}
                        document={doc}
                        active={doc.id === activeDocumentId}
                        sidebarWidth={favoriteRowWidth}
                        onSelect={() => {
                          handleOpenFavorite(doc);
                          onNavigate?.();
                        }}
                        onCreateChildPage={() => void handleCreatePage(doc.id)}
                        onCreateChildDatabase={() =>
                          void handleCreateDatabase(doc.id)
                        }
                        onRemoveFavorite={() =>
                          handleToggleFavorite(doc.id, false)
                        }
                        onDelete={() => void handleDelete(doc.id)}
                      />
                    ))}
                </div>
              )}

              {renderWorkspaceNavigation()}
              {renderTrashSection()}
            </>
          )}
        </div>
      </ScrollArea>

      <div className="shrink-0 px-3 py-2">
        <div className="space-y-1">
          {renderAgentNavButton()}
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
      <Dialog
        open={createWorkspaceDialogOpen}
        onOpenChange={(open) => {
          setCreateWorkspaceDialogOpen(open);
          if (!open && !createContentSpace.isPending) {
            setNewWorkspaceName("");
            createWorkspaceRequestIdRef.current = null;
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreateWorkspace();
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("sidebar.newWorkspace")}</DialogTitle>
              <DialogDescription>
                {t("sidebar.newWorkspaceDescription")}
              </DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              aria-label={t("sidebar.workspaceName")}
              placeholder={t("sidebar.workspaceName")}
              value={newWorkspaceName}
              maxLength={200}
              onChange={(event) => setNewWorkspaceName(event.target.value)}
            />
            <DialogFooter>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium hover:bg-accent"
                disabled={createContentSpace.isPending}
                onClick={() => setCreateWorkspaceDialogOpen(false)}
              >
                {t("comments.cancel")}
              </button>
              <button
                type="submit"
                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                disabled={
                  createContentSpace.isPending || !newWorkspaceName.trim()
                }
              >
                {t("sidebar.createWorkspace")}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={removeLocalFilesDialogOpen}
        onOpenChange={setRemoveLocalFilesDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("sidebar.removeLocalFilesQuestion")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("sidebar.removeLocalFilesDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("comments.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={removeLocalFileSource.isPending}
              onClick={(event) => {
                event.preventDefault();
                void handleRemoveLocalFiles();
              }}
            >
              {t("sidebar.removeLocalFilesFromSidebar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
