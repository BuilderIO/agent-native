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
import { cn } from "@/lib/utils";
import {
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
    label: "Screen + Camera",
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
  onUpload,
  onCancel,
  busy,
  cameraSize = "md",
  onCameraSizeChange,
}: PreRecordPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<RecordingMode>("screen+camera");
  const [displaySurface, setDisplaySurface] =
    useState<DisplaySurface>("window");
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

  const needsCamera = mode === "camera" || mode === "screen+camera";
  const needsScreen = mode === "screen" || mode === "screen+camera";

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
    const parts = [selectedMicLabel];
    if (needsCamera && selectedCameraLabel) parts.push(selectedCameraLabel);
    return parts.filter(Boolean).join(" • ");
  }, [needsCamera, selectedCameraLabel, selectedMicLabel]);

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
        enabled: micId !== NO_MIC_DEVICE_ID,
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
    return false;
  }, [busy]);

  return (
    <div className="mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
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
              <button
                key={opt.value}
                type="button"
                title={opt.sub}
                onClick={() => setMode(opt.value)}
                className={cn(
                  "flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 text-center text-[12px] font-medium transition-colors",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                )}
                aria-label={`${opt.label}: ${opt.sub}`}
                aria-pressed={active}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{opt.label}</span>
              </button>
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
            <div className="flex items-center gap-3">
              <IconMicrophone className="h-4 w-4 text-muted-foreground" />
              <Select value={micId} onValueChange={setMicId}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Default mic" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default microphone</SelectItem>
                  <SelectItem value={NO_MIC_DEVICE_ID}>
                    No microphone
                  </SelectItem>
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
              disabled={busy || micId === NO_MIC_DEVICE_ID}
              selectedLabel={selectedMicLabel}
              onStatusChange={handleMicStatusChange}
              onSignalChange={handleMicSignalChange}
            />

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
                mode,
                displaySurface,
                micDeviceId: micId === "default" ? null : micId,
                cameraDeviceId: cameraId === "default" ? null : cameraId,
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
