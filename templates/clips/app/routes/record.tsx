import {
  captureClientException,
  trackEvent,
} from "@agent-native/core/client/analytics";
import {
  agentNativePath,
  appBasePath,
} from "@agent-native/core/client/api-path";
import {
  callAction,
  getBrowserTabId,
  useSession,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useLiveTranscription } from "@agent-native/core/client/transcription/use-live-transcription";
import type { BrowserDiagnosticsData } from "@shared/browser-diagnostics";
import {
  isStoredButUnservableFinalizeError,
  waitForAcceptedRecordingAfterFinalizeError,
} from "@shared/finalize-recovery";
import {
  classifyUploadResponseError,
  chunkUploadParallelism,
  chunkUploadUrl,
  pickMimeType,
  UPLOAD_SLICE_BYTES,
  type UploadMode,
} from "@shared/recording-core";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCamera,
  IconCircleCheck,
  IconDeviceDesktop,
  IconDownload,
  IconExternalLink,
  IconMicrophone,
  IconRefresh,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { useLocation, useNavigate } from "react-router";

import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { useDesktopPromo } from "@/hooks/use-desktop-promo";
import { useRecordingLeaveGuard } from "@/hooks/use-recording-leave-guard";
import { useSonnerLifecycleToast } from "@/hooks/use-sonner-lifecycle-toast";
import {
  fetchVideoStorageStatus,
  useVideoStorageStatus,
  VIDEO_STORAGE_STATUS_KEY,
  type VideoStorageStatus,
} from "@/hooks/use-video-storage-status";
import enMessages from "@/i18n/en-US";
import {
  createBrowserDiagnosticsCapture,
  type BrowserDiagnosticsCapture,
} from "@/lib/browser-diagnostics-capture";
import {
  getCaptureHostApp,
  macPermissionGuidanceFor,
} from "@/lib/capture-permissions";
import {
  COMPRESS_THRESHOLD_BYTES,
  COMPRESSION_ENABLED,
  MAX_UPLOAD_BYTES,
  compressBlobIfTooLarge,
  formatMb,
} from "@/lib/compress";
import {
  createCountdownAudioCue,
  type CountdownAudioCue,
} from "@/lib/countdown-audio-cue";
import { takePendingUploadFile } from "@/lib/pending-upload-file";
import {
  loadRecorderPreferences,
  saveRecorderPreferences,
} from "@/lib/recorder-preferences";
import { copyFreshRecordingShareLink } from "@/lib/recording-link";
import {
  buildCaptureTitle,
  defaultRecordingTitle,
  inferWindowTitleFromDisplayStream,
} from "@/lib/recording-title";
import {
  decideRecordingVisibilityAction,
  isMobileRecorderRuntime,
} from "@/lib/recording-visibility";
import { uploadVideoBlobThumbnail } from "@/lib/thumbnail-capture";
import { uploadChunkRequest } from "@/lib/upload-request";
import { cn } from "@/lib/utils";
import { probeVideoMetadata, resolveVideoMimeType } from "@/lib/video-metadata";

async function writeAppState(key: string, value: unknown): Promise<void> {
  await fetch(
    agentNativePath(
      `/_agent-native/application-state/${encodeURIComponent(key)}`,
    ),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    },
  );
}

import {
  BUG_REPORT_POPUP_RESPONSE_HEADERS,
  bugReportTitle,
  parseBugReportContext,
  type BugReportContext,
} from "@shared/bug-report";
import {
  parseClipIntakeParams,
  type ClipIntakeParams,
} from "@shared/clip-intake";
import { toast } from "sonner";

import { CaptureInstallMenu } from "@/components/capture-install-options";
import { CameraBubble } from "@/components/recorder/camera-bubble";
import type { CameraBubbleSize } from "@/components/recorder/camera-bubble";
import {
  ConfettiCanvas,
  type ConfettiHandle,
} from "@/components/recorder/confetti-canvas";
import { CountdownOverlay } from "@/components/recorder/countdown-overlay";
import { PreRecordPanel } from "@/components/recorder/pre-record-panel";
import {
  RecorderEngine,
  canUseTimeslicedRecorderChunks,
  NO_MIC_DEVICE_ID,
  type DisplaySurface,
  type RecorderFinalizeResult,
  type RecordingMode,
} from "@/components/recorder/recorder-engine";
import { RecordingToolbar } from "@/components/recorder/recording-toolbar";
import { StorageSetupCard } from "@/components/recorder/storage-setup-card";
import { StorageStatusRetry } from "@/components/recorder/storage-status-retry";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function meta() {
  return [{ title: enMessages.recordRoute.pageTitle }];
}

export function headers() {
  return {
    "Permissions-Policy":
      "camera=(self), microphone=(self), display-capture=(self), geolocation=(), screen-wake-lock=()",
    ...BUG_REPORT_POPUP_RESPONSE_HEADERS,
  };
}

type UiState =
  | "idle"
  | "pickingSources"
  | "countdown"
  | "recording"
  | "compressing"
  | "uploading"
  | "complete"
  | "error";

type ClipsExtensionCapture = {
  extensionId: string;
  sessionId: string;
  sourceUrl: string | null;
  developerLogsEnabled: boolean;
};

type ClipsExtensionDiagnosticsResponse = {
  ok?: boolean;
  diagnostics?: BrowserDiagnosticsData;
  error?: string;
};

const MAC_SCREEN_RECORDING_PREF_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
const MAC_CAMERA_PREF_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera";
const MAC_MICROPHONE_PREF_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";

type BrowserDocumentPolicy = {
  allowsFeature?: (feature: string) => boolean;
};

function isMacPlatform(): boolean {
  return /^darwin|mac/i.test(
    typeof navigator !== "undefined" ? navigator.platform : "",
  );
}

function isEmbeddedWindow(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function openUrlFromUserGesture(url: string): void {
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    window.location.href = url;
  }
}

function bugReportDonePath(
  recordingId: string,
  context: BugReportContext,
  intake: ClipIntakeParams | null,
) {
  const params = new URLSearchParams({ recordingId });
  if (context.returnUrl) params.set("returnUrl", context.returnUrl);
  if (intake) {
    params.set("clip_intake_id", intake.intakeId);
    params.set("clip_intake", intake.token);
  }
  return `/bug-report/done?${params.toString()}`;
}

function sendClipsExtensionMessage<T>(
  extensionId: string,
  message: Record<string, unknown>,
): Promise<T | null> {
  const runtime = (globalThis as { chrome?: any }).chrome?.runtime;
  if (!runtime?.sendMessage) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      runtime.sendMessage(extensionId, message, (response: T | undefined) => {
        if (runtime.lastError) {
          console.warn("[recorder] Clips extension message failed:", {
            message: runtime.lastError.message,
            type: message.type,
          });
          resolve(null);
          return;
        }
        resolve(response ?? null);
      });
    } catch (err) {
      console.warn("[recorder] Clips extension message failed:", err);
      resolve(null);
    }
  });
}

function capturePolicy(): BrowserDocumentPolicy | null {
  if (typeof document === "undefined") return null;
  const doc = document as Document & {
    permissionsPolicy?: BrowserDocumentPolicy;
    featurePolicy?: BrowserDocumentPolicy;
  };
  return doc.permissionsPolicy ?? doc.featurePolicy ?? null;
}

function isCaptureFeatureBlockedByPolicy(feature: string): boolean {
  const policy = capturePolicy();
  if (!policy?.allowsFeature) return false;
  try {
    return !policy.allowsFeature(feature);
  } catch {
    return false;
  }
}

function getPolicyBlockedCaptureLabel(opts: {
  mode: RecordingMode;
  micDeviceId?: string | null;
}): "screen" | "camera" | "microphone" | null {
  if (
    (opts.mode === "screen" || opts.mode === "screen+camera") &&
    isCaptureFeatureBlockedByPolicy("display-capture")
  ) {
    return "screen";
  }
  if (
    (opts.mode === "camera" || opts.mode === "screen+camera") &&
    isCaptureFeatureBlockedByPolicy("camera")
  ) {
    return "camera";
  }
  if (
    wantsMicrophone(opts.micDeviceId) &&
    isCaptureFeatureBlockedByPolicy("microphone")
  ) {
    return "microphone";
  }
  return null;
}

function directRecorderUrl(opts?: {
  mode: RecordingMode;
  displaySurface: DisplaySurface;
}): string {
  if (typeof window === "undefined") return "/record";
  const url = new URL(window.location.href);
  if (opts) {
    url.searchParams.set("mode", opts.mode);
    url.searchParams.set("surface", opts.displaySurface);
  }
  return url.toString();
}

function isPermissionError(message: string): boolean {
  // Device-busy errors ("That camera is busy in another app", "Microphone is
  // currently in use") mention the device name but are not permission failures
  // — sending the user to enable a permission they already have wastes their
  // time. Require an explicit permission/denied/blocked keyword to qualify.
  const isDeviceBusy =
    /\b(busy|in use|already in use|in another (app|application|tab)|currently used|conflicting)\b/i.test(
      message,
    );
  const hasPermissionKeyword =
    /\b(permission|blocked|denied|not allowed|privacy|allow|disable[d]?|enable)\b/i.test(
      message,
    );
  if (isDeviceBusy && !hasPermissionKeyword) return false;
  return /screen|camera|microphone|mic|permission|blocked|denied|not allowed|privacy/i.test(
    message,
  );
}

function isPolicyPermissionError(message: string): boolean {
  return /permissions-policy|app frame|embedding frame|frame that allows/i.test(
    message,
  );
}

function isScreenPermissionError(message: string): boolean {
  return (
    isPermissionError(message) &&
    /screen|display|share|system audio|screen recording|Screen & System Audio Recording/i.test(
      message,
    )
  );
}

function isCameraPermissionError(message: string): boolean {
  return isPermissionError(message) && /camera/i.test(message);
}

function isMicrophonePermissionError(message: string): boolean {
  return isPermissionError(message) && /microphone|mic/i.test(message);
}

function wantsMicrophone(micDeviceId?: string | null): boolean {
  return micDeviceId !== NO_MIC_DEVICE_ID;
}

function getModePermissionLabels(
  mode?: RecordingMode,
  micDeviceId?: string | null,
): Array<"screen" | "camera" | "microphone"> {
  const labels: Array<"screen" | "camera" | "microphone"> = [];
  if (mode === "screen" || mode === "screen+camera") labels.push("screen");
  if (mode === "camera" || mode === "screen+camera") labels.push("camera");
  if (mode && wantsMicrophone(micDeviceId)) labels.push("microphone");
  return labels;
}

function getPreparingSourcesCopy(
  mode: RecordingMode,
  micDeviceId?: string | null,
): string {
  const labels = getModePermissionLabels(mode, micDeviceId);
  if (labels.length === 0) return "Choose a source before recording starts.";
  const readable = labels.map((label) =>
    label === "microphone" ? "microphone" : label,
  );
  const last = readable.pop();
  return `Allow ${readable.length ? `${readable.join(", ")} and ${last}` : last} access before recording starts.`;
}

function permissionGuidance(
  message: string,
  opts?: { mode?: RecordingMode; micDeviceId?: string | null },
): string | null {
  if (isUploadFailureError(message)) return null;
  if (!isPermissionError(message)) return null;
  if (isPolicyPermissionError(message)) {
    if (opts?.mode === "screen") {
      return "Browser site permissions are not the blocker here. Open Clips directly in a browser tab, or use an app frame that delegates screen capture.";
    }
    return "Browser site permissions are not the blocker here. Open Clips directly in a browser tab, or use an app frame that delegates the selected capture sources.";
  }
  if (isScreenPermissionError(message)) {
    if (isEmbeddedWindow() && getCaptureHostApp().kind !== "desktop") {
      return "The web client is running Clips inside a frame. Open the recorder in its own tab, then start recording; Chrome can block screen sharing in embedded pages even when macOS access is enabled.";
    }
    if (isMacPlatform()) {
      return `Camera and Microphone can be allowed while macOS still blocks screen capture. ${macPermissionGuidanceFor("screen")}`;
    }
    return "Choose a source in the browser screen picker. If it still fails, check this site's browser permissions and reload Clips.";
  }
  if (isCameraPermissionError(message)) {
    if (isMacPlatform()) {
      return `Allow Camera for this site first. ${macPermissionGuidanceFor("camera")}`;
    }
    return "Open this site's browser settings, allow Camera, then reload Clips.";
  }
  if (isMicrophonePermissionError(message)) {
    if (isMacPlatform()) {
      return `Allow Microphone for this site first. ${macPermissionGuidanceFor("microphone")}`;
    }
    return "Open this site's browser settings, allow Microphone, then reload Clips.";
  }
  if (isMacPlatform()) {
    const host = getCaptureHostApp();
    const labels = getModePermissionLabels(opts?.mode, opts?.micDeviceId);
    if (labels.length > 0) {
      const readable = labels
        .map((label) =>
          label === "screen"
            ? "Screen & System Audio Recording"
            : label === "camera"
              ? "Camera"
              : "Microphone",
        )
        .join(", ");
      return `Check this site's permissions first. If it still fails, turn on ${host.name} under ${readable} in macOS System Settings > Privacy & Security, then quit and reopen it. Clips is never listed there — macOS grants access to ${host.name}.`;
    }
    return `Check this site's permissions first. If it still fails, turn on ${host.name} in macOS System Settings > Privacy & Security, then quit and reopen it.`;
  }
  return "Open this site's browser settings and allow the selected capture sources, then reload this page.";
}

function permissionSettingsUrl(
  message: string,
  mode?: RecordingMode,
): string | null {
  if (isUploadFailureError(message)) return null;
  if (!isMacPlatform() || isPolicyPermissionError(message)) return null;
  if (isScreenPermissionError(message)) return MAC_SCREEN_RECORDING_PREF_URL;
  if (isCameraPermissionError(message)) return MAC_CAMERA_PREF_URL;
  if (isMicrophonePermissionError(message)) return MAC_MICROPHONE_PREF_URL;
  if (mode === "screen") return MAC_SCREEN_RECORDING_PREF_URL;
  return MAC_SCREEN_RECORDING_PREF_URL;
}

function isDismissedCapturePicker(err: unknown, message: string): boolean {
  const name = err instanceof Error ? err.name : "";
  return (
    name === "AbortError" ||
    /screen sharing was cancelled|cancelled|canceled|dismissed/i.test(message)
  );
}

function getRecordingModeParam(value: string | null): RecordingMode | null {
  if (value === "screen" || value === "camera") return value;
  if (
    value === "screen+camera" ||
    value === "screen camera" ||
    value === "screen-camera"
  ) {
    return "screen+camera";
  }
  return null;
}

function makeAbortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function getDisplaySurfaceParam(value: string | null): DisplaySurface | null {
  if (value === "monitor" || value === "window" || value === "browser") {
    return value;
  }
  if (value === "screen") return "monitor";
  return null;
}

function isUploadSizeError(error: string): boolean {
  return /too large to upload|too large for clips|limit is \d|file is too large|file size/i.test(
    error,
  );
}

function uploadAbortMetadata(error: unknown): Record<string, unknown> {
  const details =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const failureCode =
    details.failureCode === "chunk_html_error" ||
    details.failureCode === "multipart_start_failed"
      ? details.failureCode
      : "upload_failed";
  const failureStage =
    details.failureStage === "chunk_upload" ||
    details.failureStage === "reset_chunks" ||
    details.failureStage === "multipart_start"
      ? details.failureStage
      : undefined;
  const httpStatus =
    Number.isInteger(details.status) &&
    Number(details.status) >= 100 &&
    Number(details.status) <= 599
      ? Number(details.status)
      : undefined;
  return {
    failureCode,
    ...(failureStage ? { failureStage } : {}),
    ...(httpStatus ? { httpStatus } : {}),
  };
}

function uploadTooLargeMessage(size: number, detail?: string): string {
  return `Video is too large to upload (${
    detail ?? formatMb(size)
  }, limit is ${formatMb(
    MAX_UPLOAD_BYTES,
  )}) after automatic compression. Trim or export a shorter copy and upload again.`;
}

function fileTooLargeMessage(size: number): string {
  return `This file is too large to upload (${formatMb(
    size,
  )}, limit is ${formatMb(
    MAX_UPLOAD_BYTES,
  )}). Trim it or export a shorter copy and try again.`;
}

function isUploadFailureError(error: string): boolean {
  return (
    isUploadSizeError(error) ||
    /upload failed|chunk|reset-chunks|re-upload/i.test(error)
  );
}

function friendlyRecordingErrorMessage(error: string): string {
  if (isUploadSizeError(error)) {
    return `This video is too large for Clips. Trim or export a shorter copy under ${formatMb(
      MAX_UPLOAD_BYTES,
    )} and upload again.`;
  }
  if (isUploadFailureError(error)) {
    return "The video could not finish uploading. Retry the upload before starting over.";
  }
  if (isPolicyPermissionError(error)) {
    return "This recorder is embedded somewhere that blocks capture permissions.";
  }
  if (isScreenPermissionError(error)) {
    if (isMacPlatform()) {
      return `Clips could not start screen capture. macOS is blocking screen recording for ${getCaptureHostApp().name}.`;
    }
    return "Clips could not start screen capture. Allow screen sharing for this site, then try again.";
  }
  if (isCameraPermissionError(error)) {
    return "Clips could not start the camera. Allow camera access, then try again.";
  }
  if (isMicrophonePermissionError(error)) {
    return "Clips could not start the microphone. Allow microphone access, then try again.";
  }
  if (error.length > 220) {
    return "Something blocked the recorder before it could start.";
  }
  return error;
}

interface PendingRecording {
  id: string;
  uploadChunkUrl: string;
  abortUrl: string;
  resetChunksUrl?: string;
  uploadMode?: UploadMode;
}

const INTAKE_CREATE_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000] as const;

function isRetryableIntakeCreateStatus(status: number): boolean {
  return [408, 409, 425, 429, 500, 502, 503, 504].includes(status);
}

async function createRecordingRequest(
  url: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  const isIntakeRequest =
    typeof body.intakeId === "string" && typeof body.intakeToken === "string";
  const request = () =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await request();
    } catch (error) {
      if (
        !isIntakeRequest ||
        signal?.aborted ||
        attempt >= INTAKE_CREATE_RETRY_DELAYS_MS.length
      ) {
        throw error;
      }
      await new Promise((resolve) =>
        window.setTimeout(
          resolve,
          INTAKE_CREATE_RETRY_DELAYS_MS[attempt] ?? 2_000,
        ),
      );
      continue;
    }

    if (
      !isIntakeRequest ||
      !isRetryableIntakeCreateStatus(response.status) ||
      attempt >= INTAKE_CREATE_RETRY_DELAYS_MS.length
    ) {
      return response;
    }

    await new Promise((resolve) =>
      window.setTimeout(
        resolve,
        INTAKE_CREATE_RETRY_DELAYS_MS[attempt] ?? 2_000,
      ),
    );
  }
}

function PreRecordPanelSkeleton() {
  return (
    <div
      aria-busy="true"
      className="mx-auto w-full max-w-[420px] overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
    >
      <div className="flex justify-center px-4 pb-3 pt-4">
        <Skeleton className="h-11 w-[240px] rounded-full" />
      </div>
      <div className="grid gap-2 px-5 pb-4">
        <Skeleton className="h-9 w-full rounded-lg" />
        <Skeleton className="h-9 w-full rounded-lg" />
        <Skeleton className="h-9 w-full rounded-lg" />
      </div>
      <div className="border-t border-border p-3">
        <Skeleton className="h-11 w-full rounded-md" />
      </div>
    </div>
  );
}

function DesktopRecorderCallout() {
  const t = useT();
  return (
    <aside className="flex justify-center pt-3">
      <CaptureInstallMenu
        size="sm"
        variant="ghost"
        className="h-9 gap-2 px-3 text-sm font-medium"
      >
        {t("recordRoute.recordOnDesktop")}
      </CaptureInstallMenu>
    </aside>
  );
}

export function RecorderRouteStatus({
  icon,
  label,
  busy = false,
  progress,
  role = "status",
  children,
}: {
  icon?: ReactNode;
  label: ReactNode;
  busy?: boolean;
  progress?: number | null;
  role?: "status" | "alert";
  children?: ReactNode;
}) {
  const normalizedProgress =
    progress === null || progress === undefined
      ? null
      : Math.min(100, Math.max(0, Math.round(progress * 100)));

  return (
    <section className="w-full max-w-[420px] rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div
        role={role}
        aria-live={role === "alert" ? "assertive" : "polite"}
        aria-busy={busy || undefined}
      >
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            {busy ? <Spinner className="size-4" /> : icon}
          </div>
          <div className="min-w-0 flex-1 text-sm font-medium text-foreground">
            {label}
          </div>
        </div>
        {normalizedProgress !== null && (
          <div className="mt-4 flex items-center gap-3">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={normalizedProgress}
              className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
                style={{ width: `${normalizedProgress}%` }}
              />
            </div>
            <span className="w-9 text-end text-xs tabular-nums text-muted-foreground">
              {normalizedProgress}%
            </span>
          </div>
        )}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </section>
  );
}

function RecorderRouteViewport({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-[100dvh] w-full flex-col overflow-x-clip px-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-20 sm:px-6 sm:py-10">
      <div className="my-auto flex w-full justify-center">{children}</div>
    </main>
  );
}

export function RecordingErrorCard({
  error,
  mode,
  micDeviceId,
  canRetryUpload,
  canDownloadRecording,
  onDownloadRecording,
  onTryAgain,
}: {
  error: string;
  mode: RecordingMode;
  micDeviceId: string | null;
  canRetryUpload: boolean;
  canDownloadRecording: boolean;
  onDownloadRecording: () => void;
  onTryAgain: () => void;
}) {
  const t = useT();
  const uploadFailure = isUploadFailureError(error);
  const guidance = uploadFailure
    ? null
    : permissionGuidance(error, { mode, micDeviceId });
  const permissionError = !uploadFailure && isPermissionError(error);
  const policyError = !uploadFailure && isPolicyPermissionError(error);
  const embeddedScreenError =
    !uploadFailure &&
    isEmbeddedWindow() &&
    getCaptureHostApp().kind !== "desktop" &&
    isScreenPermissionError(error);
  const settings = permissionError
    ? getModePermissionLabels(mode, micDeviceId)
    : [];
  const directUrl = directRecorderUrl();
  const friendlyMessage = friendlyRecordingErrorMessage(error);
  const showTechnicalDetails = friendlyMessage !== error;
  const openDirectly = policyError || embeddedScreenError;
  const downloadIsPrimary = canDownloadRecording && !canRetryUpload;

  return (
    <section className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 text-start shadow-sm">
      <div
        role="alert"
        aria-live="assertive"
        className="flex items-start gap-3"
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
          <IconAlertTriangle className="size-4" />
        </div>
        <h2 className="min-w-0 flex-1 break-words pt-1.5 text-sm font-semibold leading-snug text-foreground">
          {friendlyMessage}
        </h2>
      </div>

      {guidance && (
        <details className="mt-4 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">
            {t("recordRoute.whatToCheck")}
          </summary>
          <p className="mt-2 break-words leading-relaxed">{guidance}</p>
        </details>
      )}

      {showTechnicalDetails && (
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">
            {t("recordRoute.technicalDetails")}
          </summary>
          <p className="mt-2 max-h-24 overflow-y-auto break-words rounded-lg border border-border bg-muted/40 p-2 leading-relaxed">
            {error}
          </p>
        </details>
      )}

      <div className="mt-5 grid gap-2">
        {openDirectly && (
          <Button
            type="button"
            onClick={() => openUrlFromUserGesture(directUrl)}
            className="w-full gap-2"
          >
            <IconExternalLink className="size-4" />
            {t("recordRoute.openRecorderInTab")}
          </Button>
        )}
        {!openDirectly && !downloadIsPrimary && (
          <Button onClick={onTryAgain} className="w-full gap-2">
            <IconRefresh className="size-4" />
            {canRetryUpload
              ? t("recordRoute.retryUpload")
              : t("recordRoute.tryAgain")}
          </Button>
        )}
        {canDownloadRecording && (
          <Button
            variant={downloadIsPrimary ? "default" : "outline"}
            onClick={onDownloadRecording}
            className="w-full gap-2"
          >
            <IconDownload className="size-4" />
            {t("recordRoute.downloadRecording")}
          </Button>
        )}
        {(openDirectly || downloadIsPrimary) && (
          <Button
            variant="outline"
            onClick={onTryAgain}
            className="w-full gap-2"
          >
            <IconRefresh className="h-4 w-4" />
            {canRetryUpload
              ? t("recordRoute.retryUpload")
              : t("recordRoute.tryAgain")}
          </Button>
        )}
        {permissionError &&
          isMacPlatform() &&
          !policyError &&
          settings.length > 0 && (
            <div
              className={cn(
                "grid grid-cols-1 gap-2",
                settings.length === 2
                  ? "sm:grid-cols-2"
                  : settings.length === 3
                    ? "sm:grid-cols-3"
                    : undefined,
              )}
            >
              {settings.includes("screen") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    openUrlFromUserGesture(MAC_SCREEN_RECORDING_PREF_URL);
                  }}
                  className="w-full gap-1.5 px-2 text-xs"
                >
                  <IconDeviceDesktop className="h-3.5 w-3.5" />
                  Screen
                </Button>
              )}
              {settings.includes("camera") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    openUrlFromUserGesture(MAC_CAMERA_PREF_URL);
                  }}
                  className="w-full gap-1.5 px-2 text-xs"
                >
                  <IconCamera className="h-3.5 w-3.5" />
                  Camera
                </Button>
              )}
              {settings.includes("microphone") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    openUrlFromUserGesture(MAC_MICROPHONE_PREF_URL);
                  }}
                  className="w-full gap-1.5 px-2 text-xs"
                >
                  <IconMicrophone className="h-3.5 w-3.5" />
                  Mic
                </Button>
              )}
            </div>
          )}
      </div>
    </section>
  );
}

export default function RecordRoute() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const { session: authSession } = useSession();
  const {
    dismiss: dismissUploadToast,
    error: failUploadToast,
    info: infoUploadToast,
    start: startUploadToast,
    success: completeUploadToast,
  } = useSonnerLifecycleToast();
  const showSavedToast = useCallback(
    (message: string, copied: boolean, recordingId: string) => {
      if (copied) {
        completeUploadToast(message, {
          description: t("recordRoute.linkCopied"),
        });
        return;
      }
      completeUploadToast(message, {
        action: {
          label: t("recordRoute.copyLinkAction"),
          onClick: () => {
            void copyFreshRecordingShareLink(recordingId, authSession);
          },
        },
      });
    },
    [authSession, completeUploadToast, t],
  );
  const [uiState, setUiState] = useState<UiState>("idle");
  const [savingKind, setSavingKind] = useState<"recording" | "upload" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const visibilityAutoPausedRef = useRef(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const playheadConfirmOpenRef = useRef(false);
  const discardAutoPausedRef = useRef(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraSize, setCameraSize] = useState<CameraBubbleSize>(
    () => loadRecorderPreferences().cameraSize ?? "md",
  );
  const handleCameraSizeChange = useCallback((size: CameraBubbleSize) => {
    setCameraSize(size);
    saveRecorderPreferences({ cameraSize: size });
  }, []);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [resolvedDisplaySurface, setResolvedDisplaySurface] =
    useState<DisplaySurface | null>(null);
  const [recordingMode, setRecordingMode] =
    useState<RecordingMode>("screen+camera");
  const [compressionProgress, setCompressionProgress] = useState<number | null>(
    null,
  );
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const queryClient = useQueryClient();
  const { isDesktopApp } = useDesktopPromo();
  const clipIntake = useMemo(
    () => parseClipIntakeParams(new URLSearchParams(location.search)),
    [location.search],
  );
  const storageQuery = useVideoStorageStatus(!clipIntake);

  const spaceIdFromUrl = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("spaceId") || null;
  }, [location.search]);
  const folderIdFromUrl = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("folderId") || null;
  }, [location.search]);
  const initialRecorderOptions = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const mode = params.get("mode");
    const surface = params.get("surface");
    return {
      mode: getRecordingModeParam(mode),
      surface: getDisplaySurfaceParam(surface),
    };
  }, [location.search]);
  const extensionCapture = useMemo<ClipsExtensionCapture | null>(() => {
    const params = new URLSearchParams(location.search);
    const extensionId = params.get("clipsExtensionId")?.trim();
    const sessionId = params.get("clipsCaptureSessionId")?.trim();
    if (!extensionId || !sessionId) return null;
    const developerLogs = params.get("developerLogs");
    return {
      extensionId,
      sessionId,
      sourceUrl: params.get("sourceUrl")?.trim() || null,
      developerLogsEnabled: developerLogs !== "0",
    };
  }, [location.search]);
  const bugReportContext = useMemo(
    () => parseBugReportContext(new URLSearchParams(location.search)),
    [location.search],
  );
  const clipIntakeRef = useRef<ClipIntakeParams | null>(null);
  useEffect(() => {
    clipIntakeRef.current = clipIntake;
  }, [clipIntake]);
  const storageConfigured: boolean | null = clipIntake
    ? true
    : storageQuery.isLoading
      ? null
      : !!storageQuery.data?.configured;
  const markStorageConfigured = useCallback(
    (status?: VideoStorageStatus) => {
      queryClient.setQueryData<VideoStorageStatus>(
        VIDEO_STORAGE_STATUS_KEY,
        (prev) =>
          status ?? {
            configured: true,
            activeProvider: prev?.activeProvider ?? null,
            builderConfigured: prev?.builderConfigured ?? false,
          },
      );
    },
    [queryClient],
  );

  const liveTranscription = useLiveTranscription();
  const stopLiveTranscription = liveTranscription.stop;

  const saveBugReportContext = useCallback(
    async (recordingId: string) => {
      if (!bugReportContext) return;
      try {
        await callAction(
          "save-bug-report-context" as any,
          {
            recordingId,
            projectId: bugReportContext.projectId,
            title: bugReportContext.title,
            description: bugReportContext.description,
            severity: bugReportContext.severity,
            sourceUrl: bugReportContext.sourceUrl,
            pageTitle: bugReportContext.pageTitle,
            appVersion: bugReportContext.appVersion,
            environment: bugReportContext.environment,
            reporterEmail: bugReportContext.reporterEmail,
            reporterName: bugReportContext.reporterName,
            reporterId: bugReportContext.reporterId,
            metadata: bugReportContext.metadata ?? undefined,
          } as any,
        );
      } catch (err) {
        console.warn("[recorder] bug report context save failed:", err);
      }
    },
    [bugReportContext],
  );
  const bugReportContextRef = useRef<BugReportContext | null>(null);
  const saveBugReportContextRef = useRef(saveBugReportContext);
  useEffect(() => {
    bugReportContextRef.current = bugReportContext;
    saveBugReportContextRef.current = saveBugReportContext;
  }, [bugReportContext, saveBugReportContext]);

  const engineRef = useRef<RecorderEngine | null>(null);
  const pendingRef = useRef<PendingRecording | null>(null);
  const countdownAudioCueRef = useRef<CountdownAudioCue | null>(null);
  const confettiRef = useRef<ConfettiHandle>(null);
  const doStopRef = useRef<() => Promise<void>>(async () => {});
  const pendingStartOptsRef = useRef<{
    mode: RecordingMode;
    displaySurface: DisplaySurface;
    micDeviceId: string | null;
    micDeviceLabel?: string | null;
    cameraDeviceId: string | null;
  } | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const fileUploadAbortRef = useRef<AbortController | null>(null);
  const fileUploadRecordingIdRef = useRef<string | null>(null);
  const fileUploadAbortUrlRef = useRef<string | null>(null);
  const browserDiagnosticsRef = useRef<BrowserDiagnosticsCapture | null>(null);
  const startSessionRef = useRef(0);
  const cancelledStartSessionRef = useRef<number | null>(null);
  const restartInFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (!previewVideoRef.current) return;
    previewVideoRef.current.srcObject = previewStream;
    if (previewStream) {
      previewVideoRef.current.play().catch(() => {});
    }
  }, [previewStream]);

  const showRecordingErrorToast = useCallback(
    (message: string) => {
      const pendingOpts = pendingStartOptsRef.current;
      const uploadFailure = isUploadFailureError(message);
      const guidance = uploadFailure
        ? null
        : permissionGuidance(message, pendingOpts ?? undefined);
      const settingsUrl = uploadFailure
        ? null
        : permissionSettingsUrl(message, pendingOpts?.mode);
      const friendlyMessage = friendlyRecordingErrorMessage(message);
      const options = {
        description: guidance ?? friendlyMessage,
        duration: guidance ? 20_000 : 10_000,
        action: settingsUrl
          ? {
              label: t("recordRoute.openSettings"),
              onClick: () => {
                openUrlFromUserGesture(settingsUrl);
              },
            }
          : undefined,
      };
      if (uploadFailure) {
        failUploadToast(t("recordRoute.uploadFailed"), options);
      } else {
        toast.error(t("recordRoute.couldNotStartRecording"), options);
      }
    },
    [failUploadToast, t],
  );

  const startFlow = useCallback(
    async (opts: {
      mode: RecordingMode;
      displaySurface: DisplaySurface;
      micDeviceId: string | null;
      micDeviceLabel?: string | null;
      cameraDeviceId: string | null;
    }) => {
      const blockedFeature = isEmbeddedWindow()
        ? getPolicyBlockedCaptureLabel({
            mode: opts.mode,
            micDeviceId: opts.micDeviceId,
          })
        : null;
      if (blockedFeature) {
        openUrlFromUserGesture(directRecorderUrl(opts));
        toast.info(t("recordRoute.openedRecorderInNewTab"), {
          description: `Chrome is blocking ${blockedFeature} access in this embedded web client.`,
          duration: 8000,
        });
        return;
      }

      const session = startSessionRef.current + 1;
      startSessionRef.current = session;
      const isStale = () => startSessionRef.current !== session;

      countdownAudioCueRef.current?.cleanup();
      countdownAudioCueRef.current = createCountdownAudioCue();
      setError(null);
      setSavingKind(null);
      setRecordingMode(opts.mode);
      pendingStartOptsRef.current = opts;
      setResolvedDisplaySurface(null);
      flushSync(() => {
        setUiState("pickingSources");
      });

      try {
        const engine = new RecorderEngine({
          recordingId: "__pending__",
          mode: opts.mode,
          displaySurface: opts.displaySurface,
          micDeviceId: opts.micDeviceId,
          micDeviceLabel: opts.micDeviceLabel,
          cameraDeviceId: opts.cameraDeviceId,
          cameraBubbleSize: cameraSize,
          uploadUrl: "",
          abortUrl: "",
          onError: (err) => {
            console.error("[recorder] error:", err);
            showRecordingErrorToast(err.message);
            setError(err.message);
            setUiState("error");
          },
          onWarning: (message) => {
            toast.warning(message);
          },
          onCameraEnded: () => {
            setCameraStream(null);
          },
          onResolvedDisplaySurface: (surface) => {
            setResolvedDisplaySurface(surface);
          },
          onState: (state) => {
            if (state === "compressing") {
              setUiState("compressing");
            } else if (state === "uploading") {
              setCompressionProgress(null);
              setUploadProgress(null);
              setUiState("uploading");
            }
          },
          onChunk: ({ index, total }) => {
            const fraction = total ? (index + 1) / total : null;
            setUploadProgress(fraction);
          },
          onDisplayTrackEnded: () => {
            void doStopRef.current();
          },
          onCompressionProgress: ({ stage, progress }) => {
            if (stage === "encoding" && typeof progress === "number") {
              setCompressionProgress(progress);
            } else if (stage === "loading-ffmpeg" || stage === "preparing") {
              setCompressionProgress(null);
            } else if (stage === "finalizing") {
              setCompressionProgress(1);
            }
          },
        });
        engineRef.current = engine;

        const { previewStream: ps, cameraStream: cs } = await engine.acquire();
        if (isStale()) {
          await engine.cancel("unknown").catch(() => {});
          return;
        }
        const captureTitle = buildCaptureTitle({
          windowTitle: inferWindowTitleFromDisplayStream(ps),
          displaySurface: opts.displaySurface,
          mode: opts.mode,
        });

        const wantsMic = opts.micDeviceId !== NO_MIC_DEVICE_ID;
        const usingDefaultMic = engine.didMicUseSystemDefault();
        if (wantsMic && usingDefaultMic && liveTranscription.supported) {
          liveTranscription.start();
        }

        const intake = clipIntakeRef.current;
        if (!intake) {
          const status = await fetchVideoStorageStatus();
          if (isStale()) {
            try {
              await liveTranscription.stopAndWait();
              // coercion-ok: stale recording cleanup intentionally ignores stop failure.
            } catch {
              // The recording is already stale; cleanup failure cannot change the outcome.
            }
            await engine.cancel("storage_setup_required").catch(() => {});
            return;
          }
          markStorageConfigured(status);
          if (!status.configured) {
            throw new Error(
              "No video storage configured. Connect storage: Builder.io (free tier storage + AI) or S3-compatible storage.",
            );
          }
        }

        const reportContext = bugReportContextRef.current;
        const reportTitle = reportContext
          ? `Bug report: ${bugReportTitle(reportContext)}`
          : null;
        const recordingPayload = {
          recordingPlatform: isMobileRecorderRuntime(navigator)
            ? "mobile"
            : "web",
          title: reportTitle ?? captureTitle.title,
          titleSource: reportTitle ? "context" : captureTitle.titleSource,
          sourceAppName: captureTitle.sourceAppName,
          sourceWindowTitle: captureTitle.sourceWindowTitle,
          hasCamera: opts.mode !== "screen",
          hasAudio: wantsMic,
          visibility: reportContext ? "org" : undefined,
          spaceIds: spaceIdFromUrl ? [spaceIdFromUrl] : undefined,
          folderId: folderIdFromUrl ?? undefined,
          mimeType: pickMimeType() || undefined,
          requestStreaming: canUseTimeslicedRecorderChunks(pickMimeType()),
        };
        const res = await createRecordingRequest(
          agentNativePath(
            intake
              ? "/_agent-native/actions/create-intake-recording"
              : "/_agent-native/actions/create-recording",
          ),
          intake
            ? {
                ...recordingPayload,
                intakeId: intake.intakeId,
                intakeToken: intake.token,
                bugReport: reportContext ?? undefined,
              }
            : recordingPayload,
        );
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            throw new Error("SESSION_EXPIRED");
          }
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(
            body?.error ?? `create-recording failed (${res.status})`,
          );
        }
        const created = (await res.json()) as {
          result?: {
            id: string;
            uploadChunkUrl: string;
            abortUrl: string;
            resetChunksUrl?: string;
            uploadMode?: UploadMode;
          };
          id?: string;
          uploadChunkUrl?: string;
          abortUrl?: string;
          resetChunksUrl?: string;
          uploadMode?: UploadMode;
        };
        const info = created.result ?? (created as PendingRecording);
        if (!info?.id) {
          throw new Error("create-recording did not return an id");
        }
        if (isStale()) {
          const userCancelled = cancelledStartSessionRef.current === session;
          if (userCancelled) cancelledStartSessionRef.current = null;
          await liveTranscription.stopAndWait().catch(() => "");
          if (intake) {
            fetch(`${appBasePath()}${info.abortUrl}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                reason: userCancelled
                  ? "Recording cancelled by user"
                  : "unknown",
                failureCode: userCancelled ? "user_cancelled" : "unknown",
              }),
            }).catch(() => {});
          } else {
            fetch(agentNativePath("/_agent-native/actions/trash-recording"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: info.id }),
            }).catch(() => {});
          }
          await engine
            .cancel(userCancelled ? "user_cancelled" : "unknown")
            .catch(() => {});
          return;
        }
        const uploadChunkUrl = `${appBasePath()}${info.uploadChunkUrl!}`;
        const abortUrl = `${appBasePath()}${info.abortUrl!}`;
        pendingRef.current = {
          id: info.id,
          uploadChunkUrl,
          abortUrl,
        };
        engine.setUploadTarget({
          recordingId: info.id,
          uploadUrl: uploadChunkUrl,
          abortUrl,
          resetUrl: info.resetChunksUrl
            ? `${appBasePath()}${info.resetChunksUrl}`
            : undefined,
          uploadMode: info.uploadMode,
        });
        if (!intake) await saveBugReportContextRef.current(info.id);

        setPreviewStream(ps);
        setCameraStream(cs);
        setUiState("countdown");
      } catch (err) {
        if (isStale()) return;
        const message =
          err instanceof Error
            ? err.message
            : t("recordRoute.couldNotStartRecording");
        const pickerDismissed = isDismissedCapturePicker(err, message);
        await liveTranscription.stopAndWait().catch(() => "");
        const orphan = pendingRef.current;
        if (orphan?.id) {
          const intake = clipIntakeRef.current;
          if (intake) {
            fetch(orphan.abortUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                reason: "upload_failed",
                failureCode: "upload_failed",
              }),
            }).catch(() => {});
          } else {
            fetch(agentNativePath("/_agent-native/actions/trash-recording"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: orphan.id }),
            }).catch(() => {});
          }
        }
        try {
          await engineRef.current?.cancel("upload_failed");
        } catch {
          // ignore
        }
        countdownAudioCueRef.current?.cleanup();
        countdownAudioCueRef.current = null;
        pendingRef.current = null;
        engineRef.current = null;
        if (pickerDismissed) {
          setError(null);
          setUiState("idle");
          return;
        }
        setError(message);
        setUiState("error");
        if (
          !message.includes("No video storage configured") &&
          message !== "SESSION_EXPIRED"
        ) {
          showRecordingErrorToast(message);
        }
      }
    },
    [liveTranscription, markStorageConfigured, showRecordingErrorToast],
  );

  const UPLOAD_PARALLELISM = 4;

  const uploadFile = useCallback(
    async (file: File) => {
      const session = startSessionRef.current + 1;
      startSessionRef.current = session;
      const isStale = () => startSessionRef.current !== session;
      const abort = new AbortController();
      fileUploadAbortRef.current?.abort(makeAbortError("Upload cancelled"));
      fileUploadAbortRef.current = abort;

      setError(null);
      setSavingKind("upload");
      setUiState("uploading");
      setCompressionProgress(null);
      setUploadProgress(null);
      startUploadToast(t("recordRoute.savingRecording"));

      const mimeType = resolveVideoMimeType(file);
      if (!mimeType) {
        const message =
          "That file type isn't supported. Try MP4, WebM, or MOV.";
        if (fileUploadAbortRef.current === abort) {
          fileUploadAbortRef.current = null;
        }
        setError(message);
        setUiState("error");
        failUploadToast(message);
        return;
      }

      if (file.size > MAX_UPLOAD_BYTES) {
        const message = fileTooLargeMessage(file.size);
        if (fileUploadAbortRef.current === abort) {
          fileUploadAbortRef.current = null;
        }
        setError(message);
        setUiState("error");
        failUploadToast(message);
        return;
      }

      let createdId: string | null = null;
      try {
        const intake = clipIntakeRef.current;
        if (!intake) {
          const status = await fetchVideoStorageStatus();
          if (isStale()) return;
          markStorageConfigured(status);
          if (!status.configured) {
            throw new Error(
              "No video storage configured. Connect storage: Builder.io (free tier storage + AI) or S3-compatible storage.",
            );
          }
        }

        const meta = await probeVideoMetadata(file);
        if (isStale()) return;

        let uploadBlob: Blob = file;
        let uploadMimeType = mimeType;
        let compressionError: {
          message: string;
          stderrTail: string[];
          elapsedMs: number;
        } | null = null;
        let uploadTooLargeDetail: string | undefined;

        if (COMPRESSION_ENABLED && file.size > COMPRESS_THRESHOLD_BYTES) {
          setUiState("compressing");
          startUploadToast(t("recordRoute.largeClipsNeedReencode"));
          const compression = await compressBlobIfTooLarge(file, mimeType, {
            width: meta.width,
            height: meta.height,
            durationMs: meta.durationMs,
            signal: abort.signal,
            onProgress: ({ stage, progress }) => {
              if (stage === "encoding" && typeof progress === "number") {
                setCompressionProgress(progress);
              } else if (stage === "finalizing") {
                setCompressionProgress(1);
              } else {
                setCompressionProgress(null);
              }
            },
            onError: (err) => {
              compressionError = err;
              captureClientException(
                new Error(`Upload compression failed: ${err.message}`),
                {
                  tags: {
                    uploadStep: "local-file-compression",
                    mimeType,
                  },
                  extra: {
                    filename: file.name,
                    fileBytes: file.size,
                    width: meta.width,
                    height: meta.height,
                    stderrTail: err.stderrTail,
                    elapsedMs: err.elapsedMs,
                  },
                },
              );
            },
          });
          if (isStale()) return;

          uploadBlob = compression.blob;
          uploadMimeType = compression.outputMimeType || mimeType;
          if (compressionError) {
            console.warn(
              "[recorder] upload compression failed, falling back to source file",
              compressionError,
            );
          }
          if (uploadBlob.size > MAX_UPLOAD_BYTES && compression.compressed) {
            uploadTooLargeDetail = `${formatMb(uploadBlob.size)} after compression`;
          }
          setCompressionProgress(null);
        }
        if (COMPRESSION_ENABLED && uploadBlob.size > MAX_UPLOAD_BYTES) {
          throw new Error(
            uploadTooLargeMessage(uploadBlob.size, uploadTooLargeDetail),
          );
        }
        setUiState("uploading");
        startUploadToast(t("recordRoute.savingRecording"));
        const reportContext = bugReportContextRef.current;
        const reportTitle = reportContext
          ? `Bug report: ${bugReportTitle(reportContext)}`
          : null;
        const recordingPayload = {
          recordingPlatform: isMobileRecorderRuntime(navigator)
            ? "mobile"
            : "web",
          title:
            reportTitle ??
            (file.name.replace(/\.[^/.]+$/, "") || defaultRecordingTitle()),
          titleSource: reportTitle ? "context" : "upload",
          hasCamera: false,
          hasAudio: true,
          width: meta.width,
          height: meta.height,
          visibility: reportContext ? "org" : undefined,
          spaceIds: spaceIdFromUrl ? [spaceIdFromUrl] : undefined,
          folderId: folderIdFromUrl ?? undefined,
          mimeType: uploadMimeType,
          requestStreaming: true,
        };

        const res = await createRecordingRequest(
          agentNativePath(
            intake
              ? "/_agent-native/actions/create-intake-recording"
              : "/_agent-native/actions/create-recording",
          ),
          intake
            ? {
                ...recordingPayload,
                intakeId: intake.intakeId,
                intakeToken: intake.token,
                bugReport: reportContext ?? undefined,
              }
            : recordingPayload,
          abort.signal,
        );
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            throw new Error("SESSION_EXPIRED");
          }
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(
            body?.error ?? `create-recording failed (${res.status})`,
          );
        }
        const created = (await res.json()) as {
          result?: {
            id: string;
            uploadChunkUrl: string;
            abortUrl?: string;
            resetChunksUrl?: string;
            uploadMode?: UploadMode;
          };
          id?: string;
          uploadChunkUrl?: string;
          abortUrl?: string;
          resetChunksUrl?: string;
          uploadMode?: UploadMode;
        };
        const info =
          created.result ??
          (created as {
            id: string;
            uploadChunkUrl: string;
            abortUrl?: string;
            uploadMode?: UploadMode;
          });
        if (!info?.id) {
          throw new Error("create-recording did not return an id");
        }
        createdId = info.id;
        fileUploadRecordingIdRef.current = createdId;
        fileUploadAbortUrlRef.current =
          intake && info.abortUrl ? `${appBasePath()}${info.abortUrl}` : null;
        if (!intake) await saveBugReportContextRef.current(info.id);
        if (isStale()) throw makeAbortError("Upload cancelled");
        if (!intake) {
          void uploadVideoBlobThumbnail(createdId, uploadBlob, {
            signal: abort.signal,
          }).catch((err) => {
            console.warn("[recorder] local-file thumbnail upload skipped", {
              recordingId: createdId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
        if (isStale()) throw makeAbortError("Upload cancelled");
        const uploadBase = `${appBasePath()}${info.uploadChunkUrl}`;

        const totalChunks = Math.max(
          1,
          Math.ceil(uploadBlob.size / UPLOAD_SLICE_BYTES),
        );

        const chunkDescs = Array.from({ length: totalChunks }, (_, i) => {
          const start = i * UPLOAD_SLICE_BYTES;
          const end = Math.min(start + UPLOAD_SLICE_BYTES, uploadBlob.size);
          const isFinal = i === totalChunks - 1;
          return {
            index: i,
            slice: uploadBlob.slice(start, end, uploadMimeType),
            isFinal,
            url: chunkUploadUrl(uploadBase, {
              index: i,
              total: totalChunks,
              isFinal,
              mimeType: uploadMimeType,
              durationMs: isFinal ? meta.durationMs : undefined,
              width: isFinal ? meta.width : undefined,
              height: isFinal ? meta.height : undefined,
              hasAudio: isFinal ? true : undefined,
              hasCamera: isFinal ? false : undefined,
            }),
          };
        });
        const finalChunkDesc = chunkDescs[chunkDescs.length - 1];
        const parallelChunks = chunkDescs.slice(0, -1);

        const chunkAbort = new AbortController();
        if (abort.signal.aborted) {
          chunkAbort.abort(abort.signal.reason);
        } else {
          abort.signal.addEventListener(
            "abort",
            () => chunkAbort.abort(abort.signal.reason),
            { once: true },
          );
        }

        const finalChunk = { result: null as Record<string, unknown> | null };
        let uploadError: Error | null = null;
        const queue = parallelChunks.slice();

        const worker = async () => {
          while (queue.length > 0) {
            if (isStale() || chunkAbort.signal.aborted) break;
            const item = queue.shift();
            if (!item) break;
            const { index, slice, url } = item;

            let chunkRes: Response;
            try {
              chunkRes = await uploadChunkRequest({
                url,
                contentType: uploadMimeType,
                body: await slice.arrayBuffer(),
                signal: chunkAbort.signal,
              });
            } catch (err) {
              if (chunkAbort.signal.aborted) return;
              if (!uploadError) {
                uploadError =
                  err instanceof Error ? err : new Error(String(err));
                chunkAbort.abort(uploadError);
              }
              return;
            }

            const text = await chunkRes.text();
            const responseError = classifyUploadResponseError({
              contentType: chunkRes.headers.get("content-type"),
              body: text,
              status: chunkRes.status,
              stage: "chunk_upload",
            });
            if (!chunkRes.ok || responseError.isHtml) {
              const error = Object.assign(
                new Error(
                  t("recordRoute.uploadFailedAtChunk", {
                    chunk: index + 1,
                    total: totalChunks,
                    message:
                      responseError.responseText ||
                      (responseError.isHtml
                        ? `HTML error response (${chunkRes.status})`
                        : chunkRes.statusText),
                  }),
                ),
                {
                  status: responseError.status,
                  failureCode: responseError.failureCode,
                  failureStage: responseError.failureStage,
                },
              );
              if (!uploadError) {
                uploadError = error;
                chunkAbort.abort(uploadError);
              }
              return;
            }
            setUploadProgress((index + 1) / totalChunks);
          }
        };

        await Promise.all(
          Array.from(
            {
              length: Math.min(
                chunkUploadParallelism(info.uploadMode, UPLOAD_PARALLELISM),
                parallelChunks.length,
              ),
            },
            worker,
          ),
        );

        if (uploadError) throw uploadError;
        if (abort.signal.aborted) {
          const reason = abort.signal.reason;
          throw reason instanceof Error
            ? reason
            : makeAbortError("Upload cancelled");
        }
        if (isStale()) throw makeAbortError("Upload cancelled");

        const { index, slice, url } = finalChunkDesc;
        let chunkRes: Response | null = null;
        try {
          chunkRes = await uploadChunkRequest({
            url,
            contentType: uploadMimeType,
            body: await slice.arrayBuffer(),
            signal: abort.signal,
          });
        } catch (err) {
          if (
            createdId &&
            (err as { name?: string } | null)?.name !== "AbortError"
          ) {
            const recovered = await waitForAcceptedRecordingAfterFinalizeError({
              uploadUrl: uploadBase,
              recordingId: createdId,
              preferAuthenticated: true,
              signal: abort.signal,
            });
            if (recovered) {
              finalChunk.result = recovered;
            } else {
              throw err;
            }
          } else {
            throw err;
          }
        }

        const finalChunkText = chunkRes ? await chunkRes.text() : "";
        const finalChunkError = chunkRes
          ? classifyUploadResponseError({
              contentType: chunkRes.headers.get("content-type"),
              body: finalChunkText,
              status: chunkRes.status,
              stage: "chunk_upload",
            })
          : null;
        if (chunkRes && (!chunkRes.ok || finalChunkError?.isHtml)) {
          const responseError = finalChunkError!;
          const error = Object.assign(
            new Error(
              t("recordRoute.uploadFailedAtChunk", {
                chunk: index + 1,
                total: totalChunks,
                message:
                  responseError.responseText ||
                  (responseError.isHtml
                    ? `HTML error response (${chunkRes.status})`
                    : chunkRes.statusText),
              }),
            ),
            {
              status: responseError.status,
              failureCode: responseError.failureCode,
              failureStage: responseError.failureStage,
            },
          );
          if (
            createdId &&
            chunkRes.status !== 413 &&
            !isUploadSizeError(error.message)
          ) {
            const recovered = await waitForAcceptedRecordingAfterFinalizeError({
              uploadUrl: uploadBase,
              recordingId: createdId,
              preferAuthenticated: true,
              signal: abort.signal,
            });
            if (recovered) {
              finalChunk.result = recovered;
            } else {
              throw error;
            }
          } else {
            throw error;
          }
        }

        if (chunkRes?.ok && !finalChunkError?.isHtml) {
          try {
            finalChunk.result = JSON.parse(finalChunkText) as Record<
              string,
              unknown
            >;
          } catch {
            finalChunk.result = null;
          }
        }

        setUiState("complete");
        const waitingForStorage =
          finalChunk.result?.waitingForStorage === true ||
          finalChunk.result?.status === "waiting_storage";
        if (waitingForStorage) {
          infoUploadToast(t("recordRoute.videoReadyToUpload"), {
            description: t("recordRoute.connectStorageToFinish"),
            duration: 12_000,
          });
        } else if (createdId && !reportContext) {
          showSavedToast(
            t("recordRoute.videoUploaded"),
            await copyFreshRecordingShareLink(createdId, authSession),
            createdId,
          );
        } else {
          completeUploadToast(t("recordRoute.videoUploaded"));
        }
        if (reportContext && createdId) {
          const path = bugReportDonePath(
            createdId,
            reportContext,
            clipIntakeRef.current,
          );
          await writeAppState(`navigate:${getBrowserTabId()}`, {
            view: "bug-report-done",
            recordingId: createdId,
            path,
          });
          setTimeout(() => {
            void navigate(path);
          }, 50);
        } else {
          await writeAppState(`navigate:${getBrowserTabId()}`, {
            view: "recording",
            recordingId: createdId,
          });
          setTimeout(() => {
            if (createdId) void navigate(`/r/${createdId}`);
          }, 50);
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t("recordRoute.uploadFailed");
        const aborted = err instanceof Error && err.name === "AbortError";
        const status =
          err instanceof Error
            ? (err as Error & { status?: number }).status
            : undefined;
        const serverRejectedTooLarge =
          status === 413 || isUploadSizeError(message);
        const preserveBufferedChunks =
          isStoredButUnservableFinalizeError(message);
        if (createdId && !serverRejectedTooLarge && !preserveBufferedChunks) {
          fetch(
            fileUploadAbortUrlRef.current ??
              `${appBasePath()}/api/uploads/${createdId}/abort`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                reason: message,
                ...uploadAbortMetadata(err),
              }),
            },
          ).catch(() => {});
        }
        if (aborted || isStale()) return;
        setError(message);
        setUiState("error");
        if (message !== "SESSION_EXPIRED") {
          failUploadToast(
            isUploadSizeError(message)
              ? t("recordRoute.videoTooLarge")
              : t("recordRoute.uploadFailed"),
            {
              description: createdId
                ? "The clip was marked failed in your library. You can remove it from the card menu."
                : friendlyRecordingErrorMessage(message),
              duration: 12_000,
            },
          );
        }
      } finally {
        if (fileUploadAbortRef.current === abort) {
          fileUploadAbortRef.current = null;
        }
        if (fileUploadRecordingIdRef.current === createdId) {
          fileUploadRecordingIdRef.current = null;
          fileUploadAbortUrlRef.current = null;
        }
        setCompressionProgress(null);
        setUploadProgress(null);
      }
    },
    [
      authSession,
      completeUploadToast,
      failUploadToast,
      infoUploadToast,
      markStorageConfigured,
      navigate,
      showSavedToast,
      startUploadToast,
      t,
    ],
  );

  useEffect(() => {
    if (storageConfigured !== true || uiState !== "idle") return;
    const file = takePendingUploadFile();
    if (file) void uploadFile(file);
  }, [storageConfigured, uiState, uploadFile]);

  const saveBrowserDiagnostics = useCallback(
    async (recordingId: string) => {
      const capture = browserDiagnosticsRef.current;
      browserDiagnosticsRef.current = null;
      if (extensionCapture && !extensionCapture.developerLogsEnabled) {
        capture?.dispose();
        return;
      }
      let localSnapshot: BrowserDiagnosticsData | null = null;
      try {
        localSnapshot = capture?.stop() ?? null;
      } catch (err) {
        capture?.dispose();
        console.warn("[recorder] browser diagnostics stop failed:", err);
      }
      let extensionResponse: ClipsExtensionDiagnosticsResponse | null = null;
      if (extensionCapture) {
        try {
          extensionResponse =
            await sendClipsExtensionMessage<ClipsExtensionDiagnosticsResponse>(
              extensionCapture.extensionId,
              {
                type: "CLIPS_CAPTURE_STOP",
                sessionId: extensionCapture.sessionId,
                recordingId,
              },
            );
        } catch (err) {
          console.warn("[recorder] extension diagnostics stop failed:", err);
        }
      }
      const extensionSnapshot =
        extensionResponse?.ok && extensionResponse.diagnostics
          ? extensionResponse.diagnostics
          : null;
      const snapshot = extensionSnapshot ?? localSnapshot;
      if (!snapshot) return;
      try {
        await callAction(
          "save-browser-diagnostics" as any,
          {
            recordingId,
            source: extensionSnapshot ? "extension" : "browser-recorder",
            phase: "recording",
            pageUrl: snapshot.pageUrl,
            userAgent: snapshot.userAgent,
            startedAt: snapshot.startedAt,
            endedAt: snapshot.endedAt,
            consoleLogs: snapshot.consoleLogs,
            networkRequests: snapshot.networkRequests,
            interactionEvents: snapshot.interactionEvents,
          } as any,
        );
      } catch (err) {
        console.warn("[recorder] browser diagnostics save failed:", err);
      }
    },
    [extensionCapture],
  );

  const onCountdownComplete = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      await engine.start();
      trackEvent("app.first_action", {
        action: "recording_start",
        surface: "recorder",
        resource_type: "recording",
        resource_id: pendingRef.current?.id,
      });
      trackEvent("recording_started", {
        app_name: "clips",
        template_name: "clips",
        output_id: pendingRef.current?.id,
        recording_attempt_id: pendingRef.current?.id,
        capture_type:
          recordingMode === "camera"
            ? "camera"
            : resolvedDisplaySurface === "browser"
              ? "tab"
              : "screen",
        has_extension: Boolean(extensionCapture),
        surface: "recorder",
      });
      countdownAudioCueRef.current?.cleanup();
      countdownAudioCueRef.current = null;
      browserDiagnosticsRef.current?.dispose();
      browserDiagnosticsRef.current =
        extensionCapture && !extensionCapture.developerLogsEnabled
          ? null
          : createBrowserDiagnosticsCapture();
      const recordingId = pendingRef.current?.id;
      if (
        extensionCapture &&
        extensionCapture.developerLogsEnabled &&
        recordingId
      ) {
        void sendClipsExtensionMessage(extensionCapture.extensionId, {
          type: "CLIPS_CAPTURE_START",
          sessionId: extensionCapture.sessionId,
          recordingId,
          pageUrl: extensionCapture.sourceUrl ?? window.location.href,
        });
      }
      setUiState("recording");
      setIsPaused(false);
    } catch (err) {
      browserDiagnosticsRef.current?.dispose();
      browserDiagnosticsRef.current = null;
      const message =
        err instanceof Error
          ? err.message
          : t("recordRoute.couldNotStartRecorder");
      countdownAudioCueRef.current?.cleanup();
      countdownAudioCueRef.current = null;
      setError(message);
      setUiState("error");
      showRecordingErrorToast(message);
    }
  }, [
    extensionCapture,
    recordingMode,
    resolvedDisplaySurface,
    showRecordingErrorToast,
  ]);

  const finishSavedRecording = useCallback(
    async (
      recordingId: string,
      result: RecorderFinalizeResult,
      pendingCopy?: Promise<boolean>,
    ) => {
      pendingRef.current = null;
      engineRef.current = null;
      setCameraStream(null);
      setPreviewStream(null);
      setCompressionProgress(null);
      setUploadProgress(null);
      setSavingKind(null);
      setUiState("complete");
      const reportContext = bugReportContextRef.current;
      if (result.waitingForStorage) {
        infoUploadToast(t("recordRoute.recordingReadyToUpload"), {
          description: t("recordRoute.connectStorageToFinish"),
          duration: 12_000,
        });
      } else if (reportContext) {
        completeUploadToast(t("recordRoute.recordingSaved"));
      } else {
        showSavedToast(
          t("recordRoute.recordingSaved"),
          await (pendingCopy ??
            copyFreshRecordingShareLink(recordingId, authSession)),
          recordingId,
        );
      }

      if (reportContext) {
        const path = bugReportDonePath(
          recordingId,
          reportContext,
          clipIntakeRef.current,
        );
        await writeAppState(`navigate:${getBrowserTabId()}`, {
          view: "bug-report-done",
          recordingId,
          path,
        }).catch(() => {});
        setTimeout(() => {
          void navigate(path);
        }, 50);
        return;
      }

      await writeAppState(`navigate:${getBrowserTabId()}`, {
        view: "recording",
        recordingId,
      }).catch(() => {});
      setTimeout(() => {
        void navigate(`/r/${recordingId}`);
      }, 50);
    },
    [
      authSession,
      completeUploadToast,
      infoUploadToast,
      navigate,
      showSavedToast,
      t,
    ],
  );

  const doStop = useCallback(async () => {
    const engine = engineRef.current;
    const pending = pendingRef.current;
    if (!engine || !pending) return;
    const engineState = engine.getState();
    if (
      engineState === "stopping" ||
      engineState === "uploading" ||
      engineState === "complete"
    ) {
      return;
    }
    setSavingKind("recording");
    setUiState("uploading");
    startUploadToast(t("recordRoute.savingRecording"));
    const diagnosticsSave = saveBrowserDiagnostics(pending.id).catch((err) => {
      console.warn("[recorder] browser diagnostics save failed:", err);
    });
    try {
      const browserTranscript = await liveTranscription.stopAndWait();
      const trimmedTranscript = browserTranscript.trim();
      const incompleteReason = liveTranscription.getIncompleteReason();
      if (trimmedTranscript) {
        const transcriptRes = await fetch(
          agentNativePath("/_agent-native/actions/save-browser-transcript"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              recordingId: pending.id,
              fullText: trimmedTranscript,
              source: "web-speech",
              failureReason: incompleteReason ?? undefined,
            }),
          },
        ).catch((err) => {
          console.warn("[recorder] native transcript save failed:", err);
          return null;
        });
        if (transcriptRes && !transcriptRes.ok) {
          console.warn(
            "[recorder] native transcript save failed:",
            transcriptRes.status,
          );
        }
      } else {
        await fetch(
          agentNativePath("/_agent-native/actions/save-browser-transcript"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              recordingId: pending.id,
              fullText: "",
              source: "web-speech",
              failureReason:
                incompleteReason ??
                (liveTranscription.supported
                  ? "Browser native transcription returned no speech before recording stopped."
                  : "Browser Web Speech recognition is unavailable in this browser."),
            }),
          },
        ).catch((err) => {
          console.warn(
            "[recorder] native transcript failure save failed:",
            err,
          );
        });
      }

      const stopResult = await engine.stop();
      const pendingCopy =
        stopResult.waitingForStorage || bugReportContextRef.current
          ? undefined
          : copyFreshRecordingShareLink(pending.id, authSession).catch(
              () => false,
            );
      await diagnosticsSave;
      await finishSavedRecording(pending.id, stopResult, pendingCopy);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("recordRoute.uploadFailed");
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      await diagnosticsSave;
      if (!isStoredButUnservableFinalizeError(message)) {
        fetch(pending.abortUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: message,
            ...uploadAbortMetadata(err),
            ...engine.getUploadAbortFence(),
          }),
        }).catch(() => {});
      }
      setError(message);
      setUiState("error");
      failUploadToast(t("recordRoute.uploadFailed"), {
        description: message,
        duration: 12_000,
      });
    }
  }, [
    authSession,
    failUploadToast,
    finishSavedRecording,
    liveTranscription,
    saveBrowserDiagnostics,
    startUploadToast,
    t,
  ]);

  doStopRef.current = doStop;

  const retryFailedUpload = useCallback(async () => {
    const engine = engineRef.current;
    const pending = pendingRef.current;
    if (!engine || !pending || !engine.canRetryUpload()) return;

    setError(null);
    setCompressionProgress(null);
    setUploadProgress(null);
    setSavingKind("recording");
    setUiState("uploading");
    startUploadToast(t("recordRoute.savingRecording"));
    try {
      const retryResult = await engine.retryUpload();
      await finishSavedRecording(pending.id, retryResult);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      const message =
        err instanceof Error ? err.message : t("recordRoute.uploadFailed");
      if (!isStoredButUnservableFinalizeError(message)) {
        fetch(pending.abortUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: message,
            ...uploadAbortMetadata(err),
            ...engine.getUploadAbortFence(),
          }),
        }).catch(() => {});
      }
      setCompressionProgress(null);
      setUploadProgress(null);
      setError(message);
      setUiState("error");
      failUploadToast(t("recordRoute.uploadFailed"), {
        description: message,
        duration: 12_000,
      });
    }
  }, [failUploadToast, finishSavedRecording, startUploadToast, t]);

  const downloadBufferedRecording = useCallback(() => {
    const download = engineRef.current?.getBufferedRecordingDownload();
    if (!download) {
      toast.error(t("recordRoute.noLocalRecordingData"));
      return;
    }
    const url = URL.createObjectURL(download.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = download.filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    toast.success(t("recordRoute.recordingDownloadStarted"));
  }, []);

  const doCancel = useCallback(async () => {
    dismissUploadToast();
    cancelledStartSessionRef.current = startSessionRef.current;
    startSessionRef.current += 1;
    countdownAudioCueRef.current?.cleanup();
    countdownAudioCueRef.current = null;
    const uploadRecordingId = fileUploadRecordingIdRef.current;
    const uploadAbortUrl = fileUploadAbortUrlRef.current;
    if (fileUploadAbortRef.current) {
      fileUploadAbortRef.current.abort(makeAbortError("Upload cancelled"));
      fileUploadAbortRef.current = null;
    }
    fileUploadRecordingIdRef.current = null;
    fileUploadAbortUrlRef.current = null;
    const engine = engineRef.current;
    const pendingUploadFence = engine?.getUploadAbortFence() ?? {};
    const pendingId = pendingRef.current?.id;
    const pendingAbortUrl = pendingRef.current?.abortUrl;
    engineRef.current = null;
    pendingRef.current = null;
    liveTranscription.stop();
    browserDiagnosticsRef.current?.dispose();
    browserDiagnosticsRef.current = null;
    if (extensionCapture) {
      void sendClipsExtensionMessage(extensionCapture.extensionId, {
        type: "CLIPS_CAPTURE_CANCEL",
        sessionId: extensionCapture.sessionId,
      });
    }
    try {
      await engine?.cancel("user_cancelled");
    } catch {
      // ignore
    }
    if (pendingId) {
      // The recording may have already finished uploading server-side (the
      // final chunk can land, and the row can flip to "ready", while we're
      // still awaiting saveBrowserDiagnostics/finishSavedRecording on the
      // client). A separate GET-status-then-POST-trash sequence would still
      // race finalize between the two calls, so ask the server to trash
      // atomically instead: `skipIfReady` makes the trash a conditional
      // no-op if the row is already "ready" by the time the UPDATE runs, so a
      // fully saved video is never silently discarded.
      if (pendingAbortUrl && clipIntakeRef.current) {
        fetch(pendingAbortUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: "Recording cancelled by user",
            failureCode: "user_cancelled",
            ...pendingUploadFence,
          }),
        }).catch(() => {});
      } else {
        fetch(agentNativePath("/_agent-native/actions/trash-recording"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: pendingId, skipIfReady: true }),
        }).catch(() => {});
      }
    }
    if (uploadRecordingId) {
      if (uploadAbortUrl) {
        fetch(uploadAbortUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: "Recording cancelled by user",
            failureCode: "user_cancelled",
          }),
        }).catch(() => {});
      } else {
        fetch(agentNativePath("/_agent-native/actions/trash-recording"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: uploadRecordingId, skipIfReady: true }),
        }).catch(() => {});
      }
    }
    setCameraStream(null);
    setPreviewStream(null);
    setIsPaused(false);
    setSavingKind(null);
    setUiState("idle");
    setUploadProgress(null);
  }, [dismissUploadToast, extensionCapture, liveTranscription]);

  const playCountdownAudioCue = useCallback(() => {
    void countdownAudioCueRef.current?.play();
  }, []);

  const togglePause = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    visibilityAutoPausedRef.current = false;
    if (engine.getState() === "paused") {
      engine.resume();
      liveTranscription.resume();
      setIsPaused(false);
    } else {
      engine.pause();
      liveTranscription.pause();
      setIsPaused(true);
    }
  }, [liveTranscription]);

  const requestDiscard = useCallback(() => {
    const engine = engineRef.current;
    if (uiState === "recording" && engine && engine.getState() !== "paused") {
      engine.pause();
      liveTranscription.pause();
      setIsPaused(true);
      discardAutoPausedRef.current = true;
    }
    setDiscardConfirmOpen(true);
  }, [uiState, liveTranscription]);

  const resumeFromDiscardPrompt = useCallback(() => {
    setDiscardConfirmOpen(false);
    if (!discardAutoPausedRef.current) return;
    discardAutoPausedRef.current = false;
    const engine = engineRef.current;
    if (!engine) return;
    engine.resume();
    liveTranscription.resume();
    setIsPaused(false);
  }, [liveTranscription]);

  const confirmDiscard = useCallback(() => {
    discardAutoPausedRef.current = false;
    setDiscardConfirmOpen(false);
    void doCancel();
  }, [doCancel]);

  useEffect(() => {
    if (!discardConfirmOpen) return;
    if (
      uiState === "recording" ||
      uiState === "uploading" ||
      uiState === "compressing"
    ) {
      return;
    }
    discardAutoPausedRef.current = false;
    setDiscardConfirmOpen(false);
  }, [uiState, discardConfirmOpen]);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!isMobileRecorderRuntime(navigator)) return;
    if (recordingMode !== "camera" || !cameraStream) {
      visibilityAutoPausedRef.current = false;
      return;
    }

    const videoTracks = cameraStream.getVideoTracks();
    const syncCaptureSuspension = () => {
      const engine = engineRef.current;
      if (!engine) {
        visibilityAutoPausedRef.current = false;
        return;
      }

      const decision = decideRecordingVisibilityAction({
        mode: recordingMode,
        mobileRuntime: true,
        documentHidden: document.hidden,
        cameraTrackMuted: videoTracks.some((track) => track.muted),
        recorderState: engine.getState(),
        autoPaused: visibilityAutoPausedRef.current,
      });
      visibilityAutoPausedRef.current = decision.autoPaused;

      if (decision.action === "pause") {
        engine.pause();
        liveTranscription.pause();
        setIsPaused(true);
      } else if (decision.action === "resume") {
        engine.resume();
        liveTranscription.resume();
        setIsPaused(false);
      }
    };

    document.addEventListener("visibilitychange", syncCaptureSuspension);
    for (const track of videoTracks) {
      track.addEventListener("mute", syncCaptureSuspension);
      track.addEventListener("unmute", syncCaptureSuspension);
    }
    syncCaptureSuspension();

    return () => {
      document.removeEventListener("visibilitychange", syncCaptureSuspension);
      for (const track of videoTracks) {
        track.removeEventListener("mute", syncCaptureSuspension);
        track.removeEventListener("unmute", syncCaptureSuspension);
      }
    };
  }, [cameraStream, liveTranscription, recordingMode]);

  const restart = useCallback(() => {
    if (restartInFlightRef.current) return restartInFlightRef.current;
    const run = (async () => {
      await doCancel();
      const opts = pendingStartOptsRef.current;
      if (opts) {
        await startFlow(opts);
      }
    })();
    restartInFlightRef.current = run;
    void run.then(
      () => {
        if (restartInFlightRef.current === run) {
          restartInFlightRef.current = null;
        }
      },
      () => {
        if (restartInFlightRef.current === run) {
          restartInFlightRef.current = null;
        }
      },
    );
    return run;
  }, [doCancel, startFlow]);

  const handlePlayheadConfirmChange = useCallback(
    (
      change: import("@shared/recording-playhead").RecordingPlayheadConfirmChange,
    ) => {
      playheadConfirmOpenRef.current = change.type === "open";
      if (change.type === "open") {
        if (!change.enteredPaused) {
          const engine = engineRef.current;
          engine?.pause();
          liveTranscription.pause();
          setIsPaused(true);
        }
        return;
      }
      if (change.resume || !change.enteredPaused) {
        const engine = engineRef.current;
        if (engine?.getState() === "paused") {
          engine.resume();
          liveTranscription.resume();
          setIsPaused(false);
        }
      }
    },
    [liveTranscription],
  );

  const handlePlayheadConfirmAction = useCallback(
    (intent: import("@shared/recording-playhead").RecordingPlayheadIntent) => {
      playheadConfirmOpenRef.current = false;
      if (intent === "restart") {
        void restart();
      } else {
        void doCancel();
      }
    },
    [doCancel, restart],
  );

  const fireConfetti = useCallback(() => {
    confettiRef.current?.burst();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (discardConfirmOpen || playheadConfirmOpenRef.current) return;
      const alt = e.altKey;
      const shift = e.shiftKey;
      const meta = e.metaKey;
      const ctrl = e.ctrlKey;
      const k = e.key.toLowerCase();

      const isEscape =
        e.key === "Escape" || e.key === "Esc" || e.code === "Escape";
      if (isEscape) {
        if (uiState === "countdown") {
          e.preventDefault();
          e.stopPropagation();
          void doCancel();
          return;
        }
        const engineState = engineRef.current?.getState();
        if (
          uiState === "recording" ||
          engineState === "recording" ||
          engineState === "paused"
        ) {
          e.preventDefault();
          e.stopPropagation();
          void doStopRef.current();
          return;
        }
      }

      if (alt && shift && k === "p") {
        if (uiState === "recording") {
          e.preventDefault();
          togglePause();
          return;
        }
      }

      if (alt && shift && k === "c") {
        if (
          uiState === "recording" ||
          uiState === "uploading" ||
          uiState === "compressing"
        ) {
          e.preventDefault();
          requestDiscard();
          return;
        }
        if (uiState !== "idle") {
          e.preventDefault();
          void doCancel();
          return;
        }
      }

      if (alt && shift && k === "r") {
        if (uiState === "recording" || uiState === "countdown") {
          e.preventDefault();
          void restart();
          return;
        }
      }

      if ((ctrl && meta && k === "c") || (ctrl && alt && k === "c")) {
        if (uiState === "recording") {
          e.preventDefault();
          fireConfetti();
          return;
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    uiState,
    discardConfirmOpen,
    togglePause,
    doCancel,
    requestDiscard,
    doStop,
    restart,
    fireConfetti,
  ]);

  // Query params can preselect recorder controls, but browser capture must
  // still start from the user's Start click. Calling getDisplayMedia from an
  // effect loses Chrome's transient user activation and looks like a fake
  // permission failure even when Camera and Microphone are already allowed.

  useEffect(() => {
    let released = false;
    const releaseCapture = () => {
      if (released) return;
      released = true;
      startSessionRef.current += 1;
      if (fileUploadAbortRef.current) {
        fileUploadAbortRef.current.abort(makeAbortError("Upload cancelled"));
        fileUploadAbortRef.current = null;
      }
      stopLiveTranscription();
      browserDiagnosticsRef.current?.dispose();
      browserDiagnosticsRef.current = null;
      if (extensionCapture) {
        void sendClipsExtensionMessage(extensionCapture.extensionId, {
          type: "CLIPS_CAPTURE_CANCEL",
          sessionId: extensionCapture.sessionId,
        });
      }
      const engine = engineRef.current;
      engineRef.current = null;
      pendingRef.current = null;
      setCameraStream(null);
      setPreviewStream(null);
      void engine?.cancel("unknown");
    };
    const warnBeforeDiscard = (event: BeforeUnloadEvent) => {
      if (!engineRef.current?.hasRecordingAtRisk()) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("pagehide", releaseCapture);
    window.addEventListener("beforeunload", warnBeforeDiscard);
    return () => {
      window.removeEventListener("pagehide", releaseCapture);
      window.removeEventListener("beforeunload", warnBeforeDiscard);
      releaseCapture();
    };
  }, [extensionCapture, stopLiveTranscription]);

  const {
    leavePromptOpen,
    onDialogOpenChange,
    onCloseAutoFocus,
    confirmLeave,
  } = useRecordingLeaveGuard(
    useCallback(() => !!engineRef.current?.hasRecordingAtRisk(), []),
  );

  const showRecordingUi = uiState === "recording";
  const showSavingUi =
    (uiState === "uploading" || uiState === "complete") &&
    savingKind === "recording";
  const showUploadOverlay =
    (uiState === "uploading" || uiState === "complete") &&
    savingKind !== "recording";
  const showCameraBubble =
    cameraStream !== null && recordingMode !== "screen" && uiState !== "idle";
  const rememberedRecorderOptions = pendingStartOptsRef.current;
  const effectiveDisplaySurface =
    resolvedDisplaySurface ?? rememberedRecorderOptions?.displaySurface ?? null;
  const hideBubbleForFullScreenCapture =
    effectiveDisplaySurface === "monitor" &&
    recordingMode === "screen+camera" &&
    uiState === "recording";

  const showBackButton = uiState === "idle" || uiState === "error";

  return (
    <div className="relative min-h-[100dvh] overflow-x-clip bg-background text-foreground">
      {showBackButton && (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("recordRoute.backToLibrary")}
                onClick={() => {
                  void doCancel();
                  void navigate("/library");
                }}
                className="absolute start-3 top-3 z-30 rounded-full text-muted-foreground sm:start-4 sm:top-4"
              >
                <IconArrowLeft className="size-5 rtl:-scale-x-100" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {t("recordRoute.backToLibrary")}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {/* Idle / pre-record panel. `/record` sits outside the `_app` layout, so
          it renders its own standalone surface for direct visits. */}
      {uiState === "idle" && (
        <RecorderRouteViewport>
          <div className="mx-auto grid w-full max-w-[420px] gap-2">
            <div className="min-w-0">
              {storageQuery.isError ? (
                <StorageStatusRetry
                  onRetry={() => void storageQuery.refetch()}
                />
              ) : storageConfigured === null ? (
                <PreRecordPanelSkeleton />
              ) : storageConfigured ? (
                <PreRecordPanel
                  onStart={startFlow}
                  initialMode={
                    rememberedRecorderOptions?.mode ??
                    initialRecorderOptions.mode
                  }
                  initialDisplaySurface={
                    rememberedRecorderOptions?.displaySurface ??
                    initialRecorderOptions.surface
                  }
                />
              ) : (
                <StorageSetupCard
                  onConfigured={() => markStorageConfigured()}
                  connectSource="clips_record_storage_setup_card"
                  connectFlow="record"
                />
              )}
            </div>
            {!isDesktopApp && <DesktopRecorderCallout />}
          </div>
        </RecorderRouteViewport>
      )}

      {uiState === "pickingSources" && (
        <RecorderRouteViewport>
          <RecorderRouteStatus
            busy
            label={getPreparingSourcesCopy(
              recordingMode,
              pendingStartOptsRef.current?.micDeviceId,
            )}
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => void doCancel()}
            >
              {t("common.cancel")}
            </Button>
          </RecorderRouteStatus>
        </RecorderRouteViewport>
      )}

      {/* Countdown */}
      {uiState === "countdown" && (
        <CountdownOverlay
          seconds={3}
          onOneSecond={playCountdownAudioCue}
          onComplete={onCountdownComplete}
          onCancel={doCancel}
        />
      )}

      {/* Preview (camera-only mode renders camera full-screen; screen modes
          rely on the browser's "currently sharing" native pill). Also visible
          during the countdown so users can frame themselves before recording
          begins. */}
      {recordingMode === "camera" &&
        (showRecordingUi || uiState === "countdown") && (
          <video
            ref={previewVideoRef}
            autoPlay
            muted
            playsInline
            className="fixed inset-0 h-full w-full object-cover [transform:scaleX(-1)]"
          />
        )}

      {recordingMode !== "camera" && showRecordingUi && (
        <div className="pointer-events-none fixed inset-0 bg-foreground">
          <div
            aria-live="polite"
            className="absolute inset-0 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-6 text-center text-background/70"
          >
            <div className="flex items-center gap-2 text-sm">
              <span
                className={cn(
                  "inline-flex size-2.5 shrink-0 rounded-full",
                  isPaused
                    ? "bg-muted-foreground"
                    : "animate-pulse bg-destructive motion-reduce:animate-none",
                )}
              />
              {isPaused
                ? t("recordingToolbar.resumeRecording")
                : t("recordRoute.recordingScreen")}
            </div>
            {!isPaused && (
              <div className="text-[11px] text-background/50">
                Press{" "}
                <Kbd className="h-auto min-w-0 rounded bg-background/10 px-1.5 py-0.5 text-background">
                  Esc
                </Kbd>{" "}
                to stop
              </div>
            )}
          </div>
        </div>
      )}

      {recordingMode === "camera" && showRecordingUi && isPaused && (
        <div className="pointer-events-none fixed inset-0 flex items-center justify-center bg-background/60 px-6 backdrop-blur-sm">
          <div className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-sm">
            {t("recordingToolbar.resumeRecording")}
          </div>
        </div>
      )}

      {/* Camera bubble — shown during countdown (for framing) and recording.
          Hidden during uploading/compressing, and during full-screen recording
          so it isn't captured on top of the composited bubble. */}
      {showCameraBubble && (
        <CameraBubble
          stream={cameraStream}
          size={cameraSize}
          onSizeChange={handleCameraSizeChange}
          hidden={
            (uiState !== "recording" && uiState !== "countdown") ||
            hideBubbleForFullScreenCapture
          }
        />
      )}

      {/* Confetti */}
      <ConfettiCanvas ref={confettiRef} />

      {/* Floating toolbar */}
      {(showRecordingUi || showSavingUi) && (
        <RecordingToolbar
          active={uiState === "recording"}
          saving={showSavingUi}
          getElapsedMs={() => engineRef.current?.getElapsedMs() ?? 0}
          getMicrophoneTrack={() =>
            engineRef.current?.getMicrophoneTrack() ?? null
          }
          microphoneEnabled={wantsMicrophone(
            rememberedRecorderOptions?.micDeviceId,
          )}
          isPaused={isPaused}
          onTogglePause={togglePause}
          onStop={() => void doStop()}
          onCancel={requestDiscard}
          onConfirmAction={handlePlayheadConfirmAction}
          onConfirmChange={handlePlayheadConfirmChange}
        />
      )}

      <AlertDialog
        open={discardConfirmOpen}
        onOpenChange={(open) => {
          if (!open) resumeFromDiscardPrompt();
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("recordingToolbar.discardConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("recordingToolbar.discardConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("recordingToolbar.resume")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                confirmDiscard();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("recordingToolbar.discardRecording")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={leavePromptOpen} onOpenChange={onDialogOpenChange}>
        <AlertDialogContent
          onCloseAutoFocus={onCloseAutoFocus}
          className="max-w-sm"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("recordRoute.leaveConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("recordRoute.leaveConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                confirmLeave();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("recordRoute.leaveAndDiscard")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Uploading overlay (also covers the compressing pass which can run
          for several minutes on long recordings — without a distinct copy
          users wonder if the app froze). */}
      {(uiState === "compressing" ||
        (showUploadOverlay && uiState === "uploading")) && (
        <div className="fixed inset-0 z-[120] overflow-y-auto bg-background/90 backdrop-blur-sm">
          <div className="flex min-h-full items-center justify-center p-3 sm:p-6">
            <RecorderRouteStatus
              busy
              progress={
                uiState === "compressing" ? compressionProgress : uploadProgress
              }
              label={
                uiState === "compressing"
                  ? t("recordRoute.compressingRecording")
                  : t("recordRoute.savingRecording")
              }
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={requestDiscard}
                className="w-full text-muted-foreground hover:text-destructive"
              >
                {t("recordingToolbar.cancel")}
              </Button>
            </RecorderRouteStatus>
          </div>
        </div>
      )}

      {showUploadOverlay && uiState === "complete" && (
        <RecorderRouteViewport>
          <RecorderRouteStatus
            icon={<IconCircleCheck className="size-4 text-primary" />}
            label={t("recordRoute.recordingSaved")}
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => void navigate("/library")}
            >
              {t("recordRoute.backToLibrary")}
            </Button>
          </RecorderRouteStatus>
        </RecorderRouteViewport>
      )}

      {/* Error state */}
      {uiState === "error" && error && (
        <RecorderRouteViewport>
          {error.includes("No video storage configured") ? (
            <div className="w-full max-w-md">
              <StorageSetupCard
                onConfigured={() => {
                  markStorageConfigured();
                  setError(null);
                  setUiState("idle");
                  const opts = pendingStartOptsRef.current;
                  if (opts) {
                    window.setTimeout(() => {
                      void startFlow(opts);
                    }, 0);
                  }
                }}
                connectedDescription={t(
                  "recordRoute.storageConnectedReopeningRecorder",
                )}
                connectSource="clips_record_storage_setup_card"
                connectFlow="record"
              />
            </div>
          ) : error === "SESSION_EXPIRED" ? (
            <RecorderRouteStatus
              role="alert"
              icon={<IconAlertTriangle className="size-4" />}
              label={t("recordRoute.sessionExpired")}
            >
              <Button
                type="button"
                className="w-full"
                onClick={() => window.location.reload()}
              >
                {t("recordRoute.logIn")}
              </Button>
            </RecorderRouteStatus>
          ) : (
            <RecordingErrorCard
              error={error}
              mode={recordingMode}
              micDeviceId={pendingStartOptsRef.current?.micDeviceId ?? null}
              canRetryUpload={!!engineRef.current?.canRetryUpload()}
              canDownloadRecording={
                !!engineRef.current?.canDownloadBufferedRecording()
              }
              onDownloadRecording={downloadBufferedRecording}
              onTryAgain={() => {
                if (engineRef.current?.canRetryUpload()) {
                  void retryFailedUpload();
                } else {
                  void restart();
                }
              }}
            />
          )}
        </RecorderRouteViewport>
      )}
    </div>
  );
}
