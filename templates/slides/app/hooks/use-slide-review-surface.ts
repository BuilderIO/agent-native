import { useOrgMembers } from "@agent-native/core/client/org";
import type { ReviewMention } from "@agent-native/core/review";
import { useMemo } from "react";

import {
  useSlideReviewAgent,
  type SlideReviewAgentController,
} from "./use-slide-review-agent";

export interface SlideReviewSurface {
  /** Org members a comment can `@` mention. */
  peopleMentionOptions: readonly ReviewMention[];
  agent: SlideReviewAgentController;
}

/** What every comment surface on a deck shares: who to mention and the agent. */
export function useSlideReviewSurface({
  deckId,
  canEdit,
}: {
  deckId: string | null;
  canEdit: boolean;
}): SlideReviewSurface {
  const { data: organization } = useOrgMembers();
  const peopleMentionOptions = useMemo<ReviewMention[]>(
    () =>
      (organization?.members ?? []).map((member) => ({
        label:
          member.name?.trim() || member.email.split("@")[0] || member.email,
        email: member.email,
      })),
    [organization?.members],
  );
  const agent = useSlideReviewAgent({ deckId, canAsk: canEdit });
  return { peopleMentionOptions, agent };
}
