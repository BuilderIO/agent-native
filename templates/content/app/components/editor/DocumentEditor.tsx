import { BlockRegistryProvider } from "@agent-native/core/blocks";
import { generateTabId } from "@agent-native/core/client/agent-chat";
import { agentNativePath } from "@agent-native/core/client/api-path";
import {
  useCollaborativeDoc,
  emailToColor,
  emailToName,
  type CollabUser,
} from "@agent-native/core/client/collab";
import {
  setClientAppState,
  useAvatarUrl,
  useDbSync,
  useSession,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { Document, DocumentSyncStatus } from "@shared/api";
import {
  IconDatabase,
  IconFileText,
  IconLoader2,
  IconX,
} from "@tabler/icons-react";
import { IconLock } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ClipboardEvent, MutableRefObject } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import {
  contentBlockRegistry,
  createContentBlockRenderContext,
} from "@/blocks/contentBlockRegistry";
import {
  createContentSpaceSelectionQueue,
  SELECTED_CONTENT_SPACE_STORAGE_KEY,
  selectContentSpace,
} from "@/components/sidebar/select-content-space";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useComments } from "@/hooks/use-comments";
import {
  useCreateContentDatabase,
  useDeleteContentDatabase,
  useProcessBuilderBodyHydration,
} from "@/hooks/use-content-database";
import {
  useContentSpaces,
  type ContentSpaceSummary,
} from "@/hooks/use-content-spaces";
import {
  isDocumentUpdateConflict,
  patchDocumentCaches,
  useDocument,
  useDeleteDocument,
  useDocuments,
  useUpdateDocument,
} from "@/hooks/use-documents";
import type { DocumentUpdateConflictResponse } from "@/hooks/use-documents";
import { useLocalStorage } from "@/hooks/use-local-storage";
import {
  documentSyncStatusQueryKey,
  useDocumentSyncStatus,
  usePushDocumentToNotion,
} from "@/hooks/use-notion";
import {
  canWriteLinkedLocalSource,
  writeDocumentToLinkedLocalSource,
} from "@/lib/local-content-source-files";
import { isDatabaseChoicePending } from "@/lib/optimistic-document";
import { cn } from "@/lib/utils";

import {
  documentBodyHydrationIsPending,
  isEffectivelyEmptyDocumentContent,
} from "./body-hydration";
import { BuilderBodySyncingNotice } from "./BuilderBodySyncingNotice";
import type { CommentTextAnchor } from "./comment-anchors";
import { CommentsSidebar } from "./CommentsSidebar";
import { DocumentBlockFields } from "./DocumentBlockFields";
import { DocumentDatabase } from "./DocumentDatabase";
import { DocumentEditorSkeleton } from "./DocumentEditorSkeleton";
import { DocumentInfoPanel } from "./DocumentInfoPanel";
import { DocumentToolbar, type ToolbarBreadcrumbItem } from "./DocumentToolbar";
import { EmojiPicker } from "./EmojiPicker";
import { NotionConflictBanner } from "./NotionConflictBanner";
import {
  normalizeTitleText,
  stripMarkdownHeadingPrefixFromTitlePaste,
} from "./title-text";
import { VisualEditor } from "./VisualEditor";
import type { NotionPageLink } from "./VisualEditor";

const TAB_ID = generateTabId();

interface DocumentEditorProps {
  documentId: string;
  databaseId?: string | null;
  databaseDocumentId?: string | null;
}

type FieldSaveWatermark = { title: string; updatedAt: string | null };
type ContentSaveWatermark = { content: string; updatedAt: string | null };
type DocumentUtilityPanel = "info" | "comments" | null;

export function metadataUpdatesWithPendingTitle<
  T extends {
    title?: string;
    content?: string;
    description?: string;
    icon?: string | null;
  },
>(
  updates: T,
  currentTitle: string,
  savedTitle: string,
): T & { title?: string } {
  if (updates.title !== undefined || currentTitle === savedTitle)
    return updates;
  return { ...updates, title: currentTitle };
}

export function titleMatchConfirmsSave(args: {
  serverTitle: string;
  localTitle: string;
  lastSavedTitle: string;
  pendingTitle: string | null;
}) {
  if (args.serverTitle !== args.localTitle) return false;
  return !(
    args.pendingTitle === args.localTitle &&
    args.localTitle !== args.lastSavedTitle
  );
}

function adoptConfirmedSaveWatermarks({
  saved,
  savedAt,
  title,
  content,
  updates,
  lastSavedTitleRef,
  lastSavedContentRef,
}: {
  saved: Document | undefined;
  savedAt: string;
  title: string;
  content: string;
  updates: {
    title?: string;
    content?: string;
    icon?: string | null;
  };
  lastSavedTitleRef: MutableRefObject<FieldSaveWatermark>;
  lastSavedContentRef: MutableRefObject<ContentSaveWatermark>;
}) {
  if (updates.title !== undefined) {
    lastSavedTitleRef.current = { title, updatedAt: savedAt };
  } else if (
    (updates.content !== undefined || updates.icon !== undefined) &&
    saved?.title === lastSavedTitleRef.current.title
  ) {
    lastSavedTitleRef.current = {
      ...lastSavedTitleRef.current,
      updatedAt: savedAt,
    };
  }
  if (updates.content !== undefined) {
    lastSavedContentRef.current = { content, updatedAt: savedAt };
  } else if (
    (updates.title !== undefined || updates.icon !== undefined) &&
    saved?.content === lastSavedContentRef.current.content
  ) {
    lastSavedContentRef.current = {
      ...lastSavedContentRef.current,
      updatedAt: savedAt,
    };
  }
}

function DocumentUnavailable({ onOpenHome }: { onOpenHome: () => void }) {
  const t = useT();

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-background px-6">
      <div className="flex max-w-sm flex-col items-center text-center">
        <div className="mb-5 flex size-12 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground">
          <IconLock size={22} />
        </div>
        <h1 className="text-2xl font-semibold tracking-normal">
          {t("empty.documentUnavailable")}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {t("empty.documentUnavailableDescription")}
        </p>
        <Button className="mt-6" variant="outline" onClick={onOpenHome}>
          {t("empty.goToDocuments")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Outer wrapper: gates the editor on the document fetch so collab + comments
 * only mount once we know the doc exists. Otherwise an invalid id triggers
 * an infinite spinner plus repeating 404/403 polls in the console.
 */
export function DocumentEditor({
  documentId,
  databaseId,
  databaseDocumentId,
}: DocumentEditorProps) {
  const { data: queriedDocument, isError } = useDocument(documentId);
  const navigate = useNavigate();
  const document =
    queriedDocument?.id === documentId ? queriedDocument : undefined;

  if (isError && !document) {
    return <DocumentUnavailable onOpenHome={() => navigate("/")} />;
  }

  // If we have a doc (real or optimistic from create) render the editor —
  // an `isError` blip during a just-fired create shouldn't flash "not found".
  if (!document) {
    return <DocumentEditorSkeleton />;
  }

  return (
    <DocumentEditorBody
      documentId={documentId}
      document={document}
      databaseId={databaseId}
      databaseDocumentId={databaseDocumentId}
    />
  );
}

interface DocumentEditorBodyProps {
  documentId: string;
  document: Document;
  databaseId?: string | null;
  databaseDocumentId?: string | null;
}

type PendingDocumentSave = {
  title: string;
  content: string;
  save: (
    title: string,
    content: string,
    options?: DocumentSaveOptions,
  ) => unknown | Promise<unknown>;
  canEditWhenQueued: boolean;
  timeout: ReturnType<typeof setTimeout>;
};

type DocumentSaveOptions = {
  allowQueuedSave?: boolean;
};

type DocumentSaveResult = {
  contentPersisted: boolean;
};

function useMinViewportWidth(minWidth: number) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia(`(min-width: ${minWidth}px)`);
    const update = () => setMatches(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [minWidth]);

  return matches;
}

export function documentEditorTitleRegionClassName(hasDatabase: boolean) {
  if (hasDatabase) {
    return cn(
      "shrink-0 w-full max-w-none px-4 pt-14 pb-2 sm:px-8 sm:pt-7 lg:px-10 group/title",
    );
  }

  return cn(
    "shrink-0 w-full max-w-3xl mx-auto px-4 pt-14 sm:px-8 md:px-16 md:pt-16 group/title",
    "pb-8",
  );
}

export function documentEditorDatabaseRegionClassName() {
  return "shrink-0 min-w-0 w-full max-w-none px-4 pb-8 sm:px-8 lg:px-10";
}

export function documentEditorDefaultIconKind(
  document: Pick<Document, "database">,
) {
  return document.database ? "database" : null;
}

export function databaseMembershipDatabaseTitle(
  membership: Document["databaseMembership"],
) {
  return membership?.databaseTitle?.trim() || "Untitled database";
}

export function documentEditorBreadcrumbItems(
  document: Pick<
    Document,
    "id" | "parentId" | "title" | "icon" | "databaseMembership"
  >, // i18n-ignore type expression
  documents: Pick<Document, "id" | "parentId" | "title" | "icon">[], // i18n-ignore type expression
) {
  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  const parents: { id: string; title: string; icon: string | null }[] = [];
  const seen = new Set<string>([document.id]);
  let parentId = document.parentId;

  while (parentId) {
    if (seen.has(parentId)) break;
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    parents.unshift({
      id: parent.id,
      title: parent.title,
      icon: parent.icon,
    });
    parentId = parent.parentId;
  }

  const pageItems = [
    ...parents,
    {
      id: document.id,
      title: document.title,
      icon: document.icon,
    },
  ];
  const membership = document.databaseMembership;
  if (
    !membership ||
    pageItems.some((item) => item.id === membership.databaseDocumentId)
  ) {
    return pageItems;
  }

  return [
    {
      id: membership.databaseDocumentId,
      title: databaseMembershipDatabaseTitle(membership),
      icon: null,
    },
    ...pageItems,
  ];
}

export function documentEditorBreadcrumbNavigationItems(
  items: ToolbarBreadcrumbItem[],
  documents: Pick<
    Document,
    | "id"
    | "parentId"
    | "title"
    | "icon"
    | "position"
    | "databaseMembership"
    | "source"
  >[], // i18n-ignore type expression
  spaces: Pick<ContentSpaceSummary, "filesDocumentId" | "name">[], // i18n-ignore type expression
  context?: {
    currentDocumentId: string;
    currentParentId: string | null;
    currentDatabaseSystemRole: string | null;
    catalogDocumentId: string | null;
    workspacesTitle: string;
  },
): ToolbarBreadcrumbItem[] {
  const documentById = new Map(documents.map((item) => [item.id, item]));
  const workspaceDocumentIds = new Set(
    spaces.map((space) => space.filesDocumentId),
  );

  const navigationItems = items.map<ToolbarBreadcrumbItem>((item) => {
    if (item.id && workspaceDocumentIds.has(item.id)) {
      return {
        ...item,
        iconKind: "folder",
        menuItems: spaces.map((space) => ({
          id: space.filesDocumentId,
          title: space.name,
          icon: null,
          iconKind: "folder",
        })),
      };
    }

    const current = item.id ? documentById.get(item.id) : null;
    if (!current) return item;
    const membershipDocumentId =
      current.databaseMembership?.databaseDocumentId ?? null;
    const siblings = documents
      .filter((candidate) => {
        if (candidate.source?.kind === "folder") return false;
        if (candidate.parentId !== current.parentId) return false;
        if (current.parentId) return true;
        return (
          candidate.databaseMembership?.databaseDocumentId ===
          membershipDocumentId
        );
      })
      .sort(
        (left, right) =>
          left.position - right.position ||
          left.title.localeCompare(right.title),
      );
    if (siblings.length < 2) return item;
    return {
      ...item,
      menuItems: siblings.map((sibling) => ({
        id: sibling.id,
        title: sibling.title,
        icon: sibling.icon,
      })),
    };
  });

  if (
    context?.catalogDocumentId &&
    context.currentParentId === null &&
    context.currentDatabaseSystemRole === "files" &&
    workspaceDocumentIds.has(context.currentDocumentId)
  ) {
    const workspacesItem: ToolbarBreadcrumbItem = {
      id: context.catalogDocumentId,
      title: context.workspacesTitle,
      iconKind: "folder",
    };
    return [workspacesItem, ...navigationItems];
  }

  return navigationItems;
}

function DocumentEditorBody({
  documentId,
  document,
  databaseId,
  databaseDocumentId,
}: DocumentEditorBodyProps) {
  const t = useT();
  const updateDocument = useUpdateDocument();
  const createDatabase = useCreateContentDatabase(documentId);
  const deleteContentDatabase = useDeleteContentDatabase();
  const deleteDocument = useDeleteDocument();
  const queryClient = useQueryClient();
  const processBuilderBodies = useProcessBuilderBodyHydration(
    document.databaseMembership?.databaseDocumentId ?? documentId,
  );
  const canEdit = document.canEdit ?? true;
  const canEditRef = useRef(canEdit);
  // The block render context (asset/upload resolvers, inline markdown reader,
  // panel popover) is stable for the editor's lifetime. Created once here and
  // provided alongside the content block registry so every registry block in the
  // editor subtree renders through the same wiring.
  const blockRenderContext = useMemo(
    () => createContentBlockRenderContext({ documentId, canEdit }),
    [documentId, canEdit],
  );
  const navigate = useNavigate();
  const documentsQuery = useDocuments();
  const documents: Document[] = documentsQuery.data ?? [];
  const contentSpacesQuery = useContentSpaces();
  const contentSpaces = contentSpacesQuery.data?.spaces ?? [];
  const workspaceSelectionQueueRef = useRef(createContentSpaceSelectionQueue());
  const [, setStoredSpaceId] = useLocalStorage<string | null>(
    SELECTED_CONTENT_SPACE_STORAGE_KEY,
    null,
  );
  // Shared with DocumentToolbar via the same localStorage key — both read it.
  const [autoSync] = useLocalStorage(`notion-auto-sync:${documentId}`, false);
  const isLocalFileDocument = document.source?.mode === "local-files";
  const canDelete =
    !isLocalFileDocument &&
    !document.database?.systemRole &&
    (document.canManage === true ||
      document.accessRole === "owner" ||
      document.accessRole === "admin");
  const isLinkedLocalSourceDocument = canWriteLinkedLocalSource(
    documentId,
    document.source,
  );
  // Polls Notion sync status to drive the conflict banner / sync bar and the
  // push-on-save path below (read via the query cache, not this return value).
  useDocumentSyncStatus(canEdit && !isLocalFileDocument ? documentId : null, {
    autoSync,
  });
  const pushDocumentToNotion = usePushDocumentToNotion(documentId);
  const [localTitle, setLocalTitle] = useState("");
  const [localContent, setLocalContent] = useState("");
  const [newDocumentTypeChosen, setNewDocumentTypeChosen] = useState(false);
  const [localContentUpdatedAt, setLocalContentUpdatedAt] = useState<
    string | null
  >(document.updatedAt ?? null);
  const handleDeleteDocument = useCallback(async () => {
    try {
      if (document.database) {
        await deleteContentDatabase.mutateAsync({
          databaseId: document.database.id,
        });
      } else {
        await deleteDocument.mutateAsync({ id: documentId });
      }
      navigate("/", { replace: true, flushSync: true });
    } catch (error) {
      toast.error(t("sidebar.failedDeletePage"), {
        description:
          error instanceof Error ? error.message : t("empty.genericError"),
      });
    }
  }, [
    deleteContentDatabase,
    deleteDocument,
    document.database,
    documentId,
    navigate,
    t,
  ]);
  const flushRequestKey = `flush-request-${documentId}`;
  const [flushRequestWake, setFlushRequestWake] = useState(0);
  const handleFlushRequestEvent = useCallback(
    (event: { source?: string; key?: string }) => {
      if (
        event.source === "app-state" &&
        (event.key === flushRequestKey || event.key === "*")
      ) {
        setFlushRequestWake((wake) => wake + 1);
      }
    },
    [flushRequestKey],
  );
  // Reuse the root's shared SSE/poll transport. This subscriber only wakes the
  // flush reader when its exact application-state key changes; it does not open
  // another EventSource or polling loop.
  useDbSync({ onEvent: handleFlushRequestEvent });
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promotedBuilderBodyRef = useRef<string | null>(null);
  const pendingDocumentSaveRef = useRef<PendingDocumentSave | null>(null);
  // Separate freshness watermarks for title and content so that a content save
  // never suppresses adopting a newer external title and vice versa.
  const lastSavedTitleRef = useRef<{ title: string; updatedAt: string | null }>(
    { title: "", updatedAt: null },
  );
  const lastSavedContentRef = useRef<{
    content: string;
    updatedAt: string | null;
  }>({ content: "", updatedAt: null });
  const isInitializedRef = useRef(false);
  const prevDocIdRef = useRef<string | null>(null);
  const localTitleRef = useRef(localTitle);
  localTitleRef.current = localTitle;
  const localContentRef = useRef(localContent);
  localContentRef.current = localContent;
  const localSourceWriteErrorShownRef = useRef(false);
  const documentUpdatedAtRef = useRef<string | null>(
    document.updatedAt ?? null,
  );
  documentUpdatedAtRef.current = document.updatedAt ?? null;
  const handleBackgroundSaveError = useCallback(
    (error: unknown) => {
      toast.error(t("empty.genericError"), {
        description:
          error instanceof Error ? error.message : t("empty.genericError"),
      });
    },
    [t],
  );

  useEffect(() => {
    const membership = document.databaseMembership;
    const hydration = membership?.bodyHydration;
    if (
      !membership?.sourceId ||
      !hydration ||
      (hydration.status !== "pending" && hydration.status !== "error")
    ) {
      return;
    }
    const promotionKey = `${membership.sourceId}:${documentId}:${hydration.status}:${hydration.version ?? ""}`;
    if (promotedBuilderBodyRef.current === promotionKey) return;
    promotedBuilderBodyRef.current = promotionKey;
    processBuilderBodies.mutate({
      sourceId: membership.sourceId,
      documentId,
      limit: 1,
    });
  }, [document.databaseMembership, documentId, processBuilderBodies.mutate]);
  const titleFocusedRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLTextAreaElement>(null);
  const shouldFocusTitleRef = useRef(false);
  const notionPageLinks = useMemo<NotionPageLink[]>(
    () =>
      documents.map((doc) => ({
        notionPageId: doc.notionPageId || doc.id,
        documentId: doc.id,
        title: doc.title || "Untitled",
        icon: doc.icon,
      })),
    [documents],
  );
  const handleOpenNotionPageLink = useCallback(
    (linkedDocumentId: string) => {
      navigate(`/page/${linkedDocumentId}`, { flushSync: true });
    },
    [navigate],
  );

  // Per-field freshness: an external write is authoritative when the server
  // updatedAt is newer than the last value this client saved for THAT field.
  // Separate watermarks prevent a content save from suppressing adoption of a
  // newer external title, and vice versa (the original shared-watermark bug).
  const titleExternalIsNewer =
    !lastSavedTitleRef.current.updatedAt ||
    (!!document.updatedAt &&
      document.updatedAt > lastSavedTitleRef.current.updatedAt);
  const contentExternalIsNewer =
    !lastSavedContentRef.current.updatedAt ||
    (!!document.updatedAt &&
      document.updatedAt > lastSavedContentRef.current.updatedAt);

  useLayoutEffect(() => {
    const textarea = titleInputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [localTitle]);

  // Current user info for cursor labels
  const { session } = useSession();
  const currentUserAvatarUrl = useAvatarUrl(session?.email);
  const currentUser: CollabUser | undefined = session?.email
    ? {
        name: emailToName(session.email),
        email: session.email,
        color: emailToColor(session.email),
        avatarUrl: currentUserAvatarUrl ?? undefined,
      }
    : undefined;

  // Live collaboration for everyone who can open the doc — editors and viewers
  // alike. Viewers join the shared Y.Doc read-only: they see live keystrokes,
  // cursors, and presence (Google-Docs style) instead of a lagging SQL snapshot.
  // The server enforces the split — collab READ routes (state / awareness GET /
  // users) require viewer access, WRITE routes (update) require editor — so a
  // viewer's client can subscribe but never push. The editor stays non-editable
  // for viewers (see `editable={canEdit}` below), and VisualEditor additionally
  // neutralizes every local Y.Doc mutation for viewers (no seed, no reconcile
  // apply) so a read-only client can never originate a rejected `/update` POST.
  // Local-file documents are still excluded (they have no SQL-backed collab doc).
  const collabEnabled = !isLocalFileDocument;
  const {
    ydoc,
    awareness,
    isLoading: collabLoading,
    isSynced: collabSynced,
    activeUsers,
    agentActive,
    agentPresent,
  } = useCollaborativeDoc({
    docId: collabEnabled ? documentId : "",
    requestSource: TAB_ID,
    user: currentUser,
  });
  const bodyHydrationPending = documentBodyHydrationIsPending(document);
  const editorCanEdit =
    canEdit && !bodyHydrationPending && (isLocalFileDocument || !collabLoading);
  canEditRef.current = editorCanEdit;

  // Viewers intentionally join awareness so they receive live cursors, but
  // only an editor runs the app-state flush poller below. Publish that exact
  // capability so server-side pull/push/conflict actions do not wait on a
  // read-only tab that can never acknowledge their request.
  useEffect(() => {
    if (!awareness || !collabEnabled) return;
    awareness.setLocalStateField("canFlushDocument", editorCanEdit);
    return () => {
      awareness.setLocalStateField("canFlushDocument", false);
    };
  }, [awareness, collabEnabled, editorCanEdit]);

  // Initialize from fetched document, reset on document switch
  useEffect(() => {
    if (!document) return;
    if (prevDocIdRef.current !== documentId) {
      prevDocIdRef.current = documentId;
      isInitializedRef.current = false;
      setNewDocumentTypeChosen(false);
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
        pendingDocumentSaveRef.current = null;
      }
    }
    if (!isInitializedRef.current) {
      setLocalTitle(document.title);
      setLocalContent(document.content);
      setLocalContentUpdatedAt(document.updatedAt ?? null);
      lastSavedTitleRef.current = {
        title: document.title,
        updatedAt: document.updatedAt ?? null,
      };
      lastSavedContentRef.current = {
        content: document.content,
        updatedAt: document.updatedAt ?? null,
      };
      isInitializedRef.current = true;
      if (!document.title) {
        shouldFocusTitleRef.current = true;
      }
    }
  }, [document, documentId]);

  // NOTE: External body changes (agent edit, Notion pull, update-document) are
  // reconciled into the editor by VisualEditor via its content prop + the
  // updatedAt gate. The effects below keep DocumentEditor's own mirror
  // (localTitle for the title field, localContent for export/toolbar) in step.

  // Pick up external title changes (agent edit, Notion pull). Adopt when this
  // client has no unsaved local title edit, OR when the server value is a
  // genuinely newer external write — but never yank a title the user is
  // actively editing.
  useEffect(() => {
    if (!document || !isInitializedRef.current) return;
    if (isLinkedLocalSourceDocument) return;
    const serverTitle = document.title;
    const lastSaved = lastSavedTitleRef.current;
    if (serverTitle === lastSaved.title) return;
    const adopt =
      localTitle === lastSaved.title ||
      (titleExternalIsNewer && !titleFocusedRef.current);
    if (adopt) {
      setLocalTitle(serverTitle);
      lastSavedTitleRef.current = {
        title: serverTitle,
        updatedAt: document.updatedAt ?? lastSaved.updatedAt,
      };
    }
  }, [document, isLinkedLocalSourceDocument, titleExternalIsNewer, localTitle]);

  // Pick up external body changes for the export/toolbar mirror. Adopt when
  // there's no unsaved local divergence, or when the server is genuinely newer;
  // clear any pending save so a stale autosave can't overwrite the fresh body.
  useEffect(() => {
    if (!document || !isInitializedRef.current) return;
    if (isLinkedLocalSourceDocument) return;
    const serverContent = document.content;
    const lastSaved = lastSavedContentRef.current;
    if (serverContent === lastSaved.content) return;
    const staleEmptyLocalOverFreshServer =
      isEffectivelyEmptyDocumentContent(lastSaved.content) &&
      isEffectivelyEmptyDocumentContent(localContent) &&
      !isEffectivelyEmptyDocumentContent(serverContent);
    const adopt =
      localContent === lastSaved.content ||
      contentExternalIsNewer ||
      staleEmptyLocalOverFreshServer;
    if (adopt) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
        pendingDocumentSaveRef.current = null;
      }
      setLocalContent(serverContent);
      lastSavedContentRef.current = {
        content: serverContent,
        updatedAt: document.updatedAt ?? lastSaved.updatedAt,
      };
    }
  }, [
    document,
    isLinkedLocalSourceDocument,
    contentExternalIsNewer,
    localContent,
  ]);

  // When polling/SSE refetches confirm the server now matches local editor
  // state, acknowledge it as saved (and adopt its updatedAt watermark). This
  // keeps later agent/action updates from being mistaken for conflicts with
  // stale "unsaved" local text.
  useEffect(() => {
    if (!document || !isInitializedRef.current) return;
    if (isLinkedLocalSourceDocument) return;
    const titleMatchesLocal = titleMatchConfirmsSave({
      serverTitle: document.title,
      localTitle,
      lastSavedTitle: lastSavedTitleRef.current.title,
      pendingTitle: pendingDocumentSaveRef.current?.title ?? null,
    });
    const contentMatchesLocal = document.content === localContent;

    if (titleMatchesLocal) {
      lastSavedTitleRef.current = {
        title: document.title,
        updatedAt: document.updatedAt ?? lastSavedTitleRef.current.updatedAt,
      };
    }
    if (contentMatchesLocal) {
      lastSavedContentRef.current = {
        content: document.content,
        updatedAt: document.updatedAt ?? lastSavedContentRef.current.updatedAt,
      };
    }
  }, [document, isLinkedLocalSourceDocument, localTitle, localContent]);

  const persistDocumentUpdates = useCallback(
    async (
      updates: {
        title?: string;
        content?: string;
        description?: string;
        icon?: string | null;
      },
      options: DocumentSaveOptions = {},
    ): Promise<Document | DocumentUpdateConflictResponse> => {
      if (!options.allowQueuedSave && !canEditRef.current) return document;

      const localSource = document.source;
      const isLinkedLocalSource = canWriteLinkedLocalSource(
        documentId,
        localSource,
      );
      const nextSavedAt = new Date().toISOString();
      const fileFirstDocument: Document = {
        ...document,
        title: updates.title ?? localTitleRef.current,
        content: updates.content ?? localContentRef.current,
        description: updates.description ?? document.description,
        icon: updates.icon !== undefined ? updates.icon : document.icon,
        updatedAt: nextSavedAt,
        source: localSource,
      };

      if (isLinkedLocalSource) {
        const result = await writeDocumentToLinkedLocalSource(
          fileFirstDocument,
          localSource,
        );
        if (!result.ok) {
          if (!localSourceWriteErrorShownRef.current) {
            toast.error(t("editor.couldNotSaveLocalFile"), {
              description: result.error,
            });
            localSourceWriteErrorShownRef.current = true;
          }
          throw new Error(result.error);
        }
        localSourceWriteErrorShownRef.current = false;
        setLocalContentUpdatedAt(nextSavedAt);
      }

      try {
        // Content saves are guarded with a CAS against the last snapshot this
        // editor reconciled for content, so a save can't silently clobber a
        // concurrent update (e.g. the Notion auto-pull) that landed between
        // this editor's last reconcile and this save reaching the server.
        // Title/icon-only saves are unaffected (no baseUpdatedAt sent).
        const baseUpdatedAt =
          updates.content !== undefined
            ? (lastSavedContentRef.current.updatedAt ?? undefined)
            : undefined;
        return await updateDocument.mutateAsync({
          id: documentId,
          loadedUpdatedAt: documentUpdatedAtRef.current ?? undefined,
          loadedContentWasEmpty:
            updates.content !== undefined
              ? isEffectivelyEmptyDocumentContent(
                  lastSavedContentRef.current.content,
                )
              : undefined,
          ...updates,
          ...(baseUpdatedAt !== undefined ? { baseUpdatedAt } : {}),
        });
      } catch (error) {
        if (updates.title !== undefined) {
          patchDocumentCaches(queryClient, documentId, {
            title: lastSavedTitleRef.current.title,
          });
        }
        if (!isLinkedLocalSource) throw error;
        toast.warning(t("editor.localFileSavedHistoryNotUpdated"), {
          description:
            error instanceof Error ? error.message : t("empty.genericError"),
        });
        queryClient.setQueryData(
          ["action", "get-document", { id: documentId }],
          fileFirstDocument,
        );
        queryClient.invalidateQueries({
          queryKey: ["action", "list-documents"],
        });
        return fileFirstDocument;
      }
    },
    [document, documentId, queryClient, updateDocument],
  );

  const saveDocumentImmediately = useCallback(
    async (
      title: string,
      content: string,
      options: DocumentSaveOptions = {},
    ): Promise<DocumentSaveResult> => {
      // Never clobber a newer server version (e.g. an agent edit we haven't
      // reconciled into the editor yet) with the editor's current — possibly
      // stale — content. Guard per-field using the field's own watermark.
      const titleIsStale =
        !isLinkedLocalSourceDocument &&
        documentUpdatedAtRef.current &&
        lastSavedTitleRef.current.updatedAt &&
        documentUpdatedAtRef.current > lastSavedTitleRef.current.updatedAt;
      const contentIsStale =
        !isLinkedLocalSourceDocument &&
        documentUpdatedAtRef.current &&
        lastSavedContentRef.current.updatedAt &&
        documentUpdatedAtRef.current > lastSavedContentRef.current.updatedAt;

      const updates: Record<string, string> = {};
      if (title !== lastSavedTitleRef.current.title && !titleIsStale)
        updates.title = title;
      const contentChanged = content !== lastSavedContentRef.current.content;
      if (contentChanged && !contentIsStale) updates.content = content;
      if (Object.keys(updates).length === 0) {
        return { contentPersisted: !contentChanged };
      }

      const saved = await persistDocumentUpdates(updates, options);
      if (isDocumentUpdateConflict(saved)) {
        // A concurrent write (e.g. the Notion auto-pull) landed after this
        // editor's last reconciled content snapshot — the save was rejected,
        // not applied. Don't adopt watermarks for the content we tried to
        // send (that would make the editor believe its now-discarded content
        // is the saved truth) and don't push to Notion below. The conflict
        // response already lands the winning server document in the
        // get-document cache (see useUpdateDocument), so the existing
        // external-change effects above pick it up and reconcile the editor
        // to it the same way they handle any other out-of-band write —
        // silently, with no toast.
        return { contentPersisted: false };
      }
      // Adopt the server updatedAt per saved field.
      const savedAt = saved?.updatedAt ?? new Date().toISOString();
      adoptConfirmedSaveWatermarks({
        saved,
        savedAt,
        title,
        content,
        updates,
        lastSavedTitleRef,
        lastSavedContentRef,
      });

      // Push-on-save: when auto-sync is on, trigger a Notion push
      // immediately after the save lands in SQL. This eliminates the
      // off-by-one race where a fixed-interval poll could fire between
      // the debounce and the next save, reading the previous content.
      // Pulls remain driven by the polling refetch in useDocumentSyncStatus.
      if (autoSync) {
        const status = queryClient.getQueryData<DocumentSyncStatus>(
          documentSyncStatusQueryKey(documentId, { autoSync }),
        );
        if (status?.pageId && !status.hasConflict) {
          try {
            const next = await pushDocumentToNotion.mutateAsync({
              documentId,
              // The exact editor value was persisted immediately above. Avoid
              // a redundant live-editor flush handshake on every auto-sync
              // save; manual pushes/conflict choices keep the safe default.
              flushOpenEditor: false,
            });
            queryClient.setQueryData(
              documentSyncStatusQueryKey(documentId, { autoSync }),
              next,
            );
          } catch {
            // Non-fatal — next polling refetch will surface any error.
          }
        }
      }
      return {
        contentPersisted: !contentChanged || updates.content !== undefined,
      };
    },
    [
      documentId,
      autoSync,
      isLinkedLocalSourceDocument,
      persistDocumentUpdates,
      pushDocumentToNotion,
      queryClient,
    ],
  );
  const flushPendingDocumentSave = useCallback(
    (pending: PendingDocumentSave) => {
      if (!pending.canEditWhenQueued) return;
      void Promise.resolve(
        pending.save(pending.title, pending.content, {
          allowQueuedSave: true,
        }),
      ).catch(handleBackgroundSaveError);
    },
    [handleBackgroundSaveError],
  );
  const debouncedSave = useCallback(
    (title: string, content: string) => {
      if (!canEditRef.current) return;
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      const pending: PendingDocumentSave = {
        title,
        content,
        save: saveDocumentImmediately,
        canEditWhenQueued: canEditRef.current,
        timeout: setTimeout(() => {
          if (pendingDocumentSaveRef.current === pending) {
            pendingDocumentSaveRef.current = null;
          }
          saveTimeoutRef.current = null;
          flushPendingDocumentSave(pending);
        }, 500),
      };
      pendingDocumentSaveRef.current = pending;
      saveTimeoutRef.current = pending.timeout;
    },
    [flushPendingDocumentSave, saveDocumentImmediately],
  );

  useEffect(() => {
    return () => {
      const pending = pendingDocumentSaveRef.current;
      if (!pending) return;
      clearTimeout(pending.timeout);
      saveTimeoutRef.current = null;
      pendingDocumentSaveRef.current = null;
      flushPendingDocumentSave(pending);
    };
  }, [documentId, flushPendingDocumentSave]);

  useEffect(() => {
    if (canEdit) return;
    const pending = pendingDocumentSaveRef.current;
    if (!pending) return;
    clearTimeout(pending.timeout);
    saveTimeoutRef.current = null;
    pendingDocumentSaveRef.current = null;
    flushPendingDocumentSave(pending);
  }, [canEdit, documentId, flushPendingDocumentSave]);

  // Last-chance flush when the tab is being hidden or torn down. A normal
  // debounced save is an async React-Query mutation; if the page unloads before
  // it resolves the edit is lost. On `pagehide` / `visibilitychange → hidden` we
  // fire a `keepalive` POST straight to the update-document action so the write
  // survives navigation/close. Local-file documents persist to disk, not this
  // endpoint, so they fall back to the best-effort async flush.
  useEffect(() => {
    if (!canEdit) return;

    const flushForTeardown = () => {
      const pending = pendingDocumentSaveRef.current;
      if (!pending || !pending.canEditWhenQueued) return;

      // Local-file docs can't be flushed via keepalive fetch; best-effort only.
      if (isLocalFileDocument || isLinkedLocalSourceDocument) {
        flushPendingDocumentSave(pending);
        return;
      }

      // Mirror saveDocumentImmediately's per-field stale guard + diff so we only
      // send genuinely-changed, non-stale fields.
      const serverUpdatedAt = documentUpdatedAtRef.current;
      const titleIsStale =
        !!serverUpdatedAt &&
        !!lastSavedTitleRef.current.updatedAt &&
        serverUpdatedAt > lastSavedTitleRef.current.updatedAt;
      const contentIsStale =
        !!serverUpdatedAt &&
        !!lastSavedContentRef.current.updatedAt &&
        serverUpdatedAt > lastSavedContentRef.current.updatedAt;

      const updates: Record<string, string> = {};
      if (pending.title !== lastSavedTitleRef.current.title && !titleIsStale) {
        updates.title = pending.title;
      }
      if (
        pending.content !== lastSavedContentRef.current.content &&
        !contentIsStale
      ) {
        updates.content = pending.content;
      }
      if (Object.keys(updates).length === 0) return;

      clearTimeout(pending.timeout);
      saveTimeoutRef.current = null;
      pendingDocumentSaveRef.current = null;

      try {
        const url = agentNativePath("/_agent-native/actions/update-document");
        // Include the same CAS guard as the normal save path: if content is
        // going out, tag it with the last content snapshot this editor
        // reconciled so a teardown flush can't clobber a concurrent write
        // (e.g. Notion auto-pull) either. The tab is unloading, so there's no
        // response handling — this only prevents the write from applying; it
        // can't reconcile the editor, which is fine since it's going away.
        const baseUpdatedAt =
          updates.content !== undefined
            ? (lastSavedContentRef.current.updatedAt ?? undefined)
            : undefined;
        const body = JSON.stringify({
          id: documentId,
          ...updates,
          ...(baseUpdatedAt !== undefined ? { baseUpdatedAt } : {}),
        });
        const ok = fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Tag as a browser-originated call (ctx.caller = "frontend") so this
            // never lights the AI-editing flag.
            "X-Agent-Native-Frontend": "1",
          },
          body,
          keepalive: true,
          cache: "no-store",
        });
        // Adopt an optimistic watermark so a re-render doesn't re-queue the same
        // save; the server bumps updatedAt, and the next poll reconciles it.
        const optimisticAt = new Date().toISOString();
        if (updates.title !== undefined) {
          lastSavedTitleRef.current = {
            title: pending.title,
            updatedAt: optimisticAt,
          };
        }
        if (updates.content !== undefined) {
          lastSavedContentRef.current = {
            content: pending.content,
            updatedAt: optimisticAt,
          };
        }
        void Promise.resolve(ok).catch(() => {
          /* Page is going away; nothing more we can do. */
        });
      } catch {
        // Fall back to the async flush if the keepalive fetch couldn't start.
        flushPendingDocumentSave(pending);
      }
    };

    const onVisibilityChange = () => {
      if (window.document.visibilityState === "hidden") flushForTeardown();
    };
    window.addEventListener("pagehide", flushForTeardown);
    window.document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flushForTeardown);
      window.document.removeEventListener(
        "visibilitychange",
        onVisibilityChange,
      );
    };
  }, [
    canEdit,
    documentId,
    isLocalFileDocument,
    isLinkedLocalSourceDocument,
    flushPendingDocumentSave,
  ]);

  // Collab-aware ingest flush: the `pull-document` action writes a one-shot
  // `flush-request-<id>` app-state key when an external agent wants to ingest
  // the document while a live collab session is open. The DB column can lag
  // the in-memory Y.Doc, so the open editor is the only place that can
  // serialize the live content through its existing serializer. On seeing the
  // key we force an immediate (non-debounced) save of the current editor
  // state, then acknowledge it so `pull-document` knows the flush landed.
  // The shared sync transport wakes this reader for the exact app-state key;
  // the first run covers a request that was already pending when the editor
  // mounted.
  useEffect(() => {
    if (!editorCanEdit || isLocalFileDocument) return;
    let active = true;
    const flushPath = agentNativePath(
      `/_agent-native/application-state/${flushRequestKey}`,
    );

    async function flushIfRequested() {
      try {
        const res = await fetch(flushPath);
        if (res.ok) {
          const pending = (await res.json()) as {
            id?: string;
            ts?: number;
            requestId?: string;
            status?: "pending" | "success" | "error";
            error?: string;
          } | null;
          if (pending && active) {
            // A terminal acknowledgement waits for the requesting action to
            // read and clear it. Retrying here could hide a failed flush or
            // replace the explicit success signal before the server sees it.
            if (pending.status === "error" || pending.status === "success") {
              return;
            }
            const title = localTitleRef.current;
            const content = localContentRef.current;
            const updates: Record<string, string> = {};
            if (title !== lastSavedTitleRef.current.title)
              updates.title = title;
            if (content !== lastSavedContentRef.current.content) {
              updates.content = content;
            }
            try {
              if (Object.keys(updates).length > 0) {
                const saved = await persistDocumentUpdates(updates);
                if (isDocumentUpdateConflict(saved)) {
                  // Do not acknowledge a CAS loss as a successful flush. The
                  // requester must stop instead of pushing/replacing stale SQL.
                  throw new Error(
                    "The document changed while preparing it for sync.",
                  );
                }
                const savedAt = saved?.updatedAt ?? new Date().toISOString();
                adoptConfirmedSaveWatermarks({
                  saved,
                  savedAt,
                  title,
                  content,
                  updates,
                  lastSavedTitleRef,
                  lastSavedContentRef,
                });
              }
              // Explicitly acknowledge this exact request only after the live
              // editor state is confirmed in SQL (or nothing needed saving).
              // A delete is ambiguous with a transient app-state read failure.
              await fetch(flushPath, {
                method: "PUT",
                headers: {
                  "Content-Type": "application/json",
                  "X-Agent-Native-CSRF": "1",
                },
                body: JSON.stringify({
                  id: pending.id ?? documentId,
                  ts: pending.ts ?? Date.now(),
                  requestId: pending.requestId,
                  status: "success",
                }),
              }).catch(() => {});
            } catch (error) {
              // Keep a durable negative acknowledgement so the requesting
              // Notion action can fail closed instead of timing out and using a
              // stale documents row. The server clears this after reading it.
              await fetch(flushPath, {
                method: "PUT",
                headers: {
                  "Content-Type": "application/json",
                  "X-Agent-Native-CSRF": "1",
                },
                body: JSON.stringify({
                  id: pending.id ?? documentId,
                  ts: pending.ts ?? Date.now(),
                  requestId: pending.requestId,
                  status: "error",
                  error:
                    error instanceof Error
                      ? error.message
                      : t("editor.liveDocumentSaveBeforeSyncFailed"),
                }),
              }).catch(() => {});
            }
          }
        }
      } catch {
        // Best-effort read. A later app-state event will wake the reader again.
      }
    }

    void flushIfRequested();
    return () => {
      active = false;
    };
  }, [
    documentId,
    editorCanEdit,
    flushRequestKey,
    flushRequestWake,
    isLocalFileDocument,
    persistDocumentUpdates,
    t,
  ]);

  const handleTitleChange = useCallback(
    (newTitle: string) => {
      if (!editorCanEdit) return;
      localTitleRef.current = newTitle;
      setLocalTitle(newTitle);
      patchDocumentCaches(queryClient, documentId, { title: newTitle });
      debouncedSave(newTitle, localContentRef.current);
    },
    [debouncedSave, documentId, editorCanEdit, queryClient],
  );

  const handleContentChange = useCallback(
    (newContent: string) => {
      if (!editorCanEdit) return;
      setLocalContent(newContent);
      debouncedSave(localTitleRef.current, newContent);
    },
    [debouncedSave, editorCanEdit],
  );

  const handleContentSaveNow = useCallback(
    async (newContent: string) => {
      if (!editorCanEdit) return false;
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
        pendingDocumentSaveRef.current = null;
      }
      localContentRef.current = newContent;
      setLocalContent(newContent);
      const result = await saveDocumentImmediately(
        localTitleRef.current,
        newContent,
      );
      return result.contentPersisted;
    },
    [editorCanEdit, saveDocumentImmediately],
  );

  // Comments state — pending comment from text selection
  const [pendingComment, setPendingComment] = useState<{
    quotedText: string;
    offsetTop: number;
    anchor?: CommentTextAnchor;
    range?: { from: number; to: number };
  } | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [hoveredThreadId, setHoveredThreadId] = useState<string | null>(null);
  const [utilityPanel, setUtilityPanel] = useState<DocumentUtilityPanel>(null);
  const activeThreadId = hoveredThreadId ?? selectedThreadId;
  const { data: threads, isLoading: commentsLoading } = useComments(
    canEdit && !isLocalFileDocument ? documentId : null,
  );
  const hasUtilityRailSpace = useMinViewportWidth(1024);
  const showDesktopUtilityPanel = utilityPanel !== null && hasUtilityRailSpace;
  const showUtilityPanelSheet =
    utilityPanel !== null && !showDesktopUtilityPanel;

  const handleComment = useCallback(
    (
      quotedText: string,
      offsetTop: number,
      anchor?: CommentTextAnchor,
      range?: { from: number; to: number },
    ) => {
      setPendingComment({ quotedText, offsetTop, anchor, range });
      setUtilityPanel("comments");
      setSelectedThreadId(null);
      setHoveredThreadId(null);
    },
    [],
  );

  const clearCommentFocus = useCallback(() => {
    setSelectedThreadId(null);
    setHoveredThreadId(null);
  }, []);

  useEffect(() => {
    setPendingComment(null);
    setUtilityPanel(null);
    clearCommentFocus();
  }, [clearCommentFocus, documentId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearCommentFocus();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clearCommentFocus]);

  const focusTitleEnd = useCallback(() => {
    const textarea = titleInputRef.current;
    if (!textarea) return;
    textarea.focus();
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);
  }, []);

  const joinFirstBodyBlockToTitle = useCallback(
    (text: string) => {
      const trimmed = text.replace(/\s+/g, " ").trim();
      if (trimmed) {
        const currentTitle = localTitleRef.current.trim();
        const nextTitle = currentTitle ? `${currentTitle} ${trimmed}` : trimmed;
        handleTitleChange(nextTitle);
      }
      requestAnimationFrame(focusTitleEnd);
    },
    [focusTitleEnd, handleTitleChange],
  );

  const handleTitlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      if (!editorCanEdit) return;

      const pastedText = event.clipboardData.getData("text/plain");
      if (!pastedText) return;

      event.preventDefault();

      const textarea = event.currentTarget;
      const selectionStart = textarea.selectionStart;
      const selectionEnd = textarea.selectionEnd;
      const pastedTitle = normalizeTitleText(
        stripMarkdownHeadingPrefixFromTitlePaste(pastedText),
      );
      const nextTitle = `${localTitle.slice(0, selectionStart)}${pastedTitle}${localTitle.slice(selectionEnd)}`;
      const nextCaret = selectionStart + pastedTitle.length;

      handleTitleChange(nextTitle);
      requestAnimationFrame(() => {
        titleInputRef.current?.setSelectionRange(nextCaret, nextCaret);
      });
    },
    [editorCanEdit, handleTitleChange, localTitle],
  );

  // Auto-focus title on new empty documents once collab finishes loading
  useEffect(() => {
    if (editorCanEdit && shouldFocusTitleRef.current) {
      shouldFocusTitleRef.current = false;
      requestAnimationFrame(() => titleInputRef.current?.focus());
    }
  });

  const toolbarBreadcrumbItems = useMemo(
    () =>
      documentEditorBreadcrumbNavigationItems(
        documentEditorBreadcrumbItems(document, documents),
        documents,
        contentSpaces,
        {
          currentDocumentId: document.id,
          currentParentId: document.parentId,
          currentDatabaseSystemRole: document.database?.systemRole ?? null,
          catalogDocumentId: contentSpacesQuery.data?.catalogDocumentId ?? null,
          workspacesTitle: t("sidebar.workspaces"),
        },
      ),
    [
      contentSpaces,
      contentSpacesQuery.data?.catalogDocumentId,
      document,
      documents,
      t,
    ],
  );

  const handleOpenToolbarBreadcrumb = useCallback(
    (targetId: string) => {
      const targetDocument = documents.find((item) => item.id === targetId);
      const filesDocumentId =
        targetDocument?.databaseMembership?.databaseDocumentId ?? targetId;
      const space = contentSpaces.find(
        (candidate) => candidate.filesDocumentId === filesDocumentId,
      );
      if (!space) {
        navigate(`/page/${targetId}`, { flushSync: true });
        return;
      }
      void workspaceSelectionQueueRef
        .current(() =>
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
                { requestSource: "content-breadcrumb" },
              ),
            persistSelection: setStoredSpaceId,
            openFiles: () => navigate(`/page/${targetId}`, { flushSync: true }),
          }),
        )
        .catch((error) => {
          toast.error(error instanceof Error ? error.message : String(error));
        });
    },
    [contentSpaces, documents, navigate, setStoredSpaceId],
  );

  const commentsSidebar = (
    <CommentsSidebar
      documentId={documentId}
      threads={threads ?? []}
      isLoading={commentsLoading}
      pendingComment={pendingComment}
      onPendingDone={() => setPendingComment(null)}
      scrollContainerRef={scrollContainerRef}
      activeThreadId={activeThreadId}
      selectedThreadId={selectedThreadId}
      onSelectedThreadChange={setSelectedThreadId}
      onHoveredThreadChange={setHoveredThreadId}
      currentUserEmail={session?.email}
      forceVisible
    />
  );
  const defaultIconKind = documentEditorDefaultIconKind(document);
  const isDatabasePage = Boolean(document.database);
  const databaseChoicePending = isDatabaseChoicePending(
    document,
    createDatabase.isPending,
  );
  const showNewDocumentTypeChooser =
    canEdit &&
    !isLocalFileDocument &&
    !isDatabasePage &&
    !newDocumentTypeChosen &&
    !localTitle.trim() &&
    !document.description?.trim() &&
    isEffectivelyEmptyDocumentContent(localContent);
  const handleChoosePage = useCallback(() => {
    setNewDocumentTypeChosen(true);
    requestAnimationFrame(() => titleInputRef.current?.focus());
  }, []);
  const handleChooseDatabase = useCallback(async () => {
    try {
      await createDatabase.mutateAsync({ documentId });
      setNewDocumentTypeChosen(true);
    } catch (error) {
      toast.error(t("sidebar.failedCreateDatabase"), {
        description:
          error instanceof Error ? error.message : t("empty.genericError"),
      });
    }
  }, [createDatabase, documentId, t]);
  const defaultIcon =
    defaultIconKind === "database" && !isDatabasePage ? (
      <IconDatabase className="size-12" aria-hidden="true" />
    ) : undefined;
  const exportTitle = isInitializedRef.current ? localTitle : document.title;
  const exportContent = isInitializedRef.current
    ? localContent
    : document.content;
  const utilityPanelTitle =
    utilityPanel === "info" ? t("editor.toolbar.info") : t("comments.title");
  const utilityPanelContent = utilityPanel ? (
    <div className="w-full min-w-0 bg-background" data-document-utility-panel>
      <div className="sticky top-0 z-10 flex h-12 items-center border-b border-border bg-background px-4">
        <h2 className="text-sm font-semibold">{utilityPanelTitle}</h2>
        {hasUtilityRailSpace ? (
          <button
            type="button"
            className="ms-auto flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("editor.toolbar.closeUtilityPanel")}
            onClick={() => setUtilityPanel(null)}
          >
            <IconX size={16} />
          </button>
        ) : null}
      </div>
      {utilityPanel === "info" ? (
        <DocumentInfoPanel
          document={document}
          databaseId={databaseId}
          databaseDocumentId={databaseDocumentId}
          canEdit={editorCanEdit}
          onSaveDescription={(description) =>
            persistDocumentUpdates({ description })
          }
        />
      ) : (
        commentsSidebar
      )}
    </div>
  ) : null;

  return (
    <BlockRegistryProvider
      registry={contentBlockRegistry}
      ctx={blockRenderContext}
    >
      <div
        className="relative flex min-h-0 min-w-0 flex-1"
        data-document-print-root
        onPointerDownCapture={(event) => {
          const target = event.target as HTMLElement | null;
          if (
            target?.closest("[data-comments-sidebar], [data-comment-thread]")
          ) {
            return;
          }
          clearCommentFocus();
        }}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <DocumentToolbar
            documentId={documentId}
            documentTitle={exportTitle}
            documentContent={exportContent}
            breadcrumbItems={toolbarBreadcrumbItems.map((item) =>
              item.id === documentId ? { ...item, title: exportTitle } : item,
            )}
            documentUpdatedAt={document.updatedAt}
            activeUsers={activeUsers}
            agentPresent={agentPresent}
            agentActive={agentActive}
            currentUserEmail={session?.email}
            canEdit={canEdit}
            hideFromSearch={document.hideFromSearch}
            source={document.source}
            canDelete={canDelete}
            deletePending={
              deleteDocument.isPending || deleteContentDatabase.isPending
            }
            onDelete={handleDeleteDocument}
            utilityPanel={utilityPanel}
            onUtilityPanelChange={setUtilityPanel}
            showCommentsControl={editorCanEdit && !isLocalFileDocument}
            onOpenBreadcrumbItem={handleOpenToolbarBreadcrumb}
          />

          {!isLocalFileDocument ? (
            <NotionConflictBanner documentId={documentId} canEdit={canEdit} />
          ) : null}

          <div
            ref={scrollContainerRef}
            className="flex-1 min-h-0 min-w-0 overflow-auto flex flex-col"
            data-document-print-scroll
          >
            <div
              className={cn(
                "flex min-h-full w-full min-w-0",
                showDesktopUtilityPanel ? "justify-center" : "flex-col",
              )}
              data-document-scroll-content
            >
              <div
                className={cn(
                  "min-w-0",
                  showDesktopUtilityPanel ? "flex-1" : "w-full",
                )}
              >
                <div
                  className={documentEditorTitleRegionClassName(
                    Boolean(document.database),
                  )}
                >
                  {document.icon || !isDatabasePage ? (
                    <div className="mb-1">
                      {editorCanEdit ? (
                        <EmojiPicker
                          icon={document.icon}
                          defaultIcon={defaultIcon}
                          defaultIconLabel={
                            defaultIconKind === "database" ? "database" : "page"
                          }
                          onSelect={(emoji) => {
                            void (async () => {
                              const updates = metadataUpdatesWithPendingTitle(
                                { icon: emoji },
                                localTitleRef.current,
                                lastSavedTitleRef.current.title,
                              );
                              const saved =
                                await persistDocumentUpdates(updates);
                              // Icon-only save: never CAS-guarded server-side
                              // (no content in this call), so this can't come
                              // back as a conflict — narrow defensively anyway
                              // since persistDocumentUpdates' return type is a
                              // union.
                              if (isDocumentUpdateConflict(saved)) return;
                              adoptConfirmedSaveWatermarks({
                                saved,
                                savedAt:
                                  saved?.updatedAt ?? new Date().toISOString(),
                                title: localTitleRef.current,
                                content: localContentRef.current,
                                updates,
                                lastSavedTitleRef,
                                lastSavedContentRef,
                              });
                            })().catch(handleBackgroundSaveError);
                          }}
                        />
                      ) : document.icon ? (
                        <div className="p-1 -ml-1 text-5xl leading-none">
                          {document.icon}
                        </div>
                      ) : defaultIconKind === "database" && !isDatabasePage ? (
                        <div className="-ml-1 flex size-14 items-center justify-center rounded-md text-muted-foreground">
                          <IconDatabase
                            className="size-12"
                            aria-hidden="true"
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <textarea
                    ref={titleInputRef}
                    rows={1}
                    wrap="soft"
                    value={localTitle}
                    onChange={(e) =>
                      handleTitleChange(normalizeTitleText(e.target.value))
                    }
                    onPaste={handleTitlePaste}
                    onFocus={() => {
                      titleFocusedRef.current = true;
                    }}
                    onBlur={() => {
                      titleFocusedRef.current = false;
                    }}
                    onKeyDown={(e) => {
                      if (!editorCanEdit) return;
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const pm = window.document.querySelector(
                          ".ProseMirror",
                        ) as HTMLElement | null;
                        pm?.focus();
                      }
                    }}
                    aria-label={t("editor.documentTitle")}
                    placeholder={t("editor.title")}
                    readOnly={!editorCanEdit}
                    style={{ fieldSizing: "content" } as any}
                    className={cn(
                      "block w-full resize-none overflow-hidden break-words border-none bg-transparent p-0 font-bold leading-tight text-foreground outline-none placeholder:text-muted-foreground/40",
                      isDatabasePage ? "text-3xl" : "text-3xl md:text-4xl",
                    )}
                  />
                </div>
                {document.database ? (
                  <div className={documentEditorDatabaseRegionClassName()}>
                    <DocumentDatabase document={document} canEdit={canEdit} />
                  </div>
                ) : null}

                {!isDatabasePage ? (
                  <div
                    className="flex-1 w-full max-w-3xl mx-auto px-4 pb-16 cursor-text sm:px-8 md:px-16"
                    onClick={(e) => {
                      if (e.target === e.currentTarget) {
                        const pm = e.currentTarget.querySelector(
                          ".ProseMirror",
                        ) as HTMLElement | null;
                        pm?.focus();
                      }
                    }}
                  >
                    {(() => {
                      if (bodyHydrationPending) {
                        return (
                          <BuilderBodySyncingNotice
                            title={t("editor.builderBodySyncing")}
                            description={t(
                              "editor.builderBodySyncingDescription",
                            )}
                          />
                        );
                      }

                      if (showNewDocumentTypeChooser) {
                        return (
                          <div
                            className="flex flex-wrap gap-2 pt-3"
                            aria-label={t("sidebar.newPage")}
                          >
                            <Button
                              type="button"
                              variant="outline"
                              className="justify-start gap-2"
                              disabled={
                                !editorCanEdit || createDatabase.isPending
                              }
                              onClick={handleChoosePage}
                            >
                              <IconFileText />
                              {t("sidebar.page")}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              className="justify-start gap-2"
                              disabled={!editorCanEdit || databaseChoicePending}
                              onClick={() => void handleChooseDatabase()}
                            >
                              {databaseChoicePending ? (
                                <IconLoader2 className="animate-spin" />
                              ) : (
                                <IconDatabase />
                              )}
                              {t("sidebar.database")}
                            </Button>
                          </div>
                        );
                      }

                      // The primary "Content" Blocks field IS the document body,
                      // with the full collaborative editor. It renders chromeless
                      // when it's the only Blocks field, or inside a
                      // header/collapsible shell when the row has multiple Blocks
                      // fields.
                      const primaryEditor = (
                        <VisualEditor
                          key={`${documentId}:${editorCanEdit && !isLocalFileDocument ? "live" : "snapshot"}`}
                          documentId={documentId}
                          content={
                            isLocalFileDocument
                              ? localContent
                              : document.content
                          }
                          contentUpdatedAt={
                            isLocalFileDocument
                              ? (localContentUpdatedAt ?? document.updatedAt)
                              : document.updatedAt
                          }
                          onChange={handleContentChange}
                          onSaveContent={handleContentSaveNow}
                          // Bind the shared Y.Doc/awareness for viewers too — the
                          // editor is non-editable for them and VisualEditor blocks
                          // any local Y.Doc mutation, so they get live edits +
                          // cursors without ever writing. Excludes local-file docs.
                          ydoc={collabEnabled ? ydoc : null}
                          collabSynced={collabEnabled ? collabSynced : true}
                          awareness={collabEnabled ? awareness : null}
                          user={currentUser}
                          editable={editorCanEdit}
                          localFileMode={isLocalFileDocument}
                          localFilePath={
                            isLocalFileDocument ? document.source?.path : null
                          }
                          onComment={
                            editorCanEdit && !isLocalFileDocument
                              ? handleComment
                              : undefined
                          }
                          commentThreads={threads ?? []}
                          activeThreadId={activeThreadId}
                          pendingHighlight={pendingComment?.range ?? null}
                          onActivateThread={
                            editorCanEdit && !isLocalFileDocument
                              ? setSelectedThreadId
                              : undefined
                          }
                          onJoinTitle={joinFirstBodyBlockToTitle}
                          notionPageLinks={notionPageLinks}
                          onOpenNotionPageLink={handleOpenNotionPageLink}
                          notionPageId={document.notionPageId}
                        />
                      );

                      // Only database rows have Blocks fields. Standalone pages
                      // and local-file documents keep the plain chromeless body.
                      if (document.databaseMembership && !isLocalFileDocument) {
                        return (
                          <DocumentBlockFields
                            documentId={documentId}
                            databaseId={
                              databaseId ??
                              document.databaseMembership.databaseId
                            }
                            databaseDocumentId={
                              databaseDocumentId ??
                              document.databaseMembership.databaseDocumentId
                            }
                            canEdit={editorCanEdit}
                            primaryEditor={primaryEditor}
                          />
                        );
                      }

                      return primaryEditor;
                    })()}
                    {!bodyHydrationPending &&
                    !isLocalFileDocument &&
                    collabLoading ? (
                      <div
                        className="mt-4 inline-flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
                        role="status"
                      >
                        <IconLoader2 className="size-3.5 animate-spin" />
                        {t("editor.collabConnectingReadOnly")}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {showDesktopUtilityPanel ? (
                <aside className="w-80 shrink-0 border-s border-border">
                  {utilityPanelContent}
                </aside>
              ) : null}
            </div>
          </div>
        </div>

        {showUtilityPanelSheet ? (
          <Sheet
            open={utilityPanel !== null}
            onOpenChange={(open) => {
              if (!open) {
                setUtilityPanel(null);
                setPendingComment(null);
              }
            }}
          >
            <SheetContent
              side="right"
              className="w-[85vw] max-w-sm p-0"
              aria-describedby={undefined}
            >
              <SheetHeader className="sr-only">
                <SheetTitle>{utilityPanelTitle}</SheetTitle>
              </SheetHeader>
              {utilityPanelContent}
            </SheetContent>
          </Sheet>
        ) : null}
      </div>
    </BlockRegistryProvider>
  );
}
