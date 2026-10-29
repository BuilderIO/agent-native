import { useT } from "@agent-native/core/client/i18n";
import {
  isSlideReviewAgentActive,
  type SlideReviewAgentRequest,
} from "@shared/slide-review-agent";
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconCircleOff,
} from "@tabler/icons-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

const ICON_CLASS = "size-3.5 shrink-0";

/**
 * What the agent is doing on a thread. A run that replied or applied its
 * change shows nothing here: its comment in the thread is the record.
 */
export function SlideReviewAgentStatus({
  request,
  starting,
  stopping,
  onStop,
  onOpen,
}: {
  request: SlideReviewAgentRequest | undefined;
  starting: boolean;
  stopping: boolean;
  onStop: (request: SlideReviewAgentRequest) => void;
  onOpen: (request: SlideReviewAgentRequest) => void;
}) {
  const t = useT();
  if (starting && !request) {
    return (
      <Row status="starting">
        <Spinner className={ICON_CLASS} />
        <span className="min-w-0 flex-1 truncate">
          {t("comments.agentStarting")}
        </span>
      </Row>
    );
  }
  if (!request) return null;
  const agent = request.agentName;
  if (isSlideReviewAgentActive(request.status)) {
    return (
      <Row status={request.status}>
        <Spinner className={ICON_CLASS} />
        <span className="min-w-0 flex-1 truncate">
          {t("comments.agentWorking", { agent })}
        </span>
        {request.agentThreadId ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => onOpen(request)}
          >
            {t("comments.agentOpenChat")}
          </Button>
        ) : null}
        {request.mine ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={stopping}
            onClick={() => onStop(request)}
          >
            {t("comments.agentCancel")}
          </Button>
        ) : null}
      </Row>
    );
  }
  if (request.status === "failed") {
    return (
      <Row status="failed">
        <IconAlertTriangle
          className={`${ICON_CLASS} text-destructive`}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate">
          {t("comments.agentFailed", { agent })}
        </span>
      </Row>
    );
  }
  if (request.status === "needs-input") {
    return (
      <Row status="needs-input">
        <IconAlertCircle className={ICON_CLASS} aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          {t("comments.agentNeedsInput", { agent })}
        </span>
      </Row>
    );
  }
  if (request.status === "cancelled") {
    return (
      <Row status="cancelled">
        <IconCircleOff className={ICON_CLASS} aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          {t("comments.agentStopped")}
        </span>
      </Row>
    );
  }
  return null;
}

function Row({ status, children }: { status: string; children: ReactNode }) {
  return (
    <div
      role="status"
      data-slide-review-agent-status={status}
      className="flex items-center gap-2 px-3 pt-3 text-xs text-muted-foreground"
    >
      {children}
    </div>
  );
}
