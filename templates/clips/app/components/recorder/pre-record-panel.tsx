import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconBrowser,
  IconCamera,
  IconChevronDown,
  IconDeviceDesktop,
  IconDeviceScreen,
  IconMicrophone,
  IconUpload,
  IconVideo,
} from "@tabler/icons-react";
import { agentNativePath } from "@agent-native/core/client";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  NO_CAMERA_DEVICE_ID,
  NO_MIC_DEVICE_ID,
  type DisplaySurface,
  type RecordingMode,
} from "./recorder-engine";
import type { CameraBubbleSize } from "./camera-bubble";
import { CameraVisualizer, type CameraTestStatus } from "./camera-visualizer";
import {
  MicrophoneVisualizer,
  type MicrophoneTestStatus,
} from "./microphone-visualizer";

export interface PreRecordPanelProps {
  onStart: (opts: {
    mode: RecordingMode;
    displaySurface: DisplaySurface;
    micDeviceId: string | null;
    cameraDeviceId: string | null;
  }) => void;
  initialMode?: RecordingMode | null;
  initialDisplaySurface?: DisplaySurface | null;
  /** Called when the user picks a local video file to upload. */
  onUpload?: (file: File) => void;
  onCancel?: () => void;
  busy?: boolean;
  cameraSize?: CameraBubbleSize;
  onCameraSizeChange?: (size: CameraBubbleSize) => void;
}

type MicTestState = {
  status: MicrophoneTestStatus;
  error: string | null;
  hasSignal: boolean;
};

type CameraTestState = {
  status: CameraTestStatus;
  error: string | null;
  hasPreview: boolean;
};

async function writeRecordingSetupState(value: unknown): Promise<void> {
  await fetch(
    agentNativePath("/_agent-native/application-state/recording-setup"),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    },
  );
}

const MODE_OPTIONS: Array<{
  value: RecordingMode;
  label: string;
  icon: typeof IconDeviceScreen;
  sub: string;
}> = [
  {
    value: "screen",
    label: "Screen",
    icon: IconDeviceScreen,
    sub: "Record your screen",
  },
  {
    value: "screen+camera",
    label: "Screen + cam",
    icon: IconVideo,
    sub: "Screen with webcam bubble",
  },
  {
    value: "camera",
    label: "Camera",
    icon: IconCamera,
    sub: "Just your webcam",
  },
];

const SURFACE_OPTIONS: Array<{
  value: DisplaySurface;
  label: string;
  icon: typeof IconDeviceScreen;
  sub: string;
}> = [
  {
    value: "window",
    label: "Window",
    icon: IconDeviceDesktop,
    sub: "Best for slides or one app",
  },
  {
    value: "browser",
    label: "Browser tab",
    icon: IconBrowser,
    sub: "Best for web demos",
  },
  {
    value: "monitor",
    label: "Screen",
    icon: IconDeviceScreen,
    sub: "Capture everything",
  },
];

export function PreRecordPanel({
  onStart,
  initialMode,
  initialDisplaySurface,
  onUpload,
  onCancel,
  busy,
  cameraSize = "md",
  onCameraSizeChange,
}: PreRecordPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<RecordingMode>(
    () => initialMode ?? "screen+camera",
  );
  const [displaySurface, setDisplaySurface] = useState<DisplaySurface>(
    () => initialDisplaySurface ?? "window",
  );
  const [sourceOpen, setSourceOpen] = useState(false);
  const [deviceSettingsOpen, setDeviceSettingsOpen] = useState(false);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string>("default");
  const [cameraId, setCameraId] = useState<string>("default");
  const [enumError, setEnumError] = useState<string | null>(null);
  const [micTest, setMicTest] = useState<MicTestState>({
    status: "idle",
    error: null,
    hasSignal: false,
  });
  const [cameraTest, setCameraTest] = useState<CameraTestState>({
    status: "idle",
    error: null,
    hasPreview: false,
  });

  useEffect(() => {
    if (initialMode) setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (initialDisplaySurface) setDisplaySurface(initialDisplaySurface);
  }, [initialDisplaySurface]);

  useEffect(() => {
    let cancelled = false;
    async function enumerate() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setMics(
          devices.filter(
            (d) =>
              d.kind === "audioinput" && d.deviceId && d.deviceId !== "default",
          ),
        );
        setCameras(
          devices.filter(
            (d) =>
              d.kind === "videoinput" && d.deviceId && d.deviceId !== "default",
          ),
        );
      } catch (err) {
        setEnumError(
          err instanceof Error ? err.message : "Could not enumerate devices",
        );
      }
    }
    void enumerate();
    return () => {
      cancelled = true;
    };
  }, []);

  const supportsCameraToggle = mode === "screen+camera";
  const needsCamera =
    mode === "camera" ||
    (mode === "screen+camera" && cameraId !== NO_CAMERA_DEVICE_ID);
  const needsScreen = mode === "screen" || mode === "screen+camera";
  const audioEnabled = micId !== NO_MIC_DEVICE_ID;

  const selectedMicLabel = useMemo(() => {
    if (micId === NO_MIC_DEVICE_ID) return "No microphone";
    if (micId === "default") return "Default microphone";
    return (
      mics.find((mic) => mic.deviceId === micId)?.label ||
      `Mic ${micId.slice(0, 4)}`
    );
  }, [micId, mics]);

  const selectedCameraLabel = useMemo(() => {
    if (!needsCamera) return null;
    if (cameraId === "default") return "Default camera";
    return (
      cameras.find((camera) => camera.deviceId === cameraId)?.label ||
      `Camera ${cameraId.slice(0, 4)}`
    );
  }, [cameraId, cameras, needsCamera]);

  const selectedSurfaceLabel = useMemo(() => {
    return (
      SURFACE_OPTIONS.find((surface) => surface.value === displaySurface)
        ?.label ?? "Window"
    );
  }, [displaySurface]);

  const deviceSummary = useMemo(() => {
    const parts = [audioEnabled ? selectedMicLabel : "No audio"];
    if (needsCamera && selectedCameraLabel) parts.push(selectedCameraLabel);
    else if (supportsCameraToggle) parts.push("No camera");
    return parts.filter(Boolean).join(" • ");
  }, [
    audioEnabled,
    needsCamera,
    selectedCameraLabel,
    selectedMicLabel,
    supportsCameraToggle,
  ]);

  const handleMicStatusChange = useCallback(
    (status: MicrophoneTestStatus, detail?: { error?: string | null }) => {
      setMicTest({
        status,
        error: detail?.error ?? null,
        hasSignal: false,
      });
    },
    [],
  );

  const handleMicSignalChange = useCallback((hasSignal: boolean) => {
    setMicTest((prev) => ({ ...prev, hasSignal }));
  }, []);

  const handleCameraStatusChange = useCallback(
    (status: CameraTestStatus, detail?: { error?: string | null }) => {
      setCameraTest({
        status,
        error: detail?.error ?? null,
        hasPreview: false,
      });
    },
    [],
  );

  const handleCameraPreviewChange = useCallback((hasPreview: boolean) => {
    setCameraTest((prev) => ({ ...prev, hasPreview }));
  }, []);

  useEffect(() => {
    if (needsCamera) return;
    setCameraTest({ status: "idle", error: null, hasPreview: false });
  }, [needsCamera]);

  useEffect(() => {
    void writeRecordingSetupState({
      view: "record",
      mode,
      microphone: {
        enabled: audioEnabled,
        selected:
          micId === NO_MIC_DEVICE_ID
            ? "none"
            : micId === "default"
              ? "default"
              : "specific",
        label: selectedMicLabel,
        testStatus: micTest.status,
        testHasSignal: micTest.hasSignal,
        testError: micTest.error,
      },
      camera: {
        enabled: needsCamera,
        selected: needsCamera
          ? cameraId === "default"
            ? "default"
            : "specific"
          : "none",
        label: selectedCameraLabel,
        testStatus: cameraTest.status,
        testHasPreview: cameraTest.hasPreview,
        testError: cameraTest.error,
      },
      updatedAt: new Date().toISOString(),
    }).catch(() => {});
  }, [
    cameraId,
    cameraTest.error,
    cameraTest.hasPreview,
    cameraTest.status,
    audioEnabled,
    micId,
    micTest.error,
    micTest.hasSignal,
    micTest.status,
    mode,
    needsCamera,
    selectedCameraLabel,
    selectedMicLabel,
  ]);

  const startDisabled = useMemo(() => {
    if (busy) return true;
    if (audioEnabled && micTest.status === "error") return true;
    if (needsCamera && cameraTest.status === "error") return true;
    return false;
  }, [audioEnabled, busy, cameraTest.status, micTest.status, needsCamera]);
  const setupBlockedMessage = useMemo(() => {
    if (audioEnabled && micTest.status === "error") {
      return "Fix microphone access or turn audio off before recording.";
    }
    if (needsCamera && cameraTest.status === "error") {
      return "Fix camera access or switch to Screen mode before recording.";
    }
    return null;
  }, [audioEnabled, cameraTest.status, micTest.status, needsCamera]);

  return (
    <div className="mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-border bg-muted/20 shadow-lg">
      <div className="space-y-4 p-6">
        <div>
          <h2 className="text-lg font-semibold">New recording</h2>
          <p className="text-sm text-muted-foreground">
            Choose a mode. The browser picker opens after Start.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
          {MODE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = opt.value === mode;
            return (
              <Tooltip key={opt.value}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => {
                      setMode(opt.value);
                      if (
                        opt.value === "camera" &&
                        cameraId === NO_CAMERA_DEVICE_ID
                      ) {
                        setCameraId("default");
                      }
                    }}
                    className={cn(
                      "flex h-11 min-w-0 items-center justify-center rounded-lg px-2 transition-colors",
                      active
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                    )}
                    aria-label={`${opt.label}: ${opt.sub}`}
                    aria-pressed={active}
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{opt.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>

      {needsScreen && (
        <Collapsible
          open={sourceOpen}
          onOpenChange={setSourceOpen}
          className="border-t border-border"
        >
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-6 py-4 text-left transition-colors hover:bg-muted/35"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <IconDeviceDesktop className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">Capture source</div>
                <div className="truncate text-xs text-muted-foreground">
                  {selectedSurfaceLabel} selected
                </div>
              </div>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                Change
              </span>
              <IconChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                  sourceOpen && "rotate-180",
                )}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="grid grid-cols-3 gap-2 px-6 pb-5">
              {SURFACE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = opt.value === displaySurface;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setDisplaySurface(opt.value)}
                    className={cn(
                      "flex min-h-[76px] flex-col rounded-lg border p-2 text-left transition-colors",
                      active
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-background text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                    )}
                    aria-pressed={active}
                  >
                    <Icon className="mb-2 h-4 w-4" />
                    <span className="text-[12px] font-medium leading-tight">
                      {opt.label}
                    </span>
                    <span className="mt-1 text-[10px] leading-tight text-muted-foreground">
                      {opt.sub}
                    </span>
                  </button>
                );
              })}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      <Collapsible
        open={deviceSettingsOpen}
        onOpenChange={setDeviceSettingsOpen}
        className="border-t border-border"
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-3 px-6 py-4 text-left transition-colors hover:bg-muted/35"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              {needsCamera ? (
                <IconCamera className="h-4 w-4" />
              ) : (
                <IconMicrophone className="h-4 w-4" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">
                {needsCamera ? "Audio & camera" : "Audio"}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {deviceSummary}
              </div>
            </div>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              Check
            </span>
            <IconChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                deviceSettingsOpen && "rotate-180",
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-4 px-6 pb-5">
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">
                  Include audio
                </div>
                <div className="text-xs leading-snug text-muted-foreground">
                  {audioEnabled
                    ? "Microphone and available tab audio will be recorded."
                    : "Create a silent clip for quick visual notes."}
                </div>
              </div>
              <Switch
                checked={audioEnabled}
                onCheckedChange={(checked) =>
                  setMicId(checked ? "default" : NO_MIC_DEVICE_ID)
                }
                disabled={busy}
                aria-label="Include audio in this recording"
              />
            </div>

            <div className="flex items-center gap-3">
              <IconMicrophone className="h-4 w-4 text-muted-foreground" />
              <Select value={micId} onValueChange={setMicId}>
                <SelectTrigger className="flex-1" disabled={!audioEnabled}>
                  <SelectValue placeholder="Default mic" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default microphone</SelectItem>
                  <SelectItem value={NO_MIC_DEVICE_ID}>No audio</SelectItem>
                  {mics.map((m) => (
                    <SelectItem key={m.deviceId} value={m.deviceId}>
                      {m.label || `Mic ${m.deviceId.slice(0, 4)}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <MicrophoneVisualizer
              deviceId={micId === "default" ? null : micId}
              disabled={busy || !audioEnabled}
              selectedLabel={selectedMicLabel}
              onStatusChange={handleMicStatusChange}
              onSignalChange={handleMicSignalChange}
            />

            {supportsCameraToggle && (
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">
                    Include camera
                  </div>
                  <div className="text-xs leading-snug text-muted-foreground">
                    {needsCamera
                      ? "Camera bubble overlay records alongside your screen."
                      : "Screen-only — your camera stays off."}
                  </div>
                </div>
                <Switch
                  checked={needsCamera}
                  onCheckedChange={(checked) =>
                    setCameraId(checked ? "default" : NO_CAMERA_DEVICE_ID)
                  }
                  disabled={busy}
                  aria-label="Include camera in this recording"
                />
              </div>
            )}

            {needsCamera && (
              <>
                <div className="flex items-center gap-3">
                  <IconCamera className="h-4 w-4 text-muted-foreground" />
                  <Select value={cameraId} onValueChange={setCameraId}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Default camera" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default camera</SelectItem>
                      {cameras.map((c) => (
                        <SelectItem key={c.deviceId} value={c.deviceId}>
                          {c.label || `Camera ${c.deviceId.slice(0, 4)}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <CameraVisualizer
                  deviceId={cameraId === "default" ? null : cameraId}
                  disabled={busy}
                  selectedLabel={selectedCameraLabel}
                  size={cameraSize}
                  onSizeChange={onCameraSizeChange}
                  onStatusChange={handleCameraStatusChange}
                  onPreviewChange={handleCameraPreviewChange}
                />
              </>
            )}

            {enumError && (
              <p className="text-[11px] text-destructive">{enumError}</p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div className="space-y-3 border-t border-border p-6">
        {setupBlockedMessage && (
          <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs leading-relaxed text-destructive">
            {setupBlockedMessage}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          {onCancel && (
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          )}
          <Button
            disabled={startDisabled}
            onClick={() =>
              onStart({
                // If the user toggled off the camera inside screen+camera mode,
                // downgrade to screen-only so the recorder engine doesn't try
                // to acquire a webcam stream.
                mode:
                  mode === "screen+camera" && !needsCamera ? "screen" : mode,
                displaySurface,
                micDeviceId: micId === "default" ? null : micId,
                cameraDeviceId:
                  needsCamera && cameraId !== "default" ? cameraId : null,
              })
            }
            className={cn(
              "h-11 bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary",
              onCancel ? "flex-1" : "w-full",
            )}
          >
            Start recording
          </Button>
        </div>

        {onUpload && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              <IconUpload className="h-4 w-4" />
              Upload a video file instead
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/webm,video/quicktime,video/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUpload(file);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
