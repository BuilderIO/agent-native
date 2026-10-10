import { captureClientException } from "@agent-native/core/client/analytics";
import { appBasePath } from "@agent-native/core/client/api-path";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useLabState } from "@agent-native/core/client/labs";
import { CLIPS_LOOKBACK_CONTEXT } from "@shared/labs";
import { IconArrowsMaximize } from "@tabler/icons-react";
import { type ReactNode, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

import {
  contextWindowSeconds,
  formatClock,
  hasUnfinishedContextItems,
  isContextItemUnfinished,
  type ListRecordingContextResult,
  type RecordingContextItem,
} from "./recording-context-model";

const CONTEXT_POLL_MS = 3000;

// Same route the editor and the Rewind extension use for a recording's own video.
export function contextVideoSrc(mediaRecordingId: string): string {
  return `${appBasePath()}/api/video/${encodeURIComponent(mediaRecordingId)}`;
}

export function useRecordingContextItems(
  recordingId: string | undefined,
  enabled: boolean,
) {
  return useActionQuery<ListRecordingContextResult>(
    "list-recording-context",
    { recordingId: recordingId ?? "" },
    {
      enabled: enabled && Boolean(recordingId),
      refetchInterval: (query) =>
        hasUnfinishedContextItems(query.state.data?.items ?? [])
          ? CONTEXT_POLL_MS
          : false,
    },
  );
}

// The Transcript tab's entry point. Renders nothing unless the lab is on and the
// clip has context items, so clips without earlier screen time look unchanged.
// Pass the definition to useLabState, not its bare key: a key reads as on until
// the server answers.
export function RecordingContextSection({
  recordingId,
}: {
  recordingId: string | undefined;
}) {
  const lab = useLabState(CLIPS_LOOKBACK_CONTEXT);
  const itemsQuery = useRecordingContextItems(recordingId, lab.enabled);
  const { isError, error } = itemsQuery;
  useEffect(() => {
    if (isError) captureClientException(error);
  }, [error, isError]);

  if (!recordingId || !lab.enabled || !itemsQuery.data?.items.length) {
    return null;
  }
  return <RecordingContextPanel recordingId={recordingId} />;
}

export function RecordingContextPanel({
  recordingId,
}: {
  recordingId: string;
}) {
  const t = useT();
  const itemsQuery = useRecordingContextItems(recordingId, true);

  let content: ReactNode;
  if (itemsQuery.isSuccess) {
    const items = itemsQuery.data.items;
    content =
      items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("lookbackContext.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-5">
          {items.map((item) => (
            <li key={item.id}>
              <ContextItemCard item={item} />
            </li>
          ))}
        </ul>
      );
  } else if (itemsQuery.isError) {
    content = (
      <p role="alert" className="text-sm text-destructive">
        {t("lookbackContext.loadFailed")}
      </p>
    );
  } else {
    content = <ContextPanelSkeleton />;
  }

  return (
    <div className="max-h-80 shrink-0 overflow-y-auto border-b border-border px-4 py-4">
      {content}
      {itemsQuery.isSuccess && itemsQuery.data.items.length > 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">
          {t("lookbackContext.editHint")}
        </p>
      ) : null}
    </div>
  );
}

function ContextPanelSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-28" />
        </div>
        <Skeleton className="h-8 w-20" />
      </div>
      <Skeleton className="aspect-video w-full rounded-md" />
    </div>
  );
}

function ContextItemCard({ item }: { item: RecordingContextItem }) {
  const t = useT();
  const [largerOpen, setLargerOpen] = useState(false);
  const label = item.label?.trim() || t("lookbackContext.label");
  const windowText = t("lookbackContext.window", {
    start: formatClock(0),
    end: formatClock(contextWindowSeconds(item)),
  });
  const src =
    item.status === "ready" && item.mediaRecordingId
      ? contextVideoSrc(item.mediaRecordingId)
      : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{label}</p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {windowText}
          </p>
        </div>
        {src ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => setLargerOpen(true)}
          >
            <IconArrowsMaximize className="size-4" aria-hidden="true" />
            {t("lookbackContext.larger")}
          </Button>
        ) : null}
      </div>
      {src ? (
        <>
          <video
            controls
            preload="metadata"
            src={src}
            aria-label={label}
            className="aspect-video w-full rounded-md bg-muted"
          />
          <Dialog open={largerOpen} onOpenChange={setLargerOpen}>
            <DialogContent className="sm:max-w-4xl">
              <DialogHeader>
                <DialogTitle>{label}</DialogTitle>
                <DialogDescription>{windowText}</DialogDescription>
              </DialogHeader>
              <video
                controls
                preload="metadata"
                src={src}
                aria-label={label}
                className="w-full rounded-md bg-muted"
              />
            </DialogContent>
          </Dialog>
        </>
      ) : isContextItemUnfinished(item) ? (
        <div
          role="status"
          className="flex aspect-video w-full items-center justify-center gap-2 rounded-md bg-muted text-sm text-muted-foreground"
        >
          <Spinner />
          {t("lookbackContext.savingEarlierTime")}
        </div>
      ) : (
        <div
          role="alert"
          className="rounded-md bg-muted p-3 text-sm text-destructive"
        >
          {item.error?.trim() || t("lookbackContext.failed")}
        </div>
      )}
    </div>
  );
}
