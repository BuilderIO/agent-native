import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { MediaCleanupSummary } from "@shared/media-cleanup";
import { IconAlertTriangle, IconFiles } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";

type MediaCleanupStatusValue = MediaCleanupSummary["status"];

export interface PermanentDeleteResult {
  success: boolean;
  id: string;
  recordingRemoved: boolean;
  mediaCleanup?: MediaCleanupSummary;
}

interface ListMediaCleanupsResult {
  cleanups: MediaCleanupSummary[];
}

export const MEDIA_CLEANUPS_ACTION = "list-recording-media-cleanups";

const PENDING_POLL_MS = 10_000;
const WAITING_POLL_MS = 60_000;
const RECONNECT_REASONS = new Set([
  "credential_unavailable",
  "credential_space_mismatch",
]);

/**
 * What a resolved permanent delete removed. `null` means the server did not
 * confirm the recording is gone. Media counts as removed only when cleanup
 * is complete. `retained_shared` keeps files another recording still uses:
 * neither removed nor failed. Anything else is still pending.
 */
export function permanentDeleteOutcome(
  result: PermanentDeleteResult | undefined,
): MediaCleanupStatusValue | null {
  if (result?.recordingRemoved !== true) return null;
  const status = result.mediaCleanup?.status;
  if (status === "complete") {
    return result.success === true ? status : "pending";
  }
  return status === "blocked" || status === "retained_shared"
    ? status
    : "pending";
}

function groupCleanups(data: ListMediaCleanupsResult | undefined) {
  const cleanups = Array.isArray(data?.cleanups) ? data.cleanups : [];
  const withStatus = (status: MediaCleanupStatusValue) =>
    cleanups.filter((cleanup) => cleanup.status === status);
  return {
    pending: withStatus("pending"),
    blocked: withStatus("blocked"),
    retained: withStatus("retained_shared"),
  };
}

function mediaCleanupRefetchInterval(
  data: ListMediaCleanupsResult | undefined,
): number | false {
  const { pending, blocked, retained } = groupCleanups(data);
  if (pending.length > 0) return PENDING_POLL_MS;
  return blocked.length > 0 || retained.length > 0 ? WAITING_POLL_MS : false;
}

/**
 * Media still in storage from recordings that were deleted forever: being
 * removed, blocked, or kept because another recording uses it. It is read
 * from the server so it survives a reload, and shows even when Trash has no
 * recordings left.
 */
export function MediaCleanupStatus() {
  const t = useT();
  const queryClient = useQueryClient();
  const [isRetrying, setIsRetrying] = useState(false);
  const cleanupsQuery = useActionQuery<ListMediaCleanupsResult>(
    MEDIA_CLEANUPS_ACTION,
    { limit: 100 },
    {
      refetchInterval: (query) => mediaCleanupRefetchInterval(query.state.data),
    },
  );
  const retry = useActionMutation<MediaCleanupSummary, { id: string }>(
    "retry-recording-media-cleanup",
    { skipActionQueryInvalidation: true },
  );

  const { data, isError, isFetching, refetch } = cleanupsQuery;
  if (isError && !data) {
    return (
      <div className="pb-4">
        <Item variant="outline" size="sm">
          <ItemMedia>
            <IconAlertTriangle className="size-4 text-destructive" />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{t("trashRoute.mediaCleanupLoadFailed")}</ItemTitle>
          </ItemContent>
          <ItemActions>
            <Button
              size="sm"
              variant="outline"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              {t("libraryGrid.retry")}
            </Button>
          </ItemActions>
        </Item>
      </div>
    );
  }

  const { pending, blocked, retained } = groupCleanups(data);
  if (pending.length === 0 && blocked.length === 0 && retained.length === 0) {
    return null;
  }
  const needsReconnect = blocked.some(
    (cleanup) =>
      cleanup.reason !== null && RECONNECT_REASONS.has(cleanup.reason),
  );

  const retryBlocked = async () => {
    setIsRetrying(true);
    try {
      const summaries: MediaCleanupSummary[] = [];
      let failed = 0;
      // One at a time: the list holds up to 100 cleanups, and retrying them
      // all at once would burst that many mutations at the same storage.
      for (const cleanup of blocked) {
        try {
          summaries.push(await retry.mutateAsync({ id: cleanup.id }));
        } catch {
          failed += 1;
        }
      }
      if (failed > 0) {
        toast.error(t("trashRoute.mediaCleanupRetryFailed"));
      } else if (summaries.some((summary) => summary.status === "blocked")) {
        toast.warning(t("trashRoute.mediaCleanupStillBlocked"));
      } else if (summaries.every((summary) => summary.status === "complete")) {
        toast.success(t("trashRoute.mediaCleanupRemoved"));
      }
    } finally {
      await queryClient.invalidateQueries({
        queryKey: ["action", MEDIA_CLEANUPS_ACTION],
      });
      setIsRetrying(false);
    }
  };

  return (
    <div
      role="list"
      aria-label={t("trashRoute.mediaCleanupListLabel")}
      className="flex flex-col gap-2 pb-4"
    >
      {pending.length > 0 || isRetrying ? (
        <Item variant="outline" size="sm" role="listitem">
          <ItemMedia>
            <Spinner />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{t("trashRoute.mediaCleanupPending")}</ItemTitle>
          </ItemContent>
        </Item>
      ) : null}
      {blocked.length > 0 && !isRetrying ? (
        <Item variant="outline" size="sm" role="listitem">
          <ItemMedia>
            <IconAlertTriangle className="size-4 text-destructive" />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle>
              {needsReconnect
                ? t("trashRoute.mediaCleanupReconnect")
                : t("trashRoute.mediaCleanupBlocked")}
            </ItemTitle>
          </ItemContent>
          <ItemActions>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void retryBlocked()}
            >
              {t("libraryGrid.retry")}
            </Button>
          </ItemActions>
        </Item>
      ) : null}
      {retained.length > 0 ? (
        <Item variant="outline" size="sm" role="listitem">
          <ItemMedia>
            <IconFiles className="size-4 text-muted-foreground" />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{t("trashRoute.mediaCleanupRetained")}</ItemTitle>
          </ItemContent>
        </Item>
      ) : null}
    </div>
  );
}
