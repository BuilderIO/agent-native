import { randomBytes } from "node:crypto";

import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  Session,
  WebContents,
  WindowOpenHandlerResponse,
} from "electron";

export const DESKTOP_IDENTITY_PARTITION = "persist:agent-native-identity";
export const DESKTOP_IDENTITY_COMPLETE_PATH =
  "/_agent-native/identity/desktop-complete";

const DESKTOP_IDENTITY_LOGIN_PATH = "/_agent-native/identity/login";
const DESKTOP_IDENTITY_AUTHORIZE_PATH = "/_agent-native/identity/authorize";
const DESKTOP_IDENTITY_CALLBACK_PATH = "/_agent-native/identity/callback";
const DESKTOP_LOGOUT_PATH = "/_agent-native/auth/logout";
const DESKTOP_LOGOUT_ALL_PATH = "/_agent-native/auth/logout-all";
const DEFAULT_CEREMONY_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_SESSION_COOKIE_WAIT_MS = 2_000;
const DEFAULT_AVAILABILITY_TIMEOUT_MS = 5_000;
const SESSION_COOKIE_POLL_INTERVAL_MS = 25;
const DESKTOP_IDENTITY_APP_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export type DesktopWorkspaceLogoutPath =
  | typeof DESKTOP_LOGOUT_PATH
  | typeof DESKTOP_LOGOUT_ALL_PATH;

export type DesktopIdentityStatus =
  | "idle"
  | "signing-in"
  | "signed-in"
  | "sign-in-required"
  | "failed";

export interface DesktopIdentityApp {
  id: string;
  origin: string;
  session: Session;
  cookieNames: string[];
  cookieNamesToClear: string[];
  identityAuthority?: boolean;
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
  } catch {
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
  } catch {
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
  } catch {
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
  } catch {
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
      },
    );
    if (!response.ok) return false;
    const body = (await response.json().catch(() => null)) as {
      available?: unknown;
    } | null;
    return body?.available === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export class DesktopIdentityBroker {
  private readonly pendingByApp = new Map<string, Promise<boolean>>();
  private readonly unsupportedAppIds = new Set<string>();
  private readonly activeSessionCopies = new Set<Promise<void>>();
  private queue: Promise<void> = Promise.resolve();
  private activeWindow: DesktopIdentityWindow | null = null;
  private signInOperation: Promise<boolean> | null = null;
  private signOutOperation: Promise<void> | null = null;
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

  isInternalRevocationRequest(requestUrl: string): boolean {
    try {
      return (
        new URL(requestUrl).searchParams.get("_an_desktop_logout") ===
        this.internalRevocationNonce
      );
    } catch {
      return false;
    }
  }

  async refreshStatus(authorityApp: DesktopIdentityApp | null): Promise<void> {
    const observedStatus = this.status;
    const observedGeneration = this.ceremonyGeneration;
    if (observedStatus === "signing-in" || this.signOutOperation) return;
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
        this.setStatus("idle");
        return;
      }
      this.availability = "available";
    }
    const cookies = await this.options.identitySession.cookies.get({
      url: authorityApp.origin,
    });
    if (
      this.status !== observedStatus ||
      this.ceremonyGeneration !== observedGeneration ||
      this.signOutOperation
    ) {
      return;
    }
    const allowed = new Set(authorityApp.cookieNames);
    this.setStatus(
      cookies.some((cookie) => allowed.has(cookie.name))
        ? "signed-in"
        : "sign-in-required",
    );
  }

  private ensureAppSessionInternal(
    appId: string,
    options: { interactive?: boolean; skipIfPresent?: boolean } = {},
  ): Promise<boolean> {
    const existing = this.pendingByApp.get(appId);
    if (existing) return existing;

    const generation = this.ceremonyGeneration;
    const operation = this.queue.then(async () => {
      await this.signOutOperation;
      await this.waitForActiveSessionCopies();
      const app = this.options.resolveApp(appId);
      if (!app) return false;
      if (options.skipIfPresent && (await this.hasAppSession(app))) {
        return true;
      }
      return this.runCeremony(appId, generation, options);
    });
    this.queue = operation.then(
      () => undefined,
      () => undefined,
    );
    this.pendingByApp.set(appId, operation);
    void operation.finally(() => {
      if (this.pendingByApp.get(appId) === operation) {
        this.pendingByApp.delete(appId);
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

    const generation = this.ceremonyGeneration;
    const operation = this.ensureAppSessionInternal(appId, {
      interactive: false,
      skipIfPresent: true,
    });
    void operation.then((succeeded) => {
      if (
        !succeeded &&
        this.ceremonyGeneration === generation &&
        !this.signOutOperation
      ) {
        this.unsupportedAppIds.add(appId);
      }
    });
    return operation;
  }

  signIn(appId: string): Promise<boolean> {
    if (
      !this.options.resolveApp(appId) ||
      (this.options.isAvailable && !this.options.resolveApp("dispatch")) ||
      (this.options.isAvailable && this.availability !== "available")
    ) {
      return Promise.resolve(false);
    }
    if (this.signInOperation) return this.signInOperation;

    this.unsupportedAppIds.delete(appId);
    const operation = this.runSignInFanout(appId);
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

  private async runSignInFanout(appId: string): Promise<boolean> {
    if (!this.options.listApps) {
      return this.ensureAppSessionInternal(appId, { interactive: true });
    }

    const generation = this.ceremonyGeneration;
    const requestedApp = this.options.resolveApp(appId);
    if (!requestedApp) return false;

    const appsById = new Map<string, DesktopIdentityApp>();
    try {
      for (const app of this.options.listApps()) {
        if (!appsById.has(app.id)) appsById.set(app.id, app);
      }
    } catch {
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
      { interactive: true },
    );
    if (!authoritySucceeded || !this.isCeremonyCurrent(generation)) {
      return false;
    }

    const remaining = orderedApps.filter((app) => app.id !== firstApp.id);
    const results = await Promise.allSettled(
      remaining.map((app) =>
        this.ensureAppSessionInternal(app.id, { interactive: false }),
      ),
    );
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
  ): Promise<void> {
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
    return Promise.resolve();
  }

  signOut(
    apps: DesktopIdentityApp[],
    options?: {
      logoutPath?: DesktopWorkspaceLogoutPath;
      alreadyRevokedAppId?: string;
    },
  ): Promise<void> {
    this.ceremonyGeneration += 1;
    this.signInOperation = null;
    this.pendingByApp.clear();
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
  ): Promise<void> {
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
      return;
    }
    this.setStatus("sign-in-required");
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
    if (!response.ok && response.status !== 401) {
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
            const cookies = await candidate.session.cookies.get({
              url: candidate.origin,
            });
            const allowed = new Set(candidate.cookieNames);
            targets.push({
              appId: candidate.appId,
              origin: candidate.origin,
              session: candidate.session,
              cookieHeader: cookies
                .filter((cookie) => allowed.has(cookie.name))
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
      const cookies = await app.session.cookies.get({ url: app.origin });
      const allowed = new Set(app.cookieNames);
      return cookies.some((cookie) => allowed.has(cookie.name));
    } catch {
      return false;
    }
  }

  private async runCeremony(
    appId: string,
    generation: number,
    options: { interactive?: boolean } = {},
  ): Promise<boolean> {
    if (!this.isCeremonyCurrent(generation)) return false;
    const app = this.options.resolveApp(appId);
    if (!app) return false;

    let authorityApp: DesktopIdentityApp | null = null;
    if (this.options.isAvailable) {
      authorityApp = this.options.resolveApp("dispatch");
      if (!authorityApp) {
        this.availability = "unavailable";
        this.unsupportedAppIds.add(app.id);
        this.setStatus("idle");
        this.options.reloadApp(app);
        return false;
      }
      let available = false;
      try {
        available = await this.options.isAvailable(
          authorityApp,
          this.options.identitySession,
        );
      } catch {
        available = false;
      }
      if (!this.isCeremonyCurrent(generation)) return false;
      if (!available) {
        this.availability = "unavailable";
        this.unsupportedAppIds.add(app.id);
        this.setStatus("idle");
        this.options.reloadApp(app);
        return false;
      }
      this.availability = "available";
    }

    this.setStatus("signing-in");
    const nonce = randomBytes(32).toString("base64url");
    const returnPath = new URL(completionUrl(app.origin, nonce));
    const loginUrl = new URL(DESKTOP_IDENTITY_LOGIN_PATH, app.origin);
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
      } catch {
        if (!this.isCeremonyCurrent(generation)) return false;
        console.warn("[desktop-identity] identity preflight failed");
        this.unsupportedAppIds.add(app.id);
        this.setStatus("failed");
        this.options.reloadApp(app);
        return false;
      }
      if (!this.isCeremonyCurrent(generation)) return false;
      if (!redirectUrl) {
        this.unsupportedAppIds.add(app.id);
        this.setStatus("failed");
        this.options.reloadApp(app);
        return false;
      }
      initialUrl = redirectUrl;
      if (!isDesktopIdentityCompletion(initialUrl, app, nonce)) {
        authorityApp ??= this.options.resolveApp("dispatch");
        if (
          !authorityApp ||
          !isDesktopIdentityAuthorizeNavigation(initialUrl, authorityApp, app)
        ) {
          this.unsupportedAppIds.add(app.id);
          this.setStatus("failed");
          this.options.reloadApp(app);
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
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (ok: boolean, status: DesktopIdentityStatus) => {
        if (settled) return;
        settled = true;
        if (!ok) ceremonyAbort.abort();
        if (timer) clearTimeout(timer);
        if (this.activeWindow === identityWindow) this.activeWindow = null;
        if (this.isCeremonyCurrent(generation)) this.setStatus(status);
        if (!identityWindow.isDestroyed()) identityWindow.close();
        resolve(ok);
      };

      const inspectNavigation = (event: Electron.Event, url: string) => {
        if (isDesktopIdentityCompletion(url, app, nonce)) {
          return;
        }
        if (
          this.options.handleOAuthNavigation?.(url, identityWindow.webContents)
        ) {
          event.preventDefault();
          return;
        }
        let origin: string;
        try {
          origin = new URL(url).origin;
        } catch {
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
            this.unsupportedAppIds.add(app.id);
            this.options.reloadApp(app);
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
          completionStarted = true;
          if (!this.isCeremonyCurrent(generation)) {
            finish(false, "sign-in-required");
            return;
          }
          if (httpResponseCode !== 200) {
            console.warn("[desktop-identity] authenticated completion failed", {
              appId: app.id,
              statusCode: httpResponseCode,
            });
            this.options.reloadApp(app);
            finish(false, "failed");
            return;
          }
          void this.trackSessionCopy(
            this.copyTargetSession(app, generation, ceremonyAbort.signal),
          ).then(
            () => {
              if (!this.isCeremonyCurrent(generation)) {
                finish(false, "sign-in-required");
                return;
              }
              this.options.reloadApp(app);
              finish(true, "signed-in");
            },
            () => {
              if (ceremonyAbort.signal.aborted) return;
              this.recoverFromSessionCopyFailure(app, generation);
              finish(false, "failed");
            },
          );
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
      identityWindow.on("closed", () => finish(false, "sign-in-required"));

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
      const sourceCookies = await this.readIdentityCookies(
        app.origin,
        remainingMs,
        signal,
      );
      this.assertCeremonyActive(generation, signal);
      cookies = sourceCookies.filter((cookie) => allowed.has(cookie.name));
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

      if (!app.identityAuthority) {
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
    origin: string,
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
        this.options.identitySession.cookies.get({ url: origin }),
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
  ): void {
    if (!this.isCeremonyCurrent(generation)) return;
    console.warn("[desktop-identity] target session transfer failed", {
      appId: app.id,
    });
    this.options.reloadApp(app);
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

  private isCeremonyCurrent(generation: number): boolean {
    return generation === this.ceremonyGeneration;
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
    this.status = status;
    this.options.onStatus?.(status);
  }
}
