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
let lastCheckStartedAt = 0;

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const UPDATE_FOCUS_CHECK_MIN_INTERVAL_MS = 15 * 60 * 1000;
const UPDATE_RETRY_DELAYS_MS = [1000, 3000];

function waitForRetry(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

function canRunUpdateChecks() {
  // Dev and local release builds are for testing the current checkout. Do not
  // replace them with the published auto-update channel.
  return !import.meta.env.DEV && !__CLIPS_DESKTOP_LOCAL_BUILD__;
}

function setStatus(next: UpdateStatus) {
  cachedStatus = next;
  for (const l of listeners) l(next);
}

async function runCheckAttempt(staged: string | null) {
  if (!staged) setStatus({ state: "checking" });
  const update = await check();
  if (!update) {
    // The endpoint answering "current" while a newer bundle sits staged is a
    // contradiction, not a reason to drop the download. Keep it staged.
    if (!staged) setStatus({ state: "not-available" });
    return;
  }
  if (staged && update.version === staged) return;
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
        total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
      setStatus({ state: "downloading", version, notes, percent });
    }
  });
  pendingUpdate = update;
  setStatus({ state: "downloaded", version, notes });
}

async function runCheck() {
  if (checkInFlight) return checkInFlight;

  // A staged update keeps checking on the normal cadence. Stopping here is what
  // made "Restart to update" land on a binary that was already out of date and
  // immediately ask to restart again — every check runs against the *running*
  // version, so it re-offers the staged version until a newer one ships.
  const staged =
    cachedStatus.state === "downloaded" ? cachedStatus.version : null;

  lastCheckStartedAt = Date.now();
  checkInFlight = (async () => {
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          await runCheckAttempt(staged);
          return;
        } catch (err) {
          const delay = UPDATE_RETRY_DELAYS_MS[attempt];
          if (delay === undefined) throw err;
          await waitForRetry(delay);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ state: "error", message });
    } finally {
      checkInFlight = null;
    }
  })();

  return checkInFlight;
}

function maybeCheckForUpdate() {
  if (!canRunUpdateChecks()) return;
  if (
    checkInFlight ||
    Date.now() - lastCheckStartedAt < UPDATE_FOCUS_CHECK_MIN_INTERVAL_MS
  ) {
    return;
  }
  void runCheck();
}

function startUpdateLoop() {
  if (started) return;
  started = true;
  if (!canRunUpdateChecks()) return;
  // Check 3s after launch (let the popover finish first paint), hourly while
  // Clips stays open, and when the user returns after at least 15 minutes.
  setTimeout(() => void runCheck(), 3000);
  setInterval(() => void runCheck(), UPDATE_CHECK_INTERVAL_MS);
  window.addEventListener("focus", maybeCheckForUpdate);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") maybeCheckForUpdate();
  });
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
