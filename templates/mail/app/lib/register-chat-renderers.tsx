import { registerActionChatRenderer } from "@agent-native/core/client/agentkit-chat";
import type { ToolRendererProps } from "@agent-native/core/client/agentkit-chat";
import { useT } from "@agent-native/core/client/i18n";
import { IconArchive, IconInbox } from "@tabler/icons-react";

export function MailAiFilterConfirmation({ context }: ToolRendererProps) {
  const t = useT();
  const result = context.resultJson;
  const changed =
    result && typeof result === "object" && !Array.isArray(result)
      ? (result as Record<string, unknown>).changed
      : undefined;

  if (
    context.toolName !== "apply-ai-filter" ||
    typeof changed !== "number" ||
    !Number.isSafeInteger(changed) ||
    changed < 1
  ) {
    return null;
  }

  if (context.args.mode === "filter") {
    return (
      <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
        <IconArchive
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span>{t("mail.aiFilter.filteredToast", { count: changed })}</span>
      </div>
    );
  }

  if (context.args.mode === "keep") {
    return (
      <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
        <IconInbox
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span>{t("mail.aiFilter.keptToast", { count: changed })}</span>
      </div>
    );
  }

  return null;
}

registerActionChatRenderer({
  id: "mail.ai-filter-confirmation",
  renderer: "mail.ai-filter-confirmation",
  Component: MailAiFilterConfirmation,
});
