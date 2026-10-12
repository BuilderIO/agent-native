import { convertFileSrc, invoke as tauriInvoke } from "@tauri-apps/api/core";

import type { ScreenHistoryWindow } from "../../../shared/screen-history-context";

// Both commands are local. The preview is cut from this device's Rewind footage
// and is never uploaded; only the window the person saves uploads.
export type RewindInvoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

export interface RewindPreview {
  path: string;
  src: string;
}

export async function loadRewindPreview(
  window: ScreenHistoryWindow,
  invoke: RewindInvoke = tauriInvoke,
): Promise<RewindPreview> {
  const result = (await invoke("rewind_preview_window", {
    startedAt: window.startedAt,
    endedAt: window.endedAt,
  })) as { path?: unknown } | null;
  // A response without a path is a failed preview, not an empty cut.
  if (typeof result?.path !== "string" || result.path === "") {
    throw new Error("rewind_preview_window returned no preview path");
  }
  return { path: result.path, src: convertFileSrc(result.path) };
}

export function discardRewindPreview(
  path: string,
  invoke: RewindInvoke = tauriInvoke,
): Promise<unknown> {
  return invoke("rewind_preview_discard", { path });
}
