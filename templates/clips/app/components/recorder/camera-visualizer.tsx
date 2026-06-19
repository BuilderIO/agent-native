import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CameraBubbleSize } from "./camera-bubble";

export type CameraTestStatus = "idle" | "starting" | "live" | "error";

export interface CameraVisualizerProps {
  deviceId: string | null;
  disabled?: boolean;
  className?: string;
  size?: CameraBubbleSize;
  onSizeChange?: (size: CameraBubbleSize) => void;
  onStatusChange?: (
    status: CameraTestStatus,
    detail?: { error?: string | null },
  ) => void;
  onPreviewChange?: (hasPreview: boolean) => void;
}

const CAMERA_BUBBLE_SIZE_PX: Record<CameraBubbleSize, number> = {
  sm: 120,
  md: 200,
  lg: 320,
};

const CAMERA_SIZE_OPTIONS: Array<{ value: CameraBubbleSize; label: string }> = [
  { value: "sm", label: "S" },
  { value: "md", label: "M" },
  { value: "lg", label: "L" },
];

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
  className,
  size = "md",
  onSizeChange,
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

    // Claim runId before the first await so a stale call can't win the race.
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;

    const permissionState = await getCameraPermissionState();
    if (runIdRef.current !== runId) return;
    if (permissionState === "denied") {
      const message =
        "Brave already has Camera set to Block for this site, so it will not show the popup. Click the lock/tune icon in the address bar → Site settings → Camera → Allow, then reload.";
      setError(message);
      setStatus("error");
      onStatusChange?.("error", { error: message });
      return;
    }

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
      // Re-check after play()'s await so a newer startTest can't be clobbered.
      if (runIdRef.current !== runId) {
        stopCurrent();
        return;
      }
      setStatus("live");
      onStatusChange?.("live", { error: null });
    } catch (err) {
      stopStream(stream);
      if (runIdRef.current !== runId) return;
      const message = await friendlyCameraError(err);
      // friendlyCameraError awaits the Permissions API, so re-check after.
      if (runIdRef.current !== runId) return;
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

  useEffect(() => {
    if (status !== "live" && status !== "starting") return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }
    const tryPlay = () => {
      video.play().catch(() => undefined);
    };
    tryPlay();
    video.addEventListener("loadedmetadata", tryPlay, { once: true });
    return () => {
      video.removeEventListener("loadedmetadata", tryPlay);
    };
  }, [status]);

  const live = status === "live";
  const starting = status === "starting";
  const showBubble = live || starting;
  const sizePx = CAMERA_BUBBLE_SIZE_PX[size];
  return (
    <div className={cn("space-y-2", disabled && "opacity-70", className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 rounded-full border border-border bg-muted/20 py-0.5 pl-2 pr-0.5">
          <span className="text-[11px] text-muted-foreground">Bubble</span>
          {live || starting ? (
            <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm">
              {live ? (hasFrame ? "Live" : "Waiting") : "Opening"}
            </span>
          ) : null}
        </div>
        <div className="flex rounded-md bg-muted p-0.5">
          {CAMERA_SIZE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              aria-pressed={size === option.value}
              onClick={() => onSizeChange?.(option.value)}
              className={cn(
                "h-6 min-w-6 rounded px-2 text-[11px] font-medium text-muted-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                size === option.value &&
                  "bg-background text-foreground shadow-sm",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <Button
          type="button"
          variant={live ? "outline" : "secondary"}
          size="sm"
          disabled={disabled || starting}
          onClick={live ? stopTest : startTest}
          className="ml-auto h-7 shrink-0 px-2.5 text-xs"
        >
          {live ? "Stop" : starting ? "Opening..." : "Test"}
        </Button>
      </div>
      {showBubble && (
        <div className="fixed bottom-4 left-4 z-40 flex flex-col items-start gap-2">
          <div
            className={cn(
              "relative overflow-hidden rounded-full border-4 border-white/80 bg-black shadow-2xl ring-1",
              live && hasFrame ? "ring-black/25" : "ring-border",
            )}
            style={{ width: sizePx, height: sizePx }}
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
                "h-full w-full rounded-full object-cover [transform:scaleX(-1)]",
                !live && "opacity-0",
              )}
            />
            {!live && (
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-gradient-to-br from-muted/70 to-background px-5 text-center text-[11px] text-muted-foreground">
                Camera preview
              </div>
            )}
            {live && (
              <div
                className={cn(
                  "pointer-events-none absolute bottom-[12%] right-[18%] h-2.5 w-2.5 rounded-full ring-2 ring-white",
                  hasFrame ? "bg-foreground" : "bg-muted-foreground/40",
                )}
              />
            )}
          </div>
          <div className="rounded-full border border-border bg-background/95 p-1 shadow-lg backdrop-blur">
            {CAMERA_SIZE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-label={`Set camera bubble size ${option.label}`}
                aria-pressed={size === option.value}
                onClick={() => onSizeChange?.(option.value)}
                className={cn(
                  "h-7 min-w-7 rounded-full px-2 text-[11px] font-medium text-muted-foreground transition-colors",
                  size === option.value &&
                    "bg-foreground text-background shadow-sm",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {error ? (
        <p className="text-[11px] leading-snug text-foreground">{error}</p>
      ) : null}
    </div>
  );
}
