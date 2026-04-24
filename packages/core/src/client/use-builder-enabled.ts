import { useQuery } from "@tanstack/react-query";

/**
 * Tri-state:
 *   - `null`   → still loading (env-status hasn't resolved yet)
 *   - `true`   → `ENABLE_BUILDER` is configured, show Builder flows
 *   - `false`  → not configured, hide Builder flows / show waitlist
 *
 * Callers must handle `null` (render skeleton / nothing) rather than
 * defaulting to `false` — otherwise Builder-enabled deployments briefly
 * flash the waitlist CTA before the fetch settles, and a user could
 * click "Join waitlist" when Connect Builder.io would have worked.
 *
 * Backed by React Query so multiple consumers (OnboardingPanel,
 * template-specific setup cards, etc.) share a single in-flight request
 * and a cached answer — no duplicate fetches to /_agent-native/env-status.
 */
export function useBuilderEnabled(): boolean | null {
  const { data, isLoading, isError } = useQuery<boolean>({
    queryKey: ["env-status", "ENABLE_BUILDER"],
    queryFn: async () => {
      const res = await fetch("/_agent-native/env-status");
      if (!res.ok) return false;
      const keys = (await res.json()) as Array<{
        key: string;
        configured: boolean;
      }>;
      return !!keys.find((k) => k.key === "ENABLE_BUILDER")?.configured;
    },
    staleTime: 30_000,
    retry: false,
  });
  if (isLoading) return null;
  if (isError) return false;
  return data ?? null;
}
