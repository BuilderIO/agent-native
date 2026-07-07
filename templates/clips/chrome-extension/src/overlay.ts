import "./overlay.css";
import { captureExtensionError, initExtensionSentry } from "./sentry";

initExtensionSentry("overlay");

// The overlay runs as an extension-origin iframe injected into the page by the
// content script. Each iframe renders one "part" of the Loom-style recording UI
// (camera bubble, countdown, or control toolbar) selected via ?part=. Running at
// the chrome-extension:// origin gives us a persistent camera permission grant,
// CSS isolation from the host page, and direct chrome.runtime messaging with the
// background service worker.

type OverlayPhase = "idle" | "countdown" | "recording" | "paused" | "saving";

// Hover-expand heights for the vertical toolbar, posted to the content script
// which owns the iframe size (the iframe can't resize itself).
const TOOLBAR_COLLAPSED_H = 154;
const TOOLBAR_EXPANDED_H = 236;

function isDeviceUnavailableError(error: unknown): boolean {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name)
      : "";
  return (
    name === "OverconstrainedError" ||
    name === "NotFoundError" ||
    name === "DevicesNotFoundError"
  );
}

function cameraConstraint(deviceId: string): MediaTrackConstraints {
  const video: MediaTrackConstraints = {
    width: { ideal: 640 },
    height: { ideal: 640 },
  };
  if (deviceId) video.deviceId = { exact: deviceId };
  else video.facingMode = "user";
  return video;
}

async function getCameraBubbleStream(deviceId: string): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: cameraConstraint(deviceId),
      audio: false,
    });
  } catch (error) {
    if (!deviceId || !isDeviceUnavailableError(error)) throw error;
    captureExtensionError(
      new Error("Selected Clips camera was unavailable; using default camera."),
      {
        tags: { surface: "overlay", mechanism: "camera-device-fallback" },
        extra: {
          requestedDeviceId: deviceId,
          originalError:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : String(error),
        },
      },
    );
    return navigator.mediaDevices.getUserMedia({
      video: cameraConstraint(""),
      audio: false,
    });
  }
}

function postToolbarSize(height: number): void {
  try {
    window.parent.postMessage(
      { source: "clips-overlay", kind: "resize", part: "toolbar", height },
      "*",
    );
  } catch {
    /* parent gone */
  }
}

function postCountdownFinished(): void {
  try {
    window.parent.postMessage(
      {
        source: "clips-overlay",
        kind: "countdown-finished",
        part: "countdown",
      },
      "*",
    );
  } catch {
    /* parent gone */
  }
}

type OverlayState = {
  phase: OverlayPhase;
  baseElapsedMs: number;
  baseEpochMs: number;
  countdownEndsAtMs: number;
};

const COUNTDOWN_FALLBACK = 3;
const params = new URLSearchParams(location.search);
const part = params.get("part");
const root = document.getElementById("root") as HTMLDivElement;

function icon(paths: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

const ICONS = {
  pause: icon(
    '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>',
  ),
  resume: icon('<path d="M7 5l12 7-12 7z" fill="currentColor" stroke="none"/>'),
  stop: icon(
    '<rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none"/>',
  ),
  restart: icon('<path d="M3 11a9 9 0 1 1 2.6 6.3"/><path d="M3 4v7h7"/>'),
  trash: icon(
    '<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M5 7l1 13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-13"/><path d="M9 7V4h6v3"/>',
  ),
  cameraOff: icon(
    '<path d="M2 2l20 20"/><path d="M7 7H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12"/><path d="M22 8l-6 4 6 4V8z" opacity="0.5"/>',
  ),
  cancel: icon('<path d="M6 6l12 12"/><path d="M18 6L6 18"/>'),
  skipForward: icon(
    '<path d="M6 5l10 7-10 7z" fill="currentColor" stroke="none"/><rect x="16" y="5" width="3" height="14" rx="1" fill="currentColor" stroke="none"/>',
  ),
};

function send(type: string, extra: Record<string, unknown> = {}): void {
  try {
    chrome.runtime.sendMessage(
      { type, ...extra },
      () => void chrome.runtime.lastError,
    );
  } catch {
    /* the background may be momentarily asleep; state will re-sync */
  }
}

/* ---------------------------------------------------------------- bubble --- */

function postBubble(kind: string, extra: Record<string, unknown> = {}): void {
  try {
    window.parent.postMessage(
      { source: "clips-overlay", kind, part: "bubble", ...extra },
      "*",
    );
  } catch {
    /* parent gone */
  }
}

async function initBubble(): Promise<void> {
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  const ring = document.createElement("div");
  ring.className = "bubble-ring";
  bubble.appendChild(ring);

  // Drag: the content script owns the iframe position, so we just signal the
  // start of a drag and it captures the pointer page-wide.
  bubble.style.cursor = "grab";
  bubble.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    e.preventDefault();
    bubble.style.cursor = "grabbing";
    postBubble("bubble-drag-start");
    const restore = (): void => {
      bubble.style.cursor = "grab";
      window.removeEventListener("pointerup", restore);
    };
    window.addEventListener("pointerup", restore);
  });

  // Size dots (small / large), revealed on hover — like the desktop bubble.
  const sizes = document.createElement("div");
  sizes.className = "bubble-sizes";
  sizes.setAttribute("data-no-drag", "");
  for (const key of ["sm", "lg"] as const) {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = `bubble-size-dot bubble-size-${key}`;
    dot.title = key === "sm" ? "Small" : "Large";
    dot.setAttribute(
      "aria-label",
      key === "sm" ? "Small bubble" : "Large bubble",
    );
    dot.setAttribute("data-no-drag", "");
    dot.addEventListener("click", (e) => {
      e.stopPropagation();
      postBubble("bubble-size", { size: key });
    });
    sizes.appendChild(dot);
  }
  bubble.appendChild(sizes);

  root.appendChild(bubble);

  try {
    const videoDeviceId = await new Promise<string>((resolve) => {
      try {
        chrome.storage.sync.get("videoDeviceId", (v) =>
          resolve(typeof v.videoDeviceId === "string" ? v.videoDeviceId : ""),
        );
      } catch {
        resolve("");
      }
    });
    const stream = await getCameraBubbleStream(videoDeviceId);
    const video = document.createElement("video");
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;
    ring.appendChild(video);
    await video.play().catch(() => undefined);
    console.log("[clips-overlay] camera bubble live");
    // Tell the host the feed is live so it can start the countdown — the "3"
    // shouldn't appear until the camera is actually showing.
    postBubble("camera-ready");
  } catch (err) {
    console.warn("[clips-overlay] camera getUserMedia failed:", err);
    captureExtensionError(err, {
      tags: { surface: "overlay", overlayPart: "bubble" },
    });
    const empty = document.createElement("div");
    empty.className = "bubble-empty";
    empty.innerHTML = ICONS.cameraOff;
    ring.appendChild(empty);
    // Still release the countdown — a blocked/failed camera must not hang it.
    postBubble("camera-ready");
  }
}

/* ------------------------------------------------------------- countdown --- */

// The countdown only *visualizes* the worker's clock (state.countdownEndsAtMs).
// The worker owns the real timer and starts the recorder, so this never *needs*
// to signal "done" — which is what lets recording work on pages where no overlay
// can be injected at all. The skip button is the one exception: it explicitly
// asks the worker to start now (CLIPS_OVERLAY_COUNTDOWN_DONE → beginNow), which
// is idempotent and harmless if the timer also fires.
function initCountdown(): void {
  const wrap = document.createElement("div");
  wrap.className = "countdown";

  const controls = document.createElement("div");
  controls.className = "countdown-controls";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "countdown-control countdown-control-cancel";
  cancelBtn.setAttribute("aria-label", "Cancel recording");
  cancelBtn.innerHTML = ICONS.cancel;
  cancelBtn.addEventListener("click", () => send("CLIPS_OVERLAY_CANCEL"));

  const number = document.createElement("div");
  number.className = "countdown-number";

  const skipBtn = document.createElement("button");
  skipBtn.type = "button";
  skipBtn.className = "countdown-control countdown-control-skip";
  skipBtn.setAttribute("aria-label", "Skip countdown and start recording now");
  skipBtn.innerHTML = ICONS.skipForward;
  skipBtn.addEventListener("click", () => send("CLIPS_OVERLAY_COUNTDOWN_DONE"));

  controls.append(cancelBtn, number, skipBtn);

  const hint = document.createElement("div");
  hint.className = "countdown-hint";
  hint.textContent = "Get ready…";
  wrap.append(controls, hint);
  root.appendChild(wrap);

  // Each number is shown via a CHAINED setTimeout — the next step is scheduled
  // one second after the current one actually renders, not on a fixed interval.
  // This is deliberate: when the camera is slow to connect (e.g. an iPhone
  // Continuity Camera) it can hog the main thread and stall a tick. A setInterval
  // would then fire all the missed ticks back-to-back ("3"… then "2 1 Go" in a
  // burst); chaining means a stall only delays the next number, it never bursts.
  // At "Go" we tell the worker to start the recorder; the worker's own timer is
  // just a fallback for pages where no overlay can be injected.
  const STEP_MS = 1000;
  const steps = ["3", "2", "1", "Go"];
  let doneSent = false;

  const showStep = (index: number): void => {
    const text = steps[index];
    number.textContent = text;
    number.classList.toggle("countdown-go", text === "Go");
    number.style.animation = "none";
    void number.offsetWidth;
    number.style.animation = "";
    if (text === "Go") {
      if (!doneSent) {
        doneSent = true;
        send("CLIPS_OVERLAY_COUNTDOWN_DONE");
        postCountdownFinished();
      }
      return;
    }
    window.setTimeout(() => showStep(index + 1), STEP_MS);
  };

  showStep(0); // "3" immediately, then chain "2" → "1" → "Go"
}

/* --------------------------------------------------------------- toolbar --- */

// Vertical pill anchored to the LEFT edge — mirrors the desktop app's toolbar.
// Big Stop on top, elapsed time, pause; on hover it grows to reveal restart +
// cancel. Pure command emitter; the background owns the recorder.
function initToolbar(): void {
  const pill = document.createElement("div");
  pill.className = "toolbar-v";

  const makeBtn = (
    cls: string,
    title: string,
    svg: string,
    onClick: () => void,
  ): HTMLButtonElement => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = cls;
    btn.title = title;
    btn.setAttribute("aria-label", title);
    btn.innerHTML = svg;
    btn.addEventListener("click", onClick);
    return btn;
  };

  const stopBtn = makeBtn(
    "toolbar-v-stop",
    "Stop & save",
    '<span class="toolbar-v-stop-square"></span>',
    () => send("CLIPS_OVERLAY_STOP"),
  );

  const time = document.createElement("div");
  time.className = "toolbar-v-time";
  const clock = document.createElement("span");
  clock.textContent = "0:00";
  time.append(clock);

  const pauseBtn = makeBtn("toolbar-v-pause", "Pause", ICONS.pause, () => {
    if (state.phase === "paused") send("CLIPS_OVERLAY_RESUME");
    else send("CLIPS_OVERLAY_PAUSE");
  });

  const hoverGroup = document.createElement("div");
  hoverGroup.className = "toolbar-v-hover-actions";
  const restartBtn = makeBtn("toolbar-v-action", "Restart", ICONS.restart, () =>
    send("CLIPS_OVERLAY_RESTART"),
  );
  const cancelBtn = makeBtn(
    "toolbar-v-action toolbar-v-action-danger",
    "Discard",
    ICONS.trash,
    () => send("CLIPS_OVERLAY_CANCEL"),
  );
  hoverGroup.append(restartBtn, cancelBtn);

  pill.append(stopBtn, time, pauseBtn, hoverGroup);
  root.appendChild(pill);

  // The iframe can't size itself, so ask the content script to grow/shrink it.
  pill.addEventListener("mouseenter", () =>
    postToolbarSize(TOOLBAR_EXPANDED_H),
  );
  pill.addEventListener("mouseleave", () =>
    postToolbarSize(TOOLBAR_COLLAPSED_H),
  );

  const render = (): void => {
    const paused = state.phase === "paused";
    pill.classList.toggle("toolbar-v-paused", paused);
    pauseBtn.title = paused ? "Resume" : "Pause";
    pauseBtn.innerHTML = paused ? ICONS.resume : ICONS.pause;
    const elapsed = paused
      ? state.baseElapsedMs
      : state.baseElapsedMs + Math.max(0, Date.now() - state.baseEpochMs);
    clock.textContent = formatDuration(elapsed);
  };

  window.setInterval(render, 250);
  toolbarRender = render;
  render();
}

/* ---------------------------------------------------------------- saving --- */

// Bottom-left "Saving…" card shown from Stop until the clip opens, mirroring the
// desktop Finalizing overlay so the upload gap isn't a blank screen.
function initSaving(): void {
  const card = document.createElement("div");
  card.className = "saving-card";
  const caption = document.createElement("div");
  caption.className = "saving-caption";
  caption.textContent = "Saving clip…";
  const bar = document.createElement("div");
  bar.className = "saving-bar";
  const fill = document.createElement("div");
  fill.className = "saving-bar-fill";
  bar.appendChild(fill);
  // One progress indicator only — the indeterminate bar (no circular spinner).
  card.append(caption, bar);
  root.appendChild(card);
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/* ----------------------------------------------------------------- state --- */

const state: OverlayState = {
  phase: "recording",
  baseElapsedMs: 0,
  baseEpochMs: Date.now(),
  countdownEndsAtMs: 0,
};
let toolbarRender: (() => void) | null = null;

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object") return;
  if ((message as { type?: unknown }).type !== "CLIPS_OVERLAY_STATE") return;
  const next = (message as { state?: Partial<OverlayState> }).state;
  if (!next) return;
  if (typeof next.phase === "string") state.phase = next.phase as OverlayPhase;
  if (typeof next.baseElapsedMs === "number")
    state.baseElapsedMs = next.baseElapsedMs;
  if (typeof next.baseEpochMs === "number")
    state.baseEpochMs = next.baseEpochMs;
  if (typeof next.countdownEndsAtMs === "number")
    state.countdownEndsAtMs = next.countdownEndsAtMs;
  toolbarRender?.();
});

if (part === "bubble") void initBubble();
else if (part === "countdown") initCountdown();
else if (part === "toolbar") initToolbar();
else if (part === "saving") initSaving();

// Ask the background for the current state so a freshly-injected toolbar (e.g.
// after the user navigated to a new page mid-recording) shows the right timer.
send("CLIPS_OVERLAY_HELLO", { part });
