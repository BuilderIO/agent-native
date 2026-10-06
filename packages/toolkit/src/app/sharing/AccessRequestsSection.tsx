import { useT } from "@agent-native/core/client/i18n";
import {
  useResourceAccessRequests,
  type AccessRequestReview,
} from "@agent-native/core/client/sharing/useAccessRequestReview";
import {
  ActionButton,
  Avatar as DesignSystemAvatar,
} from "@agent-native/toolkit/design-system";

// Allow here grants Viewer; the request's own page offers every role.
export function AccessRequestsSection({
  resourceType,
  resourceId,
}: {
  resourceType: string;
  resourceId: string;
}) {
  const t = useT();
  const { requests, hasMore, isError, refetch, decisions } =
    useResourceAccessRequests({ resourceType, resourceId });
  const error = decisions.error;
  const unemailed = decisions.unemailed;
  // A decision's outcome stays readable after its row is gone, even when the
  // list's reload fails: a stale decision, or an email that didn't send.
  if (!isError && !requests.length && !error && !unemailed) return null;
  // A failure shows as `decisions.error`, and a stale one reloads the list.
  const decide = (run: () => Promise<void>) =>
    void run().catch(() => undefined);
  return (
    <div className="space-y-2">
      {isError ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span role="alert">
            {t("agentChat.share.accessRequestsLoadFailed", {
              defaultValue: "Couldn't load access requests.",
            })}
          </span>
          <ActionButton
            emphasis="ghost"
            size="compact"
            onPress={() => void refetch()}
          >
            {t("agentChat.accessRequest.retry", { defaultValue: "Retry" })}
          </ActionButton>
        </div>
      ) : (
        <>
          <div className="text-sm font-semibold">
            {t("agentChat.share.accessRequests", {
              defaultValue: "Access requests",
            })}
          </div>
          {requests.length ? (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {requests.map((request) => (
                <AccessRequestRow
                  key={request.id}
                  request={request}
                  deciding={decisions.pendingId === request.id}
                  onAllow={() =>
                    decide(() => decisions.approve(request, "viewer"))
                  }
                  onDecline={() => decide(() => decisions.decline(request))}
                />
              ))}
            </ul>
          ) : null}
          {hasMore ? (
            <p className="text-xs text-muted-foreground">
              {t("agentChat.share.accessRequestsNewest", {
                count: requests.length,
                defaultValue: "Showing the {{count}} newest requests.",
              })}
            </p>
          ) : null}
        </>
      )}
      {unemailed ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t("agentChat.accessRequest.emailFailed", {
            name: unemailed.requester.name?.trim() || unemailed.requester.email,
            defaultValue: "{{name}} has access, but we couldn't email them.",
          })}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error.errorCode === "access_request_stale"
            ? t("agentChat.accessRequest.stale", {
                defaultValue:
                  "Someone already handled this request, or it changed.",
              })
            : (error.message ??
              t("agentChat.accessRequest.decisionFailed", {
                defaultValue: "Couldn't save your decision. Try again.",
              }))}
        </p>
      ) : null}
    </div>
  );
}

function AccessRequestRow({
  request,
  deciding,
  onAllow,
  onDecline,
}: {
  request: AccessRequestReview;
  deciding: boolean;
  onAllow: () => void;
  onDecline: () => void;
}) {
  const t = useT();
  const name = request.requester.name?.trim() || request.requester.email;
  return (
    <li className="flex items-start gap-3 px-1 py-1.5 text-sm">
      <DesignSystemAvatar
        name={name}
        size="compact"
        className="mt-0.5 inline-flex h-7 w-7 shrink-0 text-[11px] font-semibold"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate">{name}</div>
        {request.requester.name ? (
          <div className="truncate text-xs text-muted-foreground">
            {request.requester.email}
          </div>
        ) : null}
        {request.note ? (
          <div className="line-clamp-2 break-words text-xs text-muted-foreground">
            {request.note}
          </div>
        ) : null}
      </div>
      <ActionButton
        size="compact"
        pending={deciding}
        disabled={deciding}
        onPress={onAllow}
        aria-label={t("agentChat.share.allowRequestFrom", {
          name,
          defaultValue: "Allow {{name}}",
        })}
      >
        {t("agentChat.accessRequest.allow", { defaultValue: "Allow" })}
      </ActionButton>
      <ActionButton
        size="compact"
        emphasis="ghost"
        disabled={deciding}
        onPress={onDecline}
        aria-label={t("agentChat.share.declineRequestFrom", {
          name,
          defaultValue: "Decline {{name}}",
        })}
      >
        {t("agentChat.accessRequest.decline", { defaultValue: "Decline" })}
      </ActionButton>
    </li>
  );
}
