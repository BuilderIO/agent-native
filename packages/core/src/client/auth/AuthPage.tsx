/** @jsxRuntime classic */

import { MarketingHome, Starfield } from "@agent-native/toolkit/marketing";
import { AuthForm } from "@agent-native/toolkit/onboarding";
import * as React from "react";

import {
  signInJourney,
  type SignInJourney,
} from "../../shared/sign-in-journey.js";
import { isSyntheticTrafficValue } from "../../shared/test-traffic.js";

export type AuthView =
  | "signup"
  | "login"
  | "forgot"
  | "verification"
  | "magicLink"
  | "magicLinkSent"
  | "googleOnly";

export interface AuthMarketingProps {
  appName: string;
  tagline?: string;
  description?: string;
  features?: string[];
}

export interface AuthLocaleOption {
  value: string;
  label: string;
}

export interface AuthLegalNotice {
  termsUrl: string;
  privacyUrl: string;
  termsLabel?: string;
  privacyLabel?: string;
  prefix?: string;
  connector?: string;
  suffix?: string;
}

export interface AuthPageProps {
  authMode: "magic-link" | "password";
  googleOnly: boolean;
  initialPrompt: boolean;
  initialView: AuthView;
  appBasePath: string;
  workspaceRuntime: boolean;
  trackingApp: string;
  defaultLocale: string;
  localeStorageKey: string;
  locales: Record<string, Record<string, string>>;
  localeMetadata: Record<string, { dir?: string }>;
  localeOptions: AuthLocaleOption[];
  marketing?: AuthMarketingProps;
  marketingLocales: Record<string, AuthMarketingProps>;
  brandMarkSrc: string;
  githubUrl: string;
  showGoogle: boolean;
  signupLegalNotice?: AuthLegalNotice;
  signupLocalModeNote?: { text: string; command: string };
  connectionLabel: string;
  docsAuthUrl: string;
  identitySsoEnabled: boolean;
  publicOAuthOrigin: string;
  workspaceGatewayReturnOrigin: string;
  googleAuthMode: "popup" | "redirect" | "auto";
  builderPreviewLocalDevEnabled: boolean;
  environmentBetaHosts: Record<string, string>;
  betaForceQueryParam: string;
  betaForceSessionStorageKey: string;
  betaOptOutQueryParam: string;
  betaOptOutStorageKey: string;
  betaOptOutDurationMs: number;
  passwordMinLength: number;
  passwordMaxLength: number;
  passwordMaxCopy: string;
}

type Notice = { kind: "error" | "success"; text: string } | null;
type AuthRequestResult = {
  response: Response;
  data: Record<string, unknown>;
  readable: boolean;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TAB_STORAGE_KEY = "an.onboarding.tab";
const PENDING_SIGNUP_EMAIL_STORAGE_KEY = "an.onboarding.pendingSignupEmail";
const ANALYTICS_ANONYMOUS_ID_KEY = "agent-native.anonymous_id";
const ANALYTICS_SESSION_ID_KEY = "agent-native.session_id";
const FIRST_TOUCH_STORAGE_KEY = "an_attribution";
const FIRST_TOUCH_COOKIE = "an_ft";
const GOOGLE_AUTH_URL_PATH = "/_agent-native/google/auth-url";
const BUILDER_DESKTOP_RETURN_ORIGIN = "http://127.0.0.1:8080";

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(normalizeEmail(value));
}

function copyText(
  locales: Record<string, Record<string, string>>,
  defaultLocale: string,
  locale: string,
  key: string,
): string {
  return locales[locale]?.[key] ?? locales[defaultLocale]?.[key] ?? key;
}

function resolveLocale(
  value: string | undefined,
  localeOptions: AuthLocaleOption[],
  defaultLocale: string,
): string {
  if (!value || value === "system") return defaultLocale;
  const exact = localeOptions.find((option) => option.value === value);
  if (exact) return exact.value;
  try {
    const canonical = Intl.getCanonicalLocales(value)[0]?.toLowerCase();
    const match = localeOptions.find(
      (option) =>
        option.value.toLowerCase() === canonical ||
        option.value.split("-")[0]?.toLowerCase() === canonical?.split("-")[0],
    );
    return match?.value ?? defaultLocale;
  } catch {
    // coercion-ok: malformed locale input falls back to the configured locale.
    return defaultLocale;
  }
}

function resolveSystemLocale(
  localeOptions: AuthLocaleOption[],
  defaultLocale: string,
): string {
  if (typeof navigator === "undefined") return defaultLocale;
  const candidates = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];
  for (const candidate of candidates) {
    const locale = resolveLocale(candidate, localeOptions, defaultLocale);
    if (locale !== defaultLocale || candidate?.startsWith(defaultLocale)) {
      return locale;
    }
  }
  return defaultLocale;
}

function inferWorkspaceBasePath(pathname: string): string {
  const firstSegment = pathname.split("/").find(Boolean);
  if (
    !firstSegment ||
    ["_agent-native", "api", "sign-in", "login", "signup"].includes(
      firstSegment,
    )
  ) {
    return "";
  }
  return `/${firstSegment}`;
}

function readStorage(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    // coercion-ok: localStorage is optional; an empty value means no saved state.
    return "";
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // coercion-ok: browser storage is optional and auth has in-memory fallbacks.
  }
}

function removeStorage(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // coercion-ok: browser storage is optional.
  }
}

function authErrorText(
  data: Record<string, unknown>,
  fallback: string,
): string {
  const candidate = data.error ?? data.message;
  if (typeof candidate !== "string" || !candidate.trim()) return fallback;
  const message = candidate.trim();
  if (
    /failed query|\bselect\b.*\bfrom\b|\binsert\b.*\binto\b|\bupdate\b.*\bset\b|\bdelete\b.*\bfrom\b|\bsql\b|database|relation .* does not exist|column .* does not exist|syntax error|constraint|connection refused|econn|timeout/i.test(
      message,
    )
  ) {
    return fallback;
  }
  return message;
}

export function shouldRetryAuthSessionProbe(
  response: Pick<Response, "status">,
  readable: boolean,
): boolean {
  return !readable || response.status === 429 || response.status >= 500;
}

async function requestJson(
  url: string,
  init: RequestInit = {},
): Promise<AuthRequestResult> {
  const response = await fetch(url, {
    credentials: "include",
    ...init,
  });
  let data: Record<string, unknown> = {};
  let readable = false;
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
      readable = true;
    }
  } catch {
    // coercion-ok: a non-JSON response still has a status the caller can inspect.
  }
  return { response, data, readable };
}

function generateAnonymousId(): string {
  try {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // coercion-ok: the browser fallback remains usable when crypto is unavailable.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function safeAttributionValue(value: string | null): string {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

function trackAuth(
  app: string,
  name: string,
  properties: Record<string, unknown> = {},
): void {
  if (
    isSyntheticTrafficValue(
      (
        window as Window & {
          __AGENT_NATIVE_SYNTHETIC_TRAFFIC__?: unknown;
        }
      ).__AGENT_NATIVE_SYNTHETIC_TRAFFIC__,
    )
  ) {
    return;
  }
  try {
    const config = (
      window as Window & {
        __AGENT_NATIVE_CONFIG__?: {
          agentNativeAnalyticsPublicKey?: string;
          agentNativeAnalyticsEndpoint?: string;
        };
      }
    ).__AGENT_NATIVE_CONFIG__;
    if (!config?.agentNativeAnalyticsPublicKey) return;
    const anonymousId = readStorage(ANALYTICS_ANONYMOUS_ID_KEY);
    if (!anonymousId) return;
    const sessionId = (() => {
      try {
        return window.sessionStorage.getItem(ANALYTICS_SESSION_ID_KEY) ?? "";
      } catch {
        // coercion-ok: analytics session storage is optional.
        return "";
      }
    })();
    const body = JSON.stringify({
      publicKey: config.agentNativeAnalyticsPublicKey,
      event: name,
      properties: { app, ...properties },
      anonymousId,
      sessionId: sessionId || undefined,
      timestamp: new Date().toISOString(),
    });
    const endpoint =
      config.agentNativeAnalyticsEndpoint ??
      "https://analytics.agent-native.com/track";
    if (navigator.sendBeacon?.(endpoint, body)) return;
    void fetch(endpoint, {
      method: "POST",
      body,
      keepalive: true,
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
    }).catch(() => undefined);
  } catch {
    // coercion-ok: analytics is best effort and cannot block authentication.
  }
}

function isLoopbackHostname(): boolean {
  if (typeof window === "undefined") return false;
  const hostname = window.location.hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("127.")
  );
}

function isBuilderPreviewHostname(): boolean {
  if (typeof window === "undefined") return false;
  const hostname = window.location.hostname.toLowerCase();
  return (
    hostname.endsWith(".builderio.xyz") ||
    hostname.endsWith(".builderio.dev") ||
    hostname.endsWith(".builder.codes") ||
    hostname.endsWith(".builder.my")
  );
}

function isBuilderPreview(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    if (
      params.has("builder.preview") ||
      params.has("builder.frameEditing") ||
      params.has("__builder_editing__")
    ) {
      window.sessionStorage.setItem("__an_builder_preview_seen", "1");
      return true;
    }
    if (window.sessionStorage.getItem("__an_builder_preview_seen") === "1") {
      return true;
    }
  } catch {
    // coercion-ok: preview storage is optional; referrer detection remains available.
  }
  const referrer = document.referrer;
  return /builder\.io|builder\.my|builderio\.xyz|builderio\.dev|builder\.codes/i.test(
    referrer,
  );
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

/**
 * Builder's desktop webview uses Electron without the Agent-Native marker.
 * This only selects the local workspace return origin; native deep-link
 * handling remains exclusive to Agent-Native Desktop.
 */
export function isBuilderDesktop(
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
): boolean {
  return isElectron(userAgent) && !isAgentNativeDesktop(userAgent);
}

function isInFrame(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // coercion-ok: cross-origin frame inspection can be denied; assume embedded.
    return true;
  }
}

function configuredOAuthOrigin(
  value: string,
  currentOrigin = typeof window === "undefined" ? "" : window.location.origin,
): string {
  if (!value) return "";
  try {
    const origin = new URL(value).origin;
    return origin !== currentOrigin ? origin : "";
  } catch {
    // coercion-ok: malformed optional OAuth configuration uses same-origin behavior.
    return "";
  }
}

function builderPreviewReturnOrigin(): string {
  if (typeof window === "undefined") return "";
  const candidates = [window.location.href, document.referrer];
  try {
    if (window.location.ancestorOrigins) {
      for (const origin of window.location.ancestorOrigins)
        candidates.push(origin);
    }
  } catch {
    // coercion-ok: ancestor frame metadata is optional and may be inaccessible.
  }
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      const hostname = url.hostname.toLowerCase();
      const isBuilderHost =
        hostname === "builderio.xyz" ||
        hostname.endsWith(".builderio.xyz") ||
        hostname === "builderio.dev" ||
        hostname.endsWith(".builderio.dev") ||
        hostname === "builder.codes" ||
        hostname.endsWith(".builder.codes") ||
        hostname === "builder.my" ||
        hostname.endsWith(".builder.my");
      if (url.protocol === "https:" && isBuilderHost) return url.origin;
    } catch {
      // coercion-ok: malformed frame metadata is ignored.
    }
  }
  return "";
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

export function resolveOAuthReturnOrigin(input: {
  previewOrigin: string;
  workspaceGatewayReturnOrigin: string;
  userAgent: string;
}): string {
  return (
    input.previewOrigin ||
    input.workspaceGatewayReturnOrigin ||
    (isAgentNativeDesktop(input.userAgent) || isBuilderDesktop(input.userAgent)
      ? BUILDER_DESKTOP_RETURN_ORIGIN
      : "")
  );
}

export function oauthReturnTarget(
  target: string,
  workspaceGatewayReturnOrigin: string,
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
): string {
  const path = normalizeOAuthReturnPath(target);
  const origin = resolveOAuthReturnOrigin({
    previewOrigin: builderPreviewReturnOrigin(),
    workspaceGatewayReturnOrigin,
    userAgent,
  });
  return origin ? origin + path : path;
}

export function resolveGoogleAuthUrlPath(input: {
  builderPreview: boolean;
  currentOrigin: string;
  publicOAuthOrigin: string;
  runtimeAppBasePath: string;
}): string {
  const previewOrigin = input.builderPreview
    ? configuredOAuthOrigin(input.publicOAuthOrigin, input.currentOrigin)
    : "";
  // The public OAuth authority is rooted at the app origin even when the
  // preview itself is mounted under a workspace prefix such as /dispatch.
  return previewOrigin
    ? `${previewOrigin}${GOOGLE_AUTH_URL_PATH}`
    : `${input.runtimeAppBasePath}${GOOGLE_AUTH_URL_PATH}`;
}

function createFlowId(): string {
  try {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // coercion-ok: the browser fallback remains usable when crypto is unavailable.
  }
  return `agent-native-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function createVerifier(): string {
  try {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID() + crypto.randomUUID();
    }
    if (typeof crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    }
  } catch {
    // coercion-ok: no verifier is a typed failure handled by the OAuth caller.
    return "";
  }
  return "";
}

const GOOGLE_BRAND_COLORS = {
  // guard:allow-raw-color - Google brand mark must retain provider colors.
  blue: "#4285F4",
  // guard:allow-raw-color - Google brand mark must retain provider colors.
  green: "#34A853",
  // guard:allow-raw-color - Google brand mark must retain provider colors.
  yellow: "#FBBC05",
  // guard:allow-raw-color - Google brand mark must retain provider colors.
  red: "#EA4335",
} as const;

function googleSvg(): React.ReactNode {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill={GOOGLE_BRAND_COLORS.blue}
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      />
      <path
        fill={GOOGLE_BRAND_COLORS.green}
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill={GOOGLE_BRAND_COLORS.yellow}
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill={GOOGLE_BRAND_COLORS.red}
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function headingKeys(view: AuthView): { heading: string; subtitle: string } {
  if (view === "login") {
    return { heading: "welcomeBackTitle", subtitle: "signInSubtitle" };
  }
  if (view === "forgot") {
    return { heading: "resetPasswordTitle", subtitle: "resetPasswordSubtitle" };
  }
  if (view === "verification") {
    return { heading: "checkEmailTitle", subtitle: "finishAccountSubtitle" };
  }
  if (view === "googleOnly") {
    return { heading: "signInTitle", subtitle: "googleOnlySubtitle" };
  }
  if (view === "magicLinkSent") {
    return { heading: "magicLinkSent", subtitle: "magicLinkSentCopy" };
  }
  if (view === "magicLink") {
    return { heading: "magicLinkTitle", subtitle: "magicLinkSubtitle" };
  }
  return { heading: "welcomeTitle", subtitle: "createAccountSubtitle" };
}

export function AuthPage(props: AuthPageProps) {
  const {
    authMode,
    googleOnly,
    initialPrompt,
    appBasePath,
    workspaceRuntime,
    trackingApp,
    defaultLocale,
    localeStorageKey,
    locales,
    localeMetadata,
    localeOptions,
    marketing,
    marketingLocales,
    brandMarkSrc,
    githubUrl,
    showGoogle,
    signupLegalNotice,
    signupLocalModeNote,
    connectionLabel,
    docsAuthUrl,
    identitySsoEnabled,
    publicOAuthOrigin,
    workspaceGatewayReturnOrigin,
    googleAuthMode,
    builderPreviewLocalDevEnabled,
  } = props;
  const [localePreference, setLocalePreference] = React.useState("system");
  const [locale, setLocale] = React.useState(defaultLocale);
  const [localeMenuOpen, setLocaleMenuOpen] = React.useState(false);
  const [view, setView] = React.useState<AuthView>(props.initialView);
  const [messages, setMessages] = React.useState<Record<string, Notice>>({});
  const [submitting, setSubmitting] = React.useState<string | null>(null);
  const [localDevAvailable, setLocalDevAvailable] = React.useState(false);
  const [localDevBusy, setLocalDevBusy] = React.useState(false);
  const [fullAuthOptionsVisible, setFullAuthOptionsVisible] =
    React.useState(true);
  const [localNoteVisible, setLocalNoteVisible] = React.useState(false);
  const [upgradeVisible, setUpgradeVisible] = React.useState(false);
  const [magicLinkEmail, setMagicLinkEmail] = React.useState("");
  const [signupEmail, setSignupEmail] = React.useState("");
  const [signupPassword, setSignupPassword] = React.useState("");
  const [signupPasswordConfirmation, setSignupPasswordConfirmation] =
    React.useState("");
  const [loginEmail, setLoginEmail] = React.useState("");
  const [loginPassword, setLoginPassword] = React.useState("");
  const [forgotEmail, setForgotEmail] = React.useState("");
  const [forgotSent, setForgotSent] = React.useState(false);
  const [verificationEmail, setVerificationEmail] = React.useState("");
  const [verificationResendUntil, setVerificationResendUntil] =
    React.useState(0);
  const [googleBusy, setGoogleBusy] = React.useState(false);
  const [magicLinkBusy, setMagicLinkBusy] = React.useState(false);
  const [environmentVisible, setEnvironmentVisible] = React.useState(false);
  const [environmentOpen, setEnvironmentOpen] = React.useState(false);
  const [environmentProductionUrl, setEnvironmentProductionUrl] =
    React.useState("");
  const [copiedLocalMode, setCopiedLocalMode] = React.useState(false);
  const pendingSignupPassword = React.useRef("");
  const oauthPollTimer = React.useRef<number | null>(null);
  const oauthPollInFlight = React.useRef(false);
  const oauthPopupTimer = React.useRef<number | null>(null);
  const oauthPopupGraceTimer = React.useRef<number | null>(null);
  const oauthFlowId = React.useRef<string | null>(null);
  const nativeOAuthFlowId = React.useRef<string | null>(null);
  const nativeOAuthRequestPending = React.useRef(false);
  const nativeOAuthAbandonTimer = React.useRef<number | null>(null);
  const verificationCheckInFlight = React.useRef(false);
  const verifiedReturnHandled = React.useRef(false);

  const [runtimeAppBasePath, setRuntimeAppBasePath] =
    React.useState(appBasePath);
  const [runtimeBasePathResolved, setRuntimeBasePathResolved] = React.useState(
    Boolean(appBasePath || !workspaceRuntime),
  );

  React.useEffect(() => {
    if (appBasePath || !workspaceRuntime) {
      setRuntimeBasePathResolved(true);
      return;
    }
    setRuntimeAppBasePath(inferWorkspaceBasePath(window.location.pathname));
    setRuntimeBasePathResolved(true);
  }, [appBasePath, workspaceRuntime]);

  const t = React.useCallback(
    (key: string) => copyText(locales, defaultLocale, locale, key),
    [defaultLocale, locale, locales],
  );
  const apiPath = React.useCallback(
    (path: string) => `${runtimeAppBasePath}${path}`,
    [runtimeAppBasePath],
  );
  const journey = React.useCallback((): SignInJourney => {
    if (typeof window === "undefined") {
      return signInJourney({
        at: `${runtimeAppBasePath}/`,
        basePath: runtimeAppBasePath,
      });
    }
    return signInJourney({
      at:
        window.location.pathname +
        window.location.search +
        window.location.hash,
      continuation: new URLSearchParams(window.location.search).get("c"),
      legacyReturn: new URLSearchParams(window.location.search).get("return"),
      basePath: runtimeAppBasePath,
    });
  }, [runtimeAppBasePath]);
  const resumeHref = React.useCallback(() => journey().resumeHref, [journey]);
  const redirectToSignedInApp = React.useCallback(
    (target?: string) => {
      window.location.replace(target || resumeHref());
    },
    [resumeHref],
  );
  const setNotice = React.useCallback((key: string, notice: Notice) => {
    setMessages((current) => ({ ...current, [key]: notice }));
  }, []);
  const notice = React.useCallback(
    (key: string) => {
      const current = messages[key];
      if (!current) return null;
      return (
        <p
          className={`msg ${current.kind} show`}
          role="status"
          aria-live="polite"
        >
          {current.text}
        </p>
      );
    },
    [messages],
  );

  const pendingEmailStorageKey = React.useCallback(
    () => `${PENDING_SIGNUP_EMAIL_STORAGE_KEY}:${runtimeAppBasePath || "/"}`,
    [runtimeAppBasePath],
  );
  const rememberPendingSignupEmail = React.useCallback(
    (email: string) => {
      if (email) writeStorage(pendingEmailStorageKey(), normalizeEmail(email));
      else removeStorage(pendingEmailStorageKey());
    },
    [pendingEmailStorageKey],
  );
  const readPendingSignupEmail = React.useCallback(() => {
    const email = readStorage(pendingEmailStorageKey());
    return isValidEmail(email) ? normalizeEmail(email) : "";
  }, [pendingEmailStorageKey]);

  React.useEffect(() => {
    const stored = readStorage(localeStorageKey);
    const preference = stored || "system";
    const nextLocale =
      preference === "system"
        ? resolveSystemLocale(localeOptions, defaultLocale)
        : resolveLocale(preference, localeOptions, defaultLocale);
    setLocalePreference(preference);
    setLocale(nextLocale);
    document.documentElement.lang = nextLocale;
    document.documentElement.dir = localeMetadata[nextLocale]?.dir || "ltr";
    document.documentElement.dataset.locale = nextLocale;
  }, [defaultLocale, localeMetadata, localeOptions, localeStorageKey]);

  React.useEffect(() => {
    const closeMenu = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        document.querySelector(".locale-picker")?.contains(target)
      ) {
        return;
      }
      setLocaleMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLocaleMenuOpen(false);
    };
    document.addEventListener("click", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("click", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  React.useEffect(() => {
    const nextTitle = marketing?.appName
      ? `${marketing.appName} — ${t("pageTitleSignIn")}`
      : t("pageTitleWelcome");
    document.title = nextTitle;
    document.documentElement.lang = locale;
    document.documentElement.dir = localeMetadata[locale]?.dir || "ltr";
    document.documentElement.dataset.locale = locale;
  }, [locale, localeMetadata, marketing?.appName, t]);

  React.useEffect(() => {
    if (googleOnly) return;
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    const params = new URLSearchParams(window.location.search);
    const verificationError =
      params.get("error") === "verification_link_invalid";
    if (params.get("verified") || verificationError) {
      setView("login");
      const rememberedEmail = readPendingSignupEmail();
      if (rememberedEmail) setLoginEmail(rememberedEmail);
      if (verificationError) {
        setNotice("login", {
          kind: "error",
          text: t("verificationLinkInvalid"),
        });
      }
      return;
    }
    if (params.get("tab") === "login" || path.endsWith("/login")) {
      setView("login");
      return;
    }
    if (params.get("tab") === "signup" || path.endsWith("/signup")) {
      setView("signup");
      return;
    }
    if (authMode === "magic-link") {
      setView("magicLink");
      return;
    }
    const storedTab = readStorage(TAB_STORAGE_KEY);
    if (storedTab === "login" || storedTab === "signup") setView(storedTab);
  }, [authMode, googleOnly, readPendingSignupEmail, setNotice, t]);

  React.useEffect(() => {
    if (!runtimeBasePathResolved) return;
    const probe = async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        let retry = false;
        try {
          const { response, data, readable } = await requestJson(
            apiPath("/_agent-native/auth/session"),
            {
              headers: { Accept: "application/json" },
              cache: "no-store",
            },
          );
          if (response.ok && typeof data.email === "string" && !data.error) {
            redirectToSignedInApp();
            return;
          }
          retry = shouldRetryAuthSessionProbe(response, readable);
        } catch {
          retry = true;
        }
        if (!retry || attempt === 2) return;
        await new Promise<void>((resolve) =>
          window.setTimeout(resolve, 250 * (attempt + 1)),
        );
      }
    };
    void probe();
  }, [apiPath, redirectToSignedInApp, runtimeBasePathResolved]);

  React.useEffect(() => {
    let anonymousId = readStorage(ANALYTICS_ANONYMOUS_ID_KEY);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(anonymousId)) {
      anonymousId = generateAnonymousId();
      writeStorage(ANALYTICS_ANONYMOUS_ID_KEY, anonymousId);
    }
    try {
      document.cookie = `an_aid=${encodeURIComponent(anonymousId)}; path=/; max-age=2592000; SameSite=Lax`;
    } catch {
      // coercion-ok: attribution cookies are optional for authentication.
    }
    try {
      const existing = readStorage(FIRST_TOUCH_STORAGE_KEY);
      if (
        !existing &&
        !document.cookie
          .split(";")
          .some((part) => part.trim().startsWith(`${FIRST_TOUCH_COOKIE}=`))
      ) {
        const params = new URLSearchParams(window.location.search);
        const attribution: Record<string, string> = {};
        for (const key of [
          "ref",
          "via",
          "utm_source",
          "utm_medium",
          "utm_campaign",
          "utm_content",
          "utm_term",
        ]) {
          const value = safeAttributionValue(params.get(key));
          if (value) attribution[key] = value;
        }
        const returnPath = signInJourney({
          at: window.location.pathname,
          continuation: params.get("c"),
          legacyReturn: params.get("return"),
          basePath: runtimeAppBasePath,
        }).resumeHref;
        const landingPath = safeAttributionValue(returnPath);
        if (landingPath) attribution.landing_path = landingPath;
        try {
          const referrer = new URL(document.referrer);
          if (referrer.host !== window.location.host) {
            attribution.landing_referrer = safeAttributionValue(referrer.host);
          }
        } catch {
          // coercion-ok: a non-URL referrer is not useful attribution.
        }
        attribution.landed_at = new Date().toISOString();
        const json = JSON.stringify(attribution);
        writeStorage(FIRST_TOUCH_STORAGE_KEY, json);
        document.cookie = `${FIRST_TOUCH_COOKIE}=${encodeURIComponent(json)}; path=/; max-age=2592000; SameSite=Lax`;
      }
    } catch {
      // coercion-ok: attribution is best effort and never blocks authentication.
    }
    trackAuth(trackingApp, "auth.signup_viewed", {
      surface: "signup",
      auth_mode: authMode,
      auth_view: view,
    });
  }, [authMode, runtimeAppBasePath, trackingApp]);

  React.useEffect(() => {
    const hostname = window.location.hostname.toLowerCase();
    setLocalNoteVisible(
      hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1" ||
        hostname.endsWith(".local"),
    );
  }, []);

  const localDevAllowed = React.useMemo(
    () =>
      isLoopbackHostname() ||
      (builderPreviewLocalDevEnabled && isBuilderPreviewHostname()),
    [builderPreviewLocalDevEnabled],
  );

  React.useEffect(() => {
    if (!runtimeBasePathResolved || !localDevAllowed) return;
    let active = true;
    const loadAvailability = async () => {
      try {
        const { response, data } = await requestJson(
          apiPath("/_agent-native/auth/local-dev"),
          {
            method: "GET",
            cache: "no-store",
            headers: { Accept: "application/json" },
          },
        );
        if (!active) return;
        const available = response.ok && data.available === true;
        setLocalDevAvailable(available);
        if (!available) {
          setFullAuthOptionsVisible(true);
          return;
        }
        const params = new URLSearchParams(window.location.search);
        const startWithLocalDev =
          !params.has("tab") &&
          !params.has("verified") &&
          params.get("error") !== "verification_link_invalid";
        setFullAuthOptionsVisible(!startWithLocalDev);
      } catch {
        if (active) setFullAuthOptionsVisible(true);
      }
    };
    void loadAvailability();
    return () => {
      active = false;
    };
  }, [apiPath, localDevAllowed, runtimeBasePathResolved]);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let shouldShow =
      params.get("signin") === "1" || params.get("upgrade-from-local") === "1";
    if (!shouldShow) shouldShow = readStorage("an_migrate_from_local") === "1";
    setUpgradeVisible(shouldShow);
  }, []);

  React.useEffect(() => {
    if (window.parent !== window) return;
    try {
      if (localDevAllowed) {
        const forceUrl = new URL(window.location.href);
        if (forceUrl.searchParams.get(props.betaForceQueryParam) === "true") {
          window.sessionStorage.setItem(props.betaForceSessionStorageKey, "1");
        }
      }
      const optOutUrl = new URL(window.location.href);
      const optOutValue = optOutUrl.searchParams.get(
        props.betaOptOutQueryParam,
      );
      if (optOutValue !== null) {
        const expiry = Number(optOutValue);
        if (Number.isFinite(expiry) && expiry > Date.now()) {
          window.localStorage.setItem(
            props.betaOptOutStorageKey,
            String(expiry),
          );
        }
        optOutUrl.searchParams.delete(props.betaOptOutQueryParam);
        window.history.replaceState(null, "", optOutUrl.toString());
      }
    } catch {
      // coercion-ok: beta controls are optional.
    }
  }, [localDevAllowed, props]);

  React.useEffect(() => {
    if (window.parent !== window) return;
    const hostname = window.location.hostname.toLowerCase().replace(/\.$/, "");
    const productionHost = hostname.startsWith("beta.")
      ? hostname.slice("beta.".length)
      : "";
    if (
      !productionHost ||
      props.environmentBetaHosts[productionHost] !== hostname
    ) {
      return;
    }
    try {
      const productionUrl = new URL(window.location.href);
      productionUrl.protocol = "https:";
      productionUrl.hostname = productionHost;
      productionUrl.port = "";
      productionUrl.searchParams.set(
        props.betaOptOutQueryParam,
        String(Date.now() + props.betaOptOutDurationMs),
      );
      setEnvironmentProductionUrl(productionUrl.toString());
      setEnvironmentVisible(true);
    } catch {
      // coercion-ok: malformed host metadata cannot produce a useful switcher.
    }
  }, [props]);

  const stopOAuthPolling = React.useCallback(() => {
    if (oauthPollTimer.current !== null) {
      window.clearInterval(oauthPollTimer.current);
      oauthPollTimer.current = null;
    }
    if (oauthPopupTimer.current !== null) {
      window.clearInterval(oauthPopupTimer.current);
      oauthPopupTimer.current = null;
    }
    if (oauthPopupGraceTimer.current !== null) {
      window.clearTimeout(oauthPopupGraceTimer.current);
      oauthPopupGraceTimer.current = null;
    }
    oauthPollInFlight.current = false;
  }, []);

  const clearNativeOAuthRecovery = React.useCallback(() => {
    if (nativeOAuthAbandonTimer.current !== null) {
      window.clearTimeout(nativeOAuthAbandonTimer.current);
      nativeOAuthAbandonTimer.current = null;
    }
  }, []);

  const stopNativeOAuth = React.useCallback(() => {
    clearNativeOAuthRecovery();
    nativeOAuthFlowId.current = null;
    nativeOAuthRequestPending.current = false;
  }, [clearNativeOAuthRecovery]);

  React.useEffect(() => stopOAuthPolling, [stopOAuthPolling]);

  React.useEffect(() => {
    if (!isAgentNativeDesktop()) return;
    const recoverAfterReturn = () => {
      const flowId = nativeOAuthFlowId.current;
      if (
        !flowId ||
        nativeOAuthRequestPending.current ||
        oauthPollTimer.current === null
      ) {
        return;
      }
      clearNativeOAuthRecovery();
      nativeOAuthAbandonTimer.current = window.setTimeout(() => {
        nativeOAuthAbandonTimer.current = null;
        if (
          flowId !== nativeOAuthFlowId.current ||
          nativeOAuthRequestPending.current ||
          oauthPollTimer.current === null
        ) {
          return;
        }
        stopOAuthPolling();
        nativeOAuthFlowId.current = null;
        nativeOAuthRequestPending.current = false;
        setGoogleBusy(false);
      }, 5000);
    };
    const clearRecoveryWhileHidden = () => clearNativeOAuthRecovery();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") recoverAfterReturn();
      else clearRecoveryWhileHidden();
    };
    window.addEventListener("focus", recoverAfterReturn);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", recoverAfterReturn);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearNativeOAuthRecovery();
    };
  }, [clearNativeOAuthRecovery, stopOAuthPolling]);

  const finishOAuthExchange = React.useCallback(
    (target: string, sessionToken?: string) => {
      stopOAuthPolling();
      stopNativeOAuth();
      setGoogleBusy(false);
      setMagicLinkBusy(false);
      if (isBuilderPreview() && sessionToken) {
        try {
          const url = new URL(target, window.location.origin);
          url.searchParams.set("_session", sessionToken);
          window.location.replace(url.pathname + url.search + url.hash);
          return;
        } catch {
          // coercion-ok: same-origin continuation remains safe if preview parsing fails.
        }
      }
      redirectToSignedInApp(target);
    },
    [redirectToSignedInApp, stopNativeOAuth, stopOAuthPolling],
  );

  const startOAuthExchange = React.useCallback(
    (
      flowId: string,
      target: string,
      verifier: string,
      kind: "google" | "magic-link",
      popup?: Window | null,
    ) => {
      const startedAt = Date.now();
      const check = async () => {
        if (oauthPollInFlight.current) return;
        oauthPollInFlight.current = true;
        try {
          const { data } = await requestJson(
            `${apiPath("/_agent-native/auth/desktop-exchange")}?flow_id=${encodeURIComponent(flowId)}`,
            {
              headers: verifier
                ? { "X-Agent-Native-Desktop-Verifier": verifier }
                : undefined,
            },
          );
          if (flowId !== oauthFlowId.current) return;
          if (
            typeof data.email === "string" ||
            typeof data.token === "string"
          ) {
            finishOAuthExchange(
              target,
              typeof data.token === "string" ? data.token : undefined,
            );
            return;
          }
          if (data.error) {
            stopOAuthPolling();
            stopNativeOAuth();
            setGoogleBusy(false);
            setMagicLinkBusy(false);
            if (kind === "magic-link") setView("magicLink");
            setNotice(kind, {
              kind: "error",
              text: authErrorText(
                data,
                kind === "magic-link"
                  ? t("magicLinkFailed")
                  : t("googleNotConfigured"),
              ),
            });
            return;
          }
        } catch {
          // coercion-ok: external OAuth completion may transiently fail while polling.
        } finally {
          oauthPollInFlight.current = false;
        }
        if (Date.now() - startedAt > 5 * 60 * 1000) {
          stopOAuthPolling();
          stopNativeOAuth();
          setGoogleBusy(false);
          setMagicLinkBusy(false);
          if (kind === "magic-link") setView("magicLink");
          setNotice(kind, {
            kind: "error",
            text:
              kind === "magic-link"
                ? t("magicLinkFailed")
                : t("googleNeverFinished"),
          });
        }
      };
      stopOAuthPolling();
      oauthPollTimer.current = window.setInterval(() => void check(), 1000);
      if (popup) {
        oauthPopupTimer.current = window.setInterval(() => {
          let closed = false;
          try {
            closed = popup.closed;
          } catch {
            closed = true;
          }
          if (!closed) return;
          if (oauthPopupTimer.current !== null) {
            window.clearInterval(oauthPopupTimer.current);
            oauthPopupTimer.current = null;
          }
          oauthPopupGraceTimer.current = window.setTimeout(() => {
            oauthPopupGraceTimer.current = null;
            if (flowId !== oauthFlowId.current) return;
            void requestJson(apiPath("/_agent-native/auth/session"), {
              headers: { Accept: "application/json" },
            })
              .then(({ response, data }) => {
                if (flowId !== oauthFlowId.current) return;
                if (
                  response.ok &&
                  typeof data.email === "string" &&
                  !data.error
                ) {
                  finishOAuthExchange(target);
                  return;
                }
                stopOAuthPolling();
                setGoogleBusy(false);
                setNotice("google", {
                  kind: "error",
                  text: t("googlePopupHelp"),
                });
              })
              .catch(() => {
                if (flowId !== oauthFlowId.current) return;
                stopOAuthPolling();
                setGoogleBusy(false);
                setNotice("google", {
                  kind: "error",
                  text: t("googlePopupHelp"),
                });
              });
          }, 5000);
        }, 500);
      }
      window.setTimeout(() => void check(), 500);
    },
    [
      apiPath,
      finishOAuthExchange,
      setNotice,
      stopNativeOAuth,
      stopOAuthPolling,
      t,
    ],
  );

  const resolveGoogleFlow = React.useCallback(() => {
    const preview = isBuilderPreview();
    if (preview) return isInFrame() ? "popup" : "redirect";
    const requested = new URLSearchParams(window.location.search).get(
      "authMode",
    );
    if (requested === "popup" || requested === "redirect") return requested;
    if (googleAuthMode === "popup" || googleAuthMode === "redirect") {
      return googleAuthMode;
    }
    return isAgentNativeDesktop() ? "redirect" : "popup";
  }, [googleAuthMode]);

  const googleAuthUrlPath = React.useCallback(
    () =>
      resolveGoogleAuthUrlPath({
        builderPreview: isBuilderPreview(),
        currentOrigin: window.location.origin,
        publicOAuthOrigin,
        runtimeAppBasePath,
      }),
    [publicOAuthOrigin, runtimeAppBasePath],
  );

  const startGoogle = React.useCallback(async () => {
    if (!showGoogle || googleBusy) return;
    setGoogleBusy(true);
    setNotice("google", null);
    try {
      window.sessionStorage.setItem("__an_signin", "1");
    } catch {
      // coercion-ok: analytics session storage is optional.
    }
    trackAuth(
      trackingApp,
      view === "login" ? "auth.login_clicked" : "auth.signup_clicked",
      {
        surface: view === "login" ? "login" : "signup",
        method: "google",
        auth_view: view,
      },
    );
    const target = resumeHref();
    const oauthTarget = oauthReturnTarget(target, workspaceGatewayReturnOrigin);
    const flowId = createFlowId();
    oauthFlowId.current = flowId;
    const flow = resolveGoogleFlow();
    const nativeDesktop = flow === "redirect" && isAgentNativeDesktop();
    if (nativeDesktop) {
      stopNativeOAuth();
      nativeOAuthFlowId.current = flowId;
      nativeOAuthRequestPending.current = true;
    } else {
      stopNativeOAuth();
    }
    const authUrl = googleAuthUrlPath();
    if (flow === "redirect" && !nativeDesktop) {
      const params = new URLSearchParams({
        return: oauthTarget,
        redirect: "1",
      });
      window.location.replace(`${authUrl}?${params.toString()}`);
      return;
    }
    const verifier = createVerifier();
    if (!verifier) {
      stopNativeOAuth();
      setGoogleBusy(false);
      setNotice("google", { kind: "error", text: t("failedToConnect") });
      return;
    }
    let popup: Window | null = null;
    if (flow === "popup") {
      const builderPreviewFrame = isBuilderPreview() && isInFrame();
      try {
        popup = window.open("", "_blank", "width=640,height=760");
        if (!popup) {
          if (builderPreviewFrame) {
            setGoogleBusy(false);
            setNotice("google", {
              kind: "error",
              text: t("googlePopupHelp"),
            });
            return;
          }
          const params = new URLSearchParams({
            return: oauthTarget,
            redirect: "1",
          });
          window.location.replace(`${authUrl}?${params.toString()}`);
          return;
        }
        try {
          popup.opener = null;
        } catch {
          // coercion-ok: some browsers expose popup.opener as read-only.
        }
      } catch {
        if (builderPreviewFrame) {
          setGoogleBusy(false);
          setNotice("google", {
            kind: "error",
            text: t("googlePopupHelp"),
          });
          return;
        }
        const params = new URLSearchParams({
          return: oauthTarget,
          redirect: "1",
        });
        window.location.replace(`${authUrl}?${params.toString()}`);
        return;
      }
    }
    try {
      const params = new URLSearchParams({
        return: oauthTarget,
        desktop: "1",
        flow_id: flowId,
      });
      const { response, data } = await requestJson(
        `${authUrl}?${params.toString()}`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "X-Agent-Native-Desktop-Verifier": verifier,
          },
        },
      );
      if (!response.ok || typeof data.url !== "string" || !data.url) {
        throw new Error(authErrorText(data, t("failedToConnect")));
      }
      if (nativeDesktop) nativeOAuthRequestPending.current = false;
      startOAuthExchange(flowId, target, verifier, "google", popup);
      if (popup) {
        popup.location.href = data.url;
      } else {
        window.location.href = data.url;
      }
    } catch (error) {
      try {
        popup?.close();
      } catch {
        // Ignore a popup that has already closed.
      }
      stopNativeOAuth();
      setGoogleBusy(false);
      setNotice("google", {
        kind: "error",
        text: error instanceof Error ? error.message : t("failedToConnect"),
      });
    }
  }, [
    googleAuthUrlPath,
    googleBusy,
    resolveGoogleFlow,
    resumeHref,
    showGoogle,
    startOAuthExchange,
    stopNativeOAuth,
    stopOAuthPolling,
    t,
    trackingApp,
    view,
    workspaceGatewayReturnOrigin,
  ]);

  const handleLocalDev = React.useCallback(async () => {
    if (localDevBusy) return;
    setLocalDevBusy(true);
    setNotice("local-dev", null);
    try {
      const { response } = await requestJson(
        apiPath("/_agent-native/auth/local-dev"),
        {
          method: "POST",
          headers: { Accept: "application/json" },
        },
      );
      if (!response.ok) throw new Error("local-dev-auth-failed");
      redirectToSignedInApp();
    } catch {
      setLocalDevBusy(false);
      setLocalDevAvailable(false);
      setFullAuthOptionsVisible(true);
      setNotice("local-dev", { kind: "error", text: t("localDevFailed") });
    }
  }, [apiPath, localDevBusy, redirectToSignedInApp, setNotice, t]);

  const showVerificationStep = React.useCallback(
    (email: string, password: string) => {
      const normalized = normalizeEmail(email);
      pendingSignupPassword.current = password;
      setVerificationEmail(normalized);
      rememberPendingSignupEmail(normalized);
      setNotice("verification", null);
      setView("verification");
      writeStorage(TAB_STORAGE_KEY, "signup");
    },
    [rememberPendingSignupEmail, setNotice],
  );

  const tryPendingSignupLogin = React.useCallback(async () => {
    const email = verificationEmail || readPendingSignupEmail();
    const password = pendingSignupPassword.current;
    if (!email || !password) return { ok: false, needsManualSignIn: true };
    const { response, data } = await requestJson(
      apiPath("/_agent-native/auth/login"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      },
    );
    if (response.ok) {
      removeStorage(pendingEmailStorageKey());
      redirectToSignedInApp();
      return { ok: true, needsManualSignIn: false };
    }
    const error = authErrorText(data, t("finishSignInFailed"));
    return {
      ok: false,
      needsManualSignIn: false,
      error,
      isWaitingForVerification: /not verified|verification/i.test(error),
    };
  }, [
    apiPath,
    pendingEmailStorageKey,
    readPendingSignupEmail,
    redirectToSignedInApp,
    t,
    verificationEmail,
  ]);

  const checkVerification = React.useCallback(
    async (fallbackText?: string) => {
      if (verificationCheckInFlight.current) return;
      verificationCheckInFlight.current = true;
      setNotice("verification", {
        kind: "success",
        text: t("checkingVerification"),
      });
      try {
        const { response, data } = await requestJson(
          apiPath("/_agent-native/auth/session"),
          {
            headers: { Accept: "application/json" },
          },
        );
        if (response.ok && typeof data.email === "string" && !data.error) {
          removeStorage(pendingEmailStorageKey());
          redirectToSignedInApp();
          return;
        }
        const loginResult = await tryPendingSignupLogin();
        if (loginResult.ok) return;
        if (
          loginResult.needsManualSignIn ||
          !loginResult.isWaitingForVerification
        ) {
          setLoginEmail(verificationEmail || readPendingSignupEmail());
          setView("login");
          setNotice("login", {
            kind: "success",
            text: fallbackText || t("enterPasswordAfterVerification"),
          });
          return;
        }
        setNotice("verification", {
          kind: "error",
          text: fallbackText || t("stillWaitingVerification"),
        });
      } catch {
        setNotice("verification", {
          kind: "error",
          text: t("checkVerificationFailed"),
        });
      } finally {
        verificationCheckInFlight.current = false;
      }
    },
    [
      apiPath,
      pendingEmailStorageKey,
      readPendingSignupEmail,
      redirectToSignedInApp,
      setNotice,
      t,
      tryPendingSignupLogin,
      verificationEmail,
    ],
  );

  React.useEffect(() => {
    if (
      !runtimeBasePathResolved ||
      googleOnly ||
      verifiedReturnHandled.current
    ) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get("verified") !== "1") return;
    verifiedReturnHandled.current = true;
    setNotice("login", {
      kind: "success",
      text: t("emailVerifiedFinishing"),
    });
    void checkVerification(t("emailVerifiedSignIn"));
  }, [checkVerification, googleOnly, runtimeBasePathResolved, setNotice, t]);

  React.useEffect(() => {
    if (view !== "verification") return;
    const onFocus = () => void checkVerification();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [checkVerification, view]);

  React.useEffect(() => {
    if (!verificationResendUntil) return;
    const timer = window.setInterval(() => {
      if (Date.now() >= verificationResendUntil) setVerificationResendUntil(0);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [verificationResendUntil]);

  const handleSignup = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const email = normalizeEmail(signupEmail);
      if (!isValidEmail(email)) {
        setNotice("signup", { kind: "error", text: t("invalidEmail") });
        return;
      }
      if (signupPassword !== signupPasswordConfirmation) {
        setNotice("signup", { kind: "error", text: t("passwordsMismatch") });
        return;
      }
      setSubmitting("signup");
      setNotice("signup", null);
      trackAuth(trackingApp, "auth.signup_clicked", {
        surface: "signup",
        method: "password",
        auth_view: view,
      });
      try {
        const { response, data } = await requestJson(
          apiPath("/_agent-native/auth/register"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email,
              password: signupPassword,
              callbackURL: resumeHref(),
            }),
          },
        );
        if (!response.ok) {
          setNotice("signup", {
            kind: "error",
            text: authErrorText(data, t("registrationFailed")),
          });
          return;
        }
        const loginResult = await requestJson(
          apiPath("/_agent-native/auth/login"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password: signupPassword }),
          },
        );
        if (loginResult.response.ok) {
          removeStorage(pendingEmailStorageKey());
          setNotice("signup", {
            kind: "success",
            text: t("accountCreatedSigningIn"),
          });
          redirectToSignedInApp();
          return;
        }
        const loginError = authErrorText(
          loginResult.data,
          t("registrationFailed"),
        );
        if (
          loginResult.response.status === 403 &&
          /not verified|verification/i.test(loginError)
        ) {
          showVerificationStep(email, signupPassword);
          return;
        }
        setNotice("signup", { kind: "error", text: loginError });
      } catch {
        setNotice("signup", {
          kind: "error",
          text: t("networkErrorDashRetry"),
        });
      } finally {
        setSubmitting(null);
      }
    },
    [
      apiPath,
      pendingEmailStorageKey,
      redirectToSignedInApp,
      resumeHref,
      setNotice,
      showVerificationStep,
      signupEmail,
      signupPassword,
      signupPasswordConfirmation,
      t,
      trackingApp,
      view,
    ],
  );

  const handleLogin = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const email = normalizeEmail(loginEmail);
      if (!isValidEmail(email)) {
        setNotice("login", { kind: "error", text: t("invalidEmail") });
        return;
      }
      setSubmitting("login");
      setNotice("login", null);
      trackAuth(trackingApp, "auth.login_clicked", {
        surface: "login",
        method: "password",
        auth_view: view,
      });
      try {
        const { response, data } = await requestJson(
          apiPath("/_agent-native/auth/login"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password: loginPassword }),
          },
        );
        if (response.ok) {
          removeStorage(pendingEmailStorageKey());
          redirectToSignedInApp();
          return;
        }
        setNotice("login", {
          kind: "error",
          text: authErrorText(data, t("invalidLogin")),
        });
      } catch {
        setNotice("login", { kind: "error", text: t("networkErrorDashRetry") });
      } finally {
        setSubmitting(null);
      }
    },
    [
      apiPath,
      loginEmail,
      loginPassword,
      pendingEmailStorageKey,
      redirectToSignedInApp,
      setNotice,
      t,
      trackingApp,
      view,
    ],
  );

  const handleForgot = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const email = normalizeEmail(forgotEmail);
      if (!isValidEmail(email)) {
        setNotice("forgot", { kind: "error", text: t("invalidEmail") });
        return;
      }
      setSubmitting("forgot");
      setNotice("forgot", null);
      try {
        const { response, data } = await requestJson(
          apiPath("/_agent-native/auth/ba/request-password-reset"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          },
        );
        if (response.ok) {
          setForgotSent(true);
          setNotice("forgot", { kind: "success", text: t("resetEmailSent") });
          return;
        }
        setNotice("forgot", {
          kind: "error",
          text: authErrorText(data, t("resetEmailFailed")),
        });
      } catch {
        setNotice("forgot", {
          kind: "error",
          text: t("networkErrorDashRetry"),
        });
      } finally {
        setSubmitting(null);
      }
    },
    [apiPath, forgotEmail, setNotice, t],
  );

  const handleMagicLink = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const email = normalizeEmail(magicLinkEmail);
      if (!isValidEmail(email)) {
        setNotice("magic-link", { kind: "error", text: t("invalidEmail") });
        return;
      }
      setMagicLinkBusy(true);
      setNotice("magic-link", null);
      trackAuth(trackingApp, "auth.signup_clicked", {
        surface: "signup",
        method: "magic_link",
        auth_view: view,
      });
      const desktop = isAgentNativeDesktop();
      try {
        const { response, data } = await requestJson(
          apiPath("/_agent-native/auth/magic-link"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email,
              callbackURL: desktop
                ? apiPath("/_agent-native/auth/magic-link/desktop-callback")
                : resumeHref(),
            }),
          },
        );
        if (!response.ok) {
          setNotice("magic-link", {
            kind: "error",
            text: authErrorText(data, t("magicLinkFailed")),
          });
          return;
        }
        setMagicLinkEmail(email);
        setView("magicLinkSent");
        if (
          desktop &&
          typeof data.flowId === "string" &&
          typeof data.verifier === "string"
        ) {
          oauthFlowId.current = data.flowId;
          startOAuthExchange(
            data.flowId,
            resumeHref(),
            data.verifier,
            "magic-link",
          );
        }
      } catch {
        setNotice("magic-link", {
          kind: "error",
          text: t("networkErrorDashRetry"),
        });
      } finally {
        setMagicLinkBusy(false);
      }
    },
    [
      apiPath,
      magicLinkEmail,
      resumeHref,
      setNotice,
      startOAuthExchange,
      t,
      trackingApp,
      view,
    ],
  );

  const resendVerification = React.useCallback(async () => {
    const email = verificationEmail || readPendingSignupEmail();
    if (!email || verificationResendUntil > Date.now()) return;
    setNotice("verification", null);
    try {
      const { response, data } = await requestJson(
        apiPath("/_agent-native/auth/ba/send-verification-email"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, callbackURL: resumeHref() }),
        },
      );
      if (response.ok) {
        setVerificationResendUntil(Date.now() + 60_000);
        setNotice("verification", {
          kind: "success",
          text: t("sentVerification"),
        });
        return;
      }
      setNotice("verification", {
        kind: "error",
        text: authErrorText(data, t("resendVerificationFailed")),
      });
    } catch {
      setNotice("verification", {
        kind: "error",
        text: t("networkErrorRetry"),
      });
    }
  }, [
    apiPath,
    readPendingSignupEmail,
    resumeHref,
    setNotice,
    t,
    verificationEmail,
    verificationResendUntil,
  ]);

  const selectLocale = React.useCallback(
    (preference: string) => {
      const nextLocale =
        preference === "system"
          ? resolveSystemLocale(localeOptions, defaultLocale)
          : resolveLocale(preference, localeOptions, defaultLocale);
      writeStorage(localeStorageKey, preference);
      setLocalePreference(preference);
      setLocale(nextLocale);
      setLocaleMenuOpen(false);
    },
    [defaultLocale, localeOptions, localeStorageKey],
  );

  const handlePasswordInvalid = React.useCallback(
    (event: React.FormEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      if (input.validity.tooShort)
        input.setCustomValidity(t("passwordMinPlaceholder"));
      else if (input.validity.tooLong)
        input.setCustomValidity(props.passwordMaxCopy);
    },
    [props.passwordMaxCopy, t],
  );
  const clearPasswordValidity = React.useCallback(
    (event: React.FormEvent<HTMLInputElement>) =>
      event.currentTarget.setCustomValidity(""),
    [],
  );

  const copySignupLocalMode = React.useCallback(async () => {
    if (!signupLocalModeNote) return;
    try {
      await navigator.clipboard?.writeText(signupLocalModeNote.command);
      setCopiedLocalMode(true);
      window.setTimeout(() => setCopiedLocalMode(false), 1600);
    } catch {
      // coercion-ok: clipboard permission is optional.
    }
  }, [signupLocalModeNote]);

  const keys = headingKeys(view);
  const marketingCopy = marketing
    ? { ...marketing, ...(marketingLocales[locale] ?? {}) }
    : undefined;
  const cardClassName = [
    "card",
    view === "verification" ? "verifying" : "",
    view === "magicLinkSent" ? "magic-link-complete" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const localModeNote = signupLocalModeNote ? (
    <div
      className="signup-local-mode-note"
      id="signup-local-mode-note"
      data-command={signupLocalModeNote.command}
    >
      <p>{signupLocalModeNote.text}</p>
      <code>{signupLocalModeNote.command}</code>
      <button
        type="button"
        className="copy-run-local"
        id="copy-signup-local-mode"
        data-copy-signup-local-mode="true"
        data-i18n="copyCommand"
        onClick={() => void copySignupLocalMode()}
      >
        {copiedLocalMode ? t("copied") : t("copyCommand")}
      </button>
    </div>
  ) : null;
  const legalNote = signupLegalNotice ? (
    <p className="legal-note">
      <span data-i18n="legalPrefix">
        {signupLegalNotice.prefix ?? t("legalPrefix")}
      </span>{" "}
      <a
        href={signupLegalNotice.termsUrl}
        target="_blank"
        rel="noreferrer"
        data-i18n={signupLegalNotice.termsLabel ? undefined : "legalTerms"}
      >
        {signupLegalNotice.termsLabel ?? t("legalTerms")}
      </a>{" "}
      <span data-i18n="legalConnector">
        {signupLegalNotice.connector ?? t("legalConnector")}
      </span>{" "}
      <a
        href={signupLegalNotice.privacyUrl}
        target="_blank"
        rel="noreferrer"
        data-i18n={signupLegalNotice.privacyLabel ? undefined : "legalPrivacy"}
      >
        {signupLegalNotice.privacyLabel ?? t("legalPrivacy")}
      </a>
      <span data-i18n="legalSuffix">
        {signupLegalNotice.suffix ?? t("legalSuffix")}
      </span>
    </p>
  ) : null;
  const signupForm = (
    <AuthForm
      id="signup-form"
      className={view === "signup" ? "active" : undefined}
      onSubmit={handleSignup}
      fields={[
        {
          id: "s-email",
          label: t("email"),
          labelProps: { "data-i18n": "email" },
          inputProps: {
            type: "email",
            autoComplete: "email",
            placeholder: t("emailPlaceholder"),
            required: true,
            value: signupEmail,
            onChange: (event) => setSignupEmail(event.currentTarget.value),
          },
        },
        {
          id: "s-pass",
          label: t("password"),
          labelProps: { "data-i18n": "password" },
          inputProps: {
            type: "password",
            autoComplete: "new-password",
            placeholder: t("passwordMinPlaceholder"),
            "data-i18n-placeholder": "passwordMinPlaceholder",
            required: true,
            minLength: props.passwordMinLength,
            maxLength: props.passwordMaxLength,
            value: signupPassword,
            onChange: (event) => setSignupPassword(event.currentTarget.value),
            onInvalid: handlePasswordInvalid,
            onInput: clearPasswordValidity,
          },
        },
        {
          id: "s-pass2",
          label: t("confirmPassword"),
          labelProps: { "data-i18n": "confirmPassword" },
          inputProps: {
            type: "password",
            autoComplete: "new-password",
            placeholder: t("confirmPasswordPlaceholder"),
            "data-i18n-placeholder": "confirmPasswordPlaceholder",
            required: true,
            minLength: props.passwordMinLength,
            maxLength: props.passwordMaxLength,
            value: signupPasswordConfirmation,
            onChange: (event) =>
              setSignupPasswordConfirmation(event.currentTarget.value),
            onInvalid: handlePasswordInvalid,
            onInput: clearPasswordValidity,
          },
        },
      ]}
      submitLabel={t("createAccount")}
      submitProps={{
        "data-i18n": "createAccount",
        disabled: submitting === "signup",
      }}
      footer={
        <>
          {legalNote}
          {localModeNote}
        </>
      }
      messageId="s-msg"
      messageClassName={`msg ${messages.signup ? `${messages.signup.kind} show` : ""}`}
      message={messages.signup?.text}
    />
  );
  const identityHref = apiPath("/_agent-native/identity/login");
  const authCard = (
    <div className={cardClassName}>
      <h1 id="heading" data-i18n={keys.heading}>
        {t(keys.heading)}
      </h1>
      <p id="subtitle" className="subtitle" data-i18n={keys.subtitle}>
        {t(keys.subtitle)}
      </p>
      <p
        className={`upgrade-note ${upgradeVisible ? "show" : ""}`}
        id="upgrade-note"
        data-upgrade-copy={t("upgradeCopy")}
        data-i18n-data-upgrade-copy="upgradeCopy"
      >
        {upgradeVisible ? t("upgradeCopy") : null}
      </p>
      {identitySsoEnabled ? (
        <a
          className="btn-identity-sso"
          id="identity-sso-btn"
          href={identityHref}
          onClick={(event) => {
            event.preventDefault();
            const params = new URLSearchParams({ return: resumeHref() });
            window.location.href = `${identityHref}?${params.toString()}`;
          }}
        >
          Sign in with Agent-Native
        </a>
      ) : null}
      <div
        className="local-dev-signin"
        id="local-dev-signin"
        hidden={!localDevAvailable}
      >
        <button
          type="button"
          className="btn-local-dev btn-primary"
          id="local-dev-btn"
          title={t("localDevDescription")}
          data-i18n="localDevButton"
          data-i18n-title="localDevDescription"
          aria-describedby="local-dev-description"
          disabled={localDevBusy}
          onClick={() => void handleLocalDev()}
        >
          {localDevBusy ? t("localDevSigningIn") : t("localDevButton")}
        </button>
        <p className="local-dev-description" id="local-dev-description">
          <span data-i18n="localDevDescription">
            {t("localDevDescription")}
          </span>
          <a
            className="local-dev-help"
            id="local-dev-help"
            href={docsAuthUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={t("localDevHelp")}
            title={t("localDevHelp")}
            data-i18n-title="localDevHelp"
            data-i18n-aria-label="localDevHelp"
          >
            <span className="local-dev-help-glyph" aria-hidden="true">
              ?
            </span>
          </a>
        </p>
        <button
          type="button"
          className="local-dev-full-options"
          id="local-dev-full-options"
          hidden={fullAuthOptionsVisible}
          data-i18n="localDevFullOptions"
          onClick={() => setFullAuthOptionsVisible(true)}
        >
          {t("localDevFullOptions")}
        </button>
        {notice("local-dev")}
      </div>
      <div
        id="full-auth-options"
        className="full-auth-options"
        hidden={!fullAuthOptionsVisible}
      >
        {googleOnly && !showGoogle ? (
          <p
            className="google-error show"
            id="google-err"
            role="status"
            data-i18n="googleNotConfigured"
          >
            {t("googleNotConfigured")}
          </p>
        ) : null}
        {showGoogle ? (
          <div className="google-signin" id="google-signin">
            <button
              className={`btn-google ${view === "magicLink" && isValidEmail(magicLinkEmail) ? "magic-link-secondary" : ""}`}
              id="google-btn"
              type="button"
              disabled={googleBusy}
              onClick={() => void startGoogle()}
            >
              {googleSvg()}
              <span data-i18n="googleButton">{t("googleButton")}</span>
            </button>
            {notice("google")}
            <p className="google-debug" id="google-debug" />
          </div>
        ) : null}
        {!googleOnly && showGoogle ? (
          <div className="divider" id="auth-divider" data-i18n="dividerOr">
            {t("dividerOr")}
          </div>
        ) : null}
        {!googleOnly && authMode === "magic-link" ? (
          <form
            id="magic-link-form"
            className={`form ${view === "magicLink" ? "active" : ""}`}
            onSubmit={handleMagicLink}
          >
            <label htmlFor="m-email" data-i18n="email">
              {t("email")}
            </label>
            <input
              id="m-email"
              type="email"
              autoComplete="email"
              placeholder={t("emailPlaceholder")}
              required
              value={magicLinkEmail}
              onChange={(event) => setMagicLinkEmail(event.currentTarget.value)}
            />
            <button
              type="submit"
              id="magic-link-submit"
              className="magic-link-submit"
              disabled={magicLinkBusy || !isValidEmail(magicLinkEmail)}
              data-i18n="sendMagicLink"
            >
              {magicLinkBusy ? t("sending") : t("sendMagicLink")}
            </button>
            {notice("magic-link")}
            {legalNote}
            <p
              style={{
                marginTop: "0.75rem",
                fontSize: "0.75rem",
                textAlign: "start",
              }}
            >
              <button
                type="button"
                className="link-button auth-mode-link"
                id="use-password-link"
                data-i18n="usePasswordInstead"
                onClick={() => setView("login")}
              >
                {t("usePasswordInstead")}
              </button>
            </p>
          </form>
        ) : null}
        {authMode === "magic-link" ? (
          <div
            className={`magic-link-success ${view === "magicLinkSent" ? "is-visible" : ""}`}
            id="magic-link-success"
            aria-live="polite"
            hidden={view !== "magicLinkSent"}
          >
            <p className="magic-link-success-copy">
              <span data-i18n="magicLinkSentCopy">
                {t("magicLinkSentCopy")}
              </span>{" "}
              <strong id="magic-link-success-email">{magicLinkEmail}</strong>.
            </p>
            <button
              type="button"
              className="link-button magic-link-back"
              id="magic-link-back"
              data-i18n="back"
              onClick={() => {
                setMagicLinkEmail("");
                setView("magicLink");
              }}
            >
              {t("back")}
            </button>
          </div>
        ) : null}
        {!googleOnly ? (
          <div
            className="tabs"
            id="auth-tabs"
            hidden={view === "magicLink" || view === "magicLinkSent"}
          >
            <button
              className={`tab ${view === "signup" ? "active" : ""}`}
              type="button"
              data-tab="signup"
              data-i18n="createAccount"
              onClick={() => {
                setView("signup");
                writeStorage(TAB_STORAGE_KEY, "signup");
              }}
            >
              {t("createAccount")}
            </button>
            <button
              className={`tab ${view === "login" || view === "forgot" ? "active" : ""}`}
              type="button"
              data-tab="login"
              data-i18n="signIn"
              onClick={() => {
                setView("login");
                writeStorage(TAB_STORAGE_KEY, "login");
              }}
            >
              {t("signIn")}
            </button>
          </div>
        ) : null}
        {!googleOnly ? signupForm : null}
        <div
          id="verification-step"
          className={`form verification-step ${view === "verification" ? "active" : ""}`}
          aria-live="polite"
        >
          <div
            className="step-progress"
            aria-label={t("signupProgress")}
            data-i18n-aria-label="signupProgress"
          >
            <div className="progress-step complete">
              <span>1</span>
              <strong data-i18n="progressAccount">
                {t("progressAccount")}
              </strong>
            </div>
            <div className="progress-step current">
              <span>2</span>
              <strong data-i18n="progressVerify">{t("progressVerify")}</strong>
            </div>
            <div className="progress-step">
              <span>3</span>
              <strong data-i18n="progressStart">{t("progressStart")}</strong>
            </div>
          </div>
          <div className="verification-panel">
            <p className="verification-kicker" data-i18n="verificationSent">
              {t("verificationSent")}
            </p>
            <p className="verification-copy">
              <span data-i18n="verifyCopyPrefix">{t("verifyCopyPrefix")}</span>{" "}
              <strong id="verify-email">{verificationEmail}</strong>
              <span data-i18n="verifyCopySuffix">{t("verifyCopySuffix")}</span>
            </p>
            <p className="verification-note" data-i18n="verificationNote">
              {t("verificationNote")}
            </p>
          </div>
          <button
            type="button"
            className="btn-primary"
            id="verify-continue"
            data-i18n="continue"
            onClick={() => void checkVerification()}
          >
            {t("continue")}
          </button>
          <div className="inline-actions">
            <button
              type="button"
              className="link-button"
              id="resend-verification"
              disabled={verificationResendUntil > Date.now()}
              data-i18n="resendEmail"
              onClick={() => void resendVerification()}
            >
              {t("resendEmail")}
              {verificationResendUntil > Date.now()
                ? ` (${Math.ceil((verificationResendUntil - Date.now()) / 1000)}s)`
                : ""}
            </button>
            <button
              type="button"
              className="link-button"
              id="back-to-signup"
              data-i18n="back"
              onClick={() => {
                removeStorage(pendingEmailStorageKey());
                setView("signup");
              }}
            >
              {t("back")}
            </button>
          </div>
          {notice("verification")}
        </div>
        <form
          id="login-form"
          className={`form ${view === "login" ? "active" : ""}`}
          onSubmit={handleLogin}
        >
          <label htmlFor="l-email" data-i18n="email">
            {t("email")}
          </label>
          <input
            id="l-email"
            type="email"
            autoComplete="email"
            placeholder={t("emailPlaceholder")}
            required
            value={loginEmail}
            onChange={(event) => setLoginEmail(event.currentTarget.value)}
          />
          <label htmlFor="l-pass" data-i18n="password">
            {t("password")}
          </label>
          <input
            id="l-pass"
            type="password"
            autoComplete="current-password"
            placeholder={t("enterPasswordPlaceholder")}
            data-i18n-placeholder="enterPasswordPlaceholder"
            required
            value={loginPassword}
            onChange={(event) => setLoginPassword(event.currentTarget.value)}
            onInvalid={handlePasswordInvalid}
            onInput={clearPasswordValidity}
          />
          <button
            type="submit"
            data-i18n="signIn"
            disabled={submitting === "login"}
          >
            {submitting === "login" ? t("signingIn") : t("signIn")}
          </button>
          {notice("login")}
          <p
            style={{
              marginTop: "0.75rem",
              fontSize: "0.75rem",
              textAlign: "right",
            }}
          >
            <button
              type="button"
              id="forgot-link"
              className="link-button"
              data-i18n="forgotPassword"
              onClick={() => {
                setForgotEmail(loginEmail);
                setView("forgot");
              }}
            >
              {t("forgotPassword")}
            </button>
          </p>
          {authMode === "magic-link" ? (
            <p
              style={{
                marginTop: "0.5rem",
                fontSize: "0.75rem",
                textAlign: "center",
              }}
            >
              <button
                type="button"
                className="link-button"
                id="back-to-magic-link"
                data-i18n="backToMagicLink"
                onClick={() => setView("magicLink")}
              >
                {t("backToMagicLink")}
              </button>
            </p>
          ) : null}
        </form>
        <form
          id="forgot-form"
          className={`form ${view === "forgot" ? "active" : ""}`}
          onSubmit={handleForgot}
        >
          <label htmlFor="f-email" data-i18n="email">
            {t("email")}
          </label>
          <input
            id="f-email"
            type="email"
            autoComplete="email"
            placeholder={t("emailPlaceholder")}
            required
            value={forgotEmail}
            onChange={(event) => setForgotEmail(event.currentTarget.value)}
          />
          <button
            type="submit"
            data-i18n="sendResetLink"
            disabled={forgotSent || submitting === "forgot"}
          >
            {forgotSent
              ? t("sent")
              : submitting === "forgot"
                ? t("sending")
                : t("sendResetLink")}
          </button>
          {notice("forgot")}
          <p
            style={{
              marginTop: "0.75rem",
              fontSize: "0.75rem",
              textAlign: "center",
            }}
          >
            <button
              type="button"
              className="link-button"
              id="back-to-login"
              data-i18n="backToSignIn"
              onClick={() => setView("login")}
            >
              {t("backToSignIn")}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
  const localNote = (
    <p
      className={`local-note ${localNoteVisible ? "show" : ""}`}
      id="local-note"
    >
      <span data-i18n="localNotePrefix">{t("localNotePrefix")}</span> (
      <strong>{connectionLabel}</strong>)
      <span data-i18n="localNoteSuffix">{t("localNoteSuffix")}</span>
    </p>
  );
  const localePicker = (
    <div className="locale-picker">
      <button
        type="button"
        className="locale-trigger"
        id="auth-locale-trigger"
        aria-haspopup="menu"
        aria-expanded={localeMenuOpen}
        aria-controls="auth-locale-menu"
        aria-label={t("languageLabel")}
        title={t("languageLabel")}
        data-i18n-aria-label="languageLabel"
        data-i18n-title="languageLabel"
        onClick={() => setLocaleMenuOpen((open) => !open)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5h7" />
          <path d="M7.5 4v1" />
          <path d="M9.5 5c-.8 4.4-2.6 7.2-5.5 9" />
          <path d="M5 9c1.2 2.1 3.2 3.8 6 5" />
          <path d="M13 20l4-9 4 9" />
          <path d="M14.5 17h5" />
        </svg>
      </button>
      <div
        className="locale-menu"
        id="auth-locale-menu"
        role="menu"
        aria-labelledby="auth-locale-trigger"
        hidden={!localeMenuOpen}
      >
        <button
          type="button"
          className="locale-menu-item"
          role="menuitemradio"
          aria-checked={localePreference === "system"}
          data-locale-value="system"
          onClick={() => selectLocale("system")}
        >
          <span className="locale-menu-check" aria-hidden="true">
            ✓
          </span>
          <span data-system-language>{t("systemLanguage")}</span>
        </button>
        {localeOptions.map((option) => (
          <button
            type="button"
            className="locale-menu-item"
            role="menuitemradio"
            aria-checked={localePreference === option.value}
            data-locale-value={option.value}
            key={option.value}
            onClick={() => selectLocale(option.value)}
          >
            <span className="locale-menu-check" aria-hidden="true">
              ✓
            </span>
            <span>{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
  const environmentBadge = (
    <div
      className="environment-switcher"
      id="environment-switcher"
      hidden={!environmentVisible}
    >
      <button
        type="button"
        className="environment-badge"
        id="environment-badge"
        aria-expanded={environmentOpen}
        aria-controls="environment-popover"
        onClick={() => setEnvironmentOpen((open) => !open)}
      >
        beta
      </button>
      <div
        className="environment-popover"
        id="environment-popover"
        role="dialog"
        aria-labelledby="environment-popover-title"
        hidden={!environmentOpen}
      >
        <div
          className="environment-popover-title"
          id="environment-popover-title"
        >
          You're on Agent-Native Beta
        </div>
        <div className="environment-popover-copy">
          Choose where you want to continue.
        </div>
        <a
          className="environment-production-link"
          id="environment-production-link"
          href={environmentProductionUrl}
        >
          Switch to production
        </a>
        <button
          type="button"
          className="environment-hide-badge"
          id="environment-hide-badge"
          onClick={() => {
            setEnvironmentOpen(false);
            setEnvironmentVisible(false);
          }}
        >
          Hide badge
        </button>
      </div>
    </div>
  );
  const marketingSurface = marketingCopy ? (
    <MarketingHome
      appName={marketingCopy.appName}
      variant="auth"
      background={<Starfield id="starfield" />}
      auth={
        <>
          {authCard}
          {localNote}
        </>
      }
      className="auth-marketing-home"
    >
      <div className="marketing-content">
        <h2 className="app-name">
          <img
            className="brand-mark"
            src={brandMarkSrc}
            alt=""
            aria-hidden="true"
          />
          <span>{marketingCopy.appName}</span>
        </h2>
        <p className="app-tagline" data-marketing-field="tagline">
          {marketingCopy.tagline}
        </p>
        {marketingCopy.description ? (
          <p className="app-desc" data-marketing-field="description">
            {marketingCopy.description}
          </p>
        ) : null}
        {marketingCopy.features?.length ? (
          <ul className="feature-list">
            {marketingCopy.features.map((feature, index) => (
              <li key={index} data-marketing-feature-index={index}>
                {feature}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="marketing-actions">
          <a
            className="oss-link"
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 00-1.3-3.2 4.2 4.2 0 00-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 00-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 00-.1 3.2A4.6 4.6 0 004 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />
            </svg>
            <span data-i18n="openSource">{t("openSource")}</span>
          </a>
        </div>
      </div>
    </MarketingHome>
  ) : (
    <>
      <div className="auth-centered">{authCard}</div>
      {localNote}
    </>
  );

  return (
    <>
      {localePicker}
      {environmentBadge}
      {initialPrompt ? (
        <div className="auth-centered">{authCard}</div>
      ) : (
        marketingSurface
      )}
    </>
  );
}
