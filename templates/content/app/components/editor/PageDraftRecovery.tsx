import { writeClipboardText } from "@agent-native/core/client/clipboard";
import { useT } from "@agent-native/core/client/i18n";
import type { Document } from "@shared/api";
import { useQueryClient } from "@tanstack/react-query";
import DiffMatchPatch, { DIFF_DELETE, DIFF_INSERT } from "diff-match-patch";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { QueryErrorState } from "@/components/QueryErrorState";
import { Button } from "@/components/ui/button";
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

type DraftRecoveryFailure = "conflict" | "error";

function DiffValue({ value, other }: { value: string; other: string }) {
  const segments = useMemo(() => {
    const differ = new DiffMatchPatch();
    const result = differ.diff_main(value, other);
    differ.diff_cleanupSemantic(result);
    return result;
  }, [other, value]);
  return (
    <>
      {segments.map(([operation, text], index) =>
        operation === DIFF_INSERT ? null : operation === DIFF_DELETE ? (
          <mark
            key={`${index}:${text}`}
            className="rounded-sm bg-accent text-accent-foreground"
          >
            {text}
          </mark>
        ) : (
          <span key={`${index}:${text}`}>{text}</span>
        ),
      )}
    </>
  );
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
  const draft = drafts.data?.draft;

  async function settleDraft(restore: boolean) {
    if (!draft || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      if (
        restore &&
        (draft.title !== document.title || draft.content !== document.content)
      ) {
        if (!draft.baseDocumentUpdatedAt) {
          throw new Error("The draft has no original document version.");
        }
        const saved = await update.mutateAsync({
          id: document.id,
          title: draft.title,
          content: draft.content,
          baseUpdatedAt: draft.baseDocumentUpdatedAt,
          loadedUpdatedAt: draft.baseDocumentUpdatedAt,
          loadedContentWasEmpty: draft.loadedContentWasEmpty === 1,
        });
        if (isDocumentUpdateConflict(saved)) {
          setFailure("conflict");
          setConflictDocument(saved.document);
          return;
        }
        if (saved.content !== draft.content || saved.title !== draft.title) {
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
        ...(choice === "keep_mine"
          ? {
              expectedDocumentUpdatedAt:
                conflictDocument?.updatedAt ?? document.updatedAt,
            }
          : {}),
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
  const comparing =
    failure === "conflict" || draft.deferredReason === "conflict";
  const savedVersion = conflictDocument ?? document;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6">
      <h2 className="text-sm font-semibold">
        {comparing
          ? t("editor.previewDraftCompare")
          : t("editor.previewDraftRecovery")}
      </h2>
      <div className={comparing ? "grid gap-3 md:grid-cols-2" : "grid gap-3"}>
        <section className="min-w-0 rounded-md border p-3">
          {comparing ? (
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              {t("editor.previewDraftYourEdits")}
            </p>
          ) : null}
          <p className="font-medium break-words">
            {comparing ? (
              <DiffValue value={draft.title} other={savedVersion.title} />
            ) : (
              draft.title
            )}
          </p>
          <pre className="mt-2 whitespace-pre-wrap break-words text-sm">
            {comparing ? (
              <DiffValue value={draft.content} other={savedVersion.content} />
            ) : (
              draft.content
            )}
          </pre>
        </section>
        {comparing ? (
          <section className="min-w-0 rounded-md border p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              {t("editor.previewDraftSavedVersion")}
            </p>
            <p className="font-medium break-words">
              <DiffValue value={savedVersion.title} other={draft.title} />
            </p>
            <pre className="mt-2 whitespace-pre-wrap break-words text-sm">
              <DiffValue value={savedVersion.content} other={draft.content} />
            </pre>
          </section>
        ) : null}
      </div>
      {failure ? (
        <p role="alert" className="text-sm text-destructive">
          {failure === "conflict"
            ? t("editor.previewDraftConflict")
            : t("empty.genericError")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {comparing ? (
          <>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => void resolveConflict("keep_mine")}
            >
              {t("editor.previewDraftKeepMine")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void resolveConflict("use_saved")}
            >
              {t("editor.previewDraftUseSaved")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void resolveConflict("save_separately")}
            >
              {t("editor.previewDraftSaveSeparately")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                void writeClipboardText(draft.content).then((copied) => {
                  if (copied) toast.success(t("editor.unsavedTextCopied"));
                  else
                    toast.error(t("editor.toolbar.clipboardAccessUnavailable"));
                });
              }}
            >
              {t("editor.copyUnsavedText")}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={busy || documentBodyHydrationIsPending(document)}
            onClick={() => void settleDraft(true)}
          >
            {t("editor.restorePreviewDraft")}
          </Button>
        )}
        {!comparing ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void resolveConflict("use_saved")}
          >
            {t("editor.previewDraftUseSaved")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
