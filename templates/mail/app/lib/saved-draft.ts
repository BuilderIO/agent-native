import type { ComposeState, EmailMessage } from "@shared/types";

export function savedEmailDraftMetadata(
  email: Pick<EmailMessage, "id" | "accountEmail">,
): Pick<
  ComposeState,
  | "accountEmail"
  | "savedDraftId"
  | "savedDraftBackend"
  | "savedDraftAccountEmail"
> {
  return {
    accountEmail: email.accountEmail,
    savedDraftId: email.id,
    savedDraftBackend: email.accountEmail ? "gmail" : "local",
    savedDraftAccountEmail: email.accountEmail,
  };
}
