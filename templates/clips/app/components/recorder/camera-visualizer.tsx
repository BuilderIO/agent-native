import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertTriangle,
  IconCamera,
  IconCameraOff,
  IconLoader2,
} from "@tabler/icons-react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  createBackgroundBlurStream,
  DEFAULT_BLUR_PX,
  type CameraBlurHandle,
} from "@/lib/camera-blur";
import { cn } from "@/lib/utils";

import type { CameraBubbleSize } from "./camera-bubble";

export type CameraTestStatus = "idle" | "starting" | "live" | "error";

export interface CameraVisualizerProps {
  deviceId: string | null;
  disabled?: boolean;
  className?: string;
  /** Mirror the recording's background-blur setting in the live test preview. */
  blur?: boolean;
  /** Background blur radius (px) reflected live in the test preview. */
  blurRadius?: number;
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

const CAMERA_FRAME_TIMEOUT_MS = 5_000;

type CameraPermissionState = PermissionState | "unknown";
type PreviewAttachResult = "ready" | "pending" | "superseded" | "error";
type Translate = ReturnType<typeof useT>;
type CameraErrorKind =
  | "unsupported"
  | "policyBlocked"
  | "secureContextRequired"
  | "permissionBlocked"
  | "permissionDenied"
  | "notFound"
  | "inUse"
  | "startFailed"
  | "disconnected"
  | "noVideo";

function cameraErrorMessage(t: Translate, kind: CameraErrorKind): string {
  switch (kind) {
    case "unsupported":
      return t("cameraVisualizer.unsupported");
    case "policyBlocked":
      return t("cameraVisualizer.policyBlocked");
    case "secureContextRequired":
      return t("cameraVisualizer.secureContextRequired");
    case "permissionBlocked":
      return t("cameraVisualizer.permissionBlocked");
    case "permissionDenied":
      return t("cameraVisualizer.permissionDenied");
    case "notFound":
      return t("cameraVisualizer.notFound");
    case "inUse":
      return t("cameraVisualizer.inUse");
    case "disconnected":
      return t("cameraVisualizer.disconnected");
    case "noVideo":
      return t("cameraVisualizer.noVideo");
    case "startFailed":
      return t("cameraVisualizer.startFailed");
  }
}

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

async function friendlyCameraError(
  err: unknown,
  t: Translate,
): Promise<string> {
  const name = (err as { name?: string } | null)?.name ?? "";
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
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
    return cameraErrorMessage(t, "policyBlocked");
  }
  if (!window.isSecureContext) {
    return cameraErrorMessage(t, "secureContextRequired");
  }
  if (permissionState === "denied") {
    return cameraErrorMessage(t, "permissionBlocked");
  }
  if (/NotAllowedError|Permission denied|denied|blocked/i.test(combined)) {
    return cameraErrorMessage(t, "permissionDenied");
  }
  if (
    /NotFoundError|DevicesNotFoundError|no device|not found/i.test(combined)
  ) {
    return cameraErrorMessage(t, "notFound");
  }
  if (/NotReadableError|TrackStartError|in use/i.test(combined)) {
    return cameraErrorMessage(t, "inUse");
  }
  return cameraErrorMessage(t, "startFailed");
}

export function CameraVisualizer({
  deviceId,
  disabled,
  className,
  blur = false,
  blurRadius = DEFAULT_BLUR_PX,
  size = "md",
  onSizeChange,
  onStatusChange,
  onPreviewChange,
}: CameraVisualizerProps) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const blurHandleRef = useRef<CameraBlurHandle | null>(null);
  // Bumped per attachPreview() so a stale segmenter build (blur toggled mid-load)
  // bails instead of clobbering the preview.
  const attachGenRef = useRef(0);
  const blurRadiusRef = useRef(blurRadius);
  const runIdRef = useRef(0);
  const frameTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasFrameRef = useRef(false);
  const previousDeviceIdRef = useRef(deviceId);
  const previousBlurRef = useRef(blur);

  const [status, setStatus] = useState<CameraTestStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hasFrame, setHasFrame] = useState(false);

  const clearFrameTimeout = useCallback(() => {
    if (frameTimeoutRef.current === null) return;
    clearTimeout(frameTimeoutRef.current);
    frameTimeoutRef.current = null;
  }, []);

  const clearVideo = useCallback(() => {
    clearFrameTimeout();
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    hasFrameRef.current = false;
    setHasFrame(false);
    onPreviewChange?.(false);
  }, [clearFrameTimeout, onPreviewChange]);

  const stopCurrent = useCallback(() => {
    blurHandleRef.current?.cleanup();
    blurHandleRef.current = null;
    stopStream(streamRef.current);
    streamRef.current = null;
    clearVideo();
  }, [clearVideo]);

  const failPreview = useCallback(
    (runId: number, kind: "disconnected" | "noVideo") => {
      if (runIdRef.current !== runId) return;
      runIdRef.current += 1;
      stopCurrent();
      const message = cameraErrorMessage(t, kind);
      setError(message);
      setStatus("error");
      onStatusChange?.("error", { error: message });
    },
    [onStatusChange, stopCurrent, t],
  );

  const armFrameTimeout = useCallback(
    (runId: number) => {
      clearFrameTimeout();
      frameTimeoutRef.current = setTimeout(() => {
        if (hasFrameRef.current) return;
        failPreview(runId, "noVideo");
      }, CAMERA_FRAME_TIMEOUT_MS);
    },
    [clearFrameTimeout, failPreview],
  );

  // Bind the raw camera or its blurred derivative to the <video> per the current
  // `blur` setting, so the preview matches what recording bakes in. Each call
  // claims a generation and bails if a newer attach superseded it during an await.
  const attachPreview = useCallback(async (): Promise<PreviewAttachResult> => {
    const gen = ++attachGenRef.current;
    const raw = streamRef.current;
    const video = videoRef.current;
    if (!raw || !video) return "pending";

    let display: MediaStream = raw;
    if (blur) {
      blurHandleRef.current?.cleanup();
      blurHandleRef.current = null;
      const handle = await createBackgroundBlurStream(raw, {
        blurPx: blurRadiusRef.current,
      });
      if (gen !== attachGenRef.current || streamRef.current !== raw) {
        handle.cleanup();
        return "superseded";
      }
      blurHandleRef.current = handle;
      display = handle.stream;
    } else {
      blurHandleRef.current?.cleanup();
      blurHandleRef.current = null;
    }

    if (gen !== attachGenRef.current) return "superseded";
    if (video.srcObject !== display) video.srcObject = display;
    try {
      await video.play();
      return "ready";
    } catch {
      return gen === attachGenRef.current ? "error" : "superseded";
    }
  }, [blur]);

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
      const message = cameraErrorMessage(t, "unsupported");
      setError(message);
      setStatus("error");
      onStatusChange?.("error", { error: message });
      return;
    }
    if (isCameraBlockedByPolicy()) {
      const message = cameraErrorMessage(t, "policyBlocked");
      setError(message);
      setStatus("error");
      onStatusChange?.("error", { error: message });
      return;
    }
    if (!window.isSecureContext) {
      const message = cameraErrorMessage(t, "secureContextRequired");
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
      const message = cameraErrorMessage(t, "permissionBlocked");
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
      // Webcam unplugged mid-test: tear down so the preview + blur pipeline
      // don't keep running frozen. runId guard skips our own stop().
      for (const track of stream.getVideoTracks()) {
        track.addEventListener("ended", () => {
          failPreview(runId, "disconnected");
        });
      }
      // Arm the no-frame deadline before play(): some browsers leave its
      // promise pending when media cannot start.
      armFrameTimeout(runId);
      const attachResult = await attachPreview();
      // Re-check after the async attach so a newer startTest can't be clobbered.
      if (runIdRef.current !== runId) {
        stopCurrent();
        return;
      }
      if (attachResult === "error") {
        failPreview(runId, "noVideo");
        return;
      }
      setStatus("live");
      onStatusChange?.("live", { error: null });
    } catch (err) {
      stopStream(stream);
      if (runIdRef.current !== runId) return;
      const message = await friendlyCameraError(err, t);
      // friendlyCameraError awaits the Permissions API, so re-check after.
      if (runIdRef.current !== runId) return;
      setError(message);
      setStatus("error");
      onStatusChange?.("error", { error: message });
      clearVideo();
    }
  }, [
    attachPreview,
    armFrameTimeout,
    clearFrameTimeout,
    clearVideo,
    deviceId,
    disabled,
    failPreview,
    onStatusChange,
    stopCurrent,
    stopTest,
    t,
  ]);

  useEffect(() => {
    if (disabled) {
      previousDeviceIdRef.current = deviceId;
      if (status !== "idle") {
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
    const display = blurHandleRef.current?.stream ?? streamRef.current;
    if (!video || !display) return;
    if (video.srcObject !== display) {
      video.srcObject = display;
    }
    const runId = runIdRef.current;
    const tryPlay = () => {
      void video.play().catch(() => failPreview(runId, "noVideo"));
    };
    tryPlay();
    video.addEventListener("loadedmetadata", tryPlay, { once: true });
    return () => {
      video.removeEventListener("loadedmetadata", tryPlay);
    };
  }, [failPreview, status]);

  // Toggle blur while live: swap the preview source in place (startTest already
  // binds the initial value, so skip mount).
  useEffect(() => {
    if (previousBlurRef.current === blur) return;
    previousBlurRef.current = blur;
    if (status !== "live" && status !== "starting") return;
    if (!streamRef.current) return;
    const runId = runIdRef.current;
    void attachPreview().then((result) => {
      if (result === "error") failPreview(runId, "noVideo");
    });
  }, [attachPreview, blur, failPreview, status]);

  // Slider drags adjust the live pipeline without rebuilding the segmenter.
  useEffect(() => {
    blurRadiusRef.current = blurRadius;
    blurHandleRef.current?.setBlurPx(blurRadius);
  }, [blurRadius]);

  const live = status === "live";
  const starting = status === "starting";
  const showBubble = live || starting;
  const sizePx = CAMERA_BUBBLE_SIZE_PX[size];
  const statusLabel = disabled
    ? t("preRecord.cameraOff")
    : error
      ? t("cameraVisualizer.needsAttention")
      : starting
        ? t("cameraVisualizer.opening")
        : live
          ? hasFrame
            ? t("cameraVisualizer.live")
            : t("cameraVisualizer.waiting")
          : t("cameraVisualizer.bubble");
  return (
    <div className={cn("grid gap-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={cn(
            "flex h-7 min-w-0 flex-1 items-center gap-1 rounded-full border border-border bg-muted/20 px-1.5 text-[10px] font-medium text-muted-foreground",
            error && "border-destructive/40 bg-destructive/10 text-destructive",
          )}
        >
          {disabled ? (
            <IconCameraOff
              className="size-3.5 shrink-0"
              stroke={2}
              aria-hidden="true"
            />
          ) : error ? (
            <IconAlertTriangle
              className="size-3.5 shrink-0"
              stroke={2}
              aria-hidden="true"
            />
          ) : starting ? (
            <IconLoader2
              className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
              stroke={2}
              aria-hidden="true"
            />
          ) : (
            <IconCamera
              className="size-3.5 shrink-0"
              stroke={2}
              aria-hidden="true"
            />
          )}
          <span className="truncate">{statusLabel}</span>
        </div>
        <ToggleGroup
          type="single"
          value={size}
          onValueChange={(value) => {
            if (value) onSizeChange?.(value as CameraBubbleSize);
          }}
          variant="outline"
          aria-label={t("cameraVisualizer.bubble")}
          className="grid shrink-0 grid-cols-3 gap-0.5 rounded-md bg-muted p-0.5"
        >
          {CAMERA_SIZE_OPTIONS.map((option) => (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              disabled={disabled}
              aria-label={t("cameraVisualizer.setBubbleSize", {
                size: option.label,
              })}
              className="h-6 min-w-6 rounded border-0 px-1.5 text-[11px] text-muted-foreground shadow-none data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
            >
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button
          type="button"
          variant={live ? "outline" : "secondary"}
          size="sm"
          disabled={disabled || starting}
          onClick={live ? stopTest : startTest}
          className="h-7 w-16 shrink-0 px-2 text-xs"
        >
          {live
            ? t("cameraVisualizer.stop")
            : starting
              ? t("cameraVisualizer.opening")
              : t("cameraVisualizer.test")}
        </Button>
      </div>
      {showBubble && (
        <div
          data-testid="camera-preview-container"
          className="relative mx-auto flex w-full max-w-[var(--camera-preview-size)] flex-col items-center gap-2 min-[900px]:fixed min-[900px]:bottom-4 min-[900px]:start-4 min-[900px]:z-40 min-[900px]:mx-0"
          style={{ "--camera-preview-size": `${sizePx}px` } as CSSProperties}
        >
          <div
            className={cn(
              "relative aspect-square w-full overflow-hidden rounded-full border-4 border-background/80 bg-foreground shadow-2xl ring-1",
              live && hasFrame ? "ring-foreground/25" : "ring-border",
            )}
          >
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              onLoadedData={() => {
                clearFrameTimeout();
                hasFrameRef.current = true;
                setHasFrame(true);
                onPreviewChange?.(true);
              }}
              onError={() => {
                if (status === "live" || status === "starting") {
                  failPreview(runIdRef.current, "noVideo");
                }
              }}
              aria-label={t("cameraVisualizer.selectedPreview")}
              className={cn(
                "h-full w-full rounded-full object-cover [transform:scaleX(-1)]",
                !live && "opacity-0",
              )}
            />
            {!live && (
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-gradient-to-br from-muted/70 to-background px-5 text-center text-[11px] text-muted-foreground">
                {t("cameraVisualizer.preview")}
              </div>
            )}
          </div>
        </div>
      )}
      {error ? (
        <div
          role="alert"
          className="flex min-w-0 items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] leading-snug text-destructive"
        >
          <IconAlertTriangle
            className="mt-px size-3.5 shrink-0"
            stroke={2}
            aria-hidden="true"
          />
          <span className="min-w-0">{error}</span>
        </div>
      ) : null}
    </div>
  );
}
