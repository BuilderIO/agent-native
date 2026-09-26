import { invoke } from "@tauri-apps/api/core";
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
    if (!staged) setStatus({ state: "not-available" });
    return;
  }
  if (staged && update.version === staged) return;
  const version = update.version;
  const notes = update.body ?? undefined;
  setStatus({ state: "available", version, notes });

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

  const stagedStatus =
    cachedStatus.state === "downloaded" ? cachedStatus : null;
  const staged = stagedStatus?.version ?? null;

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
      setStatus(stagedStatus ?? { state: "error", message });
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
  if (pendingUpdate) {
    await pendingUpdate.install();
  }
  try {
    await invoke("restart_after_update");
    return;
  } catch (err) {
    console.error("[clips-updater] native restart failed:", err);
  }
  await relaunch();
}

export function isUpdatePendingRestart(): boolean {
  return cachedStatus.state === "downloaded";
}

export function canCheckForUpdates(): boolean {
  return canRunUpdateChecks();
}

export function retryUpdateCheck(): Promise<void> {
  if (!canRunUpdateChecks()) return Promise.resolve();
  return runCheck();
}
