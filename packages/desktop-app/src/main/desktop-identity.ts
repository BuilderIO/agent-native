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
  private queue: Promise<void> = Promise.resolve();
  private activeWindow: DesktopIdentityWindow | null = null;
  private status: DesktopIdentityStatus = "idle";

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

    const operation = this.queue.then(() => this.runCeremony(appId));
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

  async signOut(apps: DesktopIdentityApp[]): Promise<void> {
    this.closeActiveWindow();
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

  private async runCeremony(appId: string): Promise<boolean> {
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
        const location = response.headers.get("location");
        if (response.status < 300 || response.status >= 400 || !location) {
          this.unsupportedAppIds.add(app.id);
          this.setStatus("failed");
          this.options.reloadApp(app);
          return false;
        }
        initialUrl = new URL(location, initialUrl).toString();
      } catch {
        this.unsupportedAppIds.add(app.id);
        this.setStatus("failed");
        this.options.reloadApp(app);
        return false;
      }
    }

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
        this.setStatus(status);
        if (!identityWindow.isDestroyed()) identityWindow.close();
        resolve(ok);
      };

      const inspectNavigation = (event: Electron.Event, url: string) => {
        if (isDesktopIdentityCompletion(url, app, nonce)) {
          event.preventDefault();
          void this.copyTargetSession(app).then(
            () => {
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

  private async copyTargetSession(app: DesktopIdentityApp): Promise<void> {
    const sourceCookies = await this.options.identitySession.cookies.get({
      url: app.origin,
    });
    const allowed = new Set(app.cookieNames);
    const cookies = sourceCookies.filter((cookie) => allowed.has(cookie.name));
    if (cookies.length === 0) throw new Error("Missing app session cookie");

    for (const cookieName of app.cookieNames) {
      await app.session.cookies.remove(app.origin, cookieName).catch(() => {});
    }
    for (const cookie of cookies) {
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
    }

    if (!app.identityAuthority) {
      for (const cookie of cookies) {
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

  private setStatus(status: DesktopIdentityStatus): void {
    this.status = status;
    this.options.onStatus?.(status);
  }
}
