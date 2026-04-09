import { useActionQuery, useActionMutation } from "@agent-native/core/client";

export function useTransitions(issueKey: string | undefined) {
  return useActionQuery<any>(
    "get-transitions",
    issueKey ? { key: issueKey } : undefined,
    {
      enabled: !!issueKey,
      staleTime: 30_000,
    },
  );
}

export function useTransitionIssue() {
  const mutation = useActionMutation<
    any,
    { key: string; transitionId: string }
  >("transition-issue");

  return {
    ...mutation,
    mutate: (
      vars: { issueKey: string; transitionId: string },
      options?: Parameters<typeof mutation.mutate>[1],
    ) =>
      mutation.mutate(
        { key: vars.issueKey, transitionId: vars.transitionId },
        options,
      ),
    mutateAsync: (
      vars: { issueKey: string; transitionId: string },
      options?: Parameters<typeof mutation.mutateAsync>[1],
    ) =>
      mutation.mutateAsync(
        { key: vars.issueKey, transitionId: vars.transitionId },
        options,
      ),
  };
}
