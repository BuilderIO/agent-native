import { registerActionChatRenderer } from "@agent-native/core/client/agentkit-chat";
import type { ToolRendererProps } from "@agent-native/core/client/agentkit-chat";
import { useT } from "@agent-native/core/client/i18n";
import { IconExternalLink, IconFilter } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function gmailFiltersUrl(accountEmail: string): string {
  const url = new URL("https://mail.google.com/mail/");
  url.searchParams.set("authuser", accountEmail);
  url.hash = "settings/filters";
  return url.toString();
}

export function MailGmailFilterConfirmation({ context }: ToolRendererProps) {
  const t = useT();
  const result = asRecord(context.resultJson);
  const filter = asRecord(result?.filter);
  const operation = context.args.operation;

  if (
    context.toolName !== "manage-gmail-filters" ||
    context.isRunning ||
    (operation !== "create" && operation !== "replace") ||
    result?.ok !== true ||
    typeof result.message !== "string" ||
    typeof result.accountEmail !== "string" ||
    !result.accountEmail ||
    typeof filter?.id !== "string" ||
    !filter.id ||
    typeof filter.criteriaSummary !== "string" ||
    typeof filter.actionSummary !== "string"
  ) {
    return null;
  }

  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
        <IconFilter aria-hidden="true" className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {filter.criteriaSummary}
        </p>
        <p
          className="truncate text-xs text-muted-foreground"
          title={`${filter.actionSummary} · ${result.message}`}
        >
          {filter.actionSummary} · {result.message}
        </p>
      </div>
      <Button asChild className="shrink-0" size="sm" variant="outline">
        <a
          href={gmailFiltersUrl(result.accountEmail)}
          rel="noreferrer"
          target="_blank"
        >
          {t("mail.gmailFilters.title", { defaultValue: "Gmail Filters" })}
          <IconExternalLink aria-hidden="true" className="size-3.5" />
        </a>
      </Button>
    </div>
  );
}

registerActionChatRenderer({
  id: "mail.gmail-filter-confirmation",
  renderer: "mail.gmail-filter-confirmation",
  Component: MailGmailFilterConfirmation,
});
