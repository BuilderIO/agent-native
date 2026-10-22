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
  isDocumentCreationConfirmed,
  isDocumentCreationPending,
} from "@/lib/optimistic-document";
import {
  readDocumentShapeHint,
  readPageIconRowHint,
} from "@/lib/page-startup-hints";

import { documentBodyHydrationIsPending } from "./body-hydration";
import { saveDocumentWithRebase } from "./document-save-rebase";
import { authoredCandidateMatchesContent } from "./document-save-retry";
import { DocumentEditorSkeleton } from "./DocumentEditorSkeleton";
import { LiveEditorSessionContext } from "./live-editor-session";
import {
  clearPageDraftJournal,
  liveDraftWriterIds,
  readPageDraftJournal,
  sweepLegacyRetainedPageDraftMarkers,
  writePageDraftJournal,
  type PageDraftJournalEntry,
} from "./page-draft-journal";
import {
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
  // History preservation never replaces the page. Retry its exact draft once
  // against a freshly observed page; all other choices still require review.
  if (
    request.trigger === "automatic" &&
    request.choice === "use_saved" &&
    result.status === "document_conflict" &&
    result.document
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
  const scopeKey = session?.email
    ? JSON.stringify([
        session.email.trim().toLowerCase(),
        session.orgId ?? null,
        document.id,
      ])
    : null;
  const beginAttempt = useRecoveryAttemptOwner(scopeKey);
  const queryClient = useQueryClient();
  const creationPending = isDocumentCreationPending(queryClient, document);
  const skipCreationDraftRecoveryRef = useRef(
    creationPending || isDocumentCreationConfirmed(queryClient, document),
  );
  if (creationPending || isDocumentCreationConfirmed(queryClient, document)) {
    skipCreationDraftRecoveryRef.current = true;
  }
  const skipCreationDraftRecovery = skipCreationDraftRecoveryRef.current;
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
  const [busy, setBusy] = useState(false);
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
  const journalAttemptRef = useRef<string | null>(null);
  const pendingJournalRef = useRef<{
    entry: PageDraftJournalEntry;
    draft: PreviewDocumentDraftRecord;
  } | null>(null);
  const runningRecoveryRef = useRef<RecoveryAttempt | null>(null);
  const resolvedDraftsRef = useRef(new Set<string>());
  function acquireRecovery() {
    if (runningRecoveryRef.current?.isActive()) return null;
    const owner = beginAttempt();
    runningRecoveryRef.current = owner;
    return owner;
  }
  function releaseRecovery(owner: RecoveryAttempt) {
    if (runningRecoveryRef.current === owner) runningRecoveryRef.current = null;
  }
  const automaticRecoveryRef = useRef<string | null>(null);
  const automaticLegacyRecoveryRef = useRef<string | null>(null);
  const [liveEditorSessionId, setLiveEditorSessionId] = useState<string | null>(
    null,
  );
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
    attempt?: RecoveryAttempt,
  ) {
    attempt?.assertActive();
    setReview({ scopeKey, draft: source ?? null, failure, document: page });
  }

  function setFailure(
    failure: DraftRecoveryFailure | null,
    attempt?: RecoveryAttempt,
  ) {
    attempt?.assertActive();
    if (failure === null) setReview(null);
    else showRecoveryReview(failure, null, draft, attempt);
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
  // No scope until the session read returns; the session cache expires, so a
  // page opened later can mount before then. Unverified until it does.
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
    void ensurePreviewDocumentDraftRead(
      queryClient,
      document.id,
      document.createdAt,
    )
      .then(() => {
        if (!cancelled && owner.isActive()) setVerifiedScopeKey(scopeKey);
      })
      .catch(() => {
        if (!cancelled && owner.isActive()) setJournalState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [
    creationPending,
    document.id,
    skipDraftRecovery,
    skipCreationDraftRecovery,
    scopeKey,
    verificationRevision,
  ]);

  useEffect(() => {
    setBusy(false);
    setReview(null);
    resolvedDraftsRef.current.clear();
    automaticRecoveryRef.current = null;
    automaticLegacyRecoveryRef.current = null;
    setJournalState("checking");
    journalAttemptRef.current = null;
    pendingJournalRef.current = null;
  }, [document.id, session?.email, session?.orgId]);

  function completeJournalRecovery(
    settled: PreviewDocumentDraftRecord,
    owner: RecoveryAttempt,
  ) {
    owner.assertActive();
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
      void liveDraftWriterIds().then(
        (writerIds) => {
          // Without Web Locks no writer reads as live, so every entry
          // replays, as it did before writer locks.
          if (!cancelled && owner.isActive())
            setLiveWriters({
              scopeKey,
              entryKey,
              draftKey,
              writerIds: writerIds ?? new Set(),
            });
        },
        () => {
          if (!cancelled && owner.isActive()) setJournalState("failed");
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
      (sameAsSqlDraft &&
        draft?.baseDocumentUpdatedAt === document.updatedAt &&
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
    if (draft && !sameAsSqlDraft && !matchingSqlDraftHasLocalTitleConflict) {
      setJournalState("waiting_sql");
      return;
    }
    const attempt = `${accountId}:${scope.orgId ?? ""}:${document.id}:${entry.scope.writerId}:${entry.snapshot.editGeneration}:${entry.writtenAt}`;
    if (journalAttemptRef.current === attempt) return;
    const acquired = acquireRecovery();
    if (!acquired) return;
    owner = acquired;
    journalAttemptRef.current = attempt;
    setJournalState("promoting");
    const promote = async () => {
      owner.assertActive();
      const retainedDraft =
        sameAsSqlDraft &&
        draft &&
        draft.title === journalSnapshot.title &&
        draft.baseTitle === journalSnapshot.baseTitle &&
        draft.content === journalSnapshot.content
          ? draft
          : (
              await owner.step(() =>
                updateDraft.mutateAsync({
                  operation: "upsert",
                  documentId: document.id,
                  expectedVersion: draft?.version ?? null,
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
      if (
        retainedDraft?.title !== journalSnapshot.title ||
        retainedDraft.baseTitle !== journalSnapshot.baseTitle ||
        retainedDraft.content !== journalSnapshot.content
      ) {
        setJournalState("waiting_sql");
        showRecoveryReview(
          retainedDraft?.baseTitle == null ? "unknown" : "conflict",
          null,
          retainedDraft,
          owner,
        );
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
        const refreshed = await owner.step(() =>
          drafts.refetch({ throwOnError: true }),
        );
        if (!refreshed.data)
          throw new Error("The recovery draft could not be read.");
        setJournalState("waiting_sql");
        showRecoveryReview(
          "conflict",
          preserved.document ?? null,
          refreshed.data.draft,
          owner,
        );
        return;
      }
      resolvedDraftsRef.current.add(recoveryDraftKey(retainedDraft));
      completeJournalRecovery(retainedDraft, owner);
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
            owner.assertActive();
            winnerTitle = winner.title;
            return (
              !localChangedTitle ||
              winner.title === journalSnapshot.baseTitle ||
              winner.title === journalSnapshot.title
            );
          },
          confirmsWrite: (winner) => {
            owner.assertActive();
            return (
              winner.title ===
              (localChangedTitle ? journalSnapshot.title : winnerTitle)
            );
          },
          persist: (content, base) => {
            owner.assertActive();
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
              throw new Error("A newer local edit superseded journal replay.");
            journalStorageSnapshot = written.snapshot;
            journalSnapshot = nextSnapshot;
            return owner.step(() =>
              update.mutateAsync({
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
              }),
            );
          },
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
        if (!owner.isActive()) return;
        const failure = recoveryFailure(error);
        if (failure === "error") setJournalState("failed");
        else {
          showRecoveryReview(
            failure,
            null,
            pendingJournalRef.current?.draft ?? draft,
            owner,
          );
          setJournalState("waiting_sql");
        }
      })
      .finally(() => releaseRecovery(owner));
  }, [
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
  ) {
    if (!draft || busy) return;
    const owner = acquireRecovery();
    if (!owner) return;
    setBusy(true);
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
          expectedDocumentTitle: conflictDocument?.title ?? document.title,
          expectedDocumentUpdatedAt:
            conflictDocument?.updatedAt ?? document.updatedAt,
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
        showRecoveryReview("conflict", result.document ?? null, draft, owner);
        return;
      }
      resolvedDraftsRef.current.add(recoveryDraftKey(draft));
      completeJournalRecovery(draft, owner);
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
      setFailure(recoveryFailure(error), owner);
      try {
        await owner.step(() => drafts.refetch({ throwOnError: true }));
      } catch {
        if (owner.isActive()) setFailure("error", owner);
      }
    } finally {
      releaseRecovery(owner);
      if (owner.isActive()) setBusy(false);
    }
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
    automaticLegacyRecoveryRef.current = attempt;
    const intent = previewDraftTitleIntent(draft, document.title);
    if (intent.status === "unknown") {
      setFailure("unknown");
      return;
    }
    if (
      draftWrittenOnPage(draft, document) &&
      (!intent.changesTitle ||
        document.title === draft.baseTitle ||
        document.title === draft.title)
    ) {
      void resolveConflict("keep_mine", "automatic");
      return;
    }
    void resolveConflict("use_saved", "automatic");
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
      automaticRecoveryRef.current = attempt;
      void resolveConflict("keep_mine", "automatic");
      return;
    }
    if (
      draftWrittenOnPage(draft, document) &&
      (!intent.changesTitle ||
        document.title === draft.baseTitle ||
        document.title === draft.title)
    ) {
      automaticRecoveryRef.current = attempt;
      void resolveConflict("keep_mine", "automatic");
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
    automaticRecoveryRef.current = attempt;
    void resolveConflict("use_saved", "automatic");
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
    <LiveEditorSessionContext.Provider value={setLiveEditorSessionId}>
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
  const savedVersion = conflictDocument ?? document;
  return (
    <RecoveryComparison
      mine={{ title: draft.title, content: draft.content }}
      saved={{ title: savedVersion.title, content: savedVersion.content }}
      busy={busy}
      keepMineDisabled={
        documentBodyHydrationIsPending(document) ||
        draft.baseTitle == null ||
        failure === "unknown"
      }
      failure={
        failure === "unknown"
          ? t("editor.previewDraftTitleUnknown")
          : failure === "conflict"
            ? t("editor.previewDraftConflict")
            : t("empty.genericError")
      }
      onKeepMine={() => {
        if (
          documentBodyHydrationIsPending(document) ||
          draft.baseTitle == null ||
          failure === "unknown"
        )
          return;
        void resolveConflict("keep_mine");
      }}
      onUseSaved={() => void resolveConflict("use_saved")}
      onSaveSeparately={() => void resolveConflict("save_separately")}
      onCopy={() => {
        const owner = beginAttempt();
        void writeClipboardText(draft.content).then((copied) => {
          if (!owner.isActive()) return;
          if (copied) toast.success(t("editor.unsavedTextCopied"));
          else toast.error(t("editor.toolbar.clipboardAccessUnavailable"));
        });
      }}
    />
  );
}
