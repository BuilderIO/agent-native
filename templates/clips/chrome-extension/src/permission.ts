// Camera/microphone permission onboarding. Opened in a tab when the user hits
// Record without having granted access yet. Requesting getUserMedia from a real
// extension page (not the headless offscreen document, not a focus-stealing
// popup) is what makes Chrome show the standard permission dialog and persist
// the grant for the whole chrome-extension:// origin — so the offscreen recorder
// (mic) and the camera-bubble iframe both work afterward.

const enableBtn = document.getElementById("enable") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
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
  } catch {
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
    enableBtn.textContent = "All set — you can close this tab";
    enableBtn.disabled = true;
    setStatus(
      camOk && micOk
        ? "Camera and microphone are ready. Click the Clips icon to record."
        : "Saved. Click the Clips icon to record.",
    );
  } else {
    enableBtn.disabled = false;
    enableBtn.textContent = "Try again";
    setStatus(
      "Access was blocked. Click the camera icon in Chrome's address bar to allow it, then try again.",
      true,
    );
  }
}

async function enable(): Promise<void> {
  enableBtn.disabled = true;
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
    enableBtn.textContent = "Already enabled — you can close this tab";
    enableBtn.disabled = true;
    setStatus(
      "Camera and microphone are ready. Click the Clips icon to record.",
    );
  }
})();
