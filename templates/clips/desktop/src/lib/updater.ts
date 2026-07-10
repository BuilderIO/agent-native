import { relaunch } from "@tauri-apps/plugin-process";
import { check, Update } from "@tauri-apps/plugin-updater";
import { useEffect, useState } from "react";

declare const __CLIPS_DESKTOP_LOCAL_BUILD__: boolean;

export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "not-available" }
  | { state: "available"; version: string; notes?: string }
  | {
      state: "downloading";
      version: string;
      notes?: string;
      percent: number;
    }
  | { state: "downloaded"; version: string; notes?: string }
  | { state: "error"; message: string };

interface StatusListener {
  (status: UpdateStatus): void;
}

let cachedStatus: UpdateStatus = { state: "idle" };
let pendingUpdate: Update | null = null;
const listeners = new Set<StatusListener>();
let started = false;
let checkInFlight: Promise<void> | null = null;

function canRunUpdateChecks() {
  // Dev and local release builds are for testing the current checkout. Do not
  // replace them with the published auto-update channel.
  return !import.meta.env.DEV && !__CLIPS_DESKTOP_LOCAL_BUILD__;
}

function setStatus(next: UpdateStatus) {
  cachedStatus = next;
  for (const l of listeners) l(next);
}

async function runCheck() {
  if (checkInFlight) return checkInFlight;

  checkInFlight = (async () => {
    try {
      setStatus({ state: "checking" });
      const update = await check();
      if (!update) {
        setStatus({ state: "not-available" });
        return;
      }
      pendingUpdate = update;
      const version = update.version;
      const notes = update.body ?? undefined;
      setStatus({ state: "available", version, notes });

      // Download ONLY — do not install here. On macOS `install` swaps the .app
      // bundle on disk while this process keeps running, which invalidates the
      // running process's Screen Recording (TCC) grant and breaks capture until
      // relaunch. We defer the swap to `installAndRestart()` so a downloaded-but-
      // not-yet-installed update leaves the running app fully functional; the
      // user records normally until they choose to restart.
      let total = 0;
      let downloaded = 0;
      await update.download((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          downloaded = 0;
          setStatus({ state: "downloading", version, notes, percent: 0 });
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          const percent =
            total > 0
              ? Math.min(100, Math.round((downloaded / total) * 100))
              : 0;
          setStatus({ state: "downloading", version, notes, percent });
        } else if (event.event === "Finished") {
          setStatus({ state: "downloaded", version, notes });
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ state: "error", message });
    } finally {
      checkInFlight = null;
    }
  })();

  return checkInFlight;
}

function startUpdateLoop() {
  if (started) return;
  started = true;
  if (!canRunUpdateChecks()) return;
  // Check 3s after launch (let the popover finish first paint), then every
  // 4 hours. Matches the cadence used by the Electron app.
  setTimeout(runCheck, 3000);
  setInterval(runCheck, 4 * 60 * 60 * 1000);
}

export function useUpdateStatus(): UpdateStatus {
  const [status, setLocal] = useState<UpdateStatus>(cachedStatus);

  useEffect(() => {
    startUpdateLoop();
    listeners.add(setLocal);
    setLocal(cachedStatus);
    return () => {
      listeners.delete(setLocal);
    };
  }, []);

  return status;
}

export async function installAndRestart(): Promise<void> {
  // Perform the deferred bundle swap now, then relaunch onto the new binary.
  // Installing immediately before relaunch keeps the window where the on-disk
  // bundle no longer matches the running process as short as possible — the
  // process is torn down by `relaunch()` right after, so capture never runs
  // against a swapped-out bundle.
  if (pendingUpdate) {
    await pendingUpdate.install();
  }
  await relaunch();
}

/**
 * True once an update has been downloaded and is waiting for the user to
 * restart. The recording flow uses this to explain a post-download capture
 * failure as "restart to finish updating" instead of a misleading "grant
 * permissions" message — see `app.tsx` recError routing.
 */
export function isUpdatePendingRestart(): boolean {
  return cachedStatus.state === "downloaded";
}

export function canCheckForUpdates(): boolean {
  return canRunUpdateChecks();
}

/**
 * Manual retry entry point. Used by the UpdateBanner's error state to let
 * users re-attempt after a signature-verification / download / network
 * failure. Runs a full check + download pass, same as the periodic loop.
 */
export function retryUpdateCheck(): Promise<void> {
  if (!canRunUpdateChecks()) return Promise.resolve();
  return runCheck();
}
