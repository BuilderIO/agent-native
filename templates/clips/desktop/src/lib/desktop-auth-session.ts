export type DesktopAuthStatus = "unknown" | "authed" | "anon" | "unavailable";

export type AuthCheckResult =
  | { state: "authenticated"; token?: string }
  | { state: "anonymous" }
  | { state: "unavailable" }
  | { state: "stale" };

export const DESKTOP_AUTH_CHECK_TIMEOUT_MS = 10_000;

export async function checkDesktopAuthSession({
  serverUrl,
  isCurrentRequest,
  fetchSession,
  saveToken,
  clearToken,
  persistServerUrl,
  setAuthStatus,
  setSignedInAs,
  setServerReachable,
  timeoutMs = DESKTOP_AUTH_CHECK_TIMEOUT_MS,
}: {
  serverUrl: string;
  isCurrentRequest: () => boolean;
  fetchSession: typeof fetch;
  saveToken: (serverUrl: string, token: string) => void;
  clearToken: (serverUrl: string) => void;
  persistServerUrl: (serverUrl: string) => void;
  setAuthStatus: (
    next:
      | DesktopAuthStatus
      | ((current: DesktopAuthStatus) => DesktopAuthStatus),
  ) => void;
  setSignedInAs: (email: string | null) => void;
  setServerReachable: (reachable: boolean) => void;
  timeoutMs?: number;
}): Promise<AuthCheckResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchSession(
      `${serverUrl.replace(/\/+$/, "")}/_agent-native/auth/session`,
      {
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      },
    );
    if (!isCurrentRequest()) return { state: "stale" };
    setServerReachable(true);

    const markUnavailable = (serverReachable: boolean) => {
      setServerReachable(serverReachable);
      setAuthStatus((current) =>
        current === "authed" ? current : "unavailable",
      );
      return { state: "unavailable" as const };
    };

    if (res.status >= 500) {
      return markUnavailable(false);
    }
    if (res.status === 401 || res.status === 403) {
      clearToken(serverUrl);
      setAuthStatus("anon");
      setSignedInAs(null);
      return { state: "anonymous" };
    }

    let json: { email?: string; token?: string; error?: string } | null;
    try {
      json = (await res.json()) as {
        email?: string;
        token?: string;
        error?: string;
      } | null;
    } catch {
      if (!isCurrentRequest()) return { state: "stale" };
      return markUnavailable(true);
    }
    if (!isCurrentRequest()) return { state: "stale" };
    if (res.ok && typeof json?.email === "string" && json.email.trim()) {
      const token =
        typeof json.token === "string"
          ? json.token.trim() || undefined
          : undefined;
      persistServerUrl(serverUrl);
      if (token) saveToken(serverUrl, token);
      setAuthStatus("authed");
      setSignedInAs(json.email);
      return { state: "authenticated", ...(token ? { token } : {}) };
    }

    if (json?.error === "Not authenticated") {
      clearToken(serverUrl);
      setAuthStatus("anon");
      setSignedInAs(null);
      return { state: "anonymous" };
    }

    return markUnavailable(true);
  } catch {
    if (!isCurrentRequest()) return { state: "stale" };
    setServerReachable(false);
    setAuthStatus((current) =>
      current === "authed" ? current : "unavailable",
    );
    return { state: "unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}
