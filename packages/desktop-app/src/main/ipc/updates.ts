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

import { IPC, type UpdateStatus } from "@shared/ipc-channels";
import { app, BrowserWindow, ipcMain, Notification } from "electron";
import { autoUpdater } from "electron-updater";

const IS_DEV = !app.isPackaged;

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const UPDATE_FOCUS_CHECK_MIN_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_DESKTOP_UPDATE_FEED_URL =
  "https://agent-native.com/api/desktop-updates";
const DESKTOP_UPDATE_FEED_URL = (
  process.env.AGENT_NATIVE_DESKTOP_UPDATE_FEED_URL ||
  DEFAULT_DESKTOP_UPDATE_FEED_URL
).replace(/\/+$/, "");

let currentUpdateStatus: UpdateStatus = IS_DEV
  ? { state: "unsupported", reason: "Auto-update is disabled in development" }
  : { state: "idle" };
let updateCheckInFlight: Promise<unknown> | null = null;
let lastUpdateCheckStartedAt = 0;
let notifiedUpdateVersion: string | null = null;

export interface UpdatesIpcDeps {
  refreshApplicationMenu: () => void;
  focusMainWindow: () => void;
}

// Populated by `registerUpdatesIpc` during startup, before any of the
// functions below can be invoked (autoUpdater events fire only after
// registration, and the app menu isn't clickable until the app is ready).
let deps: UpdatesIpcDeps | null = null;

function getDeps(): UpdatesIpcDeps {
  if (!deps) {
    throw new Error("registerUpdatesIpc() must run before update checks.");
  }
  return deps;
}

/** Current cached update status, for callers outside the IPC surface (e.g. the app menu). */
export function getCurrentUpdateStatus(): UpdateStatus {
  return currentUpdateStatus;
}

function broadcastUpdateStatus(status: UpdateStatus) {
  currentUpdateStatus = status;
  getDeps().refreshApplicationMenu();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.UPDATE_STATUS_CHANGED, status);
    }
  }
}

/** Triggers (or awaits an in-flight) update check. Exported for the app menu's "Check for Updates" item. */
export async function checkForAppUpdates(): Promise<UpdateStatus> {
  if (IS_DEV) return currentUpdateStatus;
  if (currentUpdateStatus.state === "downloaded") return currentUpdateStatus;

  if (!updateCheckInFlight) {
    lastUpdateCheckStartedAt = Date.now();
    updateCheckInFlight = autoUpdater
      .checkForUpdates()
      .catch((err) => {
        broadcastUpdateStatus({
          state: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        updateCheckInFlight = null;
      });
  }

  await updateCheckInFlight;
  return currentUpdateStatus;
}

function maybeCheckForAppUpdates() {
  if (IS_DEV) return;
  if (currentUpdateStatus.state === "downloaded") return;
  if (
    updateCheckInFlight ||
    Date.now() - lastUpdateCheckStartedAt < UPDATE_FOCUS_CHECK_MIN_INTERVAL_MS
  ) {
    return;
  }
  void checkForAppUpdates();
}

function showUpdateReadyNotification(version: string) {
  if (!Notification.isSupported()) return;
  if (notifiedUpdateVersion === version) return;
  notifiedUpdateVersion = version;

  const notification = new Notification({
    title: "Agent Native update ready",
    body: `Version ${version} is downloaded. Open Agent Native to relaunch and install it.`,
  });
  notification.on("click", (_event) => {
    getDeps().focusMainWindow();
  });
  notification.show();
}

/**
 * Registers the auto-update IPC handlers, wires up `autoUpdater` event
 * listeners (production only), and starts the periodic update-check timer.
 */
export function registerUpdatesIpc(ipcDeps: UpdatesIpcDeps): void {
  deps = ipcDeps;

  if (!IS_DEV) {
    // The GitHub provider reads the repository-wide latest release feed, which
    // also contains npm package releases and Clips desktop releases. Use the
    // Agent Native feed that filters the shared repo down to desktop assets.
    autoUpdater.setFeedURL({
      provider: "generic",
      url: DESKTOP_UPDATE_FEED_URL,
    });
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
      showUpdateReadyNotification(info.version);
    });

    autoUpdater.on("error", (err) => {
      broadcastUpdateStatus({
        state: "error",
        message: err?.message ?? String(err),
      });
    });

    app.whenReady().then(() => {
      void checkForAppUpdates();
      setInterval(() => void checkForAppUpdates(), UPDATE_CHECK_INTERVAL_MS);
    });

    app.on("browser-window-focus", maybeCheckForAppUpdates);
    app.on("activate", maybeCheckForAppUpdates);
  }

  ipcMain.handle(
    IPC.UPDATE_GET_STATUS,
    (): UpdateStatus => currentUpdateStatus,
  );

  ipcMain.handle(IPC.UPDATE_CHECK, async (): Promise<UpdateStatus> => {
    return checkForAppUpdates();
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
}
