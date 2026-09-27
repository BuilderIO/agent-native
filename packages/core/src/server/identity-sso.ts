import { createHash, randomBytes } from "node:crypto";

import type { H3Event } from "h3";
import { deleteCookie, getCookie, getHeader, getMethod, setCookie } from "h3";
import * as jose from "jose";

import { canonicalA2AAudience, signA2AToken } from "../a2a/index.js";
import { getAppConfig } from "../app-config/index.js";
import { acceptPendingInvitationsForEmail } from "../org/accept-pending.js";
import {
  authProviderRequiredMessage,
  GOOGLE_AUTH_REQUIRED_MESSAGE,
  getRequiredAuthProviderForEmail,
  isGoogleSignInRequiredForEmail,
} from "../org/auth-policy.js";
import {
  normalizeAppPath,
  SIGN_IN_ENTRY_PATH,
} from "../shared/sign-in-journey.js";
import { getConfiguredAppBasePath } from "./app-base-path.js";
import {
  addSignupAttributionHeader,
  signupAttributionContextFromCookieHeader,
} from "./attribution.js";
import {
  getBetterAuth,
  getBetterAuthInternalAdapter,
} from "./better-auth-instance.js";
import { resolveAuthCookieNamespace } from "./cookie-namespace.js";
import { readDeployCredentialEnv } from "./credential-provider.js";
import { publicFrameworkPath } from "./framework-route-prefix.js";
import { createOAuthSession, getAppUrl, getOrigin } from "./google-oauth.js";
import { hasIdentityGoogleAuthCookie } from "./identity-auth-provider.js";
import { IDENTITY_SSO_PROVIDER_ID } from "./identity-sso-provider.js";
import {
  consumeSsoState,
  createSsoState,
  CANONICAL_IDENTITY_SSO_HUB_URL,
  NETLIFY_PREVIEW_IDENTITY_SSO_HUB_URL,
  getIdentityHubUrl,
  identitySsoLoginButtonHtml,
  isCanonicalIdentitySsoClientRequest,
  isDesktopSsoUserAgent,
  isIdentitySsoExplicitlyEnabled,
  isIdentitySsoEnabled,
  isNetlifyDeployPermalinkIdentitySsoClientRequest,
  isJtiReplayed,
  SSO_STATE_TTL_MS,
} from "./identity-sso-store.js";
import {
  getRequestContext,
  hasContinuationLocalRequestContext,
  runWithRequestContext,
} from "./request-context.js";

export { getIdentityHubUrl, identitySsoLoginButtonHtml, isIdentitySsoEnabled };

export { IDENTITY_SSO_PROVIDER_ID };
export const IDENTITY_SSO_SCOPE = "identity";
export const IDENTITY_SSO_DESKTOP_COMPLETE_PATH =
  "/_agent-native/identity/desktop-complete";
export const IDENTITY_SSO_CALLBACK_PATH = "/_agent-native/identity/callback";
export const IDENTITY_SSO_TOKEN_PATH = "/_agent-native/identity/token";
export const IDENTITY_SSO_BOOTSTRAP_PATH = "/_agent-native/identity/bootstrap";
export const IDENTITY_SSO_BOOTSTRAP_ACTIVATE_PATH = `${IDENTITY_SSO_BOOTSTRAP_PATH}/activate`;
export const IDENTITY_SSO_BOOTSTRAP_SCOPE = "identity-bootstrap";
export const IDENTITY_SSO_BOOTSTRAP_BINDING_COOKIE =
  "an_identity_bootstrap_binding";
const IDENTITY_SSO_BOOTSTRAP_BINDING_TTL_SECONDS = 2 * 60;

const DESKTOP_COMPLETION_NONCE = /^[A-Za-z0-9_-]{32,128}$/;
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CODE = /^[A-Za-z0-9_-]{43}$/;
const CODE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const SSO_VERIFIER_COOKIE_PREFIX = "agent_native_sso_verifier_";
const MAX_ASSERTION_AGE_SECONDS = 5 * 60;
const MAX_BOOTSTRAP_NAME_LENGTH = 200;
const ORG_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function safeReturnPath(raw: string | null | undefined): string {
  return normalizeAppPath(raw) ?? "/";
}

async function getSessionForEvent(event: H3Event) {
  const { getSession } = await import("./auth.js");
  return getSession(event);
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function redirect(event: H3Event, location: string): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    Location: location,
    "Referrer-Policy": "no-referrer",
  });
  const staged = (event as any).res?.headers?.getSetCookie?.() ?? [];
  for (const cookie of staged) headers.append("set-cookie", cookie);
  return new Response("", { status: 302, headers });
}

function errorPage(message: string, loginPath: string): Response {
  const safe = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const safeHref = loginPath.replace(/"/g, "&quot;");
  return html(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>Sign-in failed</title>` +
      `<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;` +
      `background:#09090b;color:#f4f4f5;display:flex;align-items:center;` +
      `justify-content:center;min-height:100vh;margin:0;padding:1rem}` +
      `.card{max-width:420px;padding:2rem;background:#141417;` +
      `border:1px solid rgba(255,255,255,0.1);border-radius:12px;text-align:center}` +
      `h1{font-size:1.15rem;margin:0 0 .5rem}p{color:#a1a1aa;font-size:.9rem;margin:0 0 1.25rem}` +
      `a{color:#f4f4f5;font-weight:600;text-decoration:none;border:1px solid ` +
      `rgba(255,255,255,0.18);border-radius:8px;padding:.6rem 1.1rem;display:inline-block}</style>` +
      `</head><body><div class="card"><h1>Could not sign you in</h1>` +
      `<p>${safe}</p><a href="${safeHref}">Back to sign in</a></div></body></html>`,
    400,
  );
}

function createUnusableSsoCredential(): string {
  return `an-sso_${randomBytes(32).toString("base64url")}`;
}

function normalizeAuthority(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && LOCALHOST_HOSTS.has(url.hostname))) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, "");
  } catch (error) {
    void error;
    return null;
  }
}

export function resolveIdentitySsoAppId(event: H3Event): string {
  const app = getAppConfig().app;
  const configured = app.id ?? app.workspaceId;
  if (configured) return configured;
  const name = getAppConfig().app.name;
  if (name && name !== "app") return name;
  try {
    return new URL(getOrigin(event)).hostname.split(".")[0] || "app";
  } catch {
    return "app";
  }
}

function resolveClientId(appId: string): string {
  return process.env.AGENT_NATIVE_SSO_CLIENT_ID?.trim() || appId;
}

function verifierCookieName(state: string): string {
  return `${SSO_VERIFIER_COOKIE_PREFIX}${state}`;
}

function createPkceVerifier(): string {
  return randomBytes(48).toString("base64url");
}

function createPkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function publicIdentitySsoPath(path: string): string {
  return publicFrameworkPath(`${getConfiguredAppBasePath()}${path}`);
}

function requestUrl(event: H3Event): string {
  return (event as any).node?.req?.url ?? event.path ?? "/";
}

function setPkceVerifierCookie(
  event: H3Event,
  state: string,
  verifier: string,
  secure: boolean,
): void {
  setCookie(event, verifierCookieName(state), verifier, {
    httpOnly: true,
    maxAge: Math.floor(SSO_STATE_TTL_MS / 1_000),
    path: publicIdentitySsoPath(IDENTITY_SSO_CALLBACK_PATH),
    sameSite: "lax",
    secure,
  });
}

function identitySsoBootstrapCookieAttrs(
  event: H3Event,
  hub?: string,
): { domain?: string } | null {
  const rawHost = getHeader(event, "host")?.trim();
  if (!rawHost) return null;
  let host: string;
  try {
    host = new URL(`http://${rawHost}`).hostname.toLowerCase();
  } catch (error) {
    void error;
    return null;
  }

  let hubHost: string | undefined;
  if (hub) {
    try {
      hubHost = new URL(hub).hostname.toLowerCase();
    } catch (error) {
      void error;
      return null;
    }
  }

  const configuredDomain = resolveAuthCookieNamespace()
    .configuredCookieDomain?.replace(/^\.+/, "")
    .toLowerCase();
  const sharedDomain =
    host === "agent-native.com" || host.endsWith(".agent-native.com")
      ? "agent-native.com"
      : configuredDomain &&
          (host === configuredDomain || host.endsWith(`.${configuredDomain}`))
        ? configuredDomain
        : undefined;
  if (sharedDomain) {
    if (
      hubHost &&
      hubHost !== sharedDomain &&
      !hubHost.endsWith(`.${sharedDomain}`)
    ) {
      return {};
    }
    return { domain: `.${sharedDomain}` };
  }
  return {};
}

export function canIdentitySsoBootstrapBindingCookieReachHub(
  event: H3Event,
  hub: string,
): boolean {
  const attrs = identitySsoBootstrapCookieAttrs(event, hub);
  if (!attrs) return false;
  if (attrs.domain) return true;
  try {
    return (
      new URL(`http://${getHeader(event, "host")}`).hostname ===
      new URL(hub).hostname
    );
  } catch (error) {
    void error;
    return false;
  }
}

export function setIdentitySsoBootstrapBindingCookie(
  event: H3Event,
  binding: string,
  hub: string,
): boolean {
  if (!STATE_PATTERN.test(binding)) return false;
  const attrs = identitySsoBootstrapCookieAttrs(event, hub);
  if (!attrs) return false;
  setCookie(event, IDENTITY_SSO_BOOTSTRAP_BINDING_COOKIE, binding, {
    ...attrs,
    httpOnly: true,
    maxAge: IDENTITY_SSO_BOOTSTRAP_BINDING_TTL_SECONDS,
    path: IDENTITY_SSO_BOOTSTRAP_PATH,
    sameSite: "lax",
    secure:
      process.env.NODE_ENV === "production" ||
      getHeader(event, "x-forwarded-proto") === "https",
  });
  return true;
}

export function getIdentitySsoBootstrapBindingCookie(
  event: H3Event,
): string | null {
  return getCookie(event, IDENTITY_SSO_BOOTSTRAP_BINDING_COOKIE) ?? null;
}

export function clearIdentitySsoBootstrapBindingCookie(event: H3Event): void {
  const attrs = identitySsoBootstrapCookieAttrs(event);
  if (!attrs) return;
  deleteCookie(event, IDENTITY_SSO_BOOTSTRAP_BINDING_COOKIE, {
    ...attrs,
    path: IDENTITY_SSO_BOOTSTRAP_PATH,
  });
}

function inlineJson(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function identitySsoBridgePage(
  event: H3Event,
  options: {
    frameUrl: string;
    hubOrigin: string;
    completeField: "redirect_uri" | "return_url";
  },
): Response {
  const bindingUrl = getAppUrl(event, `${IDENTITY_SSO_BOOTSTRAP_PATH}/binding`);
  const frameUrl = inlineJson(options.frameUrl);
  const bindingUrlLiteral = inlineJson(bindingUrl);
  const hubOrigin = inlineJson(options.hubOrigin);
  const completeField = inlineJson(options.completeField);
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Continuing sign-in</title></head><body><iframe id="identity-sso-bridge" title="Continuing sign-in" src=${frameUrl} style="width:1px;height:1px;border:0;position:absolute;opacity:0" aria-hidden="true"></iframe><script>(()=>{const f=document.getElementById("identity-sso-bridge"),h=${hubOrigin},b=${bindingUrlLiteral},field=${completeField};if(!f)return;const fail=()=>{document.body.textContent="Could not finish sign-in. Please return and try again."};window.addEventListener("message",async e=>{if(e.source!==f.contentWindow||e.origin!==h)return;if(e.data?.type==="agent-native-identity-bridge-ready"){try{const r=await fetch(b,{credentials:"same-origin",cache:"no-store"}),v=await r.json();if(!r.ok||typeof v.binding!=="string")throw new Error();f.contentWindow?.postMessage({type:"agent-native-identity-bridge-binding",binding:v.binding},h)}catch{fail()}}else if(e.data?.type==="agent-native-identity-bridge-complete"){const value=e.data?.[field];try{const u=new URL(value,window.location.origin);if(u.origin!==window.location.origin)throw new Error();window.top?.location.replace(u.toString())}catch{fail()}}});})();</script></body></html>`,
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Security-Policy": `default-src 'none'; connect-src 'self'; frame-src ${options.hubOrigin}; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'`,
        "Content-Type": "text/html; charset=utf-8",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}

function addBridgeParams(url: string, sourceOrigin: string): string {
  const bridged = new URL(url);
  bridged.searchParams.set("bridge", "1");
  bridged.searchParams.set("source_origin", sourceOrigin);
  return bridged.toString();
}

function clearPkceVerifierCookie(event: H3Event, state: string): void {
  deleteCookie(event, verifierCookieName(state), {
    path: publicIdentitySsoPath(IDENTITY_SSO_CALLBACK_PATH),
  });
}

interface SsoClientBinding {
  appId: string;
  clientId: string;
  redirectUri: string;
  authority: string;
}

function resolveIdentitySsoClientOrigin(event: H3Event): string {
  const host = getHeader(event, "host")?.trim();
  if (
    host &&
    isNetlifyDeployPermalinkIdentitySsoClientRequest(
      host,
      getHeader(event, "x-forwarded-proto"),
    )
  ) {
    return `https://${host.toLowerCase()}`;
  }
  return getOrigin(event);
}

function resolveClientBinding(
  event: H3Event,
  hub: string,
): SsoClientBinding | null {
  const appId = resolveIdentitySsoAppId(event);
  const clientId = resolveClientId(appId);
  const redirectUri = `${resolveIdentitySsoClientOrigin(event)}${publicIdentitySsoPath(IDENTITY_SSO_CALLBACK_PATH)}`;
  const authority = normalizeAuthority(hub);
  if (!authority || !appId || !clientId || !redirectUri) return null;
  return { appId, clientId, redirectUri, authority };
}

export function resolveIdentityHubUrl(event: H3Event): string | undefined {
  const configured = isIdentitySsoExplicitlyEnabled()
    ? getIdentityHubUrl()
    : undefined;
  if (configured) return configured;
  if (
    isCanonicalIdentitySsoClientRequest(
      getHeader(event, "host"),
      getHeader(event, "x-forwarded-proto"),
    )
  ) {
    return CANONICAL_IDENTITY_SSO_HUB_URL;
  }
  if (
    !isDesktopSsoUserAgent(getHeader(event, "user-agent")) &&
    isNetlifyDeployPermalinkIdentitySsoClientRequest(
      getHeader(event, "host"),
      getHeader(event, "x-forwarded-proto"),
    )
  ) {
    return NETLIFY_PREVIEW_IDENTITY_SSO_HUB_URL;
  }
  if (!isDesktopSsoUserAgent(getHeader(event, "user-agent"))) {
    return undefined;
  }
  try {
    if (
      !isCanonicalIdentitySsoClientRequest(
        getHeader(event, "host"),
        getHeader(event, "x-forwarded-proto"),
      )
    ) {
      return undefined;
    }
    return CANONICAL_IDENTITY_SSO_HUB_URL;
  } catch (error) {
    void error;
    return undefined;
  }
}

interface VerifiedIdentity {
  email: string;
  name: string;
  orgDomain?: string;
  orgId?: string;
  orgName?: string;
  orgRole?: "owner" | "admin" | "member";
  orgIcon?: import("../icons/index.js").IconValue | null;
  orgIconRevision?: number;
  authProvider?: "google" | `sso:${string}`;
  sub: string;
  jti: string;
}

async function verifyIdentityAssertion(
  assertion: string,
  binding: SsoClientBinding,
): Promise<VerifiedIdentity | null> {
  const secret = process.env.A2A_SECRET;
  if (!secret || !assertion) return null;
  try {
    const { payload } = await jose.jwtVerify(
      assertion,
      new TextEncoder().encode(secret),
      { audience: binding.redirectUri },
    );
    if (payload.scope !== IDENTITY_SSO_SCOPE) return null;
    if (payload.identity_client_id !== binding.clientId) return null;
    if (payload.redirect_uri !== binding.redirectUri) return null;
    if (payload.identity_authority !== binding.authority) return null;
    const issuer =
      typeof payload.iss === "string" ? normalizeAuthority(payload.iss) : null;
    if (issuer !== binding.authority) return null;
    const email =
      typeof payload.email === "string" && payload.email.includes("@")
        ? payload.email.trim().toLowerCase()
        : null;
    if (!email) return null;
    const iat = typeof payload.iat === "number" ? payload.iat : null;
    if (
      iat == null ||
      iat > Date.now() / 1_000 + 60 ||
      Date.now() / 1_000 - iat > MAX_ASSERTION_AGE_SECONDS
    ) {
      return null;
    }
    const jti = typeof payload.jti === "string" ? payload.jti : "";
    if (!jti) return null;
    const orgId =
      typeof payload.org_id === "string" && payload.org_id.trim()
        ? payload.org_id.trim()
        : undefined;
    const orgName =
      typeof payload.org_name === "string" && payload.org_name.trim()
        ? payload.org_name.trim()
        : undefined;
    const orgRole =
      payload.org_role === "owner" ||
      payload.org_role === "admin" ||
      payload.org_role === "member"
        ? payload.org_role
        : undefined;
    let orgIcon: import("../icons/index.js").IconValue | null | undefined;
    const orgIconRevision = payload.org_icon_revision;
    if (payload.org_icon !== undefined) {
      const { safeParseIconValue } = await import("../icons/index.js");
      const parsedIcon = safeParseIconValue(payload.org_icon);
      if (!parsedIcon.success) return null;
      orgIcon = parsedIcon.data;
      if (
        !Number.isSafeInteger(orgIconRevision) ||
        Number(orgIconRevision) < 0
      ) {
        return null;
      }
    }
    if ((orgId || orgName || orgRole) && (!orgId || !orgName || !orgRole)) {
      return null;
    }
    const identityAuthProvider = payload.identity_auth_provider;
    const authProvider =
      identityAuthProvider === "google"
        ? ("google" as const)
        : typeof identityAuthProvider === "string" &&
            /^sso:[^:]+$/.test(identityAuthProvider)
          ? (identityAuthProvider as `sso:${string}`)
          : undefined;
    return {
      email,
      name:
        typeof payload.name === "string" && payload.name.trim()
          ? payload.name.trim()
          : "",
      orgDomain:
        typeof payload.org_domain === "string" && payload.org_domain
          ? payload.org_domain
          : undefined,
      ...(orgId ? { orgId } : {}),
      ...(orgName ? { orgName } : {}),
      ...(orgRole ? { orgRole } : {}),
      ...(orgIcon !== undefined
        ? { orgIcon, orgIconRevision: Number(orgIconRevision) }
        : {}),
      ...(authProvider ? { authProvider } : {}),
      sub: typeof payload.sub === "string" && payload.sub ? payload.sub : email,
      jti,
    };
  } catch (error) {
    void error;
    return null;
  }
}

async function exchangeIdentityCode(
  hub: string,
  binding: SsoClientBinding,
  input: { code: string; state: string; codeVerifier: string },
): Promise<{ assertion: string; bootstrapActivation?: string } | null> {
  if (!CODE.test(input.code) || !STATE_PATTERN.test(input.state)) return null;
  if (!CODE_VERIFIER.test(input.codeVerifier)) return null;
  const tokenEndpoint = `${hub}${IDENTITY_SSO_TOKEN_PATH}`;
  try {
    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: input.code,
        state: input.state,
        app_id: binding.appId,
        client_id: binding.clientId,
        redirect_uri: binding.redirectUri,
        code_verifier: input.codeVerifier,
      }),
      redirect: "error",
    });
    if (!response.ok) return null;
    const body = (await response.json().catch((error) => {
      void error;
      return null;
    })) as Record<string, unknown> | null;
    if (typeof body?.assertion !== "string") return null;
    return {
      assertion: body.assertion,
      ...(typeof body.bootstrap_activation === "string"
        ? { bootstrapActivation: body.bootstrap_activation }
        : {}),
    };
  } catch (error) {
    void error;
    return null;
  }
}

/**
 * Ensure an authority-issued identity has a local Better Auth account.
 *
 * Provisioning goes through the password signup ceremony because that is the
 * only public API that runs Better Auth's user hooks, which leaves behind an
 * unusable credential the person never chose. Pass `emailVerified` whenever the
 * authority proved control of the address: without it the row stays unverified
 * forever, because the verification email points at a password nobody set. An
 * unverified row is not a cosmetic detail, it withholds pending invitations and
 * domain auto-join.
 */
export async function ensureIdentityUser(
  email: string,
  name?: string,
  signupHeaders?: Headers,
  options?: { emailVerified?: boolean },
): Promise<{
  id: string;
  emailVerified: boolean;
  accounts: Array<{ providerId: string; accountId: string }>;
}> {
  const adapter = await getBetterAuthInternalAdapter();
  if (!adapter) throw new Error("Local account storage is unavailable.");

  let existing = await adapter.findUserByEmail(email, {
    includeAccounts: true,
  });

  if (!existing) {
    const auth = await getBetterAuth();
    try {
      await auth.api.signUpEmail({
        body: {
          email,
          password: createUnusableSsoCredential(),
          name: name || email.split("@")[0] || "User",
        },
        ...(signupHeaders ? { headers: signupHeaders } : {}),
      });
    } catch (error) {
      const { isExpectedAuthFailure } = await import("./auth.js");
      if (!isExpectedAuthFailure(error)) throw error;
    }
    existing = await adapter.findUserByEmail(email, {
      includeAccounts: true,
    });
  }

  if (!existing?.user?.id) {
    throw new Error("Local account could not be resolved.");
  }

  let emailVerified = existing.user.emailVerified === true;
  if (options?.emailVerified === true && !emailVerified) {
    if (!adapter.updateUser) {
      console.warn(
        "[identity-sso] cannot record authority-verified email: adapter has no updateUser",
      );
    } else {
      let reconciled = true;
      try {
        await acceptPendingInvitationsForEmail(email);
      } catch (error) {
        reconciled = false;
        console.error(
          "[identity-sso] leaving the row unverified: failed to reconcile pending invitations",
          error,
        );
      }
      if (reconciled) {
        await adapter.updateUser(existing.user.id, { emailVerified: true });
        emailVerified = true;
      }
    }
  }

  return {
    id: existing.user.id,
    emailVerified,
    accounts: existing.accounts ?? [],
  };
}

async function jitLinkIdentity(
  identity: VerifiedIdentity,
  signupHeaders?: Headers,
): Promise<void> {
  const adapter = await getBetterAuthInternalAdapter();
  if (!adapter) throw new Error("Local account storage is unavailable.");

  const existing = await ensureIdentityUser(
    identity.email,
    identity.name,
    signupHeaders,
    { emailVerified: identity.authProvider === "google" },
  );

  const accountId = identity.sub || identity.email;
  const alreadyLinked = existing.accounts.some(
    (account) =>
      account.providerId === IDENTITY_SSO_PROVIDER_ID &&
      account.accountId === accountId,
  );
  if (!alreadyLinked) {
    try {
      await adapter.linkAccount({
        userId: existing.id,
        providerId: IDENTITY_SSO_PROVIDER_ID,
        accountId,
      });
    } catch (error) {
      void error;
      // The verified email already authenticates the user. This inert,
      // additive bookkeeping link must never block session creation.
    }
  }
}

function safeRequestReturnPath(event: H3Event): string {
  try {
    const url = new URL(requestUrl(event), "http://an.invalid");
    return safeReturnPath(url.searchParams.get("return"));
  } catch {
    return "/";
  }
}

function localSignInHref(returnPath: string | null): string {
  const url = new URL(SIGN_IN_ENTRY_PATH, "http://an.invalid");
  url.searchParams.set("sso", "unavailable");
  const safeReturn = safeReturnPath(returnPath);
  if (safeReturn !== "/") url.searchParams.set("return", safeReturn);
  return `${url.pathname}${url.search}`;
}

const BOOTSTRAP_HANDLE = /^[A-Za-z0-9_-]{43}$/;

async function startIdentityBootstrap(
  event: H3Event,
  hub: string,
  returnPath: string,
): Promise<Response> {
  const current = await getSessionForEvent(event).catch((error) => {
    void error;
    return null;
  });
  if (!current?.email) return redirect(event, localSignInHref(returnPath));

  const federationSecret = readDeployCredentialEnv(
    "AGENT_NATIVE_IDENTITY_FEDERATION_SECRET",
  )?.trim();
  if (!federationSecret) return redirect(event, returnPath);

  const binding = resolveClientBinding(event, hub);
  if (!binding) return redirect(event, returnPath);
  const verifier = createPkceVerifier();
  const challenge = createPkceChallenge(verifier);
  let state: string;
  try {
    state = await createSsoState({
      returnPath: returnPath === "/" ? null : returnPath,
      ...binding,
      codeChallenge: challenge,
    });
  } catch (error: any) {
    if (error?.message === "RATE_LIMITED") {
      return redirect(event, returnPath);
    }
    return redirect(event, returnPath);
  }

  setPkceVerifierCookie(
    event,
    state,
    verifier,
    binding.redirectUri.startsWith("https://"),
  );
  const browserBinding = randomBytes(32).toString("base64url");
  if (!setIdentitySsoBootstrapBindingCookie(event, browserBinding, hub)) {
    return redirect(event, returnPath);
  }
  const browserBindingHash = createHash("sha256")
    .update(browserBinding)
    .digest("base64url");

  try {
    const token = await signA2AToken(
      current.email.trim().toLowerCase(),
      undefined,
      federationSecret,
      {
        audience: canonicalA2AAudience(hub),
        expiresIn: "2m",
        extraClaims: {
          app_id: binding.appId,
          client_id: binding.clientId,
          redirect_uri: binding.redirectUri,
          state,
          code_challenge: challenge,
          browser_binding_hash: browserBindingHash,
          email_verified: current.emailVerified === true,
          scope: IDENTITY_SSO_BOOTSTRAP_SCOPE,
          ...(current.orgId && ORG_ID_PATTERN.test(current.orgId)
            ? { org_id: current.orgId }
            : {}),
          ...(current.name?.trim()
            ? { name: current.name.trim().slice(0, MAX_BOOTSTRAP_NAME_LENGTH) }
            : {}),
          ...(hasIdentityGoogleAuthCookie(event, current.email)
            ? { identity_auth_provider: "google" }
            : {}),
        },
      },
    );
    const response = await fetch(`${hub}${IDENTITY_SSO_BOOTSTRAP_PATH}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return redirect(event, returnPath);
    const body = (await response.json().catch((error) => {
      void error;
      return null;
    })) as Record<string, unknown> | null;
    if (typeof body?.continue_url !== "string") {
      return redirect(event, returnPath);
    }
    const continueUrl = new URL(body.continue_url);
    if (
      continueUrl.origin !== new URL(hub).origin ||
      continueUrl.pathname !== `${IDENTITY_SSO_BOOTSTRAP_PATH}/continue` ||
      !BOOTSTRAP_HANDLE.test(continueUrl.searchParams.get("handle") ?? "")
    ) {
      return redirect(event, returnPath);
    }
    const sourceOrigin = new URL(binding.redirectUri).origin;
    if (canIdentitySsoBootstrapBindingCookieReachHub(event, hub)) {
      return redirect(event, continueUrl.toString());
    }
    return identitySsoBridgePage(event, {
      frameUrl: addBridgeParams(continueUrl.toString(), sourceOrigin),
      hubOrigin: new URL(hub).origin,
      completeField: "redirect_uri",
    });
  } catch (error) {
    void error;
    return redirect(event, returnPath);
  }
}

export async function handleIdentitySso(
  event: H3Event,
  subpath: string,
): Promise<Response> {
  const method = getMethod(event);
  const sub = ("/" + subpath.replace(/^\/+/, "").replace(/\/+$/, "")).replace(
    /^\/$/,
    "",
  );
  const loginPath = SIGN_IN_ENTRY_PATH;

  if (sub === "/desktop-complete") {
    if (method !== "GET" && method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }
    let nonce = "";
    try {
      nonce =
        new URL(requestUrl(event), "http://an.invalid").searchParams.get(
          "nonce",
        ) || "";
    } catch {
      return new Response("Invalid completion request", { status: 400 });
    }
    if (!DESKTOP_COMPLETION_NONCE.test(nonce)) {
      return new Response("Invalid completion request", { status: 400 });
    }
    const current = await getSessionForEvent(event).catch((error) => {
      void error;
      return null;
    });
    if (!current?.email) {
      return new Response("Authentication required", { status: 401 });
    }
    return new Response(
      '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        "<title>Signed in</title></head><body>Signed in. You can close this window.</body></html>",
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'none'; style-src 'none'",
          "Content-Type": "text/html; charset=utf-8",
          "Referrer-Policy": "no-referrer",
        },
      },
    );
  }

  const hub = resolveIdentityHubUrl(event);
  if (!hub) return new Response("Not found", { status: 404 });

  if (sub === `${IDENTITY_SSO_BOOTSTRAP_PATH}/binding`) {
    if (method !== "GET" && method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }
    const current = await getSessionForEvent(event).catch((error) => {
      void error;
      return null;
    });
    const binding = getIdentitySsoBootstrapBindingCookie(event);
    if (!current?.email || !binding || !STATE_PATTERN.test(binding)) {
      return new Response("Unauthorized", { status: 401 });
    }
    return new Response(JSON.stringify({ binding }), {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
        "Referrer-Policy": "no-referrer",
      },
    });
  }

  if (sub === "/bootstrap") {
    if (method !== "GET" && method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }
    return startIdentityBootstrap(event, hub, safeRequestReturnPath(event));
  }

  if (sub === "/login") {
    if (method !== "GET" && method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }
    const existing = await getSessionForEvent(event).catch((error) => {
      void error;
      return null;
    });
    const returnPath = safeRequestReturnPath(event);
    if (existing?.email) return redirect(event, returnPath);

    let silent = false;
    try {
      const url = new URL(requestUrl(event), "http://an.invalid");
      const prompt = url.searchParams.get("prompt");
      if (prompt !== null && prompt !== "none") {
        return errorPage("Malformed sign-in request.", loginPath);
      }
      silent = prompt === "none";
    } catch {
      return errorPage("Malformed sign-in request.", loginPath);
    }

    const binding = resolveClientBinding(event, hub);
    if (!binding)
      return errorPage("Federated sign-in is not configured.", loginPath);
    const verifier = createPkceVerifier();
    const challenge = createPkceChallenge(verifier);
    let state: string;
    try {
      state = await createSsoState({
        returnPath: returnPath === "/" ? null : returnPath,
        ...binding,
        codeChallenge: challenge,
      });
    } catch (error: any) {
      if (error?.message === "RATE_LIMITED") {
        return errorPage(
          "Too many sign-in attempts. Please wait a moment and try again.",
          loginPath,
        );
      }
      return errorPage(
        "Could not start federated sign-in. Please try again.",
        loginPath,
      );
    }

    setPkceVerifierCookie(
      event,
      state,
      verifier,
      binding.redirectUri.startsWith("https://"),
    );
    const authorizeUrl =
      `${hub}/_agent-native/identity/authorize` +
      `?response_type=code` +
      `&app=${encodeURIComponent(binding.appId)}` +
      `&client_id=${encodeURIComponent(binding.clientId)}` +
      `&redirect_uri=${encodeURIComponent(binding.redirectUri)}` +
      `&state=${encodeURIComponent(state)}` +
      `&code_challenge=${encodeURIComponent(challenge)}` +
      `&code_challenge_method=S256` +
      (silent ? "&prompt=none" : "");
    return redirect(event, authorizeUrl);
  }

  if (sub === "/callback") {
    if (method !== "GET" && method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }
    let code = "";
    let state = "";
    let ssoError = "";
    try {
      const url = new URL(requestUrl(event), "http://an.invalid");
      code = url.searchParams.get("code") || "";
      state = url.searchParams.get("state") || "";
      ssoError = url.searchParams.get("error") || "";
    } catch {
      return errorPage("Malformed sign-in response.", loginPath);
    }
    const isSilentFallback =
      ssoError === "login_required" || ssoError === "feature_disabled";
    if (!STATE_PATTERN.test(state) || (!CODE.test(code) && !isSilentFallback)) {
      return errorPage("Malformed sign-in response.", loginPath);
    }

    const binding = resolveClientBinding(event, hub);
    const verifier = getCookie(event, verifierCookieName(state));
    clearPkceVerifierCookie(event, state);
    if (!binding || !verifier) {
      return errorPage(
        "Your sign-in session expired or was already used. Please try again.",
        loginPath,
      );
    }

    const stateResult = await consumeSsoState(state, {
      ...binding,
      codeChallenge: createPkceChallenge(verifier),
    });
    if (!stateResult.ok) {
      return errorPage(
        "Your sign-in session expired or was already used. Please try again.",
        loginPath,
      );
    }

    if (isSilentFallback) {
      return redirect(event, localSignInHref(stateResult.returnPath));
    }

    const exchange = await exchangeIdentityCode(hub, binding, {
      code,
      state,
      codeVerifier: verifier,
    });
    const identity = exchange
      ? await verifyIdentityAssertion(exchange.assertion, binding)
      : null;
    if (!identity || (await isJtiReplayed(identity.jti))) {
      return errorPage(
        "We could not verify the sign-in response. Please try again.",
        loginPath,
      );
    }
    const requiredAuthProvider =
      typeof getRequiredAuthProviderForEmail === "function"
        ? await getRequiredAuthProviderForEmail(identity.email)
        : (await isGoogleSignInRequiredForEmail(identity.email))
          ? "google"
          : null;
    if (requiredAuthProvider) {
      const identityProvider = identity.authProvider ?? null;
      if (identityProvider !== requiredAuthProvider) {
        return errorPage(
          authProviderRequiredMessage
            ? authProviderRequiredMessage(requiredAuthProvider)
            : GOOGLE_AUTH_REQUIRED_MESSAGE,
          loginPath,
        );
      }
    }

    try {
      const signupCookieHeader = getHeader(event, "cookie") ?? null;
      const signupAttribution =
        signupAttributionContextFromCookieHeader(signupCookieHeader);
      const signupHeaders = addSignupAttributionHeader(
        event.headers,
        signupAttribution,
      );
      const linkIdentity = () => jitLinkIdentity(identity, signupHeaders);
      await (hasContinuationLocalRequestContext()
        ? runWithRequestContext(
            {
              ...(getRequestContext() ?? {}),
              signupAttribution,
              signupOrigin: "sso_jit",
            },
            linkIdentity,
          )
        : linkIdentity());
      if (identity.orgId && identity.orgName && identity.orgRole) {
        const { provisionFederatedOrganization } =
          await import("../org/federation.js");
        await provisionFederatedOrganization({
          authority: binding.authority,
          id: identity.orgId,
          name: identity.orgName,
          role: identity.orgRole,
          email: identity.email,
          ...(identity.orgIcon !== undefined
            ? {
                icon: identity.orgIcon,
                iconRevision: identity.orgIconRevision,
              }
            : {}),
        });
      }
    } catch {
      return errorPage(
        "Could not finish linking your account. Please try again.",
        loginPath,
      );
    }
    try {
      await createOAuthSession(event, identity.email, {
        hasProductionSession: false,
        authProvider: identity.authProvider ?? null,
      });
    } catch {
      return errorPage(
        "Signed in, but could not start your session. Please try again.",
        loginPath,
      );
    }
    if (exchange?.bootstrapActivation) {
      const activationUrl = new URL(
        `${hub}${IDENTITY_SSO_BOOTSTRAP_PATH}/activate`,
      );
      activationUrl.searchParams.set(
        "activation",
        exchange.bootstrapActivation,
      );
      activationUrl.searchParams.set(
        "return",
        safeReturnPath(stateResult.returnPath),
      );
      if (!canIdentitySsoBootstrapBindingCookieReachHub(event, hub)) {
        return identitySsoBridgePage(event, {
          frameUrl: addBridgeParams(
            activationUrl.toString(),
            new URL(binding.redirectUri).origin,
          ),
          hubOrigin: new URL(hub).origin,
          completeField: "return_url",
        });
      }
      return redirect(event, activationUrl.toString());
    }
    return redirect(event, safeReturnPath(stateResult.returnPath));
  }

  return new Response("Not found", { status: 404 });
}

export function isIdentitySsoBypassPath(p: string): boolean {
  if (!isIdentitySsoEnabled()) return false;
  return (
    p === "/_agent-native/identity/login" ||
    p === "/_agent-native/identity/callback" ||
    p === "/_agent-native/identity/bootstrap" ||
    p === `${IDENTITY_SSO_BOOTSTRAP_PATH}/binding` ||
    p === `${IDENTITY_SSO_BOOTSTRAP_PATH}/continue` ||
    p === IDENTITY_SSO_BOOTSTRAP_ACTIVATE_PATH
  );
}
