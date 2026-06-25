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
        // If the server isn't reachable (503 during boot, connection refused,
        // etc.) but we're clearly on localhost, assume Code mode is on so the
        // CLI tab and Code mode toggle still work. Without this, a transient
        // server error permanently disables code features in the sidebar.
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
 * Shared internal state machine backing both `useCodeMode` (primary) and the
 * deprecated `useDevMode` alias. Returns the raw `{ codeMode, canToggle,
 * isLoading, setCodeMode }` shape; the public hooks adapt the field names.
 *
 * The `/mode` endpoint and its `devMode` payload key are unchanged for
 * back-compat — only the user-facing concept name moved from "dev mode" to
 * "Code mode".
 */
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
    fetchCodeMode(apiBase).then((val) => {
      setState(val);
      setIsLoading(false);
    });
  }, [apiBase]);

  const setCodeMode = useCallback(
    async (codeMode: boolean) => {
      // Optimistic update — apply immediately, then confirm with server.
      // The endpoint still speaks `devMode` for back-compat. Snapshot the
      // prior state so we can roll back if the server rejects or the request
      // throws; otherwise a failed toggle would leave every subscriber stuck
      // showing the wrong mode until a full reload re-fetches `/mode`.
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

/**
 * Whether the agent is in "Code mode" — the capability toggle that lets the
 * agent run shell/file/raw-DB tools and edit the app's own source code. This is
 * distinct from environment dev mode (NODE_ENV / Vite).
 *
 * Fetches `/_agent-native/agent-chat/mode` on first call, then stays in sync via
 * `setCodeMode`. The endpoint, its `devMode` payload key, the `AGENT_MODE` env
 * var, and the `agent-chat.mode` settings key are unchanged for back-compat.
 */
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
