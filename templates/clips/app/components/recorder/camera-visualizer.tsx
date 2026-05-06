import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type CameraTestStatus = "idle" | "starting" | "live" | "error";

export interface CameraVisualizerProps {
  deviceId: string | null;
  disabled?: boolean;
  selectedLabel?: string | null;
  className?: string;
  onStatusChange?: (
    status: CameraTestStatus,
    detail?: { error?: string | null },
  ) => void;
  onPreviewChange?: (hasPreview: boolean) => void;
}

type CameraPermissionState = PermissionState | "unknown";

function stopStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // ignore
    }
  }
}

function isCameraBlockedByPolicy(): boolean {
  const policy =
    (
      document as Document & {
        permissionsPolicy?: { allowsFeature: (feature: string) => boolean };
        featurePolicy?: { allowsFeature: (feature: string) => boolean };
      }
    ).permissionsPolicy ??
    (
      document as Document & {
        featurePolicy?: { allowsFeature: (feature: string) => boolean };
      }
    ).featurePolicy;
  if (!policy?.allowsFeature) return false;
  try {
    return !policy.allowsFeature("camera");
  } catch {
    return false;
  }
}

async function getCameraPermissionState(): Promise<CameraPermissionState> {
  try {
    if (!navigator.permissions?.query) return "unknown";
    const status = await navigator.permissions.query({
      name: "camera" as PermissionName,
    });
    return status.state;
  } catch {
    return "unknown";
  }
}

async function friendlyCameraError(err: unknown): Promise<string> {
  const name = (err as { name?: string } | null)?.name ?? "";
  const message = err instanceof Error ? err.message : String(err ?? "");
  const combined = `${name} ${message}`;
  const permissionState = await getCameraPermissionState();
  const blockedByPolicy = isCameraBlockedByPolicy();

  console.warn("[camera-check] getUserMedia failed", {
    name,
    message,
    permissionState,
    blockedByPolicy,
    isSecureContext: window.isSecureContext,
  });

  if (blockedByPolicy) {
    return "This page is blocking camera access via Permissions-Policy. Restart the dev server, reload /record, then try again.";
  }
  if (!window.isSecureContext) {
    return "Camera prompts require HTTPS or localhost. Open this app on localhost or an HTTPS URL, then try again.";
  }
  if (permissionState === "denied") {
    return "Brave already has Camera set to Block for this site, so it will not show the popup. Click the lock/tune icon in the address bar → Site settings → Camera → Allow, then reload.";
  }
  if (/NotAllowedError|Permission denied|denied|blocked/i.test(combined)) {
    return "The browser or macOS denied camera access. If no popup appeared, check Brave site settings and macOS System Settings → Privacy & Security → Camera for Brave, then reload.";
  }
  if (
    /NotFoundError|DevicesNotFoundError|no device|not found/i.test(combined)
  ) {
    return "No camera was found. Plug one in or choose a different camera.";
  }
  if (/NotReadableError|TrackStartError|in use/i.test(combined)) {
    return "That camera is busy in another app. Close the other app or choose a different camera.";
  }
  return message || "Could not start the camera check.";
}

export function CameraVisualizer({
  deviceId,
  disabled,
  selectedLabel,
  className,
  onStatusChange,
  onPreviewChange,
}: CameraVisualizerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runIdRef = useRef(0);
  const previousDeviceIdRef = useRef(deviceId);

  const [status, setStatus] = useState<CameraTestStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hasFrame, setHasFrame] = useState(false);

  const clearVideo = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    setHasFrame(false);
    onPreviewChange?.(false);
  }, [onPreviewChange]);

  const stopCurrent = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
    clearVideo();
  }, [clearVideo]);

  const stopTest = useCallback(() => {
    runIdRef.current += 1;
    stopCurrent();
    setError(null);
    setStatus("idle");
    onStatusChange?.("idle", { error: null });
  }, [onStatusChange, stopCurrent]);

  const startTest = useCallback(async () => {
    if (disabled) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      const message =
        "Your browser doesn't support live camera checks. Try a recent Brave, Chrome, Edge, Safari, or Firefox.";
      setError(message);
      setStatus("error");
      onStatusChange?.("error", { error: message });
      return;
    }
    if (isCameraBlockedByPolicy()) {
      const message =
        "This page is blocking camera access via Permissions-Policy. Restart the dev server, reload /record, then try again.";
      setError(message);
      setStatus("error");
      onStatusChange?.("error", { error: message });
      return;
    }
    if (!window.isSecureContext) {
      const message =
        "Camera prompts require HTTPS or localhost. Open this app on localhost or an HTTPS URL, then try again.";
      setError(message);
      setStatus("error");
      onStatusChange?.("error", { error: message });
      return;
    }
    const permissionState = await getCameraPermissionState();
    if (permissionState === "denied") {
      const message =
        "Brave already has Camera set to Block for this site, so it will not show the popup. Click the lock/tune icon in the address bar → Site settings → Camera → Allow, then reload.";
      setError(message);
      setStatus("error");
      onStatusChange?.("error", { error: message });
      return;
    }

    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    stopCurrent();
    setError(null);
    setStatus("starting");
    onStatusChange?.("starting", { error: null });

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
        audio: false,
      });
      if (runIdRef.current !== runId) {
        stopStream(stream);
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => {});
      }
      setStatus("live");
      onStatusChange?.("live", { error: null });
    } catch (err) {
      stopStream(stream);
      if (runIdRef.current !== runId) return;
      const message = await friendlyCameraError(err);
      setError(message);
      setStatus("error");
      onStatusChange?.("error", { error: message });
      clearVideo();
    }
  }, [clearVideo, deviceId, disabled, onStatusChange, stopCurrent]);

  useEffect(() => {
    if (disabled) {
      previousDeviceIdRef.current = deviceId;
      if (status === "live" || status === "starting") {
        stopTest();
      } else {
        clearVideo();
      }
      return;
    }
    if (previousDeviceIdRef.current === deviceId) return;
    previousDeviceIdRef.current = deviceId;
    if (status === "live" || status === "starting") {
      void startTest();
    } else {
      clearVideo();
    }
  }, [clearVideo, deviceId, disabled, startTest, status, stopTest]);

  useEffect(() => {
    return () => {
      runIdRef.current += 1;
      stopCurrent();
    };
  }, [stopCurrent]);

  const live = status === "live";
  const starting = status === "starting";
  const helper = disabled
    ? "Camera is off for this recording mode."
    : error
      ? error
      : live
        ? hasFrame
          ? "Preview is live — your selected camera is working."
          : "Camera is connected. Waiting for the first frame…"
        : starting
          ? "Opening camera…"
          : "Click Test camera to preview the selected camera before recording.";

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-muted/25 p-3",
        disabled && "opacity-70",
        className,
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-foreground">
            Camera check
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {selectedLabel ?? "Selected camera"}
          </div>
        </div>
        <Button
          type="button"
          variant={live ? "outline" : "secondary"}
          size="sm"
          disabled={disabled || starting}
          onClick={live ? stopTest : startTest}
          className="h-8 px-2.5 text-xs"
        >
          {live ? "Stop" : starting ? "Starting…" : "Test camera"}
        </Button>
      </div>
      <div
        className={cn(
          "relative aspect-video overflow-hidden rounded-lg border bg-background",
          live && hasFrame ? "border-foreground/40" : "border-border",
        )}
      >
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          onLoadedData={() => {
            setHasFrame(true);
            onPreviewChange?.(true);
          }}
          aria-label="Selected camera preview"
          className={cn(
            "h-full w-full object-cover [transform:scaleX(-1)]",
            !live && "opacity-0",
          )}
        />
        {!live && (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-muted/70 to-background text-[11px] text-muted-foreground">
            Camera preview
          </div>
        )}
        {live && (
          <div
            className={cn(
              "pointer-events-none absolute right-2 top-2 h-2 w-2 rounded-full",
              hasFrame ? "bg-foreground" : "bg-muted-foreground/40",
            )}
          />
        )}
      </div>
      <p
        className={cn(
          "mt-2 text-[11px] leading-snug text-muted-foreground",
          error && "text-destructive",
        )}
      >
        {helper}
      </p>
    </div>
  );
}
