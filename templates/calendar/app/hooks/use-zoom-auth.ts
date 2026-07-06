import { agentNativePath, oauthRedirectUri } from "@agent-native/core/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

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

// ---------------------------------------------------------------------------
// Shared Zoom OAuth-completion listener
//
// Every mounted useZoomStatus() call (one per rendered EventDetailPopover,
// plus Settings/CreateEventDialog/BookingLinksPage) needs to react to the
// OAuth popup finishing. Rather than each instance opening its own
// window "message" listener and BroadcastChannel, a single module-level pair
// attaches when the first subscriber joins and detaches when the last
// leaves, fanning the "connected" signal out to every subscriber.
// ---------------------------------------------------------------------------

const zoomAuthSubscribers = new Set<() => void>();
let zoomAuthChannel: BroadcastChannel | null = null;
let zoomAuthWindowListenerAttached = false;

function notifyZoomAuthSubscribers(): void {
  for (const subscriber of zoomAuthSubscribers) subscriber();
}

function onZoomAuthWindowMessage(event: MessageEvent): void {
  if (event.origin !== window.location.origin) return;
  if (event.data?.type === "agent-native:zoom-connected") {
    notifyZoomAuthSubscribers();
  }
}

function onZoomAuthChannelMessage(event: MessageEvent): void {
  if (event.data?.type === "agent-native:zoom-connected") {
    notifyZoomAuthSubscribers();
  }
}

function subscribeZoomAuthConnected(subscriber: () => void): () => void {
  if (zoomAuthSubscribers.size === 0) {
    window.addEventListener("message", onZoomAuthWindowMessage);
    zoomAuthWindowListenerAttached = true;
    if ("BroadcastChannel" in window) {
      zoomAuthChannel = new BroadcastChannel("agent-native-zoom-oauth");
      zoomAuthChannel.onmessage = onZoomAuthChannelMessage;
    }
  }
  zoomAuthSubscribers.add(subscriber);

  return () => {
    zoomAuthSubscribers.delete(subscriber);
    if (zoomAuthSubscribers.size === 0) {
      if (zoomAuthWindowListenerAttached) {
        window.removeEventListener("message", onZoomAuthWindowMessage);
        zoomAuthWindowListenerAttached = false;
      }
      zoomAuthChannel?.close();
      zoomAuthChannel = null;
    }
  };
}

export function useZoomStatus() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () =>
      queryClient.invalidateQueries({ queryKey: ["zoom-status"] });
    return subscribeZoomAuthConnected(refresh);
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
      const redirectUri = oauthRedirectUri("/_agent-native/zoom/callback");
      const authPath = agentNativePath(
        `/_agent-native/zoom/auth-url?redirect_uri=${encodeURIComponent(redirectUri)}&redirect=1`,
      );
      const popup = window.open(
        authPath,
        "_blank",
        "popup,width=520,height=720",
      );
      if (!popup) {
        window.location.assign(authPath);
        return { opened: "same-tab" as const };
      }
      return { opened: "popup" as const };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["zoom-status"] });

      const startedAt = Date.now();
      const pollId = window.setInterval(() => {
        queryClient.invalidateQueries({ queryKey: ["zoom-status"] });
        if (Date.now() - startedAt > 120_000) {
          window.clearInterval(pollId);
        }
      }, 2_000);
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
