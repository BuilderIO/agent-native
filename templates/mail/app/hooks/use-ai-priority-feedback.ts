import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useActionMutation } from "@agent-native/core/client/hooks";

export type PriorityFeedbackVote = {
  emailId: string;
  accountEmail?: string;
  decision: "important" | "not-important";
  sender?: string;
  subject?: string;
  createdAt: number;
};

export function askAgentToDraftImportanceRules(
  message: string,
  recentVotes: PriorityFeedbackVote[],
) {
  sendToAgentChat({
    message,
    context: `Review these recent importance votes and propose draft importance or auto-archive rules. Explain each proposed condition and wait for explicit confirmation before creating or changing any rule.\n\n${JSON.stringify(recentVotes)}`,
    submit: true,
    type: "content",
    chatTarget: "local",
    openSidebar: true,
  });
}

export function useAiPriorityFeedback() {
  return useActionMutation<
    {
      saved: boolean;
      decision: "important" | "not-important";
      totalVotes: number;
      recentVotes: PriorityFeedbackVote[];
    },
    {
      emailId: string;
      accountEmail?: string;
      decision: "important" | "not-important";
      sender?: string;
      subject?: string;
    }
  >("record-ai-priority-feedback", { skipActionQueryInvalidation: true });
}
