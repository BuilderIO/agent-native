import {
  registerActionChatRenderer,
  type ToolRendererProps,
} from "@agent-native/core/client/agentkit-chat";
import { useT } from "@agent-native/core/client/i18n";
import { IconArrowUpRight, IconMail } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

type MailDeepLinkResult =
  | { kind: "absent" }
  | { kind: "safe"; url: string }
  | { kind: "invalid" };

function mailDeepLink(value: unknown): MailDeepLinkResult {
  if (typeof value !== "string" || !value.trim()) return { kind: "absent" };
  try {
    const url = new URL(value, "https://mail.agent-native.com");
    if (
      url.origin === "https://mail.agent-native.com" &&
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.pathname === "/_agent-native/open"
    ) {
      return { kind: "safe", url: value };
    }
  } catch {
    return { kind: "invalid" };
  }
  return { kind: "invalid" };
}

export function MailDraftCreated({ context }: ToolRendererProps) {
  const t = useT();
  if (context.toolName !== "manage-draft" || context.args.action !== "create") {
    return null;
  }

  const result = asRecord(context.resultJson);
  const draft = asRecord(result?.draft);
  const subject = text(context.args.subject) ?? text(draft?.subject);
  const recipient = text(context.args.to) ?? text(draft?.to);
  const deepLinkResult = mailDeepLink(result?.deepLink);
  const deepLink =
    deepLinkResult.kind === "safe" ? deepLinkResult.url : undefined;
  if (!subject && !recipient && !deepLink) return null;

  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
        <IconMail aria-hidden="true" className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {subject ?? t("mail.compose.newDraft", { defaultValue: "New draft" })}
        </p>
        {recipient ? (
          <p className="truncate text-xs text-muted-foreground">
            <span className="font-medium">
              {t("mail.compose.to", { defaultValue: "To" })}
            </span>{" "}
            {recipient}
          </p>
        ) : null}
      </div>
      {deepLink ? (
        <Button asChild size="sm" variant="outline" className="shrink-0">
          <a href={deepLink} rel="noreferrer" target="_blank">
            {t("mail.compose.openInMail", { defaultValue: "Open in Mail" })}
            <IconArrowUpRight aria-hidden="true" className="size-3.5" />
          </a>
        </Button>
      ) : null}
    </div>
  );
}

registerActionChatRenderer({
  id: "mail.draft-created",
  renderer: "mail.draft-created",
  Component: MailDraftCreated,
});
