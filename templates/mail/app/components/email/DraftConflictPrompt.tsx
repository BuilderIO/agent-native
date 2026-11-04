import type { ComposeState } from "@shared/types";
import { useEffect } from "react";

import { setDraftOverlapResolver } from "@/hooks/use-compose-state";
import { useDraftConflictPrompt } from "@/hooks/use-draft-conflict-prompt";

/** Answers save overlaps for every compose window in Mail's own layout. */
export function DraftConflictPrompt({
  drafts,
  onRestore,
}: {
  drafts: ComposeState[];
  onRestore: (draft: ComposeState) => void;
}) {
  const { resolveOverlap, prompt } = useDraftConflictPrompt(
    (restoreOnto, other) => {
      const current = drafts.find((draft) => draft.id === other.id);
      onRestore(current ? restoreOnto(current) : other);
    },
  );

  useEffect(() => {
    setDraftOverlapResolver(resolveOverlap);
    return () => setDraftOverlapResolver(undefined);
  }, [resolveOverlap]);

  return prompt;
}
