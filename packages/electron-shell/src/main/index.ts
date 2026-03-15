import {
  app,
  BrowserWindow,
  ipcMain,
  session,
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

    // macOS: use hidden inset title bar so native traffic lights appear over content
    // Windows/Linux: fully frameless, custom controls in renderer
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    ...(isMac && { trafficLightPosition: { x: 16, y: 18 } }),
    frame: !isMac ? false : undefined,

    backgroundColor: "#161623",
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

ipcMain.on(
  IPC.INTER_APP_SEND,
  (event: IpcMainEvent, msg: InterAppMessage) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send(IPC.INTER_APP_MESSAGE, msg);
    });
  },
);

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
