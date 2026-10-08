import { useState, useEffect, useCallback } from "react";

import { agentNativePath } from "./api-path.js";

interface CodeModeState {
  devMode: boolean;
  canToggle: boolean;
}

let cached: CodeModeState | null = null;
let fetchPromise: Promise<CodeModeState> | null = null;
let listeners: Set<(state: CodeModeState) => void> = new Set();

function notifyListeners(state: CodeModeState) {
  cached = state;
  listeners.forEach((fn) => fn(state));
}

function isLocalhostHostname(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

function fetchCodeMode(apiBase: string): Promise<CodeModeState> {
  if (!fetchPromise) {
    fetchPromise = fetch(`${apiBase}/mode`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      })
      .then((data: CodeModeState) => {
        cached = data;
        return cached;
      })
      .catch(() => {
        cached = isLocalhostHostname()
          ? { devMode: true, canToggle: true }
          : { devMode: false, canToggle: false };
        fetchPromise = null;
        return cached;
      });
  }
  return fetchPromise;
}

function useCodeModeInternal(apiBase: string): {
  codeMode: boolean;
  canToggle: boolean;
  isLoading: boolean;
  setCodeMode: (codeMode: boolean) => Promise<void>;
} {
  const [state, setState] = useState<CodeModeState>(
    cached ?? { devMode: false, canToggle: false },
  );
  const [isLoading, setIsLoading] = useState(cached === null);

  useEffect(() => {
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
    void fetchCodeMode(apiBase).then((val) => {
      setState(val);
      setIsLoading(false);
    });
  }, [apiBase]);

  const setCodeMode = useCallback(
    async (codeMode: boolean) => {
      const prev = cached;
      notifyListeners({
        devMode: codeMode,
        canToggle: prev?.canToggle ?? true,
      });
      try {
        const res = await fetch(`${apiBase}/mode`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ devMode: codeMode }),
        });
        if (res.ok) {
          const data: CodeModeState = await res.json();
          notifyListeners(data);
        } else if (prev) {
          notifyListeners(prev);
        }
      } catch {
        if (prev) notifyListeners(prev);
      }
    },
    [apiBase],
  );

  return {
    codeMode: state.devMode,
    canToggle: state.canToggle,
    isLoading,
    setCodeMode,
  };
}

export function useCodeMode(
  apiBase = agentNativePath("/_agent-native/agent-chat"),
): {
  isCodeMode: boolean;
  canToggle: boolean;
  isLoading: boolean;
  setCodeMode: (codeMode: boolean) => Promise<void>;
} {
  const { codeMode, canToggle, isLoading, setCodeMode } =
    useCodeModeInternal(apiBase);
  return { isCodeMode: codeMode, canToggle, isLoading, setCodeMode };
}

/**
 * @deprecated Use {@link useCodeMode} instead. The agent-capability "dev mode"
 * was renamed to "Code mode" to disambiguate it from environment/NODE_ENV dev
 * mode. This alias preserves the old `{ isDevMode, canToggle, isLoading,
 * setDevMode }` shape so existing callers keep working; it delegates to the same
 * shared internal state as `useCodeMode`.
 */
export function useDevMode(
  apiBase = agentNativePath("/_agent-native/agent-chat"),
): {
  isDevMode: boolean;
  canToggle: boolean;
  isLoading: boolean;
  setDevMode: (devMode: boolean) => Promise<void>;
} {
  const { codeMode, canToggle, isLoading, setCodeMode } =
    useCodeModeInternal(apiBase);
  return {
    isDevMode: codeMode,
    canToggle,
    isLoading,
    setDevMode: setCodeMode,
  };
}
