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

export function identityBootstrapCallbackHref(
  target: string,
  options: {
    enabled: boolean;
    bootstrapPath: string;
    origin?: string;
    userAgent?: string;
  },
): string {
  const origin =
    options.origin ??
    (typeof window === "undefined"
      ? "http://agent-native.local"
      : window.location.origin);
  const appOrigin = new URL(origin);
  const targetUrl = new URL(target || "/", appOrigin);
  if (targetUrl.origin !== appOrigin.origin) {
    throw new TypeError("Identity callback target must be same-origin");
  }
  const safeTarget = `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
  if (!options.enabled || isAgentNativeDesktop(options.userAgent))
    return safeTarget;

  const url = new URL(options.bootstrapPath, origin);
  url.searchParams.set("return", safeTarget);
  return `${url.pathname}${url.search}`;
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
        "settings",
        "admin",
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
