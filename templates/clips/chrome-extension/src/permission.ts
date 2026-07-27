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
const params = new URLSearchParams(location.search);
const startAfterGrant = params.get("startAfterGrant") === "1";
const shouldRequestCamera = params.get("needsCamera") !== "false";
const shouldRequestMicrophone = params.get("needsMicrophone") !== "false";

if (!shouldRequestMicrophone) rowMic.hidden = true;
if (!shouldRequestCamera) rowCam.hidden = true;

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
  successCopy.textContent = startAfterGrant
    ? "Opening Chrome's screen picker now."
    : "You can close this tab and start recording from the Clips icon.";
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

function requiredPermissionsReady(camOk: boolean, micOk: boolean): boolean {
  return (!shouldRequestCamera || camOk) && (!shouldRequestMicrophone || micOk);
}

function writePermissionCache(camOk: boolean, micOk: boolean): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get("clipsMediaPermission", (value) => {
      const current =
        value.clipsMediaPermission &&
        typeof value.clipsMediaPermission === "object"
          ? (value.clipsMediaPermission as {
              camera?: boolean;
              microphone?: boolean;
            })
          : {};
      const next = {
        ...current,
        ...(shouldRequestCamera ? { camera: camOk } : {}),
        ...(shouldRequestMicrophone ? { microphone: micOk } : {}),
      };
      chrome.storage.local.set({ clipsMediaPermission: next }, () => resolve());
    });
  });
}

async function startPendingRecording(): Promise<void> {
  const response = (await chrome.runtime.sendMessage({
    type: "CLIPS_PERMISSION_START_AFTER_GRANT",
  })) as { ok?: boolean; error?: string } | undefined;
  if (response?.ok) {
    window.close();
    return;
  }
  showEnableButton("Try again", false);
  setStatus(
    response?.error || "Start the recording again from the Clips icon.",
    true,
  );
}

async function finish(camOk: boolean, micOk: boolean): Promise<void> {
  await writePermissionCache(camOk, micOk);
  markRow("mic", micOk);
  markRow("cam", camOk);
  if (requiredPermissionsReady(camOk, micOk)) {
    showSuccess(startAfterGrant ? "Starting recording..." : "You're all done");
    if (startAfterGrant) await startPendingRecording();
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
  const micOk = shouldRequestMicrophone ? await requestOne("mic") : true;
  const camOk = shouldRequestCamera ? await requestOne("cam") : true;
  await finish(camOk, micOk);
}

enableBtn.addEventListener("click", () => void enable());

// If both are already granted (returning here later), reflect that immediately.
void (async () => {
  const [cam, mic] = await Promise.all([
    permissionState("camera"),
    permissionState("microphone"),
  ]);
  const micOk = !shouldRequestMicrophone || mic === "granted";
  const camOk = !shouldRequestCamera || cam === "granted";
  markRow("mic", micOk);
  markRow("cam", camOk);
  if (requiredPermissionsReady(camOk, micOk)) {
    await finish(camOk, micOk);
  }
})();
