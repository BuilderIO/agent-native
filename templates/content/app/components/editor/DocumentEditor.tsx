import { BlockRegistryProvider } from "@agent-native/core/blocks";
import { generateTabId } from "@agent-native/core/client/agent-chat";
import { agentNativePath } from "@agent-native/core/client/api-path";
import { writeClipboardText } from "@agent-native/core/client/clipboard";
import {
  useCollaborativeDoc,
  emailToColor,
  emailToName,
  type CollabUser,
} from "@agent-native/core/client/collab";
import {
  actionErrorMessage,
  callAction,
  setClientAppState,
  useAvatarUrl,
  useDbSync,
  useSession,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  useCreateResourceSuggestion,
  useDecideResourceSuggestion,
  useResourceSuggestions,
  useUpdateResourceSuggestion,
} from "@agent-native/core/client/review";
import type { ResourceSuggestion } from "@agent-native/core/review";
import { normalizeDocumentTitle } from "@agent-native/core/shared";
import type { Document, DocumentSyncStatus } from "@shared/api";
import {
  SuggestionFormattingMappingError,
  suggestionMarkedSourceRanges,
} from "@shared/suggestion-formatting";
import { resolveMarkdownSuggestionRange } from "@shared/suggestion-rebase";
import {
  IconDatabase,
  IconEye,
  IconEyeOff,
  IconFileText,
  IconLoader2,
  IconX,
} from "@tabler/icons-react";
import { IconLock } from "@tabler/icons-react";
import {
  hashKey,
  type QueryClient,
  useQueryClient,
} from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ClipboardEvent, MutableRefObject, ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import {
  contentBlockRegistry,
  createContentBlockRenderContext,
} from "@/blocks/contentBlockRegistry";
import { useSidebarTrigger } from "@/components/layout/sidebar-trigger";
import { QueryErrorState } from "@/components/QueryErrorState";
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
import { flushDocumentPropertyWrites } from "@/hooks/document-property-persistence";
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
  mergeDocumentIntoDocumentCache,
  isDocumentUpdateConflict,
  patchDocumentCaches,
  documentQueryFilter,
  documentQueryKey,
  useDocument,
  useDeleteDocument,
  useDocuments,
  useUpdatePreviewDocumentDraft,
  useUpdateDocument,
} from "@/hooks/use-documents";
import type { DocumentUpdateConflictResponse } from "@/hooks/use-documents";
import { useLocalStorage } from "@/hooks/use-local-storage";
import {
  documentSyncStatusQueryKey,
  useDocumentSyncStatus,
  usePushDocumentToNotion,
} from "@/hooks/use-notion";
import { rememberContentLandingDocument } from "@/lib/content-landing";
import type { DesktopContentFileRevision } from "@/lib/desktop-content-files";
import { registerDocumentHistoryRestoreController } from "@/lib/document-history-restore-controller";
import {
  canWriteLinkedLocalSource,
  readDocumentFromLinkedLocalSource,
  watchLinkedLocalSource,
  writeDocumentToLinkedLocalSource,
} from "@/lib/local-content-source-files";
import {
  isDatabaseChoicePending,
  isDocumentCreationPending,
} from "@/lib/optimistic-document";
import { cn } from "@/lib/utils";

import {
  flushAllBlockFieldSaveControllersForDocument,
  flushBlockFieldSaveController,
} from "./blockFieldSaveRegistry";
import {
  documentBodyHydrationIsPending,
  isEffectivelyEmptyDocumentContent,
  newDocumentPageChoiceIsDisabled,
} from "./body-hydration";
import { BuilderBodySyncingNotice } from "./BuilderBodySyncingNotice";
import type { CommentTextAnchor } from "./comment-anchors";
import {
  CommentDraftProvider,
  CommentHistoryScrollContainer,
} from "./comment-drafts";
import { observeCommentLane } from "./comment-lane";
import {
  CommentsSidebar,
  preserveCommentReplyEscape,
  useCommentReplyDrafts,
  usePendingCommentDraft,
} from "./CommentsSidebar";
import type { DatabaseExportContext } from "./database/DatabaseExportDialog";
import { createHistorySession } from "./document-history-session";
import {
  saveDocumentWithRebase,
  type DocumentContentBase,
} from "./document-save-rebase";
import { DocumentBlockFields } from "./DocumentBlockFields";
import { DocumentDatabase } from "./DocumentDatabase";
import { DocumentEditorSkeleton } from "./DocumentEditorSkeleton";
import { DocumentInfoPanel } from "./DocumentInfoPanel";
import { DocumentProperties } from "./DocumentProperties";
import { DocumentToolbar, type ToolbarBreadcrumbItem } from "./DocumentToolbar";
import { EmojiPicker } from "./EmojiPicker";
import { LinkedLocalDocumentAgentBridge } from "./LinkedLocalDocumentAgentBridge";
import {
  classifyLocalSourceRead,
  localSourceRevisionForQueuedEdit,
  localSourceRevisionForSave,
  type PendingLocalSourceWrite,
} from "./local-source-write-state";
import { NotionConflictBanner } from "./NotionConflictBanner";
import { PageDraftRecovery } from "./PageDraftRecovery";
import {
  mayClearRecoveryDraft,
  savePageWithRecovery,
  type PageSaveResult as DocumentSaveResult,
} from "./pageSession";
import {
  canonicalSuggestionRevision,
  createSuggestionDraftSession,
  previewSuggestionDraft,
  editableSuggestionDraft,
  freshestSavedSuggestions,
  persistSuggestionDraftOperations,
  recordSuggestionReplacementIntent,
  suggestionDraftOperations,
  suggestionOperationKey,
  suggestionSessionVisuals,
  type DraftSuggestion,
  type SuggestionDraftSession,
  type SuggestionDraftCaret,
  unpersistedDraftSuggestions,
} from "./suggestions/draft-session";
import { suggestedEditorIsolation } from "./suggestions/editor-isolation";
import {
  normalizeTitleText,
  stripMarkdownHeadingPrefixFromTitlePaste,
} from "./title-text";
import { VisualEditor } from "./VisualEditor";
import type {
  NotionPageLink,
  VisualEditorSuggestion,
  VisualEditorHistoryController,
  VisualEditorHistoryState,
  VisualEditorPersistenceController,
} from "./VisualEditor";

const TAB_ID = generateTabId();

export function applyHistoryToDocumentBody(
  hasDatabase: boolean,
  controller: VisualEditorHistoryController | null,
  restored: Pick<Document, "content" | "updatedAt" | "revision">,
) {
  if (hasDatabase) return true;
  return (
    controller?.replaceWithAuthoritativeContent({
      content: restored.content,
      contentUpdatedAt: restored.updatedAt,
      contentRevision: restored.revision ?? null,
    }) ?? false
  );
}

export function isHistoryRestoreReady(
  hasDatabase: boolean,
  controller: VisualEditorHistoryController | null,
  controllerDocumentId: string | null,
  documentId: string,
) {
  return (
    hasDatabase || (controller !== null && controllerDocumentId === documentId)
  );
}

interface DocumentEditorProps {
  documentId: string;
  databaseId?: string | null;
  databaseDocumentId?: string | null;
  viewId?: string | null;
}

export interface PageEditorSession {
  flush: () => Promise<void>;
  focusTitle: () => void;
}

export interface PageEditorSurfaceProps extends DocumentEditorProps {
  host: "page" | "preview";
  onSessionChange?: (session: PageEditorSession | null) => void;
  onDelete?: () => Promise<void>;
  focusTitle?: boolean;
  onTitleFocused?: () => void;
}

type FieldSaveWatermark = { title: string; updatedAt: string | null };
type ContentSaveWatermark = { content: string; updatedAt: string | null };
type DocumentUtilityPanel = "info" | "comments" | null;

export function documentCanonicalMutationsEnabled(
  editorCanEdit: boolean,
  isSuggesting: boolean,
) {
  return editorCanEdit && !isSuggesting;
}

export function isSuggestionConflictActionError(error: unknown) {
  return (
    (error as { errorCode?: unknown } | null)?.errorCode ===
    "suggestion_conflict"
  );
}

export function suggestionAmendmentTargetIsResolved(
  editingSuggestionId: string | null,
  suggestions: Array<Pick<ResourceSuggestion, "id" | "status">>,
) {
  if (!editingSuggestionId) return false;
  const suggestion = suggestions.find(
    (candidate) => candidate.id === editingSuggestionId,
  );
  return !!suggestion && suggestion.status !== "pending";
}

export function suggestionPresentation(
  suggestion: Pick<ResourceSuggestion, "id" | "status" | "operations">,
  currentMarkdown: string,
): VisualEditorSuggestion | null {
  if (suggestion.status !== "pending") return null;
  const operation = suggestion.operations[0];
  if (!operation) return null;
  const before = operation.before as {
    markdown?: unknown;
    changedText?: unknown;
  } | null;
  const after = operation.after as {
    markdown?: unknown;
    changedText?: unknown;
  } | null;
  const operationAnchor = operation.anchor as {
    from?: unknown;
    to?: unknown;
  } | null;
  const supportedKinds = [
    "insert_text",
    "delete_text",
    "replace_text",
    "add_text_block",
    "set_inline_mark",
  ] as const;
  if (
    !supportedKinds.includes(
      operation.kind as (typeof supportedKinds)[number],
    ) ||
    typeof before?.changedText !== "string" ||
    typeof before.markdown !== "string" ||
    typeof after?.changedText !== "string" ||
    typeof after.markdown !== "string" ||
    typeof operationAnchor?.from !== "number" ||
    typeof operationAnchor.to !== "number"
  ) {
    return null;
  }
  const range = resolveMarkdownSuggestionRange(currentMarkdown, operation);
  if (!range) return null;
  return {
    id: suggestion.id,
    kind: operation.kind as VisualEditorSuggestion["kind"],
    beforeText: before.changedText,
    afterText: after.changedText,
    beforePresentation: {
      source: before.markdown,
      from: operationAnchor.from,
      to: operationAnchor.to,
    },
    afterPresentation: {
      source: after.markdown,
      from: operationAnchor.from,
      to: operationAnchor.from + after.changedText.length,
    },
    anchor: {
      from: range.from,
      prefix: currentMarkdown.slice(Math.max(0, range.from - 32), range.from),
      suffix: currentMarkdown.slice(range.to, range.to + 32),
    },
    presentation: "canonical",
  };
}

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

export function refreshUnchangedTitleSaveWatermark(args: {
  serverTitle: string;
  serverUpdatedAt: string | null;
  lastSaved: FieldSaveWatermark;
}): FieldSaveWatermark {
  if (
    args.serverTitle !== args.lastSaved.title ||
    !args.serverUpdatedAt ||
    (args.lastSaved.updatedAt &&
      args.serverUpdatedAt <= args.lastSaved.updatedAt)
  ) {
    return args.lastSaved;
  }
  return { ...args.lastSaved, updatedAt: args.serverUpdatedAt };
}

export function refreshUnchangedContentSaveWatermark(args: {
  serverContent: string;
  serverUpdatedAt: string | null;
  lastSaved: ContentSaveWatermark;
}): ContentSaveWatermark {
  if (
    args.serverContent !== args.lastSaved.content ||
    !args.serverUpdatedAt ||
    (args.lastSaved.updatedAt &&
      args.serverUpdatedAt <= args.lastSaved.updatedAt)
  ) {
    return args.lastSaved;
  }

  // documents.updatedAt versions the whole row, not just the body. If the
  // fetched body still byte-matches our saved baseline, a newer timestamp can
  // only describe a title/icon/metadata update. Advance the content CAS base so
  // a local rich-text tail is not silently preflight-dropped. A concurrent body
  // edit still differs here and remains protected by the server CAS.
  return { ...args.lastSaved, updatedAt: args.serverUpdatedAt };
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

function DocumentUnavailable({ onOpenHome }: { onOpenHome?: () => void }) {
  const t = useT();
  const sidebarTrigger = useSidebarTrigger();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {sidebarTrigger ? (
        <div className="flex h-12 shrink-0 items-center px-4">
          {sidebarTrigger}
        </div>
      ) : null}
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
          {onOpenHome ? (
            <Button className="mt-6" variant="outline" onClick={onOpenHome}>
              {t("empty.goToDocuments")}
            </Button>
          ) : null}
        </div>
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
  viewId,
}: DocumentEditorProps) {
  return (
    <PageEditorSurface
      documentId={documentId}
      databaseId={databaseId}
      databaseDocumentId={databaseDocumentId}
      viewId={viewId}
      host="page"
    />
  );
}

export function pageEditorSessionKey({
  documentId,
  databaseId,
  databaseDocumentId,
}: Pick<
  PageEditorSurfaceProps,
  "documentId" | "databaseId" | "databaseDocumentId"
>) {
  return `${documentId}:${databaseId ?? ""}:${databaseDocumentId ?? ""}`;
}

export function PageEditorSurface({
  documentId,
  databaseId,
  databaseDocumentId,
  viewId,
  host,
  onSessionChange,
  onDelete,
  focusTitle = false,
  onTitleFocused,
}: PageEditorSurfaceProps) {
  const documentQuery = useDocument(documentId, {
    databaseId,
    databaseDocumentId,
  });
  const {
    data: queriedDocument,
    dataUpdatedAt,
    error,
    errorUpdateCount,
    errorUpdatedAt,
    isError,
    isFetchedAfterMount,
    isFetching,
  } = documentQuery;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const documentQueryKeyValue = documentQueryKey(documentId, {
    databaseId,
    databaseDocumentId,
  });
  const authoritativeSuccess = useAuthoritativeQuerySuccess(
    queryClient,
    documentQueryKeyValue,
  );
  const [manualRetryDocumentId, setManualRetryDocumentId] = useState<
    string | null
  >(null);
  const admittedDocumentIdRef = useRef<string | null>(null);
  const loadFailureRef = useRef<DocumentLoadFailureState | null>(null);
  const document =
    queriedDocument?.id === documentId ? queriedDocument : undefined;
  const loadFailure = updateDocumentLoadFailureState({
    previous: loadFailureRef.current,
    documentId,
    admitted: admittedDocumentIdRef.current === documentId,
    dataUpdatedAt,
    errorUpdateCount,
    errorUpdatedAt,
    isError,
    authoritativeSuccess,
  });
  loadFailureRef.current = loadFailure;
  const loadState = documentEditorLoadState({
    documentId,
    admittedDocumentId: admittedDocumentIdRef.current,
    hasDocument: Boolean(document),
    isDocumentCreationPending: document
      ? isDocumentCreationPending(document)
      : false,
    isFetchedAfterMount,
    isFetching,
    isError,
    hasLoadFailure: loadFailure.failed,
    isManualRetrying: manualRetryDocumentId === documentId,
    error,
  });
  admittedDocumentIdRef.current = loadState.admittedDocumentId;

  async function retryDocumentQuery() {
    setManualRetryDocumentId(documentId);
    try {
      await queryClient.cancelQueries({
        queryKey: documentQueryKey(documentId, {
          databaseId,
          databaseDocumentId,
        }),
        exact: true,
      });
      loadFailureRef.current = {
        documentId,
        queryIdentity: authoritativeSuccess.queryIdentity,
        baselineErrorUpdateCount: errorUpdateCount,
        baselineAuthoritativeSuccessGeneration: authoritativeSuccess.generation,
        failed: false,
      };
      await documentQuery.refetch();
    } finally {
      setManualRetryDocumentId((current) =>
        current === documentId ? null : current,
      );
    }
  }

  if (loadState.view === "unavailable") {
    return (
      <DocumentUnavailable
        onOpenHome={host === "page" ? () => navigate("/home") : undefined}
      />
    );
  }

  if (loadState.view === "error") {
    return (
      <QueryErrorState
        onRetry={() => void retryDocumentQuery()}
        retrying={manualRetryDocumentId === documentId}
      />
    );
  }

  // If we have a doc (real or optimistic from create) render the editor —
  // an `isError` blip during a just-fired create shouldn't flash "not found".
  // A database/list snapshot can optimistically seed the document cache with a
  // body that predates the latest collaborative save. Mounting ProseMirror from
  // that snapshot lets reconcile briefly insert the stale tail beside the
  // already-current Y.Doc. Wait only for this mount's first dedicated
  // get-document response; later poll/SSE refetches remain live and reconcile
  // without replacing the editor.
  if (!document || loadState.view === "skeleton") {
    return <DocumentEditorSkeleton />;
  }

  const editor = (
    <DocumentCommentDraftProvider documentId={documentId}>
      <PageEditorSessionBody
        key={pageEditorSessionKey({
          documentId,
          databaseId,
          databaseDocumentId,
        })}
        documentId={documentId}
        document={document}
        databaseId={databaseId}
        databaseDocumentId={databaseDocumentId}
        viewId={viewId}
        host={host}
        onSessionChange={onSessionChange}
        onDelete={onDelete}
        focusTitle={focusTitle}
        onTitleFocused={onTitleFocused}
      />
    </DocumentCommentDraftProvider>
  );
  return document.canEdit === true &&
    document.source?.mode !== "local-files" ? (
    <PageDraftRecovery
      key={pageEditorSessionKey({
        documentId,
        databaseId,
        databaseDocumentId,
      })}
      document={document}
    >
      {editor}
    </PageDraftRecovery>
  ) : (
    editor
  );
}

function DocumentCommentDraftProvider({
  documentId,
  children,
}: {
  documentId: string;
  children: ReactNode;
}) {
  const { session } = useSession();
  return (
    <CommentDraftProvider
      documentId={documentId}
      currentUserEmail={session?.email}
    >
      {children}
    </CommentDraftProvider>
  );
}

export function documentEditorLoadState({
  documentId,
  admittedDocumentId,
  hasDocument,
  isDocumentCreationPending,
  isFetchedAfterMount,
  isFetching,
  isError,
  hasLoadFailure,
  isManualRetrying,
  error,
}: {
  documentId: string;
  admittedDocumentId: string | null;
  hasDocument: boolean;
  isDocumentCreationPending: boolean;
  isFetchedAfterMount: boolean;
  isFetching: boolean;
  isError: boolean;
  hasLoadFailure: boolean;
  isManualRetrying: boolean;
  error: unknown;
}) {
  const activeAdmittedDocumentId =
    admittedDocumentId === documentId ? admittedDocumentId : null;

  if (hasDocument && isDocumentCreationPending) {
    return {
      view: "editor" as const,
      admittedDocumentId: documentId,
    };
  }
  if (!isFetching && isError && isDocumentLoadUnavailableError(error)) {
    return {
      view: "unavailable" as const,
      admittedDocumentId: null,
    };
  }
  if (hasDocument && activeAdmittedDocumentId === documentId) {
    return {
      view: "editor" as const,
      admittedDocumentId: documentId,
    };
  }
  if (isManualRetrying || isError || hasLoadFailure) {
    return {
      view:
        isError && isDocumentLoadUnavailableError(error)
          ? ("unavailable" as const)
          : ("error" as const),
      admittedDocumentId: activeAdmittedDocumentId,
    };
  }
  if (hasDocument && isFetchedAfterMount && !isFetching) {
    return {
      view: "editor" as const,
      admittedDocumentId: documentId,
    };
  }
  return {
    view: "skeleton" as const,
    admittedDocumentId: activeAdmittedDocumentId,
  };
}

type DocumentLoadFailureState = {
  documentId: string;
  queryIdentity: string;
  baselineErrorUpdateCount: number;
  baselineAuthoritativeSuccessGeneration: number;
  failed: boolean;
};

export type AuthoritativeQuerySuccess = {
  queryIdentity: string;
  generation: number;
  errorUpdateCount: number;
};

export function subscribeToAuthoritativeQuerySuccess(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  onSuccess: (errorUpdateCount: number) => void,
) {
  const queryHash = hashKey(queryKey);
  return queryClient.getQueryCache().subscribe((event) => {
    if (
      event.type === "updated" &&
      event.query.queryHash === queryHash &&
      event.action.type === "success" &&
      event.action.manual !== true
    ) {
      onSuccess(event.query.state.errorUpdateCount);
    }
  });
}

function useAuthoritativeQuerySuccess(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
): AuthoritativeQuerySuccess {
  const queryHash = hashKey(queryKey);
  const [success, setSuccess] = useState({
    queryHash,
    generation: 0,
    errorUpdateCount: 0,
  });

  useEffect(
    () =>
      subscribeToAuthoritativeQuerySuccess(
        queryClient,
        queryKey,
        (errorUpdateCount) => {
          setSuccess((current) => ({
            queryHash,
            generation:
              current.queryHash === queryHash ? current.generation + 1 : 1,
            errorUpdateCount,
          }));
        },
      ),
    [queryClient, queryHash],
  );

  return success.queryHash === queryHash
    ? { ...success, queryIdentity: queryHash }
    : { queryIdentity: queryHash, generation: 0, errorUpdateCount: 0 };
}

export function updateDocumentLoadFailureState({
  previous,
  documentId,
  admitted,
  dataUpdatedAt,
  errorUpdateCount,
  errorUpdatedAt,
  isError,
  authoritativeSuccess,
}: {
  previous: DocumentLoadFailureState | null;
  documentId: string;
  admitted: boolean;
  dataUpdatedAt: number;
  errorUpdateCount: number;
  errorUpdatedAt: number;
  isError: boolean;
  authoritativeSuccess: AuthoritativeQuerySuccess;
}): DocumentLoadFailureState {
  if (
    previous?.documentId !== documentId ||
    previous.queryIdentity !== authoritativeSuccess.queryIdentity
  ) {
    return {
      documentId,
      queryIdentity: authoritativeSuccess.queryIdentity,
      baselineErrorUpdateCount: errorUpdateCount,
      baselineAuthoritativeSuccessGeneration: authoritativeSuccess.generation,
      failed:
        isError || (errorUpdateCount > 0 && errorUpdatedAt > dataUpdatedAt),
    };
  }
  if (
    !isError &&
    authoritativeSuccess.generation >
      previous.baselineAuthoritativeSuccessGeneration &&
    authoritativeSuccess.errorUpdateCount >= errorUpdateCount
  ) {
    return {
      ...previous,
      baselineErrorUpdateCount: errorUpdateCount,
      baselineAuthoritativeSuccessGeneration: authoritativeSuccess.generation,
      failed: false,
    };
  }
  if (admitted || previous.failed) return previous;
  return errorUpdateCount > previous.baselineErrorUpdateCount
    ? {
        ...previous,
        baselineAuthoritativeSuccessGeneration: authoritativeSuccess.generation,
        failed: true,
      }
    : previous;
}

export function isDocumentLoadUnavailableError(error: unknown) {
  const status =
    error && typeof error === "object"
      ? (error as { status?: unknown }).status
      : undefined;
  return status === 403 || status === 404;
}

export function resolveAcknowledgedDocumentSnapshot<
  T extends { id: string; updatedAt: string },
>(args: {
  currentDocumentId: string;
  incoming: T;
  acknowledged: T | null;
}): { document: T; acknowledged: T | null } {
  if (!args.acknowledged) {
    return { document: args.incoming, acknowledged: null };
  }
  if (args.acknowledged.id !== args.currentDocumentId) {
    return { document: args.incoming, acknowledged: null };
  }
  if (args.incoming.updatedAt >= args.acknowledged.updatedAt) {
    return { document: args.incoming, acknowledged: args.incoming };
  }
  return {
    document: args.acknowledged,
    acknowledged: args.acknowledged,
  };
}

export function updateAdditionalBlockContents(args: {
  current: Record<string, string>;
  activeDocumentId: string;
  sourceDocumentId: string;
  propertyId: string;
  content: string | null;
}): Record<string, string> {
  if (args.sourceDocumentId !== args.activeDocumentId) return args.current;
  if (args.content === null) {
    if (!(args.propertyId in args.current)) return args.current;
    const next = { ...args.current };
    delete next[args.propertyId];
    return next;
  }
  return args.current[args.propertyId] === args.content
    ? args.current
    : { ...args.current, [args.propertyId]: args.content };
}

export function visualEditorInstanceKey(args: {
  documentId: string;
  documentUpdatedAt: string | null;
  isLocalFileDocument: boolean;
  canEdit: boolean;
  collabEditorEnabled: boolean;
  hasYDoc: boolean;
  localFileSyncRevision?: number;
}) {
  const mode = args.isLocalFileDocument
    ? `local-file:${args.localFileSyncRevision ?? 0}`
    : args.collabEditorEnabled && args.hasYDoc
      ? "live-ready"
      : args.canEdit
        ? "live-pending"
        : `snapshot:${args.documentUpdatedAt}`;
  return `${args.documentId}:${mode}`;
}

interface DocumentEditorBodyProps {
  documentId: string;
  document: Document;
  databaseId?: string | null;
  databaseDocumentId?: string | null;
  viewId?: string | null;
  host: "page" | "preview";
  onSessionChange?: (session: PageEditorSession | null) => void;
  onDelete?: () => Promise<void>;
  focusTitle: boolean;
  onTitleFocused?: () => void;
}

type PendingDocumentSave = {
  historySessionId: string;
  title: string;
  content: string;
  save: (
    title: string,
    content: string,
    options?: DocumentSaveOptions,
  ) => Promise<DocumentSaveResult>;
  canEditWhenQueued: boolean;
  contentEditVersion: number;
  expectedLocalSourceRevision?: string | null;
  timeout: ReturnType<typeof setTimeout>;
};

type DocumentSaveOptions = {
  historySessionId?: string;
  allowQueuedSave?: boolean;
  expectedLocalSourceRevision?: string | null;
  adoptCurrentServerBase?: boolean;
  contentBase?: DocumentContentBase;
  contentEditVersion?: number;
};

type DocumentUpdates = {
  title?: string;
  content?: string;
  description?: string;
  icon?: string | null;
};

export function enqueueDocumentSave<T>(
  queueRef: MutableRefObject<Promise<void>>,
  save: () => Promise<T>,
): Promise<T> {
  // Content CAS assumes each local save starts from the result of the previous
  // local save. Debounced typing and structural "save now" operations can
  // otherwise overlap with the same baseUpdatedAt: the shorter request wins,
  // and the later, fuller document is rejected as a conflict. Keep the safety
  // guard and serialize this editor's writes instead of weakening CAS.
  const queued = queueRef.current.then(save, save);
  queueRef.current = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
}

function useElementMinWidth(
  ref: MutableRefObject<HTMLElement | null>,
  minWidth: number,
) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () =>
      setMatches(element.getBoundingClientRect().width >= minWidth);
    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, [minWidth, ref]);

  return matches;
}

export function positionAnchoredCommentCard({
  anchorRect,
  containerRect,
  boundaryRect = containerRect,
  cardHeight,
  preferredWidth = 320,
  gap = 4,
  edge = 16,
}: {
  anchorRect: Pick<DOMRect, "top" | "bottom" | "left" | "right">;
  containerRect: Pick<DOMRect, "top" | "bottom" | "left" | "right" | "width">;
  boundaryRect?: Pick<DOMRect, "top" | "bottom">;
  cardHeight: number;
  preferredWidth?: number;
  gap?: number;
  edge?: number;
}) {
  const width = Math.min(preferredWidth, containerRect.width - edge * 2);
  const centeredLeft =
    (anchorRect.left + anchorRect.right) / 2 - containerRect.left - width / 2;
  const left = Math.min(
    containerRect.width - width - edge,
    Math.max(edge, centeredLeft),
  );
  const below = anchorRect.bottom - containerRect.top + gap;
  const above = anchorRect.top - containerRect.top - cardHeight - gap;
  const fitsBelow =
    anchorRect.bottom + gap + cardHeight <= boundaryRect.bottom - edge;
  return {
    left,
    top: fitsBelow
      ? below
      : Math.max(boundaryRect.top - containerRect.top + edge, above),
    width,
    placement: fitsBelow ? ("below" as const) : ("above" as const),
  };
}

export function pendingCommentTargetMatches(
  marked: Iterable<Pick<Element, "textContent">>,
  quotedText: string,
) {
  const elements = [...marked];
  return (
    elements.length > 0 &&
    elements.map((element) => element.textContent ?? "").join("") === quotedText
  );
}

export function positionUnanchoredCommentCard({
  containerRect,
  boundaryRect,
  preferredWidth = 320,
  edge = 16,
}: {
  containerRect: Pick<DOMRect, "top" | "width">;
  boundaryRect: Pick<DOMRect, "top">;
  preferredWidth?: number;
  edge?: number;
}) {
  return {
    left: edge,
    top: boundaryRect.top - containerRect.top + edge,
    width: Math.max(
      0,
      Math.min(preferredWidth, containerRect.width - edge * 2),
    ),
    placement: "below" as const,
  };
}

export function documentEditorShowsInlineComments(args: {
  showIndicators: boolean;
  hasUtilityRailSpace: boolean;
  commentsHistoryDrawerOpen: boolean;
  utilityPanel: DocumentUtilityPanel;
  hasOpenCommentThreads: boolean;
  hasSelectedCommentThread: boolean;
  hasPendingComment: boolean;
}) {
  return (
    args.showIndicators &&
    args.hasUtilityRailSpace &&
    !args.commentsHistoryDrawerOpen &&
    args.utilityPanel !== "info" &&
    (args.hasOpenCommentThreads ||
      args.hasSelectedCommentThread ||
      args.hasPendingComment)
  );
}

export function utilityPanelAfterCommentFocusDismissal(
  utilityPanel: DocumentUtilityPanel,
): DocumentUtilityPanel {
  return utilityPanel === "comments" ? null : utilityPanel;
}

export function documentEditorTitleRegionClassName(
  hasDatabase: boolean,
  host: "page" | "preview" = "page",
) {
  if (host === "preview") {
    return hasDatabase
      ? "shrink-0 w-full max-w-none px-4 pb-2 pt-2 sm:px-6 sm:pt-6 group/title"
      : "shrink-0 mx-auto w-full max-w-3xl px-4 pb-3 pt-2 sm:px-6 sm:pt-6 group/title";
  }
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

export function resizeDocumentTitleTextarea(
  textarea: Pick<HTMLTextAreaElement, "scrollHeight" | "style">,
) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

export function documentTitleWidthChanged(
  previousWidth: number,
  nextWidth: number,
) {
  return Math.abs(nextWidth - previousWidth) >= 0.5;
}

export function shouldShowNewDocumentTypeChooser(args: {
  canEdit: boolean;
  isLocalFileDocument: boolean;
  isDatabasePage: boolean;
  initiallyEligible: boolean;
  newDocumentTypeChosen: boolean;
  description?: string | null;
  content: string;
}) {
  return (
    args.canEdit &&
    !args.isLocalFileDocument &&
    !args.isDatabasePage &&
    args.initiallyEligible &&
    !args.newDocumentTypeChosen &&
    !args.description?.trim() &&
    isEffectivelyEmptyDocumentContent(args.content)
  );
}

export function documentTypeChooserInitiallyEligible(args: {
  creationPending: boolean;
  title: string;
  description?: string | null;
  content: string;
}) {
  return (
    args.creationPending ||
    (!args.title.trim() &&
      !args.description?.trim() &&
      isEffectivelyEmptyDocumentContent(args.content))
  );
}

export function databaseConversionRequest(
  documentId: string,
  currentTitle: string,
) {
  return { documentId, title: currentTitle };
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
    !membership.databaseDocumentId ||
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
    | "database"
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
  const peerDocuments = documents.filter(
    (item) => !item.database?.systemRole && item.source?.kind !== "folder",
  );
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
    const siblings = peerDocuments
      .filter((candidate) => {
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

function PageEditorSessionBody({
  documentId,
  document: incomingDocument,
  databaseId,
  databaseDocumentId,
  viewId,
  host,
  onSessionChange,
  onDelete,
  focusTitle,
  onTitleFocused,
}: DocumentEditorBodyProps) {
  const acknowledgedDocumentRef = useRef<Document | null>(null);
  const resolvedDocument = resolveAcknowledgedDocumentSnapshot({
    currentDocumentId: documentId,
    incoming: incomingDocument,
    acknowledged: acknowledgedDocumentRef.current,
  });
  acknowledgedDocumentRef.current = resolvedDocument.acknowledged;
  const document = resolvedDocument.document;
  const currentDocumentRef = useRef(document);
  currentDocumentRef.current = document;
  const t = useT();
  const pageEditorOwner = pageEditorSessionKey({
    documentId,
    databaseId,
    databaseDocumentId,
  });
  useEffect(() => {
    if (host !== "page") return;
    void rememberContentLandingDocument(documentId).catch((error) => {
      toast.error(t("landing.saveFailed"), {
        description:
          error instanceof Error ? error.message : t("empty.genericError"),
      });
    });
  }, [documentId, host, t]);
  const updateDocument = useUpdateDocument();
  const updatePreviewDocumentDraft = useUpdatePreviewDocumentDraft();
  const updatePreviewDocumentDraftRef = useRef(
    updatePreviewDocumentDraft.mutateAsync,
  );
  updatePreviewDocumentDraftRef.current =
    updatePreviewDocumentDraft.mutateAsync;
  const handleToggleFavorite = useCallback(
    (nextFavorite: boolean) => {
      updateDocument.mutate(
        { id: documentId, isFavorite: nextFavorite },
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
    [documentId, t, updateDocument],
  );
  const createDatabase = useCreateContentDatabase(documentId);
  const deleteContentDatabase = useDeleteContentDatabase();
  const deleteDocument = useDeleteDocument();
  const queryClient = useQueryClient();
  const processBuilderBodies = useProcessBuilderBodyHydration(
    document.bodyHydration?.databaseDocumentId ?? documentId,
  );
  const canEdit = document.canEdit === true;
  const canEditRef = useRef(canEdit);
  const navigate = useNavigate();
  const location = useLocation();
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
  const canComment =
    !isLocalFileDocument &&
    (document.canComment ??
      (document.accessRole === "owner" ||
        document.accessRole === "admin" ||
        document.accessRole === "editor" ||
        document.accessRole === "commenter"));
  const createSuggestion = useCreateResourceSuggestion();
  const updateSuggestion = useUpdateResourceSuggestion();
  const decideSuggestion = useDecideResourceSuggestion();
  const suggestionsQuery = useResourceSuggestions(
    { resourceType: "document", resourceId: documentId },
    { enabled: !isLocalFileDocument },
  );
  const [isSuggesting, setIsSuggesting] = useState(false);
  // Registry blocks do not yet produce typed suggestion operations. Keep their
  // canonical child actions read-only while the surrounding body is a draft.
  const blockRenderContext = useMemo(
    () =>
      createContentBlockRenderContext({
        documentId,
        canEdit: documentCanonicalMutationsEnabled(canEdit, isSuggesting),
      }),
    [documentId, canEdit, isSuggesting],
  );
  const [isSubmittingSuggestions, setIsSubmittingSuggestions] = useState(false);
  const [suggestionAmendmentConflict, setSuggestionAmendmentConflict] =
    useState(false);
  const [suggestionDraft, setSuggestionDraft] = useState(document.content);
  const [anchoredSuggestionIds, setAnchoredSuggestionIds] = useState<
    string[] | null
  >(null);
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<
    string | null
  >(null);
  const [hoveredSuggestionId, setHoveredSuggestionId] = useState<string | null>(
    null,
  );
  const [editingSuggestionId, setEditingSuggestionId] = useState<string | null>(
    null,
  );
  const [suggestionInitialSelection, setSuggestionInitialSelection] =
    useState<SuggestionDraftCaret | null>(null);
  const suggestionBaseRef = useRef<SuggestionDraftSession | null>(null);
  const createdSuggestionOperationsRef = useRef(new Map());
  const suggestionAmendmentKeysRef = useRef(new Map<string, string>());
  const [suggestionPersistenceRevision, setSuggestionPersistenceRevision] =
    useState(0);
  const [locallyCreatedSuggestions, setLocallyCreatedSuggestions] = useState<
    ResourceSuggestion[]
  >([]);
  const [utilityPanel, setUtilityPanel] = useState<DocumentUtilityPanel>(null);
  const [lastUtilityPanel, setLastUtilityPanel] =
    useState<Exclude<DocumentUtilityPanel, null>>("comments");
  const [commentsBrowseOpen, setCommentsBrowseOpen] = useState(false);
  const [commentsHistoryRailMounted, setCommentsHistoryRailMounted] =
    useState(false);
  const [showCommentIndicators, setShowCommentIndicators] = useState(true);
  const canSuggest = canComment && document.canSuggest === true;
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
  useDocumentSyncStatus(canEdit && !isLocalFileDocument ? documentId : null);
  const pushDocumentToNotion = usePushDocumentToNotion(documentId);
  const [localTitle, setLocalTitle] = useState("");
  const [localContent, setLocalContent] = useState("");
  const [additionalBlockContents, setAdditionalBlockContents] = useState<
    Record<string, string>
  >({});
  const activeDocumentIdRef = useRef(documentId);
  activeDocumentIdRef.current = documentId;
  const handleAdditionalBlockContentChange = useCallback(
    (sourceDocumentId: string, propertyId: string, content: string | null) => {
      setAdditionalBlockContents((current) =>
        updateAdditionalBlockContents({
          current,
          activeDocumentId: activeDocumentIdRef.current,
          sourceDocumentId,
          propertyId,
          content,
        }),
      );
    },
    [],
  );

  useEffect(() => {
    setAdditionalBlockContents({});
  }, [documentId]);

  useEffect(() => {
    if (host !== "page") return;
    const nextTitle = `${normalizeDocumentTitle(
      localTitle,
      t("sidebar.untitled"),
    )} — Content`;
    const previousTitle = window.document.title;
    window.document.title = nextTitle;
    return () => {
      if (window.document.title === nextTitle) {
        window.document.title = previousTitle;
      }
    };
  }, [host, localTitle, t]);

  const [databaseExportContext, setDatabaseExportContext] =
    useState<DatabaseExportContext | null>(null);
  const databaseExportContextFingerprintRef = useRef("null");
  const handleDatabaseExportContextChange = useCallback(
    (context: DatabaseExportContext | null) => {
      const fingerprint = JSON.stringify(context);
      if (databaseExportContextFingerprintRef.current === fingerprint) return;
      databaseExportContextFingerprintRef.current = fingerprint;
      setDatabaseExportContext(context);
    },
    [],
  );
  const [newDocumentTypeChosen, setNewDocumentTypeChosen] = useState(false);
  const newDocumentTypeChooserEligibilityRef = useRef({
    documentId,
    eligible: documentTypeChooserInitiallyEligible({
      creationPending: isDocumentCreationPending(document),
      title: document.title,
      description: document.description,
      content: document.content,
    }),
  });
  if (newDocumentTypeChooserEligibilityRef.current.documentId !== documentId) {
    newDocumentTypeChooserEligibilityRef.current = {
      documentId,
      eligible: documentTypeChooserInitiallyEligible({
        creationPending: isDocumentCreationPending(document),
        title: document.title,
        description: document.description,
        content: document.content,
      }),
    };
  }
  const [localContentUpdatedAt, setLocalContentUpdatedAt] = useState<
    string | null
  >(document.updatedAt ?? null);
  const localSourceRevisionRef = useRef<DesktopContentFileRevision | undefined>(
    undefined,
  );
  const pendingLocalSourceWriteRef = useRef<PendingLocalSourceWrite | null>(
    null,
  );
  const [localSourceConflict, setLocalSourceConflict] = useState<{
    diskDocument: Document;
    diskRevision?: DesktopContentFileRevision;
    unsavedText: string;
  } | null>(null);
  const [documentReconcileConflict, setDocumentReconcileConflict] = useState<{
    localDraft: string;
  } | null>(null);
  const [localSourceMissing, setLocalSourceMissing] = useState(false);
  const [localSourceAccess, setLocalSourceAccess] = useState<
    "checking" | "available" | "unavailable"
  >("checking");
  const [localFileSyncRevision, setLocalFileSyncRevision] = useState(0);
  const editorHistoryControllerDocumentIdRef = useRef<string | null>(null);
  const [editorHistoryControllerReady, setEditorHistoryControllerReady] =
    useState(false);
  const editorHistoryControllerRef =
    useRef<VisualEditorHistoryController | null>(null);
  const editorEscapeTargetRef = useRef<HTMLButtonElement>(null);
  const editorPersistenceControllerRef =
    useRef<VisualEditorPersistenceController | null>(null);
  const [editorHistoryState, setEditorHistoryState] =
    useState<VisualEditorHistoryState>({ canUndo: false, canRedo: false });
  const handleHistoryStateChange = useCallback(
    (next: VisualEditorHistoryState) => {
      setEditorHistoryState((current) =>
        current.canUndo === next.canUndo && current.canRedo === next.canRedo
          ? current
          : next,
      );
    },
    [],
  );
  const handleHistoryControllerChange = useCallback(
    (controller: VisualEditorHistoryController | null) => {
      editorHistoryControllerRef.current = controller;
      editorHistoryControllerDocumentIdRef.current = controller
        ? documentId
        : null;
      setEditorHistoryControllerReady(controller !== null);
    },
    [documentId],
  );
  const handlePersistenceControllerChange = useCallback(
    (controller: VisualEditorPersistenceController | null) => {
      editorPersistenceControllerRef.current = controller;
    },
    [],
  );
  const handleDeleteDocument = useCallback(async () => {
    try {
      if (onDelete) {
        await onDelete();
        return;
      }
      if (document.database) {
        await deleteContentDatabase.mutateAsync({
          databaseId: document.database.id,
        });
      } else {
        await deleteDocument.mutateAsync({ id: documentId });
      }
      void navigate("/home", { replace: true, flushSync: true });
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
    onDelete,
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
  const historySessionRef = useRef(createHistorySession());
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promotedBuilderBodyRef = useRef<string | null>(null);
  const builderBodyRetryWakeRef = useRef<number | null>(null);
  const pendingDocumentSaveRef = useRef<PendingDocumentSave | null>(null);
  const documentSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const activeContentSavesRef = useRef(0);
  const recoveryDraftRef = useRef<{
    version: number;
    title: string;
    content: string;
  } | null>(null);
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
  const contentEditVersionRef = useRef(0);
  localContentRef.current = localContent;
  const getLinkedLocalEditorSnapshot = useCallback(
    () => ({
      title: localTitleRef.current,
      content: localContentRef.current,
    }),
    [],
  );
  const localSourceWriteErrorShownRef = useRef(false);
  const documentUpdatedAtRef = useRef<string | null>(
    document.updatedAt ?? null,
  );
  documentUpdatedAtRef.current = document.updatedAt ?? null;
  const documentContentRef = useRef(document.content);
  documentContentRef.current = document.content;
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
    const hydrationContext = document.bodyHydration;
    const hydration = hydrationContext?.hydration;
    if (
      !canEdit ||
      !hydrationContext?.sourceId ||
      !hydration ||
      (hydration.status !== "pending" && hydration.status !== "error")
    ) {
      return;
    }
    if (hydration.status === "error" && hydration.retryable === false) return;
    const promotionKey = `${hydrationContext.sourceId}:${documentId}:${hydration.status}:${hydration.version ?? ""}`;
    if (promotedBuilderBodyRef.current === promotionKey) return;
    promotedBuilderBodyRef.current = promotionKey;
    const request = {
      sourceId: hydrationContext.sourceId,
      documentId,
      limit: 1,
      retryFailed: hydration.status === "error",
    };
    const pump = () => {
      processBuilderBodies.mutate(request, {
        onSuccess: (result) => {
          if (!result.nextAttemptAt || result.remaining === 0) return;
          const delayMs = Math.max(
            0,
            Date.parse(result.nextAttemptAt) - Date.now(),
          );
          if (!Number.isFinite(delayMs)) return;
          if (builderBodyRetryWakeRef.current !== null) {
            window.clearTimeout(builderBodyRetryWakeRef.current);
          }
          builderBodyRetryWakeRef.current = window.setTimeout(() => {
            builderBodyRetryWakeRef.current = null;
            pump();
          }, delayMs);
        },
      });
    };
    pump();
  }, [
    canEdit,
    document.bodyHydration,
    documentId,
    processBuilderBodies.mutate,
  ]);
  useEffect(
    () => () => {
      if (builderBodyRetryWakeRef.current !== null) {
        window.clearTimeout(builderBodyRetryWakeRef.current);
      }
    },
    [],
  );
  const titleFocusedRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pendingPaddingScrollRestoreRef = useRef<number | null>(null);
  const cancelPaddingScrollRestore = () => {
    if (pendingPaddingScrollRestoreRef.current !== null) {
      window.clearTimeout(pendingPaddingScrollRestoreRef.current);
      pendingPaddingScrollRestoreRef.current = null;
    }
  };
  useEffect(
    () => () => {
      if (pendingPaddingScrollRestoreRef.current !== null) {
        window.clearTimeout(pendingPaddingScrollRestoreRef.current);
      }
    },
    [documentId],
  );
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
      void navigate(`/page/${linkedDocumentId}`, { flushSync: true });
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
    resizeDocumentTitleTextarea(textarea);
  }, [localTitle]);

  useLayoutEffect(() => {
    const textarea = titleInputRef.current;
    if (!textarea) return;

    let previousWidth = textarea.getBoundingClientRect().width;
    const resizeIfWidthChanged = (nextWidth: number) => {
      if (!documentTitleWidthChanged(previousWidth, nextWidth)) return;
      previousWidth = nextWidth;
      resizeDocumentTitleTextarea(textarea);
    };
    const handleWindowResize = () =>
      resizeIfWidthChanged(textarea.getBoundingClientRect().width);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            const entry = entries.find(
              (candidate) => candidate.target === textarea,
            );
            resizeIfWidthChanged(
              entry?.contentRect.width ??
                textarea.getBoundingClientRect().width,
            );
          });

    observer?.observe(textarea);
    if (!observer) window.addEventListener("resize", handleWindowResize);
    return () => {
      observer?.disconnect();
      if (!observer) window.removeEventListener("resize", handleWindowResize);
    };
  }, []);

  // Current user info for cursor labels
  const { session } = useSession();
  const currentUserAvatarUrl = useAvatarUrl(session?.email);
  const currentUser: CollabUser | undefined = session?.email
    ? {
        name: session.name?.trim() || emailToName(session.email),
        email: session.email,
        color: emailToColor(session.email),
        avatarUrl: currentUserAvatarUrl ?? undefined,
      }
    : undefined;

  // All SQL-backed readers subscribe for presence. Only editors bind the body
  // to Yjs; viewers render canonical SQL so missing collab state cannot hide it.
  const collabEnabled = !isLocalFileDocument;
  const collabDocumentId =
    collabEnabled && !isDocumentCreationPending(document) ? documentId : null;
  const {
    ydoc,
    awareness,
    isSynced: collabSynced,
    requestSync: requestCollabSync,
    initialization: collabInitialization,
    activeUsers,
    agentActive,
    agentPresent,
  } = useCollaborativeDoc({
    docId: collabDocumentId,
    requestSource: TAB_ID,
    user: currentUser,
  });
  const bodyHydrationPending = documentBodyHydrationIsPending(document);
  const bodyHydrationError =
    document.bodyHydration?.hydration?.status === "error"
      ? document.bodyHydration.hydration
      : null;
  const collabInitializationFailed =
    collabEnabled && collabInitialization.status === "error";
  const editorCanEdit =
    canEdit &&
    !bodyHydrationPending &&
    !localSourceMissing &&
    (!isLocalFileDocument || localSourceAccess === "available") &&
    (isLocalFileDocument || collabSynced) &&
    !collabInitializationFailed;
  // Yjs only becomes a body source after the authoritative initial state is
  // ready. Until then the canonical SQL body stays visible and read-only.
  const collabEditorEnabled =
    collabEnabled &&
    canEdit &&
    !bodyHydrationPending &&
    collabSynced &&
    collabInitialization.status === "ready" &&
    !collabInitializationFailed;
  const suggestionEditorIsolation = suggestedEditorIsolation({
    suggesting: isSuggesting,
    canSuggest,
    canEdit: editorCanEdit,
    collaborationReady: collabEditorEnabled,
  });
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
      historySessionRef.current.reset();
      prevDocIdRef.current = documentId;
      isInitializedRef.current = false;
      setNewDocumentTypeChosen(false);
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
        pendingDocumentSaveRef.current = null;
      }
      pendingLocalSourceWriteRef.current = null;
      setLocalSourceMissing(false);
      setLocalSourceAccess("checking");
      setLocalFileSyncRevision(0);
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
    if (serverTitle === lastSaved.title) {
      lastSavedTitleRef.current = refreshUnchangedTitleSaveWatermark({
        serverTitle,
        serverUpdatedAt: document.updatedAt ?? null,
        lastSaved,
      });
      return;
    }
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
    if (
      localContent !== serverContent &&
      (pendingDocumentSaveRef.current ||
        activeContentSavesRef.current > 0 ||
        documentReconcileConflict)
    )
      return;
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
    documentReconcileConflict,
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

  const pendingPersistenceRef = useRef(
    new Set<Promise<Document | DocumentUpdateConflictResponse>>(),
  );
  const persistenceErrorsRef = useRef(
    new Map<keyof DocumentUpdates, unknown>(),
  );
  const persistDocumentUpdatesUntracked = useCallback(
    async (
      updates: DocumentUpdates,
      options: DocumentSaveOptions = {},
    ): Promise<Document | DocumentUpdateConflictResponse> => {
      if (!options.allowQueuedSave && !canEditRef.current) {
        throw new Error(t("editor.pageSaveBeforeNavigationFailed"));
      }

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
        let expectedLocalSourceRevision = localSourceRevisionForSave(
          options.expectedLocalSourceRevision,
          localSourceRevisionRef.current,
        );
        if (!expectedLocalSourceRevision) {
          const baseline = await readDocumentFromLinkedLocalSource(
            document,
            localSource,
          );
          if (!baseline.ok) throw new Error(baseline.error);
          if (
            baseline.revision &&
            (baseline.document.content !==
              lastSavedContentRef.current.content ||
              baseline.document.title !== lastSavedTitleRef.current.title)
          ) {
            setLocalSourceConflict({
              diskDocument: baseline.document,
              diskRevision: baseline.revision,
              unsavedText: localContentRef.current,
            });
            throw new Error(
              "The file changed on disk before this edit could be saved.",
            );
          }
          expectedLocalSourceRevision = baseline.revision;
          localSourceRevisionRef.current = baseline.revision;
        }
        const pendingLocalWrite = {
          title: fileFirstDocument.title,
          content: fileFirstDocument.content,
        };
        pendingLocalSourceWriteRef.current = pendingLocalWrite;
        let result;
        try {
          result = await writeDocumentToLinkedLocalSource(
            fileFirstDocument,
            localSource,
            { expectedRevision: expectedLocalSourceRevision },
          );
        } catch (error) {
          if (pendingLocalSourceWriteRef.current === pendingLocalWrite) {
            pendingLocalSourceWriteRef.current = null;
          }
          throw error;
        }
        if (!result.ok) {
          if (pendingLocalSourceWriteRef.current === pendingLocalWrite) {
            pendingLocalSourceWriteRef.current = null;
          }
          if (result.conflict) {
            const latest = await readDocumentFromLinkedLocalSource(
              fileFirstDocument,
              localSource,
            );
            if (latest.ok) {
              setLocalSourceConflict({
                diskDocument: latest.document,
                diskRevision: latest.revision,
                unsavedText: localContentRef.current,
              });
            }
          }
          if (!localSourceWriteErrorShownRef.current) {
            toast.error(t("editor.couldNotSaveLocalFile"), {
              description: result.error,
            });
            localSourceWriteErrorShownRef.current = true;
          }
          throw new Error(result.error);
        }
        localSourceRevisionRef.current = result.revision;
        lastSavedTitleRef.current = {
          ...lastSavedTitleRef.current,
          title: fileFirstDocument.title,
        };
        lastSavedContentRef.current = {
          ...lastSavedContentRef.current,
          content: fileFirstDocument.content,
        };
        if (pendingLocalSourceWriteRef.current === pendingLocalWrite) {
          pendingLocalSourceWriteRef.current = null;
        }
        setLocalSourceConflict(null);
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
            ? ((options.contentBase ?? lastSavedContentRef.current).updatedAt ??
              undefined)
            : undefined;
        return await updateDocument.mutateAsync({
          id: documentId,
          loadedUpdatedAt:
            options.contentBase?.updatedAt ??
            documentUpdatedAtRef.current ??
            undefined,
          loadedContentWasEmpty:
            updates.content !== undefined
              ? isEffectivelyEmptyDocumentContent(
                  (options.contentBase ?? lastSavedContentRef.current).content,
                )
              : undefined,
          ...updates,
          historySessionId:
            options.historySessionId ??
            historySessionRef.current.activity(documentId),
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
        queryClient.setQueriesData(documentQueryFilter(documentId), (old) =>
          mergeDocumentIntoDocumentCache(old, fileFirstDocument),
        );
        void queryClient.invalidateQueries({
          queryKey: ["action", "list-documents"],
        });
        return fileFirstDocument;
      }
    },
    [document, documentId, queryClient, updateDocument],
  );
  const persistDocumentUpdates = useCallback(
    (updates: DocumentUpdates, options: DocumentSaveOptions = {}) => {
      const fields = Object.keys(updates) as (keyof DocumentUpdates)[];
      const request = persistDocumentUpdatesUntracked(updates, options);
      pendingPersistenceRef.current.add(request);
      void request.then(
        (result) => {
          if (isDocumentUpdateConflict(result)) {
            const error = new Error(
              "The page changed before the latest edit could be saved.",
            );
            for (const field of fields) {
              persistenceErrorsRef.current.set(field, error);
            }
          } else {
            if (
              result.updatedAt &&
              (!documentUpdatedAtRef.current ||
                result.updatedAt >= documentUpdatedAtRef.current)
            ) {
              documentUpdatedAtRef.current = result.updatedAt;
              documentContentRef.current = result.content;
              if (result.title === lastSavedTitleRef.current.title) {
                lastSavedTitleRef.current.updatedAt = result.updatedAt;
              }
              if (result.content === lastSavedContentRef.current.content) {
                lastSavedContentRef.current.updatedAt = result.updatedAt;
              }
            }
            for (const field of fields) {
              persistenceErrorsRef.current.delete(field);
            }
          }
          pendingPersistenceRef.current.delete(request);
        },
        (error) => {
          for (const field of fields) {
            persistenceErrorsRef.current.set(field, error);
          }
          pendingPersistenceRef.current.delete(request);
        },
      );
      return request;
    },
    [persistDocumentUpdatesUntracked],
  );
  // The document query can refresh its object identity without changing the
  // flush request itself. Keep the latest save function behind a ref so those
  // routine refreshes do not restart the one-shot flush reader and flood the
  // browser with duplicate application-state requests.
  const persistDocumentUpdatesRef = useRef(persistDocumentUpdates);
  persistDocumentUpdatesRef.current = persistDocumentUpdates;

  useEffect(() => {
    if (!isLinkedLocalSourceDocument) return;
    let active = true;

    const adoptDisk = async () => {
      const result = await readDocumentFromLinkedLocalSource(document);
      if (!active) return;
      if (!result.ok) {
        setLocalSourceAccess("unavailable");
        if (result.error.includes("was not found")) {
          if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = null;
            pendingDocumentSaveRef.current = null;
          }
          pendingLocalSourceWriteRef.current = null;
          setLocalSourceMissing(true);
        }
        return;
      }
      setLocalSourceAccess("available");
      setLocalSourceMissing(false);
      const diskContent = result.document.content;
      const disposition = classifyLocalSourceRead({
        diskTitle: result.document.title,
        diskContent,
        localContent: localContentRef.current,
        lastSavedTitle: lastSavedTitleRef.current.title,
        lastSavedContent: lastSavedContentRef.current.content,
        pendingWrite: pendingLocalSourceWriteRef.current,
        hasPendingSave: pendingDocumentSaveRef.current !== null,
      });
      if (disposition === "pending-self-write") {
        localSourceRevisionRef.current = result.revision;
        return;
      }
      if (disposition === "conflict") {
        setLocalSourceConflict({
          diskDocument: result.document,
          diskRevision: result.revision,
          unsavedText: localContentRef.current,
        });
        return;
      }
      localSourceRevisionRef.current = result.revision;
      if (disposition === "unchanged") return;
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
        pendingDocumentSaveRef.current = null;
      }
      localTitleRef.current = result.document.title;
      localContentRef.current = diskContent;
      setLocalTitle(result.document.title);
      setLocalContent(diskContent);
      setLocalContentUpdatedAt(result.updatedAt);
      lastSavedTitleRef.current = {
        title: result.document.title,
        updatedAt: result.updatedAt,
      };
      lastSavedContentRef.current = {
        content: diskContent,
        updatedAt: result.updatedAt,
      };
      setLocalFileSyncRevision((revision) => revision + 1);
      setLocalSourceConflict(null);
    };

    void adoptDisk();
    let stop: (() => void) | undefined;
    void watchLinkedLocalSource(document.source, () => void adoptDisk()).then(
      (result) => {
        if (!active) {
          if (result.ok) result.unsubscribe();
          return;
        }
        if (result.ok) stop = () => result.unsubscribe();
      },
    );
    return () => {
      active = false;
      stop?.();
    };
  }, [document.id, document.source, isLinkedLocalSourceDocument]);

  const handleLinkedLocalAgentPersistence = useCallback(
    (persisted: Document, revision?: DesktopContentFileRevision) => {
      localSourceRevisionRef.current = revision;
      localTitleRef.current = persisted.title;
      localContentRef.current = persisted.content;
      setLocalTitle(persisted.title);
      setLocalContent(persisted.content);
      setLocalContentUpdatedAt(persisted.updatedAt ?? new Date().toISOString());
      lastSavedTitleRef.current = {
        title: persisted.title,
        updatedAt: lastSavedTitleRef.current.updatedAt,
      };
      lastSavedContentRef.current = {
        content: persisted.content,
        updatedAt: lastSavedContentRef.current.updatedAt,
      };
      setLocalFileSyncRevision((revision) => revision + 1);
      setLocalSourceConflict(null);
      const sqlUpdatedAt = documentUpdatedAtRef.current;
      queryClient.setQueriesData(documentQueryFilter(documentId), (old) =>
        mergeDocumentIntoDocumentCache(old, {
          ...persisted,
          updatedAt: sqlUpdatedAt ?? persisted.updatedAt,
        }),
      );
    },
    [documentId, queryClient],
  );

  useEffect(() => {
    if (
      !isLinkedLocalSourceDocument ||
      document.title !== localTitleRef.current ||
      document.content !== localContentRef.current ||
      !document.updatedAt
    ) {
      return;
    }
    lastSavedTitleRef.current = {
      title: document.title,
      updatedAt: document.updatedAt,
    };
    lastSavedContentRef.current = {
      content: document.content,
      updatedAt: document.updatedAt,
    };
  }, [
    document.content,
    document.title,
    document.updatedAt,
    isLinkedLocalSourceDocument,
  ]);

  const saveDocumentImmediately = useCallback(
    async (
      title: string,
      content: string,
      options: DocumentSaveOptions = {},
    ): Promise<DocumentSaveResult> => {
      const contentEditVersion =
        options.contentEditVersion ?? contentEditVersionRef.current;
      if (options.adoptCurrentServerBase) {
        lastSavedContentRef.current = {
          content: documentContentRef.current,
          updatedAt: documentUpdatedAtRef.current,
        };
      }
      lastSavedContentRef.current = refreshUnchangedContentSaveWatermark({
        serverContent: documentContentRef.current,
        serverUpdatedAt: documentUpdatedAtRef.current,
        lastSaved: lastSavedContentRef.current,
      });
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

      let saved: Document | DocumentUpdateConflictResponse;
      if (
        updates.content !== undefined &&
        !isLinkedLocalSourceDocument &&
        !isLocalFileDocument
      ) {
        const savedTitle = lastSavedTitleRef.current.title;
        activeContentSavesRef.current += 1;
        let result;
        try {
          result = await saveDocumentWithRebase({
            base: { ...lastSavedContentRef.current },
            content,
            owner: {
              version: contentEditVersion,
              current: () => ({
                version: contentEditVersionRef.current,
                content: localContentRef.current,
              }),
              confirm: (confirmedContent) => {
                localContentRef.current = confirmedContent;
                setLocalContent(confirmedContent);
                setDocumentReconcileConflict(null);
              },
            },
            canRetry: (winner) =>
              updates.title === undefined ||
              winner.title === savedTitle ||
              winner.title === updates.title,
            confirmsWrite: (winner) =>
              updates.title === undefined || winner.title === updates.title,
            persist: (nextContent, contentBase) =>
              persistDocumentUpdates(
                { ...updates, content: nextContent },
                { ...options, contentBase },
              ),
          });
        } finally {
          activeContentSavesRef.current -= 1;
        }
        if (result.status === "conflict") {
          setDocumentReconcileConflict({
            localDraft: result.localDraft,
          });
          return { contentPersisted: false };
        }
        saved = result.document;
        content = result.content;
        updates.content = content;
      } else {
        saved = await persistDocumentUpdates(updates, options);
      }
      if (isDocumentUpdateConflict(saved)) {
        // Local-file saves retain their own conflict flow. Never acknowledge
        // a rejected SQL write as saved or push it to Notion.
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
          documentSyncStatusQueryKey(documentId),
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
              documentSyncStatusQueryKey(documentId),
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
      isLocalFileDocument,
      persistDocumentUpdates,
      pushDocumentToNotion,
      queryClient,
    ],
  );
  const retainRecoveryDraft = useCallback(
    async (
      title: string,
      content: string,
      deferredReason: "conflict" | null,
    ) => {
      const current = recoveryDraftRef.current;
      const result = await updatePreviewDocumentDraftRef.current({
        operation: "upsert",
        documentId,
        expectedVersion: current?.version ?? null,
        draft: {
          title,
          content,
          baseDocumentUpdatedAt: lastSavedContentRef.current.updatedAt,
          loadedContentWasEmpty: isEffectivelyEmptyDocumentContent(
            lastSavedContentRef.current.content,
          ),
          deferredReason,
        },
      });
      if (
        result.status === "saved" &&
        result.draft?.title === title &&
        result.draft.content === content
      ) {
        recoveryDraftRef.current = {
          version: result.draft.version,
          title,
          content,
        };
        return;
      }
      if (
        result.status === "conflict" &&
        result.draft?.title === title &&
        result.draft.content === content
      ) {
        recoveryDraftRef.current = {
          version: result.draft.version,
          title,
          content,
        };
        return;
      }
      throw new Error(t("editor.pageSaveBeforeNavigationFailed"));
    },
    [documentId, t],
  );
  const clearRecoveryDraft = useCallback(
    async (persistedTitle: string, persistedContent: string) => {
      const current = recoveryDraftRef.current;
      if (
        !current ||
        !mayClearRecoveryDraft(current, {
          title: persistedTitle,
          content: persistedContent,
        })
      ) {
        return;
      }
      const result = await updatePreviewDocumentDraftRef.current({
        operation: "delete",
        documentId,
        expectedVersion: current.version,
        expectedTitle: current.title,
        expectedContent: current.content,
      });
      if (result.status !== "deleted") {
        throw new Error(t("editor.pageSaveBeforeNavigationFailed"));
      }
      recoveryDraftRef.current = null;
    },
    [documentId, t],
  );
  const queueDocumentSave = useCallback(
    (title: string, content: string, options: DocumentSaveOptions = {}) => {
      const contentEditVersion =
        options.contentEditVersion ?? contentEditVersionRef.current;
      return enqueueDocumentSave(documentSaveQueueRef, () =>
        savePageWithRecovery({
          save: () =>
            saveDocumentImmediately(title, content, {
              ...options,
              contentEditVersion,
            }),
          retain: (reason) => retainRecoveryDraft(title, content, reason),
          clear: () =>
            clearRecoveryDraft(
              lastSavedTitleRef.current.title,
              lastSavedContentRef.current.content,
            ),
        }),
      );
    },
    [clearRecoveryDraft, retainRecoveryDraft, saveDocumentImmediately],
  );
  const flushPendingDocumentSave = useCallback(
    (pending: PendingDocumentSave) => {
      if (!pending.canEditWhenQueued) return;
      void Promise.resolve(
        pending.save(pending.title, pending.content, {
          allowQueuedSave: true,
          historySessionId: pending.historySessionId,
          expectedLocalSourceRevision: pending.expectedLocalSourceRevision,
          contentEditVersion: pending.contentEditVersion,
        }),
      )
        .then((result) => {
          if (!result.contentPersisted) {
            setDocumentReconcileConflict(
              (current) =>
                current ?? {
                  localDraft:
                    contentEditVersionRef.current === pending.contentEditVersion
                      ? pending.content
                      : localContentRef.current,
                },
            );
          }
        })
        .catch(handleBackgroundSaveError);
    },
    [handleBackgroundSaveError],
  );
  const prepareHistoryRestore = useCallback(async (): Promise<string> => {
    if (
      suggestionBaseRef.current !== null ||
      !isHistoryRestoreReady(
        Boolean(currentDocumentRef.current.database),
        editorHistoryControllerRef.current,
        editorHistoryControllerDocumentIdRef.current,
        documentId,
      )
    ) {
      throw new Error(t("editor.historySaveBeforeRestoreFailed"));
    }
    const title = localTitleRef.current;
    const content = localContentRef.current;
    const pending = pendingDocumentSaveRef.current;
    if (pending) {
      clearTimeout(pending.timeout);
      pendingDocumentSaveRef.current = null;
      saveTimeoutRef.current = null;
    }
    const saved = await queueDocumentSave(title, content, {
      historySessionId: pending?.historySessionId,
    });
    if (
      !saved.contentPersisted ||
      localTitleRef.current !== title ||
      localContentRef.current !== content ||
      localTitleRef.current !== lastSavedTitleRef.current.title
    ) {
      throw new Error(t("editor.historySaveBeforeRestoreFailed"));
    }
    const current = await callAction(
      "get-document",
      { id: documentId },
      { method: "GET" },
    );
    if (
      !current?.updatedAt ||
      current.title !== lastSavedTitleRef.current.title ||
      current.content !== lastSavedContentRef.current.content
    ) {
      throw new Error(t("editor.historySaveBeforeRestoreFailed"));
    }
    return current.updatedAt;
  }, [documentId, queueDocumentSave, t]);
  const historyRestoreReady =
    !isSuggesting &&
    isHistoryRestoreReady(
      Boolean(document.database),
      editorHistoryControllerRef.current,
      editorHistoryControllerDocumentIdRef.current,
      documentId,
    );
  const handleHistoryRestored = useCallback((restored: Document) => {
    if (restored.id !== activeDocumentIdRef.current) {
      return { status: "committed-editor-refresh-required" } as const;
    }
    acknowledgedDocumentRef.current = {
      ...currentDocumentRef.current,
      ...restored,
    };
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    pendingDocumentSaveRef.current = null;
    const editorApplied = applyHistoryToDocumentBody(
      Boolean(currentDocumentRef.current.database),
      editorHistoryControllerRef.current,
      restored,
    );
    localTitleRef.current = restored.title;
    localContentRef.current = restored.content;
    documentUpdatedAtRef.current = restored.updatedAt ?? null;
    setLocalTitle(restored.title);
    setLocalContent(restored.content);
    setLocalContentUpdatedAt(restored.updatedAt ?? null);
    lastSavedTitleRef.current = {
      title: restored.title,
      updatedAt: restored.updatedAt ?? null,
    };
    lastSavedContentRef.current = {
      content: restored.content,
      updatedAt: restored.updatedAt ?? null,
    };
    historySessionRef.current.reset();
    return editorApplied
      ? ({ status: "applied" } as const)
      : ({ status: "committed-editor-refresh-required" } as const);
  }, []);
  useEffect(() => {
    if (!historyRestoreReady) return;
    return registerDocumentHistoryRestoreController(documentId, {
      prepareRestore: prepareHistoryRestore,
      applyRestore: handleHistoryRestored,
    });
  }, [
    documentId,
    handleHistoryRestored,
    historyRestoreReady,
    prepareHistoryRestore,
  ]);

  const debouncedSave = useCallback(
    (title: string, content: string) => {
      if (!canEditRef.current) return;
      const expectedLocalSourceRevision = isLinkedLocalSourceDocument
        ? localSourceRevisionForQueuedEdit(
            pendingDocumentSaveRef.current?.expectedLocalSourceRevision,
            localSourceRevisionRef.current,
          )
        : undefined;
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      const pending: PendingDocumentSave = {
        historySessionId: historySessionRef.current.activity(documentId),
        title,
        content,
        save: queueDocumentSave,
        canEditWhenQueued: canEditRef.current,
        contentEditVersion: contentEditVersionRef.current,
        expectedLocalSourceRevision,
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
    [flushPendingDocumentSave, isLinkedLocalSourceDocument, queueDocumentSave],
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
        const loadedContentWasEmpty =
          updates.content !== undefined
            ? isEffectivelyEmptyDocumentContent(
                lastSavedContentRef.current.content,
              )
            : undefined;
        const loadedUpdatedAt =
          updates.content !== undefined
            ? (lastSavedContentRef.current.updatedAt ?? undefined)
            : undefined;
        const body = JSON.stringify({
          id: documentId,
          historySessionId: pending.historySessionId,
          ...updates,
          ...(loadedContentWasEmpty !== undefined
            ? { loadedContentWasEmpty }
            : {}),
          ...(loadedUpdatedAt !== undefined ? { loadedUpdatedAt } : {}),
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
  const flushRequestInFlightRef = useRef(new Set<string>());
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
            propertyId?: string;
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
            const requestIdentity =
              pending.requestId ??
              `${pending.id ?? documentId}:${pending.ts ?? 0}`;
            if (flushRequestInFlightRef.current.has(requestIdentity)) return;
            flushRequestInFlightRef.current.add(requestIdentity);
            const title = localTitleRef.current;
            const content = localContentRef.current;
            const updates: Record<string, string> = {};
            if (title !== lastSavedTitleRef.current.title)
              updates.title = title;
            if (content !== lastSavedContentRef.current.content) {
              updates.content = content;
            }
            try {
              if (pending.propertyId) {
                await flushBlockFieldSaveController(
                  documentId,
                  pending.propertyId,
                );
              } else if (Object.keys(updates).length > 0) {
                const saved = await persistDocumentUpdatesRef.current(updates);
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
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json",
                  "X-Agent-Native-CSRF": "1",
                },
                body: JSON.stringify({
                  expected: pending,
                  next: {
                    id: pending.id ?? documentId,
                    ts: pending.ts ?? Date.now(),
                    requestId: pending.requestId,
                    status: "success",
                  },
                }),
              }).catch(() => {});
            } catch (error) {
              // Keep a durable negative acknowledgement so the requesting
              // Notion action can fail closed instead of timing out and using a
              // stale documents row. The server clears this after reading it.
              await fetch(flushPath, {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json",
                  "X-Agent-Native-CSRF": "1",
                },
                body: JSON.stringify({
                  expected: pending,
                  next: {
                    id: pending.id ?? documentId,
                    ts: pending.ts ?? Date.now(),
                    requestId: pending.requestId,
                    status: "error",
                    error:
                      error instanceof Error
                        ? error.message
                        : t("editor.liveDocumentSaveBeforeSyncFailed"),
                  },
                }),
              }).catch(() => {});
            } finally {
              flushRequestInFlightRef.current.delete(requestIdentity);
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
    t,
  ]);

  const handleTitleChange = useCallback(
    (newTitle: string) => {
      if (!documentCanonicalMutationsEnabled(editorCanEdit, isSuggesting))
        return;
      localTitleRef.current = newTitle;
      setLocalTitle(newTitle);
      patchDocumentCaches(queryClient, documentId, { title: newTitle });
      debouncedSave(newTitle, localContentRef.current);
    },
    [debouncedSave, documentId, editorCanEdit, isSuggesting, queryClient],
  );

  const handleContentChange = useCallback(
    (newContent: string) => {
      if (!editorCanEdit) return;
      contentEditVersionRef.current += 1;
      localContentRef.current = newContent;
      setLocalContent(newContent);
      if (documentReconcileConflict) {
        setDocumentReconcileConflict({ localDraft: newContent });
        return;
      }
      debouncedSave(localTitleRef.current, newContent);
    },
    [debouncedSave, documentReconcileConflict, editorCanEdit],
  );

  const savedSuggestions = useMemo(() => {
    return freshestSavedSuggestions(
      locallyCreatedSuggestions,
      suggestionsQuery.data?.suggestions ?? [],
    );
  }, [locallyCreatedSuggestions, suggestionsQuery.data?.suggestions]);
  const amendmentTargetIsResolved = suggestionAmendmentTargetIsResolved(
    editingSuggestionId,
    savedSuggestions,
  );
  const amendmentDraftIsDirty = Boolean(
    suggestionBaseRef.current?.existingSuggestion &&
    suggestionDraft !== suggestionBaseRef.current.initialContent,
  );

  useEffect(() => {
    if (!isSuggesting || !amendmentDraftIsDirty || !amendmentTargetIsResolved)
      return;
    setSuggestionAmendmentConflict(true);
    void queryClient.invalidateQueries(documentQueryFilter(documentId));
  }, [
    amendmentDraftIsDirty,
    amendmentTargetIsResolved,
    documentId,
    isSuggesting,
    queryClient,
  ]);

  const adoptConfirmedSuggestions = useCallback(() => {
    const confirmed = [...createdSuggestionOperationsRef.current.values()]
      .map((entry) => entry.suggestion as ResourceSuggestion | undefined)
      .filter((suggestion): suggestion is ResourceSuggestion => !!suggestion);
    if (confirmed.length > 0) {
      setLocallyCreatedSuggestions((current) => {
        const byId = new Map(
          current.map((suggestion) => [suggestion.id, suggestion]),
        );
        for (const suggestion of confirmed) byId.set(suggestion.id, suggestion);
        return [...byId.values()];
      });
    }
    setSuggestionPersistenceRevision((revision) => revision + 1);
  }, []);

  const flushSuggestionDraft = useCallback(async () => {
    if (!isSuggesting) return null;
    if (isSubmittingSuggestions) return null;
    const base = suggestionBaseRef.current;
    if (!base) return null;
    if (base.existingSuggestion && suggestionDraft === base.initialContent) {
      setIsSuggesting(false);
      suggestionBaseRef.current = null;
      setEditingSuggestionId(null);
      setSuggestionInitialSelection(null);
      setSuggestionAmendmentConflict(false);
      suggestionAmendmentKeysRef.current.clear();
      return new Map<string, ResourceSuggestion>();
    }
    if (
      base.existingSuggestion &&
      (suggestionAmendmentConflict || amendmentTargetIsResolved)
    ) {
      setSuggestionAmendmentConflict(true);
      return null;
    }
    if (suggestionDraft === base.baseContent) {
      if (base.existingSuggestion) {
        toast.error(t("editor.suggestionAmendmentEmpty"));
        return null;
      }
      setIsSuggesting(false);
      suggestionBaseRef.current = null;
      setEditingSuggestionId(null);
      setSuggestionInitialSelection(null);
      setSuggestionAmendmentConflict(false);
      createdSuggestionOperationsRef.current.clear();
      return new Map<string, ResourceSuggestion>();
    }
    setIsSubmittingSuggestions(true);
    try {
      const operations = suggestionDraftOperations(base, suggestionDraft);
      if (operations.length === 0) {
        if (base.existingSuggestion) {
          toast.error(t("editor.suggestionAmendmentEmpty"));
          return null;
        }
        setIsSuggesting(false);
        suggestionBaseRef.current = null;
        setEditingSuggestionId(null);
        setSuggestionInitialSelection(null);
        setSuggestionAmendmentConflict(false);
        return new Map<string, ResourceSuggestion>();
      }
      let persisted: Map<string, ResourceSuggestion>;
      if (base.existingSuggestion) {
        const operationKey = JSON.stringify(operations);
        const idempotencyKey =
          suggestionAmendmentKeysRef.current.get(operationKey) ??
          globalThis.crypto.randomUUID();
        suggestionAmendmentKeysRef.current.set(operationKey, idempotencyKey);
        const amended = await updateSuggestion.mutateAsync({
          id: base.existingSuggestion.id,
          observedRevision: base.existingSuggestion.revision,
          idempotencyKey,
          operations,
          summary: t("editor.toolbar.suggestEdits"),
        });
        setLocallyCreatedSuggestions((current) => {
          const byId = new Map(
            current.map((suggestion) => [suggestion.id, suggestion]),
          );
          byId.set(amended.id, amended);
          return [...byId.values()];
        });
        setSuggestionPersistenceRevision((revision) => revision + 1);
        persisted = new Map([
          [suggestionOperationKey(operations[0]!), amended],
        ]);
      } else {
        persisted = await persistSuggestionDraftOperations(
          operations,
          createdSuggestionOperationsRef.current,
          (operation, idempotencyKey) =>
            createSuggestion.mutateAsync({
              resourceType: "document",
              resourceId: documentId,
              adapterKind: "content.document-markdown",
              baseRevision: base.baseRevision,
              summary: t("editor.toolbar.suggestEdits"),
              idempotencyKey,
              operations: [operation],
            }),
        );
        adoptConfirmedSuggestions();
      }
      setIsSuggesting(false);
      suggestionBaseRef.current = null;
      setEditingSuggestionId(null);
      setSuggestionInitialSelection(null);
      setSuggestionAmendmentConflict(false);
      createdSuggestionOperationsRef.current.clear();
      suggestionAmendmentKeysRef.current.clear();
      return persisted;
    } catch (error) {
      adoptConfirmedSuggestions();
      if (error instanceof SuggestionFormattingMappingError) {
        toast.error(t("editor.suggestionFormattingUnsupported"));
        return null;
      }
      if (base.existingSuggestion && isSuggestionConflictActionError(error)) {
        setSuggestionAmendmentConflict(true);
        void suggestionsQuery.refetch();
        void queryClient.invalidateQueries(documentQueryFilter(documentId));
        return null;
      }
      toast.error(
        t(
          base.existingSuggestion
            ? "editor.suggestionAmendmentFailed"
            : "editor.suggestionCreateFailed",
        ),
        {
          description: actionErrorMessage(error) ?? t("empty.genericError"),
        },
      );
      return null;
    } finally {
      setIsSubmittingSuggestions(false);
    }
  }, [
    createSuggestion,
    updateSuggestion,
    adoptConfirmedSuggestions,
    documentId,
    isSuggesting,
    isSubmittingSuggestions,
    amendmentTargetIsResolved,
    queryClient,
    suggestionAmendmentConflict,
    suggestionDraft,
    suggestionsQuery,
    t,
  ]);

  const startSuggestionDraft = useCallback(
    (suggestion?: ResourceSuggestion) => {
      if (!canSuggest || isSuggesting) return false;
      try {
        suggestionMarkedSourceRanges(document.content);
      } catch (error) {
        if (!(error instanceof SuggestionFormattingMappingError)) throw error;
        toast.error(t("editor.suggestionFormattingBaselineUnsupported"));
        return false;
      }
      const existing = suggestion
        ? editableSuggestionDraft({
            suggestion,
            currentUserEmail: session?.email,
            canonicalContent: document.content,
            canonicalRevision: canonicalSuggestionRevision(
              document,
              suggestion,
            ),
          })
        : null;
      if (suggestion && !existing) return false;
      createdSuggestionOperationsRef.current.clear();
      suggestionAmendmentKeysRef.current.clear();
      setSuggestionAmendmentConflict(false);
      suggestionBaseRef.current =
        existing?.session ??
        createSuggestionDraftSession({
          id: globalThis.crypto.randomUUID(),
          baseContent: document.content,
          baseRevision: canonicalSuggestionRevision(document),
          startedAt: new Date().toISOString(),
        });
      setSuggestionDraft(existing?.content ?? document.content);
      setSuggestionInitialSelection(existing?.caret ?? null);
      setEditingSuggestionId(existing?.session.existingSuggestion?.id ?? null);
      if (existing) setSelectedSuggestionId(null);
      setIsSuggesting(true);
      return true;
    },
    [
      canSuggest,
      document.content,
      document.revision,
      document.updatedAt,
      isSuggesting,
      session?.email,
      t,
    ],
  );

  const handleSuggestionModeChange = useCallback(
    async (next: boolean) => {
      if (next) {
        const selected = savedSuggestions.find(
          (suggestion) => suggestion.id === selectedSuggestionId,
        );
        if (!selected || !startSuggestionDraft(selected)) {
          startSuggestionDraft();
        }
        return;
      }
      await flushSuggestionDraft();
    },
    [
      flushSuggestionDraft,
      savedSuggestions,
      selectedSuggestionId,
      startSuggestionDraft,
    ],
  );

  const handleSuggestionReplacementIntent = useCallback(
    (intent: {
      beforeText: string;
      startOffset: number;
      beforeMarkdown: string;
    }) => {
      const session = suggestionBaseRef.current;
      if (!session) return;
      if (
        previewSuggestionDraft(session, intent.beforeMarkdown, null).status !==
        "ready"
      )
        return;
      if (
        recordSuggestionReplacementIntent(
          session,
          intent,
          intent.beforeMarkdown,
        )
      ) {
        setSuggestionPersistenceRevision((revision) => revision + 1);
      }
    },
    [],
  );

  useEffect(() => {
    if (!canSuggest && isSuggesting) setIsSuggesting(false);
  }, [canSuggest, isSuggesting]);

  useEffect(() => {
    setLocallyCreatedSuggestions([]);
    setEditingSuggestionId(null);
    setSuggestionInitialSelection(null);
    setSuggestionAmendmentConflict(false);
  }, [documentId]);

  const discardConflictedSuggestionDraft = useCallback(() => {
    setIsSuggesting(false);
    setSuggestionDraft(document.content);
    suggestionBaseRef.current = null;
    setEditingSuggestionId(null);
    setSuggestionInitialSelection(null);
    createdSuggestionOperationsRef.current.clear();
    suggestionAmendmentKeysRef.current.clear();
    setSuggestionAmendmentConflict(false);
  }, [document.content]);

  const suggestionDraftPreview = useMemo(() => {
    const draftSession = suggestionBaseRef.current;
    return isSuggesting && draftSession
      ? previewSuggestionDraft(
          draftSession,
          suggestionDraft,
          session?.email ?? null,
        )
      : { status: "ready" as const, suggestions: [] as DraftSuggestion[] };
  }, [
    isSuggesting,
    session?.email,
    suggestionDraft,
    suggestionPersistenceRevision,
  ]);
  const sessionDraftSuggestions =
    suggestionDraftPreview.status === "ready"
      ? suggestionDraftPreview.suggestions
      : [];
  const draftSuggestions = useMemo(() => {
    if (suggestionBaseRef.current?.existingSuggestion) return [];
    return unpersistedDraftSuggestions(
      sessionDraftSuggestions,
      createdSuggestionOperationsRef.current,
    );
  }, [sessionDraftSuggestions, suggestionPersistenceRevision]);

  const visualSuggestions = useMemo<VisualEditorSuggestion[]>(() => {
    const currentMarkdown = isSuggesting ? suggestionDraft : document.content;
    const byId = new Map<string, VisualEditorSuggestion>();
    for (const suggestion of savedSuggestions) {
      if (suggestion.id === editingSuggestionId) continue;
      const presentation = suggestionPresentation(suggestion, currentMarkdown);
      if (presentation) byId.set(presentation.id, presentation);
    }
    for (const suggestion of suggestionSessionVisuals(
      sessionDraftSuggestions,
      createdSuggestionOperationsRef.current,
    )) {
      const operation = suggestion.operations[0]!;
      const before = operation.before as { changedText: string };
      const after = operation.after as {
        markdown: string;
        changedText: string;
      };
      const beforeMarkdown = (operation.before as { markdown: string })
        .markdown;
      const operationAnchor = operation.anchor as { from: number; to: number };
      byId.set(suggestion.id, {
        id: suggestion.id,
        kind: operation.kind as VisualEditorSuggestion["kind"],
        beforeText: before.changedText,
        afterText: after.changedText,
        beforePresentation: {
          source: beforeMarkdown,
          from: operationAnchor.from,
          to: operationAnchor.to,
        },
        afterPresentation: {
          source: after.markdown,
          from: operationAnchor.from,
          to: operationAnchor.from + after.changedText.length,
        },
        anchor: suggestion.anchor,
        presentation: "draft" as const,
      });
    }
    return [...byId.values()];
  }, [
    document.content,
    editingSuggestionId,
    isSuggesting,
    savedSuggestions,
    sessionDraftSuggestions,
    suggestionPersistenceRevision,
    suggestionDraft,
  ]);
  const sidebarSuggestions = useMemo(() => {
    if (!editingSuggestionId || sessionDraftSuggestions.length !== 1) {
      return savedSuggestions;
    }
    return savedSuggestions.map((suggestion) =>
      suggestion.id === editingSuggestionId
        ? { ...suggestion, operations: sessionDraftSuggestions[0]!.operations }
        : suggestion,
    );
  }, [editingSuggestionId, savedSuggestions, sessionDraftSuggestions]);

  useEffect(() => {
    void setClientAppState(
      "content-suggestion-mode",
      {
        documentId,
        suggesting: isSuggesting,
        draftChanged: isSuggesting && suggestionDraft !== document.content,
        pendingCount: savedSuggestions.filter(
          (suggestion) => suggestion.status === "pending",
        ).length,
      },
      { requestSource: "content-editor" },
    ).catch(() => {
      // Suggesting remains usable when best-effort agent context sync fails.
    });
  }, [
    document.content,
    documentId,
    isSuggesting,
    suggestionDraft,
    savedSuggestions,
  ]);

  const handleContentSaveNow = useCallback(
    async (newContent: string, adoptCurrentServerBase = false) => {
      if (!editorCanEdit) return false;
      contentEditVersionRef.current += 1;
      const contentEditVersion = contentEditVersionRef.current;
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
        pendingDocumentSaveRef.current = null;
      }
      localContentRef.current = newContent;
      setLocalContent(newContent);
      const result = await queueDocumentSave(
        localTitleRef.current,
        newContent,
        {
          adoptCurrentServerBase,
        },
      );
      if (!result.contentPersisted) {
        setDocumentReconcileConflict(
          (current) =>
            current ?? {
              localDraft:
                contentEditVersionRef.current === contentEditVersion
                  ? newContent
                  : localContentRef.current,
            },
        );
      } else if (contentEditVersionRef.current === contentEditVersion) {
        setDocumentReconcileConflict(null);
      }
      return result.contentPersisted;
    },
    [editorCanEdit, queueDocumentSave],
  );

  const handleBaseAwareReconcile = useCallback(
    (result: { status: "merged" | "conflict" | "failed"; content: string }) => {
      if (result.status === "merged") {
        void handleContentSaveNow(result.content, true);
        return;
      }
      setDocumentReconcileConflict({ localDraft: result.content });
    },
    [handleContentSaveNow],
  );

  const useDiskVersion = useCallback(() => {
    if (!localSourceConflict) return;
    const next = localSourceConflict.diskDocument;
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
      pendingDocumentSaveRef.current = null;
    }
    localSourceRevisionRef.current = localSourceConflict.diskRevision;
    localTitleRef.current = next.title;
    localContentRef.current = next.content;
    setLocalTitle(next.title);
    setLocalContent(next.content);
    setLocalContentUpdatedAt(next.updatedAt ?? new Date().toISOString());
    lastSavedTitleRef.current = {
      title: next.title,
      updatedAt: next.updatedAt ?? null,
    };
    lastSavedContentRef.current = {
      content: next.content,
      updatedAt: next.updatedAt ?? null,
    };
    setLocalFileSyncRevision((revision) => revision + 1);
    setLocalSourceConflict(null);
  }, [localSourceConflict]);

  // Comments state — pending comment from text selection
  const {
    pendingComment,
    setPendingComment,
    changePendingComment,
    completePendingComment,
  } = usePendingCommentDraft(documentId);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [hoveredThreadId, setHoveredThreadId] = useState<string | null>(null);
  const [utilityPanelSheetContainer, setUtilityPanelSheetContainer] =
    useState<HTMLElement | null>(null);
  const activeThreadId = hoveredThreadId ?? selectedThreadId;
  const replyDrafts = useCommentReplyDrafts(documentId, session?.email);
  const [pendingCommentTargetValid, setPendingCommentTargetValid] =
    useState(true);
  useLayoutEffect(() => {
    if (!pendingComment) {
      setPendingCommentTargetValid(true);
      return;
    }
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      setPendingCommentTargetValid(false);
      return;
    }

    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const marked = scrollContainer.querySelectorAll(
          ".comment-highlight--pending",
        );
        setPendingCommentTargetValid(
          pendingCommentTargetMatches(marked, pendingComment.quotedText),
        );
      });
    };
    setPendingCommentTargetValid(false);
    update();
    const observer = new MutationObserver(update);
    observer.observe(scrollContainer, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [pendingComment]);
  const [focusSuggestionId, setFocusSuggestionId] = useState<string | null>(
    null,
  );
  const appliedSuggestionLinkRef = useRef<string | null>(null);
  const { data: threads, isLoading: commentsLoading } = useComments(
    !isLocalFileDocument ? documentId : null,
  );
  const documentLayoutRef = useRef<HTMLDivElement>(null);
  const commentLaneRef = useRef<HTMLElement>(null);
  const anchoredCommentRef = useRef<HTMLElement>(null);
  const [anchoredCommentPosition, setAnchoredCommentPosition] = useState<{
    left: number;
    top: number;
    width: number;
    placement: "above" | "below";
  } | null>(null);
  const [commentLaneOffset, setCommentLaneOffset] = useState(0);
  const hasUtilityRailSpace = useElementMinWidth(documentLayoutRef, 960);
  const hasInlineCommentSpace = useElementMinWidth(documentLayoutRef, 1088);
  const showCommentsHistoryDrawer =
    utilityPanel === "comments" && commentsBrowseOpen;
  const showDesktopCommentsHistory =
    showCommentsHistoryDrawer && hasUtilityRailSpace;
  const hasOpenCommentThreads =
    threads?.some((thread) => !thread.resolved) ?? false;
  const hasOpenSuggestions =
    savedSuggestions.some((suggestion) => suggestion.status === "pending") ||
    draftSuggestions.length > 0;
  const hasSelectedCommentThread =
    !!selectedThreadId &&
    (threads?.some((thread) => thread.threadId === selectedThreadId) ?? false);
  const showInlineComments = documentEditorShowsInlineComments({
    showIndicators: showCommentIndicators,
    hasUtilityRailSpace: hasInlineCommentSpace,
    commentsHistoryDrawerOpen: showCommentsHistoryDrawer,
    utilityPanel,
    hasOpenCommentThreads: hasOpenCommentThreads || hasOpenSuggestions,
    hasSelectedCommentThread,
    hasPendingComment: !!pendingComment,
  });
  const showDesktopInfoPanel = utilityPanel === "info" && hasUtilityRailSpace;
  const showDesktopRightRail = showInlineComments || showDesktopInfoPanel;
  const showAnchoredCommentPopover =
    !showCommentsHistoryDrawer &&
    utilityPanel === "comments" &&
    !hasInlineCommentSpace &&
    (!!pendingComment || !!selectedThreadId);
  const showUtilityPanelSheet =
    (showCommentsHistoryDrawer && !showDesktopCommentsHistory) ||
    (utilityPanel === "comments" &&
      !hasInlineCommentSpace &&
      !!selectedSuggestionId) ||
    (utilityPanel === "info" && !showDesktopInfoPanel);
  const hasFocusedCommentReply =
    replyDrafts.focus.current?.documentId === documentId;

  useLayoutEffect(() => {
    if (!pendingComment) {
      setPendingCommentTargetValid(true);
      return;
    }
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      setPendingCommentTargetValid(false);
      return;
    }

    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const marked = scrollContainer.querySelectorAll(
          ".comment-highlight--pending",
        );
        setPendingCommentTargetValid(
          pendingCommentTargetMatches(marked, pendingComment.quotedText),
        );
      });
    };
    setPendingCommentTargetValid(false);
    update();
    const observer = new MutationObserver(update);
    observer.observe(scrollContainer, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [pendingComment]);

  useEffect(() => {
    if (utilityPanel) setLastUtilityPanel(utilityPanel);
  }, [utilityPanel]);

  useEffect(() => {
    if (showDesktopCommentsHistory) setCommentsHistoryRailMounted(true);
  }, [showDesktopCommentsHistory]);

  useLayoutEffect(() => {
    if (!showInlineComments) {
      setCommentLaneOffset(0);
      return;
    }
    const lane = commentLaneRef.current;
    const container = scrollContainerRef.current;
    if (!lane || !container) return;
    return observeCommentLane(container, lane, setCommentLaneOffset);
  }, [documentId, showInlineComments]);

  const handleComment = useCallback(
    (
      quotedText: string,
      offsetTop: number,
      anchor?: CommentTextAnchor,
      range?: { from: number; to: number },
    ) => {
      setPendingComment({ quotedText, offsetTop, anchor, range });
      setCommentsBrowseOpen(false);
      setUtilityPanel("comments");
      setSelectedThreadId(null);
      setHoveredThreadId(null);
    },
    [],
  );

  const clearCommentFocus = useCallback(() => {
    setSelectedThreadId(null);
    setHoveredThreadId(null);
    setSelectedSuggestionId(null);
    setHoveredSuggestionId(null);
  }, []);

  const dismissCommentFocus = useCallback(() => {
    replyDrafts.setOpenReply(null);
    clearCommentFocus();
    if (!hasInlineCommentSpace) {
      setCommentsBrowseOpen(false);
      setUtilityPanel(utilityPanelAfterCommentFocusDismissal);
    }
  }, [clearCommentFocus, hasInlineCommentSpace, replyDrafts.setOpenReply]);

  const handleEditorEscape = useCallback(() => {
    dismissCommentFocus();
    editorEscapeTargetRef.current?.focus({ preventScroll: true });
  }, [dismissCommentFocus]);

  const activateCommentThread = useCallback(
    (threadId: string, preserveBrowseContext = false) => {
      setSelectedSuggestionId(null);
      setPendingComment(null);
      setHoveredThreadId(null);
      setSelectedThreadId(threadId);
      setCommentsBrowseOpen(preserveBrowseContext);
      setUtilityPanel("comments");
    },
    [],
  );

  const activateSuggestion = useCallback((suggestionId: string) => {
    setPendingComment(null);
    setHoveredThreadId(null);
    setSelectedThreadId(null);
    setSelectedSuggestionId(suggestionId);
    setCommentsBrowseOpen(false);
    setUtilityPanel("comments");
    requestAnimationFrame(() => {
      const escaped = globalThis.CSS?.escape
        ? globalThis.CSS.escape(suggestionId)
        : suggestionId.replace(/["\\]/g, "\\$&");
      const targets = globalThis.document.querySelectorAll<HTMLElement>(
        `[data-suggestion-id="${escaped}"]`,
      );
      const pageTarget = Array.from(targets).find((target) =>
        target.closest(".notion-editor"),
      );
      if (pageTarget) {
        const rect = pageTarget.getBoundingClientRect();
        const viewport = scrollContainerRef.current?.getBoundingClientRect();
        if (
          viewport &&
          (rect.top < viewport.top || rect.bottom > viewport.bottom)
        ) {
          pageTarget.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }
    });
  }, []);

  const activateInlineSuggestion = useCallback(
    (suggestionId: string) => {
      if (
        isSuggesting &&
        suggestionBaseRef.current?.existingSuggestion?.id === suggestionId
      ) {
        return;
      }
      const suggestion = savedSuggestions.find(
        (candidate) => candidate.id === suggestionId,
      );
      if (suggestion && startSuggestionDraft(suggestion)) {
        setPendingComment(null);
        setHoveredThreadId(null);
        setSelectedThreadId(null);
        setSelectedSuggestionId(null);
        setHoveredSuggestionId(null);
        return;
      }
      activateSuggestion(suggestionId);
    },
    [activateSuggestion, isSuggesting, savedSuggestions, startSuggestionDraft],
  );

  const handleUtilityPanelChange = useCallback(
    (nextPanel: DocumentUtilityPanel) => {
      if (!nextPanel) replyDrafts.setOpenReply(null);
      setUtilityPanel(nextPanel);
      if (nextPanel === "comments") {
        setCommentsBrowseOpen(true);
        clearCommentFocus();
      } else {
        setCommentsBrowseOpen(false);
        clearCommentFocus();
      }
    },
    [clearCommentFocus, replyDrafts.setOpenReply],
  );

  useEffect(() => {
    setPendingComment(null);
    setCommentsBrowseOpen(false);
    setUtilityPanel(null);
    clearCommentFocus();
    setSelectedSuggestionId(null);
  }, [clearCommentFocus, documentId]);

  useEffect(() => {
    const suggestionId = new URLSearchParams(location.search).get("suggestion");
    const key = `${documentId}:${location.key}:${location.search}`;
    if (!suggestionId) {
      appliedSuggestionLinkRef.current = null;
      return;
    }
    if (!suggestionsQuery.data || appliedSuggestionLinkRef.current === key)
      return;
    appliedSuggestionLinkRef.current = key;
    const suggestion = suggestionsQuery.data.suggestions.find(
      (entry) => entry.id === suggestionId,
    );
    if (!suggestion) {
      toast.error(t("comments.linkUnavailable"));
      return;
    }
    clearCommentFocus();
    setPendingComment(null);
    setSelectedSuggestionId(suggestion.id);
    setUtilityPanel("comments");
    setCommentsBrowseOpen(true);
    replyDrafts.setOpenReply(suggestion.threadId, suggestion.id, false);
    setFocusSuggestionId(suggestion.id);
  }, [
    documentId,
    location.key,
    location.search,
    suggestionsQuery.data,
    clearCommentFocus,
    replyDrafts.setOpenReply,
    t,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const path = event.composedPath();
      const pathOwner = path.find(
        (node) => node instanceof HTMLElement && node.dataset.pageEditorOwner,
      );
      const activeElement = window.document.activeElement;
      const activeOwner =
        activeElement instanceof HTMLElement
          ? activeElement.closest<HTMLElement>("[data-page-editor-owner]")
          : null;
      const eventOwner =
        pathOwner instanceof HTMLElement ? pathOwner : activeOwner;
      const ownsEvent = eventOwner?.dataset.pageEditorOwner === pageEditorOwner;
      if (ownsEvent) dismissCommentFocus();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dismissCommentFocus, pageEditorOwner]);

  useEffect(() => {
    if (!showAnchoredCommentPopover) {
      setAnchoredCommentPosition(null);
      return;
    }
    const scrollContainer = scrollContainerRef.current;
    const scrollContent = scrollContainer?.querySelector(
      "[data-document-scroll-content]",
    ) as HTMLElement | null;
    if (!scrollContainer || !scrollContent) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const escapedThreadId = selectedThreadId
          ? globalThis.CSS?.escape
            ? globalThis.CSS.escape(selectedThreadId)
            : selectedThreadId.replace(/["\\]/g, "\\$&")
          : null;
        const escapedSuggestionId = selectedSuggestionId
          ? globalThis.CSS?.escape
            ? globalThis.CSS.escape(selectedSuggestionId)
            : selectedSuggestionId.replace(/["\\]/g, "\\$&")
          : null;
        const marked = scrollContainer.querySelector(
          escapedThreadId
            ? `[data-comment-thread="${escapedThreadId}"]`
            : escapedSuggestionId
              ? `[data-suggestion-id="${escapedSuggestionId}"]`
              : ".comment-highlight--pending",
        ) as HTMLElement | null;
        if (!marked) {
          setAnchoredCommentPosition(
            positionUnanchoredCommentCard({
              containerRect: scrollContent.getBoundingClientRect(),
              boundaryRect: scrollContainer.getBoundingClientRect(),
            }),
          );
          return;
        }
        const paragraph = marked.closest(
          "p, li, blockquote, h1, h2, h3, h4, h5, h6",
        );
        const anchorRect = (paragraph ?? marked).getBoundingClientRect();
        const containerRect = scrollContent.getBoundingClientRect();
        const boundaryRect = scrollContainer.getBoundingClientRect();
        const cardHeight =
          anchoredCommentRef.current?.getBoundingClientRect().height ?? 180;
        setAnchoredCommentPosition(
          positionAnchoredCommentCard({
            anchorRect,
            containerRect,
            boundaryRect,
            cardHeight,
          }),
        );
      });
    };
    update();
    window.addEventListener("resize", update);
    scrollContainer.addEventListener("scroll", update, { passive: true });
    const mutationObserver = new MutationObserver(update);
    mutationObserver.observe(scrollContent, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-comment-thread", "data-suggestion-id", "class"],
    });
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    resizeObserver?.observe(scrollContent);
    if (anchoredCommentRef.current) {
      resizeObserver?.observe(anchoredCommentRef.current);
    }
    return () => {
      cancelAnimationFrame(frame);
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", update);
      scrollContainer.removeEventListener("scroll", update);
    };
  }, [
    selectedSuggestionId,
    selectedThreadId,
    showAnchoredCommentPopover,
    scrollContainerRef,
  ]);

  const focusTitleEnd = useCallback(() => {
    const textarea = titleInputRef.current;
    if (!textarea) return;
    textarea.focus();
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);
  }, []);

  const flushLatestPageEdits = useCallback(async () => {
    if (documentReconcileConflict || localSourceConflict) {
      throw new Error(t("editor.pageSaveBeforeNavigationFailed"));
    }
    if (isSuggesting && (await flushSuggestionDraft()) === null) {
      throw new Error(t("editor.pageSaveBeforeNavigationFailed"));
    }

    while (pendingPersistenceRef.current.size > 0) {
      await Promise.allSettled([...pendingPersistenceRef.current]);
    }

    const latestBodyPersisted =
      isSuggesting ||
      ((await editorPersistenceControllerRef.current?.flushLatest()) ?? true);
    if (!latestBodyPersisted) {
      throw new Error(t("editor.pageSaveBeforeNavigationFailed"));
    }

    const title = localTitleRef.current;
    const content = localContentRef.current;
    if (title === lastSavedTitleRef.current.title) {
      persistenceErrorsRef.current.delete("title");
    }
    if (content === lastSavedContentRef.current.content) {
      persistenceErrorsRef.current.delete("content");
    }
    const hasUnsavedPrimaryEdit =
      title !== lastSavedTitleRef.current.title ||
      content !== lastSavedContentRef.current.content;
    if (!canEditRef.current && hasUnsavedPrimaryEdit) {
      throw new Error(t("editor.pageSaveBeforeNavigationFailed"));
    }

    const pending = pendingDocumentSaveRef.current;
    if (pending) {
      clearTimeout(pending.timeout);
      saveTimeoutRef.current = null;
      pendingDocumentSaveRef.current = null;
    }

    const primarySave = canEditRef.current
      ? queueDocumentSave(title, content, {
          allowQueuedSave: true,
          expectedLocalSourceRevision:
            pending?.expectedLocalSourceRevision ??
            (isLinkedLocalSourceDocument
              ? localSourceRevisionRef.current
              : undefined),
        })
      : Promise.resolve<DocumentSaveResult>({ contentPersisted: true });
    const [primaryResult, blockFieldsResult, propertiesResult] =
      await Promise.allSettled([
        primarySave,
        flushAllBlockFieldSaveControllersForDocument(documentId),
        flushDocumentPropertyWrites(documentId),
      ]);

    if (primaryResult.status === "rejected") throw primaryResult.reason;
    if (!primaryResult.value.contentPersisted) {
      throw new Error(t("editor.pageSaveBeforeNavigationFailed"));
    }
    if (blockFieldsResult.status === "rejected") {
      throw blockFieldsResult.reason;
    }
    if (propertiesResult.status === "rejected") {
      throw propertiesResult.reason;
    }

    while (pendingPersistenceRef.current.size > 0) {
      await Promise.allSettled([...pendingPersistenceRef.current]);
    }
    const persistenceError = persistenceErrorsRef.current.values().next().value;
    if (persistenceError !== undefined) throw persistenceError;

    if (
      localTitleRef.current !== lastSavedTitleRef.current.title ||
      localContentRef.current !== lastSavedContentRef.current.content
    ) {
      throw new Error(t("editor.pageSaveBeforeNavigationFailed"));
    }
  }, [
    documentId,
    documentReconcileConflict,
    flushSuggestionDraft,
    isSuggesting,
    isLinkedLocalSourceDocument,
    localSourceConflict,
    queueDocumentSave,
    t,
  ]);

  const flushLatestPageEditsRef = useRef(flushLatestPageEdits);
  flushLatestPageEditsRef.current = flushLatestPageEdits;
  const focusTitleEndRef = useRef(focusTitleEnd);
  focusTitleEndRef.current = focusTitleEnd;
  const pageEditorSessionRef = useRef<PageEditorSession | null>(null);
  if (!pageEditorSessionRef.current) {
    pageEditorSessionRef.current = {
      flush: async () => {
        try {
          await flushLatestPageEditsRef.current();
        } catch {
          throw new Error(t("editor.pageSaveBeforeNavigationFailed"));
        }
      },
      focusTitle: () => focusTitleEndRef.current(),
    };
  }
  const onSessionChangeRef = useRef(onSessionChange);
  onSessionChangeRef.current = onSessionChange;
  useEffect(() => {
    const notify = onSessionChangeRef.current;
    const session = pageEditorSessionRef.current;
    if (!notify || !session) return;
    notify(session);
    return () => notify(null);
  }, []);

  const focusTitleHandledRef = useRef(false);
  useEffect(() => {
    if (!focusTitle || !editorCanEdit || focusTitleHandledRef.current) return;
    focusTitleHandledRef.current = true;
    requestAnimationFrame(focusTitleEnd);
  }, [editorCanEdit, focusTitle, focusTitleEnd]);

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
      if (!documentCanonicalMutationsEnabled(editorCanEdit, isSuggesting))
        return;

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
    [editorCanEdit, handleTitleChange, isSuggesting, localTitle],
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
        void navigate(`/page/${targetId}`, { flushSync: true });
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

  const renderCommentsSidebar = (
    visibleThreadId?: string | null,
    alignToAnchors = hasInlineCommentSpace,
    presentation: "inline" | "history" = "inline",
  ) => (
    <CommentsSidebar
      compact={!hasInlineCommentSpace}
      replyDrafts={replyDrafts}
      documentId={documentId}
      threads={threads ?? []}
      isLoading={commentsLoading}
      pendingComment={pendingComment}
      pendingTargetValid={pendingCommentTargetValid}
      onPendingChange={changePendingComment}
      onPendingDone={(id, threadId) => {
        if (!completePendingComment(id)) return;
        if (threadId) {
          setSelectedThreadId(threadId);
        } else if (!hasInlineCommentSpace) {
          setUtilityPanel(null);
        }
      }}
      scrollContainerRef={scrollContainerRef}
      activeThreadId={activeThreadId}
      selectedThreadId={selectedThreadId}
      onActivateThread={(threadId) =>
        activateCommentThread(threadId, presentation === "history")
      }
      activeSuggestionId={editingSuggestionId ?? selectedSuggestionId}
      focusSuggestionId={focusSuggestionId}
      onSuggestionFocused={() => setFocusSuggestionId(null)}
      hoveredSuggestionId={hoveredSuggestionId ?? editingSuggestionId}
      anchoredSuggestionIds={anchoredSuggestionIds}
      onActivateSuggestion={activateSuggestion}
      onSelectedThreadChange={setSelectedThreadId}
      onHoveredThreadChange={setHoveredThreadId}
      currentUserEmail={session?.email}
      canComment={canComment}
      canResolve={canEdit}
      alignToAnchors={alignToAnchors}
      forceVisible
      suggestions={sidebarSuggestions}
      draftSuggestions={draftSuggestions}
      onMaterializeDraft={async (draft) => {
        const persisted = await flushSuggestionDraft();
        if (!persisted) return null;
        const suggestion = persisted.get(
          suggestionOperationKey(draft.operations[0]!),
        );
        if (suggestion) setSelectedSuggestionId(suggestion.id);
        return suggestion ?? null;
      }}
      canDecideSuggestions={canEdit}
      decidingSuggestion={decideSuggestion.isPending}
      onDecideSuggestion={async (suggestion, decision) => {
        if (decideSuggestion.isPending || isSubmittingSuggestions) return;
        let observedSuggestion = suggestion;
        if (decision === "accepted" && suggestion.id === editingSuggestionId) {
          const persisted = await flushSuggestionDraft();
          if (!persisted) return;
          observedSuggestion = [...persisted.values()][0] ?? suggestion;
        }
        decideSuggestion.mutate(
          {
            id: observedSuggestion.id,
            decision,
            idempotencyKey: globalThis.crypto.randomUUID(),
            observedBase: observedSuggestion.baseRevision,
            observedRevision: observedSuggestion.revision,
          },
          {
            onSuccess: (result) => {
              if (
                result.suggestion.id === editingSuggestionId &&
                result.suggestion.status !== "pending"
              ) {
                setIsSuggesting(false);
                suggestionBaseRef.current = null;
                setEditingSuggestionId(null);
                setSuggestionInitialSelection(null);
                suggestionAmendmentKeysRef.current.clear();
              }
              if (result.suggestion.status !== "stale") return;
              toast.error(t("editor.toolbar.conflict"));
              setSelectedSuggestionId(result.suggestion.id);
              setUtilityPanel("comments");
              setCommentsBrowseOpen(true);
            },
            onError: (error) => {
              toast.error(t("empty.genericError"), {
                description: error.message,
              });
            },
          },
        );
      }}
      visibleThreadId={visibleThreadId}
      presentation={presentation}
    />
  );
  const defaultIconKind = documentEditorDefaultIconKind(document);
  const isDatabasePage = Boolean(document.database);
  const databaseChoicePending = isDatabaseChoicePending(
    document,
    createDatabase.isPending,
  );
  const showNewDocumentTypeChooser = shouldShowNewDocumentTypeChooser({
    canEdit,
    isLocalFileDocument,
    isDatabasePage,
    initiallyEligible:
      !document.databaseMembership &&
      newDocumentTypeChooserEligibilityRef.current.eligible,
    newDocumentTypeChosen,
    description: document.description,
    content: localContent,
  });
  const handleChoosePage = useCallback(() => {
    setNewDocumentTypeChosen(true);
    requestAnimationFrame(() => titleInputRef.current?.focus());
  }, []);
  const handleChooseDatabase = useCallback(async () => {
    try {
      await createDatabase.mutateAsync(
        databaseConversionRequest(documentId, localTitleRef.current),
      );
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
  const renderUtilityPanelContent = (
    panel: Exclude<DocumentUtilityPanel, null>,
    inSheet = false,
    popoverContainer?: HTMLElement | null,
  ) => {
    const utilityPanelTitle =
      panel === "info" ? t("editor.toolbar.info") : t("comments.title");
    return (
      <div
        className="w-full min-w-0 bg-background"
        data-document-utility-panel
        data-page-editor-owner={pageEditorOwner}
      >
        <div className="sticky top-0 z-10 flex h-12 items-center border-b border-border bg-background px-4">
          <h2
            className="text-sm font-semibold"
            aria-hidden={!hasUtilityRailSpace || undefined}
          >
            {utilityPanelTitle}
          </h2>
          {panel === "comments" ? (
            <button
              type="button"
              className="ms-auto flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-pressed={!showCommentIndicators}
              aria-label={t(
                showCommentIndicators
                  ? "comments.hideIndicators"
                  : "comments.showIndicators",
              )}
              onClick={() => setShowCommentIndicators((visible) => !visible)}
            >
              {showCommentIndicators ? (
                <IconEye size={16} />
              ) : (
                <IconEyeOff size={16} />
              )}
            </button>
          ) : null}
          {hasUtilityRailSpace || inSheet ? (
            <button
              type="button"
              className={cn(
                "flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                panel !== "comments" && "ms-auto",
              )}
              aria-label={t("editor.toolbar.closeUtilityPanel")}
              onClick={() => handleUtilityPanelChange(null)}
            >
              <IconX size={16} />
            </button>
          ) : null}
        </div>
        {panel === "info" ? (
          <DocumentInfoPanel
            document={document}
            documentContent={exportContent}
            additionalBlockContents={additionalBlockContents}
            databaseId={databaseId}
            databaseDocumentId={databaseDocumentId}
            canEdit={editorCanEdit}
            popoverContainer={popoverContainer}
            onSaveDescription={(description) =>
              persistDocumentUpdates({ description })
            }
          />
        ) : (
          renderCommentsSidebar(undefined, false, "history")
        )}
      </div>
    );
  };
  const utilityPanelContent = utilityPanel
    ? renderUtilityPanelContent(utilityPanel)
    : null;

  return (
    <BlockRegistryProvider
      registry={contentBlockRegistry}
      ctx={blockRenderContext}
    >
      {isLinkedLocalSourceDocument && editorCanEdit ? (
        <LinkedLocalDocumentAgentBridge
          document={document}
          getEditorSnapshot={getLinkedLocalEditorSnapshot}
          onPersisted={handleLinkedLocalAgentPersistence}
        />
      ) : null}
      <div
        ref={documentLayoutRef}
        className="relative flex min-h-0 min-w-0 flex-1"
        data-document-print-root
        data-page-editor-owner={pageEditorOwner}
        onClickCapture={(event) => {
          const target = event.target as HTMLElement | null;
          const commentHighlight = target?.closest("[data-comment-thread]");
          const threadId = commentHighlight?.getAttribute(
            "data-comment-thread",
          );
          if (threadId) {
            activateCommentThread(threadId);
            return;
          }
          if (
            target?.closest(
              "[data-comments-sidebar], [data-comments-history], [data-comment-menu], [data-document-utility-panel]",
            )
          ) {
            return;
          }
          dismissCommentFocus();
        }}
        onPointerOverCapture={(event) => {
          const target = event.target as HTMLElement | null;
          const threadId = target
            ?.closest("[data-comment-thread]")
            ?.getAttribute("data-comment-thread");
          if (threadId) setHoveredThreadId(threadId);
        }}
        onPointerOutCapture={(event) => {
          const target = event.target as HTMLElement | null;
          const highlight = target?.closest("[data-comment-thread]");
          if (!highlight) return;
          const nextHighlight = (event.relatedTarget as HTMLElement | null)
            ?.closest("[data-comment-thread]")
            ?.getAttribute("data-comment-thread");
          if (nextHighlight !== highlight.getAttribute("data-comment-thread")) {
            setHoveredThreadId(null);
          }
        }}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <DocumentToolbar
            compact={host === "preview"}
            documentId={documentId}
            documentTitle={exportTitle}
            documentContent={exportContent}
            databaseExportContext={databaseExportContext}
            breadcrumbItems={
              host === "page"
                ? toolbarBreadcrumbItems.map((item) =>
                    item.id === documentId
                      ? { ...item, title: exportTitle }
                      : item,
                  )
                : []
            }
            documentUpdatedAt={document.updatedAt}
            prepareHistoryRestore={prepareHistoryRestore}
            historyRestoreReady={
              historyRestoreReady &&
              (Boolean(document.database) || editorHistoryControllerReady)
            }
            onHistoryRestored={handleHistoryRestored}
            restoreUnavailableReason={
              isLinkedLocalSourceDocument
                ? t("editor.historyLinkedLocalRestoreUnavailable")
                : undefined
            }
            activeUsers={activeUsers}
            agentPresent={agentPresent}
            agentActive={agentActive}
            currentUserEmail={session?.email}
            canEdit={editorCanEdit}
            hideFromSearch={document.hideFromSearch}
            source={document.source}
            canDelete={canDelete}
            deletePending={
              deleteDocument.isPending || deleteContentDatabase.isPending
            }
            onDelete={handleDeleteDocument}
            isFavorite={document.isFavorite}
            onToggleFavorite={handleToggleFavorite}
            utilityPanel={utilityPanel}
            commentsHistoryOpen={showCommentsHistoryDrawer}
            onUtilityPanelChange={handleUtilityPanelChange}
            showCommentsControl={canComment && !isLocalFileDocument}
            onOpenBreadcrumbItem={
              host === "page" ? handleOpenToolbarBreadcrumb : undefined
            }
            canUndo={editorHistoryState.canUndo}
            canRedo={editorHistoryState.canRedo}
            onUndo={() => editorHistoryControllerRef.current?.undo()}
            onRedo={() => editorHistoryControllerRef.current?.redo()}
            canSuggest={canSuggest}
            suggesting={isSuggesting}
            editorEscapeTargetRef={editorEscapeTargetRef}
            onSuggestingChange={(next) => {
              void handleSuggestionModeChange(next);
            }}
          />

          {!isLocalFileDocument ? (
            <NotionConflictBanner documentId={documentId} canEdit={canEdit} />
          ) : null}

          {localSourceConflict ? (
            <div
              className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2 text-sm"
              role="alert"
              data-local-source-conflict
            >
              <span className="me-auto">
                {t("editor.localFileChangedWithUnsavedEdits")}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  void writeClipboardText(localSourceConflict.unsavedText).then(
                    (copied) => {
                      if (copied) {
                        toast.success(t("editor.unsavedTextCopied"));
                      } else {
                        toast.error(
                          t("editor.toolbar.clipboardAccessUnavailable"),
                        );
                      }
                    },
                  );
                }}
              >
                {t("editor.copyUnsavedText")}
              </Button>
              <Button type="button" size="sm" onClick={useDiskVersion}>
                {t("editor.useDiskVersion")}
              </Button>
            </div>
          ) : null}

          {documentReconcileConflict ? (
            <div
              className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2 text-sm"
              role="alert"
              data-document-reconcile-conflict
            >
              <span className="me-auto">{t("editor.toolbar.conflict")}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  void writeClipboardText(
                    documentReconcileConflict.localDraft,
                  ).then((copied) => {
                    if (copied) toast.success(t("editor.unsavedTextCopied"));
                    else
                      toast.error(
                        t("editor.toolbar.clipboardAccessUnavailable"),
                      );
                  });
                }}
              >
                {t("editor.copyUnsavedText")}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  const localDraft = documentReconcileConflict.localDraft;
                  void handleContentSaveNow(localDraft, true);
                }}
              >
                {t("editor.keepLocalDraft")}
              </Button>
            </div>
          ) : null}

          {isSuggesting &&
          amendmentDraftIsDirty &&
          suggestionAmendmentConflict ? (
            <div
              className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2 text-sm"
              role="alert"
              data-suggestion-amendment-conflict
            >
              <span className="me-auto">
                {t("editor.suggestionAmendmentResolved")}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  void writeClipboardText(suggestionDraft).then((copied) => {
                    if (copied) toast.success(t("editor.unsavedTextCopied"));
                    else
                      toast.error(
                        t("editor.toolbar.clipboardAccessUnavailable"),
                      );
                  });
                }}
              >
                {t("editor.copyUnsavedText")}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={discardConflictedSuggestionDraft}
              >
                {t("editor.discardSuggestionDraft")}
              </Button>
            </div>
          ) : null}

          {localSourceMissing ? (
            <div
              className="border-b bg-muted/40 px-4 py-2 text-sm"
              role="alert"
              data-local-source-missing
            >
              {t("empty.documentNotFound")}
            </div>
          ) : null}

          {isLocalFileDocument && localSourceAccess === "unavailable" ? (
            <div
              className="border-b bg-muted/20 px-4 py-1.5 text-xs text-muted-foreground"
              role="status"
              data-local-source-read-only
            >
              {t("editor.localFileReadOnlySnapshot", {
                device: "Agent-Native Desktop",
                date: new Date(
                  document.source?.updatedAt ?? document.updatedAt,
                ).toLocaleString(),
              })}
            </div>
          ) : null}

          <div
            ref={scrollContainerRef}
            className="flex-1 min-h-0 min-w-0 overflow-auto flex flex-col"
            data-document-print-scroll
            onKeyDownCapture={cancelPaddingScrollRestore}
            onPointerDownCapture={cancelPaddingScrollRestore}
            onWheelCapture={cancelPaddingScrollRestore}
          >
            <div
              className={cn(
                "relative flex min-h-full w-full min-w-0",
                showDesktopInfoPanel ? "justify-center" : "flex-col",
              )}
              data-document-scroll-content
            >
              <div
                className={cn(
                  "min-w-0",
                  showDesktopInfoPanel ? "flex-1" : "w-full",
                  showInlineComments && !isDatabasePage && "pr-80",
                )}
              >
                <div
                  className={documentEditorTitleRegionClassName(
                    Boolean(document.database),
                    host,
                  )}
                >
                  {document.icon || !isDatabasePage ? (
                    <div className="mb-1">
                      {documentCanonicalMutationsEnabled(
                        editorCanEdit,
                        isSuggesting,
                      ) ? (
                        <EmojiPicker
                          icon={document.icon}
                          defaultIcon={defaultIcon}
                          defaultIconLabel={
                            defaultIconKind === "database" ? "database" : "page"
                          }
                          onSelect={(emoji) => {
                            if (
                              !documentCanonicalMutationsEnabled(
                                editorCanEdit,
                                isSuggesting,
                              )
                            )
                              return;
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
                    onChange={(e) => {
                      if (!isSuggesting)
                        handleTitleChange(normalizeTitleText(e.target.value));
                    }}
                    onPaste={handleTitlePaste}
                    onFocus={() => {
                      titleFocusedRef.current = true;
                      onTitleFocused?.();
                    }}
                    onBlur={() => {
                      titleFocusedRef.current = false;
                    }}
                    onKeyDown={(e) => {
                      if (!editorCanEdit || isSuggesting) return;
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const pm = documentLayoutRef.current?.querySelector(
                          ".ProseMirror",
                        ) as HTMLElement | null;
                        pm?.focus();
                      }
                    }}
                    aria-label={t("editor.documentTitle")}
                    placeholder={t("editor.title")}
                    readOnly={!editorCanEdit || isSuggesting}
                    style={{ fieldSizing: "content" } as any}
                    className={cn(
                      "block w-full resize-none overflow-hidden break-words border-none bg-transparent p-0 font-bold leading-tight text-foreground outline-none placeholder:text-muted-foreground/40",
                      host === "preview" || isDatabasePage
                        ? "text-3xl"
                        : "text-3xl md:text-4xl",
                    )}
                  />
                </div>
                {host === "preview" &&
                document.databaseMembership &&
                !isLocalFileDocument ? (
                  <div className="mx-auto w-full max-w-3xl px-4 pb-3 sm:px-6">
                    <DocumentProperties
                      documentId={documentId}
                      databaseId={
                        databaseId ??
                        document.databaseMembership.databaseId ??
                        null
                      }
                      databaseDocumentId={
                        databaseDocumentId ??
                        document.databaseMembership.databaseDocumentId ??
                        null
                      }
                      canEdit={editorCanEdit}
                      popoversPortalled={false}
                    />
                  </div>
                ) : null}
                {document.database ? (
                  <div className={documentEditorDatabaseRegionClassName()}>
                    <DocumentDatabase
                      document={document}
                      canEdit={canEdit}
                      viewId={viewId}
                      onExportContextChange={handleDatabaseExportContextChange}
                    />
                  </div>
                ) : null}

                {!isDatabasePage ? (
                  <div
                    className={cn(
                      "mx-auto w-full max-w-3xl flex-1 cursor-text px-4",
                      host === "preview"
                        ? "pb-10 sm:px-6"
                        : "pb-16 sm:px-8 md:px-16",
                    )}
                    onClick={(e) => {
                      if (e.target === e.currentTarget) {
                        cancelPaddingScrollRestore();
                        const scrollContainer = scrollContainerRef.current;
                        const scrollTop = scrollContainer?.scrollTop;
                        const restoreScroll = () => {
                          if (scrollContainer && scrollTop !== undefined) {
                            scrollContainer.scrollTop = scrollTop;
                          }
                          pendingPaddingScrollRestoreRef.current = null;
                        };
                        const pm = e.currentTarget.querySelector(
                          ".ProseMirror",
                        ) as HTMLElement | null;
                        pm?.focus({ preventScroll: true });
                        restoreScroll();
                        if (scrollContainer && scrollTop !== undefined) {
                          pendingPaddingScrollRestoreRef.current =
                            window.setTimeout(restoreScroll, 50);
                        }
                      }
                    }}
                  >
                    {(() => {
                      if (bodyHydrationPending) {
                        return (
                          <BuilderBodySyncingNotice
                            title={t(
                              document.bodyHydration?.provider === "builder"
                                ? "editor.builderBodySyncing"
                                : "editor.pageBodySyncing",
                            )}
                            description={t(
                              document.bodyHydration?.provider === "builder"
                                ? "editor.builderBodySyncingDescription"
                                : "editor.pageBodySyncingDescription",
                            )}
                          />
                        );
                      }

                      if (bodyHydrationError) {
                        return (
                          <BuilderBodySyncingNotice
                            title={t("database.builderBodySyncFailedNotice")}
                            description={
                              bodyHydrationError.error ??
                              t("database.builderBodySyncFailedDescription")
                            }
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
                              disabled={newDocumentPageChoiceIsDisabled({
                                canEdit,
                                bodyHydrationPending,
                                databaseCreationPending:
                                  createDatabase.isPending,
                              })}
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
                        <>
                          {canEdit && collabInitializationFailed ? (
                            <div data-collab-initialization-error role="alert">
                              <QueryErrorState
                                compact
                                onRetry={() => globalThis.location.reload()}
                              />
                            </div>
                          ) : null}
                          {suggestionDraftPreview.status ===
                          "unsupported-formatting" ? (
                            <div
                              role="alert"
                              className="mb-3 text-sm text-destructive"
                            >
                              {t("editor.suggestionFormattingUnsupported")}
                            </div>
                          ) : null}
                          <VisualEditor
                            onEscape={handleEditorEscape}
                            key={`${visualEditorInstanceKey({
                              documentId,
                              documentUpdatedAt: document.updatedAt,
                              isLocalFileDocument,
                              canEdit,
                              collabEditorEnabled,
                              hasYDoc: Boolean(ydoc),
                              localFileSyncRevision,
                            })}:${isSuggesting ? "suggesting" : "canonical"}`}
                            documentId={documentId}
                            content={
                              isLocalFileDocument
                                ? localContent
                                : isSuggesting
                                  ? suggestionDraft
                                  : document.content
                            }
                            contentUpdatedAt={
                              isLocalFileDocument
                                ? (localContentUpdatedAt ?? document.updatedAt)
                                : document.updatedAt
                            }
                            contentRevision={
                              isLocalFileDocument
                                ? null
                                : (document.revision ?? null)
                            }
                            onBaseAwareReconcile={handleBaseAwareReconcile}
                            collabContentRevision={
                              isLocalFileDocument || isSuggesting
                                ? null
                                : document.collabContentRevision
                            }
                            requestCollabSync={requestCollabSync}
                            onChange={
                              isSuggesting
                                ? setSuggestionDraft
                                : handleContentChange
                            }
                            onSaveContent={
                              suggestionEditorIsolation.persistCanonical
                                ? handleContentSaveNow
                                : undefined
                            }
                            ydoc={
                              suggestionEditorIsolation.bindCanonicalYDoc
                                ? ydoc
                                : null
                            }
                            collabSynced={
                              collabEditorEnabled ? collabSynced : true
                            }
                            awareness={collabEditorEnabled ? awareness : null}
                            user={currentUser}
                            editable={
                              suggestionEditorIsolation.editable &&
                              !isSubmittingSuggestions
                            }
                            suggesting={isSuggesting}
                            localFileMode={isLocalFileDocument}
                            localFilePath={
                              isLocalFileDocument ? document.source?.path : null
                            }
                            onComment={canComment ? handleComment : undefined}
                            commentThreads={threads ?? []}
                            activeThreadId={selectedThreadId}
                            hoveredThreadId={hoveredThreadId}
                            pendingHighlight={pendingComment?.range ?? null}
                            onActivateThread={
                              !isLocalFileDocument
                                ? activateCommentThread
                                : undefined
                            }
                            suggestions={visualSuggestions}
                            activeSuggestionId={
                              hoveredSuggestionId ??
                              editingSuggestionId ??
                              selectedSuggestionId
                            }
                            onActivateSuggestion={activateInlineSuggestion}
                            onHoverSuggestion={setHoveredSuggestionId}
                            onSuggestionReplacementIntent={
                              isSuggesting
                                ? handleSuggestionReplacementIntent
                                : undefined
                            }
                            initialSelection={suggestionInitialSelection}
                            onSuggestionAnchorsChange={setAnchoredSuggestionIds}
                            showCommentIndicators={showCommentIndicators}
                            onJoinTitle={joinFirstBodyBlockToTitle}
                            notionPageLinks={notionPageLinks}
                            onOpenNotionPageLink={handleOpenNotionPageLink}
                            notionPageId={document.notionPageId}
                            onHistoryControllerChange={
                              handleHistoryControllerChange
                            }
                            onHistoryStateChange={handleHistoryStateChange}
                            onPersistenceControllerChange={
                              handlePersistenceControllerChange
                            }
                          />
                        </>
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
                            onAdditionalContentChange={
                              handleAdditionalBlockContentChange
                            }
                          />
                        );
                      }

                      return primaryEditor;
                    })()}
                    {!bodyHydrationPending &&
                    !isLocalFileDocument &&
                    canEdit &&
                    !collabSynced ? (
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

              {showDesktopRightRail ? (
                showInlineComments ? (
                  <aside
                    ref={commentLaneRef}
                    className="absolute right-0 top-0 w-80"
                    aria-label={t("comments.title")}
                    data-comments-flow-lane
                  >
                    <div
                      style={{
                        transform: `translateX(${commentLaneOffset}px)`,
                      }}
                    >
                      <div className="relative min-h-full translate-x-4">
                        {renderCommentsSidebar()}
                      </div>
                    </div>
                  </aside>
                ) : (
                  <aside className="w-80 shrink-0 border-s border-border">
                    {utilityPanelContent}
                  </aside>
                )
              ) : null}

              {showAnchoredCommentPopover ? (
                <aside
                  ref={anchoredCommentRef}
                  className="pointer-events-none absolute z-30"
                  aria-label={t("comments.title")}
                  data-comments-anchored-popover
                  data-placement={anchoredCommentPosition?.placement}
                  style={
                    anchoredCommentPosition
                      ? {
                          left: anchoredCommentPosition.left,
                          top: anchoredCommentPosition.top,
                          width: anchoredCommentPosition.width,
                        }
                      : { visibility: "hidden" }
                  }
                >
                  <div className="pointer-events-auto">
                    {renderCommentsSidebar(
                      pendingComment ? "__pending-only__" : selectedThreadId,
                      false,
                    )}
                  </div>
                </aside>
              ) : null}
            </div>
          </div>
        </div>

        <aside
          className={cn(
            "min-h-0 shrink-0 overflow-hidden border-s bg-background transition-[width] duration-[260ms] ease-[var(--ease-drawer)]",
            showDesktopCommentsHistory
              ? "w-80 border-border"
              : "pointer-events-none w-0 border-transparent",
          )}
          aria-hidden={!showDesktopCommentsHistory || undefined}
          inert={!showDesktopCommentsHistory || undefined}
          data-comments-history-rail
          onTransitionEnd={(event) => {
            if (event.propertyName === "width" && !showDesktopCommentsHistory) {
              setCommentsHistoryRailMounted(false);
            }
          }}
        >
          <CommentHistoryScrollContainer className="h-full w-80 overflow-x-hidden overflow-y-auto">
            {commentsHistoryRailMounted
              ? renderUtilityPanelContent("comments")
              : null}
          </CommentHistoryScrollContainer>
        </aside>

        <Sheet
          open={showUtilityPanelSheet}
          onOpenChange={(open) => {
            if (!open) {
              handleUtilityPanelChange(null);
            }
          }}
        >
          <SheetContent
            ref={setUtilityPanelSheetContainer}
            side="right"
            inert={!showUtilityPanelSheet || undefined}
            onOpenAutoFocus={(event) => {
              if (hasFocusedCommentReply) event.preventDefault();
            }}
            onCloseAutoFocus={(event) => {
              if (hasInlineCommentSpace && hasFocusedCommentReply) {
                event.preventDefault();
              }
            }}
            className="flex min-h-0 w-[min(26rem,calc(100vw-1rem))] flex-col overflow-hidden p-0 data-[state=closed]:duration-[260ms] data-[state=open]:duration-[260ms] data-[state=closed]:ease-[var(--ease-drawer)] data-[state=open]:ease-[var(--ease-drawer)]"
            aria-describedby={undefined}
            onEscapeKeyDown={(event) => {
              preserveCommentReplyEscape(event);
              if (event.defaultPrevented) return;
              const target = event.target;
              const nestedPopper =
                target instanceof Element
                  ? target.closest("[data-radix-popper-content-wrapper]")
                  : null;
              if (
                nestedPopper &&
                utilityPanelSheetContainer?.contains(nestedPopper)
              ) {
                event.preventDefault();
              }
            }}
          >
            <SheetHeader className="sr-only">
              <SheetTitle>
                {lastUtilityPanel === "info"
                  ? t("editor.toolbar.info")
                  : t("comments.title")}
              </SheetTitle>
            </SheetHeader>
            {lastUtilityPanel === "comments" ? (
              <CommentHistoryScrollContainer className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
                {showUtilityPanelSheet
                  ? renderUtilityPanelContent(
                      lastUtilityPanel,
                      true,
                      utilityPanelSheetContainer,
                    )
                  : null}
              </CommentHistoryScrollContainer>
            ) : (
              <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
                {showUtilityPanelSheet
                  ? renderUtilityPanelContent(
                      lastUtilityPanel,
                      true,
                      utilityPanelSheetContainer,
                    )
                  : null}
              </div>
            )}
          </SheetContent>
        </Sheet>
      </div>
    </BlockRegistryProvider>
  );
}
