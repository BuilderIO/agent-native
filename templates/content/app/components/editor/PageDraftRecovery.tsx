import { isOpenAiMcpAppHost } from "@agent-native/core/client/agent-chat";
import { callAction, useSession } from "@agent-native/core/client/hooks";
import { isEmbedMcpChatBridgeActive } from "@agent-native/core/client/host";
import { useT } from "@agent-native/core/client/i18n";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import type { Document } from "@shared/api";
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
  readPageDraftJournal,
  sweepLegacyRetainedPageDraftMarkers,
  writePageDraftJournal,
} from "./page-draft-journal";
import { RecoveryComparison } from "./RecoveryComparison";

type DraftRecoveryFailure = "conflict" | "error" | "unknown";

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
  const [failure, setFailure] = useState<DraftRecoveryFailure | null>(null);
  const [conflictDocument, setConflictDocument] = useState<Document | null>(
    null,
  );
  const [journalState, setJournalState] = useState<
    "checking" | "promoting" | "waiting_sql" | "ready" | "failed"
  >("checking");
  const [journalRevision, setJournalRevision] = useState(0);
  const journalAttemptRef = useRef<string | null>(null);
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
  // No scope until the session read returns; the session cache expires, so a
  // page opened later can mount before then. Unverified until it does.
  const scopeVerified = scopeKey !== null && verifiedScopeKey === scopeKey;
  const editorReleased =
    scopeVerified && releasedScopeKey === scopeKey && !draft;

  useEffect(() => {
    setFailure(null);
    setConflictDocument(null);
  }, [
    scopeKey,
    draft?.version,
    draft?.title,
    draft?.content,
    draft?.baseTitle,
    draft?.editorSessionId,
    draft?.editGeneration,
  ]);

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
    let cancelled = false;
    void ensurePreviewDocumentDraftRead(
      queryClient,
      document.id,
      document.createdAt,
    )
      .then(() => {
        if (!cancelled) setVerifiedScopeKey(scopeKey);
      })
      .catch(() => {
        if (!cancelled) setJournalState("failed");
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
    setJournalState("checking");
    journalAttemptRef.current = null;
  }, [document.id, session?.email, session?.orgId]);

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
    const accountId = session?.email?.trim().toLowerCase();
    if (!accountId) return;
    const scope = {
      accountId,
      orgId: session?.orgId ?? null,
      documentId: document.id,
    };
    let entry;
    try {
      entry = readPageDraftJournal(scope);
    } catch {
      setJournalState("failed");
      return;
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
    journalAttemptRef.current = attempt;
    setJournalState("promoting");
    const promote = async () => {
      const retainedDraft =
        sameAsSqlDraft &&
        draft &&
        draft.title === journalSnapshot.title &&
        draft.baseTitle === journalSnapshot.baseTitle &&
        draft.content === journalSnapshot.content
          ? draft
          : (
              await updateDraft.mutateAsync({
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
              })
            ).draft;
      if (
        retainedDraft?.title !== journalSnapshot.title ||
        retainedDraft.baseTitle !== journalSnapshot.baseTitle ||
        retainedDraft.content !== journalSnapshot.content
      ) {
        setJournalState("waiting_sql");
        setFailure(retainedDraft?.baseTitle == null ? "unknown" : "conflict");
        return;
      }
      const preserved = await resolveDraft.mutateAsync({
        choice: "use_saved",
        trigger: "automatic",
        documentId: document.id,
        expectedDraftVersion: retainedDraft.version,
        expectedDraftTitle: retainedDraft.title,
        expectedDraftContent: retainedDraft.content,
        expectedDraftBaseTitle: retainedDraft.baseTitle,
        expectedDocumentTitle: document.title,
        expectedDocumentUpdatedAt: document.updatedAt,
      });
      if (preserved.status === "recovery_required") {
        setJournalState("waiting_sql");
        setFailure("conflict");
        return;
      }
      if (preserved.status !== "resolved")
        throw new Error("The journal could not be preserved in history.");
      if (!clearPageDraftJournal(entry.scope, journalStorageSnapshot))
        throw new Error("The journal changed during History preservation.");
      toast.success(t("editor.previewDraftSavedToHistory"));
      await queryClient.refetchQueries(documentQueryFilter(document.id));
      await drafts.refetch();
      setJournalState("checking");
    };
    void (async () => {
      const attemptIds = [
        journalSnapshot.saveAttemptId,
        ...(journalSnapshot.equivalentSaveAttemptIds ?? []),
      ].filter((attemptId): attemptId is string => !!attemptId);
      for (const attemptId of attemptIds) {
        const receipt = await callAction<{
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
          await queryClient.refetchQueries(documentQueryFilter(document.id));
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
      const outcome = await saveDocumentWithRebase({
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
        persist: (content, base) => {
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
                  authoredBaseRevision: journalSnapshot.authoredBaseRevision,
                  authoredBaseContent: journalSnapshot.authoredBaseContent,
                  authoredCandidateContent:
                    journalSnapshot.authoredCandidateContent,
                }
              : {}),
          });
        },
      });
      if (outcome.status === "superseded") {
        clearPageDraftJournal(entry.scope, journalStorageSnapshot);
        await queryClient.refetchQueries(documentQueryFilter(document.id));
        await drafts.refetch();
        setJournalState("checking");
        return;
      }
      if (outcome.status === "preservation") {
        if (!clearPageDraftJournal(entry.scope, journalStorageSnapshot))
          throw new Error("The journal changed during History preservation.");
        toast.success(t("editor.previewDraftSavedToHistory"));
        await queryClient.refetchQueries(documentQueryFilter(document.id));
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
      await queryClient.refetchQueries(documentQueryFilter(document.id));
      await drafts.refetch();
      setJournalState("checking");
    })().catch(() => setJournalState("failed"));
  }, [
    creationPending,
    document,
    draft,
    drafts.data,
    editorReleased,
    journalRevision,
    journalState,
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
  ) {
    const result = await updateDraft.mutateAsync({
      operation: "delete",
      documentId: document.id,
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
    });
    // A page that moved on since this tab read it is recovered against
    // its newer version once both are read again.
    if (result.status !== "deleted" && !ifPageHoldsDraft)
      throw new Error("The saved draft changed during recovery.");
    await queryClient.refetchQueries(documentQueryFilter(document.id));
    await drafts.refetch();
  }

  async function resolveConflict(
    choice: "keep_mine" | "use_saved" | "save_separately",
    trigger: "automatic" | "reviewed" = "reviewed",
  ) {
    if (!draft || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const result = await resolveDraft.mutateAsync({
        choice,
        trigger,
        documentId: document.id,
        expectedDraftVersion: draft.version,
        expectedDraftTitle: draft.title,
        expectedDraftContent: draft.content,
        expectedDraftBaseTitle: draft.baseTitle ?? null,
        expectedDocumentTitle: conflictDocument?.title ?? document.title,
        expectedDocumentUpdatedAt:
          conflictDocument?.updatedAt ?? document.updatedAt,
      });
      if (result.status === "recovery_required") {
        setFailure("conflict");
        setConflictDocument(result.document ?? null);
        return;
      }
      if (result.status === "document_conflict") {
        if (
          trigger === "reviewed" &&
          result.document &&
          pageHoldsDraft(draft, result.document)
        ) {
          await discardDraft(draft, true);
          return;
        }
        setFailure("conflict");
        setConflictDocument(result.document ?? null);
        return;
      }
      if (result.status !== "resolved")
        throw new Error("The draft could not be resolved.");
      if (choice === "use_saved")
        toast.success(t("editor.previewDraftSavedToHistory"));
      if (choice === "save_separately")
        toast.success(t("editor.previewDraftSavedSeparately"), {
          action: result.urlPath
            ? {
                label: t("editor.previewDraftOpenSavedPage"),
                onClick: () => void navigate(result.urlPath!),
              }
            : undefined,
        });
      await queryClient.refetchQueries(documentQueryFilter(document.id));
      await drafts.refetch();
    } catch (error) {
      const errorCode = (error as { errorCode?: unknown } | null)?.errorCode;
      setFailure(
        errorCode === "PREVIEW_DRAFT_TITLE_INTENT_UNKNOWN"
          ? "unknown"
          : errorCode === "PREVIEW_DRAFT_AUTOMATIC_RECOVERY_REFUSED" ||
              errorCode === "PREVIEW_DRAFT_RECOVERY_CONFLICT"
            ? "conflict"
            : "error",
      );
      await drafts.refetch();
    } finally {
      setBusy(false);
    }
  }

  const hasEditIdentity = Boolean(
    draft?.editorSessionId && draft.editGeneration !== null,
  );
  useEffect(() => {
    if (
      !draft ||
      hasEditIdentity ||
      busy ||
      failure ||
      journalState === "checking" ||
      journalState === "promoting" ||
      !scopeVerified
    )
      return;
    const attempt = `${draft.version}:${document.updatedAt}`;
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
      !hasEditIdentity ||
      busy ||
      failure ||
      journalState === "checking" ||
      journalState === "promoting" ||
      !scopeVerified ||
      documentBodyHydrationIsPending(document)
    )
      return;
    const attempt = `${draft.editorSessionId}:${draft.editGeneration}:${draft.version}:${document.updatedAt}`;
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
        const journal = readPageDraftJournal({
          accountId: session.email.trim().toLowerCase(),
          orgId: session.orgId ?? null,
          documentId: document.id,
        });
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
    failure,
    hasEditIdentity,
    journalState,
    scopeVerified,
    session?.email,
    session?.orgId,
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
  if (!draft) return withNotice(null);
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
        void writeClipboardText(draft.content).then((copied) => {
          if (copied) toast.success(t("editor.unsavedTextCopied"));
          else toast.error(t("editor.toolbar.clipboardAccessUnavailable"));
        });
      }}
    />
  );
}
