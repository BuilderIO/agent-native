import { isOpenAiMcpAppHost } from "@agent-native/core/client/agent-chat";
import { callAction, useSession } from "@agent-native/core/client/hooks";
import { isEmbedMcpChatBridgeActive } from "@agent-native/core/client/host";
import { useT } from "@agent-native/core/client/i18n";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import type { Document } from "@shared/api";
import { expectedPreviewDraftIdentity } from "@shared/preview-draft-identity";
import { previewDraftTitleIntent } from "@shared/preview-draft-title-intent";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { QueryErrorState } from "@/components/QueryErrorState";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  documentQueryFilter,
  ensurePreviewDocumentDraftRead,
  usePreviewDocumentDraft,
  useResolvePreviewDocumentDraft,
  useUpdateDocument,
  useUpdatePreviewDocumentDraft,
  type PreviewDocumentDraftRecord,
} from "@/hooks/use-documents";
import {
  getDocumentCreationBaseline,
  isDocumentCreationPending,
} from "@/lib/optimistic-document";
import {
  readDocumentShapeHint,
  readPageIconRowHint,
} from "@/lib/page-startup-hints";

import { documentBodyHydrationIsPending } from "./body-hydration";
import {
  flushSnapshotUnchanged,
  type FlushLocalSnapshot,
} from "./document-flush-participant";
import { saveDocumentWithRebase } from "./document-save-rebase";
import { authoredCandidateMatchesContent } from "./document-save-retry";
import { DocumentEditorSkeleton } from "./DocumentEditorSkeleton";
import {
  LiveEditorSessionContext,
  type LiveEditor,
} from "./live-editor-session";
import {
  clearPageDraftJournal,
  liveDraftWriterIds,
  readPageDraftJournal,
  sweepLegacyRetainedPageDraftMarkers,
  writePageDraftJournal,
  type PageDraftJournalEntry,
} from "./page-draft-journal";
import {
  pageRecoveryIdentity,
  RecoveryAttemptEnded,
  useRecoveryAttemptOwner,
  type RecoveryAttempt,
} from "./recovery-attempt";
import { RecoveryComparison } from "./RecoveryComparison";

type DraftRecoveryFailure = "conflict" | "error" | "unknown";

type ResolvePreviewDraft = ReturnType<
  typeof useResolvePreviewDocumentDraft
>["mutateAsync"];

async function resolvePreviewDraftWithRefresh(
  resolve: ResolvePreviewDraft,
  request: Parameters<ResolvePreviewDraft>[0],
  attempt: RecoveryAttempt,
  selected: PreviewDocumentDraftRecord,
  current: () => PreviewDocumentDraftRecord | null | undefined,
  refresh: () => Promise<PreviewDocumentDraftRecord | null>,
) {
  const result = await attempt.step(() => resolve(request));
  // History preservation never replaces the page, and neither does restoring
  // a draft the page already holds. Retry its exact draft once against a
  // freshly observed page; all other choices still require review.
  if (
    request.trigger === "automatic" &&
    result.status === "document_conflict" &&
    result.document &&
    (request.choice === "use_saved" ||
      (request.choice === "keep_mine" &&
        pageHoldsDraft(selected, result.document)))
  ) {
    if (current() && !sameRecoveryDraft(selected, current()))
      return {
        status: "recovery_required" as const,
        reason: "draft_changed" as const,
        document: result.document,
      };
    const refreshed = await attempt.step(refresh);
    if (!sameRecoveryDraft(selected, refreshed))
      return {
        status: "recovery_required" as const,
        reason: "draft_changed" as const,
        document: result.document,
      };
    return attempt.step(() =>
      resolve({
        ...request,
        expectedDocumentTitle: result.document!.title,
        expectedDocumentUpdatedAt: result.document!.updatedAt,
      }),
    );
  }
  return result;
}

function recoveryFailure(error: unknown): DraftRecoveryFailure {
  const errorCode = (error as { errorCode?: unknown } | null)?.errorCode;
  return errorCode === "PREVIEW_DRAFT_TITLE_INTENT_UNKNOWN"
    ? "unknown"
    : errorCode === "PREVIEW_DRAFT_AUTOMATIC_RECOVERY_REFUSED" ||
        errorCode === "PREVIEW_DRAFT_RECOVERY_CONFLICT"
      ? "conflict"
      : "error";
}

function recoveryDraftKey(draft: PreviewDocumentDraftRecord) {
  return JSON.stringify([
    draft.id,
    draft.editorSessionId,
    draft.editGeneration,
    draft.version,
    draft.title,
    draft.baseTitle,
    draft.content,
  ]);
}

function sameRecoveryDraft(
  left: PreviewDocumentDraftRecord | null | undefined,
  right: PreviewDocumentDraftRecord | null | undefined,
) {
  if (!left || !right) return left == null && right == null;
  return (
    left.id === right.id &&
    left.version === right.version &&
    left.title === right.title &&
    left.baseTitle === right.baseTitle &&
    left.content === right.content &&
    left.editorSessionId === right.editorSessionId &&
    left.editGeneration === right.editGeneration
  );
}

// A tab whose save fails keeps a draft of its text, and another tab holding
// the same text through collaboration can still save it. Once the page holds
// the draft, filing it in History or offering it in the chooser repeats the
// page.
function pageHoldsDraft(
  draft: { title: string; content: string },
  page: { title: string; content: string },
): boolean {
  return draft.title === page.title && draft.content === page.content;
}

// The version of the page a review showed. A choice made from that review
// consents to this version alone.
type ReviewedPage = Pick<Document, "title" | "content" | "updatedAt"> & {
  revision: Document["revision"];
};

function reviewedPage(page: Document): ReviewedPage {
  return {
    title: page.title,
    content: page.content,
    updatedAt: page.updatedAt,
    revision: page.revision,
  };
}

function sameReviewedPage(left: ReviewedPage, right: ReviewedPage) {
  return (
    left.updatedAt === right.updatedAt &&
    left.revision === right.revision &&
    left.title === right.title &&
    left.content === right.content
  );
}

// A draft goes back onto the page as an edit of the page's body, so only while
// the page still holds the body the draft was written on. The timestamp alone
// cannot show that: a tab can stamp it from a copy that paired its body with
// the timestamp of a body another writer saved.
function draftWrittenOnPage(
  draft: {
    baseDocumentUpdatedAt: string | null;
    baseContentHash?: string | null;
  },
  page: { updatedAt: string; contentHash?: string },
): boolean {
  return !!draft.baseContentHash && draft.baseContentHash === page.contentHash;
}

export function PageDraftRecovery({
  document,
  children,
}: {
  document: Document;
  children: ReactNode;
}) {
  const t = useT();
  const navigate = useNavigate();
  const openAiWidget = isOpenAiMcpAppHost();
  const widgetBridgeActive = isEmbedMcpChatBridgeActive();
  const scopedWidgetReadOnly = document.mcpDirectoryWidgetReadOnly === true;
  const skipDraftRecovery =
    openAiWidget ||
    scopedWidgetReadOnly ||
    document.canEdit !== true ||
    document.source?.mode === "local-files";
  const { session } = useSession();
  // A page deleted for good leaves its id free, and a page created later under
  // that id renders here without a remount. Only its creation time tells the
  // two apart.
  const incarnation = JSON.stringify([document.id, document.createdAt ?? null]);
  const queryClient = useQueryClient();
  const creationPending = isDocumentCreationPending(queryClient, document);
  const recoveryIdentity = pageRecoveryIdentity(
    session,
    document,
    creationPending,
  );
  const beginAttempt = useRecoveryAttemptOwner(recoveryIdentity);
  const scopeKey = recoveryIdentity.includes(undefined)
    ? null
    : JSON.stringify(recoveryIdentity);
  const openedIncarnationRef = useRef(incarnation);
  // Creation state outlives the creating editor's hold on it, and an
  // optimistic page takes the server's creation time once it is confirmed.
  // A confirmation names the page it confirmed; a later page under the same
  // id is not that page.
  const createdIncarnationRef = useRef<string | null>(null);
  const confirmedCreation = getDocumentCreationBaseline(queryClient, document);
  if (
    creationPending ||
    (confirmedCreation &&
      JSON.stringify([
        confirmedCreation.id,
        confirmedCreation.createdAt ?? null,
      ]) === incarnation)
  ) {
    createdIncarnationRef.current = incarnation;
  }
  const skipCreationDraftRecovery =
    createdIncarnationRef.current === incarnation;
  const drafts = usePreviewDocumentDraft(document.id, {
    enabled:
      !creationPending && !skipDraftRecovery && !skipCreationDraftRecovery,
    createdAt: document.createdAt,
  });
  const update = useUpdateDocument({ saveOrigin: "recovery" });
  const updateDraft = useUpdatePreviewDocumentDraft();
  const resolveDraft = useResolvePreviewDocumentDraft();
  const [releasedScopeKey, setReleasedScopeKey] = useState<string | null>(null);
  const [verifiedScopeKey, setVerifiedScopeKey] = useState<string | null>(null);
  const [verificationRevision, setVerificationRevision] = useState(0);
  const [review, setReview] = useState<{
    scopeKey: string | null;
    draft: PreviewDocumentDraftRecord | null;
    failure: DraftRecoveryFailure;
    document: Document | null;
  } | null>(null);
  const [journalState, setJournalState] = useState<
    "checking" | "promoting" | "waiting_sql" | "ready" | "failed"
  >("checking");
  const [journalRevision, setJournalRevision] = useState(0);
  // Another tab's open editor settles its own journal entries; replaying one
  // here races its save queue and sends a save for text nobody typed here.
  // A query only knows the editors open when it ran, so it holds for the
  // journal entry and SQL draft it was taken for; a tab opened since writes
  // entries it misses.
  const [liveWriters, setLiveWriters] = useState<{
    scopeKey: string;
    entryKey: string | null;
    draftKey: string | null;
    writerIds: ReadonlySet<string>;
  } | null>(null);
  const scopeLiveWriters =
    liveWriters && liveWriters.scopeKey === scopeKey ? liveWriters : null;
  const skippedWriterIds = scopeLiveWriters?.writerIds;
  const journalAttemptRef = useRef<{
    key: string;
    // The SQL draft the attempt stopped behind for review. A choice for a
    // draft that does not hold the journal leaves it, so the attempt runs
    // again once SQL holds any other draft or none.
    waitingFor?: string;
  } | null>(null);
  const pendingJournalRef = useRef<{
    entry: PageDraftJournalEntry;
    draft: PreviewDocumentDraftRecord;
  } | null>(null);
  // One recovery holds the page at a time. Its holder is state, so automatic
  // recovery waits for it and the chooser offers no choice that could not
  // take the page; both run again once the holder lets go.
  const recoveryHolderRef = useRef<RecoveryAttempt | null>(null);
  const [recoveryHolder, setRecoveryHolder] = useState<RecoveryAttempt | null>(
    null,
  );
  const busy = recoveryHolder?.isActive() ?? false;
  const resolvedDraftsRef = useRef(new Set<string>());
  function acquireRecovery() {
    if (recoveryHolderRef.current?.isActive()) return null;
    const owner = beginAttempt();
    recoveryHolderRef.current = owner;
    setRecoveryHolder(owner);
    return owner;
  }
  function releaseRecovery(owner: RecoveryAttempt) {
    if (recoveryHolderRef.current !== owner) return;
    recoveryHolderRef.current = null;
    if (owner.isActive())
      setRecoveryHolder((holder) => (holder === owner ? null : holder));
  }
  const automaticRecoveryRef = useRef<string | null>(null);
  const automaticLegacyRecoveryRef = useRef<string | null>(null);
  const [liveEditor, setLiveEditor] = useState<LiveEditor | null>(null);
  const liveEditorSessionId = liveEditor?.editorSessionId ?? null;
  // A legacy draft of unknown lineage waits for review beside the open
  // editor, so its review also covers the editor's own edits. A choice runs
  // only while the page is still the version the review read and the editor
  // holds the saved edit the review was prepared against; anything typed,
  // synced or saved by a peer since needs a new review and a new click.
  const [legacyReview, setLegacyReview] = useState<
    | { status: "preparing" }
    | { status: "held"; reason: "unsaved" | "changed" | "error" }
    | {
        status: "ready";
        epoch: number;
        draftKey: string;
        page: ReviewedPage;
        editor: FlushLocalSnapshot;
      }
    | { status: "chosen" }
    | null
  >(null);
  const legacyReviewRunRef = useRef(0);
  // The live editor settles drafts it wrote itself; swapping it for a
  // skeleton here would remount it and jump the page to the top.
  const draft =
    drafts.data?.draft &&
    liveEditorSessionId &&
    drafts.data.draft.editorSessionId === liveEditorSessionId
      ? null
      : drafts.data?.draft;
  const currentDraftRef = useRef(draft);
  currentDraftRef.current = draft;
  const currentReview =
    review?.scopeKey === scopeKey && sameRecoveryDraft(review.draft, draft)
      ? review
      : null;
  const failure = currentReview?.failure ?? null;
  const conflictDocument = currentReview?.document ?? null;

  function showRecoveryReview(
    failure: DraftRecoveryFailure,
    page: Document | null = null,
    source: PreviewDocumentDraftRecord | null | undefined = draft,
  ) {
    setReview({ scopeKey, draft: source ?? null, failure, document: page });
  }

  function setFailure(failure: DraftRecoveryFailure | null) {
    if (failure === null) setReview(null);
    else showRecoveryReview(failure, null, draft);
  }
  // So does an editor open in another tab; settling its draft here would move
  // text it is still saving to History. Its draft can outlive its journal
  // entry, or have none when that write failed, so the draft is checked too.
  const draftKey = draft?.editorSessionId
    ? `${draft.editorSessionId}:${draft.editGeneration}:${draft.version}`
    : null;
  const draftLivenessKnown =
    draftKey === null || scopeLiveWriters?.draftKey === draftKey;
  const draftOpenElsewhere = Boolean(
    draft?.editorSessionId && skippedWriterIds?.has(draft.editorSessionId),
  );
  // No scope until the session read returns and the page shows its creation
  // time; the session cache expires, so a page opened later can mount before
  // then. Unverified until it does.
  const scopeVerified = scopeKey !== null && verifiedScopeKey === scopeKey;
  const editorReleased =
    scopeVerified && releasedScopeKey === scopeKey && !draft;

  useEffect(() => {
    setVerifiedScopeKey(null);
    setReleasedScopeKey(null);
    if (
      !scopeKey ||
      creationPending ||
      skipDraftRecovery ||
      skipCreationDraftRecovery
    )
      return;
    const owner = beginAttempt();
    let cancelled = false;
    // A read made for this page's open names its id alone, so it can hold
    // the draft of the page this one replaced.
    const read =
      incarnation === openedIncarnationRef.current
        ? ensurePreviewDocumentDraftRead(
            queryClient,
            document.id,
            document.createdAt,
          )
        : drafts.refetch({ throwOnError: true }).then(({ data }) => {
            if (data?.editable === false)
              throw new Error("The page is no longer editable by this user.");
          });
    void owner
      .step(() => read)
      .then(
        () => {
          if (!cancelled) setVerifiedScopeKey(scopeKey);
        },
        (error: unknown) => {
          if (!cancelled && !(error instanceof RecoveryAttemptEnded))
            setJournalState("failed");
        },
      );
    return () => {
      cancelled = true;
    };
  }, [
    creationPending,
    document.createdAt,
    document.id,
    skipDraftRecovery,
    skipCreationDraftRecovery,
    scopeKey,
    verificationRevision,
  ]);

  useEffect(() => {
    setReview(null);
    resolvedDraftsRef.current.clear();
    automaticRecoveryRef.current = null;
    automaticLegacyRecoveryRef.current = null;
    setJournalState("checking");
    journalAttemptRef.current = null;
    pendingJournalRef.current = null;
    legacyReviewRunRef.current += 1;
    setLegacyReview(null);
  }, [beginAttempt.epoch]);

  function completeJournalRecovery(settled: PreviewDocumentDraftRecord) {
    const pending = pendingJournalRef.current;
    if (!pending || !sameRecoveryDraft(pending.draft, settled)) return;
    // A newer journal is still pending even when this exact SQL draft settled.
    try {
      clearPageDraftJournal(pending.entry.scope, pending.entry.snapshot);
    } catch (error) {
      setJournalState("failed");
      throw error;
    }
    pendingJournalRef.current = null;
    journalAttemptRef.current = null;
    setJournalState("checking");
  }

  useEffect(() => {
    // A mounted editor owns its journal entry until its save queue settles.
    // Replaying it here would race that queue from a stale base and remount
    // the editor mid-edit.
    if (journalState === "promoting" || editorReleased) return;
    if (
      !drafts.data ||
      !scopeVerified ||
      creationPending ||
      documentBodyHydrationIsPending(document)
    )
      return;
    let owner = beginAttempt();
    const accountId = session?.email?.trim().toLowerCase();
    if (!accountId) return;
    const scope = {
      accountId,
      orgId: session?.orgId ?? null,
      documentId: document.id,
    };
    let entry;
    try {
      entry = readPageDraftJournal(scope, skippedWriterIds);
    } catch {
      setJournalState("failed");
      return;
    }
    const entryKey = entry
      ? `${entry.scope.writerId}:${entry.snapshot.editGeneration}:${entry.writtenAt}`
      : null;
    if (
      scopeKey &&
      ((entryKey !== null && scopeLiveWriters?.entryKey !== entryKey) ||
        !draftLivenessKnown)
    ) {
      let cancelled = false;
      void owner
        .step(() => liveDraftWriterIds())
        .then(
          (writerIds) => {
            // Without Web Locks no writer reads as live, so every entry
            // replays, as it did before writer locks.
            if (!cancelled)
              setLiveWriters({
                scopeKey,
                entryKey,
                draftKey,
                writerIds: writerIds ?? new Set(),
              });
          },
          (error: unknown) => {
            if (!cancelled && !(error instanceof RecoveryAttemptEnded))
              setJournalState("failed");
          },
        );
      return () => {
        cancelled = true;
      };
    }
    if (!entry) {
      sweepLegacyRetainedPageDraftMarkers();
      setJournalState("ready");
      return;
    }
    const matchingSqlDraft =
      draft?.editorSessionId === entry.scope.writerId &&
      draft.editGeneration === entry.snapshot.editGeneration &&
      draft.content === entry.snapshot.content;
    // The SQL draft can contain a title update whose localStorage write failed.
    // Only adopt it when the writer, generation, and body all identify this journal.
    let journalStorageSnapshot = entry.snapshot;
    const journalTitleIsClean =
      entry.snapshot.title === entry.snapshot.baseTitle;
    let journalSnapshot =
      matchingSqlDraft &&
      journalTitleIsClean &&
      draft.baseTitle === draft.title &&
      draft.title !== entry.snapshot.title
        ? {
            ...entry.snapshot,
            title: draft.title,
            baseTitle: draft.title,
          }
        : entry.snapshot;
    const matchingSqlDraftHasLocalTitleConflict =
      matchingSqlDraft &&
      !journalTitleIsClean &&
      entry.snapshot.title !== draft?.title;
    const sameAsCanonical =
      journalSnapshot.title === document.title &&
      journalSnapshot.content === document.content;
    const sameAsSqlDraft =
      draft?.title === journalSnapshot.title &&
      draft.content === journalSnapshot.content;
    if (
      sameAsCanonical ||
      (matchingSqlDraft &&
        sameAsSqlDraft &&
        draft.baseDocumentUpdatedAt === document.updatedAt &&
        draft.baseTitle === journalSnapshot.baseTitle)
    ) {
      try {
        clearPageDraftJournal(entry.scope, journalStorageSnapshot);
        setJournalState("checking");
        setJournalRevision((revision) => revision + 1);
      } catch {
        setJournalState("failed");
      }
      return;
    }
    // A page keeps one SQL draft, and an editor open in another tab is still
    // writing it, so a closed tab's entry waits whatever text the two share.
    if (
      draft &&
      (draftOpenElsewhere ||
        (!sameAsSqlDraft && !matchingSqlDraftHasLocalTitleConflict))
    ) {
      setJournalState("waiting_sql");
      return;
    }
    const attempt = `${accountId}:${scope.orgId ?? ""}:${document.id}:${entry.scope.writerId}:${entry.snapshot.editGeneration}:${entry.writtenAt}`;
    // Compared with the unfiltered read: a draft the live editor wrote is
    // hidden from review but still holds the page.
    const latched = journalAttemptRef.current;
    const storedDraft = drafts.data.draft;
    if (
      latched?.key === attempt &&
      (latched.waitingFor === undefined ||
        (storedDraft && latched.waitingFor === recoveryDraftKey(storedDraft)))
    )
      return;
    const acquired = acquireRecovery();
    if (!acquired) return;
    owner = acquired;
    journalAttemptRef.current = { key: attempt };
    setJournalState("promoting");
    // Another writer's draft can hold the same text; settling it here would
    // consume and fence that writer's generation.
    const holdsJournal = (sqlDraft: PreviewDocumentDraftRecord) =>
      sqlDraft.editorSessionId === entry.scope.writerId &&
      sqlDraft.editGeneration === journalSnapshot.editGeneration &&
      sqlDraft.title === journalSnapshot.title &&
      sqlDraft.baseTitle === journalSnapshot.baseTitle &&
      sqlDraft.content === journalSnapshot.content;
    // A review shows only the draft this page last read, and that read can
    // predate the one SQL holds now. With no draft there, nothing proves the
    // journal was recovered.
    const reviewCurrentDraft = async (
      failure?: DraftRecoveryFailure,
      page: Document | null = null,
    ) => {
      const current = (
        await owner.step(() => drafts.refetch({ throwOnError: true }))
      ).data?.draft;
      if (!current) throw new Error("The recovery draft could not be read.");
      showRecoveryReview(
        failure ?? (current.baseTitle == null ? "unknown" : "conflict"),
        page,
        current,
      );
      if (holdsJournal(current))
        pendingJournalRef.current = {
          entry: { ...entry, snapshot: journalStorageSnapshot },
          draft: current,
        };
      journalAttemptRef.current = {
        key: attempt,
        waitingFor: recoveryDraftKey(current),
      };
      setJournalState("waiting_sql");
    };
    const promote = async () => {
      const retainedDraft =
        draft && holdsJournal(draft)
          ? draft
          : (
              await owner.step(() =>
                updateDraft.mutateAsync({
                  operation: "upsert",
                  documentId: document.id,
                  ...(draft
                    ? {
                        expectedVersion: draft.version,
                        expectedDraftId: draft.id,
                      }
                    : { expectedVersion: null }),
                  draft: {
                    title: journalSnapshot.title,
                    baseTitle: journalSnapshot.baseTitle,
                    content: journalSnapshot.content,
                    editorSessionId: entry.scope.writerId,
                    editGeneration: journalSnapshot.editGeneration,
                    baseDocumentUpdatedAt:
                      journalSnapshot.baseUpdatedAt ??
                      (journalSnapshot.baseTitle === document.title &&
                      journalSnapshot.baseContent === document.content
                        ? document.updatedAt
                        : null),
                    // Bound for History: only a choice in the chooser puts it
                    // back on the page.
                    baseContentHash: null,
                    loadedContentWasEmpty: journalSnapshot.baseContent === "",
                    deferredReason: "conflict",
                  },
                }),
              )
            ).draft;
      if (!retainedDraft || !holdsJournal(retainedDraft)) {
        await reviewCurrentDraft();
        return;
      }
      pendingJournalRef.current = {
        entry: { ...entry, snapshot: journalStorageSnapshot },
        draft: retainedDraft,
      };
      const preserved = await resolvePreviewDraftWithRefresh(
        resolveDraft.mutateAsync,
        {
          choice: "use_saved",
          trigger: "automatic",
          documentId: document.id,
          ...expectedPreviewDraftIdentity(retainedDraft),
          expectedDraftVersion: retainedDraft.version,
          expectedDraftTitle: retainedDraft.title,
          expectedDraftContent: retainedDraft.content,
          expectedDraftBaseTitle: retainedDraft.baseTitle,
          expectedDocumentTitle: document.title,
          expectedDocumentUpdatedAt: document.updatedAt,
        },
        owner,
        retainedDraft,
        () => currentDraftRef.current,
        async () => {
          await owner.step(() =>
            queryClient.refetchQueries(documentQueryFilter(document.id), {
              throwOnError: true,
            }),
          );
          const refreshed = await owner.step(() =>
            drafts.refetch({ throwOnError: true }),
          );
          if (!refreshed.data)
            throw new Error("The recovery draft could not be read.");
          return refreshed.data.draft;
        },
      );
      if (preserved.status !== "resolved") {
        await reviewCurrentDraft("conflict", preserved.document);
        return;
      }
      resolvedDraftsRef.current.add(recoveryDraftKey(retainedDraft));
      completeJournalRecovery(retainedDraft);
      toast.success(t("editor.previewDraftSavedToHistory"));
      await owner.step(() =>
        queryClient.refetchQueries(documentQueryFilter(document.id)),
      );
      await owner.step(() => drafts.refetch());
      setJournalState("checking");
    };
    void (async () => {
      const attemptIds = [
        journalSnapshot.saveAttemptId,
        ...(journalSnapshot.equivalentSaveAttemptIds ?? []),
      ].filter((attemptId): attemptId is string => !!attemptId);
      for (const attemptId of attemptIds) {
        const receipt = await owner.step(() =>
          callAction<{
            found: boolean;
            preservationRequired?: {
              reason: "structure" | "provenance";
              checkpointId: string;
            };
          }>(
            "get-document-save-attempt",
            {
              id: document.id,
              browserSaveAttemptId: attemptId,
            },
            { method: "GET" },
          ),
        );
        if (receipt.found && receipt.preservationRequired) {
          if (!clearPageDraftJournal(entry.scope, journalStorageSnapshot))
            throw new Error("The journal changed during History preservation.");
          toast.success(t("editor.previewDraftSavedToHistory"));
          setJournalState("checking");
          return;
        }
        if (receipt.found) {
          clearPageDraftJournal(entry.scope, journalStorageSnapshot);
          await owner.step(() =>
            queryClient.refetchQueries(documentQueryFilter(document.id)),
          );
          setJournalState("checking");
          return;
        }
      }
      const baseUpdatedAt =
        journalSnapshot.baseUpdatedAt ??
        (journalSnapshot.baseTitle === document.title &&
        journalSnapshot.baseContent === document.content
          ? document.updatedAt
          : null);
      const localChangedTitle =
        journalSnapshot.title !== journalSnapshot.baseTitle;
      const titleConflict =
        localChangedTitle &&
        document.title !== journalSnapshot.baseTitle &&
        document.title !== journalSnapshot.title;
      if (!baseUpdatedAt || titleConflict) {
        await promote();
        return;
      }
      let winnerTitle = document.title;
      let attemptedContent = journalSnapshot.content;
      const outcome = await owner.step(() =>
        saveDocumentWithRebase({
          base: {
            content: journalSnapshot.baseContent,
            updatedAt: baseUpdatedAt,
            revision: journalSnapshot.baseRevision,
          },
          content: journalSnapshot.content,
          canRetry: (winner) => {
            winnerTitle = winner.title;
            return (
              !localChangedTitle ||
              winner.title === journalSnapshot.baseTitle ||
              winner.title === journalSnapshot.title
            );
          },
          confirmsWrite: (winner) =>
            winner.title ===
            (localChangedTitle ? journalSnapshot.title : winnerTitle),
          // The journal write is part of the step, so it waits for the owner
          // as the save does.
          persist: (content, base) =>
            owner.step(async () => {
              attemptedContent = content;
              const saveAttemptId = crypto.randomUUID();
              const nextSnapshot = {
                ...journalSnapshot,
                content,
                baseContent: base.content,
                baseUpdatedAt: base.updatedAt,
                baseRevision: base.revision,
                saveAttemptId,
                priorSaveAttemptIds: undefined,
                equivalentSaveAttemptIds: undefined,
              };
              const written = writePageDraftJournal({
                scope: entry.scope,
                snapshot: nextSnapshot,
              });
              if (written.snapshot.saveAttemptId !== saveAttemptId)
                throw new Error(
                  "A newer local edit superseded journal replay.",
                );
              journalStorageSnapshot = written.snapshot;
              journalSnapshot = nextSnapshot;
              return update.mutateAsync({
                id: document.id,
                browserSaveAttemptId: saveAttemptId,
                ...(localChangedTitle ? { title: journalSnapshot.title } : {}),
                content,
                baseUpdatedAt: base.updatedAt ?? undefined,
                baseRevision: base.revision,
                ...(localChangedTitle
                  ? { baseTitle: journalSnapshot.baseTitle }
                  : {}),
                loadedUpdatedAt: base.updatedAt ?? undefined,
                loadedContentWasEmpty: base.content === "",
                editorSessionId: entry.scope.writerId,
                editorEditGeneration: journalSnapshot.editGeneration,
                editorSnapshotTitle: localChangedTitle
                  ? journalSnapshot.title
                  : winnerTitle,
                editorSnapshotContent: content,
                ...(journalSnapshot.authoredBaseRevision &&
                journalSnapshot.authoredBaseContent !== undefined &&
                authoredCandidateMatchesContent(
                  content,
                  journalSnapshot.authoredCandidateContent,
                )
                  ? {
                      authoredBaseRevision:
                        journalSnapshot.authoredBaseRevision,
                      authoredBaseContent: journalSnapshot.authoredBaseContent,
                      authoredCandidateContent:
                        journalSnapshot.authoredCandidateContent,
                    }
                  : {}),
              });
            }),
        }),
      );
      if (outcome.status === "superseded") {
        clearPageDraftJournal(entry.scope, journalStorageSnapshot);
        await owner.step(() =>
          queryClient.refetchQueries(documentQueryFilter(document.id)),
        );
        await owner.step(() => drafts.refetch());
        setJournalState("checking");
        return;
      }
      if (outcome.status === "preservation") {
        if (!clearPageDraftJournal(entry.scope, journalStorageSnapshot))
          throw new Error("The journal changed during History preservation.");
        toast.success(t("editor.previewDraftSavedToHistory"));
        await owner.step(() =>
          queryClient.refetchQueries(documentQueryFilter(document.id)),
        );
        setJournalState("checking");
        return;
      }
      const intentOutcome =
        outcome.status === "saved" && "bodyIntentOutcome" in outcome.document
          ? outcome.document.bodyIntentOutcome
          : undefined;
      if (
        outcome.status !== "saved" ||
        (outcome.document.content !== attemptedContent &&
          !(
            intentOutcome &&
            typeof intentOutcome === "object" &&
            "status" in intentOutcome &&
            (intentOutcome.status === "applied" ||
              intentOutcome.status === "displaced-preserved")
          )) ||
        outcome.document.title !==
          (localChangedTitle ? entry.snapshot.title : winnerTitle)
      ) {
        await promote();
        return;
      }
      clearPageDraftJournal(entry.scope, journalStorageSnapshot);
      await owner.step(() =>
        queryClient.refetchQueries(documentQueryFilter(document.id)),
      );
      await owner.step(() => drafts.refetch());
      setJournalState("checking");
    })()
      .catch((error: unknown) => {
        const failure = recoveryFailure(error);
        if (failure === "error") throw error;
        return reviewCurrentDraft(failure);
      })
      .catch((error: unknown) => {
        if (!(error instanceof RecoveryAttemptEnded)) setJournalState("failed");
      })
      .finally(() => releaseRecovery(owner));
  }, [
    busy,
    creationPending,
    document,
    draft,
    drafts.data,
    editorReleased,
    journalRevision,
    journalState,
    scopeKey,
    scopeLiveWriters,
    scopeVerified,
    session?.email,
    session?.orgId,
  ]);

  useEffect(() => {
    if (
      drafts.data?.draft === null &&
      scopeVerified &&
      journalState === "ready"
    )
      setReleasedScopeKey(scopeKey);
  }, [drafts.data, journalState, scopeKey, scopeVerified]);

  async function discardDraft(
    settled: NonNullable<typeof draft>,
    ifPageHoldsDraft = false,
    owner: RecoveryAttempt = beginAttempt(),
  ) {
    const result = await owner.step(() =>
      updateDraft.mutateAsync({
        operation: "delete",
        documentId: document.id,
        expectedDraftId: settled.id,
        expectedVersion: settled.version,
        expectedTitle: settled.title,
        expectedContent: settled.content,
        expectedBaseTitle: settled.baseTitle ?? null,
        ...(settled.editorSessionId
          ? { expectedEditorSessionId: settled.editorSessionId }
          : {}),
        ...(typeof settled.editGeneration === "number"
          ? { expectedEditGeneration: settled.editGeneration }
          : {}),
        ...(ifPageHoldsDraft ? { ifPageHoldsDraft: true as const } : {}),
      }),
    );
    // A page that moved on since this tab read it is recovered against
    // its newer version once both are read again.
    if (result.status !== "deleted" && !ifPageHoldsDraft)
      throw new Error("The saved draft changed during recovery.");
    await owner.step(() =>
      queryClient.refetchQueries(documentQueryFilter(document.id)),
    );
    await owner.step(() => drafts.refetch());
  }

  async function resolveConflict(
    choice: "keep_mine" | "use_saved" | "save_separately",
    trigger: "automatic" | "reviewed" = "reviewed",
    onAcquired?: () => void,
    reviewed: ReviewedPage = reviewedPage(conflictDocument ?? document),
  ) {
    if (!draft || busy) return;
    const owner = acquireRecovery();
    if (!owner) return;
    onAcquired?.();
    setFailure(null);
    try {
      const result = await resolvePreviewDraftWithRefresh(
        resolveDraft.mutateAsync,
        {
          choice,
          trigger,
          documentId: document.id,
          ...expectedPreviewDraftIdentity(draft),
          expectedDraftVersion: draft.version,
          expectedDraftTitle: draft.title,
          expectedDraftContent: draft.content,
          expectedDraftBaseTitle: draft.baseTitle ?? null,
          expectedDocumentTitle: reviewed.title,
          expectedDocumentUpdatedAt: reviewed.updatedAt,
        },
        owner,
        draft,
        () => currentDraftRef.current,
        async () => {
          await owner.step(() =>
            queryClient.refetchQueries(documentQueryFilter(document.id), {
              throwOnError: true,
            }),
          );
          const refreshed = await owner.step(() =>
            drafts.refetch({ throwOnError: true }),
          );
          if (!refreshed.data)
            throw new Error("The recovery draft could not be read.");
          return refreshed.data.draft;
        },
      );
      if (result.status !== "resolved") {
        if (
          result.status === "document_conflict" &&
          trigger === "reviewed" &&
          result.document &&
          pageHoldsDraft(draft, result.document)
        ) {
          await discardDraft(draft, true, owner);
          return;
        }
        showRecoveryReview("conflict", result.document ?? null, draft);
        return;
      }
      resolvedDraftsRef.current.add(recoveryDraftKey(draft));
      completeJournalRecovery(draft);
      if (choice === "use_saved")
        toast.success(t("editor.previewDraftSavedToHistory"));
      if (choice === "save_separately")
        toast.success(t("editor.previewDraftSavedSeparately"), {
          action: result.urlPath
            ? {
                label: t("editor.previewDraftOpenSavedPage"),
                onClick: () => {
                  if (owner.isActive()) void navigate(result.urlPath!);
                },
              }
            : undefined,
        });
      await owner.step(() =>
        queryClient.refetchQueries(documentQueryFilter(document.id)),
      );
      await owner.step(() => drafts.refetch());
    } catch (error) {
      if (!owner.isActive()) return;
      setFailure(recoveryFailure(error));
      try {
        await owner.step(() => drafts.refetch({ throwOnError: true }));
      } catch {
        if (owner.isActive()) setFailure("error");
      }
    } finally {
      releaseRecovery(owner);
    }
  }

  // An automatic choice counts as made once it holds the page.
  function chooseAutomatically(
    made: { current: string | null },
    attempt: string,
    choice: "keep_mine" | "use_saved",
  ) {
    void resolveConflict(choice, "automatic", () => {
      made.current = attempt;
    });
  }

  // Saves the editor's edits, then reads the page and draft again, so the
  // review shows what a choice would act on.
  async function reviewLegacyDraft() {
    if (!draft || busy) return;
    const run = ++legacyReviewRunRef.current;
    const attempt = beginAttempt();
    const epoch = beginAttempt.epoch;
    const flush = liveEditor?.flush ?? null;
    const settle = (next: typeof legacyReview) => {
      if (legacyReviewRunRef.current === run) setLegacyReview(next);
    };
    setLegacyReview({ status: "preparing" });
    if (!flush) return settle({ status: "held", reason: "unsaved" });
    try {
      await attempt.step(() => flush.drain());
    } catch (error) {
      if (!(error instanceof RecoveryAttemptEnded))
        settle({ status: "held", reason: "unsaved" });
      return;
    }
    let reviewed: PreviewDocumentDraftRecord | null;
    try {
      await attempt.step(() =>
        queryClient.refetchQueries(documentQueryFilter(document.id), {
          throwOnError: true,
        }),
      );
      const refreshed = await attempt.step(() =>
        drafts.refetch({ throwOnError: true }),
      );
      reviewed = refreshed.data?.draft ?? null;
    } catch (error) {
      if (!(error instanceof RecoveryAttemptEnded))
        settle({ status: "held", reason: "error" });
      return;
    }
    // The page as this review's own reads left it, which the rendered page
    // may not show yet. Reads that disagree saw a save land between them.
    const pages = queryClient
      .getQueryCache()
      .findAll(documentQueryFilter(document.id))
      .flatMap((query) =>
        query.state.data ? [reviewedPage(query.state.data as Document)] : [],
      );
    const page = pages[0];
    if (!page || pages.some((other) => !sameReviewedPage(page, other)))
      return settle({ status: "held", reason: "error" });
    const editor = flush.snapshot();
    if (!editor.clean) return settle({ status: "held", reason: "unsaved" });
    if (!reviewed) return settle(null);
    settle({
      status: "ready",
      epoch,
      draftKey: recoveryDraftKey(reviewed),
      page,
      editor,
    });
  }

  // What the review shows and what a click may do: both hold only while the
  // owner, the draft, the page version and the editor's saved edit and claim
  // are the ones the review read. Clicks check again, since an edit typed
  // after the review re-renders nothing here.
  function legacyReviewHolds(
    review: typeof legacyReview,
  ): review is Extract<typeof legacyReview, { status: "ready" }> {
    const editor = liveEditor?.flush?.snapshot();
    return (
      review?.status === "ready" &&
      review.epoch === beginAttempt.epoch &&
      !!draft &&
      review.draftKey === recoveryDraftKey(draft) &&
      sameReviewedPage(review.page, reviewedPage(document)) &&
      !!editor?.clean &&
      flushSnapshotUnchanged(review.editor, editor) &&
      JSON.stringify(review.editor.claim) === JSON.stringify(editor.claim)
    );
  }

  function chooseReviewedLegacy(
    choice: "keep_mine" | "use_saved" | "save_separately",
  ) {
    if (!legacyReviewHolds(legacyReview)) {
      legacyReviewRunRef.current += 1;
      setLegacyReview({ status: "held", reason: "changed" });
      return;
    }
    const { page } = legacyReview;
    setLegacyReview({ status: "chosen" });
    void resolveConflict(choice, "reviewed", undefined, page);
  }

  // The copy itself never waits: the browser allows it only while the click
  // that asked for it is current. Only its report waits for the owner.
  function copyDraft(content: string) {
    const copied = writeClipboardText(content);
    void beginAttempt()
      .step(() => copied)
      .then(
        (done) => {
          if (done) toast.success(t("editor.unsavedTextCopied"));
          else toast.error(t("editor.toolbar.clipboardAccessUnavailable"));
        },
        (error: unknown) => {
          if (!(error instanceof RecoveryAttemptEnded)) throw error;
        },
      );
  }

  const hasEditIdentity = Boolean(
    draft?.editorSessionId && draft.editGeneration !== null,
  );
  useEffect(() => {
    if (
      !draft ||
      resolvedDraftsRef.current.has(recoveryDraftKey(draft)) ||
      hasEditIdentity ||
      busy ||
      failure ||
      journalState === "checking" ||
      journalState === "promoting" ||
      !scopeVerified
    )
      return;
    const attempt = `${draft.id}:${draft.version}:${document.updatedAt}`;
    if (automaticLegacyRecoveryRef.current === attempt) return;
    const intent = previewDraftTitleIntent(draft, document.title);
    if (intent.status === "unknown") {
      automaticLegacyRecoveryRef.current = attempt;
      setFailure("unknown");
      return;
    }
    if (
      draftWrittenOnPage(draft, document) &&
      (!intent.changesTitle ||
        document.title === draft.baseTitle ||
        document.title === draft.title)
    ) {
      chooseAutomatically(automaticLegacyRecoveryRef, attempt, "keep_mine");
      return;
    }
    chooseAutomatically(automaticLegacyRecoveryRef, attempt, "use_saved");
  }, [
    busy,
    document.updatedAt,
    draft,
    failure,
    hasEditIdentity,
    journalState,
    scopeVerified,
  ]);
  useEffect(() => {
    if (
      !draft ||
      resolvedDraftsRef.current.has(recoveryDraftKey(draft)) ||
      !hasEditIdentity ||
      !draftLivenessKnown ||
      draftOpenElsewhere ||
      busy ||
      failure ||
      journalState === "checking" ||
      journalState === "promoting" ||
      !scopeVerified ||
      documentBodyHydrationIsPending(document)
    )
      return;
    const attempt = `${draft.id}:${draft.editorSessionId}:${draft.editGeneration}:${draft.version}:${document.updatedAt}`;
    if (automaticRecoveryRef.current === attempt) return;
    const intent = previewDraftTitleIntent(draft, document.title);
    if (intent.status === "unknown") {
      setFailure("unknown");
      return;
    }
    if (journalState === "waiting_sql") {
      setFailure("conflict");
      return;
    }
    if (pageHoldsDraft(draft, document)) {
      chooseAutomatically(automaticRecoveryRef, attempt, "keep_mine");
      return;
    }
    if (
      draftWrittenOnPage(draft, document) &&
      (!intent.changesTitle ||
        document.title === draft.baseTitle ||
        document.title === draft.title)
    ) {
      chooseAutomatically(automaticRecoveryRef, attempt, "keep_mine");
      return;
    }
    if (session?.email) {
      try {
        const journal = readPageDraftJournal(
          {
            accountId: session.email.trim().toLowerCase(),
            orgId: session.orgId ?? null,
            documentId: document.id,
          },
          skippedWriterIds,
        );
        if (
          journal?.snapshot.title === draft.title &&
          journal.snapshot.content === draft.content
        )
          return;
      } catch {
        setJournalState("failed");
        return;
      }
    }
    chooseAutomatically(automaticRecoveryRef, attempt, "use_saved");
  }, [
    busy,
    document,
    draft,
    draftLivenessKnown,
    draftOpenElsewhere,
    failure,
    hasEditIdentity,
    journalState,
    scopeVerified,
    session?.email,
    session?.orgId,
    skippedWriterIds,
  ]);

  // Keep the editor at one tree position so a notice never remounts it.
  const withNotice = (notice: ReactNode) => (
    <LiveEditorSessionContext.Provider value={setLiveEditor}>
      {notice}
      {children}
    </LiveEditorSessionContext.Provider>
  );
  // Scoped widget tickets identify the document, not a cookie session whose
  // private draft journal can be verified.
  if (skipDraftRecovery || skipCreationDraftRecovery) return withNotice(null);
  if (editorReleased) return withNotice(null);
  if (drafts.isError)
    return (
      <QueryErrorState
        onRetry={() => {
          setVerificationRevision((revision) => revision + 1);
          void drafts.refetch();
        }}
        retrying={drafts.isFetching}
      />
    );
  if (journalState === "failed")
    return (
      <QueryErrorState
        onRetry={() => {
          journalAttemptRef.current = null;
          setJournalState("checking");
          setVerificationRevision((revision) => revision + 1);
          void drafts.refetch();
        }}
        retrying={drafts.isFetching}
      />
    );
  if (
    !drafts.data ||
    !scopeVerified ||
    journalState === "checking" ||
    journalState === "promoting"
  )
    return (
      <DocumentEditorSkeleton
        title={document.title}
        iconRow={readPageIconRowHint(document.id)}
        shape={readDocumentShapeHint(document)}
        stalledLoad={
          widgetBridgeActive
            ? {
                stage: t("editor.widgetDraftCheckStage"),
                action: "get-preview-document-draft",
              }
            : undefined
        }
      />
    );
  if (!draft || draftOpenElsewhere) return withNotice(null);
  const savedVersion = conflictDocument ?? document;
  const keepMineDisabled =
    documentBodyHydrationIsPending(document) ||
    draft.baseTitle == null ||
    failure === "unknown";
  // No automatic choice settles a legacy draft of unknown lineage, so it waits
  // for review in a notice while the editor stays open. Journaled text waiting
  // behind the draft still goes first: recovering it after the editor opened
  // would replace the editor.
  if (!hasEditIdentity && draft.baseTitle == null && journalState === "ready") {
    const reviewReady = legacyReviewHolds(legacyReview);
    const reviewStale = legacyReview?.status === "ready" && !reviewReady;
    const reviewHeld =
      legacyReview?.status === "held" ||
      reviewStale ||
      (legacyReview?.status === "chosen" && !busy);
    const legacySaved = reviewReady ? legacyReview.page : savedVersion;
    return withNotice(
      <Dialog
        open={legacyReview !== null}
        onOpenChange={(open) => {
          if (open || busy) return;
          legacyReviewRunRef.current += 1;
          setLegacyReview(null);
        }}
      >
        <div
          className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2 text-sm"
          data-page-draft-recovery-notice
        >
          <span className="me-auto min-w-0 flex-1 basis-56" role="status">
            {t("editor.previewDraftRecovery")}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => copyDraft(draft.content)}
          >
            {t("editor.copyUnsavedText")}
          </Button>
          <DialogTrigger asChild>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => void reviewLegacyDraft()}
            >
              {t("editor.reconcileReview")}
            </Button>
          </DialogTrigger>
        </div>
        <DialogContent className="flex h-[min(46rem,calc(100dvh-2rem))] max-w-[min(72rem,calc(100vw-2rem))] flex-col overflow-hidden p-0 sm:max-w-[min(72rem,calc(100vw-2rem))]">
          <DialogTitle className="sr-only">
            {t("editor.reconcileReview")}
          </DialogTitle>
          <RecoveryComparison
            mine={{ title: draft.title, content: draft.content }}
            saved={{ title: legacySaved.title, content: legacySaved.content }}
            busy={
              busy ||
              legacyReview?.status === "preparing" ||
              legacyReview?.status === "chosen"
            }
            keepMineDisabled={keepMineDisabled}
            failure={
              reviewStale
                ? t("editor.reconcileReviewStale")
                : legacyReview?.status === "held"
                  ? legacyReview.reason === "unsaved"
                    ? t("editor.reconcileSaveFailed")
                    : legacyReview.reason === "changed"
                      ? t("editor.reconcileReviewStale")
                      : t("empty.genericError")
                  : failure === "conflict"
                    ? t("editor.previewDraftConflict")
                    : failure === "error"
                      ? t("empty.genericError")
                      : t("editor.previewDraftTitleUnknown")
            }
            stale={reviewHeld}
            onRefresh={() => void reviewLegacyDraft()}
            onKeepMine={() => {
              if (keepMineDisabled) return;
              chooseReviewedLegacy("keep_mine");
            }}
            onUseSaved={() => chooseReviewedLegacy("use_saved")}
            onSaveSeparately={() => chooseReviewedLegacy("save_separately")}
            onCopy={() => copyDraft(draft.content)}
          />
        </DialogContent>
      </Dialog>,
    );
  }
  // Legacy drafts are preserved automatically; that path toasts once.
  if (!hasEditIdentity && !failure) return withNotice(null);
  if (!failure)
    return (
      <DocumentEditorSkeleton
        title={document.title}
        iconRow={readPageIconRowHint(document.id)}
        shape={readDocumentShapeHint(document)}
      />
    );
  return (
    <RecoveryComparison
      mine={{ title: draft.title, content: draft.content }}
      saved={{ title: savedVersion.title, content: savedVersion.content }}
      busy={busy}
      keepMineDisabled={keepMineDisabled}
      failure={
        failure === "unknown"
          ? t("editor.previewDraftTitleUnknown")
          : failure === "conflict"
            ? t("editor.previewDraftConflict")
            : t("empty.genericError")
      }
      onKeepMine={() => {
        if (keepMineDisabled) return;
        void resolveConflict("keep_mine");
      }}
      onUseSaved={() => void resolveConflict("use_saved")}
      onSaveSeparately={() => void resolveConflict("save_separately")}
      onCopy={() => copyDraft(draft.content)}
    />
  );
}
