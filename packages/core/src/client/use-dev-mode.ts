import { useState, useEffect, useCallback } from "react";

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
        cached = { devMode: false, canToggle: false };
        return cached;
      });
  }
  return fetchPromise;
}

/**
 * Returns whether the app is running in dev mode and whether mode can be toggled.
 * Fetches /_agent-native/agent-chat/mode on first call, then stays in sync via setDevMode.
 */
export function useDevMode(apiBase = "/_agent-native/agent-chat"): {
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
