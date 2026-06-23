import "./overlay.css";

// The overlay runs as an extension-origin iframe injected into the page by the
// content script. Each iframe renders one "part" of the Loom-style recording UI
// (camera bubble, countdown, or control toolbar) selected via ?part=. Running at
// the chrome-extension:// origin gives us a persistent camera permission grant,
// CSS isolation from the host page, and direct chrome.runtime messaging with the
// background service worker.

type OverlayPhase = "idle" | "countdown" | "recording" | "paused";

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

async function initBubble(): Promise<void> {
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  const ring = document.createElement("div");
  ring.className = "bubble-ring";
  bubble.appendChild(ring);
  root.appendChild(bubble);

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 640 },
        facingMode: "user",
      },
      audio: false,
    });
    const video = document.createElement("video");
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;
    ring.appendChild(video);
    await video.play().catch(() => undefined);
  } catch {
    const empty = document.createElement("div");
    empty.className = "bubble-empty";
    empty.innerHTML = ICONS.cameraOff;
    ring.appendChild(empty);
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

  let lastShown = "";
  const render = (): void => {
    const fallback =
      Number(params.get("seconds") || String(COUNTDOWN_FALLBACK)) ||
      COUNTDOWN_FALLBACK;
    const endsAt =
      state.countdownEndsAtMs > 0
        ? state.countdownEndsAtMs
        : Date.now() + fallback * 1000;
    const remainingMs = endsAt - Date.now();
    if (state.phase !== "countdown" || remainingMs <= 0) {
      if (lastShown !== "Go") {
        number.textContent = "Go";
        number.classList.add("countdown-go");
        lastShown = "Go";
      }
      return;
    }
    const text = String(Math.ceil(remainingMs / 1000));
    if (text !== lastShown) {
      number.textContent = text;
      number.classList.remove("countdown-go");
      number.style.animation = "none";
      void number.offsetWidth;
      number.style.animation = "";
      lastShown = text;
    }
  };
  countdownRender = render;
  window.setInterval(render, 100);
  render();
}

/* --------------------------------------------------------------- toolbar --- */

function initToolbar(): void {
  const pill = document.createElement("div");
  pill.className = "toolbar-pill";

  const time = document.createElement("div");
  time.className = "toolbar-time";
  const dot = document.createElement("span");
  dot.className = "toolbar-dot";
  const clock = document.createElement("span");
  clock.textContent = "0:00";
  time.append(dot, clock);

  const makeBtn = (
    cls: string,
    title: string,
    svg: string,
    onClick: () => void,
  ): HTMLButtonElement => {
    const btn = document.createElement("button");
    btn.className = `toolbar-btn ${cls}`.trim();
    btn.title = title;
    btn.setAttribute("aria-label", title);
    btn.innerHTML = svg;
    btn.addEventListener("click", onClick);
    return btn;
  };

  const pauseBtn = makeBtn("pause-resume", "Pause", ICONS.pause, () => {
    if (state.phase === "paused") send("CLIPS_OVERLAY_RESUME");
    else send("CLIPS_OVERLAY_PAUSE");
  });
  const restartBtn = makeBtn("restart", "Restart", ICONS.restart, () =>
    send("CLIPS_OVERLAY_RESTART"),
  );
  const deleteBtn = makeBtn("danger", "Delete", ICONS.trash, () =>
    send("CLIPS_OVERLAY_CANCEL"),
  );
  const stopBtn = makeBtn("stop", "Stop & save", ICONS.stop, () =>
    send("CLIPS_OVERLAY_STOP"),
  );

  const divider = document.createElement("div");
  divider.className = "toolbar-divider";

  pill.append(time, divider, pauseBtn, restartBtn, deleteBtn, stopBtn);
  root.appendChild(pill);

  const render = (): void => {
    const paused = state.phase === "paused";
    pill.classList.toggle("paused", paused);
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
let countdownRender: (() => void) | null = null;

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
  countdownRender?.();
});

if (part === "bubble") void initBubble();
else if (part === "countdown") initCountdown();
else if (part === "toolbar") initToolbar();

// Ask the background for the current state so a freshly-injected toolbar (e.g.
// after the user navigated to a new page mid-recording) shows the right timer.
send("CLIPS_OVERLAY_HELLO", { part });
