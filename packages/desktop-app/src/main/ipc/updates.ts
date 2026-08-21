// ---------- Auto-updates ----------
//
// In production, electron-updater pulls release metadata from the
// `publish:` target in electron-builder.yml (currently the BuilderIO/agent-native
// GitHub repo). We auto-download in the background, surface progress and
// readiness to the renderer over IPC, and let the user trigger
// quitAndInstall from a chat-first rail action / restart prompt. The app also
// installs queued updates automatically on quit.
//
// Un-packaged development builds and locally packaged builds cannot install a
// production release. Only explicitly marked release builds use the updater.

import { IPC, type UpdateStatus } from "@shared/ipc-channels";
import { DESKTOP_RELEASE_CHANNEL } from "@shared/release-channel";
import { app, BrowserWindow, ipcMain, Notification } from "electron";
import { autoUpdater } from "electron-updater";

import { resolveDesktopUpdateSupport } from "./update-policy.js";

declare const __AGENT_NATIVE_DESKTOP_BUILD_CHANNEL__: string | undefined;

const UPDATE_SUPPORT = resolveDesktopUpdateSupport(
  app.isPackaged,
  app.getVersion(),
  typeof __AGENT_NATIVE_DESKTOP_BUILD_CHANNEL__ === "string"
    ? __AGENT_NATIVE_DESKTOP_BUILD_CHANNEL__
    : "release",
);

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const UPDATE_FOCUS_CHECK_MIN_INTERVAL_MS = 15 * 60 * 1000;
// electron-updater's feed request has no built-in timeout; without this, a
// hung request would pin `updateCheckInFlight` forever and the periodic
// check's `checkRunning` guard would never release.
const UPDATE_CHECK_TIMEOUT_MS = 60_000;
const DEFAULT_DESKTOP_UPDATE_FEED_URL =
  "https://www.agent-native.com/api/desktop-updates";
const DESKTOP_UPDATE_FEED_URL = [
  (
    process.env.AGENT_NATIVE_DESKTOP_UPDATE_FEED_URL ||
    DEFAULT_DESKTOP_UPDATE_FEED_URL
  ).replace(/\/+$/, ""),
  ...(DESKTOP_RELEASE_CHANNEL === "nightly" ? ["nightly"] : []),
].join("/");

let currentUpdateStatus: UpdateStatus = !UPDATE_SUPPORT.supported
  ? { state: "unsupported", reason: UPDATE_SUPPORT.reason }
  : { state: "idle" };
let updateCheckInFlight: Promise<unknown> | null = null;
let lastUpdateCheckStartedAt = 0;
let notifiedUpdateVersion: string | null = null;
let updateInstallInFlight = false;
let updateQuitOwned = false;
let quitRequestedDuringUpdatePreparation = false;
let updateHelpersNeedRestore = false;
let updateHelpersRestorePromise: Promise<void> | null = null;
let installingUpdateForRetry: Extract<
  UpdateStatus,
  { state: "downloaded" }
> | null = null;
let pendingDownloadedUpdate: Extract<
  UpdateStatus,
  { state: "downloaded" }
> | null = null;

export interface UpdatesIpcDeps {
  refreshApplicationMenu: () => void;
  focusMainWindow: () => void;
  prepareForUpdate?: () => Promise<void>;
  restoreAfterUpdateFailure?: () => Promise<void>;
}

export interface UpdateCheckOptions {
  notifyOnResult?: boolean;
}

// Populated by `registerUpdatesIpc` during startup, before any of the
// functions below can be invoked (autoUpdater events fire only after
// registration, and the app menu isn't clickable until the app is ready).
let deps: UpdatesIpcDeps | null = null;

const UPDATE_CHECK_ERROR_MESSAGE =
  "Couldn't check for updates. Please try again.";
const UPDATE_DOWNLOAD_ERROR_MESSAGE =
  "Couldn't download the update. Please try again.";
const UPDATE_GENERIC_ERROR_MESSAGE =
  "Couldn't complete the software update. Please try again.";

function updateErrorMessage(error: unknown, message: string): string {
  const detail = error instanceof Error ? error.message : String(error);
  console.warn("[updates] update operation failed:", detail);
  return message;
}

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

/** Remembers a user quit that Electron deferred while helpers are closing. */
export function requestQuitAfterUpdatePreparation(): void {
  if (isPreparingDownloadedUpdate()) {
    quitRequestedDuringUpdatePreparation = true;
  }
}

function completeDeferredQuitIfRequested(): void {
  const shouldQuit = quitRequestedDuringUpdatePreparation;
  quitRequestedDuringUpdatePreparation = false;
  if (shouldQuit) {
    queueMicrotask(() => app.quit());
  }
}

async function restoreHelpersAfterFailedUpdate(): Promise<void> {
  if (!updateHelpersNeedRestore) return;
  updateHelpersNeedRestore = false;
  const restore = getDeps().restoreAfterUpdateFailure;
  if (!restore) return;
  if (!updateHelpersRestorePromise) {
    updateHelpersRestorePromise = restore()
      .catch((error) => {
        console.warn(
          "[updates] failed to restore desktop helpers after update handoff:",
          error instanceof Error ? error.message : error,
        );
      })
      .finally(() => {
        updateHelpersRestorePromise = null;
      });
  }
  await updateHelpersRestorePromise;
}

export async function installDownloadedUpdate(): Promise<void> {
  if (
    !UPDATE_SUPPORT.supported ||
    !hasUpdateReadyToInstall() ||
    updateInstallInFlight
  ) {
    return;
  }
  installingUpdateForRetry =
    pendingDownloadedUpdate ||
    (currentUpdateStatus.state === "downloaded" ? currentUpdateStatus : null);
  quitRequestedDuringUpdatePreparation = false;
  updateInstallInFlight = true;
  // Preparation can fail after one of the native helpers has already been
  // detached. Mark restoration before entering that multi-step operation so
  // both synchronous and asynchronous handoff failures recover the shell.
  updateHelpersNeedRestore = true;
  try {
    // Native helpers can outlive the Electron window. Close them before
    // Squirrel checks whether the old app is still running.
    await getDeps().prepareForUpdate?.();
    // The updater owns quit only after preparation has completed and the
    // installer handoff is about to happen. A normal user quit remains
    // guarded while preparation is in flight.
    updateQuitOwned = true;
    quitRequestedDuringUpdatePreparation = false;
    // isSilent=false so any installer UI shows; isForceRunAfter=true so the
    // app relaunches after the update completes.
    autoUpdater.quitAndInstall(false, true);
  } catch (err) {
    updateInstallInFlight = false;
    updateQuitOwned = false;
    await restoreHelpersAfterFailedUpdate();
    const retryUpdate = installingUpdateForRetry;
    installingUpdateForRetry = null;
    if (retryUpdate) {
      pendingDownloadedUpdate = retryUpdate;
      console.warn(
        "[updates] update installation failed; keeping the downloaded update ready for retry:",
        err,
      );
      broadcastUpdateStatus(retryUpdate);
    } else {
      broadcastUpdateStatus({
        state: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    completeDeferredQuitIfRequested();
  }
}

/** Whether the updater owns the next app quit lifecycle. */
export function isInstallingDownloadedUpdate(): boolean {
  return updateQuitOwned;
}

/** Whether the updater is still preparing helpers before taking over quit. */
export function isPreparingDownloadedUpdate(): boolean {
  return updateInstallInFlight && !updateQuitOwned;
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

function publishDownloadedUpdate() {
  if (!pendingDownloadedUpdate) return;
  const update = pendingDownloadedUpdate;
  pendingDownloadedUpdate = null;
  broadcastUpdateStatus(update);
  showUpdateReadyNotification(update.version);
}

function hasUpdateReadyToInstall(): boolean {
  return (
    pendingDownloadedUpdate !== null ||
    currentUpdateStatus.state === "downloaded"
  );
}

async function waitForDownloadedUpdate(
  downloadPromise: Promise<unknown> | null | undefined,
) {
  await downloadPromise;
  publishDownloadedUpdate();
}

function withUpdateCheckTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Update check timed out after ${UPDATE_CHECK_TIMEOUT_MS}ms`,
          ),
        ),
      UPDATE_CHECK_TIMEOUT_MS,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Triggers (or awaits an in-flight) update check. */
export async function checkForAppUpdates(
  options: UpdateCheckOptions = {},
): Promise<UpdateStatus> {
  if (!UPDATE_SUPPORT.supported) return currentUpdateStatus;
  if (hasUpdateReadyToInstall()) return currentUpdateStatus;

  if (!updateCheckInFlight) {
    lastUpdateCheckStartedAt = Date.now();
    updateCheckInFlight = withUpdateCheckTimeout(
      (async () => {
        const result = await autoUpdater.checkForUpdates();
        try {
          await waitForDownloadedUpdate(result?.downloadPromise);
        } catch (err) {
          pendingDownloadedUpdate = null;
          broadcastUpdateStatus({
            state: "error",
            message: updateErrorMessage(err, UPDATE_DOWNLOAD_ERROR_MESSAGE),
          });
        }
      })(),
    )
      .catch((err) => {
        pendingDownloadedUpdate = null;
        broadcastUpdateStatus({
          state: "error",
          message: updateErrorMessage(err, UPDATE_CHECK_ERROR_MESSAGE),
        });
      })
      .finally(() => {
        updateCheckInFlight = null;
      });
  }

  await updateCheckInFlight;
  if (options.notifyOnResult) {
    showUpdateCheckResultNotification(currentUpdateStatus);
  }
  return currentUpdateStatus;
}

function maybeCheckForAppUpdates() {
  if (!UPDATE_SUPPORT.supported) return;
  if (hasUpdateReadyToInstall()) return;
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
    title: `${app.getName()} update ready`,
    body: `Version ${version} is downloaded. Open ${app.getName()} to relaunch and install it.`,
  });
  notification.on("click", (_event) => {
    getDeps().focusMainWindow();
  });
  notification.show();
}

function showUpdateCheckResultNotification(status: UpdateStatus) {
  if (!Notification.isSupported()) return;

  const notification =
    status.state === "not-available"
      ? new Notification({
          title: "Agent Native is up to date",
          body: `You're running the latest version (${status.currentVersion}).`,
        })
      : status.state === "error"
        ? new Notification({
            title: "Could not check for Agent Native updates",
            body: status.message,
          })
        : null;

  if (!notification) return;
  notification.on("click", () => getDeps().focusMainWindow());
  notification.show();
}

/**
 * Registers the auto-update IPC handlers, wires up `autoUpdater` event
 * listeners (production only), and starts the periodic update-check timer.
 */
export function registerUpdatesIpc(ipcDeps: UpdatesIpcDeps): void {
  deps = ipcDeps;

  if (UPDATE_SUPPORT.supported) {
    // The public feed filters the shared repository's releases down to desktop
    // assets, so npm and Clips releases never enter this updater.
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
      // On macOS this event precedes native Squirrel staging; publish only
      // after the download promise resolves so the first relaunch can install.
      if (hasUpdateReadyToInstall()) return;
      pendingDownloadedUpdate = {
        state: "downloaded",
        version: info.version,
        releaseNotes:
          typeof info.releaseNotes === "string" ? info.releaseNotes : undefined,
      };
    });

    autoUpdater.on("error", async (err) => {
      const retryUpdate = updateInstallInFlight
        ? installingUpdateForRetry
        : null;
      updateInstallInFlight = false;
      updateQuitOwned = false;
      installingUpdateForRetry = null;
      await restoreHelpersAfterFailedUpdate();
      if (retryUpdate) {
        pendingDownloadedUpdate = retryUpdate;
        console.warn(
          "[updates] update installation failed; keeping the downloaded update ready for retry:",
          err,
        );
        broadcastUpdateStatus(retryUpdate);
        completeDeferredQuitIfRequested();
        return;
      }
      pendingDownloadedUpdate = null;
      broadcastUpdateStatus({
        state: "error",
        message: updateErrorMessage(err, UPDATE_GENERIC_ERROR_MESSAGE),
      });
      completeDeferredQuitIfRequested();
    });
  }

  app.whenReady().then(() => {
    void checkForAppUpdates();
    let checkRunning = false;
    setInterval(() => {
      if (checkRunning) return;
      checkRunning = true;
      void checkForAppUpdates().finally(() => {
        checkRunning = false;
      });
    }, UPDATE_CHECK_INTERVAL_MS);
  });

  app.on("browser-window-focus", maybeCheckForAppUpdates);
  app.on("activate", maybeCheckForAppUpdates);

  ipcMain.handle(
    IPC.UPDATE_GET_STATUS,
    (): UpdateStatus => currentUpdateStatus,
  );

  ipcMain.handle(IPC.UPDATE_CHECK, async (): Promise<UpdateStatus> => {
    return checkForAppUpdates({ notifyOnResult: true });
  });

  ipcMain.handle(IPC.UPDATE_DOWNLOAD, async (): Promise<UpdateStatus> => {
    if (!UPDATE_SUPPORT.supported || hasUpdateReadyToInstall()) {
      return currentUpdateStatus;
    }
    try {
      await waitForDownloadedUpdate(autoUpdater.downloadUpdate());
    } catch (err) {
      pendingDownloadedUpdate = null;
      broadcastUpdateStatus({
        state: "error",
        message: updateErrorMessage(err, UPDATE_DOWNLOAD_ERROR_MESSAGE),
      });
    }
    return currentUpdateStatus;
  });

  ipcMain.handle(IPC.UPDATE_INSTALL, () => installDownloadedUpdate());
}
