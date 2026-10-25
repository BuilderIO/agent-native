import { useT } from "@agent-native/core/client/i18n";
import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/use-action";
import {
  contextGroupColor,
  contextGroupLabel,
  ContextUsagePanelView,
  ContextUsageRingView,
  type ContextCompactState,
  type ContextUsageSegmentView,
} from "@agent-native/toolkit/context-ui";
import { useEffect, useState } from "react";

import {
  SYSTEM_CONTEXT_KIND,
  useThreadContextUsage,
} from "./use-thread-context-usage.js";

interface CompactionStatus {
  tokensUntilAutoCompact?: number;
}

interface CompactResult {
  status: "compacted" | "nothing-to-compact";
}

/**
 * The composer's context ring for one thread: usage of the selected model's
 * window, its breakdown by kind, and compaction. Renders nothing until the
 * thread has a measured model call that fills enough of the window to matter.
 */
export function ThreadContextRing({
  threadId,
  model,
  enabled = true,
}: {
  threadId?: string | null | undefined;
  /** The composer's selected model; its window is the denominator. */
  model?: string | undefined;
  /** False while the thread is a draft the server has not saved yet. */
  enabled?: boolean;
}) {
  const t = useT();
  const usage = useThreadContextUsage({ threadId, model, enabled });
  const [open, setOpen] = useState(false);
  const [compact, setCompact] = useState<ContextCompactState>({
    state: "idle",
  });
  const compactMutation = useActionMutation("context-compact");
  const compactionStatus = useActionQuery(
    "context-compaction-get",
    open && threadId ? { threadId } : undefined,
    { enabled: Boolean(open && threadId), staleTime: 5000 },
  ) as { data?: CompactionStatus; refetch?: () => unknown };

  useEffect(() => {
    setCompact({ state: "idle" });
  }, [threadId]);

  if (
    usage.status !== "ready" ||
    usage.usedTokens === undefined ||
    usage.windowTokens === undefined
  ) {
    return null;
  }

  const segments: ContextUsageSegmentView[] = usage.segments.map((segment) => ({
    kind: segment.kind,
    tokens: segment.tokens,
    label:
      segment.kind === SYSTEM_CONTEXT_KIND
        ? t("agentChat.contextRing.system", { defaultValue: "System" })
        : contextGroupLabel(segment.kind, t),
    colorClass: contextGroupColor(
      segment.kind === SYSTEM_CONTEXT_KIND ? "System · required" : segment.kind,
    ),
  }));

  const runCompact = () => {
    if (!threadId) return;
    setCompact({ state: "running" });
    compactMutation.mutate(
      { threadId },
      {
        onSuccess: (result: unknown) => {
          const status = (result as CompactResult | undefined)?.status;
          setCompact({
            state: "done",
            message:
              status === "nothing-to-compact"
                ? t("agentChat.contextRing.nothingToCompact", {
                    defaultValue:
                      "Everything in this thread is already compacted.",
                  })
                : t("agentChat.contextRing.compacted", {
                    defaultValue: "Compacted. Applies from the next message.",
                  }),
          });
          usage.refresh();
          void compactionStatus.refetch?.();
        },
        onError: (error: unknown) => {
          setCompact({
            state: "error",
            message:
              actionErrorMessage(error) ??
              t("agentChat.contextRing.compactFailed", {
                defaultValue: "Could not compact this thread.",
              }),
          });
        },
      },
    );
  };

  return (
    <ContextUsageRingView
      usedTokens={usage.usedTokens}
      windowTokens={usage.windowTokens}
      open={open}
      onOpenChange={setOpen}
      translate={t}
    >
      <ContextUsagePanelView
        usedTokens={usage.usedTokens}
        windowTokens={usage.windowTokens}
        segments={segments}
        tokensUntilAutoCompact={compactionStatus.data?.tokensUntilAutoCompact}
        compact={compact}
        onCompact={threadId ? runCompact : undefined}
        translate={t}
      />
    </ContextUsageRingView>
  );
}
