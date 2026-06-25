// Camera/microphone permission onboarding. Opened in a tab when the user hits
// Record without having granted access yet. Requesting getUserMedia from a real
// extension page (not the headless offscreen document, not a focus-stealing
// popup) is what makes Chrome show the standard permission dialog and persist
// the grant for the whole chrome-extension:// origin — so the offscreen recorder
// (mic) and the camera-bubble iframe both work afterward.

import { captureExtensionError, initExtensionSentry } from "./sentry";

initExtensionSentry("permission");

const enableBtn = document.getElementById("enable") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const successEl = document.getElementById("success-state") as HTMLDivElement;
const successTitle = document.getElementById("success-title") as HTMLDivElement;
const successCopy = document.getElementById(
  "success-copy",
) as HTMLParagraphElement;
const rowMic = document.getElementById("row-mic") as HTMLDivElement;
const rowCam = document.getElementById("row-cam") as HTMLDivElement;
const checkMic = document.getElementById("check-mic") as HTMLSpanElement;
const checkCam = document.getElementById("check-cam") as HTMLSpanElement;

const CHECK = "✓";
const DOT = "●";

function setStatus(text: string, isError = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function showEnableButton(text: string, disabled: boolean): void {
  enableBtn.hidden = false;
  enableBtn.textContent = text;
  enableBtn.disabled = disabled;
  successEl.hidden = true;
}

function showSuccess(title: string): void {
  enableBtn.hidden = true;
  enableBtn.disabled = true;
  successTitle.textContent = title;
  successCopy.textContent =
    "You can close this tab and start recording from the Clips icon.";
  successEl.hidden = false;
  setStatus(
    "Chrome still asks you what to share before each recording starts.",
  );
}

function markRow(kind: "mic" | "cam", granted: boolean): void {
  const row = kind === "mic" ? rowMic : rowCam;
  const check = kind === "mic" ? checkMic : checkCam;
  row.classList.toggle("granted", granted);
  check.textContent = granted ? CHECK : DOT;
}

async function permissionState(
  name: "camera" | "microphone",
): Promise<PermissionState | "unknown"> {
  try {
    const status = await navigator.permissions.query({
      name: name as PermissionName,
    });
    return status.state;
  } catch {
    return "unknown";
  }
}

async function requestOne(kind: "mic" | "cam"): Promise<boolean> {
  try {
    const constraints: MediaStreamConstraints =
      kind === "mic" ? { audio: true } : { video: true };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    for (const track of stream.getTracks()) track.stop();
    return true;
  } catch (err) {
    captureExtensionError(err, {
      tags: { surface: "permission", permission: kind },
    });
    return false;
  }
}

function finish(camOk: boolean, micOk: boolean): void {
  void chrome.storage.local.set({
    clipsMediaPermission: { camera: camOk, microphone: micOk },
  });
  markRow("mic", micOk);
  markRow("cam", camOk);
  if (camOk || micOk) {
    showSuccess(camOk && micOk ? "You're all done" : "Saved");
  } else {
    showEnableButton("Try again", false);
    setStatus(
      "Access was blocked. Click the camera icon in Chrome's address bar to allow it, then try again.",
      true,
    );
  }
}

async function enable(): Promise<void> {
  showEnableButton(enableBtn.textContent ?? "Enable camera & microphone", true);
  setStatus("Waiting for Chrome's permission prompt…");
  // Request separately so a camera denial doesn't also block the microphone.
  const micOk = await requestOne("mic");
  const camOk = await requestOne("cam");
  finish(camOk, micOk);
}

enableBtn.addEventListener("click", () => void enable());

// If both are already granted (returning here later), reflect that immediately.
void (async () => {
  const [cam, mic] = await Promise.all([
    permissionState("camera"),
    permissionState("microphone"),
  ]);
  markRow("mic", mic === "granted");
  markRow("cam", cam === "granted");
  if (cam === "granted" && mic === "granted") {
    showSuccess("You're all done");
  }
})();
