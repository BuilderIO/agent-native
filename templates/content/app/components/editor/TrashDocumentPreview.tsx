import { useActionQuery } from "@agent-native/core/client/hooks";
import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";

import type { TrashedDocumentPreview } from "../../../actions/get-trashed-document";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { prepareTrashPreviewContent } from "./trash-preview-content";
import { TrashPreviewHistory } from "./TrashPreviewHistory";

const ReadonlyEditor = lazy(async () => ({
  default: (await import("./VisualEditor")).VisualEditor,
}));
const ignoreChange = () => {};

export function TrashStoredContent({
  content,
  sourceLabel,
}: {
  content: string;
  sourceLabel: string;
}) {
  const prepared = useMemo(
    () => prepareTrashPreviewContent(content),
    [content],
  );
  return (
    <div className="min-w-0">
      {prepared.hasSourceBlocks && (
        <span className="text-xs text-muted-foreground">{sourceLabel}</span>
      )}
      <Suspense fallback={<Skeleton className="h-24 w-full" />}>
        <ReadonlyEditor
          key={prepared.content}
          content={prepared.content}
          onChange={ignoreChange}
          editable={false}
          showCommentIndicators={false}
        />
      </Suspense>
    </div>
  );
}
export type TrashPreviewLabels = {
  readOnly: string;
  unavailable: string;
  properties: string;
  comments: string;
  history: string;
  moreComments: string;
  moreHistory: string;
  computedUnavailable: string;
  previous: string;
  next: string;
  unsupported: string;
  retry: string;
};

function TrashDocumentPreviewBody({
  documentId,
  databaseId,
  databaseDocumentId,
  labels,
  actions,
}: {
  documentId: string;
  databaseId?: string;
  databaseDocumentId?: string;
  labels: TrashPreviewLabels;
  actions?: ReactNode | ((document: TrashedDocumentPreview) => ReactNode);
}) {
  const [commentCursors, setCommentCursors] = useState<(string | undefined)[]>([
    undefined,
  ]);
  const query = useActionQuery(
    "get-trashed-document",
    {
      documentId,
      databaseId,
      databaseDocumentId,
      commentsCursor: commentCursors[commentCursors.length - 1],
    },
    {
      staleTime: 0,
      refetchOnMount: "always",
    },
  );
  const document = query.data as TrashedDocumentPreview | undefined;
  if (query.error)
    return (
      <div role="status" className="p-6 text-muted-foreground">
        {labels.unavailable}
        <Button
          variant="outline"
          size="sm"
          onClick={() => void query.refetch()}
        >
          {labels.retry}
        </Button>
      </div>
    );
  if (query.isFetching || !document || document.id !== documentId)
    return (
      <div className="flex flex-col gap-4 p-6" aria-busy="true">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-5/6" />
      </div>
    );
  return (
    <article className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-6 p-4 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">{labels.readOnly}</span>
        {typeof actions === "function" ? actions(document) : actions}
      </div>
      <h1 className="break-words text-3xl font-semibold">{document.title}</h1>
      {document.description && (
        <p className="whitespace-pre-wrap">{document.description}</p>
      )}
      <TrashStoredContent
        content={document.content}
        sourceLabel={labels.unsupported}
      />
      {document.properties.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">{labels.properties}</h2>
          <dl className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            {document.properties.map((property) => (
              <div key={property.id} className="contents">
                <dt className="break-words text-muted-foreground">
                  {property.name}
                </dt>
                <dd className="whitespace-pre-wrap break-words">
                  {!property.available
                    ? labels.computedUnavailable
                    : typeof property.value === "string"
                      ? property.value
                      : JSON.stringify(property.value)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {(document.comments.length > 0 || commentCursors.length > 1) && (
        <section className="flex flex-col gap-4">
          <h2 className="font-medium">{labels.comments}</h2>
          {document.comments.map((comment) => (
            <div key={comment.id} className="flex flex-col gap-1 border-l pl-3">
              <span className="text-sm text-muted-foreground">
                {comment.authorName || comment.authorEmail}
              </span>
              {comment.quotedText && (
                <blockquote className="whitespace-pre-wrap text-muted-foreground">
                  {comment.quotedText}
                </blockquote>
              )}
              <TrashStoredContent
                content={comment.content}
                sourceLabel={labels.unsupported}
              />
            </div>
          ))}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={commentCursors.length === 1}
              onClick={() =>
                setCommentCursors((cursors) => cursors.slice(0, -1))
              }
            >
              {labels.previous}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!document.nextCommentsCursor}
              onClick={() =>
                setCommentCursors((cursors) => [
                  ...cursors,
                  document.nextCommentsCursor ?? undefined,
                ])
              }
            >
              {labels.next}
            </Button>
          </div>{" "}
        </section>
      )}
      <TrashPreviewHistory
        key={documentId}
        documentId={documentId}
        labels={labels}
      />
    </article>
  );
}

export function TrashDocumentPreview(
  props: Parameters<typeof TrashDocumentPreviewBody>[0],
) {
  return (
    <TrashDocumentPreviewBody
      key={JSON.stringify([
        props.documentId,
        props.databaseId,
        props.databaseDocumentId,
      ])}
      {...props}
    />
  );
}
