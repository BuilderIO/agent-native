import {
  app,
  BrowserWindow,
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
} from "@shared/ipc-channels";
import { HARNESS_PORT } from "@shared/app-registry";
import type { AppConfig } from "@shared/app-registry";
import * as AppStore from "./app-store";

const IS_DEV = !app.isPackaged;

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

async function handleDeepLink(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.host === "oauth-complete") {
      const token = parsed.searchParams.get("token");
      if (token) {
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
  const allContents = webContents.getAllWebContents();
  const origins = new Set<string>();
  for (const wc of allContents) {
    if (wc.getType() === "webview") {
      try {
        origins.add(new URL(wc.getURL()).origin);
      } catch {}
    }
  }
  for (const origin of origins) {
    await session.defaultSession.cookies.set({
      url: origin,
      name: "an_session",
      value: token,
      httpOnly: true,
      path: "/",
      expirationDate: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    });
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

// ---------- Auto-updates (production only) ----------

if (!IS_DEV) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  app.whenReady().then(() => {
    autoUpdater.checkForUpdatesAndNotify();
    // Re-check every 4 hours
    setInterval(
      () => autoUpdater.checkForUpdatesAndNotify(),
      4 * 60 * 60 * 1000,
    );
  });
}

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
      // Allow webviews to load localhost apps without CORS errors
      webSecurity: false,
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

function toggleWebviewDevTools() {
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
  const target =
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
    webviewContents[0];

  if (target) {
    if (target.isDevToolsOpened()) {
      target.closeDevTools();
    } else {
      target.openDevTools({ mode: "detach" });
    }
  }
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

const OAUTH_HOSTS = ["accounts.google.com"];

function openOAuthWindow(url: string) {
  const mainWin = BrowserWindow.getAllWindows()[0];

  const oauthWin = new BrowserWindow({
    width: 500,
    height: 700,
    title: "Sign in",
    backgroundColor: "#111111",
    parent: mainWin || undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  oauthWin.loadURL(url);

  // Once navigation leaves Google's domain, the OAuth callback has been
  // reached and the server has set cookies. Wait for the page to finish
  // loading then auto-close the window.
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

  const isGoogleDomain = (hostname: string) =>
    hostname.endsWith("google.com") ||
    hostname.endsWith("googleapis.com") ||
    hostname.endsWith("gstatic.com");

  const onNavigate = (_event: Electron.Event, navUrl: string) => {
    try {
      const parsed = new URL(navUrl);
      if (!isGoogleDomain(parsed.hostname)) {
        scheduleClose();
      }
    } catch {
      // Malformed URL — ignore
    }
  };

  oauthWin.webContents.on("did-navigate", onNavigate);
  oauthWin.webContents.on("did-redirect-navigation", onNavigate);

  // Fallback: also detect did-fail-load (e.g. deep link navigation)
  oauthWin.webContents.on("did-fail-load", () => {
    setTimeout(() => {
      if (!oauthWin.isDestroyed()) oauthWin.close();
    }, 300);
  });

  // Reload webviews when the OAuth window closes (whether auto or manual)
  oauthWin.on("closed", () => {
    reloadAllWebviews();
  });
}

// ---------- Webview popup handling ----------

app.on("web-contents-created", (_event, contents) => {
  // Only intercept webview guest contents
  if (contents.getType() !== "webview") return;

  contents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return { action: "deny" };
      }
      if (OAUTH_HOSTS.includes(parsed.hostname)) {
        openOAuthWindow(url);
      } else {
        shell.openExternal(url);
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

  // Allow webviews to load any localhost URL during development
  if (IS_DEV) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
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

  // Intercept OAuth callbacks on the harness port and redirect to the app's server.
  // Google redirects to localhost:3334/api/google/... but the harness doesn't
  // serve API routes — the actual app server runs on a different port.
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: [`http://localhost:${HARNESS_PORT}/api/google/*`] },
    (details, callback) => {
      // Route to the correct app's server based on the callback path
      const apps = AppStore.loadApps();
      // Try mail first, then calendar — both have Google OAuth
      const app =
        apps.find((a) => a.id === "mail") ||
        apps.find((a) => a.id === "calendar");
      if (app) {
        const appUrl = details.url.replace(
          `http://localhost:${HARNESS_PORT}`,
          `http://localhost:${app.devPort}`,
        );
        callback({ redirectURL: appUrl });
      } else {
        callback({});
      }
    },
  );

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
        { role: "resetZoom" as const },
        { role: "zoomIn" as const },
        { role: "zoomOut" as const },
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

  // Re-create window on macOS when dock icon is clicked with no windows open
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
