import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import { buildRecordingShareUrl } from "../../../shared/recording-link";
import { normalizeServerUrl } from "./url";

/**
 * Absolute, paste-ready `/share/<id>` URL. Never `/r/<id>` — that is the owner
 * dashboard and renders a sign-in prompt for anyone the link is sent to.
 */
export function recordingShareUrl(
  recordingId: string,
  serverUrl: string,
): string {
  return buildRecordingShareUrl({
    recordingId,
    origin: normalizeServerUrl(serverUrl),
  });
}

async function writeClipboardText(text: string): Promise<boolean> {
  // Rust-side write first: at recording-stop time the popover webview is
  // usually not focused, and `navigator.clipboard.writeText` rejects with
  // `NotAllowedError: Document is not focused` in exactly that case.
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

/**
 * Copy a recording's public share URL. Resolves to whether the clipboard
 * actually took the text so callers never claim a copy that did not happen.
 */
export async function copyRecordingShareLink(
  recordingId: string,
  serverUrl: string,
): Promise<boolean> {
  if (!recordingId.trim() || !normalizeServerUrl(serverUrl)) return false;
  return writeClipboardText(recordingShareUrl(recordingId, serverUrl));
}
