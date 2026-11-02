import { useT } from "@agent-native/core/client/i18n";
import { useSaveConflictPrompt } from "@agent-native/toolkit/app/save-conflict";
import type { ComposeState } from "@shared/types";
import { useEffect } from "react";

import { setDraftOverlapResolver } from "@/hooks/use-compose-state";

/** The one prompt for two writers changing the same field of a compose draft. */
export function DraftConflictPrompt({
  drafts,
  onRestore,
}: {
  drafts: ComposeState[];
  onRestore: (draft: ComposeState) => void;
}) {
  const t = useT();
  const { resolveOverlap, prompt } = useSaveConflictPrompt<ComposeState>({
    record: "draft",
    describeField: (path) => {
      if (path === "to") return t("mail.compose.to");
      if (path === "cc") return t("mail.compose.cc");
      if (path === "bcc") return t("mail.compose.bcc");
      if (path === "subject") return t("mail.compose.subject");
      return null;
    },
    onRestore: (restoreOnto, other) => {
      const current = drafts.find((draft) => draft.id === other.id);
      onRestore(current ? restoreOnto(current) : other);
    },
  });

  useEffect(() => {
    setDraftOverlapResolver(resolveOverlap);
    return () => setDraftOverlapResolver(undefined);
  }, [resolveOverlap]);

  return prompt;
}
