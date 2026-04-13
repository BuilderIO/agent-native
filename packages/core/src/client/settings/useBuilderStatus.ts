import { useState, useEffect, useCallback } from "react";

export interface BuilderStatus {
  configured: boolean;
  connectUrl: string;
  appHost: string;
  apiHost: string;
  publicKeyConfigured: boolean;
  privateKeyConfigured: boolean;
  userId?: string;
  orgName?: string;
  orgKind?: string;
}

/**
 * Fetches Builder connection status from /_agent-native/builder/status.
 * Re-fetches on window focus to detect post-redirect state changes.
 */
export function useBuilderStatus() {
  const [status, setStatus] = useState<BuilderStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/_agent-native/builder/status");
      if (!res.ok) {
        setStatus(null);
        return;
      }
      setStatus(await res.json());
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();

    function onFocus() {
      fetchStatus();
    }
    window.addEventListener("focus", onFocus);
    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") fetchStatus();
    });
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchStatus]);

  return { status, loading, refetch: fetchStatus };
}
