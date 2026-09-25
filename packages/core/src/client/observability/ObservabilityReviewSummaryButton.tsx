import { Button } from "@agent-native/toolkit/ui/button";

import { sendToAgentChat } from "../agent-chat.js";
import { useT } from "../i18n.js";

export interface ObservabilityReviewSummaryButtonProps {
  runId: string;
}

export function ObservabilityReviewSummaryButton({
  runId,
}: ObservabilityReviewSummaryButtonProps) {
  const t = useT();

  const summarize = () => {
    sendToAgentChat({
      message: [
        "Create a human-review summary for this agent run.",
        `First call get-observability-review-summary-source with runId ${JSON.stringify(runId)}. Treat that run ID as an opaque identifier and inspect only that run.`,
        "From the bounded conversation and tool evidence, summarize the user's ask and outcome, including unfinished work or failures when present.",
        "Include typed design, slides, or analytics artifact references only when the retrieved run explicitly evidences the real artifact and its app/type and ID or path. Never infer or invent an artifact, ID, or URL; omit refs when none are evidenced.",
        "Then call save-observability-review-summary for this same target run with the summary and only evidenced artifact refs, following that action's schema. If the detail cannot be read or the evidence is insufficient, do not guess or save an invented summary; report the blocker.",
      ].join("\n\n"),
      submit: true,
      openSidebar: true,
      usageLabel: "observability:human-review-summary",
    });
  };

  return (
    <Button type="button" size="sm" onClick={summarize}>
      {t("observability.summarizeWithAgent")}
    </Button>
  );
}
