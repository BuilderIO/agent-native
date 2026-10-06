export function shouldRetryAuthSessionProbe(
  response: Pick<Response, "status">,
  readable: boolean,
): boolean {
  return !readable || response.status === 429 || response.status >= 500;
}

export function isAgentNativeDesktop(
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
): boolean {
  return /AgentNativeDesktop/i.test(userAgent);
}

export function isElectron(
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
): boolean {
  return userAgent.includes("Electron");
}

export function isBuilderDesktop(
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
): boolean {
  return isElectron(userAgent) && !isAgentNativeDesktop(userAgent);
}

export function normalizeOAuthReturnPath(
  target: string,
  origin = typeof window === "undefined"
    ? "http://agent-native.local"
    : window.location.origin,
): string {
  try {
    const url = new URL(target || "/", origin);
    let pathname = url.pathname || "/";
    if (pathname === "/dispatch/dispatch") {
      pathname = "/dispatch";
    } else if (pathname.startsWith("/dispatch/")) {
      const rest = pathname.slice("/dispatch/".length);
      const first = rest.split("/")[0];
      const dispatchRoutes = new Set([
        "overview",
        "apps",
        "metrics",
        "vault",
        "integrations",
        "messaging",
        "workspace",
        "agents",
        "destinations",
        "identities",
        "approvals",
        "audit",
        "team",
        "thread-debug",
        "new-app",
      ]);
      if (first === "dispatch")
        pathname = "/dispatch" + rest.slice(first.length);
      else if (first && !dispatchRoutes.has(first)) pathname = "/" + rest;
    }
    return pathname + url.search + url.hash;
  } catch {
    return target || "/";
  }
}
