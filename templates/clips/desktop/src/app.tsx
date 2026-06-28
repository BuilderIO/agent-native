import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCircleCheck,
  IconDownload,
  IconExternalLink,
  IconFolderOpen,
  IconPencil,
  IconInfoCircle,
  IconRefresh,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { FeedbackButton } from "./components/FeedbackButton";
import {
  CamIcon,
  ClockIcon,
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
import { startBubbleFramePump } from "./lib/bubble-pump";
import {
  startBubbleWebrtc,
  type BubbleWebrtcHandle,
} from "./lib/bubble-webrtc";
import {
  isHardCapturePermissionError,
  MACOS_CAPTURE_PERMISSION_MESSAGE,
  MACOS_SPEECH_PERMISSION_MESSAGE,
} from "./lib/permissions";
import { isMacPlatform, isWindowsPlatform } from "./lib/platform";
import {
  discardBrowserRecordingBackup,
  exportBrowserRecordingBackup,
  listBrowserRecordingBackups,
  retryBrowserRecordingBackup,
  shouldUseNativeFullscreenRecording,
  startRecording,
  type LocalExportedFile,
  type PendingBrowserRecordingUpload,
  type RecorderHandle,
  type RecorderStopResult,
} from "./lib/recorder";
import {
  loadBool,
  loadString,
  loadStringAllowEmpty,
  saveBool,
  saveString,
} from "./lib/storage";
import { normalizeServerUrl } from "./lib/url";
import {
  installDesktopVoiceDictation,
  type VoiceMode,
  type VoiceProvider,
  type VoiceShortcutPreference,
  type VoiceTextDelivery,
} from "./lib/voice-dictation";
import { useFeatureConfig, type LocalRecordingMode } from "./shared/config";

interface RecordingSummary {
  id: string;
  title: string;
  durationMs: number;
  thumbnailUrl: string | null;
  updatedAt: string;
}

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

interface LocalRecordingNotice {
  folderPath?: string;
  files: LocalExportedFile[];
}

type MeetingTranscriptionMode = "manual" | "ask" | "auto";

type CaptureMode = "screen" | "screen-camera" | "camera";
type VideoStorageStatus = "checking" | "configured" | "missing";

const STORAGE_SETUP_HELP_TEXT =
  "Clips is 100% free and open source, so you need to hook up a way to store your clips. Connect storage with Builder.io for free-tier storage and AI, or use S3-compatible object storage and your own LLM keys.";
const STORAGE_SETUP_FAILURE_RE =
  /video storage is not connected|no video storage configured|file upload provider|storage provider|connect builder|s3-compatible/i;

function isStorageSetupFailureMessage(message: string | null | undefined) {
  return STORAGE_SETUP_FAILURE_RE.test(message ?? "");
}

const STORAGE_KEY = "clips:server-url";
const MODE_KEY = "clips:last-mode";
const VOICE_SHORTCUT_KEY = "clips:voice-shortcut";
const VOICE_SHORTCUT_CONFIGURED_KEY = "clips:voice-shortcut-configured";
const VOICE_CUSTOM_SHORTCUT_KEY = "clips:voice-custom-shortcut";
const POPOVER_CUSTOM_SHORTCUT_KEY = "clips:popover-custom-shortcut";
const VOICE_MODE_KEY = "clips:voice-mode";
const VOICE_PROVIDER_KEY = "clips:voice-provider";
const VOICE_TEXT_DELIVERY_KEY = "clips:voice-text-delivery";
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

function resolveDesktopThumbnailUrl(
  rawUrl: string | null | undefined,
  serverUrl: string,
): string | null {
  if (!rawUrl) return null;
  if (
    rawUrl.startsWith("http://") ||
    rawUrl.startsWith("https://") ||
    rawUrl.startsWith("data:") ||
    rawUrl.startsWith("blob:")
  ) {
    return rawUrl;
  }
  if (rawUrl.startsWith("/")) {
    return `${serverUrl.replace(/\/+$/, "")}${rawUrl}`;
  }
  return rawUrl;
}

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
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
  microphone:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  screen:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  speech:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition",
  accessibility:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  "input-monitoring":
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
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
  const [voiceMode, setVoiceMode] = useState<VoiceMode>(() => {
    const saved = loadString(VOICE_MODE_KEY, "push-to-talk");
    return saved === "toggle" ? "toggle" : "push-to-talk";
  });
  const [voiceProvider, setVoiceProvider] = useState<VoiceProvider>(() => {
    return normalizeVoiceProvider(
      loadString(VOICE_PROVIDER_KEY, nativeVoiceProvider()),
    );
  });
  const [voiceTextDelivery, setVoiceTextDelivery] = useState<VoiceTextDelivery>(
    () => {
      const saved = loadString(VOICE_TEXT_DELIVERY_KEY, "paste-and-copy");
      return saved === "copy-only" || saved === "type-only"
        ? saved
        : "paste-and-copy";
    },
  );
  const [voiceInstructions, setVoiceInstructions] = useState<string>(() =>
    loadString(VOICE_INSTRUCTIONS_KEY, ""),
  );
  const localRecordingMode: LocalRecordingMode =
    featureConfig?.localRecordingMode ?? "off";

  const [recordings, setRecordings] = useState<RecordingSummary[]>([]);
  const [pendingUploads, setPendingUploads] = useState<PendingDesktopUpload[]>(
    [],
  );
  const [retryingUploadId, setRetryingUploadId] = useState<string | null>(null);
  const [exportingUploadId, setExportingUploadId] = useState<string | null>(
    null,
  );
  const [discardingUploadId, setDiscardingUploadId] = useState<string | null>(
    null,
  );
  const [localRecordingNotice, setLocalRecordingNotice] =
    useState<LocalRecordingNotice | null>(null);
  const [showRecent, setShowRecent] = useState(false);
  const [readinessOpen, setReadinessOpen] = useState<boolean>(
    () => !loadBool(READINESS_REVIEWED_KEY, false),
  );
  const [showSettings, setShowSettings] = useState(false);
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
      textDelivery: voiceTextDelivery,
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
    voiceTextDelivery,
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
  }, [popoverCustomShortcut, voiceCustomShortcut, voiceShortcut]);

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
      import("@tauri-apps/plugin-shell")
        .then(({ open }) => open(url))
        .catch((err) => {
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
    setShowSettings(false);
  }

  // ---- Esc closes the popover --------------------------------------------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // Don't close mid-recording — user would lose the recorder handle.
        if (isRecording) return;
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
        setPopoverVisible(!!ev.payload);
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
        invoke("hide_overlays").catch(() => {});
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

    navigator.mediaDevices
      .getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          ...(cameraId ? { deviceId: { exact: cameraId } } : {}),
        },
        audio: false,
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
          setCameraError(MACOS_CAPTURE_PERMISSION_MESSAGE);
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
        invoke("hide_overlays").catch(() => {});
      }
    };
  }, [bubbleActive, cameraId]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    listen("clips:release-camera", () => {
      console.log(`[popover] releasing camera`);
      bubbleStreamRef.current?.getTracks().forEach((t) => t.stop());
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

  // ---- auto-size popover to content --------------------------------------
  // The Tauri window is fixed-size via tauri.conf.json, but our content
  // height varies (more rows when a camera is on, Recent list toggle, etc.).
  // A descendant-aware observer tells Rust what the current content height is
  // and we call `resize_popover` to match.
  const appRef = useRef<HTMLDivElement | null>(null);
  usePopoverAutoSize(appRef, {
    disabled: !popoverVisible || isRecording || recordingFlowActive,
    width: showSettings ? 440 : 360,
  });

  // ---- recent list --------------------------------------------------------

  const fetchRecent = useCallback(async () => {
    if (authStatus !== "authed") return; // don't bother; would just 401
    try {
      const url = `${serverUrl.replace(/\/+$/, "")}/_agent-native/actions/list-recordings?limit=3&sort=recent`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return;
      const json = await res.json();
      const list = Array.isArray(json?.recordings) ? json.recordings : [];
      setRecordings(
        list.slice(0, 3).map((r: any) => ({
          id: r.id,
          title: r.title ?? "Untitled",
          durationMs: r.durationMs ?? 0,
          thumbnailUrl: r.thumbnailUrl ?? null,
          updatedAt: r.updatedAt ?? r.createdAt,
        })),
      );
    } catch {
      // ignore — server may be unreachable, we still render the chrome
    }
  }, [serverUrl, authStatus]);

  const loadPendingUploads = useCallback(async () => {
    try {
      const nativeList = await invoke<Omit<PendingNativeUpload, "kind">[]>(
        "native_fullscreen_pending_uploads",
      );
      const browserList = await listBrowserRecordingBackups();
      const nativeUploads = Array.isArray(nativeList)
        ? nativeList.map((upload) => ({
            ...upload,
            kind: "native" as const,
          }))
        : [];
      setPendingUploads(
        [...nativeUploads, ...browserList].sort((a, b) =>
          b.savedAt.localeCompare(a.savedAt),
        ),
      );
    } catch (err) {
      console.warn("[clips-tray] pending upload lookup failed:", err);
      setPendingUploads([]);
    }
  }, []);

  useEffect(() => {
    fetchRecent();
  }, [fetchRecent]);

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
  useEffect(() => saveString(VOICE_MODE_KEY, voiceMode), [voiceMode]);
  useEffect(
    () => saveString(VOICE_PROVIDER_KEY, voiceProvider),
    [voiceProvider],
  );
  useEffect(
    () => saveString(VOICE_TEXT_DELIVERY_KEY, voiceTextDelivery),
    [voiceTextDelivery],
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
    if (retryingUploadId || exportingUploadId || discardingUploadId) return;
    const targetServerUrl = serverUrlForPendingUpload(upload, serverUrl);
    setRecError(null);
    setRetryingUploadId(upload.recordingId);
    try {
      const authToken = loadDesktopAuthToken(targetServerUrl);
      if (upload.kind === "native") {
        await invoke("native_fullscreen_recording_retry_upload", {
          serverUrl: targetServerUrl,
          recordingId: upload.recordingId,
          authToken,
          cookie: typeof document !== "undefined" ? document.cookie || "" : "",
        });
      } else {
        await retryBrowserRecordingBackup({
          recordingId: upload.recordingId,
          serverUrl: targetServerUrl,
          authToken,
        });
      }
      await loadPendingUploads();
      await fetchRecent();
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
    if (retryingUploadId || exportingUploadId || discardingUploadId) return;
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

  async function discardPendingUpload(upload: PendingDesktopUpload) {
    if (retryingUploadId || exportingUploadId || discardingUploadId) return;
    setRecError(null);
    setDiscardingUploadId(upload.recordingId);
    setPendingUploads((uploads) =>
      uploads.filter((item) => item.recordingId !== upload.recordingId),
    );
    try {
      if (upload.kind === "native") {
        await invoke("native_fullscreen_recording_discard_upload", {
          recordingId: upload.recordingId,
        });
      } else {
        await discardBrowserRecordingBackup(upload.recordingId);
      }
      await loadPendingUploads();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[clips-tray] discard saved upload failed:", err);
      setRecError(message);
      await loadPendingUploads();
    } finally {
      setDiscardingUploadId(null);
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
    if (recorder && !options?.ignoreActiveRecorder) return;
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
          setRecError(MACOS_CAPTURE_PERMISSION_MESSAGE);
          openPrivacySettings("screen");
          return;
        }
      } catch (err) {
        setReadinessOpen(true);
        setRecError(err instanceof Error ? err.message : String(err));
        return;
      }
    }

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
      setRecError(MACOS_CAPTURE_PERMISSION_MESSAGE);
      return;
    }
    if (isStorageSetupFailureMessage(message)) {
      setRecError(STORAGE_SETUP_HELP_TEXT);
      openVideoStorageSetup();
      return;
    }
    setRecError(message);
  }

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
        let stopFailed = false;
        let stopResult: RecorderStopResult | null = null;
        try {
          stopResult = await recorder.stop();
          if (cancelled) return;
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
          if (!cancelled) {
            setRecError(err instanceof Error ? err.message : String(err));
            await loadPendingUploads();
          }
        } finally {
          if (!cancelled) {
            // Clear the force-alive flag — recording is done, the pump
            // can honor document.hidden normally again.
            (
              window as unknown as { clipsForceAlive?: boolean }
            ).clipsForceAlive = false;
            // Recorder has stopped its tracks; next popover session can
            // acquire the camera cleanly again.
            bubbleStreamTransferredToRecorder.current = false;
            bubbleStreamRef.current = null;
            recordingFlowGateRef.current = false;
            setRecorder(null);
            setRecordingFlowActive(false);
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
            if (!stopResult?.localOnly) {
              fetchRecent();
            }
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
  }, [recorder, fetchRecent, loadPendingUploads]);

  // Auto-hide on blur is handled on the Rust side (tauri::WindowEvent::Focused).

  const showCameraRow = mode !== "screen"; // screen-only has no camera
  const showSourceRow = mode !== "camera"; // camera-only has no screen source

  // During recording the popover is normally hidden — the tray click and the
  // global shortcut both emit `clips:recorder-stop` directly, and the
  // floating left-edge toolbar has the canonical Stop button. If the popover
  // does somehow end up visible (dock reopen, global-shortcut race, etc.),
  // we just render the normal pre-record panel so the user at least knows
  // where they are. No recording-only UI lives here.

  if (showSettings) {
    return (
      <div className="app app-settings" ref={appRef}>
        <Setup
          initial={serverUrl}
          serverUrl={serverUrl}
          signedInAs={signedInAs}
          voiceShortcut={voiceShortcut}
          voiceCustomShortcut={voiceCustomShortcut}
          popoverCustomShortcut={popoverCustomShortcut}
          voiceMode={voiceMode}
          voiceProvider={voiceProvider}
          voiceTextDelivery={voiceTextDelivery}
          voiceInstructions={voiceInstructions}
          shortcutRegistrationError={shortcutRegistrationError}
          onVoiceShortcutChange={updateVoiceShortcut}
          onVoiceCustomShortcutChange={setVoiceCustomShortcut}
          onPopoverCustomShortcutChange={setPopoverCustomShortcut}
          onVoiceModeChange={setVoiceMode}
          onVoiceProviderChange={setVoiceProvider}
          onVoiceTextDeliveryChange={setVoiceTextDelivery}
          onVoiceInstructionsChange={setVoiceInstructions}
          onSignOut={signOut}
          onConnect={(url) => {
            saveString(STORAGE_KEY, url.replace(/\/+$/, ""));
            setServerUrl(url.replace(/\/+$/, ""));
            setShowSettings(false);
          }}
          onCancel={() => setShowSettings(false)}
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
          <a className="footer-link" onClick={() => setShowSettings(true)}>
            Settings
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="app" ref={appRef}>
      <Header mode={mode} onModeChange={setMode} submitterEmail={signedInAs} />
      <UpdateBanner />

      {pendingUploads.length > 0 ? (
        <PendingUploadBanner
          uploads={pendingUploads}
          retryingUploadId={retryingUploadId}
          exportingUploadId={exportingUploadId}
          discardingUploadId={discardingUploadId}
          onExport={exportPendingUpload}
          onRetry={retryPendingUpload}
          onDiscard={discardPendingUpload}
          onOpenFolder={openPendingUploadFolder}
          onConnectStorage={(upload) => openVideoStorageSetup(upload.serverUrl)}
        />
      ) : null}

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
          meterActive={popoverVisible && !isRecording}
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
      {recError ? (
        recError === MACOS_CAPTURE_PERMISSION_MESSAGE ? (
          <PermissionRecoveryBanner
            kind="recording"
            message={recError}
            panes={permissionPanesForRecording(mode, cameraOn, micOn)}
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
          <StorageConnectionBanner onConnect={() => openVideoStorageSetup()} />
        ) : (
          <div className="error-banner">{recError}</div>
        )
      ) : null}
      {cameraError && !recError ? (
        cameraError === MACOS_CAPTURE_PERMISSION_MESSAGE ? (
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

      <div className="bottom-row">
        <BottomButton
          icon="library"
          label="Library"
          onClick={() => openInBrowser("/")}
        />
        <BottomButton
          icon="settings"
          label="Settings"
          onClick={() => setShowSettings(true)}
        />
        <BottomButton
          icon="recent"
          label="Recent"
          badge={undefined}
          onClick={() => setShowRecent((v) => !v)}
        />
      </div>

      {showRecent && recordings.length > 0 ? (
        <div className="recent-list">
          {recordings.map((r) => (
            <button
              key={r.id}
              className="recent-item"
              onClick={() => openInBrowser(`/r/${r.id}`)}
            >
              {r.thumbnailUrl ? (
                <img
                  className="thumb"
                  src={
                    resolveDesktopThumbnailUrl(r.thumbnailUrl, serverUrl) ?? ""
                  }
                  alt=""
                />
              ) : (
                <div className="thumb thumb-placeholder" />
              )}
              <div className="recent-meta">
                <div className="recent-title">{r.title}</div>
                <div className="recent-sub">{formatAgo(r.updatedAt)}</div>
              </div>
            </button>
          ))}
        </div>
      ) : null}
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

  return (
    <div className="error-banner permission-banner">
      <div className="permission-copy">
        <div className="permission-title">{title}</div>
        <div>{message}</div>
      </div>
      <div className="permission-actions" aria-label="Open privacy settings">
        {uniquePanes.map((pane) => (
          <button
            type="button"
            key={pane}
            onClick={() => openPrivacySettings(pane)}
          >
            {permissionPaneLabel(pane)}
          </button>
        ))}
        <button type="button" className="permission-retry" onClick={onRetry}>
          Try again
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
  discardingUploadId,
  onExport,
  onRetry,
  onDiscard,
  onOpenFolder,
  onConnectStorage,
}: {
  uploads: PendingDesktopUpload[];
  retryingUploadId: string | null;
  exportingUploadId: string | null;
  discardingUploadId: string | null;
  onExport: (upload: PendingDesktopUpload) => void;
  onRetry: (upload: PendingDesktopUpload) => void;
  onDiscard: (upload: PendingDesktopUpload) => void;
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
    !!retryingUploadId || !!exportingUploadId || !!discardingUploadId;
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
            ? `${details.join(" · ")} · discard and record again`
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
        {latest.kind === "native" && latest.corrupt ? (
          <button
            type="button"
            className="pending-upload-discard"
            disabled={actionsDisabled}
            onClick={() => onDiscard(latest)}
            aria-label="Discard corrupted clip"
            title="This clip is corrupted and cannot be recovered. Discard it and record again."
          >
            <IconTrash size={14} stroke={2} />
          </button>
        ) : (
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
            <button
              type="button"
              className="pending-upload-discard"
              disabled={actionsDisabled}
              onClick={() => onDiscard(latest)}
              aria-label="Discard saved local clip"
              title="Discard saved local clip"
            >
              <IconTrash size={14} stroke={2} />
            </button>
          </>
        )}
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

function BottomButton({
  icon,
  label,
  badge,
  onClick,
}: {
  icon: "library" | "settings" | "recent";
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
        ) : (
          <ClockIcon />
        )}
        {badge ? <span className="badge">{badge}</span> : null}
      </span>
      <span className="bottom-label">{label}</span>
    </button>
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

function Setup({
  initial,
  serverUrl,
  signedInAs,
  voiceShortcut,
  voiceCustomShortcut,
  popoverCustomShortcut,
  voiceMode,
  voiceProvider,
  voiceTextDelivery,
  voiceInstructions,
  shortcutRegistrationError,
  onVoiceShortcutChange,
  onVoiceCustomShortcutChange,
  onPopoverCustomShortcutChange,
  onVoiceModeChange,
  onVoiceProviderChange,
  onVoiceTextDeliveryChange,
  onVoiceInstructionsChange,
  onConnect,
  onCancel,
  onSignOut,
}: {
  initial?: string | null;
  serverUrl?: string;
  signedInAs?: string | null;
  voiceShortcut: VoiceShortcutPreference;
  voiceCustomShortcut: string;
  popoverCustomShortcut: string;
  voiceMode: VoiceMode;
  voiceProvider: VoiceProvider;
  voiceTextDelivery: VoiceTextDelivery;
  voiceInstructions: string;
  shortcutRegistrationError: string | null;
  onVoiceShortcutChange: (value: VoiceShortcutPreference) => void;
  onVoiceCustomShortcutChange: (value: string) => void;
  onPopoverCustomShortcutChange: (value: string) => void;
  onVoiceModeChange: (value: VoiceMode) => void;
  onVoiceProviderChange: (value: VoiceProvider) => void;
  onVoiceTextDeliveryChange: (value: VoiceTextDelivery) => void;
  onVoiceInstructionsChange: (value: string) => void;
  onConnect: (url: string) => void;
  onCancel?: () => void;
  onSignOut?: () => void;
}) {
  const [url, setUrl] = useState(initial ?? DEFAULT_URL);
  const [readinessOpen, setReadinessOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const featureConfig = useFeatureConfig();
  const voiceEnabled = featureConfig?.voiceEnabled !== false;
  const meetingsEnabled = featureConfig?.meetingsEnabled !== false;
  const launchAtLoginEnabled = featureConfig?.launchAtLoginEnabled !== false;
  const autoHidePopoverEnabled = featureConfig?.autoHidePopoverEnabled === true;
  const showInScreenCapture = featureConfig?.showInScreenCapture === true;
  const localRecordingMode = featureConfig?.localRecordingMode ?? "off";
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
    inputRef.current?.focus();
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
  const textDeliveryHint: Record<VoiceTextDelivery, string> = {
    "paste-and-copy":
      "Paste the text into the focused field and keep a copy on the clipboard.",
    "copy-only": "Only copy the text to the clipboard. Paste it yourself.",
    "type-only":
      "Type the text into the focused field without changing the clipboard.",
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

  return (
    <form className="setup" onSubmit={handleSubmit}>
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
          ref={inputRef}
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://localhost:8080"
        />
        <button className="primary" type="submit">
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
            hint="By default the Clips window and recording overlays are hidden from screenshots and screen recordings so they never leak into your captured video. Turn on for debugging or demos."
          />
          <Switch
            on={showInScreenCapture}
            onChange={setShowInScreenCapture}
            label="Show Clips in screen captures"
          />
        </div>
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

          <div className="setup-section">
            <SettingLabel
              label="Text delivery"
              hint="What happens with the transcribed text once dictation stops."
              htmlFor="voice-text-delivery"
            />
            <select
              id="voice-text-delivery"
              className="setup-select"
              value={voiceTextDelivery}
              onChange={(event) =>
                onVoiceTextDeliveryChange(
                  event.target.value as VoiceTextDelivery,
                )
              }
            >
              <option value="paste-and-copy">Paste into field and copy</option>
              <option value="copy-only">Copy to clipboard only</option>
              <option value="type-only">Type into field only</option>
            </select>
            <p className="setup-hint">{textDeliveryHint[voiceTextDelivery]}</p>
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
    </form>
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
