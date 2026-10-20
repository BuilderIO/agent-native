import { useActionQuery } from "@agent-native/core/client/hooks";

export function useStoryboardDesignTargetPreflight(open: boolean) {
  const query = useActionQuery(
    "check-replay-storyboard-design-target",
    {},
    {
      enabled: open,
      retry: false,
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: false,
      gcTime: 0,
    },
  );
  const settled = !query.isLoading && !query.isFetching;

  return {
    code: query.data?.code,
    failureCode: query.data?.failureCode,
    targetClass: query.data?.targetClass,
    ready: open && settled && !query.error && query.data?.code === "ready",
    unavailable:
      open && settled && (Boolean(query.error) || query.data?.code !== "ready"),
  };
}
