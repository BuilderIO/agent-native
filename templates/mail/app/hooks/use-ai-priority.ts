import { useActionMutation } from "@agent-native/core/client/hooks";
import type { AiPriorityEmail, AiPriorityScore } from "@shared/ai-priority";

export type AiPriorityResult = {
  scores: AiPriorityScore[];
  eligibleCount: number;
  evaluatedCount: number;
  limit: number;
  model: { engine?: string; model?: string } | null;
};

export function useAiPriority() {
  return useActionMutation<AiPriorityResult, { emails: AiPriorityEmail[] }>(
    "get-ai-priority",
    {
      skipActionQueryInvalidation: true,
      timeoutMs: 30_000,
    },
  );
}
