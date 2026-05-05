import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  session,
  shell,
  webContents,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import path from "path";
import { autoUpdater } from "electron-updater";
import {
  IPC,
  type ActiveWebviewTarget,
  type InterAppMessage,
  type UpdateStatus,
} from "@shared/ipc-channels";
import { FRAME_PORT } from "@shared/app-registry";
import type { AppConfig } from "@shared/app-registry";
import * as AppStore from "./app-store";

const IS_DEV = !app.isPackaged;

// ---------- User-Agent marker ----------
// Tag every request from this Electron app so the server can distinguish
// Agent Native desktop from other Electron-based webviews (Builder.io's
// Fusion, Slack desktop, Discord, etc.). Without this, any Electron UA
// would trigger the desktop-only OAuth deep-link page (`agentnative://...`),
// stranding users in non-Agent-Native Electron contexts on a "Connected!
// Open Agent Native" screen whose deep link can't fire.
app.userAgentFallback = `${app.userAgentFallback} AgentNativeDesktop/${app.getVersion()}`;

// ---------- Deep link protocol (agentnative://) ----------
// Register before app is ready so macOS associates the scheme with this app.

const DEEP_LINK_PROTOCOL = "agentnative";
if (IS_DEV) {
  app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [
    path.resolve(process.argv[1]),
  ]);
} else {
  app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
}

let pendingDeepLink: string | null = null;
const PENDING_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const pendingOAuthStates = new Map<string, number>();

function prunePendingOAuthStates(now = Date.now()) {
  for (const [state, expiresAt] of pendingOAuthStates) {
    if (expiresAt <= now) pendingOAuthStates.delete(state);
  }
}

function rememberOAuthState(url: string) {
  try {
    const state = new URL(url).searchParams.get("state");
    if (!state) return;
    prunePendingOAuthStates();
    pendingOAuthStates.set(state, Date.now() + PENDING_OAUTH_STATE_TTL_MS);
  } catch {
    // Malformed URL — ignore
  }
}

function consumeOAuthState(state: string | null): boolean {
  if (!state) return false;
  const now = Date.now();
  prunePendingOAuthStates(now);
  const expiresAt = pendingOAuthStates.get(state);
  if (!expiresAt || expiresAt <= now) return false;
  pendingOAuthStates.delete(state);
  return true;
}

async function handleDeepLink(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.host === "oauth-complete") {
      const token = parsed.searchParams.get("token");
      if (token) {
        if (!consumeOAuthState(parsed.searchParams.get("state"))) {
          console.warn(
            "[main] rejected oauth-complete deep link without matching OAuth state",
          );
          return;
        }
        await injectSessionAndReload(token);
      } else {
        reloadAllWebviews();
      }
    }
  } catch {
    // Malformed URL — ignore
  }
}

async function injectSessionAndReload(token: string) {
  // Each webview runs in its own persisted partition (persist:app-<id>), so
  // cookies must be written to every known app partition — not just the
  // active webviews and not session.defaultSession. Otherwise apps that
  // haven't been opened yet (e.g. Calendar when only Mail is visible at
  // login) won't pick up the session cookie.
  const frameOrigin = `http://localhost:${FRAME_PORT}`;
  let apps: AppConfig[] = [];
  try {
    apps = AppStore.loadApps();
  } catch (err) {
    console.error("[main] failed to load apps for session injection:", err);
  }
  // Per-app cookie name. The framework derives session cookies from APP_NAME
  // (e.g. an_session_mail, an_session_calendar) so apps don't share one cookie
  // slot on localhost — browsers scope cookies by host, not host+port. Mirror
  // that here so each partition gets the right cookie.
  const cookieNameForApp = (id: string) => {
    const slug = id
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return slug ? `an_session_${slug}` : "an_session";
  };
  const targets: {
    session: Electron.Session;
    origin: string;
    cookieName: string;
  }[] = [];
  for (const appConfig of apps) {
    const sess = session.fromPartition(`persist:app-${appConfig.id}`);
    // Dev-mode apps load through the frame (localhost:3334); prod-mode apps
    // load their production URL directly. Set the cookie on whichever origin
    // the app actually talks to. Dev-mode always gets the frame origin;
    // prod-mode gets the configured URL if available.
    const isProdMode = appConfig.mode !== "dev";
    let origin = frameOrigin;
    if (isProdMode && appConfig.url) {
      try {
        origin = new URL(appConfig.url).origin;
      } catch (err) {
        console.error(
          `[main] invalid production URL for ${appConfig.id} (${appConfig.url}); falling back to frame origin:`,
          err,
        );
      }
    }
    targets.push({
      session: sess,
      origin,
      cookieName: cookieNameForApp(appConfig.id),
    });
  }
  // Also cover any currently-live webview origins not matched above
  // (e.g. production URLs). For unknown origins we don't know which app they
  // belong to, so set the legacy cookie name as a fallback.
  const seen = new Set<string>(
    targets.map((t) => `${t.origin}|${t.cookieName}`),
  );
  for (const wc of webContents.getAllWebContents()) {
    if (wc.getType() !== "webview") continue;
    try {
      const origin = new URL(wc.getURL()).origin;
      const key = `${origin}|an_session`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ session: wc.session, origin, cookieName: "an_session" });
    } catch {}
  }
  for (const { session: sess, origin, cookieName } of targets) {
    try {
      await sess.cookies.set({
        url: origin,
        name: cookieName,
        value: token,
        httpOnly: true,
        path: "/",
        expirationDate: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      });
    } catch (err) {
      console.error(
        `[main] cookie.set (${cookieName}) failed for ${origin}:`,
        err,
      );
    }
  }
  reloadAllWebviews();
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
}

function reloadAllWebviews() {
  for (const wc of webContents.getAllWebContents()) {
    if (wc.getType() === "webview") wc.reload();
  }
}

// macOS: deep links arrive via open-url (both when app is running and on cold launch)
app.on("open-url", (event, url) => {
  event.preventDefault();
  if (app.isReady()) {
    handleDeepLink(url);
  } else {
    pendingDeepLink = url;
  }
});

// ---------- Auto-updates ----------
//
// In production, electron-updater pulls release metadata from the
// `publish:` target in electron-builder.yml (currently the BuilderIO/agent-native
// GitHub repo). We auto-download in the background, surface progress and
// readiness to the renderer over IPC, and let the user trigger
// quitAndInstall from a sidebar pill / restart prompt. The app also
// installs queued updates automatically on quit.
//
// In dev, autoUpdater is unsupported (no app signature, no dev-app-update.yml),
// so we report an "unsupported" status and skip all autoUpdater calls.

let currentUpdateStatus: UpdateStatus = IS_DEV
  ? { state: "unsupported", reason: "Auto-update is disabled in development" }
  : { state: "idle" };

function broadcastUpdateStatus(status: UpdateStatus) {
  currentUpdateStatus = status;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.UPDATE_STATUS_CHANGED, status);
    }
  }
}

if (!IS_DEV) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    broadcastUpdateStatus({ state: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    broadcastUpdateStatus({
      state: "available",
      version: info.version,
      releaseNotes:
        typeof info.releaseNotes === "string" ? info.releaseNotes : undefined,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    broadcastUpdateStatus({
      state: "not-available",
      currentVersion: info.version ?? app.getVersion(),
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    broadcastUpdateStatus({
      state: "downloading",
      percent: Math.round(progress.percent ?? 0),
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    broadcastUpdateStatus({
      state: "downloaded",
      version: info.version,
      releaseNotes:
        typeof info.releaseNotes === "string" ? info.releaseNotes : undefined,
    });
  });

  autoUpdater.on("error", (err) => {
    broadcastUpdateStatus({
      state: "error",
      message: err?.message ?? String(err),
    });
  });

  app.whenReady().then(() => {
    autoUpdater.checkForUpdates().catch(() => {
      // Errors are surfaced via the 'error' event above; swallow the
      // promise rejection so it doesn't become an unhandled rejection.
    });
    // Re-check every 4 hours
    setInterval(
      () => {
        autoUpdater.checkForUpdates().catch(() => {});
      },
      4 * 60 * 60 * 1000,
    );
  });
}

ipcMain.handle(IPC.UPDATE_GET_STATUS, (): UpdateStatus => currentUpdateStatus);

ipcMain.handle(IPC.UPDATE_CHECK, async (): Promise<UpdateStatus> => {
  if (IS_DEV) return currentUpdateStatus;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    broadcastUpdateStatus({
      state: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
  return currentUpdateStatus;
});

ipcMain.handle(IPC.UPDATE_DOWNLOAD, async (): Promise<UpdateStatus> => {
  if (IS_DEV) return currentUpdateStatus;
  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    broadcastUpdateStatus({
      state: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
  return currentUpdateStatus;
});

ipcMain.handle(IPC.UPDATE_INSTALL, () => {
  if (IS_DEV) return;
  // isSilent=false so any installer UI shows; isForceRunAfter=true so the
  // app relaunches after the update completes.
  autoUpdater.quitAndInstall(false, true);
});

function createWindow(): BrowserWindow {
  const isMac = process.platform === "darwin";

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,

    // macOS: hidden title bar with traffic lights positioned in the tab bar
    // Windows/Linux: fully frameless, custom controls in renderer
    titleBarStyle: "hidden",
    // Traffic lights in the far top-left of the tab bar
    ...(isMac && { trafficLightPosition: { x: 14, y: 12 } }),

    backgroundColor: "#111111",
    show: false,

    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      webSecurity: true,
    },
  });

  // Avoid white flash — show window once content is ready
  win.once("ready-to-show", () => win.show());

  // In dev, load from the Vite dev server; in prod, load built files
  if (IS_DEV && process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    // DevTools will be opened for the active webview via Cmd+Shift+I
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  return win;
}

// ---------- DevTools: target the active app webview ----------

let activeAppId = "";
let activeWebviewContentsId: number | undefined;

ipcMain.on(IPC.SET_ACTIVE_APP, (_event: IpcMainEvent, appId: string) => {
  activeAppId = appId;
});

ipcMain.on(
  IPC.SET_ACTIVE_WEBVIEW,
  (_event: IpcMainEvent, target: ActiveWebviewTarget) => {
    activeAppId = target.appId;
    activeWebviewContentsId = target.webContentsId;
  },
);

function getActiveWebviewContents() {
  const allContents = webContents.getAllWebContents();
  const webviewContents = allContents.filter(
    (wc) => wc.getType() === "webview",
  );

  const activeTarget =
    activeWebviewContentsId &&
    webContents.fromId(activeWebviewContentsId)?.getType() === "webview"
      ? webContents.fromId(activeWebviewContentsId)
      : undefined;

  // Fall back to the currently focused guest, then to the active app by URL.
  return (
    activeTarget ||
    webviewContents.find((wc) => wc.isFocused()) ||
    (activeAppId &&
      webviewContents.find((wc) => {
        try {
          const url = new URL(wc.getURL());
          return url.searchParams.get("app") === activeAppId;
        } catch {
          return false;
        }
      })) ||
    webviewContents[0]
  );
}

function toggleWebviewDevTools() {
  const target = getActiveWebviewContents();
  if (!target) return;
  if (target.isDevToolsOpened()) {
    target.closeDevTools();
  } else {
    target.openDevTools({ mode: "detach" });
  }
}

// Electron's built-in zoomIn/zoomOut/resetZoom menu roles act on the focused
// webContents, which is the shell renderer (the chrome around the apps), not
// the webview guest where the actual app content lives. So the user sees no
// effect. Apply zoom directly to the active webview's webContents instead.
const ZOOM_STEP = 0.5;
const ZOOM_MIN = -3;
const ZOOM_MAX = 3;

function zoomActiveWebview(delta: number) {
  const target = getActiveWebviewContents();
  if (!target) return;
  const next = Math.max(
    ZOOM_MIN,
    Math.min(ZOOM_MAX, target.getZoomLevel() + delta),
  );
  target.setZoomLevel(next);
}

function resetActiveWebviewZoom() {
  const target = getActiveWebviewContents();
  if (!target) return;
  target.setZoomLevel(0);
}

// ---------- Native context menus ----------
// Electron does not provide Chromium's standard right-click menu by default,
// so add the useful browser/editing actions for both the shell and app webviews.

const contextMenuContents = new WeakSet<Electron.WebContents>();

function canOpenExternalUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return (
      protocol === "http:" ||
      protocol === "https:" ||
      protocol === "mailto:" ||
      protocol === "tel:"
    );
  } catch {
    return false;
  }
}

function openExternalUrl(url: string) {
  if (!canOpenExternalUrl(url)) return;
  shell.openExternal(url).catch(() => {});
}

function cleanContextMenuTemplate(
  template: Electron.MenuItemConstructorOptions[],
): Electron.MenuItemConstructorOptions[] {
  while (template[0]?.type === "separator") template.shift();
  while (template.at(-1)?.type === "separator") template.pop();
  return template.filter((item, index, items) => {
    if (item.type !== "separator") return true;
    return items[index - 1]?.type !== "separator";
  });
}

function addContextMenuSeparator(
  template: Electron.MenuItemConstructorOptions[],
) {
  if (template.length === 0 || template.at(-1)?.type === "separator") return;
  template.push({ type: "separator" });
}

function buildContextMenuTemplate(
  contents: Electron.WebContents,
  params: Electron.ContextMenuParams,
): Electron.MenuItemConstructorOptions[] {
  const template: Electron.MenuItemConstructorOptions[] = [];
  const editFlags = params.editFlags;
  const hasLink = params.linkURL.trim().length > 0;
  const hasSelection = params.selectionText.trim().length > 0;
  const hasMediaSource = params.srcURL.trim().length > 0;
  const hasImage = params.mediaType === "image" && params.hasImageContents;

  if (hasLink) {
    template.push(
      {
        label: "Open Link in Browser",
        enabled: canOpenExternalUrl(params.linkURL),
        click: () => openExternalUrl(params.linkURL),
      },
      {
        label: "Copy Link",
        click: () => clipboard.writeText(params.linkURL),
      },
    );
  }

  if (hasImage || hasMediaSource) {
    addContextMenuSeparator(template);
    if (hasImage) {
      template.push({
        label: "Copy Image",
        click: () => contents.copyImageAt(params.x, params.y),
      });
    }
    if (hasMediaSource) {
      template.push({
        label: hasImage ? "Copy Image Address" : "Copy Media Address",
        click: () => clipboard.writeText(params.srcURL),
      });
    }
  }

  if (params.isEditable) {
    if (
      params.misspelledWord &&
      params.dictionarySuggestions &&
      params.dictionarySuggestions.length > 0
    ) {
      addContextMenuSeparator(template);
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        template.push({
          label: suggestion,
          click: () => contents.replaceMisspelling(suggestion),
        });
      }
    }

    addContextMenuSeparator(template);
    template.push(
      {
        label: "Undo",
        enabled: editFlags.canUndo,
        click: () => contents.undo(),
      },
      {
        label: "Redo",
        enabled: editFlags.canRedo,
        click: () => contents.redo(),
      },
      { type: "separator" },
      {
        label: "Cut",
        enabled: editFlags.canCut,
        click: () => contents.cut(),
      },
      {
        label: "Copy",
        enabled: editFlags.canCopy || hasSelection,
        click: () => contents.copy(),
      },
      {
        label: "Paste",
        enabled: editFlags.canPaste,
        click: () => contents.paste(),
      },
      {
        label: "Paste and Match Style",
        enabled: editFlags.canPaste && editFlags.canEditRichly,
        click: () => contents.pasteAndMatchStyle(),
      },
      {
        label: "Delete",
        enabled: editFlags.canDelete,
        click: () => contents.delete(),
      },
      { type: "separator" },
      {
        label: "Select All",
        enabled: editFlags.canSelectAll,
        click: () => contents.selectAll(),
      },
    );
  } else if (hasSelection) {
    addContextMenuSeparator(template);
    template.push({
      label: "Copy",
      click: () => contents.copy(),
    });
  }

  if (IS_DEV) {
    addContextMenuSeparator(template);
    template.push({
      label: "Inspect Element",
      click: () => contents.inspectElement(params.x, params.y),
    });
  }

  return cleanContextMenuTemplate(template);
}

function installContextMenu(contents: Electron.WebContents) {
  if (contextMenuContents.has(contents)) return;
  contextMenuContents.add(contents);

  contents.on("context-menu", (event, params) => {
    const template = buildContextMenuTemplate(contents, params);
    if (template.length === 0) return;

    event.preventDefault();
    const menu = Menu.buildFromTemplate(template);
    const window =
      BrowserWindow.fromWebContents(contents) ||
      BrowserWindow.getFocusedWindow() ||
      BrowserWindow.getAllWindows()[0];
    menu.popup({ window, x: params.x, y: params.y });
  });
}

// ---------- IPC: Window controls ----------

ipcMain.on(IPC.WINDOW_MINIMIZE, (event: IpcMainEvent) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on(IPC.WINDOW_MAXIMIZE, (event: IpcMainEvent) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  win.isMaximized() ? win.restore() : win.maximize();
});

ipcMain.on(IPC.WINDOW_CLOSE, (event: IpcMainEvent) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle(
  IPC.WINDOW_IS_MAXIMIZED,
  (event: IpcMainInvokeEvent): boolean => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  },
);

// ---------- IPC: App config management ----------

ipcMain.handle(IPC.APPS_LOAD, (): AppConfig[] => {
  return AppStore.loadApps();
});

ipcMain.handle(
  IPC.APPS_ADD,
  (_event: IpcMainInvokeEvent, app: AppConfig): AppConfig[] => {
    return AppStore.addApp(app);
  },
);

ipcMain.handle(
  IPC.APPS_REMOVE,
  (_event: IpcMainInvokeEvent, id: string): AppConfig[] => {
    return AppStore.removeApp(id);
  },
);

ipcMain.handle(
  IPC.APPS_UPDATE,
  (
    _event: IpcMainInvokeEvent,
    id: string,
    updates: Partial<AppConfig>,
  ): AppConfig[] => {
    return AppStore.updateApp(id, updates);
  },
);

ipcMain.handle(IPC.APPS_RESET, (): AppConfig[] => {
  return AppStore.resetToDefaults();
});

// ---------- IPC: Frame settings ----------

ipcMain.handle(IPC.FRAME_LOAD, () => {
  return AppStore.loadFrameSettings();
});

ipcMain.handle(
  IPC.FRAME_UPDATE,
  (_event: IpcMainInvokeEvent, settings: Partial<AppStore.FrameSettings>) => {
    return AppStore.saveFrameSettings(settings);
  },
);

// ---------- IPC: Inter-app message relay ----------
// Routes messages from one app to all renderer windows so webviews can forward them.

ipcMain.on(IPC.INTER_APP_SEND, (event: IpcMainEvent, msg: InterAppMessage) => {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send(IPC.INTER_APP_MESSAGE, msg);
  });
});

// ---------- OAuth handling ----------
// Open OAuth in an Electron BrowserWindow (not the system browser) so
// the callback sets the session cookie in the same Electron session as
// the app webviews. After the callback completes, auto-close the OAuth
// window and reload webviews to pick up the new auth state.

// OAuth providers we recognize as "safe to open inside an Electron popup"
// instead of handing off to the system browser. Each provider specifies:
//   - a `matches` predicate on the initial URL (from window.open)
//   - a `callbackPathFragment` used to detect when the OAuth callback has
//     been reached so we can auto-close the popup
//
// Builder is matched on two URL shapes: (1) the localhost 302 starter at
// `/_agent-native/builder/connect`, which is what the in-app button opens,
// and (2) the resolved `builder.io/cli-auth` URL, so both shapes route
// through the same popup. Private keys delivered by the callback are
// written server-side (template `.env` + SQL `persisted-env-vars`) — they
// never touch the webview/renderer. See credential-provider.ts.
interface OAuthProvider {
  name: string;
  matches: (url: URL, context?: OAuthMatchContext) => boolean;
  /** Substring to look for in the navigation URL to detect callback arrival. */
  callbackPathFragment: string;
}

interface OAuthMatchContext {
  sourceUrl?: string;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function isGoogleOAuthStarterPath(pathname: string): boolean {
  return (
    pathname.endsWith("/_agent-native/google/auth-url") ||
    pathname.endsWith("/_agent-native/google/add-account/auth-url")
  );
}

function getUrlOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function isTrustedGoogleOAuthStarter(
  url: URL,
  context?: OAuthMatchContext,
): boolean {
  if (!isGoogleOAuthStarterPath(url.pathname)) return false;
  if (isLoopbackHost(url.hostname)) return true;
  return getUrlOrigin(context?.sourceUrl) === url.origin;
}

const OAUTH_PROVIDERS: OAuthProvider[] = [
  {
    name: "google",
    matches: (u, context) =>
      u.hostname === "accounts.google.com" ||
      isTrustedGoogleOAuthStarter(u, context),
    callbackPathFragment: "google/callback",
  },
  {
    name: "builder",
    matches: (u) => {
      const host = u.hostname.toLowerCase();
      const isLocalhost =
        host === "localhost" || host === "127.0.0.1" || host === "[::1]";
      // (a) The localhost 302 starter the in-app button opens.
      if (
        isLocalhost &&
        u.pathname.endsWith("/_agent-native/builder/connect")
      ) {
        return true;
      }
      // (b) The resolved Builder CLI-auth URL. Gate on `/cli-auth` so
      // ordinary builder.io links (docs, marketing, etc.) opened from a
      // webview don't get hijacked into the OAuth popup — they'd load
      // fine but never hit the callback and the popup would just sit
      // open on a docs page.
      const isBuilderDomain =
        host === "builder.io" || host.endsWith(".builder.io");
      return isBuilderDomain && u.pathname.startsWith("/cli-auth");
    },
    callbackPathFragment: "/_agent-native/builder/callback",
  },
];

function matchOAuthProvider(
  urlString: string,
  context?: OAuthMatchContext,
): OAuthProvider | null {
  try {
    const parsed = new URL(urlString);
    return OAUTH_PROVIDERS.find((p) => p.matches(parsed, context)) ?? null;
  } catch {
    return null;
  }
}

function shouldRememberOAuthStateFromNavigation(
  provider: OAuthProvider,
  url: URL,
): boolean {
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (provider.name === "google") {
    return url.hostname === "accounts.google.com";
  }
  return provider.matches(url);
}

function rememberOAuthStateFromNavigation(
  provider: OAuthProvider,
  url: string,
) {
  try {
    const parsed = new URL(url);
    if (shouldRememberOAuthStateFromNavigation(provider, parsed)) {
      rememberOAuthState(url);
    }
  } catch {
    // Malformed URL — ignore
  }
}

function openOAuthWindow(
  url: string,
  sourceSession: Electron.Session | undefined,
  provider: OAuthProvider,
) {
  rememberOAuthStateFromNavigation(provider, url);
  const mainWin = BrowserWindow.getAllWindows()[0];

  // Critical: the popup MUST share the source webview's session so the
  // OAuth callback hits the server with the user's auth cookies. Without
  // this, the callback runs in Electron's default session (no cookies),
  // sees `local@localhost`, and saves tokens under the connected account's
  // email instead of the actual signed-in user — turning the "connect"
  // flow into an infinite redirect loop in dev mode.
  const oauthWin = new BrowserWindow({
    width: 500,
    height: 700,
    title: "Sign in",
    backgroundColor: "#111111",
    parent: mainWin || undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      ...(sourceSession ? { session: sourceSession } : {}),
    },
  });

  oauthWin.loadURL(url);

  // Close once we've reached the OAuth callback URL. Matching on path
  // fragment works for both Google (callback on localhost /api/google/*)
  // and Builder (callback on localhost /_agent-native/builder/callback).
  // The Builder callback HTML also calls window.close() itself; this
  // close-path is the Electron-side safety net if the page's script
  // hasn't fired yet (or doesn't, e.g. on future callback redesigns).
  let closeScheduled = false;

  function scheduleClose() {
    if (closeScheduled) return;
    closeScheduled = true;
    oauthWin.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        if (!oauthWin.isDestroyed()) oauthWin.close();
      }, 600);
    });
  }

  const onNavigate = (_event: Electron.Event, navUrl: string) => {
    try {
      const parsed = new URL(navUrl);
      rememberOAuthStateFromNavigation(provider, navUrl);
      // Detect the OAuth callback (works for both /api/google/callback and
      // /_agent-native/google/callback).
      if (parsed.pathname.includes(provider.callbackPathFragment)) {
        scheduleClose();
      }
      // Detect agentnative:// deep link — handle it and close the popup.
      if (parsed.protocol === `${DEEP_LINK_PROTOCOL}:`) {
        handleDeepLink(navUrl);
        scheduleClose();
      }
    } catch {
      // Malformed URL — ignore
    }
  };

  oauthWin.webContents.on("did-navigate", onNavigate);
  oauthWin.webContents.on("did-redirect-navigation", onNavigate);

  // Intercept deep link navigations that would fail to load — handle the
  // deep link and close the popup instead of showing a blank error page.
  oauthWin.webContents.on(
    "will-navigate",
    (event: Electron.Event, navUrl: string) => {
      if (navUrl.startsWith(`${DEEP_LINK_PROTOCOL}:`)) {
        event.preventDefault();
        handleDeepLink(navUrl);
        scheduleClose();
      }
    },
  );

  oauthWin.webContents.on("did-fail-load", () => {
    scheduleClose();
  });

  // Builder's callback writes credentials server-side, so reload after it
  // closes. Google success already reloads through the agentnative:// handoff;
  // Google failures are delivered to the app through desktop-exchange, so an
  // unconditional reload here would erase the in-app recovery panel.
  oauthWin.on("closed", () => {
    if (provider.name !== "google") {
      reloadAllWebviews();
    }
  });
}

const webviewOAuthNavigationHandlers = new WeakSet<Electron.WebContents>();

function openOAuthFromWebviewNavigation(
  url: string,
  sourceContents: Electron.WebContents,
): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }
    const provider = matchOAuthProvider(url, {
      sourceUrl: sourceContents.getURL(),
    });
    if (!provider) return false;
    openOAuthWindow(url, sourceContents.session, provider);
    return true;
  } catch {
    return false;
  }
}

function installWebviewOAuthNavigationHandler(contents: Electron.WebContents) {
  if (webviewOAuthNavigationHandlers.has(contents)) return;
  webviewOAuthNavigationHandlers.add(contents);

  contents.on("will-frame-navigate", (event) => {
    if (!openOAuthFromWebviewNavigation(event.url, contents)) return;
    event.preventDefault();
  });
}

// ---------- Webview popup handling ----------
// React 19 sets <webview allowpopups={true}> as a DOM property, not an HTML
// attribute. Electron only reads the attribute, so popups are silently
// blocked. The renderer now creates <webview> via document.createElement and
// sets the attribute imperatively, but setWindowOpenHandler must also be
// registered via did-attach-webview (the web-contents-created path alone
// doesn't reliably catch webviews created this way).

app.on("web-contents-created", (_event, contents) => {
  installContextMenu(contents);

  if (contents.getType() !== "webview") {
    contents.on("did-attach-webview" as any, (_e: any, wc: any) => {
      installContextMenu(wc);
      installWebviewOAuthNavigationHandler(wc);

      wc.setWindowOpenHandler(({ url }: any) => {
        try {
          const parsed = new URL(url);
          if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
            return { action: "deny" as const };
          }
          const provider = matchOAuthProvider(url, { sourceUrl: wc.getURL() });
          if (provider) {
            openOAuthWindow(url, wc.session, provider);
          } else {
            shell.openExternal(url).catch(() => {});
          }
        } catch {
          // malformed URL — ignore
        }
        return { action: "deny" as const };
      });
    });
    return;
  }

  installWebviewOAuthNavigationHandler(contents);

  contents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return { action: "deny" };
      }
      const provider = matchOAuthProvider(url, {
        sourceUrl: contents.getURL(),
      });
      if (provider) {
        openOAuthWindow(url, contents.session, provider);
      } else {
        shell.openExternal(url).catch(() => {});
      }
    } catch {
      // malformed URL — ignore
    }
    return { action: "deny" };
  });

  // Forward keyboard shortcuts from focused webview guests to the shell
  // renderer so they work even when a webview has keyboard focus.
  contents.on("before-input-event", (event, input) => {
    if (!(input.meta || input.control) || input.type !== "keyDown") return;

    const key = input.key.toLowerCase();

    // Cmd+Option+I (and legacy Cmd+Shift+I) — toggle devtools for the active app webview
    if (key === "i" && (input.alt || input.shift)) {
      event.preventDefault();
      toggleWebviewDevTools();
      return;
    }

    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;

    // Cmd+W — close tab (dedicated channel for backwards compat)
    if (key === "w") {
      event.preventDefault();
      win.webContents.send("shortcut:close-tab");
      return;
    }

    // Cmd+Option+Up/Down — previous/next app
    if (input.alt && (key === "arrowup" || key === "arrowdown")) {
      event.preventDefault();
      win.webContents.send("shortcut:keydown", {
        key: input.key,
        shiftKey: input.shift,
        altKey: true,
      });
      return;
    }

    // Forward other Cmd+ shortcuts: F, R, T, Shift+T, 1-9, [, ]
    const isShortcut =
      key === "f" ||
      key === "r" ||
      key === "t" ||
      key === "[" ||
      key === "]" ||
      (key >= "1" && key <= "9");

    if (isShortcut) {
      event.preventDefault();
      win.webContents.send("shortcut:keydown", {
        key: input.key,
        shiftKey: input.shift,
        altKey: false,
      });
    }
  });
});

// ---------- App lifecycle ----------

app.whenReady().then(() => {
  // Process any deep link that arrived before the app was ready
  if (pendingDeepLink) {
    handleDeepLink(pendingDeepLink);
    pendingDeepLink = null;
  }

  // Webviews now run in per-app persisted partitions (persist:app-<id>), so
  // webRequest handlers must be attached to each partitioned session, not
  // just session.defaultSession.
  const configuredSessions = new WeakSet<Electron.Session>();
  function configureWebviewSession(
    sess: Electron.Session,
    targetAppId: string | null,
  ) {
    if (configuredSessions.has(sess)) return;
    configuredSessions.add(sess);

    if (IS_DEV) {
      sess.webRequest.onHeadersReceived((details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            "Content-Security-Policy": [
              "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:",
            ],
          },
        });
      });
    }

    // Intercept OAuth callbacks on the frame port and redirect to the app's server.
    // Google redirects to localhost:3334/api/google/... but the frame doesn't
    // serve API routes — the actual app server runs on a different port.
    // Each partition is bound to a specific app, so route to that app's port
    // rather than falling back to a hardcoded mail/calendar preference.
    sess.webRequest.onBeforeRequest(
      { urls: [`http://localhost:${FRAME_PORT}/api/google/*`] },
      (details, callback) => {
        let apps: AppConfig[] = [];
        try {
          apps = AppStore.loadApps();
        } catch (err) {
          console.error("[main] OAuth redirect: loadApps failed:", err);
          callback({});
          return;
        }
        const app =
          (targetAppId && apps.find((a) => a.id === targetAppId)) ||
          apps.find((a) => a.id === "mail") ||
          apps.find((a) => a.id === "calendar");
        if (app) {
          const appUrl = details.url.replace(
            `http://localhost:${FRAME_PORT}`,
            `http://localhost:${app.devPort}`,
          );
          callback({ redirectURL: appUrl });
        } else {
          callback({});
        }
      },
    );
  }

  // Also configure session.defaultSession so the OAuth BrowserWindow (which
  // is not a webview and uses defaultSession) gets the redirect handler.
  // With no specific targetAppId, the handler falls back to mail/calendar.
  configureWebviewSession(session.defaultSession, null);

  // Pre-configure each known app's partition so handlers are ready before
  // the first request fires. Each partition knows its own app id.
  let initialApps: AppConfig[] = [];
  try {
    initialApps = AppStore.loadApps();
  } catch (err) {
    console.error("[main] failed to load apps for session setup:", err);
  }
  const sessionToAppId = new Map<Electron.Session, string>();
  for (const appConfig of initialApps) {
    const sess = session.fromPartition(`persist:app-${appConfig.id}`);
    sessionToAppId.set(sess, appConfig.id);
    configureWebviewSession(sess, appConfig.id);
  }

  // Catch any webview sessions we didn't pre-configure (e.g. custom apps
  // added at runtime) when their web contents are created. Derive the app
  // id from the webview URL's ?app= param when possible.
  app.on("web-contents-created", (_event, wc) => {
    if (wc.getType() !== "webview") return;
    let id = sessionToAppId.get(wc.session) ?? null;
    if (!id) {
      try {
        id = new URL(wc.getURL()).searchParams.get("app");
      } catch {}
    }
    configureWebviewSession(wc.session, id);
  });

  // Replace the default app menu so Cmd+Option+I doesn't open shell DevTools.
  // We handle this shortcut ourselves via before-input-event → toggleWebviewDevTools().
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            role: "appMenu" as const,
          },
        ]
      : []),
    { role: "fileMenu" as const },
    { role: "editMenu" as const },
    {
      label: "View",
      submenu: [
        { role: "reload" as const },
        { role: "forceReload" as const },
        {
          label: "Toggle Developer Tools",
          accelerator: "CmdOrCtrl+Option+I",
          click: () => toggleWebviewDevTools(),
        },
        { type: "separator" as const },
        {
          label: "Actual Size",
          accelerator: "CmdOrCtrl+0",
          click: () => resetActiveWebviewZoom(),
        },
        {
          label: "Zoom In",
          accelerator: "CmdOrCtrl+Plus",
          click: () => zoomActiveWebview(ZOOM_STEP),
        },
        {
          label: "Zoom Out",
          accelerator: "CmdOrCtrl+-",
          click: () => zoomActiveWebview(-ZOOM_STEP),
        },
        { type: "separator" as const },
        { role: "togglefullscreen" as const },
      ],
    },
    { role: "windowMenu" as const },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  const win = createWindow();

  // Intercept keyboard shortcuts on the shell renderer
  win.webContents.on("before-input-event", (_event, input) => {
    if (!(input.meta || input.control) || input.type !== "keyDown") return;
    const key = input.key.toLowerCase();

    // Cmd+Option+I (and legacy Cmd+Shift+I) — open devtools for the active webview, not the shell
    if (key === "i" && (input.alt || input.shift)) {
      _event.preventDefault();
      toggleWebviewDevTools();
      return;
    }

    // Cmd+R — refresh active webview, not the shell
    if (key === "r") {
      _event.preventDefault();
      win.webContents.send("shortcut:keydown", {
        key: "r",
        shiftKey: input.shift,
      });
      return;
    }

    // Cmd+F — search inside the active webview, not the shell
    if (key === "f") {
      _event.preventDefault();
      win.webContents.send("shortcut:keydown", {
        key: "f",
        shiftKey: input.shift,
      });
      return;
    }

    // Cmd+W — close tab instead of window
    if (key === "w") {
      _event.preventDefault();
      win.webContents.send("shortcut:close-tab");
    }
  });

  // Broadcast window maximized state changes to the renderer
  const broadcastMaximized = (isMaximized: boolean) =>
    win.webContents.send(IPC.WINDOW_MAXIMIZED_CHANGED, isMaximized);

  win.on("maximize", () => broadcastMaximized(true));
  win.on("unmaximize", () => broadcastMaximized(false));
  win.on("enter-full-screen", () => broadcastMaximized(true));
  win.on("leave-full-screen", () => broadcastMaximized(false));

  // macOS: restore/focus the window when dock icon is clicked
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
