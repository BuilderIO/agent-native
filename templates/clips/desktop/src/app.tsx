import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCalendarEvent,
  IconCircleCheck,
  IconCopy,
  IconDownload,
  IconExternalLink,
  IconFolderOpen,
  IconPencil,
  IconInfoCircle,
  IconHistory,
  IconMicrophone2,
  IconPlayerPlay,
  IconRefresh,
  IconSearch,
  IconShieldLock,
  IconTrash,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { FeedbackButton } from "./components/FeedbackButton";
import {
  CamIcon,
  CloseIcon,
  GoogleIcon,
  LibraryIcon,
  ScreenCamIcon,
  ScreenIcon,
  SettingsIcon,
} from "./components/Icons";
import { MediaDeviceRow } from "./components/MediaDeviceRow";
import { ReadinessPanel } from "./components/ReadinessPanel";
import { SourceRow, type CaptureSource } from "./components/SourceRow";
import { Switch } from "./components/Switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "./components/Tooltip";
import { UpdateBanner } from "./components/UpdateBanner";
import { useMediaDevices } from "./hooks/useMediaDevices";
import { useMeetingTranscription } from "./hooks/useMeetingTranscription";
import { stopAllMicMeters } from "./hooks/useMicMeter";
import { startBubbleFramePump } from "./lib/bubble-pump";
import {
  startBubbleWebrtc,
  type BubbleWebrtcHandle,
} from "./lib/bubble-webrtc";
import {
  getCameraStreamWithFallback,
  isMediaConstraintFailure,
} from "./lib/media-capture-constraints";
import { openMeetingJoinUrl } from "./lib/open-meeting-join-url";
import {
  DESKTOP_CAPTURE_PERMISSION_MESSAGE,
  isHardCapturePermissionError,
  MACOS_CAPTURE_PERMISSION_MESSAGE,
  MACOS_SCREEN_PERMISSION_MESSAGE,
  MACOS_SPEECH_PERMISSION_MESSAGE,
  MACOS_UPDATE_RESTART_MESSAGE,
} from "./lib/permissions";
import { isMacPlatform, isWindowsPlatform } from "./lib/platform";
import {
  dismissBrowserRecordingBackup,
  createPrivateAgentRewindRecording,
  exportBrowserRecordingBackup,
  getRewindClipOrigin,
  listBrowserRecordingBackups,
  retryBrowserRecordingBackup,
  scheduleNativeBackupCleanupAfterProcessing,
  shouldUseNativeFullscreenRecording,
  startRecording,
  type LocalExportedFile,
  type PendingBrowserRecordingUpload,
  type RecorderHandle,
  type RecorderStopResult,
} from "./lib/recorder";
import { REWIND_AGENT_PROMPT } from "./lib/rewind-agent-prompt";
import { getRewindStatusPresentation } from "./lib/rewind-status";
import {
  loadBool,
  loadString,
  loadStringAllowEmpty,
  saveBool,
  saveString,
} from "./lib/storage";
import {
  canCheckForUpdates,
  installAndRestart,
  isUpdatePendingRestart,
  retryUpdateCheck,
  useUpdateStatus,
  type UpdateStatus,
} from "./lib/updater";
import { normalizeServerUrl } from "./lib/url";
import {
  installDesktopVoiceDictation,
  type VoiceMode,
  type VoiceProvider,
  type VoiceShortcutPreference,
} from "./lib/voice-dictation";
import {
  useFeatureConfig,
  type FeatureConfig,
  type LocalRecordingMode,
  type ScreenMemoryStatus,
} from "./shared/config";

interface PendingNativeUpload {
  kind: "native";
  recordingId: string;
  serverUrl: string;
  folderPath?: string;
  durationMs: number;
  width?: number | null;
  height?: number | null;
  bytes: number;
  hasAudio: boolean;
  hasCamera: boolean;
  savedAt: string;
  lastAttemptAt?: string | null;
  lastError?: string | null;
  retryCount: number;
  corrupt?: boolean;
}

type PendingDesktopUpload = PendingNativeUpload | PendingBrowserRecordingUpload;

type PopoverView =
  | "recorder"
  | "memory"
  | "rewind-settings"
  | "settings"
  | "meetings"
  | "dictation";

interface PopoverMeeting {
  id: string;
  title: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  joinUrl: string | null;
  platform: string | null;
  transcriptStatus: string | null;
}

interface RewindMeetingHistoryAvailability {
  available: boolean;
  reason?: string | null;
  coveredFrom?: string | null;
}

interface RewindAgentHandoffRequest {
  requestId: string;
  status: "pending" | "processing" | "ready" | "declined" | "failed";
  requestedAt: string;
  startAt: string;
  endAt: string;
  durationMs: number;
  reason: string;
  includeMicrophone: boolean;
  includeSystemAudio: boolean;
  reviewRequired: boolean;
  agentClipRetention: "forever" | "24-hours" | "7-days" | "30-days";
  recordingId?: string;
  agentUrl?: string;
  contextUrl?: string;
  expiresAt?: string;
  error?: string;
}

interface RewindExtensionRequest {
  requestId: string;
  recordingId: string;
  seconds: 30 | 300;
  status: "pending" | "processing" | "ready" | "failed";
  updatedAt: string;
  preRollRecordingId?: string;
  actualDurationMs?: number;
  error?: string;
}

interface NativeRewindUploadResult {
  recordingId: string;
  durationMs: number;
}

interface DueRewindAgentHandoff {
  requestId: string;
  recordingId: string;
}

interface LocalRecordingNotice {
  folderPath?: string;
  files: LocalExportedFile[];
}

interface ScreenMemoryExportResult {
  folderPath: string;
  files: Array<{
    path: string;
    fileName: string;
    bytes: number;
    mimeType: string;
  }>;
}

interface RewindEgressEvent {
  requestId: string;
  occurredAt: string;
  state:
    | "prepared"
    | "completed"
    | "failed"
    | "local-evidence-read"
    | "handoff-requested";
  evidenceCount: number;
  packetBytes: number;
  error?: string | null;
  operation?: string | null;
  receipt?: {
    evidence?: Array<{
      id: string;
      momentId: string;
      sourceType: "app-context" | "transcript" | "ocr" | "chapter";
      capturedAt?: string | null;
    }>;
    frames?: Array<{ timestamp: string; segmentId: string }>;
    mediaInterval?: { startAt: string; endAt: string };
    reviewRequired?: boolean;
  } | null;
}

interface RewindLocalAskResult {
  query: string;
  answerSummary: string;
  evidence: Array<{
    id: string;
    sourceType: "app-context" | "transcript" | "ocr";
    capturedAt: string;
    excerpt: string;
    confidence?: number | null;
    segmentId: string;
    offsetMs: number;
  }>;
  coverage: {
    segmentsConsidered: number;
    transcriptIndexesReady: number;
    ocrIndexesReady: number;
    gaps: Array<{
      kind: string;
      source: string;
      startedAt?: string | null;
      endedAt?: string | null;
      detail: string;
    }>;
  };
  confidence: string;
  truncated: boolean;
}

interface RewindExcludedApplication {
  bundleId: string;
  name: string;
  path?: string | null;
  installed: boolean;
}

interface RewindAgentConnectionStatus {
  client: "codex" | "claude-code";
  configured: boolean;
  configPath: string;
  storeDir: string;
}

type MeetingTranscriptionMode = "manual" | "ask" | "auto";

type CaptureMode = "screen" | "screen-camera" | "camera";
type VideoStorageStatus = "checking" | "configured" | "missing";

const STORAGE_SETUP_HELP_TEXT =
  "Clips is 100% free and open source, so you need to hook up a way to store your clips. Connect storage with Builder.io for free-tier storage and AI, or use S3-compatible object storage and your own LLM keys.";
const STORAGE_SETUP_FAILURE_RE =
  /video storage is not connected|no video storage configured|file upload provider|storage provider|connect builder|s3-compatible/i;
const DEFAULT_SCREEN_MEMORY_CONFIG = {
  enabled: false,
  paused: false,
  retentionHours: 8,
  maxBytes: 20 * 1024 * 1024 * 1024,
  segmentSeconds: 5 * 60,
  sampleIntervalSeconds: 10,
  captureMode: "visuals" as const,
  reviewBeforeSending: true,
  autoPreviewBeforeSending: true,
  agentClipRetention: "forever" as const,
  excludedBundleIds: [
    "com.1password.1password",
    "com.agilebits.onepassword7",
    "com.bitwarden.desktop",
    "com.dashlane.dashlane",
    "com.lastpass.lastpass",
  ],
  excludePrivateWindows: false,
};

function parseExcludedBundleIds(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\n,]/)
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
}

function isStorageSetupFailureMessage(message: string | null | undefined) {
  return STORAGE_SETUP_FAILURE_RE.test(message ?? "");
}

const STORAGE_KEY = "clips:server-url";
const MODE_KEY = "clips:last-mode";
const VOICE_SHORTCUT_KEY = "clips:voice-shortcut";
const VOICE_SHORTCUT_CONFIGURED_KEY = "clips:voice-shortcut-configured";
const VOICE_CUSTOM_SHORTCUT_KEY = "clips:voice-custom-shortcut";
const POPOVER_CUSTOM_SHORTCUT_KEY = "clips:popover-custom-shortcut";
const RECORD_CUSTOM_SHORTCUT_KEY = "clips:record-custom-shortcut";
const VOICE_MODE_KEY = "clips:voice-mode";
const VOICE_PROVIDER_KEY = "clips:voice-provider";
const VOICE_INSTRUCTIONS_KEY = "clips:voice-instructions";
const AUTH_TOKEN_KEY = "clips:auth-token";
const SOURCE_KEY = "clips:last-source";
const CAM_ON_KEY = "clips:camera-on";
const MIC_ON_KEY = "clips:mic-on";
const SYSTEM_AUDIO_KEY = "clips:system-audio";
const READINESS_REVIEWED_KEY = "clips:readiness-reviewed";

// Sensible defaults so the user never has to type a URL on first launch.
// Dev builds point at the local dev server; production builds point at the
// hosted Clips instance. The user can still override from Settings.
// Dev points at the Clips dev server (shared-app-config says 8094).
// Prod points at the hosted Clips instance. User can override from Settings.
const DEFAULT_URL = import.meta.env.DEV
  ? "http://localhost:8094"
  : "https://clips.agent-native.com";

function normalizeCaptureSource(value: string): CaptureSource {
  if (value === "region" && isMacPlatform()) return "region";
  return value === "window" ? "window" : "full-screen";
}

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

let authFetchInstalled = false;
let currentServerOrigin = "";
let currentAuthToken = "";

function originForUrl(value: string, base?: string): string | null {
  try {
    return new URL(value, base).origin;
  } catch {
    return null;
  }
}

function originForServer(serverUrl: string): string {
  return originForUrl(serverUrl) ?? serverUrl.trim().replace(/\/+$/, "");
}

function serverUrlForPendingUpload(
  upload: PendingDesktopUpload,
  currentServerUrl: string,
): string {
  const normalizedCurrent = normalizeServerUrl(currentServerUrl);
  return normalizedCurrent || normalizeServerUrl(upload.serverUrl || "");
}

// "configured"/"missing" are definitive answers from the server; "unknown"
// means the check could not be completed (network error, unreachable server, or
// an unparseable/non-OK response). An "unknown" result must never downgrade an
// already-connected user to the setup flow.
type VideoStorageProbe = "configured" | "missing" | "unknown";

async function hasConfiguredVideoStorage(
  serverUrl: string,
): Promise<VideoStorageProbe> {
  const base = serverUrl.replace(/\/+$/, "");

  // Track whether any endpoint gave a definitive answer. If both checks throw
  // or return non-OK/unparseable responses, we can't tell and return "unknown".
  let sawDefinitiveAnswer = false;

  try {
    const uploadStatus = await fetch(
      `${base}/_agent-native/file-upload/status`,
      {
        credentials: "include",
        cache: "no-store",
      },
    );
    if (uploadStatus.ok) {
      const body = (await uploadStatus.json().catch(() => null)) as {
        configured?: boolean;
      } | null;
      if (body) {
        sawDefinitiveAnswer = true;
        if (body.configured) return "configured";
      }
    }
  } catch {
    // Fall through to the Builder status endpoint.
  }

  try {
    const builderStatus = await fetch(`${base}/_agent-native/builder/status`, {
      credentials: "include",
      cache: "no-store",
    });
    if (builderStatus.ok) {
      const body = (await builderStatus.json().catch(() => null)) as {
        configured?: boolean;
      } | null;
      if (body) {
        sawDefinitiveAnswer = true;
        if (body.configured) return "configured";
      }
    }
  } catch {
    // Network error or unreachable server — treat as indeterminate below.
  }

  return sawDefinitiveAnswer ? "missing" : "unknown";
}

function authTokenStorageKey(serverUrl: string): string {
  return `${AUTH_TOKEN_KEY}:${originForServer(serverUrl)}`;
}

function loadDesktopAuthToken(serverUrl: string): string {
  return loadString(authTokenStorageKey(serverUrl), "");
}

function setDesktopAuthContext(serverUrl: string, token: string): void {
  currentServerOrigin = originForServer(serverUrl);
  currentAuthToken = token.trim();
}

function saveDesktopAuthToken(serverUrl: string, token: string): void {
  const trimmed = token.trim();
  if (!trimmed) return;
  saveString(authTokenStorageKey(serverUrl), trimmed);
  setDesktopAuthContext(serverUrl, trimmed);
}

function clearDesktopAuthToken(serverUrl: string): void {
  saveString(authTokenStorageKey(serverUrl), "");
  if (currentServerOrigin === originForServer(serverUrl)) {
    currentAuthToken = "";
  }
}

function urlForFetchInput(input: FetchInput): string | null {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.url;
  }
  return null;
}

function installAuthFetchInterceptor(): void {
  if (authFetchInstalled || typeof window === "undefined") return;
  authFetchInstalled = true;
  const nativeFetch = window.fetch.bind(window);

  window.fetch = (input: FetchInput, init?: FetchInit) => {
    const rawUrl = urlForFetchInput(input);
    const targetOrigin = rawUrl
      ? originForUrl(rawUrl, window.location.href)
      : null;
    if (!targetOrigin || targetOrigin !== currentServerOrigin) {
      return nativeFetch(input, init);
    }

    const requestHeaders =
      typeof Request !== "undefined" && input instanceof Request
        ? input.headers
        : undefined;
    const headers = new Headers(init?.headers ?? requestHeaders);
    if (!headers.has("X-Request-Source")) {
      headers.set("X-Request-Source", "clips-desktop");
    }
    if (currentAuthToken && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${currentAuthToken}`);
    }
    return nativeFetch(input, { ...init, headers });
  };
}

type ByokVoiceProvider = Extract<VoiceProvider, "gemini" | "groq">;
type VoiceProviderMode = "native" | "whisper" | "builder" | "byok";
type MacosPrivacyPane =
  | "camera"
  | "microphone"
  | "screen"
  | "speech"
  | "accessibility"
  | "input-monitoring";

const MACOS_PRIVACY_URLS: Record<MacosPrivacyPane, string> = {
  camera:
    "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Camera",
  microphone:
    "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone",
  screen:
    "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture",
  speech:
    "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_SpeechRecognition",
  accessibility:
    "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility",
  "input-monitoring":
    "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ListenEvent",
};

const WINDOWS_PRIVACY_URLS: Partial<Record<MacosPrivacyPane, string>> = {
  camera: "ms-settings:privacy-webcam",
  microphone: "ms-settings:privacy-microphone",
  // No dedicated screen-capture privacy page that works on all Windows
  // versions, so open the top-level Privacy settings page.
  screen: "ms-settings:privacy",
  speech: "ms-settings:privacy-speechtyping",
  accessibility: "ms-settings:easeofaccess",
  "input-monitoring": "ms-settings:privacy",
};

function openPrivacySettings(pane: MacosPrivacyPane): void {
  if (isMacPlatform()) {
    invoke("open_macos_privacy_settings", { pane }).catch((nativeErr) => {
      console.warn(
        "[clips-tray] native macOS privacy settings open failed; falling back:",
        nativeErr,
      );
      openExternal(MACOS_PRIVACY_URLS[pane]).catch((err) => {
        console.error("[clips-tray] open macOS privacy settings failed:", err);
      });
    });
    return;
  }
  if (isWindowsPlatform()) {
    const url = WINDOWS_PRIVACY_URLS[pane];
    if (url) {
      openExternal(url).catch((err) => {
        console.error(
          "[clips-tray] open Windows privacy settings failed:",
          err,
        );
      });
    }
    return;
  }
}

function nativeVoiceProvider(): VoiceProvider {
  return isMacPlatform() ? "macos-native" : "browser";
}

function isByokVoiceProvider(value: VoiceProvider): value is ByokVoiceProvider {
  return value === "gemini" || value === "groq";
}

function voiceProviderMode(value: VoiceProvider): VoiceProviderMode {
  if (isByokVoiceProvider(value)) return "byok";
  if (value === "builder" || value === "builder-gemini") return "builder";
  if (value === "whisper") return "whisper";
  return "native";
}

function normalizeVoiceProvider(value: string): VoiceProvider {
  const native = nativeVoiceProvider();
  if (value === "auto") return native;
  if (value === "builder") return "builder-gemini";
  if (value === "macos-native" && !isMacPlatform()) return "browser";
  // Symmetric migration: a persisted "browser" preference from a non-Mac
  // install (or an older build) silently ran native transcription on Mac
  // via resolveProvider()'s mic-override branch with zero UI indication.
  // Normalize the stale value at the source instead (D1).
  if (value === "browser" && isMacPlatform()) return "macos-native";
  return value === "browser" ||
    value === "macos-native" ||
    value === "whisper" ||
    value === "builder-gemini" ||
    value === "gemini" ||
    value === "groq"
    ? value
    : native;
}

function formatAgo(iso: string): string {
  try {
    const delta = (Date.now() - new Date(iso).getTime()) / 1000;
    if (delta < 60) return "just now";
    if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
    if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
    return `${Math.floor(delta / 86400)}d ago`;
  } catch {
    return "";
  }
}

function formatMeetingWhen(meeting: PopoverMeeting): string {
  const startMs = Date.parse(meeting.scheduledStart ?? "");
  if (Number.isNaN(startMs)) return "Upcoming";

  const endMs = Date.parse(meeting.scheduledEnd ?? "");
  const now = Date.now();
  if (startMs <= now && (Number.isNaN(endMs) || endMs >= now)) {
    return "Now";
  }

  if (startMs > now && startMs - now < 60 * 60 * 1000) {
    return `in ${Math.max(1, Math.round((startMs - now) / 60000))}m`;
  }

  const start = new Date(startMs);
  const time = start.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const today = new Date(now);
  const tomorrow = new Date(now + 24 * 60 * 60 * 1000);
  if (start.toDateString() === today.toDateString()) return `Today ${time}`;
  if (start.toDateString() === tomorrow.toDateString()) {
    return `Tomorrow ${time}`;
  }

  return `${start.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  })} ${time}`;
}

function meetingCanStartNotes(meeting: PopoverMeeting): boolean {
  const startMs = Date.parse(meeting.scheduledStart ?? "");
  if (Number.isNaN(startMs)) return false;
  const endMs = Date.parse(meeting.scheduledEnd ?? "");
  const now = Date.now();
  return (
    startMs <= now + 10 * 60 * 1000 && (Number.isNaN(endMs) || endMs >= now)
  );
}

function voiceShortcutLabel(
  shortcut: VoiceShortcutPreference,
  customShortcut: string,
): string {
  switch (shortcut) {
    case "fn":
      return "Fn";
    case "cmd-shift-space":
      return "Cmd+Shift+Space";
    case "ctrl-shift-space":
      return "Ctrl+Shift+Space";
    case "custom":
      return customShortcut || "Custom shortcut";
    case "both":
      return "Fn, Cmd+Shift+Space, or Ctrl+Shift+Space";
  }
}

function voiceProviderLabel(provider: VoiceProvider): string {
  if (provider === "whisper") return "Local Whisper";
  if (provider === "builder" || provider === "builder-gemini") {
    return "Builder.io cleanup";
  }
  if (provider === "gemini") return "Google Gemini";
  if (provider === "groq") return "Groq";
  if (provider === "macos-native") return "macOS on-device";
  return "Browser speech";
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function measurePopoverHeight(el: HTMLElement): number {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  const borderY =
    Number.parseFloat(style.borderTopWidth || "0") +
    Number.parseFloat(style.borderBottomWidth || "0");

  const candidates = [rect.height, el.scrollHeight + borderY];

  // When a direct child is the scrollable content pane, the shell's own
  // scrollHeight already includes the fixed footer but excludes content that
  // is hidden inside that child. Add only that hidden delta to the shell
  // baseline. Measuring the child's full height alone would omit the footer
  // and leave the resumed recorder window partially clipped.
  const directChildOverflow = Array.from(el.children).reduce((total, child) => {
    if (!(child instanceof HTMLElement)) return total;
    return total + Math.max(0, child.scrollHeight - child.clientHeight);
  }, 0);
  candidates.push(el.scrollHeight + borderY + directChildOverflow);

  // ResizeObserver on `.app` alone misses scroll-only and absolutely
  // positioned growth. Measure descendant bounds so menus, banners, and
  // settings sections can grow the native window even when `.app` is capped
  // by the current viewport height.
  let lowestBottom = rect.bottom;
  for (const child of Array.from(el.querySelectorAll<HTMLElement>("*"))) {
    const childStyle = window.getComputedStyle(child);
    if (childStyle.display === "none") continue;
    const childRect = child.getBoundingClientRect();
    if (childRect.width === 0 && childRect.height === 0) continue;
    lowestBottom = Math.max(lowestBottom, childRect.bottom);

    // Recorder Home deliberately keeps its footer fixed and lets the content
    // region scroll when the native window is short. A newly inserted row can
    // therefore grow `child.scrollHeight` without changing any descendant's
    // visible bounding box. Include that hidden overflow in the desired
    // window height so a state transition (for example paused -> remembering)
    // can grow the popover back to its natural size.
    const childBorderY =
      Number.parseFloat(childStyle.borderTopWidth || "0") +
      Number.parseFloat(childStyle.borderBottomWidth || "0");
    candidates.push(
      childRect.top - rect.top + child.scrollHeight + childBorderY,
    );
  }
  candidates.push(lowestBottom - rect.top);

  return Math.ceil(Math.max(...candidates));
}

function usePopoverAutoSize(
  ref: RefObject<HTMLElement | null>,
  options: { disabled: boolean; width: number },
): void {
  const { disabled, width } = options;

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;

    let animationFrame = 0;
    let settleTimer = 0;
    let lastHeight = 0;
    let lastWidth = 0;

    const push = () => {
      animationFrame = 0;
      const height = measurePopoverHeight(el);
      if (
        height > 0 &&
        (Math.abs(height - lastHeight) >= 2 || Math.abs(width - lastWidth) >= 1)
      ) {
        lastHeight = height;
        lastWidth = width;
        invoke("resize_popover", { height, width }).catch(() => {});
      }
    };

    const schedule = () => {
      if (!animationFrame) {
        animationFrame = window.requestAnimationFrame(push);
      }
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(push, 80);
    };

    const resizeObserver = new ResizeObserver(schedule);
    const observeTree = () => {
      resizeObserver.disconnect();
      resizeObserver.observe(el);
      for (const child of Array.from(el.querySelectorAll<HTMLElement>("*"))) {
        resizeObserver.observe(child);
      }
    };

    const mutationObserver = new MutationObserver(() => {
      observeTree();
      schedule();
    });

    observeTree();
    mutationObserver.observe(el, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    schedule();

    if (document.fonts) {
      document.fonts.ready.then(schedule).catch(() => {});
    }

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(settleTimer);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [disabled, ref, width]);
}

export function App() {
  const featureConfig = useFeatureConfig();
  const [serverUrl, setServerUrl] = useState<string>(() =>
    loadString(STORAGE_KEY, DEFAULT_URL).replace(/\/+$/, ""),
  );
  const [mode, setMode] = useState<CaptureMode>(
    () => loadString(MODE_KEY, "screen-camera") as CaptureMode,
  );
  const [source, setSource] = useState<CaptureSource>(() =>
    normalizeCaptureSource(loadString(SOURCE_KEY, "full-screen")),
  );
  const [cameraOn, setCameraOn] = useState<boolean>(() =>
    loadBool(CAM_ON_KEY, false),
  );
  const [micOn, setMicOn] = useState<boolean>(() => loadBool(MIC_ON_KEY, true));
  const [systemAudioOn, setSystemAudioOn] = useState<boolean>(() =>
    loadBool(SYSTEM_AUDIO_KEY, true),
  );
  const [voiceShortcut, setVoiceShortcut] = useState<VoiceShortcutPreference>(
    () => {
      if (!loadBool(VOICE_SHORTCUT_CONFIGURED_KEY, false)) {
        return "cmd-shift-space";
      }
      const saved = loadString(VOICE_SHORTCUT_KEY, "cmd-shift-space");
      return saved === "fn" ||
        saved === "cmd-shift-space" ||
        saved === "ctrl-shift-space" ||
        saved === "custom" ||
        saved === "both"
        ? saved
        : "cmd-shift-space";
    },
  );
  const [voiceCustomShortcut, setVoiceCustomShortcut] = useState<string>(() =>
    loadStringAllowEmpty(VOICE_CUSTOM_SHORTCUT_KEY, "Cmd+Shift+D"),
  );
  const [popoverCustomShortcut, setPopoverCustomShortcut] = useState<string>(
    () => loadStringAllowEmpty(POPOVER_CUSTOM_SHORTCUT_KEY, ""),
  );
  const [recordCustomShortcut, setRecordCustomShortcut] = useState<string>(() =>
    loadStringAllowEmpty(RECORD_CUSTOM_SHORTCUT_KEY, ""),
  );
  const [voiceMode, setVoiceMode] = useState<VoiceMode>(() => {
    const saved = loadString(VOICE_MODE_KEY, "push-to-talk");
    return saved === "toggle" ? "toggle" : "push-to-talk";
  });
  const [voiceProvider, setVoiceProvider] = useState<VoiceProvider>(() => {
    return normalizeVoiceProvider(
      loadString(VOICE_PROVIDER_KEY, nativeVoiceProvider()),
    );
  });
  const [voiceInstructions, setVoiceInstructions] = useState<string>(() =>
    loadString(VOICE_INSTRUCTIONS_KEY, ""),
  );
  const localRecordingMode: LocalRecordingMode =
    featureConfig?.localRecordingMode ?? "off";

  const [pendingUploads, setPendingUploads] = useState<PendingDesktopUpload[]>(
    [],
  );
  const [retryingUploadId, setRetryingUploadId] = useState<string | null>(null);
  const [exportingUploadId, setExportingUploadId] = useState<string | null>(
    null,
  );
  const [dismissingUploadId, setDismissingUploadId] = useState<string | null>(
    null,
  );
  const [localRecordingNotice, setLocalRecordingNotice] =
    useState<LocalRecordingNotice | null>(null);
  const [popoverView, setPopoverView] = useState<PopoverView>("recorder");
  const [rewindSettingsReturnView, setRewindSettingsReturnView] = useState<
    "recorder" | "settings"
  >("recorder");
  const [homeScreenMemoryStatus, setHomeScreenMemoryStatus] =
    useState<ScreenMemoryStatus | null>(null);
  const [homeScreenMemoryBusy, setHomeScreenMemoryBusy] = useState(false);
  const [rewindAgentPromptCopied, setRewindAgentPromptCopied] = useState(false);
  const [agentHandoff, setAgentHandoff] =
    useState<RewindAgentHandoffRequest | null>(null);
  const agentHandoffProcessingRef = useRef<string | null>(null);
  const agentHandoffPreviewedRef = useRef<Set<string>>(new Set());
  const rewindExtensionProcessingRef = useRef<Set<string>>(new Set());
  const [agentHandoffPreviewBusy, setAgentHandoffPreviewBusy] = useState(false);
  const [agentHandoffPreviewError, setAgentHandoffPreviewError] = useState<
    string | null
  >(null);
  const [promptRewindEnable, setPromptRewindEnable] = useState(false);
  const [meetings, setMeetings] = useState<PopoverMeeting[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(false);
  const [meetingsError, setMeetingsError] = useState<string | null>(null);
  const [meetingStartMessage, setMeetingStartMessage] = useState<string | null>(
    null,
  );
  const [
    rewindMeetingHistoryAvailability,
    setRewindMeetingHistoryAvailability,
  ] = useState<Record<string, RewindMeetingHistoryAvailability>>({});
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);
  const [readinessOpen, setReadinessOpen] = useState<boolean>(
    () => !loadBool(READINESS_REVIEWED_KEY, false),
  );
  const [recorder, setRecorder] = useState<RecorderHandle | null>(null);
  const [recError, setRecError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [shortcutRegistrationError, setShortcutRegistrationError] = useState<
    string | null
  >(null);
  // Latched true the moment the user clicks Start Recording and cleared
  // when the recorder fully stops/cancels. We use this to suppress the
  // popover auto-hide during the macOS screen-picker focus dance.
  const [recordingFlowActive, setRecordingFlowActive] = useState(false);
  const [recordingStopFinalizing, setRecordingStopFinalizing] = useState(false);
  const [lastRecordingId, setLastRecordingId] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<"unknown" | "authed" | "anon">(
    "unknown",
  );
  const [videoStorageStatus, setVideoStorageStatus] =
    useState<VideoStorageStatus>("checking");
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [signInPending, setSignInPending] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  // Ref-based lock so two fast clicks cannot both enter signInExternal()
  // (state updates are async; refs are synchronous).
  const signInInflightRef = useRef(false);
  // Stored so Cancel can stop the polling loop.
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRecording = recorder !== null;
  // Whether the popover window is shown; driven by the visibility effect below.
  const [popoverVisible, setPopoverVisible] = useState(false);
  const homeRewindPresentation = getRewindStatusPresentation({
    status: homeScreenMemoryStatus,
    config: featureConfig?.screenMemory ?? DEFAULT_SCREEN_MEMORY_CONFIG,
    clipRecordingActive: isRecording || recordingFlowActive,
  });
  useEffect(() => {
    if (featureConfig?.screenMemory?.enabled !== true) {
      setHomeScreenMemoryStatus(null);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      invoke<ScreenMemoryStatus>("screen_memory_status")
        .then((status) => {
          if (!cancelled) setHomeScreenMemoryStatus(status);
        })
        .catch(() => {});
    };
    refresh();
    const timer = window.setInterval(refresh, popoverVisible ? 5_000 : 30_000);
    let unlisten: (() => void) | undefined;
    listen("clips:screen-memory-changed", refresh)
      .then((stopListening) => {
        if (cancelled) {
          stopListening();
          return;
        }
        unlisten = stopListening;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      unlisten?.();
    };
  }, [featureConfig?.screenMemory?.enabled, popoverVisible]);
  const recordShortcutHandlerRef = useRef<() => void>(() => {});
  // Mirrors `bubbleActive` (assigned below once it is computed) so device
  // probes can synchronously tell whether the camera bubble owns the grant.
  const bubbleActiveRef = useRef(false);
  const {
    cameraId,
    setCameraId,
    micId,
    setMicId,
    cameraLabel,
    setCameraLabel,
    micLabel,
    setMicLabel,
    selectedMicId,
    selectedMicLabel,
    cameraDevices,
    micDevices,
    loadDevices,
    requestDeviceAccess,
  } = useMediaDevices({
    bubbleActiveRef,
    popoverVisible,
    setCameraError,
    setRecError,
  });
  const voiceDictationEnabled = featureConfig?.voiceEnabled !== false;
  const fnShortcutEnabled =
    voiceDictationEnabled &&
    (voiceShortcut === "fn" || voiceShortcut === "both");
  const updateVoiceShortcut = useCallback((value: VoiceShortcutPreference) => {
    saveBool(VOICE_SHORTCUT_CONFIGURED_KEY, true);
    setVoiceShortcut(value);
  }, []);

  useEffect(() => {
    installAuthFetchInterceptor();
    setDesktopAuthContext(serverUrl, loadDesktopAuthToken(serverUrl));
  }, [serverUrl]);

  const refreshVideoStorageStatus = useCallback(async () => {
    if (authStatus !== "authed" || localRecordingMode !== "off") {
      setVideoStorageStatus("configured");
      return true;
    }

    setVideoStorageStatus((prev) => (prev === "missing" ? prev : "checking"));
    const probe = await hasConfiguredVideoStorage(serverUrl);
    if (probe === "unknown") {
      // The check couldn't be completed (offline/unreachable). Never downgrade
      // an already-connected user to "missing" on an indeterminate result;
      // preserve the last known status and let the poll retry. If we never
      // determined a status, fall back to "checking" so the poll keeps trying
      // rather than hard-blocking the record button.
      setVideoStorageStatus((prev) =>
        prev === "configured" || prev === "missing" ? prev : "checking",
      );
      return false;
    }
    setVideoStorageStatus(probe);
    return probe === "configured";
  }, [authStatus, localRecordingMode, serverUrl]);

  useEffect(() => {
    void refreshVideoStorageStatus();
  }, [refreshVideoStorageStatus]);

  useEffect(() => {
    if (
      authStatus !== "authed" ||
      localRecordingMode !== "off" ||
      // Re-poll while storage is "missing" (server may become configured) and
      // while still "checking" (an indeterminate/unreachable first probe should
      // keep retrying instead of hard-blocking the record button).
      (videoStorageStatus !== "missing" && videoStorageStatus !== "checking")
    ) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshVideoStorageStatus();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [
    authStatus,
    localRecordingMode,
    refreshVideoStorageStatus,
    videoStorageStatus,
  ]);

  useEffect(() => {
    return installDesktopVoiceDictation({
      enabled: voiceDictationEnabled,
      serverUrl,
      shortcut: voiceShortcut,
      mode: voiceMode,
      provider: voiceProvider,
      micDeviceId: selectedMicId || null,
      micDeviceLabel: selectedMicLabel || null,
      instructions: voiceInstructions,
    });
  }, [
    serverUrl,
    voiceShortcut,
    voiceDictationEnabled,
    voiceMode,
    voiceProvider,
    selectedMicId,
    selectedMicLabel,
    voiceInstructions,
  ]);

  useEffect(() => {
    invoke("set_fn_shortcut_enabled", { enabled: fnShortcutEnabled }).catch(
      (err) => {
        console.warn("[clips-tray] set_fn_shortcut_enabled failed:", err);
      },
    );
  }, [fnShortcutEnabled]);

  useEffect(() => {
    let cancelled = false;
    invoke("set_custom_shortcuts", {
      voice: voiceShortcut === "custom" ? voiceCustomShortcut : null,
      popover: popoverCustomShortcut.trim() ? popoverCustomShortcut : null,
      record: recordCustomShortcut.trim() ? recordCustomShortcut : null,
    })
      .then(() => {
        if (!cancelled) setShortcutRegistrationError(null);
      })
      .catch((err) => {
        console.warn("[clips-tray] set_custom_shortcuts failed:", err);
        if (!cancelled) {
          setShortcutRegistrationError(
            err instanceof Error ? err.message : String(err),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    popoverCustomShortcut,
    recordCustomShortcut,
    voiceCustomShortcut,
    voiceShortcut,
  ]);

  // ---- auth status --------------------------------------------------------
  // The Tauri WebView has its own cookie jar (separate from the user's
  // browser). Before anything else, check whether we have a session cookie
  // for the Clips server; if not, surface a Sign in button.
  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch(
        `${serverUrl.replace(/\/+$/, "")}/_agent-native/auth/session`,
        { credentials: "include" },
      );
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          clearDesktopAuthToken(serverUrl);
        }
        setAuthStatus("anon");
        setSignedInAs(null);
        return false;
      }
      const json = (await res.json().catch(() => null)) as {
        email?: string;
        token?: string;
        error?: string;
      } | null;
      if (json?.email) {
        if (json.token) saveDesktopAuthToken(serverUrl, json.token);
        setAuthStatus("authed");
        setSignedInAs(json.email);
        return true;
      }
      setAuthStatus("anon");
      setSignedInAs(null);
      clearDesktopAuthToken(serverUrl);
      return false;
    } catch {
      setAuthStatus("anon");
      setSignedInAs(null);
      return false;
    }
  }, [serverUrl]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Push the current server URL to the Rust meetings watcher so it can
  // poll the backend for upcoming events. The watcher no-ops until this
  // fires — we re-push on every server-url change so a settings tweak
  // flows through immediately.
  useEffect(() => {
    invoke("meetings_watcher_set_server_url", { serverUrl }).catch(() => {
      // Command may be missing on older builds — best-effort.
    });
  }, [serverUrl]);

  // The Rust-side meetings watcher fetches the backend with `reqwest`, which
  // does NOT inherit the popover WebView's cookie jar or fetch interceptor.
  // We forward both the legacy cookie string and the desktop bearer token.
  // Re-push on:
  //   - boot
  //   - sign-in / sign-out (signedInAs change)
  //   - the watcher emitting `meetings:auth-needed` (401) — usually means
  //     the cookie expired and we need to send a fresh one.
  useEffect(() => {
    function pushSession() {
      const cookie =
        typeof document !== "undefined" ? document.cookie || "" : "";
      const authToken = loadDesktopAuthToken(serverUrl);
      invoke("meetings_watcher_set_session", { cookie, authToken }).catch(
        () => {
          // Older builds may not expose this command yet — best-effort.
        },
      );
    }
    pushSession();
    let unlisten: (() => void) | null = null;
    listen("meetings:auth-needed", () => {
      console.warn("[clips-popover] meetings:auth-needed — re-pushing session");
      pushSession();
    })
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {});
    return () => {
      if (unlisten) {
        try {
          unlisten();
        } catch {
          // ignore
        }
      }
    };
  }, [signedInAs, serverUrl]);

  // Tray "Upcoming Meetings" submenu click → open that meeting's notes page in
  // the browser. The rich meeting UI (transcript + AI notes) lives in the web
  // app, not this popover, so we deep-link to it. Without this listener the
  // tray click emitted `meetings:open` into the void and nothing happened.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<{ meetingId?: string }>("meetings:open", (ev) => {
      const id = ev.payload?.meetingId;
      if (!id) return;
      const base = serverUrl.replace(/\/+$/, "");
      const url = `${base}/meetings/${encodeURIComponent(id)}`;
      import("@tauri-apps/plugin-shell")
        .then(({ open }) => open(url))
        .catch((err) => {
          console.error("[clips-popover] open meeting failed:", err);
        });
    })
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {});
    return () => {
      if (unlisten) {
        try {
          unlisten();
        } catch {
          // ignore
        }
      }
    };
  }, [serverUrl]);

  // Open meeting join URLs (Zoom / Meet / Teams) when the meeting
  // notification banner asks. Centralized here so any future surface that
  // emits `meetings:open-join-url` works the same way.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<{ joinUrl?: string | null }>("meetings:open-join-url", (ev) => {
      const url = ev.payload?.joinUrl;
      if (!url) return;
      openMeetingJoinUrl(url).catch((err) => {
        console.error("[clips-popover] open join url failed:", err);
      });
    })
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {});
    return () => {
      if (unlisten) {
        try {
          unlisten();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  const callClipsAction = useCallback(
    async <T,>(
      name: string,
      body: Record<string, unknown>,
      opts?: { method?: "GET" | "POST"; signal?: AbortSignal },
    ): Promise<T> => {
      const base = serverUrl.replace(/\/+$/, "");
      const method = opts?.method ?? "POST";
      const headers = new Headers();
      const authToken = loadDesktopAuthToken(serverUrl);
      if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
      // GET actions read their args from the query string; POST actions send a
      // JSON body.
      let url = `${base}/_agent-native/actions/${name}`;
      let requestBody: string | undefined;
      if (method === "GET") {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(body)) {
          if (value != null) params.set(key, String(value));
        }
        const qs = params.toString();
        if (qs) url += `?${qs}`;
      } else {
        headers.set("Content-Type", "application/json");
        requestBody = JSON.stringify(body);
      }
      const response = await fetch(url, {
        method,
        credentials: "include",
        headers,
        body: requestBody,
        signal: opts?.signal,
      });
      const text = await response.text().catch(() => "");
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        // Keep text fallback below.
      }
      if (!response.ok) {
        const message =
          json?.error ||
          json?.message ||
          (response.status === 401
            ? "Sign in to transcribe meetings."
            : text.slice(0, 180) || `Request failed (${response.status})`);
        throw new Error(message);
      }
      return (json?.result ?? json) as T;
    },
    [serverUrl],
  );

  const updateAgentHandoff = useCallback(
    async (
      requestId: string,
      status: RewindAgentHandoffRequest["status"],
      result?: Record<string, unknown>,
      error?: string,
    ) => {
      await invoke("screen_memory_update_agent_handoff", {
        requestId,
        status,
        result: result ?? null,
        error: error ?? null,
      });
    },
    [],
  );

  const previewAgentHandoff = useCallback(
    async (request: RewindAgentHandoffRequest) => {
      setAgentHandoffPreviewBusy(true);
      setAgentHandoffPreviewError(null);
      try {
        await invoke("rewind_agent_handoff_preview", {
          requestId: request.requestId,
          startedAt: request.startAt,
          endedAt: request.endAt,
          includeMic: request.includeMicrophone,
          includeSystemAudio: request.includeSystemAudio,
        });
      } catch (error) {
        setAgentHandoffPreviewError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setAgentHandoffPreviewBusy(false);
      }
    },
    [],
  );

  const processAgentHandoff = useCallback(
    async (request: RewindAgentHandoffRequest) => {
      if (agentHandoffProcessingRef.current === request.requestId) return;
      agentHandoffProcessingRef.current = request.requestId;
      const processing = { ...request, status: "processing" as const };
      setAgentHandoff(processing);
      let recordingId: string | null = null;
      try {
        await updateAgentHandoff(request.requestId, "processing");
        const hasAudio =
          request.includeMicrophone || request.includeSystemAudio;
        const recording = await createPrivateAgentRewindRecording(
          serverUrl,
          hasAudio,
          request.startAt,
        );
        recordingId = recording.id;
        await invoke("rewind_agent_handoff_upload", {
          requestId: request.requestId,
          startedAt: request.startAt,
          endedAt: request.endAt,
          serverUrl,
          recordingId,
          authToken: loadDesktopAuthToken(serverUrl),
          cookie: typeof document !== "undefined" ? document.cookie || "" : "",
          uploadMode: recording.uploadMode,
          includeMic: request.includeMicrophone,
          includeSystemAudio: request.includeSystemAudio,
        });

        const retentionHours = {
          forever: null,
          "24-hours": 24,
          "7-days": 7 * 24,
          "30-days": 30 * 24,
        }[request.agentClipRetention];
        const autoDeleteAt = retentionHours
          ? new Date(
              Date.now() + retentionHours * 60 * 60 * 1_000,
            ).toISOString()
          : null;
        await callClipsAction("update-recording", {
          id: recordingId,
          ...(autoDeleteAt ? { expiresAt: autoDeleteAt } : {}),
        });
        const link = await callClipsAction<{
          recordingId: string;
          url: string;
          contextUrl: string;
          expiresAt: string;
        }>("create-recording-agent-link", { recordingId });
        const ready: RewindAgentHandoffRequest = {
          ...processing,
          status: "ready",
          recordingId,
          agentUrl: link.url,
          contextUrl: link.contextUrl,
          expiresAt: link.expiresAt,
        };
        await updateAgentHandoff(request.requestId, "ready", {
          recordingId,
          agentUrl: link.url,
          contextUrl: link.contextUrl,
          expiresAt: link.expiresAt,
          ...(autoDeleteAt ? { autoDeleteAt } : {}),
        });
        setAgentHandoff(ready);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (recordingId) {
          await callClipsAction("trash-recording", {
            id: recordingId,
            skipIfReady: true,
          }).catch(() => {});
        }
        await updateAgentHandoff(
          request.requestId,
          "failed",
          undefined,
          message,
        ).catch(() => {});
        setAgentHandoff({ ...processing, status: "failed", error: message });
      } finally {
        agentHandoffProcessingRef.current = null;
      }
    },
    [callClipsAction, serverUrl, updateAgentHandoff],
  );

  const processRewindExtension = useCallback(
    async (request: RewindExtensionRequest) => {
      if (rewindExtensionProcessingRef.current.has(request.requestId)) return;
      rewindExtensionProcessingRef.current.add(request.requestId);
      let preRollRecordingId: string | null = null;
      try {
        const origin = getRewindClipOrigin(request.recordingId);
        if (!origin) {
          throw new Error(
            "Clips Alpha no longer has the local start time for this Clip.",
          );
        }
        const endedAtMs = Date.parse(origin.startedAt);
        if (!Number.isFinite(endedAtMs)) {
          throw new Error("The original Clip start time is invalid.");
        }
        await callClipsAction("update-rewind-extension-request", {
          recordingId: request.recordingId,
          requestId: request.requestId,
          status: "processing",
        });
        const startedAt = new Date(
          endedAtMs - request.seconds * 1_000,
        ).toISOString();
        const recording = await createPrivateAgentRewindRecording(
          serverUrl,
          origin.includeMicrophone || origin.includeSystemAudio,
          startedAt,
        );
        preRollRecordingId = recording.id;
        const upload = await invoke<NativeRewindUploadResult>(
          "rewind_agent_handoff_upload",
          {
            requestId: `handoff-${request.requestId}`,
            startedAt,
            endedAt: origin.startedAt,
            serverUrl,
            recordingId: recording.id,
            authToken: loadDesktopAuthToken(serverUrl),
            cookie:
              typeof document !== "undefined" ? document.cookie || "" : "",
            uploadMode: recording.uploadMode,
            includeMic: origin.includeMicrophone,
            includeSystemAudio: origin.includeSystemAudio,
          },
        );
        await callClipsAction("update-rewind-extension-request", {
          recordingId: request.recordingId,
          requestId: request.requestId,
          status: "ready",
          preRollRecordingId: recording.id,
          actualDurationMs: Math.round(upload.durationMs),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (preRollRecordingId) {
          await callClipsAction("trash-recording", {
            id: preRollRecordingId,
            skipIfReady: true,
          }).catch(() => {});
        }
        await callClipsAction("update-rewind-extension-request", {
          recordingId: request.recordingId,
          requestId: request.requestId,
          status: "failed",
          error: message,
        }).catch(() => {});
      } finally {
        rewindExtensionProcessingRef.current.delete(request.requestId);
      }
    },
    [callClipsAction, serverUrl],
  );

  useEffect(() => {
    if (
      authStatus !== "authed" ||
      featureConfig?.screenMemory?.enabled !== true
    ) {
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const result = await callClipsAction<{
        requests?: RewindExtensionRequest[];
      }>("list-rewind-extension-requests", {}, { method: "GET" }).catch(
        () => null,
      );
      if (cancelled) return;
      for (const request of result?.requests ?? []) {
        void processRewindExtension(request);
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    authStatus,
    callClipsAction,
    featureConfig?.screenMemory?.enabled,
    processRewindExtension,
  ]);

  useEffect(() => {
    if (featureConfig?.screenMemory?.enabled !== true || agentHandoff) return;
    let cancelled = false;
    const poll = () => {
      invoke<RewindAgentHandoffRequest | null>(
        "screen_memory_next_agent_handoff",
      )
        .then((request) => {
          if (cancelled || !request) return;
          setAgentHandoff(request);
          getCurrentWindow()
            .show()
            .catch(() => {});
          getCurrentWindow()
            .setFocus()
            .catch(() => {});
          if (!request.reviewRequired) {
            void processAgentHandoff(request);
          } else if (
            featureConfig?.screenMemory?.autoPreviewBeforeSending !== false &&
            !agentHandoffPreviewedRef.current.has(request.requestId)
          ) {
            // Polling and config refreshes can rerender this surface. Mark the
            // request before preparing QuickTime so one approval request opens
            // one local preview, while leaving the manual control available.
            agentHandoffPreviewedRef.current.add(request.requestId);
            void previewAgentHandoff(request);
          }
        })
        .catch(() => {});
    };
    poll();
    const timer = window.setInterval(poll, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    agentHandoff,
    featureConfig?.screenMemory?.autoPreviewBeforeSending,
    featureConfig?.screenMemory?.enabled,
    previewAgentHandoff,
    processAgentHandoff,
  ]);

  useEffect(() => {
    if (featureConfig?.screenMemory?.enabled !== true) return;
    let cancelled = false;
    const sweep = async () => {
      const due = await invoke<DueRewindAgentHandoff[]>(
        "screen_memory_due_agent_handoffs",
      ).catch(() => []);
      if (cancelled) return;
      for (const item of due) {
        try {
          const cleanup = await callClipsAction<{
            deleted: boolean;
            reason: string;
          }>("delete-agent-recording-if-unpromoted", {
            id: item.recordingId,
          });
          if (cleanup.deleted) {
            await invoke("screen_memory_mark_agent_handoff_deleted", {
              requestId: item.requestId,
            });
          } else if (cleanup.reason === "promoted") {
            await invoke("screen_memory_cancel_agent_handoff_cleanup", {
              requestId: item.requestId,
            });
          }
        } catch (error) {
          console.warn(
            "[clips-tray] agent-created Clip cleanup failed:",
            error,
          );
        }
      }
    };
    void sweep();
    const timer = window.setInterval(() => void sweep(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [callClipsAction, featureConfig?.screenMemory?.enabled]);

  const fetchUpcomingMeetings = useCallback(async () => {
    if (authStatus !== "authed") {
      setMeetings([]);
      setMeetingsError(null);
      return;
    }

    setMeetingsLoading(true);
    setMeetingsError(null);
    try {
      const result = await callClipsAction<{ meetings?: unknown[] }>(
        "list-meetings",
        { view: "upcoming", limit: 3, upcomingWithinMin: 24 * 60 },
        { method: "GET" },
      );
      const list = Array.isArray(result.meetings) ? result.meetings : [];
      setMeetings(
        list.slice(0, 3).map((raw) => {
          const meeting = raw as Partial<PopoverMeeting>;
          return {
            id: String(meeting.id ?? ""),
            title: meeting.title || "Untitled meeting",
            scheduledStart: meeting.scheduledStart ?? null,
            scheduledEnd: meeting.scheduledEnd ?? null,
            joinUrl: meeting.joinUrl ?? null,
            platform: meeting.platform ?? null,
            transcriptStatus: meeting.transcriptStatus ?? null,
          };
        }),
      );
    } catch (err) {
      setMeetings([]);
      setMeetingsError(
        err instanceof Error ? err.message : "Could not load meetings.",
      );
    } finally {
      setMeetingsLoading(false);
    }
  }, [authStatus, callClipsAction]);

  useEffect(() => {
    let cancelled = false;
    if (popoverView !== "meetings" || meetings.length === 0) {
      setRewindMeetingHistoryAvailability({});
      return () => {
        cancelled = true;
      };
    }
    Promise.all(
      meetings.map(async (meeting) => {
        if (!meeting.scheduledStart)
          return [meeting.id, { available: false }] as const;
        try {
          const availability = await invoke<RewindMeetingHistoryAvailability>(
            "rewind_meeting_history_status",
            { scheduledStart: meeting.scheduledStart },
          );
          return [meeting.id, availability] as const;
        } catch (error) {
          return [
            meeting.id,
            {
              available: false,
              reason:
                error instanceof Error
                  ? error.message
                  : "Earlier local meeting audio is unavailable.",
            },
          ] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled)
        setRewindMeetingHistoryAvailability(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [meetings, popoverView]);

  const startMeetingNotes = useCallback(
    (meeting: PopoverMeeting, includeFromMeetingStart = false) => {
      setActiveMeetingId(meeting.id);
      setMeetingStartMessage(
        includeFromMeetingStart
          ? `Including earlier local audio for ${meeting.title}…`
          : `Starting notes for ${meeting.title}…`,
      );
      emit("meetings:start-transcription", {
        meetingId: meeting.id,
        joinUrl: meeting.joinUrl,
        reason: "user",
        scheduledStart: meeting.scheduledStart,
        includeFromMeetingStart,
      }).catch((err) => {
        console.error("[clips-popover] start meeting notes failed:", err);
        setActiveMeetingId(null);
        setMeetingStartMessage(
          "Could not start notes. Try again from Meetings.",
        );
      });
    },
    [],
  );

  const startMeetingNotesAndJoin = useCallback(
    (meeting: PopoverMeeting, includeFromMeetingStart = false) => {
      if (meeting.joinUrl) {
        openMeetingJoinUrl(meeting.joinUrl).catch((err) => {
          console.error("[clips-popover] open meeting join url failed:", err);
        });
      }
      startMeetingNotes(meeting, includeFromMeetingStart);
      hidePopover();
    },
    [startMeetingNotes],
  );

  const showActiveMeetingPill = useCallback((meetingId: string) => {
    invoke("recording_pill_show", { meetingId, mode: "meeting" }).catch(
      (err) => {
        console.error("[clips-popover] show meeting pill failed:", err);
      },
    );
    emit("clips:pill-context", { meetingId, mode: "meeting" }).catch(() => {});
  }, []);

  useEffect(() => {
    invoke<string | null>("get_active_meeting_id")
      .then((meetingId) => {
        if (meetingId) setActiveMeetingId((current) => current ?? meetingId);
      })
      .catch(() => {});

    let stopped = false;
    const unlistens: Array<() => void> = [];
    const track = (promise: Promise<() => void>) => {
      promise
        .then((unlisten) => {
          if (stopped) {
            unlisten();
            return;
          }
          unlistens.push(unlisten);
        })
        .catch(() => {});
    };
    track(
      listen<{ meetingId?: string | null }>(
        "meetings:transcription-started",
        (event) => {
          if (event.payload?.meetingId) {
            setActiveMeetingId(event.payload.meetingId);
            setMeetingStartMessage("Meeting notes are live and staying local.");
          }
        },
      ),
    );
    track(
      listen<{ meetingId?: string | null }>(
        "meetings:transcription-stopped",
        (event) => {
          setActiveMeetingId((current) =>
            !event.payload?.meetingId || event.payload.meetingId === current
              ? null
              : current,
          );
          setMeetingStartMessage(null);
        },
      ),
    );
    track(
      listen<{ meetingId?: string | null; error?: string }>(
        "meetings:transcription-error",
        (event) => {
          setActiveMeetingId((current) =>
            !event.payload?.meetingId || event.payload.meetingId === current
              ? null
              : current,
          );
          setMeetingStartMessage(
            event.payload?.error || "Could not start meeting notes.",
          );
        },
      ),
    );
    track(
      listen<{ meetingId?: string | null; error?: string }>(
        "meetings:history-error",
        (event) => {
          setMeetingStartMessage(
            event.payload?.error ||
              "Meeting notes are live, but the earlier local audio could not be included.",
          );
        },
      ),
    );
    return () => {
      stopped = true;
      unlistens.forEach((unlisten) => unlisten());
      unlistens.length = 0;
    };
  }, []);

  useEffect(() => {
    if (!popoverVisible || !activeMeetingId) return;
    showActiveMeetingPill(activeMeetingId);
  }, [activeMeetingId, popoverVisible, showActiveMeetingPill]);

  useMeetingTranscription({
    callClipsAction,
    serverUrl,
    selectedMicId,
    selectedMicLabel,
  });

  // OAuth (Google) opens in the system browser — the popover WebView can't
  // share a cookie jar with a separate Tauri WebviewWindow, and the old
  // approach of opening a WebView at the server root produced a blank window.
  // Instead: fetch the Google auth URL, open it externally, then poll a
  // server-side exchange endpoint for the session token.
  async function signInExternal() {
    // Synchronous ref guard — prevents a double-click from opening two OAuth
    // tabs. State updates are async so `signInPending` alone isn't sufficient.
    if (signInInflightRef.current) return;
    signInInflightRef.current = true;

    function stopPolling() {
      if (pollIntervalRef.current !== null) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }

    function finishWithError(message: string) {
      stopPolling();
      signInInflightRef.current = false;
      setSignInPending(false);
      setSignInError(message);
    }

    try {
      setSignInError(null);
      const flowId =
        crypto.randomUUID?.() ||
        Math.random().toString(36).slice(2) + Date.now().toString(36);
      const base = serverUrl.replace(/\/+$/, "");

      // Open directly in the system browser — the server redirects (302)
      // to Google's OAuth page, avoiding any cross-origin fetch from
      // the Tauri WebView.
      await openExternal(
        `${base}/_agent-native/google/auth-url?desktop=1&flow_id=${flowId}&redirect=1`,
      );

      setSignInPending(true);

      // Poll the exchange endpoint for the session token.
      const start = Date.now();
      const TIMEOUT_MS = 180_000; // 3 minutes
      pollIntervalRef.current = setInterval(async () => {
        try {
          const xr = await fetch(
            `${base}/_agent-native/auth/desktop-exchange?flow_id=${flowId}`,
            { credentials: "include" },
          );
          if (!xr.ok) {
            if (Date.now() - start > TIMEOUT_MS) {
              stopPolling();
              signInInflightRef.current = false;
              setSignInPending(false);
            }
            return;
          }
          const xd = await xr.json();
          if (xd?.error) {
            finishWithError(
              typeof xd.error === "string"
                ? xd.error
                : "Google sign-in failed. Please try again.",
            );
            return;
          }
          if (xd?.token) {
            stopPolling();
            saveDesktopAuthToken(base, String(xd.token));
            // Establish the session cookie when the WebView accepts it; the
            // bearer token above is the reliable desktop auth path.
            await fetch(
              `${base}/_agent-native/auth/session?_session=${xd.token}`,
              { credentials: "include" },
            );
            signInInflightRef.current = false;
            setSignInPending(false);
            const ok = await checkAuth();
            if (!ok) {
              setSignInError(
                "Google sign-in completed, but Clips could not save the session. Please try again.",
              );
            }
          } else if (Date.now() - start > TIMEOUT_MS) {
            finishWithError("Google sign-in timed out. Please try again.");
          }
        } catch {
          if (Date.now() - start > TIMEOUT_MS) {
            finishWithError("Google sign-in timed out. Please try again.");
          }
        }
      }, 1500);
    } catch (err) {
      console.error("[clips-tray] signInExternal failed:", err);
      signInInflightRef.current = false;
      setSignInPending(false);
      setSignInError(
        err instanceof Error
          ? err.message
          : "Could not open Google sign-in. Please try again.",
      );
    }
  }

  // Sign out via the framework's logout endpoint. The cookie clears in the
  // same webview that will re-check `/auth/session`, so the popover flips
  // back to the inline sign-in form without a reload.
  async function signOut() {
    try {
      await fetch(
        `${serverUrl.replace(/\/+$/, "")}/_agent-native/auth/logout`,
        { method: "POST", credentials: "include" },
      );
    } catch {
      // ignore — we'll re-check session regardless
    }
    clearDesktopAuthToken(serverUrl);
    await checkAuth();
    setPopoverView("recorder");
  }

  // ---- Esc closes the popover --------------------------------------------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // Don't close mid-recording — user would lose the recorder handle.
        if (isRecording) return;
        // Reset nested views before hide so the next tray open lands on the
        // main recorder UI instead of resuming scrolled settings/meetings.
        setPopoverView("recorder");
        hidePopover();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isRecording]);

  // ---- popover visibility tracking ----------------------------------------
  // ONLY source of truth: explicit `clips:popover-visible` events from Rust,
  // which fire on every show/hide (including the blur-auto-hide path).
  // Focus events are NOT reliable here — opening devtools steals focus,
  // clicking inside the popover re-gains it, etc., which caused an
  // infinite show_bubble/hide flap when we listened to onFocusChanged.
  useEffect(() => {
    // Race-safe listen tracking. `listen()` is async — the unlisten fn
    // only exists AFTER the IPC round-trip resolves. If React cleanup
    // fires before that, the "fire-and-forget" `.then((u) => push(u))`
    // pattern never enqueues the unlisten and the listener leaks
    // forever. Each leaked listener closes over the effect scope +
    // React state, so every remount of this component grows heap.
    // Track `cancelled` and call the unlisten IMMEDIATELY if it arrives
    // after cleanup ran.
    let cancelled = false;
    const unlistens: Array<() => void> = [];
    const track = (p: Promise<() => void>) => {
      p.then((u) => {
        if (cancelled) {
          try {
            u();
          } catch {
            // ignore
          }
          return;
        }
        unlistens.push(u);
      }).catch(() => {
        // ignore — best-effort
      });
    };
    track(
      listen<boolean>("clips:popover-visible", (ev) => {
        console.log("[clips-popover] popover-visible =", ev.payload);
        const visible = !!ev.payload;
        setPopoverVisible(visible);
        // Leaving settings/meetings/dictation mid-scroll should not resume on
        // the next open — always return to the main recorder surface.
        if (!visible) setPopoverView("recorder");
      }),
    );
    // The bubble window emits `clips:bubble-closed` when the user clicks
    // the X on the hover controls. Treat that as "camera off": stop the
    // popover-owned camera track now so the hardware light goes off
    // immediately, and clear `cameraOn` so the bubble-session effect tears
    // down the rest (pump/window) and the toggle reflects the new state.
    track(
      listen("clips:bubble-closed", () => {
        console.log(
          "[clips-popover] bubble-closed received — stopping camera + clearing cameraOn",
        );
        bubbleStreamRef.current?.getTracks().forEach((t) => t.stop());
        setCameraOn(false);
      }),
    );
    // Query the CURRENT visibility on mount in case the event already
    // fired before React subscribed.
    getCurrentWindow()
      .isVisible()
      .then((v) => {
        if (cancelled) return;
        console.log("[clips-popover] initial isVisible =", v);
        setPopoverVisible(!!v);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlistens.forEach((u) => {
        try {
          u();
        } catch {
          // ignore
        }
      });
      unlistens.length = 0;
    };
  }, []);

  const speechPermissionChecked = useRef(false);
  useEffect(() => {
    if (!popoverVisible || !micOn || speechPermissionChecked.current) return;
    speechPermissionChecked.current = true;
    invoke<boolean>("native_speech_request_permission").catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[clips-popover] speech permission preflight failed:", err);
      setRecError(
        /speech recognition|speech/i.test(message)
          ? MACOS_SPEECH_PERMISSION_MESSAGE
          : `Speech recognition unavailable: ${message}`,
      );
    });
  }, [micOn, popoverVisible]);

  // ---- camera bubble session ---------------------------------------------
  // The bubble overlay (small circular PiP in the bottom-left of the screen
  // showing the user's face) uses two paths. Browser capture keeps the camera
  // in this popover for the entire session because WebKit can mute capture
  // tracks across same-process webviews. Native full-screen capture uses a
  // local bubble camera because the native screen recorder captures that
  // overlay directly.
  //
  // Lifecycle:
  //   - Popover visible + camera mode + cameraOn → acquire camera, call
  //     show_bubble, then either start the WebRTC/canvas relay (browser
  //     capture) or tell the bubble to start its local camera (native
  //     full-screen capture). User sees their face in the bottom-left corner.
  //   - User clicks Start Recording → popover hides, recording begins.
  //     `isRecording` becomes true, so this effect's deps still say
  //     "active" — the stream + bubble + pump keep running. The recorder
  //     reuses the camera stream for the saved video composite (see
  //     `preAcquiredCameraStream` in recorder.ts). Explicit native full-screen
  //     mode leaves the bubble's local camera stream alone.
  //   - Recording stops → `isRecording` flips back to false, popover
  //     usually hides too, so the effect cleans up: stop tracks, hide
  //     overlays (which closes the bubble window).
  //   - User switches camera / turns camera off / closes popover (not
  //     recording) → cleanup fires, bubble disappears.
  const bubbleStreamRef = useRef<MediaStream | null>(null);
  // Set to true the instant handleStartRecording hands `bubbleStreamRef.current`
  // to `startRecording` as `preAcquiredCameraStream`. The recorder
  // then owns the track lifecycle — this effect's cleanup MUST NOT stop
  // the tracks or the MediaRecorder ends up with `readyState: "ended"`
  // tracks (which causes the laggy / black / silently-failing recording
  // symptoms). Reset to false once the recording is fully torn down.
  const bubbleStreamTransferredToRecorder = useRef(false);
  // Bumped when the native stop path releases the camera mid-session so the
  // bubble effect re-acquires even if bubbleActive/cameraId are unchanged
  // (post-stop reopen with a blank "Default Camera" preview).
  const [bubbleSessionEpoch, setBubbleSessionEpoch] = useState(0);
  const wantsCamera = mode !== "screen" && cameraOn;
  const nativeFullscreenRecordingActive =
    mode !== "camera" && shouldUseNativeFullscreenRecording(source);
  // Ref mirror of `isRecording || recordingFlowActive` so cleanup (which
  // captures the dep-snapshot value) can still see the CURRENT flow state
  // at the moment it actually runs. Without this, if `recordingFlowActive`
  // briefly flips false on a re-render mid-flow (e.g. finally-block
  // recovery path), the cleanup function snapshots `bubbleActive=false`
  // from THAT render and stops the camera stream even though recording is
  // still in flight.
  const recordingFlowGateRef = useRef(false);
  // Stop detaches the recorder state before optimization/upload finishes so a
  // fresh camera session can recover immediately. Keep that post-stop phase
  // separate so React cleanup does not close the finalizing progress window.
  const recordingStopFinalizingRef = useRef(false);
  useEffect(() => {
    recordingFlowGateRef.current = isRecording || recordingFlowActive;
  }, [isRecording, recordingFlowActive]);
  const bubbleActive =
    wantsCamera &&
    (popoverVisible ||
      isRecording ||
      recordingFlowActive ||
      recordingFlowGateRef.current);

  bubbleActiveRef.current = bubbleActive;
  // The toolbar is recording chrome, not pre-record chrome. Showing it while
  // the popover is merely open leaves a disabled 0:00 Stop/Pause pill on the
  // desktop, which reads as a stuck recorder and can trap accessibility clicks.
  const toolbarActive = isRecording || recordingFlowActive;

  useEffect(() => {
    if (!toolbarActive) return;
    let cancelled = false;
    (async () => {
      try {
        await invoke("show_toolbar");
        if (cancelled) return;
        // Seed disabled — previous recordings may have latched it on in
        // the toolbar's React state (the window is destroyed on
        // `hide_overlays`, so this is mostly defensive, but free).
        emit("clips:toolbar-enabled", false).catch(() => {});
      } catch (err) {
        console.error("[clips-popover] show_toolbar failed:", err);
      }
    })();
    return () => {
      cancelled = true;
      // In screen-only mode the bubble effect never runs, so its
      // cleanup (which normally hides overlays) never fires either.
      // Hide them from here instead. Guard on !recordingInFlight so
      // we don't rip the toolbar out from under an active recording.
      if (!recordingFlowGateRef.current) {
        invoke("hide_overlays", {
          preserveFinalizing: recordingStopFinalizingRef.current,
        }).catch(() => {});
      }
    };
  }, [toolbarActive]);

  useEffect(() => {
    if (!bubbleActive) return;
    setCameraError(null);

    let cancelled = false;
    // Dual-transport bookkeeping. We try WebRTC first; if it fails or
    // times out, we fall back to the canvas pump. Only one should be
    // active at a time — the ref below guarantees we never double-start.
    let webrtcHandle: BubbleWebrtcHandle | null = null;
    let stopPump: (() => void) | null = null;
    let fellBackToPump = false;
    let stream: MediaStream | null = null;

    const startPump = (reason: string) => {
      if (cancelled || stopPump || !stream) return;
      fellBackToPump = true;
      console.log("[clips-popover] starting bubble canvas pump — %s", reason);
      stopPump = startBubbleFramePump(stream);
    };

    console.log(
      "[clips-popover] bubble session start — acquiring camera + showing bubble",
    );

    // The saved camera id can go stale (webcam unplugged since last launch).
    // The fallback helper retries once with the default camera on a
    // constraint failure instead of leaving the ghost id to fail with
    // OverconstrainedError; once `loadDevices()` refreshes the list below,
    // the stale selection itself is cleared by `useMediaDevices`.
    getCameraStreamWithFallback(cameraId, {
      width: { ideal: 1280 },
      height: { ideal: 720 },
    })
      .then(async (s) => {
        if (cancelled) {
          // Effect re-ran before we resolved — throw this stream away.
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        await loadDevices();
        stream = s;
        bubbleStreamRef.current = s;
        // Open the bubble window. It's a pure renderer — the bubble
        // itself creates an RTCPeerConnection receiver and emits
        // `clips:bubble-ready` once it's listening. We also keep the
        // legacy canvas-frame sink around so a WebRTC failure can
        // fall back to JPEG frames without a bubble reload.
        try {
          await invoke("show_bubble");
        } catch (err) {
          console.error("[clips-popover] show_bubble failed:", err);
        }
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        // Preferred path: WebRTC. Starts listening for bubble-ready,
        // then kicks off an offer/answer/ICE dance. If ICE doesn't
        // connect within the timeout (or fails later) we start the
        // canvas pump in its place. The pump is our safety net —
        // proven to work, just slower.
        const startCanvasFallback = (reason: string) => {
          if (cancelled || fellBackToPump) return;
          fellBackToPump = true;
          console.warn(
            "[clips-popover] WebRTC bubble failed (%s) — starting canvas pump fallback",
            reason,
          );
          webrtcHandle?.stop();
          webrtcHandle = null;
          startPump(reason);
        };
        webrtcHandle = startBubbleWebrtc({
          stream: s,
          onConnected: () => {
            console.log(
              "[clips-popover] bubble WebRTC connected — video is live",
            );
          },
          onFailure: startCanvasFallback,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[clips-popover] camera acquisition failed:", err);
        const msg = err?.message ?? "";
        if (
          msg.includes("AVVideoCaptureSource") ||
          msg.includes("sandbox") ||
          err?.name === "NotAllowedError"
        ) {
          setCameraError(
            isMacPlatform()
              ? MACOS_CAPTURE_PERMISSION_MESSAGE
              : DESKTOP_CAPTURE_PERMISSION_MESSAGE,
          );
        } else if (isMediaConstraintFailure(err)) {
          // Even the default-camera retry inside getCameraStreamWithFallback
          // failed, so no camera is usable right now. Say that plainly
          // instead of surfacing constraint jargon like "Invalid constraint".
          setCameraError(
            "No camera found. Connect a camera, or pick one from the camera menu.",
          );
        } else {
          setCameraError(`Camera unavailable: ${msg}`);
        }
      });

    return () => {
      cancelled = true;
      const transferred = bubbleStreamTransferredToRecorder.current;
      const recordingInFlight = recordingFlowGateRef.current;
      const trackCount = stream ? stream.getTracks().length : 0;
      console.log(
        "[clips-popover] bubble session end — transferred=%o recordingInFlight=%o tracks=%d hasWebrtc=%o hasPump=%o",
        transferred,
        recordingInFlight,
        trackCount,
        !!webrtcHandle,
        !!stopPump,
      );
      if (webrtcHandle) {
        webrtcHandle.stop();
        webrtcHandle = null;
      }
      if (stopPump) {
        stopPump();
        stopPump = null;
      }
      // Critical: if the recorder borrowed this stream, it now owns the
      // track lifecycle. Stopping tracks here would end them out from
      // under `MediaRecorder`, producing the laggy-bubble / dead-track
      // bug. The recorder will stop them on `stop()` / `cancel()`.
      if (stream && !transferred) {
        stream.getTracks().forEach((t) => t.stop());
        // Drop the local closure reference so nothing else pins the
        // (now-stopped) MediaStream. WebKit's MediaStream is backed by a
        // native track buffer that GC doesn't reclaim aggressively — any
        // dangling reference keeps it resident.
        stream = null;
      }
      // If the recorder owns the stream, keep `bubbleStreamRef` pointed
      // at it so the next re-entry of this effect (if any) doesn't try
      // to re-acquire while the recorder is still using it.
      if (!transferred) {
        bubbleStreamRef.current = null;
      }
      // Don't tear down overlays if a recording is still in flight (the
      // recorder's stop flow calls `hide_recording_chrome` which handles
      // the bubble correctly). Hiding here mid-flow would kill the
      // on-screen bubble window the user sees during the recording.
      // Also skip when the bubble is still wanted and only the capture
      // source changed (e.g. cameraId flip re-runs this effect): hiding
      // would race the re-run's show_bubble and close the window out from under it.
      if (!recordingInFlight && !bubbleActiveRef.current) {
        invoke("hide_overlays", {
          preserveFinalizing: recordingStopFinalizingRef.current,
        }).catch(() => {});
      }
    };
  }, [bubbleActive, cameraId, bubbleSessionEpoch]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    listen("clips:release-camera", () => {
      console.log(`[popover] releasing camera`);
      // Native stop closes the bubble and kills tracks while React may still
      // hold a live RecorderHandle during finalize/upload. Clear ownership so
      // the bubble session can re-acquire a fresh preview, and so Start is not
      // stuck on an ended stream.
      bubbleStreamTransferredToRecorder.current = false;
      bubbleStreamRef.current?.getTracks().forEach((t) => t.stop());
      bubbleStreamRef.current = null;
      setBubbleSessionEpoch((epoch) => epoch + 1);
    })
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // If the popover reopens while camera is still wanted, and the previous
  // bubble stream is gone or all tracks have ended (common after native stop
  // + mid-upload reopen), bump the session epoch so the bubble effect
  // re-acquires getUserMedia + WebRTC instead of showing a blank "Default
  // Camera" label with a silent Start.
  useEffect(() => {
    if (!popoverVisible || !wantsCamera) return;
    if (recordingFlowGateRef.current || recordingFlowActive) return;
    const tracks = bubbleStreamRef.current?.getTracks() ?? [];
    const needsFreshBubble =
      tracks.length === 0 ||
      tracks.every((track) => track.readyState === "ended");
    if (!needsFreshBubble) return;
    bubbleStreamTransferredToRecorder.current = false;
    bubbleStreamRef.current = null;
    setBubbleSessionEpoch((epoch) => epoch + 1);
  }, [popoverVisible, wantsCamera, recordingFlowActive]);

  // ---- auto-size popover to content --------------------------------------
  // The Tauri window is fixed-size via tauri.conf.json, but our content
  // height varies (more rows when a camera is on, Recent list toggle, etc.).
  // A descendant-aware observer tells Rust what the current content height is
  // and we call `resize_popover` to match.
  const appRef = useRef<HTMLDivElement | null>(null);
  usePopoverAutoSize(appRef, {
    disabled: !popoverVisible || isRecording || recordingFlowActive,
    width: popoverView === "settings" || popoverView === "memory" ? 440 : 360,
  });

  const loadPendingUploads = useCallback(async () => {
    const [nativeResult, browserResult] = await Promise.allSettled([
      invoke<Omit<PendingNativeUpload, "kind">[]>(
        "native_fullscreen_pending_uploads",
      ),
      listBrowserRecordingBackups(),
    ]);
    if (nativeResult.status === "rejected") {
      console.warn(
        "[clips-tray] native pending upload lookup failed:",
        nativeResult.reason,
      );
    }
    if (browserResult.status === "rejected") {
      console.warn(
        "[clips-tray] browser pending upload lookup failed:",
        browserResult.reason,
      );
    }
    const nativeUploads =
      nativeResult.status === "fulfilled" && Array.isArray(nativeResult.value)
        ? nativeResult.value.map((upload) => ({
            ...upload,
            kind: "native" as const,
          }))
        : [];
    const browserUploads =
      browserResult.status === "fulfilled" ? browserResult.value : [];
    setPendingUploads(
      [...nativeUploads, ...browserUploads].sort((a, b) =>
        b.savedAt.localeCompare(a.savedAt),
      ),
    );
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    listen("clips:pending-uploads-changed", () => {
      void loadPendingUploads();
    })
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [loadPendingUploads]);

  useEffect(() => {
    if (popoverView === "meetings" && popoverVisible) {
      void fetchUpcomingMeetings();
    }
  }, [fetchUpcomingMeetings, popoverView, popoverVisible]);

  useEffect(() => {
    loadPendingUploads();
  }, [loadPendingUploads, popoverVisible]);

  // ---- persist selections -------------------------------------------------

  useEffect(() => saveString(MODE_KEY, mode), [mode]);
  useEffect(
    () => saveString(VOICE_SHORTCUT_KEY, voiceShortcut),
    [voiceShortcut],
  );
  useEffect(
    () => saveString(VOICE_CUSTOM_SHORTCUT_KEY, voiceCustomShortcut),
    [voiceCustomShortcut],
  );
  useEffect(
    () => saveString(POPOVER_CUSTOM_SHORTCUT_KEY, popoverCustomShortcut),
    [popoverCustomShortcut],
  );
  useEffect(
    () => saveString(RECORD_CUSTOM_SHORTCUT_KEY, recordCustomShortcut),
    [recordCustomShortcut],
  );
  useEffect(() => saveString(VOICE_MODE_KEY, voiceMode), [voiceMode]);
  useEffect(
    () => saveString(VOICE_PROVIDER_KEY, voiceProvider),
    [voiceProvider],
  );
  useEffect(
    () => saveString(VOICE_INSTRUCTIONS_KEY, voiceInstructions),
    [voiceInstructions],
  );
  useEffect(() => saveString(SOURCE_KEY, source), [source]);
  useEffect(() => saveBool(CAM_ON_KEY, cameraOn), [cameraOn]);
  useEffect(() => saveBool(MIC_ON_KEY, micOn), [micOn]);
  useEffect(() => saveBool(SYSTEM_AUDIO_KEY, systemAudioOn), [systemAudioOn]);

  // ---- actions -----------------------------------------------------------

  function openInBrowser(path: string) {
    const href = `${serverUrl.replace(/\/+$/, "")}${path}`;
    openExternal(href).catch((err) => {
      console.error("[clips-tray] open failed:", err);
    });
  }

  async function retryPendingUpload(upload: PendingDesktopUpload) {
    if (retryingUploadId || exportingUploadId || dismissingUploadId) return;
    const targetServerUrl = serverUrlForPendingUpload(upload, serverUrl);
    setRecError(null);
    setRetryingUploadId(upload.recordingId);
    try {
      const authToken = loadDesktopAuthToken(targetServerUrl);
      if (upload.kind === "native") {
        const result = await invoke<{ verificationPending?: boolean }>(
          "native_fullscreen_recording_retry_upload",
          {
            serverUrl: targetServerUrl,
            recordingId: upload.recordingId,
            authToken,
            cookie:
              typeof document !== "undefined" ? document.cookie || "" : "",
          },
        );
        if (result.verificationPending) {
          scheduleNativeBackupCleanupAfterProcessing({
            serverUrl: targetServerUrl,
            recordingId: upload.recordingId,
            authToken,
          });
        }
      } else {
        await retryBrowserRecordingBackup({
          recordingId: upload.recordingId,
          serverUrl: targetServerUrl,
          authToken,
        });
      }
      await loadPendingUploads();
      await openExternal(`${targetServerUrl}/r/${upload.recordingId}`);
      getCurrentWindow()
        .hide()
        .catch(() => {});
      emit("clips:popover-visible", false).catch(() => {});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[clips-tray] retry saved upload failed:", err);
      setRecError(
        isStorageSetupFailureMessage(message)
          ? "Connect storage to finish uploading this saved clip: Builder.io (free tier storage + AI) or S3-compatible storage."
          : message,
      );
      await loadPendingUploads();
    } finally {
      setRetryingUploadId(null);
    }
  }

  async function exportPendingUpload(upload: PendingDesktopUpload) {
    if (retryingUploadId || exportingUploadId || dismissingUploadId) return;
    setRecError(null);

    if (upload.kind === "native") {
      openPendingUploadFolder(upload);
      return;
    }

    setExportingUploadId(upload.recordingId);
    try {
      const exportResult = await exportBrowserRecordingBackup(
        upload.recordingId,
      );
      setLocalRecordingNotice({
        folderPath: exportResult.folderPath,
        files: [exportResult.file],
      });
      await invoke("open_local_recording_folder", {
        path: exportResult.folderPath,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[clips-tray] export saved upload failed:", err);
      setRecError(message);
    } finally {
      setExportingUploadId(null);
    }
  }

  async function dismissPendingUpload(upload: PendingDesktopUpload) {
    if (retryingUploadId || exportingUploadId || dismissingUploadId) return;
    setRecError(null);
    setDismissingUploadId(upload.recordingId);
    setPendingUploads((uploads) =>
      uploads.filter((item) => item.recordingId !== upload.recordingId),
    );
    try {
      if (upload.kind === "native") {
        await invoke("native_fullscreen_recording_dismiss_upload", {
          recordingId: upload.recordingId,
        });
      } else {
        await dismissBrowserRecordingBackup(upload.recordingId);
      }
      await loadPendingUploads();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[clips-tray] dismiss saved upload failed:", err);
      setRecError(message);
      await loadPendingUploads();
    } finally {
      setDismissingUploadId(null);
    }
  }

  function openPendingUploadFolder(upload: PendingDesktopUpload) {
    if (upload.kind !== "native" || !upload.folderPath) {
      setRecError("This saved upload is stored in the browser backup cache.");
      return;
    }
    invoke("open_local_recording_folder", {
      path: upload.folderPath,
    }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[clips-tray] open pending upload folder failed:", err);
      setRecError(message);
    });
  }

  const openVideoStorageSetup = useCallback(
    (targetServerUrl?: string) => {
      const base = (targetServerUrl?.trim() || serverUrl).replace(/\/+$/, "");
      setRecError(STORAGE_SETUP_HELP_TEXT);
      void openExternal(`${base}/record`).catch((err) => {
        setRecError(
          err instanceof Error
            ? err.message
            : "Could not open Clips storage setup.",
        );
      });
      void refreshVideoStorageStatus();
    },
    [refreshVideoStorageStatus, serverUrl],
  );

  async function handleStartRecording(options?: {
    ignoreActiveRecorder?: boolean;
  }) {
    if (recorder && !options?.ignoreActiveRecorder) {
      console.warn(
        "[clips-popover] handleStartRecording ignored — recorder already active",
      );
      setRecError(
        "Still finishing the last recording. Wait a moment, then try again.",
      );
      return;
    }
    const bubbleTracks = bubbleStreamRef.current?.getTracks() ?? [];
    const bubbleStreamDead =
      bubbleTracks.length > 0 &&
      bubbleTracks.every((track) => track.readyState === "ended");
    if (bubbleStreamDead) {
      console.warn("[clips-popover] clearing ended bubble stream before start");
      bubbleStreamTransferredToRecorder.current = false;
      bubbleStreamRef.current = null;
      setBubbleSessionEpoch((epoch) => epoch + 1);
    }
    if (localRecordingMode === "off") {
      if (videoStorageStatus === "checking") {
        setRecError("Checking video storage. Try again in a moment.");
        return;
      }
      if (videoStorageStatus === "missing") {
        openVideoStorageSetup();
        return;
      }
    }
    setRecError(null);
    setLocalRecordingNotice(null);
    console.log("[clips-popover] handleStartRecording clicked", {
      serverUrl,
      mode,
      source,
      localRecordingMode,
      cameraOn,
      micOn,
    });

    if (mode !== "camera" && nativeFullscreenRecordingActive) {
      try {
        const granted = await invoke<boolean>(
          "request_macos_screen_recording_access",
        );
        if (!granted) {
          setReadinessOpen(true);
          setRecError(MACOS_SCREEN_PERMISSION_MESSAGE);
          openPrivacySettings("screen");
          return;
        }
      } catch (err) {
        setReadinessOpen(true);
        setRecError(err instanceof Error ? err.message : String(err));
        return;
      }
    }

    stopAllMicMeters();

    // Latch BEFORE the async work so the popover stays in "recording
    // flow" during the macOS screen-picker focus dance. The bubble
    // session effect also keys off this flag (via `bubbleActive`) so
    // the bubble + camera stream stay alive while the picker is up.
    recordingFlowGateRef.current = true;
    setRecordingFlowActive(true);
    // Tell Rust we're entering the recording flow NOW, not after the
    // handle arrives. The macOS screen-picker dialog steals focus from
    // the popover, which would otherwise trigger the blur-auto-hide
    // mid-setup — so the countdown and toolbar render behind a hidden
    // popover and the user sees nothing happen.
    invoke("set_recording_state", { active: true }).catch(() => {});

    // Hand the live camera stream to the recorder so it doesn't
    // re-acquire the camera (which would trigger WebKit's
    // capture-exclusion mute bug — see `preAcquiredCameraStream` in
    // recorder.ts). The popover KEEPS ownership: the bubble session
    // effect's deps still include `isRecording`, so the stream + bubble
    // + pump stay alive for the entire recording.
    const preAcquiredCameraStream =
      mode !== "screen" && cameraOn ? bubbleStreamRef.current : null;
    // Flip the ownership flag BEFORE kicking off the recorder. Any
    // bubble-session cleanup that fires after this point must leave the
    // tracks alone — the recorder now owns them. Cleared in the stop /
    // cancel / failure paths below.
    if (preAcquiredCameraStream) {
      bubbleStreamTransferredToRecorder.current = true;
    }

    let handle: RecorderHandle | null = null;
    let startError: unknown = null;
    try {
      // Per Steve: "when we hit Start Recording the popover should disappear
      // BEFORE the screen picker shows up — otherwise you might accidentally
      // pick the popover itself." NSWindowSharingNone keeps the popover out
      // of the final recording, but on modern macOS the picker STILL lists
      // NSWindowSharingNone windows — only the actual capture is blocked.
      // So we have to visually hide it early.
      //
      // We can't hide() the popover — that suspends its JS and the bubble
      // frame pump dies. Instead we park it as a 2×2 pinhole on the primary
      // screen (AppKit sees the window as on-screen, no occlusion
      // throttling, pump keeps ticking). The pinhole is too small to show
      // up prominently in the picker and since NSWindowSharingNone is also
      // set the picker's thumbnail is empty anyway.
      //
      // USER ACTIVATION: WebKit requires `getDisplayMedia` to be called
      // from within a user gesture handler. The first `await` in a click
      // handler consumes user activation. `startRecording` kicks off
      // `getDisplayMedia` SYNCHRONOUSLY before its first `await`, so we
      // start the recording promise FIRST (capturing the gesture), then
      // park the popover in parallel via a fire-and-forget `invoke`.
      // `invoke` itself is async — but because `getDisplayMedia` was
      // already dispatched at that point, user activation has already been
      // consumed for the purpose that needs it.
      //
      // Set `clipsForceAlive` before parking so the bubble frame pump's
      // `document.hidden` early-out is bypassed even if WebKit flips
      // visibility=hidden on a pinhole-sized window.
      (window as unknown as { clipsForceAlive?: boolean }).clipsForceAlive =
        true;

      const recordingPromise = startRecording({
        serverUrl,
        mode,
        source,
        cameraId,
        micId: selectedMicId || undefined,
        // Live label is empty when the stored hashed deviceId no longer
        // resolves in the current device list; fall back to the persisted label
        // so the native recorder always has a name to match. recorder.ts also
        // probes the live track.label at start as the authoritative source.
        micLabel: selectedMicLabel || micLabel || undefined,
        authToken: loadDesktopAuthToken(serverUrl),
        cookie: typeof document !== "undefined" ? document.cookie || "" : "",
        cameraOn,
        micOn,
        systemAudioOn,
        localRecordingMode,
        preAcquiredCameraStream,
      });
      // macOS: park the popover to its 2×2 pinhole IMMEDIATELY so it
      // doesn't appear in the screen picker window list. The native
      // Rust recorder used for full-screen doesn't need getDisplayMedia
      // at all, so parking is always safe on macOS.
      //
      // Windows: do NOT park before getDisplayMedia resolves. On Windows,
      // the WebView2 screen picker UI renders within the popover webview —
      // shrinking the window to 2×2 makes the picker invisible and the
      // user can never select a screen. The recorder.ts code parks the
      // popover itself (line ~2165) AFTER the streams are acquired, which
      // is the correct time on Windows.
      if (isMacPlatform()) {
        invoke("park_popover_offscreen").catch(() => {});
        emit("clips:popover-visible", false).catch(() => {});
      }

      // No watchdog — the macOS screen picker can stay open indefinitely
      // (a user deciding which window to capture may take 20, 60, 180
      // seconds). A false-positive timeout here fires recovery mid-setup,
      // which flips `recordingFlowActive` back to false → the bubble
      // session effect's cleanup runs and stops the popover-owned camera
      // stream → the recorder ends up with a dead track when the screen
      // picker finally resolves. If the user actually wants to abort,
      // canceling the picker throws NotAllowedError and we recover through
      // the normal error path.
      handle = await recordingPromise;
      console.log("[clips-popover] recorder handle received");
    } catch (err) {
      startError = err;
    } finally {
      // If the recorder handle was NEVER set, ALWAYS run recovery here —
      // even if downstream code throws before reaching the failure
      // branch. This makes the tray-dead symptom impossible: regardless
      // of WHICH step failed (stream acquisition, countdown, createRecording,
      // MediaRecorder.start, watchdog, unexpected throw), is_recording_active
      // is flipped back to false and the popover is re-shown.
      if (!handle) {
        console.warn(
          "[clips-popover] handleStartRecording finally: no handle — running recovery",
        );
        // Clear the force-alive flag if it was latched before the failure.
        (window as unknown as { clipsForceAlive?: boolean }).clipsForceAlive =
          false;
        // Hand the stream back to the popover session. The recorder
        // never got far enough to take ownership of the tracks, so the
        // bubble-session effect must be allowed to stop them again on
        // its next cleanup (e.g. if the user closes the popover).
        bubbleStreamTransferredToRecorder.current = false;
        recordingFlowGateRef.current = false;
        setRecordingFlowActive(false);
        try {
          await invoke("set_recording_state", { active: false });
        } catch {
          // ignore — best-effort
        }
        try {
          await invoke("show_popover");
        } catch {
          // ignore — best-effort
        }
      }
    }

    if (handle) {
      setRecorder(handle);
      return;
    }

    // Failure path — the recorder never came up. Side-effects (recording
    // flag + popover visibility) were already restored in the finally
    // block above. Now surface any non-cancel error to the UI.
    console.error("[clips-popover] handleStartRecording failed:", startError);

    // User cancelled the macOS screen-picker (or denied permission). WebKit
    // often reports both as NotAllowedError; only show the big permissions
    // banner when the message carries a hard macOS/privacy failure signal.
    const errName =
      startError instanceof DOMException || startError instanceof Error
        ? startError.name
        : "";
    const message =
      startError instanceof Error ? startError.message : String(startError);
    if (
      errName === "AbortError" ||
      /was cancelled|dismissed|region selection cancelled/i.test(message)
    ) {
      return;
    }
    if (
      errName === "NotAllowedError" &&
      !isHardCapturePermissionError(message)
    ) {
      return;
    }
    if (isHardCapturePermissionError(message)) {
      // If an update has finished downloading and is waiting to install, the
      // safe next step is to restart (which applies the update and gives the
      // process a clean binary + permission state). Prefer that hint over the
      // "grant permissions" banner, which is misleading when the readiness
      // checkmarks are already green.
      setRecError(
        isUpdatePendingRestart()
          ? MACOS_UPDATE_RESTART_MESSAGE
          : isMacPlatform()
            ? MACOS_CAPTURE_PERMISSION_MESSAGE
            : DESKTOP_CAPTURE_PERMISSION_MESSAGE,
      );
      return;
    }
    if (isStorageSetupFailureMessage(message)) {
      setRecError(STORAGE_SETUP_HELP_TEXT);
      openVideoStorageSetup();
      return;
    }
    setRecError(message);
  }

  recordShortcutHandlerRef.current = () => {
    if (recorder) {
      emit("clips:recorder-stop").catch(() => {});
      return;
    }
    if (recordingFlowGateRef.current || recordingFlowActive) {
      emit("clips:countdown-cancel").catch(() => {});
      return;
    }

    setPopoverView("recorder");
    if (authStatus === "anon" && localRecordingMode === "off") {
      setRecError("Sign in to Clips before using the recording shortcut.");
      invoke("show_popover").catch(() => {});
      return;
    }

    const canStartFromGlobalShortcut =
      mode === "camera" || nativeFullscreenRecordingActive;
    if (!canStartFromGlobalShortcut) {
      setRecError(
        "Open Clips and click Start recording to use the selected source.",
      );
      invoke("show_popover").catch(() => {});
      return;
    }

    void handleStartRecording({ ignoreActiveRecorder: true });
  };

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    listen("clips:record-shortcut", () => {
      recordShortcutHandlerRef.current();
    })
      .then((u) => {
        if (cancelled) {
          try {
            u();
          } catch {
            // ignore
          }
          return;
        }
        unlisten = u;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (unlisten) {
        try {
          unlisten();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  function updateReadinessOpen(next: boolean) {
    setReadinessOpen(next);
    if (!next) saveBool(READINESS_REVIEWED_KEY, true);
  }

  function retryCameraPreview() {
    setCameraError(null);
    if (!cameraOn) {
      setCameraOn(true);
      return;
    }
    setCameraOn(false);
    window.setTimeout(() => setCameraOn(true), 0);
  }

  // When the toolbar or countdown triggers stop/cancel the popover auto-
  // rehydrates into a "last recording" state so the user has a single-click
  // path to the playback page + knows the upload landed.
  useEffect(() => {
    if (!recorder) return;
    let cancelled = false;
    // Each Promise<UnlistenFn> is still pending when this effect might
    // already be tearing down (a fast stop→cancel toggle, or the effect
    // re-running due to a new recorder). If the unlisten arrives after
    // cleanup ran, call it immediately — otherwise Tauri keeps the
    // listener registered for the lifetime of the webview, and each
    // orphaned closure pins `recorder` + its MediaStream graph.
    const unlisteners: Array<() => void> = [];
    const track = (p: Promise<() => void>) => {
      p.then((u) => {
        if (cancelled) {
          try {
            u();
          } catch {
            // ignore
          }
          return;
        }
        unlisteners.push(u);
      }).catch(() => {
        // ignore — best-effort
      });
    };
    track(
      listen("clips:recorder-stop", async () => {
        // Detach the React Start/bubble gate immediately. The recorder keeps
        // Rust `is_recording_active` and the finalizing overlay guarded until
        // its durable backup/finalize boundary; keeping this React handle set
        // through the whole upload made reopen show a blank preview and made
        // Start a silent no-op.
        const handle = recorder;
        recordingStopFinalizingRef.current = true;
        setRecordingStopFinalizing(true);
        bubbleStreamTransferredToRecorder.current = false;
        bubbleStreamRef.current = null;
        recordingFlowGateRef.current = false;
        (window as unknown as { clipsForceAlive?: boolean }).clipsForceAlive =
          false;
        setRecordingFlowActive(false);
        setRecorder(null);
        // Force a fresh bubble session even when bubbleActive stays true
        // (popover still open / camera still on). Without this epoch bump the
        // effect does not re-run and reopen shows ended tracks until Start
        // discovers them.
        setBubbleSessionEpoch((epoch) => epoch + 1);

        let stopFailed = false;
        let stopResult: RecorderStopResult | null = null;
        try {
          stopResult = await handle.stop();
          if (stopResult.localOnly) {
            setLocalRecordingNotice({
              folderPath: stopResult.localFolder,
              files: stopResult.localFiles ?? [],
            });
          } else {
            setLastRecordingId(stopResult.recordingId);
          }
        } catch (err) {
          stopFailed = true;
          setRecError(err instanceof Error ? err.message : String(err));
          await loadPendingUploads();
        } finally {
          recordingStopFinalizingRef.current = false;
          setRecordingStopFinalizing(false);
          invoke("set_recording_state", { active: false }).catch(() => {});
          if (stopFailed || stopResult?.localOnly) {
            invoke("show_popover").catch(() => {});
          } else {
            // Close the popover — recorder.stop() already opened the
            // recording's page in the default browser. The popover doesn't
            // need to hang around.
            getCurrentWindow()
              .hide()
              .catch(() => {});
            emit("clips:popover-visible", false).catch(() => {});
          }
        }
      }),
    );
    track(
      listen("clips:recorder-cancel", async () => {
        try {
          await recorder.cancel();
        } finally {
          if (!cancelled) {
            (
              window as unknown as { clipsForceAlive?: boolean }
            ).clipsForceAlive = false;
            bubbleStreamTransferredToRecorder.current = false;
            bubbleStreamRef.current = null;
            recordingFlowGateRef.current = false;
            setRecorder(null);
            setRecordingFlowActive(false);
            setBubbleSessionEpoch((epoch) => epoch + 1);
            invoke("set_recording_state", { active: false }).catch(() => {});
            invoke("show_popover").catch(() => {});
          }
        }
      }),
    );
    track(
      listen("clips:recorder-restart", async () => {
        try {
          await recorder.cancel();
        } finally {
          if (!cancelled) {
            (
              window as unknown as { clipsForceAlive?: boolean }
            ).clipsForceAlive = false;
            bubbleStreamTransferredToRecorder.current = false;
            bubbleStreamRef.current = null;
            recordingFlowGateRef.current = false;
            setRecorder(null);
            setRecordingFlowActive(false);
            setBubbleSessionEpoch((epoch) => epoch + 1);
            invoke("set_recording_state", { active: false }).catch(() => {});
            // Starting a new browser capture must come from a fresh click in
            // this webview. The toolbar click arrives here through async Tauri
            // IPC, so reopen the popover and let the next Start click provide
            // the required user activation.
            invoke("show_popover").catch(() => {});
          }
        }
      }),
    );
    return () => {
      cancelled = true;
      unlisteners.forEach((u) => {
        try {
          u();
        } catch {
          // ignore
        }
      });
      unlisteners.length = 0;
    };
  }, [recorder, loadPendingUploads]);

  // Auto-hide on blur is handled on the Rust side (tauri::WindowEvent::Focused).

  const showCameraRow = mode !== "screen"; // screen-only has no camera
  const showSourceRow = mode !== "camera"; // camera-only has no screen source

  async function setHomeRewindRemembering(remembering: boolean) {
    if (homeScreenMemoryBusy) return;
    if (remembering && featureConfig?.screenMemory?.enabled !== true) {
      setRewindSettingsReturnView("recorder");
      setPromptRewindEnable(true);
      setPopoverView("rewind-settings");
      return;
    }
    setHomeScreenMemoryBusy(true);
    try {
      const current = await invoke<FeatureConfig>("get_feature_config");
      await invoke("set_feature_config", {
        config: {
          ...current,
          screenMemory: {
            ...DEFAULT_SCREEN_MEMORY_CONFIG,
            ...current.screenMemory,
            // Once Rewind has been set up, the everyday Home switch is a
            // pause/resume control. Full disable and capture permissions live
            // in Rewind Settings, so an accidental Home click never tears
            // down the configured memory system or asks for consent again.
            enabled: true,
            paused: !remembering,
          },
        },
      });
      const status = await invoke<ScreenMemoryStatus>("screen_memory_status");
      setHomeScreenMemoryStatus(status);
    } catch (err) {
      console.error(
        "[clips-tray] update Rewind remembering state failed:",
        err,
      );
    } finally {
      setHomeScreenMemoryBusy(false);
    }
  }

  const pendingUploadBanner = recordingStopFinalizing ? (
    <FinalizingUploadBanner />
  ) : pendingUploads.length > 0 ? (
    <PendingUploadBanner
      uploads={pendingUploads}
      retryingUploadId={retryingUploadId}
      exportingUploadId={exportingUploadId}
      dismissingUploadId={dismissingUploadId}
      onExport={exportPendingUpload}
      onRetry={retryPendingUpload}
      onDismiss={dismissPendingUpload}
      onOpenFolder={openPendingUploadFolder}
      onConnectStorage={(upload) => openVideoStorageSetup(upload.serverUrl)}
    />
  ) : null;

  async function copyRewindAgentPrompt() {
    try {
      await navigator.clipboard.writeText(REWIND_AGENT_PROMPT);
      setRewindAgentPromptCopied(true);
      window.setTimeout(() => setRewindAgentPromptCopied(false), 1_500);
    } catch (err) {
      console.error("[clips-tray] copy Rewind agent prompt failed:", err);
    }
  }

  if (agentHandoff) {
    const durationSeconds = Math.max(
      1,
      Math.round(
        (new Date(agentHandoff.endAt).getTime() -
          new Date(agentHandoff.startAt).getTime()) /
          1_000,
      ),
    );
    return (
      <div className="app app-settings" ref={appRef}>
        <div className="setup popover-view rewind-settings-surface">
          <div className="setup-header">
            <h2>
              {agentHandoff.status === "pending"
                ? "Review before sending"
                : agentHandoff.status === "processing"
                  ? "Making a private Clip"
                  : agentHandoff.status === "ready"
                    ? "Clip sent to your agent"
                    : "Clip handoff needs attention"}
            </h2>
          </div>
          <div className="rewind-agent-guide">
            <div className="rewind-agent-guide-icon">
              <IconHistory size={17} stroke={1.8} />
            </div>
            <div>
              <strong>{agentHandoff.reason}</strong>
              <p>
                {new Date(agentHandoff.startAt).toLocaleString()} –{" "}
                {new Date(agentHandoff.endAt).toLocaleTimeString()} ·{" "}
                {durationSeconds} seconds
              </p>
            </div>
          </div>
          <div className="rewind-local-promise">
            <IconShieldLock size={17} stroke={1.8} />
            <p>
              <strong>Only this interval becomes a private Clip.</strong> The
              rolling Rewind archive and its local paths stay on this Mac.
              {agentHandoff.agentClipRetention === "forever"
                ? " This Clip will be kept in your Library."
                : ` It uses your ${agentHandoff.agentClipRetention.replace("-", " ")} agent-Clip retention setting.`}
            </p>
          </div>
          {agentHandoff.status === "pending" ? (
            <>
              <div className="setup-grid">
                <div className="setup-mini-field">
                  <span>Microphone</span>
                  <Switch
                    on={agentHandoff.includeMicrophone}
                    onChange={(includeMicrophone) =>
                      setAgentHandoff({ ...agentHandoff, includeMicrophone })
                    }
                    label="Include microphone audio"
                  />
                </div>
                <div className="setup-mini-field">
                  <span>Mac audio</span>
                  <Switch
                    on={agentHandoff.includeSystemAudio}
                    onChange={(includeSystemAudio) =>
                      setAgentHandoff({ ...agentHandoff, includeSystemAudio })
                    }
                    label="Include Mac audio"
                  />
                </div>
              </div>
              <button
                type="button"
                className="secondary"
                disabled={agentHandoffPreviewBusy}
                onClick={() => void previewAgentHandoff(agentHandoff)}
              >
                {agentHandoffPreviewBusy
                  ? "Preparing preview…"
                  : "Preview range"}
              </button>
              {agentHandoffPreviewError ? (
                <p className="setup-error" role="alert">
                  {agentHandoffPreviewError}
                </p>
              ) : null}
              <button
                type="button"
                className="primary rewind-consent-primary"
                onClick={() => void processAgentHandoff(agentHandoff)}
              >
                Send selected range to agent
              </button>
              <button
                type="button"
                className="rewind-quiet-button"
                onClick={async () => {
                  await updateAgentHandoff(agentHandoff.requestId, "declined");
                  setAgentHandoff(null);
                }}
              >
                Don’t send
              </button>
            </>
          ) : agentHandoff.status === "processing" ? (
            <p className="setup-hint" role="status">
              Materializing the bounded range, uploading it privately, and
              preparing transcript and frame access for your agent…
            </p>
          ) : agentHandoff.status === "ready" ? (
            <>
              <p className="setup-hint" role="status">
                The agent received a temporary access link. The private Clip
                itself remains in your Library according to your retention
                setting.
              </p>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  if (!agentHandoff.agentUrl) return;
                  import("@tauri-apps/plugin-shell")
                    .then(({ open }) => open(agentHandoff.agentUrl!))
                    .catch(() => {});
                }}
              >
                Open Clip
              </button>
              <button
                type="button"
                className="primary rewind-consent-primary"
                onClick={() => setAgentHandoff(null)}
              >
                Done
              </button>
            </>
          ) : (
            <>
              <p className="setup-error" role="alert">
                {agentHandoff.error || "The bounded Clip could not be sent."}
              </p>
              <button
                type="button"
                className="secondary"
                onClick={() => setAgentHandoff(null)}
              >
                Close
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (popoverView === "memory" || popoverView === "rewind-settings") {
    return (
      <div className="app app-settings" ref={appRef}>
        {pendingUploadBanner}
        {isRecording ? <ActiveRecordingBanner /> : null}
        <Setup
          surface={popoverView === "memory" ? "memory" : "rewind"}
          recordingActive={isRecording || recordingFlowActive}
          promptRewindEnable={promptRewindEnable}
          initial={serverUrl}
          serverUrl={serverUrl}
          signedInAs={signedInAs}
          voiceShortcut={voiceShortcut}
          voiceCustomShortcut={voiceCustomShortcut}
          popoverCustomShortcut={popoverCustomShortcut}
          recordCustomShortcut={recordCustomShortcut}
          voiceMode={voiceMode}
          voiceProvider={voiceProvider}
          voiceInstructions={voiceInstructions}
          shortcutRegistrationError={shortcutRegistrationError}
          onVoiceShortcutChange={updateVoiceShortcut}
          onVoiceCustomShortcutChange={setVoiceCustomShortcut}
          onPopoverCustomShortcutChange={setPopoverCustomShortcut}
          onRecordCustomShortcutChange={setRecordCustomShortcut}
          onVoiceModeChange={setVoiceMode}
          onVoiceProviderChange={setVoiceProvider}
          onVoiceInstructionsChange={setVoiceInstructions}
          onSignOut={signOut}
          onConnect={(url) => {
            saveString(STORAGE_KEY, url.replace(/\/+$/, ""));
            setServerUrl(url.replace(/\/+$/, ""));
            setPopoverView("recorder");
          }}
          onOpenRewind={() => setPopoverView("rewind-settings")}
          onOpenMemory={() => setPopoverView("memory")}
          onCancel={() => {
            setPromptRewindEnable(false);
            setPopoverView(
              popoverView === "memory"
                ? "rewind-settings"
                : rewindSettingsReturnView,
            );
          }}
        />
      </div>
    );
  }

  if (popoverView === "settings") {
    return (
      <div className="app app-settings" ref={appRef}>
        {pendingUploadBanner}
        {isRecording ? <ActiveRecordingBanner /> : null}
        <Setup
          recordingActive={isRecording || recordingFlowActive}
          initial={serverUrl}
          serverUrl={serverUrl}
          signedInAs={signedInAs}
          voiceShortcut={voiceShortcut}
          voiceCustomShortcut={voiceCustomShortcut}
          popoverCustomShortcut={popoverCustomShortcut}
          recordCustomShortcut={recordCustomShortcut}
          voiceMode={voiceMode}
          voiceProvider={voiceProvider}
          voiceInstructions={voiceInstructions}
          shortcutRegistrationError={shortcutRegistrationError}
          onVoiceShortcutChange={updateVoiceShortcut}
          onVoiceCustomShortcutChange={setVoiceCustomShortcut}
          onPopoverCustomShortcutChange={setPopoverCustomShortcut}
          onRecordCustomShortcutChange={setRecordCustomShortcut}
          onVoiceModeChange={setVoiceMode}
          onVoiceProviderChange={setVoiceProvider}
          onVoiceInstructionsChange={setVoiceInstructions}
          onSignOut={signOut}
          onConnect={(url) => {
            saveString(STORAGE_KEY, url.replace(/\/+$/, ""));
            setServerUrl(url.replace(/\/+$/, ""));
            setPopoverView("recorder");
          }}
          onOpenRewind={() => {
            setPromptRewindEnable(false);
            setRewindSettingsReturnView("settings");
            setPopoverView("rewind-settings");
          }}
          onCancel={() => setPopoverView("recorder")}
        />
      </div>
    );
  }

  if (popoverView === "meetings") {
    return (
      <div className="app app-popover-view" ref={appRef}>
        {pendingUploadBanner}
        {isRecording ? <ActiveRecordingBanner /> : null}
        <MeetingsPopoverView
          meetings={meetings}
          loading={meetingsLoading}
          error={meetingsError}
          startMessage={meetingStartMessage}
          activeMeetingId={activeMeetingId}
          meetingsEnabled={featureConfig?.meetingsEnabled !== false}
          rewindHistoryAvailability={rewindMeetingHistoryAvailability}
          onBack={() => setPopoverView("recorder")}
          onRefresh={fetchUpcomingMeetings}
          onOpenMeetings={() => openInBrowser("/meetings")}
          onOpenMeeting={(meetingId) =>
            openInBrowser(`/meetings/${encodeURIComponent(meetingId)}`)
          }
          onOpenSettings={() => setPopoverView("settings")}
          onStartNotes={startMeetingNotes}
          onStartNotesAndJoin={startMeetingNotesAndJoin}
          onShowActiveMeeting={showActiveMeetingPill}
        />
      </div>
    );
  }

  if (popoverView === "dictation") {
    return (
      <div className="app app-popover-view" ref={appRef}>
        {pendingUploadBanner}
        {isRecording ? <ActiveRecordingBanner /> : null}
        <DictationPopoverView
          voiceEnabled={voiceDictationEnabled}
          voiceShortcut={voiceShortcut}
          voiceCustomShortcut={voiceCustomShortcut}
          voiceMode={voiceMode}
          voiceProvider={voiceProvider}
          onBack={() => setPopoverView("recorder")}
          onOpenDictate={() => openInBrowser("/dictate")}
          onOpenSettings={() => setPopoverView("settings")}
        />
      </div>
    );
  }

  // When unauthenticated, render the sign-in form INLINE in the popover
  // (not a separate Tauri window). This avoids Tauri 2's separate-WebKit-
  // data-store-per-WebviewWindow cookie-jar issue — the cookie is set in
  // the same webview that reads it on the next /auth/session poll.
  // OAuth (Google / Apple) still needs a browser, so we offer that as a
  // secondary link via signInExternal().
  if (authStatus === "anon") {
    return (
      <div className="app" ref={appRef}>
        <Header
          mode={mode}
          onModeChange={setMode}
          submitterEmail={signedInAs}
        />
        <UpdateBanner />
        {pendingUploadBanner}
        {signInPending ? (
          <div className="signin-pending">
            <div className="signin-pending-spinner" />
            <p className="signin-pending-text">Waiting for browser sign-in…</p>
            <button
              type="button"
              className="signin-pending-cancel"
              onClick={() => {
                if (pollIntervalRef.current !== null) {
                  clearInterval(pollIntervalRef.current);
                  pollIntervalRef.current = null;
                }
                signInInflightRef.current = false;
                setSignInPending(false);
                setSignInError(null);
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            {signInError ? (
              <div className="error-banner">{signInError}</div>
            ) : null}
            <SignInForm
              serverUrl={serverUrl}
              onSignedIn={async () => {
                setSignInError(null);
                await checkAuth();
              }}
              onUseBrowser={signInExternal}
            />
          </>
        )}
        <div className="footer">
          <a className="footer-link" onClick={() => setPopoverView("settings")}>
            Settings
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="app app-recorder" ref={appRef}>
      <div className="recorder-home-content">
        <Header
          mode={mode}
          onModeChange={setMode}
          submitterEmail={signedInAs}
        />
        <UpdateBanner />

        {pendingUploadBanner}

        {isRecording ? <ActiveRecordingBanner /> : null}

        {localRecordingMode !== "off" ? (
          <LocalRecordingModeBanner mode={localRecordingMode} />
        ) : null}

        {localRecordingNotice ? (
          <LocalRecordingSavedBanner
            notice={localRecordingNotice}
            onDismiss={() => setLocalRecordingNotice(null)}
            onOpenFolder={() => {
              if (!localRecordingNotice.folderPath) return;
              invoke("open_local_recording_folder", {
                path: localRecordingNotice.folderPath,
              }).catch((err) => {
                console.error("[clips-tray] open local folder failed:", err);
              });
            }}
          />
        ) : null}

        <div className="panel">
          {showSourceRow ? (
            <SourceRow
              value={source}
              onChange={setSource}
              includeRegion={isMacPlatform()}
            />
          ) : null}

          {showCameraRow ? (
            <MediaDeviceRow
              kind="camera"
              devices={cameraDevices}
              selectedId={cameraId}
              selectedLabel={cameraLabel}
              onSelect={(id, label) => {
                setCameraId(id);
                setCameraLabel(label);
              }}
              onRefresh={() => requestDeviceAccess("camera")}
              on={cameraOn}
              onToggle={setCameraOn}
            />
          ) : null}

          <MediaDeviceRow
            kind="mic"
            devices={micDevices}
            selectedId={selectedMicId}
            selectedLabel={micLabel}
            onSelect={(id, label) => {
              setMicId(id);
              setMicLabel(label);
            }}
            onRefresh={() => requestDeviceAccess("mic")}
            on={micOn}
            onToggle={setMicOn}
            systemAudio={systemAudioOn}
            onSystemAudioToggle={setSystemAudioOn}
            meterActive={popoverVisible && !isRecording && !recordingFlowActive}
          />
        </div>

        <ReadinessPanel
          mode={mode}
          cameraOn={cameraOn}
          micOn={micOn}
          includeVoicePaste={voiceDictationEnabled}
          includeFnMonitoring={fnShortcutEnabled}
          open={readinessOpen}
          onOpenChange={updateReadinessOpen}
          onOpenPermission={openPrivacySettings}
        />

        <section className="rewind-home-card" aria-label="Rewind status">
          <div className="rewind-home-status">
            <span
              className={`rewind-home-dot ${homeRewindPresentation.isLive ? "is-live" : ""}`}
            />
            <div>
              <strong>{homeRewindPresentation.title}</strong>
              {!homeRewindPresentation.isLive ? (
                <p>{homeRewindPresentation.detail}</p>
              ) : null}
            </div>
            <div className="rewind-home-controls">
              <button
                type="button"
                className="rewind-agent-prompt-copy"
                onClick={() => void copyRewindAgentPrompt()}
                aria-label={
                  rewindAgentPromptCopied
                    ? "Setup prompt copied — paste it into your agent once"
                    : "Set up your agent"
                }
                title={
                  rewindAgentPromptCopied
                    ? "Setup prompt copied — paste it into your agent once"
                    : "Set up your agent"
                }
              >
                {rewindAgentPromptCopied ? (
                  <IconCircleCheck size={15} stroke={2} />
                ) : (
                  <IconCopy size={15} stroke={1.9} />
                )}
              </button>
              <Switch
                on={
                  featureConfig?.screenMemory?.enabled === true &&
                  featureConfig.screenMemory.paused !== true
                }
                disabled={
                  homeScreenMemoryBusy || isRecording || recordingFlowActive
                }
                onChange={(remembering) =>
                  void setHomeRewindRemembering(remembering)
                }
                label={
                  featureConfig?.screenMemory?.enabled === true
                    ? "Remember with Rewind"
                    : "Set up Rewind"
                }
              />
            </div>
          </div>
        </section>

        {!isRecording ? (
          <button
            className="primary start"
            disabled={
              localRecordingMode === "off" && videoStorageStatus === "checking"
            }
            onClick={() => {
              void handleStartRecording();
            }}
          >
            {localRecordingMode === "off" && videoStorageStatus === "checking"
              ? "Checking storage..."
              : localRecordingMode === "off"
                ? "Start recording"
                : "Start local recording"}
          </button>
        ) : null}
        {recError ? (
          recError === MACOS_UPDATE_RESTART_MESSAGE ? (
            <UpdateRestartBanner message={recError} />
          ) : recError === MACOS_CAPTURE_PERMISSION_MESSAGE ||
            recError === MACOS_SCREEN_PERMISSION_MESSAGE ||
            recError === DESKTOP_CAPTURE_PERMISSION_MESSAGE ? (
            <PermissionRecoveryBanner
              kind="recording"
              message={recError}
              panes={
                recError === MACOS_SCREEN_PERMISSION_MESSAGE
                  ? ["screen"]
                  : permissionPanesForRecording(mode, cameraOn, micOn)
              }
              onRetry={handleStartRecording}
            />
          ) : recError === MACOS_SPEECH_PERMISSION_MESSAGE ? (
            <PermissionRecoveryBanner
              kind="speech"
              message={recError}
              panes={["speech", "microphone"]}
              onRetry={handleStartRecording}
            />
          ) : isStorageSetupFailureMessage(recError) ? (
            <StorageConnectionBanner
              onConnect={() => openVideoStorageSetup()}
            />
          ) : (
            <div className="error-banner">{recError}</div>
          )
        ) : null}
        {cameraError && !recError ? (
          cameraError === MACOS_CAPTURE_PERMISSION_MESSAGE ||
          cameraError === DESKTOP_CAPTURE_PERMISSION_MESSAGE ? (
            <PermissionRecoveryBanner
              kind="camera"
              message={cameraError}
              panes={["camera"]}
              onRetry={retryCameraPreview}
            />
          ) : (
            <div className="error-banner">{cameraError}</div>
          )
        ) : null}
      </div>

      <div className="bottom-row">
        <BottomButton
          icon="library"
          label="Library"
          onClick={() => openInBrowser("/")}
        />
        <BottomButton
          icon="meetings"
          label="Meetings"
          onClick={() => setPopoverView("meetings")}
        />
        <BottomButton
          icon="dictation"
          label="Dictate"
          badge={undefined}
          onClick={() => setPopoverView("dictation")}
        />
        <BottomButton
          icon="settings"
          label="Settings"
          onClick={() => setPopoverView("settings")}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function hidePopover() {
  // Hide the Tauri window + tell Rust so it can broadcast the
  // popover-visible=false event (which in turn tears down the bubble).
  getCurrentWindow()
    .hide()
    .catch(() => {});
  emit("clips:popover-visible", false).catch(() => {});
}

function permissionPanesForRecording(
  mode: CaptureMode,
  cameraOn: boolean,
  micOn: boolean,
): MacosPrivacyPane[] {
  const panes: MacosPrivacyPane[] = [];
  if (mode !== "camera") panes.push("screen");
  if (micOn) panes.push("microphone", "speech");
  if (mode !== "screen" && cameraOn) panes.push("camera");
  return Array.from(new Set(panes));
}

function permissionPaneLabel(pane: MacosPrivacyPane): string {
  return {
    camera: "Camera",
    microphone: "Microphone",
    screen: "Screen",
    speech: "Speech",
    accessibility: "Accessibility",
    "input-monitoring": "Input Monitoring",
  }[pane];
}

function PermissionRecoveryBanner({
  kind,
  message,
  panes,
  onRetry,
}: {
  kind: "recording" | "speech" | "camera";
  message: string;
  panes: MacosPrivacyPane[];
  onRetry: () => void;
}) {
  const title =
    kind === "speech"
      ? "Transcript setup blocked"
      : kind === "camera"
        ? "Camera setup blocked"
        : "Recording setup blocked";
  const uniquePanes = Array.from(new Set(panes));
  const canOpenPrivacySettings = isMacPlatform() || isWindowsPlatform();

  return (
    <div className="error-banner permission-banner">
      <div className="permission-copy">
        <div className="permission-title">{title}</div>
        <div>{message}</div>
      </div>
      <div className="permission-actions" aria-label="Permission recovery">
        {canOpenPrivacySettings
          ? uniquePanes.map((pane) => (
              <button
                type="button"
                key={pane}
                onClick={() => openPrivacySettings(pane)}
              >
                {permissionPaneLabel(pane)}
              </button>
            ))
          : null}
        <button type="button" className="permission-retry" onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  );
}

function UpdateRestartBanner({ message }: { message: string }) {
  return (
    <div className="error-banner permission-banner">
      <div className="permission-copy">
        <div className="permission-title">Restart to finish updating</div>
        <div>{message}</div>
      </div>
      <div className="permission-actions">
        <button
          type="button"
          className="permission-retry"
          onClick={() => {
            installAndRestart().catch((err) => {
              console.error("[clips-updater] relaunch failed:", err);
            });
          }}
        >
          Restart Clips
        </button>
      </div>
    </div>
  );
}

function StorageConnectionBanner({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="storage-flow-banner">
      <div className="storage-flow-icon" aria-hidden>
        <IconUpload size={17} stroke={1.8} />
      </div>
      <div className="storage-flow-copy">
        <div className="storage-flow-title">
          Connect storage to keep recording
        </div>
        <div className="storage-flow-sub">{STORAGE_SETUP_HELP_TEXT}</div>
      </div>
      <button
        type="button"
        className="storage-flow-connect"
        onClick={onConnect}
      >
        <IconExternalLink size={14} stroke={2} />
        Connect
      </button>
    </div>
  );
}

function PendingUploadBanner({
  uploads,
  retryingUploadId,
  exportingUploadId,
  dismissingUploadId,
  onExport,
  onRetry,
  onDismiss,
  onOpenFolder,
  onConnectStorage,
}: {
  uploads: PendingDesktopUpload[];
  retryingUploadId: string | null;
  exportingUploadId: string | null;
  dismissingUploadId: string | null;
  onExport: (upload: PendingDesktopUpload) => void;
  onRetry: (upload: PendingDesktopUpload) => void;
  onDismiss: (upload: PendingDesktopUpload) => void;
  onOpenFolder: (upload: PendingDesktopUpload) => void;
  onConnectStorage: (upload: PendingDesktopUpload) => void;
}) {
  const latest = uploads[0];
  if (!latest) return null;

  const retrying = retryingUploadId === latest.recordingId;
  const storageSetupFailure = isStorageSetupFailureMessage(latest.lastError);
  const exporting = exportingUploadId === latest.recordingId;
  const canOpenFolder = latest.kind === "native" && !!latest.folderPath;
  const canExport = latest.kind === "browser";
  const actionsDisabled =
    !!retryingUploadId || !!exportingUploadId || !!dismissingUploadId;
  const savedLabel =
    uploads.length === 1
      ? "1 Clip saved locally"
      : `${uploads.length} Clips saved locally`;
  const nativeCorrupt = latest.kind === "native" && !!latest.corrupt;
  const title = nativeCorrupt
    ? uploads.length === 1
      ? "Clip could not be finalized"
      : "Some Clips could not be finalized"
    : storageSetupFailure
      ? uploads.length === 1
        ? "Connect storage to upload saved Clip"
        : "Connect storage to upload saved Clips"
      : savedLabel;
  const details = [
    latest.savedAt ? `saved ${formatAgo(latest.savedAt)}` : null,
    formatFileSize(latest.bytes),
  ].filter(Boolean);
  const errorText = latest.lastError
    ? latest.lastError.replace(/\s+/g, " ").slice(0, 140)
    : null;

  return (
    <div className="pending-upload-banner">
      <div className="pending-upload-icon" aria-hidden>
        <IconUpload size={17} stroke={1.8} />
      </div>
      <div className="pending-upload-copy">
        <div className="pending-upload-title">{title}</div>
        <div
          className={
            storageSetupFailure
              ? "pending-upload-sub pending-upload-sub-wrap"
              : "pending-upload-sub"
          }
        >
          {nativeCorrupt
            ? `${details.join(" · ")} · file may be unusable`
            : storageSetupFailure
              ? `${details.join(" · ")} · your clip is safe locally`
              : `${details.join(" · ")}${errorText ? ` · ${errorText}` : ""}`}
        </div>
        {storageSetupFailure ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="pending-upload-why">
                Why am I seeing this?
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              align="start"
              className="tooltip-content-wide"
            >
              {STORAGE_SETUP_HELP_TEXT}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <div className="pending-upload-actions">
        {canOpenFolder ? (
          <button
            type="button"
            className="pending-upload-folder"
            disabled={actionsDisabled}
            onClick={() => onOpenFolder(latest)}
            aria-label="Open saved local clip folder"
            title="Open saved local clip folder"
          >
            <IconFolderOpen size={14} stroke={2} />
          </button>
        ) : null}
        {canExport ? (
          <button
            type="button"
            className="pending-upload-folder"
            disabled={actionsDisabled}
            onClick={() => onExport(latest)}
            aria-label="Download saved local clip"
            title="Download saved local clip"
          >
            <IconDownload size={14} stroke={2} />
          </button>
        ) : null}
        {latest.kind === "native" && latest.corrupt ? null : (
          <>
            {storageSetupFailure ? (
              <button
                type="button"
                className="pending-upload-connect"
                disabled={actionsDisabled}
                onClick={() => onConnectStorage(latest)}
              >
                <IconExternalLink size={14} stroke={2} />
                Connect
              </button>
            ) : null}
            <button
              type="button"
              className="pending-upload-retry"
              disabled={actionsDisabled}
              onClick={() => onRetry(latest)}
            >
              <IconRefresh size={14} stroke={2} />
              {retrying ? "Retrying" : "Retry"}
            </button>
          </>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="pending-upload-dismiss"
              disabled={actionsDisabled}
              onClick={() => onDismiss(latest)}
              aria-label="Dismiss saved clip warning"
            >
              <IconX size={16} stroke={2} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end">
            Dismiss warning and keep the clip in Clip Drafts
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function FinalizingUploadBanner() {
  return (
    <div className="pending-upload-banner">
      <div className="pending-upload-icon" aria-hidden>
        <IconUpload size={17} stroke={1.8} />
      </div>
      <div className="pending-upload-copy">
        <div className="pending-upload-title">Still finishing your Clip</div>
        <div className="pending-upload-sub">
          Recovery options will appear here if saving does not finish.
        </div>
      </div>
    </div>
  );
}

function localRecordingModeLabel(mode: Exclude<LocalRecordingMode, "off">) {
  return mode === "separate"
    ? "Local desktop + camera files"
    : "Local composed video";
}

function LocalRecordingModeBanner({
  mode,
}: {
  mode: Exclude<LocalRecordingMode, "off">;
}) {
  return (
    <div className="local-recording-banner">
      <IconInfoCircle size={16} stroke={1.8} aria-hidden />
      <span>
        {localRecordingModeLabel(mode)} is on. Clips will save to Movies/Clips
        and skip upload.
      </span>
    </div>
  );
}

function localFileRoleLabel(role: LocalExportedFile["role"]) {
  return {
    composed: "Video",
    desktop: "Desktop",
    camera: "Camera",
  }[role];
}

function LocalRecordingSavedBanner({
  notice,
  onOpenFolder,
  onDismiss,
}: {
  notice: LocalRecordingNotice;
  onOpenFolder: () => void;
  onDismiss: () => void;
}) {
  const fileSummary = notice.files
    .map((file) =>
      [localFileRoleLabel(file.role), formatFileSize(file.bytes)]
        .filter(Boolean)
        .join(" "),
    )
    .join(" · ");

  return (
    <div className="local-save-banner">
      <div className="local-save-copy">
        <div className="local-save-title">Saved locally</div>
        <div className="local-save-sub">
          {fileSummary || "Recording saved to Movies/Clips"}
        </div>
      </div>
      {notice.folderPath ? (
        <button type="button" onClick={onOpenFolder}>
          Open folder
        </button>
      ) : null}
      <button type="button" className="local-save-dismiss" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

function Header({
  mode,
  onModeChange,
  submitterEmail,
}: {
  mode: CaptureMode;
  onModeChange: (m: CaptureMode) => void;
  submitterEmail?: string | null;
}) {
  const [tooltipMode, setTooltipMode] = useState<CaptureMode | null>(null);
  const tooltipReadyAtRef = useRef(Date.now() + 600);
  const tooltipTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(
    null,
  );
  const suppressTooltipRef = useRef(false);

  const clearModeTooltip = useCallback(() => {
    if (tooltipTimerRef.current) {
      window.clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
    setTooltipMode(null);
  }, []);

  const queueModeTooltip = useCallback(
    (nextMode: CaptureMode) => {
      if (
        suppressTooltipRef.current ||
        Date.now() < tooltipReadyAtRef.current ||
        tooltipMode === nextMode ||
        tooltipTimerRef.current
      ) {
        return;
      }
      tooltipTimerRef.current = window.setTimeout(() => {
        tooltipTimerRef.current = null;
        if (!suppressTooltipRef.current) {
          setTooltipMode(nextMode);
        }
      }, 350);
    },
    [tooltipMode],
  );

  const leaveModeButton = useCallback(() => {
    suppressTooltipRef.current = false;
    clearModeTooltip();
  }, [clearModeTooltip]);

  const pressModeButton = useCallback(() => {
    suppressTooltipRef.current = true;
    clearModeTooltip();
  }, [clearModeTooltip]);

  useEffect(
    () => () => {
      if (tooltipTimerRef.current) {
        window.clearTimeout(tooltipTimerRef.current);
        tooltipTimerRef.current = null;
      }
    },
    [],
  );

  // Mode-toggle is absolutely centered (visual center of the popover) and the
  // close button lives top-right as an absolute-positioned sibling, so the
  // tabs aren't offset by the close button's width.
  return (
    <div className="header header-centered">
      <FeedbackButton submitterEmail={submitterEmail} />
      <div
        className="mode-toggle"
        role="radiogroup"
        aria-label="Recording mode"
      >
        <button
          className={mode === "screen" ? "active" : ""}
          onPointerEnter={() => {
            suppressTooltipRef.current = false;
          }}
          onPointerMove={() => queueModeTooltip("screen")}
          onPointerLeave={leaveModeButton}
          onPointerDown={pressModeButton}
          onClick={(event) => {
            suppressTooltipRef.current = true;
            clearModeTooltip();
            event.currentTarget.blur();
            onModeChange("screen");
          }}
          aria-label="Screen only"
        >
          <ScreenIcon />
          {tooltipMode === "screen" ? (
            <span className="mode-tooltip" role="tooltip">
              Screen
            </span>
          ) : null}
        </button>
        <button
          className={mode === "screen-camera" ? "active" : ""}
          onPointerEnter={() => {
            suppressTooltipRef.current = false;
          }}
          onPointerMove={() => queueModeTooltip("screen-camera")}
          onPointerLeave={leaveModeButton}
          onPointerDown={pressModeButton}
          onClick={(event) => {
            suppressTooltipRef.current = true;
            clearModeTooltip();
            event.currentTarget.blur();
            onModeChange("screen-camera");
          }}
          aria-label="Screen + Camera"
        >
          <ScreenCamIcon />
          {tooltipMode === "screen-camera" ? (
            <span className="mode-tooltip" role="tooltip">
              Screen + cam
            </span>
          ) : null}
        </button>
        <button
          className={mode === "camera" ? "active" : ""}
          onPointerEnter={() => {
            suppressTooltipRef.current = false;
          }}
          onPointerMove={() => queueModeTooltip("camera")}
          onPointerLeave={leaveModeButton}
          onPointerDown={pressModeButton}
          onClick={(event) => {
            suppressTooltipRef.current = true;
            clearModeTooltip();
            event.currentTarget.blur();
            onModeChange("camera");
          }}
          aria-label="Camera only"
        >
          <CamIcon />
          {tooltipMode === "camera" ? (
            <span className="mode-tooltip" role="tooltip">
              Camera
            </span>
          ) : null}
        </button>
      </div>
      <button
        className="icon-button header-close"
        onClick={hidePopover}
        aria-label="Close"
        title="Close"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

function SignInForm({
  serverUrl,
  onSignedIn,
  onUseBrowser,
}: {
  serverUrl: string;
  onSignedIn: () => Promise<void> | void;
  onUseBrowser: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      // Post to the framework's Better Auth-backed email/password endpoint.
      // Production Tauri builds cannot rely on cross-origin cookies sticking,
      // so the desktop fetch interceptor stores the returned session token and
      // sends it as Authorization on later same-server requests.
      const res = await fetch(
        `${serverUrl.replace(/\/+$/, "")}/_agent-native/auth/login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), password }),
          credentials: "include",
        },
      );
      const json = (await res.json().catch(() => null)) as {
        error?: string;
        token?: string;
      } | null;
      if (!res.ok) {
        throw new Error(json?.error || `Sign in failed (${res.status})`);
      }
      if (json?.token) saveDesktopAuthToken(serverUrl, json.token);
      await onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="signin" onSubmit={onSubmit}>
      <div className="signin-title">Sign in to Clips</div>
      <input
        ref={emailRef}
        type="email"
        autoComplete="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <input
        type="password"
        autoComplete="current-password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error ? <div className="error-banner">{error}</div> : null}
      <button
        type="submit"
        className="primary start"
        disabled={submitting || !email || !password}
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
      <div className="signin-divider">
        <span>or</span>
      </div>
      <button
        type="button"
        className="signin-google"
        onClick={onUseBrowser}
        title="Opens your default browser to complete Google sign-in"
      >
        <GoogleIcon />
        Continue with Google
      </button>
    </form>
  );
}

function PopoverSubViewHeader({
  title,
  onBack,
  action,
}: {
  title: string;
  onBack: () => void;
  action?: ReactNode;
}) {
  return (
    <div className="setup-header popover-view-header">
      <button
        type="button"
        className="setup-back"
        onClick={onBack}
        aria-label="Back"
      >
        <IconArrowLeft size={18} stroke={1.75} />
      </button>
      <h2>{title}</h2>
      <div className="popover-view-header-spacer" />
      {action}
    </div>
  );
}

function MeetingsPopoverView({
  meetings,
  loading,
  error,
  startMessage,
  activeMeetingId,
  meetingsEnabled,
  rewindHistoryAvailability,
  onBack,
  onRefresh,
  onOpenMeetings,
  onOpenMeeting,
  onOpenSettings,
  onStartNotes,
  onStartNotesAndJoin,
  onShowActiveMeeting,
}: {
  meetings: PopoverMeeting[];
  loading: boolean;
  error: string | null;
  startMessage: string | null;
  activeMeetingId: string | null;
  meetingsEnabled: boolean;
  rewindHistoryAvailability: Record<string, RewindMeetingHistoryAvailability>;
  onBack: () => void;
  onRefresh: () => void;
  onOpenMeetings: () => void;
  onOpenMeeting: (meetingId: string) => void;
  onOpenSettings: () => void;
  onStartNotes: (
    meeting: PopoverMeeting,
    includeFromMeetingStart?: boolean,
  ) => void;
  onStartNotesAndJoin: (
    meeting: PopoverMeeting,
    includeFromMeetingStart?: boolean,
  ) => void;
  onShowActiveMeeting: (meetingId: string) => void;
}) {
  const [includeHistoryFor, setIncludeHistoryFor] = useState<Set<string>>(
    () => new Set(),
  );

  const consumeIncludeHistoryChoice = (meeting: PopoverMeeting): boolean => {
    const include = includeHistoryFor.has(meeting.id);
    // This is intentionally a one-shot choice. It never follows the next
    // meeting, an automatic start, or a tray action around like a lost duck.
    setIncludeHistoryFor((current) => {
      const next = new Set(current);
      next.delete(meeting.id);
      return next;
    });
    return include;
  };

  return (
    <div className="setup popover-view">
      <PopoverSubViewHeader
        title="Meetings"
        onBack={onBack}
        action={
          <button
            type="button"
            className="link-button popover-view-link"
            onClick={onOpenMeetings}
          >
            Open web
          </button>
        }
      />

      <div className="setup-section">
        <p className="setup-hint">
          Start Granola-style live notes from calendar meetings without hunting
          through Settings.
        </p>
      </div>

      {!meetingsEnabled ? (
        <div className="popover-empty-card">
          <strong>Meeting notes are off</strong>
          <p>Turn them on to show reminders and start live transcription.</p>
          <button type="button" className="secondary" onClick={onOpenSettings}>
            Open meeting settings
          </button>
        </div>
      ) : error ? (
        <div className="popover-empty-card">
          <strong>Could not load meetings</strong>
          <p>{error}</p>
          <button type="button" className="secondary" onClick={onRefresh}>
            Try again
          </button>
        </div>
      ) : loading ? (
        <div className="popover-empty-card">
          <strong>Loading meetings…</strong>
          <p>Checking your connected calendar.</p>
        </div>
      ) : meetings.length === 0 ? (
        <div className="popover-empty-card">
          <strong>No meetings ready</strong>
          <p>Connect Google Calendar or open the Meetings page to see setup.</p>
          <button type="button" className="secondary" onClick={onOpenMeetings}>
            Open Meetings
          </button>
        </div>
      ) : (
        <div className="popover-list">
          {meetings.map((meeting) => {
            const canStart = meetingCanStartNotes(meeting);
            const hasJoin = Boolean(meeting.joinUrl);
            const isActive = activeMeetingId === meeting.id;
            const rewindHistory = rewindHistoryAvailability[meeting.id];
            const includeHistory = includeHistoryFor.has(meeting.id);
            return (
              <div className="popover-list-item" key={meeting.id}>
                <div className="popover-list-icon">
                  <IconCalendarEvent size={17} stroke={1.75} />
                </div>
                <div className="popover-list-main">
                  <div className="popover-list-title">{meeting.title}</div>
                  <div className="popover-list-sub">
                    {formatMeetingWhen(meeting)}
                    {meeting.platform ? ` · ${meeting.platform}` : ""}
                  </div>
                  {canStart && rewindHistory?.available ? (
                    <label className="popover-list-sub">
                      <input
                        type="checkbox"
                        checked={includeHistory}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setIncludeHistoryFor((current) => {
                            const next = new Set(current);
                            if (checked) next.add(meeting.id);
                            else next.delete(meeting.id);
                            return next;
                          });
                        }}
                      />{" "}
                      Include from meeting start
                    </label>
                  ) : null}
                </div>
                {isActive ? (
                  <button
                    type="button"
                    className="popover-list-action popover-list-action-active"
                    onClick={() => onShowActiveMeeting(meeting.id)}
                    title="Meeting notes are recording"
                  >
                    <span className="popover-list-action-dot" aria-hidden />
                    Recording
                  </button>
                ) : canStart ? (
                  <button
                    type="button"
                    className="popover-list-action popover-list-action-primary"
                    onClick={() =>
                      hasJoin
                        ? onStartNotesAndJoin(
                            meeting,
                            consumeIncludeHistoryChoice(meeting),
                          )
                        : onStartNotes(
                            meeting,
                            consumeIncludeHistoryChoice(meeting),
                          )
                    }
                    title={
                      hasJoin
                        ? "Start notes and join the meeting"
                        : "Start meeting notes"
                    }
                  >
                    {hasJoin ? "Start + join" : "Start notes"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="popover-list-action"
                    onClick={() => onOpenMeeting(meeting.id)}
                  >
                    Open
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {startMessage ? <p className="setup-success">{startMessage}</p> : null}
    </div>
  );
}

function DictationPopoverView({
  voiceEnabled,
  voiceShortcut,
  voiceCustomShortcut,
  voiceMode,
  voiceProvider,
  onBack,
  onOpenDictate,
  onOpenSettings,
}: {
  voiceEnabled: boolean;
  voiceShortcut: VoiceShortcutPreference;
  voiceCustomShortcut: string;
  voiceMode: VoiceMode;
  voiceProvider: VoiceProvider;
  onBack: () => void;
  onOpenDictate: () => void;
  onOpenSettings: () => void;
}) {
  const shortcut = voiceShortcutLabel(voiceShortcut, voiceCustomShortcut);
  return (
    <div className="setup popover-view">
      <PopoverSubViewHeader
        title="Dictate"
        onBack={onBack}
        action={
          <button
            type="button"
            className="link-button popover-view-link"
            onClick={onOpenDictate}
          >
            Open web
          </button>
        }
      />

      <div className="popover-empty-card">
        <div className="popover-card-heading">
          <IconMicrophone2 size={18} stroke={1.75} />
          <strong>
            {voiceEnabled ? "Ready to dictate" : "Dictation is off"}
          </strong>
        </div>
        {voiceEnabled ? (
          <>
            <p>
              {voiceMode === "toggle"
                ? "Press once to start, then press again to stop."
                : "Hold the shortcut while speaking; release to paste."}
            </p>
            <div className="popover-kv">
              <span>Shortcut</span>
              <strong>{shortcut}</strong>
            </div>
            <div className="popover-kv">
              <span>Provider</span>
              <strong>{voiceProviderLabel(voiceProvider)}</strong>
            </div>
          </>
        ) : (
          <p>Turn on voice dictation to speak to type anywhere on your Mac.</p>
        )}
      </div>

      <div className="setup-button-row">
        <button type="button" className="secondary" onClick={onOpenDictate}>
          Open Dictate history
        </button>
        <button type="button" className="secondary" onClick={onOpenSettings}>
          Dictation settings
        </button>
      </div>
    </div>
  );
}

function BottomButton({
  icon,
  label,
  badge,
  onClick,
}: {
  icon: "library" | "settings" | "meetings" | "dictation";
  label: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button className="bottom-btn" onClick={onClick}>
      <span className="bottom-icon">
        {icon === "library" ? (
          <LibraryIcon />
        ) : icon === "settings" ? (
          <SettingsIcon />
        ) : icon === "meetings" ? (
          <IconCalendarEvent size={18} stroke={1.75} />
        ) : (
          <IconMicrophone2 size={18} stroke={1.75} />
        )}
        {badge ? <span className="badge">{badge}</span> : null}
      </span>
      <span className="bottom-label">{label}</span>
    </button>
  );
}

function ActiveRecordingBanner() {
  return (
    <section
      className="active-recording-card active-recording-card-compact"
      aria-live="polite"
    >
      <span className="active-recording-live" aria-label="Live recording">
        <span className="active-recording-live-dot" aria-hidden="true" />
        REC
      </span>
      <div className="active-recording-copy">
        <strong>Recording in progress</strong>
      </div>
      <button
        type="button"
        className="primary rec-active active-recording-stop"
        onClick={() => emit("clips:recorder-stop").catch(() => {})}
      >
        Stop
      </button>
    </section>
  );
}

// ---- inline icons (Tabler-style, monochrome, stroke=1.75) -----------------

// ---------------------------------------------------------------------------

type VoiceProviderStatus = {
  browser: true;
  // Apple's SFSpeechRecognizer + AVAudioEngine driven from Rust. The
  // server reports `true` whenever it's available; the desktop client
  // additionally has it gated to macOS at the Tauri-command layer.
  "macos-native": boolean;
  builder: boolean;
  gemini: boolean;
  groq: boolean;
};

function keyForByokProvider(provider: ByokVoiceProvider): string {
  return {
    gemini: "GEMINI_API_KEY",
    groq: "GROQ_API_KEY",
  }[provider];
}

function labelForByokProvider(provider: ByokVoiceProvider): string {
  return {
    gemini: "Google Gemini",
    groq: "Groq",
  }[provider];
}

function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${Math.max(1, Math.round(mb))} MB`;
}

function desktopUpdateStatusText(status: UpdateStatus): string {
  switch (status.state) {
    case "idle":
      return "Clips checks automatically after launch, every hour, and when you return.";
    case "checking":
      return "Checking for updates...";
    case "not-available":
      return "Clips is up to date.";
    case "available":
      return `Update ${status.version} found. Downloading now...`;
    case "downloading":
      return `Downloading update ${status.version}... ${status.percent}%`;
    case "downloaded":
      return `Update ${status.version} is ready. Restart to install it.`;
    case "error":
      return `Update check failed: ${status.message}`;
  }
}

function Setup({
  surface = "settings",
  promptRewindEnable = false,
  recordingActive = false,
  initial,
  serverUrl,
  signedInAs,
  voiceShortcut,
  voiceCustomShortcut,
  popoverCustomShortcut,
  recordCustomShortcut,
  voiceMode,
  voiceProvider,
  voiceInstructions,
  shortcutRegistrationError,
  onVoiceShortcutChange,
  onVoiceCustomShortcutChange,
  onPopoverCustomShortcutChange,
  onRecordCustomShortcutChange,
  onVoiceModeChange,
  onVoiceProviderChange,
  onVoiceInstructionsChange,
  onConnect,
  onOpenRewind,
  onOpenMemory,
  onCancel,
  onSignOut,
}: {
  surface?: "settings" | "memory" | "rewind";
  promptRewindEnable?: boolean;
  recordingActive?: boolean;
  initial?: string | null;
  serverUrl?: string;
  signedInAs?: string | null;
  voiceShortcut: VoiceShortcutPreference;
  voiceCustomShortcut: string;
  popoverCustomShortcut: string;
  recordCustomShortcut: string;
  voiceMode: VoiceMode;
  voiceProvider: VoiceProvider;
  voiceInstructions: string;
  shortcutRegistrationError: string | null;
  onVoiceShortcutChange: (value: VoiceShortcutPreference) => void;
  onVoiceCustomShortcutChange: (value: string) => void;
  onPopoverCustomShortcutChange: (value: string) => void;
  onRecordCustomShortcutChange: (value: string) => void;
  onVoiceModeChange: (value: VoiceMode) => void;
  onVoiceProviderChange: (value: VoiceProvider) => void;
  onVoiceInstructionsChange: (value: string) => void;
  onConnect: (url: string) => void;
  onOpenRewind?: () => void;
  onOpenMemory?: () => void;
  onCancel?: () => void;
  onSignOut?: () => void;
}) {
  const [url, setUrl] = useState(initial ?? DEFAULT_URL);
  const [readinessOpen, setReadinessOpen] = useState(false);
  const featureConfig = useFeatureConfig();
  const updateStatus = useUpdateStatus();
  const voiceEnabled = featureConfig?.voiceEnabled !== false;
  const meetingsEnabled = featureConfig?.meetingsEnabled !== false;
  const launchAtLoginEnabled = featureConfig?.launchAtLoginEnabled !== false;
  const autoHidePopoverEnabled = featureConfig?.autoHidePopoverEnabled === true;
  const showInScreenCapture = featureConfig?.showInScreenCapture === true;
  const localRecordingMode = featureConfig?.localRecordingMode ?? "off";
  const observedScreenMemory =
    featureConfig?.screenMemory ?? DEFAULT_SCREEN_MEMORY_CONFIG;
  const [screenMemory, setScreenMemory] = useState(observedScreenMemory);
  const [rewindConsentOpen, setRewindConsentOpen] = useState(
    promptRewindEnable && observedScreenMemory.enabled !== true,
  );
  const [rewindConsentMode, setRewindConsentMode] = useState<
    "visuals" | "visuals-audio"
  >(observedScreenMemory.captureMode ?? "visuals");
  const screenMemoryRef = useRef(observedScreenMemory);
  const screenMemoryMutationRef = useRef(0);
  const screenMemoryMutationVersionRef = useRef(0);
  const screenMemoryMutationTailRef = useRef<Promise<void>>(Promise.resolve());
  const [screenMemoryConfigBusy, setScreenMemoryConfigBusy] = useState(false);

  useEffect(() => {
    if (screenMemoryMutationRef.current > 0) return;
    screenMemoryRef.current = observedScreenMemory;
    setScreenMemory(observedScreenMemory);
  }, [observedScreenMemory]);
  const regionGuides = featureConfig?.regionGuides ?? {
    enabled: false,
    rects: [],
    alwaysVisible: false,
  };
  const regionGuideRects = regionGuides.rects ?? [];
  const regionGuideCount = regionGuideRects.length;
  const regionGuidesAlwaysVisible = regionGuides.alwaysVisible === true;
  const meetingTranscriptionMode: MeetingTranscriptionMode =
    featureConfig?.meetingTranscriptionMode ?? "ask";
  const showMeetingWidgetEnabled =
    featureConfig?.showMeetingWidgetEnabled !== false;
  const whisperModelEnabled = featureConfig?.whisperModelEnabled !== false;
  type WhisperModelState = "disabled" | "missing" | "downloading" | "ready";
  interface WhisperModelStatus {
    state: WhisperModelState;
    path: string;
    downloadedMb: number;
    totalMb: number;
  }
  const [whisperStatus, setWhisperStatus] = useState<WhisperModelStatus | null>(
    null,
  );
  const [screenMemoryStatus, setScreenMemoryStatus] =
    useState<ScreenMemoryStatus | null>(null);
  const [screenMemoryMessage, setScreenMemoryMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const [screenMemoryExportResult, setScreenMemoryExportResult] =
    useState<ScreenMemoryExportResult | null>(null);
  const [clipDraftsError, setClipDraftsError] = useState<string | null>(null);
  const [screenMemoryBusy, setScreenMemoryBusy] = useState(false);
  const [rewindEgressEvents, setRewindEgressEvents] = useState<
    RewindEgressEvent[]
  >([]);
  const [rewindEgressOpen, setRewindEgressOpen] = useState(false);
  const [rewindLocalQuery, setRewindLocalQuery] = useState("");
  const [rewindLocalResult, setRewindLocalResult] =
    useState<RewindLocalAskResult | null>(null);
  const [rewindLocalBusy, setRewindLocalBusy] = useState(false);
  const [rewindLocalError, setRewindLocalError] = useState<string | null>(null);
  const [rewindReplayId, setRewindReplayId] = useState<string | null>(null);
  const [excludedBundleIdsInput, setExcludedBundleIdsInput] = useState("");
  const [excludedApps, setExcludedApps] = useState<RewindExcludedApplication[]>(
    [],
  );
  const [excludedAppsBusy, setExcludedAppsBusy] = useState(false);
  const [agentConnectionBusy, setAgentConnectionBusy] = useState<
    "codex" | "claude-code" | null
  >(null);
  const [agentConnectionMessage, setAgentConnectionMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const screenMemorySegments = screenMemoryStatus?.recentSegments ?? [];
  const screenMemoryTotalBytes = screenMemorySegments.reduce(
    (sum, segment) => sum + segment.bytes,
    0,
  );
  const rewindStatusPresentation = getRewindStatusPresentation({
    status: screenMemoryStatus,
    config: screenMemory,
    clipRecordingActive: recordingActive,
  });
  const captureControlsLocked = recordingActive;

  useEffect(() => {
    setExcludedBundleIdsInput(
      (screenMemory.excludedBundleIds ?? []).join(", "),
    );
    invoke<RewindExcludedApplication[]>("resolve_rewind_excluded_apps", {
      bundleIds: screenMemory.excludedBundleIds ?? [],
    })
      .then(setExcludedApps)
      .catch(() => {
        setExcludedApps(
          (screenMemory.excludedBundleIds ?? []).map((bundleId) => ({
            bundleId,
            name: bundleId.split(".").pop() || "Application",
            installed: false,
          })),
        );
      });
  }, [screenMemory.excludedBundleIds]);

  const excludedAppGroups = excludedApps.reduce<
    Array<RewindExcludedApplication & { bundleIds: string[] }>
  >((groups, app) => {
    const existing = groups.find(
      (candidate) => candidate.name.toLowerCase() === app.name.toLowerCase(),
    );
    if (existing) {
      existing.bundleIds.push(app.bundleId);
      existing.installed ||= app.installed;
      existing.path ||= app.path;
    } else {
      groups.push({ ...app, bundleIds: [app.bundleId] });
    }
    return groups;
  }, []);

  const [providerStatus, setProviderStatus] =
    useState<VoiceProviderStatus | null>(null);
  const [providerStatusLoading, setProviderStatusLoading] = useState(true);
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [apiKeyMessage, setApiKeyMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  function setVoiceEnabled(enabled: boolean) {
    if (!featureConfig) return;
    invoke("set_feature_config", {
      config: { ...featureConfig, voiceEnabled: enabled },
    }).catch((err) =>
      console.error("[settings] set_feature_config failed", err),
    );
  }

  function setMeetingsEnabled(enabled: boolean) {
    if (!featureConfig) return;
    invoke("set_feature_config", {
      config: { ...featureConfig, meetingsEnabled: enabled },
    }).catch((err) =>
      console.error("[settings] set_feature_config failed", err),
    );
  }

  function triggerWhisperDownload() {
    invoke("whisper_model_download").catch(() => {});
  }

  function setWhisperModelEnabled(enabled: boolean) {
    if (!featureConfig) return;
    invoke("set_feature_config", {
      config: { ...featureConfig, whisperModelEnabled: enabled },
    }).catch((err) =>
      console.error("[settings] set_feature_config failed", err),
    );
    if (enabled) {
      triggerWhisperDownload();
    } else if (voiceProvider === "whisper") {
      onVoiceProviderChange(nativeVoiceProvider());
    }
  }

  function setLaunchAtLoginEnabled(enabled: boolean) {
    if (!featureConfig) return;
    invoke("set_feature_config", {
      config: { ...featureConfig, launchAtLoginEnabled: enabled },
    }).catch((err) =>
      console.error("[settings] set_feature_config failed", err),
    );
  }

  function setAutoHidePopoverEnabled(enabled: boolean) {
    if (!featureConfig) return;
    invoke("set_feature_config", {
      config: { ...featureConfig, autoHidePopoverEnabled: enabled },
    }).catch((err) =>
      console.error("[settings] set_feature_config failed", err),
    );
  }

  function setShowInScreenCapture(enabled: boolean) {
    if (!featureConfig) return;
    invoke("set_feature_config", {
      config: { ...featureConfig, showInScreenCapture: enabled },
    }).catch((err) =>
      console.error("[settings] set_feature_config failed", err),
    );
  }

  async function setScreenMemoryConfig(
    patch: Partial<ScreenMemoryStatus["config"]>,
  ) {
    if (!featureConfig) return;
    setScreenMemoryMessage(null);
    const next = {
      ...DEFAULT_SCREEN_MEMORY_CONFIG,
      ...screenMemoryRef.current,
      ...patch,
    };
    const version = ++screenMemoryMutationVersionRef.current;
    screenMemoryMutationRef.current += 1;
    screenMemoryRef.current = next;
    setScreenMemory(next);
    setScreenMemoryConfigBusy(true);
    let operation!: Promise<void>;
    operation = screenMemoryMutationTailRef.current
      .catch(() => {})
      .then(async () => {
        // Read the latest complete config at execution time so a queued Rewind
        // edit cannot overwrite an unrelated setting changed while it waited.
        const current = await invoke<FeatureConfig>("get_feature_config");
        await invoke("set_feature_config", {
          config: { ...current, screenMemory: next },
        });
        const committed = await invoke<FeatureConfig>("get_feature_config");
        if (version === screenMemoryMutationVersionRef.current) {
          screenMemoryRef.current = committed.screenMemory;
          setScreenMemory(committed.screenMemory);
        }
      });
    screenMemoryMutationTailRef.current = operation;
    try {
      await operation;
    } catch (err) {
      console.error("[settings] set_feature_config failed", err);
      if (version === screenMemoryMutationVersionRef.current) {
        const committed = await invoke<FeatureConfig>(
          "get_feature_config",
        ).catch(() => null);
        if (committed) {
          screenMemoryRef.current = committed.screenMemory;
          setScreenMemory(committed.screenMemory);
        }
      }
      setScreenMemoryMessage({
        kind: "error",
        text: (err as Error)?.message ?? "Could not update Rewind.",
      });
    } finally {
      screenMemoryMutationRef.current = Math.max(
        0,
        screenMemoryMutationRef.current - 1,
      );
      if (screenMemoryMutationRef.current === 0) {
        setScreenMemoryConfigBusy(false);
      }
    }
  }

  async function installRewindAgentConnection(client: "codex" | "claude-code") {
    setAgentConnectionBusy(client);
    setAgentConnectionMessage(null);
    try {
      const status = await invoke<RewindAgentConnectionStatus>(
        "screen_memory_install_agent_connection",
        { client },
      );
      setAgentConnectionMessage({
        kind: "ok",
        text: `${client === "codex" ? "Codex" : "Claude Code"} is connected to this Rewind store. Restart the agent app once to load it.`,
      });
      console.info(
        `[clips-tray] configured ${status.client} Screen Memory MCP at ${status.configPath}`,
      );
    } catch (err) {
      setAgentConnectionMessage({
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setAgentConnectionBusy(null);
    }
  }

  function refreshScreenMemoryStatus() {
    invoke<ScreenMemoryStatus>("screen_memory_status")
      .then(setScreenMemoryStatus)
      .catch(() => {});
  }

  function refreshRewindEgressLog() {
    invoke<RewindEgressEvent[]>("rewind_list_evidence_egress", { limit: 20 })
      .then(setRewindEgressEvents)
      .catch((err) => {
        setScreenMemoryMessage({
          kind: "error",
          text:
            (err as Error)?.message ?? "Could not read the Rewind access log.",
        });
      });
  }

  async function askRewindLocally() {
    const query = rewindLocalQuery.trim();
    if (!query) return;
    setRewindLocalBusy(true);
    setRewindLocalError(null);
    try {
      const result = await invoke<RewindLocalAskResult>("rewind_local_ask", {
        query,
        limit: 12,
      });
      setRewindLocalResult(result);
    } catch (err) {
      setRewindLocalError(
        (err as Error)?.message ?? "Could not search local Rewind evidence.",
      );
    } finally {
      setRewindLocalBusy(false);
    }
  }

  async function replayRewindMoment(
    evidence: RewindLocalAskResult["evidence"][number],
  ) {
    setRewindReplayId(evidence.id);
    setRewindLocalError(null);
    try {
      await invoke("rewind_replay_moment", {
        segmentId: evidence.segmentId,
        offsetMs: evidence.offsetMs,
      });
    } catch (err) {
      setRewindLocalError(
        (err as Error)?.message ?? "Could not replay this local moment.",
      );
    } finally {
      setRewindReplayId(null);
    }
  }

  async function exportScreenMemoryRecent() {
    setScreenMemoryBusy(true);
    setScreenMemoryMessage(null);
    setScreenMemoryExportResult(null);
    try {
      const result = await invoke<ScreenMemoryExportResult>(
        "screen_memory_export_recent",
        { minutes: 5 },
      );
      setScreenMemoryExportResult(result);
    } catch (err) {
      setScreenMemoryMessage({
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setScreenMemoryBusy(false);
      refreshScreenMemoryStatus();
    }
  }

  async function clearScreenMemory() {
    setScreenMemoryBusy(true);
    setScreenMemoryMessage(null);
    try {
      const status = await invoke<ScreenMemoryStatus>(
        "screen_memory_delete_all",
      );
      setScreenMemoryStatus(status);
      setScreenMemoryMessage({ kind: "ok", text: "Rewind cleared." });
    } catch (err) {
      setScreenMemoryMessage({
        kind: "error",
        text: (err as Error)?.message ?? "Could not clear Rewind.",
      });
    } finally {
      setScreenMemoryBusy(false);
    }
  }

  function openScreenMemoryFolder() {
    invoke("screen_memory_open_folder").catch((err) => {
      setScreenMemoryMessage({
        kind: "error",
        text: (err as Error)?.message ?? "Could not open Rewind folder.",
      });
    });
  }

  async function chooseExcludedApplications() {
    setExcludedAppsBusy(true);
    setScreenMemoryMessage(null);
    try {
      const chosen = await invoke<RewindExcludedApplication[]>(
        "choose_rewind_excluded_apps",
      );
      if (chosen.length === 0) return;
      const bundleIds = [
        ...new Set([
          ...(screenMemory.excludedBundleIds ?? []),
          ...chosen.map((app) => app.bundleId),
        ]),
      ];
      await setScreenMemoryConfig({ excludedBundleIds: bundleIds });
    } catch (err) {
      setScreenMemoryMessage({
        kind: "error",
        text: (err as Error)?.message ?? "Could not choose applications.",
      });
    } finally {
      setExcludedAppsBusy(false);
    }
  }

  function removeExcludedApplications(bundleIds: string[]) {
    const removed = new Set(bundleIds);
    void setScreenMemoryConfig({
      excludedBundleIds: (screenMemory.excludedBundleIds ?? []).filter(
        (candidate) => !removed.has(candidate),
      ),
    });
  }

  function openClipDraftsFolder() {
    setClipDraftsError(null);
    invoke("native_fullscreen_open_drafts_folder").catch((err) => {
      setClipDraftsError(
        (err as Error)?.message ?? "Could not open Clip Drafts.",
      );
    });
  }

  function openRegionGuideEditor() {
    invoke("show_region_guide_editor").catch((err) =>
      console.error("[settings] show_region_guide_editor failed", err),
    );
  }

  function setRegionGuidesEnabled(enabled: boolean) {
    if (!featureConfig) return;
    if (enabled && regionGuideCount === 0) {
      openRegionGuideEditor();
      return;
    }
    invoke("set_feature_config", {
      config: {
        ...featureConfig,
        regionGuides: {
          ...regionGuides,
          enabled,
          rects: regionGuideRects,
          ...(enabled ? {} : { alwaysVisible: false }),
        },
      },
    }).catch((err) =>
      console.error("[settings] set_feature_config failed", err),
    );
  }

  function setRegionGuidesAlwaysVisible(enabled: boolean) {
    if (!featureConfig) return;
    if (enabled && regionGuideCount === 0) {
      openRegionGuideEditor();
      invoke("set_feature_config", {
        config: {
          ...featureConfig,
          regionGuides: {
            ...regionGuides,
            enabled: true,
            alwaysVisible: true,
            rects: regionGuideRects,
          },
        },
      }).catch((err) =>
        console.error("[settings] set_feature_config failed", err),
      );
      return;
    }
    invoke("set_feature_config", {
      config: {
        ...featureConfig,
        regionGuides: {
          ...regionGuides,
          alwaysVisible: enabled,
          enabled: regionGuides.enabled,
          rects: regionGuideRects,
        },
      },
    }).catch((err) =>
      console.error("[settings] set_feature_config failed", err),
    );
  }

  function clearRegionGuidePreset() {
    if (!featureConfig) return;
    invoke("set_feature_config", {
      config: {
        ...featureConfig,
        regionGuides: { enabled: false, rects: [], alwaysVisible: false },
      },
    }).catch((err) =>
      console.error("[settings] set_feature_config failed", err),
    );
  }

  function setLocalRecordingMode(mode: LocalRecordingMode) {
    if (!featureConfig) return;
    invoke("set_feature_config", {
      config: { ...featureConfig, localRecordingMode: mode },
    }).catch((err) =>
      console.error("[settings] set_feature_config failed", err),
    );
  }

  function setMeetingTranscriptionMode(mode: MeetingTranscriptionMode) {
    if (!featureConfig) return;
    invoke("set_feature_config", {
      config: { ...featureConfig, meetingTranscriptionMode: mode },
    }).catch((err) =>
      console.error("[settings] set_feature_config failed", err),
    );
  }

  function setShowMeetingWidgetEnabled(enabled: boolean) {
    if (!featureConfig) return;
    invoke("set_feature_config", {
      config: { ...featureConfig, showMeetingWidgetEnabled: enabled },
    }).catch((err) =>
      console.error("[settings] set_feature_config failed", err),
    );
  }

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      invoke<ScreenMemoryStatus>("screen_memory_status")
        .then((status) => {
          if (!cancelled) setScreenMemoryStatus(status);
        })
        .catch(() => {});
    };
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    const unlistens: Array<() => void> = [];
    const track = (p: Promise<() => void>) => {
      p.then((u) => {
        if (cancelled) {
          try {
            u();
          } catch {
            /* ignore */
          }
          return;
        }
        unlistens.push(u);
      }).catch(() => {});
    };
    track(listen("clips:screen-memory-changed", refresh));
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      unlistens.forEach((u) => {
        try {
          u();
        } catch {
          /* ignore */
        }
      });
    };
  }, []);

  // Load model status on mount and keep it current via events.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      invoke<WhisperModelStatus>("whisper_model_status")
        .then((s) => {
          if (!cancelled) setWhisperStatus(s);
        })
        .catch(() => {});
    };
    refresh();
    const unlistens: Array<() => void> = [];
    const track = (p: Promise<() => void>) => {
      p.then((u) => {
        if (cancelled) {
          try {
            u();
          } catch {
            /* ignore */
          }
          return;
        }
        unlistens.push(u);
      }).catch(() => {});
    };
    track(listen("whisper:model-progress", () => refresh()));
    track(listen("whisper:model-ready", () => refresh()));
    track(listen("whisper:model-error", () => refresh()));
    track(listen("whisper:model-enabled-changed", () => refresh()));
    return () => {
      cancelled = true;
      unlistens.forEach((u) => {
        try {
          u();
        } catch {
          /* ignore */
        }
      });
    };
  }, []);

  useEffect(() => {
    const base = (serverUrl ?? initial ?? DEFAULT_URL).replace(/\/+$/, "");
    let cancelled = false;
    setProviderStatusLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `${base}/_agent-native/voice-providers/status`,
          { credentials: "include" },
        );
        if (!res.ok) {
          if (!cancelled) {
            setProviderStatus(null);
            setProviderStatusLoading(false);
          }
          return;
        }
        // Server emits `native` (no namespace); the client uses
        // `"macos-native"` as the provider key throughout — remap on the
        // way in.
        const json = (await res.json().catch(() => null)) as
          | (Partial<Omit<VoiceProviderStatus, "browser" | "macos-native">> & {
              native?: boolean;
            })
          | null;
        if (cancelled) return;
        setProviderStatus({
          browser: true,
          "macos-native": Boolean(json?.native),
          builder: Boolean(json?.builder),
          gemini: Boolean(json?.gemini),
          groq: Boolean(json?.groq),
        });
        setProviderStatusLoading(false);
      } catch {
        if (!cancelled) {
          setProviderStatus(null);
          setProviderStatusLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverUrl, initial]);

  function handleConnect() {
    const trimmed = url.trim();
    if (!trimmed) return;
    onConnect(trimmed);
  }

  const selectedMode = voiceProviderMode(voiceProvider);
  const byokProvider: ByokVoiceProvider = isByokVoiceProvider(voiceProvider)
    ? voiceProvider
    : "gemini";
  const providerHint: Record<VoiceProviderMode, string> = {
    native: isMacPlatform()
      ? "Uses macOS on-device speech recognition for the fastest free dictation."
      : "Uses the browser's built-in speech recognition when available.",
    whisper: "Uses the local Whisper model for offline AI transcription.",
    builder:
      "Uses Builder.io for fast cleanup. No separate provider key needed.",
    byok: "Use your own provider key for cleanup.",
  };
  const shortcutHint: Record<VoiceShortcutPreference, string> = {
    fn: "Press the Fn / globe key to dictate. macOS requires Input Monitoring for this one shortcut.",
    "cmd-shift-space":
      "Press Cmd+Shift+Space to dictate. This does not need Input Monitoring.",
    "ctrl-shift-space": "Press Ctrl+Shift+Space to dictate.",
    custom: `Press ${voiceCustomShortcut || "your recorded shortcut"} to dictate.`,
    both: "Any of Fn, Cmd+Shift+Space, or Ctrl+Shift+Space. Includes Fn, so macOS may ask for Input Monitoring.",
  };
  const fnShortcutSelected = voiceShortcut === "fn" || voiceShortcut === "both";
  const modeHint: Record<VoiceMode, string> = {
    "push-to-talk": "Hold the shortcut while speaking. Release to stop.",
    toggle: "Press once to start, again to stop.",
  };

  function selectProviderMode(mode: VoiceProviderMode) {
    setApiKeyMessage(null);
    if (mode === "native") {
      onVoiceProviderChange(nativeVoiceProvider());
    } else if (mode === "whisper") {
      onVoiceProviderChange("whisper");
      if (!whisperModelEnabled) setWhisperModelEnabled(true);
    } else if (mode === "builder") {
      onVoiceProviderChange("builder-gemini");
    } else {
      onVoiceProviderChange(byokProvider);
    }
  }

  async function saveApiKey() {
    const value = apiKeyValue.trim();
    if (!value || apiKeySaving) return;
    const key = keyForByokProvider(byokProvider);
    const base = (serverUrl ?? initial ?? DEFAULT_URL).replace(/\/+$/, "");
    setApiKeySaving(true);
    setApiKeyMessage(null);
    try {
      let res = await fetch(
        `${base}/_agent-native/secrets/${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value }),
          credentials: "include",
        },
      );

      // Some apps may not register every BYOK provider. Fall back to the
      // ad-hoc secret store so the tray can still wire user-scoped keys.
      if (res.status === 404) {
        res = await fetch(`${base}/_agent-native/secrets/adhoc`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: key,
            value,
            scope: "user",
            description: `${labelForByokProvider(byokProvider)} key for Clips voice transcription`,
          }),
          credentials: "include",
        });
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error || `Save failed (${res.status})`);
      }

      setProviderStatus((prev) =>
        prev
          ? { ...prev, [byokProvider]: true }
          : {
              browser: true,
              "macos-native": true,
              builder: false,
              gemini: byokProvider === "gemini",
              groq: byokProvider === "groq",
            },
      );
      setApiKeyValue("");
      setApiKeyMessage({
        kind: "ok",
        text: `${labelForByokProvider(byokProvider)} key saved.`,
      });
    } catch (err) {
      setApiKeyMessage({
        kind: "error",
        text: (err as Error)?.message ?? "Could not save key.",
      });
    } finally {
      setApiKeySaving(false);
    }
  }

  function connectBuilder() {
    const base = (serverUrl ?? initial ?? DEFAULT_URL).replace(/\/+$/, "");
    openExternal(`${base}/_agent-native/builder/connect`).catch((err) => {
      setApiKeyMessage({
        kind: "error",
        text: (err as Error)?.message ?? "Could not open Builder.io connect.",
      });
    });
  }

  // Only warn when the selected provider has no key/connection on the server.
  const providerWarning: string | null = (() => {
    if (providerStatusLoading || !providerStatus) return null;
    if (selectedMode === "native") return null;
    if (selectedMode === "whisper") return null;
    if (selectedMode === "builder") {
      return providerStatus.builder
        ? null
        : "Builder.io is not connected — cleanup will fail until connected.";
    }
    if (providerStatus[byokProvider]) return null;
    return `${keyForByokProvider(byokProvider)} is not set — cleanup will fail until configured.`;
  })();
  const updateChecksSupported = canCheckForUpdates();
  const updateBusy =
    updateStatus.state === "checking" ||
    updateStatus.state === "available" ||
    updateStatus.state === "downloading";
  const updateReady = updateStatus.state === "downloaded";
  const updateStatusClass =
    updateStatus.state === "error"
      ? "setup-warning"
      : updateStatus.state === "downloaded" ||
          updateStatus.state === "not-available"
        ? "setup-success"
        : "setup-hint";
  const updateCheckLabel = !updateChecksSupported
    ? "Release builds only"
    : updateStatus.state === "checking"
      ? "Checking..."
      : updateStatus.state === "downloading"
        ? `Downloading ${updateStatus.percent}%`
        : "Check now";

  function checkForDesktopUpdate() {
    retryUpdateCheck().catch((err) => {
      console.error("[clips-updater] manual check failed:", err);
    });
  }

  if (surface !== "settings" && rewindConsentOpen) {
    return (
      <div className="setup rewind-consent">
        <div className="rewind-consent-mark">
          <IconHistory size={24} stroke={1.8} />
        </div>
        <p className="rewind-kicker">Rewind</p>
        <h2>Turn on Rewind?</h2>
        <p className="rewind-consent-copy">
          Rewind remembers recent moments so you can ask an agent about them or
          add earlier context to a Clip.
        </p>
        <div className="rewind-consent-choices">
          <button
            type="button"
            className={rewindConsentMode === "visuals" ? "selected" : ""}
            onClick={() => setRewindConsentMode("visuals")}
          >
            <strong>Visuals</strong>
            <span>Screen, app, and readable text</span>
          </button>
          <button
            type="button"
            className={rewindConsentMode === "visuals-audio" ? "selected" : ""}
            onClick={() => setRewindConsentMode("visuals-audio")}
          >
            <strong>Visuals + audio</strong>
            <span>Also remember your microphone and sound from the Mac</span>
          </button>
        </div>
        <div className="rewind-local-promise">
          <IconShieldLock size={17} stroke={1.8} />
          <p>
            <strong>Raw Rewind recordings stay on this Mac.</strong> When you
            ask an agent to search, Clips returns bounded matching context. A
            media range uploads only through a private Clip handoff.
          </p>
        </div>
        <button
          type="button"
          className="primary rewind-consent-primary"
          disabled={screenMemoryConfigBusy}
          onClick={async () => {
            await setScreenMemoryConfig({
              enabled: true,
              paused: false,
              captureMode: rewindConsentMode,
              retentionHours: 8,
              maxBytes: 20 * 1024 * 1024 * 1024,
              reviewBeforeSending: true,
              agentClipRetention: "forever",
            });
            setRewindConsentOpen(false);
          }}
        >
          {screenMemoryConfigBusy ? "Turning on…" : "Turn on Rewind"}
        </button>
        <button
          type="button"
          className="rewind-quiet-button"
          onClick={() => {
            setRewindConsentOpen(false);
            onCancel?.();
          }}
        >
          Not now
        </button>
      </div>
    );
  }

  if (surface === "memory") {
    return (
      <div className="setup popover-view rewind-memory-surface">
        <div className="setup-header">
          <button
            type="button"
            className="setup-back"
            onClick={onCancel}
            aria-label="Back"
          >
            <IconArrowLeft size={18} stroke={1.75} />
          </button>
          <h2>Manual search</h2>
        </div>
        {screenMemory.enabled ? (
          <>
            <p className="rewind-surface-lede">
              This local fallback helps you verify what Rewind remembers. For
              everyday retrieval, ask Codex or your connected agent instead.
            </p>
            <form
              className="rewind-search-row"
              onSubmit={(event) => {
                event.preventDefault();
                void askRewindLocally();
              }}
            >
              <IconSearch size={17} stroke={1.8} />
              <input
                autoFocus
                value={rewindLocalQuery}
                onChange={(event) => setRewindLocalQuery(event.target.value)}
                placeholder="Search words you saw or heard…"
                aria-label="Search memory"
                maxLength={500}
              />
              <button
                type="submit"
                disabled={rewindLocalBusy || !rewindLocalQuery.trim()}
              >
                {rewindLocalBusy ? "Searching…" : "Search"}
              </button>
            </form>
            {rewindLocalError ? (
              <p className="setup-warning">{rewindLocalError}</p>
            ) : null}
            {rewindLocalResult ? (
              <div className="rewind-search-results" aria-live="polite">
                <div className="rewind-result-summary">
                  <strong>
                    {rewindLocalResult.evidence.length} moment
                    {rewindLocalResult.evidence.length === 1 ? "" : "s"} found
                  </strong>
                  <span>
                    {rewindLocalResult.coverage.segmentsConsidered} local
                    segments searched
                  </span>
                </div>
                {rewindLocalResult.evidence.length === 0 ? (
                  <div className="popover-empty-card">
                    <strong>No matching moments</strong>
                    <p>
                      Try an app name, a phrase you heard, or text that appeared
                      on screen.
                    </p>
                  </div>
                ) : (
                  rewindLocalResult.evidence.map((evidence) => (
                    <article className="rewind-evidence-card" key={evidence.id}>
                      <div className="rewind-evidence-meta">
                        {new Date(evidence.capturedAt).toLocaleString()} ·{" "}
                        {evidence.sourceType === "ocr"
                          ? "On-screen text"
                          : evidence.sourceType === "transcript"
                            ? "Audio"
                            : "App context"}
                      </div>
                      <p>{evidence.excerpt}</p>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void replayRewindMoment(evidence)}
                        disabled={rewindReplayId === evidence.id}
                      >
                        <IconPlayerPlay size={14} stroke={1.9} />
                        {rewindReplayId === evidence.id
                          ? "Preparing replay…"
                          : "Replay this moment"}
                      </button>
                    </article>
                  ))
                )}
                <details className="setup-advanced rewind-coverage-details">
                  <summary className="setup-advanced-summary">
                    Coverage and gaps
                  </summary>
                  <div className="setup-advanced-body">
                    <p className="setup-hint">
                      {rewindLocalResult.coverage.transcriptIndexesReady} audio
                      and {rewindLocalResult.coverage.ocrIndexesReady} visual
                      indexes were ready. Confidence:{" "}
                      {rewindLocalResult.confidence}.
                    </p>
                    {rewindLocalResult.coverage.gaps.length === 0 ? (
                      <p className="setup-hint">
                        No known capture or index gaps.
                      </p>
                    ) : (
                      rewindLocalResult.coverage.gaps.map((gap, index) => (
                        <p
                          className="setup-hint"
                          key={`${gap.kind}-${gap.source}-${gap.startedAt ?? index}`}
                        >
                          <strong>{gap.source}</strong> · {gap.detail}
                        </p>
                      ))
                    )}
                  </div>
                </details>
              </div>
            ) : (
              <div className="popover-empty-card rewind-memory-empty">
                <IconSearch size={19} stroke={1.7} />
                <strong>Find the source moment</strong>
                <p>
                  Results stay grounded in retained local evidence and always
                  lead back to Replay.
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="popover-empty-card rewind-memory-empty">
            <IconHistory size={20} stroke={1.7} />
            <strong>Rewind is off</strong>
            <p>
              Turn on a private rolling memory before there is anything to
              search.
            </p>
            <button
              type="button"
              className="secondary"
              onClick={() => setRewindConsentOpen(true)}
            >
              Turn on Rewind
            </button>
          </div>
        )}
      </div>
    );
  }

  if (surface === "rewind") {
    return (
      <div className="setup popover-view rewind-settings-surface">
        <div className="setup-header">
          <button
            type="button"
            className="setup-back"
            onClick={onCancel}
            aria-label="Back"
          >
            <IconArrowLeft size={18} stroke={1.75} />
          </button>
          <h2>Rewind settings</h2>
        </div>
        <div className="rewind-setting-row">
          <SettingLabel
            label="Rewind"
            hint={
              !screenMemory.enabled
                ? "Off"
                : screenMemory.paused
                  ? "Paused · existing local memory is still available"
                  : "Remembering locally"
            }
          />
          <Switch
            on={screenMemory.enabled}
            disabled={screenMemoryConfigBusy || captureControlsLocked}
            onChange={(enabled) => {
              if (enabled) setRewindConsentOpen(true);
              else
                void setScreenMemoryConfig({ enabled: false, paused: false });
            }}
            label="Enable Rewind"
          />
        </div>
        {captureControlsLocked ? (
          <p className="rewind-capture-lock-note" role="status">
            Rewind capture settings unlock when this Clip ends. This keeps one
            screen and audio recorder running at a time.
          </p>
        ) : null}
        {screenMemory.enabled ? (
          <>
            <div className="rewind-setting-row">
              <SettingLabel
                label="Remember"
                hint="Choose whether audio joins the local screen memory."
                htmlFor="rewind-capture-mode"
              />
              <select
                id="rewind-capture-mode"
                className="setup-select rewind-setting-control"
                disabled={screenMemoryConfigBusy || captureControlsLocked}
                value={screenMemory.captureMode}
                onChange={(event) =>
                  void setScreenMemoryConfig({
                    captureMode: event.target.value as
                      | "visuals"
                      | "visuals-audio",
                  })
                }
              >
                <option value="visuals">Visuals</option>
                <option value="visuals-audio">Visuals + audio</option>
              </select>
            </div>
            <div className="rewind-setting-row">
              <SettingLabel
                label="Remember the last…"
                hint={`${formatStorageBytes(screenMemory.maxBytes)} maximum on disk`}
                htmlFor="rewind-retention"
              />
              <select
                id="rewind-retention"
                className="setup-select rewind-setting-control"
                disabled={screenMemoryConfigBusy}
                value={screenMemory.retentionHours}
                onChange={(event) =>
                  void setScreenMemoryConfig({
                    retentionHours: Number(event.target.value),
                  })
                }
              >
                <option value={8}>8 hours</option>
                <option value={24}>24 hours</option>
              </select>
            </div>
            <div className="rewind-setting-row">
              <SettingLabel
                label="Keep up to"
                hint="Older moments are removed automatically when this limit is reached."
                htmlFor="rewind-disk-cap"
              />
              <select
                id="rewind-disk-cap"
                className="setup-select rewind-setting-control"
                disabled={screenMemoryConfigBusy}
                value={screenMemory.maxBytes}
                onChange={(event) =>
                  void setScreenMemoryConfig({
                    maxBytes: Number(event.target.value),
                  })
                }
              >
                <option value={5 * 1024 * 1024 * 1024}>5 GB</option>
                <option value={20 * 1024 * 1024 * 1024}>20 GB</option>
                <option value={50 * 1024 * 1024 * 1024}>50 GB</option>
              </select>
            </div>
            <div className="rewind-settings-status">
              <span
                className={`rewind-home-dot ${rewindStatusPresentation.isLive ? "is-live" : ""}`}
              />
              <span>
                {rewindStatusPresentation.kind === "recording" &&
                !rewindStatusPresentation.hasError
                  ? `${screenMemorySegments.length} retained segment${screenMemorySegments.length === 1 ? "" : "s"} · ${formatStorageBytes(screenMemoryTotalBytes)}`
                  : rewindStatusPresentation.detail}
              </span>
            </div>
            <div className="setup-section-heading">Privacy</div>
            <div className="rewind-excluded-apps">
              <div className="rewind-excluded-apps-header">
                <SettingLabel
                  label="Excluded apps"
                  hint="Rewind never remembers these applications."
                />
                <button
                  type="button"
                  className="secondary rewind-choose-apps"
                  disabled={excludedAppsBusy || screenMemoryConfigBusy}
                  onClick={() => void chooseExcludedApplications()}
                >
                  <IconFolderOpen size={14} stroke={1.9} />
                  {excludedAppsBusy ? "Choosing…" : "Choose applications…"}
                </button>
              </div>
              {excludedAppGroups.length > 0 ? (
                <div className="rewind-excluded-app-list">
                  {excludedAppGroups.map((app) => (
                    <div
                      className={`rewind-excluded-app ${app.installed ? "" : "is-missing"}`}
                      key={app.bundleId}
                    >
                      <div
                        className="rewind-excluded-app-mark"
                        aria-hidden="true"
                      >
                        {app.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="rewind-excluded-app-copy">
                        <strong>{app.name}</strong>
                        <span>
                          {app.installed
                            ? "Excluded"
                            : "Not currently installed · still excluded"}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="rewind-excluded-app-remove"
                        aria-label={`Remove ${app.name}`}
                        disabled={screenMemoryConfigBusy}
                        onClick={() =>
                          removeExcludedApplications(app.bundleIds)
                        }
                      >
                        <IconX size={14} stroke={2} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="setup-hint">No additional apps are excluded.</p>
              )}
            </div>
            <div className="setup-section-heading">Agent handoff</div>
            <div className="rewind-agent-guide">
              <div className="rewind-agent-guide-icon">
                <IconHistory size={17} stroke={1.8} />
              </div>
              <div>
                <strong>Set up your agent once</strong>
                <p>
                  Copy the setup prompt into any compatible agent. It installs
                  Rewind's reusable instructions and repairs the local
                  connection, so later you can simply say “Look at Rewind.”
                </p>
              </div>
            </div>
            <details className="setup-advanced rewind-agent-repair">
              <summary className="setup-advanced-summary">
                Repair an agent connection
              </summary>
              <div className="setup-advanced-body">
                <p className="setup-hint">
                  Usually your agent can install Rewind from the copied prompt.
                  These buttons are a manual repair for known clients.
                </p>
                <div className="rewind-memory-actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={agentConnectionBusy !== null}
                    onClick={() => void installRewindAgentConnection("codex")}
                  >
                    {agentConnectionBusy === "codex"
                      ? "Repairing…"
                      : "Repair Codex connection"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={agentConnectionBusy !== null}
                    onClick={() =>
                      void installRewindAgentConnection("claude-code")
                    }
                  >
                    {agentConnectionBusy === "claude-code"
                      ? "Repairing…"
                      : "Repair Claude Code connection"}
                  </button>
                </div>
                {agentConnectionMessage ? (
                  <p
                    className={
                      agentConnectionMessage.kind === "error"
                        ? "setup-error"
                        : "setup-hint"
                    }
                    role="status"
                  >
                    {agentConnectionMessage.text}
                  </p>
                ) : null}
              </div>
            </details>
            <div className="rewind-setting-row rewind-agent-row">
              <SettingLabel
                label="Review before sending"
                hint="Preview and trim any visual or audio range before it becomes a private Clip."
              />
              <Switch
                on={screenMemory.reviewBeforeSending}
                disabled={screenMemoryConfigBusy}
                onChange={(enabled) =>
                  void setScreenMemoryConfig({
                    reviewBeforeSending: enabled,
                  })
                }
                label="Review visual and audio ranges before sending"
              />
            </div>
            <div className="rewind-setting-row rewind-agent-row">
              <SettingLabel
                label="Open local preview automatically"
                hint="When review is on, prepare the selected range in QuickTime when an agent asks for it."
              />
              <Switch
                on={screenMemory.autoPreviewBeforeSending}
                disabled={
                  screenMemoryConfigBusy || !screenMemory.reviewBeforeSending
                }
                onChange={(enabled) =>
                  void setScreenMemoryConfig({
                    autoPreviewBeforeSending: enabled,
                  })
                }
                label="Open a local preview automatically before sending"
              />
            </div>
            <p className="rewind-boundary-note">
              Asking your agent authorizes bounded matching text. Raw Rewind
              files stay local. If this review is off, an agent-requested media
              range becomes a private Clip immediately and leaves a receipt.
            </p>
            <div className="rewind-setting-row">
              <SettingLabel
                label="Agent-created Clip retention"
                hint="Applies to future private Clips created for an agent."
                htmlFor="rewind-agent-clip-retention"
              />
              <select
                id="rewind-agent-clip-retention"
                className="setup-select rewind-setting-control"
                disabled={screenMemoryConfigBusy}
                value={screenMemory.agentClipRetention}
                onChange={(event) =>
                  void setScreenMemoryConfig({
                    agentClipRetention: event.target.value as
                      | "forever"
                      | "24-hours"
                      | "7-days"
                      | "30-days",
                  })
                }
              >
                <option value="forever">Keep forever</option>
                <option value="24-hours">Delete after 24 hours</option>
                <option value="7-days">Delete after 7 days</option>
                <option value="30-days">Delete after 30 days</option>
              </select>
            </div>
            <div className="rewind-agent-guide">
              <div className="rewind-agent-guide-icon">
                <IconHistory size={17} stroke={1.8} />
              </div>
              <div>
                <strong>Ask your agent</strong>
                <p>
                  Try “What was the Terminal error?” or “Replay Tuesday’s design
                  review.”
                </p>
                <button
                  type="button"
                  className="rewind-text-button"
                  onClick={onOpenMemory}
                >
                  Search manually
                </button>
              </div>
            </div>
            <details
              className="setup-advanced"
              open={rewindEgressOpen}
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setRewindEgressOpen(open);
                if (open) refreshRewindEgressLog();
              }}
            >
              <summary className="setup-advanced-summary">
                Agent activity
              </summary>
              <div className="setup-advanced-body">
                <p className="setup-hint">
                  See when an agent searched bounded local evidence. Raw Rewind
                  media remains on this Mac unless you explicitly create a
                  private Clip.
                </p>
                {rewindEgressEvents.length === 0 ? (
                  <p className="setup-hint">No matching-text requests yet.</p>
                ) : (
                  rewindEgressEvents.slice(0, 10).map((event) => (
                    <p
                      className="setup-hint"
                      key={`${event.requestId}-${event.state}`}
                    >
                      <strong>
                        {new Date(event.occurredAt).toLocaleString()}
                      </strong>
                      {` · ${event.state} · ${event.evidenceCount} item${event.evidenceCount === 1 ? "" : "s"}`}
                    </p>
                  ))
                )}
              </div>
            </details>
            <details className="setup-advanced">
              <summary className="setup-advanced-summary">
                Manage local memory
              </summary>
              <div className="setup-advanced-body">
                <div className="rewind-memory-actions">
                  <div className="rewind-memory-action">
                    <div className="rewind-memory-action-copy">
                      <strong>Save a local Clip</strong>
                      <p>
                        Export the previous five minutes as a video on this Mac.
                        Nothing is uploaded.
                      </p>
                      {screenMemoryExportResult ? (
                        <div className="rewind-inline-receipt" role="status">
                          <span>Saved locally</span>
                          <button
                            type="button"
                            className="rewind-text-button"
                            onClick={() =>
                              void invoke("open_local_recording_folder", {
                                path: screenMemoryExportResult.folderPath,
                              })
                            }
                          >
                            Show in Finder
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="secondary"
                      disabled={
                        screenMemoryBusy || screenMemorySegments.length === 0
                      }
                      onClick={exportScreenMemoryRecent}
                    >
                      <IconDownload size={15} stroke={1.9} /> Save previous 5
                      minutes
                    </button>
                  </div>
                  <div className="rewind-memory-action">
                    <div>
                      <strong>View Rewind files</strong>
                      <p>
                        Open the private folder where Rewind keeps its temporary
                        local memory.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="secondary"
                      onClick={openScreenMemoryFolder}
                    >
                      <IconFolderOpen size={15} stroke={1.9} /> Open Rewind
                      folder
                    </button>
                  </div>
                  <div className="rewind-memory-action is-danger">
                    <div>
                      <strong>Erase Rewind memory</strong>
                      <p>
                        Permanently delete all retained media and indexes from
                        this Mac.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="secondary rewind-danger-button"
                      disabled={
                        screenMemoryBusy || screenMemorySegments.length === 0
                      }
                      onClick={clearScreenMemory}
                    >
                      <IconTrash size={15} stroke={1.9} /> Erase all memory…
                    </button>
                  </div>
                </div>
              </div>
            </details>
            {screenMemoryMessage ? (
              <p
                className={
                  screenMemoryMessage.kind === "ok"
                    ? "setup-success"
                    : "setup-warning"
                }
              >
                {screenMemoryMessage.text}
              </p>
            ) : null}
          </>
        ) : (
          <div className="popover-empty-card rewind-memory-empty">
            <IconHistory size={20} stroke={1.7} />
            <strong>Nothing is being remembered</strong>
            <p>
              Turning Rewind on begins a private rolling memory after you choose
              what it may remember.
            </p>
            <button
              type="button"
              className="secondary"
              onClick={() => setRewindConsentOpen(true)}
            >
              Choose what to remember
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="setup">
      <div className="setup-header">
        {onCancel ? (
          <button
            type="button"
            className="setup-back"
            onClick={onCancel}
            aria-label="Back"
          >
            <IconArrowLeft size={18} stroke={1.75} />
          </button>
        ) : null}
        <h2>Settings</h2>
      </div>

      <div className="setup-section-heading">General</div>

      <div className="setup-section">
        <SettingLabel
          label="Clips server URL"
          hint="The URL of the Clips backend this tray app connects to."
          htmlFor="clips-url"
        />
        <input
          id="clips-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://localhost:8080"
        />
        <button
          className="secondary setup-connect-button"
          type="button"
          onClick={handleConnect}
        >
          Connect
        </button>
      </div>

      <div className="setup-section">
        <div className="setup-toggle-row">
          <SettingLabel
            label="Open at login"
            hint="Start Clips automatically when you sign in so recording, meetings, and dictation shortcuts are ready."
          />
          <Switch
            on={launchAtLoginEnabled}
            onChange={setLaunchAtLoginEnabled}
            label="Open Clips at login"
          />
        </div>
      </div>

      <div className="setup-section">
        <div className="setup-toggle-row">
          <SettingLabel
            label="Hide when inactive"
            hint="When off, the Clips window stays open until you close it."
          />
          <Switch
            on={autoHidePopoverEnabled}
            onChange={setAutoHidePopoverEnabled}
            label="Hide Clips when focus leaves"
          />
        </div>
      </div>

      <div className="setup-section">
        <div className="setup-toggle-row">
          <SettingLabel
            label="Show Clips in screen captures"
            hint="When off, Clips windows and recording overlays stay out of screenshots, normal screen recordings, and Rewind. Turn on only for debugging or demos."
          />
          <Switch
            on={showInScreenCapture}
            onChange={setShowInScreenCapture}
            label="Show Clips in screen captures"
          />
        </div>
      </div>

      <div className="setup-section">
        <SettingLabel
          label="Desktop updates"
          hint="Check the signed Clips desktop release channel and download any available update."
        />
        <div className="setup-button-row">
          <button
            type="button"
            className="secondary"
            onClick={checkForDesktopUpdate}
            disabled={!updateChecksSupported || updateBusy || updateReady}
          >
            <IconRefresh
              size={15}
              stroke={1.9}
              className={updateBusy ? "update-spinner" : undefined}
            />
            {updateCheckLabel}
          </button>
          {updateReady ? (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                installAndRestart().catch((err) => {
                  console.error("[clips-updater] relaunch failed:", err);
                });
              }}
            >
              Restart to install
            </button>
          ) : null}
        </div>
        <p className={updateStatusClass}>
          {updateChecksSupported
            ? desktopUpdateStatusText(updateStatus)
            : "Update checks are available in signed release builds."}
        </p>
      </div>

      <div className="setup-section-heading">Permissions</div>

      <div className="setup-section">
        <ReadinessPanel
          mode="screen-camera"
          cameraOn={true}
          micOn={true}
          includeVoicePaste={voiceEnabled}
          includeFnMonitoring={fnShortcutSelected}
          open={readinessOpen}
          onOpenChange={setReadinessOpen}
          onOpenPermission={openPrivacySettings}
        />
      </div>

      <div className="setup-section-heading">Recording</div>

      <div className="setup-section rewind-settings-entry">
        <div className="rewind-settings-entry-main">
          <span
            className={`rewind-home-dot ${rewindStatusPresentation.isLive ? "is-live" : ""}`}
          />
          <div>
            <strong>Rewind</strong>
            <p className="setup-hint">{rewindStatusPresentation.title}</p>
          </div>
        </div>
        <button type="button" className="secondary" onClick={onOpenRewind}>
          Rewind settings
        </button>
      </div>

      <div className="setup-section">
        <SettingLabel
          label="Clip Drafts"
          hint="Only clips you dismiss from the saved-upload card appear in Movies/Clips/Drafts. To retry a failed upload, return to the Clips popover and use Retry."
        />
        <button
          type="button"
          className="secondary"
          onClick={openClipDraftsFolder}
        >
          <IconFolderOpen size={15} stroke={1.9} />
          Open Clip Drafts
        </button>
        {clipDraftsError ? (
          <p className="setup-warning">{clipDraftsError}</p>
        ) : null}
      </div>

      <div className="setup-section setup-rewind-legacy">
        <div className="setup-toggle-row">
          <SettingLabel
            label="Rewind"
            hint="A disabled-by-default rolling local archive for recent screen and app context. It never becomes a shared Clip on its own."
          />
          <Switch
            on={screenMemory.enabled}
            onChange={(enabled) =>
              void setScreenMemoryConfig({ enabled, paused: false })
            }
            label="Enable Rewind"
            disabled={screenMemoryConfigBusy || captureControlsLocked}
          />
        </div>
        <p className="setup-hint">
          Local-only by default. Media uploads and sharing happen only when you
          make a normal Clip.
        </p>
        {screenMemory.enabled ? (
          <>
            <div className="setup-toggle-row">
              <SettingLabel
                label="Pause capture"
                hint="Stop retaining new Rewind segments without clearing the local archive."
              />
              <Switch
                on={screenMemory.paused}
                onChange={(paused) => void setScreenMemoryConfig({ paused })}
                label="Pause Rewind"
                disabled={screenMemoryConfigBusy || captureControlsLocked}
              />
            </div>
            <div className="setup-grid">
              <label className="setup-mini-field">
                <span>Retention</span>
                <select
                  className="setup-select"
                  disabled={screenMemoryConfigBusy || captureControlsLocked}
                  value={screenMemory.retentionHours}
                  onChange={(event) =>
                    setScreenMemoryConfig({
                      retentionHours: Number(event.target.value),
                    })
                  }
                >
                  <option value={8}>8 hours</option>
                  <option value={24}>24 hours</option>
                </select>
              </label>
              <label className="setup-mini-field">
                <span>Disk cap</span>
                <select
                  className="setup-select"
                  disabled={screenMemoryConfigBusy}
                  value={screenMemory.maxBytes}
                  onChange={(event) =>
                    setScreenMemoryConfig({
                      maxBytes: Number(event.target.value),
                    })
                  }
                >
                  <option value={5 * 1024 * 1024 * 1024}>5 GB</option>
                  <option value={20 * 1024 * 1024 * 1024}>20 GB</option>
                  <option value={50 * 1024 * 1024 * 1024}>50 GB</option>
                </select>
              </label>
            </div>
            <div className="setup-grid">
              <label className="setup-mini-field">
                <span>Capture mode</span>
                <select
                  className="setup-select"
                  disabled={screenMemoryConfigBusy}
                  value={screenMemory.captureMode}
                  onChange={(event) =>
                    setScreenMemoryConfig({
                      captureMode: event.target.value as
                        | "visuals"
                        | "visuals-audio",
                    })
                  }
                >
                  <option value="visuals">Visuals</option>
                  <option value="visuals-audio">Visuals + audio</option>
                </select>
              </label>
              <label className="setup-mini-field">
                <span>Agent handoff review</span>
                <select
                  className="setup-select"
                  disabled={screenMemoryConfigBusy}
                  value={screenMemory.reviewBeforeSending ? "review" : "direct"}
                  onChange={(event) =>
                    setScreenMemoryConfig({
                      reviewBeforeSending: event.target.value === "review",
                    })
                  }
                >
                  <option value="review">Review before sending</option>
                  <option value="direct">Send requested range directly</option>
                </select>
              </label>
            </div>
            <p className="setup-hint">
              {screenMemory.captureMode === "visuals-audio"
                ? "Visuals + audio is configured to retain microphone and system audio as separate local tracks."
                : "Visuals retains screen and app context without selecting audio capture."}
            </p>
            <p className="setup-hint">
              Agents receive bounded matching text when you ask. Raw Rewind
              media remains local unless a bounded range becomes a private Clip.
            </p>
            <label className="setup-mini-field">
              <span>Excluded apps</span>
              <input
                value={excludedBundleIdsInput}
                onChange={(event) =>
                  setExcludedBundleIdsInput(event.target.value)
                }
                onBlur={() =>
                  setScreenMemoryConfig({
                    excludedBundleIds: parseExcludedBundleIds(
                      excludedBundleIdsInput,
                    ),
                  })
                }
                placeholder="com.example.private-app, com.example.vault"
                aria-describedby="rewind-excluded-apps-hint"
              />
            </label>
            <button
              type="button"
              className="secondary"
              disabled={screenMemoryConfigBusy}
              onClick={() =>
                void setScreenMemoryConfig({
                  excludedBundleIds: parseExcludedBundleIds(
                    excludedBundleIdsInput,
                  ),
                })
              }
            >
              Apply exclusions
            </button>
            <p id="rewind-excluded-apps-hint" className="setup-hint">
              Bundle IDs, comma-separated. Password managers are excluded by
              default. Recognized bundle IDs stop media capture and discard the
              entire in-flight segment; apps that do not expose a recognized
              bundle ID cannot be detected.
            </p>
            <div className="whisper-status">
              {rewindStatusPresentation.isLive ? (
                <IconCircleCheck size={13} className="whisper-status-icon" />
              ) : (
                <IconAlertTriangle size={13} className="whisper-status-icon" />
              )}
              <span>
                {rewindStatusPresentation.kind === "recording" &&
                !rewindStatusPresentation.hasError
                  ? `Rewind is retaining local coverage: ${screenMemorySegments.length} segment${screenMemorySegments.length === 1 ? "" : "s"}, ${formatStorageBytes(screenMemoryTotalBytes)}.`
                  : rewindStatusPresentation.detail}
              </span>
            </div>
            {screenMemorySegments[0] ? (
              <p className="setup-hint">
                Latest local coverage:{" "}
                {new Date(screenMemorySegments[0].endedAt).toLocaleTimeString()}
                .
              </p>
            ) : null}
            <div className="setup-advanced-body">
              <SettingLabel
                label="Ask Rewind"
                hint="Searches app context, local transcripts, and local visual text on this Mac. Private mode allows this because no model or network service is called."
              />
              <div className="setup-button-row">
                <input
                  value={rewindLocalQuery}
                  onChange={(event) => setRewindLocalQuery(event.target.value)}
                  placeholder="What was Lilian saying about the audience?"
                  aria-label="Ask Rewind locally"
                  maxLength={500}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    event.stopPropagation();
                    void askRewindLocally();
                  }}
                />
                <button
                  type="button"
                  className="secondary"
                  disabled={rewindLocalBusy || !rewindLocalQuery.trim()}
                  onClick={() => void askRewindLocally()}
                >
                  {rewindLocalBusy ? "Searching…" : "Search locally"}
                </button>
              </div>
              {rewindLocalError ? (
                <p className="setup-warning">{rewindLocalError}</p>
              ) : null}
              {rewindLocalResult ? (
                <div aria-live="polite">
                  <p className="setup-hint">
                    <strong>Local answer:</strong>{" "}
                    {rewindLocalResult.answerSummary}
                  </p>
                  <p className="setup-hint">
                    <strong>Confidence:</strong> {rewindLocalResult.confidence}
                  </p>
                  <p className="setup-hint">
                    <strong>Coverage:</strong>{" "}
                    {rewindLocalResult.coverage.segmentsConsidered} retained
                    segment
                    {rewindLocalResult.coverage.segmentsConsidered === 1
                      ? ""
                      : "s"}
                    ; {rewindLocalResult.coverage.transcriptIndexesReady}{" "}
                    transcript and {rewindLocalResult.coverage.ocrIndexesReady}{" "}
                    visual indexes ready.
                    {rewindLocalResult.coverage.gaps.length > 0
                      ? ` ${rewindLocalResult.coverage.gaps.length} capture or index gap${rewindLocalResult.coverage.gaps.length === 1 ? "" : "s"} may hide matches.`
                      : " No known capture or index gaps."}
                  </p>
                  {rewindLocalResult.coverage.gaps.length > 0 ? (
                    <details className="setup-advanced">
                      <summary className="setup-advanced-summary">
                        Coverage gaps
                      </summary>
                      <div className="setup-advanced-body">
                        {rewindLocalResult.coverage.gaps
                          .slice(0, 10)
                          .map((gap, index) => (
                            <p
                              className="setup-hint"
                              key={`${gap.kind}-${gap.source}-${gap.startedAt ?? index}`}
                            >
                              <strong>{gap.source}</strong> · {gap.detail}
                            </p>
                          ))}
                      </div>
                    </details>
                  ) : null}
                  {rewindLocalResult.evidence.length === 0 ? (
                    <p className="setup-hint">No matching evidence to show.</p>
                  ) : (
                    rewindLocalResult.evidence.map((evidence) => (
                      <div className="setup-section" key={evidence.id}>
                        <p className="setup-hint">
                          <strong>{evidence.sourceType}</strong> ·{" "}
                          {new Date(evidence.capturedAt).toLocaleString()}
                          {typeof evidence.confidence === "number"
                            ? ` · ${Math.round(evidence.confidence * 100)}% OCR confidence`
                            : ""}
                          <br />
                          {evidence.excerpt}
                        </p>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => void replayRewindMoment(evidence)}
                          disabled={rewindReplayId === evidence.id}
                        >
                          <IconExternalLink size={14} stroke={1.9} />
                          {rewindReplayId === evidence.id
                            ? "Preparing replay…"
                            : "Replay moment"}
                        </button>
                      </div>
                    ))
                  )}
                  {rewindLocalResult.truncated ? (
                    <p className="setup-hint">
                      More local matches exist; results are bounded to the
                      strongest 12.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="setup-button-row">
              <button
                type="button"
                className="secondary"
                onClick={exportScreenMemoryRecent}
                disabled={screenMemoryBusy || screenMemorySegments.length === 0}
              >
                <IconDownload size={15} stroke={1.9} />
                Export 5 min
              </button>
              <button
                type="button"
                className="secondary"
                onClick={openScreenMemoryFolder}
              >
                <IconFolderOpen size={15} stroke={1.9} />
                Open folder
              </button>
              <button
                type="button"
                className="secondary"
                onClick={clearScreenMemory}
                disabled={screenMemoryBusy || screenMemorySegments.length === 0}
              >
                <IconTrash size={15} stroke={1.9} />
                Clear Rewind
              </button>
            </div>
            <details
              className="setup-advanced"
              open={rewindEgressOpen}
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setRewindEgressOpen(open);
                if (open) refreshRewindEgressLog();
              }}
            >
              <summary className="setup-advanced-summary">
                Agent access log
              </summary>
              <div className="setup-advanced-body">
                <p className="setup-hint">
                  Every bounded Rewind evidence request is recorded on this Mac
                  before matching text is returned. Raw media appears only as a
                  separate private Clip handoff.
                </p>
                {rewindEgressEvents.length === 0 ? (
                  <p className="setup-hint">No evidence requests yet.</p>
                ) : (
                  rewindEgressEvents.slice(0, 10).map((event) => (
                    <details
                      className="setup-advanced"
                      key={`${event.requestId}-${event.state}`}
                    >
                      <summary className="popover-kv">
                        <span>
                          {new Date(event.occurredAt).toLocaleString()} ·{" "}
                          {event.state}
                        </span>
                        <strong>
                          {event.evidenceCount} item
                          {event.evidenceCount === 1 ? "" : "s"}
                        </strong>
                      </summary>
                      <div className="setup-advanced-body">
                        <p className="setup-hint">
                          <strong>{event.operation ?? "Agent access"}</strong>
                          {" · "}Request {event.requestId}
                        </p>
                        {event.receipt?.evidence?.map((evidence) => (
                          <p className="setup-hint" key={evidence.id}>
                            <strong>{evidence.sourceType}</strong>
                            {evidence.capturedAt
                              ? ` · ${new Date(evidence.capturedAt).toLocaleTimeString()}`
                              : ""}
                            <br />
                            Evidence {evidence.id} · moment {evidence.momentId}
                          </p>
                        ))}
                        {event.receipt?.frames?.map((frame) => (
                          <p className="setup-hint" key={frame.timestamp}>
                            <strong>Local frame</strong>
                            {` · ${new Date(frame.timestamp).toLocaleTimeString()}`}
                            <br />
                            Segment {frame.segmentId}
                          </p>
                        ))}
                        {event.receipt?.mediaInterval ? (
                          <p className="setup-hint">
                            <strong>Private Clip range</strong>
                            {` · ${new Date(event.receipt.mediaInterval.startAt).toLocaleTimeString()}–${new Date(event.receipt.mediaInterval.endAt).toLocaleTimeString()}`}
                          </p>
                        ) : null}
                        {!event.receipt ? (
                          <p className="setup-hint">
                            This completion record refers to the prepared
                            receipt with request ID {event.requestId}.
                          </p>
                        ) : null}
                        {event.error ? (
                          <p className="setup-warning">{event.error}</p>
                        ) : null}
                      </div>
                    </details>
                  ))
                )}
              </div>
            </details>
            {screenMemoryMessage ? (
              <p
                className={
                  screenMemoryMessage.kind === "ok"
                    ? "setup-success"
                    : "setup-warning"
                }
              >
                {screenMemoryMessage.text}
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      <details className="setup-advanced">
        <summary className="setup-advanced-summary">Advanced recording</summary>
        <div className="setup-advanced-body">
          <div className="setup-section">
            <SettingLabel
              label="Save recordings locally"
              hint="Advanced local-only mode. Local recordings save to Movies/Clips and do not upload or create a Clip."
              htmlFor="local-recording-mode"
            />
            <select
              id="local-recording-mode"
              className="setup-select"
              value={localRecordingMode}
              onChange={(event) =>
                setLocalRecordingMode(event.target.value as LocalRecordingMode)
              }
            >
              <option value="off">Cloud Clips (default)</option>
              <option value="composed">One local composed video</option>
              <option value="separate">
                Two local files: desktop + camera
              </option>
            </select>
            <p className="setup-hint">
              Two-file mode records desktop with audio and a raw rectangular
              camera video with no audio.
            </p>
          </div>

          <div className="setup-section">
            <div className="setup-toggle-row">
              <SettingLabel
                label="Screen region guides"
                hint="Show private rectangle guides over your screen while recording. They stay out of the saved Clip."
              />
              <Switch
                on={regionGuides.enabled}
                onChange={setRegionGuidesEnabled}
                label="Show screen region guides while recording"
              />
            </div>
            {regionGuides.enabled && (
              <div className="setup-toggle-row">
                <SettingLabel
                  label="Keep guides on screen even when not recording"
                  hint="Stays visible at all times so you can frame recordings made with other tools like OBS or QuickTime. Still excluded from every screen recording."
                />
                <Switch
                  on={regionGuidesAlwaysVisible}
                  onChange={setRegionGuidesAlwaysVisible}
                  label="Keep region guides on screen even when not recording"
                />
              </div>
            )}
            <div className="setup-button-row">
              <button
                type="button"
                className="secondary"
                onClick={openRegionGuideEditor}
              >
                <IconPencil size={15} stroke={1.9} />
                Edit preset
              </button>
              <button
                type="button"
                className="secondary"
                onClick={clearRegionGuidePreset}
                disabled={regionGuideCount === 0}
              >
                <IconTrash size={15} stroke={1.9} />
                Clear
              </button>
            </div>
            <p className="setup-hint">
              {regionGuideCount === 0
                ? "No guide preset saved yet."
                : `${regionGuideCount} ${regionGuideCount === 1 ? "rectangle" : "rectangles"} saved.`}
            </p>
          </div>
        </div>
      </details>

      <div className="setup-section">
        <SettingLabel
          label="Start/stop recording shortcut"
          hint="Optional global shortcut for starting full-screen, region, or camera recordings and stopping the active recording."
        />
        <ShortcutRecorder
          value={recordCustomShortcut}
          placeholder="Record shortcut"
          onChange={onRecordCustomShortcutChange}
        />
        <p className="setup-hint">
          Window and browser-tab sources still open Clips first so the picker
          can use a click.
        </p>
      </div>

      <div className="setup-section">
        <SettingLabel
          label="Open Clips shortcut"
          hint="Optional extra global shortcut for opening the tray popover. Cmd+Shift+L remains available."
        />
        <ShortcutRecorder
          value={popoverCustomShortcut}
          placeholder="Record shortcut"
          onChange={onPopoverCustomShortcutChange}
        />
        <p className="setup-hint">
          Use a modifier combination like Cmd+Shift+K. Leave empty to use only
          Cmd+Shift+L.
        </p>
        {shortcutRegistrationError ? (
          <p className="setup-warning">{shortcutRegistrationError}</p>
        ) : null}
      </div>

      <div className="setup-section-heading">Meetings</div>

      <div className="setup-section">
        <div className="setup-toggle-row">
          <SettingLabel
            label="Meeting notes"
            hint="Use calendar meetings to show a notes widget and start live transcription."
          />
          <Switch
            on={meetingsEnabled}
            onChange={setMeetingsEnabled}
            label="Enable meeting notes"
          />
        </div>
      </div>

      {meetingsEnabled ? (
        <>
          <div className="setup-section">
            <SettingLabel
              label="Meeting transcription"
              hint="Choose whether Clips asks first, starts automatically, or waits for manual start."
              htmlFor="meeting-transcription-mode"
            />
            <select
              id="meeting-transcription-mode"
              className="setup-select"
              value={meetingTranscriptionMode}
              onChange={(event) =>
                setMeetingTranscriptionMode(
                  event.target.value as MeetingTranscriptionMode,
                )
              }
            >
              <option value="ask">Ask at meeting time</option>
              <option value="auto">Auto-start during meeting times</option>
              <option value="manual">Manual only</option>
            </select>
            <p className="setup-hint">
              Auto-start still shows the notes pill while transcription is
              active.
            </p>
          </div>

          <div className="setup-section">
            <div className="setup-toggle-row">
              <SettingLabel
                label="Meeting widget"
                hint="Show the on-screen meeting widget near calendar start times, even when macOS notifications are hidden."
              />
              <Switch
                on={showMeetingWidgetEnabled}
                onChange={setShowMeetingWidgetEnabled}
                label="Show meeting widget"
              />
            </div>
          </div>
        </>
      ) : null}

      <div className="setup-section-heading">Whisper</div>

      <div className="setup-section">
        <div className="setup-toggle-row">
          <SettingLabel
            label="Whisper model"
            hint="Local AI model for offline transcription (dictation and meetings). No API key required."
          />
          <Switch
            on={whisperModelEnabled}
            onChange={setWhisperModelEnabled}
            label="Enable Whisper model"
          />
        </div>
        <WhisperModelStatusRow
          status={whisperStatus}
          enabled={whisperModelEnabled}
          onDownload={triggerWhisperDownload}
        />
      </div>

      <div className="setup-section-heading">Dictation</div>

      <div className="setup-section">
        <div className="setup-toggle-row">
          <SettingLabel
            label="Voice dictation"
            hint="Speak to type anywhere on your Mac. Turn off to disable globally and remove the keyboard shortcuts."
          />
          <Switch
            on={voiceEnabled}
            onChange={setVoiceEnabled}
            label="Enable voice dictation"
          />
        </div>
      </div>

      {voiceEnabled ? (
        <>
          <div className="setup-section">
            <SettingLabel
              label="Provider"
              hint="Choose free on-device dictation, Builder.io cleanup, or a provider key you own."
              htmlFor="voice-provider"
            />
            <select
              id="voice-provider"
              className="setup-select"
              value={selectedMode}
              onChange={(event) =>
                selectProviderMode(event.target.value as VoiceProviderMode)
              }
            >
              <option value="native">On-device (free, fast)</option>
              <option value="whisper" disabled={!whisperModelEnabled}>
                {whisperModelEnabled
                  ? "Local Whisper (offline AI)"
                  : "Local Whisper — enable Whisper model first"}
              </option>
              <option value="builder">Builder.io</option>
              <option value="byok">Add your own key</option>
            </select>
            <p className="setup-hint">{providerHint[selectedMode]}</p>
            {selectedMode === "whisper" && !whisperModelEnabled ? (
              <p className="setup-warning">
                Whisper model is disabled. Enable it in the Whisper section
                above.
              </p>
            ) : null}
            {providerWarning ? (
              <p className="setup-warning">{providerWarning}</p>
            ) : null}
            {selectedMode === "builder" && !providerStatus?.builder ? (
              <button
                type="button"
                className="secondary"
                onClick={connectBuilder}
              >
                Use Builder.io (free)
              </button>
            ) : null}
          </div>

          {selectedMode === "byok" ? (
            <div className="setup-section">
              <SettingLabel
                label="Key provider"
                hint="Choose which provider key to use for cleanup."
                htmlFor="voice-byok-provider"
              />
              <select
                id="voice-byok-provider"
                className="setup-select"
                value={byokProvider}
                onChange={(event) => {
                  setApiKeyMessage(null);
                  onVoiceProviderChange(
                    event.target.value as ByokVoiceProvider,
                  );
                }}
              >
                <option value="gemini">Google Gemini (recommended)</option>
                <option value="groq">Groq</option>
              </select>
              <div className="setup-key-row">
                <input
                  type="password"
                  value={apiKeyValue}
                  onChange={(event) => setApiKeyValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      saveApiKey();
                    }
                  }}
                  placeholder={
                    providerStatus?.[byokProvider]
                      ? "Key is saved — paste to rotate"
                      : `Paste ${keyForByokProvider(byokProvider)} here`
                  }
                  className="setup-key-input"
                />
                <button
                  type="button"
                  className="secondary setup-key-save"
                  onClick={saveApiKey}
                  disabled={!apiKeyValue.trim() || apiKeySaving}
                >
                  {apiKeySaving
                    ? "Saving..."
                    : providerStatus?.[byokProvider]
                      ? "Rotate"
                      : "Save"}
                </button>
              </div>
              {providerStatus?.[byokProvider] ? (
                <p className="setup-hint">
                  {labelForByokProvider(byokProvider)} key is set.
                </p>
              ) : null}
              {apiKeyMessage ? (
                <p
                  className={
                    apiKeyMessage.kind === "ok"
                      ? "setup-success"
                      : "setup-warning"
                  }
                >
                  {apiKeyMessage.text}
                </p>
              ) : null}
            </div>
          ) : null}

          {selectedMode !== "native" && selectedMode !== "whisper" ? (
            <div className="setup-section">
              <SettingLabel
                label="Custom instructions"
                hint="Included with LLM cleanup/transcription. Use this for casing, names, punctuation, tone, or terms of art."
                htmlFor="voice-instructions"
              />
              <textarea
                id="voice-instructions"
                className="setup-textarea"
                rows={4}
                value={voiceInstructions}
                onChange={(event) =>
                  onVoiceInstructionsChange(event.target.value)
                }
                placeholder="Example: keep it casual, spell Builder.io with a dot, and preserve technical terms exactly."
              />
              <p className="setup-hint">
                These instructions are sent only when an LLM-based provider is
                selected.
              </p>
            </div>
          ) : null}

          <div className="setup-section">
            <SettingLabel
              label="Shortcut"
              hint="The key combination that triggers voice dictation."
              htmlFor="voice-shortcut"
            />
            <select
              id="voice-shortcut"
              className="setup-select"
              value={voiceShortcut}
              onChange={(event) =>
                onVoiceShortcutChange(
                  event.target.value as VoiceShortcutPreference,
                )
              }
            >
              <option value="cmd-shift-space">Cmd+Shift+Space</option>
              <option value="ctrl-shift-space">Ctrl+Shift+Space</option>
              <option value="custom">Custom shortcut</option>
              <option value="fn">Fn (globe, needs Input Monitoring)</option>
              <option value="both">All shortcuts (includes Fn)</option>
            </select>
            {voiceShortcut === "custom" ? (
              <ShortcutRecorder
                value={voiceCustomShortcut}
                placeholder="Record voice shortcut"
                onChange={onVoiceCustomShortcutChange}
              />
            ) : null}
            <p className="setup-hint">{shortcutHint[voiceShortcut]}</p>
            {isMacPlatform() && fnShortcutSelected ? (
              <button
                type="button"
                className="secondary"
                onClick={() => openPrivacySettings("input-monitoring")}
              >
                Open Input Monitoring
              </button>
            ) : null}
          </div>

          <div className="setup-section">
            <SettingLabel
              label="Mode"
              hint="Whether you hold the shortcut while speaking or toggle it on and off."
              htmlFor="voice-mode"
            />
            <select
              id="voice-mode"
              className="setup-select"
              value={voiceMode}
              onChange={(event) =>
                onVoiceModeChange(event.target.value as VoiceMode)
              }
            >
              <option value="push-to-talk">Hold to dictate</option>
              <option value="toggle">Press to start, press to stop</option>
            </select>
            <p className="setup-hint">{modeHint[voiceMode]}</p>
          </div>
        </>
      ) : null}

      <div className="setup-section-heading">Debug</div>

      <div className="setup-account setup-account--no-border">
        <button
          type="button"
          className="link-button"
          onClick={() => {
            invoke("open_logs").catch((err) => {
              console.error("[clips-tray] open logs failed:", err);
            });
          }}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <IconFolderOpen size={14} />
          Open logs
        </button>
      </div>
      {signedInAs && onSignOut ? (
        <div className="setup-account">
          <span className="setup-account-email">{signedInAs}</span>
          <button
            type="button"
            className="link-button"
            onClick={onSignOut}
            style={{ background: "transparent", border: "none" }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SettingLabel({
  label,
  hint,
  htmlFor,
}: {
  label: string;
  hint: string;
  htmlFor?: string;
}) {
  return (
    <label className="setup-label" htmlFor={htmlFor}>
      <span>{label}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="setup-help" aria-label={hint}>
            <IconInfoCircle size={14} stroke={1.75} />
          </button>
        </TooltipTrigger>
        <TooltipContent>{hint}</TooltipContent>
      </Tooltip>
    </label>
  );
}

function WhisperModelStatusRow({
  status,
  enabled,
  onDownload,
}: {
  status: {
    state: string;
    path: string;
    downloadedMb: number;
    totalMb: number;
  } | null;
  enabled: boolean;
  onDownload: () => void;
}) {
  if (!enabled) {
    return (
      <div className="whisper-status whisper-status-disabled">
        <IconAlertTriangle size={13} className="whisper-status-icon" />
        <span>
          Without the Whisper model, only your microphone is transcribed — other
          speakers are not captured.
        </span>
      </div>
    );
  }
  if (!status) return null;

  if (status.state === "ready") {
    return (
      <div className="whisper-status whisper-status-ready">
        <IconCircleCheck size={13} className="whisper-status-icon" />
        <span>Ready · {status.totalMb} MB</span>
        <span className="whisper-status-path">{status.path}</span>
      </div>
    );
  }

  if (status.state === "downloading") {
    const pct =
      status.totalMb > 0
        ? Math.round((status.downloadedMb / status.totalMb) * 100)
        : 0;
    return (
      <div className="whisper-status whisper-status-downloading">
        <span className="whisper-progress-label">
          Downloading… {status.downloadedMb} / {status.totalMb} MB ({pct}%)
        </span>
        <div className="whisper-progress-bar">
          <div className="whisper-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  // "missing" state
  return (
    <div className="whisper-status whisper-status-missing">
      <IconAlertTriangle size={13} className="whisper-status-icon" />
      <span>Model not downloaded.</span>
      <button
        type="button"
        className="whisper-download-btn"
        onClick={onDownload}
      >
        Download now
      </button>
    </div>
  );
}

function formatShortcutKey(key: string): string {
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  const aliases: Record<string, string> = {
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
    ArrowUp: "ArrowUp",
    Escape: "Escape",
    " ": "Space",
  };
  return aliases[key] ?? key;
}

function shortcutFromKeyboardEvent(event: React.KeyboardEvent): string | null {
  const modifierKeys = new Set(["Alt", "Control", "Meta", "Shift", "Fn"]);
  if (modifierKeys.has(event.key)) return null;

  const parts: string[] = [];
  if (event.metaKey) parts.push("Cmd");
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (!parts.length) return null;

  return [...parts, formatShortcutKey(event.key)].join("+");
}

function hasShortcutModifier(event: React.KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
}

function ShortcutRecorder({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  function flashSaved() {
    setSaved(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => {
      savedTimerRef.current = null;
      setSaved(false);
    }, 1600);
  }

  return (
    <div className="setup-shortcut-row">
      <button
        ref={buttonRef}
        type="button"
        className={`setup-shortcut-recorder ${recording ? "recording" : ""}`}
        onClick={(event) => {
          if (recording) {
            event.preventDefault();
            return;
          }
          setError(null);
          setSaved(false);
          setRecording(true);
          requestAnimationFrame(() => buttonRef.current?.focus());
        }}
        onBlur={() => setRecording(false)}
        onKeyDown={(event) => {
          if (!recording) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Escape") {
            setRecording(false);
            setError(null);
            return;
          }
          if (event.key === "Backspace" || event.key === "Delete") {
            onChange("");
            setRecording(false);
            setError(null);
            setSaved(false);
            return;
          }
          const next = shortcutFromKeyboardEvent(event);
          if (!next) {
            setError(
              event.key === " " && !hasShortcutModifier(event)
                ? "Space needs Cmd, Ctrl, Option, or Shift so it does not hijack typing."
                : "Use at least one modifier plus a key.",
            );
            return;
          }
          onChange(next);
          setRecording(false);
          setError(null);
          flashSaved();
        }}
        onKeyUp={(event) => {
          if (!recording) return;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {recording ? "Press shortcut..." : value || placeholder}
      </button>
      {value ? (
        <button
          type="button"
          className="setup-shortcut-clear"
          onClick={() => {
            onChange("");
            setError(null);
            setSaved(false);
          }}
        >
          Clear
        </button>
      ) : null}
      {error ? <p className="setup-warning">{error}</p> : null}
      {saved && !error ? (
        <p className="setup-success" aria-live="polite">
          Saved
        </p>
      ) : null}
    </div>
  );
}
