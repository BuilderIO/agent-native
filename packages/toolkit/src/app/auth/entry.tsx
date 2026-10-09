import type { SessionReplayOptions } from "@agent-native/core/client/analytics";
import { resolveLaneEndpoint } from "@agent-native/core/shared/environment-lanes";
import { createRoot, hydrateRoot } from "react-dom/client";

import { AuthPage, type AuthPageProps } from "./AuthPage.js";
import {
  ResetPasswordPage,
  type ResetPasswordPageProps,
} from "./ResetPasswordPage.js";

const AUTH_SHELL_PATHS = new Set([
  "/",
  "/login",
  "/signup",
  "/sign-in",
  "/_agent-native/sign-in",
]);
const AUTH_CALLBACK_QUERY_PARAMS = [
  "token",
  "code",
  "state",
  "c",
  "access_token",
  "refresh_token",
  "id_token",
  "token_hash",
  "session_token",
  "auth_token",
  "verification_token",
  "otp",
  "flow_id",
  "verifier",
  "callbackURL",
  "error",
];
const SENSITIVE_AUTH_QUERY_PARAMS = [
  ...AUTH_CALLBACK_QUERY_PARAMS,
  "email",
  "password",
  "return",
  "invite",
  "invite_token",
  "invitation",
  "invitation_token",
  "ticket",
  "challenge",
];

// A custom blockSelector replaces rrweb's defaults, so keep the framework
// privacy selectors here when adding auth-specific identity text.
const PRE_AUTH_BLOCK_SELECTOR = [
  "#magic-link-success-email",
  "#verify-email",
  "#google-debug",
  "#google-err",
  ".auth-page .msg",
  "[data-sensitive]",
  "[data-an-block]",
  "[data-an-private]",
  "[data-private]",
  ".an-block",
  ".an-replay-block",
  ".an-private",
  ".rr-block",
  "[autocomplete='cc-number']",
  "[autocomplete='cc-csc']",
  "[autocomplete='cc-exp']",
  "[name*='password' i]",
  "[name*='credit' i]",
  "[name*='card' i]",
  "[name*='ssn' i]",
].join(", ");

type AnalyticsBrowserConfig = {
  agentNativeAnalyticsPublicKey?: unknown;
  agentNativeAnalyticsEndpoint?: unknown;
  authSessionReplay?: unknown;
};

function normalizeBasePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "";
  return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

export function isAuthSessionReplayPathname(
  pathname: string,
  appBasePath: string,
): boolean {
  const basePath = normalizeBasePath(appBasePath);
  let appPathname = pathname;
  if (basePath) {
    if (pathname === basePath) {
      appPathname = "/";
    } else if (pathname.startsWith(`${basePath}/`)) {
      appPathname = pathname.slice(basePath.length);
    } else {
      return false;
    }
  }
  return AUTH_SHELL_PATHS.has(appPathname);
}

function hasAuthCallbackMaterial(search: string, hash: string): boolean {
  if (hash) return true;
  const params = new URLSearchParams(search);
  const callbackParams = new Set(
    AUTH_CALLBACK_QUERY_PARAMS.map((key) =>
      key.toLowerCase().replace(/[^a-z0-9]/g, ""),
    ),
  );
  return Array.from(params.keys()).some((key) =>
    callbackParams.has(key.toLowerCase().replace(/[^a-z0-9]/g, "")),
  );
}

function isAuthCallbackUrl(urlValue: string, appBasePath: string): boolean {
  try {
    const url = new URL(urlValue, window.location.href);
    const basePath = normalizeBasePath(appBasePath);
    const appPathname = basePath
      ? url.pathname === basePath
        ? "/"
        : url.pathname.startsWith(`${basePath}/`)
          ? url.pathname.slice(basePath.length)
          : url.pathname
      : url.pathname;
    return (
      hasAuthCallbackMaterial(url.search, url.hash) ||
      appPathname === "/_agent-native/auth" ||
      appPathname.startsWith("/_agent-native/auth/")
    );
  } catch {
    return true;
  }
}

function replayEndpointFromAnalyticsEndpoint(
  endpoint: string,
): string | undefined {
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(endpoint)) {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      return undefined;
    }
    if (url.pathname.endsWith("/api/analytics/track")) {
      url.pathname = url.pathname.replace(
        /\/api\/analytics\/track$/,
        "/api/analytics/replay",
      );
      return url.toString();
    }
    if (url.pathname.endsWith("/track")) {
      url.pathname = url.pathname.replace(/\/track$/, "/api/analytics/replay");
      return url.toString();
    }
  }
  if (endpoint.endsWith("/api/analytics/track")) {
    return endpoint.replace(
      /\/api\/analytics\/track$/,
      "/api/analytics/replay",
    );
  }
  if (endpoint.endsWith("/track")) {
    return endpoint.replace(/\/track$/, "/api/analytics/replay");
  }
  return undefined;
}

export function authSessionReplayOptions(
  config: AnalyticsBrowserConfig | undefined,
  pathname: string,
  appBasePath: string,
  hostname: string,
  search = "",
  hash = "",
): SessionReplayOptions | null {
  const publicKey =
    typeof config?.agentNativeAnalyticsPublicKey === "string"
      ? config.agentNativeAnalyticsPublicKey.trim()
      : "";
  if (
    config?.authSessionReplay !== true ||
    !publicKey ||
    !isAuthSessionReplayPathname(pathname, appBasePath) ||
    hasAuthCallbackMaterial(search, hash)
  ) {
    return null;
  }

  const configuredEndpoint =
    typeof config.agentNativeAnalyticsEndpoint === "string"
      ? config.agentNativeAnalyticsEndpoint.trim()
      : "";
  const replayEndpoint = configuredEndpoint
    ? replayEndpointFromAnalyticsEndpoint(configuredEndpoint)
    : undefined;
  if (configuredEndpoint && !replayEndpoint) {
    console.warn(
      "Skipping optional auth session replay because the configured Analytics endpoint is invalid.",
    );
    return null;
  }

  return {
    publicKey,
    ...(replayEndpoint
      ? { endpoint: resolveLaneEndpoint(replayEndpoint, hostname) }
      : {}),
    requireSignedInUser: false,
    sensitiveQueryParams: SENSITIVE_AUTH_QUERY_PARAMS,
    blockUrls: [(url) => isAuthCallbackUrl(url, appBasePath)],
    maskAllInputs: true,
    blockSelector: PRE_AUTH_BLOCK_SELECTOR,
    recordCanvas: false,
    recordCrossOriginIframes: false,
    inlineImages: false,
    collectFonts: false,
    console: false,
    network: false,
    extraProperties: {
      capture_context: "pre_auth",
      pre_auth_base_path: normalizeBasePath(appBasePath),
    },
    shouldStart: () =>
      isAuthSessionReplayPathname(window.location.pathname, appBasePath) &&
      !hasAuthCallbackMaterial(window.location.search, window.location.hash),
  };
}

function startAuthSessionReplay(
  config: AnalyticsBrowserConfig | undefined,
  appBasePath: string,
): void {
  const options = authSessionReplayOptions(
    config,
    window.location.pathname,
    appBasePath,
    window.location.hostname,
    window.location.search,
    window.location.hash,
  );
  if (!options) return;

  void import("@agent-native/core/client/analytics")
    .then(({ startSessionReplay }) => startSessionReplay(options))
    .catch(() => undefined);
}

const root = document.getElementById("agent-native-auth-root");
const data = document.getElementById("agent-native-auth-data");

if (root && data) {
  const props = JSON.parse(data.textContent ?? "{}") as
    | AuthPageProps
    | ResetPasswordPageProps;
  if ("pageType" in props && props.pageType === "reset-password") {
    const page = <ResetPasswordPage {...props} />;
    if (root.dataset.agentNativeAuthFallback) createRoot(root).render(page);
    else hydrateRoot(root, page);
  } else {
    startAuthSessionReplay(
      window.__AGENT_NATIVE_CONFIG__ as AnalyticsBrowserConfig | undefined,
      (props as AuthPageProps).appBasePath,
    );
    const page = <AuthPage {...(props as AuthPageProps)} />;
    if (root.dataset.agentNativeAuthFallback) createRoot(root).render(page);
    else hydrateRoot(root, page);
  }
}
