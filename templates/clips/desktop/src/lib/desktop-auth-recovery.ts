import type { AuthCheckResult } from "./desktop-auth-session";

const RETRY_DELAYS_MS = [1000, 3000, 10_000, 30_000] as const;

interface RecoveryOptions {
  isVisible?: () => boolean;
  subscribeToResume?: (listener: () => void) => () => void;
}

function subscribeToWebViewResume(listener: () => void): () => void {
  const onVisibilityChange = () => listener();
  window.addEventListener("focus", listener);
  document.addEventListener("visibilitychange", onVisibilityChange);
  return () => {
    window.removeEventListener("focus", listener);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}

export function startUnavailableAuthRecovery(
  checkAuth: () => Promise<AuthCheckResult>,
  options: RecoveryOptions = {},
): () => void {
  const isVisible = options.isVisible ?? (() => !document.hidden);
  let stopped = false;
  let requestInFlight = false;
  let retryIndex = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const clearRetry = () => {
    if (retryTimer === null) return;
    clearTimeout(retryTimer);
    retryTimer = null;
  };

  const scheduleRetry = () => {
    if (stopped || requestInFlight || retryTimer !== null) return;
    const delay =
      RETRY_DELAYS_MS[Math.min(retryIndex, RETRY_DELAYS_MS.length - 1)];
    retryIndex += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void runCheck();
    }, delay);
  };

  const runCheck = async () => {
    if (stopped || requestInFlight || !isVisible()) return;
    requestInFlight = true;
    let result: AuthCheckResult;
    try {
      result = await checkAuth();
    } catch {
      result = { state: "unavailable" };
    } finally {
      requestInFlight = false;
    }

    if (result.state === "unavailable" || result.state === "stale") {
      scheduleRetry();
    }
  };

  const retryNow = () => {
    if (stopped || requestInFlight) return;
    if (!isVisible()) {
      clearRetry();
      return;
    }
    clearRetry();
    void runCheck();
  };

  const unsubscribe = (options.subscribeToResume ?? subscribeToWebViewResume)(
    retryNow,
  );
  scheduleRetry();

  return () => {
    stopped = true;
    clearRetry();
    unsubscribe();
  };
}
