import { useT } from "@agent-native/core/client/i18n";
import type { Document } from "@shared/api";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { QueryErrorState } from "@/components/QueryErrorState";
import { Button } from "@/components/ui/button";
import {
  documentQueryFilter,
  isDocumentUpdateConflict,
  usePreviewDocumentDraft,
  useUpdateDocument,
  useUpdatePreviewDocumentDraft,
} from "@/hooks/use-documents";

import { documentBodyHydrationIsPending } from "./body-hydration";
import { DocumentEditorSkeleton } from "./DocumentEditorSkeleton";

export function PageDraftRecovery({
  document,
  children,
}: {
  document: Document;
  children: ReactNode;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const drafts = usePreviewDocumentDraft(document.id);
  const update = useUpdateDocument();
  const updateDraft = useUpdatePreviewDocumentDraft();
  const [releasedDocumentId, setReleasedDocumentId] = useState<string | null>(
    null,
  );
  useEffect(() => {
    if (drafts.data?.draft === null) setReleasedDocumentId(document.id);
  }, [document.id, drafts.data]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const draft = drafts.data?.draft;

  async function settleDraft(restore: boolean) {
    if (!draft || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      if (
        restore &&
        (draft.title !== document.title || draft.content !== document.content)
      ) {
        const saved = await update.mutateAsync({
          id: document.id,
          title: draft.title,
          content: draft.content,
          baseUpdatedAt: document.updatedAt,
          loadedUpdatedAt: document.updatedAt,
          loadedContentWasEmpty: false,
        });
        if (
          isDocumentUpdateConflict(saved) ||
          saved.content !== draft.content ||
          saved.title !== draft.title
        ) {
          throw new Error("Draft restoration was not confirmed.");
        }
      }
      const result = await updateDraft.mutateAsync({
        operation: "delete",
        documentId: document.id,
        expectedVersion: draft.version,
        expectedTitle: draft.title,
        expectedContent: draft.content,
      });
      if (result.status !== "deleted")
        throw new Error("The saved draft changed during recovery.");
      // Mount the live editor only after both the restore and the exact draft
      // deletion are acknowledged; a failed CAS must leave the draft available.
      await queryClient.refetchQueries(documentQueryFilter(document.id));
      await drafts.refetch();
    } catch {
      setFailed(true);
      await drafts.refetch();
    } finally {
      setBusy(false);
    }
  }

  if (releasedDocumentId === document.id) return children;
  if (drafts.isError)
    return (
      <QueryErrorState
        onRetry={() => void drafts.refetch()}
        retrying={drafts.isFetching}
      />
    );
  if (!drafts.data) return <DocumentEditorSkeleton />;
  if (!draft) return children;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6">
      <h2 className="text-sm font-semibold">
        {t("editor.previewDraftRecovery")}
      </h2>
      <div className="rounded-md border p-3">
        <p className="font-medium break-words">{draft.title}</p>
        <pre className="mt-2 whitespace-pre-wrap break-words text-sm">
          {draft.content}
        </pre>
      </div>
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          {t("empty.genericError")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy || documentBodyHydrationIsPending(document)}
          onClick={() => void settleDraft(true)}
        >
          {t("editor.restorePreviewDraft")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void settleDraft(false)}
        >
          {t("editor.discardPreviewDraft")}
        </Button>
      </div>
    </div>
  );
}
