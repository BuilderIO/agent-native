import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import type { HostEnvironmentStatus } from "../../shared/host-environment.js";
import { agentNativePath } from "../api-path.js";

/**
 * "loading" and "unavailable" are distinct from a real value on purpose: a
 * dropped fetch must never render as "Not set" for a key the host may well
 * have configured. Callers switch on `state`, never on a fabricated default.
 */
export type HostEnvironmentStatusResult =
  | { state: "loading" }
  | { state: "ready"; value: HostEnvironmentStatus }
  | { state: "unavailable" };

export async function fetchHostEnvironmentStatus(): Promise<HostEnvironmentStatusResult> {
  try {
    const response = await fetch(
      agentNativePath("/_agent-native/host-environment"),
      { credentials: "include" },
    );
    if (!response.ok) return { state: "unavailable" };
    const value = (await response.json()) as HostEnvironmentStatus;
    return { state: "ready", value };
  } catch {
    return { state: "unavailable" };
  }
}

/**
 * Host environment values only change on redeploy/restart, but the Settings
 * UI still needs to notice a save this session (env-vars, S3 config) that may
 * have changed what the host reports, and a stale read from before sign-in.
 */
export function useHostEnvironmentStatus(): HostEnvironmentStatusResult {
  const query = useQuery({
    queryKey: ["agent-native", "host-environment"],
    queryFn: fetchHostEnvironmentStatus,
    staleTime: 30_000,
  });

  useEffect(() => {
    const refresh = () => void query.refetch();
    window.addEventListener("agent-engine:configured-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("agent-engine:configured-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return query.data ?? { state: "loading" };
}
