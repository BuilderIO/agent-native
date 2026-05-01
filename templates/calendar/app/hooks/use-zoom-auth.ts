import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { agentNativePath } from "@agent-native/core/client";

export interface ZoomAuthStatus {
  connected: boolean;
  configured: boolean;
  accounts: Array<{ id: string; email?: string; displayName?: string }>;
}

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) {
    let message = `${input} -> ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body.message || body.error || message;
    } catch {
      // fall through with status text
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function useZoomStatus() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () =>
      queryClient.invalidateQueries({ queryKey: ["zoom-status"] });

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "agent-native:zoom-connected") refresh();
    };

    window.addEventListener("message", onMessage);

    let channel: BroadcastChannel | null = null;
    if ("BroadcastChannel" in window) {
      channel = new BroadcastChannel("agent-native-zoom-oauth");
      channel.onmessage = (event) => {
        if (event.data?.type === "agent-native:zoom-connected") refresh();
      };
    }

    return () => {
      window.removeEventListener("message", onMessage);
      channel?.close();
    };
  }, [queryClient]);

  return useQuery<ZoomAuthStatus>({
    queryKey: ["zoom-status"],
    queryFn: () =>
      fetchJson<ZoomAuthStatus>(agentNativePath("/_agent-native/zoom/status")),
    staleTime: 30_000,
  });
}

/**
 * Kick off the Zoom OAuth flow by navigating to the auth URL. Uses a
 * mutation (not a query) so the flow only starts when the user clicks
 * Connect, not on mount.
 */
export function useConnectZoom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { getCallbackOrigin } = await import("@agent-native/core/client");
      const redirectUri = `${getCallbackOrigin()}${agentNativePath(
        "/_agent-native/zoom/callback",
      )}`;
      const { url } = await fetchJson<{ url: string }>(
        agentNativePath(
          `/_agent-native/zoom/auth-url?redirect_uri=${encodeURIComponent(redirectUri)}`,
        ),
      );
      const popup = window.open(url, "_blank");
      if (!popup) {
        throw new Error("Your browser blocked the Zoom connection popup.");
      }
      try {
        popup.opener = null;
      } catch {
        // best-effort hardening; BroadcastChannel still updates this tab
      }
      popup.focus();
    },
    onSuccess: () => {
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["zoom-status"] });
      }, 1000);
    },
  });
}

export function useDisconnectZoom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchJson(agentNativePath("/_agent-native/zoom/disconnect"), {
        method: "POST",
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["zoom-status"] }),
  });
}
