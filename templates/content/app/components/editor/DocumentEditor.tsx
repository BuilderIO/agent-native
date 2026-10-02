import { generateTabId } from "@agent-native/core/client/agent-chat";
import { agentNativePath } from "@agent-native/core/client/api-path";
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
  tryCallActionKeepalive,
  useAvatarUrl,
  useDbSync,
  useSession,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  useCreateResourceSuggestionProposal,
  useDecideResourceSuggestion,
  useDecideResourceSuggestionProposal,
  useResourceSuggestions,
  useUpdateResourceSuggestion,
} from "@agent-native/core/client/review";
import type {
  ResourceSuggestion,
  SuggestionDecision,
} from "@agent-native/core/review";
import { normalizeDocumentTitle } from "@agent-native/core/shared";
import { BlockRegistryProvider } from "@agent-native/toolkit/app/blocks";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import type {
  ContentNavigationPathEntry,
  Document,
  DocumentSyncStatus,
} from "@shared/api";
import { canonicalizeNfm, docToNfm } from "@shared/nfm";
import { markdownSuggestionOperations } from "@shared/suggestion-diff";
import {
  SuggestionFormattingMappingError,
  suggestionMarkedSourceRanges,
} from "@shared/suggestion-formatting";
import { resolveMarkdownSuggestionRange } from "@shared/suggestion-rebase";
import {
  IconDatabase,
  IconEye,
  IconEyeOff,
  IconLoader2,
  IconX,
} from "@tabler/icons-react";
import { IconLock } from "@tabler/icons-react";
import {
  hashKey,
  type QueryClient,
  useQueryClient,
} from "@tanstack/react-query";
import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ClipboardEvent, MutableRefObject, ReactNode } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import type { Doc as YDoc } from "yjs";

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
import { useComments, type CommentThread } from "@/hooks/use-comments";
import {
  useCreateContentDatabase,
  useDeleteContentDatabase,
  useProcessBuilderBodyHydration,
} from "@/hooks/use-content-database";
import { useRecordContentVisit } from "@/hooks/use-content-recent";
import {
  useContentSpaces,
  type ContentSpaceSummary,
} from "@/hooks/use-content-spaces";
import {
  mergeDocumentIntoDocumentCache,
  isDocumentUpdateConflict,
  isDocumentUpdatePreservationRequired,
  isDocumentUpdateSuperseded,
  patchDocumentCaches,
  documentQueryFilter,
  documentQueryKey,
  startPageOpenReviewReads,
  startPreviewDocumentDraftRead,
  useContentNavigationContext,
  useDeleteDocument,
  useDocuments,
  usePageOpenDocument,
  useResolvePreviewDocumentDraft,
  useUpdatePreviewDocumentDraft,
  useUpdateDocument,
} from "@/hooks/use-documents";
import type { DocumentUpdateResult } from "@/hooks/use-documents";
import { useLocalStorage } from "@/hooks/use-local-storage";
import {
  documentSyncStatusQueryKey,
  useDocumentSyncStatus,
  usePushDocumentToNotion,
} from "@/hooks/use-notion";
import {
  useOptimisticDocumentTitle,
  refreshLandingTitleHintCache,
} from "@/hooks/use-optimistic-document-title";
import {
  CONTENT_LANDING_PATH,
  contentLandingRecoveryTarget,
  rememberContentLandingDocument,
} from "@/lib/content-landing";
import type { DesktopContentFileRevision } from "@/lib/desktop-content-files";
import { registerDocumentHistoryRestoreController } from "@/lib/document-history-restore-controller";
import { rememberLandingTitleHint } from "@/lib/document-title-hint";
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
import {
  readDocumentShapeHint,
  readPageIconRowHint,
  readPageShapeHint,
  rememberPageIconRow,
  rememberPageShape,
} from "@/lib/page-startup-hints";
import { startupAnchor } from "@/lib/startup-timing";
import { cn } from "@/lib/utils";

import { ContentIcon } from "../icons/ContentIcon";
import {
  flushAllBlockFieldSaveControllersForDocument,
  flushBlockFieldSaveController,
} from "./blockFieldSaveRegistry";
import {
  createCollectionStarterIsVisible,
  documentBodyHydrationIsPending,
  isEffectivelyEmptyDocumentContent,
} from "./body-hydration";
import { BuilderBodySyncingNotice } from "./BuilderBodySyncingNotice";
import { useCommentAiRequests } from "./comment-ai";
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
import {
  DOCUMENT_EDITOR_DATABASE_TITLE_SIZE_CLASS_NAME,
  DOCUMENT_EDITOR_INLINE_REVIEW_MIN_WIDTH,
  DOCUMENT_EDITOR_PAGE_TITLE_SIZE_CLASS_NAME,
  DOCUMENT_EDITOR_TITLE_CLASS_NAME,
  documentEditorBodyClassName,
  documentEditorDatabaseRegionClassName,
  documentEditorTitleRegionClassName,
  type DocumentEditorIconRow,
} from "./document-editor-layout";
import { createHistorySession } from "./document-history-session";
import {
  saveDocumentWithRebase,
  type DocumentContentBase,
} from "./document-save-rebase";
import {
  authoredCandidateMatchesContent,
  pendingSaveRetrySnapshot,
} from "./document-save-retry";
import { DocumentBlockFields } from "./DocumentBlockFields";
import { DocumentDatabase } from "./DocumentDatabase";
import { DocumentEditorSkeleton } from "./DocumentEditorSkeleton";
import { DocumentInfoPanel } from "./DocumentInfoPanel";
import { DocumentProperties } from "./DocumentProperties";
import { DocumentReconcileRecovery } from "./DocumentReconcileRecovery";
import {
  DocumentToolbar,
  type ToolbarBreadcrumbItem,
  type ToolbarBreadcrumbOpen,
} from "./DocumentToolbar";
import type { EditorDraftSaveResult } from "./editor-draft-save";
import { EmojiPicker } from "./EmojiPicker";
import { LinkedLocalDocumentAgentBridge } from "./LinkedLocalDocumentAgentBridge";
import { useRegisterLiveEditorSession } from "./live-editor-session";
import {
  classifyLocalSourceRead,
  localSourceRevisionForQueuedEdit,
  localSourceRevisionForSave,
  type PendingLocalSourceWrite,
} from "./local-source-write-state";
import { NotionConflictBanner } from "./NotionConflictBanner";
import {
  clearPageDraftJournal,
  clearPageDraftJournalGeneration,
  writePageDraftJournal,
} from "./page-draft-journal";
import { PageDraftRecovery } from "./PageDraftRecovery";
import {
  mayClearRecoveryDraft,
  ownRecoveryDraftSupersededBySave,
  savePageWithRecovery,
  type PageSaveResult as DocumentSaveResult,
} from "./pageSession";
import {
  canonicalSuggestionRevision,
  createSuggestionDraftSession,
  previewSuggestionDraft,
  editableSuggestionDraft,
  freshestSavedSuggestions,
  recordSuggestionReplacementIntent,
  suggestionDraftOperations,
  suggestionOperationKey,
  suggestionSessionVisuals,
  type DraftSuggestion,
  type SuggestionDraftSession,
  unpersistedDraftSuggestions,
} from "./suggestions/draft-session";
import { suggestedEditorIsolation } from "./suggestions/editor-isolation";
import {
  createObservedSuggestionPresentationTransition,
  hydrateSuggestionPresentationTransitions,
  preciseSuggestionPresentationOperations,
  retainCommittedSuggestionPresentationTransitions,
  resolveSuggestionPresentationRange,
  suggestionPresentationTransitionKey,
  type SuggestionPresentationTransition,
  type SuggestionPresentationTransitions,
} from "./suggestions/presentation-rebase";
import {
  normalizeTitleText,
  stripMarkdownHeadingPrefixFromTitlePaste,
} from "./title-text";
import {
  useDocumentReconcileRecovery,
  type DocumentReconcileRecoveryState,
  type ReconcileRecoveryDraft,
  type ReconcileSaveBase,
} from "./useDocumentReconcileRecovery";
import { canProjectAcceptedSuggestion, VisualEditor } from "./VisualEditor";
import type {
  VisualEditorSuggestion,
  VisualEditorHistoryController,
  VisualEditorHistoryState,
  VisualEditorPersistenceController,
  VisualEditorSelectionController,
  VisualEditorSelectionSnapshot,
} from "./VisualEditor";

const NO_COMMENT_THREADS: CommentThread[] = [];

export function observeAcceptedCanonicalSettlement(args: {
  ydoc: YDoc;
  beforeContent: string;
  readbackContent: string;
  onRendered: () => void;
  onOutdated: (actualContent: string) => void;
  onError: (error: unknown) => void;
}) {
  const before = canonicalizeNfm(args.beforeContent);
  const readback = canonicalizeNfm(args.readbackContent);
  let rendered = false;
  const check = () => {
    if (rendered) return;
    try {
      const actual = canonicalizeNfm(
        docToNfm(yDocToProsemirrorJSON(args.ydoc, "default") as any),
      );
      if (actual === readback && actual !== before) {
        rendered = true;
        args.onRendered();
      } else if (actual !== before && actual !== readback) {
        args.onOutdated(actual);
      }
    } catch (error) {
      args.onError(error);
    }
  };
  args.ydoc.on("update", check);
  check();
  return () => args.ydoc.off("update", check);
}

export function shouldResumeSelectedSuggestionFromPageActions(
  capturedSelection: VisualEditorSelectionSnapshot | null,
) {
  return capturedSelection == null;
}

export function restoreCapturedEditorSelection(
  controller: VisualEditorSelectionController | null,
  snapshot: VisualEditorSelectionSnapshot | null,
) {
  controller?.releaseSelectionPreservation();
  if (!controller || !snapshot) return false;
  return controller.restoreSelection(snapshot);
}

export function documentEditorCommentThreads(
  threads: CommentThread[] | null | undefined,
) {
  return threads ?? NO_COMMENT_THREADS;
}

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
  foreground?: boolean;
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
type ContentSaveWatermark = {
  content: string;
  updatedAt: string | null;
  revision?: string;
};
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

export function suggestionAmendmentResolutionConflicts(
  editingSuggestionId: string | null,
  suggestions: Array<Pick<ResourceSuggestion, "id" | "status">>,
  ownedDecisions: ReadonlyArray<{ id: string; decision: SuggestionDecision }>,
) {
  if (!suggestionAmendmentTargetIsResolved(editingSuggestionId, suggestions))
    return false;
  const suggestion = suggestions.find(
    (candidate) => candidate.id === editingSuggestionId,
  );
  return !ownedDecisions.some(
    (owned) =>
      owned.id === editingSuggestionId && owned.decision === suggestion?.status,
  );
}

export function suggestionDecisionPreviewContent(
  suggestion: Pick<ResourceSuggestion, "operations">,
  decision: SuggestionDecision,
  canonicalContent: string,
  optimistic = true,
) {
  if (!optimistic || decision === "rejected") return canonicalContent;
  const after = suggestion.operations[0]?.after as {
    markdown?: unknown;
  } | null;
  return typeof after?.markdown === "string"
    ? after.markdown
    : canonicalContent;
}

export function materializedSuggestionForDraft(
  persisted: ReadonlyMap<string, ResourceSuggestion>,
  draft: Pick<DraftSuggestion, "operations">,
) {
  const exact = persisted.get(suggestionOperationKey(draft.operations[0]!));
  if (exact) return exact;
  return persisted.size === 1
    ? (persisted.values().next().value ?? null)
    : null;
}

export function visibleSavedSuggestionsDuringDraftMaterialization(
  saved: ResourceSuggestion[],
  drafts: DraftSuggestion[],
  submitting: boolean,
  materializedIds: ReadonlySet<string>,
) {
  if (!submitting || drafts.length === 0) return saved;
  return saved.filter((suggestion) => !materializedIds.has(suggestion.id));
}

export function sameSuggestionAnchorIds(
  current: string[] | null,
  next: string[],
) {
  return (
    current !== null &&
    current.length === next.length &&
    current.every((id) => next.includes(id))
  );
}

export function documentEditorReservesInlineReviewSpace(args: {
  showInlineComments: boolean;
  preserveInlineReviewSpace: boolean;
  hasInlineCommentSpace: boolean;
  isDatabasePage: boolean;
}) {
  return (
    !args.isDatabasePage &&
    (args.showInlineComments ||
      (args.preserveInlineReviewSpace && args.hasInlineCommentSpace))
  );
}

export function suggestionPresentation(
  suggestion: Pick<ResourceSuggestion, "id" | "status" | "operations">,
  currentMarkdown: string,
  transition?: SuggestionPresentationTransition,
  observedTransition?: SuggestionPresentationTransition,
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
  const range = resolveSuggestionPresentationRange(
    currentMarkdown,
    operation,
    transition,
    observedTransition,
  );
  if (!range) return null;
  const editorMarkdown = canonicalizeNfm(currentMarkdown);
  const currentText = currentMarkdown.slice(range.from, range.to);
  const editorRange = resolveMarkdownSuggestionRange(editorMarkdown, {
    before: { markdown: currentMarkdown, changedText: currentText },
    after: { markdown: currentMarkdown, changedText: currentText },
    anchor: {
      from: range.from,
      to: range.to,
      prefix: currentMarkdown.slice(Math.max(0, range.from - 32), range.from),
      suffix: currentMarkdown.slice(range.to, range.to + 32),
    },
  });
  if (!editorRange) return null;
  return {
    id: suggestion.id,
    kind: operation.kind as VisualEditorSuggestion["kind"],
    canonicalOperation: operation,
    canonicalTransition: transition,
    observedTransition,
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
      from: editorRange.from,
      prefix: editorMarkdown.slice(
        Math.max(0, editorRange.from - 32),
        editorRange.from,
      ),
      suffix: editorMarkdown.slice(editorRange.to, editorRange.to + 32),
    },
    presentation: "canonical",
  };
}

export function suggestionPresentations(
  suggestion: Pick<ResourceSuggestion, "id" | "status" | "operations">,
  currentMarkdown: string,
  transition?: SuggestionPresentationTransition,
  observedTransition?: SuggestionPresentationTransition,
): VisualEditorSuggestion[] {
  const original = suggestionPresentation(
    suggestion,
    currentMarkdown,
    transition,
    observedTransition,
  );
  if (suggestion.operations.length !== 1) return original ? [original] : [];
  const saved = suggestion.operations[0]!;
  if (saved.kind !== "replace_text") return original ? [original] : [];
  const operations = preciseSuggestionPresentationOperations(saved);
  if (!operations) return original ? [original] : [];
  const precise = operations.map((operation) =>
    suggestionPresentation(
      { ...suggestion, operations: [operation] },
      currentMarkdown,
      transition,
      observedTransition,
    ),
  );
  return precise.every((presentation) => presentation !== null)
    ? (precise as VisualEditorSuggestion[])
    : original
      ? [original]
      : [];
}

export function documentEditorSuggestionPresentations(args: {
  savedSuggestions: ResourceSuggestion[];
  drafts: DraftSuggestion[];
  currentMarkdown: string;
  editingSuggestionId: string | null;
  pendingSuggestionId: string | null;
  transitions: SuggestionPresentationTransitions;
  observedTransition?: SuggestionPresentationTransition;
}): VisualEditorSuggestion[] {
  const savedPresentations: VisualEditorSuggestion[] = [];
  for (const suggestion of args.savedSuggestions) {
    if (suggestion.id === args.editingSuggestionId) continue;
    savedPresentations.push(
      ...suggestionPresentations(
        suggestion,
        args.currentMarkdown,
        args.transitions.get(suggestionPresentationTransitionKey(suggestion)),
        args.observedTransition,
      ),
    );
  }
  const draftPresentations: VisualEditorSuggestion[] = [];
  for (const suggestion of args.drafts) {
    if (suggestion.id === args.pendingSuggestionId) continue;
    const preciseDrafts = preciseDraftSuggestionPresentations(
      suggestion,
      args.currentMarkdown,
    );
    if (preciseDrafts) {
      draftPresentations.push(...preciseDrafts);
      continue;
    }
    const operation = suggestion.operations[0]!;
    const before = operation.before as { changedText: string };
    const after = operation.after as {
      markdown: string;
      changedText: string;
    };
    const beforeMarkdown = (operation.before as { markdown: string }).markdown;
    const operationAnchor = operation.anchor as { from: number; to: number };
    draftPresentations.push({
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
      presentation: "draft",
    });
  }
  return replaceSuggestionPresentations(savedPresentations, draftPresentations);
}

function replaceSuggestionPresentations(
  presentations: VisualEditorSuggestion[],
  replacements: VisualEditorSuggestion[],
): VisualEditorSuggestion[] {
  if (replacements.length === 0) return presentations;
  const replacedIds = new Set(
    replacements.map((presentation) => presentation.id),
  );
  return [
    ...presentations.filter(
      (presentation) => !replacedIds.has(presentation.id),
    ),
    ...replacements,
  ];
}

export function replaceAcceptedSuggestionPresentations(
  presentations: VisualEditorSuggestion[],
  accepted: VisualEditorSuggestion | VisualEditorSuggestion[] | null,
): VisualEditorSuggestion[] {
  return replaceSuggestionPresentations(
    presentations,
    accepted ? (Array.isArray(accepted) ? accepted : [accepted]) : [],
  );
}

export function replaceAcceptedProposalPresentations(
  presentations: VisualEditorSuggestion[],
  members: ResourceSuggestion[],
  beforeContent: string,
  readbackContent: string | null,
): VisualEditorSuggestion[] {
  const ids = new Set(members.map((member) => member.id));
  const settling = members.flatMap((member) =>
    suggestionPresentations(
      { ...member, status: "pending" },
      beforeContent,
    ).map((presentation) => ({
      ...presentation,
      presentation: canProjectAcceptedSuggestion(presentation)
        ? ("settling" as const)
        : ("canonical" as const),
      settlementReadbackContent: readbackContent,
    })),
  );
  return [
    ...presentations.filter((presentation) => !ids.has(presentation.id)),
    ...settling,
  ];
}

export function proposalDecisionPresentations(
  presentations: VisualEditorSuggestion[],
  decision: {
    accepted: boolean;
    continueSuggesting: boolean;
    members: ResourceSuggestion[];
    beforeContent: string;
    readbackContent: string | null;
  } | null,
): VisualEditorSuggestion[] {
  if (!decision?.accepted) return presentations;
  return replaceAcceptedProposalPresentations(
    presentations,
    decision.members,
    decision.beforeContent,
    decision.readbackContent,
  );
}

export function observedSuggestionDecisionTransition(
  single: {
    decision: SuggestionDecision;
    optimistic: boolean;
    continueSuggesting: boolean;
    suggestion: Pick<ResourceSuggestion, "operations">;
  } | null,
  proposal: {
    accepted: boolean;
    continueSuggesting: boolean;
    members: Array<Pick<ResourceSuggestion, "operations">>;
  } | null,
) {
  return single?.decision === "accepted" && single.optimistic
    ? (createObservedSuggestionPresentationTransition([single.suggestion]) ??
        undefined)
    : proposal?.accepted
      ? (createObservedSuggestionPresentationTransition(proposal.members) ??
        undefined)
      : undefined;
}

export function createDocumentSuggestionDraftSession(
  input: Pick<
    Parameters<typeof createSuggestionDraftSession>[0],
    "id" | "baseContent" | "baseRevision" | "startedAt"
  >,
) {
  suggestionMarkedSourceRanges(input.baseContent);
  const content = canonicalizeNfm(input.baseContent);
  return {
    session: createSuggestionDraftSession({
      ...input,
      initialContent: content,
    }),
    content,
  };
}

export function suggestionDraftHasChanges(
  session: Pick<SuggestionDraftSession, "baseContent" | "initialContent">,
  content: string,
) {
  return (
    content !== (session.initialContent ?? canonicalizeNfm(session.baseContent))
  );
}

export function singleSuggestionDecisionLockAfterMismatch(
  current: { inFlight: boolean; activeSuggestionId: string | null },
  requestedDecision: SuggestionDecision,
  returnedStatus: ResourceSuggestion["status"],
) {
  return requestedDecision !== "accepted" && returnedStatus === "accepted"
    ? { inFlight: false, activeSuggestionId: null }
    : current;
}

export function preciseDraftSuggestionPresentations(
  suggestion: Pick<DraftSuggestion, "id" | "operations" | "anchor">,
  currentMarkdown: string,
): VisualEditorSuggestion[] | null {
  const operation = suggestion.operations[0];
  const before = operation?.before as { markdown?: unknown } | null;
  const after = operation?.after as {
    markdown?: unknown;
    changedText?: unknown;
  } | null;
  const operationAnchor = operation?.anchor as {
    from?: unknown;
    to?: unknown;
  } | null;
  if (
    operation?.kind !== "replace_text" ||
    typeof before?.markdown !== "string" ||
    typeof after?.markdown !== "string" ||
    typeof after.changedText !== "string" ||
    typeof operationAnchor?.from !== "number" ||
    typeof operationAnchor.to !== "number"
  )
    return null;

  const mappedStart = suggestion.anchor.from;
  const mappedEnd = suggestion.anchor.to;
  if (
    mappedStart < 0 ||
    mappedEnd > currentMarkdown.length ||
    currentMarkdown.slice(mappedStart, mappedEnd) !== after.changedText
  )
    return null;

  try {
    const operations = markdownSuggestionOperations(
      before.markdown,
      after.markdown,
    );
    if (operations.length === 0) return null;
    const presentations: VisualEditorSuggestion[] = [];
    let delta = 0;
    for (const preciseOperation of operations) {
      const from =
        mappedStart +
        preciseOperation.anchor.from -
        operationAnchor.from +
        delta;
      const to = from + preciseOperation.after.changedText.length;
      if (
        from < 0 ||
        to > currentMarkdown.length ||
        currentMarkdown.slice(from, to) !== preciseOperation.after.changedText
      )
        return null;
      const presentation = suggestionPresentation(
        {
          id: suggestion.id,
          status: "pending",
          operations: [preciseOperation],
        },
        before.markdown,
      );
      if (!presentation) return null;
      presentations.push({
        ...presentation,
        afterPresentation: { source: currentMarkdown, from, to },
        anchor: {
          from,
          prefix: currentMarkdown.slice(Math.max(0, from - 32), from),
          suffix: currentMarkdown.slice(to, to + 32),
        },
        presentation: "draft",
      });
      delta +=
        preciseOperation.after.changedText.length -
        preciseOperation.before.changedText.length;
    }
    return presentations;
  } catch (error) {
    if (!(error instanceof SuggestionFormattingMappingError)) throw error;
    return null;
  }
}

export function metadataUpdatesWithPendingTitle<
  T extends {
    title?: string;
    content?: string;
    description?: string;
    icon?: Document["icon"];
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

export function shouldAttestUnchangedEditorSave(args: {
  hasUpdates: boolean;
  contentChanged: boolean;
  editorSessionId?: string;
  editGeneration?: number;
  isLinkedLocalSource: boolean;
  isLocalFile: boolean;
}) {
  return (
    !args.hasUpdates &&
    !args.contentChanged &&
    !!args.editorSessionId &&
    args.editGeneration !== undefined &&
    !args.isLinkedLocalSource &&
    !args.isLocalFile
  );
}

/**
 * Whether the page title moved away from this save's base because someone
 * else renamed it. The document can already hold this editor's own
 * optimistic title, which is not a conflict.
 */
export function titleRenamedByAnotherWriter({
  documentTitle,
  titleBase,
  title,
}: {
  documentTitle: string;
  titleBase: string | undefined;
  title: string;
}): boolean {
  return (
    titleBase !== undefined &&
    documentTitle !== titleBase &&
    documentTitle !== title
  );
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

  return { ...args.lastSaved, updatedAt: args.serverUpdatedAt };
}

export type OwnContentSaveLineage = Map<
  string,
  { baseRevision: string; editGeneration: number }
>;

const OWN_CONTENT_SAVE_LINEAGE_LIMIT = 32;

export function recordOwnContentSave(
  lineage: OwnContentSaveLineage,
  revision: string,
  link: { baseRevision: string; editGeneration: number },
) {
  lineage.delete(revision);
  lineage.set(revision, link);
  while (lineage.size > OWN_CONTENT_SAVE_LINEAGE_LIMIT) {
    lineage.delete(lineage.keys().next().value as string);
  }
}

// Edits made while an earlier save is in flight capture the pre-save base.
// The server's positional intent merge treats this editor's own committed
// blocks as a concurrent edit, so any inserted or removed block is preserved
// to History instead of saved. Advance the base only across revisions this
// editor session committed verbatim at an earlier generation.
export function ownConfirmedContentBase(args: {
  captured: DocumentContentBase;
  latest: ContentSaveWatermark;
  lineage: ReadonlyMap<
    string,
    { baseRevision: string; editGeneration: number }
  >;
  editGeneration: number;
}): ContentSaveWatermark | null {
  const target = args.captured.revision;
  let revision = args.latest.revision;
  if (!target || !revision || revision === target) return null;
  for (let step = 0; step < args.lineage.size; step++) {
    const link = args.lineage.get(revision);
    if (!link || link.editGeneration >= args.editGeneration) return null;
    if (link.baseRevision === target) return args.latest;
    revision = link.baseRevision;
  }
  return null;
}

// A browser save attempt ID names one exact payload. A hidden tab sends a
// keepalive copy of the pending save under its ID before the ordinary flush,
// so a flush moved onto this editor's newer base is a different payload and
// needs its own ID. The server then accepts both deliveries as the same edit
// generation instead of rejecting the second as a reused attempt. Page
// recovery keeps checking the earlier ID too, as long as that copy sent
// everything the new one does.
export function adoptOwnConfirmedBases(
  options: DocumentSaveOptions,
  content: string,
  ownBase: (captured: DocumentContentBase) => ContentSaveWatermark | null,
): DocumentSaveOptions {
  const ownContentBase = options.contentBase && ownBase(options.contentBase);
  // The keepalive copy leaves out a body that matches its captured base, so
  // its receipt cannot confirm a body that the newer base turns into a change,
  // such as a revert of this editor's own earlier save.
  const earlierCopySentBody =
    !ownContentBase ||
    content !== options.contentBase?.content ||
    content === ownContentBase.content;
  const intent = options.authoredContentIntent;
  const ownIntentBase =
    intent &&
    ownBase({
      content: intent.baseContent,
      updatedAt: null,
      revision: intent.baseRevision,
    });
  if (!ownContentBase && !ownIntentBase) return options;
  return {
    ...options,
    ...(ownContentBase ? { contentBase: { ...ownContentBase } } : {}),
    ...(intent && ownIntentBase
      ? {
          authoredContentIntent: {
            ...intent,
            baseRevision: ownIntentBase.revision,
            baseContent: ownIntentBase.content,
          },
        }
      : {}),
    ...(options.saveAttemptId
      ? {
          saveAttemptId: crypto.randomUUID(),
          equivalentSaveAttemptIds: earlierCopySentBody
            ? [
                options.saveAttemptId,
                ...(options.equivalentSaveAttemptIds ?? []),
              ]
            : undefined,
        }
      : {}),
  };
}

// The keepalive copy and the ordinary flush of one pending save share its
// attempt ID, so they must derive this field the same way, including for a
// title-only save.
export function loadedUpdatedAtForSave(
  contentBase: { updatedAt: string | null } | undefined,
  documentUpdatedAt: string | null,
): string | undefined {
  return contentBase?.updatedAt ?? documentUpdatedAt ?? undefined;
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
    icon?: Document["icon"];
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
    lastSavedContentRef.current = {
      content,
      updatedAt: savedAt,
      revision: saved?.revision,
    };
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

function DocumentUnavailable() {
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
        </div>
      </div>
    </div>
  );
}

export function DocumentEditor({
  documentId,
  databaseId,
  databaseDocumentId,
  viewId,
  foreground = false,
}: DocumentEditorProps) {
  return (
    <PageEditorSurface
      // Each page open mounts its own surface, so a read started for the open
      // is adopted instead of refetched by a document switch.
      key={pageEditorSessionKey({ documentId, databaseId, databaseDocumentId })}
      documentId={documentId}
      databaseId={databaseId}
      databaseDocumentId={databaseDocumentId}
      viewId={viewId}
      foreground={foreground}
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

export function suggestionModeCapability(args: {
  permission: boolean;
  bodyReady: boolean;
  primaryFieldAvailable: boolean;
}) {
  return {
    canStart: args.permission && args.bodyReady && args.primaryFieldAvailable,
    canContinue: args.permission,
  };
}

export function PageEditorSurface({
  documentId,
  databaseId,
  databaseDocumentId,
  viewId,
  foreground = false,
  host,
  onSessionChange,
  onDelete,
  focusTitle = false,
  onTitleFocused,
}: PageEditorSurfaceProps) {
  const {
    query: documentQuery,
    fetchedForThisOpen,
    readsStartedEarly,
  } = usePageOpenDocument(documentId, { databaseId, databaseDocumentId });
  const {
    data: queriedDocument,
    dataUpdatedAt,
    error,
    errorUpdateCount,
    errorUpdatedAt,
    isError,
    isFetching,
  } = documentQuery;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const documentQueryKeyValue = documentQueryKey(documentId, {
    databaseId,
    databaseDocumentId,
  });
  useEffect(() => {
    if (readsStartedEarly) return;
    const cached = queryClient.getQueryData<Document>(
      documentQueryKey(documentId, { databaseId, databaseDocumentId }),
    );
    startPreviewDocumentDraftRead(queryClient, documentId, cached);
    if (cached?.source?.mode !== "local-files") {
      startPageOpenReviewReads(queryClient, documentId);
    }
  }, [
    databaseDocumentId,
    databaseId,
    documentId,
    queryClient,
    readsStartedEarly,
  ]);
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
  const optimisticTitle = useOptimisticDocumentTitle(documentId, {
    seededTitle:
      queriedDocument?.id === documentId ? queriedDocument.title : null,
  });
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
    isFetchedAfterMount: fetchedForThisOpen,
    isFetching,
    isError,
    hasLoadFailure: loadFailure.failed,
    isManualRetrying: manualRetryDocumentId === documentId,
    error,
  });
  admittedDocumentIdRef.current = loadState.admittedDocumentId;

  useRecordContentVisit(
    { documentId },
    foreground &&
      host === "page" &&
      !viewId &&
      !!document &&
      !document.database &&
      !isError &&
      fetchedForThisOpen &&
      loadState.view === "editor",
  );

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

  const landingRecovery =
    loadState.view === "unavailable"
      ? contentLandingRecoveryTarget({ host, documentId })
      : null;
  const landingRecoveryDocumentId =
    landingRecovery?.state.unavailableDocumentId ?? null;
  useEffect(() => {
    if (!landingRecoveryDocumentId) return;
    void navigate(CONTENT_LANDING_PATH, {
      replace: true,
      state: { unavailableDocumentId: landingRecoveryDocumentId },
    });
  }, [landingRecoveryDocumentId, navigate]);

  if (loadState.view === "unavailable") {
    return landingRecovery ? (
      <DocumentEditorSkeleton />
    ) : (
      <DocumentUnavailable />
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

  if (
    viewId &&
    document &&
    (!document.database || document.database.id !== databaseId)
  ) {
    return host === "page" ? (
      <Navigate to="/home" replace />
    ) : (
      <DocumentUnavailable />
    );
  }

  if (!document || loadState.view === "skeleton") {
    return (
      <DocumentEditorSkeleton
        title={optimisticTitle}
        iconRow={readPageIconRowHint(documentId)}
        shape={
          document
            ? readDocumentShapeHint(document)
            : readPageShapeHint(documentId)
        }
      />
    );
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
        foreground={
          foreground && host === "page" && !isError && fetchedForThisOpen
        }
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
      currentUserOrgId={session?.orgId}
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
  foreground?: boolean;
}

type PendingDocumentSave = {
  historySessionId: string;
  editorSessionId: string;
  title: string;
  content: string;
  save: (
    title: string,
    content: string,
    options?: DocumentSaveOptions,
  ) => Promise<DocumentSaveResult>;
  canEditWhenQueued: boolean;
  contentEditVersion: number;
  editGeneration: number;
  contentAuthoredAfterRevision?: string;
  authoredContentIntent?: AuthoredContentIntent;
  contentBase: DocumentContentBase;
  titleBase: string;
  contentObservationEpoch: number;
  saveAttemptId: string;
  expectedLocalSourceRevision?: string | null;
  timeout: ReturnType<typeof setTimeout>;
};

type DocumentSaveOptions = {
  historySessionId?: string;
  editorSessionId?: string;
  allowQueuedSave?: boolean;
  expectedLocalSourceRevision?: string | null;
  contentBase?: DocumentContentBase;
  titleBase?: string;
  contentEditVersion?: number;
  editGeneration?: number;
  contentAuthoredAfterRevision?: string;
  authoredContentIntent?: AuthoredContentIntent;
  contentObservationEpoch?: number;
  saveAttemptId?: string;
  equivalentSaveAttemptIds?: string[];
  editorSnapshotTitle?: string;
  editorSnapshotContent?: string;
};

type AuthoredContentIntent = {
  editGeneration: number;
  baseRevision?: string;
  baseContent: string;
  candidateContent: string;
};

type DocumentUpdates = {
  title?: string;
  content?: string;
  description?: string;
  icon?: Document["icon"];
};

export function enqueueDocumentSave<T>(
  queueRef: MutableRefObject<Promise<void>>,
  save: () => Promise<T>,
): Promise<T> {
  const queued = queueRef.current.then(save, save);
  queueRef.current = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
}

export function shouldSubmitDocumentContent(input: {
  changed: boolean;
  stale: boolean;
  canRebase: boolean;
}) {
  return input.changed && (!input.stale || input.canRebase);
}

export function lifecycleKeepaliveDisposition(input: {
  titleChanged: boolean;
  contentChanged: boolean;
  sendsTitle: boolean;
  sendsContent: boolean;
}): "skip" | "send" | "fallback" {
  if (
    (input.titleChanged && !input.sendsTitle) ||
    (input.contentChanged && !input.sendsContent)
  )
    return "fallback";
  if (input.sendsTitle || input.sendsContent) return "send";
  return "skip";
}

export async function retainThenAdoptDisplacedWinner(input: {
  ownerVersion: number;
  currentVersion: () => number;
  ownerGeneration: number;
  currentGeneration: () => number;
  retain: () => Promise<void>;
  adopt: () => void;
}) {
  await input.retain();
  if (
    input.currentVersion() !== input.ownerVersion ||
    input.currentGeneration() !== input.ownerGeneration
  )
    return false;
  input.adopt();
  return true;
}

function useElementMinWidth(
  ref: MutableRefObject<HTMLElement | null>,
  minWidth: number,
) {
  const [matches, setMatches] = useState(false);

  // Measured before the first paint: a page that opens beside the review
  // margin must not first paint without it.
  useLayoutEffect(() => {
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

export type AnchoredCommentPosition = {
  left: number;
  top: number;
  width: number;
  placement: "above" | "below";
};

export function sameAnchoredCommentPosition(
  left: AnchoredCommentPosition | null,
  right: AnchoredCommentPosition | null,
) {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.left === right.left &&
    left.top === right.top &&
    left.width === right.width &&
    left.placement === right.placement
  );
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

type DocumentCommentSurfaceLayout = {
  commentsHistoryDrawerOpen: boolean;
  hasUtilityRailSpace: boolean;
  hasInlineCommentSpace: boolean;
};

function documentEditorHasDesktopCommentSurface(
  args: DocumentCommentSurfaceLayout,
) {
  return args.commentsHistoryDrawerOpen
    ? args.hasUtilityRailSpace
    : args.hasInlineCommentSpace;
}

export function dismissDocumentCommentFocus(
  args: DocumentCommentSurfaceLayout & {
    closeReply: () => void;
    clearFocus: () => void;
    closePanel: () => void;
  },
) {
  args.closeReply();
  args.clearFocus();
  if (!documentEditorHasDesktopCommentSurface(args)) args.closePanel();
}

export function documentEditorShowsUtilityPanelSheet(
  args: DocumentCommentSurfaceLayout & {
    utilityPanel: DocumentUtilityPanel;
    selectedSuggestionId: string | null;
  },
) {
  if (args.utilityPanel === "comments") {
    return (
      !documentEditorHasDesktopCommentSurface(args) &&
      (args.commentsHistoryDrawerOpen || !!args.selectedSuggestionId)
    );
  }
  return args.utilityPanel === "info" && !args.hasUtilityRailSpace;
}

export {
  documentEditorDatabaseRegionClassName,
  documentEditorTitleRegionClassName,
};

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

export function databaseConversionRequest(
  documentId: string,
  currentTitle: string,
  currentDescription?: string | null,
) {
  return {
    documentId,
    title: currentTitle,
    description: currentDescription?.trim() || undefined,
  };
}

export function documentEditorDefaultIconKind(
  document: Pick<Document, "database">,
) {
  return document.database ? "database" : null;
}

export function databaseMembershipDatabaseTitle(
  membership: Document["databaseMembership"],
) {
  return membership?.databaseTitle?.trim() || "Untitled collection";
}

export function documentEditorBreadcrumbItems(
  document: Pick<
    Document,
    "id" | "parentId" | "title" | "icon" | "databaseMembership"
  >, // i18n-ignore type expression
  documents: Pick<Document, "id" | "parentId" | "title" | "icon">[], // i18n-ignore type expression
) {
  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  const parents: { id: string; title: string; icon: Document["icon"] }[] = [];
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
  navigationPath: Pick<
    ContentNavigationPathEntry,
    "id" | "parentId" | "databaseId"
  >[] = [], // i18n-ignore type expression
): ToolbarBreadcrumbItem[] {
  const peerDocuments = documents.filter(
    (item) => !item.database?.systemRole && item.source?.kind !== "folder",
  );
  const documentById = new Map(documents.map((item) => [item.id, item]));
  const pathEntryById = new Map(
    navigationPath.map((entry) => [entry.id, entry]),
  );
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
    if (!current) {
      const entry = item.id ? pathEntryById.get(item.id) : undefined;
      // Peers of an item under an unreadable parent are not listable.
      if (
        !entry?.databaseId ||
        (entry.parentId !== null && !pathEntryById.has(entry.parentId))
      ) {
        return item;
      }
      return {
        ...item,
        filesDatabaseId: entry.databaseId,
        siblings: {
          filesDatabaseId: entry.databaseId,
          parentId: entry.parentId,
        },
      };
    }
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
    const filesDatabaseId = current.databaseMembership?.databaseId ?? null;
    if (siblings.length < 2) return { ...item, filesDatabaseId };
    return {
      ...item,
      filesDatabaseId,
      menuItems: siblings.map((sibling) => ({
        id: sibling.id,
        title: sibling.title,
        icon: sibling.icon,
        filesDatabaseId: sibling.databaseMembership?.databaseId ?? null,
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
  foreground = false,
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
  const queryClient = useQueryClient();
  useEffect(() => {
    if (host !== "page" || document.database?.systemRole) return;
    const target = {
      documentId,
      ...(currentDocumentRef.current?.title?.trim()
        ? { title: currentDocumentRef.current.title }
        : {}),
      ...(databaseId ? { databaseId } : {}),
      ...(viewId ? { viewId } : {}),
    };
    rememberLandingTitleHint(queryClient, target);
    void rememberContentLandingDocument(
      target,
      document.spaceId ?? undefined,
    ).catch((error) => {
      toast.error(t("landing.saveFailed"), {
        description:
          error instanceof Error ? error.message : t("empty.genericError"),
      });
    });
  }, [
    databaseId,
    document.database?.systemRole,
    document.spaceId,
    documentId,
    host,
    queryClient,
    viewId,
    t,
  ]);
  const updateDocument = useUpdateDocument();
  const resolvePreviewDocumentDraft = useResolvePreviewDocumentDraft();
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
  const processBuilderBodies = useProcessBuilderBodyHydration(
    document.bodyHydration?.databaseDocumentId ?? documentId,
  );
  const canEdit = document.canEdit === true;
  const canEditRef = useRef(canEdit);
  const navigate = useNavigate();
  const location = useLocation();
  const contentSpacesQuery = useContentSpaces();
  const contentSpaces = contentSpacesQuery.data?.spaces ?? [];
  const localWorkspaceMode =
    contentSpacesQuery.data?.sourceMode === "local-files";
  const localDocumentsQuery = useDocuments({ enabled: localWorkspaceMode });
  const localDocuments = useMemo<Document[]>(
    () => (localWorkspaceMode ? (localDocumentsQuery.data ?? []) : []),
    [localDocumentsQuery.data, localWorkspaceMode],
  );
  const navigationContextQuery = useContentNavigationContext(
    host === "page" ? documentId : null,
  );
  const navigationPath = useMemo(
    () =>
      navigationContextQuery.data?.document.id === documentId
        ? navigationContextQuery.data.path
        : [],
    [documentId, navigationContextQuery.data],
  );
  const workspaceSelectionQueueRef = useRef(createContentSpaceSelectionQueue());
  const [, setStoredSpaceId] = useLocalStorage<string | null>(
    SELECTED_CONTENT_SPACE_STORAGE_KEY,
    null,
  );
  const [autoSync] = useLocalStorage(`notion-auto-sync:${documentId}`, false);
  const isLocalFileDocument = document.source?.mode === "local-files";
  const canComment =
    !isLocalFileDocument &&
    (document.canComment ??
      (document.accessRole === "owner" ||
        document.accessRole === "admin" ||
        document.accessRole === "editor" ||
        document.accessRole === "commenter"));
  const createSuggestionProposal = useCreateResourceSuggestionProposal();
  const updateSuggestion = useUpdateResourceSuggestion();
  const decideSuggestion = useDecideResourceSuggestion();
  const decideSuggestionProposal = useDecideResourceSuggestionProposal();
  const suggestionsQuery = useResourceSuggestions(
    { resourceType: "document", resourceId: documentId },
    { enabled: !isLocalFileDocument },
  );
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isStartingSuggestion, setIsStartingSuggestion] = useState(false);
  const startingSuggestionRef = useRef(false);
  const [pendingSuggestionDecision, setPendingSuggestionDecision] = useState<{
    suggestion: ResourceSuggestion;
    decision: SuggestionDecision;
    continueSuggesting: boolean;
    optimistic: boolean;
    readbackContent: string | null;
  } | null>(null);
  const [pendingProposalDecision, setPendingProposalDecision] = useState<{
    generation: number;
    continueSuggesting: boolean;
    requestedDecision: SuggestionDecision;
    accepted: boolean;
    members: ResourceSuggestion[];
    beforeContent: string;
    readbackContent: string | null;
  } | null>(null);
  const [
    suggestionPresentationTransitions,
    setSuggestionPresentationTransitions,
  ] = useState<{
    documentId: string;
    entries: SuggestionPresentationTransitions;
  }>(() => ({ documentId, entries: new Map() }));
  const proposalDecisionInFlightRef = useRef(false);
  const proposalDecisionKeysRef = useRef(new Map<string, string>());
  const [decisionRefreshFailed, setDecisionRefreshFailed] = useState(false);
  const decisionRefreshInFlightRef = useRef<number | null>(null);
  const [decisionReadbackDivergence, setDecisionReadbackDivergence] = useState<{
    suggestionId: string;
    actualContent: string;
  } | null>(null);
  const [
    proposalDecisionReadbackDivergence,
    setProposalDecisionReadbackDivergence,
  ] = useState<{ generation: number; actualContent: string } | null>(null);
  const suggestionDecisionInFlightRef = useRef(false);
  const suggestionDecisionGenerationRef = useRef(0);
  const suggestionDecisionDocumentIdRef = useRef(documentId);
  suggestionDecisionDocumentIdRef.current = documentId;
  const activeSuggestionDecisionIdRef = useRef<string | null>(null);
  const [preserveInlineReviewSpace, setPreserveInlineReviewSpace] =
    useState(false);
  const blockRenderContext = useMemo(
    () =>
      createContentBlockRenderContext({
        documentId,
        canEdit: documentCanonicalMutationsEnabled(canEdit, isSuggesting),
      }),
    [documentId, canEdit, isSuggesting],
  );
  const [isSubmittingSuggestions, setIsSubmittingSuggestions] = useState(false);
  const [suggestionDraftSaveFailed, setSuggestionDraftSaveFailed] =
    useState(false);
  const [suggestionAmendmentConflict, setSuggestionAmendmentConflict] =
    useState(false);
  const [suggestionDraft, setSuggestionDraft] = useState(document.content);
  const [anchoredSuggestionIds, setAnchoredSuggestionIds] = useState<
    string[] | null
  >(null);
  const handleSuggestionAnchorsChange = useCallback(
    (next: string[]) => {
      if (isSuggesting) return;
      setAnchoredSuggestionIds((current) =>
        sameSuggestionAnchorIds(current, next) ? current : next,
      );
    },
    [isSuggesting],
  );
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<
    string | null
  >(null);
  const [hoveredSuggestionId, setHoveredSuggestionId] = useState<string | null>(
    null,
  );
  const [editingSuggestionId, setEditingSuggestionId] = useState<string | null>(
    null,
  );
  const [suggestionInitialSelection, setSuggestionInitialSelection] = useState<
    | { from: number; prefix: string; suffix: string }
    | VisualEditorSelectionSnapshot
    | null
  >(null);
  const suggestionBaseRef = useRef<SuggestionDraftSession | null>(null);
  const createdSuggestionOperationsRef = useRef(new Map());
  const suggestionProposalsRef = useRef(
    new Map<string, { id: string; summary: string }>(),
  );
  const suggestionProposalCreationKeysRef = useRef(new Map<string, string>());
  const unresolvedProposalCreationRef = useRef<{
    baseId: string;
    request: Parameters<typeof createSuggestionProposal.mutateAsync>[0];
    pendingKeys: string[];
    operations: ReturnType<typeof suggestionDraftOperations>;
  } | null>(null);
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
  const [primaryFieldAvailability, setPrimaryFieldAvailability] = useState<{
    scope: string;
    available: boolean;
  } | null>(null);
  const handlePrimaryFieldAvailabilityChange = useCallback(
    (scope: string, available: boolean) => {
      setPrimaryFieldAvailability((current) =>
        current?.scope === scope && current.available === available
          ? current
          : { scope, available },
      );
    },
    [],
  );
  const databaseFieldScope = document.databaseMembership
    ? pageEditorSessionKey({
        documentId,
        databaseId: databaseId ?? document.databaseMembership.databaseId,
        databaseDocumentId:
          databaseDocumentId ?? document.databaseMembership.databaseDocumentId,
      })
    : null;
  const suggestionCapability = suggestionModeCapability({
    permission: canComment && document.canSuggest === true,
    bodyReady:
      !documentBodyHydrationIsPending(document) &&
      document.bodyHydration?.hydration?.status !== "error",
    primaryFieldAvailable:
      databaseFieldScope === null ||
      (primaryFieldAvailability?.scope === databaseFieldScope &&
        primaryFieldAvailability.available),
  });
  const canSuggest = suggestionCapability.canStart;
  const canStartSuggestionRef = useRef(canSuggest);
  canStartSuggestionRef.current = canSuggest;
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
  const reconcileRecoveryStateRef =
    useRef<DocumentReconcileRecoveryState | null>(null);
  const reconcileSaveRef = useRef<
    (
      draft: ReconcileRecoveryDraft,
      base?: ReconcileSaveBase,
    ) => Promise<boolean>
  >(async () => false);
  const reconcileRetainRef = useRef<
    (draft: ReconcileRecoveryDraft) => Promise<void>
  >(async () => undefined);
  const reportReconcileRef = useRef<
    (reason: "conflict" | "failed", localDraft: string) => void
  >(() => undefined);
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
  const editorSelectionControllerRef =
    useRef<VisualEditorSelectionController | null>(null);
  const pageActionsSelectionRef = useRef<VisualEditorSelectionSnapshot | null>(
    null,
  );
  const editorEscapeTargetRef = useRef<HTMLButtonElement>(null);
  const editorPersistenceControllerRef =
    useRef<VisualEditorPersistenceController | null>(null);
  const [editorHistoryState, setEditorHistoryState] =
    useState<VisualEditorHistoryState>({ canUndo: false, canRedo: false });
  const editorHistoryStateRef = useRef(editorHistoryState);
  const handleHistoryStateChange = useCallback(
    (next: VisualEditorHistoryState) => {
      const current = editorHistoryStateRef.current;
      if (
        current.canUndo === next.canUndo &&
        current.canRedo === next.canRedo
      ) {
        return;
      }
      editorHistoryStateRef.current = next;
      if (isSuggesting) return;
      setEditorHistoryState(next);
    },
    [isSuggesting],
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
    editorSessionId: string | null;
    editGeneration: number | null;
    supersedable?: boolean;
  } | null>(null);
  const lastSavedTitleRef = useRef<{ title: string; updatedAt: string | null }>(
    { title: "", updatedAt: null },
  );
  const lastSavedContentRef = useRef<ContentSaveWatermark>({
    content: "",
    updatedAt: null,
    revision: undefined,
  });
  const isInitializedRef = useRef(false);
  const prevDocIdRef = useRef<string | null>(null);
  const localTitleRef = useRef(localTitle);
  localTitleRef.current = localTitle;
  const localContentRef = useRef(localContent);
  const contentEditVersionRef = useRef(0);
  const confirmedContentEditVersionRef = useRef(0);
  const contentObservationEpochRef = useRef(0);
  const editorEditGenerationRef = useRef(0);
  const authoredContentIntentRef = useRef<AuthoredContentIntent | null>(null);
  const ownContentSaveLineageRef = useRef<OwnContentSaveLineage>(new Map());
  const editorSessionIdRef = useRef<string | null>(null);
  if (editorSessionIdRef.current === null) {
    editorSessionIdRef.current = `${TAB_ID}:${documentId}:${crypto.randomUUID()}`;
  }
  useRegisterLiveEditorSession(editorSessionIdRef.current);
  localContentRef.current = localContent;
  const reconcileRecovery = useDocumentReconcileRecovery({
    save: (draft, base) => reconcileSaveRef.current(draft, base),
    retain: (draft) => reconcileRetainRef.current(draft),
    getDraft: () => localContentRef.current,
    getTitle: () => localTitleRef.current,
    getSaveIdentity: () =>
      JSON.stringify([localTitleRef.current, localContentRef.current]),
    stateRef: reconcileRecoveryStateRef,
  });
  const documentReconcileConflict = reconcileRecovery.state;
  const {
    report: reportReconcile,
    resolve: resolveReconcile,
    resolveAutomatically: resolveReconcileAutomatically,
    resolveChoice: resolveReconcileChoice,
    updateDraft: updateReconcileDraft,
    reportRetentionFailure,
  } = reconcileRecovery;
  const retainActiveRecoveryDraft = useCallback(
    (draft: ReconcileRecoveryDraft) => {
      void reconcileRetainRef.current(draft).catch(reportRetentionFailure);
    },
    [reportRetentionFailure],
  );
  const [acknowledgedLocalSnapshot, setAcknowledgedLocalSnapshot] = useState<{
    value: string;
    revision: string;
    updatedAt: string;
    sequence: number;
  } | null>(null);
  const acknowledgedLocalSnapshotSequenceRef = useRef(0);
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
  const documentTitleRef = useRef(document.title);
  documentTitleRef.current = document.title;
  const documentRevisionRef = useRef(document.revision);
  documentRevisionRef.current = document.revision;
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
  const handleOpenNotionPageLink = useCallback(
    (linkedDocumentId: string) => {
      void navigate(`/page/${linkedDocumentId}`, { flushSync: true });
    },
    [navigate],
  );

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

  const { session } = useSession();
  const journalWriteErrorShownRef = useRef(false);
  const journalScope = useCallback(
    () =>
      session?.email
        ? {
            accountId: session.email,
            orgId: session.orgId ?? null,
            documentId,
            writerId: editorSessionIdRef.current!,
          }
        : null,
    [documentId, session?.email, session?.orgId],
  );
  const journalCurrentDraft = useCallback(
    (
      title: string,
      content: string,
      editGeneration: number,
      prepared?: {
        saveAttemptId: string;
        equivalentSaveAttemptIds?: string[];
        contentBase: ContentSaveWatermark;
        titleBase: string;
        authoredContentIntent?: AuthoredContentIntent;
      },
    ) => {
      if (isLocalFileDocument || isLinkedLocalSourceDocument) return;
      const scope = journalScope();
      if (!scope) return;
      const authored =
        prepared?.authoredContentIntent ??
        (authoredContentIntentRef.current?.editGeneration === editGeneration
          ? authoredContentIntentRef.current
          : null);
      try {
        writePageDraftJournal({
          scope,
          snapshot: {
            title,
            content,
            baseTitle: prepared?.titleBase ?? lastSavedTitleRef.current.title,
            baseContent:
              prepared?.contentBase.content ??
              lastSavedContentRef.current.content,
            baseUpdatedAt:
              prepared?.contentBase.updatedAt ??
              lastSavedContentRef.current.updatedAt ??
              null,
            baseRevision:
              prepared?.contentBase.revision ??
              lastSavedContentRef.current.revision,
            editGeneration,
            saveAttemptId: prepared?.saveAttemptId,
            ...(prepared?.equivalentSaveAttemptIds?.length
              ? { equivalentSaveAttemptIds: prepared.equivalentSaveAttemptIds }
              : {}),
            ...(authored?.baseRevision &&
            authoredCandidateMatchesContent(content, authored.candidateContent)
              ? {
                  authoredBaseRevision: authored.baseRevision,
                  authoredBaseContent: authored.baseContent,
                  authoredCandidateContent: authored.candidateContent,
                }
              : {}),
          },
        });
        journalWriteErrorShownRef.current = false;
      } catch {
        if (!journalWriteErrorShownRef.current) {
          toast.error(t("editor.pageSaveBeforeNavigationFailed"));
          journalWriteErrorShownRef.current = true;
        }
      }
    },
    [isLinkedLocalSourceDocument, isLocalFileDocument, journalScope, t],
  );
  const clearConfirmedDraftJournal = useCallback(
    (
      saved: Document & {
        bodyIntentOutcome?: { status: "applied" | "displaced-preserved" };
      },
      editGeneration: number,
    ) => {
      const scope = journalScope();
      if (!scope) return;
      try {
        if (saved.bodyIntentOutcome) {
          clearPageDraftJournalGeneration(scope, editGeneration);
        } else {
          clearPageDraftJournal(scope, {
            editGeneration,
            title: saved.title,
            content: saved.content,
          });
        }
      } catch {
        if (!journalWriteErrorShownRef.current) {
          toast.error(t("editor.pageSaveBeforeNavigationFailed"));
          journalWriteErrorShownRef.current = true;
        }
      }
    },
    [journalScope, t],
  );
  const currentUserAvatarUrl = useAvatarUrl(session?.email);
  const currentUser: CollabUser | undefined = session?.email
    ? {
        name: session.name?.trim() || emailToName(session.email),
        email: session.email,
        color: emailToColor(session.email),
        avatarUrl: currentUserAvatarUrl ?? undefined,
      }
    : undefined;

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
  const collabEditorEnabled =
    collabEnabled &&
    canEdit &&
    !bodyHydrationPending &&
    collabSynced &&
    collabInitialization.status === "ready" &&
    !collabInitializationFailed;
  const suggestionEditorIsolation = suggestedEditorIsolation({
    suggesting: isSuggesting,
    canSuggest: suggestionCapability.canContinue,
    canEdit: editorCanEdit,
    collaborationReady: collabEditorEnabled,
  });
  canEditRef.current = editorCanEdit;

  useEffect(() => {
    if (!awareness || !collabEnabled) return;
    awareness.setLocalStateField("canFlushDocument", editorCanEdit);
    return () => {
      awareness.setLocalStateField("canFlushDocument", false);
    };
  }, [awareness, collabEnabled, editorCanEdit]);

  useEffect(() => {
    if (!document) return;
    if (prevDocIdRef.current !== documentId) {
      historySessionRef.current.reset();
      ownContentSaveLineageRef.current.clear();
      prevDocIdRef.current = documentId;
      isInitializedRef.current = false;
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
        revision: document.revision,
      };
      isInitializedRef.current = true;
      if (!document.title) {
        shouldFocusTitleRef.current = true;
      }
    }
  }, [document, documentId]);

  useEffect(() => {
    if (!document || !isInitializedRef.current) return;
    if (isLinkedLocalSourceDocument) return;
    if (reconcileRecoveryStateRef.current) return;
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
        revision: document.revision,
      };
    }
  }, [
    document,
    isLinkedLocalSourceDocument,
    contentExternalIsNewer,
    localContent,
    documentReconcileConflict,
  ]);

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
        revision: document.revision,
      };
    }
  }, [document, isLinkedLocalSourceDocument, localTitle, localContent]);

  const pendingPersistenceRef = useRef(
    new Set<Promise<Document | DocumentUpdateResult>>(),
  );
  const persistenceErrorsRef = useRef(
    new Map<keyof DocumentUpdates, unknown>(),
  );
  const persistDocumentUpdatesUntracked = useCallback(
    async (
      updates: DocumentUpdates,
      options: DocumentSaveOptions = {},
    ): Promise<Document | DocumentUpdateResult> => {
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
        const baseUpdatedAt =
          updates.content !== undefined
            ? ((options.contentBase ?? lastSavedContentRef.current).updatedAt ??
              undefined)
            : undefined;
        const baseRevision =
          updates.content !== undefined
            ? (options.contentBase ?? lastSavedContentRef.current).revision
            : undefined;
        return await updateDocument.mutateAsync({
          id: documentId,
          loadedUpdatedAt: loadedUpdatedAtForSave(
            options.contentBase,
            documentUpdatedAtRef.current,
          ),
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
          editorSessionId: options.editorSessionId,
          editorEditGeneration: options.editGeneration,
          browserSaveAttemptId: options.saveAttemptId,
          ...(updates.content !== undefined &&
          options.authoredContentIntent &&
          authoredCandidateMatchesContent(
            updates.content,
            options.authoredContentIntent?.candidateContent,
          )
            ? {
                authoredBaseRevision:
                  options.authoredContentIntent.baseRevision,
                authoredBaseContent: options.authoredContentIntent.baseContent,
                authoredCandidateContent:
                  options.authoredContentIntent.candidateContent,
              }
            : {}),
          editorSnapshotTitle: options.editorSnapshotTitle,
          editorSnapshotContent: options.editorSnapshotContent,
          ...(baseUpdatedAt !== undefined ? { baseUpdatedAt } : {}),
          ...(baseRevision !== undefined ? { baseRevision } : {}),
          ...(updates.title !== undefined
            ? {
                baseTitle: options.titleBase ?? lastSavedTitleRef.current.title,
              }
            : {}),
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
          if (isDocumentUpdateSuperseded(result)) {
            return;
          } else if (
            isDocumentUpdateConflict(result) ||
            isDocumentUpdatePreservationRequired(result)
          ) {
            const error = new Error(
              "The page changed before the latest edit could be saved.",
            );
            for (const field of fields) {
              persistenceErrorsRef.current.set(field, error);
            }
          } else {
            if (
              updates.content !== undefined &&
              result.revision &&
              result.updatedAt
            ) {
              const snapshot = {
                value: result.content,
                revision: result.revision,
                updatedAt: result.updatedAt,
                sequence: ++acknowledgedLocalSnapshotSequenceRef.current,
              };
              setAcknowledgedLocalSnapshot((current) =>
                !current || snapshot.sequence > current.sequence
                  ? snapshot
                  : current,
              );
            }
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
                lastSavedContentRef.current.revision = result.revision;
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
      revision: document.revision,
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
      options = {
        ...options,
        editorSnapshotTitle: title,
        editorSnapshotContent: content,
      };
      const contentEditVersion =
        options.contentEditVersion ?? contentEditVersionRef.current;
      const editorEditGeneration =
        options.editGeneration ?? editorEditGenerationRef.current;
      const contentObservationEpoch =
        options.contentObservationEpoch ?? contentObservationEpochRef.current;
      lastSavedContentRef.current = refreshUnchangedContentSaveWatermark({
        serverContent: documentContentRef.current,
        serverUpdatedAt: documentUpdatedAtRef.current,
        lastSaved: lastSavedContentRef.current,
      });
      const adopted = adoptOwnConfirmedBases(options, content, (captured) =>
        ownConfirmedContentBase({
          captured,
          latest: lastSavedContentRef.current,
          lineage: ownContentSaveLineageRef.current,
          editGeneration: editorEditGeneration,
        }),
      );
      // Page recovery looks up the journaled attempt ID, so record a minted
      // replacement before any branch below can send it.
      if (
        adopted.saveAttemptId &&
        adopted.saveAttemptId !== options.saveAttemptId &&
        contentEditVersionRef.current === contentEditVersion &&
        contentObservationEpochRef.current === contentObservationEpoch &&
        editorEditGenerationRef.current === editorEditGeneration
      ) {
        journalCurrentDraft(title, content, editorEditGeneration, {
          saveAttemptId: adopted.saveAttemptId,
          equivalentSaveAttemptIds: adopted.equivalentSaveAttemptIds,
          contentBase: adopted.contentBase ?? lastSavedContentRef.current,
          titleBase: adopted.titleBase ?? lastSavedTitleRef.current.title,
          authoredContentIntent: adopted.authoredContentIntent,
        });
      }
      options = adopted;
      const titleIsStale =
        !isLinkedLocalSourceDocument &&
        options.titleBase === undefined &&
        documentUpdatedAtRef.current &&
        lastSavedTitleRef.current.updatedAt &&
        documentUpdatedAtRef.current > lastSavedTitleRef.current.updatedAt;
      const contentBase = options.contentBase ?? lastSavedContentRef.current;
      if (
        titleRenamedByAnotherWriter({
          documentTitle: documentTitleRef.current,
          titleBase: options.titleBase,
          title,
        })
      ) {
        return { contentPersisted: false };
      }
      const contentIsStale =
        !isLinkedLocalSourceDocument &&
        !!documentRevisionRef.current &&
        !!contentBase.revision &&
        documentRevisionRef.current !== contentBase.revision;

      const updates: Record<string, string> = {};
      if (title !== lastSavedTitleRef.current.title && !titleIsStale)
        updates.title = title;
      const contentChanged = content !== contentBase.content;
      if (
        shouldSubmitDocumentContent({
          changed: contentChanged,
          stale: contentIsStale,
          canRebase: !isLinkedLocalSourceDocument && !isLocalFileDocument,
        })
      )
        updates.content = content;
      const hasUpdates = Object.keys(updates).length > 0;
      if (
        shouldAttestUnchangedEditorSave({
          hasUpdates,
          contentChanged,
          editorSessionId: options.editorSessionId,
          editGeneration: options.editGeneration,
          isLinkedLocalSource: isLinkedLocalSourceDocument,
          isLocalFile: isLocalFileDocument,
        })
      ) {
        const attested = await persistDocumentUpdates(
          { title, content },
          options,
        );
        return {
          contentPersisted:
            !isDocumentUpdateConflict(attested) &&
            !isDocumentUpdateSuperseded(attested) &&
            !isDocumentUpdatePreservationRequired(attested),
        };
      }
      if (!hasUpdates) {
        return { contentPersisted: !contentChanged };
      }

      let saved: Document | DocumentUpdateResult;
      if (
        updates.content !== undefined &&
        !isLinkedLocalSourceDocument &&
        !isLocalFileDocument
      ) {
        const savedTitle = lastSavedTitleRef.current.title;
        let rebaseAttempt = 0;
        activeContentSavesRef.current += 1;
        let result;
        try {
          result = await saveDocumentWithRebase({
            base: { ...contentBase },
            content,
            owner: {
              version: contentEditVersion,
              observationEpoch: contentObservationEpoch,
              current: () => ({
                version: contentEditVersionRef.current,
                content: localContentRef.current,
                observationEpoch: contentObservationEpochRef.current,
              }),
              canPreferLive: (winner) =>
                !!winner.revision &&
                options.contentAuthoredAfterRevision === winner.revision,
              confirm: (confirmedContent) => {
                localContentRef.current = confirmedContent;
                setLocalContent(confirmedContent);
              },
            },
            canRetry: (winner) =>
              updates.title === undefined ||
              winner.title === savedTitle ||
              winner.title === updates.title,
            confirmsWrite: (winner) =>
              updates.title === undefined || winner.title === updates.title,
            persist: (nextContent, contentBase) => {
              const reusedAttemptId =
                rebaseAttempt++ === 0 ? options.saveAttemptId : undefined;
              const saveAttemptId = reusedAttemptId ?? crypto.randomUUID();
              if (
                contentEditVersionRef.current === contentEditVersion &&
                contentObservationEpochRef.current ===
                  contentObservationEpoch &&
                editorEditGenerationRef.current === editorEditGeneration
              ) {
                journalCurrentDraft(title, nextContent, editorEditGeneration, {
                  saveAttemptId,
                  ...(reusedAttemptId
                    ? {
                        equivalentSaveAttemptIds:
                          options.equivalentSaveAttemptIds,
                      }
                    : {}),
                  contentBase,
                  titleBase:
                    options.titleBase ?? lastSavedTitleRef.current.title,
                  authoredContentIntent: options.authoredContentIntent,
                });
              }
              return persistDocumentUpdates(
                { ...updates, content: nextContent },
                {
                  ...options,
                  contentBase,
                  saveAttemptId,
                  editorSnapshotContent: nextContent,
                },
              );
            },
          });
        } finally {
          activeContentSavesRef.current -= 1;
        }
        if (result.status === "preservation") {
          toast.error(t("editor.pageSaveBeforeNavigationFailed"));
          return {
            contentPersisted: false,
            outcome: "pending_preservation",
            recoveryDraft: {
              title,
              content: result.localDraft,
              baseContent: result.base.content,
              baseUpdatedAt: result.base.updatedAt,
              baseRevision: result.base.revision,
            },
          };
        }
        if (result.status === "conflict") {
          return {
            contentPersisted: false,
            recoveryDraft: {
              title,
              content: result.localDraft,
              baseContent: result.base?.content,
              baseUpdatedAt: result.base?.updatedAt,
              baseRevision: result.base?.revision,
            },
          };
        }
        if (result.status === "superseded") {
          return { contentPersisted: false, outcome: "superseded" };
        }
        if (result.status === "displaced") {
          const adopted = await retainThenAdoptDisplacedWinner({
            ownerVersion: contentEditVersion,
            currentVersion: () => contentEditVersionRef.current,
            ownerGeneration: editorEditGeneration,
            currentGeneration: () => editorEditGenerationRef.current,
            retain: () =>
              reconcileRetainRef.current({
                localTitle: title,
                localDraft: result.localDraft,
              }),
            adopt: () => {
              localContentRef.current = result.document.content;
              setLocalContent(result.document.content);
            },
          });
          if (!adopted) {
            return { contentPersisted: false, outcome: "superseded" };
          }
          saved = result.document;
          content = result.document.content;
          updates.content = content;
        } else {
          saved = result.document;
          content = result.content;
          updates.content = content;
        }
      } else {
        saved = await persistDocumentUpdates(updates, options);
      }
      if (
        isDocumentUpdateConflict(saved) ||
        isDocumentUpdateSuperseded(saved) ||
        isDocumentUpdatePreservationRequired(saved)
      ) {
        return { contentPersisted: false };
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
      if (
        updates.content !== undefined &&
        saved.revision &&
        contentBase.revision &&
        saved.content === options.editorSnapshotContent
      ) {
        recordOwnContentSave(ownContentSaveLineageRef.current, saved.revision, {
          baseRevision: contentBase.revision,
          editGeneration: editorEditGeneration,
        });
      }
      if (
        contentEditVersionRef.current === contentEditVersion &&
        contentObservationEpochRef.current === contentObservationEpoch
      ) {
        confirmedContentEditVersionRef.current = contentEditVersion;
        if (
          saved.title === localTitleRef.current &&
          saved.content === localContentRef.current
        ) {
          clearConfirmedDraftJournal(saved, editorEditGeneration);
        }
      }

      if (autoSync) {
        const status = queryClient.getQueryData<DocumentSyncStatus>(
          documentSyncStatusQueryKey(documentId),
        );
        if (status?.pageId && !status.hasConflict) {
          try {
            const next = await pushDocumentToNotion.mutateAsync({
              documentId,
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
      clearConfirmedDraftJournal,
      isLinkedLocalSourceDocument,
      isLocalFileDocument,
      journalCurrentDraft,
      persistDocumentUpdates,
      pushDocumentToNotion,
      queryClient,
      t,
    ],
  );
  const retainRecoveryDraft = useCallback(
    async (
      title: string,
      content: string,
      deferredReason: "conflict" | null,
      editorSessionId: string,
      editGeneration: number,
      contentBase: DocumentContentBase = lastSavedContentRef.current,
      supersedable = false,
    ) => {
      const current = recoveryDraftRef.current;
      const result = await updatePreviewDocumentDraftRef.current({
        operation: "upsert",
        documentId,
        expectedVersion: current?.version ?? null,
        draft: {
          title,
          content,
          baseDocumentUpdatedAt: contentBase.updatedAt,
          loadedContentWasEmpty: isEffectivelyEmptyDocumentContent(
            contentBase.content,
          ),
          deferredReason,
          editorSessionId,
          editGeneration,
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
          editorSessionId: result.draft.editorSessionId,
          editGeneration: result.draft.editGeneration,
          supersedable,
        };
        return;
      }
      if (
        result.status === "conflict" &&
        result.draft?.editorSessionId === editorSessionId &&
        result.draft?.title === title &&
        result.draft.content === content
      ) {
        recoveryDraftRef.current = {
          version: result.draft.version,
          title,
          content,
          editorSessionId: result.draft.editorSessionId,
          editGeneration: result.draft.editGeneration,
          supersedable,
        };
        return;
      }
      if (result.status === "superseded" && result.draft === null) return;
      throw new Error(t("editor.pageSaveBeforeNavigationFailed"));
    },
    [documentId, t],
  );
  const recoveryDraftRetentionQueueRef = useRef<Promise<void>>(
    Promise.resolve(),
  );
  const queueRecoveryDraftRetention = useCallback(
    (
      title: string,
      content: string,
      deferredReason: "conflict" | null,
      editorSessionId: string,
      editGeneration: number,
      contentBase?: DocumentContentBase,
    ) => {
      const retain = () =>
        retainRecoveryDraft(
          title,
          content,
          deferredReason,
          editorSessionId,
          editGeneration,
          contentBase,
        );
      const queued = recoveryDraftRetentionQueueRef.current.then(
        retain,
        retain,
      );
      recoveryDraftRetentionQueueRef.current = queued.catch(() => undefined);
      return queued;
    },
    [retainRecoveryDraft],
  );
  const clearRecoveryDraft = useCallback(
    async (
      persistedTitle: string,
      persistedContent: string,
      persistedBy?: { editorSessionId: string; editGeneration: number },
    ) => {
      const current = recoveryDraftRef.current;
      if (
        !current ||
        !(
          mayClearRecoveryDraft(current, {
            title: persistedTitle,
            content: persistedContent,
          }) ||
          (persistedBy &&
            ownRecoveryDraftSupersededBySave(current, persistedBy))
        )
      ) {
        return;
      }
      const result = await updatePreviewDocumentDraftRef.current({
        operation: "delete",
        documentId,
        expectedVersion: current.version,
        expectedTitle: current.title,
        expectedContent: current.content,
        expectedEditorSessionId: current.editorSessionId ?? undefined,
        expectedEditGeneration: current.editGeneration ?? undefined,
      });
      if (result.status !== "deleted" && result.draft !== null) {
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
      const editorSessionId =
        options.editorSessionId ?? editorSessionIdRef.current!;
      const editGeneration =
        options.editGeneration ?? editorEditGenerationRef.current;
      const contentObservationEpoch =
        options.contentObservationEpoch ?? contentObservationEpochRef.current;
      const contentBase = {
        ...(options.contentBase ?? lastSavedContentRef.current),
      };
      const saveAttemptId = options.saveAttemptId ?? crypto.randomUUID();
      const contentAuthoredAfterRevision =
        options.contentAuthoredAfterRevision ??
        lastSavedContentRef.current.revision;
      const authoredContentIntent =
        options.authoredContentIntent ??
        (authoredContentIntentRef.current?.editGeneration === editGeneration
          ? authoredContentIntentRef.current
          : undefined);
      return enqueueDocumentSave(documentSaveQueueRef, () =>
        savePageWithRecovery({
          save: () =>
            saveDocumentImmediately(title, content, {
              ...options,
              contentEditVersion,
              historySessionId:
                options.historySessionId ??
                historySessionRef.current.activity(documentId),
              editorSessionId,
              editGeneration,
              contentBase,
              contentObservationEpoch,
              saveAttemptId,
              contentAuthoredAfterRevision,
              authoredContentIntent: authoredCandidateMatchesContent(
                content,
                authoredContentIntent?.candidateContent,
              )
                ? authoredContentIntent
                : undefined,
            }),
          retain: (reason, result) => {
            const snapshotChanged =
              contentEditVersionRef.current !== contentEditVersion ||
              contentObservationEpochRef.current !== contentObservationEpoch;
            const recovery = result?.recoveryDraft;
            return retainRecoveryDraft(
              snapshotChanged
                ? localTitleRef.current
                : (recovery?.title ?? title),
              snapshotChanged
                ? localContentRef.current
                : (recovery?.content ?? content),
              reason,
              editorSessionId,
              snapshotChanged
                ? editorEditGenerationRef.current
                : editGeneration,
              recovery && !snapshotChanged && recovery.baseContent !== undefined
                ? {
                    content: recovery.baseContent,
                    updatedAt: recovery.baseUpdatedAt ?? null,
                    revision: recovery.baseRevision,
                  }
                : contentBase,
              // The editor keeps this text and a later save of it lands.
              true,
            );
          },
          clear: () =>
            clearRecoveryDraft(
              lastSavedTitleRef.current.title,
              lastSavedContentRef.current.content,
              { editorSessionId, editGeneration },
            ),
        }),
      );
    },
    [
      clearRecoveryDraft,
      documentId,
      retainRecoveryDraft,
      saveDocumentImmediately,
    ],
  );
  const retryPendingSaveRef = useRef<
    (result: DocumentSaveResult, pending: PendingDocumentSave) => void
  >(() => undefined);
  const retryPendingSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const retryPendingSaveDelayRef = useRef(800);
  retryPendingSaveRef.current = (result, pending) => {
    const currentRetryState = () => ({
      canEdit: canEditRef.current,
      contentEditVersion: contentEditVersionRef.current,
      editGeneration: editorEditGenerationRef.current,
      contentObservationEpoch: contentObservationEpochRef.current,
      title: localTitleRef.current,
      content: localContentRef.current,
      contentBase: { ...lastSavedContentRef.current },
      titleBase: lastSavedTitleRef.current.title,
    });
    if (!pendingSaveRetrySnapshot(result, pending, currentRetryState())) return;
    if (retryPendingSaveTimerRef.current)
      clearTimeout(retryPendingSaveTimerRef.current);
    const delay = retryPendingSaveDelayRef.current;
    retryPendingSaveDelayRef.current = Math.min(delay * 2, 30_000);
    retryPendingSaveTimerRef.current = setTimeout(() => {
      retryPendingSaveTimerRef.current = null;
      const snapshot = pendingSaveRetrySnapshot(
        result,
        pending,
        currentRetryState(),
      );
      if (!snapshot) return;
      const retryPending = {
        ...pending,
        ...snapshot,
        saveAttemptId: crypto.randomUUID(),
      };
      void queueDocumentSave(snapshot.title, snapshot.content, {
        contentBase: snapshot.contentBase,
        titleBase: snapshot.titleBase,
        contentEditVersion: pending.contentEditVersion,
        contentObservationEpoch: snapshot.contentObservationEpoch,
        contentAuthoredAfterRevision: pending.contentAuthoredAfterRevision,
        authoredContentIntent: pending.authoredContentIntent,
        editorSessionId: pending.editorSessionId,
        editGeneration: pending.editGeneration,
        historySessionId: pending.historySessionId,
        saveAttemptId: retryPending.saveAttemptId,
      })
        .then((next) => {
          if (next.contentPersisted) {
            retryPendingSaveDelayRef.current = 800;
          } else {
            retryPendingSaveRef.current(next, retryPending);
          }
        })
        .catch(handleBackgroundSaveError);
    }, delay);
  };
  const flushPendingDocumentSave = useCallback(
    (pending: PendingDocumentSave) => {
      if (!pending.canEditWhenQueued) return Promise.resolve();
      return Promise.resolve(
        pending.save(pending.title, pending.content, {
          allowQueuedSave: true,
          historySessionId: pending.historySessionId,
          editorSessionId: pending.editorSessionId,
          expectedLocalSourceRevision: pending.expectedLocalSourceRevision,
          contentEditVersion: pending.contentEditVersion,
          editGeneration: pending.editGeneration,
          contentAuthoredAfterRevision: pending.contentAuthoredAfterRevision,
          authoredContentIntent: pending.authoredContentIntent,
          contentBase: pending.contentBase,
          titleBase: pending.titleBase,
          contentObservationEpoch: pending.contentObservationEpoch,
          saveAttemptId: pending.saveAttemptId,
        }),
      )
        .then((result) => {
          if (result.contentPersisted) {
            retryPendingSaveDelayRef.current = 800;
          } else {
            retryPendingSaveRef.current(result, pending);
          }
        })
        .catch(handleBackgroundSaveError);
    },
    [handleBackgroundSaveError],
  );
  useEffect(
    () => () => {
      if (retryPendingSaveTimerRef.current)
        clearTimeout(retryPendingSaveTimerRef.current);
    },
    [],
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
      revision: restored.revision,
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
      if (reconcileRecoveryStateRef.current) return;
      const expectedLocalSourceRevision = isLinkedLocalSourceDocument
        ? localSourceRevisionForQueuedEdit(
            pendingDocumentSaveRef.current?.expectedLocalSourceRevision,
            localSourceRevisionRef.current,
          )
        : undefined;
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      const pending: PendingDocumentSave = {
        historySessionId: historySessionRef.current.activity(documentId),
        editorSessionId: editorSessionIdRef.current!,
        title,
        content,
        save: queueDocumentSave,
        canEditWhenQueued: canEditRef.current,
        contentEditVersion: contentEditVersionRef.current,
        editGeneration: editorEditGenerationRef.current,
        contentAuthoredAfterRevision: lastSavedContentRef.current.revision,
        authoredContentIntent:
          authoredContentIntentRef.current?.editGeneration ===
          editorEditGenerationRef.current
            ? authoredContentIntentRef.current
            : undefined,
        contentBase: { ...lastSavedContentRef.current },
        titleBase: lastSavedTitleRef.current.title,
        contentObservationEpoch: contentObservationEpochRef.current,
        saveAttemptId: crypto.randomUUID(),
        expectedLocalSourceRevision,
        timeout: setTimeout(() => {
          if (pendingDocumentSaveRef.current === pending) {
            pendingDocumentSaveRef.current = null;
          }
          saveTimeoutRef.current = null;
          flushPendingDocumentSave(pending);
        }, 500),
      };
      journalCurrentDraft(title, content, pending.editGeneration, {
        saveAttemptId: pending.saveAttemptId,
        contentBase: pending.contentBase,
        titleBase: pending.titleBase,
      });
      pendingDocumentSaveRef.current = pending;
      saveTimeoutRef.current = pending.timeout;
    },
    [
      flushPendingDocumentSave,
      isLinkedLocalSourceDocument,
      journalCurrentDraft,
      queueDocumentSave,
    ],
  );

  useEffect(() => {
    return () => {
      const pending = pendingDocumentSaveRef.current;
      if (!pending) return;
      clearTimeout(pending.timeout);
      saveTimeoutRef.current = null;
      void flushPendingDocumentSave(pending).finally(() => {
        if (pendingDocumentSaveRef.current === pending) {
          pendingDocumentSaveRef.current = null;
        }
      });
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

  useEffect(() => {
    if (!canEdit) return;

    const sendKeepaliveSave = (pending: PendingDocumentSave) => {
      if (!pending.canEditWhenQueued) return false;

      if (isLocalFileDocument || isLinkedLocalSourceDocument) {
        return false;
      }

      const serverUpdatedAt = documentUpdatedAtRef.current;
      const titleIsStale =
        !!serverUpdatedAt &&
        !!lastSavedTitleRef.current.updatedAt &&
        serverUpdatedAt > lastSavedTitleRef.current.updatedAt;
      const contentIsStale =
        !!documentRevisionRef.current &&
        !!pending.contentBase.revision &&
        documentRevisionRef.current !== pending.contentBase.revision;

      const titleChanged = pending.title !== pending.titleBase;
      const contentChanged = pending.content !== pending.contentBase.content;
      const updates: Record<string, string> = {};
      if (titleChanged && !titleIsStale) {
        updates.title = pending.title;
      }
      if (contentChanged && !contentIsStale) {
        updates.content = pending.content;
      }
      const disposition = lifecycleKeepaliveDisposition({
        titleChanged,
        contentChanged,
        sendsTitle: updates.title !== undefined,
        sendsContent: updates.content !== undefined,
      });
      if (disposition !== "send") return disposition === "skip";

      try {
        const baseUpdatedAt =
          updates.content !== undefined
            ? (pending.contentBase.updatedAt ?? undefined)
            : undefined;
        const baseRevision =
          updates.content !== undefined
            ? pending.contentBase.revision
            : undefined;
        const loadedContentWasEmpty =
          updates.content !== undefined
            ? isEffectivelyEmptyDocumentContent(pending.contentBase.content)
            : undefined;
        const loadedUpdatedAt = loadedUpdatedAtForSave(
          pending.contentBase,
          documentUpdatedAtRef.current,
        );
        const attempt = tryCallActionKeepalive(
          "update-document",
          {
            id: documentId,
            historySessionId: pending.historySessionId,
            editorSessionId: pending.editorSessionId,
            editorEditGeneration: pending.editGeneration,
            browserSaveAttemptId: pending.saveAttemptId,
            ...(updates.content !== undefined &&
            pending.authoredContentIntent &&
            authoredCandidateMatchesContent(
              updates.content,
              pending.authoredContentIntent?.candidateContent,
            )
              ? {
                  authoredBaseRevision:
                    pending.authoredContentIntent.baseRevision,
                  authoredBaseContent:
                    pending.authoredContentIntent.baseContent,
                  authoredCandidateContent:
                    pending.authoredContentIntent.candidateContent,
                }
              : {}),
            editorSnapshotTitle: pending.title,
            editorSnapshotContent: pending.content,
            ...updates,
            ...(loadedContentWasEmpty !== undefined
              ? { loadedContentWasEmpty }
              : {}),
            ...(loadedUpdatedAt !== undefined ? { loadedUpdatedAt } : {}),
            ...(baseUpdatedAt !== undefined ? { baseUpdatedAt } : {}),
            ...(baseRevision !== undefined ? { baseRevision } : {}),
            ...(updates.title !== undefined
              ? { baseTitle: pending.titleBase }
              : {}),
          },
          {
            headers: {
              "X-Agent-Native-Frontend": "1",
            },
          },
        );
        if (!attempt.accepted) return false;
        void attempt.completion.catch(() => {
          /* Page is going away; nothing more we can do. */
        });
        return true;
      } catch {
        // coercion-ok: false explicitly triggers the ordinary guarded fallback.
        return false;
      }
    };

    const flushForTeardown = () => {
      const pending = pendingDocumentSaveRef.current;
      if (!pending || !pending.canEditWhenQueued) return;
      clearTimeout(pending.timeout);
      saveTimeoutRef.current = null;
      pendingDocumentSaveRef.current = null;
      if (!sendKeepaliveSave(pending)) flushPendingDocumentSave(pending);
    };

    const onVisibilityChange = () => {
      if (window.document.visibilityState !== "hidden") return;
      const pending = pendingDocumentSaveRef.current;
      if (!pending) return;
      clearTimeout(pending.timeout);
      saveTimeoutRef.current = null;
      pendingDocumentSaveRef.current = null;
      sendKeepaliveSave(pending);
      void flushPendingDocumentSave(pending).finally(() => {
        if (pendingDocumentSaveRef.current === pending) {
          pendingDocumentSaveRef.current = null;
        }
      });
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
                if (
                  isDocumentUpdateConflict(saved) ||
                  isDocumentUpdateSuperseded(saved) ||
                  isDocumentUpdatePreservationRequired(saved)
                ) {
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
      editorEditGenerationRef.current += 1;
      journalCurrentDraft(
        newTitle,
        localContentRef.current,
        editorEditGenerationRef.current,
      );
      setLocalTitle(newTitle);
      if (updateReconcileDraft(localContentRef.current, newTitle)) {
        retainActiveRecoveryDraft({
          localTitle: newTitle,
          localDraft: localContentRef.current,
        });
        return;
      }
      patchDocumentCaches(queryClient, documentId, { title: newTitle });
      if (host === "page") {
        refreshLandingTitleHintCache(queryClient, documentId, newTitle);
        void rememberContentLandingDocument(documentId, newTitle).catch(
          () => {},
        );
      }
      debouncedSave(newTitle, localContentRef.current);
    },
    [
      debouncedSave,
      documentId,
      editorCanEdit,
      host,
      isSuggesting,
      journalCurrentDraft,
      queryClient,
      retainActiveRecoveryDraft,
      updateReconcileDraft,
    ],
  );

  const savedSuggestions = useMemo(() => {
    return freshestSavedSuggestions(
      locallyCreatedSuggestions,
      suggestionsQuery.data?.suggestions ?? [],
    );
  }, [locallyCreatedSuggestions, suggestionsQuery.data?.suggestions]);
  const renderedSuggestionTransitions = useMemo(
    () =>
      hydrateSuggestionPresentationTransitions(
        suggestionPresentationTransitions.documentId === documentId
          ? suggestionPresentationTransitions.entries
          : new Map(),
        savedSuggestions,
        pendingSuggestionDecision || pendingProposalDecision
          ? []
          : savedSuggestions,
        document.content,
      ),
    [
      document.content,
      documentId,
      pendingProposalDecision,
      pendingSuggestionDecision,
      savedSuggestions,
      suggestionPresentationTransitions,
    ],
  );
  useEffect(() => {
    setSuggestionPresentationTransitions((current) => {
      if (current !== suggestionPresentationTransitions) return current;
      return current.documentId === documentId &&
        renderedSuggestionTransitions === current.entries
        ? current
        : { documentId, entries: renderedSuggestionTransitions };
    });
  }, [
    documentId,
    renderedSuggestionTransitions,
    suggestionPresentationTransitions,
  ]);
  const retainCommittedPresentationTransitions = useCallback(
    (committed: ResourceSuggestion[]) => {
      setSuggestionPresentationTransitions((current) => ({
        documentId,
        entries: retainCommittedSuggestionPresentationTransitions(
          current.documentId === documentId ? current.entries : new Map(),
          savedSuggestions,
          committed,
        ),
      }));
    },
    [documentId, savedSuggestions],
  );
  const presentedSuggestions = useMemo(() => {
    if (!pendingSuggestionDecision?.continueSuggesting) return savedSuggestions;
    return savedSuggestions.map((suggestion) =>
      suggestion.id === pendingSuggestionDecision.suggestion.id
        ? {
            ...suggestion,
            status: pendingSuggestionDecision.optimistic
              ? pendingSuggestionDecision.decision
              : pendingSuggestionDecision.suggestion.status,
          }
        : suggestion,
    );
  }, [pendingSuggestionDecision, savedSuggestions]);
  const pendingSuggestionDecisionContent =
    pendingSuggestionDecision?.continueSuggesting
      ? suggestionDecisionPreviewContent(
          pendingSuggestionDecision.suggestion,
          pendingSuggestionDecision.decision,
          document.content,
          pendingSuggestionDecision.optimistic,
        )
      : null;
  const amendmentTargetIsResolved = suggestionAmendmentTargetIsResolved(
    editingSuggestionId,
    savedSuggestions,
  );
  const amendmentDraftIsDirty = Boolean(
    suggestionBaseRef.current?.existingSuggestion &&
    suggestionDraftHasChanges(suggestionBaseRef.current, suggestionDraft),
  );
  const amendmentResolutionConflicts = suggestionAmendmentResolutionConflicts(
    editingSuggestionId,
    savedSuggestions,
    pendingSuggestionDecision?.optimistic &&
      activeSuggestionDecisionIdRef.current ===
        pendingSuggestionDecision.suggestion.id
      ? [
          {
            id: pendingSuggestionDecision.suggestion.id,
            decision: pendingSuggestionDecision.decision,
          },
        ]
      : pendingProposalDecision?.generation ===
          suggestionDecisionGenerationRef.current
        ? pendingProposalDecision.members.map((member) => ({
            id: member.id,
            decision: pendingProposalDecision.requestedDecision,
          }))
        : [],
  );

  useEffect(() => {
    if (
      !isSuggesting ||
      !amendmentDraftIsDirty ||
      !amendmentResolutionConflicts
    )
      return;
    setSuggestionAmendmentConflict(true);
    void queryClient.invalidateQueries(documentQueryFilter(documentId));
  }, [
    amendmentDraftIsDirty,
    amendmentResolutionConflicts,
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

  const flushSuggestionDraft = useCallback(
    async ({ keepMode = false }: { keepMode?: boolean } = {}) => {
      if (!isSuggesting) return null;
      if (isSubmittingSuggestions) return null;
      const base = suggestionBaseRef.current;
      if (!base) return null;
      setSuggestionDraftSaveFailed(false);
      if (base.existingSuggestion && suggestionDraft === base.initialContent) {
        if (!keepMode) {
          setIsSuggesting(false);
          suggestionBaseRef.current = null;
          setEditingSuggestionId(null);
          setSuggestionInitialSelection(null);
          setSuggestionAmendmentConflict(false);
          suggestionAmendmentKeysRef.current.clear();
        }
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
        if (!keepMode) {
          setIsSuggesting(false);
          suggestionBaseRef.current = null;
          setEditingSuggestionId(null);
          setSuggestionInitialSelection(null);
          setSuggestionAmendmentConflict(false);
          createdSuggestionOperationsRef.current.clear();
        }
        return new Map<string, ResourceSuggestion>();
      }
      setIsSubmittingSuggestions(true);
      try {
        type CreatedProposal = Awaited<
          ReturnType<typeof createSuggestionProposal.mutateAsync>
        >;
        const recordCreated = (
          created: CreatedProposal,
          pendingKeys: string[],
          operations: ReturnType<typeof suggestionDraftOperations>,
          idempotencyKey: string,
          baseId: string,
        ) => {
          if (created.suggestions.length !== operations.length)
            throw new Error(
              "Proposal creation returned an incomplete edit set",
            );
          suggestionProposalsRef.current.set(baseId, {
            id: created.proposal.id,
            summary: created.proposal.summary,
          });
          operations.forEach((operation, index) => {
            const suggestion = created.suggestions[index]!;
            createdSuggestionOperationsRef.current.set(pendingKeys[index]!, {
              idempotencyKey,
              operation,
              suggestion,
            });
          });
        };
        const unresolved = unresolvedProposalCreationRef.current;
        if (unresolved) {
          const recovered = await createSuggestionProposal.mutateAsync(
            unresolved.request,
          );
          recordCreated(
            recovered,
            unresolved.pendingKeys,
            unresolved.operations,
            unresolved.request.idempotencyKey,
            unresolved.baseId,
          );
          unresolvedProposalCreationRef.current = null;
        }
        const operations = suggestionDraftOperations(base, suggestionDraft);
        if (operations.length === 0) {
          if (base.existingSuggestion) {
            toast.error(t("editor.suggestionAmendmentEmpty"));
            return null;
          }
          if (!keepMode) {
            setIsSuggesting(false);
            suggestionBaseRef.current = null;
            setEditingSuggestionId(null);
            setSuggestionInitialSelection(null);
            setSuggestionAmendmentConflict(false);
          }
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
          persisted = new Map<string, ResourceSuggestion>();
          const pending = operations.filter((operation) => {
            const existing = createdSuggestionOperationsRef.current.get(
              suggestionOperationKey(operation),
            );
            if (existing?.suggestion) {
              persisted.set(
                suggestionOperationKey(operation),
                existing.suggestion,
              );
              return false;
            }
            return true;
          });
          if (pending.length > 0) {
            const pendingKeys = pending.map(suggestionOperationKey);
            const requestKey = JSON.stringify([base.id, pendingKeys]);
            const idempotencyKey =
              suggestionProposalCreationKeysRef.current.get(requestKey) ??
              globalThis.crypto.randomUUID();
            suggestionProposalCreationKeysRef.current.set(
              requestKey,
              idempotencyKey,
            );
            const existingProposal = suggestionProposalsRef.current.get(
              base.id,
            );
            const proposalSummary =
              existingProposal?.summary ?? t("editor.toolbar.suggestEdits");
            const request = {
              resourceType: "document",
              resourceId: documentId,
              adapterKind: "content.document-markdown",
              baseRevision: base.baseRevision,
              summary: proposalSummary,
              proposalId: existingProposal?.id,
              idempotencyKey,
              suggestions: pending.map((operation) => ({
                summary: proposalSummary,
                operations: [operation],
              })),
            } satisfies Parameters<
              typeof createSuggestionProposal.mutateAsync
            >[0];
            unresolvedProposalCreationRef.current = {
              baseId: base.id,
              request,
              pendingKeys,
              operations: pending,
            };
            const created = await createSuggestionProposal.mutateAsync(request);
            recordCreated(
              created,
              pendingKeys,
              pending,
              idempotencyKey,
              base.id,
            );
            unresolvedProposalCreationRef.current = null;
            pendingKeys.forEach((operationKey, index) => {
              persisted.set(operationKey, created.suggestions[index]!);
            });
          }
          adoptConfirmedSuggestions();
        }
        if (!keepMode) {
          setIsSuggesting(false);
          suggestionBaseRef.current = null;
          setEditingSuggestionId(null);
          setSuggestionInitialSelection(null);
          setSuggestionAmendmentConflict(false);
          createdSuggestionOperationsRef.current.clear();
          suggestionAmendmentKeysRef.current.clear();
        }
        return persisted;
      } catch (error) {
        const status = (error as { status?: unknown } | null)?.status;
        if (
          typeof status === "number" &&
          status >= 400 &&
          status < 500 &&
          status !== 408 &&
          status !== 429
        ) {
          unresolvedProposalCreationRef.current = null;
        }
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
        setSuggestionDraftSaveFailed(true);
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
    },
    [
      createSuggestionProposal,
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
    ],
  );

  const startSuggestionDraft = useCallback(
    (
      nextDocument: Document,
      suggestion?: ResourceSuggestion,
      initialSelection?: VisualEditorSelectionSnapshot | null,
    ) => {
      if (!canStartSuggestionRef.current || isSuggesting) return false;
      try {
        suggestionMarkedSourceRanges(nextDocument.content);
      } catch (error) {
        if (!(error instanceof SuggestionFormattingMappingError)) throw error;
        toast.error(t("editor.suggestionFormattingBaselineUnsupported"));
        return false;
      }
      const existing = suggestion
        ? editableSuggestionDraft({
            suggestion,
            currentUserEmail: session?.email,
            canonicalContent: nextDocument.content,
            canonicalRevision: canonicalSuggestionRevision(
              nextDocument,
              suggestion,
            ),
          })
        : null;
      if (suggestion && !existing) return false;
      createdSuggestionOperationsRef.current.clear();
      suggestionAmendmentKeysRef.current.clear();
      setSuggestionAmendmentConflict(false);
      const initial =
        existing ??
        createDocumentSuggestionDraftSession({
          id: globalThis.crypto.randomUUID(),
          baseContent: nextDocument.content,
          baseRevision: canonicalSuggestionRevision(nextDocument),
          startedAt: new Date().toISOString(),
        });
      suggestionBaseRef.current = initial.session;
      setSuggestionDraft(initial.content);
      setSuggestionInitialSelection(
        existing?.caret ?? initialSelection ?? null,
      );
      setEditingSuggestionId(existing?.session.existingSuggestion?.id ?? null);
      if (existing) setSelectedSuggestionId(null);
      setIsSuggesting(true);
      return true;
    },
    [isSuggesting, session?.email, t],
  );

  const prepareSuggestionDraftDocument = useCallback(async () => {
    const content = localContentRef.current;
    const title = localTitleRef.current;
    const pending = pendingDocumentSaveRef.current;
    if (
      !pending &&
      content === document.content &&
      title === document.title &&
      title === lastSavedTitleRef.current.title
    )
      return document;
    if (pending) {
      clearTimeout(pending.timeout);
      pendingDocumentSaveRef.current = null;
      saveTimeoutRef.current = null;
    }
    try {
      const saved = await queueDocumentSave(title, content, {
        historySessionId: pending?.historySessionId,
        contentEditVersion: contentEditVersionRef.current,
      });
      if (
        !saved.contentPersisted ||
        localContentRef.current !== content ||
        localTitleRef.current !== title ||
        lastSavedTitleRef.current.title !== title
      ) {
        toast.error(t("editor.suggestionCreateFailed"));
        return null;
      }
      const refreshedDocument = await callAction(
        "get-document",
        {
          id: documentId,
          ...(databaseId ? { databaseId } : {}),
          ...(databaseDocumentId ? { databaseDocumentId } : {}),
        },
        { method: "GET" },
      );
      if (
        refreshedDocument.content !== content ||
        refreshedDocument.title !== title
      ) {
        toast.error(t("editor.toolbar.conflict"));
        return null;
      }
      patchDocumentCaches(queryClient, documentId, refreshedDocument);
      return refreshedDocument;
    } catch (error) {
      toast.error(t("editor.suggestionCreateFailed"), {
        description:
          error instanceof Error ? error.message : t("empty.genericError"),
      });
      return null;
    }
  }, [
    databaseDocumentId,
    databaseId,
    document,
    documentId,
    queryClient,
    queueDocumentSave,
    t,
  ]);

  const continueSuggestionModeFrom = useCallback((nextDocument: Document) => {
    createdSuggestionOperationsRef.current.clear();
    suggestionAmendmentKeysRef.current.clear();
    const initial = createDocumentSuggestionDraftSession({
      id: globalThis.crypto.randomUUID(),
      baseContent: nextDocument.content,
      baseRevision: canonicalSuggestionRevision(nextDocument),
      startedAt: new Date().toISOString(),
    });
    suggestionBaseRef.current = initial.session;
    setSuggestionDraft(initial.content);
    setEditingSuggestionId(null);
    setSuggestionInitialSelection(null);
    setSuggestionAmendmentConflict(false);
    setIsSuggesting(true);
    setSuggestionPersistenceRevision((revision) => revision + 1);
  }, []);

  const refreshSuggestionDecisionDocument = useCallback(
    async (
      continueSuggesting: boolean,
      owner:
        | "single-accepted"
        | "single-other"
        | "proposal-accepted"
        | "proposal-other",
    ): Promise<
      | { status: "refreshed"; document: Document }
      | { status: "failed" | "superseded" | "in-flight" }
    > => {
      const decisionGeneration = suggestionDecisionGenerationRef.current;
      if (decisionRefreshInFlightRef.current === decisionGeneration)
        return { status: "in-flight" };
      decisionRefreshInFlightRef.current = decisionGeneration;
      setDecisionRefreshFailed(false);
      try {
        const refreshedDocument = await callAction(
          "get-document",
          {
            id: documentId,
            ...(databaseId ? { databaseId } : {}),
            ...(databaseDocumentId ? { databaseDocumentId } : {}),
          },
          { method: "GET" },
        );
        if (
          decisionGeneration !== suggestionDecisionGenerationRef.current ||
          documentId !== suggestionDecisionDocumentIdRef.current
        )
          return { status: "superseded" };
        patchDocumentCaches(queryClient, documentId, refreshedDocument);
        if (continueSuggesting) continueSuggestionModeFrom(refreshedDocument);
        if (
          (owner === "single-accepted" || owner === "proposal-accepted") &&
          continueSuggesting
        ) {
          const sync = await requestCollabSync();
          if (
            decisionGeneration !== suggestionDecisionGenerationRef.current ||
            documentId !== suggestionDecisionDocumentIdRef.current
          )
            return { status: "superseded" };
          if (sync.status === "failed") throw sync.error;
          if (sync.status === "unavailable")
            throw Object.assign(new Error(t("empty.genericError")), {
              cause: sync,
            });
        }
        if (owner === "single-accepted" || owner === "single-other") {
          setPendingSuggestionDecision((current) => {
            if (owner !== "single-accepted" || !current?.optimistic)
              return null;
            return { ...current, readbackContent: refreshedDocument.content };
          });
          if (owner === "single-other") {
            suggestionDecisionInFlightRef.current = false;
            activeSuggestionDecisionIdRef.current = null;
          }
        }
        return { status: "refreshed", document: refreshedDocument };
      } catch (error) {
        if (
          decisionGeneration !== suggestionDecisionGenerationRef.current ||
          documentId !== suggestionDecisionDocumentIdRef.current
        )
          return { status: "superseded" };
        setDecisionRefreshFailed(true);
        void queryClient.invalidateQueries(documentQueryFilter(documentId));
        toast.error(t("empty.genericError"), {
          description:
            error instanceof Error ? error.message : t("empty.genericError"),
        });
        return { status: "failed" };
      } finally {
        if (decisionRefreshInFlightRef.current === decisionGeneration)
          decisionRefreshInFlightRef.current = null;
      }
    },
    [
      continueSuggestionModeFrom,
      databaseDocumentId,
      databaseId,
      documentId,
      queryClient,
      requestCollabSync,
      t,
    ],
  );

  const handleAcceptedDecisionRendered = useCallback((suggestionId: string) => {
    if (activeSuggestionDecisionIdRef.current !== suggestionId) return;
    activeSuggestionDecisionIdRef.current = null;
    suggestionDecisionGenerationRef.current += 1;
    setDecisionReadbackDivergence((current) =>
      current?.suggestionId === suggestionId ? null : current,
    );
    setPendingSuggestionDecision((current) => {
      if (
        current?.suggestion.id !== suggestionId ||
        current.readbackContent === null
      )
        return current;
      suggestionDecisionInFlightRef.current = false;
      return null;
    });
  }, []);

  const handleProposalDecisionRendered = useCallback(
    (generation: number) => {
      if (
        generation !== suggestionDecisionGenerationRef.current ||
        pendingProposalDecision?.generation !== generation ||
        pendingProposalDecision.readbackContent === null
      )
        return;
      suggestionDecisionGenerationRef.current += 1;
      proposalDecisionInFlightRef.current = false;
      setProposalDecisionReadbackDivergence(null);
      setPendingProposalDecision(null);
    },
    [pendingProposalDecision],
  );

  const handleProposalDecisionReadbackOutdated = useCallback(
    (generation: number, actualContent: string) => {
      if (
        generation === suggestionDecisionGenerationRef.current &&
        pendingProposalDecision?.generation === generation
      )
        setProposalDecisionReadbackDivergence((previous) =>
          previous?.generation === generation &&
          previous.actualContent === actualContent
            ? previous
            : { generation, actualContent },
        );
    },
    [pendingProposalDecision],
  );

  const handleAcceptedDecisionReadbackOutdated = useCallback(
    (suggestionId: string, actualContent: string) => {
      const current = pendingSuggestionDecision;
      if (
        current?.suggestion.id !== suggestionId ||
        current.readbackContent === null
      )
        return;
      setDecisionReadbackDivergence((previous) =>
        previous?.suggestionId === suggestionId &&
        previous.actualContent === actualContent
          ? previous
          : { suggestionId, actualContent },
      );
    },
    [pendingSuggestionDecision],
  );

  useEffect(() => {
    const pending = pendingSuggestionDecision;
    if (
      !isSuggesting ||
      !collabEditorEnabled ||
      !ydoc ||
      pending?.decision !== "accepted" ||
      pending.readbackContent === null
    )
      return;
    const before = pending.suggestion.operations[0]?.before as
      | { markdown?: unknown }
      | undefined;
    if (typeof before?.markdown !== "string") {
      setDecisionRefreshFailed(true);
      return;
    }
    const suggestionId = pending.suggestion.id;
    return observeAcceptedCanonicalSettlement({
      ydoc,
      beforeContent: before.markdown,
      readbackContent: pending.readbackContent,
      onRendered: () => handleAcceptedDecisionRendered(suggestionId),
      onOutdated: (actual) =>
        handleAcceptedDecisionReadbackOutdated(suggestionId, actual),
      onError: () => setDecisionRefreshFailed(true),
    });
  }, [
    collabEditorEnabled,
    handleAcceptedDecisionReadbackOutdated,
    handleAcceptedDecisionRendered,
    isSuggesting,
    pendingSuggestionDecision,
    ydoc,
  ]);

  useEffect(() => {
    const pending = pendingProposalDecision;
    if (
      !isSuggesting ||
      !collabEditorEnabled ||
      !ydoc ||
      !pending?.accepted ||
      pending.readbackContent === null
    )
      return;
    return observeAcceptedCanonicalSettlement({
      ydoc,
      beforeContent: pending.beforeContent,
      readbackContent: pending.readbackContent,
      onRendered: () => handleProposalDecisionRendered(pending.generation),
      onOutdated: (actual) =>
        handleProposalDecisionReadbackOutdated(pending.generation, actual),
      onError: () => setDecisionRefreshFailed(true),
    });
  }, [
    collabEditorEnabled,
    handleProposalDecisionReadbackOutdated,
    handleProposalDecisionRendered,
    isSuggesting,
    pendingProposalDecision,
    ydoc,
  ]);

  useEffect(() => {
    if (
      !decisionReadbackDivergence ||
      pendingSuggestionDecision?.suggestion.id !==
        decisionReadbackDivergence.suggestionId ||
      pendingSuggestionDecision.readbackContent === null ||
      decisionRefreshFailed
    )
      return;
    const timer = window.setTimeout(() => {
      void refreshSuggestionDecisionDocument(
        pendingSuggestionDecision.continueSuggesting,
        "single-accepted",
      );
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [
    decisionReadbackDivergence,
    decisionRefreshFailed,
    pendingSuggestionDecision,
    refreshSuggestionDecisionDocument,
  ]);

  useEffect(() => {
    if (
      !proposalDecisionReadbackDivergence ||
      pendingProposalDecision?.generation !==
        proposalDecisionReadbackDivergence.generation ||
      pendingProposalDecision.readbackContent === null ||
      decisionRefreshFailed
    )
      return;
    const timer = window.setTimeout(() => {
      void refreshSuggestionDecisionDocument(
        pendingProposalDecision.continueSuggesting,
        pendingProposalDecision.accepted
          ? "proposal-accepted"
          : "proposal-other",
      ).then((recovered) => {
        if (
          recovered.status === "refreshed" &&
          pendingProposalDecision.generation ===
            suggestionDecisionGenerationRef.current &&
          documentId === suggestionDecisionDocumentIdRef.current
        )
          setPendingProposalDecision((current) =>
            current?.generation === pendingProposalDecision.generation
              ? { ...current, readbackContent: recovered.document.content }
              : current,
          );
      });
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [
    decisionRefreshFailed,
    documentId,
    pendingProposalDecision,
    proposalDecisionReadbackDivergence,
    refreshSuggestionDecisionDocument,
  ]);

  const handleSuggestionModeChange = useCallback(
    async (next: boolean) => {
      if (next) {
        if (!canSuggest || startingSuggestionRef.current) return;
        const initialSelection = pageActionsSelectionRef.current;
        pageActionsSelectionRef.current = null;
        startingSuggestionRef.current = true;
        setIsStartingSuggestion(true);
        try {
          if (document.databaseMembership) {
            try {
              await flushAllBlockFieldSaveControllersForDocument(documentId);
            } catch (error) {
              toast.error(t("editor.suggestionCreateFailed"), {
                description:
                  actionErrorMessage(error) ?? t("empty.genericError"),
              });
              restoreCapturedEditorSelection(
                editorSelectionControllerRef.current,
                initialSelection,
              );
              return;
            }
          }
          if (!canStartSuggestionRef.current) {
            restoreCapturedEditorSelection(
              editorSelectionControllerRef.current,
              initialSelection,
            );
            return;
          }
          const readyDocument = await prepareSuggestionDraftDocument();
          if (!readyDocument || !canStartSuggestionRef.current) {
            restoreCapturedEditorSelection(
              editorSelectionControllerRef.current,
              initialSelection,
            );
            return;
          }
          if (
            !shouldResumeSelectedSuggestionFromPageActions(initialSelection)
          ) {
            if (
              !startSuggestionDraft(readyDocument, undefined, initialSelection)
            ) {
              restoreCapturedEditorSelection(
                editorSelectionControllerRef.current,
                initialSelection,
              );
            }
            return;
          }
          const selected = savedSuggestions.find(
            (suggestion) => suggestion.id === selectedSuggestionId,
          );
          if (!selected || !startSuggestionDraft(readyDocument, selected)) {
            startSuggestionDraft(readyDocument);
          }
        } finally {
          setIsStartingSuggestion(false);
          startingSuggestionRef.current = false;
        }
        return;
      }
      await flushSuggestionDraft();
    },
    [
      canSuggest,
      document.databaseMembership,
      documentId,
      flushSuggestionDraft,
      prepareSuggestionDraftDocument,
      savedSuggestions,
      selectedSuggestionId,
      startSuggestionDraft,
      t,
    ],
  );

  const capturePageActionsSelection = useCallback(
    (includeRemembered = false) => {
      pageActionsSelectionRef.current =
        editorSelectionControllerRef.current?.captureSelection({
          includeRemembered,
        }) ?? null;
    },
    [],
  );

  const handleSelectionControllerChange = useCallback(
    (controller: VisualEditorSelectionController | null) => {
      editorSelectionControllerRef.current = controller;
    },
    [],
  );

  const preservePageActionsSelection = useCallback(() => {
    const snapshot = pageActionsSelectionRef.current;
    if (snapshot) {
      editorSelectionControllerRef.current?.preserveSelection(snapshot);
    }
  }, []);

  const restorePageActionsSelection = useCallback(() => {
    const snapshot = pageActionsSelectionRef.current;
    restoreCapturedEditorSelection(
      editorSelectionControllerRef.current,
      snapshot,
    );
  }, []);

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
    suggestionDecisionGenerationRef.current += 1;
    decisionRefreshInFlightRef.current = null;
    suggestionDecisionInFlightRef.current = false;
    proposalDecisionInFlightRef.current = false;
    activeSuggestionDecisionIdRef.current = null;
    setLocallyCreatedSuggestions([]);
    setEditingSuggestionId(null);
    setSuggestionInitialSelection(null);
    setSuggestionAmendmentConflict(false);
    unresolvedProposalCreationRef.current = null;
    setPendingSuggestionDecision(null);
    setPendingProposalDecision(null);
    setSuggestionPresentationTransitions({ documentId, entries: new Map() });
    setProposalDecisionReadbackDivergence(null);
    setDecisionRefreshFailed(false);
    setPreserveInlineReviewSpace(false);
  }, [documentId]);

  useEffect(() => {
    if (!isSuggesting) setPreserveInlineReviewSpace(false);
  }, [isSuggesting]);

  useEffect(() => {
    if (!isSuggesting) setSuggestionDraftSaveFailed(false);
  }, [isSuggesting]);

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

  const displaySavedSuggestions = useMemo(
    () =>
      visibleSavedSuggestionsDuringDraftMaterialization(
        presentedSuggestions,
        draftSuggestions,
        isSubmittingSuggestions,
        new Set(
          [...createdSuggestionOperationsRef.current.values()]
            .map((entry) => entry.suggestion?.id)
            .filter((id): id is string => typeof id === "string"),
        ),
      ),
    [
      presentedSuggestions,
      draftSuggestions,
      isSubmittingSuggestions,
      suggestionPersistenceRevision,
    ],
  );

  const visualSuggestions = useMemo<VisualEditorSuggestion[]>(() => {
    const currentMarkdown =
      pendingSuggestionDecisionContent ??
      (isSuggesting ? suggestionDraft : document.content);
    const observedTransition = observedSuggestionDecisionTransition(
      pendingSuggestionDecision,
      pendingProposalDecision,
    );
    const ordinaryPresentations = documentEditorSuggestionPresentations({
      savedSuggestions: displaySavedSuggestions,
      drafts: suggestionSessionVisuals(
        sessionDraftSuggestions,
        createdSuggestionOperationsRef.current,
      ),
      currentMarkdown,
      editingSuggestionId,
      pendingSuggestionId: pendingSuggestionDecision?.suggestion.id ?? null,
      transitions: renderedSuggestionTransitions,
      observedTransition,
    });
    let acceptedPresentations: VisualEditorSuggestion[] = [];
    if (
      pendingSuggestionDecision?.decision === "accepted" &&
      pendingSuggestionDecision.optimistic
    ) {
      const operation = pendingSuggestionDecision.suggestion.operations[0];
      const before = operation?.before as { markdown?: unknown } | undefined;
      if (typeof before?.markdown === "string") {
        acceptedPresentations = suggestionPresentations(
          { ...pendingSuggestionDecision.suggestion, status: "pending" },
          before.markdown,
        ).map((presentation) => ({
          ...presentation,
          presentation: canProjectAcceptedSuggestion(presentation)
            ? "settling"
            : "canonical",
          settlementReadbackContent: pendingSuggestionDecision.readbackContent,
        }));
      }
    }
    const presentations = replaceAcceptedSuggestionPresentations(
      ordinaryPresentations,
      acceptedPresentations,
    );
    return proposalDecisionPresentations(
      presentations,
      pendingProposalDecision,
    );
  }, [
    document.content,
    editingSuggestionId,
    isSuggesting,
    pendingSuggestionDecision,
    pendingProposalDecision,
    pendingSuggestionDecisionContent,
    displaySavedSuggestions,
    sessionDraftSuggestions,
    suggestionPersistenceRevision,
    suggestionDraft,
    documentId,
    renderedSuggestionTransitions,
  ]);
  const sidebarSuggestions = useMemo(() => {
    if (!editingSuggestionId || sessionDraftSuggestions.length !== 1) {
      return displaySavedSuggestions;
    }
    return displaySavedSuggestions.map((suggestion) =>
      suggestion.id === editingSuggestionId
        ? { ...suggestion, operations: sessionDraftSuggestions[0]!.operations }
        : suggestion,
    );
  }, [editingSuggestionId, displaySavedSuggestions, sessionDraftSuggestions]);

  useEffect(() => {
    void setClientAppState(
      "content-suggestion-mode",
      {
        documentId,
        suggesting: isSuggesting,
        draftChanged:
          isSuggesting &&
          suggestionBaseRef.current !== null &&
          suggestionDraftHasChanges(suggestionBaseRef.current, suggestionDraft),
        pendingCount: presentedSuggestions.filter(
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
    presentedSuggestions,
  ]);

  const handleContentSaveNow = useCallback(
    async (
      recovery: ReconcileRecoveryDraft,
      reconcileBase?: ReconcileSaveBase,
    ) => {
      if (!editorCanEdit) return false;
      contentEditVersionRef.current += 1;
      editorEditGenerationRef.current += 1;
      authoredContentIntentRef.current = {
        editGeneration: editorEditGenerationRef.current,
        baseRevision: lastSavedContentRef.current.revision,
        baseContent: lastSavedContentRef.current.content,
        candidateContent: recovery.localDraft,
      };
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
        pendingDocumentSaveRef.current = null;
      }
      localTitleRef.current = recovery.localTitle;
      localContentRef.current = recovery.localDraft;
      setLocalTitle(recovery.localTitle);
      setLocalContent(recovery.localDraft);
      const contentBase = reconcileBase
        ? {
            content: reconcileBase.content,
            updatedAt: reconcileBase.updatedAt,
            revision: reconcileBase.revision,
          }
        : { ...lastSavedContentRef.current };
      const saveAttemptId = crypto.randomUUID();
      journalCurrentDraft(
        recovery.localTitle,
        recovery.localDraft,
        editorEditGenerationRef.current,
        {
          saveAttemptId,
          contentBase,
          titleBase: reconcileBase?.title ?? lastSavedTitleRef.current.title,
        },
      );
      const result = await queueDocumentSave(
        recovery.localTitle,
        recovery.localDraft,
        {
          contentBase,
          titleBase: reconcileBase?.title,
          saveAttemptId,
        },
      );
      return result.contentPersisted;
    },
    [editorCanEdit, journalCurrentDraft, queueDocumentSave],
  );
  reconcileSaveRef.current = handleContentSaveNow;
  reconcileRetainRef.current = ({ localTitle, localDraft }) =>
    queueRecoveryDraftRetention(
      localTitle,
      localDraft,
      reconcileRecoveryStateRef.current?.reason === "conflict"
        ? "conflict"
        : null,
      editorSessionIdRef.current!,
      editorEditGenerationRef.current,
    );
  reportReconcileRef.current = reportReconcile;

  const handleContentChange = useCallback(
    (newContent: string) => {
      if (!editorCanEdit) return;
      if (newContent === localContentRef.current) return;
      contentEditVersionRef.current += 1;
      editorEditGenerationRef.current += 1;
      authoredContentIntentRef.current = {
        editGeneration: editorEditGenerationRef.current,
        baseRevision: lastSavedContentRef.current.revision,
        baseContent: lastSavedContentRef.current.content,
        candidateContent: newContent,
      };
      localContentRef.current = newContent;
      journalCurrentDraft(
        localTitleRef.current,
        newContent,
        editorEditGenerationRef.current,
      );
      setLocalContent(newContent);
      if (updateReconcileDraft(newContent)) {
        retainActiveRecoveryDraft({
          localTitle: localTitleRef.current,
          localDraft: newContent,
        });
        return;
      }
      debouncedSave(localTitleRef.current, newContent);
    },
    [
      debouncedSave,
      editorCanEdit,
      journalCurrentDraft,
      retainActiveRecoveryDraft,
      updateReconcileDraft,
    ],
  );

  const handleRemoteSnapshotChange = useCallback(
    (content: string) => {
      if (content === localContentRef.current) return;
      contentObservationEpochRef.current += 1;
      localContentRef.current = content;
      setLocalContent(content);
      if (
        !isSuggesting &&
        contentEditVersionRef.current > confirmedContentEditVersionRef.current
      ) {
        journalCurrentDraft(
          localTitleRef.current,
          content,
          editorEditGenerationRef.current,
        );
        // The pending authored attempt owns persistence. A peer observation
        // must not submit its generation again with a different attempt ID.
      }
    },
    [isSuggesting, journalCurrentDraft],
  );

  const handleImmediateContentChange = useCallback(
    async (newContent: string): Promise<EditorDraftSaveResult> => {
      if (!editorCanEdit) return "failed";
      if (reconcileRecoveryStateRef.current) {
        handleContentChange(newContent);
        return "retained";
      }
      return (await handleContentSaveNow({
        localTitle: localTitleRef.current,
        localDraft: newContent,
      }))
        ? "persisted"
        : "failed";
    },
    [editorCanEdit, handleContentChange, handleContentSaveNow],
  );

  const handleBaseAwareReconcile = useCallback(
    (result: {
      status: "merged" | "conflict" | "failed";
      content: string;
      serverContent: string;
      serverRevision: string;
    }) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
        pendingDocumentSaveRef.current = null;
      }
      localContentRef.current = result.content;
      setLocalContent(result.content);
      if (result.status === "merged") {
        if (documentContentRef.current === result.serverContent) {
          void resolveReconcileAutomatically(
            {
              localTitle: localTitleRef.current,
              localDraft: result.content,
            },
            {
              title: documentTitleRef.current,
              content: result.serverContent,
              updatedAt: documentUpdatedAtRef.current,
              revision: result.serverRevision,
            },
          );
        } else {
          reportReconcile("failed", result.content);
          retainActiveRecoveryDraft({
            localTitle: localTitleRef.current,
            localDraft: result.content,
          });
        }
        return;
      }
      reportReconcile(result.status, result.content);
      retainActiveRecoveryDraft({
        localTitle: localTitleRef.current,
        localDraft: result.content,
      });
    },
    [reportReconcile, resolveReconcileAutomatically, retainActiveRecoveryDraft],
  );

  const handleResolveReconcile = useCallback(
    async (base: ReconcileSaveBase) => {
      const saved = await resolveReconcile(base);
      if (saved)
        requestAnimationFrame(() => {
          documentLayoutRef.current
            ?.querySelector<HTMLElement>(".ProseMirror")
            ?.focus({ preventScroll: true });
        });
      return saved;
    },
    [resolveReconcile],
  );

  const resolveLiveRecoveryDraft = useCallback(
    async (
      choice: "use_saved" | "save_separately",
      base: ReconcileSaveBase,
    ) => {
      let resolvedUrlPath: string | undefined;
      const resolved = await resolveReconcileChoice(
        base,
        async (recovery, reviewedBase) => {
          await retainRecoveryDraft(
            recovery.localTitle,
            recovery.localDraft,
            documentReconcileConflict?.reason === "conflict"
              ? "conflict"
              : null,
            editorSessionIdRef.current!,
            editorEditGenerationRef.current,
          );
          const draft = recoveryDraftRef.current;
          if (!draft || !reviewedBase.updatedAt) return false;
          const result = await resolvePreviewDocumentDraft.mutateAsync({
            choice,
            documentId,
            expectedDraftVersion: draft.version,
            expectedDraftTitle: draft.title,
            expectedDraftContent: draft.content,
            expectedDocumentUpdatedAt: reviewedBase.updatedAt,
          });
          if (result.status === "document_conflict") {
            await queryClient.refetchQueries(documentQueryFilter(documentId));
            return false;
          }
          if (
            recoveryDraftRef.current?.version === draft.version &&
            recoveryDraftRef.current.title === draft.title &&
            recoveryDraftRef.current.content === draft.content
          ) {
            recoveryDraftRef.current = null;
          }
          resolvedUrlPath = result.urlPath;
          return true;
        },
      );
      if (!resolved) return false;
      if (choice === "save_separately" && resolvedUrlPath) {
        toast.success(t("editor.previewDraftSavedSeparately"));
        void navigate(resolvedUrlPath);
        return true;
      }
      if (choice === "use_saved") {
        localTitleRef.current = base.title ?? document.title;
        localContentRef.current = base.content;
        setLocalTitle(base.title ?? document.title);
        setLocalContent(base.content);
        await queryClient.refetchQueries(documentQueryFilter(documentId));
        toast.success(t("editor.previewDraftSavedToHistory"));
      }
      return true;
    },
    [
      documentId,
      documentReconcileConflict?.reason,
      navigate,
      queryClient,
      resolveReconcileChoice,
      resolvePreviewDocumentDraft,
      retainRecoveryDraft,
      t,
    ],
  );

  const copyLiveRecoveryDraft = useCallback(async () => {
    const copied = await writeClipboardText(localContentRef.current);
    if (copied) toast.success(t("editor.unsavedTextCopied"));
    else toast.error(t("editor.toolbar.clipboardAccessUnavailable"));
  }, [t]);

  const focusEditorAfterRecoveryReview = useCallback(() => {
    requestAnimationFrame(() => {
      documentLayoutRef.current
        ?.querySelector<HTMLElement>(".ProseMirror")
        ?.focus({ preventScroll: true });
    });
  }, []);

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
  const utilityPanelSheetCloseRef = useRef<HTMLButtonElement>(null);
  const utilityPanelSheetTriggerRef = useRef<HTMLElement | null>(null);
  const commentsHistoryTriggerRef = useRef<HTMLButtonElement>(null);
  const utilityPanelFocusGenerationRef = useRef(0);
  const activeThreadId = hoveredThreadId ?? selectedThreadId;
  const replyDrafts = useCommentReplyDrafts(documentId, session?.email);
  const [pendingCommentTargetValid, setPendingCommentTargetValid] =
    useState(true);
  const pendingCommentTargetId = pendingComment?.id ?? null;
  const pendingCommentQuotedText = pendingComment?.quotedText ?? null;
  useLayoutEffect(() => {
    if (!pendingCommentTargetId || pendingCommentQuotedText === null) {
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
          pendingCommentTargetMatches(marked, pendingCommentQuotedText),
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
  }, [pendingCommentTargetId, pendingCommentQuotedText]);
  const [focusSuggestionId, setFocusSuggestionId] = useState<string | null>(
    null,
  );
  const appliedSuggestionLinkRef = useRef<string | null>(null);
  const {
    data: threads,
    isLoading: commentsLoading,
    isError: commentsQueryFailed,
  } = useComments(!isLocalFileDocument ? documentId : null);
  const commentAi = useCommentAiRequests(documentId, {
    enabled: !isLocalFileDocument && canComment,
  });
  // While AI's result is on screen, a thread it just resolved highlights the
  // text it wrote, so the card sits beside the change it describes.
  const editorCommentThreads = useMemo(() => {
    const fresh = commentAi.freshResolutions;
    if (!threads || fresh.size === 0) return threads ?? [];
    return threads.map((thread) => {
      const change = fresh.get(thread.threadId)?.result?.changes?.[0];
      if (!thread.resolved || !change?.after || change.truncated) return thread;
      return {
        ...thread,
        resolved: false,
        quotedText: change.after,
        prefix: null,
        suffix: null,
        startOffset: null,
      };
    });
  }, [commentAi.freshResolutions, threads]);
  const documentLayoutRef = useRef<HTMLDivElement>(null);
  const commentLaneRef = useRef<HTMLElement>(null);
  const anchoredCommentRef = useRef<HTMLElement>(null);
  const [anchoredCommentPosition, setAnchoredCommentPosition] =
    useState<AnchoredCommentPosition | null>(null);
  const [commentLaneOffset, setCommentLaneOffset] = useState(0);
  const hasUtilityRailSpace = useElementMinWidth(documentLayoutRef, 960);
  const hasInlineCommentSpace = useElementMinWidth(
    documentLayoutRef,
    DOCUMENT_EDITOR_INLINE_REVIEW_MIN_WIDTH,
  );
  const showCommentsHistoryDrawer =
    utilityPanel === "comments" && commentsBrowseOpen;
  const showDesktopCommentsHistory =
    showCommentsHistoryDrawer &&
    documentEditorHasDesktopCommentSurface({
      commentsHistoryDrawerOpen: showCommentsHistoryDrawer,
      hasUtilityRailSpace,
      hasInlineCommentSpace,
    });
  const hasOpenCommentThreads =
    threads?.some((thread) => !thread.resolved) ?? false;
  // A suggestion whose text is gone lives in the comments panel only, so it
  // must not hold open an otherwise empty margin.
  const hasOpenSuggestions =
    presentedSuggestions.some(
      (suggestion) =>
        suggestion.status === "pending" &&
        (!anchoredSuggestionIds ||
          anchoredSuggestionIds.includes(suggestion.id)),
    ) || draftSuggestions.length > 0;
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
  const reviewReadsSettled =
    isLocalFileDocument ||
    ((threads !== undefined || commentsQueryFailed) &&
      (suggestionsQuery.data !== undefined || suggestionsQuery.isError));
  const pageHadOpenReview = useMemo(
    () => host === "page" && readPageShapeHint(documentId) === "review",
    [documentId, host],
  );
  const reserveInlineReviewSpace = documentEditorReservesInlineReviewSpace({
    showInlineComments,
    preserveInlineReviewSpace:
      preserveInlineReviewSpace || (pageHadOpenReview && !reviewReadsSettled),
    hasInlineCommentSpace,
    isDatabasePage: Boolean(document.database),
  });
  const hasOpenReview = hasOpenCommentThreads || hasOpenSuggestions;
  useEffect(() => {
    if (
      host !== "page" ||
      document.database ||
      isLocalFileDocument ||
      threads === undefined ||
      suggestionsQuery.data === undefined
    )
      return;
    rememberPageShape(documentId, hasOpenReview ? "review" : "page");
  }, [
    document.database,
    documentId,
    hasOpenReview,
    host,
    isLocalFileDocument,
    suggestionsQuery.data,
    threads,
  ]);
  const showDesktopInfoPanel = utilityPanel === "info" && hasUtilityRailSpace;
  const showDesktopRightRail = showInlineComments || showDesktopInfoPanel;
  const showAnchoredCommentPopover =
    !showCommentsHistoryDrawer &&
    utilityPanel === "comments" &&
    !hasInlineCommentSpace &&
    (!!pendingComment || !!selectedThreadId);
  const showUtilityPanelSheet = documentEditorShowsUtilityPanelSheet({
    utilityPanel,
    commentsHistoryDrawerOpen: showCommentsHistoryDrawer,
    hasUtilityRailSpace,
    hasInlineCommentSpace,
    selectedSuggestionId,
  });
  const hasFocusedCommentReply =
    replyDrafts.focus.current?.documentId === documentId;

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
    dismissDocumentCommentFocus({
      commentsHistoryDrawerOpen: showCommentsHistoryDrawer,
      hasUtilityRailSpace,
      hasInlineCommentSpace,
      closeReply: () => replyDrafts.setOpenReply(null),
      clearFocus: clearCommentFocus,
      closePanel: () => {
        setCommentsBrowseOpen(false);
        setUtilityPanel(utilityPanelAfterCommentFocusDismissal);
      },
    });
  }, [
    clearCommentFocus,
    hasInlineCommentSpace,
    hasUtilityRailSpace,
    replyDrafts.setOpenReply,
    showCommentsHistoryDrawer,
  ]);

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
    async (suggestionId: string) => {
      if (
        isSuggesting &&
        suggestionBaseRef.current?.existingSuggestion?.id === suggestionId
      ) {
        return;
      }
      const suggestion = savedSuggestions.find(
        (candidate) => candidate.id === suggestionId,
      );
      if (suggestion && !isStartingSuggestion) {
        setIsStartingSuggestion(true);
        try {
          const readyDocument = await prepareSuggestionDraftDocument();
          if (
            readyDocument &&
            startSuggestionDraft(readyDocument, suggestion)
          ) {
            setPendingComment(null);
            setHoveredThreadId(null);
            setSelectedThreadId(null);
            setSelectedSuggestionId(null);
            setHoveredSuggestionId(null);
            return;
          }
          if (!readyDocument) return;
        } finally {
          setIsStartingSuggestion(false);
        }
      }
      activateSuggestion(suggestionId);
    },
    [
      activateSuggestion,
      isStartingSuggestion,
      isSuggesting,
      prepareSuggestionDraftDocument,
      savedSuggestions,
      startSuggestionDraft,
    ],
  );
  const handledCommentDeepLinkRef = useRef<string | null>(null);

  const handleUtilityPanelChange = useCallback(
    (nextPanel: DocumentUtilityPanel) => {
      ++utilityPanelFocusGenerationRef.current;
      const activeElement = globalThis.document.activeElement;
      if (
        nextPanel &&
        activeElement instanceof HTMLElement &&
        activeElement !== globalThis.document.body
      ) {
        utilityPanelSheetTriggerRef.current = activeElement;
      }
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
    const threadId = new URLSearchParams(location.search).get("comment");
    if (!threadId) {
      handledCommentDeepLinkRef.current = null;
      return;
    }
    const deepLinkKey = `${documentId}:${threadId}`;
    if (
      handledCommentDeepLinkRef.current === deepLinkKey ||
      !threads?.some((thread) => thread.threadId === threadId)
    ) {
      return;
    }
    handledCommentDeepLinkRef.current = deepLinkKey;
    activateCommentThread(threadId, true);
  }, [activateCommentThread, documentId, location.search, threads]);

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
    const commit = (next: AnchoredCommentPosition) =>
      setAnchoredCommentPosition((previous) =>
        sameAnchoredCommentPosition(previous, next) ? previous : next,
      );
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
          commit(
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
        commit(
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

  useEffect(() => {
    if (editorCanEdit && shouldFocusTitleRef.current) {
      shouldFocusTitleRef.current = false;
      requestAnimationFrame(() => titleInputRef.current?.focus());
    }
  });

  const toolbarBreadcrumbItems = useMemo(
    () =>
      documentEditorBreadcrumbNavigationItems(
        documentEditorBreadcrumbItems(
          document,
          localWorkspaceMode ? localDocuments : navigationPath,
        ),
        localDocuments,
        contentSpaces,
        {
          currentDocumentId: document.id,
          currentParentId: document.parentId,
          currentDatabaseSystemRole: document.database?.systemRole ?? null,
          catalogDocumentId: contentSpacesQuery.data?.catalogDocumentId ?? null,
          workspacesTitle: t("sidebar.workspaces"),
        },
        navigationPath,
      ),
    [
      contentSpaces,
      contentSpacesQuery.data?.catalogDocumentId,
      document,
      localDocuments,
      localWorkspaceMode,
      navigationPath,
      t,
    ],
  );

  const handleOpenToolbarBreadcrumb = useCallback<ToolbarBreadcrumbOpen>(
    (targetId, filesDatabaseId) => {
      const space = contentSpaces.find(
        (candidate) =>
          candidate.filesDocumentId === targetId ||
          (!!filesDatabaseId && candidate.filesDatabaseId === filesDatabaseId),
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
            openSpace: () => navigate(`/page/${targetId}`, { flushSync: true }),
          }),
        )
        .catch((error) => {
          toast.error(error instanceof Error ? error.message : String(error));
        });
    },
    [contentSpaces, navigate, setStoredSpaceId],
  );

  const renderCommentsSidebar = (
    visibleThreadId?: string | null,
    alignToAnchors = hasInlineCommentSpace,
    presentation: "inline" | "history" = "inline",
    surface?: "rail" | "popover" | "panel",
  ) => (
    <CommentsSidebar
      compact={!hasInlineCommentSpace}
      replyDrafts={replyDrafts}
      documentId={documentId}
      threads={documentEditorCommentThreads(threads)}
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
      currentUserOrgId={session?.orgId}
      canComment={canComment}
      canResolve={canEdit}
      alignToAnchors={alignToAnchors}
      forceVisible
      suggestions={sidebarSuggestions}
      draftSuggestions={draftSuggestions}
      onMaterializeDraft={async (draft) => {
        const persisted = await flushSuggestionDraft({ keepMode: true });
        if (!persisted) return null;
        const suggestion = materializedSuggestionForDraft(persisted, draft);
        if (suggestion) setSelectedSuggestionId(suggestion.id);
        return suggestion ?? null;
      }}
      canDecideSuggestions={canEdit}
      decidingSuggestion={() =>
        decideSuggestion.isPending ||
        decideSuggestionProposal.isPending ||
        isSubmittingSuggestions ||
        !!pendingSuggestionDecision ||
        !!pendingProposalDecision
      }
      onDecideSuggestionProposal={async (proposalId, decision, members) => {
        if (
          proposalDecisionInFlightRef.current ||
          suggestionDecisionInFlightRef.current ||
          pendingSuggestionDecision ||
          pendingProposalDecision ||
          decideSuggestion.isPending ||
          decideSuggestionProposal.isPending ||
          isSubmittingSuggestions ||
          members.length === 0
        )
          return;
        proposalDecisionInFlightRef.current = true;
        suggestionDecisionGenerationRef.current += 1;
        const decisionGeneration = suggestionDecisionGenerationRef.current;
        const continueSuggesting = isSuggesting;
        setProposalDecisionReadbackDivergence(null);
        setPendingProposalDecision({
          generation: decisionGeneration,
          continueSuggesting,
          requestedDecision: decision,
          accepted: decision === "accepted",
          members,
          beforeContent: document.content,
          readbackContent: null,
        });
        let awaitingReadback = false;
        try {
          let currentMembers = members;
          if (continueSuggesting) {
            const persisted = await flushSuggestionDraft({ keepMode: true });
            if (!persisted) return;
            const refreshed = await suggestionsQuery.refetch();
            if (
              decisionGeneration !== suggestionDecisionGenerationRef.current ||
              documentId !== suggestionDecisionDocumentIdRef.current
            )
              return;
            if (refreshed.isError || !refreshed.data)
              throw (
                refreshed.error ?? new Error("Could not refresh proposal edits")
              );
            currentMembers = refreshed.data.suggestions.filter(
              (suggestion) =>
                suggestion.proposalId === proposalId &&
                suggestion.status === "pending",
            );
            setPendingProposalDecision((current) =>
              current?.generation === decisionGeneration
                ? { ...current, members: currentMembers }
                : current,
            );
          }
          const observed = currentMembers.map((member) => ({
            id: member.id,
            observedRevision: member.revision,
            observedBase: member.baseRevision,
          }));
          const decisionKey = JSON.stringify([proposalId, decision, observed]);
          const idempotencyKey =
            proposalDecisionKeysRef.current.get(decisionKey) ??
            globalThis.crypto.randomUUID();
          proposalDecisionKeysRef.current.set(decisionKey, idempotencyKey);
          if (
            decisionGeneration !== suggestionDecisionGenerationRef.current ||
            documentId !== suggestionDecisionDocumentIdRef.current
          )
            return;
          if (showInlineComments) setPreserveInlineReviewSpace(true);
          const result = await decideSuggestionProposal.mutateAsync({
            proposalId,
            decision,
            idempotencyKey,
            members: observed,
          });
          if (
            decisionGeneration !== suggestionDecisionGenerationRef.current ||
            documentId !== suggestionDecisionDocumentIdRef.current
          )
            return;
          if (
            decision === "accepted" &&
            result.suggestions.every((member) => member.status === "accepted")
          )
            retainCommittedPresentationTransitions(result.suggestions);
          setLocallyCreatedSuggestions((current) => {
            const byId = new Map(current.map((item) => [item.id, item]));
            for (const suggestion of result.suggestions)
              byId.set(suggestion.id, suggestion);
            return [...byId.values()];
          });
          setPendingProposalDecision((current) =>
            current?.generation === decisionGeneration
              ? {
                  ...current,
                  accepted:
                    decision === "accepted" &&
                    result.suggestions.every(
                      (suggestion) => suggestion.status === "accepted",
                    ),
                }
              : current,
          );
          void suggestionsQuery.refetch();
          awaitingReadback = true;
          const readback = await refreshSuggestionDecisionDocument(
            continueSuggesting,
            decision === "accepted" ? "proposal-accepted" : "proposal-other",
          );
          if (readback.status === "refreshed") {
            awaitingReadback = false;
            setPendingProposalDecision((current) =>
              current?.generation === decisionGeneration
                ? { ...current, readbackContent: readback.document.content }
                : current,
            );
          }
        } catch (error) {
          if (
            decisionGeneration !== suggestionDecisionGenerationRef.current ||
            documentId !== suggestionDecisionDocumentIdRef.current
          )
            return;
          void suggestionsQuery.refetch();
          toast.error(t("empty.genericError"), {
            description: actionErrorMessage(error) ?? t("empty.genericError"),
          });
        } finally {
          if (
            decisionGeneration === suggestionDecisionGenerationRef.current &&
            documentId === suggestionDecisionDocumentIdRef.current
          ) {
            if (
              !awaitingReadback &&
              decisionGeneration === suggestionDecisionGenerationRef.current
            )
              setPendingProposalDecision((current) =>
                current?.readbackContent === null ? null : current,
              );
            proposalDecisionInFlightRef.current = false;
          }
        }
      }}
      onDecideSuggestion={async (suggestion, decision) => {
        if (
          suggestionDecisionInFlightRef.current ||
          proposalDecisionInFlightRef.current ||
          pendingSuggestionDecision ||
          pendingProposalDecision ||
          decideSuggestion.isPending ||
          decideSuggestionProposal.isPending ||
          isSubmittingSuggestions
        )
          return;
        suggestionDecisionInFlightRef.current = true;
        suggestionDecisionGenerationRef.current += 1;
        const decisionGeneration = suggestionDecisionGenerationRef.current;
        const continueSuggesting = isSuggesting;
        let observedSuggestion = suggestion;
        if (continueSuggesting) {
          const persisted = await flushSuggestionDraft({ keepMode: true });
          if (!persisted) {
            if (
              decisionGeneration === suggestionDecisionGenerationRef.current &&
              documentId === suggestionDecisionDocumentIdRef.current
            )
              suggestionDecisionInFlightRef.current = false;
            return;
          }
          if (
            decisionGeneration !== suggestionDecisionGenerationRef.current ||
            documentId !== suggestionDecisionDocumentIdRef.current
          )
            return;
          if (suggestion.id === editingSuggestionId) {
            observedSuggestion = [...persisted.values()][0] ?? suggestion;
          }
        }
        if (showInlineComments) setPreserveInlineReviewSpace(true);
        activeSuggestionDecisionIdRef.current = observedSuggestion.id;
        setPendingSuggestionDecision({
          suggestion: observedSuggestion,
          decision,
          continueSuggesting,
          optimistic: true,
          readbackContent: null,
        });
        setDecisionRefreshFailed(false);
        let result: Awaited<ReturnType<typeof decideSuggestion.mutateAsync>>;
        try {
          result = await decideSuggestion.mutateAsync({
            id: observedSuggestion.id,
            decision,
            idempotencyKey: globalThis.crypto.randomUUID(),
            observedBase: observedSuggestion.baseRevision,
            observedRevision: observedSuggestion.revision,
          });
        } catch (error) {
          if (
            decisionGeneration !== suggestionDecisionGenerationRef.current ||
            documentId !== suggestionDecisionDocumentIdRef.current
          )
            return;
          activeSuggestionDecisionIdRef.current = null;
          setPendingSuggestionDecision(null);
          setDecisionRefreshFailed(false);
          suggestionDecisionInFlightRef.current = false;
          toast.error(t("empty.genericError"), {
            description:
              error instanceof Error ? error.message : t("empty.genericError"),
          });
          return;
        }
        if (
          decisionGeneration !== suggestionDecisionGenerationRef.current ||
          documentId !== suggestionDecisionDocumentIdRef.current
        )
          return;
        if (decision === "accepted" && result.suggestion.status === "accepted")
          retainCommittedPresentationTransitions([result.suggestion]);
        if (result.suggestion.status !== decision) {
          const lock = singleSuggestionDecisionLockAfterMismatch(
            {
              inFlight: suggestionDecisionInFlightRef.current,
              activeSuggestionId: activeSuggestionDecisionIdRef.current,
            },
            decision,
            result.suggestion.status,
          );
          suggestionDecisionInFlightRef.current = lock.inFlight;
          activeSuggestionDecisionIdRef.current = lock.activeSuggestionId;
          setPendingSuggestionDecision((current) =>
            current?.suggestion.id === observedSuggestion.id
              ? {
                  ...current,
                  suggestion: result.suggestion,
                  optimistic: false,
                }
              : current,
          );
        }
        setLocallyCreatedSuggestions((current) => {
          const byId = new Map(
            current.map((candidate) => [candidate.id, candidate]),
          );
          byId.set(result.suggestion.id, result.suggestion);
          return [...byId.values()];
        });
        void suggestionsQuery.refetch();
        await refreshSuggestionDecisionDocument(
          continueSuggesting,
          result.suggestion.status === "accepted"
            ? "single-accepted"
            : "single-other",
        );
        if (
          decisionGeneration !== suggestionDecisionGenerationRef.current ||
          documentId !== suggestionDecisionDocumentIdRef.current
        )
          return;
        if (result.suggestion.status === "stale") {
          toast.error(t("editor.toolbar.conflict"));
          setSelectedSuggestionId(result.suggestion.id);
          setUtilityPanel("comments");
          setCommentsBrowseOpen(true);
        }
      }}
      canSuggest={canSuggest}
      commentAi={commentAi}
      visibleThreadId={visibleThreadId}
      presentation={presentation}
      surface={surface}
      onClose={surface === "popover" ? handleEditorEscape : undefined}
    />
  );
  const defaultIconKind = documentEditorDefaultIconKind(document);
  const isDatabasePage = Boolean(document.database);
  const iconRow: DocumentEditorIconRow = document.icon
    ? "icon"
    : canEdit && !isSuggesting
      ? "add"
      : "none";
  useEffect(() => {
    if (host === "page" && !isDatabasePage) {
      rememberPageIconRow(documentId, iconRow);
    }
  }, [documentId, host, iconRow, isDatabasePage]);
  const databaseChoicePending = isDatabaseChoicePending(
    document,
    createDatabase.isPending,
  );
  const showCreateCollectionStarter = createCollectionStarterIsVisible({
    canEdit: editorCanEdit,
    bodyHydrationPending,
    isLocalFileDocument,
    isDatabasePage,
    isCollectionItem: Boolean(
      document.databaseMembership &&
      !contentSpaces.some(
        (space) =>
          space.filesDatabaseId === document.databaseMembership?.databaseId,
      ),
    ),
    content: localContent,
  });
  const handleCreateCollection = useCallback(async () => {
    try {
      const saved = await handleContentSaveNow({
        localTitle: localTitleRef.current,
        localDraft: localContentRef.current,
      });
      if (!saved) throw new Error(t("empty.genericError"));
      await createDatabase.mutateAsync(
        databaseConversionRequest(documentId, localTitleRef.current),
      );
    } catch (error) {
      toast.error(t("sidebar.failedCreateDatabase"), {
        description:
          error instanceof Error ? error.message : t("empty.genericError"),
      });
    }
  }, [createDatabase, documentId, handleContentSaveNow, t]);
  const defaultIcon =
    defaultIconKind === "database" ? (
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
            className="sr-only"
            aria-hidden={!hasUtilityRailSpace || undefined}
          >
            {utilityPanelTitle}
          </h2>
          <div
            role="tablist"
            aria-label={t("comments.panelTabs")}
            className="flex h-full items-stretch gap-5"
            data-utility-panel-tabs
          >
            {(["comments", "info"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={panel === tab}
                onClick={() => {
                  if (panel !== tab) handleUtilityPanelChange(tab);
                }}
                className={cn(
                  "relative inline-flex items-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full",
                  panel === tab && "text-foreground after:bg-foreground",
                )}
              >
                {tab === "comments"
                  ? t("comments.title")
                  : t("editor.toolbar.info")}
              </button>
            ))}
          </div>
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
              ref={inSheet ? utilityPanelSheetCloseRef : undefined}
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
          // React bubbles portal clicks (the @ menu, emoji picker, model menu)
          // through this tree even though they render outside it. Those are
          // interactions with an open comment, not clicks on the page.
          if (target && !event.currentTarget.contains(target)) return;
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
            commentsTriggerRef={commentsHistoryTriggerRef}
            onOpenBreadcrumbItem={
              host === "page" ? handleOpenToolbarBreadcrumb : undefined
            }
            canUndo={
              isSuggesting
                ? editorHistoryStateRef.current.canUndo
                : editorHistoryState.canUndo
            }
            canRedo={
              isSuggesting
                ? editorHistoryStateRef.current.canRedo
                : editorHistoryState.canRedo
            }
            onUndo={() => editorHistoryControllerRef.current?.undo()}
            onRedo={() => editorHistoryControllerRef.current?.redo()}
            canSuggest={canSuggest}
            suggesting={isSuggesting}
            editorEscapeTargetRef={editorEscapeTargetRef}
            onCaptureEditorSelection={capturePageActionsSelection}
            onPreserveEditorSelection={preservePageActionsSelection}
            onRestoreEditorSelection={restorePageActionsSelection}
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
            <DocumentReconcileRecovery
              state={documentReconcileConflict}
              server={{
                title: document.title,
                content: document.content,
                updatedAt: document.updatedAt ?? null,
                revision: document.revision,
              }}
              canEdit={editorCanEdit}
              onKeepMine={handleResolveReconcile}
              onUseSaved={(base) => resolveLiveRecoveryDraft("use_saved", base)}
              onSaveSeparately={(base) =>
                resolveLiveRecoveryDraft("save_separately", base)
              }
              onCopy={copyLiveRecoveryDraft}
              onClose={focusEditorAfterRecoveryReview}
            />
          ) : null}

          {isSuggesting &&
          (!suggestionCapability.canStart ||
            suggestionDraftSaveFailed ||
            (amendmentDraftIsDirty && suggestionAmendmentConflict)) ? (
            <div
              className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2 text-sm"
              role="alert"
              data-suggestion-amendment-conflict
            >
              <span className="me-auto">
                {t(
                  suggestionCapability.canStart && !suggestionDraftSaveFailed
                    ? "editor.suggestionAmendmentResolved"
                    : "editor.suggestionCreateFailed",
                )}
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
                  reserveInlineReviewSpace && "pr-80",
                )}
              >
                <div
                  className={documentEditorTitleRegionClassName(
                    Boolean(document.database),
                    host,
                  )}
                >
                  <div className="mb-1">
                    {documentCanonicalMutationsEnabled(
                      editorCanEdit,
                      isSuggesting,
                    ) ? (
                      <EmojiPicker
                        icon={document.icon}
                        assetScopeDocumentId={document.id}
                        defaultIcon={defaultIcon}
                        defaultIconLabel={
                          defaultIconKind === "database" ? "database" : "page"
                        }
                        onSelect={async (icon) => {
                          if (
                            !documentCanonicalMutationsEnabled(
                              editorCanEdit,
                              isSuggesting,
                            )
                          ) {
                            throw new Error(
                              t("editor.pageSaveBeforeNavigationFailed"),
                            );
                          }
                          const updates = metadataUpdatesWithPendingTitle(
                            { icon },
                            localTitleRef.current,
                            lastSavedTitleRef.current.title,
                          );
                          const saved = await persistDocumentUpdates(updates);
                          if (
                            isDocumentUpdateConflict(saved) ||
                            isDocumentUpdateSuperseded(saved) ||
                            isDocumentUpdatePreservationRequired(saved)
                          ) {
                            throw new Error(
                              t("editor.pageSaveBeforeNavigationFailed"),
                            );
                          }
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
                        }}
                      />
                    ) : document.icon ? (
                      // Sized like the picker's button: a library icon draws
                      // only once its glyph loads.
                      <div className="flex size-14 items-center justify-center p-1 -ml-1">
                        <ContentIcon value={document.icon} size={48} />
                      </div>
                    ) : defaultIconKind === "database" ? (
                      <div className="-ml-1 flex size-14 items-center justify-center rounded-md text-muted-foreground">
                        <IconDatabase className="size-12" aria-hidden="true" />
                      </div>
                    ) : canEdit && !isSuggesting ? (
                      // An editor gets the "Add icon" button once the page
                      // syncs; its row is held so the title does not move.
                      <div className="h-7" aria-hidden="true" />
                    ) : null}
                  </div>
                  <textarea
                    {...(host === "page" ? startupAnchor("title") : {})}
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
                      DOCUMENT_EDITOR_TITLE_CLASS_NAME,
                      "resize-none overflow-hidden border-none bg-transparent outline-none placeholder:text-muted-foreground/40",
                      host === "preview" || isDatabasePage
                        ? DOCUMENT_EDITOR_DATABASE_TITLE_SIZE_CLASS_NAME
                        : DOCUMENT_EDITOR_PAGE_TITLE_SIZE_CLASS_NAME,
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
                      foreground={foreground}
                      canEdit={canEdit}
                      viewId={viewId}
                      onExportContextChange={handleDatabaseExportContextChange}
                    />
                  </div>
                ) : null}

                {!isDatabasePage ? (
                  <div
                    {...(host === "page" ? startupAnchor("body") : {})}
                    className={documentEditorBodyClassName(host)}
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
                          {decisionRefreshFailed &&
                          (pendingSuggestionDecision ||
                            pendingProposalDecision) ? (
                            <div role="alert">
                              <QueryErrorState
                                compact
                                onRetry={() => {
                                  const continueSuggesting =
                                    pendingSuggestionDecision?.continueSuggesting ??
                                    pendingProposalDecision?.continueSuggesting ??
                                    false;
                                  const owner = pendingProposalDecision
                                    ? pendingProposalDecision.accepted
                                      ? "proposal-accepted"
                                      : "proposal-other"
                                    : pendingSuggestionDecision?.decision ===
                                          "accepted" &&
                                        pendingSuggestionDecision.optimistic
                                      ? "single-accepted"
                                      : "single-other";
                                  const decisionGeneration =
                                    suggestionDecisionGenerationRef.current;
                                  void refreshSuggestionDecisionDocument(
                                    continueSuggesting,
                                    owner,
                                  ).then((recovered) => {
                                    if (
                                      recovered.status === "refreshed" &&
                                      (owner === "proposal-accepted" ||
                                        owner === "proposal-other") &&
                                      decisionGeneration ===
                                        suggestionDecisionGenerationRef.current &&
                                      documentId ===
                                        suggestionDecisionDocumentIdRef.current
                                    )
                                      setPendingProposalDecision((current) =>
                                        current?.generation ===
                                        decisionGeneration
                                          ? {
                                              ...current,
                                              readbackContent:
                                                recovered.document.content,
                                            }
                                          : current,
                                      );
                                  });
                                }}
                              />
                            </div>
                          ) : null}
                          {pendingSuggestionDecision?.decision === "accepted" &&
                          pendingSuggestionDecision.optimistic &&
                          visualSuggestions.some(
                            (suggestion) =>
                              suggestion.id ===
                                pendingSuggestionDecision.suggestion.id &&
                              suggestion.presentation === "canonical",
                          ) ? (
                            <div
                              role="status"
                              className="mb-3 text-sm text-muted-foreground"
                            >
                              {t("editor.pageBodySyncing")}
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
                            acceptedDecisionReadback={
                              !isSuggesting &&
                              pendingSuggestionDecision?.decision ===
                                "accepted" &&
                              pendingSuggestionDecision.readbackContent !== null
                                ? {
                                    id: pendingSuggestionDecision.suggestion.id,
                                    content:
                                      pendingSuggestionDecision.readbackContent,
                                  }
                                : null
                            }
                            onAcceptedDecisionRendered={
                              handleAcceptedDecisionRendered
                            }
                            onAcceptedDecisionReadbackOutdated={
                              handleAcceptedDecisionReadbackOutdated
                            }
                            contentResetKey={
                              pendingSuggestionDecision
                                ? `${pendingSuggestionDecision.suggestion.id}:${pendingSuggestionDecision.decision}:${pendingSuggestionDecision.optimistic ? "optimistic" : "canonical"}`
                                : pendingProposalDecision
                                  ? `proposal:${pendingProposalDecision.generation}:${pendingProposalDecision.readbackContent === null ? "pending" : "readback"}`
                                  : null
                            }
                            proposalDecisionReadback={
                              (!isSuggesting ||
                                !pendingProposalDecision?.accepted) &&
                              pendingProposalDecision?.readbackContent !==
                                null &&
                              pendingProposalDecision?.readbackContent !==
                                undefined
                                ? {
                                    generation:
                                      pendingProposalDecision.generation,
                                    content:
                                      pendingProposalDecision.readbackContent,
                                    beforeContent:
                                      pendingProposalDecision.beforeContent,
                                  }
                                : null
                            }
                            onProposalDecisionRendered={
                              handleProposalDecisionRendered
                            }
                            onProposalDecisionReadbackOutdated={
                              handleProposalDecisionReadbackOutdated
                            }
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
                            contentSpaceId={document.spaceId ?? undefined}
                            content={
                              isLocalFileDocument
                                ? localContent
                                : (pendingSuggestionDecisionContent ??
                                  (isSuggesting
                                    ? suggestionDraft
                                    : document.content))
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
                            acknowledgedLocalSnapshot={
                              acknowledgedLocalSnapshot
                            }
                            onBaseAwareReconcile={handleBaseAwareReconcile}
                            onRemoteSnapshotChange={handleRemoteSnapshotChange}
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
                                ? handleImmediateContentChange
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
                              !isStartingSuggestion &&
                              !isSubmittingSuggestions &&
                              !pendingSuggestionDecision &&
                              !pendingProposalDecision
                            }
                            suggesting={isSuggesting}
                            localFileMode={isLocalFileDocument}
                            localFilePath={
                              isLocalFileDocument ? document.source?.path : null
                            }
                            onComment={canComment ? handleComment : undefined}
                            commentThreads={editorCommentThreads}
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
                            onSuggestionAnchorsChange={
                              handleSuggestionAnchorsChange
                            }
                            showCommentIndicators={showCommentIndicators}
                            onJoinTitle={joinFirstBodyBlockToTitle}
                            onOpenNotionPageLink={handleOpenNotionPageLink}
                            notionPageId={document.notionPageId}
                            onHistoryControllerChange={
                              handleHistoryControllerChange
                            }
                            onHistoryStateChange={handleHistoryStateChange}
                            onSelectionControllerChange={
                              handleSelectionControllerChange
                            }
                            onPersistenceControllerChange={
                              handlePersistenceControllerChange
                            }
                          />
                        </>
                      );
                      const primaryEditorWithStarter = (
                        <>
                          {primaryEditor}
                          {showCreateCollectionStarter ? (
                            <Button
                              type="button"
                              variant="ghost"
                              className="mt-2 gap-2 text-muted-foreground"
                              disabled={!editorCanEdit || databaseChoicePending}
                              onClick={() => void handleCreateCollection()}
                            >
                              {databaseChoicePending ? (
                                <IconLoader2 className="animate-spin" />
                              ) : (
                                <IconDatabase />
                              )}
                              {t("editor.createCollection")}
                            </Button>
                          ) : null}
                        </>
                      );

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
                            suggesting={isSuggesting || isStartingSuggestion}
                            enteringSuggestion={isStartingSuggestion}
                            onPrimaryFieldAvailabilityChange={
                              handlePrimaryFieldAvailabilityChange
                            }
                            primaryEditor={primaryEditorWithStarter}
                            pageProperties={document.properties}
                            onAdditionalContentChange={
                              handleAdditionalBlockContentChange
                            }
                          />
                        );
                      }

                      return primaryEditorWithStarter;
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
                      "inline",
                      "popover",
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
          modal
          open={showUtilityPanelSheet}
          onOpenChange={(open) => {
            if (!open) handleUtilityPanelChange(null);
          }}
        >
          <SheetContent
            ref={setUtilityPanelSheetContainer}
            side="right"
            inert={!showUtilityPanelSheet || undefined}
            onOpenAutoFocus={(event) => {
              const activeElement = globalThis.document.activeElement;
              if (
                !utilityPanelSheetTriggerRef.current &&
                activeElement instanceof HTMLElement &&
                activeElement !== globalThis.document.body &&
                !utilityPanelSheetContainer?.contains(activeElement)
              ) {
                utilityPanelSheetTriggerRef.current = activeElement;
              }
              event.preventDefault();
              const focusedReply = hasFocusedCommentReply
                ? utilityPanelSheetContainer?.querySelector<HTMLElement>(
                    "[data-comment-reply-composer] [contenteditable=true]",
                  )
                : null;
              (focusedReply ?? utilityPanelSheetCloseRef.current)?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (hasInlineCommentSpace && hasFocusedCommentReply) return;
              const focusGeneration = utilityPanelFocusGenerationRef.current;
              const restoreTarget = utilityPanelSheetTriggerRef.current;
              const fallbackTarget = commentsHistoryTriggerRef.current;
              globalThis.setTimeout(() => {
                if (utilityPanelFocusGenerationRef.current !== focusGeneration)
                  return;
                (restoreTarget?.isConnected
                  ? restoreTarget
                  : fallbackTarget
                )?.focus();
                utilityPanelSheetTriggerRef.current = null;
              }, 0);
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
