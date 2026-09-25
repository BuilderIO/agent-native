import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { Document } from "@shared/api";
import { IconArrowLeft, IconExternalLink, IconX } from "@tabler/icons-react";
import { Link } from "react-router";

import { ContentIcon } from "@/components/icons/ContentIcon";
import { QueryErrorState } from "@/components/QueryErrorState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { documentFetchView } from "@/lib/document-fetch-state";

import { TrashPreviewContent } from "./trash-preview-content";

export function TrashDocumentPreview({
  documentId,
  fullPage = false,
  onClose,
}: {
  documentId: string;
  fullPage?: boolean;
  onClose?: () => void;
}) {
  const t = useT();
  const query = useActionQuery<Document>(
    "get-trashed-document",
    { id: documentId },
    { retry: false },
  );
  const errorStatus =
    query.error && typeof query.error === "object"
      ? (query.error as { status?: number }).status
      : undefined;
  const view = documentFetchView({
    hasData: Boolean(query.data),
    isFetching: query.isFetching,
    isError: query.isError,
    status: errorStatus,
  });

  return (
    <section
      className="flex min-h-0 flex-1 flex-col bg-background"
      aria-label={t("trash.preview")}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        {fullPage ? (
          <Button asChild variant="ghost" size="sm">
            <Link to="/trash">
              <IconArrowLeft size={16} />
              {t("trash.backToTrash")}
            </Link>
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label={t("trash.closePreview")}
          >
            <IconX size={16} />
          </Button>
        )}
        <div className="flex-1" />
        {!fullPage ? (
          <Button asChild variant="ghost" size="sm">
            <Link
              to={`/trash?preview=${encodeURIComponent(documentId)}&full=1`}
            >
              <IconExternalLink size={15} />
              {t("trash.openFullPage")}
            </Link>
          </Button>
        ) : null}
      </div>
      {view === "loading" ? (
        <div className="mx-auto grid w-full max-w-3xl gap-4 px-6 py-12">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      ) : view === "ready" && query.data ? (
        <article className="mx-auto w-full max-w-3xl overflow-y-auto px-6 py-10 sm:px-10">
          {query.data.icon ? (
            <div className="mb-8">
              <ContentIcon value={query.data.icon} size={40} />
            </div>
          ) : null}
          <h1 className="mb-8 text-3xl font-bold tracking-tight">
            {query.data.title || t("sidebar.untitled")}
          </h1>
          <TrashPreviewContent
            content={query.data.content}
            unsupportedEmbedLabel={t("trash.unsupportedEmbed")}
          />
        </article>
      ) : (
        <div className="flex flex-1 items-center justify-center px-6">
          <QueryErrorState
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        </div>
      )}
    </section>
  );
}
