import { signOut, useSession } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  useAccessRequestReview,
  type AccessRequestReview,
  type AccessRequestRole,
} from "@agent-native/core/client/sharing/useAccessRequestReview";
import {
  ActionButton,
  Avatar,
  Picker,
  Skeleton,
  Status,
} from "@agent-native/toolkit/design-system";
import { cn } from "@agent-native/toolkit/utils";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";

import { ResourceAccessScreen } from "./ResourceAccessScreen.js";

export interface AccessRequestApprovalPageProps {
  /**
   * The request id from the link in the owner's email or notification.
   * Defaults to the route's `requestId` param.
   */
  requestId?: string;
  /** Replaces Switch account, which by default signs out. */
  onSwitchAccount?: () => void;
  /** Rendered above the page, such as a sidebar toggle. */
  header?: ReactNode;
  /** Render as the page's `main` landmark when the app shell has none. */
  landmark?: boolean;
  className?: string;
}

const ROLES = ["viewer", "commenter", "editor", "admin"] as const;

/**
 * Where an access request's email and notification lead: who is asking, for
 * what, and Allow or Decline. Opening it only reads; the decision is always an
 * explicit press. Someone who can't manage the resource sees the same
 * unavailable screen whether or not the request exists.
 */
export function AccessRequestApprovalPage({
  requestId,
  onSwitchAccount,
  header,
  landmark = false,
  className,
}: AccessRequestApprovalPageProps) {
  const t = useT();
  const params = useParams();
  const { session } = useSession();
  const controller = useAccessRequestReview(
    requestId ?? params.requestId ?? "",
  );
  const Root = landmark ? "main" : "div";

  if (controller.isSignedOut) {
    return (
      <ResourceAccessScreen
        state="signed-out"
        header={header}
        landmark={landmark}
        className={className}
      />
    );
  }

  if (controller.isUnavailable) {
    return (
      <ResourceAccessScreen
        state="denied"
        title={t("agentChat.accessRequest.unavailableTitle", {
          defaultValue: "You can't review this request",
        })}
        description={t("agentChat.accessRequest.unavailableDescription", {
          defaultValue:
            "It may have been withdrawn, or this account can't manage access.",
        })}
        signedInEmail={session?.email ?? null}
        onSwitchAccount={onSwitchAccount ?? (() => void signOut())}
        header={header}
        landmark={landmark}
        className={className}
      />
    );
  }

  return (
    <Root className={cn("flex min-h-0 flex-1 flex-col", className)}>
      {header}
      <div className="flex min-h-0 flex-1 items-center justify-center bg-background px-6 py-10">
        {controller.review ? (
          <ReviewPanel
            review={controller.review}
            decisions={controller.decisions}
          />
        ) : controller.isError ? (
          <section className="flex w-full max-w-sm flex-col items-center text-center">
            <p role="alert" className="text-sm text-muted-foreground">
              {t("agentChat.accessRequest.loadFailed", {
                defaultValue: "Couldn't load this request.",
              })}
            </p>
            <ActionButton
              emphasis="outline"
              className="mt-4"
              onPress={() => void controller.refetch()}
            >
              {t("agentChat.accessRequest.retry", { defaultValue: "Retry" })}
            </ActionButton>
          </section>
        ) : (
          <ReviewSkeleton />
        )}
      </div>
    </Root>
  );
}

function ReviewSkeleton() {
  return (
    <div aria-hidden="true" className="flex w-full max-w-md flex-col gap-6">
      <Skeleton height={32} width="80%" />
      <div className="flex items-center gap-3">
        <Skeleton shape="circle" width={36} height={36} />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton height={14} width="40%" />
          <Skeleton height={12} width="60%" />
        </div>
      </div>
      <Skeleton height={14} width="50%" />
      <div className="flex gap-2">
        <Skeleton height={36} width={128} />
        <Skeleton height={36} width={80} />
        <Skeleton height={36} width={80} />
      </div>
    </div>
  );
}

function ReviewPanel({
  review,
  decisions,
}: {
  review: AccessRequestReview;
  decisions: ReturnType<typeof useAccessRequestReview>["decisions"];
}) {
  const t = useT();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [role, setRole] = useState<AccessRequestRole>("viewer");
  const name = review.requester.name?.trim() || review.requester.email;
  const deciding = decisions.pendingId === review.id;
  const roleLabel = (value: AccessRequestRole) =>
    ({
      viewer: t("agentChat.share.viewer", { defaultValue: "Viewer" }),
      commenter: t("agentChat.share.commenter", { defaultValue: "Commenter" }),
      editor: t("agentChat.share.editor", { defaultValue: "Editor" }),
      admin: t("agentChat.share.admin", { defaultValue: "Admin" }),
    })[value];

  // A decision removes the buttons that held focus, so the outcome is read
  // from the heading it moves to.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [review.state]);

  // A failure shows as `decisions.error`, and a stale one reloads the request.
  const decide = (run: () => Promise<void>) =>
    void run().catch(() => undefined);

  const heading =
    review.state === "approved"
      ? t("agentChat.accessRequest.approvedTitle", {
          defaultValue: "Access allowed",
        })
      : review.state === "declined"
        ? t("agentChat.accessRequest.declinedTitle", {
            defaultValue: "Request declined",
          })
        : t("agentChat.accessRequest.title", {
            name,
            defaultValue: "{{name}} is asking for access",
          });

  const error = decisions.error;
  const errorText = error
    ? error.errorCode === "access_request_stale"
      ? t("agentChat.accessRequest.stale", {
          defaultValue: "Someone already handled this request, or it changed.",
        })
      : (error.message ??
        t("agentChat.accessRequest.decisionFailed", {
          defaultValue: "Couldn't save your decision. Try again.",
        }))
    : null;

  return (
    <section
      aria-labelledby={headingId}
      className="flex w-full max-w-md flex-col gap-6"
      data-access-request-state={review.state}
    >
      <h1
        ref={headingRef}
        id={headingId}
        tabIndex={-1}
        className="break-words text-2xl font-semibold tracking-normal text-foreground outline-none"
      >
        {heading}
      </h1>

      <div className="flex items-center gap-3">
        <Avatar name={name} size="default" className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">
            {name}
          </div>
          {review.requester.name ? (
            <div className="truncate text-sm text-muted-foreground">
              {review.requester.email}
            </div>
          ) : null}
        </div>
        {review.state === "approved" && review.grantedRole ? (
          <Status tone="neutral" size="compact">
            {roleLabel(review.grantedRole)}
          </Status>
        ) : null}
      </div>

      <div className="text-sm text-muted-foreground">
        <span>{review.resource.label}</span>{" "}
        {review.resource.path ? (
          <Link
            to={review.resource.path}
            className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
          >
            {review.resource.title}
          </Link>
        ) : (
          <span className="font-medium text-foreground">
            {review.resource.title}
          </span>
        )}
      </div>

      {review.note ? (
        <blockquote className="whitespace-pre-wrap break-words border-s-2 border-border ps-3 text-sm text-foreground">
          {review.note}
        </blockquote>
      ) : null}

      {review.state === "pending" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Picker
            mode="select"
            options={ROLES.map((value) => ({
              value,
              label: roleLabel(value),
            }))}
            value={role}
            onChange={(value) => {
              if (value && (ROLES as readonly string[]).includes(value)) {
                setRole(value as AccessRequestRole);
              }
            }}
            disabled={deciding}
            aria-label={t("agentChat.share.role", { defaultValue: "Role" })}
            className="w-auto"
          />
          <ActionButton
            pending={deciding}
            disabled={deciding}
            onPress={() => decide(() => decisions.approve(review, role))}
          >
            {t("agentChat.accessRequest.allow", { defaultValue: "Allow" })}
          </ActionButton>
          <ActionButton
            emphasis="outline"
            disabled={deciding}
            onPress={() => decide(() => decisions.decline(review))}
          >
            {t("agentChat.accessRequest.decline", { defaultValue: "Decline" })}
          </ActionButton>
        </div>
      ) : null}

      {decisions.unemailed?.id === review.id ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("agentChat.accessRequest.emailFailed", {
            name,
            defaultValue: "{{name}} has access, but we couldn't email them.",
          })}
        </p>
      ) : null}

      {errorText ? (
        <p role="alert" className="text-sm text-destructive">
          {errorText}
        </p>
      ) : null}
    </section>
  );
}
