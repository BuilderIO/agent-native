import { useState, useEffect, useCallback } from "react";
import { agentNativePath } from "./api-path.js";

interface DevModeState {
  devMode: boolean;
  canToggle: boolean;
}

let cached: DevModeState | null = null;
let fetchPromise: Promise<DevModeState> | null = null;
let listeners: Set<(state: DevModeState) => void> = new Set();

function notifyListeners(state: DevModeState) {
  cached = state;
  listeners.forEach((fn) => fn(state));
}

function isLocalhostHostname(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

function fetchDevMode(apiBase: string): Promise<DevModeState> {
  if (!fetchPromise) {
    fetchPromise = fetch(`${apiBase}/mode`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      })
      .then((data: DevModeState) => {
        cached = data;
        return cached;
      })
      .catch(() => {
        // If the server isn't reachable (503 during boot, connection refused,
        // etc.) but we're clearly on localhost, assume dev mode so the CLI
        // tab and dev toggle still work. Without this, a transient server
        // error permanently disables dev features in the sidebar.
        cached = isLocalhostHostname()
          ? { devMode: true, canToggle: true }
          : { devMode: false, canToggle: false };
        // Null the in-flight promise so the next call retries the fetch
        // and we can pick up the real answer once the server is back.
        fetchPromise = null;
        return cached;
      });
  }
  return fetchPromise;
}

/**
 * Returns whether the app is running in dev mode and whether mode can be toggled.
 * Fetches /_agent-native/agent-chat/mode on first call, then stays in sync via setDevMode.
 */
export function useDevMode(
  apiBase = agentNativePath("/_agent-native/agent-chat"),
): {
  isDevMode: boolean;
  canToggle: boolean;
  isLoading: boolean;
  setDevMode: (devMode: boolean) => Promise<void>;
} {
  const [state, setState] = useState<DevModeState>(
    cached ?? { devMode: false, canToggle: false },
  );
  const [isLoading, setIsLoading] = useState(cached === null);

  useEffect(() => {
    // Subscribe to changes from other hook instances
    listeners.add(setState);
    return () => {
      listeners.delete(setState);
    };
  }, []);

  useEffect(() => {
    if (cached !== null) {
      setState(cached);
      setIsLoading(false);
      return;
    }
    fetchDevMode(apiBase).then((val) => {
      setState(val);
      setIsLoading(false);
    });
  }, [apiBase]);

  const setDevMode = useCallback(
    async (devMode: boolean) => {
      // Optimistic update — apply immediately, then confirm with server
      notifyListeners({ devMode, canToggle: true });
      const res = await fetch(`${apiBase}/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ devMode }),
      });
      if (res.ok) {
        const data: DevModeState = await res.json();
        notifyListeners(data);
      }
    },
    [apiBase],
  );

  return {
    isDevMode: state.devMode,
    canToggle: state.canToggle,
    isLoading,
    setDevMode,
  };
}
