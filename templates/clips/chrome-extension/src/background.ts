import { sanitizeBrowserDiagnosticNavigationUrl } from "@shared/browser-diagnostics";
import { buildRecordingShareUrl } from "@shared/recording-link";

import {
  cdpTimestampMs,
  cdpWallTimeMs,
  elapsedMsFromCaptureStart,
} from "./cdp-time";
import {
  MediaPermissionRequiredError,
  mediaPermissionErrorFromResponse,
  mediaPermissionRequirements,
  permissionPageUrl,
  writeCachedMediaPermission,
} from "./media-permission";
import {
  claimRecordingFinalization,
  restartUploadModeFromResponse,
  restartUploadResetBody,
  shouldClearTerminalSavingOverlay,
  shouldReconcilePersistedRecording,
  type OffscreenRecordingState,
} from "./native-recording-state";
import {
  sendWithInjectionFallback,
  shouldFollowOverlay,
} from "./overlay-follow";
import { captureExtensionError, initExtensionSentry } from "./sentry";

initExtensionSentry("background");

const DEFAULT_CLIPS_BASE_URL = "https://clips.agent-native.com";
const DEBUGGER_PROTOCOL_VERSION = "1.3";
const MAX_CONSOLE_LOGS = 400;
const MAX_NETWORK_REQUESTS = 400;
const CLICK_INPUT_INGRESS_WINDOW_MS = 1_000;
const MAX_CLICK_INPUT_INGRESS_PER_WINDOW = 100;
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
type InteractionKind = "navigation" | "click" | "input" | "scroll";
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

type AuthSessionMessage = {
  type: "CLIPS_AUTH_SESSION";
  token?: string;
  email?: string;
  clipsBaseUrl?: string;
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
  | AuthSessionMessage;

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

type InteractionEvent = {
  timestampMs: number;
  elapsedMs: number;
  kind: InteractionKind;
  target?: string;
  url?: string;
};

type BrowserDiagnosticsData = {
  pageUrl: string | null;
  userAgent: string | null;
  startedAt: string;
  endedAt: string;
  consoleLogs: ConsoleLog[];
  networkRequests: NetworkRequest[];
  interactionEvents?: InteractionEvent[];
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
  diagnosticsPausedAtMs?: number;
  diagnosticsPausedDurationMs?: number;
  savedToDisk?: boolean;
  savedFilename?: string;
  mimeType?: string;
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
  recordingStep?: string;
  mimeType?: string;
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
  interactionEvents: InteractionEvent[];
  clickInputIngressWindowStartedAtMs: number;
  clickInputIngressCount: number;
  diagnosticsPausedAtMs: number | null;
  diagnosticsPausedDurationMs: number;
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


type CaptureMode = "screen" | "camera";
type OverlayPhase = "idle" | "countdown" | "recording" | "paused" | "saving";
type OverlayPart = "bubble" | "countdown" | "toolbar" | "saving";

let overlayPhase: OverlayPhase = "idle";
let overlayBaseElapsedMs = 0;
let overlayBaseEpochMs = 0;
let overlayShowsBubble = false;
let recordingShowsBubble = false;
const CROSS_TAB_FOLLOW: boolean = true;
let overlayTabId: number | null = null;
let countdownEndsAtMs = 0;
let armingNativeRecordingSessionId: string | null = null;
const ARMING_GUARD_TTL_MS = 120000;

function desiredParts(): OverlayPart[] {
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

const COUNTDOWN_SECONDS = 3;
const PENDING_PERMISSION_START_TTL_MS = 5 * 60 * 1000;

function clearCountdownTimer(): void {
  countdownEndsAtMs = 0;
}

function setActionPopup(path: string): void {
  try {
    void chrome.action.setPopup({ popup: path });
  } catch {
    /* action API unavailable */
  }
}

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
    "pendingNativeRecording",
    "overlayRuntime",
    "armingNativeRecordingSessionId",
  ]);
  const rawArmingSessionId = persistedArmingSessionId(
    stored.armingNativeRecordingSessionId,
  );
  const hadArmingGuardBeforeRestore = armingNativeRecordingSessionId !== null;
  const rec = stored.activeNativeRecording as NativeRecording | undefined;
  const pendingRec = stored.pendingNativeRecording as
    | NativeRecording
    | undefined;
  const restoredRecording = rec ?? pendingRec;
  if (
    restoredRecording &&
    typeof restoredRecording.sessionId === "string" &&
    !activeNativeRecording
  ) {
    activeNativeRecording = restoredRecording;
  }
  if (
    activeNativeRecording &&
    !sessions.has(activeNativeRecording.sessionId) &&
    activeNativeRecording.status !== "complete" &&
    activeNativeRecording.status !== "error"
  ) {
    const session = restoreCaptureSession(activeNativeRecording);
    await attachSession(session);
  }
  const freshArmingSessionId = await readFreshPersistedArmingSessionId(
    stored.armingNativeRecordingSessionId,
  );
  if (freshArmingSessionId && armingNativeRecordingSessionId === null) {
    armingNativeRecordingSessionId = freshArmingSessionId;
  } else if (!freshArmingSessionId) {
    armingNativeRecordingSessionId = null;
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

  let armingRecovered = !freshArmingSessionId;
  const recoverySessionId = freshArmingSessionId ?? rawArmingSessionId;
  if (recoverySessionId) {
    let offscreenState: OffscreenRecordingState | null = null;
    try {
      await ensureOffscreenDocument();
      offscreenState = await sendOffscreenMessage<OffscreenRecordingState>({
        type: "CLIPS_OFFSCREEN_STATUS",
      });
    } catch (error) {
      console.warn(
        "[clips-bg] could not inspect interrupted arming state:",
        error,
      );
    }

    if (offscreenState?.activeSessionId === recoverySessionId) {
      if (activeNativeRecording) {
        await setArmingGuard(null);
        armingRecovered = true;
      } else {
        await cancelRecoveredOffscreenSession(
          recoverySessionId,
          offscreenState.activeRecordingId,
        );
        resetOverlay();
        await broadcastUnmount();
        broadcastOverlayState();
        await clearNativeRecording();
        await setArmingGuard(null);
        armingRecovered = true;
      }
    } else if (offscreenState?.preparedSessionId === recoverySessionId) {
      if (hadArmingGuardBeforeRestore && freshArmingSessionId) {
        // This is the normal acquire/create/attach gap before BEGIN. Keep the
        // guard while the prepared streams are still owned by this arm.
      } else if (activeNativeRecording?.sessionId === recoverySessionId) {
        await cancelRecording(true);
        await setArmingGuard(null);
        armingRecovered = true;
      } else {
        await cancelRecoveredOffscreenSession(recoverySessionId);
        resetOverlay();
        await broadcastUnmount();
        broadcastOverlayState();
        await clearNativeRecording();
        await setArmingGuard(null);
        armingRecovered = true;
      }
    } else if (offscreenState) {
      if (activeNativeRecording?.sessionId === recoverySessionId) {
        await cancelRecording(true);
      } else {
        await cancelRecoveredOffscreenSession(recoverySessionId);
        if (!activeNativeRecording) {
          resetOverlay();
          await broadcastUnmount();
          broadcastOverlayState();
          await clearNativeRecording();
        }
      }
      await setArmingGuard(null);
      armingRecovered = true;
    }
  }

  if (armingRecovered && overlayPhase !== "idle" && activeNativeRecording) {
    setActionPopup(overlayPhase === "saving" ? "" : "src/popup.html");
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

  if (activeNativeRecording?.status === "complete") {
    setActionPopup("src/popup.html");
    await finishSaving(
      activeNativeRecording,
      activeNativeRecording.recordingId,
      true,
    );
  } else if (
    activeNativeRecording &&
    shouldClearTerminalSavingOverlay(overlayPhase, activeNativeRecording.status)
  ) {
    resetOverlay();
    await broadcastUnmount();
    broadcastOverlayState();
  } else {
    await reconcilePersistedNativeRecording();
  }
}

function sendTabMessage(
  tabId: number,
  message: Record<string, unknown>,
): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, () => {
        resolve(!chrome.runtime.lastError);
      });
    } catch {
      resolve(false);
    }
  });
}

async function injectContentScript(tabId: number): Promise<boolean> {
  const scripting = (
    chrome as typeof chrome & {
      scripting?: {
        executeScript: (args: {
          target: { tabId: number };
          files: string[];
          world?: "ISOLATED" | "MAIN";
        }) => Promise<unknown>;
      };
    }
  ).scripting;
  if (!scripting) return false;
  try {
    await scripting.executeScript({
      target: { tabId },
      files: ["assets/content-history-bridge.js"],
      world: "MAIN",
    });
    // coercion-ok: MAIN-world injection is optional; the isolated script still records.
  } catch {
    // Some restricted pages reject MAIN-world injection but still accept the
    // isolated overlay/content script.
  }
  try {
    await scripting.executeScript({
      target: { tabId },
      files: ["assets/content-script.js"],
    });
    return true;
  } catch {
    return false;
  }
}

async function mountOverlayOnTab(
  tabId: number,
  parts: OverlayPart[] = desiredParts(),
): Promise<boolean> {
  return sendWithInjectionFallback(
    () =>
      sendTabMessage(tabId, {
        type: "CLIPS_OVERLAY_MOUNT",
        parts,
      }),
    () => injectContentScript(tabId),
  );
}

function allTabs(): Promise<chrome.tabs.Tab[]> {
  return new Promise((resolve) => {
    chrome.tabs.query({}, (tabs) => resolve(tabs ?? []));
  });
}

async function broadcastMount(): Promise<void> {
  if (!CROSS_TAB_FOLLOW) {
    if (overlayTabId !== null) await mountOverlayOnTab(overlayTabId);
    return;
  }
  const parts = desiredParts();
  const resetDiagnosticQuotas = overlayPhase === "recording";
  const tabs = await allTabs();
  await Promise.all(
    tabs.map((tab) =>
      typeof tab.id === "number"
        ? sendTabMessage(tab.id, {
            type: "CLIPS_OVERLAY_MOUNT",
            parts,
            ...(resetDiagnosticQuotas ? { resetDiagnosticQuotas: true } : {}),
          })
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
  setActionPopup("src/popup.html");
  void persistOverlay();
}

let previewTabId: number | null = null;

async function startPreview(wantsCamera: boolean): Promise<void> {
  await ensureRestored();
  if (overlayPhase !== "idle" || !wantsCamera) {
    await stopPreview();
    return;
  }
  const tab = await queryActiveTab();
  if (!tab || typeof tab.id !== "number") return;
  if (previewTabId !== null && previewTabId !== tab.id) await stopPreview();
  previewTabId = tab.id;
  await mountOverlayOnTab(tab.id, ["bubble"]);
}

async function stopPreview(): Promise<void> {
  const tabId = previewTabId;
  previewTabId = null;
  if (tabId === null) return;
  if (overlayPhase !== "idle") return;
  await sendTabMessage(tabId, { type: "CLIPS_OVERLAY_UNMOUNT" });
}

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
    await sessionStorageRemove("pendingNativeRecording").catch(() => undefined);
    return;
  }
  await sessionStorageSet({
    activeNativeRecording: activeNativeRecording,
  }).catch(() => undefined);
}

async function persistPendingNativeRecording(
  recording: NativeRecording,
): Promise<void> {
  await sessionStorageSet({ pendingNativeRecording: recording });
}

async function cancelRecoveredOffscreenSession(
  sessionId: string,
  recordingId?: string,
): Promise<void> {
  await sendOffscreenMessage({
    type: "CLIPS_OFFSCREEN_CANCEL",
    sessionId,
  }).catch(() => undefined);
  if (recordingId) {
    const settings = await readSettings();
    await postAction(settings, "trash-recording", { id: recordingId }).catch(
      (error) => {
        console.warn(
          "[clips-bg] recovered recording cleanup could not trash row",
          error,
        );
      },
    );
  }
}

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

function persistedArmingSessionId(rawValue: unknown): string | null {
  if (typeof rawValue === "string" && rawValue) return rawValue;
  if (!rawValue || typeof rawValue !== "object") return null;
  const sessionId = (rawValue as { sessionId?: unknown }).sessionId;
  return typeof sessionId === "string" && sessionId ? sessionId : null;
}

async function readFreshPersistedArmingSessionId(
  rawValue: unknown,
): Promise<string | null> {
  if (typeof rawValue === "string" && rawValue) {
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

type OffscreenErrorResponse = {
  error?: string;
  errorCode?: string;
  errorDevice?: string;
};

function offscreenError(response: OffscreenErrorResponse): Error {
  return (
    mediaPermissionErrorFromResponse(response) ?? new Error(response.error)
  );
}

function sendOffscreenMessage<T>(message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      message,
      (response: T & OffscreenErrorResponse) => {
        const error = chromeLastError();
        if (error) {
          reject(error);
          return;
        }
        if (response && typeof response.error === "string") {
          reject(offscreenError(response));
          return;
        }
        resolve(response);
      },
    );
  });
}

const WORKER_KEEPALIVE_INTERVAL_MS = 20_000;

async function withWorkerKeepAlive<T>(run: () => Promise<T>): Promise<T> {
  const timer = setInterval(() => {
    void chrome.runtime.getPlatformInfo().catch(() => undefined);
  }, WORKER_KEEPALIVE_INTERVAL_MS);
  try {
    return await run();
  } finally {
    clearInterval(timer);
  }
}

function recordingUrl(
  recording: Pick<NativeRecording, "clipsBaseUrl" | "recordingId">,
): string {
  return `${recording.clipsBaseUrl}/r/${encodeURIComponent(recording.recordingId)}`;
}

// The extension only stores the signed-in user's token and email; email is PII
function recordingShareUrl(
  recording: Pick<NativeRecording, "clipsBaseUrl" | "recordingId">,
): string {
  return buildRecordingShareUrl({
    recordingId: recording.recordingId,
    origin: recording.clipsBaseUrl,
  });
}

async function copyRecordingUrlToClipboard(
  recording: NativeRecording,
): Promise<void> {
  try {
    await ensureOffscreenDocument();
    await sendOffscreenMessage({
      type: "CLIPS_OFFSCREEN_COPY_TEXT",
      text: recordingShareUrl(recording),
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
    interactionEvents: [],
    clickInputIngressWindowStartedAtMs: 0,
    clickInputIngressCount: 0,
    diagnosticsPausedAtMs: null,
    diagnosticsPausedDurationMs: 0,
    pendingNetworkRequests: new Map(),
  };
  sessions.set(sessionId, session);
  tabToSession.set(session.targetTabId, sessionId);
  return session;
}

function restoreCaptureSession(recording: NativeRecording): CaptureSession {
  const session = createSession(
    recording.sessionId,
    {
      id: recording.targetTabId,
      title: recording.targetTitle ?? undefined,
      url: recording.targetUrl ?? undefined,
    },
    settingsFromRecording(recording),
  );
  session.recordingId = recording.recordingId;
  session.startedAt = recording.startedAt;
  session.startedAtMs = recording.startedAtMs;
  session.diagnosticsPausedAtMs =
    typeof recording.diagnosticsPausedAtMs === "number"
      ? recording.diagnosticsPausedAtMs
      : null;
  session.diagnosticsPausedDurationMs =
    typeof recording.diagnosticsPausedDurationMs === "number"
      ? Math.max(0, recording.diagnosticsPausedDurationMs)
      : 0;
  if (session.targetUrl) {
    pushInteraction(session, {
      kind: "navigation",
      url: session.targetUrl,
      timestampMs: session.startedAtMs,
    });
  }
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
  // one back to a fresh permission tab on failure would open a new tab per
  allowPermissionRecovery?: boolean;
}) {
  const { tab, settings } = args;
  const allowPermissionRecovery = args.allowPermissionRecovery !== false;
  await reconcilePersistedNativeRecording();
  const persistedArmingSessionId = await readFreshPersistedArmingSessionId(
    (await sessionStorageGet(["armingNativeRecordingSessionId"]))
      .armingNativeRecordingSessionId,
  );
  if (!persistedArmingSessionId) {
    armingNativeRecordingSessionId = null;
  }
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
    return await armRecording({
      sessionId,
      tab,
      settings,
      allowPermissionRecovery,
    });
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
  return startRecordingFromTab({
    tab,
    settings: pending.settings,
    allowPermissionRecovery: false,
  });
}

// user through the permission page — the only surface Chrome will prompt from —
async function recoverMissingMediaPermission(args: {
  error: MediaPermissionRequiredError;
  tab: ChromeTab;
  settings: ExtensionSettings;
  openPermissionPage: boolean;
}): Promise<{ ok: false; error: string }> {
  const { error, tab, settings, openPermissionPage } = args;
  captureExtensionError(error, {
    tags: {
      surface: "background",
      recordingStep: "offscreen-acquire",
      permission: error.device,
    },
  });
  await writeCachedMediaPermission({ [error.device]: false });
  if (!openPermissionPage) {
    return {
      ok: false,
      error: `Chrome still has not granted Clips ${error.device} access. Allow it from Chrome's address-bar icon, then start the recording again.`,
    };
  }
  if (typeof tab.id === "number") {
    await writePendingPermissionStart({
      settings,
      targetTabId: tab.id,
      createdAtMs: Date.now(),
    });
  }
  await createTab(
    permissionPageUrl(mediaPermissionRequirements(settings), {
      startAfterGrant: typeof tab.id === "number",
    }),
  ).catch(() => undefined);
  return { ok: false, error: error.message };
}

async function armRecording(args: {
  sessionId: string;
  tab: ChromeTab;
  settings: ExtensionSettings;
  allowPermissionRecovery: boolean;
}) {
  const { sessionId, tab, settings, allowPermissionRecovery } = args;
  const mode: CaptureMode =
    settings.captureSurface === "camera" ? "camera" : "screen";
  const surface: "browser" | "window" | "monitor" =
    settings.captureSurface === "camera" ? "browser" : settings.captureSurface;
  console.log("[clips-bg] arm: start", { mode, surface, tabId: tab.id });

  await ensureOffscreenDocument();

  let acq: { ok: boolean; width: number; height: number };
  try {
    acq = await withWorkerKeepAlive(() =>
      sendOffscreenMessage<{ ok: boolean; width: number; height: number }>({
        type: "CLIPS_OFFSCREEN_ACQUIRE",
        sessionId,
        mode,
        surface,
        includeMicrophone: settings.includeMicrophone,
        includeCamera: settings.includeCamera,
        videoDeviceId: settings.videoDeviceId,
        audioDeviceId: settings.audioDeviceId,
      }),
    );
  } catch (err) {
    if (err instanceof MediaPermissionRequiredError) {
      return recoverMissingMediaPermission({
        error: err,
        tab,
        settings,
        openPermissionPage: allowPermissionRecovery,
      });
    }
    throw err;
  }
  console.log("[clips-bg] arm: acquired stream", acq);

  const cameraInvolved = mode === "camera" || settings.includeCamera;
  setActionPopup("");
  overlayPhase = "countdown";
  overlayBaseElapsedMs = 0;
  overlayBaseEpochMs = nowMs();
  overlayShowsBubble = cameraInvolved;
  recordingShowsBubble = cameraInvolved;
  countdownEndsAtMs = nowMs() + COUNTDOWN_SECONDS * 1000;
  previewTabId = null;
  setRecordingFlag(true);
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
      recordingPlatform: "extension",
      sourceWindowTitle: tab.title ?? null,
      hasCamera: cameraInvolved,
      hasAudio: settings.includeMicrophone,
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
  try {
    await persistPendingNativeRecording(activeNativeRecording);
    await saveActiveNativeRecording();
  } catch (err) {
    await abortArming();
    await postAction(settings, "trash-recording", { id: created.id }).catch(
      () => undefined,
    );
    await clearNativeRecording();
    throw err;
  }
  const authToken = (await readAuthSession(settings))?.token;
  console.log("[clips-bg] arm: created row", created.id, "auth?", !!authToken);
  await attachSession(session);
  const startDelayMs = cameraInvolved ? 20000 : COUNTDOWN_SECONDS * 1000 + 1000;
  if (
    armingNativeRecordingSessionId !== sessionId ||
    activeNativeRecording?.sessionId !== sessionId
  ) {
    await abortArming();
    await clearNativeRecording();
    throw new Error("Clips recording start was cancelled.");
  }
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
      transcriptUrl: actionUrl(settings, "save-browser-transcript"),
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
    await cancelRecording(true);
    throw err;
  }
  setActionPopup("src/popup.html");
  await saveActiveNativeRecording();

  broadcastOverlayState();
  await chrome.action.setBadgeBackgroundColor({ color: "#e11d48" });
  await chrome.action.setBadgeText({ text: "REC" });
  console.log("[clips-bg] arm: done — countdown, parts:", desiredParts());

  return { ok: true, sessionId, recordingId: created.id, native: true };
}

async function markRecordingStarted() {
  if (overlayPhase !== "countdown") return;
  console.log("[clips-bg] recorder started → phase=recording");
  clearCountdownTimer();
  overlayPhase = "recording";
  overlayBaseElapsedMs = 0;
  overlayBaseEpochMs = nowMs();
  const session = activeNativeRecording
    ? sessions.get(activeNativeRecording.sessionId)
    : null;
  if (session) beginSessionCapture(session, overlayBaseEpochMs);
  if (activeNativeRecording) {
    delete activeNativeRecording.diagnosticsPausedAtMs;
    delete activeNativeRecording.diagnosticsPausedDurationMs;
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
  const pausedAtMs = nowMs();
  overlayBaseElapsedMs += Math.max(0, pausedAtMs - overlayBaseEpochMs);
  overlayPhase = "paused";
  const session = activeNativeRecording
    ? sessions.get(activeNativeRecording.sessionId)
    : null;
  if (session) session.diagnosticsPausedAtMs = pausedAtMs;
  if (activeNativeRecording) {
    activeNativeRecording.diagnosticsPausedAtMs = pausedAtMs;
    activeNativeRecording.diagnosticsPausedDurationMs ??= 0;
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
  const resumedAtMs = nowMs();
  const session = activeNativeRecording
    ? sessions.get(activeNativeRecording.sessionId)
    : null;
  const pausedAtMs =
    session?.diagnosticsPausedAtMs ??
    activeNativeRecording?.diagnosticsPausedAtMs;
  if (typeof pausedAtMs === "number") {
    const pausedDurationMs = Math.max(0, resumedAtMs - pausedAtMs);
    if (session) {
      session.diagnosticsPausedDurationMs += pausedDurationMs;
      session.diagnosticsPausedAtMs = null;
    }
    if (activeNativeRecording) {
      activeNativeRecording.diagnosticsPausedDurationMs =
        (activeNativeRecording.diagnosticsPausedDurationMs ?? 0) +
        pausedDurationMs;
      delete activeNativeRecording.diagnosticsPausedAtMs;
    }
  }
  overlayBaseEpochMs = resumedAtMs;
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
  const uploadMode = await resetRecordingChunks(recording);
  if (!uploadMode) {
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
  recording.uploadMode = uploadMode;
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
      transcriptUrl: actionUrl(
        settingsFromRecording(recording),
        "save-browser-transcript",
      ),
    });
  } catch (err) {
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
): Promise<UploadMode | null> {
  const url = `${recording.clipsBaseUrl}/api/uploads/${encodeURIComponent(
    recording.recordingId,
  )}/reset-chunks`;
  const headers = {
    ...(await authHeaders(settingsFromRecording(recording))),
    "Content-Type": "application/json",
  };
  const response = await fetch(url, {
    method: "POST",
    headers,
    credentials: "include",
    cache: "no-store",
    body: JSON.stringify(
      restartUploadResetBody(recording.mimeType ?? "video/webm"),
    ),
  }).catch(() => undefined);
  if (!response?.ok) return null;
  return restartUploadModeFromResponse(await response.json().catch(() => null));
}

async function finishSaving(
  recording: NativeRecording,
  recordingIdFromStatus?: string,
  restoringCompletedRecording = false,
): Promise<boolean> {
  if (
    overlayPhase !== "saving" &&
    !(restoringCompletedRecording && recording.status === "complete")
  ) {
    return false;
  }
  const releaseFinalization = claimRecordingFinalization(recording.sessionId);
  if (!releaseFinalization) return false;
  try {
    resetOverlay();
    recording.status = "complete";
    recording.error = null;
    if (recordingIdFromStatus) recording.recordingId = recordingIdFromStatus;
    recording.recordingUrl = recordingUrl(recording);
    await deleteSession(recording.sessionId);
    await broadcastUnmount();
    broadcastOverlayState();
    await copyRecordingUrlToClipboard(recording);
    await clearNativeRecording();
    await createTab(recording.recordingUrl);
    return true;
  } finally {
    releaseFinalization();
  }
}

async function stopRecording() {
  const recording = activeNativeRecording;
  console.log("[clips-bg] stopRecording — active:", !!recording);
  if (!recording) return { ok: false, error: "No active Clips recording." };
  if (overlayPhase === "saving") return { ok: false };
  recording.status = "stopping";
  // Disable the popup while saving so a second Stop or Discard cannot race
  setActionPopup("");
  overlayPhase = "saving";
  countdownEndsAtMs = 0;
  const diagnostics = await stopNativeDiagnostics(recording);
  const diagnosticsSave = saveNativeDiagnostics(recording, diagnostics);
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
      await diagnosticsSave;
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
    await diagnosticsSave;
    await finishSaving(recording, recordingId);
    return {
      ok: true,
      recordingId: recording.recordingId,
      recordingUrl: recording.recordingUrl,
    };
  } catch (err) {
    await diagnosticsSave;
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

async function cancelRecording(force = false) {
  const recording = activeNativeRecording;
  if (overlayPhase === "saving") return { ok: false };
  if (!force && armingNativeRecordingSessionId) {
    return { ok: false, error: "Clips recording is still starting." };
  }
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
    failureCode: "user_cancelled",
    reason: "Recording cancelled by user",
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
  diagnostics?: BrowserDiagnosticsData | null,
): Promise<void> {
  if (!recording.includeDeveloperLogs) return;
  const session = sessions.get(recording.sessionId);
  const snapshot = diagnostics ?? (session ? snapshotSession(session) : null);
  if (!snapshot) return;
  await postAction(
    settingsFromRecording(recording),
    "save-browser-diagnostics",
    {
      recordingId: recording.recordingId,
      sessionId: recording.sessionId,
      source: "extension",
      phase: "recording",
      pageUrl: snapshot.pageUrl,
      userAgent: snapshot.userAgent,
      startedAt: snapshot.startedAt,
      endedAt: snapshot.endedAt,
      consoleLogs: snapshot.consoleLogs,
      networkRequests: snapshot.networkRequests,
      interactionEvents: snapshot.interactionEvents,
    },
  ).catch((err) => {
    console.warn("[clips-extension] diagnostics save failed:", err);
  });
}

async function stopNativeDiagnostics(
  recording: NativeRecording,
): Promise<BrowserDiagnosticsData | null> {
  const session = sessions.get(recording.sessionId);
  if (!session) return null;
  const diagnostics = recording.includeDeveloperLogs
    ? snapshotSession(session)
    : null;
  await deleteSession(recording.sessionId).catch((err) => {
    console.warn("[clips-extension] diagnostics detach failed:", err);
  });
  return diagnostics;
}

async function clearNativeRecording(): Promise<void> {
  activeNativeRecording = null;
  await saveActiveNativeRecording();
  await chrome.action.setBadgeText({ text: "" });
}

async function reconcilePersistedNativeRecording(): Promise<void> {
  const recording = activeNativeRecording;
  if (!recording) return;
  if (recording.status === "error" || recording.status === "complete") return;

  try {
    await ensureOffscreenDocument();
    const state = await sendOffscreenMessage<OffscreenRecordingState>({
      type: "CLIPS_OFFSCREEN_STATUS",
    });
    if (
      !shouldReconcilePersistedRecording(
        recording.status,
        recording.sessionId,
        state,
      )
    ) {
      return;
    }
  } catch {
    return;
  }

  console.warn(
    "[clips-bg] clearing persisted recording with no live offscreen session",
    recording.sessionId,
  );
  await deleteSession(recording.sessionId).catch((error) => {
    console.warn(
      "[clips-bg] stale recording cleanup could not detach tab",
      error,
    );
  });
  resetOverlay();
  await broadcastUnmount();
  broadcastOverlayState();
  await clearNativeRecording();
}

async function handlePopupStatus() {
  await reconcilePersistedNativeRecording();
  if (armingNativeRecordingSessionId) await restoreRuntimeState();
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

async function handleAuthSession(
  message: AuthSessionMessage,
  senderUrl?: string,
) {
  const settings = await readSettings();
  const clipsBaseUrl = normalizeBaseUrl(
    message.clipsBaseUrl ?? settings.clipsBaseUrl,
  );
  const senderOrigin = originOf(senderUrl);
  if (
    !senderOrigin ||
    senderOrigin !== originOf(clipsBaseUrl) ||
    senderOrigin !== originOf(settings.clipsBaseUrl)
  ) {
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

function diagnosticElapsedMs(
  timestampMs: number,
  session: CaptureSession,
): number | null {
  const elapsedMs = elapsedMsFromCaptureStart(timestampMs, session.startedAtMs);
  if (elapsedMs === null) return null;
  const activePauseMs =
    session.diagnosticsPausedAtMs === null
      ? 0
      : Math.max(0, timestampMs - session.diagnosticsPausedAtMs);
  return Math.max(
    0,
    elapsedMs - session.diagnosticsPausedDurationMs - activePauseMs,
  );
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
    interactionEvents: session.interactionEvents.slice(-800),
    summary: summarize({ endedAt, consoleLogs, networkRequests }),
  };
}

function beginSessionCapture(
  session: CaptureSession,
  startedAtMs = nowMs(),
): void {
  session.startedAtMs = startedAtMs;
  session.startedAt = new Date(startedAtMs).toISOString();
  session.consoleLogs = [];
  session.networkRequests = [];
  session.interactionEvents = [];
  session.clickInputIngressWindowStartedAtMs = 0;
  session.clickInputIngressCount = 0;
  session.diagnosticsPausedAtMs = null;
  session.diagnosticsPausedDurationMs = 0;
  if (session.targetUrl) {
    pushInteraction(session, {
      kind: "navigation",
      url: session.targetUrl,
      timestampMs: startedAtMs,
    });
  }
  session.pendingNetworkRequests.clear();
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
  const elapsedMs = diagnosticElapsedMs(timestampMs, session);
  if (elapsedMs === null) return;
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
    elapsedMs,
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

function pushInteraction(
  session: CaptureSession,
  entry: Omit<InteractionEvent, "timestampMs" | "elapsedMs"> & {
    timestampMs?: number;
  },
): void {
  const timestampMs = entry.timestampMs ?? nowMs();
  const elapsedMs = diagnosticElapsedMs(timestampMs, session);
  if (elapsedMs === null) return;
  const url = entry.url
    ? sanitizeBrowserDiagnosticNavigationUrl(entry.url)
    : undefined;
  if (entry.kind === "navigation" && url) {
    const first = session.interactionEvents[0];
    if (
      session.interactionEvents.length === 1 &&
      first?.kind === "navigation" &&
      first.url === url
    ) {
      return;
    }
  }
  session.interactionEvents.push({
    timestampMs,
    elapsedMs,
    kind: entry.kind,
    ...(entry.target
      ? { target: truncate(redactString(entry.target), 200) }
      : {}),
    ...(url ? { url } : {}),
  });
  if (session.interactionEvents.length > 800) {
    session.interactionEvents.splice(0, session.interactionEvents.length - 800);
  }
}

function allowClickInputIngress(
  session: CaptureSession,
  kind: InteractionKind,
): boolean {
  if (kind !== "click" && kind !== "input") return true;
  const now = nowMs();
  if (
    now - session.clickInputIngressWindowStartedAtMs >=
    CLICK_INPUT_INGRESS_WINDOW_MS
  ) {
    session.clickInputIngressWindowStartedAtMs = now;
    session.clickInputIngressCount = 0;
  }
  if (session.clickInputIngressCount >= MAX_CLICK_INPUT_INGRESS_PER_WINDOW) {
    return false;
  }
  session.clickInputIngressCount += 1;
  return true;
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
    timestampMs: cdpTimestampMs(event.timestamp),
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
    timestampMs:
      typeof item.timestamp === "number" ? item.timestamp : undefined,
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
    timestampMs: cdpTimestampMs(item.timestamp),
  });
}

function trackedNetworkType(value: unknown): NetworkType | null {
  if (value === "XHR") return "xhr";
  if (value === "Fetch") return "fetch";
  return null;
}

function requestTimestampMs(params: Record<string, unknown>): number {
  return cdpWallTimeMs(params.wallTime) ?? nowMs();
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
  const elapsedMs = diagnosticElapsedMs(timestampMs, session);
  if (elapsedMs === null) return;
  const url = sanitizeUrl(typeof request.url === "string" ? request.url : "");
  if (!url) return;
  session.pendingNetworkRequests.set(requestId, {
    requestId,
    timestampMs,
    elapsedMs,
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
    return handleAuthSession(message, sender?.url);
  }

  if (message.type === "CLIPS_CAPTURE_START") {
    if (!message.sessionId) return { ok: false, error: "Missing sessionId." };
    const session = sessions.get(message.sessionId);
    if (!session) return { ok: false, error: "Capture session not found." };
    session.recordingId = message.recordingId ?? null;
    beginSessionCapture(session);
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
  if (details.reason === "install") {
    void createTab(chrome.runtime.getURL("src/permission.html")).catch(
      () => undefined,
    );
  }
});

let restorePromise: Promise<void> | null = null;
function ensureRestored(): Promise<void> {
  if (!restorePromise) {
    restorePromise = restoreRuntimeState().catch(() => undefined);
  }
  return restorePromise;
}
void ensureRestored();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  void (async () => {
    await ensureRestored();
    let response: unknown;
    try {
      response = await dispatchRuntimeMessage(message, sender);
    } catch (err) {
      console.error(
        "[clips-bg] message failed:",
        (message as { type?: unknown })?.type,
        err,
      );
      captureExtensionError(err, {
        tags: {
          surface: "background",
          messageType:
            typeof (message as { type?: unknown })?.type === "string"
              ? (message as { type: string }).type
              : "",
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

async function dispatchRuntimeMessage(
  message: unknown,
  sender?: chrome.runtime.MessageSender,
): Promise<unknown> {
  const type = (message as { type?: unknown }).type;

  if (type === "CLIPS_AUTH_SESSION") {
    return handleAuthSession(
      message as AuthSessionMessage,
      sender?.tab?.url ?? sender?.url,
    );
  }

  if (type === "CLIPS_DIAGNOSTIC_INTERACTION") {
    const tabId = sender?.tab?.id;
    const sessionId =
      typeof tabId === "number" ? tabToSession.get(tabId) : null;
    const session = sessionId ? sessions.get(sessionId) : null;
    const kind = (message as { kind?: unknown }).kind;
    if (
      !session ||
      (kind !== "navigation" &&
        kind !== "click" &&
        kind !== "input" &&
        kind !== "scroll")
    ) {
      return { ok: false };
    }
    if (overlayPhase === "paused") return { ok: false };
    if (!allowClickInputIngress(session, kind)) return { ok: false };
    const target = (message as { target?: unknown }).target;
    const url = (message as { url?: unknown }).url;
    pushInteraction(session, {
      kind,
      ...(typeof target === "string" ? { target } : {}),
      ...(typeof url === "string" ? { url } : {}),
    });
    return { ok: true };
  }

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
      if (typeof status.mimeType === "string") {
        activeNativeRecording.mimeType = status.mimeType;
      }
      if (status.status === "error") {
        activeNativeRecording.savedToDisk = status.savedToDisk === true;
        activeNativeRecording.savedFilename =
          typeof status.savedFilename === "string"
            ? status.savedFilename
            : undefined;
      }
      if (
        status.status === "error" &&
        status.recordingStep === "recorder-start"
      ) {
        await deleteSession(activeNativeRecording.sessionId).catch((error) => {
          console.warn(
            "[clips-bg] failed recorder-start cleanup could not detach tab",
            error,
          );
        });
        await postAction(
          settingsFromRecording(activeNativeRecording),
          "trash-recording",
          { id: activeNativeRecording.recordingId },
        ).catch(() => undefined);
        resetOverlay();
        await broadcastUnmount();
        broadcastOverlayState();
        await clearNativeRecording();
        return { ok: true };
      }
      await saveActiveNativeRecording();
      if (status.status === "recording" && overlayPhase === "countdown") {
        await markRecordingStarted();
      }
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

  if (type === "CLIPS_CONTENT_HELLO") {
    return { ok: true, parts: desiredParts() };
  }

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

chrome.tabs.onActivated.addListener((info) => {
  if (!CROSS_TAB_FOLLOW) return;
  void (async () => {
    await ensureRestored();
    if (
      !shouldFollowOverlay(
        overlayPhase,
        Boolean(activeNativeRecording),
        Boolean(armingNativeRecordingSessionId),
      )
    )
      return;
    await mountOverlayOnTab(info.tabId);
  })();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  void (async () => {
    await ensureRestored();
    if (
      !shouldFollowOverlay(
        overlayPhase,
        Boolean(activeNativeRecording),
        Boolean(armingNativeRecordingSessionId),
      )
    )
      return;
    if (tabId !== overlayTabId) return;
    await mountOverlayOnTab(tabId);
    broadcastOverlayState();
    if (overlayPhase === "countdown") await handleOverlaySkip();
  })();
});

chrome.action.onClicked.addListener(() => {
  void (async () => {
    await ensureRestored();
    if (armingNativeRecordingSessionId) {
      await restoreRuntimeState();
    }
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
});

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
