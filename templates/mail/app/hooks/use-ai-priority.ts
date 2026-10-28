import { useActionMutation } from "@agent-native/core/client/hooks";
import type {
  AiPriorityEmail,
  AiPriorityFailure,
  AiPriorityScore,
} from "@shared/ai-priority";

export type AiPriorityResult = {
  scores: AiPriorityScore[];
  failures: AiPriorityFailure[];
  eligibleCount: number;
  evaluatedCount: number;
  failedCount: number;
  limit: number;
  model: { provider: "openai" | "jev"; model: string } | null;
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
