import { useT } from "@agent-native/core/client/i18n";
import {
  useSaveConflictPrompt,
  type SaveConflictPromptOptions,
} from "@agent-native/toolkit/app/save-conflict";
import type { ComposeState } from "@shared/types";

/** The one prompt for two writers changing the same field of a compose draft. */
export function useDraftConflictPrompt(
  onRestore: SaveConflictPromptOptions<ComposeState>["onRestore"],
) {
  const t = useT();
  return useSaveConflictPrompt<ComposeState>({
    record: "draft",
    describeField: (path) => {
      if (path === "to") return t("mail.compose.to");
      if (path === "cc") return t("mail.compose.cc");
      if (path === "bcc") return t("mail.compose.bcc");
      if (path === "subject") return t("mail.compose.subject");
      return null;
    },
    onRestore,
  });
}
