import {
  IconAdjustmentsHorizontal,
  IconAlertTriangle,
  IconArrowLeft,
  IconCalendar,
  IconCalendarEvent,
  IconCircleCheck,
  IconExternalLink,
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
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  type ReactNode,
  type RefObject,
  type KeyboardEvent as ReactKeyboardEvent,
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Switch as UiSwitch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import {
  CLIPS_MEETINGS,
  CLIPS_WISPRFLOW,
  isLabEnabled,
} from "../../shared/labs";
import { BackToApp } from "./components/BackToApp";
import {
  CamIcon,
  GoogleIcon,
  LibraryIcon,
  ScreenCamIcon,
  ScreenIcon,
  SettingsIcon,
} from "./components/Icons";
import { MediaDeviceRow } from "./components/MediaDeviceRow";
import { MicOffConfirmation } from "./components/MicOffConfirmation";
import {
  RecordingRecovery,
  RecordingRecoveryPage,
  type RecordingRecoveryProps,
} from "./components/RecordingRecovery";
import { ShortcutKeycaps } from "./components/ShortcutKeycaps";
import { SourceRow, type CaptureSource } from "./components/SourceRow";
import { Switch } from "./components/Switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "./components/Tooltip";
import { UpdateBanner } from "./components/UpdateBanner";
import { useMediaDevices } from "./hooks/useMediaDevices";
import { useMeetingTranscription } from "./hooks/useMeetingTranscription";
import { stopAllMicMeters } from "./hooks/useMicMeter";
import { useSystemAccessRows } from "./hooks/useSystemAccessRows";
import { useWhisperSettings } from "./hooks/useWhisperSettings";
import {
  desktopAuthCopy,
  desktopRecoveryCopy,
  desktopRecordingFailureCopy,
} from "./i18n/en-US";
import { startBubbleFramePump } from "./lib/bubble-pump";
import { shouldKeepBubbleSession } from "./lib/bubble-session";
import {
  startBubbleWebrtc,
  type BubbleWebrtcHandle,
} from "./lib/bubble-webrtc";
import {
  captureSetupForCamera,
  captureSetupForMode,
  normalizeCaptureSetup,
} from "./lib/capture-mode";
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
  createPrivateAgentRewindRecording,
  exportBrowserRecordingBackup,
  getRewindClipOrigin,
  listBrowserRecordingBackups,
  retryBrowserRecordingBackup,
  scheduleNativeBackupCleanupAfterProcessing,
  shouldUseNativeFullscreenRecording,
  shouldUseNativeWindowRecording,
  startRecording,
  type LocalExportedFile,
  type CaptureMode,
  type RecorderHandle,
  type RecorderStopResult,
  type RestartHandoff,
} from "./lib/recorder";
import { notifyRecordingFailure } from "./lib/recording-failure-notifications";
import { clearResolvedFinalizationError } from "./lib/recording-finalization-state";
import {
  copyRecordingShareLink,
  recordingShareUrl,
} from "./lib/recording-link";
import {
  prepareNativeRecordingStart,
  recoverRecordingStart,
  RecordingStartAttempt,
  ScreenRecordingPermissionError,
} from "./lib/recording-preflight";
import {
  reconcileRecordingRecovery,
  recordingRecoveryKey,
  shouldShowRecordingRecoveryBanner,
  type PendingDesktopUpload,
  type PendingNativeUpload,
  type RecoverySnapshot,
} from "./lib/recording-recovery";
import {
  applyRecordingRecoveryResult,
  isRecordingStartCancellation,
  type RecordingRecoveryResult,
} from "./lib/recording-recovery-failure";
import {
  shouldDismissDesktopPopover,
  useRecordingRecoveryNavigation,
} from "./lib/recording-recovery-navigation";
import {
  RECORDING_SERVER_UNAVAILABLE,
  RECORDING_SESSION_EXPIRED,
  isStorageSetupFailureMessage,
} from "./lib/recording-request";
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
import {
  DEFAULT_SERVER_URL,
  normalizeServerUrl,
  SERVER_URL_STORAGE_KEY,
} from "./lib/url";
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

type AuthCheckResult =
  | { state: "authenticated"; token?: string }
  | { state: "anonymous" }
  | { state: "unavailable" }
  | { state: "stale" };

type NativeUploadProgress = {
  recordingId?: string;
  message?: string;
};

type PopoverView = "recorder" | "memory" | "settings" | "meetings" | "recovery";

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
  width?: number | null;
  height?: number | null;
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

type VideoStorageStatus = "checking" | "configured" | "missing";

const STORAGE_SETUP_HELP_TEXT =
  "Clips is 100% free and open source, so you need to hook up a way to store your clips. Connect storage with Builder.io for free-tier storage and AI, or use S3-compatible object storage and your own LLM keys.";
const DEFAULT_SCREEN_MEMORY_CONFIG = {
  enabled: false,
  paused: false,
  retentionHours: 8,
  maxBytes: 5 * 1024 * 1024 * 1024,
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

const STORAGE_KEY = SERVER_URL_STORAGE_KEY;
const MODE_KEY = "clips:last-mode";
const VOICE_SHORTCUT_KEY = "clips:voice-shortcut";
const VOICE_SHORTCUT_CONFIGURED_KEY = "clips:voice-shortcut-configured";
const DEFAULT_VOICE_SHORTCUT: VoiceShortcutPreference = "fn";
const VOICE_CUSTOM_SHORTCUT_KEY = "clips:voice-custom-shortcut";
const POPOVER_CUSTOM_SHORTCUT_KEY = "clips:popover-custom-shortcut";
const RECORD_CUSTOM_SHORTCUT_KEY = "clips:record-custom-shortcut";
const RECORD_CANCEL_SHORTCUT_KEY = "clips:record-cancel-shortcut";
const RECORD_PAUSE_SHORTCUT_KEY = "clips:record-pause-shortcut";
const VOICE_MODE_KEY = "clips:voice-mode";
const VOICE_PROVIDER_KEY = "clips:voice-provider";
const VOICE_INSTRUCTIONS_KEY = "clips:voice-instructions";
const AUTH_TOKEN_KEY = "clips:auth-token";
const SOURCE_KEY = "clips:last-source";
const CAM_ON_KEY = "clips:camera-on";
const MIC_ON_KEY = "clips:mic-on";
const SYSTEM_AUDIO_KEY = "clips:system-audio";
const VIDEO_STORAGE_CONFIGURED_KEY = "clips:video-storage-configured";
const REWIND_DOCS_URL =
  "https://www.agent-native.com/docs/template-clips-capture-everywhere#rewind";

const DEFAULT_URL = DEFAULT_SERVER_URL;

function normalizeCaptureSource(value: string): CaptureSource {
  if (value === "region" && isMacPlatform()) return "region";
  return value === "window" ? "window" : "full-screen";
}

function stopRestartHandoff(handoff: RestartHandoff): void {
  [handoff.displayStream, handoff.audioStream].forEach((stream) =>
    stream?.getTracks().forEach((track) => track.stop()),
  );
  void handoff.transcriptionTornDown?.catch(() => {});
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

type VideoStorageProbe = "configured" | "missing" | "unknown";
type FileUploadStatusProbe = VideoStorageProbe | "reauthorization-required";

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
  account: string | null,
): Promise<VideoStorageProbe> {
  const base = serverUrl.replace(/\/+$/, "");

  const probeEndpoint = async (
    path: string,
  ): Promise<FileUploadStatusProbe> => {
    try {
      const res = await fetchWithAbortTimeout(
        `${base}${path}`,
        {
          credentials: "include",
          cache: "no-store",
        },
        VIDEO_STORAGE_PROBE_TIMEOUT_MS,
      );
      if (!res.ok) return "unknown";
      // coercion-ok: an unparseable body maps to the typed "unknown" probe
      // result, which callers treat as distinct from configured/missing.
      const body = (await res.json().catch(() => null)) as {
        configured?: boolean;
        builderReauthorizationRequired?: boolean;
      } | null;
      if (!body) return "unknown";
      if (body.configured) return "configured";
      if (body.builderReauthorizationRequired) {
        return "reauthorization-required";
      }
      return "missing";
    } catch {
      return "unknown";
    }
  };

  const uploadProbe = probeEndpoint("/_agent-native/file-upload/status");
  const builderProbe = probeEndpoint("/_agent-native/builder/status");
  const uploadResult = await uploadProbe;
  if (uploadResult === "reauthorization-required") {
    return "missing";
  }

  const results = [uploadResult, await builderProbe];
  const probe = results.includes("configured")
    ? "configured"
    : results.includes("missing")
      ? "missing"
      : "unknown";
  if (probe === "configured" && account) {
    saveBool(videoStorageConfiguredKey(serverUrl, account), true);
  }
  return probe;
}

function authTokenStorageKey(serverUrl: string): string {
  return `${AUTH_TOKEN_KEY}:${originForServer(serverUrl)}`;
}

function videoStorageConfiguredKey(serverUrl: string, account: string): string {
  return `${VIDEO_STORAGE_CONFIGURED_KEY}:${originForServer(serverUrl)}:${account}`;
}

export function loadDesktopAuthToken(serverUrl: string): string {
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

const MEETING_IMMINENT_WINDOW_MS = 10 * 60 * 1000;

function meetingCanStartNotes(meeting: PopoverMeeting): boolean {
  const startMs = Date.parse(meeting.scheduledStart ?? "");
  if (Number.isNaN(startMs)) return false;
  const endMs = Date.parse(meeting.scheduledEnd ?? "");
  const now = Date.now();
  return (
    startMs <= now + MEETING_IMMINENT_WINDOW_MS &&
    (Number.isNaN(endMs) || endMs >= now)
  );
}

const MAC_MODIFIER_GLYPHS: Record<string, string> = {
  Cmd: "⌘",
  Ctrl: "⌃",
  Alt: "⌥",
  Shift: "⇧",
};

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
    />
  );
}

const VOICE_SHORTCUT_CHOICES: Array<{ value: string; label: string }> = [
  { value: "fn", label: "Fn (globe)" },
  { value: "cmd-shift-space", label: "Cmd Shift Space" },
  { value: "ctrl-shift-space", label: "Ctrl Shift Space" },
  { value: "custom", label: "Custom shortcut" },
  { value: "both", label: "Any of them" },
];

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

const POPOVER_RESIZE_OVERLAY_SELECTOR = '[data-popover-resize-overlay="true"]';

function measurePopoverHeight(el: HTMLElement): number {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  const borderY =
    Number.parseFloat(style.borderTopWidth || "0") +
    Number.parseFloat(style.borderBottomWidth || "0");

  const candidates = [rect.height, el.scrollHeight + borderY];

  const directChildOverflow = Array.from(el.children).reduce((total, child) => {
    if (!(child instanceof HTMLElement)) return total;
    return total + Math.max(0, child.scrollHeight - child.clientHeight);
  }, 0);
  candidates.push(el.scrollHeight + borderY + directChildOverflow);

  let lowestBottom = rect.bottom;
  for (const child of Array.from(el.querySelectorAll<HTMLElement>("*"))) {
    if (child.closest('[data-popover-overlay="true"]')) continue;
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

    const childBorderY =
      Number.parseFloat(childStyle.borderTopWidth || "0") +
      Number.parseFloat(childStyle.borderBottomWidth || "0");
    candidates.push(
      childRect.top - rect.top + child.scrollHeight + childBorderY,
    );
  }
  candidates.push(lowestBottom - rect.top);

  for (const overlay of Array.from(
    document.querySelectorAll<HTMLElement>(POPOVER_RESIZE_OVERLAY_SELECTOR),
  )) {
    const overlayRect = overlay.getBoundingClientRect();
    const overlayStyle = window.getComputedStyle(overlay);
    const overlayBorderY =
      Number.parseFloat(overlayStyle.borderTopWidth || "0") +
      Number.parseFloat(overlayStyle.borderBottomWidth || "0");
    const overlayHeight = Math.max(
      overlayRect.height,
      overlay.scrollHeight + overlayBorderY,
    );
    candidates.push(overlayRect.top - rect.top + overlayHeight + 8);
  }

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
      for (const overlay of Array.from(
        document.querySelectorAll<HTMLElement>(POPOVER_RESIZE_OVERLAY_SELECTOR),
      )) {
        resizeObserver.observe(overlay);
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
    const portalObserver = new MutationObserver(() => {
      observeTree();
      schedule();
    });
    portalObserver.observe(document.body, {
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
      portalObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [disabled, ref, width]);
}

export function App({
  initialView,
  initialSettingsTab: initialSettingsTabProp,
}: {
  initialView?: PopoverView;
  initialSettingsTab?: DesktopSettingsTab;
} = {}) {
  const featureConfig = useFeatureConfig();
  const [serverUrl, setServerUrl] = useState<string>(() =>
    loadString(STORAGE_KEY, DEFAULT_URL).replace(/\/+$/, ""),
  );
  const [initialCaptureSetup] = useState(() =>
    normalizeCaptureSetup(
      loadString(MODE_KEY, "screen-camera"),
      loadBool(CAM_ON_KEY, true),
    ),
  );
  const [mode, setMode] = useState<CaptureMode>(initialCaptureSetup.mode);
  const [source, setSource] = useState<CaptureSource>(() =>
    normalizeCaptureSource(loadString(SOURCE_KEY, "full-screen")),
  );
  const [cameraOn, setCameraOn] = useState<boolean>(
    initialCaptureSetup.cameraOn,
  );
  const [micOn, setMicOn] = useState<boolean>(() => loadBool(MIC_ON_KEY, true));
  const [micOffConfirmOpen, setMicOffConfirmOpen] = useState(false);
  const [systemAudioOn, setSystemAudioOn] = useState<boolean>(() =>
    loadBool(SYSTEM_AUDIO_KEY, true),
  );
  const [voiceShortcut, setVoiceShortcut] = useState<VoiceShortcutPreference>(
    () => {
      if (!loadBool(VOICE_SHORTCUT_CONFIGURED_KEY, false)) {
        return DEFAULT_VOICE_SHORTCUT;
      }
      const saved = loadString(VOICE_SHORTCUT_KEY, DEFAULT_VOICE_SHORTCUT);
      return saved === "fn" ||
        saved === "cmd-shift-space" ||
        saved === "ctrl-shift-space" ||
        saved === "custom" ||
        saved === "both"
        ? saved
        : DEFAULT_VOICE_SHORTCUT;
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
  const [recordCancelShortcut, setRecordCancelShortcut] = useState<string>(() =>
    loadStringAllowEmpty(RECORD_CANCEL_SHORTCUT_KEY, ""),
  );
  const [recordPauseShortcut, setRecordPauseShortcut] = useState<string>(() =>
    loadStringAllowEmpty(RECORD_PAUSE_SHORTCUT_KEY, ""),
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

  const [recoverySnapshot, setRecoverySnapshot] = useState<RecoverySnapshot>({
    uploads: [],
    errors: [],
  });
  const pendingUploads = recoverySnapshot.uploads;
  const [recoveryActionErrors, setRecoveryActionErrors] = useState<
    Record<string, string>
  >({});
  const [recoveryRefreshing, setRecoveryRefreshing] = useState(false);
  const recoveryLookupSequence = useRef(0);
  const recoveryFailureAttempts = useRef(new Map<string, string>());
  const recoverySessionId = useRef(crypto.randomUUID());
  const [retryingUploadId, setRetryingUploadId] = useState<string | null>(null);
  const [retryingUploadStatus, setRetryingUploadStatus] = useState<
    string | null
  >(null);
  const retryUploadAbortRef = useRef<AbortController | null>(null);
  const retryUploadRecordingIdRef = useRef<string | null>(null);
  const retryingUploadKindRef = useRef<PendingDesktopUpload["kind"] | null>(
    null,
  );
  useEffect(() => {
    if (!retryingUploadId) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listen<NativeUploadProgress>(
      "clips:native-upload-progress",
      (event) => {
        if (
          !event.payload.recordingId ||
          retryingUploadId !== `native:${event.payload.recordingId}`
        )
          return;
        const message = event.payload?.message?.trim();
        if (message) setRetryingUploadStatus(message);
      },
    ).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [retryingUploadId]);
  const [exportingUploadId, setExportingUploadId] = useState<string | null>(
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
  function openSettings(tab: SettingsTabId = "general") {
    setInitialSettingsTab(tab);
    setPopoverView("settings");
  }

  function selectCaptureMode(nextMode: CaptureMode) {
    const nextSetup = captureSetupForMode(nextMode);
    setMode(nextSetup.mode);
    setCameraOn(nextSetup.cameraOn);
  }

  function toggleCamera(nextOn: boolean) {
    const nextSetup = captureSetupForCamera(mode, nextOn);
    setMode(nextSetup.mode);
    setCameraOn(nextSetup.cameraOn);
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
  const [meetingsCalendarNeedsReauth, setMeetingsCalendarNeedsReauth] =
    useState(false);
  const [meetingStartMessage, setMeetingStartMessage] = useState<string | null>(
    null,
  );
  const [
    rewindMeetingHistoryAvailability,
    setRewindMeetingHistoryAvailability,
  ] = useState<Record<string, RewindMeetingHistoryAvailability>>({});
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);
  const [recorder, setRecorder] = useState<RecorderHandle | null>(null);
  const recordingStartAttemptRef = useRef<RecordingStartAttempt | null>(null);
  const [recordingStartPending, setRecordingStartPending] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [shortcutRegistrationError, setShortcutRegistrationError] = useState<
    string | null
  >(null);
  const [recordingFlowActive, setRecordingFlowActive] = useState(false);
  const [recordingStopFinalizing, setRecordingStopFinalizing] = useState(false);
  const [, setLastRecordingId] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<
    "unknown" | "authed" | "anon" | "unavailable"
  >("unknown");
  const [labValues, setLabValues] = useState<Record<string, boolean>>({});
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
  const signInInflightRef = useRef(false);
  const authCheckGenerationRef = useRef(0);
  const authServerUrlRef = useRef(serverUrl);
  authServerUrlRef.current = serverUrl;
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const signInVisibilityRef = useRef<(() => void) | null>(null);
  const isRecording = recorder !== null;
  const [popoverVisible, setPopoverVisible] = useState(false);
  const recordingErrorVisibleRef = useRef({
    visible: popoverVisible,
    view: popoverView,
  });
  recordingErrorVisibleRef.current = {
    visible: popoverVisible,
    view: popoverView,
  };
  const recordShortcutHandlerRef = useRef<() => void>(() => {});
  const handleStartRecordingRef = useRef<
    (options?: {
      resumeCapture?: RestartHandoff;
    }) => Promise<RecorderHandle | null>
  >(async () => null);
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
    microphoneEnabled: micOn,
    popoverVisible,
    setCameraError,
    setRecError,
  });
  const meetingsLabEnabled =
    authStatus === "authed" && isLabEnabled(labValues, CLIPS_MEETINGS);
  const wisprFlowLabEnabled =
    authStatus === "authed" && isLabEnabled(labValues, CLIPS_WISPRFLOW);
  const voiceDictationEnabled =
    wisprFlowLabEnabled && featureConfig?.voiceEnabled !== false;
  const fnShortcutEnabled =
    voiceDictationEnabled &&
    (voiceShortcut === "fn" || voiceShortcut === "both");

  useEffect(() => {
    if (!meetingsLabEnabled && popoverView === "meetings") {
      setPopoverView("recorder");
    }
  }, [meetingsLabEnabled, popoverView]);
  const updateVoiceShortcut = useCallback((value: VoiceShortcutPreference) => {
    saveBool(VOICE_SHORTCUT_CONFIGURED_KEY, true);
    setVoiceShortcut(value);
  }, []);

  useEffect(() => {
    installAuthFetchInterceptor();
    setDesktopAuthContext(serverUrl, loadDesktopAuthToken(serverUrl));
  }, [serverUrl]);

  const videoStorageIdentity = `${originForServer(serverUrl)}|${signedInAs ?? ""}`;
  const videoStorageIdentityRef = useRef(videoStorageIdentity);
  useEffect(() => {
    videoStorageIdentityRef.current = videoStorageIdentity;
    setVideoStorageStatus(
      signedInAs &&
        loadBool(videoStorageConfiguredKey(serverUrl, signedInAs), false)
        ? "configured"
        : "checking",
    );
  }, [videoStorageIdentity, serverUrl, signedInAs]);

  const refreshVideoStorageStatus = useCallback(async () => {
    if (authStatus !== "authed" || localRecordingMode !== "off") {
      setVideoStorageStatus("configured");
      return true;
    }

    const probedIdentity = videoStorageIdentity;
    const probe = await hasConfiguredVideoStorage(serverUrl, signedInAs);
    if (videoStorageIdentityRef.current !== probedIdentity) return false;
    if (probe === "unknown") {
      setVideoStorageStatus((prev) =>
        prev === "configured" || prev === "missing" ? prev : "checking",
      );
      return false;
    }
    setVideoStorageStatus(probe);
    return probe === "configured";
  }, [
    authStatus,
    localRecordingMode,
    serverUrl,
    signedInAs,
    videoStorageIdentity,
  ]);

  useEffect(() => {
    void refreshVideoStorageStatus();
  }, [refreshVideoStorageStatus]);

  useEffect(() => {
    if (
      authStatus !== "authed" ||
      localRecordingMode !== "off" ||
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
      recordCancel: recordCancelShortcut.trim() ? recordCancelShortcut : null,
      recordPause: recordPauseShortcut.trim() ? recordPauseShortcut : null,
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
    recordCancelShortcut,
    recordCustomShortcut,
    recordPauseShortcut,
    voiceCustomShortcut,
    voiceShortcut,
  ]);

  const checkAuth = useCallback(async (): Promise<AuthCheckResult> => {
    const requestServerUrl = serverUrl;
    const requestId = ++authCheckGenerationRef.current;
    const isCurrentRequest = () =>
      requestId === authCheckGenerationRef.current &&
      authServerUrlRef.current === requestServerUrl;
    try {
      const res = await fetch(
        `${requestServerUrl.replace(/\/+$/, "")}/_agent-native/auth/session`,
        { credentials: "include", cache: "no-store" },
      );
      if (!isCurrentRequest()) return { state: "stale" };
      setServerReachable(true);
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          clearDesktopAuthToken(requestServerUrl);
          setAuthStatus("anon");
          setSignedInAs(null);
          return { state: "anonymous" };
        }
        if (res.status >= 500) {
          setServerReachable(false);
          setAuthStatus((current) =>
            current === "authed" ? current : "unavailable",
          );
          return { state: "unavailable" };
        }
        setAuthStatus("anon");
        setSignedInAs(null);
        return { state: "anonymous" };
      }
      const json = (await res.json().catch(() => null)) as {
        email?: string;
        token?: string;
        error?: string;
      } | null;
      if (json?.email) {
        if (!isCurrentRequest()) return { state: "stale" };
        const token = json.token?.trim() || undefined;
        if (token) saveDesktopAuthToken(requestServerUrl, token);
        setAuthStatus("authed");
        setSignedInAs(json.email);
        return { state: "authenticated", ...(token ? { token } : {}) };
      }
      if (!isCurrentRequest()) return { state: "stale" };
      setAuthStatus("anon");
      setSignedInAs(null);
      clearDesktopAuthToken(requestServerUrl);
      return { state: "anonymous" };
    } catch {
      if (!isCurrentRequest()) return { state: "stale" };
      setServerReachable(false);
      setAuthStatus((current) =>
        current === "authed" ? current : "unavailable",
      );
      return { state: "unavailable" };
    }
  }, [serverUrl]);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    invoke("meetings_watcher_set_server_url", { serverUrl }).catch(() => {
      // Command may be missing on older builds — best-effort.
    });
  }, [serverUrl]);

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
      let url = `${base}/_agent-native/actions/${name}`;
      let requestBody: string | undefined;
      if (method === "GET") {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(body)) {
          if (value != null)
            params.set(
              key,
              typeof value === "string" ? value : (JSON.stringify(value) ?? ""),
            );
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

  useEffect(() => {
    let cancelled = false;
    const refreshLabs = async () => {
      if (authStatus !== "authed") {
        setLabValues({});
        emit("clips:labs-updated", { values: {} }).catch(() => {});
        return;
      }

      try {
        const values = await callClipsAction<Record<string, boolean>>(
          "get-labs",
          {},
          { method: "GET" },
        );
        if (!cancelled) {
          setLabValues(values);
          emit("clips:labs-updated", { values }).catch(() => {});
        }
      } catch (error) {
        console.warn("[clips-tray] lab refresh failed:", error);
      }
    };

    void refreshLabs();
    if (authStatus !== "authed") {
      return () => {
        cancelled = true;
      };
    }

    const refreshInterval = window.setInterval(() => {
      void refreshLabs();
    }, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(refreshInterval);
    };
  }, [authStatus, callClipsAction]);

  useEffect(() => {
    invoke("meetings_watcher_set_lab_enabled", {
      enabled: authStatus === "authed" && meetingsLabEnabled,
    }).catch((error) => {
      console.warn("[clips-tray] meetings lab sync failed:", error);
    });
  }, [authStatus, meetingsLabEnabled]);

  useEffect(() => {
    if (meetingsLabEnabled) return;
    setActiveMeetingId(null);
    setMeetingStartMessage(null);
  }, [meetingsLabEnabled]);

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
          loadDesktopAuthToken(serverUrl),
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
          loadDesktopAuthToken(serverUrl),
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
          ...(typeof upload.width === "number" && upload.width > 0
            ? { preRollWidth: upload.width }
            : {}),
          ...(typeof upload.height === "number" && upload.height > 0
            ? { preRollHeight: upload.height }
            : {}),
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
    if (authStatus !== "authed" || !meetingsLabEnabled) {
      setMeetings([]);
      setMeetingsError(null);
      setMeetingsCalendarNeedsReauth(false);
      return;
    }

    setMeetingsLoading(true);
    setMeetingsError(null);
    try {
      const result = await callClipsAction<{
        meetings?: unknown[];
        calendarErrors?: Array<{ needsReauth?: boolean }>;
      }>(
        "list-meetings",
        {
          view: "upcoming",
          limit: 3,
          upcomingWithinMin: 24 * 60,
        },
        { method: "GET" },
      );
      setMeetingsCalendarNeedsReauth(
        result.calendarErrors?.some((error) => error.needsReauth === true) ===
          true,
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
      setMeetingsCalendarNeedsReauth(false);
      setMeetingsError(
        err instanceof Error ? err.message : "Could not load meetings.",
      );
    } finally {
      setMeetingsLoading(false);
    }
  }, [authStatus, callClipsAction, meetingsLabEnabled]);

  useEffect(() => {
    let cancelled = false;
    if (
      !meetingsLabEnabled ||
      popoverView !== "meetings" ||
      meetings.length === 0
    ) {
      setRewindMeetingHistoryAvailability({});
      return () => {
        cancelled = true;
      };
    }
    void Promise.all(
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
  }, [meetings, meetingsLabEnabled, popoverView]);

  const startMeetingNotes = useCallback(
    (meeting: PopoverMeeting, includeFromMeetingStart = false) => {
      if (!meetingsLabEnabled) return;
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
    [meetingsLabEnabled],
  );

  const startMeetingNotesAndJoin = useCallback(
    (meeting: PopoverMeeting, includeFromMeetingStart = false) => {
      if (!meetingsLabEnabled) return;
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
    if (!meetingsLabEnabled) return;
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
  }, [meetingsLabEnabled]);

  useEffect(() => {
    if (!meetingsLabEnabled || !popoverVisible || !activeMeetingId) {
      return;
    }
    showActiveMeetingPill(activeMeetingId);
  }, [
    activeMeetingId,
    meetingsLabEnabled,
    popoverVisible,
    showActiveMeetingPill,
  ]);

  useMeetingTranscription({
    callClipsAction,
    serverUrl,
    selectedMicId,
    selectedMicLabel,
    enabled: meetingsLabEnabled,
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
          signInInflightRef.current = false;
          setSignInPending(null);
          setMagicLinkEmail(null);
          const authResult = await checkAuth();
          if (authResult.state === "anonymous") {
            setSignInError(
              kind === "magic-link"
                ? "Signed in, but Clips couldn't keep the session. Try again."
                : "Signed in with Google, but Clips couldn't keep the session. Try again.",
            );
          } else if (authResult.state === "unavailable") {
            setSignInError(
              "Signed in, but Clips couldn't reach the server to verify it. Try again.",
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

  async function signInExternal() {
    if (signInInflightRef.current) return;
    signInInflightRef.current = true;

    try {
      setSignInError(null);
      const flowId = crypto.randomUUID?.call(crypto) ?? null;
      const verifier = (() => {
        const randomUuid = crypto.randomUUID?.bind(crypto);
        if (randomUuid) {
          return `${randomUuid()}${randomUuid()}`;
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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (isRecording) return;
        if (!shouldDismissDesktopPopover(e)) return;
        setPopoverView("recorder");
        hidePopover();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isRecording]);

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
        recordingErrorVisibleRef.current.visible = visible;
        if (!visible) setPopoverView("recorder");
      }),
    );
    track(
      listen("clips:bubble-closed", () => {
        console.log(
          "[clips-popover] bubble-closed received — stopping camera + clearing cameraOn",
        );
        bubbleStreamRef.current?.getTracks().forEach((t) => t.stop());
        const nextSetup = captureSetupForMode("screen");
        setMode(nextSetup.mode);
        setCameraOn(nextSetup.cameraOn);
      }),
    );
    getCurrentWindow()
      .isVisible()
      .then((v) => {
        if (cancelled) return;
        console.log("[clips-popover] initial isVisible =", v);
        setPopoverVisible(!!v);
        recordingErrorVisibleRef.current.visible = !!v;
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

  const bubbleStreamRef = useRef<MediaStream | null>(null);
  const bubbleStreamTransferredToRecorder = useRef(false);
  const [bubbleSessionEpoch, setBubbleSessionEpoch] = useState(0);
  const [recordingChromeEpoch, setRecordingChromeEpoch] = useState(0);
  const wantsCamera = mode !== "screen" && cameraOn;
  const nativeFullscreenRecordingActive =
    mode !== "camera" && shouldUseNativeFullscreenRecording(source);
  const nativeWindowRecordingActive =
    mode !== "camera" && shouldUseNativeWindowRecording(source);
  const nativeCaptureRecordingActive =
    nativeFullscreenRecordingActive || nativeWindowRecordingActive;
  const recordingFlowGateRef = useRef(false);
  const recordingStopFinalizingRef = useRef(false);
  const restartInFlightRef = useRef(false);
  const restartCancelledRef = useRef(false);
  const recordingCancelInFlightRef = useRef(false);
  const sessionRecordingIdRef = useRef<string | null>(null);
  const recordingInFlight =
    isRecording || recordingFlowActive || recordingStartPending;
  useLayoutEffect(() => {
    recordingFlowGateRef.current =
      recordingInFlight || recordingStartAttemptRef.current !== null;
  }, [recordingInFlight]);
  const bubbleActive = shouldKeepBubbleSession({
    wantsCamera,
    popoverVisible,
    recordingInFlight,
  });

  bubbleActiveRef.current = bubbleActive;
  const toolbarActive = isRecording || recordingFlowActive;

  useEffect(() => {
    if (!toolbarActive) return;
    let cancelled = false;
    void (async () => {
      try {
        await invoke("show_toolbar");
        if (cancelled) return;
      } catch (err) {
        console.error("[clips-popover] show_toolbar failed:", err);
      }
    })();
    emit("clips:toolbar-enabled", false).catch(() => {});
    emit("clips:toolbar-preparing").catch(() => {});
    return () => {
      cancelled = true;
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

    getCameraStreamWithFallback(cameraId, {
      width: { ideal: 1280 },
      height: { ideal: 720 },
    })
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        await loadDevices();
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        bubbleStreamRef.current = s;
        try {
          await invoke("show_bubble");
        } catch (err) {
          console.error("[clips-popover] show_bubble failed:", err);
        }
        if (cancelled) {
          if (!recordingFlowGateRef.current && !bubbleActiveRef.current) {
            await invoke("close_bubble").catch((err) =>
              console.error("[clips-popover] late bubble cleanup failed:", err),
            );
          }
          s.getTracks().forEach((t) => t.stop());
          return;
        }
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
      if (stream && !transferred) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
      }
      if (!transferred) {
        bubbleStreamRef.current = null;
      }
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
      bubbleStreamTransferredToRecorder.current = false;
      bubbleStreamRef.current?.getTracks().forEach((t) => t.stop());
      bubbleStreamRef.current = null;
      if (!recordingFlowGateRef.current) {
        setBubbleSessionEpoch((epoch) => epoch + 1);
      }
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

  const appRef = useRef<HTMLDivElement | null>(null);
  const recoveryNavigation = useRecordingRecoveryNavigation(
    popoverView,
    setPopoverView,
    appRef,
  );
  usePopoverAutoSize(appRef, {
    disabled:
      (popoverView !== "settings" && !popoverVisible) ||
      isRecording ||
      recordingFlowActive ||
      recordingStartPending,
    width:
      popoverView === "settings" ? 720 : popoverView === "memory" ? 440 : 320,
  });

  const loadPendingUploads = useCallback(async () => {
    const sequence = ++recoveryLookupSequence.current;
    setRecoveryRefreshing(true);
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
    if (sequence !== recoveryLookupSequence.current) return;
    setRecoverySnapshot((previous) =>
      reconcileRecordingRecovery(previous.uploads, nativeResult, browserResult),
    );
    setRecoveryRefreshing(false);
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

  const reportRecordingFailure = useCallback(
    (result: RecordingRecoveryResult, localOnly = false) => {
      const recordingId = result.recordingId || recoverySessionId.current;
      setRecoveryActionErrors((errors) =>
        applyRecordingRecoveryResult(
          errors,
          result,
          recoverySessionId.current,
          desktopRecoveryCopy.actionFailed,
        ),
      );
      if (result.ok) return;
      const id =
        recoveryFailureAttempts.current.get(recordingId) ||
        `recording:${recordingId}`;
      void notifyRecordingFailure({
        kind: localOnly ? "save" : "upload",
        id,
        localCopyVerified: false,
        title: localOnly
          ? desktopRecordingFailureCopy.saveTitle
          : desktopRecordingFailureCopy.uploadTitle,
        body: localOnly
          ? desktopRecordingFailureCopy.saveBody
          : desktopRecordingFailureCopy.uploadBody,
      });
    },
    [],
  );

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<RecordingRecoveryResult>(
      "clips:native-upload-finished",
      (event) => {
        const retryWasCancelled =
          (retryUploadAbortRef.current?.signal.aborted &&
            retryUploadRecordingIdRef.current === event.payload.recordingId) ||
          event.payload.error === "native recording upload retry cancelled";
        if (!event.payload.ok && retryWasCancelled) return;
        reportRecordingFailure(event.payload);
        void loadPendingUploads();
      },
    )
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error) => {
        console.error("[clips-tray] upload recovery listener failed:", error);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [loadPendingUploads, reportRecordingFailure]);

  useEffect(() => {
    if (
      popoverVisible &&
      (popoverView === "meetings" || popoverView === "recorder")
    ) {
      void fetchUpcomingMeetings();
    }
  }, [fetchUpcomingMeetings, popoverView, popoverVisible]);

  useEffect(() => {
    void loadPendingUploads();
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
  useEffect(
    () => saveString(RECORD_CANCEL_SHORTCUT_KEY, recordCancelShortcut),
    [recordCancelShortcut],
  );
  useEffect(
    () => saveString(RECORD_PAUSE_SHORTCUT_KEY, recordPauseShortcut),
    [recordPauseShortcut],
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
    if (
      retryingUploadId ||
      exportingUploadId ||
      recordingStopFinalizingRef.current
    )
      return;
    const key = recordingRecoveryKey(upload);
    if (authStatus !== "authed") {
      setRecoveryActionErrors((errors) => ({
        ...errors,
        [key]: desktopRecoveryCopy.signInToRetry,
      }));
      return;
    }
    const targetServerUrl = serverUrlForPendingUpload(upload, serverUrl);
    setRecoveryActionErrors((errors) => {
      const next = { ...errors };
      delete next[key];
      delete next[`failure:${upload.recordingId}`];
      return next;
    });
    setRetryingUploadId(key);
    recoveryFailureAttempts.current.set(
      upload.recordingId,
      `retry:${upload.recordingId}:${crypto.randomUUID()}`,
    );
    const abortController = new AbortController();
    retryUploadAbortRef.current = abortController;
    retryUploadRecordingIdRef.current = upload.recordingId;
    retryingUploadKindRef.current = upload.kind;
    let uploadCompleted = false;
    try {
      let authToken = loadDesktopAuthToken(targetServerUrl);
      if (originForServer(targetServerUrl) === originForServer(serverUrl)) {
        const authResult = await checkAuth();
        if (authResult.state === "anonymous") {
          throw new Error(desktopRecoveryCopy.signInToRetry);
        }
        if (authResult.state === "authenticated" && authResult.token) {
          authToken = authResult.token;
        }
      }
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
          signal: abortController.signal,
          onRecoveryDecision: ({ action, progress }) => {
            setRetryingUploadStatus(
              action === "resume"
                ? desktopRecoveryCopy.resumeProgress.replace(
                    "{percent}",
                    String(Math.round(progress * 100)),
                  )
                : action === "wait"
                  ? desktopRecoveryCopy.waiting
                  : action === "restart"
                    ? desktopRecoveryCopy.restarting
                    : desktopRecoveryCopy.retrying,
            );
          },
        });
      }
      uploadCompleted = true;
      await loadPendingUploads();
      reportRecordingFailure({ recordingId: upload.recordingId, ok: true });
      await copyShareLink(upload.recordingId, targetServerUrl, {
        notify: false,
      });
      await openExternal(`${targetServerUrl}/r/${upload.recordingId}`);
      getCurrentWindow()
        .hide()
        .catch(() => {});
      emit("clips:popover-visible", false).catch(() => {});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        abortController.signal.aborted ||
        (err instanceof DOMException && err.name === "AbortError") ||
        message === "native recording upload retry cancelled"
      ) {
        await loadPendingUploads();
        return;
      }
      console.error("[clips-tray] retry saved upload failed:", err);
      setRecoveryActionErrors((errors) => ({ ...errors, [key]: message }));
      if (!uploadCompleted)
        reportRecordingFailure({
          recordingId: upload.recordingId,
          ok: false,
          error: message,
        });
      await loadPendingUploads();
    } finally {
      if (retryUploadAbortRef.current === abortController) {
        retryUploadAbortRef.current = null;
        retryUploadRecordingIdRef.current = null;
        retryingUploadKindRef.current = null;
      }
      setRetryingUploadId(null);
      setRetryingUploadStatus(null);
    }
  }

  function cancelPendingUploadRetry(upload: PendingDesktopUpload) {
    if (retryingUploadId !== recordingRecoveryKey(upload)) return;
    retryUploadAbortRef.current?.abort();
    if (retryingUploadKindRef.current === "native") {
      invoke("native_fullscreen_recording_cancel_retry", {
        recordingId: upload.recordingId,
      }).catch((err) => {
        console.error("[clips-tray] cancel saved upload retry failed:", err);
        setRecoveryActionErrors((errors) => ({
          ...errors,
          [recordingRecoveryKey(upload)]:
            err instanceof Error ? err.message : String(err),
        }));
        setRetryingUploadStatus(desktopRecoveryCopy.retrying);
      });
    }
    setRetryingUploadStatus(desktopRecoveryCopy.cancelling);
  }

  async function exportPendingUpload(upload: PendingDesktopUpload) {
    if (retryingUploadId || exportingUploadId) return;
    const key = recordingRecoveryKey(upload);
    setRecoveryActionErrors((errors) => {
      const next = { ...errors };
      delete next[key];
      return next;
    });

    if (upload.kind === "native") {
      openPendingUploadFolder(upload);
      return;
    }

    setExportingUploadId(key);
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
      setRecoveryActionErrors((errors) => ({ ...errors, [key]: message }));
    } finally {
      setExportingUploadId(null);
    }
  }

  function openPendingUploadFolder(upload: PendingDesktopUpload) {
    const key = recordingRecoveryKey(upload);
    setRecoveryActionErrors((errors) => {
      const next = { ...errors };
      delete next[key];
      return next;
    });
    if (upload.kind !== "native" || !upload.folderPath) {
      setRecoveryActionErrors((errors) => ({
        ...errors,
        [key]: desktopRecoveryCopy.completeCopyUnconfirmed,
      }));
      return;
    }
    invoke("open_local_recording_folder", {
      path: upload.folderPath,
    }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[clips-tray] open pending upload folder failed:", err);
      setRecoveryActionErrors((errors) => ({ ...errors, [key]: message }));
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
    resumeCapture?: RestartHandoff;
  }): Promise<RecorderHandle | null> {
    if (recordingStopFinalizingRef.current) {
      console.warn(
        "[clips-popover] handleStartRecording ignored — previous recording still finalizing",
      );
      return null;
    }
    if (
      recordingStartAttemptRef.current ||
      (!options?.resumeCapture &&
        (recorder ||
          recordingFlowGateRef.current ||
          restartInFlightRef.current ||
          recordingCancelInFlightRef.current))
    ) {
      console.warn(
        "[clips-popover] handleStartRecording ignored — recorder already active",
      );
      return null;
    }
    if (localRecordingMode === "off" && authStatus !== "authed") {
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

    const attempt = new RecordingStartAttempt();
    const startAttemptId = crypto.randomUUID();
    recoverySessionId.current = startAttemptId;
    recordingStartAttemptRef.current = attempt;
    recordingFlowGateRef.current = true;
    setRecordingStartPending(true);
    let handle: RecorderHandle | null = null;
    let startError: unknown = null;
    let parkPopoverTimer: number | null = null;
    try {
      stopAllMicMeters();
      (window as unknown as { clipsForceAlive?: boolean }).clipsForceAlive =
        true;
      if (nativeCaptureRecordingActive) {
        await prepareNativeRecordingStart(attempt, {
          windowCapture: nativeWindowRecordingActive,
          resumeCapture: Boolean(options?.resumeCapture),
          microphone: micOn,
        });
      }
      attempt.ensureActive();

      recordingFlowGateRef.current = true;
      setRecordingFlowActive(true);
      if (!nativeCaptureRecordingActive) {
        void boundedCleanup(invoke("set_recording_state", { active: true }));
      }

      const preAcquiredCameraStream =
        mode !== "screen" && cameraOn ? bubbleStreamRef.current : null;
      if (preAcquiredCameraStream) {
        bubbleStreamTransferredToRecorder.current = true;
      }

      (window as unknown as { clipsForceAlive?: boolean }).clipsForceAlive =
        true;

      const recordingPromise = startRecording({
        serverUrl,
        mode,
        source,
        cameraId,
        micId: selectedMicId || undefined,
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
        preAcquiredCaptureSuspension: attempt.captureSuspension,
        pendingTranscriptionTeardown:
          options?.resumeCapture?.transcriptionTornDown ?? null,
        signal: attempt.signal,
      });
      if (isMacPlatform() && !nativeCaptureRecordingActive) {
        parkPopoverTimer = window.setTimeout(() => {
          if (
            !attempt.signal.aborted &&
            recordingStartAttemptRef.current === attempt
          ) {
            invoke("park_popover_offscreen").catch(() => {});
            emit("clips:popover-visible", false).catch(() => {});
          }
        }, 250);
      }
      const started = await recordingPromise;
      if (attempt.signal.aborted) {
        await boundedCleanup(started.cancel());
        attempt.ensureActive();
      }
      handle = started;
      attempt.captureSuspension = null;
      console.log("[clips-popover] recorder handle received");
    } catch (err) {
      startError = err;
      if (!isRecordingStartCancellation(err)) {
        void notifyRecordingFailure({
          kind: "start",
          id: `start:${startAttemptId}`,
          localCopyVerified: false,
          title: desktopRecordingFailureCopy.startTitle,
          body: desktopRecordingFailureCopy.startBody,
          visible:
            recordingErrorVisibleRef.current.visible &&
            recordingErrorVisibleRef.current.view === "recorder",
        });
      }
    } finally {
      if (parkPopoverTimer !== null) {
        window.clearTimeout(parkPopoverTimer);
        parkPopoverTimer = null;
      }
      if (!handle && recordingStartAttemptRef.current === attempt) {
        attempt.cancel();
        console.warn(
          "[clips-popover] handleStartRecording finally: no handle — running recovery",
        );
        (window as unknown as { clipsForceAlive?: boolean }).clipsForceAlive =
          false;
        bubbleStreamTransferredToRecorder.current = false;
        await recoverRecordingStart(attempt, nativeWindowRecordingActive);
        recordingFlowGateRef.current = false;
        setRecordingFlowActive(false);
      }
      if (recordingStartAttemptRef.current === attempt) {
        recordingStartAttemptRef.current = null;
        setRecordingStartPending(false);
      }
    }

    if (handle) {
      setRecorder(handle);
      return handle;
    }

    console.error("[clips-popover] handleStartRecording failed:", startError);

    if (startError instanceof ScreenRecordingPermissionError) {
      setRecError(MACOS_SCREEN_PERMISSION_MESSAGE);
      openPrivacySettings("screen");
      return null;
    }

    const message =
      startError instanceof Error ? startError.message : String(startError);
    if (isRecordingStartCancellation(startError)) {
      return null;
    }
    if (isHardCapturePermissionError(message)) {
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
    if (
      message === RECORDING_SESSION_EXPIRED ||
      message === RECORDING_SERVER_UNAVAILABLE
    ) {
      setRecError(message);
      return null;
    }
    setRecError(message);
    return null;
  }

  async function reconnectSession() {
    const authResult = await checkAuth();
    if (authResult.state === "unavailable") {
      setRecError(RECORDING_SERVER_UNAVAILABLE);
      return;
    }
    if (
      authResult.state === "authenticated" ||
      authResult.state === "anonymous"
    ) {
      setRecError(null);
    }
  }

  handleStartRecordingRef.current = handleStartRecording;

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];
    const cancelStart = () => {
      if (restartInFlightRef.current) restartCancelledRef.current = true;
      recordingStartAttemptRef.current?.cancel();
    };
    for (const event of ["clips:recorder-cancel", "clips:countdown-cancel"]) {
      listen(event, cancelStart)
        .then((nextUnlisten) => {
          if (cancelled) {
            nextUnlisten();
            return;
          }
          unlisteners.push(nextUnlisten);
        })
        .catch(() => {});
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelStart();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelled = true;
      recordingStartAttemptRef.current?.cancel();
      unlisteners.forEach((unlisten) => unlisten());
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  function beginRecording(
    options?: Parameters<typeof handleStartRecording>[0],
    beginOptions?: { revealPopoverIfMicOff?: boolean },
  ) {
    if (!micOn) {
      if (beginOptions?.revealPopoverIfMicOff) {
        invoke("show_popover").catch(() => {});
      }
      setMicOffConfirmOpen(true);
      return;
    }
    void handleStartRecording(options);
  }

  function closeMicOffConfirmation() {
    setMicOffConfirmOpen(false);
  }

  recordShortcutHandlerRef.current = () => {
    if (recordingStartAttemptRef.current || restartInFlightRef.current) {
      if (restartInFlightRef.current) restartCancelledRef.current = true;
      recordingStartAttemptRef.current?.cancel();
      emit("clips:countdown-cancel").catch(() => {});
      return;
    }
    if (recorder) {
      emit("clips:recorder-stop").catch(() => {});
      return;
    }
    if (recordingFlowGateRef.current || recordingFlowActive) {
      emit("clips:countdown-cancel").catch(() => {});
      return;
    }
    if (recordingStopFinalizingRef.current) {
      invoke("show_popover").catch(() => {});
      return;
    }

    setPopoverView("recorder");
    if (authStatus !== "authed" && localRecordingMode === "off") {
      if (authStatus === "anon") {
        setRecError("Sign in to Clips before using the recording shortcut.");
      }
      invoke("show_popover").catch(() => {});
      return;
    }

    const canStartFromGlobalShortcut =
      mode === "camera" || nativeCaptureRecordingActive;
    if (!canStartFromGlobalShortcut) {
      setRecError(
        "Open Clips and click Start recording to use the selected source.",
      );
      invoke("show_popover").catch(() => {});
      return;
    }

    beginRecording(undefined, { revealPopoverIfMicOff: true });
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

  function retryCameraPreview() {
    setCameraError(null);
    if (!cameraOn) {
      setCameraOn(true);
      return;
    }
    setCameraOn(false);
    window.setTimeout(() => setCameraOn(true), 0);
  }

  useEffect(() => {
    if (!recorder) return;
    let cancelled = false;
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
      listen<{ recordingId?: string | null }>(
        "clips:recorder-session",
        (event) => {
          sessionRecordingIdRef.current = event.payload?.recordingId ?? null;
        },
      ),
    );
    track(
      listen("clips:recorder-stop", async () => {
        if (
          cancelled ||
          restartInFlightRef.current ||
          recordingStopFinalizingRef.current ||
          recordingCancelInFlightRef.current
        )
          return;
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
        setBubbleSessionEpoch((epoch) => epoch + 1);

        let stopFailed = false;
        let stopResult: RecorderStopResult | null = null;
        const stoppingRecordingId = sessionRecordingIdRef.current;
        try {
          stopResult = await handle.stop();
          if (stopResult.localOnly) {
            setLocalRecordingNotice({
              folderPath: stopResult.localFolder,
              files: stopResult.localFiles ?? [],
            });
            emit("clips:native-upload-finished", {
              recordingId: stopResult.recordingId,
              ok: true,
              localFilePath: stopResult.localFiles?.[0]?.path ?? null,
            }).catch(() => {});
          } else {
            setLastRecordingId(stopResult.recordingId);
            await copyShareLink(stopResult.recordingId, serverUrl, {
              notify: false,
            });
          }
        } catch (err) {
          stopFailed = true;
          setRecError(err instanceof Error ? err.message : String(err));
          if (!stopResult) {
            reportRecordingFailure(
              {
                recordingId: stoppingRecordingId ?? undefined,
                ok: false,
                error: err instanceof Error ? err.message : String(err),
              },
              localRecordingMode !== "off",
            );
            emit("clips:native-upload-finished", {
              recordingId: stoppingRecordingId ?? undefined,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            }).catch(() => {});
          }
          await loadPendingUploads();
        } finally {
          recordingStopFinalizingRef.current = false;
          setRecordingStopFinalizing(false);
          setRecError((message) =>
            clearResolvedFinalizationError(message, false),
          );
          invoke("set_recording_state", { active: false }).catch(() => {});
          if (stopFailed || stopResult?.localOnly) {
            invoke("show_popover").catch(() => {});
          } else {
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
        if (
          cancelled ||
          restartInFlightRef.current ||
          recordingStopFinalizingRef.current ||
          recordingCancelInFlightRef.current
        )
          return;
        recordingCancelInFlightRef.current = true;
        const cancelDone = recorder.cancel();
        // Optimistic feedback: bring the popover back and clear the tray's
        // recording state the moment the cancel is dispatched — the recorder
        // teardown can take seconds and neither call depends on it. The flow
        // gate below must NOT be released here: it stays latched until
        // cancel() resolves so a fast Start can't race the tearing-down
        // session.
        if (!cancelled) {
          invoke("set_recording_state", { active: false }).catch(() => {});
          invoke("show_popover").catch(() => {});
        }
        try {
          await cancelDone;
        } catch (err) {
          setRecError(err instanceof Error ? err.message : String(err));
        } finally {
          recordingCancelInFlightRef.current = false;
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
          }
        }
      }),
    );
    track(
      listen("clips:recorder-restart", async () => {
        if (
          cancelled ||
          recordingStopFinalizingRef.current ||
          recordingCancelInFlightRef.current
        )
          return;
        if (restartInFlightRef.current) return;
        restartInFlightRef.current = true;
        restartCancelledRef.current = false;
        let handoff: RestartHandoff | null = null;
        try {
          handoff = await recorder.discardForRestart();
          if (cancelled) return;
          if (restartCancelledRef.current) {
            await recorder.cancel();
            recordingFlowGateRef.current = false;
            (
              window as unknown as { clipsForceAlive?: boolean }
            ).clipsForceAlive = false;
            bubbleStreamTransferredToRecorder.current = false;
            bubbleStreamRef.current = null;
            setRecorder(null);
            setRecordingFlowActive(false);
            setBubbleSessionEpoch((epoch) => epoch + 1);
            void boundedCleanup(invoke("show_popover"));
            return;
          }
          setRecordingChromeEpoch((epoch) => epoch + 1);
          setRecorder(null);
          const restarted = await handleStartRecordingRef.current({
            resumeCapture: handoff,
          });
          if (restarted) handoff = null;
        } catch (err) {
          console.error("[clips-popover] restart failed:", err);
          setRecError(err instanceof Error ? err.message : String(err));
        } finally {
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
  }, [
    recorder,
    loadPendingUploads,
    reportRecordingFailure,
    localRecordingMode,
    serverUrl,
  ]);

  const showSourceRow = mode !== "camera";
  const imminentMeeting = meetings.find(meetingCanStartNotes) ?? null;
  const recordingReadinessPending =
    localRecordingMode === "off" &&
    (authStatus !== "authed" || videoStorageStatus === "checking");
  const startButtonLoading =
    (recordingReadinessPending || recordingStartPending) &&
    !recordingStopFinalizing;
  const startButtonLabel = recordingStopFinalizing
    ? desktopRecoveryCopy.finishing
    : mode === "camera"
      ? "Start camera recording"
      : localRecordingMode === "off"
        ? "Start recording"
        : "Start local recording";

  const recoveryProps: RecordingRecoveryProps = {
    uploads: pendingUploads,
    lookupErrors: recoverySnapshot.errors,
    actionErrors: recoveryActionErrors,
    refreshing: recoveryRefreshing,
    authenticated: authStatus === "authed",
    finalizing: recordingStopFinalizing,
    finalizingRecordingId: sessionRecordingIdRef.current,
    showFinalizing: popoverView !== "recorder" || authStatus !== "authed",
    retryingUploadId,
    retryingUploadStatus,
    exportingUploadId,
    needsStorage: isStorageSetupFailureMessage,
    onRefresh: () => void loadPendingUploads(),
    onExport: exportPendingUpload,
    onRetry: retryPendingUpload,
    onCancelRetry: cancelPendingUploadRetry,
    onOpenFolder: openPendingUploadFolder,
    onReviewFiles: (key) => {
      void invoke("native_fullscreen_open_drafts_folder").catch((error) => {
        setRecoveryActionErrors((errors) => ({
          ...errors,
          [key]: error instanceof Error ? error.message : String(error),
        }));
      });
    },
    onOpenLogs: (key) => {
      void invoke("open_logs").catch((error) => {
        setRecoveryActionErrors((errors) => ({
          ...errors,
          [key]: error instanceof Error ? error.message : String(error),
        }));
      });
    },
    onConnectStorage: (upload) => {
      const key = recordingRecoveryKey(upload);
      const targetServerUrl = serverUrlForPendingUpload(upload, serverUrl);
      setRecoveryActionErrors((errors) => {
        const next = { ...errors };
        delete next[key];
        return next;
      });
      void openExternal(`${targetServerUrl}/record`).catch((error) => {
        setRecoveryActionErrors((errors) => ({
          ...errors,
          [key]: error instanceof Error ? error.message : String(error),
        }));
      });
    },
  };
  const pendingUploadBanner = shouldShowRecordingRecoveryBanner(
    popoverView,
    authStatus === "authed",
  ) ? (
    <RecordingRecovery
      {...recoveryProps}
      onOpen={recoveryNavigation.openRecovery}
      triggerRef={recoveryNavigation.triggerRef}
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
                    checked={agentHandoff.includeMicrophone}
                    onCheckedChange={(includeMicrophone) =>
                      setAgentHandoff({ ...agentHandoff, includeMicrophone })
                    }
                    label="Include microphone audio"
                  />
                </div>
                <div className="setup-mini-field">
                  <span>System audio</span>
                  <Switch
                    checked={agentHandoff.includeSystemAudio}
                    onCheckedChange={(includeSystemAudio) =>
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

  if (popoverView === "recovery") {
    return (
      <div className="app app-popover-view" ref={appRef}>
        <RecordingRecoveryPage
          {...recoveryProps}
          onBack={recoveryNavigation.closeRecovery}
        />
      </div>
    );
  }

  if (popoverView === "memory") {
    return (
      <div className="app app-settings" ref={appRef}>
        {isRecording ? <ActiveRecordingBanner /> : null}
        <Setup
          surface="memory"
          meetingsLabEnabled={meetingsLabEnabled}
          wisprFlowLabEnabled={wisprFlowLabEnabled}
          recordingActive={isRecording || recordingFlowActive}
          initial={serverUrl}
          serverUrl={serverUrl}
          signedInAs={signedInAs}
          voiceShortcut={voiceShortcut}
          voiceCustomShortcut={voiceCustomShortcut}
          popoverCustomShortcut={popoverCustomShortcut}
          recordCustomShortcut={recordCustomShortcut}
          recordCancelShortcut={recordCancelShortcut}
          recordPauseShortcut={recordPauseShortcut}
          voiceMode={voiceMode}
          voiceProvider={voiceProvider}
          voiceInstructions={voiceInstructions}
          shortcutRegistrationError={shortcutRegistrationError}
          onVoiceShortcutChange={updateVoiceShortcut}
          onVoiceCustomShortcutChange={setVoiceCustomShortcut}
          onPopoverCustomShortcutChange={setPopoverCustomShortcut}
          onRecordCustomShortcutChange={setRecordCustomShortcut}
          onRecordCancelShortcutChange={setRecordCancelShortcut}
          onRecordPauseShortcutChange={setRecordPauseShortcut}
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
        {isRecording ? <ActiveRecordingBanner /> : null}
        <Setup
          initialSettingsTab={initialSettingsTab}
          onSettingsTabChange={setInitialSettingsTab}
          meetingsLabEnabled={meetingsLabEnabled}
          wisprFlowLabEnabled={wisprFlowLabEnabled}
          recordingActive={isRecording || recordingFlowActive}
          initial={serverUrl}
          serverUrl={serverUrl}
          signedInAs={signedInAs}
          voiceShortcut={voiceShortcut}
          voiceCustomShortcut={voiceCustomShortcut}
          popoverCustomShortcut={popoverCustomShortcut}
          recordCustomShortcut={recordCustomShortcut}
          recordCancelShortcut={recordCancelShortcut}
          recordPauseShortcut={recordPauseShortcut}
          voiceMode={voiceMode}
          voiceProvider={voiceProvider}
          voiceInstructions={voiceInstructions}
          shortcutRegistrationError={shortcutRegistrationError}
          onVoiceShortcutChange={updateVoiceShortcut}
          onVoiceCustomShortcutChange={setVoiceCustomShortcut}
          onPopoverCustomShortcutChange={setPopoverCustomShortcut}
          onRecordCustomShortcutChange={setRecordCustomShortcut}
          onRecordCancelShortcutChange={setRecordCancelShortcut}
          onRecordPauseShortcutChange={setRecordPauseShortcut}
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

  if (popoverView === "meetings" && meetingsLabEnabled) {
    return (
      <div className="app app-popover-view" ref={appRef}>
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
          calendarNeedsReauth={meetingsCalendarNeedsReauth}
        />
      </div>
    );
  }

  if (authStatus === "anon" || authStatus === "unavailable") {
    return (
      <div className="app" ref={appRef}>
        {/* Signed out, the only job on this screen is signing in. Capture
            modes, Feedback, and Settings all act on an account that does not
            exist yet, so they appear after auth rather than competing with it.
            The menubar toggle remains the single way to dismiss the popover. */}
        {signInPending === "google" ? (
          <div data-tw-surface>
            <Empty className="w-full border-none">
              <EmptyHeader>
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
                const authResult = await checkAuth();
                if (authResult.state === "unavailable") {
                  setSignInError(
                    "Signed in, but Clips couldn't reach the server to verify it. Try again.",
                  );
                }
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
          onContinue={() => {
            setMicOffConfirmOpen(false);
            void handleStartRecording();
          }}
        />
      ) : null}

      <div className="recorder-home-content">
        <Header mode={mode} onModeChange={selectCaptureMode} />
        <UpdateBanner />

        {meetingsLabEnabled && imminentMeeting ? (
          <ImminentMeetingRow
            meeting={imminentMeeting}
            onStartNotes={() => startMeetingNotes(imminentMeeting)}
          />
        ) : null}

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

        <div className="panel" inert={recordingStartPending}>
          {showSourceRow ? (
            <SourceRow
              value={source}
              onChange={setSource}
              includeRegion={isMacPlatform()}
            />
          ) : null}

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
            onToggle={toggleCamera}
          />

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
            meterActive={popoverVisible && !recordingInFlight}
          />
        </div>

        {!isRecording ? (
          <button
            data-recovery-focus-fallback
            className={cn(
              "primary start",
              startButtonLoading && "start-loading",
            )}
            disabled={
              recordingReadinessPending ||
              recordingStopFinalizing ||
              recordingStartPending
            }
            aria-busy={
              recordingReadinessPending ||
              recordingStopFinalizing ||
              recordingStartPending
            }
            aria-label={
              recordingStopFinalizing || recordingReadinessPending
                ? startButtonLabel
                : undefined
            }
            onClick={() => beginRecording()}
          >
            <span className="rec-dot" aria-hidden="true" />
            <span className="start-label">{startButtonLabel}</span>
            {startButtonLoading ? (
              <span
                aria-hidden="true"
                className="start-loading-shimmer skeleton-shimmer"
              />
            ) : null}
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
          ) : recError === RECORDING_SESSION_EXPIRED ? (
            <SessionExpiredBanner onReconnect={() => void reconnectSession()} />
          ) : recError === RECORDING_SERVER_UNAVAILABLE ? (
            <ServerUnavailableBanner onRetry={() => beginRecording()} />
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

      {pendingUploadBanner}

      <div className="bottom-row">
        {wisprFlowLabEnabled ? (
          <BottomHint
            label="Dictate"
            shortcut={compactVoiceShortcutLabel(
              voiceShortcut,
              voiceCustomShortcut,
            )}
          />
        ) : null}
        <BottomButton
          icon="library"
          label="Library"
          external
          onClick={() => openInBrowser("/")}
        />
        <BottomButton
          icon="settings"
          label="Settings"
          onClick={() => openSettings()}
        />
      </div>
    </div>
  );
}

function hidePopover() {
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
    <Alert variant="destructive" className="recovery-alert p-2 text-xs">
      <span className="recovery-alert-icon" aria-hidden>
        <IconAlertTriangle size={16} stroke={1.8} />
      </span>
      <div className="recovery-alert-copy">
        <AlertTitle className="mb-0">{title}</AlertTitle>
        <AlertDescription className="recovery-alert-description text-[11px] leading-tight">
          {message}
        </AlertDescription>
        <div className="permission-actions" aria-label="Permission recovery">
          {canOpenPrivacySettings
            ? uniquePanes.map((pane) => (
                <Button
                  type="button"
                  key={pane}
                  variant="outline"
                  size="sm"
                  className="permission-action h-7 px-2 text-xs"
                  onClick={() => openPrivacySettings(pane)}
                >
                  {permissionPaneLabel(pane)}
                </Button>
              ))
            : null}
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="permission-action permission-retry h-7 px-2 text-xs"
            onClick={onRetry}
          >
            Try again
          </Button>
        </div>
      </div>
    </Alert>
  );
}

function UpdateRestartBanner({ message }: { message: string }) {
  return (
    <Alert variant="destructive" className="recovery-alert p-2 text-xs">
      <span className="recovery-alert-icon" aria-hidden>
        <IconAlertTriangle size={16} stroke={1.8} />
      </span>
      <div className="recovery-alert-copy">
        <AlertTitle className="mb-0">Restart to finish updating</AlertTitle>
        <AlertDescription className="recovery-alert-description text-[11px] leading-tight">
          {message}
        </AlertDescription>
        <div className="permission-actions">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="permission-action permission-retry h-7 px-2 text-xs"
            onClick={() => {
              installAndRestart().catch((err) => {
                console.error("[clips-updater] relaunch failed:", err);
              });
            }}
          >
            Restart Clips
          </Button>
        </div>
      </div>
    </Alert>
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

function SessionExpiredBanner({ onReconnect }: { onReconnect: () => void }) {
  return (
    <Alert variant="destructive" className="recovery-alert p-2 text-xs">
      <span className="recovery-alert-icon" aria-hidden>
        <IconAlertTriangle size={16} stroke={1.8} />
      </span>
      <div className="recovery-alert-copy">
        <AlertTitle className="mb-0">Session expired</AlertTitle>
        <AlertDescription className="recovery-alert-description text-[11px] leading-tight">
          Sign in again to start recording.
        </AlertDescription>
        <div className="permission-actions" aria-label="Session recovery">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="permission-action permission-retry h-7 px-2 text-xs"
            onClick={onReconnect}
          >
            Sign in again
          </Button>
        </div>
      </div>
    </Alert>
  );
}

function ServerUnavailableBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert variant="destructive" className="recovery-alert p-2 text-xs">
      <span className="recovery-alert-icon" aria-hidden>
        <IconAlertTriangle size={16} stroke={1.8} />
      </span>
      <div className="recovery-alert-copy">
        <AlertTitle className="mb-0">Clips server unavailable</AlertTitle>
        <AlertDescription className="recovery-alert-description text-[11px] leading-tight">
          Check your connection, then try starting the recording again.
        </AlertDescription>
        <div className="permission-actions" aria-label="Server recovery">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="permission-action permission-retry h-7 px-2 text-xs"
            onClick={onRetry}
          >
            Try again
          </Button>
        </div>
      </div>
    </Alert>
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

function ImminentMeetingRow({
  meeting,
  onStartNotes,
}: {
  meeting: PopoverMeeting;
  onStartNotes: () => void;
}) {
  const startMs = Date.parse(meeting.scheduledStart ?? "");
  const endMs = Date.parse(meeting.scheduledEnd ?? "");
  const durationMinutes =
    !Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs > startMs
      ? Math.max(1, Math.round((endMs - startMs) / 60000))
      : null;

  return (
    <section className="imminent-meeting" aria-label="Upcoming meeting">
      <IconCalendarEvent size={20} stroke={1.8} aria-hidden />
      <div className="imminent-meeting-copy">
        <strong>
          {meeting.title}
          {durationMinutes ? ` · ${durationMinutes} min` : ""}
        </strong>
        <span>
          {meeting.platform || "Calendar"} · {formatMeetingWhen(meeting)}
        </span>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="imminent-meeting-action"
        onClick={onStartNotes}
      >
        Start notes
      </Button>
    </section>
  );
}

function Header({
  mode,
  onModeChange,
}: {
  mode: CaptureMode;
  onModeChange: (m: CaptureMode) => void;
}) {
  const modeOrder: CaptureMode[] = ["screen", "screen-camera", "camera"];
  const modeButtonRefs = useRef<
    Partial<Record<CaptureMode, HTMLButtonElement | null>>
  >({});

  function moveMode(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentMode: CaptureMode,
  ) {
    const currentIndex = modeOrder.indexOf(currentMode);
    let nextIndex = currentIndex;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % modeOrder.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + modeOrder.length) % modeOrder.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = modeOrder.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextMode = modeOrder[nextIndex];
    onModeChange(nextMode);
    requestAnimationFrame(() => modeButtonRefs.current[nextMode]?.focus());
  }

  return (
    <div className="header header-centered">
      <div
        className="mode-toggle"
        role="radiogroup"
        aria-label="Recording mode"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={mode === "screen" ? "active" : ""}
              role="radio"
              aria-checked={mode === "screen"}
              tabIndex={mode === "screen" ? 0 : -1}
              aria-label="Screen"
              ref={(button) => {
                modeButtonRefs.current.screen = button;
              }}
              onKeyDown={(event) => moveMode(event, "screen")}
              onClick={() => onModeChange("screen")}
            >
              <ScreenIcon />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Screen</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={mode === "screen-camera" ? "active" : ""}
              role="radio"
              aria-checked={mode === "screen-camera"}
              tabIndex={mode === "screen-camera" ? 0 : -1}
              aria-label="Screen and camera"
              ref={(button) => {
                modeButtonRefs.current["screen-camera"] = button;
              }}
              onKeyDown={(event) => moveMode(event, "screen-camera")}
              onClick={() => onModeChange("screen-camera")}
            >
              <ScreenCamIcon />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Screen and camera</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={mode === "camera" ? "active" : ""}
              role="radio"
              aria-checked={mode === "camera"}
              tabIndex={mode === "camera" ? 0 : -1}
              aria-label="Camera"
              ref={(button) => {
                modeButtonRefs.current.camera = button;
              }}
              onKeyDown={(event) => moveMode(event, "camera")}
              onClick={() => onModeChange("camera")}
            >
              <CamIcon />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Camera</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

export function SignInForm({
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
  const [twoFactorPending, setTwoFactorPending] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const twoFactorCodeRef = useRef<HTMLInputElement | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
  }>({});
  useEffect(() => {
    if (!magicLinkSentEmail) emailRef.current?.focus();
  }, [magicLinkSentEmail]);
  useEffect(() => {
    if (twoFactorPending) twoFactorCodeRef.current?.focus();
  }, [twoFactorPending]);

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
    const trimmedEmail = email.trim();
    const nextFieldErrors: { email?: string; password?: string } = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      nextFieldErrors.email = "Enter an email like you@example.com";
    }
    if (authMode === "password" && !twoFactorPending && !password) {
      nextFieldErrors.password = "Enter a password";
    }
    setFieldErrors(nextFieldErrors);
    if (nextFieldErrors.email || nextFieldErrors.password) {
      (nextFieldErrors.email ? emailRef : passwordRef).current?.focus();
      return;
    }
    if (twoFactorPending && !/^\d{6,8}$/.test(twoFactorCode)) {
      setError(desktopAuthCopy.codeRequired);
      twoFactorCodeRef.current?.focus();
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      if (authMode === "magic-link") {
        await onMagicLink(email.trim());
        return;
      }
      if (twoFactorPending) {
        const res = await fetch(
          `${serverUrl.replace(/\/+$/, "")}/_agent-native/auth/two-factor/verify`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: trimmedEmail,
              password,
              code: twoFactorCode,
            }),
            credentials: "include",
          },
        );
        const raw = await res.text();
        let json: { error?: string; ok?: boolean; token?: string } | null =
          null;
        try {
          json = raw
            ? (JSON.parse(raw) as {
                error?: string;
                ok?: boolean;
                token?: string;
              })
            : null;
        } catch {
          if (res.ok) throw new Error(desktopAuthCopy.verificationFailed);
        }
        if (!res.ok) {
          throw new Error(
            json?.error ||
              raw.slice(0, 200) ||
              `Couldn't verify the code (${res.status})`,
          );
        }
        if (json?.ok !== true || typeof json.token !== "string") {
          throw new Error(desktopAuthCopy.verificationFailed);
        }
        saveDesktopAuthToken(serverUrl, json.token);
        setPassword("");
        setTwoFactorCode("");
        setTwoFactorPending(false);
        await onSignedIn();
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
        twoFactorRedirect?: boolean;
        token?: string;
      } | null;
      if (!res.ok) {
        throw new Error(
          json?.error || "Couldn't sign you in. Check your email and password.",
        );
      }
      if (json?.twoFactorRedirect === true) {
        setTwoFactorPending(true);
        setTwoFactorCode("");
        return;
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
      <div className="signin-title">
        {twoFactorPending
          ? desktopAuthCopy.verificationTitle
          : "Welcome to Clips"}
      </div>
      {!twoFactorPending ? (
        <>
          <div className="signin-subtitle">
            Record your screen, camera, and mic. Share a link the moment you
            stop.
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
        </>
      ) : null}
      <div data-tw-surface className="grid w-full gap-2">
        {twoFactorPending ? (
          <Input
            ref={twoFactorCodeRef}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label={desktopAuthCopy.codePlaceholder}
            placeholder={desktopAuthCopy.codePlaceholder}
            className="h-9 text-sm"
            value={twoFactorCode}
            onChange={(e) => {
              setTwoFactorCode(e.target.value.replace(/\D/g, "").slice(0, 8));
              setError(null);
            }}
          />
        ) : (
          <>
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
                setFieldErrors((current) => ({
                  ...current,
                  email: undefined,
                }));
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
                  <p className="text-xs text-destructive">
                    {fieldErrors.password}
                  </p>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      <button
        type="submit"
        className="primary start"
        disabled={
          submitting ||
          !email ||
          (authMode === "password" && !password) ||
          (twoFactorPending && !twoFactorCode)
        }
      >
        {submitting
          ? twoFactorPending
            ? desktopAuthCopy.verifyingCode
            : authMode === "magic-link"
              ? "Sending…"
              : "Signing in…"
          : twoFactorPending
            ? desktopAuthCopy.verifyCode
            : authMode === "magic-link"
              ? "Continue"
              : "Sign in"}
      </button>
      {twoFactorPending ? (
        <button
          type="button"
          className="signin-alt signin-mode-link"
          onClick={() => {
            setError(null);
            setTwoFactorPending(false);
            setTwoFactorCode("");
            setPassword("");
          }}
        >
          {desktopAuthCopy.backToSignIn}
        </button>
      ) : null}
      {!twoFactorPending ? (
        <>
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
        </>
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
  calendarNeedsReauth,
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
  calendarNeedsReauth: boolean;
}) {
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
          Start live notes from calendar meetings without hunting through
          Settings.
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
          {calendarNeedsReauth ? (
            <p>Reconnect your calendar from the Meetings page.</p>
          ) : null}
          <button type="button" className="secondary" onClick={onRefresh}>
            Try again
          </button>
          {calendarNeedsReauth ? (
            <button
              type="button"
              className="secondary"
              onClick={onOpenMeetings}
            >
              Open Meetings
            </button>
          ) : null}
        </div>
      ) : loading ? (
        <div className="popover-empty-card">
          <strong>Loading meetings…</strong>
          <p>Checking your connected calendar.</p>
        </div>
      ) : meetings.length === 0 ? (
        <div className="popover-empty-card">
          <strong>
            {calendarNeedsReauth
              ? "Reconnect your calendar"
              : "No meetings ready"}
          </strong>
          <p>
            {calendarNeedsReauth
              ? "Your calendar connection needs attention before Clips can match meeting titles."
              : "Connect Google Calendar or open the Meetings page to see setup."}
          </p>
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
                            rewindHistory?.available === true,
                          )
                        : onStartNotes(
                            meeting,
                            rewindHistory?.available === true,
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

function BottomButton({
  icon,
  label,
  shortcut,
  external = false,
  onClick,
}: {
  icon: "library" | "settings";
  label: string;
  shortcut?: string;
  external?: boolean;
  onClick: () => void;
}) {
  const tooltipLabel = icon === "library" ? "Open library" : "Open settings";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="bottom-btn" onClick={onClick}>
          <span className="bottom-icon" aria-hidden="true">
            {icon === "library" ? <LibraryIcon /> : <SettingsIcon />}
          </span>
          <span className="bottom-label">{label}</span>
          {shortcut ? <ShortcutKeycaps shortcut={shortcut} /> : null}
          {external ? (
            <IconExternalLink
              className="bottom-external"
              size={16}
              stroke={1.75}
              aria-hidden
            />
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">{tooltipLabel}</TooltipContent>
    </Tooltip>
  );
}

function BottomHint({ label, shortcut }: { label: string; shortcut: string }) {
  return (
    <div
      className="bottom-btn bottom-btn-hint"
      role="note"
      aria-label={`Press ${shortcut} to dictate`}
    >
      <span className="bottom-icon" aria-hidden="true">
        <IconMicrophone2 size={18} stroke={1.75} />
      </span>
      <span className="bottom-label">{label}</span>
      <ShortcutKeycaps shortcut={shortcut} />
    </div>
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

type VoiceProviderStatus = {
  browser: true;
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
  onSettingsTabChange,
  meetingsLabEnabled,
  wisprFlowLabEnabled,
  recordingActive = false,
  initial,
  serverUrl,
  signedInAs,
  voiceShortcut,
  voiceCustomShortcut,
  popoverCustomShortcut,
  recordCustomShortcut,
  recordCancelShortcut,
  recordPauseShortcut,
  voiceMode,
  voiceProvider,
  voiceInstructions,
  shortcutRegistrationError,
  onVoiceShortcutChange,
  onVoiceCustomShortcutChange,
  onPopoverCustomShortcutChange,
  onRecordCustomShortcutChange,
  onRecordCancelShortcutChange,
  onRecordPauseShortcutChange,
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
  onSettingsTabChange?: (tab: SettingsTabId) => void;
  meetingsLabEnabled: boolean;
  wisprFlowLabEnabled: boolean;
  recordingActive?: boolean;
  initial?: string | null;
  serverUrl?: string;
  signedInAs?: string | null;
  voiceShortcut: VoiceShortcutPreference;
  voiceCustomShortcut: string;
  popoverCustomShortcut: string;
  recordCustomShortcut: string;
  recordCancelShortcut: string;
  recordPauseShortcut: string;
  voiceMode: VoiceMode;
  voiceProvider: VoiceProvider;
  voiceInstructions: string;
  shortcutRegistrationError: string | null;
  onVoiceShortcutChange: (value: VoiceShortcutPreference) => void;
  onVoiceCustomShortcutChange: (value: string) => void;
  onPopoverCustomShortcutChange: (value: string) => void;
  onRecordCustomShortcutChange: (value: string) => void;
  onRecordCancelShortcutChange: (value: string) => void;
  onRecordPauseShortcutChange: (value: string) => void;
  onVoiceModeChange: (value: VoiceMode) => void;
  onVoiceProviderChange: (value: VoiceProvider) => void;
  onVoiceInstructionsChange: (value: string) => void;
  onConnect: (url: string) => void;
  rewindAgentPromptCopied: boolean;
  onCopyRewindAgentPrompt: () => void;
  onOpenRewindDocs: () => void;
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

  useEffect(() => {
    if (surface !== "settings" || settingsTab !== "rewind") return;
    if (screenMemory.enabled !== true) return;
    refreshRewindEgressLog();
  }, [surface, settingsTab, screenMemory.enabled]);

  useEffect(() => {
    const base = (serverUrl ?? initial ?? DEFAULT_URL).replace(/\/+$/, "");
    let cancelled = false;
    setProviderStatusLoading(true);
    void (async () => {
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

  const settingsTabIsAvailable =
    settingsTab === "general" ||
    settingsTab === "recording" ||
    settingsTab === "rewind" ||
    settingsTab === "advanced" ||
    (settingsTab === "meetings" && meetingsLabEnabled) ||
    (settingsTab === "dictation" && wisprFlowLabEnabled);

  useEffect(() => {
    if (surface !== "settings" || settingsTabIsAvailable) return;
    setSettingsTab("general");
  }, [settingsTabIsAvailable, surface]);

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
            label="Start / stop recording"
            description="Start and stop a recording from any app"
            control={
              <ShortcutRecorder
                value={recordCustomShortcut}
                placeholder={compactShortcutLabel(
                  isMacPlatform() ? "Cmd+Shift+L" : "Ctrl+Shift+L",
                )}
                onChange={onRecordCustomShortcutChange}
              />
            }
          />
          <SettingsRow
            label="Cancel recording"
            description="Cancel a recording without saving it"
            control={
              <ShortcutRecorder
                value={recordCancelShortcut}
                placeholder={compactShortcutLabel("Alt+Shift+C")}
                onChange={onRecordCancelShortcutChange}
              />
            }
          />
          <SettingsRow
            label="Pause / resume recording"
            description="Pause and resume an active recording"
            control={
              <ShortcutRecorder
                value={recordPauseShortcut}
                placeholder={
                  isMacPlatform()
                    ? compactShortcutLabel("Alt+Shift+P")
                    : "Alt Shift P / S"
                }
                onChange={onRecordPauseShortcutChange}
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
                  disabled={screenMemoryConfigBusy || !featureConfig}
                  onClick={(event) => {
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
                  if (next) {
                    setRewindConsentOpen(true);
                    return;
                  }
                  void setScreenMemoryConfig({ enabled: false });
                }}
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
                          void saveApiKey();
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
                placeholder="Set"
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
  }> = [
    {
      id: "general",
      label: "General",
      icon: (
        <IconAdjustmentsHorizontal size={16} stroke={1.7} aria-hidden="true" />
      ),
    },
    {
      id: "recording",
      label: "Recording",
      icon: <IconVideo size={16} stroke={1.7} aria-hidden="true" />,
    },
    {
      id: "rewind",
      label: "Rewind",
      icon: <IconHistory size={16} stroke={1.7} aria-hidden="true" />,
    },
    ...(meetingsLabEnabled
      ? [
          {
            id: "meetings" as const,
            label: "Meetings",
            icon: <IconCalendar size={16} stroke={1.7} aria-hidden="true" />,
          },
        ]
      : []),
    ...(wisprFlowLabEnabled
      ? [
          {
            id: "dictation" as const,
            label: "Dictation",
            icon: <IconMicrophone size={16} stroke={1.7} aria-hidden="true" />,
          },
        ]
      : []),
    {
      id: "advanced",
      label: "Advanced",
      icon: <IconTool size={16} stroke={1.7} aria-hidden="true" />,
    },
  ];
  const activeSettingsTab =
    settingsTabs.find((tab) => tab.id === settingsTab) ?? settingsTabs[0];

  function renderSettingsTab() {
    switch (activeSettingsTab?.id) {
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
      className="flex h-[560px] w-full flex-col overflow-hidden rounded-[14px] bg-background text-foreground"
    >
      <div className="grid min-h-0 flex-1 grid-cols-[176px_minmax(0,1fr)]">
        <nav
          className="flex min-w-0 flex-col gap-0.5 overflow-y-auto border-r border-border bg-muted/50 p-2.5 pt-3"
          aria-label="Settings sections"
        >
          <div className="flex items-center pb-2">
            {onCancel ? <BackToApp onClick={onCancel} /> : null}
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
              onClick={() => {
                setSettingsTab(tab.id);
                onSettingsTabChange?.(tab.id);
              }}
            >
              {tab.icon}
              <span className="flex-1 truncate">{tab.label}</span>
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
