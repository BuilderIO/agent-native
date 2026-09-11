import { callAction, useChangeVersions } from "@agent-native/core/client/hooks";
import type {
  AiFilterDecision,
  AiFilterState,
  AiFilterTarget,
} from "@shared/ai-filter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useAiFilter() {
  const changeVersion = useChangeVersions(["settings", "action"]);
  return useQuery<AiFilterState>({
    queryKey: ["ai-filter", changeVersion],
    queryFn: () => callAction("get-ai-filter", {}, { method: "GET" }),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
}

type AiFilterSettingsPatch = Partial<
  Pick<
    AiFilterState,
    "enabled" | "autoFilter" | "autoFilterThreshold" | "suggestionThreshold"
  >
>;

export function useManageAiFilter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      mode: "filter" | "keep" | "settings";
      targets?: AiFilterTarget[];
      comment?: string;
      settings?: AiFilterSettingsPatch;
    }) => callAction("apply-ai-filter", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ai-filter"] });
      void queryClient.invalidateQueries({ queryKey: ["automations"] });
      void queryClient.invalidateQueries({ queryKey: ["emails"] });
      void queryClient.invalidateQueries({ queryKey: ["labels"] });
    },
  });
}

export function latestAiFilterDecisions(
  state: AiFilterState | undefined,
): AiFilterDecision[] {
  return state ? [...state.decisions].reverse() : [];
}
