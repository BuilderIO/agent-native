import { captureClientException } from "@agent-native/core/client/analytics";
import { appBasePath } from "@agent-native/core/client/api-path";
import {
  useActionMutation,
  useActionQuery,
  useDbSync,
  useSession,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconArrowsMaximize, IconTrash } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  isWaitingOnOtherDevice,
  type ListRecordingContextResult,
  type RecordingContextItem,
} from "./recording-context-model";

const CONTEXT_POLL_MS = 3000;
const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;
const CONTEXT_SYNC_ACTIONS = new Set([
  "request-recording-context",
  "update-recording-context",
  "set-recording-context-window",
  "remove-recording-context",
]);

export function isAuthenticatedRecordingPath(
  pathname: string,
  authenticated: boolean,
): boolean {
  return authenticated && /(?:^|\/)r\/[^/]+$/.test(pathname);
}

// Same route the editor and the Rewind extension use for a recording's own video.
export function contextVideoSrc(
  mediaRecordingId: string,
  accessToken?: string,
): string {
  const src = `${appBasePath()}/api/video/${encodeURIComponent(mediaRecordingId)}`;
  return accessToken ? `${src}?t=${encodeURIComponent(accessToken)}` : src;
}

type MediaAccessTokenClaims =
  | { kind: "valid"; resourceId: string; exp: number }
  | { kind: "invalid" };

function mediaAccessTokenClaims(
  token: string | undefined,
): MediaAccessTokenClaims | undefined {
  if (!token) return undefined;
  const payload = token.split(".", 1)[0];
  if (!payload) return { kind: "invalid" };
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    const claims = JSON.parse(decoded) as Record<string, unknown>;
    return typeof claims.resourceId === "string" &&
      typeof claims.exp === "number"
      ? { kind: "valid", resourceId: claims.resourceId, exp: claims.exp }
      : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}

function shouldReplacePinnedAccessToken(
  currentToken: string | undefined,
  incomingToken: string | undefined,
): boolean {
  if (!incomingToken || currentToken === incomingToken) return false;
  if (!currentToken) return true;
  const current = mediaAccessTokenClaims(currentToken);
  const incoming = mediaAccessTokenClaims(incomingToken);
  if (incoming?.kind !== "valid") return false;
  if (current?.kind !== "valid") return true;
  return (
    current.resourceId !== incoming.resourceId ||
    current.exp * 1000 <= Date.now() + ACCESS_TOKEN_REFRESH_SKEW_MS
  );
}

// A trashed Clip answers non-owner viewers 404 recording_not_found. That is
// "no context to show", not a failed load.
function isClipUnavailableError(error: unknown): boolean {
  const { status, errorCode } = (error ?? {}) as {
    status?: unknown;
    errorCode?: unknown;
  };
  return status === 404 && errorCode === "recording_not_found";
}

export function useRecordingContextItems(
  recordingId: string | undefined,
  enabled: boolean,
  accessToken?: string,
  canPollUnclaimedPending = false,
) {
  // Keep the query key stable across player-data refetches, but adopt a new
  // grant when its resource scope changes or the pinned grant is expiring.
  const pinned = useRef<{ recordingId?: string; token?: string }>({});
  if (pinned.current.recordingId !== recordingId) {
    pinned.current = { recordingId, token: accessToken };
  } else if (
    shouldReplacePinnedAccessToken(pinned.current.token, accessToken)
  ) {
    pinned.current.token = accessToken;
  }
  const stableToken = pinned.current.token;
  return useActionQuery<ListRecordingContextResult>(
    "list-recording-context",
    {
      recordingId: recordingId ?? "",
      ...(stableToken ? { accessToken: stableToken } : {}),
    },
    {
      enabled: enabled && Boolean(recordingId),
      // A share viewer has no realtime channel, so context attached after the
      // page opened appears when they come back to the tab.
      // request-storm-allow: one small query per open clip view, and the 30s
      // staleTime default skips a refetch on a quick refocus.
      refetchOnWindowFocus: true,
      refetchInterval: (query) =>
        hasUnfinishedContextItems(
          query.state.data?.items ?? [],
          canPollUnclaimedPending,
        )
          ? CONTEXT_POLL_MS
          : false,
    },
  );
}

// The Transcript tab's entry point. Renders nothing unless the clip has context
// items, so clips without earlier screen time look unchanged. It is shown to
// every viewer of the clip: earlier screen time is shared with the clip.
export function RecordingContextSection({
  recordingId,
  canManage = true,
  accessToken,
}: {
  recordingId: string | undefined;
  canManage?: boolean;
  accessToken?: string;
}) {
  const location = useLocation();
  const { session } = useSession();
  const queryClient = useQueryClient();
  const canPollUnclaimedPending =
    canManage && isAuthenticatedRecordingPath(location.pathname, !!session);
  useDbSync({
    queryClient,
    realtime:
      isAuthenticatedRecordingPath(location.pathname, !!session) && recordingId
        ? {
            reason: "desktop finishes earlier screen time",
          }
        : undefined,
    actionInvalidatePredicate: (query, events) =>
      query.queryKey[0] === "action" &&
      query.queryKey[1] === "list-recording-context" &&
      (query.queryKey[2] as { recordingId?: unknown } | undefined)
        ?.recordingId === recordingId &&
      events.some(
        (event) =>
          event.source === "action" &&
          typeof event.key === "string" &&
          CONTEXT_SYNC_ACTIONS.has(event.key),
      ),
  });
  const itemsQuery = useRecordingContextItems(
    recordingId,
    true,
    accessToken,
    canPollUnclaimedPending,
  );
  const { isError, error } = itemsQuery;
  const clipUnavailable = isError && isClipUnavailableError(error);
  useEffect(() => {
    if (isError && !clipUnavailable) captureClientException(error);
  }, [clipUnavailable, error, isError]);

  const hasItems = Boolean(itemsQuery.data?.items.length);
  if (!recordingId || (!hasItems && (!isError || clipUnavailable))) {
    return null;
  }
  return (
    <RecordingContextPanel
      recordingId={recordingId}
      canManage={canManage}
      accessToken={accessToken}
      canPollUnclaimedPending={canPollUnclaimedPending}
    />
  );
}

export function RecordingContextPanel({
  recordingId,
  canManage = true,
  accessToken,
  canPollUnclaimedPending = canManage,
}: {
  recordingId: string;
  canManage?: boolean;
  accessToken?: string;
  canPollUnclaimedPending?: boolean;
}) {
  const t = useT();
  const itemsQuery = useRecordingContextItems(
    recordingId,
    true,
    accessToken,
    canPollUnclaimedPending,
  );
  // Hides an item as soon as its removal lands, without waiting for the refetch.
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const markRemoved = (id: string) =>
    setRemovedIds((current) => new Set(current).add(id));

  let content: ReactNode;
  let visibleCount = 0;
  if (itemsQuery.isSuccess) {
    const items = itemsQuery.data.items.filter(
      (item) => !removedIds.has(item.id),
    );
    visibleCount = items.length;
    content =
      items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("lookbackContext.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-5">
          {items.map((item) => (
            <li key={item.id}>
              <ContextItemCard
                item={item}
                canManage={canManage}
                accessToken={accessToken}
                onRemoved={markRemoved}
              />
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
      {visibleCount > 0 && canManage ? (
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

function ContextItemCard({
  item,
  canManage,
  accessToken,
  onRemoved,
}: {
  item: RecordingContextItem;
  canManage: boolean;
  accessToken?: string;
  onRemoved: (id: string) => void;
}) {
  const t = useT();
  const [largerOpen, setLargerOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const removeContext = useActionMutation("remove-recording-context");
  const retryContext = useActionMutation("set-recording-context-window");
  const label = item.label?.trim() || t("lookbackContext.label");
  const windowText = t("lookbackContext.window", {
    start: formatClock(0),
    end: formatClock(contextWindowSeconds(item)),
  });
  const src =
    item.status === "ready" && item.mediaRecordingId
      ? contextVideoSrc(item.mediaRecordingId, accessToken)
      : null;
  // Only a pending item waits on its device. A processing item is already
  // claimed by that device, so it keeps the saving text.
  const waitingOnOtherDevice = isWaitingOnOtherDevice(item);

  function confirmRemove() {
    removeContext.mutate(
      { id: item.id },
      {
        onSuccess: () => {
          onRemoved(item.id);
          toast.success(t("lookbackContext.removed"));
        },
        onError: () => toast.error(t("lookbackContext.removeFailedAction")),
      },
    );
  }

  function retry() {
    retryContext.mutate(
      {
        id: item.id,
        startedAt: item.startedAt,
        endedAt: item.endedAt,
      },
      {
        onSuccess: () => toast.success(t("lookbackContext.savingEarlierTime")),
        onError: () => toast.error(t("lookbackContext.editFailed")),
      },
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{label}</p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {windowText}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {item.status === "failed" && canManage ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={retryContext.isPending}
              onClick={retry}
            >
              {t("lookbackContext.retry")}
            </Button>
          ) : null}
          {src ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setLargerOpen(true)}
            >
              <IconArrowsMaximize className="size-4" aria-hidden="true" />
              {t("lookbackContext.larger")}
            </Button>
          ) : null}
          {canManage ? (
            <Button
              type="button"
              variant="outline-destructive"
              size="sm"
              onClick={() => setRemoveOpen(true)}
            >
              <IconTrash className="size-4" aria-hidden="true" />
              {t("lookbackContext.removeAction")}
            </Button>
          ) : null}
        </div>
      </div>
      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("lookbackContext.removeConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("lookbackContext.removeConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmRemove}
            >
              {t("lookbackContext.removeConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
          {waitingOnOtherDevice
            ? t("lookbackContext.waitingOtherDevice")
            : t("lookbackContext.savingEarlierTime")}
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
