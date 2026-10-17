import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import { buildRecordingShareUrl } from "../../../shared/recording-link";
import { normalizeServerUrl } from "./url";

export function recordingShareUrl(
  recordingId: string,
  serverUrl: string,
): string {
  return buildRecordingShareUrl({
    recordingId,
    origin: normalizeServerUrl(serverUrl),
  });
}

export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    await writeText(text);
    return true;
  } catch (err) {
    console.warn("[clips-tray] native clipboard write failed:", err);
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.warn("[clips-tray] navigator clipboard write failed:", err);
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch (err) {
    console.warn("[clips-tray] execCommand clipboard write failed:", err);
    return false;
  }
}

export async function copyRecordingShareLink(
  recordingId: string,
  serverUrl: string,
): Promise<boolean> {
  if (!recordingId.trim() || !normalizeServerUrl(serverUrl)) return false;
  return writeClipboardText(recordingShareUrl(recordingId, serverUrl));
}
