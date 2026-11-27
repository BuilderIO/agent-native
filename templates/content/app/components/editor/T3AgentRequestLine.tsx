import { useT } from "@agent-native/core/client/i18n";
import { mcpConnectHostLabel } from "@agent-native/core/shared/mcp-connect-content";
import {
  IconAlertCircle,
  IconExternalLink,
  IconHandStop,
  IconLoader2,
} from "@tabler/icons-react";

import {
  isT3AgentRequestActive,
  useT3AgentRequestsContext,
  type T3AgentRequest,
} from "@/hooks/use-t3-agents";

export function T3AgentRequestLine({ commentId }: { commentId: string }) {
  const t = useT();
  const { requests, unreachable } = useT3AgentRequestsContext();
  const request = requests.find(
    (candidate) =>
      candidate.commentId === commentId && candidate.status !== "answered",
  );
  if (!request) return null;
  const agent = mcpConnectHostLabel(request.agent) ?? request.agent;
  const thread = request.t3ThreadTitle ?? t("comments.t3NewThread");
  const active = isT3AgentRequestActive(request);
  return (
    <div
      className="grid gap-0.5 text-xs text-muted-foreground"
      data-t3-agent-request={request.status}
      role="status"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <StatusIcon request={request} />
        <span className="min-w-0">
          {request.status === "sending"
            ? t("comments.t3Sending", { agent })
            : request.status === "working"
              ? t("comments.t3Working", { agent, thread })
              : request.status === "needs-you"
                ? t("comments.t3NeedsYou", { agent })
                : t("comments.t3Failed", {
                    agent,
                    reason: request.error ?? t("comments.t3FailedUnknown"),
                  })}
        </span>
        {request.t3ThreadLink && request.status !== "sending" ? (
          <a
            href={request.t3ThreadLink}
            className="inline-flex shrink-0 items-center gap-0.5 font-medium text-foreground underline-offset-2 hover:underline"
          >
            {t("comments.t3OpenInT3")}
            <IconExternalLink size={12} aria-hidden />
          </a>
        ) : null}
      </span>
      {active && unreachable ? (
        <span>{t("comments.t3Unreachable")}</span>
      ) : null}
    </div>
  );
}

function StatusIcon({ request }: { request: T3AgentRequest }) {
  if (request.status === "needs-you")
    return <IconHandStop size={13} className="shrink-0" aria-hidden />;
  if (request.status === "failed")
    return (
      <IconAlertCircle
        size={13}
        className="shrink-0 text-destructive"
        aria-hidden
      />
    );
  return (
    <IconLoader2 size={13} className="shrink-0 animate-spin" aria-hidden />
  );
}
