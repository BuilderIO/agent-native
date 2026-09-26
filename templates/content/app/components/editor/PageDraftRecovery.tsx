import { writeClipboardText } from "@agent-native/core/client/clipboard";
import { callAction, useSession } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { Document } from "@shared/api";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { QueryErrorState } from "@/components/QueryErrorState";
import {
  documentQueryFilter,
  isDocumentUpdateConflict,
  isDocumentUpdatePreservationRequired,
  isDocumentUpdateSuperseded,
  usePreviewDocumentDraft,
  useResolvePreviewDocumentDraft,
  useUpdateDocument,
  useUpdatePreviewDocumentDraft,
} from "@/hooks/use-documents";
import { isDocumentCreationPending } from "@/lib/optimistic-document";

import { documentBodyHydrationIsPending } from "./body-hydration";
import { saveDocumentWithRebase } from "./document-save-rebase";
import { authoredCandidateMatchesContent } from "./document-save-retry";
import { DocumentEditorSkeleton } from "./DocumentEditorSkeleton";
import {
  clearPageDraftJournal,
  hasRetainedPageDraftNotice,
  markPageDraftJournalRetained,
  readPageDraftJournal,
  writePageDraftJournal,
} from "./page-draft-journal";
import { RecoveryComparison } from "./RecoveryComparison";

type DraftRecoveryFailure = "conflict" | "error";

export function PageDraftRecovery({
  document,
  children,
}: {
  document: Document;
  children: ReactNode;
}) {
  const t = useT();
  const navigate = useNavigate();
  const { session } = useSession();
  const scopeKey = session?.email
    ? JSON.stringify([
        session.email.trim().toLowerCase(),
        session.orgId ?? null,
        document.id,
      ])
    : null;
  const queryClient = useQueryClient();
  // Optimistic creation navigates to /page/<id> before create-document commits,
  // so while that mark is set the row does not exist yet. Querying then fails
  // with 403/404 and the error sticks — this query has retry: false and nothing
  // refetches it after create succeeds.
  const creationPending = isDocumentCreationPending(document);
  const drafts = usePreviewDocumentDraft(document.id, {
    enabled: !creationPending,
    // Lets the read ride out a row that is still settling after its own create
    // without also retrying a genuinely revoked share.
    createdAt: document.createdAt,
  });
  const update = useUpdateDocument();
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
    "checking" | "promoting" | "waiting_sql" | "ready" | "retained" | "failed"
  >("checking");
  const [journalRevision, setJournalRevision] = useState(0);
  const journalAttemptRef = useRef<string | null>(null);
  const automaticRecoveryRef = useRef<string | null>(null);
  const automaticLegacyRecoveryRef = useRef<string | null>(null);
  const draft = drafts.data?.draft;

  useEffect(() => {
    setVerifiedScopeKey(null);
    setReleasedScopeKey(null);
    if (!scopeKey || creationPending) return;
    let cancelled = false;
    void callAction(
      "get-preview-document-draft",
      { documentId: document.id },
      { method: "GET" },
    )
      .then(() => drafts.refetch())
      .then(() => {
        if (!cancelled) setVerifiedScopeKey(scopeKey);
      })
      .catch(() => {
        if (!cancelled) setJournalState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [creationPending, document.id, scopeKey, verificationRevision]);

  useEffect(() => {
    setJournalState("checking");
    journalAttemptRef.current = null;
  }, [document.id, session?.email, session?.orgId]);

  useEffect(() => {
    if (journalState === "promoting") return;
    if (
      !drafts.data ||
      verifiedScopeKey !== scopeKey ||
      creationPending ||
      documentBodyHydrationIsPending(document)
    )
      return;
    // The draft action has already checked this session's editor access.
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
      try {
        setJournalState(
          hasRetainedPageDraftNotice(scope) ? "retained" : "ready",
        );
      } catch {
        setJournalState("failed");
      }
      return;
    }
    const sameAsCanonical =
      entry.snapshot.title === document.title &&
      entry.snapshot.content === document.content;
    const sameAsSqlDraft =
      draft?.title === entry.snapshot.title &&
      draft.content === entry.snapshot.content;
    if (
      sameAsCanonical ||
      (sameAsSqlDraft && draft?.baseDocumentUpdatedAt === document.updatedAt)
    ) {
      try {
        clearPageDraftJournal(entry.scope, entry.snapshot);
        setJournalState("checking");
        setJournalRevision((revision) => revision + 1);
      } catch {
        setJournalState("failed");
      }
      return;
    }
    if (draft && !sameAsSqlDraft) {
      // Settle an existing SQL draft first; the local entry stays intact.
      setJournalState("waiting_sql");
      return;
    }
    const attempt = `${accountId}:${scope.orgId ?? ""}:${document.id}:${entry.scope.writerId}:${entry.snapshot.editGeneration}:${entry.writtenAt}`;
    if (journalAttemptRef.current === attempt) return;
    journalAttemptRef.current = attempt;
    setJournalState("promoting");
    let journalSnapshot = entry.snapshot;
    const promote = async () => {
      const retainedDraft =
        sameAsSqlDraft &&
        draft &&
        draft.title === journalSnapshot.title &&
        draft.content === journalSnapshot.content
          ? draft
          : (
              await updateDraft.mutateAsync({
                operation: "upsert",
                documentId: document.id,
                expectedVersion: draft?.version ?? null,
                draft: {
                  title: journalSnapshot.title,
                  content: journalSnapshot.content,
                  baseDocumentUpdatedAt:
                    journalSnapshot.baseUpdatedAt ??
                    (journalSnapshot.baseTitle === document.title &&
                    journalSnapshot.baseContent === document.content
                      ? document.updatedAt
                      : null),
                  loadedContentWasEmpty: journalSnapshot.baseContent === "",
                  deferredReason: "conflict",
                },
              })
            ).draft;
      if (
        retainedDraft?.title !== journalSnapshot.title ||
        retainedDraft.content !== journalSnapshot.content
      )
        throw new Error("The journal was not retained for recovery.");
      const preserved = await resolveDraft.mutateAsync({
        choice: "use_saved",
        documentId: document.id,
        expectedDraftVersion: retainedDraft.version,
        expectedDraftTitle: retainedDraft.title,
        expectedDraftContent: retainedDraft.content,
        expectedDocumentUpdatedAt: document.updatedAt,
      });
      if (preserved.status !== "resolved")
        throw new Error("The journal could not be preserved in history.");
      if (!markPageDraftJournalRetained(entry.scope, journalSnapshot))
        throw new Error("The journal changed during History preservation.");
      toast.success(t("editor.previewDraftSavedToHistory"));
      await queryClient.refetchQueries(documentQueryFilter(document.id));
      await drafts.refetch();
      setJournalState("checking");
    };
    void (async () => {
      if (journalSnapshot.saveAttemptId) {
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
            browserSaveAttemptId: journalSnapshot.saveAttemptId,
          },
          { method: "GET" },
        );
        if (receipt.found && receipt.preservationRequired) {
          if (!markPageDraftJournalRetained(entry.scope, journalSnapshot))
            throw new Error("The journal changed during History preservation.");
          setJournalState("checking");
          return;
        }
        if (receipt.found) {
          clearPageDraftJournal(entry.scope, journalSnapshot);
          await queryClient.refetchQueries(documentQueryFilter(document.id));
          setJournalState("checking");
          return;
        }
      }
      const baseUpdatedAt =
        entry.snapshot.baseUpdatedAt ??
        (entry.snapshot.baseTitle === document.title &&
        entry.snapshot.baseContent === document.content
          ? document.updatedAt
          : null);
      const localChangedTitle =
        entry.snapshot.title !== entry.snapshot.baseTitle;
      const titleConflict =
        localChangedTitle &&
        document.title !== entry.snapshot.baseTitle &&
        document.title !== entry.snapshot.title;
      if (!baseUpdatedAt || titleConflict) {
        await promote();
        return;
      }
      let winnerTitle = document.title;
      let attemptedContent = entry.snapshot.content;
      const outcome = await saveDocumentWithRebase({
        base: {
          content: entry.snapshot.baseContent,
          updatedAt: baseUpdatedAt,
          revision: entry.snapshot.baseRevision,
        },
        content: entry.snapshot.content,
        canRetry: (winner) => {
          winnerTitle = winner.title;
          return (
            !localChangedTitle ||
            winner.title === entry.snapshot.baseTitle ||
            winner.title === entry.snapshot.title
          );
        },
        confirmsWrite: (winner) =>
          winner.title ===
          (localChangedTitle ? entry.snapshot.title : winnerTitle),
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
          };
          const written = writePageDraftJournal({
            scope: entry.scope,
            snapshot: nextSnapshot,
          });
          if (written.snapshot.saveAttemptId !== saveAttemptId)
            throw new Error("A newer local edit superseded journal replay.");
          journalSnapshot = nextSnapshot;
          return update.mutateAsync({
            id: document.id,
            browserSaveAttemptId: saveAttemptId,
            ...(localChangedTitle ? { title: entry.snapshot.title } : {}),
            content,
            baseUpdatedAt: base.updatedAt ?? undefined,
            baseRevision: base.revision,
            ...(localChangedTitle
              ? { baseTitle: entry.snapshot.baseTitle }
              : {}),
            loadedUpdatedAt: base.updatedAt ?? undefined,
            loadedContentWasEmpty: base.content === "",
            editorSessionId: entry.scope.writerId,
            editorEditGeneration: entry.snapshot.editGeneration,
            editorSnapshotTitle: localChangedTitle
              ? entry.snapshot.title
              : winnerTitle,
            editorSnapshotContent: content,
            ...(entry.snapshot.authoredBaseRevision &&
            entry.snapshot.authoredBaseContent !== undefined &&
            authoredCandidateMatchesContent(
              content,
              entry.snapshot.authoredCandidateContent,
            )
              ? {
                  authoredBaseRevision: entry.snapshot.authoredBaseRevision,
                  authoredBaseContent: entry.snapshot.authoredBaseContent,
                  authoredCandidateContent:
                    entry.snapshot.authoredCandidateContent,
                }
              : {}),
          });
        },
      });
      if (outcome.status === "superseded") {
        clearPageDraftJournal(entry.scope, journalSnapshot);
        await queryClient.refetchQueries(documentQueryFilter(document.id));
        await drafts.refetch();
        setJournalState("checking");
        return;
      }
      if (outcome.status === "preservation") {
        if (!markPageDraftJournalRetained(entry.scope, journalSnapshot))
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
      clearPageDraftJournal(entry.scope, journalSnapshot);
      await queryClient.refetchQueries(documentQueryFilter(document.id));
      await drafts.refetch();
      setJournalState("checking");
    })().catch(() => setJournalState("failed"));
  }, [
    creationPending,
    document,
    draft,
    drafts.data,
    journalRevision,
    journalState,
    scopeKey,
    session?.email,
    session?.orgId,
    verifiedScopeKey,
  ]);

  useEffect(() => {
    if (
      drafts.data?.draft === null &&
      verifiedScopeKey === scopeKey &&
      (journalState === "ready" || journalState === "retained")
    )
      setReleasedScopeKey(scopeKey);
  }, [drafts.data, journalState, scopeKey, verifiedScopeKey]);

  async function settleDraft(restore: boolean) {
    if (!draft || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const identifiedDraft = Boolean(
        draft.editorSessionId && typeof draft.editGeneration === "number",
      );
      const draftDiffers =
        draft.title !== document.title || draft.content !== document.content;
      if (restore && (identifiedDraft || draftDiffers)) {
        if (draftDiffers && !draft.baseDocumentUpdatedAt) {
          throw new Error("The draft has no original document version.");
        }
        if (draft.content !== document.content && !document.revision) {
          throw new Error("The current body revision is unavailable.");
        }
        const saved = await update.mutateAsync({
          id: document.id,
          title: draft.title,
          content: draft.content,
          ...(draft.content !== document.content
            ? {
                baseRevision: document.revision,
                baseTitle: document.title,
                authoredBaseRevision: document.revision,
                authoredBaseContent: document.content,
                authoredCandidateContent: draft.content,
                browserSaveAttemptId: crypto.randomUUID(),
              }
            : {}),
          ...(draft.baseDocumentUpdatedAt
            ? {
                baseUpdatedAt: draft.baseDocumentUpdatedAt,
                loadedUpdatedAt: draft.baseDocumentUpdatedAt,
              }
            : {}),
          loadedContentWasEmpty: draft.loadedContentWasEmpty === 1,
          ...(identifiedDraft || draft.content !== document.content
            ? {
                editorSessionId: identifiedDraft
                  ? draft.editorSessionId!
                  : `preview-recovery:${document.id}:${draft.version}`,
                editorEditGeneration: identifiedDraft
                  ? draft.editGeneration! + 1
                  : 0,
                editorSnapshotTitle: draft.title,
                editorSnapshotContent: draft.content,
              }
            : {}),
        });
        if (isDocumentUpdateSuperseded(saved)) {
          await queryClient.refetchQueries(documentQueryFilter(document.id));
          await drafts.refetch();
          return;
        }
        if (isDocumentUpdateConflict(saved)) {
          setFailure("conflict");
          setConflictDocument(saved.document);
          return;
        }
        if (isDocumentUpdatePreservationRequired(saved)) {
          setFailure("error");
          setConflictDocument(saved.document);
          return;
        }
        if (saved.content !== draft.content || saved.title !== draft.title) {
          throw new Error("Draft restoration was not confirmed.");
        }
        if (identifiedDraft) {
          await queryClient.refetchQueries(documentQueryFilter(document.id));
          await drafts.refetch();
          return;
        }
      }
      const result = await updateDraft.mutateAsync({
        operation: "delete",
        documentId: document.id,
        expectedVersion: draft.version,
        expectedTitle: draft.title,
        expectedContent: draft.content,
        ...(draft.editorSessionId
          ? { expectedEditorSessionId: draft.editorSessionId }
          : {}),
        ...(typeof draft.editGeneration === "number"
          ? { expectedEditGeneration: draft.editGeneration }
          : {}),
      });
      if (result.status !== "deleted")
        throw new Error("The saved draft changed during recovery.");
      // Mount the live editor only after both the restore and the exact draft
      // deletion are acknowledged; a failed CAS must leave the draft available.
      await queryClient.refetchQueries(documentQueryFilter(document.id));
      await drafts.refetch();
    } catch {
      setFailure("error");
      await drafts.refetch();
    } finally {
      setBusy(false);
    }
  }

  async function resolveConflict(
    choice: "keep_mine" | "use_saved" | "save_separately",
  ) {
    if (!draft || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const result = await resolveDraft.mutateAsync({
        choice,
        documentId: document.id,
        expectedDraftVersion: draft.version,
        expectedDraftTitle: draft.title,
        expectedDraftContent: draft.content,
        expectedDocumentUpdatedAt:
          conflictDocument?.updatedAt ?? document.updatedAt,
      });
      if (result.status === "document_conflict") {
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
    } catch {
      setFailure("error");
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
      verifiedScopeKey !== scopeKey
    )
      return;
    const attempt = `${draft.version}:${document.updatedAt}`;
    if (automaticLegacyRecoveryRef.current === attempt) return;
    automaticLegacyRecoveryRef.current = attempt;
    void resolveConflict("use_saved");
  }, [
    busy,
    document.updatedAt,
    draft,
    failure,
    hasEditIdentity,
    journalState,
    scopeKey,
    verifiedScopeKey,
  ]);
  useEffect(() => {
    if (
      !draft ||
      !hasEditIdentity ||
      busy ||
      failure ||
      journalState === "checking" ||
      journalState === "promoting" ||
      verifiedScopeKey !== scopeKey ||
      documentBodyHydrationIsPending(document)
    )
      return;
    const attempt = `${draft.editorSessionId}:${draft.editGeneration}:${draft.version}:${document.updatedAt}`;
    if (automaticRecoveryRef.current === attempt) return;
    if (draft.baseDocumentUpdatedAt === document.updatedAt) {
      automaticRecoveryRef.current = attempt;
      void settleDraft(true);
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
    void resolveConflict("use_saved");
  }, [
    busy,
    document,
    draft,
    failure,
    hasEditIdentity,
    journalState,
    scopeKey,
    session?.email,
    session?.orgId,
    verifiedScopeKey,
  ]);

  if (releasedScopeKey === scopeKey && verifiedScopeKey === scopeKey && !draft)
    return journalState === "retained" ? (
      <>
        <div role="status">{t("editor.previewDraftSavedToHistory")}</div>
        {children}
      </>
    ) : (
      children
    );
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
    verifiedScopeKey !== scopeKey ||
    journalState === "checking" ||
    journalState === "promoting"
  )
    return <DocumentEditorSkeleton title={document.title} />;
  if (!draft) return children;
  if (!hasEditIdentity && !failure)
    return (
      <>
        <div role="status">
          {failure === "error"
            ? t("empty.genericError")
            : t("editor.previewDraftSavedToHistory")}
        </div>
        {children}
      </>
    );
  if (!failure) return <DocumentEditorSkeleton title={document.title} />;
  const savedVersion = conflictDocument ?? document;
  return (
    <RecoveryComparison
      mine={{ title: draft.title, content: draft.content }}
      saved={{ title: savedVersion.title, content: savedVersion.content }}
      busy={busy}
      keepMineDisabled={documentBodyHydrationIsPending(document)}
      failure={
        failure === "conflict"
          ? t("editor.previewDraftConflict")
          : t("empty.genericError")
      }
      onKeepMine={() => {
        if (documentBodyHydrationIsPending(document)) return;
        if (
          failure === "conflict" ||
          draft.baseDocumentUpdatedAt !== document.updatedAt
        )
          void resolveConflict("keep_mine");
        else void settleDraft(true);
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
