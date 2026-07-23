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

const DESKTOP_SIGN_IN_PATH = "/_agent-native/sign-in";
const DESKTOP_IDENTITY_LOGIN_PATH = "/_agent-native/identity/login";
const DEFAULT_CEREMONY_TIMEOUT_MS = 5 * 60 * 1000;

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

export function isDesktopWorkspaceLogoutRequest(
  requestUrl: string,
  app: Pick<DesktopIdentityApp, "origin">,
): boolean {
  try {
    const parsed = new URL(requestUrl);
    return (
      parsed.origin === app.origin &&
      (parsed.pathname === "/_agent-native/auth/logout" ||
        parsed.pathname === "/_agent-native/auth/logout-all")
    );
  } catch {
    return false;
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
  resolveApp: (appId: string) => DesktopIdentityApp | null;
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
}

export function isDesktopSignInNavigation(
  navigationUrl: string,
  app: Pick<DesktopIdentityApp, "origin">,
): boolean {
  try {
    const parsed = new URL(navigationUrl);
    return (
      parsed.origin === app.origin && parsed.pathname === DESKTOP_SIGN_IN_PATH
    );
  } catch {
    return false;
  }
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

export class DesktopIdentityBroker {
  private readonly pendingByApp = new Map<string, Promise<boolean>>();
  private readonly unsupportedAppIds = new Set<string>();
  private readonly activeSessionCopies = new Set<Promise<void>>();
  private queue: Promise<void> = Promise.resolve();
  private activeWindow: DesktopIdentityWindow | null = null;
  private signOutOperation: Promise<void> | null = null;
  private status: DesktopIdentityStatus = "idle";
  private ceremonyGeneration = 0;
  private automaticSignInSuppressed = false;

  constructor(private readonly options: DesktopIdentityBrokerOptions) {}

  getStatus(): DesktopIdentityStatus {
    return this.status;
  }

  async refreshStatus(authorityApp: DesktopIdentityApp | null): Promise<void> {
    if (!authorityApp) {
      this.setStatus("idle");
      return;
    }
    const cookies = await this.options.identitySession.cookies.get({
      url: authorityApp.origin,
    });
    const allowed = new Set(authorityApp.cookieNames);
    this.setStatus(
      cookies.some((cookie) => allowed.has(cookie.name))
        ? "signed-in"
        : "sign-in-required",
    );
  }

  handleSignedOutNavigation(appId: string, navigationUrl: string): boolean {
    const app = this.options.resolveApp(appId);
    if (
      !app ||
      this.automaticSignInSuppressed ||
      this.unsupportedAppIds.has(appId) ||
      !isDesktopSignInNavigation(navigationUrl, app)
    ) {
      return false;
    }
    void this.ensureAppSession(appId);
    return true;
  }

  ensureAppSession(appId: string): Promise<boolean> {
    const existing = this.pendingByApp.get(appId);
    if (existing) return existing;

    const generation = this.ceremonyGeneration;
    const operation = this.queue.then(async () => {
      await this.signOutOperation;
      return this.runCeremony(appId, generation);
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

  signIn(appId: string): Promise<boolean> {
    this.automaticSignInSuppressed = false;
    this.unsupportedAppIds.delete(appId);
    return this.ensureAppSession(appId);
  }

  signOut(apps: DesktopIdentityApp[]): Promise<void> {
    this.automaticSignInSuppressed = true;
    this.ceremonyGeneration += 1;
    this.pendingByApp.clear();
    this.closeActiveWindow();
    if (this.signOutOperation) return this.signOutOperation;

    const operation = this.finishSignOut(apps);
    this.signOutOperation = operation;
    void operation.then(
      () => {
        if (this.signOutOperation === operation) this.signOutOperation = null;
      },
      () => {
        if (this.signOutOperation === operation) this.signOutOperation = null;
      },
    );
    return operation;
  }

  private async finishSignOut(apps: DesktopIdentityApp[]): Promise<void> {
    await this.waitForActiveSessionCopies();
    await this.options.identitySession.clearStorageData({
      storages: ["cookies"],
    });

    for (const app of apps) {
      for (const cookieName of app.cookieNamesToClear) {
        await app.session.cookies
          .remove(app.origin, cookieName)
          .catch(() => {});
      }
      this.options.reloadApp(app);
    }
    await this.options.clearLocalBroker();
    this.setStatus("sign-in-required");
  }

  private async runCeremony(
    appId: string,
    generation: number,
  ): Promise<boolean> {
    if (!this.isCeremonyCurrent(generation)) return false;
    const app = this.options.resolveApp(appId);
    if (!app) return false;

    this.setStatus("signing-in");
    const nonce = randomBytes(32).toString("base64url");
    const returnPath = new URL(completionUrl(app.origin, nonce));
    const loginUrl = new URL(DESKTOP_IDENTITY_LOGIN_PATH, app.origin);
    loginUrl.searchParams.set(
      "return",
      returnPath.pathname + returnPath.search,
    );

    let initialUrl = loginUrl.toString();
    if (typeof this.options.identitySession.fetch === "function") {
      try {
        const response = await this.options.identitySession.fetch(initialUrl, {
          redirect: "manual",
        });
        if (!this.isCeremonyCurrent(generation)) return false;
        const location = response.headers.get("location");
        if (response.status < 300 || response.status >= 400 || !location) {
          this.unsupportedAppIds.add(app.id);
          this.setStatus("failed");
          this.options.reloadApp(app);
          return false;
        }
        initialUrl = new URL(location, initialUrl).toString();
      } catch {
        if (!this.isCeremonyCurrent(generation)) return false;
        this.unsupportedAppIds.add(app.id);
        this.setStatus("failed");
        this.options.reloadApp(app);
        return false;
      }
    }

    if (!this.isCeremonyCurrent(generation)) return false;

    const identityWindow = this.options.createWindow({
      width: 520,
      height: 720,
      title: "Sign in to Agent Native",
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
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (ok: boolean, status: DesktopIdentityStatus) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (this.activeWindow === identityWindow) this.activeWindow = null;
        if (this.isCeremonyCurrent(generation)) this.setStatus(status);
        if (!identityWindow.isDestroyed()) identityWindow.close();
        resolve(ok);
      };

      const inspectNavigation = (event: Electron.Event, url: string) => {
        if (isDesktopIdentityCompletion(url, app, nonce)) {
          event.preventDefault();
          if (!this.isCeremonyCurrent(generation)) {
            finish(false, "sign-in-required");
            return;
          }
          void this.trackSessionCopy(
            this.copyTargetSession(app, generation),
          ).then(
            () => {
              if (!this.isCeremonyCurrent(generation)) {
                finish(false, "sign-in-required");
                return;
              }
              this.options.reloadApp(app);
              finish(true, "signed-in");
            },
            () => finish(false, "failed"),
          );
          return;
        }
        if (
          this.options.handleOAuthNavigation?.(url, identityWindow.webContents)
        ) {
          event.preventDefault();
        }
      };

      identityWindow.webContents.on("will-navigate", inspectNavigation);
      identityWindow.webContents.on("will-redirect", (event, url) =>
        inspectNavigation(event, url),
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
  ): Promise<void> {
    this.assertCeremonyCurrent(generation);
    const sourceCookies = await this.options.identitySession.cookies.get({
      url: app.origin,
    });
    this.assertCeremonyCurrent(generation);
    const allowed = new Set(app.cookieNames);
    const cookies = sourceCookies.filter((cookie) => allowed.has(cookie.name));
    if (cookies.length === 0) throw new Error("Missing app session cookie");

    for (const cookieName of app.cookieNames) {
      this.assertCeremonyCurrent(generation);
      await app.session.cookies.remove(app.origin, cookieName).catch(() => {});
    }
    for (const cookie of cookies) {
      this.assertCeremonyCurrent(generation);
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
      if (!this.isCeremonyCurrent(generation)) {
        await app.session.cookies
          .remove(app.origin, cookie.name)
          .catch(() => {});
        this.assertCeremonyCurrent(generation);
      }
    }

    if (!app.identityAuthority) {
      for (const cookie of cookies) {
        this.assertCeremonyCurrent(generation);
        await this.options.identitySession.cookies
          .remove(app.origin, cookie.name)
          .catch(() => {});
      }
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

  private isCeremonyCurrent(generation: number): boolean {
    return generation === this.ceremonyGeneration;
  }

  private assertCeremonyCurrent(generation: number): void {
    if (!this.isCeremonyCurrent(generation)) {
      throw new Error("Desktop identity ceremony was cancelled");
    }
  }

  private setStatus(status: DesktopIdentityStatus): void {
    this.status = status;
    this.options.onStatus?.(status);
  }
}
