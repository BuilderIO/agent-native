import { useQuery } from "@tanstack/react-query";

import { agentNativePath } from "./api-path.js";
import { useChangeVersion } from "./use-change-version.js";

interface DemoModeStatusResponse {
  enabled?: boolean;
  forced?: boolean;
}

export interface DemoModeStatus {
  enabled: boolean;
  forced: boolean;
  isLoading: boolean;
}

const DEMO_STATUS_URL = agentNativePath("/_agent-native/demo/status");

/**
 * Reads the effective Demo mode status for the current user. The shared
 * change-version stream advances after Demo mode application state changes,
 * so mounted consumers refresh without polling or duplicating the route call.
 */
export function useDemoModeStatus(): DemoModeStatus {
  const demoModeVersion = useChangeVersion("app-state:demo-mode");

  const { data, isLoading } = useQuery({
    queryKey: ["agent-native", "demo-mode", demoModeVersion],
    queryFn: async () => {
      const res = await fetch(DEMO_STATUS_URL, {
        credentials: "same-origin",
      });
      if (!res.ok) return null;
      return (await res.json()) as DemoModeStatusResponse | null;
    },
    staleTime: Infinity,
  });

  return {
    enabled: data?.enabled === true,
    forced: data?.forced === true,
    isLoading,
  };
}
