import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import {
  registerActionChatRenderer,
  type ToolRendererProps,
} from "@agent-native/core/client/agentkit-chat";
import { ActionCard } from "@agent-native/core/client/chat";
import { useT } from "@agent-native/core/client/i18n";
import { IconBulb } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

function insightResult(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  return typeof result.title === "string" &&
    typeof result.detail === "string" &&
    typeof result.followUpPrompt === "string"
    ? {
        title: result.title,
        detail: result.detail,
        followUpPrompt: result.followUpPrompt,
      }
    : null;
}

export function ResponseInsightCard({ context }: ToolRendererProps) {
  const t = useT();
  const insight = insightResult(context.resultJson);
  if (!insight) return null;

  return (
    <ActionCard
      icon={<IconBulb aria-hidden="true" className="size-4" />}
      title={insight.title}
      detail={insight.detail}
      status={t("agent.topSignal")}
      className="border-0 bg-transparent p-0 shadow-none"
      action={
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="transition-none active:scale-100"
          onClick={() =>
            sendToAgentChat({
              message: insight.followUpPrompt,
              submit: false,
              chatTarget: "local",
            })
          }
        >
          {t("agent.draftFollowUp")}
        </Button>
      }
    />
  );
}

registerActionChatRenderer({
  id: "forms.response-insight",
  renderer: "forms.response-insight",
  Component: ResponseInsightCard,
});
