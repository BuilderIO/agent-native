import { randomBytes } from "node:crypto";

import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  Session,
  WebContents,
  WindowOpenHandlerResponse,
} from "electron";

import type {
  DesktopIdentityAuthRequest,
  DesktopIdentityAuthResult,
  DesktopIdentityMagicLinkRequest,
  DesktopIdentityMagicLinkResult,
} from "../../shared/ipc-channels.js";

export const DESKTOP_IDENTITY_PARTITION = "persist:agent-native-identity";
export const DESKTOP_IDENTITY_COMPLETE_PATH =
  "/_agent-native/identity/desktop-complete";

const DESKTOP_IDENTITY_LOGIN_PATH = "/_agent-native/identity/login";
// Dispatch is the identity authority, not an SSO client. Its identity login
// route intentionally returns 404 to prevent self-federation, so the parent
// ceremony must use the ordinary login document while child apps use SSO.
const DESKTOP_IDENTITY_AUTHORITY_LOGIN_PATH = "/login";
const DESKTOP_IDENTITY_AUTHORIZE_PATH = "/_agent-native/identity/authorize";
const DESKTOP_IDENTITY_CALLBACK_PATH = "/_agent-native/identity/callback";
const DESKTOP_LOGOUT_PATH = "/_agent-native/auth/logout";
const DESKTOP_LOGOUT_ALL_PATH = "/_agent-native/auth/logout-all";
const DEFAULT_CEREMONY_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_SESSION_COOKIE_WAIT_MS = 10_000;
const DEFAULT_AVAILABILITY_TIMEOUT_MS = 5_000;
const SESSION_COOKIE_POLL_INTERVAL_MS = 25;
const DESKTOP_EXCHANGE_POLL_INTERVAL_MS = 500;
const DESKTOP_EXCHANGE_PATH = "/_agent-native/auth/desktop-exchange";
const DESKTOP_GOOGLE_AUTH_URL_PATH = "/_agent-native/google/auth-url";
const DISPATCH_WORKSPACE_EMBED_ACTION =
  "/_agent-native/actions/create-workspace-app-embed-session";
const DESKTOP_IDENTITY_APP_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function normalizeIdentityEmail(email: string): string {
  return email.trim().toLowerCase();
}

function cookieMatchesOrigin(
  cookie: Pick<Electron.Cookie, "domain" | "hostOnly">,
  origin: string,
): boolean {
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    const domain = (cookie.domain ?? "").replace(/^\./, "").toLowerCase();
    return Boolean(
      domain &&
      (hostname === domain ||
        (!cookie.hostOnly && hostname.endsWith(`.${domain}`))),
    );
  } catch (error) {
    void error;
    return false;
  }
}

function isAllowedDesktopIdentityOAuthNavigation(
  navigationUrl: string,
): boolean {
  try {
    const parsed = new URL(navigationUrl);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === "accounts.google.com" ||
      host.endsWith(".google.com") ||
      host.endsWith(".gstatic.com")
    );
  } catch (error) {
    void error;
    return false;
  }
}

function extractDesktopOAuthFlowId(navigationUrl: string): string | null {
  try {
    const parsed = new URL(navigationUrl);
    const directFlowId = parsed.searchParams.get("flow_id")?.trim();
    if (directFlowId) return directFlowId;

    const state = parsed.searchParams.get("state");
    if (!state) return null;
    const separator = state.lastIndexOf(".");
    const encodedPayload = separator === -1 ? state : state.slice(0, separator);
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as { f?: unknown };
    return typeof payload.f === "string" && payload.f.trim()
      ? payload.f.trim()
      : null;
  } catch (error) {
    void error;
    return null;
  }
}

function extractDesktopOAuthVerifier(navigationUrl: string): string | null {
  try {
    const verifier = new URL(navigationUrl).searchParams
      .get("verifier")
      ?.trim();
    return verifier || null;
  } catch (error) {
    void error;
    return null;
  }
}

export type DesktopWorkspaceLogoutPath =
  | typeof DESKTOP_LOGOUT_PATH
  | typeof DESKTOP_LOGOUT_ALL_PATH;

export type DesktopIdentityStatus =
  | "idle"
  | "signing-in"
  | "signed-in"
  | "sign-in-required"
  | "failed";

export function shouldStartDesktopIdentitySignIn(
  status: DesktopIdentityStatus,
  authorityApp: Pick<DesktopIdentityApp, "origin"> | null,
): boolean {
  return status === "sign-in-required" && authorityApp !== null;
}

export interface DesktopIdentityApp {
  id: string;
  origin: string;
  session: Session;
  cookieNames: string[];
  cookieNamesToClear: string[];
  identityAuthority?: boolean;
  workspaceSso?: boolean;
}

export function isDesktopIdentityAppIdEligible(
  appId: unknown,
): appId is string {
  return (
    typeof appId === "string" && DESKTOP_IDENTITY_APP_ID_PATTERN.test(appId)
  );
}

export function isDesktopIdentityOriginEligible(
  origin: string | null | undefined,
): origin is string {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "https:" && parsed.origin === origin;
  } catch (error) {
    void error;
    return false;
  }
}

export function isDesktopIdentityAppConfigEligible<
  T extends {
    id?: string;
    enabled?: boolean;
    mode?: string;
    workspaceSso?: boolean;
  },
>(
  configured: T | null | undefined,
  options?: { canonical?: boolean; forCleanup?: boolean },
): configured is T {
  if (!configured || !isDesktopIdentityAppIdEligible(configured.id)) {
    return false;
  }
  const productionMode =
    configured.mode === undefined || configured.mode === "prod";
  const enabled = options?.forCleanup ? true : configured.enabled === true;
  return Boolean(
    productionMode &&
    enabled &&
    (options?.canonical === true || configured.workspaceSso === true),
  );
}

export function isDesktopIdentityConfiguredAppEligible<
  T extends { enabled?: boolean; mode?: string },
>(
  configured: T | null | undefined,
  options?: { forCleanup?: boolean },
): configured is T {
  return Boolean(
    configured &&
    (options?.forCleanup ||
      (configured.mode !== "dev" && configured.enabled !== false)),
  );
}

export function isDesktopWorkspaceLogoutRequest(
  requestUrl: string,
  app: Pick<DesktopIdentityApp, "origin">,
): boolean {
  return desktopWorkspaceLogoutPath(requestUrl, app) !== null;
}

export function desktopWorkspaceLogoutPath(
  requestUrl: string,
  app: Pick<DesktopIdentityApp, "origin">,
): DesktopWorkspaceLogoutPath | null {
  try {
    const parsed = new URL(requestUrl);
    if (parsed.origin !== app.origin) return null;
    if (
      parsed.pathname === DESKTOP_LOGOUT_PATH ||
      parsed.pathname === DESKTOP_LOGOUT_ALL_PATH
    ) {
      return parsed.pathname;
    }
    return null;
  } catch (error) {
    void error;
    return null;
  }
}

interface DesktopIdentityWindow {
  webContents: WebContents;
  loadURL(url: string): Promise<void>;
  isDestroyed(): boolean;
  close(): void;
  on(event: "closed", listener: () => void): unknown;
}

export interface DesktopIdentityBrokerOptions {
  identitySession: Session;
  /** Opens provider verification in the user's system browser. */
  openExternal?: (url: string) => void | Promise<void>;
  isAvailable?: (
    authorityApp: DesktopIdentityApp,
    identitySession: Session,
  ) => Promise<boolean>;
  resolveLoginRedirect?: (
    url: string,
    identitySession: Session,
  ) => Promise<string | null>;
  resolveApp: (appId: string) => DesktopIdentityApp | null;
  listApps?: () => DesktopIdentityApp[];
  createWindow: (
    options: BrowserWindowConstructorOptions,
  ) => DesktopIdentityWindow;
  parentWindow?: () => BrowserWindow | null;
  handleWindowOpen?: (
    contents: WebContents,
    url: string,
  ) => WindowOpenHandlerResponse;
  handleOAuthNavigation?: (url: string, contents: WebContents) => boolean;
  reloadApp: (app: DesktopIdentityApp) => void;
  clearLocalBroker: () => Promise<void> | void;
  onStatus?: (status: DesktopIdentityStatus) => void;
  timeoutMs?: number;
  sessionCookieWaitMs?: number;
}

interface DesktopSignOutIntent {
  logoutPath: DesktopWorkspaceLogoutPath;
  alreadyRevokedAppIds: Set<string>;
}

interface DesktopRevocationTarget {
  appId: string | null;
  origin: string;
  session: Session;
  cookieHeader: string;
}

function completionUrl(origin: string, nonce: string): string {
  const result = new URL(DESKTOP_IDENTITY_COMPLETE_PATH, origin);
  result.searchParams.set("nonce", nonce);
  return result.toString();
}

export function isDesktopIdentityCompletion(
  navigationUrl: string,
  app: Pick<DesktopIdentityApp, "origin">,
  nonce: string,
): boolean {
  try {
    const parsed = new URL(navigationUrl);
    return (
      parsed.origin === app.origin &&
      parsed.pathname === DESKTOP_IDENTITY_COMPLETE_PATH &&
      parsed.searchParams.get("nonce") === nonce
    );
  } catch (error) {
    void error;
    return false;
  }
}

export function isDesktopIdentityAuthorizeNavigation(
  navigationUrl: string,
  authorityApp: DesktopIdentityApp,
  targetApp: DesktopIdentityApp,
): boolean {
  try {
    const parsed = new URL(navigationUrl);
    const callback = new URL(parsed.searchParams.get("redirect_uri") ?? "");
    return (
      authorityApp.identityAuthority === true &&
      parsed.origin === authorityApp.origin &&
      parsed.pathname === DESKTOP_IDENTITY_AUTHORIZE_PATH &&
      parsed.searchParams.get("app") === targetApp.id &&
      Boolean(parsed.searchParams.get("state")) &&
      callback.origin === targetApp.origin &&
      callback.pathname === DESKTOP_IDENTITY_CALLBACK_PATH
    );
  } catch (error) {
    void error;
    return false;
  }
}

export async function fetchDesktopIdentityAvailability(
  authorityApp: DesktopIdentityApp,
  identitySession: Session,
  timeoutMs = DEFAULT_AVAILABILITY_TIMEOUT_MS,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const cookieHeader = await getSessionCookieHeader(
      authorityApp,
      identitySession,
    );
    const response = await identitySession.fetch(
      new URL(
        "/_agent-native/identity/availability",
        authorityApp.origin,
      ).toString(),
      {
        method: "GET",
        redirect: "manual",
        credentials: "include",
        signal: controller.signal,
        ...(cookieHeader ? { headers: { Cookie: cookieHeader } } : {}),
      },
    );
    if (!response.ok) return false;
    const body = (await response.json().catch((error) => {
      void error;
      return null;
    })) as {
      available?: unknown;
    } | null;
    return body?.available === true;
  } catch (error) {
    void error;
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function getSessionCookieHeader(
  app: Pick<DesktopIdentityApp, "origin" | "cookieNames">,
  session: Session,
): Promise<string | undefined> {
  if (!session.cookies?.get) return undefined;
  const cookies = await session.cookies.get({});
  const allowed = new Set(app.cookieNames);
  const header = cookies
    .filter(
      (cookie) =>
        cookieMatchesOrigin(cookie, app.origin) && allowed.has(cookie.name),
    )
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
  return header || undefined;
}

function cookieHeaderNames(cookieHeader: string | undefined): string[] {
  return (cookieHeader ?? "")
    .split(";")
    .map((part) => part.split("=", 1)[0]?.trim() ?? "")
    .filter(Boolean);
}

async function readDesktopIdentityAuthResponse(
  response: Response,
): Promise<{ email?: string; error?: string }> {
  type AuthResponseBody = {
    email?: unknown;
    error?: unknown;
  };
  let body: AuthResponseBody | null = null;
  try {
    body = (await response.json()) as AuthResponseBody;
  } catch (error) {
    console.warn("[desktop identity] auth response was not valid JSON", {
      reason: error instanceof Error ? error.message : "unknown error",
    });
  }
  return {
    ...(typeof body?.email === "string" && body.email.trim()
      ? { email: body.email.trim() }
      : {}),
    ...(typeof body?.error === "string" && body.error.trim()
      ? { error: body.error.trim() }
      : {}),
  };
}

async function readDesktopIdentityMagicLinkResponse(
  response: Response,
): Promise<{
  email?: string;
  error?: string;
  flowId?: string;
  verifier?: string;
}> {
  type MagicLinkResponseBody = {
    email?: unknown;
    error?: unknown;
    flowId?: unknown;
    verifier?: unknown;
  };
  let body: MagicLinkResponseBody | null = null;
  try {
    body = (await response.json()) as MagicLinkResponseBody;
  } catch (error) {
    console.warn("[desktop identity] magic-link response was not valid JSON", {
      reason: error instanceof Error ? error.message : "unknown error",
    });
  }
  return {
    ...(typeof body?.email === "string" && body.email.trim()
      ? { email: body.email.trim() }
      : {}),
    ...(typeof body?.error === "string" && body.error.trim()
      ? { error: body.error.trim() }
      : {}),
    ...(typeof body?.flowId === "string" && body.flowId.trim()
      ? { flowId: body.flowId.trim() }
      : {}),
    ...(typeof body?.verifier === "string" && body.verifier.trim()
      ? { verifier: body.verifier.trim() }
      : {}),
  };
}

export class DesktopIdentityBroker {
  private readonly pendingByApp = new Map<string, Promise<boolean>>();
  private readonly pendingModernAppSessions = new Map<
    string,
    Promise<boolean>
  >();
  private readonly completedModernAppSessions = new Set<string>();
  private readonly unsupportedAppIds = new Set<string>();
  private readonly activeSessionCopies = new Set<Promise<void>>();
  private queue: Promise<void> = Promise.resolve();
  private activeWindow: DesktopIdentityWindow | null = null;
  private signInOperation: Promise<boolean> | null = null;
  private magicLinkRequestOperation: Promise<DesktopIdentityMagicLinkResult> | null =
    null;
  private passwordAuthOperation: Promise<DesktopIdentityAuthResult> | null =
    null;
  private sessionAdoptionOperation: Promise<boolean> | null = null;
  private signOutOperation: Promise<boolean> | null = null;
  private signOutIntent: DesktopSignOutIntent | null = null;
  private revocationTargets: DesktopRevocationTarget[] | null = null;
  private revocationTargetErrors: unknown[] = [];
  private revocationTargetsPromise: Promise<void> | null = null;
  private externalSignOutRequests = 0;
  private readonly externalSignOutWaiters = new Set<() => void>();
  private readonly internalRevocationNonce =
    randomBytes(16).toString("base64url");
  private status: DesktopIdentityStatus = "idle";
  private ceremonyGeneration = 0;
  private availability: "unknown" | "available" | "unavailable";

  constructor(private readonly options: DesktopIdentityBrokerOptions) {
    this.availability = options.isAvailable ? "unknown" : "available";
  }

  getStatus(): DesktopIdentityStatus {
    return this.status;
  }

  setStatusForSetting(status: DesktopIdentityStatus): void {
    this.ceremonyGeneration += 1;
    this.completedModernAppSessions.clear();
    this.setStatus(status);
  }

  isAvailable(): boolean {
    return this.availability === "available";
  }

  isInternalRevocationRequest(requestUrl: string): boolean {
    try {
      return (
        new URL(requestUrl).searchParams.get("_an_desktop_logout") ===
        this.internalRevocationNonce
      );
    } catch (error) {
      void error;
      return false;
    }
  }

  async refreshStatus(authorityApp: DesktopIdentityApp | null): Promise<void> {
    const observedStatus = this.status;
    const observedGeneration = this.ceremonyGeneration;
    if (
      observedStatus === "signing-in" ||
      this.signInOperation ||
      this.sessionAdoptionOperation ||
      this.signOutOperation
    ) {
      return;
    }
    if (!authorityApp) {
      this.availability = "unavailable";
      this.setStatus("idle");
      return;
    }
    if (this.options.isAvailable) {
      const available = await this.options
        .isAvailable(authorityApp, this.options.identitySession)
        .catch(() => false);
      if (
        this.status !== observedStatus ||
        this.ceremonyGeneration !== observedGeneration ||
        this.signOutOperation
      ) {
        return;
      }
      if (!available) {
        this.availability = "unavailable";
        // The native setting owns whether the parent sign-in surface is
        // shown. Availability is still recorded so background fan-out stays
        // fail-closed, but an anonymous user must be able to start the
        // hosted parent login even when the server flag is user-scoped.
      }
      if (available) this.availability = "available";
    }
    const verifiedEmail = await this.verifyIdentitySession(authorityApp).catch(
      () => null,
    );
    if (
      this.status !== observedStatus ||
      this.ceremonyGeneration !== observedGeneration ||
      this.signOutOperation
    ) {
      return;
    }
    this.setStatus(verifiedEmail ? "signed-in" : "sign-in-required");
  }

  private ensureAppSessionInternal(
    appId: string,
    options: {
      interactive?: boolean;
      preserveIdentitySession?: boolean;
      skipIfPresent?: boolean;
      verifyExistingSession?: boolean;
      expectedSessionValue?: string;
      waitForSignOut?: boolean;
      skipAvailabilityProbe?: boolean;
      preserveStatus?: boolean;
    } = {},
  ): Promise<boolean> {
    const pendingKey = this.pendingOperationKey(
      appId,
      options.expectedSessionValue,
    );
    const existing = this.pendingByApp.get(pendingKey);
    if (existing) return existing;

    const generation = this.ceremonyGeneration;
    const operation = this.queue.then(async () => {
      if (options.waitForSignOut !== false) {
        await this.signOutOperation;
      }
      await this.waitForActiveSessionCopies();
      if (!this.isCeremonyCurrent(generation)) return false;
      const app = this.options.resolveApp(appId);
      if (!app) return false;
      if (options.skipIfPresent) {
        const hasExistingSession = await this.hasAppSession(app);
        const alreadySynchronized = options.expectedSessionValue
          ? await this.hasMatchingAppSession(app, options.expectedSessionValue)
          : options.verifyExistingSession
            ? await this.hasMatchingIdentitySession(app)
            : hasExistingSession;
        if (alreadySynchronized) return true;
        if (hasExistingSession) await this.clearAppSessionCookies(app);
      }
      return this.runCeremony(appId, generation, options);
    });
    this.queue = operation.then(
      () => undefined,
      () => undefined,
    );
    this.pendingByApp.set(pendingKey, operation);
    void operation.finally(() => {
      if (this.pendingByApp.get(pendingKey) === operation) {
        this.pendingByApp.delete(pendingKey);
      }
    });
    return operation;
  }

  /**
   * Synchronize one newly opened eligible app after the workspace is already
   * signed in. This stays in the main process and is intentionally a no-op
   * while the broker is unavailable or signed out.
   */
  ensureAppSession(appId: string): Promise<boolean> {
    if (
      this.status !== "signed-in" ||
      this.signOutOperation ||
      (this.options.isAvailable && this.availability !== "available") ||
      this.unsupportedAppIds.has(appId) ||
      !this.options.resolveApp(appId)
    ) {
      return Promise.resolve(false);
    }

    const operation = this.options.openExternal
      ? this.ensureModernAppSessionDeduped(appId)
      : this.ensureAppSessionInternal(appId, {
          interactive: false,
          skipIfPresent: true,
          verifyExistingSession: true,
          // Lazy child synchronization is scoped to the requested WebView. Do
          // not replace the workspace-level signed-in state while it runs.
          preserveStatus: true,
        });
    return operation;
  }

  private ensureModernAppSessionDeduped(
    appId: string,
    generation = this.ceremonyGeneration,
    expectedEmail?: string,
  ): Promise<boolean> {
    const pendingKey = `${generation}:${appId}`;
    if (this.completedModernAppSessions.has(pendingKey)) {
      return Promise.resolve(true);
    }
    const existing = this.pendingModernAppSessions.get(pendingKey);
    if (existing) return existing;

    const operation = this.ensureModernAppSession(
      appId,
      generation,
      expectedEmail,
    );
    this.pendingModernAppSessions.set(pendingKey, operation);
    void operation.then(
      (succeeded) => {
        if (this.pendingModernAppSessions.get(pendingKey) === operation) {
          this.pendingModernAppSessions.delete(pendingKey);
        }
        if (succeeded && this.isCeremonyCurrent(generation)) {
          this.completedModernAppSessions.add(pendingKey);
        }
      },
      () => {
        if (this.pendingModernAppSessions.get(pendingKey) === operation) {
          this.pendingModernAppSessions.delete(pendingKey);
        }
      },
    );
    return operation;
  }

  /**
   * Adopt a session created by the normal login form inside an app webview.
   *
   * The source cookie is never trusted on its own: it is copied into the
   * isolated identity session and verified through the canonical authority
   * before any other app session is changed. This keeps parent-owned login
   * compatible with custom workspace apps without moving account data.
   */
  adoptAppSession(appId: string): Promise<boolean> {
    if (this.signOutOperation) {
      return Promise.resolve(false);
    }
    if (this.signInOperation) return this.signInOperation;
    const app = this.options.resolveApp(appId);
    if (!app) return Promise.resolve(false);
    if (this.sessionAdoptionOperation) return this.sessionAdoptionOperation;

    const generation = this.ceremonyGeneration;
    const operation = this.runSessionAdoption(app, generation);
    this.sessionAdoptionOperation = operation;
    void operation.then(
      () => {
        if (this.sessionAdoptionOperation === operation) {
          this.sessionAdoptionOperation = null;
        }
      },
      () => {
        if (this.sessionAdoptionOperation === operation) {
          this.sessionAdoptionOperation = null;
        }
      },
    );
    return operation;
  }

  signIn(appId: string): Promise<boolean> {
    if (
      this.signOutOperation ||
      !this.options.resolveApp(appId) ||
      (this.options.isAvailable && !this.options.resolveApp("dispatch"))
    ) {
      return Promise.resolve(false);
    }
    if (this.signInOperation) return this.signInOperation;

    this.unsupportedAppIds.delete(appId);
    const generation = this.ceremonyGeneration;
    const adoption = this.sessionAdoptionOperation;
    const operation = this.options.openExternal
      ? this.runExternalGoogleSignIn(appId, generation)
      : adoption
        ? adoption.then(
            () => this.runSignInFanout(appId, generation),
            () => this.runSignInFanout(appId, generation),
          )
        : this.runSignInFanout(appId, generation);
    this.signInOperation = operation;
    void operation.then(
      () => {
        if (this.signInOperation === operation) this.signInOperation = null;
      },
      () => {
        if (this.signInOperation === operation) this.signInOperation = null;
      },
    );
    return operation;
  }

  /**
   * Start a parent magic-link exchange without opening a hosted login window.
   * The request is acknowledged as soon as the email is queued; the broker
   * keeps polling the one-time exchange until the system browser verifies it.
   */
  requestMagicLink(
    request: DesktopIdentityMagicLinkRequest,
  ): Promise<DesktopIdentityMagicLinkResult> {
    const email = request.email.trim();
    if (!email) {
      return Promise.resolve({
        ok: false,
        error: "Enter your email to continue.",
      });
    }
    if (this.signOutOperation) {
      return Promise.resolve({
        ok: false,
        error: "Sign-out is still finishing. Please try again.",
      });
    }
    if (this.signInOperation || this.magicLinkRequestOperation) {
      return Promise.resolve({
        ok: false,
        error: "Sign-in is already in progress. Please wait a moment.",
      });
    }

    const authority = this.resolveIdentityAuthority();
    if (!authority) {
      return Promise.resolve({
        ok: false,
        error: "The Agent Native identity service is unavailable.",
      });
    }

    const generation = this.ceremonyGeneration;
    const operation = this.startMagicLinkRequest(email, authority, generation);
    this.magicLinkRequestOperation = operation;
    void operation.then(
      () => {
        if (this.magicLinkRequestOperation === operation) {
          this.magicLinkRequestOperation = null;
        }
      },
      () => {
        if (this.magicLinkRequestOperation === operation) {
          this.magicLinkRequestOperation = null;
        }
      },
    );
    return operation;
  }

  private async startMagicLinkRequest(
    email: string,
    authority: DesktopIdentityApp,
    generation: number,
  ): Promise<DesktopIdentityMagicLinkResult> {
    const fail = (error: string): DesktopIdentityMagicLinkResult => {
      if (this.isCeremonyCurrent(generation) && !this.signOutOperation) {
        this.setStatus("failed");
      }
      return { ok: false, error };
    };

    await this.waitForActiveSessionCopies();
    if (!this.isCeremonyCurrent(generation)) {
      return fail("Sign-in was cancelled. Please try again.");
    }
    this.setStatus("signing-in");

    let response: Response;
    try {
      response = await this.options.identitySession.fetch(
        new URL("/_agent-native/auth/magic-link", authority.origin).toString(),
        {
          method: "POST",
          redirect: "manual",
          credentials: "include",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email,
            callbackURL: "/_agent-native/auth/magic-link/desktop-callback",
          }),
        },
      );
    } catch (error) {
      return fail(
        error instanceof Error
          ? error.message
          : "Could not reach the Agent Native identity service.",
      );
    }

    const payload = await readDesktopIdentityMagicLinkResponse(response);
    if (!response.ok) {
      return fail(
        payload.error ?? "Could not send a sign-in link. Please try again.",
      );
    }
    if (!payload.flowId || !payload.verifier) {
      return fail("The magic-link sign-in flow could not be initialized.");
    }
    if (!this.isCeremonyCurrent(generation) || this.signOutOperation) {
      return fail("Sign-in was cancelled. Please try again.");
    }

    const exchangeOperation = this.finishExternalAuthentication(
      authority,
      payload.flowId,
      payload.verifier,
      generation,
    );
    this.signInOperation = exchangeOperation;
    void exchangeOperation.then(
      () => {
        if (this.signInOperation === exchangeOperation) {
          this.signInOperation = null;
        }
      },
      () => {
        if (this.signInOperation === exchangeOperation) {
          this.signInOperation = null;
        }
      },
    );

    return { ok: true, email, pending: true };
  }

  private async runExternalGoogleSignIn(
    appId: string,
    generation: number,
  ): Promise<boolean> {
    const authority = this.resolveIdentityAuthority();
    if (!authority || !this.options.openExternal) return false;

    const flowId = randomBytes(32).toString("base64url");
    const authUrl = new URL(DESKTOP_GOOGLE_AUTH_URL_PATH, authority.origin);
    authUrl.searchParams.set("desktop", "1");
    authUrl.searchParams.set("flow_id", flowId);
    authUrl.searchParams.set("redirect", "1");

    this.setStatus("signing-in");
    try {
      await this.options.openExternal(authUrl.toString());
      return await this.finishExternalAuthentication(
        authority,
        flowId,
        null,
        generation,
        appId,
      );
    } catch (error) {
      if (this.isCeremonyCurrent(generation) && !this.signOutOperation) {
        this.setStatus("failed");
      }
      console.warn("[desktop identity] system-browser Google sign-in failed", {
        reason: error instanceof Error ? error.message : "unknown error",
      });
      return false;
    }
  }

  private async finishExternalAuthentication(
    authority: DesktopIdentityApp,
    flowId: string,
    verifier: string | null,
    generation: number,
    requestedAppId = authority.id,
  ): Promise<boolean> {
    try {
      await this.pollDesktopOAuthExchange(
        authority,
        flowId,
        verifier,
        generation,
        new AbortController().signal,
      );
      const succeeded = await this.runSignInFanout(requestedAppId, generation, {
        interactive: false,
      });
      if (
        !succeeded &&
        this.isCeremonyCurrent(generation) &&
        !this.signOutOperation
      ) {
        this.setStatus("failed");
      }
      return succeeded;
    } catch (error) {
      if (this.isCeremonyCurrent(generation) && !this.signOutOperation) {
        this.setStatus("failed");
      }
      console.warn("[desktop identity] desktop exchange failed", {
        reason: error instanceof Error ? error.message : "unknown error",
      });
      return false;
    }
  }

  /**
   * Authenticate from the trusted Desktop parent surface without opening a
   * second login page. Credentials are sent only from preload to this main
   * process and over the identity session's HTTPS request to Dispatch.
   */
  authenticateWithPassword(
    request: DesktopIdentityAuthRequest,
  ): Promise<DesktopIdentityAuthResult> {
    const email = request.email.trim();
    const password = request.password;
    if (!email || !password) {
      return Promise.resolve({
        ok: false,
        error: "Enter your email and password to continue.",
      });
    }
    if (this.signOutOperation) {
      return Promise.resolve({
        ok: false,
        error: "Sign-out is still finishing. Please try again.",
      });
    }
    if (this.signInOperation) {
      return Promise.resolve({
        ok: false,
        error: "Sign-in is already in progress. Please wait a moment.",
      });
    }

    const authority = this.resolveIdentityAuthority();
    if (!authority) {
      return Promise.resolve({
        ok: false,
        error: "The Agent Native identity service is unavailable.",
      });
    }

    const generation = this.ceremonyGeneration;
    const operation = this.runPasswordAuthentication(
      { ...request, email, password },
      authority,
      generation,
    );
    this.passwordAuthOperation = operation;
    const statusOperation = operation.then((result) => result.ok);
    this.signInOperation = statusOperation;
    const clearSignInOperation = () => {
      if (this.signInOperation === statusOperation) {
        this.signInOperation = null;
      }
      if (this.passwordAuthOperation === operation) {
        this.passwordAuthOperation = null;
      }
    };
    void statusOperation.then(clearSignInOperation, clearSignInOperation);
    return operation;
  }

  private async runPasswordAuthentication(
    request: DesktopIdentityAuthRequest,
    authority: DesktopIdentityApp,
    generation: number,
  ): Promise<DesktopIdentityAuthResult> {
    const fail = (error: string): DesktopIdentityAuthResult => {
      if (this.isCeremonyCurrent(generation) && !this.signOutOperation) {
        this.setStatus("failed");
      }
      return { ok: false, error };
    };

    if (this.options.isAvailable) {
      let available = false;
      try {
        available = await this.options.isAvailable(
          authority,
          this.options.identitySession,
        );
      } catch (error) {
        console.warn("[desktop identity] availability probe failed", {
          reason: error instanceof Error ? error.message : "unknown error",
        });
      }
      if (!this.isCeremonyCurrent(generation)) {
        this.availability = "unavailable";
        return fail("Sign-in was cancelled. Please try again.");
      }
      if (available) {
        this.availability = "available";
      } else {
        // This is an explicit parent-auth attempt. The availability probe is
        // user-scoped, so an anonymous false result must not block login.
        this.availability = "unavailable";
      }
    }

    await this.waitForActiveSessionCopies();
    if (!this.isCeremonyCurrent(generation)) {
      return { ok: false, error: "Sign-in was cancelled. Please try again." };
    }

    this.setStatus("signing-in");
    const endpoint = new URL(
      request.mode === "sign-up"
        ? "/_agent-native/auth/register"
        : "/_agent-native/auth/login",
      authority.origin,
    );
    let response: Response;
    try {
      response = await this.options.identitySession.fetch(endpoint.toString(), {
        method: "POST",
        redirect: "manual",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: request.email,
          password: request.password,
        }),
      });
    } catch (error) {
      return fail(
        error instanceof Error
          ? error.message
          : "Could not reach the Agent Native identity service.",
      );
    }

    const payload = await readDesktopIdentityAuthResponse(response);
    if (!response.ok) {
      return fail(
        payload.error ??
          (request.mode === "sign-up"
            ? "Could not create your account. Please try again."
            : "The email or password is incorrect."),
      );
    }

    if (request.mode === "sign-up") {
      let loginResponse: Response;
      try {
        loginResponse = await this.options.identitySession.fetch(
          new URL("/_agent-native/auth/login", authority.origin).toString(),
          {
            method: "POST",
            redirect: "manual",
            credentials: "include",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              email: request.email,
              password: request.password,
            }),
          },
        );
      } catch (error) {
        return fail(
          error instanceof Error
            ? error.message
            : "Account created, but sign-in could not finish.",
        );
      }
      const loginPayload = await readDesktopIdentityAuthResponse(loginResponse);
      if (!loginResponse.ok) {
        return fail(
          loginPayload.error ??
            "Account created. Check your email to verify it, then sign in.",
        );
      }
    }

    if (!this.isCeremonyCurrent(generation)) {
      return { ok: false, error: "Sign-in was cancelled. Please try again." };
    }
    const verifiedEmail = await this.verifyIdentitySession(authority).catch(
      () => false,
    );
    if (
      typeof verifiedEmail !== "string" ||
      normalizeIdentityEmail(verifiedEmail) !==
        normalizeIdentityEmail(request.email)
    ) {
      return fail(
        request.mode === "sign-up"
          ? "Account created. Check your email to verify it, then sign in."
          : "Sign-in did not create a usable session. Please try again.",
      );
    }

    const succeeded = await this.runSignInFanout(authority.id, generation, {
      interactive: false,
    });
    if (!succeeded) {
      return fail(
        "You are signed in, but one or more workspace apps could not be opened yet. Try again.",
      );
    }
    return { ok: true, email: request.email };
  }

  private async runModernIdentityFanout(
    appId: string,
    generation: number,
  ): Promise<boolean> {
    if (!this.isCeremonyCurrent(generation) || !this.options.listApps) {
      return false;
    }
    const requestedApp = this.options.resolveApp(appId);
    if (!requestedApp) return false;

    const appsById = new Map<string, DesktopIdentityApp>();
    try {
      for (const app of this.options.listApps()) {
        if (
          app.id === appId ||
          app.identityAuthority === true ||
          app.workspaceSso === true
        ) {
          if (!appsById.has(app.id)) appsById.set(app.id, app);
        }
      }
    } catch (error) {
      console.warn("[desktop identity] workspace app snapshot failed", {
        reason: error instanceof Error ? error.message : "unknown error",
      });
    }
    appsById.set(requestedApp.id, requestedApp);

    const authority =
      [...appsById.values()].find((app) => app.identityAuthority) ??
      this.options.resolveApp("dispatch");
    if (!authority) return false;

    const orderedApps: DesktopIdentityApp[] = [];
    const orderedIds = new Set<string>();
    for (const app of [authority, requestedApp, ...appsById.values()]) {
      if (app && !orderedIds.has(app.id)) {
        orderedIds.add(app.id);
        orderedApps.push(app);
      }
    }
    const firstApp = orderedApps[0];
    if (!firstApp) return false;

    const identityEmail = await this.verifyIdentitySession(
      authority,
      this.options.identitySession,
    );
    if (!identityEmail) return false;

    const authoritySucceeded = await this.ensureAuthoritySessionFromIdentity(
      firstApp,
      generation,
      identityEmail,
    );
    if (!authoritySucceeded || !this.isCeremonyCurrent(generation)) {
      return false;
    }

    if (this.options.isAvailable) {
      let available = false;
      try {
        available = await this.options.isAvailable(
          authority,
          this.options.identitySession,
        );
      } catch (error) {
        console.warn("[desktop identity] availability probe failed", {
          reason: error instanceof Error ? error.message : "unknown error",
        });
      }
      if (!this.isCeremonyCurrent(generation)) return false;
      if (!available) {
        this.availability = "unavailable";
        this.setStatus("failed");
        return false;
      }
      this.availability = "available";
    }

    const remaining = orderedApps.filter((app) => app.id !== firstApp.id);
    // Each child mint makes Dispatch open a separate outbound MCP session.
    // Keep first-run fan-out serial so serverless connection resets cannot turn
    // a valid parent session into a batch of opaque 500 responses.
    let resolveRequested: (succeeded: boolean) => void = () => {};
    const requestedResult = new Promise<boolean>((resolve) => {
      resolveRequested = resolve;
    });
    let requestedResultSettled = firstApp.id === appId;
    if (requestedResultSettled) resolveRequested(true);

    void (async () => {
      const failedAppIds: string[] = [];
      for (const app of remaining) {
        let succeeded = false;
        try {
          succeeded = await this.ensureModernAppSessionDeduped(
            app.id,
            generation,
            identityEmail,
          );
        } catch (error) {
          console.warn("[desktop identity] app session fan-out failed", {
            appId: app.id,
            reason: error instanceof Error ? error.message : "unknown error",
          });
        }
        if (app.id === appId && !requestedResultSettled) {
          requestedResultSettled = true;
          resolveRequested(succeeded && this.isCeremonyCurrent(generation));
        }
        if (!succeeded) failedAppIds.push(app.id);
        if (!this.isCeremonyCurrent(generation)) {
          if (!requestedResultSettled) {
            requestedResultSettled = true;
            resolveRequested(false);
          }
          return;
        }
      }
      if (!requestedResultSettled) {
        requestedResultSettled = true;
        resolveRequested(firstApp.id === appId);
      }
      if (failedAppIds.length > 0) {
        console.warn("[desktop identity] app session fan-out had failures", {
          appIds: failedAppIds,
        });
      }
    })().catch((error) => {
      if (!requestedResultSettled) {
        requestedResultSettled = true;
        resolveRequested(false);
      }
      console.warn("[desktop identity] app session fan-out stopped", {
        reason: error instanceof Error ? error.message : "unknown error",
      });
    });

    const requestedSucceeded = await requestedResult;
    if (!requestedSucceeded) {
      if (this.isCeremonyCurrent(generation) && !this.signOutOperation) {
        this.setStatus("failed");
      }
      return false;
    }

    if (this.isCeremonyCurrent(generation) && !this.signOutOperation) {
      this.setStatus("signed-in");
    }
    return true;
  }

  private async ensureAuthoritySessionFromIdentity(
    authority: DesktopIdentityApp,
    generation: number,
    expectedEmail: string,
  ): Promise<boolean> {
    try {
      await this.copyTargetSession(authority, generation, undefined, true);
      const appEmail = await this.verifyIdentitySession(
        authority,
        authority.session,
      );
      if (
        !appEmail ||
        normalizeIdentityEmail(appEmail) !==
          normalizeIdentityEmail(expectedEmail)
      ) {
        await this.clearAppSessionCookies(authority);
        return false;
      }
      this.reloadAppSafely(authority);
      return true;
    } catch (error) {
      console.warn("[desktop identity] authority session copy failed", {
        reason: error instanceof Error ? error.message : "unknown error",
      });
      return false;
    }
  }

  private async ensureModernAppSession(
    appId: string,
    generation = this.ceremonyGeneration,
    expectedEmail?: string,
  ): Promise<boolean> {
    const app = this.options.resolveApp(appId);
    const authority = this.resolveIdentityAuthority();
    if (!app || !authority || !this.isCeremonyCurrent(generation)) return false;
    const identityEmail =
      expectedEmail ?? (await this.verifyIdentitySession(authority));
    if (!identityEmail) return false;

    // Status notifications can arrive again after the child reloads. Keep a
    // matching session in place instead of minting another one-time ticket
    // and reloading the same WebView forever.
    if (await this.hasMatchingIdentitySession(app)) {
      return true;
    }
    if (await this.hasAppSession(app)) {
      await this.clearAppSessionCookies(app);
    }

    if (app.identityAuthority === true || app.id === authority.id) {
      return this.ensureAuthoritySessionFromIdentity(
        app,
        generation,
        identityEmail,
      );
    }
    if (app.workspaceSso !== true) return false;

    try {
      const startUrl = await this.mintWorkspaceEmbedStartUrl(authority, app);
      const response = await app.session.fetch(startUrl, {
        redirect: "follow",
        credentials: "include",
        headers: { Accept: "text/html,application/xhtml+xml" },
      });
      if (!response.ok) {
        throw new Error(`Embed session returned ${response.status}`);
      }
      const appEmail = await this.verifyIdentitySession(app, app.session);
      if (
        !appEmail ||
        normalizeIdentityEmail(appEmail) !==
          normalizeIdentityEmail(identityEmail)
      ) {
        await this.clearAppSessionCookies(app);
        return false;
      }
      this.reloadAppSafely(app);
      return true;
    } catch (error) {
      console.warn("[desktop identity] workspace app session mint failed", {
        appId: app.id,
        reason: error instanceof Error ? error.message : "unknown error",
      });
      return false;
    }
  }

  private async mintWorkspaceEmbedStartUrl(
    authority: DesktopIdentityApp,
    target: DesktopIdentityApp,
  ): Promise<string> {
    const cookieHeader = await getSessionCookieHeader(
      authority,
      this.options.identitySession,
    );
    console.info("[desktop identity] workspace embed request", {
      authorityOrigin: authority.origin,
      targetAppId: target.id,
      cookieNames: cookieHeaderNames(cookieHeader),
    });
    const response = await this.options.identitySession.fetch(
      new URL(DISPATCH_WORKSPACE_EMBED_ACTION, authority.origin).toString(),
      {
        method: "POST",
        redirect: "manual",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Agent-Native-CSRF": "1",
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        body: JSON.stringify({ app: target.id, path: "/", chrome: "minimal" }),
      },
    );
    console.info("[desktop identity] workspace embed response", {
      targetAppId: target.id,
      status: response.status,
      ok: response.ok,
    });
    let payload: { error?: unknown; startUrl?: unknown } | null;
    try {
      payload = (await response.json()) as {
        error?: unknown;
        startUrl?: unknown;
      };
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? `Dispatch returned invalid workspace app session data: ${error.message}`
          : "Dispatch returned invalid workspace app session data.",
      );
    }
    if (!response.ok || typeof payload?.startUrl !== "string") {
      const message =
        typeof payload?.error === "string" && payload.error.trim()
          ? payload.error.trim()
          : `Dispatch could not create a session for ${target.id}.`;
      throw new Error(message);
    }

    const startUrl = new URL(payload.startUrl);
    if (
      (startUrl.protocol !== "https:" && startUrl.protocol !== "http:") ||
      startUrl.origin !== target.origin ||
      !startUrl.pathname.endsWith("/_agent-native/embed/start") ||
      startUrl.searchParams.get("ticket") === null ||
      startUrl.username ||
      startUrl.password ||
      startUrl.hash
    ) {
      throw new Error("Dispatch returned an invalid workspace app session.");
    }
    return startUrl.toString();
  }

  private async runSignInFanout(
    appId: string,
    generation: number,
    options: { interactive?: boolean } = {},
  ): Promise<boolean> {
    if (!this.isCeremonyCurrent(generation)) return false;
    if (this.options.openExternal) {
      return this.runModernIdentityFanout(appId, generation);
    }
    if (!this.options.listApps) {
      return this.ensureAppSessionInternal(appId, {
        interactive: options.interactive !== false,
      });
    }

    const requestedApp = this.options.resolveApp(appId);
    if (!requestedApp) return false;

    const appsById = new Map<string, DesktopIdentityApp>();
    try {
      for (const app of this.options.listApps()) {
        if (
          app.id === appId ||
          app.identityAuthority === true ||
          app.workspaceSso === true
        ) {
          if (!appsById.has(app.id)) appsById.set(app.id, app);
        }
      }
    } catch (error) {
      void error;
      // A changing app list is treated as an empty snapshot. The explicit
      // target is still retained so a single-app sign-in remains possible.
    }
    appsById.set(requestedApp.id, requestedApp);

    const authority =
      [...appsById.values()].find((app) => app.identityAuthority) ??
      this.options.resolveApp("dispatch");
    if (this.options.isAvailable && !authority) {
      this.availability = "unavailable";
      this.setStatus("idle");
      return false;
    }

    const orderedApps: DesktopIdentityApp[] = [];
    const orderedIds = new Set<string>();
    for (const app of [authority, requestedApp, ...appsById.values()]) {
      if (app && !orderedIds.has(app.id)) {
        orderedIds.add(app.id);
        orderedApps.push(app);
      }
    }

    for (const app of orderedApps) this.unsupportedAppIds.delete(app.id);

    const firstApp = orderedApps[0];
    if (!firstApp) return false;
    const authoritySucceeded = await this.ensureAppSessionInternal(
      firstApp.id,
      { interactive: options.interactive !== false },
    );
    if (!authoritySucceeded || !this.isCeremonyCurrent(generation)) {
      return false;
    }

    // Anonymous availability is intentionally allowed to be false so a
    // user-scoped rollout can still show the parent sign-in surface. Once the
    // authority session exists, evaluate the same endpoint again with that
    // session before minting any child sessions.
    if (this.options.isAvailable) {
      let availableForSession = false;
      try {
        availableForSession = await this.options.isAvailable(
          firstApp,
          this.options.identitySession,
        );
      } catch (error) {
        console.warn(
          "[desktop identity] authenticated availability probe failed",
          {
            reason: error instanceof Error ? error.message : "unknown error",
          },
        );
      }
      if (!this.isCeremonyCurrent(generation)) return false;
      if (!availableForSession) {
        this.availability = "unavailable";
        if (!this.signOutOperation) this.setStatus("failed");
        return false;
      }
      this.availability = "available";
    }

    const remaining = orderedApps.filter((app) => app.id !== firstApp.id);
    const operations = remaining.map((app) =>
      this.ensureAppSessionInternal(app.id, {
        interactive: false,
        skipAvailabilityProbe: true,
        preserveStatus: app.id !== appId,
      }),
    );
    // A child that has no SSO-capable login path must not strand the parent
    // or the requested app; failed children are retried when opened.
    const allResults = Promise.allSettled(operations);
    const requestedIndex = remaining.findIndex((app) => app.id === appId);
    const requestedOperation =
      requestedIndex >= 0 ? operations[requestedIndex] : null;
    let requestedSucceeded = firstApp.id === appId;
    if (requestedOperation) {
      let requestedResult = false;
      try {
        requestedResult = await requestedOperation;
      } catch (error) {
        console.warn("[desktop identity] requested app session failed", {
          appId,
          reason: error instanceof Error ? error.message : "unknown error",
        });
      }
      requestedSucceeded =
        requestedResult === true && this.isCeremonyCurrent(generation);
    }
    if (!requestedSucceeded) {
      if (this.isCeremonyCurrent(generation) && !this.signOutOperation) {
        this.setStatus("failed");
      }
      return false;
    }
    if (this.isCeremonyCurrent(generation) && !this.signOutOperation) {
      this.setStatus("signed-in");
    }
    void allResults.then((results) => {
      const failedAppIds = remaining
        .filter((_app, index) => {
          const result = results[index];
          return result.status === "rejected" || !result.value;
        })
        .map((app) => app.id);
      if (failedAppIds.length > 0) {
        console.warn("[desktop identity] app session fan-out had failures", {
          appIds: failedAppIds,
        });
      }
    });
    return true;
  }

  private async runSessionAdoption(
    sourceApp: DesktopIdentityApp,
    generation: number,
  ): Promise<boolean> {
    if (!sourceApp.identityAuthority && sourceApp.workspaceSso !== true) {
      return false;
    }
    await this.waitForActiveSessionCopies();
    if (!this.isCeremonyCurrent(generation)) {
      return false;
    }

    const authority = this.resolveIdentityAuthority();
    if (!authority) return false;

    if (this.options.isAvailable) {
      let available = false;
      try {
        available = await this.options.isAvailable(
          authority,
          this.options.identitySession,
        );
      } catch (error) {
        void error;
      }
      if (!this.isCeremonyCurrent(generation) || !available) {
        this.availability = "unavailable";
        return false;
      }
      this.availability = "available";
    }

    const sourceCookie = await this.readAppSessionCookie(sourceApp);
    if (!sourceCookie) return false;
    let sourceEmail: string | null;
    try {
      sourceEmail = await this.verifyIdentitySession(
        sourceApp,
        sourceApp.session,
      );
    } catch (error) {
      console.warn("[desktop identity] source session verification failed", {
        appId: sourceApp.id,
        reason: error instanceof Error ? error.message : "unknown error",
      });
      return false;
    }
    if (!sourceEmail) return false;

    let currentIdentityCookies: Electron.Cookie[];
    try {
      currentIdentityCookies = await this.options.identitySession.cookies.get(
        {},
      );
    } catch (error) {
      console.warn("[desktop identity] could not inspect identity cookies", {
        reason: error instanceof Error ? error.message : "unknown error",
      });
      return false;
    }
    const authorityCookieNames = new Set(authority.cookieNames);
    const currentAuthorityCookies = currentIdentityCookies.filter(
      (cookie) =>
        cookieMatchesOrigin(cookie, authority.origin) &&
        authorityCookieNames.has(cookie.name),
    );
    const identityMatchesSource =
      currentAuthorityCookies.length > 0 &&
      currentAuthorityCookies.every(
        (cookie) => cookie.value === sourceCookie.value,
      );
    let identitySessionMatchesSource = identityMatchesSource;
    let currentAuthorityEmail: string | null = null;
    if (!identityMatchesSource) {
      if (currentAuthorityCookies.length > 0) {
        try {
          currentAuthorityEmail = await this.verifyIdentitySession(authority);
        } catch (error) {
          console.warn(
            "[desktop identity] authority session verification failed",
            {
              reason: error instanceof Error ? error.message : "unknown error",
            },
          );
          return false;
        }
      }
      if (
        currentAuthorityEmail &&
        normalizeIdentityEmail(currentAuthorityEmail) !==
          normalizeIdentityEmail(sourceEmail)
      ) {
        return false;
      }
      if (currentAuthorityEmail) {
        // A child app session is not a credential for the Dispatch authority.
        // Preserve an already-verified identity session instead of replacing
        // it with a host-specific child cookie.
        identitySessionMatchesSource = true;
      } else if (!sourceApp.identityAuthority) {
        return false;
      }
    }

    const previousStatus = this.status;
    this.setStatus("signing-in");
    const previousAuthorityCookies = currentIdentityCookies.filter(
      (cookie) =>
        cookieMatchesOrigin(cookie, authority.origin) &&
        authorityCookieNames.has(cookie.name),
    );
    try {
      if (!identitySessionMatchesSource) {
        await this.replaceIdentitySessionCookies(
          authority,
          sourceCookie,
          previousAuthorityCookies,
        );
        if (!this.isCeremonyCurrent(generation)) {
          await this.restoreIdentitySessionCookies(
            authority,
            previousAuthorityCookies,
          );
          return false;
        }
      }

      const verifiedEmail = await this.verifyIdentitySession(authority);
      if (
        !verifiedEmail ||
        normalizeIdentityEmail(verifiedEmail) !==
          normalizeIdentityEmail(sourceEmail) ||
        !this.isCeremonyCurrent(generation)
      ) {
        await this.restoreIdentitySessionCookies(
          authority,
          previousAuthorityCookies,
        );
        if (this.isCeremonyCurrent(generation)) {
          this.setStatus(previousStatus === "signed-in" ? "signed-in" : "idle");
        }
        return false;
      }

      const authorityAlreadyMatches =
        sourceApp.id === authority.id ||
        (identitySessionMatchesSource &&
          (await this.hasMatchingIdentitySession(authority))) ||
        (await this.hasMatchingAppSession(authority, sourceCookie.value));
      const authoritySucceeded = authorityAlreadyMatches
        ? true
        : await this.ensureAppSessionInternal(authority.id, {
            interactive: false,
            preserveIdentitySession: true,
            waitForSignOut: false,
          });
      if (!authoritySucceeded || !this.isCeremonyCurrent(generation)) {
        await this.restoreIdentitySessionCookies(
          authority,
          previousAuthorityCookies,
        );
        if (this.isCeremonyCurrent(generation)) {
          this.setStatus(previousStatus === "signed-in" ? "signed-in" : "idle");
        }
        return false;
      }

      const apps = this.listIdentityApps(sourceApp, authority);
      const remaining = apps.filter((app) => app.id !== authority.id);
      const results = await Promise.allSettled(
        remaining.map((app) =>
          this.ensureAppSessionInternal(app.id, {
            interactive: false,
            skipIfPresent: true,
            expectedSessionValue: sourceCookie.value,
            waitForSignOut: false,
            skipAvailabilityProbe: true,
            preserveStatus: true,
          }),
        ),
      );
      const failedAppIds = remaining
        .filter((_app, index) => {
          const result = results[index];
          return result.status === "rejected" || !result.value;
        })
        .map((app) => app.id);
      if (failedAppIds.length > 0) {
        // The verified source and authority sessions remain usable. A failed
        // app is retried when its webview is opened instead of locking the
        // whole workspace behind a second login.
        console.warn(
          "[desktop identity] automatic app session sync had failures",
          {
            appIds: failedAppIds,
          },
        );
      }
      if (this.isCeremonyCurrent(generation) && !this.signOutOperation) {
        this.setStatus("signed-in");
      }
      return true;
    } catch (error) {
      await this.restoreIdentitySessionCookies(
        authority,
        previousAuthorityCookies,
      );
      if (this.isCeremonyCurrent(generation)) {
        this.setStatus(previousStatus === "signed-in" ? "signed-in" : "idle");
      }
      console.warn("[desktop identity] automatic session adoption failed", {
        appId: sourceApp.id,
        reason: error instanceof Error ? error.message : "unknown error",
      });
      return false;
    }
  }

  private resolveIdentityAuthority(): DesktopIdentityApp | null {
    try {
      const authority = this.options
        .listApps?.()
        .find((app) => app.identityAuthority);
      if (authority) return authority;
    } catch (error) {
      void error;
    }
    return this.options.resolveApp("dispatch");
  }

  private listIdentityApps(
    sourceApp: DesktopIdentityApp,
    authority: DesktopIdentityApp,
  ): DesktopIdentityApp[] {
    const appsById = new Map<string, DesktopIdentityApp>();
    try {
      for (const app of this.options.listApps?.() ?? []) {
        if (!appsById.has(app.id)) appsById.set(app.id, app);
      }
    } catch (error) {
      void error;
    }
    appsById.set(sourceApp.id, sourceApp);
    appsById.set(authority.id, authority);
    return [...appsById.values()].filter(
      (app) =>
        (app.id === authority.id || app.workspaceSso === true) &&
        !this.unsupportedAppIds.has(app.id),
    );
  }

  private async readAppSessionCookie(
    app: DesktopIdentityApp,
  ): Promise<Electron.Cookie | null> {
    try {
      const cookies = await app.session.cookies.get({});
      const allowed = new Set(app.cookieNames);
      return (
        cookies.find(
          (cookie) =>
            cookieMatchesOrigin(cookie, app.origin) && allowed.has(cookie.name),
        ) ?? null
      );
    } catch (error) {
      void error;
      return null;
    }
  }

  private async replaceIdentitySessionCookies(
    authority: DesktopIdentityApp,
    sourceCookie: Electron.Cookie,
    previousCookies: Electron.Cookie[],
  ): Promise<void> {
    try {
      for (const name of authority.cookieNames) {
        await this.options.identitySession.cookies
          .remove(authority.origin, name)
          .catch(() => {});
      }
      for (const name of new Set(authority.cookieNames)) {
        await this.options.identitySession.cookies.set({
          url: authority.origin,
          name,
          value: sourceCookie.value,
          path: sourceCookie.path || "/",
          httpOnly: sourceCookie.httpOnly,
          secure: sourceCookie.secure,
          sameSite: sourceCookie.sameSite,
          ...(sourceCookie.expirationDate
            ? { expirationDate: sourceCookie.expirationDate }
            : {}),
        });
      }
    } catch (error) {
      await this.restoreIdentitySessionCookies(authority, previousCookies);
      throw error;
    }
  }

  private async restoreIdentitySessionCookies(
    authority: DesktopIdentityApp,
    cookies: Electron.Cookie[],
  ): Promise<void> {
    await Promise.all(
      authority.cookieNames.map((name) =>
        this.options.identitySession.cookies
          .remove(authority.origin, name)
          .catch(() => {}),
      ),
    );
    await Promise.all(
      cookies.map((cookie) =>
        this.options.identitySession.cookies
          .set({
            url: authority.origin,
            name: cookie.name,
            value: cookie.value,
            path: cookie.path || "/",
            httpOnly: cookie.httpOnly,
            secure: cookie.secure,
            sameSite: cookie.sameSite,
            ...(cookie.expirationDate
              ? { expirationDate: cookie.expirationDate }
              : {}),
          })
          .catch(() => {}),
      ),
    );
  }

  private async verifyIdentitySession(
    authority: DesktopIdentityApp,
    identitySession: Session = this.options.identitySession,
  ): Promise<string | null> {
    const cookieHeader = await getSessionCookieHeader(
      authority,
      identitySession,
    );
    const response = await identitySession.fetch(
      new URL("/_agent-native/auth/session", authority.origin).toString(),
      {
        method: "GET",
        redirect: "manual",
        credentials: "include",
        headers: {
          Accept: "application/json",
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
      },
    );
    if (!response.ok) return null;
    const body = (await response.json().catch((error) => {
      void error;
      return null;
    })) as { email?: unknown } | null;
    return typeof body?.email === "string" && body.email.trim().length > 0
      ? body.email.trim()
      : null;
  }

  async prepareExternalSignOut(
    apps: DesktopIdentityApp[],
    options: {
      logoutPath: DesktopWorkspaceLogoutPath;
      alreadyRevokedAppId: string;
    },
  ): Promise<boolean> {
    if (this.options.isAvailable) {
      const authorityApp = this.options.resolveApp("dispatch");
      const available = authorityApp
        ? await this.options
            .isAvailable(authorityApp, this.options.identitySession)
            .catch(() => false)
        : false;
      if (!available) {
        this.availability = "unavailable";
        this.setStatus("idle");
        return false;
      }
      this.availability = "available";
    }
    this.externalSignOutRequests += 1;
    this.updateSignOutIntent({ logoutPath: options.logoutPath });
    await this.ensureRevocationTargets(apps);
    return true;
  }

  completeExternalSignOut(
    apps: DesktopIdentityApp[],
    options: {
      logoutPath: DesktopWorkspaceLogoutPath;
      alreadyRevokedAppId: string;
    },
    succeeded: boolean,
  ): Promise<boolean> {
    this.externalSignOutRequests = Math.max(
      0,
      this.externalSignOutRequests - 1,
    );
    if (this.externalSignOutRequests === 0) {
      for (const resolve of this.externalSignOutWaiters) resolve();
      this.externalSignOutWaiters.clear();
    }
    if (succeeded) return this.signOut(apps, options);
    if (!this.signOutOperation && this.externalSignOutRequests === 0) {
      this.resetSignOutState();
    }
    return Promise.resolve(false);
  }

  signOut(
    apps: DesktopIdentityApp[],
    options?: {
      logoutPath?: DesktopWorkspaceLogoutPath;
      alreadyRevokedAppId?: string;
    },
  ): Promise<boolean> {
    this.ceremonyGeneration += 1;
    this.signInOperation = null;
    this.magicLinkRequestOperation = null;
    this.pendingByApp.clear();
    this.pendingModernAppSessions.clear();
    this.completedModernAppSessions.clear();
    this.unsupportedAppIds.clear();
    this.closeActiveWindow();
    this.updateSignOutIntent(options);
    if (this.signOutOperation) return this.signOutOperation;

    const intent = this.signOutIntent!;
    const operation = this.finishSignOut(apps, intent);
    this.signOutOperation = operation;
    void operation.then(
      () => {
        if (this.signOutOperation === operation) {
          this.signOutOperation = null;
          this.resetSignOutState();
        }
      },
      () => {
        if (this.signOutOperation === operation) {
          this.signOutOperation = null;
          this.resetSignOutState();
        }
      },
    );
    return operation;
  }

  private updateSignOutIntent(options?: {
    logoutPath?: DesktopWorkspaceLogoutPath;
    alreadyRevokedAppId?: string;
  }): void {
    const requestedPath = options?.logoutPath ?? DESKTOP_LOGOUT_PATH;
    if (!this.signOutIntent) {
      this.signOutIntent = {
        logoutPath: requestedPath,
        alreadyRevokedAppIds: new Set(
          options?.alreadyRevokedAppId ? [options.alreadyRevokedAppId] : [],
        ),
      };
      return;
    }

    if (
      requestedPath === DESKTOP_LOGOUT_ALL_PATH &&
      this.signOutIntent.logoutPath !== DESKTOP_LOGOUT_ALL_PATH
    ) {
      this.signOutIntent.logoutPath = DESKTOP_LOGOUT_ALL_PATH;
      this.signOutIntent.alreadyRevokedAppIds.clear();
    }
    if (
      requestedPath === this.signOutIntent.logoutPath &&
      options?.alreadyRevokedAppId
    ) {
      this.signOutIntent.alreadyRevokedAppIds.add(options.alreadyRevokedAppId);
    }
  }

  private async finishSignOut(
    apps: DesktopIdentityApp[],
    intent: DesktopSignOutIntent,
  ): Promise<boolean> {
    await this.waitForSessionAdoption();
    await this.waitForPasswordAuthentication();
    await this.waitForActiveSessionCopies();
    await this.ensureRevocationTargets(apps);
    const errors = [...this.revocationTargetErrors];
    let completedPath: DesktopWorkspaceLogoutPath | null = null;
    do {
      const logoutPath = intent.logoutPath;
      const alreadyRevokedAppIds = new Set(intent.alreadyRevokedAppIds);
      const revocations = (this.revocationTargets ?? [])
        .filter(
          (target) => !target.appId || !alreadyRevokedAppIds.has(target.appId),
        )
        .map((target) => this.revokeSession(target, logoutPath));
      for (const result of await Promise.allSettled(revocations)) {
        if (result.status === "rejected") errors.push(result.reason);
      }
      completedPath = logoutPath;
      await Promise.resolve();
    } while (intent.logoutPath !== completedPath);

    try {
      await this.options.identitySession.clearStorageData({
        storages: ["cookies"],
      });
    } catch (error) {
      errors.push(error);
    }

    for (const app of apps) {
      for (const cookieName of app.cookieNamesToClear) {
        try {
          await app.session.cookies.remove(app.origin, cookieName);
        } catch (error) {
          errors.push(error);
        }
      }
      try {
        this.options.reloadApp(app);
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      await this.options.clearLocalBroker();
    } catch (error) {
      errors.push(error);
    }

    await this.waitForExternalSignOutRequests();
    while (intent.logoutPath !== completedPath) {
      const logoutPath: DesktopWorkspaceLogoutPath = intent.logoutPath;
      const alreadyRevokedAppIds = new Set(intent.alreadyRevokedAppIds);
      const revocations = (this.revocationTargets ?? [])
        .filter(
          (target) => !target.appId || !alreadyRevokedAppIds.has(target.appId),
        )
        .map((target) => this.revokeSession(target, logoutPath));
      for (const result of await Promise.allSettled(revocations)) {
        if (result.status === "rejected") errors.push(result.reason);
      }
      completedPath = logoutPath;
    }
    if (errors.length > 0) {
      console.error(
        "[desktop identity] Workspace sign-out completed with failures",
        new AggregateError(errors),
      );
      this.setStatus("failed");
      return false;
    }
    this.setStatus("sign-in-required");
    return true;
  }

  private async revokeSession(
    target: DesktopRevocationTarget,
    logoutPath: DesktopWorkspaceLogoutPath,
  ): Promise<void> {
    const logoutUrl = new URL(logoutPath, target.origin);
    logoutUrl.searchParams.set(
      "_an_desktop_logout",
      this.internalRevocationNonce,
    );
    const response = await target.session.fetch(logoutUrl.toString(), {
      method: "POST",
      redirect: "manual",
      credentials: "include",
      ...(target.cookieHeader
        ? { headers: { Cookie: target.cookieHeader } }
        : {}),
    });
    if (!response.ok && !(response.status === 401 && !target.cookieHeader)) {
      throw new Error(
        `Workspace sign-out failed for ${target.origin} (${response.status})`,
      );
    }
  }

  private async ensureRevocationTargets(
    apps: DesktopIdentityApp[],
  ): Promise<void> {
    if (!this.revocationTargetsPromise) {
      this.revocationTargetsPromise = (async () => {
        const authority = apps.find((app) => app.identityAuthority);
        const candidates = [
          ...apps.map((app) => ({
            appId: app.id,
            origin: app.origin,
            session: app.session,
            cookieNames: app.cookieNamesToClear,
          })),
          ...(authority
            ? [
                {
                  appId: null,
                  origin: authority.origin,
                  session: this.options.identitySession,
                  cookieNames: authority.cookieNamesToClear,
                },
              ]
            : []),
        ];
        const targets: DesktopRevocationTarget[] = [];
        for (const candidate of candidates) {
          try {
            const cookies = await candidate.session.cookies.get({});
            const allowed = new Set(candidate.cookieNames);
            targets.push({
              appId: candidate.appId,
              origin: candidate.origin,
              session: candidate.session,
              cookieHeader: cookies
                .filter(
                  (cookie) =>
                    cookieMatchesOrigin(cookie, candidate.origin) &&
                    allowed.has(cookie.name),
                )
                .map((cookie) => `${cookie.name}=${cookie.value}`)
                .join("; "),
            });
          } catch (error) {
            this.revocationTargetErrors.push(error);
          }
        }
        this.revocationTargets = targets;
      })();
    }
    await this.revocationTargetsPromise;
  }

  private async waitForExternalSignOutRequests(): Promise<void> {
    while (this.externalSignOutRequests > 0) {
      await new Promise<void>((resolve) =>
        this.externalSignOutWaiters.add(resolve),
      );
    }
  }

  private resetSignOutState(): void {
    this.signOutIntent = null;
    this.revocationTargets = null;
    this.revocationTargetErrors = [];
    this.revocationTargetsPromise = null;
  }

  private async hasAppSession(app: DesktopIdentityApp): Promise<boolean> {
    try {
      const cookies = await app.session.cookies.get({});
      const allowed = new Set(app.cookieNames);
      return cookies.some(
        (cookie) =>
          cookieMatchesOrigin(cookie, app.origin) && allowed.has(cookie.name),
      );
    } catch (error) {
      void error;
      return false;
    }
  }

  private async clearAppSessionCookies(app: DesktopIdentityApp): Promise<void> {
    await Promise.all(
      app.cookieNamesToClear.map((cookieName) =>
        app.session.cookies.remove(app.origin, cookieName),
      ),
    );
  }

  private async hasMatchingAppSession(
    app: DesktopIdentityApp,
    value: string,
  ): Promise<boolean> {
    try {
      const cookies = await app.session.cookies.get({});
      const allowed = new Set(app.cookieNames);
      const sessionCookies = cookies.filter(
        (cookie) =>
          cookieMatchesOrigin(cookie, app.origin) && allowed.has(cookie.name),
      );
      return (
        sessionCookies.length > 0 &&
        sessionCookies.every((cookie) => cookie.value === value)
      );
    } catch (error) {
      void error;
      return false;
    }
  }

  private async hasMatchingIdentitySession(
    app: DesktopIdentityApp,
  ): Promise<boolean> {
    const authority = this.resolveIdentityAuthority();
    if (!authority || !(await this.hasAppSession(app))) return false;

    const [authorityEmail, appEmail] = await Promise.all([
      this.verifyIdentitySession(authority),
      this.verifyIdentitySession(app, app.session),
    ]);
    return Boolean(
      authorityEmail &&
      appEmail &&
      normalizeIdentityEmail(authorityEmail) ===
        normalizeIdentityEmail(appEmail),
    );
  }

  private async pollDesktopOAuthExchange(
    authorityApp: DesktopIdentityApp,
    flowId: string,
    verifier: string | null,
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    const deadline =
      Date.now() + (this.options.timeoutMs ?? DEFAULT_CEREMONY_TIMEOUT_MS);
    const exchangeUrl = new URL(DESKTOP_EXCHANGE_PATH, authorityApp.origin);
    exchangeUrl.searchParams.set("flow_id", flowId);
    if (verifier) exchangeUrl.searchParams.set("verifier", verifier);

    while (Date.now() < deadline) {
      this.assertCeremonyActive(generation, signal);
      let response: Response;
      try {
        response = await this.options.identitySession.fetch(
          exchangeUrl.toString(),
          {
            headers: { Accept: "application/json" },
            credentials: "include",
          },
        );
      } catch (error) {
        throw new Error(
          error instanceof Error
            ? error.message
            : "Could not reach the desktop sign-in exchange.",
        );
      }

      let payload: {
        code?: unknown;
        email?: unknown;
        error?: unknown;
        pending?: unknown;
        token?: unknown;
      };
      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        throw new Error("The desktop sign-in exchange returned invalid data.");
      }
      const exchangeError =
        typeof payload.error === "string" && payload.error.trim()
          ? payload.error.trim()
          : null;
      const exchangeCode =
        typeof payload.code === "string" && payload.code.trim()
          ? ` (${payload.code.trim()})`
          : "";
      if (!response.ok) {
        throw new Error(
          exchangeError
            ? `${exchangeError}${exchangeCode}`
            : "The desktop sign-in exchange failed.",
        );
      }

      const token =
        typeof payload.token === "string" ? payload.token.trim() : "";
      if (token) {
        this.assertCeremonyActive(generation, signal);
        // The exchange response intentionally returns the one-time credential
        // to the native shell. Store it only in the isolated identity session;
        // copyTargetSession then moves it into the target app partition.
        for (const cookieName of authorityApp.cookieNames) {
          this.assertCeremonyActive(generation, signal);
          await this.options.identitySession.cookies.set({
            url: authorityApp.origin,
            name: cookieName,
            value: token,
            path: "/",
            httpOnly: true,
            secure: true,
          });
        }
        return;
      }
      if (exchangeError) {
        throw new Error(
          `The desktop sign-in exchange returned an error${exchangeCode}: ${exchangeError}`,
        );
      }
      if (payload.pending !== true) {
        throw new Error("The desktop sign-in exchange returned no session.");
      }

      await this.waitForCookiePoll(
        Math.min(
          DESKTOP_EXCHANGE_POLL_INTERVAL_MS,
          Math.max(0, deadline - Date.now()),
        ),
        signal,
      );
    }

    throw new Error("The desktop sign-in exchange timed out.");
  }

  private async runCeremony(
    appId: string,
    generation: number,
    options: {
      interactive?: boolean;
      preserveIdentitySession?: boolean;
      preserveStatus?: boolean;
      skipAvailabilityProbe?: boolean;
    } = {},
  ): Promise<boolean> {
    if (!this.isCeremonyCurrent(generation)) return false;
    const app = this.options.resolveApp(appId);
    if (!app) return false;
    const markUnsupported = () => {
      // A background synchronization can fail because a deploy is warming or
      // a redirect is temporarily unavailable. Only an interactive ceremony
      // may permanently remove an app from the current fan-out snapshot.
      if (options.interactive !== false) this.unsupportedAppIds.add(app.id);
    };
    const setCeremonyStatus = (status: DesktopIdentityStatus) => {
      if (!options.preserveStatus) this.setStatus(status);
    };

    let authorityApp: DesktopIdentityApp | null = null;
    if (this.options.isAvailable) {
      authorityApp = this.options.resolveApp("dispatch");
      if (!authorityApp) {
        this.availability = "unavailable";
        markUnsupported();
        setCeremonyStatus("idle");
        this.reloadAppSafely(app);
        return false;
      }
      let available = false;
      if (options.skipAvailabilityProbe) {
        available = this.availability === "available";
      } else {
        try {
          available = await this.options.isAvailable(
            authorityApp,
            this.options.identitySession,
          );
        } catch (error) {
          void error;
          available = false;
        }
      }
      if (!this.isCeremonyCurrent(generation)) return false;
      if (!available) {
        this.availability = "unavailable";
        if (options.interactive === false) {
          markUnsupported();
          setCeremonyStatus("idle");
          this.reloadAppSafely(app);
          return false;
        }
      } else {
        this.availability = "available";
      }
    }

    setCeremonyStatus("signing-in");
    const nonce = randomBytes(32).toString("base64url");
    const returnPath = new URL(completionUrl(app.origin, nonce));
    const loginPath =
      app.identityAuthority === true
        ? DESKTOP_IDENTITY_AUTHORITY_LOGIN_PATH
        : DESKTOP_IDENTITY_LOGIN_PATH;
    const loginUrl = new URL(loginPath, app.origin);
    loginUrl.searchParams.set(
      "return",
      returnPath.pathname + returnPath.search,
    );

    let initialUrl = loginUrl.toString();
    if (this.options.resolveLoginRedirect) {
      let redirectUrl: string | null;
      try {
        redirectUrl = await this.options.resolveLoginRedirect(
          initialUrl,
          this.options.identitySession,
        );
      } catch (error) {
        void error;
        if (!this.isCeremonyCurrent(generation)) return false;
        console.warn("[desktop-identity] identity preflight failed");
        markUnsupported();
        setCeremonyStatus("failed");
        this.reloadAppSafely(app);
        return false;
      }
      if (!this.isCeremonyCurrent(generation)) return false;
      if (!redirectUrl) {
        markUnsupported();
        setCeremonyStatus("failed");
        this.reloadAppSafely(app);
        return false;
      }
      initialUrl = redirectUrl;
      if (!isDesktopIdentityCompletion(initialUrl, app, nonce)) {
        authorityApp ??= this.options.resolveApp("dispatch");
        if (
          !authorityApp ||
          !isDesktopIdentityAuthorizeNavigation(initialUrl, authorityApp, app)
        ) {
          markUnsupported();
          setCeremonyStatus("failed");
          this.reloadAppSafely(app);
          return false;
        }
      }
    }

    if (!this.isCeremonyCurrent(generation)) return false;

    const identityWindow = this.options.createWindow({
      width: 520,
      height: 720,
      title: "Sign in to Agent Native",
      show: options.interactive !== false,
      backgroundColor: "#111111",
      parent: this.options.parentWindow?.() ?? undefined,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        session: this.options.identitySession,
      },
    });
    this.activeWindow = identityWindow;

    return new Promise<boolean>((resolve) => {
      const ceremonyAbort = new AbortController();
      let settled = false;
      let completionStarted = false;
      let desktopExchangeStarted = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (ok: boolean, status: DesktopIdentityStatus) => {
        if (settled) return;
        settled = true;
        if (!ok) ceremonyAbort.abort();
        if (timer) clearTimeout(timer);
        if (this.activeWindow === identityWindow) this.activeWindow = null;
        if (!options.preserveStatus && this.isCeremonyCurrent(generation)) {
          this.setStatus(status);
        }
        if (!identityWindow.isDestroyed()) identityWindow.close();
        resolve(ok);
      };

      const completeAfterAuthentication = () => {
        if (settled || completionStarted) return;
        completionStarted = true;
        void this.trackSessionCopy(
          this.copyTargetSession(
            app,
            generation,
            ceremonyAbort.signal,
            options.preserveIdentitySession,
          ),
        ).then(
          () => {
            if (!this.isCeremonyCurrent(generation)) {
              finish(false, "sign-in-required");
              return;
            }
            this.reloadAppSafely(app);
            finish(true, "signed-in");
          },
          (error) => {
            if (ceremonyAbort.signal.aborted) return;
            this.recoverFromSessionCopyFailure(app, generation, error);
            finish(false, "failed");
          },
        );
      };

      const startDesktopExchange = (navigationUrl: string) => {
        if (desktopExchangeStarted || !authorityApp) return;
        const flowId = extractDesktopOAuthFlowId(navigationUrl);
        if (!flowId) return;
        const verifier = extractDesktopOAuthVerifier(navigationUrl);
        desktopExchangeStarted = true;
        void this.pollDesktopOAuthExchange(
          authorityApp,
          flowId,
          verifier,
          generation,
          ceremonyAbort.signal,
        ).then(
          () => completeAfterAuthentication(),
          (error) => {
            if (ceremonyAbort.signal.aborted || settled) return;
            console.warn("[desktop-identity] desktop OAuth exchange failed", {
              appId: app.id,
              reason: error instanceof Error ? error.message : "unknown error",
            });
            this.reloadAppSafely(app);
            finish(false, "failed");
          },
        );
      };

      const inspectNavigation = (event: Electron.Event, url: string) => {
        if (isDesktopIdentityCompletion(url, app, nonce)) {
          return;
        }
        startDesktopExchange(url);
        if (
          this.options.handleOAuthNavigation?.(url, identityWindow.webContents)
        ) {
          event.preventDefault();
          return;
        }
        if (isAllowedDesktopIdentityOAuthNavigation(url)) return;
        let origin: string;
        try {
          origin = new URL(url).origin;
        } catch (error) {
          void error;
          event.preventDefault();
          finish(false, "failed");
          return;
        }
        if (
          origin === app.origin ||
          (authorityApp && origin === authorityApp.origin)
        ) {
          return;
        }
        event.preventDefault();
        finish(false, "failed");
      };

      identityWindow.webContents.on("will-navigate", inspectNavigation);
      identityWindow.webContents.on("will-redirect", (event, url) =>
        inspectNavigation(event, url),
      );
      identityWindow.webContents.on(
        "did-navigate",
        (_event, url, httpResponseCode) => {
          if (
            !settled &&
            httpResponseCode >= 400 &&
            authorityApp &&
            isDesktopIdentityAuthorizeNavigation(url, authorityApp, app)
          ) {
            markUnsupported();
            this.reloadAppSafely(app);
            finish(false, "idle");
            return;
          }
          if (
            settled ||
            completionStarted ||
            !isDesktopIdentityCompletion(url, app, nonce)
          ) {
            return;
          }
          if (!this.isCeremonyCurrent(generation)) {
            finish(false, "sign-in-required");
            return;
          }
          if (httpResponseCode !== 200) {
            console.warn("[desktop-identity] authenticated completion failed", {
              appId: app.id,
              statusCode: httpResponseCode,
            });
            this.reloadAppSafely(app);
            finish(false, "failed");
            return;
          }
          completeAfterAuthentication();
        },
      );
      identityWindow.webContents.setWindowOpenHandler(({ url }) =>
        this.options.handleWindowOpen
          ? this.options.handleWindowOpen(identityWindow.webContents, url)
          : { action: "deny" },
      );
      identityWindow.webContents.on("render-process-gone", () =>
        finish(false, "failed"),
      );
      identityWindow.on("closed", () => {
        // The hosted desktop callback page closes itself after it has claimed
        // the browser session. Keep the broker alive until its one-time
        // exchange poll copies that session into the target app.
        if (desktopExchangeStarted && !completionStarted) return;
        finish(false, "sign-in-required");
      });

      timer = setTimeout(
        () => finish(false, "sign-in-required"),
        this.options.timeoutMs ?? DEFAULT_CEREMONY_TIMEOUT_MS,
      );

      void identityWindow.loadURL(initialUrl).catch(() => {
        finish(false, "failed");
      });
    });
  }

  private async copyTargetSession(
    app: DesktopIdentityApp,
    generation: number,
    signal?: AbortSignal,
    preserveIdentitySession = false,
  ): Promise<void> {
    this.assertCeremonyActive(generation, signal);
    const allowed = new Set(app.cookieNames);
    const deadline =
      Date.now() +
      (this.options.sessionCookieWaitMs ?? DEFAULT_SESSION_COOKIE_WAIT_MS);
    let cookies: Electron.Cookie[] = [];
    do {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      const sourceCookies = await this.readIdentityCookies(remainingMs, signal);
      this.assertCeremonyActive(generation, signal);
      cookies = sourceCookies.filter(
        (cookie) =>
          cookieMatchesOrigin(cookie, app.origin) && allowed.has(cookie.name),
      );
      if (cookies.length > 0) {
        console.info("[desktop-identity] target session cookie observed", {
          appId: app.id,
          cookieNames: cookies.map((cookie) => cookie.name),
        });
      }
      if (cookies.length > 0 || Date.now() >= deadline) break;
      await this.waitForCookiePoll(
        Math.min(SESSION_COOKIE_POLL_INTERVAL_MS, deadline - Date.now()),
        signal,
      );
      this.assertCeremonyActive(generation, signal);
    } while (true);
    if (cookies.length === 0) throw new Error("Missing app session cookie");

    const writtenCookieNames: string[] = [];
    try {
      for (const cookieName of app.cookieNames) {
        this.assertCeremonyActive(generation, signal);
        await app.session.cookies
          .remove(app.origin, cookieName)
          .catch(() => {});
      }
      for (const cookie of cookies) {
        this.assertCeremonyActive(generation, signal);
        await app.session.cookies.set({
          url: app.origin,
          name: cookie.name,
          value: cookie.value,
          path: cookie.path || "/",
          httpOnly: cookie.httpOnly,
          secure: cookie.secure,
          sameSite: cookie.sameSite,
          ...(cookie.expirationDate
            ? { expirationDate: cookie.expirationDate }
            : {}),
        });
        writtenCookieNames.push(cookie.name);
        this.assertCeremonyActive(generation, signal);
      }

      if (!app.identityAuthority && !preserveIdentitySession) {
        for (const cookie of cookies) {
          this.assertCeremonyActive(generation, signal);
          await this.options.identitySession.cookies
            .remove(app.origin, cookie.name)
            .catch(() => {});
          this.assertCeremonyActive(generation, signal);
        }
      }
      this.assertCeremonyActive(generation, signal);
    } catch (error) {
      if (!this.isCeremonyCurrent(generation) || signal?.aborted) {
        await Promise.all(
          writtenCookieNames.map((cookieName) =>
            app.session.cookies.remove(app.origin, cookieName).catch(() => {}),
          ),
        );
      }
      throw error;
    }
  }

  private async readIdentityCookies(
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Electron.Cookie[]> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const stopped = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error("Identity cookie read timed out")),
        timeoutMs,
      );
      if (signal) {
        onAbort = () =>
          reject(new Error("Desktop identity ceremony was cancelled"));
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
    try {
      return await Promise.race([
        // Partitioned cookies can be omitted by Chromium when the filter
        // includes a URL but the current network partition is not supplied.
        // Read the identity partition, then keep only the target app's
        // allow-listed names in copyTargetSession.
        this.options.identitySession.cookies.get({}),
        stopped,
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    }
  }

  private async waitForCookiePoll(
    delayMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (delayMs <= 0) return;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("Desktop identity ceremony was cancelled"));
      };
      timeout = setTimeout(finish, delayMs);
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private recoverFromSessionCopyFailure(
    app: DesktopIdentityApp,
    generation: number,
    error: unknown,
  ): void {
    if (!this.isCeremonyCurrent(generation)) return;
    console.warn("[desktop-identity] target session transfer failed", {
      appId: app.id,
      reason:
        error instanceof Error
          ? error.message.slice(0, 200)
          : "unknown transfer error",
    });
    this.reloadAppSafely(app);
  }

  private reloadAppSafely(app: DesktopIdentityApp): void {
    try {
      this.options.reloadApp(app);
    } catch (error) {
      // Session transfer succeeded even when an old webview was destroyed
      // during reload; never strand the broker before its completion signal.
      console.warn(
        "[desktop-identity] app reload after session transfer failed",
        {
          appId: app.id,
          reason:
            error instanceof Error
              ? error.message.slice(0, 200)
              : "unknown error",
        },
      );
    }
  }

  private closeActiveWindow(): void {
    const active = this.activeWindow;
    this.activeWindow = null;
    if (active && !active.isDestroyed()) active.close();
  }

  private trackSessionCopy(operation: Promise<void>): Promise<void> {
    this.activeSessionCopies.add(operation);
    void operation.then(
      () => this.activeSessionCopies.delete(operation),
      () => this.activeSessionCopies.delete(operation),
    );
    return operation;
  }

  private async waitForActiveSessionCopies(): Promise<void> {
    while (this.activeSessionCopies.size > 0) {
      await Promise.allSettled([...this.activeSessionCopies]);
    }
  }

  private async waitForSessionAdoption(): Promise<void> {
    const operation = this.sessionAdoptionOperation;
    if (operation) await Promise.allSettled([operation]);
  }

  private async waitForPasswordAuthentication(): Promise<void> {
    const operation = this.passwordAuthOperation;
    if (operation) await Promise.allSettled([operation]);
  }

  private isCeremonyCurrent(generation: number): boolean {
    return generation === this.ceremonyGeneration;
  }

  private pendingOperationKey(
    appId: string,
    expectedSessionValue?: string,
  ): string {
    return `${appId}\u0000${expectedSessionValue ?? ""}`;
  }

  private assertCeremonyCurrent(generation: number): void {
    if (!this.isCeremonyCurrent(generation)) {
      throw new Error("Desktop identity ceremony was cancelled");
    }
  }

  private assertCeremonyActive(generation: number, signal?: AbortSignal): void {
    this.assertCeremonyCurrent(generation);
    if (signal?.aborted) {
      throw new Error("Desktop identity ceremony was cancelled");
    }
  }

  private setStatus(status: DesktopIdentityStatus): void {
    if (
      status === "signing-in" ||
      status === "sign-in-required" ||
      status === "failed"
    ) {
      this.completedModernAppSessions.clear();
    }
    this.status = status;
    this.options.onStatus?.(status);
  }
}
