export function isClaimedSlackReactionName(
  name: string | null | undefined,
): boolean {
  const normalized = name?.trim().toLowerCase();
  return normalized === "eyes" || normalized === "robot_face";
}

export function dispatchSkipPreservesItemStatus(status: string): boolean {
  return status === "automation_started" || status === "evidence_ready";
}

export function slackFeedbackLeavesReviewWindow(input: {
  status: string;
  slackReactionName?: string | null;
}): boolean {
  return (
    dispatchSkipPreservesItemStatus(input.status) ||
    isClaimedSlackReactionName(input.slackReactionName)
  );
}

export function dispatchSkipStatusWrite(status: string): {
  nextStatus: "needs_manual" | null;
  needsManual: boolean;
  statusPreserved: boolean;
} {
  if (dispatchSkipPreservesItemStatus(status)) {
    return {
      nextStatus: null,
      needsManual: false,
      statusPreserved: true,
    };
  }
  return {
    nextStatus: "needs_manual",
    needsManual: true,
    statusPreserved: false,
  };
}
