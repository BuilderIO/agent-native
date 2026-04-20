import { useEffect, useState } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

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

function setStatus(next: UpdateStatus) {
  cachedStatus = next;
  for (const l of listeners) l(next);
}

async function runCheck() {
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

    let total = 0;
    let downloaded = 0;
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? 0;
        downloaded = 0;
        setStatus({ state: "downloading", version, notes, percent: 0 });
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        const percent =
          total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
        setStatus({ state: "downloading", version, notes, percent });
      } else if (event.event === "Finished") {
        setStatus({ state: "downloaded", version, notes });
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus({ state: "error", message });
  }
}

function startUpdateLoop() {
  if (started) return;
  started = true;
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
  // downloadAndInstall already applied the bundle; relaunch completes it.
  await relaunch();
}

/**
 * Manual retry entry point. Used by the UpdateBanner's error state to let
 * users re-attempt after a signature-verification / download / network
 * failure. Runs a full check + download pass, same as the periodic loop.
 */
export function retryUpdateCheck(): Promise<void> {
  return runCheck();
}
