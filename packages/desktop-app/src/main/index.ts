import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import path from "path";
import { IPC, type InterAppMessage } from "@shared/ipc-channels";

const IS_DEV = !app.isPackaged;

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
    // Open DevTools in a detached window during development
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  return win;
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

// ---------- IPC: Inter-app message relay ----------
// Routes messages from one app to all renderer windows so webviews can forward them.

ipcMain.on(IPC.INTER_APP_SEND, (event: IpcMainEvent, msg: InterAppMessage) => {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send(IPC.INTER_APP_MESSAGE, msg);
  });
});

// ---------- Webview popup handling ----------
// Open popups from webviews (e.g. OAuth flows) in the system browser
// instead of creating broken Electron popup windows.

app.on("web-contents-created", (_event, contents) => {
  // Only intercept webview guest contents
  if (contents.getType() !== "webview") return;

  contents.setWindowOpenHandler(({ url }) => {
    // Open in system browser — OAuth polling in the app will detect completion
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Forward keyboard shortcuts from focused webview guests to the shell
  // renderer so they work even when a webview has keyboard focus.
  contents.on("before-input-event", (event, input) => {
    if (!(input.meta || input.control) || input.type !== "keyDown") return;

    const key = input.key.toLowerCase();
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;

    // Cmd+W — close tab (dedicated channel for backwards compat)
    if (key === "w") {
      event.preventDefault();
      win.webContents.send("shortcut:close-tab");
      return;
    }

    // Forward other Cmd+ shortcuts: T, Shift+T, 1-9, [, ]
    const isShortcut =
      key === "t" || key === "[" || key === "]" || (key >= "1" && key <= "9");

    if (isShortcut) {
      event.preventDefault();
      win.webContents.send("shortcut:keydown", {
        key: input.key,
        shiftKey: input.shift,
      });
    }
  });
});

// ---------- App lifecycle ----------

app.whenReady().then(() => {
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

  const win = createWindow();

  // Intercept Cmd+W so it closes a tab instead of the window
  win.webContents.on("before-input-event", (_event, input) => {
    if (
      (input.meta || input.control) &&
      input.key.toLowerCase() === "w" &&
      input.type === "keyDown"
    ) {
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
