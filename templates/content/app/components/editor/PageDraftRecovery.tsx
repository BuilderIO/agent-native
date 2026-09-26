import { writeClipboardText } from "@agent-native/core/client/clipboard";
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
  usePreviewDocumentDraft,
  useResolvePreviewDocumentDraft,
  useUpdateDocument,
  useUpdatePreviewDocumentDraft,
} from "@/hooks/use-documents";
import { isDocumentCreationPending } from "@/lib/optimistic-document";

import { documentBodyHydrationIsPending } from "./body-hydration";
import { DocumentEditorSkeleton } from "./DocumentEditorSkeleton";
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
  const queryClient = useQueryClient();
  const creationPending = isDocumentCreationPending(document);
  const drafts = usePreviewDocumentDraft(document.id, {
    enabled: !creationPending,
    createdAt: document.createdAt,
  });
  const update = useUpdateDocument();
  const updateDraft = useUpdatePreviewDocumentDraft();
  const resolveDraft = useResolvePreviewDocumentDraft();
  const [releasedDocumentId, setReleasedDocumentId] = useState<string | null>(
    null,
  );
  useEffect(() => {
    if (drafts.data?.draft === null) setReleasedDocumentId(document.id);
  }, [document.id, drafts.data]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<DraftRecoveryFailure | null>(null);
  const [conflictDocument, setConflictDocument] = useState<Document | null>(
    null,
  );
  const automaticRecoveryRef = useRef<string | null>(null);
  const draft = drafts.data?.draft;

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
        const saved = await update.mutateAsync({
          id: document.id,
          title: draft.title,
          content: draft.content,
          ...(draft.baseDocumentUpdatedAt
            ? {
                baseUpdatedAt: draft.baseDocumentUpdatedAt,
                loadedUpdatedAt: draft.baseDocumentUpdatedAt,
              }
            : {}),
          loadedContentWasEmpty: draft.loadedContentWasEmpty === 1,
          ...(identifiedDraft
            ? {
                editorSessionId: draft.editorSessionId!,
                editorEditGeneration: draft.editGeneration!,
                editorSnapshotTitle: draft.title,
                editorSnapshotContent: draft.content,
              }
            : {}),
        });
        if (isDocumentUpdateConflict(saved)) {
          setFailure("conflict");
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
      !hasEditIdentity ||
      busy ||
      failure ||
      documentBodyHydrationIsPending(document)
    )
      return;
    const attempt = `${draft.editorSessionId}:${draft.editGeneration}:${draft.version}:${document.updatedAt}`;
    if (automaticRecoveryRef.current === attempt) return;
    automaticRecoveryRef.current = attempt;
    if (draft.baseDocumentUpdatedAt === document.updatedAt) {
      void settleDraft(true);
      return;
    }
    void resolveConflict("use_saved");
  }, [busy, document, draft, failure, hasEditIdentity]);

  if (releasedDocumentId === document.id) return children;
  if (drafts.isError)
    return (
      <QueryErrorState
        onRetry={() => void drafts.refetch()}
        retrying={drafts.isFetching}
      />
    );
  if (!drafts.data) return <DocumentEditorSkeleton title={document.title} />;
  if (!draft) return children;
  if (hasEditIdentity && !failure)
    return <DocumentEditorSkeleton title={document.title} />;
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
          : failure === "error"
            ? t("empty.genericError")
            : null
      }
      onKeepMine={() => {
        if (documentBodyHydrationIsPending(document)) return;
        if (failure === "conflict" || draft.deferredReason === "conflict")
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
