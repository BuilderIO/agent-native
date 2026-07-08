import { captureExtensionError, initExtensionSentry } from "./sentry";

initExtensionSentry("background");

const DEFAULT_CLIPS_BASE_URL = "https://clips.agent-native.com";
const DEBUGGER_PROTOCOL_VERSION = "1.3";
const MAX_CONSOLE_LOGS = 400;
const MAX_NETWORK_REQUESTS = 400;
const MAX_MESSAGE_LENGTH = 2_000;
const MAX_URL_LENGTH = 1_000;
const STORAGE_SETUP_REQUIRED_MESSAGE =
  "Connect storage to finish saving this clip: Builder.io (free tier storage + AI) or S3-compatible storage.";
const STORAGE_SETUP_FAILURE_RE =
  /video storage is not connected|no video storage configured|file upload provider|storage provider|connect builder|s3-compatible/i;
const SECRET_KEY_FRAGMENT =
  "(?:authorization|cookie|set[-_]?cookie|token|secret|password|passwd|pwd|api[-_]?key|apikey|session|credential)";
const AUTHORIZATION_SCHEME_RE =
  /\b(authorization)\b(\s*[:=]\s*)(?:bearer|basic)\s+[a-z0-9._~+/-]+=*/gi;
const DOUBLE_QUOTED_SECRET_VALUE_RE = new RegExp(
  `(["']?)([A-Za-z0-9_$.-]*${SECRET_KEY_FRAGMENT}[A-Za-z0-9_$.-]*)\\1(\\s*[:=]\\s*)"(?:[^"\\\\]|\\\\.)*"`,
  "gi",
);
const SINGLE_QUOTED_SECRET_VALUE_RE = new RegExp(
  `(["']?)([A-Za-z0-9_$.-]*${SECRET_KEY_FRAGMENT}[A-Za-z0-9_$.-]*)\\1(\\s*[:=]\\s*)'(?:[^'\\\\]|\\\\.)*'`,
  "gi",
);
const UNQUOTED_SECRET_VALUE_RE = new RegExp(
  `(["']?)([A-Za-z0-9_$.-]*${SECRET_KEY_FRAGMENT}[A-Za-z0-9_$.-]*)\\1(\\s*[:=]\\s*)([^"',\\s;}\\]]+)`,
  "gi",
);

type CaptureSurface = "browser" | "window" | "monitor" | "camera";
type ConsoleLevel = "debug" | "log" | "info" | "warn" | "error";
type NetworkType = "fetch" | "xhr";
type UploadMode = "streaming" | "buffered";

type ExtensionSettings = {
  clipsBaseUrl: string;
  captureSurface: CaptureSurface;
  includeCamera: boolean;
  includeMicrophone: boolean;
  includeDeveloperLogs: boolean;
  videoDeviceId: string;
  audioDeviceId: string;
};

type PopupStartMessage = {
  type: "CLIPS_POPUP_START";
  settings?: Partial<ExtensionSettings>;
};

type PopupMessage =
  | PopupStartMessage
  | { type: "CLIPS_POPUP_STATUS" }
  | { type: "CLIPS_POPUP_STOP" }
  | { type: "CLIPS_POPUP_CANCEL" }
  | { type: "CLIPS_POPUP_OPEN" }
  | { type: "CLIPS_POPUP_SIGN_IN"; settings?: Partial<ExtensionSettings> }
  | {
      type: "CLIPS_POPUP_PREPARE_PERMISSION_START";
      settings?: Partial<ExtensionSettings>;
      targetTabId?: number;
    };

type ExternalMessage =
  | {
      type: "CLIPS_CAPTURE_START";
      sessionId?: string;
      recordingId?: string;
      pageUrl?: string;
    }
  | {
      type: "CLIPS_CAPTURE_STOP";
      sessionId?: string;
      recordingId?: string;
    }
  | {
      type: "CLIPS_CAPTURE_CANCEL";
      sessionId?: string;
    }
  | {
      type: "CLIPS_AUTH_SESSION";
      token?: string;
      email?: string;
      clipsBaseUrl?: string;
    };

type ChromeTab = {
  id?: number;
  windowId?: number;
  title?: string;
  url?: string;
};

type ConsoleLog = {
  timestampMs: number;
  elapsedMs: number;
  level: ConsoleLevel;
  message: string;
  stack?: string;
};

type NetworkRequest = {
  timestampMs: number;
  elapsedMs: number;
  type: NetworkType;
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  ok?: boolean;
  durationMs: number;
  error?: string;
};

type BrowserDiagnosticsData = {
  pageUrl: string | null;
  userAgent: string | null;
  startedAt: string;
  endedAt: string;
  consoleLogs: ConsoleLog[];
  networkRequests: NetworkRequest[];
  summary: {
    consoleCount: number;
    consoleErrorCount: number;
    consoleWarnCount: number;
    networkCount: number;
    networkFailureCount: number;
    capturedAt: string | null;
  };
};

type NativeRecordingStatus =
  | "recording"
  | "paused"
  | "stopping"
  | "uploading"
  | "complete"
  | "error";

type NativeRecording = {
  sessionId: string;
  recordingId: string;
  clipsBaseUrl: string;
  uploadUrl: string;
  uploadMode: UploadMode;
  targetTabId: number;
  targetTitle: string | null;
  targetUrl: string | null;
  startedAt: string;
  startedAtMs: number;
  captureSurface: CaptureSurface;
  includeCamera: boolean;
  includeMicrophone: boolean;
  includeDeveloperLogs: boolean;
  videoDeviceId: string;
  audioDeviceId: string;
  status: NativeRecordingStatus;
  recordingUrl: string;
  error: string | null;
  // When an upload fails, the recording is saved to the user's Downloads as a
  // fallback so it is never lost; these describe that saved file.
  savedToDisk?: boolean;
  savedFilename?: string;
};

type OffscreenStatusMessage = {
  type: "CLIPS_NATIVE_STATUS";
  sessionId: string;
  status: NativeRecordingStatus;
  recordingId?: string;
  result?: Record<string, unknown>;
  error?: string;
  storageSetupRequired?: boolean;
  savedToDisk?: boolean;
  savedFilename?: string;
};

type ExtensionErrorMessage = {
  type: "CLIPS_EXTENSION_ERROR";
  surface?: string;
  name?: string;
  message?: string;
  stack?: string;
  context?: Record<string, unknown>;
};

function isStorageSetupFailureMessage(message: string | null | undefined) {
  return STORAGE_SETUP_FAILURE_RE.test(message ?? "");
}

function friendlyRecordingError(message: string | null | undefined): string {
  return isStorageSetupFailureMessage(message)
    ? STORAGE_SETUP_REQUIRED_MESSAGE
    : message || "Could not stop recording.";
}

type PendingNetworkRequest = {
  requestId: string;
  timestampMs: number;
  elapsedMs: number;
  startedAtMonotonicSeconds: number | null;
  type: NetworkType;
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  ok?: boolean;
  error?: string;
};

type CaptureSession = {
  sessionId: string;
  targetTabId: number;
  targetTitle: string | null;
  targetUrl: string | null;
  recordingId: string | null;
  startedAt: string;
  startedAtMs: number;
  includeDeveloperLogs: boolean;
  attached: boolean;
  attachError: string | null;
  consoleLogs: ConsoleLog[];
  networkRequests: NetworkRequest[];
  pendingNetworkRequests: Map<string, PendingNetworkRequest>;
};

type StoredAuth = {
  token: string;
  email?: string;
  clipsBaseUrl: string;
  savedAt: string;
};

const DEFAULT_SETTINGS: ExtensionSettings = {
  clipsBaseUrl: DEFAULT_CLIPS_BASE_URL,
  captureSurface: "browser",
  includeCamera: true,
  includeMicrophone: true,
  includeDeveloperLogs: true,
  videoDeviceId: "",
  audioDeviceId: "",
};

const sessions = new Map<string, CaptureSession>();
const tabToSession = new Map<number, string>();
let activeNativeRecording: NativeRecording | null = null;

// ----- Loom-style in-page overlay state -------------------------------------
// The service worker is the single source of truth for the recording phase and
// the elapsed-time base. The phase decides which overlay "parts" each tab should
// show; the timer base lets every overlay iframe tick the same clock locally.

type CaptureMode = "screen" | "camera";
type OverlayPhase = "idle" | "countdown" | "recording" | "paused" | "saving";
type OverlayPart = "bubble" | "countdown" | "toolbar" | "saving";

let overlayPhase: OverlayPhase = "idle";
let overlayBaseElapsedMs = 0;
let overlayBaseEpochMs = 0;
// Bubble during the countdown preview (any camera). During recording, the face
// is composited into the video by the offscreen for screen+camera, so we only
// show the on-page bubble for camera-only mode (recordingShowsBubble).
let overlayShowsBubble = false;
let recordingShowsBubble = false;
// Cross-tab follow: when true, the overlay is pushed to whatever tab the user
// switches to mid-recording. That requires "<all_urls>" + a declarative content
// script, which triggers Chrome's broad-host in-depth review. Shipped OFF
// (activeTab-only: the overlay lives on the launch tab the user invoked the
// extension from). Capture is unaffected — it runs in the offscreen document via
// getDisplayMedia regardless. See PERMISSIONS.md to re-enable.
// Typed `boolean` (not inferred literal `false`) so the cross-tab branches below
// don't read as unreachable code; flip the value to re-enable. See PERMISSIONS.md.
const CROSS_TAB_FOLLOW: boolean = false;
// The tab the recording was launched from — the only tab activeTab lets us touch.
let overlayTabId: number | null = null;
let countdownEndsAtMs = 0;
let armingNativeRecordingSessionId: string | null = null;
// If the worker dies mid-arming (before the `finally` in handlePopupStart
// clears the guard), the persisted guard would otherwise survive for the rest
// of the browser session and permanently report "already recording". A TTL
// comfortably longer than the picker + create-recording round trip lets a
// stuck guard self-clear instead.
const ARMING_GUARD_TTL_MS = 120000;

function desiredParts(): OverlayPart[] {
  // The on-page controls match the desktop app: a left-edge vertical pill plus
  // the face bubble. (Both are captured in full-screen/window recordings — same
  // tradeoff as the desktop's on-screen controls; that's the intended UX.)
  if (overlayPhase === "countdown") {
    return overlayShowsBubble ? ["bubble", "countdown"] : ["countdown"];
  }
  if (overlayPhase === "recording" || overlayPhase === "paused") {
    return recordingShowsBubble ? ["bubble", "toolbar"] : ["toolbar"];
  }
  if (overlayPhase === "saving") {
    return ["saving"];
  }
  return [];
}

function overlayStateForBroadcast(): {
  phase: OverlayPhase;
  baseElapsedMs: number;
  baseEpochMs: number;
  countdownEndsAtMs: number;
} {
  return {
    phase: overlayPhase,
    baseElapsedMs: overlayBaseElapsedMs,
    baseEpochMs: overlayBaseEpochMs,
    countdownEndsAtMs,
  };
}

// The countdown clock lives here in the worker, not in the overlay. The overlay
// only *visualizes* it. This is critical: on chrome:// pages (and any page where
// the overlay can't be injected) the recorder must still start. Without this,
// recording would silently never begin on those pages.
const COUNTDOWN_SECONDS = 3;
const PENDING_PERMISSION_START_TTL_MS = 5 * 60 * 1000;

function clearCountdownTimer(): void {
  countdownEndsAtMs = 0;
}

// Toggle the toolbar popup off while recording so clicking the extension icon
// fires onClicked (immediate stop & save) instead of opening the popup.
function setActionPopup(path: string): void {
  try {
    void chrome.action.setPopup({ popup: path });
  } catch {
    /* action API unavailable */
  }
}

// Reaches every extension-origin overlay iframe across all tabs at once.
function broadcastOverlayState(): void {
  void persistOverlay();
  try {
    chrome.runtime.sendMessage(
      { type: "CLIPS_OVERLAY_STATE", state: overlayStateForBroadcast() },
      () => void chrome.runtime.lastError,
    );
  } catch {
    /* no overlay listening yet */
  }
}

// MV3 can suspend the service worker mid-recording, wiping these module vars.
// Persist them to session storage (survives suspend/revive within the browser
// session) and restore on worker startup so the overlay controls keep working.
function persistOverlay(): Promise<void> {
  return sessionStorageSet({
    overlayRuntime: {
      phase: overlayPhase,
      baseElapsedMs: overlayBaseElapsedMs,
      baseEpochMs: overlayBaseEpochMs,
      showsBubble: overlayShowsBubble,
      recordingShowsBubble,
      countdownEndsAtMs,
      overlayTabId,
    },
  }).catch(() => undefined);
}

async function restoreRuntimeState(): Promise<void> {
  const stored = await sessionStorageGet([
    "activeNativeRecording",
    "overlayRuntime",
    "armingNativeRecordingSessionId",
  ]);
  const rec = stored.activeNativeRecording as NativeRecording | undefined;
  if (rec && typeof rec.sessionId === "string" && !activeNativeRecording) {
    activeNativeRecording = rec;
  }
  const freshArmingSessionId = await readFreshPersistedArmingSessionId(
    stored.armingNativeRecordingSessionId,
  );
  if (freshArmingSessionId && armingNativeRecordingSessionId === null) {
    armingNativeRecordingSessionId = freshArmingSessionId;
  }
  const rt = stored.overlayRuntime as
    | {
        phase?: OverlayPhase;
        baseElapsedMs?: number;
        baseEpochMs?: number;
        showsBubble?: boolean;
        recordingShowsBubble?: boolean;
        countdownEndsAtMs?: number;
        overlayTabId?: number;
      }
    | undefined;
  if (rt && typeof rt.phase === "string" && overlayPhase === "idle") {
    overlayPhase = rt.phase;
    overlayBaseElapsedMs =
      typeof rt.baseElapsedMs === "number" ? rt.baseElapsedMs : 0;
    overlayBaseEpochMs =
      typeof rt.baseEpochMs === "number" ? rt.baseEpochMs : 0;
    overlayShowsBubble = Boolean(rt.showsBubble);
    recordingShowsBubble = Boolean(rt.recordingShowsBubble);
    countdownEndsAtMs =
      typeof rt.countdownEndsAtMs === "number" ? rt.countdownEndsAtMs : 0;
    overlayTabId = typeof rt.overlayTabId === "number" ? rt.overlayTabId : null;
  }

  if (overlayPhase !== "idle" && activeNativeRecording) {
    // Recording survived a worker restart. The offscreen document owns the
    // recorder + pre-roll timer, so it kept running; just restore immediate-stop
    // mode. If the pre-roll already elapsed, assume the offscreen started the
    // recorder so the icon click does Stop (not Discard).
    setActionPopup("");
    if (
      overlayPhase === "countdown" &&
      countdownEndsAtMs > 0 &&
      nowMs() >= countdownEndsAtMs
    ) {
      overlayPhase = "recording";
      overlayBaseEpochMs = countdownEndsAtMs;
      countdownEndsAtMs = 0;
    }
  }
}

function sendTabMessage(
  tabId: number,
  message: Record<string, unknown>,
): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

async function ensureContentScript(tabId: number): Promise<void> {
  const scripting = (
    chrome as typeof chrome & {
      scripting?: {
        executeScript: (args: {
          target: { tabId: number };
          files: string[];
        }) => Promise<unknown>;
      };
    }
  ).scripting;
  if (!scripting) return;
  await scripting
    .executeScript({ target: { tabId }, files: ["assets/content-script.js"] })
    .catch(() => undefined);
}

async function mountOverlayOnTab(tabId: number): Promise<void> {
  await ensureContentScript(tabId);
  await sendTabMessage(tabId, {
    type: "CLIPS_OVERLAY_MOUNT",
    parts: desiredParts(),
  });
}

function allTabs(): Promise<chrome.tabs.Tab[]> {
  return new Promise((resolve) => {
    chrome.tabs.query({}, (tabs) => resolve(tabs ?? []));
  });
}

async function broadcastMount(): Promise<void> {
  // activeTab-only: keep the overlay on the launch tab (re-ensures the injected
  // content script too, so it survives a worker suspend). Cross-tab broadcast is
  // gated behind CROSS_TAB_FOLLOW because it needs broad host access.
  if (!CROSS_TAB_FOLLOW) {
    if (overlayTabId !== null) await mountOverlayOnTab(overlayTabId);
    return;
  }
  const parts = desiredParts();
  const tabs = await allTabs();
  await Promise.all(
    tabs.map((tab) =>
      typeof tab.id === "number"
        ? sendTabMessage(tab.id, { type: "CLIPS_OVERLAY_MOUNT", parts })
        : Promise.resolve(),
    ),
  );
}

async function broadcastUnmount(): Promise<void> {
  if (!CROSS_TAB_FOLLOW) {
    if (overlayTabId !== null)
      await sendTabMessage(overlayTabId, { type: "CLIPS_OVERLAY_UNMOUNT" });
    return;
  }
  const tabs = await allTabs();
  await Promise.all(
    tabs.map((tab) =>
      typeof tab.id === "number"
        ? sendTabMessage(tab.id, { type: "CLIPS_OVERLAY_UNMOUNT" })
        : Promise.resolve(),
    ),
  );
}

function resetOverlay(): void {
  overlayPhase = "idle";
  overlayBaseElapsedMs = 0;
  overlayBaseEpochMs = 0;
  overlayShowsBubble = false;
  recordingShowsBubble = false;
  clearCountdownTimer();
  setRecordingFlag(false);
  // Bring back the toolbar popup now that we're idle again.
  setActionPopup("src/popup.html");
  void persistOverlay();
}

// ----- Pre-record camera preview --------------------------------------------
// While the popup is open and idle, show the live face bubble on the active tab
// (like the desktop app's pre-record bubble). The popup holds a runtime port
// open; its disconnect (popup closed) tears the preview down.
let previewTabId: number | null = null;

async function startPreview(wantsCamera: boolean): Promise<void> {
  await ensureRestored();
  // Never show a preview over an active recording (the recording overlay owns
  // the tab then). If the camera is off, make sure any preview is removed.
  if (overlayPhase !== "idle" || !wantsCamera) {
    await stopPreview();
    return;
  }
  const tab = await queryActiveTab();
  if (!tab || typeof tab.id !== "number") return;
  if (previewTabId !== null && previewTabId !== tab.id) await stopPreview();
  previewTabId = tab.id;
  await ensureContentScript(tab.id);
  // Injection / send fail silently on unsupported pages (chrome://, etc.).
  await sendTabMessage(tab.id, {
    type: "CLIPS_OVERLAY_MOUNT",
    parts: ["bubble"],
  });
}

async function stopPreview(): Promise<void> {
  const tabId = previewTabId;
  previewTabId = null;
  if (tabId === null) return;
  // Don't tear down a recording overlay that took over this tab.
  if (overlayPhase !== "idle") return;
  await sendTabMessage(tabId, { type: "CLIPS_OVERLAY_UNMOUNT" });
}

// Mirrored into chrome.storage.local so content scripts can cheaply tell whether
// a recording is in progress without waking the service worker on every page
// load. Content scripts can read storage.local by default; storage.session
// cannot, which is why we use local here.
function setRecordingFlag(active: boolean): void {
  try {
    chrome.storage.local.set(
      { clipsRecordingActive: active },
      () => void chrome.runtime.lastError,
    );
  } catch {
    /* storage unavailable */
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function nowMs(): number {
  return Date.now();
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function redactString(
  value: string,
  options: { redactQueryValues?: boolean } = {},
): string {
  const redacted = value
    .replace(AUTHORIZATION_SCHEME_RE, "$1$2<redacted>")
    .replace(/\b(bearer|basic)\s+[a-z0-9._~+/-]+=*/gi, "$1 <redacted>")
    .replace(DOUBLE_QUOTED_SECRET_VALUE_RE, '$1$2$1$3"<redacted>"')
    .replace(SINGLE_QUOTED_SECRET_VALUE_RE, "$1$2$1$3'<redacted>'")
    .replace(UNQUOTED_SECRET_VALUE_RE, "$1$2$1$3<redacted>");
  return options.redactQueryValues
    ? redacted.replace(/([?&][^=\s&?#]+)=([^&\s#]+)/g, "$1=<redacted>")
    : redacted;
}

function sanitizeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const redacted = redactString(raw, { redactQueryValues: true });
  try {
    const parsed = new URL(redacted);
    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    const params = new URLSearchParams();
    for (const key of parsed.searchParams.keys()) {
      params.set(key, "<redacted>");
    }
    parsed.search = params.toString();
    return truncate(parsed.toString(), MAX_URL_LENGTH);
  } catch {
    return truncate(redacted, MAX_URL_LENGTH);
  }
}

function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return DEFAULT_CLIPS_BASE_URL;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return DEFAULT_CLIPS_BASE_URL;
    }
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return DEFAULT_CLIPS_BASE_URL;
  }
}

function normalizeSurface(value: unknown): CaptureSurface {
  if (
    value === "browser" ||
    value === "window" ||
    value === "monitor" ||
    value === "camera"
  ) {
    return value;
  }
  return DEFAULT_SETTINGS.captureSurface;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeDeviceId(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function chromeLastError(): Error | null {
  const error = chrome.runtime.lastError;
  return error ? new Error(error.message) : null;
}

function storageGet(keys: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(keys, (value) => resolve(value));
  });
}

function storageSet(value: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(value, () => {
      const error = chromeLastError();
      if (error) reject(error);
      else resolve();
    });
  });
}

async function readSettings(
  overrides?: Partial<ExtensionSettings>,
): Promise<ExtensionSettings> {
  const stored = await storageGet([
    "clipsBaseUrl",
    "captureSurface",
    "includeCamera",
    "includeMicrophone",
    "includeDeveloperLogs",
    "videoDeviceId",
    "audioDeviceId",
  ]);
  return {
    clipsBaseUrl: normalizeBaseUrl(
      overrides?.clipsBaseUrl ?? stored.clipsBaseUrl,
    ),
    captureSurface: normalizeSurface(
      overrides?.captureSurface ?? stored.captureSurface,
    ),
    includeCamera: normalizeBoolean(
      overrides?.includeCamera ?? stored.includeCamera,
      DEFAULT_SETTINGS.includeCamera,
    ),
    includeMicrophone: normalizeBoolean(
      overrides?.includeMicrophone ?? stored.includeMicrophone,
      DEFAULT_SETTINGS.includeMicrophone,
    ),
    includeDeveloperLogs: normalizeBoolean(
      overrides?.includeDeveloperLogs ?? stored.includeDeveloperLogs,
      DEFAULT_SETTINGS.includeDeveloperLogs,
    ),
    videoDeviceId: normalizeDeviceId(
      overrides?.videoDeviceId ?? stored.videoDeviceId,
    ),
    audioDeviceId: normalizeDeviceId(
      overrides?.audioDeviceId ?? stored.audioDeviceId,
    ),
  };
}

function sessionStorageSet(value: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.session.set(value, () => {
      const error = chromeLastError();
      if (error) reject(error);
      else resolve();
    });
  });
}

function sessionStorageGet(keys: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    chrome.storage.session.get(keys, (value) => resolve(value));
  });
}

function sessionStorageRemove(key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.session.remove(key, () => {
      const error = chromeLastError();
      if (error) reject(error);
      else resolve();
    });
  });
}

function originOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

// Auth lives in chrome.storage.local (not .session) so the user stays signed in
// across extension reloads and browser restarts. It is the user's own session
// token — treated like a cookie — and is cleared on sign-out or when invalid.
function localStorageSet(value: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(value, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function localStorageGet(keys: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (value) => resolve(value ?? {}));
  });
}

async function saveAuthSession(auth: StoredAuth): Promise<void> {
  await localStorageSet({ clipsAuth: auth });
}

async function readAuthSession(
  settings: ExtensionSettings,
): Promise<StoredAuth | null> {
  const stored = await localStorageGet(["clipsAuth"]);
  const auth = stored.clipsAuth as Partial<StoredAuth> | undefined;
  if (
    !auth ||
    typeof auth.token !== "string" ||
    !auth.token.trim() ||
    typeof auth.clipsBaseUrl !== "string" ||
    originOf(auth.clipsBaseUrl) !== originOf(settings.clipsBaseUrl)
  ) {
    return null;
  }
  return {
    token: auth.token,
    email: typeof auth.email === "string" ? auth.email : undefined,
    clipsBaseUrl: normalizeBaseUrl(auth.clipsBaseUrl),
    savedAt: typeof auth.savedAt === "string" ? auth.savedAt : nowIso(),
  };
}

async function authHeaders(
  settings: ExtensionSettings,
): Promise<Record<string, string>> {
  const auth = await readAuthSession(settings);
  return auth ? { Authorization: `Bearer ${auth.token}` } : {};
}

async function saveActiveNativeRecording(): Promise<void> {
  if (!activeNativeRecording) {
    await sessionStorageRemove("activeNativeRecording").catch(() => undefined);
    return;
  }
  await sessionStorageSet({
    activeNativeRecording: activeNativeRecording,
  }).catch(() => undefined);
}

// The arming guard rejects a second CLIPS_POPUP_START while the picker +
// create-recording round trip is in flight. The in-memory var alone does not
// survive an MV3 service-worker suspension (possible while awaiting the
// native picker or the create-recording network call), which would let a
// second start race in on a revived worker. Persist it to session storage
// (authoritative; cleared when the browser session ends) and treat the
// in-memory var as a fast path only. Stored alongside a timestamp so a guard
// left behind by a worker that died mid-arming (skipping the `finally` that
// normally clears it) expires instead of blocking every future start for the
// rest of the browser session.
async function setArmingGuard(sessionId: string | null): Promise<void> {
  armingNativeRecordingSessionId = sessionId;
  if (sessionId) {
    await sessionStorageSet({
      armingNativeRecordingSessionId: { sessionId, ts: Date.now() },
    }).catch(() => undefined);
  } else {
    await sessionStorageRemove("armingNativeRecordingSessionId").catch(
      () => undefined,
    );
  }
}

// Reads the persisted arming guard and returns its sessionId only if it is
// still fresh. Clears (best-effort) and treats as absent when: missing,
// expired, or in the old bare-string shape (no `ts` — can't be aged, so
// treat as stale). Centralized so handlePopupStart and restoreRuntimeState
// apply the exact same TTL logic.
async function readFreshPersistedArmingSessionId(
  rawValue: unknown,
): Promise<string | null> {
  if (typeof rawValue === "string" && rawValue) {
    // Old shape (bare string, no timestamp) — can't verify freshness, so
    // treat as stale and clear it.
    await sessionStorageRemove("armingNativeRecordingSessionId").catch(
      () => undefined,
    );
    return null;
  }
  if (rawValue && typeof rawValue === "object") {
    const { sessionId, ts } = rawValue as { sessionId?: unknown; ts?: unknown };
    if (typeof sessionId === "string" && sessionId && typeof ts === "number") {
      if (Date.now() - ts < ARMING_GUARD_TTL_MS) {
        return sessionId;
      }
    }
    await sessionStorageRemove("armingNativeRecordingSessionId").catch(
      () => undefined,
    );
  }
  return null;
}

function queryActiveTab(): Promise<ChromeTab | null> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const error = chromeLastError();
      if (error) reject(error);
      else resolve((tabs[0] as ChromeTab | undefined) ?? null);
    });
  });
}

function getTab(tabId: number): Promise<ChromeTab | null> {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      const error = chromeLastError();
      resolve(error ? null : ((tab as ChromeTab | undefined) ?? null));
    });
  });
}

async function activateTab(tab: ChromeTab): Promise<void> {
  if (typeof tab.id !== "number") return;
  await new Promise<void>((resolve) => {
    chrome.tabs.update(tab.id as number, { active: true }, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
  if (typeof tab.windowId === "number") {
    await new Promise<void>((resolve) => {
      chrome.windows.update(tab.windowId as number, { focused: true }, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    });
  }
}

function createTab(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url }, () => {
      const error = chromeLastError();
      if (error) reject(error);
      else resolve();
    });
  });
}

type PendingPermissionStart = {
  settings: ExtensionSettings;
  targetTabId: number;
  createdAtMs: number;
};

async function writePendingPermissionStart(
  pending: PendingPermissionStart,
): Promise<void> {
  await sessionStorageSet({ pendingPermissionStart: pending }).catch(
    () => undefined,
  );
}

async function clearPendingPermissionStart(): Promise<void> {
  await sessionStorageRemove("pendingPermissionStart").catch(() => undefined);
}

async function readPendingPermissionStart(): Promise<PendingPermissionStart | null> {
  const raw = (await sessionStorageGet(["pendingPermissionStart"]))
    .pendingPermissionStart;
  if (!raw || typeof raw !== "object") return null;
  const pending = raw as Partial<PendingPermissionStart>;
  if (
    !pending.settings ||
    typeof pending.targetTabId !== "number" ||
    typeof pending.createdAtMs !== "number"
  ) {
    await clearPendingPermissionStart();
    return null;
  }
  if (Date.now() - pending.createdAtMs > PENDING_PERMISSION_START_TTL_MS) {
    await clearPendingPermissionStart();
    return null;
  }
  return pending as PendingPermissionStart;
}

function debuggerAttach(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION, () => {
      const error = chromeLastError();
      if (error) reject(error);
      else resolve();
    });
  });
}

function debuggerDetach(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => resolve());
  });
}

function debuggerSendCommand(
  tabId: number,
  method: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params ?? {}, (result) => {
      const error = chromeLastError();
      if (error) reject(error);
      else resolve(result);
    });
  });
}

function timezoneHeader(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function actionUrl(settings: ExtensionSettings, actionName: string): string {
  return `${settings.clipsBaseUrl}/_agent-native/actions/${actionName}`;
}

async function postAction<T>(
  settings: ExtensionSettings,
  actionName: string,
  body: Record<string, unknown>,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Agent-Native-Frontend": "1",
    ...(await authHeaders(settings)),
  };
  const timezone = timezoneHeader();
  if (timezone) headers["x-user-timezone"] = timezone;
  const res = await fetch(actionUrl(settings, actionName), {
    method: "POST",
    headers,
    credentials: "include",
    cache: "no-store",
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  let data: Record<string, unknown> | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const rawMessage =
      (data && typeof data.error === "string" && data.error) ||
      (data && typeof data.message === "string" && data.message) ||
      text ||
      res.statusText;
    const authMessage =
      res.status === 401 || res.status === 403
        ? "Sign in to Clips, then start the recording again."
        : rawMessage;
    const err = new Error(authMessage || `Action ${actionName} failed.`);
    (err as { status?: number }).status = res.status;
    throw err;
  }
  return (data ?? {}) as T;
}

async function ensureOffscreenDocument(): Promise<void> {
  const path = "src/offscreen.html";
  const offscreenUrl = chrome.runtime.getURL(path);
  const runtimeWithContexts = chrome.runtime as typeof chrome.runtime & {
    getContexts?: (filter: Record<string, unknown>) => Promise<unknown[]>;
  };
  const existing = runtimeWithContexts.getContexts
    ? await runtimeWithContexts.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [offscreenUrl],
      })
    : [];
  if (existing.length > 0) return;

  await chrome.offscreen.createDocument({
    url: path,
    reasons: ["USER_MEDIA", "CLIPBOARD"],
    justification:
      "Record tab, camera, and microphone streams after the user starts Clips, then copy the finished clip link.",
  });
}

function sendOffscreenMessage<T>(message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T & { error?: string }) => {
      const error = chromeLastError();
      if (error) {
        reject(error);
        return;
      }
      if (response && typeof response.error === "string") {
        reject(new Error(response.error));
        return;
      }
      resolve(response);
    });
  });
}

function recordingUrl(
  recording: Pick<NativeRecording, "clipsBaseUrl" | "recordingId">,
): string {
  return `${recording.clipsBaseUrl}/r/${encodeURIComponent(recording.recordingId)}`;
}

async function copyRecordingUrlToClipboard(
  recording: NativeRecording,
): Promise<void> {
  try {
    await ensureOffscreenDocument();
    await sendOffscreenMessage({
      type: "CLIPS_OFFSCREEN_COPY_TEXT",
      text: recording.recordingUrl,
    });
  } catch (err) {
    console.warn("[clips-bg] could not copy recording URL", err);
    captureExtensionError(err, {
      tags: { surface: "background", recordingStep: "copy-recording-url" },
      extra: { recordingId: recording.recordingId },
    });
  }
}

function settingsFromRecording(recording: NativeRecording): ExtensionSettings {
  return {
    clipsBaseUrl: recording.clipsBaseUrl,
    captureSurface: recording.captureSurface,
    includeCamera: recording.includeCamera,
    includeMicrophone: recording.includeMicrophone,
    includeDeveloperLogs: recording.includeDeveloperLogs,
    videoDeviceId: recording.videoDeviceId ?? "",
    audioDeviceId: recording.audioDeviceId ?? "",
  };
}

function createSession(
  sessionId: string,
  tab: ChromeTab,
  settings: ExtensionSettings,
): CaptureSession {
  if (typeof tab.id === "number") {
    const existing = tabToSession.get(tab.id);
    if (existing) {
      void deleteSession(existing);
    }
  }

  const startedAtMs = nowMs();
  const session: CaptureSession = {
    sessionId,
    targetTabId: tab.id as number,
    targetTitle: tab.title?.trim() || null,
    targetUrl: tab.url?.trim() || null,
    recordingId: null,
    startedAt: new Date(startedAtMs).toISOString(),
    startedAtMs,
    includeDeveloperLogs: settings.includeDeveloperLogs,
    attached: false,
    attachError: null,
    consoleLogs: [],
    networkRequests: [],
    pendingNetworkRequests: new Map(),
  };
  sessions.set(sessionId, session);
  tabToSession.set(session.targetTabId, sessionId);
  return session;
}

async function handlePopupStart(message: PopupStartMessage) {
  const tab = await queryActiveTab();
  if (!tab || typeof tab.id !== "number") {
    return { ok: false, error: "No active tab is available to record." };
  }
  const settings = await readSettings(message.settings);
  return startRecordingFromTab({ tab, settings });
}

async function startRecordingFromTab(args: {
  tab: ChromeTab;
  settings: ExtensionSettings;
}) {
  const { tab, settings } = args;
  // The persisted value is authoritative (survives a worker suspension during
  // arming); the in-memory var is only a same-tick fast path on top of it.
  // Stale (past-TTL) or legacy-shaped guards are treated as absent — see
  // readFreshPersistedArmingSessionId.
  const persistedArmingSessionId = await readFreshPersistedArmingSessionId(
    (await sessionStorageGet(["armingNativeRecordingSessionId"]))
      .armingNativeRecordingSessionId,
  );
  if (
    activeNativeRecording ||
    armingNativeRecordingSessionId ||
    persistedArmingSessionId
  ) {
    return {
      ok: false,
      error: "Clips is already recording. Stop the active clip first.",
    };
  }
  if (typeof tab.id !== "number") {
    return { ok: false, error: "No active tab is available to record." };
  }

  const sessionId = crypto.randomUUID();
  await setArmingGuard(sessionId);
  try {
    await storageSet(settings);
    return await armRecording({ sessionId, tab, settings });
  } finally {
    if (armingNativeRecordingSessionId === sessionId) {
      await setArmingGuard(null);
    }
  }
}

async function handlePopupPreparePermissionStart(message: {
  settings?: Partial<ExtensionSettings>;
  targetTabId?: number;
}) {
  const settings = await readSettings(message.settings);
  const tab =
    typeof message.targetTabId === "number"
      ? await getTab(message.targetTabId)
      : await queryActiveTab();
  if (!tab || typeof tab.id !== "number") {
    return { ok: false, error: "No active tab is available to record." };
  }
  await writePendingPermissionStart({
    settings,
    targetTabId: tab.id,
    createdAtMs: Date.now(),
  });
  return { ok: true };
}

async function handlePermissionStartAfterGrant() {
  const pending = await readPendingPermissionStart();
  if (!pending) {
    return {
      ok: false,
      error: "Start the recording again from the Clips icon.",
    };
  }
  await clearPendingPermissionStart();
  const tab = await getTab(pending.targetTabId);
  if (!tab || typeof tab.id !== "number") {
    return { ok: false, error: "The original tab is no longer available." };
  }
  await activateTab(tab);
  return startRecordingFromTab({ tab, settings: pending.settings });
}

// Arm a Loom-style in-page recording: show the native picker, create the row,
// then hand the recorder its pre-roll delay. The MediaRecorder starts inside the
// offscreen document after that delay, which reports "recording" back here
// (markRecordingStarted) — reliable even when no overlay can be injected.
async function armRecording(args: {
  sessionId: string;
  tab: ChromeTab;
  settings: ExtensionSettings;
}) {
  const { sessionId, tab, settings } = args;
  const mode: CaptureMode =
    settings.captureSurface === "camera" ? "camera" : "screen";
  const surface: "browser" | "window" | "monitor" =
    settings.captureSurface === "camera" ? "browser" : settings.captureSurface;
  console.log("[clips-bg] arm: start", { mode, surface, tabId: tab.id });

  // Pre-warmed on popup open, so this is effectively instant and keeps the
  // getDisplayMedia() call close to the user's click.
  await ensureOffscreenDocument();

  // 1) Native "Choose what to share" picker. Do this before any network round
  //    trip so the picker stays tied to the user gesture. Throws if cancelled.
  const acq = await sendOffscreenMessage<{
    ok: boolean;
    width: number;
    height: number;
  }>({
    type: "CLIPS_OFFSCREEN_ACQUIRE",
    sessionId,
    mode,
    surface,
    includeMicrophone: settings.includeMicrophone,
    includeCamera: settings.includeCamera,
    videoDeviceId: settings.videoDeviceId,
    audioDeviceId: settings.audioDeviceId,
  });
  console.log("[clips-bg] arm: acquired stream", acq);

  // 2) Show the countdown overlay IMMEDIATELY — before the network round-trip —
  //    so the 3-2-1 runs full-length and the dim/blur clears exactly when the
  //    recorder starts. The on-page bubble shows during countdown AND recording
  //    (the face is captured in the display; we do not composite).
  const cameraInvolved = mode === "camera" || settings.includeCamera;
  overlayPhase = "countdown";
  overlayBaseElapsedMs = 0;
  overlayBaseEpochMs = nowMs();
  overlayShowsBubble = cameraInvolved;
  recordingShowsBubble = cameraInvolved;
  countdownEndsAtMs = nowMs() + COUNTDOWN_SECONDS * 1000;
  // The recording overlay now owns this tab's bubble — hand off from any preview
  // so the popup-close disconnect won't tear down the live recording overlay.
  previewTabId = null;
  setRecordingFlag(true);
  // Clicking the icon now stops & saves immediately instead of opening the popup.
  setActionPopup("");
  overlayTabId = tab.id as number;
  await mountOverlayOnTab(tab.id as number);
  broadcastOverlayState();

  const abortArming = async (): Promise<void> => {
    await sendOffscreenMessage({
      type: "CLIPS_OFFSCREEN_CANCEL",
      sessionId,
    }).catch(() => undefined);
    resetOverlay();
    await broadcastUnmount();
    await chrome.action.setBadgeText({ text: "" });
  };

  // 3) Create the recording row (happens during the countdown).
  type CreatedRecording = {
    id?: string;
    uploadChunkUrl?: string;
    abortUrl?: string;
    uploadMode?: UploadMode;
  };
  let created: CreatedRecording;
  try {
    created = await postAction<CreatedRecording>(settings, "create-recording", {
      title: tab.title || "Untitled recording",
      titleSource: tab.title ? "context" : "default",
      sourceAppName: "Chrome",
      sourceWindowTitle: tab.title ?? null,
      hasCamera: cameraInvolved,
      hasAudio:
        settings.includeMicrophone || settings.captureSurface !== "camera",
      visibility: "public",
      mimeType: "video/webm",
      requestStreaming: true,
    });
  } catch (err) {
    captureExtensionError(err, {
      tags: {
        surface: "background",
        recordingStep: "create-recording",
      },
      extra: {
        captureSurface: settings.captureSurface,
        includeCamera: settings.includeCamera,
        includeMicrophone: settings.includeMicrophone,
      },
    });
    await abortArming();
    throw err;
  }
  if (!created.id || !created.uploadChunkUrl) {
    await abortArming();
    throw new Error("Clips did not create a recording target.");
  }

  const uploadUrl = `${settings.clipsBaseUrl}${created.uploadChunkUrl}`;
  const session = createSession(sessionId, tab, settings);
  session.recordingId = created.id;

  activeNativeRecording = {
    sessionId,
    recordingId: created.id,
    clipsBaseUrl: settings.clipsBaseUrl,
    uploadUrl,
    uploadMode: created.uploadMode ?? "buffered",
    targetTabId: tab.id as number,
    targetTitle: tab.title?.trim() || null,
    targetUrl: tab.url?.trim() || null,
    startedAt: new Date().toISOString(),
    startedAtMs: nowMs(),
    captureSurface: settings.captureSurface,
    includeCamera: settings.includeCamera,
    includeMicrophone: settings.includeMicrophone,
    includeDeveloperLogs: settings.includeDeveloperLogs,
    videoDeviceId: settings.videoDeviceId,
    audioDeviceId: settings.audioDeviceId,
    status: "recording",
    recordingUrl: `${settings.clipsBaseUrl}/r/${encodeURIComponent(created.id)}`,
    error: null,
  };

  // 4) Start the recorder when the (already-running) countdown ends. The
  //    offscreen owns the pre-roll timer (a reliable context, unlike the
  //    suspendable worker) and reports "recording" back when it actually starts.
  const authToken = (await readAuthSession(settings))?.token;
  console.log("[clips-bg] arm: created row", created.id, "auth?", !!authToken);
  // The on-page countdown drives the actual start (it sends COUNTDOWN_DONE at
  // "Go"). This offscreen timer is only a FALLBACK. When a camera is involved the
  // countdown waits for the camera feed before it even shows "3" (the content
  // script holds it, with its own 12s cap), so the fallback must be generous
  // enough not to start the recorder mid-connect; otherwise a short pre-roll.
  const startDelayMs = cameraInvolved ? 20000 : COUNTDOWN_SECONDS * 1000 + 1000;
  try {
    await sendOffscreenMessage({
      type: "CLIPS_OFFSCREEN_BEGIN",
      sessionId,
      recordingId: created.id,
      uploadUrl,
      uploadMode: created.uploadMode ?? "buffered",
      hasCamera: cameraInvolved,
      startDelayMs,
      authToken,
    });
  } catch (err) {
    console.error("[clips-bg] arm: BEGIN failed", err);
    captureExtensionError(err, {
      tags: {
        surface: "background",
        recordingStep: "offscreen-begin",
      },
      extra: {
        recordingId: created.id,
        captureSurface: settings.captureSurface,
        includeCamera: settings.includeCamera,
        includeMicrophone: settings.includeMicrophone,
      },
    });
    await cancelRecording();
    throw err;
  }
  await saveActiveNativeRecording();

  // Browser-tab diagnostics still attach to the launch tab only.
  if (settings.captureSurface === "browser") {
    await attachSession(session);
  }

  broadcastOverlayState();
  await chrome.action.setBadgeBackgroundColor({ color: "#e11d48" });
  await chrome.action.setBadgeText({ text: "REC" });
  console.log("[clips-bg] arm: done — countdown, parts:", desiredParts());

  return { ok: true, sessionId, recordingId: created.id, native: true };
}

// Called when the offscreen recorder reports it actually started (after its
// pre-roll countdown). Advances phase countdown -> recording and starts the
// on-page timer. Idempotent.
async function markRecordingStarted() {
  if (overlayPhase !== "countdown") return;
  console.log("[clips-bg] recorder started → phase=recording");
  clearCountdownTimer();
  overlayPhase = "recording";
  overlayBaseElapsedMs = 0;
  overlayBaseEpochMs = nowMs();
  if (activeNativeRecording) {
    activeNativeRecording.startedAtMs = overlayBaseEpochMs;
    activeNativeRecording.startedAt = new Date(
      overlayBaseEpochMs,
    ).toISOString();
    activeNativeRecording.status = "recording";
    await saveActiveNativeRecording();
  }
  await broadcastMount();
  broadcastOverlayState();
}

// Skip the pre-roll: tell the offscreen recorder to start immediately. It will
// report "recording", which flips our phase via markRecordingStarted.
async function handleOverlaySkip() {
  if (overlayPhase !== "countdown" || !activeNativeRecording) {
    return { ok: true };
  }
  await sendOffscreenMessage({
    type: "CLIPS_OFFSCREEN_START_NOW",
    sessionId: activeNativeRecording.sessionId,
  }).catch(() => undefined);
  return { ok: true };
}

function handleOverlayPause() {
  if (overlayPhase !== "recording") return { ok: true };
  overlayBaseElapsedMs += Math.max(0, nowMs() - overlayBaseEpochMs);
  overlayPhase = "paused";
  if (activeNativeRecording) {
    activeNativeRecording.status = "paused";
    void saveActiveNativeRecording();
    void sendOffscreenMessage({
      type: "CLIPS_OFFSCREEN_PAUSE",
      sessionId: activeNativeRecording.sessionId,
    }).catch(() => undefined);
  }
  broadcastOverlayState();
  return { ok: true };
}

function handleOverlayResume() {
  if (overlayPhase !== "paused") return { ok: true };
  overlayBaseEpochMs = nowMs();
  overlayPhase = "recording";
  if (activeNativeRecording) {
    activeNativeRecording.status = "recording";
    void saveActiveNativeRecording();
    void sendOffscreenMessage({
      type: "CLIPS_OFFSCREEN_RESUME",
      sessionId: activeNativeRecording.sessionId,
    }).catch(() => undefined);
  }
  broadcastOverlayState();
  return { ok: true };
}

// Restart: discard the in-progress capture but keep the same screen selection,
// reset the server-side chunks, then replay the countdown.
async function handleOverlayRestart() {
  const recording = activeNativeRecording;
  if (!recording) return { ok: true };
  try {
    await sendOffscreenMessage({
      type: "CLIPS_OFFSCREEN_RESTART",
      sessionId: recording.sessionId,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not restart.",
    };
  }
  // If the previous take's chunks could not be cleared, do NOT re-arm with the
  // same recordingId — finalize would otherwise assemble stale chunk keys from
  // the aborted take into the restarted recording. Surface the failure instead.
  // CLIPS_OFFSCREEN_RESTART above already cleared the offscreen's active
  // recording (it only holds the raw source streams in a "prepared" slot now),
  // so we must not leave the overlay stuck mid-recording/paused with no
  // recorder behind it — tear the overlay back down and release those streams,
  // matching the re-arm failure handling just below.
  const chunksReset = await resetRecordingChunks(recording);
  if (!chunksReset) {
    recording.status = "error";
    recording.error =
      "Could not clear the previous take before restarting. Stop and start a new recording.";
    await sendOffscreenMessage({
      type: "CLIPS_OFFSCREEN_CANCEL",
      sessionId: recording.sessionId,
    }).catch(() => undefined);
    resetOverlay();
    await saveActiveNativeRecording();
    await broadcastUnmount();
    broadcastOverlayState();
    return {
      ok: false,
      error: recording.error,
    };
  }
  overlayPhase = "countdown";
  overlayBaseElapsedMs = 0;
  overlayBaseEpochMs = nowMs();
  countdownEndsAtMs = nowMs() + COUNTDOWN_SECONDS * 1000;
  const cameraInvolved =
    recording.captureSurface === "camera" || recording.includeCamera;
  overlayShowsBubble = cameraInvolved;
  recordingShowsBubble = cameraInvolved;
  recording.status = "recording";
  const restartAuthToken = (
    await readAuthSession(settingsFromRecording(recording))
  )?.token;
  // Re-arm the recorder on the same (re-homed) source streams with a fresh
  // pre-roll. The offscreen reports "recording" when it restarts.
  try {
    await sendOffscreenMessage({
      type: "CLIPS_OFFSCREEN_BEGIN",
      sessionId: recording.sessionId,
      recordingId: recording.recordingId,
      uploadUrl: recording.uploadUrl,
      uploadMode: recording.uploadMode ?? "buffered",
      hasCamera: cameraInvolved,
      startDelayMs: cameraInvolved ? 20000 : COUNTDOWN_SECONDS * 1000 + 1000,
      authToken: restartAuthToken,
    });
  } catch (err) {
    // Re-arming failed: tear the countdown overlay back down and report the
    // failure instead of leaving the user on a pre-roll with no recorder.
    recording.status = "error";
    recording.error =
      err instanceof Error ? err.message : "Could not restart the recorder.";
    resetOverlay();
    await saveActiveNativeRecording();
    await broadcastUnmount();
    broadcastOverlayState();
    return { ok: false, error: recording.error };
  }
  await saveActiveNativeRecording();
  await broadcastMount();
  broadcastOverlayState();
  return { ok: true };
}

async function resetRecordingChunks(
  recording: NativeRecording,
): Promise<boolean> {
  const url = `${recording.clipsBaseUrl}/api/uploads/${encodeURIComponent(
    recording.recordingId,
  )}/reset-chunks`;
  const headers = await authHeaders(settingsFromRecording(recording));
  const response = await fetch(url, {
    method: "POST",
    headers,
    credentials: "include",
    cache: "no-store",
  }).catch(() => undefined);
  return Boolean(response?.ok);
}

// Finalize a successful save: open the clip and tear down the "Saving…" overlay.
// Guarded + claims the phase synchronously so it runs exactly once even if both
// the STOP response and the offscreen "complete" status race to call it (the
// latter is the safety net when the worker was suspended mid-upload).
async function finishSaving(
  recording: NativeRecording,
  recordingIdFromStatus?: string,
): Promise<boolean> {
  if (overlayPhase !== "saving") return false;
  resetOverlay(); // first statement sets overlayPhase = "idle" synchronously
  recording.status = "complete";
  recording.error = null;
  if (recordingIdFromStatus) recording.recordingId = recordingIdFromStatus;
  recording.recordingUrl = recordingUrl(recording);
  await saveNativeDiagnostics(recording);
  await deleteSession(recording.sessionId);
  await broadcastUnmount();
  broadcastOverlayState();
  await copyRecordingUrlToClipboard(recording);
  await clearNativeRecording();
  await createTab(recording.recordingUrl);
  return true;
}

async function stopRecording() {
  const recording = activeNativeRecording;
  console.log("[clips-bg] stopRecording — active:", !!recording);
  if (!recording) return { ok: false, error: "No active Clips recording." };
  recording.status = "stopping";
  // Keep an overlay up: swap the recording controls/bubble for a "Saving…" card
  // so the user has feedback during the upload gap (instead of everything
  // vanishing while the clip uploads invisibly). Mirrors the desktop Finalizing
  // overlay. The popup stays disabled so the icon can't interrupt the save.
  overlayPhase = "saving";
  countdownEndsAtMs = 0;
  await saveActiveNativeRecording();
  await broadcastMount();
  broadcastOverlayState();
  try {
    const response = await sendOffscreenMessage<{
      ok?: boolean;
      result?: Record<string, unknown>;
    }>({
      type: "CLIPS_OFFSCREEN_STOP",
      sessionId: recording.sessionId,
    });
    if (response.result && response.result.status === "cancelled") {
      // Stopped during the pre-roll countdown: no media was captured. Treat it
      // as an aborted take — discard the empty recording instead of opening a
      // playback tab for a finished-but-empty clip.
      await deleteSession(recording.sessionId);
      await postAction(settingsFromRecording(recording), "trash-recording", {
        id: recording.recordingId,
      }).catch(() => undefined);
      resetOverlay();
      await broadcastUnmount();
      broadcastOverlayState();
      await clearNativeRecording();
      return { ok: true, cancelled: true };
    }
    const recordingId =
      response.result && typeof response.result.recordingId === "string"
        ? response.result.recordingId
        : undefined;
    await finishSaving(recording, recordingId);
    return {
      ok: true,
      recordingId: recording.recordingId,
      recordingUrl: recording.recordingUrl,
    };
  } catch (err) {
    recording.status = "error";
    recording.error = friendlyRecordingError(
      err instanceof Error ? err.message : null,
    );
    resetOverlay();
    await broadcastUnmount();
    broadcastOverlayState();
    await saveActiveNativeRecording();
    return { ok: false, error: recording.error };
  }
}

async function cancelRecording() {
  const recording = activeNativeRecording;
  resetOverlay();
  await broadcastUnmount();
  broadcastOverlayState();
  await chrome.action.setBadgeText({ text: "" });
  if (!recording) {
    await clearNativeRecording();
    return { ok: true };
  }
  await sendOffscreenMessage({
    type: "CLIPS_OFFSCREEN_CANCEL",
    sessionId: recording.sessionId,
  }).catch(() => undefined);
  await deleteSession(recording.sessionId);
  await postAction(settingsFromRecording(recording), "trash-recording", {
    id: recording.recordingId,
  }).catch(() => undefined);
  await clearNativeRecording();
  return { ok: true };
}

async function saveNativeDiagnostics(
  recording: NativeRecording,
): Promise<void> {
  if (!recording.includeDeveloperLogs) return;
  const session = sessions.get(recording.sessionId);
  if (!session) return;
  const diagnostics = snapshotSession(session);
  await postAction(
    settingsFromRecording(recording),
    "save-browser-diagnostics",
    {
      recordingId: recording.recordingId,
      sessionId: recording.sessionId,
      source: "extension",
      phase: "recording",
      pageUrl: diagnostics.pageUrl,
      userAgent: diagnostics.userAgent,
      startedAt: diagnostics.startedAt,
      endedAt: diagnostics.endedAt,
      consoleLogs: diagnostics.consoleLogs,
      networkRequests: diagnostics.networkRequests,
    },
  ).catch((err) => {
    console.warn("[clips-extension] diagnostics save failed:", err);
  });
}

async function clearNativeRecording(): Promise<void> {
  activeNativeRecording = null;
  await saveActiveNativeRecording();
  await chrome.action.setBadgeText({ text: "" });
}

async function handlePopupStatus() {
  return {
    ok: true,
    activeRecording: activeNativeRecording,
    arming: Boolean(armingNativeRecordingSessionId),
  };
}

async function handlePopupStop() {
  return stopRecording();
}

async function handlePopupCancel() {
  return cancelRecording();
}

async function handlePopupOpen() {
  const recording = activeNativeRecording;
  if (!recording) return { ok: false, error: "No active recording." };
  await createTab(recording.recordingUrl);
  return { ok: true };
}

async function handlePopupSignIn(message: {
  settings?: Partial<ExtensionSettings>;
}) {
  const settings = await readSettings(message.settings);
  await storageSet(settings);
  const signInUrl = new URL(`${settings.clipsBaseUrl}/library`);
  signInUrl.searchParams.set("clipsExtensionAuth", "1");
  signInUrl.searchParams.set("clipsExtensionId", chrome.runtime.id);
  await createTab(signInUrl.toString());
  return { ok: true };
}

function summarize(snapshot: {
  endedAt: string;
  consoleLogs: ConsoleLog[];
  networkRequests: NetworkRequest[];
}): BrowserDiagnosticsData["summary"] {
  return {
    consoleCount: snapshot.consoleLogs.length,
    consoleErrorCount: snapshot.consoleLogs.filter(
      (entry) => entry.level === "error",
    ).length,
    consoleWarnCount: snapshot.consoleLogs.filter(
      (entry) => entry.level === "warn",
    ).length,
    networkCount: snapshot.networkRequests.length,
    networkFailureCount: snapshot.networkRequests.filter(
      (entry) =>
        Boolean(entry.error) ||
        (typeof entry.status === "number" && entry.status >= 400),
    ).length,
    capturedAt: snapshot.endedAt || null,
  };
}

function pendingNetworkSnapshot(session: CaptureSession): NetworkRequest[] {
  const endedAtMs = nowMs();
  return Array.from(session.pendingNetworkRequests.values()).map((entry) => ({
    timestampMs: entry.timestampMs,
    elapsedMs: entry.elapsedMs,
    type: entry.type,
    method: entry.method,
    url: entry.url,
    ...(typeof entry.status === "number" ? { status: entry.status } : {}),
    ...(entry.statusText ? { statusText: entry.statusText } : {}),
    ...(typeof entry.ok === "boolean" ? { ok: entry.ok } : {}),
    durationMs: Math.max(0, endedAtMs - entry.timestampMs),
    ...(entry.error ? { error: entry.error } : {}),
  }));
}

function snapshotSession(session: CaptureSession): BrowserDiagnosticsData {
  const endedAt = nowIso();
  const consoleLogs = session.consoleLogs.slice(-MAX_CONSOLE_LOGS);
  const networkRequests = [
    ...session.networkRequests,
    ...pendingNetworkSnapshot(session),
  ].slice(-MAX_NETWORK_REQUESTS);
  return {
    pageUrl: sanitizeUrl(session.targetUrl),
    userAgent:
      typeof navigator === "undefined"
        ? "Chrome extension"
        : navigator.userAgent,
    startedAt: session.startedAt,
    endedAt,
    consoleLogs,
    networkRequests,
    summary: summarize({ endedAt, consoleLogs, networkRequests }),
  };
}

async function attachSession(session: CaptureSession): Promise<void> {
  if (!session.includeDeveloperLogs || session.attached) return;
  try {
    await debuggerAttach(session.targetTabId);
    session.attached = true;
    tabToSession.set(session.targetTabId, session.sessionId);
    await Promise.allSettled([
      debuggerSendCommand(session.targetTabId, "Runtime.enable"),
      debuggerSendCommand(session.targetTabId, "Log.enable"),
      debuggerSendCommand(session.targetTabId, "Network.enable", {
        maxTotalBufferSize: 0,
        maxResourceBufferSize: 0,
        maxPostDataSize: 0,
      }),
    ]);
  } catch (err) {
    session.attachError =
      err instanceof Error ? err.message : "Could not attach to the tab.";
    pushConsole(session, {
      level: "warn",
      message: `Clips could not attach browser diagnostics: ${session.attachError}`,
    });
  }
}

async function detachSession(session: CaptureSession): Promise<void> {
  if (session.attached) {
    await debuggerDetach(session.targetTabId);
  }
  session.attached = false;
  tabToSession.delete(session.targetTabId);
}

async function deleteSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  await detachSession(session);
  sessions.delete(sessionId);
}

function pushConsole(
  session: CaptureSession,
  entry: {
    level: ConsoleLevel;
    message: string;
    stack?: string | null;
    timestampMs?: number | null;
  },
): void {
  const timestampMs = Number.isFinite(entry.timestampMs)
    ? (entry.timestampMs as number)
    : nowMs();
  const message = truncate(
    redactString(entry.message, { redactQueryValues: true }),
    MAX_MESSAGE_LENGTH,
  );
  const stack = entry.stack
    ? truncate(
        redactString(entry.stack, { redactQueryValues: true }),
        MAX_MESSAGE_LENGTH,
      )
    : "";
  session.consoleLogs.push({
    timestampMs,
    elapsedMs: Math.max(0, timestampMs - session.startedAtMs),
    level: entry.level,
    message,
    ...(stack ? { stack } : {}),
  });
  if (session.consoleLogs.length > MAX_CONSOLE_LOGS) {
    session.consoleLogs.splice(
      0,
      session.consoleLogs.length - MAX_CONSOLE_LOGS,
    );
  }
}

function pushNetwork(session: CaptureSession, entry: NetworkRequest): void {
  session.networkRequests.push(entry);
  if (session.networkRequests.length > MAX_NETWORK_REQUESTS) {
    session.networkRequests.splice(
      0,
      session.networkRequests.length - MAX_NETWORK_REQUESTS,
    );
  }
}

function consoleLevel(value: unknown): ConsoleLevel {
  if (
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error"
  ) {
    return value;
  }
  return "log";
}

function safeJson(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function remoteObjectText(value: unknown): string {
  if (!value || typeof value !== "object") return String(value);
  const object = value as Record<string, unknown>;
  if ("value" in object) {
    const primitive = object.value;
    return typeof primitive === "string"
      ? primitive
      : (safeJson(primitive) ?? String(primitive));
  }
  if (typeof object.unserializableValue === "string") {
    return object.unserializableValue;
  }
  if (typeof object.description === "string") {
    return object.description;
  }
  if (typeof object.type === "string") {
    return `<${object.type}>`;
  }
  return "<value>";
}

function stackTraceText(stackTrace: unknown): string | null {
  if (!stackTrace || typeof stackTrace !== "object") return null;
  const frames = (stackTrace as { callFrames?: unknown }).callFrames;
  if (!Array.isArray(frames)) return null;
  const lines = frames
    .map((frame) => {
      if (!frame || typeof frame !== "object") return null;
      const item = frame as Record<string, unknown>;
      const fn =
        typeof item.functionName === "string" && item.functionName.trim()
          ? item.functionName
          : "(anonymous)";
      const url = typeof item.url === "string" ? item.url : "";
      const line =
        typeof item.lineNumber === "number" ? item.lineNumber + 1 : null;
      const column =
        typeof item.columnNumber === "number" ? item.columnNumber + 1 : null;
      return `${fn} (${url}${line !== null ? `:${line}` : ""}${
        column !== null ? `:${column}` : ""
      })`;
    })
    .filter((line): line is string => Boolean(line));
  return lines.length ? lines.join("\n") : null;
}

function handleConsoleEvent(session: CaptureSession, params: unknown): void {
  if (!params || typeof params !== "object") return;
  const event = params as Record<string, unknown>;
  const args = Array.isArray(event.args) ? event.args : [];
  const message = args.map(remoteObjectText).join(" ");
  if (!message) return;
  pushConsole(session, {
    level: consoleLevel(event.type),
    message,
    stack: stackTraceText(event.stackTrace),
    timestampMs:
      typeof event.timestamp === "number" ? event.timestamp : undefined,
  });
}

function handleExceptionEvent(session: CaptureSession, params: unknown): void {
  if (!params || typeof params !== "object") return;
  const details = (params as { exceptionDetails?: unknown }).exceptionDetails;
  if (!details || typeof details !== "object") return;
  const item = details as Record<string, unknown>;
  const exception = item.exception as Record<string, unknown> | undefined;
  const description =
    (typeof exception?.description === "string" && exception.description) ||
    (typeof exception?.value === "string" && exception.value) ||
    (typeof item.text === "string" && item.text) ||
    "Unhandled exception";
  pushConsole(session, {
    level: "error",
    message: description,
    stack: stackTraceText(item.stackTrace),
  });
}

function handleLogEntryEvent(session: CaptureSession, params: unknown): void {
  if (!params || typeof params !== "object") return;
  const entry = (params as { entry?: unknown }).entry;
  if (!entry || typeof entry !== "object") return;
  const item = entry as Record<string, unknown>;
  const text = typeof item.text === "string" ? item.text : "";
  if (!text) return;
  const source = typeof item.source === "string" ? `${item.source}: ` : "";
  pushConsole(session, {
    level: consoleLevel(item.level),
    message: `${source}${text}`,
    timestampMs:
      typeof item.timestamp === "number" ? item.timestamp : undefined,
  });
}

function trackedNetworkType(value: unknown): NetworkType | null {
  if (value === "XHR") return "xhr";
  if (value === "Fetch") return "fetch";
  return null;
}

function requestTimestampMs(params: Record<string, unknown>): number {
  return typeof params.wallTime === "number"
    ? Math.round(params.wallTime * 1000)
    : nowMs();
}

function handleRequestWillBeSent(
  session: CaptureSession,
  params: unknown,
): void {
  if (!params || typeof params !== "object") return;
  const event = params as Record<string, unknown>;
  const type = trackedNetworkType(event.type);
  const requestId =
    typeof event.requestId === "string" ? event.requestId : null;
  const request =
    event.request && typeof event.request === "object"
      ? (event.request as Record<string, unknown>)
      : null;
  if (!type || !requestId || !request) return;
  const timestampMs = requestTimestampMs(event);
  const url = sanitizeUrl(typeof request.url === "string" ? request.url : "");
  if (!url) return;
  session.pendingNetworkRequests.set(requestId, {
    requestId,
    timestampMs,
    elapsedMs: Math.max(0, timestampMs - session.startedAtMs),
    startedAtMonotonicSeconds:
      typeof event.timestamp === "number" ? event.timestamp : null,
    type,
    method:
      typeof request.method === "string"
        ? truncate(request.method.toUpperCase(), 24)
        : "GET",
    url,
  });
}

function handleResponseReceived(
  session: CaptureSession,
  params: unknown,
): void {
  if (!params || typeof params !== "object") return;
  const event = params as Record<string, unknown>;
  const requestId =
    typeof event.requestId === "string" ? event.requestId : null;
  if (!requestId) return;
  const pending = session.pendingNetworkRequests.get(requestId);
  if (!pending) return;
  const response =
    event.response && typeof event.response === "object"
      ? (event.response as Record<string, unknown>)
      : null;
  if (!response) return;
  if (typeof response.status === "number") {
    pending.status = Math.round(response.status);
    pending.ok = response.status >= 200 && response.status < 400;
  }
  if (typeof response.statusText === "string") {
    pending.statusText = truncate(
      redactString(response.statusText, { redactQueryValues: true }),
      120,
    );
  }
}

function finalizeNetworkRequest(
  session: CaptureSession,
  requestId: string,
  params: Record<string, unknown>,
  error?: string,
): void {
  const pending = session.pendingNetworkRequests.get(requestId);
  if (!pending) return;
  session.pendingNetworkRequests.delete(requestId);
  const monotonicEnd =
    typeof params.timestamp === "number" ? params.timestamp : null;
  const durationMs =
    monotonicEnd !== null && pending.startedAtMonotonicSeconds !== null
      ? Math.max(0, (monotonicEnd - pending.startedAtMonotonicSeconds) * 1000)
      : Math.max(0, nowMs() - pending.timestampMs);
  pushNetwork(session, {
    timestampMs: pending.timestampMs,
    elapsedMs: pending.elapsedMs,
    type: pending.type,
    method: pending.method,
    url: pending.url,
    ...(typeof pending.status === "number" ? { status: pending.status } : {}),
    ...(pending.statusText ? { statusText: pending.statusText } : {}),
    ...(typeof pending.ok === "boolean" ? { ok: pending.ok } : {}),
    durationMs: Math.round(durationMs),
    ...(error
      ? {
          error: truncate(
            redactString(error, { redactQueryValues: true }),
            MAX_MESSAGE_LENGTH,
          ),
        }
      : {}),
  });
}

function handleLoadingFinished(session: CaptureSession, params: unknown): void {
  if (!params || typeof params !== "object") return;
  const event = params as Record<string, unknown>;
  const requestId =
    typeof event.requestId === "string" ? event.requestId : null;
  if (requestId) finalizeNetworkRequest(session, requestId, event);
}

function handleLoadingFailed(session: CaptureSession, params: unknown): void {
  if (!params || typeof params !== "object") return;
  const event = params as Record<string, unknown>;
  const requestId =
    typeof event.requestId === "string" ? event.requestId : null;
  const errorText =
    typeof event.errorText === "string" ? event.errorText : "Request failed";
  if (requestId) finalizeNetworkRequest(session, requestId, event, errorText);
}

async function handleExternalMessage(
  message: ExternalMessage,
  sender?: chrome.runtime.MessageSender,
) {
  if (!message || typeof message !== "object") {
    return { ok: false, error: "Invalid message." };
  }

  if (message.type === "CLIPS_AUTH_SESSION") {
    const settings = await readSettings();
    const clipsBaseUrl = normalizeBaseUrl(
      message.clipsBaseUrl ?? settings.clipsBaseUrl,
    );
    const senderOrigin = originOf(sender?.url);
    if (!senderOrigin || senderOrigin !== originOf(clipsBaseUrl)) {
      return { ok: false, error: "Auth message came from the wrong origin." };
    }
    if (typeof message.token !== "string" || !message.token.trim()) {
      return { ok: false, error: "Missing auth token." };
    }
    await storageSet({ ...settings, clipsBaseUrl });
    await saveAuthSession({
      token: message.token,
      email: typeof message.email === "string" ? message.email : undefined,
      clipsBaseUrl,
      savedAt: nowIso(),
    });
    return { ok: true };
  }

  if (message.type === "CLIPS_CAPTURE_START") {
    if (!message.sessionId) return { ok: false, error: "Missing sessionId." };
    const session = sessions.get(message.sessionId);
    if (!session) return { ok: false, error: "Capture session not found." };
    session.recordingId = message.recordingId ?? null;
    session.startedAtMs = nowMs();
    session.startedAt = new Date(session.startedAtMs).toISOString();
    session.consoleLogs = [];
    session.networkRequests = [];
    session.pendingNetworkRequests.clear();
    await attachSession(session);
    return {
      ok: true,
      attached: session.attached,
      developerLogs: session.includeDeveloperLogs,
      attachError: session.attachError,
    };
  }

  if (message.type === "CLIPS_CAPTURE_STOP") {
    if (!message.sessionId) return { ok: false, error: "Missing sessionId." };
    const session = sessions.get(message.sessionId);
    if (!session) return { ok: false, error: "Capture session not found." };
    session.recordingId = message.recordingId ?? session.recordingId;
    const diagnostics = snapshotSession(session);
    await deleteSession(message.sessionId);
    return { ok: true, diagnostics };
  }

  if (message.type === "CLIPS_CAPTURE_CANCEL") {
    if (message.sessionId) await deleteSession(message.sessionId);
    return { ok: true };
  }

  return { ok: false, error: "Unknown message." };
}

chrome.runtime.onInstalled.addListener((details) => {
  void readSettings().then((settings) => storageSet(settings));
  // Ask for camera/mic once on install so the grant is ready before the first
  // recording (the record-time gate in the popup is the fallback).
  if (details.reason === "install") {
    void createTab(chrome.runtime.getURL("src/permission.html")).catch(
      () => undefined,
    );
  }
});

// Restore recording/overlay state whenever the service worker (re)starts so an
// in-progress recording survives MV3 worker suspension. Memoized so every entry
// point can `await ensureRestored()` before reading activeNativeRecording — the
// worker can be revived by the very event (icon click, status message) that
// needs the state, and the module globals start out empty until restore runs.
let restorePromise: Promise<void> | null = null;
function ensureRestored(): Promise<void> {
  if (!restorePromise) {
    restorePromise = restoreRuntimeState().catch(() => undefined);
  }
  return restorePromise;
}
void ensureRestored();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  void (async () => {
    // Critical: never read activeNativeRecording/overlayPhase before state is
    // restored, or a freshly-woken worker drops the message (e.g. the offscreen
    // "recording" status, or an overlay Stop click).
    await ensureRestored();
    let response: unknown;
    try {
      response = await dispatchRuntimeMessage(message);
    } catch (err) {
      console.error(
        "[clips-bg] message failed:",
        (message as { type?: unknown })?.type,
        err,
      );
      captureExtensionError(err, {
        tags: {
          surface: "background",
          messageType: String((message as { type?: unknown })?.type ?? ""),
        },
      });
      response = {
        ok: false,
        error: err instanceof Error ? err.message : "Could not use Clips.",
      };
    }
    try {
      sendResponse(response);
    } catch {
      /* message port already closed (fire-and-forget sender) */
    }
  })();
  return true;
});

async function dispatchRuntimeMessage(message: unknown): Promise<unknown> {
  const type = (message as { type?: unknown }).type;

  if (type === "CLIPS_EXTENSION_ERROR") {
    const report = message as ExtensionErrorMessage;
    const error = new Error(report.message || "Chrome extension error");
    error.name = report.name || "ExtensionError";
    if (report.stack) error.stack = report.stack;
    captureExtensionError(error, {
      tags: {
        surface: report.surface || "content-script",
        mechanism: "content-script-report",
      },
      extra: report.context,
    });
    return { ok: true };
  }

  // The offscreen recorder asks us to save a recording to disk when its upload
  // fails (storage not connected, network drop, size cap), so the recording is
  // never lost. The offscreen document holds the blob URL alive until its next
  // acquire(); we only need the download to be accepted, not fully written.
  if (type === "CLIPS_SAVE_RECORDING_TO_DISK") {
    const { url, filename } = message as { url?: string; filename?: string };
    if (typeof url !== "string" || !url) {
      return { ok: false, error: "Missing recording URL." };
    }
    try {
      const options: chrome.downloads.DownloadOptions = {
        url,
        saveAs: false,
        conflictAction: "uniquify",
      };
      if (typeof filename === "string" && filename) options.filename = filename;
      const downloadId = await chrome.downloads.download(options);
      return { ok: typeof downloadId === "number" && downloadId >= 0 };
    } catch (err) {
      console.error("[clips-bg] save-to-disk download failed", err);
      captureExtensionError(err, {
        tags: { surface: "background", messageType: type },
      });
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Download failed.",
      };
    }
  }

  // Status updates streamed from the offscreen recorder.
  if (type === "CLIPS_NATIVE_STATUS") {
    const status = message as OffscreenStatusMessage;
    console.log(
      "[clips-bg] status:",
      status.status,
      status.error ?? "",
      "phase:",
      overlayPhase,
    );
    if (
      activeNativeRecording &&
      activeNativeRecording.sessionId === status.sessionId
    ) {
      activeNativeRecording.status = status.status;
      activeNativeRecording.error =
        typeof status.error === "string"
          ? status.storageSetupRequired === true ||
            isStorageSetupFailureMessage(status.error)
            ? STORAGE_SETUP_REQUIRED_MESSAGE
            : status.error
          : null;
      if (typeof status.recordingId === "string") {
        activeNativeRecording.recordingId = status.recordingId;
        activeNativeRecording.recordingUrl = recordingUrl(
          activeNativeRecording,
        );
      }
      if (status.status === "error") {
        activeNativeRecording.savedToDisk = status.savedToDisk === true;
        activeNativeRecording.savedFilename =
          typeof status.savedFilename === "string"
            ? status.savedFilename
            : undefined;
      }
      await saveActiveNativeRecording();
      // The offscreen recorder finished its pre-roll and actually started —
      // advance from countdown to recording (the reliable phase flip).
      if (status.status === "recording" && overlayPhase === "countdown") {
        await markRecordingStarted();
      }
      // Safety net: if the worker was suspended during the upload, stopRecording's
      // await was lost — finalize here when the offscreen reports completion.
      if (status.status === "complete" && overlayPhase === "saving") {
        await finishSaving(
          activeNativeRecording,
          typeof status.recordingId === "string"
            ? status.recordingId
            : undefined,
        );
      }
      if (status.status === "error") {
        resetOverlay();
        await broadcastUnmount();
        await chrome.action.setBadgeText({ text: "" });
      }
    }
    return { ok: true };
  }

  // The user stopped sharing from Chrome's native control bar.
  if (type === "CLIPS_NATIVE_ENDED") {
    const sessionId = (message as { sessionId?: string }).sessionId;
    if (
      activeNativeRecording &&
      activeNativeRecording.sessionId === sessionId &&
      overlayPhase !== "idle" &&
      overlayPhase !== "saving"
    ) {
      return stopRecording();
    }
    return { ok: true };
  }

  // Content script asking which overlay parts to show on its page.
  if (type === "CLIPS_CONTENT_HELLO") {
    return { ok: true, parts: desiredParts() };
  }

  // Overlay iframe handshake — rebroadcast the current timer/phase to it.
  if (type === "CLIPS_OVERLAY_HELLO") {
    broadcastOverlayState();
    return { ok: true, state: overlayStateForBroadcast() };
  }

  if (type === "CLIPS_PREWARM") {
    void ensureOffscreenDocument().catch(() => undefined);
    return { ok: true };
  }

  if (type === "CLIPS_PREVIEW") {
    await startPreview(Boolean((message as { camera?: unknown }).camera));
    return { ok: true };
  }

  switch (type) {
    case "CLIPS_POPUP_START":
      return handlePopupStart(message as PopupStartMessage);
    case "CLIPS_POPUP_STATUS":
      return handlePopupStatus();
    case "CLIPS_POPUP_STOP":
      return handlePopupStop();
    case "CLIPS_POPUP_CANCEL":
      return handlePopupCancel();
    case "CLIPS_POPUP_OPEN":
      return handlePopupOpen();
    case "CLIPS_POPUP_SIGN_IN":
      return handlePopupSignIn(
        message as { settings?: Partial<ExtensionSettings> },
      );
    case "CLIPS_POPUP_PREPARE_PERMISSION_START":
      return handlePopupPreparePermissionStart(
        message as {
          settings?: Partial<ExtensionSettings>;
          targetTabId?: number;
        },
      );
    case "CLIPS_PERMISSION_START_AFTER_GRANT":
      return handlePermissionStartAfterGrant();
    case "CLIPS_OVERLAY_COUNTDOWN_DONE":
      // Skip button on the countdown overlay: start the recorder now.
      return handleOverlaySkip();
    case "CLIPS_OVERLAY_PAUSE":
      return handleOverlayPause();
    case "CLIPS_OVERLAY_RESUME":
      return handleOverlayResume();
    case "CLIPS_OVERLAY_STOP":
      return stopRecording();
    case "CLIPS_OVERLAY_CANCEL":
      return cancelRecording();
    case "CLIPS_OVERLAY_RESTART":
      return handleOverlayRestart();
    default:
      return { ok: false, error: "Unknown message." };
  }
}

// While a recording is active, keep the overlay following the user as they
// switch tabs (programmatic injection covers tabs opened before the extension
// loaded; declared content scripts cover navigations).
chrome.tabs.onActivated.addListener((info) => {
  if (!CROSS_TAB_FOLLOW) return; // activeTab-only: overlay stays on the launch tab
  void (async () => {
    await ensureRestored();
    if (overlayPhase === "idle" || !activeNativeRecording) return;
    await mountOverlayOnTab(info.tabId);
  })();
});

// The overlay content script is injected on demand (activeTab), so reloading the
// launch tab wipes it — the camera bubble and toolbar would vanish for the rest
// of the recording even though capture keeps running in the offscreen document.
// Re-inject and re-mount once the launch tab finishes reloading while a recording
// is active. Scoped to the launch tab (the only tab activeTab lets us touch); a
// same-URL reload keeps that grant.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  void (async () => {
    await ensureRestored();
    if (overlayPhase === "idle" || !activeNativeRecording) return;
    if (tabId !== overlayTabId) return;
    await mountOverlayOnTab(tabId);
    broadcastOverlayState();
    if (overlayPhase === "countdown") await handleOverlaySkip();
  })();
});

// While recording, the popup is disabled (setActionPopup("")), so clicking the
// extension icon lands here: stop & save immediately (or discard if we're still
// in the pre-roll countdown). When idle, the popup opens and this never fires.
chrome.action.onClicked.addListener(() => {
  void (async () => {
    // Await restore — the click may have woken the worker, leaving the module
    // globals empty until this resolves. Without it, Stop silently does nothing.
    await ensureRestored();
    console.log(
      "[clips-bg] icon clicked — phase:",
      overlayPhase,
      "active:",
      !!activeNativeRecording,
    );
    if (!activeNativeRecording) return;
    if (overlayPhase === "countdown") await cancelRecording();
    else if (overlayPhase === "recording" || overlayPhase === "paused") {
      await stopRecording();
    }
  })();
});

// The popup opens a port for as long as it is visible; its disconnect (popup
// closed) is our reliable signal to remove the pre-record preview bubble.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "clips-preview") return;
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    void stopPreview();
  });
});

chrome.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
    void handleExternalMessage(message as ExternalMessage, sender)
      .then(sendResponse)
      .catch((err) => {
        sendResponse({
          ok: false,
          error:
            err instanceof Error
              ? err.message
              : "Could not collect diagnostics.",
        });
      });
    return true;
  },
);

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (typeof tabId !== "number") return;
  const sessionId = tabToSession.get(tabId);
  const session = sessionId ? sessions.get(sessionId) : null;
  if (!session) return;
  try {
    if (method === "Runtime.consoleAPICalled") {
      handleConsoleEvent(session, params);
    } else if (method === "Runtime.exceptionThrown") {
      handleExceptionEvent(session, params);
    } else if (method === "Log.entryAdded") {
      handleLogEntryEvent(session, params);
    } else if (method === "Network.requestWillBeSent") {
      handleRequestWillBeSent(session, params);
    } else if (method === "Network.responseReceived") {
      handleResponseReceived(session, params);
    } else if (method === "Network.loadingFinished") {
      handleLoadingFinished(session, params);
    } else if (method === "Network.loadingFailed") {
      handleLoadingFailed(session, params);
    }
  } catch (err) {
    pushConsole(session, {
      level: "warn",
      message: `Clips skipped a diagnostics event: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
    });
  }
});

chrome.debugger.onDetach.addListener((source) => {
  const tabId = source.tabId;
  if (typeof tabId !== "number") return;
  const sessionId = tabToSession.get(tabId);
  if (!sessionId) return;
  const session = sessions.get(sessionId);
  if (session) session.attached = false;
  tabToSession.delete(tabId);
});

// ---- Dev auto-reload (unpacked installs only) ------------------------------
// `pnpm dev:hot` runs a localhost server that streams "reload" after each
// rebuild; we hold the stream open and reload the extension when it fires, so
// edits land without touching chrome://extensions. The open fetch also keeps
// this worker alive while iterating. No-ops for packed/Web Store installs
// (they have an update_url) and quietly retries when no dev server is running.
function startDevHotReload(): void {
  if ("update_url" in chrome.runtime.getManifest()) return;
  const url = "http://localhost:8123/dev-reload-stream";
  const connect = (): void => {
    fetch(url, { cache: "no-store" })
      .then(async (res) => {
        const reader = res.body?.getReader();
        if (!reader) {
          setTimeout(connect, 2500);
          return;
        }
        const decoder = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (decoder.decode(value, { stream: true }).includes("reload")) {
            chrome.runtime.reload();
            return;
          }
        }
        setTimeout(connect, 1000);
      })
      .catch(() => setTimeout(connect, 2500));
  };
  connect();
}
startDevHotReload();
