import {
  IconAdjustmentsHorizontal,
  IconAlertTriangle,
  IconArrowLeft,
  IconCalendar,
  IconCalendarEvent,
  IconCircleCheck,
  IconDownload,
  IconExternalLink,
  IconFolderOpen,
  IconPencil,
  IconInfoCircle,
  IconHistory,
  IconMicrophone,
  IconMicrophone2,
  IconPlayerPlay,
  IconRefresh,
  IconSearch,
  IconShieldLock,
  IconTool,
  IconTrash,
  IconUpload,
  IconVideo,
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
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  SettingsActionButton,
  SettingsChoicePopover,
  SettingsGroup,
  SettingsKeycap,
  SettingsPopover,
  SettingsRow,
  SettingsSelect,
  SettingsValueTrigger,
} from "@/components/settings/settings-ui";
// Aliased `Ui*` for symmetry with `UiSwitch`: the tray historically had a
// plain-CSS AlertDialog adapter under the bare names.
import {
  AlertDialog as UiAlertDialog,
  AlertDialogAction as UiAlertDialogAction,
  AlertDialogCancel as UiAlertDialogCancel,
  AlertDialogContent as UiAlertDialogContent,
  AlertDialogDescription as UiAlertDialogDescription,
  AlertDialogFooter as UiAlertDialogFooter,
  AlertDialogHeader as UiAlertDialogHeader,
  AlertDialogTitle as UiAlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch as UiSwitch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

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
import { MicOffConfirmation } from "./components/MicOffConfirmation";
import { ReadinessPanel } from "./components/ReadinessPanel";
import { SourceRow, type CaptureSource } from "./components/SourceRow";
import { Switch } from "./components/Switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "./components/Tooltip";
import { UpdateBanner } from "./components/UpdateBanner";
import { useMediaDevices } from "./hooks/useMediaDevices";
import { useMeetingTranscription } from "./hooks/useMeetingTranscription";
import { stopAllMicMeters } from "./hooks/useMicMeter";
import { useSystemAccessRows } from "./hooks/useSystemAccessRows";
import { useWhisperSettings } from "./hooks/useWhisperSettings";
import { startBubbleFramePump } from "./lib/bubble-pump";
import { shouldKeepBubbleSession } from "./lib/bubble-session";
import {
  startBubbleWebrtc,
  type BubbleWebrtcHandle,
} from "./lib/bubble-webrtc";
import {
  getCameraStreamWithFallback,
  isMediaConstraintFailure,
} from "./lib/media-capture-constraints";
import { sendNativeNotification } from "./lib/native-notification";
import { openMeetingJoinUrl } from "./lib/open-meeting-join-url";
import type { MacosPrivacyPane } from "./lib/permission-status";
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
  pickFullscreenRecordingDisplay,
  retryBrowserRecordingBackup,
  scheduleNativeBackupCleanupAfterProcessing,
  shouldUseNativeFullscreenRecording,
  startRecording,
  type LocalExportedFile,
  type PendingBrowserRecordingUpload,
  type RecorderHandle,
  type RecorderStopResult,
  type RestartHandoff,
} from "./lib/recorder";
import {
  copyRecordingShareLink,
  recordingShareUrl,
} from "./lib/recording-link";
import { boundedCleanup } from "./lib/recording-start-guard";
import { REWIND_AGENT_PROMPT } from "./lib/rewind-agent-prompt";
import { getRewindStatusPresentation } from "./lib/rewind-status";
import {
  initialDesktopSettingsTab,
  type DesktopSettingsTab,
} from "./lib/settings-navigation";
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
} from "./lib/updater";
import { normalizeServerUrl } from "./lib/url";
import { cn } from "./lib/utils";
import {
  installDesktopVoiceDictation,
  type VoiceMode,
  type VoiceProvider,
  type VoiceShortcutPreference,
} from "./lib/voice-dictation";
import { whisperModelOptionLabel } from "./lib/whisper-model-picker";
import { PillLogo } from "./overlays/pill-logo";
import {
  useFeatureConfig,
  type FeatureConfig,
  type RewindCaptureMode,
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
  | "settings"
  | "meetings"
  | "dictation";

type SettingsTabId = DesktopSettingsTab;

declare const __CLIPS_DESKTOP_VERSION__: string;

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

interface ShareLinkNotice {
  recordingId: string;
  origin: string;
  url: string;
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
// The docs section for the tray's rolling buffer, published under the same
// Rewind name the settings tab uses.
const REWIND_DOCS_URL =
  "https://www.agent-native.com/docs/template-clips-capture-everywhere#rewind";

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

function stopRestartHandoff(handoff: RestartHandoff): void {
  [handoff.displayStream, handoff.audioStream].forEach((stream) =>
    stream?.getTracks().forEach((track) => track.stop()),
  );
}

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

let authFetchInstalled = false;
// Seeded at module load, not from an effect. A child component's effect runs
// before its parent's, so anything fetching the server during the first commit
// (the sign-in screen's availability probe, for one) would otherwise find no
// server origin registered and get the un-adjusted request.
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

// Poll cadence for the caller's re-check loop is 5s; bound each probe request
// well above that so a hung request can't wedge the poll's in-flight guard.
const VIDEO_STORAGE_PROBE_TIMEOUT_MS = Math.max(10_000, 5000 * 4);

async function fetchWithAbortTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function hasConfiguredVideoStorage(
  serverUrl: string,
): Promise<VideoStorageProbe> {
  const base = serverUrl.replace(/\/+$/, "");

  // Track whether any endpoint gave a definitive answer. If both checks throw
  // or return non-OK/unparseable responses, we can't tell and return "unknown".
  let sawDefinitiveAnswer = false;

  try {
    const uploadStatus = await fetchWithAbortTimeout(
      `${base}/_agent-native/file-upload/status`,
      {
        credentials: "include",
        cache: "no-store",
      },
      VIDEO_STORAGE_PROBE_TIMEOUT_MS,
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
    const builderStatus = await fetchWithAbortTimeout(
      `${base}/_agent-native/builder/status`,
      {
        credentials: "include",
        cache: "no-store",
      },
      VIDEO_STORAGE_PROBE_TIMEOUT_MS,
    );
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

/** True only for `tauri dev` / `pnpm vite:dev`, where the webview is served
 *  from Vite at http://localhost:1420. Protocol alone is NOT the test:
 *  packaged Windows builds load from http(s)://tauri.localhost — one of the
 *  exact origins the framework trusts with cookie credentials
 *  (TRUSTED_NATIVE_APP_ORIGIN_RE) — and classifying those as dev would strip
 *  `credentials: "include"` from every production request on Windows. */
function isDevOriginWebview(): boolean {
  return (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    window.location.protocol.startsWith("http") &&
    window.location.hostname === "localhost"
  );
}

function seedDesktopAuthContextFromStorage(): void {
  if (currentServerOrigin || typeof window === "undefined") return;
  const storedServerUrl = loadString(STORAGE_KEY, DEFAULT_URL).replace(
    /\/+$/,
    "",
  );
  setDesktopAuthContext(storedServerUrl, loadDesktopAuthToken(storedServerUrl));
}

/**
 * Installed from `main.tsx` before the first render, not from an effect: a
 * component effect runs too late to cover fetches issued during the same
 * commit, and an un-intercepted desktop request goes out without its
 * X-Request-Source marker or the dev-origin credential policy below.
 */
export function installAuthFetchInterceptor(): void {
  if (authFetchInstalled || typeof window === "undefined") return;
  authFetchInstalled = true;
  seedDesktopAuthContextFromStorage();
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
    // Cookies are only an option from the packaged app. `tauri dev` serves the
    // webview from http://localhost:1420, and the framework deliberately keeps
    // localhost off credentialed CORS ("only the configured browser allowlist
    // and the framework's exact native app origins may receive cookies" —
    // shouldAllowMcpEmbedCredentials). Since we always add X-Request-Source,
    // the preflight is credentialed, so asking for cookies there fails the
    // whole request rather than degrading. The bearer token above is the
    // supported credential for this origin, and the server returns it in the
    // login body precisely because localhost:1420 is on its token allowlist.
    const credentials: RequestCredentials | undefined = isDevOriginWebview()
      ? "omit"
      : init?.credentials;
    return nativeFetch(input, { ...init, headers, credentials });
  };
}

type ByokVoiceProvider = Extract<VoiceProvider, "gemini" | "groq">;
type VoiceProviderMode = "native" | "whisper" | "builder" | "byok";

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

// Same explicit-drag pattern the toolbar/bubble overlays use —
// `data-tauri-drag-region` has been unreliable, so we call `startDragging()`
// directly on mousedown. Clicks on buttons/inputs still reach their handlers
// since we only start a drag when the mousedown target isn't inside one.
function handlePopoverHeaderMouseDown(event: React.MouseEvent) {
  if (event.button !== 0) return;
  const target = event.target as HTMLElement;
  if (target.closest("button, a, input, select, textarea")) return;
  getCurrentWindow()
    .startDragging()
    .catch((err) => {
      console.warn("[clips-popover] startDragging failed:", err);
    });
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

function humanReadableShortcutLabel(shortcut: string): string {
  return shortcut
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean)
    .join(" ");
}

const MAC_MODIFIER_GLYPHS: Record<string, string> = {
  Cmd: "⌘",
  Ctrl: "⌃",
  Alt: "⌥",
  Shift: "⇧",
};

/** Keycap form for a settings row: `⌘⇧Space` on macOS, words elsewhere. */
function compactShortcutLabel(shortcut: string): string {
  const tokens = shortcut
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);
  if (!isMacPlatform()) return tokens.join(" ");
  return tokens.map((token) => MAC_MODIFIER_GLYPHS[token] ?? token).join("");
}

function compactVoiceShortcutLabel(
  shortcut: VoiceShortcutPreference,
  customShortcut: string,
): string {
  switch (shortcut) {
    case "fn":
      return "Fn";
    case "cmd-shift-space":
      return compactShortcutLabel("Cmd+Shift+Space");
    case "ctrl-shift-space":
      return compactShortcutLabel("Ctrl+Shift+Space");
    case "custom":
      return customShortcut ? compactShortcutLabel(customShortcut) : "Custom";
    case "both":
      return `Fn / ${compactShortcutLabel("Cmd+Shift+Space")}`;
  }
}

/**
 * The shadcn Switch, engaged in green rather than `bg-primary`. A menu-bar app
 * sits next to macOS's own switches all day, and green is what that audience
 * reads as "on" — the one accent on this surface, hence the `--success` token
 * rather than a literal.
 */
function SettingsSwitch({
  checked,
  onCheckedChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <UiSwitch
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className="h-5 w-9 data-[state=checked]:bg-success [&>span]:size-4 [&>span]:data-[state=checked]:translate-x-4"
    />
  );
}

const VOICE_SHORTCUT_CHOICES: Array<{ value: string; label: string }> = [
  { value: "cmd-shift-space", label: "Cmd Shift Space" },
  { value: "ctrl-shift-space", label: "Ctrl Shift Space" },
  { value: "custom", label: "Custom shortcut" },
  { value: "fn", label: "Fn (globe)" },
  { value: "both", label: "Any of them" },
];

function voiceShortcutLabel(
  shortcut: VoiceShortcutPreference,
  customShortcut: string,
): string {
  switch (shortcut) {
    case "fn":
      return "Fn";
    case "cmd-shift-space":
      return "Cmd Shift Space";
    case "ctrl-shift-space":
      return "Ctrl Shift Space";
    case "custom":
      return customShortcut
        ? humanReadableShortcutLabel(customShortcut)
        : "Custom shortcut";
    case "both":
      return "Fn, Cmd Shift Space, or Ctrl Shift Space";
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
    // Floating settings layers are intentionally independent of the native
    // window size. Their content can scroll inside the layer without changing
    // the tray popover underneath it.
    if (child.closest('[data-popover-overlay="true"]')) continue;
    // A marked scroll region owns its overflow: content scrolls inside it
    // without growing the native window. Without this, the fixed-height
    // Settings pane's scrollHeight would resize the tray to the full length
    // of whichever tab is open.
    const scrollRegion = child.closest<HTMLElement>(
      "[data-popover-scroll-region]",
    );
    if (scrollRegion) {
      if (scrollRegion !== child) continue;
      const regionRect = child.getBoundingClientRect();
      lowestBottom = Math.max(lowestBottom, regionRect.bottom);
      continue;
    }
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

export function App({
  initialView,
  initialSettingsTab: initialSettingsTabProp,
}: {
  /** Route-supplied starting surface, so `#settings` opens there directly. */
  initialView?: PopoverView;
  initialSettingsTab?: DesktopSettingsTab;
} = {}) {
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
  const [micOffConfirmOpen, setMicOffConfirmOpen] = useState(false);
  const pendingStartOptionsRef =
    useRef<Parameters<typeof handleStartRecording>[0]>(undefined);
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
  const voiceCleanupEnabled = featureConfig?.voiceCleanupEnabled !== false;

  const [pendingUploads, setPendingUploads] = useState<PendingDesktopUpload[]>(
    [],
  );
  const [retryingUploadId, setRetryingUploadId] = useState<string | null>(null);
  const [retryingUploadStatus, setRetryingUploadStatus] = useState<
    string | null
  >(null);
  const [exportingUploadId, setExportingUploadId] = useState<string | null>(
    null,
  );
  const [dismissingUploadId, setDismissingUploadId] = useState<string | null>(
    null,
  );
  const [localRecordingNotice, setLocalRecordingNotice] =
    useState<LocalRecordingNotice | null>(null);
  const [shareLinkNotice, setShareLinkNotice] =
    useState<ShareLinkNotice | null>(null);
  const [popoverView, setPopoverView] = useState<PopoverView>(
    initialView ?? "recorder",
  );
  const [initialSettingsTab, setInitialSettingsTab] = useState<SettingsTabId>(
    initialSettingsTabProp ?? "general",
  );
  // A staged update is announced by a dot on Settings, not by a banner that
  // pushes the recording controls down.
  const updateReadyToInstall = useUpdateStatus().state === "downloaded";

  function openSettings(tab: SettingsTabId = "general") {
    setInitialSettingsTab(tab);
    setPopoverView("settings");
  }

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
  const recordingStartAbortRef = useRef<AbortController | null>(null);
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
  const [, setLastRecordingId] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<"unknown" | "authed" | "anon">(
    "unknown",
  );
  // "Could not reach the server" is not the same state as "signed out", and the
  // fix is different: one needs a correct server URL, the other needs sign-in.
  const [serverReachable, setServerReachable] = useState(true);
  const serverHostForSignIn = serverUrl
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const [videoStorageStatus, setVideoStorageStatus] =
    useState<VideoStorageStatus>("checking");
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [signInPending, setSignInPending] = useState<
    "google" | "magic-link" | null
  >(null);
  const [magicLinkEmail, setMagicLinkEmail] = useState<string | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);
  // Ref-based lock so two fast clicks cannot start competing desktop auth
  // (state updates are async; refs are synchronous).
  const signInInflightRef = useRef(false);
  // Stored so Cancel can stop the polling loop.
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const signInVisibilityRef = useRef<(() => void) | null>(null);
  const isRecording = recorder !== null;
  // Whether the popover window is shown; driven by the visibility effect below.
  const [popoverVisible, setPopoverVisible] = useState(false);
  const recordShortcutHandlerRef = useRef<() => void>(() => {});
  const handleStartRecordingRef = useRef<
    (options?: {
      ignoreActiveRecorder?: boolean;
      resumeCapture?: RestartHandoff;
    }) => Promise<RecorderHandle | null>
  >(async () => null);
  // Mirrors `bubbleActive` (assigned below once it is computed) so device
  // probes can synchronously tell whether the camera bubble owns the grant.
  const bubbleActiveRef = useRef(false);
  const {
    cameraId,
    setCameraId,
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

    let inFlight = false;
    const tick = () => {
      if (document.hidden || inFlight) return;
      inFlight = true;
      void refreshVideoStorageStatus().finally(() => {
        inFlight = false;
      });
    };
    const interval = window.setInterval(tick, 5000);
    const onVisibilityChange = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
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
        { credentials: "include", cache: "no-store" },
      );
      // Any HTTP answer, including 401, means the server is there.
      setServerReachable(true);
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
      // Network-level failure: nothing answered, so we know nothing about the
      // session. Record that separately so the UI can offer the right fix.
      setServerReachable(false);
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
    let inFlight = false;
    const poll = async () => {
      if (document.hidden || inFlight) return;
      inFlight = true;
      const controller = new AbortController();
      const abortTimer = setTimeout(
        () => controller.abort(),
        Math.max(10_000, 3_000 * 4),
      );
      try {
        const result = await callClipsAction<{
          requests?: RewindExtensionRequest[];
        }>(
          "list-rewind-extension-requests",
          {},
          { method: "GET", signal: controller.signal },
        )
          // coercion-ok: nothing to process this sweep either way; the next
          // tick re-reads the pending requests.
          .catch(() => null);
        if (cancelled) return;
        for (const request of result?.requests ?? []) {
          void processRewindExtension(request);
        }
      } finally {
        clearTimeout(abortTimer);
        inFlight = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3_000);
    const onVisibilityChange = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
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
    let inFlight = false;
    const sweep = async () => {
      if (document.hidden || inFlight) return;
      inFlight = true;
      try {
        const due = await invoke<DueRewindAgentHandoff[]>(
          "screen_memory_due_agent_handoffs",
        )
          // coercion-ok: handoffs stay due in the local store, so an empty
          // sweep and a failed one both retry on the next tick.
          .catch(() => []);
        if (cancelled) return;
        for (const item of due) {
          try {
            const controller = new AbortController();
            const abortTimer = setTimeout(
              () => controller.abort(),
              Math.max(10_000, 60_000 * 4),
            );
            const cleanup = await callClipsAction<{
              deleted: boolean;
              reason: string;
            }>(
              "delete-agent-recording-if-unpromoted",
              { id: item.recordingId },
              { signal: controller.signal },
            ).finally(() => clearTimeout(abortTimer));
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
      } finally {
        inFlight = false;
      }
    };
    void sweep();
    const timer = window.setInterval(() => void sweep(), 60_000);
    const onVisibilityChange = () => {
      if (!document.hidden) void sweep();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
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

  type DesktopAuthKind = "google" | "magic-link";

  function stopDesktopAuthPolling() {
    if (pollIntervalRef.current !== null) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (signInVisibilityRef.current) {
      document.removeEventListener(
        "visibilitychange",
        signInVisibilityRef.current,
      );
      signInVisibilityRef.current = null;
    }
  }

  function finishDesktopAuthWithError(kind: DesktopAuthKind, message: string) {
    stopDesktopAuthPolling();
    signInInflightRef.current = false;
    setSignInPending(null);
    if (kind === "magic-link") setMagicLinkEmail(null);
    setSignInError(message);
  }

  function startDesktopAuthExchange(
    flowId: string,
    kind: DesktopAuthKind,
    verifier?: string,
  ) {
    let tickInFlight = false;
    const base = serverUrl.replace(/\/+$/, "");
    const start = Date.now();
    const TIMEOUT_MS = 5 * 60 * 1000;
    const POLL_ABORT_MS = Math.max(10_000, 1500 * 4);
    const timeoutMessage =
      kind === "magic-link"
        ? "That sign-in link expired. Request a new one."
        : "Google sign-in timed out. Try again.";
    const exchangeErrorMessage =
      kind === "magic-link"
        ? "That link didn't sign you in. Request a new one."
        : "Google sign-in didn't go through. Try again.";

    const tick = async () => {
      if (document.hidden || tickInFlight) return;
      tickInFlight = true;
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), POLL_ABORT_MS);
      try {
        const xr = await fetch(
          `${base}/_agent-native/auth/desktop-exchange?flow_id=${encodeURIComponent(flowId)}`,
          {
            credentials: "include",
            ...(verifier
              ? {
                  headers: {
                    "X-Agent-Native-Desktop-Verifier": verifier,
                  },
                }
              : {}),
            signal: controller.signal,
          },
        );
        if (!xr.ok) {
          if (Date.now() - start > TIMEOUT_MS) {
            finishDesktopAuthWithError(kind, timeoutMessage);
          }
          return;
        }
        const xd = (await xr.json()) as {
          error?: string;
          message?: string;
          token?: string;
        } | null;
        if (xd?.error) {
          finishDesktopAuthWithError(
            kind,
            typeof xd.message === "string"
              ? xd.message
              : typeof xd.error === "string"
                ? xd.error
                : exchangeErrorMessage,
          );
          return;
        }
        if (xd?.token) {
          stopDesktopAuthPolling();
          saveDesktopAuthToken(base, String(xd.token));
          // The exchange response sets the WebView cookie. The bearer token
          // above is the reliable desktop auth path and avoids putting it in a
          // follow-up URL.
          signInInflightRef.current = false;
          setSignInPending(null);
          setMagicLinkEmail(null);
          const ok = await checkAuth();
          if (!ok) {
            setSignInError(
              kind === "magic-link"
                ? "Signed in, but Clips couldn't keep the session. Try again."
                : "Signed in with Google, but Clips couldn't keep the session. Try again.",
            );
          }
        } else if (Date.now() - start > TIMEOUT_MS) {
          finishDesktopAuthWithError(kind, timeoutMessage);
        }
      } catch {
        if (Date.now() - start > TIMEOUT_MS) {
          finishDesktopAuthWithError(kind, timeoutMessage);
        }
      } finally {
        clearTimeout(abortTimer);
        tickInFlight = false;
      }
    };

    stopDesktopAuthPolling();
    pollIntervalRef.current = setInterval(() => void tick(), 1500);
    const onVisibilityChange = () => {
      if (!document.hidden) void tick();
    };
    signInVisibilityRef.current = onVisibilityChange;
    document.addEventListener("visibilitychange", onVisibilityChange);
    void tick();
  }

  // Google verification opens in the system browser so the user's Google
  // cookies are available. The client-held verifier still gates the exchange
  // back into this Tauri app.
  async function signInExternal() {
    if (signInInflightRef.current) return;
    signInInflightRef.current = true;

    try {
      setSignInError(null);
      const flowId = crypto.randomUUID?.() ?? null;
      const verifier = (() => {
        const randomUuid = crypto.randomUUID;
        if (typeof randomUuid === "function") {
          return `${randomUuid.call(crypto)}${randomUuid.call(crypto)}`;
        }
        if (typeof crypto.getRandomValues === "function") {
          const bytes = new Uint8Array(32);
          crypto.getRandomValues(bytes);
          let binary = "";
          for (const byte of bytes) binary += String.fromCharCode(byte);
          return btoa(binary)
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
        }
        return null;
      })();
      if (!flowId || !verifier) {
        // A Math.random flow id is guessable, which lets anyone else claim this
        // sign-in's exchange slot; fail closed rather than weaken the credential.
        throw new Error("Secure OAuth flow generation is unavailable.");
      }
      const base = serverUrl.replace(/\/+$/, "");

      const authParams = new URLSearchParams({
        desktop: "1",
        flow_id: flowId,
      });
      const authResponse = await fetch(
        `${base}/_agent-native/google/auth-url?${authParams.toString()}`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "X-Agent-Native-Desktop-Verifier": verifier,
          },
        },
      );
      let authPayload: {
        url?: unknown;
        error?: unknown;
        message?: unknown;
      };
      try {
        authPayload = (await authResponse.json()) as typeof authPayload;
      } catch {
        throw new Error("Could not start Google sign-in.");
      }
      if (!authResponse.ok || typeof authPayload?.url !== "string") {
        const message =
          typeof authPayload.message === "string"
            ? authPayload.message
            : typeof authPayload.error === "string"
              ? authPayload.error
              : "Could not start Google sign-in.";
        throw new Error(message);
      }
      await openExternal(authPayload.url);
      setSignInPending("google");
      startDesktopAuthExchange(flowId, "google", verifier);
    } catch (err) {
      console.error("[clips-tray] signInExternal failed:", err);
      signInInflightRef.current = false;
      setSignInPending(null);
      setSignInError(
        err instanceof Error
          ? err.message
          : "Couldn't open Google sign-in. Try again.",
      );
    }
  }

  async function requestMagicLink(email: string) {
    if (signInInflightRef.current) return;
    signInInflightRef.current = true;
    const base = serverUrl.replace(/\/+$/, "");
    try {
      setSignInError(null);
      const res = await fetch(`${base}/_agent-native/auth/magic-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          callbackURL: "/_agent-native/auth/magic-link/desktop-callback",
        }),
        credentials: "include",
      });
      const json = (await res.json()) as {
        error?: string;
        flowId?: string;
        verifier?: string;
      } | null;
      if (!res.ok) {
        throw new Error(
          json?.error ||
            "Couldn't send the link. Check the email address and try again.",
        );
      }
      if (!json?.flowId || !json.verifier) {
        throw new Error("That link is no longer active. Request a new one.");
      }
      setMagicLinkEmail(email.trim());
      setSignInPending("magic-link");
      startDesktopAuthExchange(json.flowId, "magic-link", json.verifier);
    } catch (err) {
      signInInflightRef.current = false;
      setSignInPending(null);
      setMagicLinkEmail(null);
      throw err;
    }
  }

  function cancelSignIn() {
    stopDesktopAuthPolling();
    signInInflightRef.current = false;
    setSignInPending(null);
    setMagicLinkEmail(null);
    setSignInError(null);
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
        // Escape belongs to the topmost layer. Radix handles it on `document`,
        // which then bubbles to this window listener, so a single press would
        // otherwise both dismiss the layer AND hide the whole tray window —
        // backing out of a select or the Rewind consent dialog would take the
        // window the user was working in with it. Matching only `open` layers
        // keeps a closing one (select and popover still animate out) from
        // swallowing the next press.
        if (
          document.querySelector(
            '[data-radix-popper-content-wrapper] [data-state="open"], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
          )
        ) {
          return;
        }
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
  // Bumped when a session tears the recording chrome down without leaving the
  // recording flow, which only a restart does. `toolbarActive` stays true
  // across that handoff, so without an epoch the toolbar effect never re-runs
  // and the closed toolbar window is never rebuilt.
  const [recordingChromeEpoch, setRecordingChromeEpoch] = useState(0);
  const wantsCamera = mode !== "screen" && cameraOn;
  const nativeFullscreenRecordingActive =
    mode !== "camera" && shouldUseNativeFullscreenRecording(source);
  // Ref mirror of `isRecording || recordingFlowActive` so cleanup (which
  // captures the dep-snapshot value) can still see the current flow state.
  // Update it in a layout effect: passive effect cleanup runs before passive
  // effect setup, so mirroring this in a passive effect leaves cleanup behind.
  const recordingFlowGateRef = useRef(false);
  // Stop detaches the recorder state before optimization/upload finishes so a
  // fresh camera session can recover immediately. Keep that post-stop phase
  // separate so React cleanup does not close the finalizing progress window.
  const recordingStopFinalizingRef = useRef(false);
  // Held from the restart click until the replacement recorder is up (or has
  // failed). Stop and cancel are terminal transitions on the recorder a
  // restart is already tearing down, so they must not run against it.
  const restartInFlightRef = useRef(false);
  const recordingInFlight = isRecording || recordingFlowActive;
  useLayoutEffect(() => {
    recordingFlowGateRef.current = recordingInFlight;
  }, [recordingInFlight]);
  const bubbleActive = shouldKeepBubbleSession({
    wantsCamera,
    popoverVisible,
    recordingInFlight,
  });

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
      } catch (err) {
        console.error("[clips-popover] show_toolbar failed:", err);
      }
    })();
    // Seed disabled before the asynchronous window creation. A late seed can
    // otherwise arrive after the recorder's enabled event and strand the
    // toolbar at 0:00.
    emit("clips:toolbar-enabled", false).catch(() => {});
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
  }, [toolbarActive, recordingChromeEpoch]);

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
    let unlistenUnrendered: (() => void) | null = null;

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
        // ICE reaching `connected` proves the transport works, nothing more.
        // WKWebView can refuse to play the received track (no user gesture in
        // the bubble page, or its window briefly had no on-screen area), and
        // that failure is invisible from here — so the bubble reports it and
        // we fall back to the pump. Without this the safety net below only
        // ever fired on ICE failure, which is not how this breaks in practice.
        listen("clips:bubble-webrtc-unrendered", (ev) => {
          startCanvasFallback(
            `bubble reported no rendered frames ${JSON.stringify(ev.payload)}`,
          );
        })
          .then((u) => {
            if (cancelled) {
              u();
              return;
            }
            unlistenUnrendered = u;
          })
          .catch(() => {});
        webrtcHandle = startBubbleWebrtc({
          stream: s,
          onConnected: () => {
            console.log(
              "[clips-popover] bubble WebRTC transport connected — waiting for the bubble to confirm playback",
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
      if (unlistenUnrendered) {
        unlistenUnrendered();
        unlistenUnrendered = null;
      }
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
    disabled:
      (popoverView !== "settings" && !popoverVisible) ||
      isRecording ||
      recordingFlowActive,
    width:
      popoverView === "settings" ? 720 : popoverView === "memory" ? 440 : 320,
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

  useEffect(() => {
    let cancelled = false;
    void invoke<{ recovered: number }>(
      "native_fullscreen_recover_orphaned_uploads",
      { serverUrl },
    )
      .then((result) => {
        if (!cancelled && result.recovered > 0) {
          return loadPendingUploads();
        }
        return undefined;
      })
      .catch((error) => {
        console.warn(
          "[clips-tray] orphaned recording recovery lookup failed:",
          error,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [loadPendingUploads, serverUrl]);

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

  function openRewindDocs() {
    openExternal(REWIND_DOCS_URL).catch((err) => {
      console.error("[clips-tray] open Rewind docs failed:", err);
    });
  }

  // Never rejects: a clipboard failure must not be mistaken for a failed
  // recording by the stop/retry callers that await this inside their try block.
  async function copyShareLink(
    recordingId: string,
    origin = serverUrl,
    { notify = true }: { notify?: boolean } = {},
  ) {
    try {
      const url = recordingShareUrl(recordingId, origin);
      const copied = await copyRecordingShareLink(recordingId, origin);
      if (copied) {
        setShareLinkNotice(null);
        if (notify) {
          await sendNativeNotification({
            title: "Link copied",
            body: "Your clip link is ready to paste.",
          });
        }
      } else {
        setShareLinkNotice({ recordingId, origin, url });
      }
      return copied;
    } catch (err) {
      console.error("[clips-tray] copy share link failed:", err);
      return false;
    }
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
          onRecoveryDecision: ({ action, progress }) => {
            setRetryingUploadStatus(
              action === "resume"
                ? `Resuming · ${Math.round(progress * 100)}% already uploaded`
                : action === "restart"
                  ? "Restarting upload"
                  : "Finishing upload",
            );
          },
        });
      }
      await loadPendingUploads();
      await copyShareLink(upload.recordingId, targetServerUrl);
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
      setRetryingUploadStatus(null);
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
    /** Live capture inherited from the take a restart is replacing. */
    resumeCapture?: RestartHandoff;
  }): Promise<RecorderHandle | null> {
    if (
      (recorder || recordingFlowGateRef.current) &&
      !options?.ignoreActiveRecorder
    ) {
      console.warn(
        "[clips-popover] handleStartRecording ignored — recorder already active",
      );
      setRecError(
        "Still finishing the last recording. Wait a moment, then try again.",
      );
      return null;
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
        return null;
      }
      if (videoStorageStatus === "missing") {
        openVideoStorageSetup();
        return null;
      }
    }
    setRecError(null);
    setLocalRecordingNotice(null);
    setShareLinkNotice(null);
    console.log("[clips-popover] handleStartRecording clicked", {
      serverUrl,
      mode,
      source,
      localRecordingMode,
      cameraOn,
      micOn,
    });

    if (mode !== "camera" && nativeFullscreenRecordingActive) {
      // Latch re-entry protection before these awaits, not after — both the
      // permission prompt and the monitor picker below can take a while (the
      // picker waits on the user), and without this a double-click while
      // either is pending passes the top-of-function guard and starts a
      // second, competing recording-start flow. The real flow-active latch
      // further below hasn't run yet at this point, so reset this on every
      // early return in this block.
      recordingFlowGateRef.current = true;
      try {
        const granted = await invoke<boolean>(
          "request_macos_screen_recording_access",
        );
        if (!granted) {
          recordingFlowGateRef.current = false;
          setReadinessOpen(true);
          setRecError(MACOS_SCREEN_PERMISSION_MESSAGE);
          openPrivacySettings("screen");
          return null;
        }
      } catch (err) {
        recordingFlowGateRef.current = false;
        setReadinessOpen(true);
        setRecError(err instanceof Error ? err.message : String(err));
        return null;
      }
      // A restart hands off the already-live display stream from the take
      // it's replacing (see `discardForRestart`/`preAcquiredDisplayStream`
      // below) — it must keep recording the same screen, not re-prompt.
      if (source === "full-screen" && !options?.resumeCapture) {
        try {
          // Must resolve before `recordingFlowActive` flips the toolbar on
          // below — the toolbar reads the pick to place itself on the
          // chosen screen the first time it's shown.
          await pickFullscreenRecordingDisplay();
        } catch (err) {
          recordingFlowGateRef.current = false;
          if (err instanceof Error && err.name === "AbortError") {
            // User cancelled the screen picker (Escape) — abort silently,
            // same as dismissing the native macOS screen picker.
            return null;
          }
          // A real failure (picker window construction, persisting the
          // pick, etc.) — surface it instead of silently aborting like a
          // cancel, or the user has no idea why nothing happened.
          setRecError(err instanceof Error ? err.message : String(err));
          return null;
        }
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
    const startController = new AbortController();
    recordingStartAbortRef.current = startController;
    let parkPopoverTimer: number | null = null;
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
        voiceCleanupEnabled,
        localRecordingMode,
        preAcquiredCameraStream,
        preAcquiredDisplayStream: options?.resumeCapture?.displayStream ?? null,
        preAcquiredAudioStream: options?.resumeCapture?.audioStream ?? null,
        signal: startController.signal,
      });
      // macOS: give WebKit a short window to dispatch getDisplayMedia before
      // parking the popover. Parking synchronously can leave the picker
      // request pending in a long-lived tray webview.
      //
      // Windows: do NOT park before getDisplayMedia resolves. On Windows,
      // the WebView2 screen picker UI renders within the popover webview —
      // shrinking the window to 2×2 makes the picker invisible and the
      // user can never select a screen. The recorder.ts code parks the
      // popover itself (line ~2165) AFTER the streams are acquired, which
      // is the correct time on Windows.
      if (isMacPlatform()) {
        parkPopoverTimer = window.setTimeout(() => {
          if (!startController.signal.aborted && recordingFlowGateRef.current) {
            invoke("park_popover_offscreen").catch(() => {});
            emit("clips:popover-visible", false).catch(() => {});
          }
        }, 250);
      }
      handle = await recordingPromise;
      console.log("[clips-popover] recorder handle received");
    } catch (err) {
      startError = err;
    } finally {
      if (parkPopoverTimer !== null) {
        window.clearTimeout(parkPopoverTimer);
        parkPopoverTimer = null;
      }
      if (recordingStartAbortRef.current === startController) {
        recordingStartAbortRef.current = null;
      }
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
        // Bounded, not just best-effort: a plain unbounded await here would
        // let a stuck native command (e.g. a ScreenCaptureKit handshake that
        // never returns) turn this "always recovers" block into another
        // permanent hang on top of the one that just failed — exactly the
        // "stuck on Preparing…, have to restart" symptom this exists to
        // prevent.
        await boundedCleanup(invoke("set_recording_state", { active: false }));
        await boundedCleanup(invoke("show_popover"));
      }
    }

    if (handle) {
      setRecorder(handle);
      return handle;
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
      return null;
    }
    if (
      errName === "NotAllowedError" &&
      !isHardCapturePermissionError(message)
    ) {
      return null;
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
      return null;
    }
    if (isStorageSetupFailureMessage(message)) {
      setRecError(STORAGE_SETUP_HELP_TEXT);
      openVideoStorageSetup();
      return null;
    }
    setRecError(message);
    return null;
  }

  // The restart listener lives in an effect keyed on `recorder`; calling the
  // start flow through this ref keeps that dependency list from having to
  // include a function that is recreated every render.
  handleStartRecordingRef.current = handleStartRecording;

  // The toolbar exists before a recorder handle does. Keep its Cancel action
  // useful during capture setup, when the normal recorder event listener has
  // not been installed yet.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    listen("clips:recorder-cancel", () => {
      recordingStartAbortRef.current?.abort();
    })
      .then((nextUnlisten) => {
        if (cancelled) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Gates every start-recording gesture (button, global shortcut, permission
  // retry) on the mic toggle. When the mic is off we hold the actual
  // getDisplayMedia/getUserMedia call until the user confirms in
  // micOffConfirmOpen — the confirm button's own click supplies the user
  // activation handleStartRecording needs, same as the direct gesture would.
  function beginRecording(
    options?: Parameters<typeof handleStartRecording>[0],
    beginOptions?: { revealPopoverIfMicOff?: boolean },
  ) {
    if (!micOn) {
      pendingStartOptionsRef.current = options;
      if (beginOptions?.revealPopoverIfMicOff) {
        invoke("show_popover").catch(() => {});
      }
      setMicOffConfirmOpen(true);
      return;
    }
    void handleStartRecording(options);
  }

  function closeMicOffConfirmation() {
    pendingStartOptionsRef.current = undefined;
    setMicOffConfirmOpen(false);
  }

  function unmuteFromConfirmation() {
    setMicOn(true);
    closeMicOffConfirmation();
  }

  function continueWithoutMic() {
    const options = pendingStartOptionsRef.current;
    closeMicOffConfirmation();
    void handleStartRecording(options);
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

    beginRecording(
      { ignoreActiveRecorder: true },
      { revealPopoverIfMicOff: true },
    );
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
        if (restartInFlightRef.current) return;
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
            // The browser opens `/r/<id>` (the author's dashboard); what lands
            // on the clipboard must be the public `/share/<id>` link, which is
            // the one a recipient can actually open.
            await copyShareLink(stopResult.recordingId);
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
        if (restartInFlightRef.current) return;
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
        if (recordingStopFinalizingRef.current) return;
        // Latched synchronously: a restart is a terminal transition on this
        // recorder, and stop/cancel must not act on it while the replacement
        // is being brought up.
        if (restartInFlightRef.current) return;
        restartInFlightRef.current = true;
        let handoff: RestartHandoff | null = null;
        try {
          handoff = await recorder.discardForRestart();
          if (cancelled) return;
          // The recording flow stays latched across the restart. Releasing
          // `clipsForceAlive` / `recordingFlowGateRef` / `recordingFlowActive`
          // / `set_recording_state` the way cancel does would let the popover's
          // blur auto-hide fire and flicker the pill between the two takes. The
          // camera also stays owned by the popover, so the bubble session epoch
          // is deliberately not bumped and the stream is re-handed unchanged.
          //
          // The discard did close the countdown and toolbar windows. The
          // recorder rebuilds the countdown on every start, but the toolbar is
          // owned by an effect keyed on the flow latches we just kept held — so
          // it has to be told the chrome is gone.
          setRecordingChromeEpoch((epoch) => epoch + 1);
          setRecorder(null);
          const restarted = await handleStartRecordingRef.current({
            ignoreActiveRecorder: true,
            resumeCapture: handoff,
          });
          // The new session owns the handed-off capture only once it exists.
          if (restarted) handoff = null;
        } catch (err) {
          console.error("[clips-popover] restart failed:", err);
          setRecError(err instanceof Error ? err.message : String(err));
        } finally {
          // Anything still held here belongs to a retake that never came up.
          // Leaving it would keep the screen captured with nothing recording.
          if (handoff) stopRestartHandoff(handoff);
          restartInFlightRef.current = false;
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

  const pendingUploadBanner = recordingStopFinalizing ? (
    <FinalizingUploadBanner />
  ) : pendingUploads.length > 0 ? (
    <PendingUploadBanner
      uploads={pendingUploads}
      retryingUploadId={retryingUploadId}
      retryingUploadStatus={retryingUploadStatus}
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
                    : "Couldn't send this Clip"}
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
              <strong>Only this range becomes a private Clip.</strong> The
              rolling Rewind archive stays on this device.
              {agentHandoff.agentClipRetention === "forever"
                ? " This Clip will be kept in your Library."
                : ` It follows your ${agentHandoff.agentClipRetention.replace("-", " ")} retention setting.`}
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
                  <span>System audio</span>
                  <Switch
                    on={agentHandoff.includeSystemAudio}
                    onChange={(includeSystemAudio) =>
                      setAgentHandoff({ ...agentHandoff, includeSystemAudio })
                    }
                    label="Include system audio"
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
                Send to agent
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
              Making a private Clip of this range and preparing transcript and
              frame access for your agent…
            </p>
          ) : agentHandoff.status === "ready" ? (
            <>
              <p className="setup-hint" role="status">
                Your agent received a temporary link. The private Clip stays in
                your Library under your retention setting.
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
                {agentHandoff.error || "This Clip couldn't be sent. Try again."}
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

  if (popoverView === "memory") {
    return (
      <div className="app app-settings" ref={appRef}>
        {pendingUploadBanner}
        {isRecording ? <ActiveRecordingBanner /> : null}
        <Setup
          surface="memory"
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
          rewindAgentPromptCopied={rewindAgentPromptCopied}
          onCopyRewindAgentPrompt={copyRewindAgentPrompt}
          onOpenRewindDocs={openRewindDocs}
          onCancel={() => openSettings("rewind")}
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
          initialSettingsTab={initialSettingsTab}
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
          rewindAgentPromptCopied={rewindAgentPromptCopied}
          onCopyRewindAgentPrompt={copyRewindAgentPrompt}
          onOpenRewindDocs={openRewindDocs}
          onOpenMemory={() => setPopoverView("memory")}
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
          onOpenSettings={() => openSettings()}
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
          onOpenSettings={() => openSettings("dictation")}
        />
      </div>
    );
  }

  // The session check has not answered yet. "unknown" must not fall through
  // to the recorder: that shows a signed-out user the full recording UI for
  // as long as /auth/session takes — indefinitely, if it hangs. Render the
  // popover's shape instead until the check resolves either way.
  if (authStatus === "unknown") {
    return (
      <div className="app" ref={appRef}>
        <div
          className="header header-centered"
          onMouseDown={handlePopoverHeaderMouseDown}
        >
          <button
            className="icon-button header-close"
            onClick={hidePopover}
            aria-label="Close"
            title="Close"
          >
            <CloseIcon />
          </button>
        </div>
        <div data-tw-surface className="grid gap-2.5 px-4 pb-4 pt-1">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="mt-2 h-12 w-full rounded-full" />
        </div>
      </div>
    );
  }

  // When unauthenticated, render the sign-in form INLINE in the popover
  // (not a separate Tauri window). This avoids Tauri 2's separate-WebKit-
  // data-store-per-WebviewWindow cookie-jar issue — the cookie is set in
  // the same webview that reads it on the next /auth/session poll.
  // Google verification uses a popup in the bound WebView, while magic-link
  // verification uses the system browser and password stays inline here.
  if (authStatus === "anon") {
    return (
      <div className="app" ref={appRef}>
        {/* Signed out, the only job on this screen is signing in. Capture
            modes, Feedback, and Settings all act on an account that does not
            exist yet, so they appear after auth rather than competing with it.
            Only the window's own close control stays. */}
        <div
          className="header header-centered"
          onMouseDown={handlePopoverHeaderMouseDown}
        >
          <button
            className="icon-button header-close"
            onClick={hidePopover}
            aria-label="Close"
            title="Close"
          >
            <CloseIcon />
          </button>
        </div>
        {pendingUploadBanner}
        {signInPending === "google" ? (
          /* `data-tw-surface` marks only this subtree: the sign-in form beside
             it is still hand-written CSS that the scoped preflight would
             strip. */
          <div data-tw-surface>
            <Empty className="w-full border-none">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Spinner />
                </EmptyMedia>
                <EmptyTitle>Sign in from your browser</EmptyTitle>
                <EmptyDescription>
                  We opened a tab for {serverHostForSignIn}. Approve access
                  there and Clips picks it up from here.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-md px-3 text-sm"
                  onClick={cancelSignIn}
                >
                  Cancel
                </Button>
              </EmptyContent>
            </Empty>
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
              onMagicLink={requestMagicLink}
              magicLinkSentEmail={
                signInPending === "magic-link" ? magicLinkEmail : null
              }
              onMagicLinkBack={cancelSignIn}
            />
            {/* The escape hatches. An unreachable server names itself; a
                reachable-but-WRONG server (packaged default when the user
                wants self-hosted, dev build on the wrong port) answers 401
                forever, and without this link the only way into Settings ›
                Advanced is signing in to a server the user never wanted. */}
            <div className="footer">
              <span>
                {serverReachable
                  ? serverHostForSignIn
                  : `Can’t reach ${serverHostForSignIn}`}
              </span>
              <a
                className="footer-link"
                onClick={() => openSettings("advanced")}
              >
                Change server
              </a>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="app app-recorder" ref={appRef}>
      {micOffConfirmOpen ? (
        <MicOffConfirmation
          onBack={closeMicOffConfirmation}
          onUnmute={unmuteFromConfirmation}
          onContinue={continueWithoutMic}
        />
      ) : null}

      <div
        className="recorder-home-content"
        hidden={micOffConfirmOpen}
        aria-hidden={micOffConfirmOpen}
      >
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

        {shareLinkNotice ? (
          <ShareLinkBanner
            notice={shareLinkNotice}
            onCopy={() => {
              void copyShareLink(
                shareLinkNotice.recordingId,
                shareLinkNotice.origin,
                { notify: false },
              );
            }}
            onDismiss={() => setShareLinkNotice(null)}
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

        <div className="recorder-disclosures">
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
        </div>

        {!isRecording ? (
          <button
            className="primary start"
            disabled={
              localRecordingMode === "off" && videoStorageStatus === "checking"
            }
            onClick={() => beginRecording()}
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
              onRetry={() => beginRecording()}
            />
          ) : recError === MACOS_SPEECH_PERMISSION_MESSAGE ? (
            <PermissionRecoveryBanner
              kind="speech"
              message={recError}
              panes={["speech", "microphone"]}
              onRetry={() => beginRecording()}
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
          alert={updateReadyToInstall}
          onClick={() => openSettings()}
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
  retryingUploadStatus,
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
  retryingUploadStatus: string | null;
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
              className={`pending-upload-retry${retrying ? " pending-upload-retry-spinning" : ""}`}
              disabled={actionsDisabled}
              onClick={() => onRetry(latest)}
              aria-busy={retrying}
            >
              <IconRefresh size={14} stroke={2} />
              {retrying ? (retryingUploadStatus ?? "Retrying") : "Retry"}
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

function ShareLinkBanner({
  notice,
  onCopy,
  onDismiss,
}: {
  notice: ShareLinkNotice;
  onCopy: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="share-link-banner">
      <div className="local-save-copy">
        <div className="local-save-title">Share link ready</div>
        <div className="local-save-sub">{notice.url}</div>
      </div>
      <button type="button" onClick={onCopy}>
        Copy
      </button>
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
    <div
      className="header header-centered"
      onMouseDown={handlePopoverHeaderMouseDown}
    >
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
  onMagicLink,
  magicLinkSentEmail,
  onMagicLinkBack,
}: {
  serverUrl: string;
  onSignedIn: () => Promise<void> | void;
  onUseBrowser: () => void | Promise<void>;
  onMagicLink: (email: string) => Promise<void>;
  magicLinkSentEmail: string | null;
  onMagicLinkBack: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"magic-link" | "password">(
    "magic-link",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
  }>({});
  useEffect(() => {
    if (!magicLinkSentEmail) emailRef.current?.focus();
  }, [magicLinkSentEmail]);

  /**
   * The framework exposes a first-class local-dev sign-in that creates or
   * reuses an auto-managed dev account. Whether to offer it is the server's
   * call, not ours: it answers `available: true` only in development with no
   * other users, so there is no env sniffing or invented affordance here.
   */
  const [devSignInAvailable, setDevSignInAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch(`${serverUrl.replace(/\/+$/, "")}/_agent-native/auth/local-dev`, {
      credentials: "include",
    })
      .then(async (res) => {
        const raw = res.ok ? await res.text() : "";
        let available: boolean | null = null;
        let parseError: string | null = null;
        if (raw) {
          try {
            available =
              (JSON.parse(raw) as { available?: boolean }).available === true;
          } catch (err) {
            // coercion-ok: recorded and logged below as its own outcome, so an
            // unreadable body never passes for "not available".
            parseError = err instanceof Error ? err.message : String(err);
          }
        }
        if (cancelled) return;
        setDevSignInAvailable(available === true);
        // Hidden-because-unavailable, hidden-because-unreadable, and
        // hidden-because-the-probe-broke look identical on screen. Say which.
        console.info("[clips-tray] local-dev sign-in probe", {
          server: serverUrl,
          status: res.status,
          available,
          parseError,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setDevSignInAvailable(false);
        console.warn("[clips-tray] local-dev sign-in probe failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [serverUrl]);

  async function signInAsLocalDev() {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(
        `${serverUrl.replace(/\/+$/, "")}/_agent-native/auth/local-dev`,
        { method: "POST", credentials: "include" },
      );
      const raw = await res.text();
      let json: { error?: string; token?: string } | null = null;
      try {
        json = raw
          ? (JSON.parse(raw) as { error?: string; token?: string })
          : null;
      } catch {
        // coercion-ok: the unparsed body is still reported in the error below,
        // so a non-JSON response surfaces instead of reading as an empty one.
      }
      if (!res.ok) {
        throw new Error(
          json?.error ||
            raw.slice(0, 200) ||
            `Dev sign-in didn't work (${res.status})`,
        );
      }
      // A missing token is legitimate: the server only puts it in the body for
      // desktop-marked requests, and the session cookie covers the rest.
      // `onSignedIn` re-checks the session either way.
      if (json?.token) saveDesktopAuthToken(serverUrl, json.token);
      await onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    // Native constraint validation is off (noValidate): the UA bubble is
    // unstyleable and vanishes on blur. Field errors render inline instead,
    // in the "Enter a [noun]" shape.
    const trimmedEmail = email.trim();
    const nextFieldErrors: { email?: string; password?: string } = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      nextFieldErrors.email = "Enter an email like you@example.com";
    }
    if (authMode === "password" && !password) {
      nextFieldErrors.password = "Enter a password";
    }
    setFieldErrors(nextFieldErrors);
    if (nextFieldErrors.email || nextFieldErrors.password) {
      (nextFieldErrors.email ? emailRef : passwordRef).current?.focus();
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      if (authMode === "magic-link") {
        await onMagicLink(email.trim());
        return;
      }
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
        throw new Error(
          json?.error || "Couldn't sign you in. Check your email and password.",
        );
      }
      if (json?.token) saveDesktopAuthToken(serverUrl, json.token);
      await onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (magicLinkSentEmail) {
    return (
      <div className="signin signin-success" aria-live="polite">
        <div className="signin-title">Check your email</div>
        <p className="signin-success-copy">
          {"We sent a sign-in link to "}
          <strong>{magicLinkSentEmail}</strong>
          {"."}
        </p>
        <button
          type="button"
          className="signin-alt signin-mode-link"
          onClick={onMagicLinkBack}
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <form className="signin" onSubmit={onSubmit} noValidate>
      <PillLogo className="signin-mark" />
      <div className="signin-title">Welcome to Clips</div>
      <div className="signin-subtitle">
        Record your screen, camera, and mic. Share a link the moment you stop.
      </div>
      <button
        type="button"
        className="signin-google"
        onClick={onUseBrowser}
        title="Comes back to Clips to finish sign-in"
      >
        <GoogleIcon />
        Sign in with Google
      </button>
      <div className="signin-divider">
        <span>or</span>
      </div>
      <div data-tw-surface className="grid w-full gap-2">
        <Input
          ref={emailRef}
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          className="h-9 text-sm"
          value={email}
          aria-invalid={fieldErrors.email ? true : undefined}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
            setFieldErrors((current) => ({ ...current, email: undefined }));
          }}
        />
        {fieldErrors.email ? (
          <p className="text-xs text-destructive">{fieldErrors.email}</p>
        ) : null}
        {authMode === "password" ? (
          <>
            <Input
              ref={passwordRef}
              type="password"
              autoComplete="current-password"
              placeholder="Password"
              className="h-9 text-sm"
              value={password}
              aria-invalid={fieldErrors.password ? true : undefined}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
                setFieldErrors((current) => ({
                  ...current,
                  password: undefined,
                }));
              }}
            />
            {fieldErrors.password ? (
              <p className="text-xs text-destructive">{fieldErrors.password}</p>
            ) : null}
          </>
        ) : null}
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      <button
        type="submit"
        className="primary start"
        disabled={
          submitting || !email || (authMode === "password" && !password)
        }
      >
        {submitting
          ? authMode === "magic-link"
            ? "Sending…"
            : "Signing in…"
          : authMode === "magic-link"
            ? "Continue"
            : "Sign in"}
      </button>
      <button
        type="button"
        className="signin-alt signin-mode-link"
        onClick={() => {
          setError(null);
          setAuthMode((current) =>
            current === "magic-link" ? "password" : "magic-link",
          );
        }}
      >
        {authMode === "magic-link"
          ? "Use a password instead"
          : "Use a sign-in link instead"}
      </button>
      {devSignInAvailable ? (
        <button
          type="button"
          className="signin-alt signin-mode-link"
          onClick={signInAsLocalDev}
          disabled={submitting}
        >
          Continue as the dev account
        </button>
      ) : null}
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
    <div
      className="setup-header popover-view-header"
      onMouseDown={handlePopoverHeaderMouseDown}
    >
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
  alert = false,
  onClick,
}: {
  icon: "library" | "settings" | "meetings" | "dictation";
  label: string;
  badge?: string;
  alert?: boolean;
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
        {alert && !badge ? (
          <span className="bottom-dot" role="img" aria-label="Update ready" />
        ) : null}
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

function Setup({
  surface = "settings",
  initialSettingsTab,
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
  rewindAgentPromptCopied,
  onCopyRewindAgentPrompt,
  onOpenRewindDocs,
  onOpenMemory,
  onCancel,
  onSignOut,
}: {
  surface?: "settings" | "memory";
  initialSettingsTab?: SettingsTabId;
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
  rewindAgentPromptCopied: boolean;
  onCopyRewindAgentPrompt: () => void;
  onOpenRewindDocs: () => void;
  /** Opens the Rewind manual-search surface. Only the settings instance gets
   *  it — the memory surface itself must not offer a loop back into itself. */
  onOpenMemory?: () => void;
  onCancel?: () => void;
  onSignOut?: () => void;
}) {
  const [url, setUrl] = useState(initial ?? DEFAULT_URL);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>(() =>
    initialDesktopSettingsTab(initialSettingsTab),
  );
  const [serverUrlOpen, setServerUrlOpen] = useState(false);

  useEffect(() => {
    if (surface !== "settings") return;
    setSettingsTab(initialDesktopSettingsTab(initialSettingsTab));
  }, [initialSettingsTab, surface]);

  const featureConfig = useFeatureConfig();
  const updateStatus = useUpdateStatus();
  const voiceEnabled = featureConfig?.voiceEnabled !== false;
  const voiceCleanupEnabled = featureConfig?.voiceCleanupEnabled !== false;
  const meetingsEnabled = featureConfig?.meetingsEnabled !== false;
  const showMeetingWidgetEnabled =
    featureConfig?.showMeetingWidgetEnabled !== false;
  const launchAtLoginEnabled = featureConfig?.launchAtLoginEnabled !== false;
  const autoHidePopoverEnabled = featureConfig?.autoHidePopoverEnabled === true;
  const showInScreenCapture = featureConfig?.showInScreenCapture === true;
  const localRecordingMode = featureConfig?.localRecordingMode ?? "off";
  const observedScreenMemory =
    featureConfig?.screenMemory ?? DEFAULT_SCREEN_MEMORY_CONFIG;
  const [screenMemory, setScreenMemory] = useState(observedScreenMemory);
  const [rewindConsentOpen, setRewindConsentOpen] = useState(false);
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
  const whisper = useWhisperSettings(
    featureConfig,
    voiceProvider,
    onVoiceProviderChange,
    nativeVoiceProvider,
  );
  const {
    catalog: whisperModels,
    status: whisperStatus,
    enabled: whisperModelEnabled,
    modelId: whisperModelId,
    deletableModels,
  } = whisper;
  const [screenMemoryStatus, setScreenMemoryStatus] =
    useState<ScreenMemoryStatus | null>(null);
  const screenMemoryStatusRefreshVersionRef = useRef(0);
  const [screenMemoryMessage, setScreenMemoryMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const [clipDraftsError, setClipDraftsError] = useState<string | null>(null);
  const [screenMemoryBusy, setScreenMemoryBusy] = useState(false);
  const [rewindLocalQuery, setRewindLocalQuery] = useState("");
  const [rewindLocalResult, setRewindLocalResult] =
    useState<RewindLocalAskResult | null>(null);
  const [rewindLocalBusy, setRewindLocalBusy] = useState(false);
  const [rewindLocalError, setRewindLocalError] = useState<string | null>(null);
  const [rewindReplayId, setRewindReplayId] = useState<string | null>(null);
  const [rewindEgressEvents, setRewindEgressEvents] = useState<
    RewindEgressEvent[]
  >([]);
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

  function setVoiceCleanupEnabled(enabled: boolean) {
    if (!featureConfig) return;
    invoke("set_feature_config", {
      config: { ...featureConfig, voiceCleanupEnabled: enabled },
    }).catch((err) =>
      console.error("[settings] set_feature_config failed", err),
    );
  }

  // Deliberately does NOT write showMeetingWidgetEnabled: widget-off with
  // notes-on is a stored configuration real users hold, and folding the two
  // into one switch silently re-enabled the widget the next time they touched
  // notes. The widget keeps its own sub-toggle below.
  function setMeetingsEnabled(enabled: boolean) {
    if (!featureConfig) return;
    invoke("set_feature_config", {
      config: { ...featureConfig, meetingsEnabled: enabled },
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
    const previous = screenMemoryRef.current;
    // Optimistic UI only — the persisted payload is built inside the queued
    // callback from the on-disk config plus THIS call's patch, so a failed
    // earlier mutation's values can never ride along in a later write.
    const optimistic = {
      ...DEFAULT_SCREEN_MEMORY_CONFIG,
      ...previous,
      ...patch,
    };
    const version = ++screenMemoryMutationVersionRef.current;
    screenMemoryMutationRef.current += 1;
    screenMemoryRef.current = optimistic;
    setScreenMemory(optimistic);
    setScreenMemoryConfigBusy(true);
    let operation!: Promise<void>;
    operation = screenMemoryMutationTailRef.current
      .catch(() => {})
      .then(async () => {
        // Read the latest complete config at execution time so a queued Rewind
        // edit cannot overwrite an unrelated setting changed while it waited —
        // and cannot re-apply a predecessor's failed patch.
        const current = await invoke<FeatureConfig>("get_feature_config");
        const next = {
          ...DEFAULT_SCREEN_MEMORY_CONFIG,
          ...current.screenMemory,
          ...patch,
        };
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
        // When the read-back fails too, roll back to the pre-mutation value —
        // keeping the optimistic `next` would leave the switch claiming a
        // state the backend never entered, with only an error line to hint
        // that the two disagree.
        const restored = committed ? committed.screenMemory : previous;
        screenMemoryRef.current = restored;
        setScreenMemory(restored);
      }
      setScreenMemoryMessage({
        kind: "error",
        text: (err as Error)?.message ?? "Couldn't update Rewind. Try again.",
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
        text: `${client === "codex" ? "Codex" : "Claude Code"} is connected. Restart it once to load Rewind.`,
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

  const refreshScreenMemoryStatus = useCallback(() => {
    const version = ++screenMemoryStatusRefreshVersionRef.current;
    invoke<ScreenMemoryStatus>("screen_memory_status")
      .then((status) => {
        if (version === screenMemoryStatusRefreshVersionRef.current) {
          setScreenMemoryStatus(status);
        }
      })
      .catch(() => {});
  }, []);

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
        (err as Error)?.message ??
          "Couldn't search this device's memory. Try again.",
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
        (err as Error)?.message ??
          "Couldn't replay this moment. Try another result.",
      );
    } finally {
      setRewindReplayId(null);
    }
  }

  async function exportScreenMemoryRecent() {
    setScreenMemoryBusy(true);
    setScreenMemoryMessage(null);
    try {
      const result = await invoke<ScreenMemoryExportResult>(
        "screen_memory_export_recent",
        { minutes: 5 },
      );
      setScreenMemoryMessage({
        kind: "ok",
        text: `Saved ${result.files.length === 1 ? "a video" : `${result.files.length} videos`} to ${result.folderPath}`,
      });
    } catch (err) {
      setScreenMemoryMessage({
        kind: "error",
        text:
          (err as Error)?.message ??
          "Couldn't save the last 5 minutes. Try again.",
      });
    } finally {
      setScreenMemoryBusy(false);
      refreshScreenMemoryStatus();
    }
  }

  function refreshRewindEgressLog() {
    invoke<RewindEgressEvent[]>("rewind_list_evidence_egress", { limit: 20 })
      .then(setRewindEgressEvents)
      .catch((err) => {
        setScreenMemoryMessage({
          kind: "error",
          text:
            (err as Error)?.message ??
            "Couldn't read the access log. Try again.",
        });
      });
  }

  async function clearScreenMemory() {
    setScreenMemoryBusy(true);
    setScreenMemoryMessage(null);
    try {
      const status = await invoke<ScreenMemoryStatus>(
        "screen_memory_delete_all",
      );
      screenMemoryStatusRefreshVersionRef.current += 1;
      setScreenMemoryStatus(status);
      setScreenMemoryMessage({ kind: "ok", text: "Rewind cleared" });
    } catch (err) {
      setScreenMemoryMessage({
        kind: "error",
        text: (err as Error)?.message ?? "Couldn't clear Rewind. Try again.",
      });
    } finally {
      setScreenMemoryBusy(false);
    }
  }

  function openScreenMemoryFolder() {
    invoke("screen_memory_open_folder").catch((err) => {
      setScreenMemoryMessage({
        kind: "error",
        text: (err as Error)?.message ?? "Couldn't open the Rewind folder.",
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
        text:
          (err as Error)?.message ?? "Couldn't open the app picker. Try again.",
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
        (err as Error)?.message ?? "Couldn't open the drafts folder.",
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

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (!cancelled) refreshScreenMemoryStatus();
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
      screenMemoryStatusRefreshVersionRef.current += 1;
      window.clearInterval(timer);
      unlistens.forEach((u) => {
        try {
          u();
        } catch {
          /* ignore */
        }
      });
    };
  }, [refreshScreenMemoryStatus]);

  // The agent-activity log loads when the Rewind tab is actually in front —
  // it is an audit read, not something to poll from every settings view.
  useEffect(() => {
    if (surface !== "settings" || settingsTab !== "rewind") return;
    if (screenMemory.enabled !== true) return;
    refreshRewindEgressLog();
  }, [surface, settingsTab, screenMemory.enabled]);

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

  const [serverUrlError, setServerUrlError] = useState<string | null>(null);

  function handleConnect() {
    const trimmed = url.trim();
    // Anything that parses as http(s) is allowed — reachability is the
    // sign-in screen's job — but junk must not be persisted as the server
    // URL, where it silently fails every request.
    let parsed: URL | null = null;
    try {
      parsed = new URL(trimmed);
    } catch {
      // coercion-ok: null is the typed "not a URL" outcome the next branch
      // reports to the user as an inline field error.
      parsed = null;
    }
    if (
      !parsed ||
      (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    ) {
      setServerUrlError("Enter a URL like http://localhost:8080");
      return;
    }
    setServerUrlError(null);
    onConnect(trimmed);
  }

  const selectedMode = voiceProviderMode(voiceProvider);
  const byokProvider: ByokVoiceProvider = isByokVoiceProvider(voiceProvider)
    ? voiceProvider
    : "gemini";
  const fnShortcutSelected = voiceShortcut === "fn" || voiceShortcut === "both";
  const canOpenPrivacySettings = isMacPlatform() || isWindowsPlatform();
  const systemAccessRows = useSystemAccessRows({
    includeVoicePaste: voiceEnabled,
    includeFnMonitoring: fnShortcutSelected,
    onOpenSettings: openPrivacySettings,
  });
  const serverHostLabel = (serverUrl ?? initial ?? DEFAULT_URL)
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");

  function selectProviderMode(mode: VoiceProviderMode) {
    setApiKeyMessage(null);
    if (mode === "native") {
      onVoiceProviderChange(nativeVoiceProvider());
    } else if (mode === "whisper") {
      onVoiceProviderChange("whisper");
      if (!whisperModelEnabled) whisper.setEnabled(true);
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
        throw new Error(
          body?.error || `Couldn't save the key (${res.status}). Try again.`,
        );
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
        text: `${labelForByokProvider(byokProvider)} key saved`,
      });
    } catch (err) {
      setApiKeyMessage({
        kind: "error",
        text: (err as Error)?.message ?? "Couldn't save the key. Try again.",
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
        text: (err as Error)?.message ?? "Couldn't open Builder.io. Try again.",
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
        : "Cleanup is off until Builder.io is connected.";
    }
    if (providerStatus[byokProvider]) return null;
    return `Cleanup is off until you add ${keyForByokProvider(byokProvider)}.`;
  })();
  const updateChecksSupported = canCheckForUpdates();
  const updateBusy =
    updateStatus.state === "checking" ||
    updateStatus.state === "available" ||
    updateStatus.state === "downloading";
  const updateReady = updateStatus.state === "downloaded";
  const updateRowLabel = !updateChecksSupported
    ? `Version ${__CLIPS_DESKTOP_VERSION__ || "0.0.0"}`
    : updateStatus.state === "downloaded"
      ? `Version ${updateStatus.version} ready`
      : updateStatus.state === "downloading"
        ? `Downloading ${updateStatus.version} · ${updateStatus.percent}%`
        : updateStatus.state === "available"
          ? `Version ${updateStatus.version} found`
          : updateStatus.state === "checking"
            ? "Checking for updates"
            : updateStatus.state === "error"
              ? "Couldn't check for updates"
              : `Version ${__CLIPS_DESKTOP_VERSION__ || "0.0.0"}`;
  // Dev/unsigned builds get the bare version — no subtitle, no control. The
  // updater states below are unreachable there, and real users never see this
  // branch.
  const updateRowDescription = !updateChecksSupported
    ? undefined
    : updateStatus.state === "downloaded"
      ? "Restart when you like. Nothing in progress is lost."
      : updateStatus.state === "downloading" ||
          updateStatus.state === "available"
        ? "Downloading in the background, so keep recording"
        : updateStatus.state === "error"
          ? "Clips retries after launch and every hour"
          : "Checks after launch, every hour, and when you come back";

  function checkForDesktopUpdate() {
    retryUpdateCheck().catch((err) => {
      console.error("[clips-updater] manual check failed:", err);
    });
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
          <h2>Search memory</h2>
        </div>
        {screenMemory.enabled ? (
          <>
            <p className="rewind-surface-lede">
              Search what Rewind remembers on this device. For everyday recall,
              ask your connected agent.
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
                  Every result comes from what's stored on this device and links
                  back to a replay.
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="popover-empty-card rewind-memory-empty">
            <IconHistory size={20} stroke={1.7} />
            <strong>Rewind is off</strong>
            <p>Turn on Rewind to start keeping moments you can search.</p>
            {/* The consent dialog renders only on the settings surface, so
                the switch (and its consent) live there — this button walks
                the user to it rather than toggling a dialog that cannot
                mount here. */}
            <button type="button" className="secondary" onClick={onCancel}>
              Open Rewind settings
            </button>
          </div>
        )}
      </div>
    );
  }

  function renderGeneralSettings() {
    return (
      <div className="mx-auto grid w-full max-w-[620px] gap-7 pb-4">
        <SettingsGroup label="App">
          <SettingsRow
            label="Open at login"
            description="Open Clips automatically on login"
            control={
              <SettingsSwitch
                checked={launchAtLoginEnabled}
                onCheckedChange={setLaunchAtLoginEnabled}
                label="Open at login"
              />
            }
          />
          <SettingsRow
            label="Hide when inactive"
            description="Close the Clips window when switching to another application"
            control={
              <SettingsSwitch
                checked={autoHidePopoverEnabled}
                onCheckedChange={setAutoHidePopoverEnabled}
                label="Hide when inactive"
              />
            }
          />
        </SettingsGroup>

        <SettingsGroup label="System access">
          {systemAccessRows.map((row) => (
            <SettingsRow
              key={row.key}
              label={row.label}
              description={row.description}
              control={
                row.granted === true ? (
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <IconCircleCheck
                      className="size-4"
                      stroke={1.8}
                      aria-hidden="true"
                    />
                    Granted
                  </span>
                ) : canOpenPrivacySettings ? (
                  <SettingsActionButton onClick={row.onGrant}>
                    {row.granted === false ? "Grant" : "Open settings"}
                  </SettingsActionButton>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    System prompt
                  </span>
                )
              }
            />
          ))}
        </SettingsGroup>

        <SettingsGroup label="Updates">
          <SettingsRow
            label={updateRowLabel}
            description={updateRowDescription}
            control={renderUpdateControl()}
          >
            {updateStatus.state === "error" ? (
              <p className="text-xs text-destructive">{updateStatus.message}</p>
            ) : null}
          </SettingsRow>
        </SettingsGroup>
      </div>
    );
  }

  function renderUpdateControl() {
    if (!updateChecksSupported) {
      return null;
    }
    if (updateReady) {
      return (
        <SettingsActionButton
          emphasis="primary"
          onClick={() => {
            installAndRestart().catch((err) => {
              console.error("[clips-updater] relaunch failed:", err);
            });
          }}
        >
          Restart to install
        </SettingsActionButton>
      );
    }
    if (updateBusy) {
      return (
        <IconRefresh
          size={15}
          stroke={1.9}
          className="update-spinner text-muted-foreground"
          aria-hidden="true"
        />
      );
    }
    return (
      <SettingsActionButton onClick={checkForDesktopUpdate}>
        Check now
      </SettingsActionButton>
    );
  }

  function renderRecordingSettings() {
    return (
      <div className="mx-auto grid w-full max-w-[620px] gap-7 pb-4">
        <SettingsGroup>
          <SettingsRow
            label="Voice cleanup"
            description="Reduces background noise and echo from your microphone"
            control={
              <SettingsSwitch
                checked={voiceCleanupEnabled}
                onCheckedChange={setVoiceCleanupEnabled}
                disabled={captureControlsLocked}
                label="Voice cleanup"
              />
            }
          />
          <SettingsRow
            label="Start/stop shortcut"
            description="Start and stop a recording from any app"
            control={
              <ShortcutRecorder
                value={recordCustomShortcut}
                placeholder="Set"
                onChange={onRecordCustomShortcutChange}
              />
            }
          />
          <SettingsRow
            label="Save to"
            description="Uploads recordings to your cloud library, or saves locally on device"
            control={
              <SettingsSelect
                ariaLabel="Save recordings to"
                value={localRecordingMode}
                onValueChange={(value) =>
                  setLocalRecordingMode(value as LocalRecordingMode)
                }
                options={[
                  { value: "off", label: "Cloud Clips" },
                  { value: "composed", label: "This device, one video" },
                  { value: "separate", label: "This device, screen + camera" },
                ]}
              />
            }
          />
        </SettingsGroup>
      </div>
    );
  }

  /**
   * Rewind's settings, flat. Every one of these used to live behind a Manage
   * button inside a popover launched from another popover — three layers deep,
   * with tooltips escaping behind the window. They are ordinary rows now, in
   * the order a user reasons about them: does it run, what does it keep, who
   * may see it, where does it live.
   */
  function renderRewindSettings() {
    const rewindOn = screenMemory.enabled === true;
    return (
      <div className="mx-auto grid w-full max-w-[620px] gap-7 pb-4">
        <SettingsGroup>
          {/* A confirmation, so a dialog rather than a takeover: the user is
              answering one question about the screen behind it, not moving to
              a new place. What it remembers is chosen afterwards, in the row
              below — asking before they have agreed puts the options in front
              of the decision.

              The copy names what is captured and what can leave, and nothing
              else. Two claims are tempting and both are false: this buffer
              holds screen *video* (hence the GB disk limit below), not app
              and window notes; and it cannot promise "never leaves this Mac"
              because the agent-handoff path uploads an approved range. A
              consent screen is the one place a comforting simplification is
              indistinguishable from a lie. */}
          <UiAlertDialog
            open={rewindConsentOpen}
            onOpenChange={setRewindConsentOpen}
          >
            <UiAlertDialogContent className="max-w-md">
              <UiAlertDialogHeader>
                <UiAlertDialogTitle>Turn on Rewind?</UiAlertDialogTitle>
                <UiAlertDialogDescription>
                  Clips will continuously record your screen and keep it on this
                  device. Agents get text excerpts, and video is shared only
                  when you approve it.
                </UiAlertDialogDescription>
              </UiAlertDialogHeader>
              <UiAlertDialogFooter>
                <UiAlertDialogCancel>Not now</UiAlertDialogCancel>
                <UiAlertDialogAction
                  /* Also disabled until featureConfig loads:
                     setScreenMemoryConfig no-ops without it, and the finally
                     below would close the dialog with nothing written and
                     nothing said. */
                  disabled={screenMemoryConfigBusy || !featureConfig}
                  onClick={(event) => {
                    // Radix closes on click by default, which would unmount
                    // the busy label before the invoke even starts. Hold the
                    // dialog open until the write settles either way — the
                    // result (switch state, error line) renders in the row
                    // behind it. Deliberately no captureMode here: re-enabling
                    // must not reset a stored "Screen + audio" choice.
                    event.preventDefault();
                    void setScreenMemoryConfig({
                      enabled: true,
                      paused: false,
                    }).finally(() => setRewindConsentOpen(false));
                  }}
                >
                  {screenMemoryConfigBusy ? "Turning on…" : "Turn on Rewind"}
                </UiAlertDialogAction>
              </UiAlertDialogFooter>
            </UiAlertDialogContent>
          </UiAlertDialog>
          <SettingsRow
            label="Rewind"
            description="Keeps a rolling record of your recent screen on this device"
            control={
              <SettingsSwitch
                checked={rewindOn}
                onCheckedChange={(next) => {
                  // Turning it on starts continuously capturing the screen, so
                  // it routes through consent rather than flipping silently.
                  // Turning it off needs no confirmation — stopping is safe.
                  if (next) {
                    setRewindConsentOpen(true);
                    return;
                  }
                  void setScreenMemoryConfig({ enabled: false });
                }}
                /* Rust rejects Rewind capture changes mid-Clip
                   (config.rs `set_feature_config` guard); disabling here
                   turns that hard error into a visible lock. */
                disabled={screenMemoryConfigBusy || captureControlsLocked}
                label="Rewind"
              />
            }
          >
            {screenMemoryMessage ? (
              <p
                className={
                  screenMemoryMessage.kind === "ok"
                    ? "text-xs text-success"
                    : "text-xs text-destructive"
                }
              >
                {screenMemoryMessage.text}
              </p>
            ) : rewindOn && rewindStatusPresentation.hasError ? (
              <p className="text-xs text-destructive">
                {rewindStatusPresentation.detail}
              </p>
            ) : null}
          </SettingsRow>
          {rewindOn ? (
            <>
              <SettingsRow
                label="Remember"
                description="Choose what Rewind captures"
                control={
                  <SettingsSelect
                    ariaLabel="What Rewind remembers"
                    value={screenMemory.captureMode ?? "visuals"}
                    onValueChange={(value) => {
                      void setScreenMemoryConfig({
                        captureMode: value as RewindCaptureMode,
                      });
                    }}
                    disabled={screenMemoryConfigBusy || captureControlsLocked}
                    options={[
                      { value: "visuals", label: "Screen only" },
                      { value: "visuals-audio", label: "Screen + audio" },
                    ]}
                  />
                }
              />
              <SettingsRow
                label="Time limit"
                description="Choose how long Rewind keeps your screen history"
                control={
                  <SettingsSelect
                    ariaLabel="Rewind time limit"
                    placeholder={`${screenMemory.retentionHours} hours`}
                    value={String(screenMemory.retentionHours)}
                    onValueChange={(value) => {
                      void setScreenMemoryConfig({
                        retentionHours: Number(value),
                      });
                    }}
                    disabled={screenMemoryConfigBusy}
                    options={[
                      { value: "8", label: "8 hours" },
                      { value: "24", label: "24 hours" },
                    ]}
                  />
                }
              />
              <SettingsRow
                label="Storage limit"
                description="Choose how much space Rewind can use on this device"
                control={
                  <SettingsSelect
                    ariaLabel="Rewind storage limit"
                    placeholder={formatStorageBytes(screenMemory.maxBytes)}
                    value={String(screenMemory.maxBytes)}
                    onValueChange={(value) => {
                      void setScreenMemoryConfig({ maxBytes: Number(value) });
                    }}
                    disabled={screenMemoryConfigBusy}
                    options={[
                      { value: String(5 * 1024 * 1024 * 1024), label: "5 GB" },
                      {
                        value: String(20 * 1024 * 1024 * 1024),
                        label: "20 GB",
                      },
                      {
                        value: String(50 * 1024 * 1024 * 1024),
                        label: "50 GB",
                      },
                    ]}
                  />
                }
              />
            </>
          ) : null}
        </SettingsGroup>

        {rewindOn ? (
          <>
            <SettingsGroup label="Privacy">
              <SettingsRow
                label="Excluded apps"
                description={"Apps Rewind never captures"}
                control={
                  <SettingsActionButton
                    onClick={() => void chooseExcludedApplications()}
                    disabled={excludedAppsBusy}
                  >
                    Choose apps
                  </SettingsActionButton>
                }
              >
                {excludedAppGroups.length > 0 ? (
                  <div className="grid gap-1">
                    {excludedAppGroups.map((app) => (
                      <div
                        key={app.bundleIds.join(",")}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="truncate">{app.name}</span>
                        <SettingsActionButton
                          emphasis="quiet"
                          onClick={() =>
                            removeExcludedApplications(app.bundleIds)
                          }
                        >
                          Remove
                        </SettingsActionButton>
                      </div>
                    ))}
                  </div>
                ) : null}
              </SettingsRow>
              <SettingsRow
                label="Review before sending"
                description="Approve each visual or audio range before an agent receives it"
                control={
                  <SettingsSwitch
                    checked={screenMemory.reviewBeforeSending !== false}
                    onCheckedChange={(next) => {
                      void setScreenMemoryConfig({
                        reviewBeforeSending: next,
                      });
                    }}
                    disabled={screenMemoryConfigBusy}
                    label="Review before sending"
                  />
                }
              />
              <SettingsRow
                label="Preview before sending"
                description="Open the range locally so you see exactly what is sent"
                control={
                  <SettingsSwitch
                    checked={screenMemory.autoPreviewBeforeSending === true}
                    onCheckedChange={(next) => {
                      void setScreenMemoryConfig({
                        autoPreviewBeforeSending: next,
                      });
                    }}
                    disabled={screenMemoryConfigBusy}
                    label="Preview before sending"
                  />
                }
              />
              <SettingsRow
                label="Keep agent Clips"
                description="Choose how long Clips made for agents stay in your library"
                control={
                  <SettingsSelect
                    ariaLabel="How long agent-created Clips are kept"
                    value={screenMemory.agentClipRetention}
                    onValueChange={(value) => {
                      void setScreenMemoryConfig({
                        agentClipRetention:
                          value as ScreenMemoryStatus["config"]["agentClipRetention"],
                      });
                    }}
                    disabled={screenMemoryConfigBusy}
                    options={[
                      { value: "forever", label: "Forever" },
                      { value: "24-hours", label: "24 hours" },
                      { value: "7-days", label: "7 days" },
                      { value: "30-days", label: "30 days" },
                    ]}
                  />
                }
              />
              <SettingsRow
                label="Agent activity"
                description="Each time an agent searched this device's memory, newest first"
              >
                {rewindEgressEvents.length === 0 ? (
                  <p>No agent has searched it yet.</p>
                ) : (
                  <div className="grid gap-1">
                    {rewindEgressEvents.slice(0, 10).map((event) => (
                      <div
                        key={`${event.requestId}-${event.state}`}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="truncate">
                          {new Date(event.occurredAt).toLocaleString()}
                        </span>
                        <span className="shrink-0">
                          {event.state} ·{" "}
                          {`${event.evidenceCount} item${event.evidenceCount === 1 ? "" : "s"}`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </SettingsRow>
            </SettingsGroup>

            <SettingsGroup label="Agents">
              <SettingsRow
                label="Setup prompt"
                description="Paste it into an agent once to install Rewind's instructions"
                control={
                  <>
                    <SettingsActionButton
                      emphasis="quiet"
                      onClick={onOpenRewindDocs}
                    >
                      Learn more
                    </SettingsActionButton>
                    <SettingsActionButton onClick={onCopyRewindAgentPrompt}>
                      {rewindAgentPromptCopied ? "Copied" : "Copy"}
                    </SettingsActionButton>
                  </>
                }
              />
              <SettingsRow
                label="Connect an agent"
                description="Gives a local agent access to this device's Rewind memory"
                control={
                  <>
                    <SettingsActionButton
                      onClick={() => void installRewindAgentConnection("codex")}
                      disabled={agentConnectionBusy !== null}
                    >
                      Codex
                    </SettingsActionButton>
                    <SettingsActionButton
                      onClick={() =>
                        void installRewindAgentConnection("claude-code")
                      }
                      disabled={agentConnectionBusy !== null}
                    >
                      Claude Code
                    </SettingsActionButton>
                  </>
                }
              >
                {agentConnectionMessage ? (
                  <p
                    className={
                      agentConnectionMessage.kind === "ok"
                        ? "text-xs text-success"
                        : "text-xs text-destructive"
                    }
                  >
                    {agentConnectionMessage.text}
                  </p>
                ) : null}
              </SettingsRow>
            </SettingsGroup>

            <SettingsGroup label="Storage">
              <SettingsRow
                label="Search memory"
                description="Find and replay a recent moment yourself"
                control={
                  <SettingsActionButton onClick={onOpenMemory}>
                    Search
                  </SettingsActionButton>
                }
              />
              <SettingsRow
                label="Save last 5 minutes"
                description="Exports recent memory as video files on this device. Nothing is uploaded."
                control={
                  <SettingsActionButton
                    onClick={() => void exportScreenMemoryRecent()}
                    disabled={screenMemoryBusy}
                  >
                    Save
                  </SettingsActionButton>
                }
              />
              <SettingsRow
                label="On this device"
                description={`${screenMemorySegments.length} ${screenMemorySegments.length === 1 ? "segment" : "segments"} · ${formatStorageBytes(screenMemoryTotalBytes)}`}
                control={
                  <>
                    <SettingsActionButton onClick={openScreenMemoryFolder}>
                      Open folder
                    </SettingsActionButton>
                    <SettingsActionButton
                      emphasis="destructive"
                      onClick={() => void clearScreenMemory()}
                      disabled={screenMemoryBusy}
                    >
                      Delete all
                    </SettingsActionButton>
                  </>
                }
              />
            </SettingsGroup>
          </>
        ) : null}
      </div>
    );
  }

  function renderAdvancedSettings() {
    return (
      <div className="mx-auto grid w-full max-w-[620px] gap-7 pb-4">
        <SettingsGroup label="Connection">
          <SettingsRow
            label="Clips server URL"
            description="The server Clips signs in and uploads to"
            control={
              <SettingsPopover
                title="Clips server URL"
                open={serverUrlOpen}
                onOpenChange={setServerUrlOpen}
                trigger={<SettingsValueTrigger mono value={serverHostLabel} />}
              >
                <div className="grid gap-1.5">
                  <div className="flex items-center gap-2">
                    <Input
                      id="clips-url"
                      type="url"
                      value={url}
                      aria-invalid={serverUrlError ? true : undefined}
                      onChange={(event) => {
                        setUrl(event.target.value);
                        setServerUrlError(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          handleConnect();
                        }
                      }}
                      placeholder="http://localhost:8080"
                      className="h-8 text-sm"
                    />
                    <SettingsActionButton
                      className="shrink-0"
                      onClick={handleConnect}
                      disabled={!url.trim()}
                    >
                      Connect
                    </SettingsActionButton>
                  </div>
                  {serverUrlError ? (
                    <p className="text-xs text-destructive">{serverUrlError}</p>
                  ) : null}
                </div>
              </SettingsPopover>
            }
          />
        </SettingsGroup>

        <SettingsGroup label="Transcription">
          <SettingsRow
            label="Transcription engine"
            description="Choose what transcribes dictation and meetings"
            control={
              <SettingsSelect
                ariaLabel="Transcription engine"
                value={selectedMode}
                onValueChange={(value) =>
                  selectProviderMode(value as VoiceProviderMode)
                }
                options={[
                  {
                    value: "native",
                    label: isMacPlatform()
                      ? "macOS on-device"
                      : "Browser built-in",
                  },
                  { value: "whisper", label: "Local Whisper" },
                  { value: "builder", label: "Builder.io" },
                  { value: "byok", label: "Your own key" },
                ]}
              />
            }
          >
            {providerWarning ||
            (selectedMode === "builder" && !providerStatus?.builder) ? (
              <>
                {providerWarning ? (
                  <p className="text-xs text-destructive">{providerWarning}</p>
                ) : null}
                {selectedMode === "builder" && !providerStatus?.builder ? (
                  <SettingsActionButton
                    className="w-fit"
                    onClick={connectBuilder}
                  >
                    Use Builder.io
                  </SettingsActionButton>
                ) : null}
              </>
            ) : null}
          </SettingsRow>

          {selectedMode === "byok" ? (
            <>
              <SettingsRow
                label="Key provider"
                description="Choose whose model cleans up dictated text"
                control={
                  <SettingsSelect
                    ariaLabel="Key provider"
                    value={byokProvider}
                    onValueChange={(value) => {
                      setApiKeyMessage(null);
                      onVoiceProviderChange(value as ByokVoiceProvider);
                    }}
                    options={[
                      { value: "gemini", label: "Google Gemini" },
                      { value: "groq", label: "Groq" },
                    ]}
                  />
                }
              />
              <SettingsRow
                label={
                  providerStatus?.[byokProvider]
                    ? `${labelForByokProvider(byokProvider)} key (set)`
                    : `${labelForByokProvider(byokProvider)} key`
                }
                description="Saved to your Clips account"
                stacked
                control={
                  <div className="flex w-full items-center gap-2">
                    <Input
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
                          ? "Paste to rotate"
                          : `Paste ${keyForByokProvider(byokProvider)}`
                      }
                      className="h-8 text-sm"
                    />
                    <SettingsActionButton
                      className="shrink-0"
                      onClick={saveApiKey}
                      disabled={!apiKeyValue.trim() || apiKeySaving}
                    >
                      {apiKeySaving
                        ? "Saving…"
                        : providerStatus?.[byokProvider]
                          ? "Rotate"
                          : "Save"}
                    </SettingsActionButton>
                  </div>
                }
              >
                {apiKeyMessage ? (
                  <p
                    className={
                      apiKeyMessage.kind === "ok"
                        ? "text-xs text-success"
                        : "text-xs text-destructive"
                    }
                  >
                    {apiKeyMessage.text}
                  </p>
                ) : null}
              </SettingsRow>
            </>
          ) : null}

          {selectedMode !== "native" && selectedMode !== "whisper" ? (
            <SettingsRow
              label="Cleanup instructions"
              description="Names, jargon, and casing to keep exactly as you say them"
              stacked
              control={
                <Textarea
                  id="voice-instructions"
                  rows={3}
                  value={voiceInstructions}
                  onChange={(event) =>
                    onVoiceInstructionsChange(event.target.value)
                  }
                  placeholder="Example: keep it casual and preserve technical terms exactly."
                  className="min-h-16 text-sm"
                />
              }
            />
          ) : null}

          <SettingsRow
            label="Local Whisper model"
            description="Transcribes everyone else in a meeting, offline on this device"
            control={
              <SettingsSwitch
                checked={whisperModelEnabled}
                onCheckedChange={whisper.setEnabled}
                label="Local Whisper model"
              />
            }
          >
            {whisperModelEnabled ? null : (
              <WhisperModelStatusRow
                status={whisperStatus}
                enabled={false}
                onDownload={whisper.triggerDownload}
              />
            )}
          </SettingsRow>
          {whisperModelEnabled ? (
            <SettingsRow
              label="Model"
              description="Choose the model used for offline transcription"
              control={
                <SettingsSelect
                  ariaLabel="Whisper model"
                  value={whisperModelId}
                  onValueChange={whisper.setModelId}
                  placeholder={
                    whisperModels.length === 0
                      ? "No models available"
                      : "Choose a model"
                  }
                  options={whisperModels.map((model) => ({
                    value: model.id,
                    label: whisperModelOptionLabel(model),
                  }))}
                  disabled={
                    whisperModels.length === 0 ||
                    whisperStatus?.state === "downloading"
                  }
                />
              }
            >
              {/* `ready` renders nothing (the picker already says which model),
                  so gating on `whisperStatus` alone left an empty children row
                  adding phantom space under the select. Gate on what will
                  actually render. */}
              {(whisperStatus && whisperStatus.state !== "ready") ||
              deletableModels.length > 0 ? (
                <>
                  <WhisperModelStatusRow
                    status={whisperStatus}
                    enabled={whisperModelEnabled}
                    onDownload={whisper.triggerDownload}
                  />
                  {deletableModels.length > 0 ? (
                    <div className="grid gap-1">
                      {deletableModels.map((model) => (
                        <div
                          key={model.id}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="truncate">
                            {model.title} &middot; {model.sizeMb} MB
                          </span>
                          <SettingsActionButton
                            emphasis="quiet"
                            onClick={() => whisper.deleteModel(model.id)}
                          >
                            <IconTrash className="size-3.5" stroke={1.9} />
                            Delete
                          </SettingsActionButton>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
            </SettingsRow>
          ) : null}
        </SettingsGroup>

        <SettingsGroup label="Capture">
          <SettingsRow
            label="Screen region guides"
            description={
              "Outlines to frame a shot that never appear in the Clip"
            }
            control={
              <>
                <SettingsSwitch
                  checked={regionGuides.enabled}
                  onCheckedChange={setRegionGuidesEnabled}
                  label="Show screen region guides while recording"
                />
                <SettingsActionButton onClick={openRegionGuideEditor}>
                  <IconPencil className="size-3.5" stroke={1.9} />
                  Edit
                </SettingsActionButton>
              </>
            }
          >
            {regionGuides.enabled ? (
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="flex-1">
                  Keep guides visible when not recording
                </span>
                <SettingsSwitch
                  checked={regionGuidesAlwaysVisible}
                  onCheckedChange={setRegionGuidesAlwaysVisible}
                  label="Keep region guides on screen even when not recording"
                />
                {regionGuideCount > 0 ? (
                  <SettingsActionButton
                    emphasis="quiet"
                    onClick={clearRegionGuidePreset}
                  >
                    Clear preset
                  </SettingsActionButton>
                ) : null}
              </div>
            ) : null}
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup label="Window">
          <SettingsRow
            label="Show Clips in screen captures"
            description="The Clips window will appear in your recordings"
            control={
              <SettingsSwitch
                checked={showInScreenCapture}
                onCheckedChange={setShowInScreenCapture}
                label="Show Clips in screen captures"
              />
            }
          />
          <SettingsRow
            label="Open Clips shortcut"
            description="Shortcut to open Clips from any app"
            control={
              <ShortcutRecorder
                value={popoverCustomShortcut}
                /* The built-in Cmd/Ctrl+Shift+L binding is always registered
                   (shortcuts.rs), so an empty custom slot shows the shortcut
                   that actually works instead of a blank "Set". Recording a
                   custom chord adds a second binding; clearing it returns to
                   showing the built-in one. */
                placeholder={compactShortcutLabel(
                  isMacPlatform() ? "Cmd+Shift+L" : "Ctrl+Shift+L",
                )}
                onChange={onPopoverCustomShortcutChange}
              />
            }
          >
            {shortcutRegistrationError ? (
              <p className="text-xs text-destructive">
                {shortcutRegistrationError}
              </p>
            ) : null}
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup label="Troubleshooting">
          <SettingsRow
            label="Clip drafts"
            description="Local copies kept when an upload doesn't finish"
            control={
              <SettingsActionButton onClick={openClipDraftsFolder}>
                Open folder
              </SettingsActionButton>
            }
          >
            {clipDraftsError ? (
              <p className="text-xs text-destructive">{clipDraftsError}</p>
            ) : null}
          </SettingsRow>
          <SettingsRow
            label="Diagnostic logs"
            description="Attach these when you report a problem"
            control={
              <SettingsActionButton
                onClick={() => {
                  invoke("open_logs").catch((err) => {
                    console.error("[clips-tray] open logs failed:", err);
                  });
                }}
              >
                Open folder
              </SettingsActionButton>
            }
          />
        </SettingsGroup>

        {signedInAs && onSignOut ? (
          <SettingsGroup label="Account">
            <SettingsRow
              label={`Signed in as ${signedInAs}`}
              description="Recordings from this device land in this library"
              control={
                <SettingsActionButton onClick={onSignOut}>
                  Sign out
                </SettingsActionButton>
              }
            />
          </SettingsGroup>
        ) : null}
      </div>
    );
  }

  function renderMeetingSettings() {
    return (
      <div className="mx-auto grid w-full max-w-[620px] gap-7 pb-4">
        <SettingsGroup>
          <SettingsRow
            label="Meeting notes"
            description="Transcribes and summarizes meetings from your calendar"
            control={
              <SettingsSwitch
                checked={meetingsEnabled}
                onCheckedChange={setMeetingsEnabled}
                label="Meeting notes"
              />
            }
          />
          {meetingsEnabled ? (
            <>
              <SettingsRow
                label="When a meeting starts"
                description="Choose how note taking begins"
                control={
                  <SettingsSelect
                    ariaLabel="When a meeting starts"
                    value={meetingTranscriptionMode}
                    onValueChange={(value) =>
                      setMeetingTranscriptionMode(
                        value as MeetingTranscriptionMode,
                      )
                    }
                    options={[
                      { value: "ask", label: "Ask first" },
                      { value: "auto", label: "Start notes" },
                      { value: "manual", label: "Do nothing" },
                    ]}
                  />
                }
              />
              <SettingsRow
                label="Meeting notifications"
                description="Show a notification before scheduled meetings and when a call is detected"
                control={
                  <SettingsSwitch
                    checked={showMeetingWidgetEnabled}
                    onCheckedChange={setShowMeetingWidgetEnabled}
                    label="Meeting notifications"
                  />
                }
              />
            </>
          ) : null}
        </SettingsGroup>
      </div>
    );
  }

  function renderDictationSettings() {
    return (
      <div className="mx-auto grid w-full max-w-[620px] gap-7 pb-4">
        <SettingsGroup>
          <SettingsRow
            label="Voice dictation"
            description="Turns speech into polished text in any app"
            control={
              <SettingsSwitch
                checked={voiceEnabled}
                onCheckedChange={setVoiceEnabled}
                label="Voice dictation"
              />
            }
          />
          {voiceEnabled ? (
            <>
              <SettingsRow
                label="Shortcut"
                description="Shortcut to start dictation"
                control={
                  <SettingsChoicePopover
                    title="Dictation shortcut"
                    trigger={
                      <SettingsKeycap aria-haspopup="listbox">
                        {compactVoiceShortcutLabel(
                          voiceShortcut,
                          voiceCustomShortcut,
                        )}
                      </SettingsKeycap>
                    }
                    value={voiceShortcut}
                    options={VOICE_SHORTCUT_CHOICES}
                    keepOpenValues={["custom", "fn", "both"]}
                    onChange={(next) =>
                      onVoiceShortcutChange(next as VoiceShortcutPreference)
                    }
                  >
                    {voiceShortcut === "custom" ? (
                      <ShortcutRecorder
                        value={voiceCustomShortcut}
                        placeholder="Record shortcut"
                        onChange={onVoiceCustomShortcutChange}
                      />
                    ) : null}
                    {isMacPlatform() && fnShortcutSelected ? (
                      <SettingsActionButton
                        className="w-full"
                        onClick={() => openPrivacySettings("input-monitoring")}
                      >
                        Grant Input Monitoring
                      </SettingsActionButton>
                    ) : null}
                    {shortcutRegistrationError ? (
                      <p className="text-xs text-destructive">
                        {shortcutRegistrationError}
                      </p>
                    ) : null}
                  </SettingsChoicePopover>
                }
              />
              <SettingsRow
                label="Mode"
                description="Choose how the shortcut starts and stops dictation"
                control={
                  <SettingsSelect
                    ariaLabel="Dictation mode"
                    value={voiceMode}
                    onValueChange={(value) =>
                      onVoiceModeChange(value as VoiceMode)
                    }
                    options={[
                      { value: "push-to-talk", label: "Hold to dictate" },
                      { value: "toggle", label: "Press to start and stop" },
                    ]}
                  />
                }
              />
            </>
          ) : null}
        </SettingsGroup>
      </div>
    );
  }

  const settingsTabs: Array<{
    id: SettingsTabId;
    label: string;
    icon: ReactNode;
    alert?: boolean;
  }> = [
    {
      id: "general",
      label: "General",
      icon: (
        <IconAdjustmentsHorizontal size={16} stroke={1.7} aria-hidden="true" />
      ),
      alert: updateReady,
    },
    {
      id: "recording",
      label: "Recording",
      icon: <IconVideo size={16} stroke={1.7} aria-hidden="true" />,
    },
    // Its own destination, not a popover buried in Advanced: Rewind carries ~10
    // settings across capture, privacy, agent, and storage.
    {
      id: "rewind",
      label: "Rewind",
      icon: <IconHistory size={16} stroke={1.7} aria-hidden="true" />,
    },
    {
      id: "meetings",
      label: "Meetings",
      icon: <IconCalendar size={16} stroke={1.7} aria-hidden="true" />,
    },
    // A microphone, not a keyboard: dictation is the surface you talk into, and
    // a keyboard icon read as "keyboard shortcuts" instead.
    {
      id: "dictation",
      label: "Dictation",
      icon: <IconMicrophone size={16} stroke={1.7} aria-hidden="true" />,
    },
    // A wrench, not a warning triangle: Advanced is rarely-needed, not unsafe.
    {
      id: "advanced",
      label: "Advanced",
      icon: <IconTool size={16} stroke={1.7} aria-hidden="true" />,
    },
  ];
  const activeSettingsTab =
    settingsTabs.find((tab) => tab.id === settingsTab) ?? settingsTabs[0];

  function renderSettingsTab() {
    switch (settingsTab) {
      case "recording":
        return renderRecordingSettings();
      case "meetings":
        return renderMeetingSettings();
      case "dictation":
        return renderDictationSettings();
      case "rewind":
        return renderRewindSettings();
      case "advanced":
        return renderAdvancedSettings();
      case "general":
      default:
        return renderGeneralSettings();
    }
  }

  return (
    <div
      data-tw-surface
      /* A fixed height, not content-driven: the tray window resizes itself to
         match rendered content, so a taller tab would otherwise grow the window
         out from under the user. Tabs scroll inside this frame instead. */
      className="flex h-[560px] max-h-[calc(100vh-48px)] w-full flex-col overflow-hidden rounded-[14px] bg-background text-foreground"
    >
      <div className="grid min-h-0 flex-1 grid-cols-[176px_minmax(0,1fr)]">
        <nav
          className="flex min-w-0 flex-col gap-0.5 overflow-y-auto border-r border-border bg-muted/50 p-2.5 pt-3"
          aria-label="Settings sections"
        >
          {/* The tray window is chromeless, so this header is its only drag
              handle — without it the window cannot be moved. */}
          <div
            className="flex items-center pb-2"
            onMouseDown={handlePopoverHeaderMouseDown}
          >
            {onCancel ? (
              <button
                type="button"
                className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-base font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={onCancel}
              >
                <IconArrowLeft
                  className="size-4 shrink-0"
                  stroke={1.85}
                  aria-hidden="true"
                />
                Back to app
              </button>
            ) : null}
          </div>
          {settingsTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={cn(
                "flex min-h-8 w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-base font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                settingsTab === tab.id
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
              aria-current={settingsTab === tab.id ? "page" : undefined}
              onClick={() => setSettingsTab(tab.id)}
            >
              {tab.icon}
              <span className="flex-1 truncate">{tab.label}</span>
              {tab.alert ? (
                <span
                  className="size-1.5 shrink-0 rounded-full bg-info"
                  role="img"
                  aria-label="Update ready"
                />
              ) : null}
            </button>
          ))}
        </nav>
        <main
          data-popover-scroll-region
          className="min-h-0 min-w-0 overflow-y-auto overscroll-contain px-5 pb-6 pt-5"
          tabIndex={-1}
        >
          {/* Title only, and the title deliberately repeats the nav item —
              normally the first thing the default-chrome rule deletes. This
              surface is a macOS System Settings idiom (owner-approved
              mockups), where the pane restating the selected sidebar item is
              the platform convention; a subtitle under it is still banned. */}
          <h3 className="mx-auto mb-6 max-w-[620px] text-2xl font-semibold tracking-[-0.02em]">
            {activeSettingsTab.label}
          </h3>
          {renderSettingsTab()}
        </main>
      </div>
    </div>
  );
}

/**
 * The one row that reports real state rather than offering a control. Tailwind,
 * not the old `.whisper-status` CSS, because it renders inside the settings
 * tree where the scoped preflight subset strips hand-written button chrome.
 */
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
      <p className="flex items-start gap-1.5">
        <IconAlertTriangle
          className="mt-px size-3.5 shrink-0 text-muted-foreground"
          stroke={1.9}
          aria-hidden="true"
        />
        <span>Without it, only your mic is transcribed</span>
      </p>
    );
  }
  if (!status) return null;

  // Nothing to say when the model is ready: the picker already shows which
  // model and how big it is, so a green "Ready · 141 MB" is the same fact twice.
  if (status.state === "ready") return null;

  if (status.state === "downloading") {
    const pct =
      status.totalMb > 0
        ? Math.round((status.downloadedMb / status.totalMb) * 100)
        : 0;
    return (
      <div className="grid gap-1.5">
        <span>
          Downloading… {status.downloadedMb} / {status.totalMb} MB ({pct}%)
        </span>
        <div
          className="h-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Whisper model download ${pct}% complete`}
        >
          <div
            className="h-full rounded-full bg-foreground transition-[width] duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  // "missing" state
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5">
        <IconAlertTriangle
          className="size-3.5 shrink-0 text-muted-foreground"
          stroke={1.9}
          aria-hidden="true"
        />
        Not downloaded yet
      </span>
      <SettingsActionButton onClick={onDownload}>
        Download now
      </SettingsActionButton>
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
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <SettingsKeycap
        ref={buttonRef}
        active={recording}
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
                ? "Space needs Cmd, Ctrl, Option, or Shift so it doesn't hijack typing."
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
        {recording
          ? "Press shortcut…"
          : value
            ? compactShortcutLabel(value)
            : placeholder}
      </SettingsKeycap>
      {value ? (
        <SettingsActionButton
          emphasis="quiet"
          onClick={() => {
            onChange("");
            setError(null);
            setSaved(false);
          }}
        >
          Clear
        </SettingsActionButton>
      ) : null}
      {error ? (
        <p className="w-full text-right text-xs text-destructive">{error}</p>
      ) : null}
      {saved && !error ? (
        <p
          className="w-full text-right text-xs text-success"
          aria-live="polite"
        >
          Saved
        </p>
      ) : null}
    </div>
  );
}
