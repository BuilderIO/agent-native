import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface ZoomAuthStatus {
  connected: boolean;
  configured: boolean;
  accounts: Array<{ id: string; email?: string; displayName?: string }>;
}

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) throw new Error(`${input} → ${res.status}`);
  return (await res.json()) as T;
}

export function useZoomStatus() {
  return useQuery<ZoomAuthStatus>({
    queryKey: ["zoom-status"],
    queryFn: () => fetchJson<ZoomAuthStatus>("/_agent-native/zoom/status"),
    staleTime: 30_000,
  });
}

/**
 * Kick off the Zoom OAuth flow by navigating to the auth URL. Uses a
 * mutation (not a query) so the flow only starts when the user clicks
 * Connect, not on mount.
 */
export function useConnectZoom() {
  return useMutation({
    mutationFn: async () => {
      const { getCallbackOrigin } = await import("@agent-native/core/client");
      const redirectUri = `${getCallbackOrigin()}/_agent-native/zoom/callback`;
      const { url } = await fetchJson<{ url: string }>(
        `/_agent-native/zoom/auth-url?redirect_uri=${encodeURIComponent(redirectUri)}`,
      );
      location.href = url;
    },
  });
}

export function useDisconnectZoom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchJson("/_agent-native/zoom/disconnect", { method: "POST" }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["zoom-status"] }),
  });
}
