import {
  chatModelSelectionStorageKey,
  useChatModels,
} from "@agent-native/core/client/agent-chat";
import type { ReviewMention } from "@agent-native/core/review/types";
import { useCallback, useMemo } from "react";

import {
  resolveReviewAgentMention,
  reviewAgentMentionOption,
  reviewAgentSelections,
  type ReviewAgentSelection,
} from "./review-agent.js";
import type { ReviewMentionOption } from "./ReviewMentionPicker.js";

export interface ReviewAgentMentions {
  /** One `@` option per configured model; empty until the model list loads. */
  mentionOptions: readonly ReviewMentionOption[];
  /** The live selection a stored chip names, or null once that model is gone. */
  resolveMention: (mention: ReviewMention) => ReviewAgentSelection | null;
}

/**
 * The agents a comment composer can tag, from the models this workspace has
 * connected. `scope` keeps each app's last-used model separate from its chat.
 */
export function useReviewAgentMentions({
  scope,
  enabled,
}: {
  scope: string;
  enabled: boolean;
}): ReviewAgentMentions {
  const { availableModels, selectedModel, selectedEngine, selectionReady } =
    useChatModels({
      enabled,
      storageKey: chatModelSelectionStorageKey(scope),
      unavailableSelectionPolicy: "require-explicit",
    });
  const selections = useMemo(
    () =>
      reviewAgentSelections(
        availableModels.filter((group) => group.configured),
        { model: selectedModel, engine: selectedEngine },
      ),
    [availableModels, selectedEngine, selectedModel],
  );
  const ready = enabled && selectionReady && selections.length > 0;
  const mentionOptions = useMemo(
    () => (ready ? selections.map(reviewAgentMentionOption) : []),
    [ready, selections],
  );
  const resolveMention = useCallback(
    (mention: ReviewMention) => resolveReviewAgentMention(selections, mention),
    [selections],
  );
  return { mentionOptions, resolveMention };
}
