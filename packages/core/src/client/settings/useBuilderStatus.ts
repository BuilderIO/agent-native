import { agentNativePath } from "../api-path.js";
import { useState, useEffect, useCallback, useRef } from "react";
import { getCallbackOrigin } from "../frame.js";

export interface BuilderStatus {
  configured: boolean;
  builderEnabled: boolean;
  connectUrl: string;
  appHost: string;
  apiHost: string;
  publicKeyConfigured: boolean;
  privateKeyConfigured: boolean;
  userId?: string;
  orgName?: string;
  orgKind?: string;
  /**
   * Set when the OAuth callback ran but failed to persist credentials.
   * Surfaced as a one-shot row by the server so the connect-flow polling
   * can stop with a clear message instead of timing out at 5min.
   */
  connectError?: { message: string; at: number };
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
      const res = await fetch(agentNativePath("/_agent-native/builder/status"));
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
    function onVisibility() {
      if (document.visibilityState === "visible") fetchStatus();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    // Engine connect/disconnect actions (e.g. the Builder disconnect button)
    // dispatch this event so dependent cards refresh without a full reload.
    window.addEventListener("agent-engine:configured-changed", fetchStatus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(
        "agent-engine:configured-changed",
        fetchStatus,
      );
    };
  }, [fetchStatus]);

  return { status, loading, refetch: fetchStatus };
}

// ─── useBuilderConnectFlow ──────────────────────────────────────────────────
//
// Shared state machine for the "open Builder CLI-auth popup + poll
// /builder/status until credentials land" interaction. Replaces three
// near-duplicate inline implementations: `BuilderCliAuthMethod` in
// OnboardingPanel, `ConnectBuilderCard`, and `BuilderConnectCta` in
// AssistantChat. Each consumer supplies its own popup URL / completion
// behavior; the hook owns the polling + timeout + focus refresh.
//
// `popupUrl` is what we pass to `window.open`. The default
// `/_agent-native/builder/connect` is a server-side 302 to the real
// cli-auth URL — using it keeps the click handler synchronous so popup
// blockers don't downgrade the open to same-tab navigation. Pass an
// explicit `popupUrl` (e.g. the already-computed cli-auth URL) if your
// caller already has it in hand.

export interface BuilderConnectFlowOptions {
  /** URL to synchronously open on start(). Defaults to the 302 shortcut. */
  popupUrl?: string;
  /** Invoked after the status poll first sees `configured: true`. */
  onConnected?: (state: { orgName: string | null }) => void | Promise<void>;
}

export interface BuilderConnectFlow {
  configured: boolean;
  orgName: string | null;
  connecting: boolean;
  error: string | null;
  /**
   * True once the first `/builder/status` fetch has completed (successfully
   * or not). Consumers that accept an `initialConfigured` prop (e.g. agent
   * tool-call results rendered with server-side state) should treat
   * `configured`/`orgName` as authoritative only once this flips true —
   * otherwise the hook's starting `false` defaults would cause a flash
   * back to "Connect Builder" on first paint.
   */
  hasFetchedStatus: boolean;
  /** Open the popup and begin polling. Must be called from a user-gesture handler. */
  start: () => void;
}

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

export function useBuilderConnectFlow(
  opts: BuilderConnectFlowOptions = {},
): BuilderConnectFlow {
  const { popupUrl, onConnected } = opts;
  const [configured, setConfigured] = useState(false);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetchedStatus, setHasFetchedStatus] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  // Keep onConnected in a ref so start() doesn't need to re-create when the
  // caller passes an inline arrow function.
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    const origin = getCallbackOrigin() || window.location.origin;
    try {
      const r = await fetch(`${origin}/_agent-native/builder/status`);
      if (!r.ok) return null;
      return (await r.json()) as {
        configured: boolean;
        orgName?: string | null;
        connectError?: { message: string; at: number };
      };
    } catch {
      return null;
    }
  }, []);

  // Initial fetch + focus/visibility refresh so if the user completed the
  // flow in another tab (or a downgraded same-tab nav) we notice it. Also
  // listen for `agent-engine:configured-changed` so a Disconnect click in
  // Settings propagates to any connect-CTA cards rendered elsewhere in
  // the app without waiting for the next focus event.
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    const refresh = async () => {
      const s = await fetchStatus();
      if (cancelled || !mountedRef.current) return;
      // Flip `hasFetchedStatus` even when the fetch failed — the caller's
      // "use initial props until the hook has an answer" pattern wants to
      // stop waiting after we've tried, regardless of network outcome.
      setHasFetchedStatus(true);
      if (!s) return;
      setConfigured(!!s.configured);
      setOrgName(s.orgName ?? null);
    };
    refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("agent-engine:configured-changed", refresh);
    return () => {
      cancelled = true;
      mountedRef.current = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("agent-engine:configured-changed", refresh);
      stopPoll();
    };
  }, [fetchStatus, stopPoll]);

  const start = useCallback(() => {
    stopPoll();
    setConnecting(true);
    setError(null);

    // Open SYNCHRONOUSLY inside the caller's click handler — any await
    // before window.open lets the user-gesture token expire, which causes
    // popup blockers to block entirely or fall back to same-tab navigation.
    const origin = getCallbackOrigin() || window.location.origin;
    const url = popupUrl ?? `${origin}/_agent-native/builder/connect`;
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      // Fall through — polling still detects completion if the user
      // opens the URL themselves.
    }

    const started = Date.now();
    pollRef.current = setInterval(async () => {
      const s = await fetchStatus();
      if (!mountedRef.current) {
        stopPoll();
        return;
      }
      if (s?.configured) {
        stopPoll();
        setConfigured(true);
        const org = s.orgName ?? null;
        setOrgName(org);
        setConnecting(false);
        try {
          await onConnectedRef.current?.({ orgName: org });
        } catch {
          // Consumer's callback failed; we've already flipped the UI state
          // to connected. Swallow so we don't re-arm the flow.
        }
      } else if (s?.connectError?.message) {
        // OAuth callback ran but writeBuilderCredentials threw — surface the
        // real error instead of letting the user wait 5 minutes for timeout.
        stopPoll();
        setConnecting(false);
        setError(
          `Couldn't save Builder credentials: ${s.connectError.message}. Try again or contact support.`,
        );
      } else if (Date.now() - started > POLL_TIMEOUT_MS) {
        stopPoll();
        setConnecting(false);
        setError(
          "Didn't hear back from Builder in 5 minutes. Allow popups and try again.",
        );
      }
    }, POLL_INTERVAL_MS);
  }, [fetchStatus, popupUrl, stopPoll]);

  // Popup-side fast path: the error page postMessages us so we stop polling
  // immediately rather than waiting for the next 2s tick (and so we still
  // surface the error if the settings-row write also failed).
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; message?: string } | undefined;
      if (data?.type !== "builder-connect-error") return;
      if (typeof data.message !== "string" || !data.message) return;
      stopPoll();
      setConnecting(false);
      setError(`Couldn't save Builder credentials: ${data.message}.`);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [stopPoll]);

  return { configured, orgName, connecting, error, hasFetchedStatus, start };
}
