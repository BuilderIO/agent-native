import {
  agentNativePath,
  appBasePath,
  callAction,
  captureClientException,
  useT,
} from "@agent-native/core/client";
import { useLiveTranscription } from "@agent-native/core/client/transcription/use-live-transcription";
import type { BrowserDiagnosticsData } from "@shared/browser-diagnostics";
import {
  chunkUploadUrl,
  pickMimeType,
  type UploadMode,
} from "@shared/recording-core";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCamera,
  IconDeviceDesktop,
  IconDownload,
  IconExternalLink,
  IconMicrophone,
  IconRefresh,
  IconVideo,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router";

import { Skeleton } from "@/components/ui/skeleton";
import { useDesktopPromo } from "@/hooks/use-desktop-promo";
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
import {
  loadRecorderPreferences,
  saveRecorderPreferences,
} from "@/lib/recorder-preferences";
import {
  buildCaptureTitle,
  defaultRecordingTitle,
  inferWindowTitleFromDisplayStream,
} from "@/lib/recording-title";
import {
  captureVideoThumbnailBlob,
  uploadRecordingThumbnail,
} from "@/lib/thumbnail-capture";
import { cn } from "@/lib/utils";

// Client-side app-state writer (the server module pulls in Node's `events`
// and cannot be bundled for the browser).
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
  bugReportTitle,
  parseBugReportContext,
  type BugReportContext,
} from "@shared/bug-report";
import { toast } from "sonner";

import { CaptureInstallButton } from "@/components/capture-install-options";
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
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [{ title: enMessages.recordRoute.pageTitle }];
}

export function headers() {
  return {
    "Permissions-Policy":
      "camera=(self), microphone=(self), display-capture=(self), geolocation=(), screen-wake-lock=()",
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

function bugReportDonePath(recordingId: string, context: BugReportContext) {
  const params = new URLSearchParams({ recordingId });
  if (context.returnUrl) params.set("returnUrl", context.returnUrl);
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
    if (isEmbeddedWindow()) {
      return "The web client is running Clips inside a frame. Open the recorder in its own tab, then start recording; Chrome can block screen sharing in embedded pages even when macOS access is enabled.";
    }
    if (isMacPlatform()) {
      return "Chrome can have Camera and Microphone allowed while macOS still blocks screen capture. Enable your browser in System Settings > Privacy & Security > Screen & System Audio Recording, then quit and reopen it.";
    }
    return "Choose a source in the browser screen picker. If it still fails, check this site's browser permissions and reload Clips.";
  }
  if (isCameraPermissionError(message)) {
    if (isMacPlatform()) {
      return "Allow Camera in this site's browser settings and in macOS System Settings > Privacy & Security > Camera, then reload Clips.";
    }
    return "Open this site's browser settings, allow Camera, then reload Clips.";
  }
  if (isMicrophonePermissionError(message)) {
    if (isMacPlatform()) {
      return "Allow Microphone in this site's browser settings and in macOS System Settings > Privacy & Security > Microphone, then reload Clips.";
    }
    return "Open this site's browser settings, allow Microphone, then reload Clips.";
  }
  if (isMacPlatform()) {
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
      return `Check this site's browser permissions first. If it still fails, enable ${readable} for your browser in macOS System Settings > Privacy & Security, then quit and reopen it.`;
    }
    return "Check this site's browser permissions first. If it still fails, open macOS System Settings > Privacy & Security for your browser, then quit and reopen it.";
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

function getRecordingErrorTitle(
  error: string,
  t: ReturnType<typeof useT>,
): string {
  if (isUploadSizeError(error)) return t("recordRoute.videoTooLarge");
  if (isUploadFailureError(error)) return t("recordRoute.uploadFailed");
  if (isScreenPermissionError(error)) return "Screen recording needs access";
  if (isCameraPermissionError(error)) return "Camera needs access";
  if (isMicrophonePermissionError(error)) return "Microphone needs access";
  return t("recordRoute.couldNotStartRecording");
}

function isUploadSizeError(error: string): boolean {
  return /too large to upload|too large for clips|limit is \d|file is too large|file size/i.test(
    error,
  );
}

function uploadTooLargeMessage(size: number, detail?: string): string {
  return `Video is too large to upload (${
    detail ?? formatMb(size)
  }, limit is ${formatMb(
    MAX_UPLOAD_BYTES,
  )}) after automatic compression. Trim or export a shorter copy and upload again.`;
}

function isUploadFailureError(error: string): boolean {
  return (
    isUploadSizeError(error) ||
    /upload failed|chunk|reset-chunks|re-upload/i.test(error)
  );
}

function friendlyRecordingErrorMessage(error: string): string {
  if (isUploadSizeError(error)) {
    return `This video is too large for Clips after automatic compression. Trim or export a shorter copy under ${formatMb(
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
      return "Clips could not start screen capture. Enable screen recording for your browser, then try again.";
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

function captureThumbnailFromPreview(
  video: HTMLVideoElement | null,
  recordingId: string,
): void {
  void captureVideoThumbnailBlob(video)
    .then((blob) => (blob ? uploadRecordingThumbnail(recordingId, blob) : null))
    .catch(() => {
      // best effort — the player has a backfill path if this misses.
    });
}

/** Resolve once the off-screen video has a decoded frame, or after a timeout. */
function waitForVideoFrame(
  video: HTMLVideoElement,
  timeoutMs: number,
): Promise<void> {
  if (video.videoWidth > 0 && video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("canplay", onReady);
      clearTimeout(timer);
      resolve();
    };
    const onReady = () => {
      if (video.videoWidth > 0 && video.readyState >= 2) finish();
    };
    video.addEventListener("loadeddata", onReady);
    video.addEventListener("canplay", onReady);
    const timer = setTimeout(finish, timeoutMs);
    onReady();
  });
}

/**
 * Capture a thumbnail from a MediaStream that isn't bound to a visible element
 * — used for the screen+camera composite so the thumbnail includes the camera
 * bubble. Best effort: if it misses, the player's backfill path (which reads
 * the recorded file, also composited) still produces a face thumbnail.
 */
function captureThumbnailFromStream(
  stream: MediaStream,
  recordingId: string,
): void {
  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  void (async () => {
    try {
      await video.play().catch(() => {});
      await waitForVideoFrame(video, 1500);
      const blob = await captureVideoThumbnailBlob(video);
      if (blob) await uploadRecordingThumbnail(recordingId, blob);
    } catch {
      // best effort — the player has a backfill path if this misses.
    } finally {
      try {
        video.pause();
      } catch {
        // ignore
      }
      video.srcObject = null;
    }
  })();
}

interface PendingRecording {
  id: string;
  uploadChunkUrl: string;
  abortUrl: string;
  uploadMode?: UploadMode;
}

function PreRecordPanelSkeleton() {
  return (
    <div className="mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-border bg-muted/20 shadow-lg">
      <div className="space-y-4 p-6">
        <div className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-64" />
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
          <Skeleton className="h-11 rounded-lg" />
          <Skeleton className="h-11 rounded-lg" />
          <Skeleton className="h-11 rounded-lg" />
        </div>
      </div>
      <div className="space-y-0 border-t border-border">
        <div className="flex items-center gap-3 px-6 py-4">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-36" />
          </div>
        </div>
        <div className="flex items-center gap-3 border-t border-border px-6 py-4">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
      </div>
      <div className="space-y-3 border-t border-border p-6">
        <Skeleton className="h-11 w-full rounded-md" />
        <Skeleton className="mx-auto h-8 w-48 rounded-md" />
      </div>
    </div>
  );
}

function DesktopRecorderCallout() {
  const t = useT();
  return (
    <aside className="w-full rounded-2xl border border-border bg-card p-4 shadow-lg">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <IconDeviceDesktop className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">
            {t("recordRoute.betterInDesktop")}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t("recordRoute.desktopAppDescription")}
          </p>
        </div>
      </div>
      <CaptureInstallButton
        size="sm"
        className="mt-4 w-full bg-primary text-primary-foreground hover:bg-primary/90"
      >
        {t("recordRoute.downloadDesktopApp")}
      </CaptureInstallButton>
    </aside>
  );
}

function RecordingErrorCard({
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
    !uploadFailure && isEmbeddedWindow() && isScreenPermissionError(error);
  const settings = permissionError
    ? getModePermissionLabels(mode, micDeviceId)
    : [];
  const directUrl = directRecorderUrl();
  const friendlyMessage = friendlyRecordingErrorMessage(error);
  const showTechnicalDetails = friendlyMessage !== error;

  return (
    <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
      <div className="border-b border-border p-6">
        <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-foreground">
          <IconAlertTriangle className="h-5 w-5" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">
          {getRecordingErrorTitle(error, t)}
        </h2>
        <p className="mt-2 break-words text-sm leading-relaxed text-muted-foreground">
          {friendlyMessage}
        </p>
        {showTechnicalDetails && (
          <details className="mt-3 text-start text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">
              {t("recordRoute.technicalDetails")}
            </summary>
            <p className="mt-2 max-h-28 overflow-auto break-words rounded-lg border border-border bg-muted/40 p-2 leading-relaxed">
              {error}
            </p>
          </details>
        )}
      </div>

      {guidance && (
        <div className="border-b border-border bg-muted/25 px-6 py-4 text-start">
          <div className="text-xs font-medium text-foreground">
            {t("recordRoute.whatToCheck")}
          </div>
          <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">
            {guidance}
          </p>
        </div>
      )}

      <div className="space-y-3 p-6">
        {/* Offer the download whenever local recording data survives, no matter
            why the upload failed — the user should never lose their video. They
            can re-import the saved file later via "Upload a video file". */}
        {canDownloadRecording && (
          <>
            <Button onClick={onDownloadRecording} className="w-full gap-2">
              <IconDownload className="h-4 w-4" />
              {t("recordRoute.downloadRecording")}
            </Button>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Your recording is safe on this device. Download it now and upload
              the file later from the recorder if it still won&apos;t save.
            </p>
          </>
        )}
        <Button variant="outline" onClick={onTryAgain} className="w-full gap-2">
          <IconRefresh className="h-4 w-4" />
          {canRetryUpload ? "Retry upload" : "Try again"}
        </Button>
        {(policyError || embeddedScreenError) && (
          <Button
            type="button"
            onClick={() => openUrlFromUserGesture(directUrl)}
            className="w-full gap-2"
          >
            <IconExternalLink className="h-4 w-4" />
            {t("recordRoute.openRecorderInTab")}
          </Button>
        )}
        {permissionError &&
          isMacPlatform() &&
          !policyError &&
          settings.length > 0 && (
            <div
              className={cn(
                "grid gap-2",
                settings.length === 1
                  ? "grid-cols-1"
                  : settings.length === 2
                    ? "grid-cols-2"
                    : "grid-cols-3",
              )}
            >
              {settings.includes("screen") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    openUrlFromUserGesture(MAC_SCREEN_RECORDING_PREF_URL);
                  }}
                  className="gap-1.5 px-2 text-xs"
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
                  className="gap-1.5 px-2 text-xs"
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
                  className="gap-1.5 px-2 text-xs"
                >
                  <IconMicrophone className="h-3.5 w-3.5" />
                  Mic
                </Button>
              )}
            </div>
          )}
      </div>
    </div>
  );
}

export default function RecordRoute() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const [uiState, setUiState] = useState<UiState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraSize, setCameraSize] = useState<CameraBubbleSize>(
    () => loadRecorderPreferences().cameraSize ?? "md",
  );
  // Remember the bubble size across visits alongside the panel's selections.
  const handleCameraSizeChange = useCallback((size: CameraBubbleSize) => {
    setCameraSize(size);
    saveRecorderPreferences({ cameraSize: size });
  }, []);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  // The capture surface the user actually picked in the browser's native screen
  // picker (authority over the requested `displaySurface` hint). Drives whether
  // the live camera bubble is hidden during full-screen recording.
  const [resolvedDisplaySurface, setResolvedDisplaySurface] =
    useState<DisplaySurface | null>(null);
  const [loomImporting, setLoomImporting] = useState(false);
  const [recordingMode, setRecordingMode] =
    useState<RecordingMode>("screen+camera");
  // Surfaced during the post-stop compression pass so the spinner can show
  // "Compressing… 42%" instead of "Saving your recording…" — otherwise
  // multi-minute encodes on long screen recordings look frozen.
  const [compressionProgress, setCompressionProgress] = useState<number | null>(
    null,
  );

  const queryClient = useQueryClient();
  const { isDesktopApp } = useDesktopPromo();
  const storageQuery = useVideoStorageStatus();

  // When the user clicks "Record for this space/folder", the empty-state CTA
  // appends ?spaceId or ?folderId so the new recording lands there.
  const spaceIdFromUrl = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("spaceId") || null;
  }, [location.search]);
  const folderIdFromUrl = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("folderId") || null;
  }, [location.search]);
  const storageConfigured: boolean | null = storageQuery.isLoading
    ? null
    : !!storageQuery.data?.configured;
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
  // Stable ref to doStop so engine callbacks created during startFlow always
  // call the latest version (avoids stale-closure problems with useCallback deps).
  const doStopRef = useRef<() => Promise<void>>(async () => {});
  const pendingStartOptsRef = useRef<{
    mode: RecordingMode;
    displaySurface: DisplaySurface;
    micDeviceId: string | null;
    cameraDeviceId: string | null;
  } | null>(null);
  const tickRef = useRef<number | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const fileUploadAbortRef = useRef<AbortController | null>(null);
  const browserDiagnosticsRef = useRef<BrowserDiagnosticsCapture | null>(null);
  // Bumped by doCancel() to invalidate any in-flight startFlow().
  const startSessionRef = useRef(0);

  // -------------------------------------------------------------------------
  // Timer
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (uiState !== "recording") {
      if (tickRef.current !== null) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }
    tickRef.current = window.setInterval(() => {
      const e = engineRef.current?.getElapsedMs() ?? 0;
      setElapsedMs(e);
    }, 250);
    return () => {
      if (tickRef.current !== null) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [uiState]);

  // -------------------------------------------------------------------------
  // Wire preview stream into its video element.
  // -------------------------------------------------------------------------
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
      toast.error(
        uploadFailure
          ? t("recordRoute.uploadFailed")
          : t("recordRoute.couldNotStartRecording"),
        {
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
        },
      );
    },
    [t],
  );

  // -------------------------------------------------------------------------
  // Acquire media, create recording row, start countdown.
  // -------------------------------------------------------------------------
  const startFlow = useCallback(
    async (opts: {
      mode: RecordingMode;
      displaySurface: DisplaySurface;
      micDeviceId: string | null;
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

      // Claim a session id; doCancel() bumps the ref to invalidate us.
      const session = startSessionRef.current + 1;
      startSessionRef.current = session;
      const isStale = () => startSessionRef.current !== session;

      countdownAudioCueRef.current?.cleanup();
      countdownAudioCueRef.current = createCountdownAudioCue();
      setError(null);
      setRecordingMode(opts.mode);
      pendingStartOptsRef.current = opts;
      // Clear any surface resolved by a previous capture; the engine reports the
      // new one once the user picks in the browser's screen dialog.
      setResolvedDisplaySurface(null);
      flushSync(() => {
        setUiState("pickingSources");
      });

      try {
        // Build the engine and trigger browser media prompts before any
        // network await. Brave drops the transient user activation after async
        // work, so calling getDisplayMedia after create-recording can fail
        // silently without showing a picker.
        const engine = new RecorderEngine({
          recordingId: "__pending__",
          mode: opts.mode,
          displaySurface: opts.displaySurface,
          micDeviceId: opts.micDeviceId,
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
          // Non-fatal device drops (camera unplugged, mic disconnected) — the
          // recording keeps going; just let the user know what happened.
          onWarning: (message) => {
            toast.warning(message);
          },
          // Track the surface the user actually chose (and any mid-recording
          // switch) so the live camera bubble is hidden only when the full
          // screen — including this tab's overlay — is being captured.
          onResolvedDisplaySurface: (surface) => {
            setResolvedDisplaySurface(surface);
          },
          onState: (state) => {
            // Mirror the engine's compression pass into the UI so the
            // "Saving your recording…" spinner becomes "Compressing…" for
            // the duration. Other engine states are managed by the UI's
            // own state machine in startFlow / doStop.
            if (state === "compressing") {
              setUiState("compressing");
            } else if (state === "uploading") {
              // Reset compression progress when the engine moves on to
              // upload — applies whether or not we just came from
              // compressing.
              setCompressionProgress(null);
              // Always sync the UI back to "uploading"; if we were already
              // there from doStop's pre-stop transition, this is a no-op.
              setUiState("uploading");
            }
          },
          onChunk: ({ index, bytes }) => {
            const recordingId = pendingRef.current?.id;
            if (!recordingId) return;
            void writeAppState(`recording-upload-${recordingId}`, {
              recordingId,
              status: "uploading",
              chunksReceived: index + 1,
              lastChunkBytes: bytes,
              updatedAt: new Date().toISOString(),
            }).catch(() => {});
          },
          // When the user clicks the browser's native "Stop sharing" button,
          // delegate to doStop() so the UI runs its full stop flow: thumbnail
          // capture, transcription flush, state updates, and navigation.
          // Using a ref so we always call the latest version of doStop even
          // though startFlow itself has empty deps.
          onDisplayTrackEnded: () => {
            void doStopRef.current();
          },
          onCompressionProgress: ({ stage, progress }) => {
            // The recorder engine is responsible for transitioning into the
            // `compressing` state. We mirror that into the UI via the
            // generic onState handler below; here we just track the
            // numeric progress so the spinner can show a percentage.
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

        // 1. Acquire media (triggers permission prompts) while the click's
        // transient activation is still live.
        const { previewStream: ps, cameraStream: cs } = await engine.acquire();
        if (isStale()) {
          await engine.cancel().catch(() => {});
          return;
        }
        const captureTitle = buildCaptureTitle({
          windowTitle: inferWindowTitleFromDisplayStream(ps),
          displaySurface: opts.displaySurface,
          mode: opts.mode,
        });

        const wantsMic = opts.micDeviceId !== NO_MIC_DEVICE_ID;
        // Web Speech does not let us pin a microphone device. If the user
        // chose a specific mic, do not start a parallel system-default mic
        // session for instant transcription; the recorded audio still uses
        // the exact selected device and can be transcribed after upload.
        //
        // The one exception is when a stale saved mic forced the engine to
        // fall back to the system default during acquire(): the recording is
        // now on the default device, so live transcription would use the same
        // mic and is safe to start.
        const usingDefaultMic =
          !opts.micDeviceId || engine.didMicFallBackToDefault();
        if (wantsMic && usingDefaultMic && liveTranscription.supported) {
          liveTranscription.start();
        }

        const status = await fetchVideoStorageStatus();
        if (isStale()) {
          await liveTranscription.stopAndWait().catch(() => "");
          await engine.cancel().catch(() => {});
          return;
        }
        markStorageConfigured(status);
        if (!status.configured) {
          throw new Error(
            "No video storage configured. Connect storage: Builder.io (free tier storage + AI) or S3-compatible storage.",
          );
        }

        // 2. Create the recording row server-side once permissions are granted.
        const reportContext = bugReportContextRef.current;
        const reportTitle = reportContext
          ? `Bug report: ${bugReportTitle(reportContext)}`
          : null;
        const res = await fetch(
          agentNativePath("/_agent-native/actions/create-recording"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: reportTitle ?? captureTitle.title,
              titleSource: reportTitle ? "context" : captureTitle.titleSource,
              sourceAppName: captureTitle.sourceAppName,
              sourceWindowTitle: captureTitle.sourceWindowTitle,
              hasCamera: opts.mode !== "screen",
              hasAudio: wantsMic,
              visibility: reportContext ? "org" : "public",
              spaceIds: spaceIdFromUrl ? [spaceIdFromUrl] : undefined,
              folderId: folderIdFromUrl ?? undefined,
              mimeType: pickMimeType() || undefined,
              requestStreaming: canUseTimeslicedRecorderChunks(pickMimeType()),
            }),
          },
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
            uploadMode?: UploadMode;
          };
          id?: string;
          uploadChunkUrl?: string;
          abortUrl?: string;
          uploadMode?: UploadMode;
        };
        const info = created.result ?? (created as PendingRecording);
        if (!info?.id) {
          throw new Error("create-recording did not return an id");
        }
        // Cancelled mid-POST: pendingRef is still null, so trash directly.
        if (isStale()) {
          await liveTranscription.stopAndWait().catch(() => "");
          fetch(agentNativePath("/_agent-native/actions/trash-recording"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: info.id }),
          }).catch(() => {});
          await engine.cancel().catch(() => {});
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
          uploadMode: info.uploadMode,
        });
        await saveBugReportContextRef.current(info.id);

        setPreviewStream(ps);
        setCameraStream(cs);
        setUiState("countdown");
      } catch (err) {
        // doCancel() owns teardown if a cancel raced ahead — don't clobber it.
        if (isStale()) return;
        const message =
          err instanceof Error
            ? err.message
            : t("recordRoute.couldNotStartRecording");
        const pickerDismissed = isDismissedCapturePicker(err, message);
        await liveTranscription.stopAndWait().catch(() => "");
        // If the recording row was created before the failure, trash it so it
        // doesn't sit in the library forever in 'uploading' status. This
        // is the bug that produced "stuck UPLOADING" cards from failed
        // record attempts.
        const orphan = pendingRef.current;
        if (orphan?.id) {
          fetch(agentNativePath("/_agent-native/actions/trash-recording"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: orphan.id }),
          }).catch(() => {});
        }
        // Release any tracks the engine grabbed before failing.
        try {
          await engineRef.current?.cancel();
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

  // -------------------------------------------------------------------------
  // Upload a local video file as a Clip.
  // Reads metadata via a hidden <video>, creates the recording row, then
  // streams the file to /api/uploads/:id/chunk in slices small enough for
  // Netlify's effective binary function payload limit. Mirrors the recorder's
  // upload pipeline so finalize-recording handles it identically.
  // -------------------------------------------------------------------------
  const UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024;

  const probeVideoMetadata = useCallback(
    (
      file: File,
    ): Promise<{ durationMs: number; width: number; height: number }> => {
      return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const video = document.createElement("video");
        video.preload = "metadata";
        video.muted = true;
        const cleanup = () => {
          URL.revokeObjectURL(url);
        };
        video.onloadedmetadata = () => {
          const durationMs =
            Number.isFinite(video.duration) && video.duration > 0
              ? Math.round(video.duration * 1000)
              : 0;
          const width =
            Number.isFinite(video.videoWidth) && video.videoWidth > 0
              ? Math.round(video.videoWidth)
              : 0;
          const height =
            Number.isFinite(video.videoHeight) && video.videoHeight > 0
              ? Math.round(video.videoHeight)
              : 0;
          resolve({
            durationMs,
            width,
            height,
          });
          cleanup();
        };
        video.onerror = () => {
          resolve({ durationMs: 0, width: 0, height: 0 });
          cleanup();
        };
        video.src = url;
      });
    },
    [],
  );

  const uploadFile = useCallback(
    async (file: File) => {
      const session = startSessionRef.current + 1;
      startSessionRef.current = session;
      const isStale = () => startSessionRef.current !== session;
      const abort = new AbortController();
      fileUploadAbortRef.current?.abort(makeAbortError("Upload cancelled"));
      fileUploadAbortRef.current = abort;

      setError(null);
      setUiState("uploading");
      setCompressionProgress(null);

      const acceptedMime = new Set([
        "video/mp4",
        "video/webm",
        "video/quicktime",
      ]);
      const baseType = (file.type || "").split(";")[0]?.trim().toLowerCase();
      let mimeType = baseType && acceptedMime.has(baseType) ? baseType : null;
      // Fallback by extension when the browser doesn't provide a type
      // (rare on macOS .mov files dragged from Finder).
      if (!mimeType) {
        const lower = file.name.toLowerCase();
        if (lower.endsWith(".mp4")) mimeType = "video/mp4";
        else if (lower.endsWith(".webm")) mimeType = "video/webm";
        else if (lower.endsWith(".mov")) mimeType = "video/quicktime";
      }
      if (!mimeType) {
        const message =
          "That file type isn't supported. Try MP4, WebM, or MOV.";
        if (fileUploadAbortRef.current === abort) {
          fileUploadAbortRef.current = null;
        }
        setError(message);
        setUiState("error");
        toast.error(message);
        return;
      }

      let createdId: string | null = null;
      try {
        const status = await fetchVideoStorageStatus();
        if (isStale()) return;
        markStorageConfigured(status);
        if (!status.configured) {
          throw new Error(
            "No video storage configured. Connect storage: Builder.io (free tier storage + AI) or S3-compatible storage.",
          );
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
        const reportContext = bugReportContextRef.current;
        const reportTitle = reportContext
          ? `Bug report: ${bugReportTitle(reportContext)}`
          : null;

        const res = await fetch(
          agentNativePath("/_agent-native/actions/create-recording"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: abort.signal,
            body: JSON.stringify({
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
            }),
          },
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
          result?: { id: string; uploadChunkUrl: string; abortUrl?: string };
          id?: string;
          uploadChunkUrl?: string;
          abortUrl?: string;
        };
        const info =
          created.result ??
          (created as {
            id: string;
            uploadChunkUrl: string;
            abortUrl?: string;
          });
        if (!info?.id) {
          throw new Error("create-recording did not return an id");
        }
        createdId = info.id;
        await saveBugReportContextRef.current(info.id);
        if (isStale()) throw makeAbortError("Upload cancelled");
        const uploadBase = `${appBasePath()}${info.uploadChunkUrl}`;

        const totalChunks = Math.max(
          1,
          Math.ceil(uploadBlob.size / UPLOAD_CHUNK_BYTES),
        );
        let finalChunkResult: Record<string, unknown> | null = null;
        for (let i = 0; i < totalChunks; i++) {
          if (isStale()) throw makeAbortError("Upload cancelled");
          const start = i * UPLOAD_CHUNK_BYTES;
          const end = Math.min(start + UPLOAD_CHUNK_BYTES, uploadBlob.size);
          const slice = uploadBlob.slice(start, end, uploadMimeType);
          const isFinal = i === totalChunks - 1;
          const chunkUrl = chunkUploadUrl(uploadBase, {
            index: i,
            total: totalChunks,
            isFinal,
            mimeType: uploadMimeType,
            durationMs: isFinal ? meta.durationMs : undefined,
            width: isFinal ? meta.width : undefined,
            height: isFinal ? meta.height : undefined,
            hasAudio: isFinal ? true : undefined,
            hasCamera: isFinal ? false : undefined,
          });
          const chunkRes = await fetch(chunkUrl, {
            method: "POST",
            headers: { "Content-Type": uploadMimeType },
            body: await slice.arrayBuffer(),
            signal: abort.signal,
          });
          if (!chunkRes.ok) {
            const text = await chunkRes.text().catch(() => "");
            const error = new Error(
              t("recordRoute.uploadFailedAtChunk", {
                chunk: i + 1,
                total: totalChunks,
                message: text || chunkRes.statusText,
              }),
            );
            (error as Error & { status?: number }).status = chunkRes.status;
            throw error;
          }
          if (isFinal) {
            finalChunkResult =
              ((await chunkRes.json().catch(() => null)) as Record<
                string,
                unknown
              > | null) ?? null;
          }
        }

        setUiState("complete");
        const waitingForStorage =
          finalChunkResult?.waitingForStorage === true ||
          finalChunkResult?.status === "waiting_storage";
        if (waitingForStorage) {
          toast.info(t("recordRoute.videoReadyToUpload"), {
            description: t("recordRoute.connectStorageToFinish"),
            duration: 12_000,
          });
        } else {
          toast.success(t("recordRoute.videoUploaded"));
        }
        if (reportContext && createdId) {
          const path = bugReportDonePath(createdId, reportContext);
          await writeAppState("navigate", {
            view: "bug-report-done",
            recordingId: createdId,
            path,
          });
          setTimeout(() => {
            navigate(path);
          }, 50);
        } else {
          await writeAppState("navigate", {
            view: "recording",
            recordingId: createdId,
          });
          setTimeout(() => {
            if (createdId) navigate(`/r/${createdId}`);
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
        if (createdId && !serverRejectedTooLarge) {
          fetch(`${appBasePath()}/api/uploads/${createdId}/abort`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: message }),
          }).catch(() => {});
        }
        if (aborted || isStale()) return;
        setError(message);
        setUiState("error");
        if (message !== "SESSION_EXPIRED") {
          toast.error(
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
        setCompressionProgress(null);
      }
    },
    [markStorageConfigured, navigate, probeVideoMetadata],
  );

  const importLoom = useCallback(
    async (url: string) => {
      startSessionRef.current += 1;
      fileUploadAbortRef.current?.abort(makeAbortError("Upload cancelled"));
      fileUploadAbortRef.current = null;
      setError(null);
      setLoomImporting(true);

      try {
        const result = (await callAction(
          "import-loom-recording" as any,
          {
            url,
            spaceIds: spaceIdFromUrl ? [spaceIdFromUrl] : undefined,
            folderId: folderIdFromUrl ?? undefined,
          } as any,
        )) as {
          recordingId?: string;
          status?: string;
          storageSetupRequired?: boolean;
        };
        const recordingId = result?.recordingId;
        if (!recordingId) {
          throw new Error("Loom import did not return a recording id.");
        }

        if (
          result?.storageSetupRequired ||
          result?.status === "waiting_storage"
        ) {
          toast.info(t("recordRoute.storageNeededToFinishLoomImport"), {
            description: t("recordRoute.connectStorageToRetryLoom"),
            duration: 12_000,
          });
        } else {
          toast.success(t("recordRoute.loomImported"));
        }
        await writeAppState("navigate", {
          view: "recording",
          recordingId,
        }).catch(() => {});
        navigate(`/r/${recordingId}`);
      } catch (err) {
        throw new Error(
          err instanceof Error
            ? err.message
            : t("recordRoute.couldNotImportLoom"),
        );
      } finally {
        setLoomImporting(false);
      }
    },
    [folderIdFromUrl, navigate, spaceIdFromUrl],
  );

  const saveBrowserDiagnostics = useCallback(
    async (recordingId: string) => {
      const capture = browserDiagnosticsRef.current;
      browserDiagnosticsRef.current = null;
      if (extensionCapture && !extensionCapture.developerLogsEnabled) {
        capture?.dispose();
        return;
      }
      const localSnapshot = capture?.stop() ?? null;
      const extensionResponse = extensionCapture
        ? await sendClipsExtensionMessage<ClipsExtensionDiagnosticsResponse>(
            extensionCapture.extensionId,
            {
              type: "CLIPS_CAPTURE_STOP",
              sessionId: extensionCapture.sessionId,
              recordingId,
            },
          )
        : null;
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
          } as any,
        );
      } catch (err) {
        console.warn("[recorder] browser diagnostics save failed:", err);
      }
    },
    [extensionCapture],
  );

  // -------------------------------------------------------------------------
  // After countdown → actually start MediaRecorder.
  // -------------------------------------------------------------------------
  const onCountdownComplete = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      await engine.start();
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
  }, [extensionCapture, showRecordingErrorToast]);

  // -------------------------------------------------------------------------
  // Stop / upload / navigate.
  // -------------------------------------------------------------------------
  const finishSavedRecording = useCallback(
    async (recordingId: string, result: RecorderFinalizeResult) => {
      // Recording is fully saved — clear refs so that if anything below throws
      // and the user clicks "Try again", doCancel() won't trash a good recording.
      pendingRef.current = null;
      engineRef.current = null;
      setCameraStream(null);
      setPreviewStream(null);
      setCompressionProgress(null);
      setUiState("complete");
      if (result.waitingForStorage) {
        toast.info(t("recordRoute.recordingReadyToUpload"), {
          description: t("recordRoute.connectStorageToFinish"),
          duration: 12_000,
        });
      } else {
        toast.success(t("recordRoute.recordingSaved"));
      }

      const reportContext = bugReportContextRef.current;
      if (reportContext) {
        const path = bugReportDonePath(recordingId, reportContext);
        await writeAppState("navigate", {
          view: "bug-report-done",
          recordingId,
          path,
        }).catch(() => {});
        setTimeout(() => {
          navigate(path);
        }, 50);
        return;
      }

      await writeAppState("navigate", {
        view: "recording",
        recordingId,
      }).catch(() => {});
      setTimeout(() => {
        navigate(`/r/${recordingId}`);
      }, 50);
    },
    [navigate],
  );

  const doStop = useCallback(async () => {
    const engine = engineRef.current;
    const pending = pendingRef.current;
    if (!engine || !pending) return;
    // Guard against concurrent calls (e.g. browser "Stop sharing" fires at the
    // same time the user also clicks the in-app stop button).
    const engineState = engine.getState();
    if (
      engineState === "stopping" ||
      engineState === "uploading" ||
      engineState === "complete"
    ) {
      return;
    }
    setUiState("uploading");
    try {
      // Capture a still-frame thumbnail while the stream is still live —
      // otherwise the library would show a blank card until the owner opens the
      // recording and triggers the player's backfill path. In screen+camera
      // mode the visible preview is screen-only, so grab the composited stream
      // (screen + camera bubble) to keep the presenter's face in the thumbnail.
      const compositeStream = engine.getCompositeStream();
      if (compositeStream) {
        captureThumbnailFromStream(compositeStream, pending.id);
      } else {
        captureThumbnailFromPreview(previewVideoRef.current, pending.id);
      }

      // Stop live transcription and save the native web transcript before the
      // engine finalizes. This gives the recording an instant transcript
      // (from Web Speech API) with no API key required.
      const browserTranscript = await liveTranscription.stopAndWait();
      const trimmedTranscript = browserTranscript.trim();
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
      }

      const stopResult = await engine.stop();
      await saveBrowserDiagnostics(pending.id);
      await finishSavedRecording(pending.id, stopResult);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("recordRoute.uploadFailed");
      // Distinguish user-initiated cancel from real failure. When the user
      // clicks Cancel mid-compression, engine.cancel() aborts the in-flight
      // compression pass; the still-pending engine.stop() above then throws
      // an error with `name === "AbortError"`. The recording was
      // intentionally discarded — surfacing it as "Upload failed" is
      // misleading (and was the original bug). So skip the error toast on
      // the cancel path; doCancel() owns the UI teardown. Anything else
      // (real upload failures, compression timeouts — which throw with
      // `name === "TimeoutError"` — network errors) keeps the existing
      // error toast.
      //
      // Detection is name-only. The abort invariant is: every cancel-shaped
      // error from the engine arrives with `name === "AbortError"` —
      // `RecorderEngine.cancel()` sets the name on the abort reason it
      // creates, and downstream sites that interpret abort signals
      // (`compress.ts`, the reset-chunks fetch catch in `recorder-engine`)
      // preserve that identity. So we don't need to grep error messages.
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      await saveBrowserDiagnostics(pending.id);
      fetch(pending.abortUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: message }),
      }).catch(() => {});
      setError(message);
      setUiState("error");
      toast.error(t("recordRoute.uploadFailed"), {
        description: message,
        duration: 12_000,
      });
    }
  }, [finishSavedRecording, liveTranscription, saveBrowserDiagnostics]);

  // Keep the ref current so engine callbacks always invoke the latest doStop.
  doStopRef.current = doStop;

  const retryFailedUpload = useCallback(async () => {
    const engine = engineRef.current;
    const pending = pendingRef.current;
    if (!engine || !pending || !engine.canRetryUpload()) return;

    setError(null);
    setCompressionProgress(null);
    setUiState("uploading");
    try {
      const retryResult = await engine.retryUpload();
      await finishSavedRecording(pending.id, retryResult);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      const message =
        err instanceof Error ? err.message : t("recordRoute.uploadFailed");
      fetch(pending.abortUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: message }),
      }).catch(() => {});
      setCompressionProgress(null);
      setError(message);
      setUiState("error");
      toast.error(t("recordRoute.uploadFailed"), {
        description: message,
        duration: 12_000,
      });
    }
  }, [finishSavedRecording]);

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
    // Invalidate any in-flight startFlow().
    startSessionRef.current += 1;
    countdownAudioCueRef.current?.cleanup();
    countdownAudioCueRef.current = null;
    if (fileUploadAbortRef.current) {
      fileUploadAbortRef.current.abort(makeAbortError("Upload cancelled"));
      fileUploadAbortRef.current = null;
    }
    const engine = engineRef.current;
    const pendingId = pendingRef.current?.id;
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
      await engine?.cancel();
    } catch {
      // ignore
    }
    if (pendingId) {
      fetch(agentNativePath("/_agent-native/actions/trash-recording"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: pendingId }),
      }).catch(() => {});
    }
    setCameraStream(null);
    setPreviewStream(null);
    setIsPaused(false);
    setUiState("idle");
    pendingRef.current = null;
    engineRef.current = null;
  }, [extensionCapture, liveTranscription]);

  const playCountdownAudioCue = useCallback(() => {
    void countdownAudioCueRef.current?.play();
  }, []);

  const togglePause = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
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

  const restart = useCallback(async () => {
    await doCancel();
    const opts = pendingStartOptsRef.current;
    if (opts) {
      await startFlow(opts);
    }
  }, [doCancel, startFlow]);

  const fireConfetti = useCallback(() => {
    confettiRef.current?.burst();
  }, []);

  // -------------------------------------------------------------------------
  // Keyboard shortcuts.
  // -------------------------------------------------------------------------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const alt = e.altKey;
      const shift = e.shiftKey;
      const meta = e.metaKey;
      const ctrl = e.ctrlKey;
      const k = e.key.toLowerCase();

      // Esc cancels the pre-record countdown. Once recording is live, it
      // finishes the clip just like the stop button.
      if (e.key === "Escape") {
        if (uiState === "countdown") {
          e.preventDefault();
          e.stopPropagation();
          void doCancel();
          return;
        }
        if (uiState === "recording") {
          e.preventDefault();
          e.stopPropagation();
          void doStop();
          return;
        }
      }

      // Opt/Alt+Shift+P — pause/resume
      if (alt && shift && k === "p") {
        if (uiState === "recording") {
          e.preventDefault();
          togglePause();
          return;
        }
      }

      // Opt/Alt+Shift+C — cancel
      if (alt && shift && k === "c") {
        if (uiState !== "idle") {
          e.preventDefault();
          void doCancel();
          return;
        }
      }

      // Opt/Alt+Shift+R — quick restart
      if (alt && shift && k === "r") {
        if (uiState === "recording" || uiState === "countdown") {
          e.preventDefault();
          void restart();
          return;
        }
      }

      // Ctrl+Cmd+C OR Ctrl+Alt+C — confetti
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
  }, [uiState, togglePause, doCancel, doStop, restart, fireConfetti]);

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
      void engine?.cancel();
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

  // -------------------------------------------------------------------------
  // Render.
  // -------------------------------------------------------------------------
  const showRecordingUi =
    uiState === "recording" ||
    uiState === "uploading" ||
    uiState === "compressing";
  const showCameraBubble =
    cameraStream !== null && recordingMode !== "screen" && uiState !== "idle";
  const rememberedRecorderOptions = pendingStartOptsRef.current;
  // The requested `displaySurface` is only a hint — the user picks the real
  // surface in the browser's native dialog and can even switch it mid-recording
  // (`surfaceSwitching: include`). Prefer the surface the engine resolved from
  // the live track, falling back to the requested one only when the browser
  // doesn't expose the resolved value (Firefox/Safari are partial).
  const effectiveDisplaySurface =
    resolvedDisplaySurface ?? rememberedRecorderOptions?.displaySurface ?? null;
  // Full-screen capture records this tab's own bubble, which the composite
  // already bakes into the video — hide the live overlay while recording so it
  // doesn't appear twice. Countdown isn't recorded; window/tab captures don't
  // include the overlay, so both keep it.
  const hideBubbleForFullScreenCapture =
    effectiveDisplaySurface === "monitor" &&
    recordingMode === "screen+camera" &&
    uiState === "recording";

  // `/record` is a fullscreen route outside the `_app` shell, so it has no
  // sidebar back-affordance. Surface a back arrow whenever there's nothing in
  // flight — during recording/countdown/uploading the toolbar's stop flow is
  // the exit path. `pickingSources` is included so users aren't trapped
  // when the browser's permission/source dialog hangs or they want to bail
  // out before granting access.
  const showBackButton =
    uiState === "idle" || uiState === "error" || uiState === "pickingSources";

  return (
    <div className="relative min-h-screen bg-background">
      {showBackButton && (
        <button
          type="button"
          aria-label={t("recordRoute.backToLibrary")}
          onClick={async () => {
            // If we landed in `error` after partial media acquisition, the
            // engine may still hold live screen/camera tracks. doCancel()
            // releases them synchronously (see RecorderEngine.cancel —
            // hardware teardown runs before the server-abort fetch is
            // awaited), so navigate() can fire immediately while the
            // best-effort server abort settles in the background.
            void doCancel();
            navigate("/library");
          }}
          className="fixed start-4 top-4 z-30 inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <IconArrowLeft className="h-5 w-5 rtl:-scale-x-100" />
        </button>
      )}

      {/* Idle / pre-record panel. `/record` sits outside the `_app` layout, so
          it renders its own standalone surface for direct visits. */}
      {uiState === "idle" && (
        <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
          <div className="mb-6 flex items-center gap-2 text-primary">
            <IconVideo className="h-6 w-6" />
            <span className="text-sm font-medium uppercase tracking-wide">
              {t("recordRoute.clipsRecorder")}
            </span>
          </div>
          <div className="relative w-full max-w-6xl">
            <div className="mx-auto w-full max-w-md">
              {storageConfigured === null ? (
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
                  onUpload={uploadFile}
                  onImportLoom={importLoom}
                  importingLoom={loomImporting}
                  cameraSize={cameraSize}
                  onCameraSizeChange={handleCameraSizeChange}
                />
              ) : (
                <StorageSetupCard
                  onConfigured={() => markStorageConfigured()}
                  connectSource="clips_record_storage_setup_card"
                  connectFlow="record"
                />
              )}
            </div>
            {!isDesktopApp && (
              <div className="mx-auto mt-4 w-full max-w-md xl:absolute xl:start-[calc(50%+18rem)] xl:top-0 xl:mt-0 xl:w-72">
                <DesktopRecorderCallout />
              </div>
            )}
          </div>
        </div>
      )}

      {uiState === "pickingSources" && (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-muted-foreground">
          <div className="text-sm">{t("recordRoute.preparingSources")}</div>
          <div className="text-xs">
            {getPreparingSourcesCopy(
              recordingMode,
              pendingStartOptsRef.current?.micDeviceId,
            )}
          </div>
        </div>
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
        <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-zinc-950 via-zinc-900 to-black opacity-95">
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/70">
            <div className="flex items-center gap-2 text-sm">
              <span className="relative inline-flex">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-30" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
              </span>
              {t("recordRoute.recordingScreen")}
            </div>
            <div className="text-[11px] text-white/50">
              Press <kbd className="rounded bg-white/10 px-1.5 py-0.5">Esc</kbd>{" "}
              to stop
            </div>
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
      {showRecordingUi && (
        <RecordingToolbar
          elapsedMs={elapsedMs}
          isPaused={isPaused}
          onTogglePause={togglePause}
          onStop={() => void doStop()}
          onConfetti={fireConfetti}
          onCancel={() => void doCancel()}
        />
      )}

      {/* Uploading overlay (also covers the compressing pass which can run
          for several minutes on long recordings — without a distinct copy
          users wonder if the app froze). */}
      {(uiState === "uploading" || uiState === "compressing") && (
        <div className="fixed inset-0 z-[120] flex flex-col items-center justify-center gap-3 bg-black/70 text-white backdrop-blur">
          <Spinner className="h-10 w-10 text-white/70" />
          {uiState === "compressing" ? (
            <>
              <div className="text-sm">
                Compressing your recording
                {compressionProgress !== null
                  ? ` — ${Math.round(compressionProgress * 100)}%`
                  : "…"}
              </div>
              <div className="text-[11px] text-white/50">
                {t("recordRoute.largeClipsNeedReencode")}
              </div>
            </>
          ) : (
            <div className="text-sm">{t("recordRoute.savingRecording")}</div>
          )}
          <button
            onClick={doCancel}
            className="mt-1 text-xs text-white/50 underline-offset-2 hover:text-white/80 hover:underline"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Error state */}
      {uiState === "error" && error && (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
          {error.includes("No video storage configured") ? (
            <>
              <div className="mb-2 flex items-center gap-2 text-primary">
                <IconVideo className="h-6 w-6" />
                <span className="text-sm font-medium uppercase tracking-wide">
                  {t("recordRoute.clipsRecorder")}
                </span>
              </div>
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
                connectedDescription="Storage connected. Reopening recorder..."
                connectSource="clips_record_storage_setup_card"
                connectFlow="record"
              />
            </>
          ) : error === "SESSION_EXPIRED" ? (
            <div className="max-w-md rounded-xl border border-border bg-card p-6">
              <div className="mb-2 text-sm font-semibold text-foreground">
                {t("recordRoute.sessionExpired")}
              </div>
              <div className="text-sm text-muted-foreground">
                {t("recordRoute.sessionExpiredDescription")}
              </div>
              <div className="mt-4 flex justify-center">
                <Button onClick={() => window.location.reload()}>
                  {t("recordRoute.logIn")}
                </Button>
              </div>
            </div>
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
                  // Re-run the same flow with the current mode/surface — users
                  // expect "Try again" to retry, not to wipe their selections.
                  void restart();
                }
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
