import { useT } from "@agent-native/core/client/i18n";
import type { ReviewComment } from "@agent-native/core/review";
import type { ReviewAgentRequest } from "@shared/review-agent";
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconBulb,
  IconCircleCheck,
  IconCircleOff,
  IconMessageCheck,
} from "@tabler/icons-react";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  freshResultRemainingMs,
  reviewAgentModelName,
  shouldShowStatus,
  statusPresentation,
  type ReviewAgentStatusIcon,
} from "@/lib/review-agent/review-agent-status";
import { cn } from "@/lib/utils";

interface ThreadForStatus {
  root: ReviewComment;
  replies: readonly ReviewComment[];
}

export interface ReviewAgentRequestStatusProps {
  className?: string | undefined;
  /** The latest request for the thread. */
  request: ReviewAgentRequest | undefined;
  thread: ThreadForStatus;
  /** This tab is starting a run; shown at once, before the request exists. */
  starting?: boolean | undefined;
  startingAgentName?: string | null | undefined;
  stopping?: boolean | undefined;
  onStop?: ((request: ReviewAgentRequest) => void) | undefined;
  onOpen?: ((request: ReviewAgentRequest) => void) | undefined;
  onRetry?: ((request: ReviewAgentRequest) => void) | undefined;
}

const ICON_CLASS = "size-3.5 shrink-0";

function StatusIcon({ icon }: { icon: ReviewAgentStatusIcon }) {
  switch (icon) {
    case "spinner":
      return <Spinner className={ICON_CLASS} />;
    case "replied":
      return <IconMessageCheck className={ICON_CLASS} aria-hidden />;
    case "suggested":
      return <IconBulb className={ICON_CLASS} aria-hidden />;
    case "applied":
      return <IconCircleCheck className={ICON_CLASS} aria-hidden />;
    case "needs-input":
      return <IconAlertCircle className={ICON_CLASS} aria-hidden />;
    case "failed":
      return (
        <IconAlertTriangle
          className={`${ICON_CLASS} text-destructive`}
          aria-hidden
        />
      );
    case "cancelled":
      return <IconCircleOff className={ICON_CLASS} aria-hidden />;
  }
}

function StatusFrame({
  status,
  className,
  children,
}: {
  status: string;
  className: string | undefined;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      data-review-agent-status={status}
      className={cn(
        "flex items-center gap-2 px-3 pt-3 text-xs text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * One row in the thread card: what the agent is doing on this thread, with the
 * few actions that status allows. It is chrome-free on purpose; the agent's
 * reply in the thread is the lasting record, so a finished run's row expires.
 */
export function ReviewAgentRequestStatus({
  className,
  request,
  thread,
  starting = false,
  startingAgentName = null,
  stopping = false,
  onStop,
  onOpen,
  onRetry,
}: ReviewAgentRequestStatusProps) {
  const t = useT();
  const [, setClock] = useState(0);
  const status = request?.status;
  const updatedAt = request?.updatedAt;
  useEffect(() => {
    if (status === undefined || updatedAt === undefined) return;
    const remaining = freshResultRemainingMs({ status, updatedAt }, Date.now());
    if (remaining === null || remaining <= 0) return;
    const timer = setTimeout(
      () => setClock((tick) => tick + 1),
      remaining + 50,
    );
    return () => clearTimeout(timer);
  }, [status, updatedAt]);

  if (starting) {
    return (
      <StatusFrame status="starting" className={className}>
        <Spinner className={ICON_CLASS} />
        <span className="min-w-0 flex-1 truncate">
          {t("review.agent.working", {
            agent: startingAgentName ?? t("review.agent.fallbackName"),
          })}
        </span>
      </StatusFrame>
    );
  }
  if (!request || !shouldShowStatus(request, thread, Date.now())) return null;

  const presentation = statusPresentation(request);
  const agent = reviewAgentModelName(request) ?? t("review.agent.fallbackName");
  const label = presentation.namesAgent
    ? t(presentation.labelKey, { agent })
    : t(presentation.labelKey);
  return (
    <StatusFrame status={request.status} className={className}>
      <StatusIcon icon={presentation.icon} />
      {presentation.tooltipKey ? (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="min-w-0 flex-1 truncate" tabIndex={0}>
                {label}
              </span>
            </TooltipTrigger>
            <TooltipContent>{t(presentation.tooltipKey)}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <span className="min-w-0 flex-1 truncate">{label}</span>
      )}
      {presentation.canRetry && onRetry ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => onRetry(request)}
        >
          {t("review.agent.retry")}
        </Button>
      ) : null}
      {presentation.canOpenChat && onOpen ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => onOpen(request)}
        >
          {t("review.agent.openChat")}
        </Button>
      ) : null}
      {presentation.canCancel && onStop ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={stopping}
          onClick={() => onStop(request)}
        >
          {t("review.agent.cancel")}
        </Button>
      ) : null}
    </StatusFrame>
  );
}
