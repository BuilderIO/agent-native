import { useActionQuery } from "@agent-native/core/client/hooks";
import { useState } from "react";

import type {
  DocumentHistoryPage,
  DocumentHistoryCheckpointPage,
  DocumentHistoryCheckpointDetail,
} from "../../../shared/document-history";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import {
  TrashStoredContent,
  type TrashPreviewLabels,
} from "./TrashDocumentPreview";

function PageControls({
  cursors,
  setCursors,
  next,
  labels,
}: {
  cursors: (string | undefined)[];
  setCursors: (value: (string | undefined)[]) => void;
  next: string | null;
  labels: TrashPreviewLabels;
}) {
  if (cursors.length === 1 && !next) return null;
  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={cursors.length === 1}
        onClick={() => setCursors(cursors.slice(0, -1))}
      >
        {labels.previous}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={!next}
        onClick={() => next && setCursors([...cursors, next])}
      >
        {labels.next}
      </Button>
    </div>
  );
}

function HistoryFailure({
  labels,
  retry,
}: {
  labels: TrashPreviewLabels;
  retry: () => void;
}) {
  return (
    <div role="status" className="flex items-center gap-2">
      <span>{labels.unavailable}</span>
      <Button variant="outline" size="sm" onClick={retry}>
        {labels.retry}
      </Button>
    </div>
  );
}

function Checkpoint({
  documentId,
  versionId,
  labels,
}: {
  documentId: string;
  versionId: string;
  labels: TrashPreviewLabels;
}) {
  const query = useActionQuery(
    "get-document-history-checkpoint",
    { documentId, versionId },
    { staleTime: 0, refetchOnMount: "always" },
  );
  const data = query.data as
    | { checkpoint: DocumentHistoryCheckpointDetail }
    | undefined;
  if (query.error)
    return (
      <HistoryFailure labels={labels} retry={() => void query.refetch()} />
    );
  if (query.isFetching || !data) return <Skeleton className="h-24 w-full" />;
  return (
    <TrashStoredContent
      content={data.checkpoint.content}
      sourceLabel={labels.unsupported}
    />
  );
}

function Checkpoints({
  documentId,
  groupId,
  labels,
}: {
  documentId: string;
  groupId: string;
  labels: TrashPreviewLabels;
}) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [selected, setSelected] = useState<string | null>(null);
  const query = useActionQuery(
    "list-document-history-checkpoints",
    { documentId, groupId, limit: 20, cursor: cursors[cursors.length - 1] },
    { staleTime: 0, refetchOnMount: "always" },
  );
  const data = query.data as DocumentHistoryCheckpointPage | undefined;
  if (query.error)
    return (
      <HistoryFailure labels={labels} retry={() => void query.refetch()} />
    );
  if (query.isFetching || !data) return <Skeleton className="h-12 w-full" />;
  return (
    <div className="flex flex-col gap-2 border-l pl-3">
      {data.checkpoints.map((checkpoint) => (
        <div key={checkpoint.id}>
          <Button
            variant="ghost"
            className="h-auto max-w-full whitespace-normal text-left"
            aria-expanded={selected === checkpoint.id}
            onClick={() =>
              setSelected(selected === checkpoint.id ? null : checkpoint.id)
            }
          >
            {checkpoint.title} ·{" "}
            <time dateTime={checkpoint.createdAt}>{checkpoint.createdAt}</time>
          </Button>
          {selected === checkpoint.id && (
            <Checkpoint
              documentId={documentId}
              versionId={checkpoint.id}
              labels={labels}
            />
          )}
        </div>
      ))}
      <PageControls
        cursors={cursors}
        setCursors={(value) => {
          setSelected(null);
          setCursors(value);
        }}
        next={data.nextCursor}
        labels={labels}
      />
    </div>
  );
}

export function TrashPreviewHistory({
  documentId,
  labels,
}: {
  documentId: string;
  labels: TrashPreviewLabels;
}) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [selected, setSelected] = useState<string | null>(null);
  const query = useActionQuery(
    "list-document-history",
    { documentId, limit: 20, cursor: cursors[cursors.length - 1] },
    { staleTime: 0, refetchOnMount: "always" },
  );
  const data = query.data as DocumentHistoryPage | undefined;
  if (query.error)
    return (
      <HistoryFailure labels={labels} retry={() => void query.refetch()} />
    );
  if (query.isFetching || !data) return <Skeleton className="h-12 w-full" />;
  if (data.groups.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">{labels.history}</h2>
      {data.groups.map((group) => (
        <div key={group.id} className="flex flex-col gap-2">
          <Button
            variant="ghost"
            className="h-auto max-w-full whitespace-normal text-left"
            aria-expanded={selected === group.id}
            onClick={() => setSelected(selected === group.id ? null : group.id)}
          >
            <time dateTime={group.startedAt}>{group.startedAt}</time>
            {group.actorEmail && <> · {group.actorEmail}</>}
          </Button>
          {selected === group.id && (
            <Checkpoints
              documentId={documentId}
              groupId={group.id}
              labels={labels}
            />
          )}
        </div>
      ))}
      <PageControls
        cursors={cursors}
        setCursors={(value) => {
          setSelected(null);
          setCursors(value);
        }}
        next={data.nextCursor}
        labels={labels}
      />
    </section>
  );
}
