import { agentNativePath, useT } from "@agent-native/core/client";
import {
  IconBrowser,
  IconCamera,
  IconChevronDown,
  IconDeviceDesktop,
  IconDeviceScreen,
  IconLink,
  IconMicrophone,
  IconPlayerRecord,
  IconUpload,
  IconVideo,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { CaptureInstallInlineLink } from "@/components/capture-install-options";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  loadRecorderPreferences,
  saveRecorderPreferences,
} from "@/lib/recorder-preferences";
import { cn } from "@/lib/utils";

import type { CameraBubbleSize } from "./camera-bubble";
import { CameraVisualizer, type CameraTestStatus } from "./camera-visualizer";
import {
  MicrophoneVisualizer,
  friendlyMicError,
  type MicrophoneTestStatus,
} from "./microphone-visualizer";
import {
  NO_CAMERA_DEVICE_ID,
  NO_MIC_DEVICE_ID,
  type DisplaySurface,
  type RecordingMode,
} from "./recorder-engine";

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
  /** Called when the user submits a Loom URL to import. */
  onImportLoom?: (url: string) => Promise<void> | void;
  importingLoom?: boolean;
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

type DeviceAccessStatus = "idle" | "requesting" | "granted" | "error";

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

type ModeOption = {
  value: RecordingMode;
  label: string;
  icon: typeof IconDeviceScreen;
};

type SurfaceOption = {
  value: DisplaySurface;
  label: string;
  icon: typeof IconDeviceScreen;
  sub: string;
};

const REQUEST_MIC_ACCESS_VALUE = "__clips_request_microphone_access__";

function isPseudoMediaDeviceId(value: string | null | undefined): boolean {
  const id = value?.trim().toLowerCase();
  return !id || id === "default" || id === "communications";
}

function isSelectableMediaDevice(device: MediaDeviceInfo): boolean {
  return !isPseudoMediaDeviceId(device.deviceId);
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

export function PreRecordPanel({
  onStart,
  initialMode,
  initialDisplaySurface,
  onUpload,
  onImportLoom,
  importingLoom,
  onCancel,
  busy,
  cameraSize = "md",
  onCameraSizeChange,
}: PreRecordPanelProps) {
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loomInputRef = useRef<HTMLInputElement>(null);
  // Saved selections from the last visit. A `?mode=`/`?surface=` deep link
  // (initialMode/initialDisplaySurface) still takes precedence over them.
  const savedPrefs = useMemo(() => loadRecorderPreferences(), []);
  const [mode, setMode] = useState<RecordingMode>(
    () => initialMode ?? savedPrefs.mode ?? "screen+camera",
  );
  const [displaySurface, setDisplaySurface] = useState<DisplaySurface>(
    () => initialDisplaySurface ?? savedPrefs.displaySurface ?? "window",
  );
  const [sourceOpen, setSourceOpen] = useState(false);
  const [deviceSettingsOpen, setDeviceSettingsOpen] = useState(false);
  const [loomImportOpen, setLoomImportOpen] = useState(false);
  const [loomUrl, setLoomUrl] = useState("");
  const [loomError, setLoomError] = useState<string | null>(null);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string>(
    () => savedPrefs.micId ?? "default",
  );
  const [cameraId, setCameraId] = useState<string>(
    () => savedPrefs.cameraId ?? "default",
  );
  const [enumError, setEnumError] = useState<string | null>(null);
  const [micAccessStatus, setMicAccessStatus] =
    useState<DeviceAccessStatus>("idle");
  const [micAccessError, setMicAccessError] = useState<string | null>(null);
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

  const modeOptions = useMemo<ModeOption[]>(
    () => [
      {
        value: "screen+camera",
        label: t("preRecord.modeScreenCamera"),
        icon: IconVideo,
      },
      {
        value: "screen",
        label: t("preRecord.modeScreenOnly"),
        icon: IconDeviceScreen,
      },
      {
        value: "camera",
        label: t("preRecord.modeCameraOnly"),
        icon: IconCamera,
      },
    ],
    [t],
  );
  const surfaceOptions = useMemo<SurfaceOption[]>(
    () => [
      {
        value: "window",
        label: t("preRecord.surfaceWindow"),
        icon: IconDeviceDesktop,
        sub: t("preRecord.surfaceWindowDescription"),
      },
      {
        value: "browser",
        label: t("preRecord.surfaceBrowser"),
        icon: IconBrowser,
        sub: t("preRecord.surfaceBrowserDescription"),
      },
      {
        value: "monitor",
        label: t("preRecord.surfaceScreen"),
        icon: IconDeviceScreen,
        sub: t("preRecord.surfaceScreenDescription"),
      },
    ],
    [t],
  );

  useEffect(() => {
    if (initialMode) setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (initialDisplaySurface) setDisplaySurface(initialDisplaySurface);
  }, [initialDisplaySurface]);

  const enumerateDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) {
        throw new Error(t("preRecord.microphoneSelectionUnsupported"));
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      setEnumError(null);
      setMics(
        devices.filter(
          (d) => d.kind === "audioinput" && isSelectableMediaDevice(d),
        ),
      );
      setCameras(
        devices.filter(
          (d) => d.kind === "videoinput" && isSelectableMediaDevice(d),
        ),
      );
    } catch (err) {
      setEnumError(
        err instanceof Error ? err.message : t("preRecord.enumerateFailed"),
      );
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    enumerateDevices().catch(() => {});
    if (!navigator.mediaDevices?.addEventListener) {
      return () => {
        cancelled = true;
      };
    }
    const handleDeviceChange = () => {
      if (!cancelled) enumerateDevices().catch(() => {});
    };
    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        handleDeviceChange,
      );
    };
  }, [enumerateDevices]);

  const microphoneLabelsUnlocked = useMemo(
    () => mics.some((mic) => mic.label.trim().length > 0),
    [mics],
  );

  // Reset to "default" only once a populated list genuinely excludes the saved
  // device — an empty list means "not enumerated yet", and resetting then would
  // wipe a restored preference before devices load.
  useEffect(() => {
    if (micId === "default" || micId === NO_MIC_DEVICE_ID) return;
    if (mics.length > 0 && !mics.some((mic) => mic.deviceId === micId)) {
      setMicId("default");
    }
  }, [micId, mics]);

  // Same guard for cameras. Not persisted, so a temporarily missing device
  // doesn't erase the saved choice.
  useEffect(() => {
    if (cameraId === "default" || cameraId === NO_CAMERA_DEVICE_ID) return;
    if (
      cameras.length > 0 &&
      !cameras.some((camera) => camera.deviceId === cameraId)
    ) {
      setCameraId("default");
    }
  }, [cameraId, cameras]);

  // Camera-only mode needs a camera — coerce a restored "off" sentinel to
  // "default" so Start doesn't forward it as an exact deviceId. This is the
  // single owner of that coercion: it covers both the mode-button click and the
  // ?mode=camera deep-link/restore path.
  useEffect(() => {
    if (mode === "camera" && cameraId === NO_CAMERA_DEVICE_ID) {
      setCameraId("default");
    }
  }, [mode, cameraId]);

  // Persist deliberate picks only (not the resets above), so an unavailable
  // device on load can't clobber the stored preference.
  const chooseMode = useCallback((value: RecordingMode) => {
    setMode(value);
    saveRecorderPreferences({ mode: value });
  }, []);
  const chooseDisplaySurface = useCallback((value: DisplaySurface) => {
    setDisplaySurface(value);
    saveRecorderPreferences({ displaySurface: value });
  }, []);
  const chooseMic = useCallback((value: string) => {
    setMicId(value);
    saveRecorderPreferences({ micId: value });
  }, []);
  const chooseCamera = useCallback((value: string) => {
    setCameraId(value);
    saveRecorderPreferences({ cameraId: value });
  }, []);

  const requestMicrophoneChoices = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicAccessStatus("error");
      setMicAccessError(t("preRecord.microphoneSelectionUnsupported"));
      return;
    }
    setMicAccessStatus("requesting");
    setMicAccessError(null);
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      stopStream(stream);
      stream = null;
      await enumerateDevices();
      setMicAccessStatus("granted");
    } catch (err) {
      stopStream(stream);
      setMicAccessStatus("error");
      setMicAccessError(await friendlyMicError(err));
    }
  }, [enumerateDevices]);

  const supportsCameraToggle = mode === "screen+camera";
  const needsCamera =
    mode === "camera" ||
    (mode === "screen+camera" && cameraId !== NO_CAMERA_DEVICE_ID);
  const needsScreen = mode === "screen" || mode === "screen+camera";
  const showCameraControls = supportsCameraToggle || needsCamera;
  const audioEnabled = micId !== NO_MIC_DEVICE_ID;

  const selectedMicLabel = useMemo(() => {
    if (micId === NO_MIC_DEVICE_ID) return t("preRecord.noMicrophone");
    if (micId === "default") return t("preRecord.defaultMicrophone");
    return (
      mics.find((mic) => mic.deviceId === micId)?.label ||
      t("preRecord.shortMicLabel", { id: micId.slice(0, 4) })
    );
  }, [micId, mics, t]);

  const selectedCameraLabel = useMemo(() => {
    if (!needsCamera) return null;
    if (cameraId === "default") return t("preRecord.defaultCamera");
    return (
      cameras.find((camera) => camera.deviceId === cameraId)?.label ||
      t("preRecord.shortCameraLabel", { id: cameraId.slice(0, 4) })
    );
  }, [cameraId, cameras, needsCamera, t]);

  const selectedSurfaceLabel = useMemo(() => {
    return (
      surfaceOptions.find((surface) => surface.value === displaySurface)
        ?.label ?? t("preRecord.surfaceWindow")
    );
  }, [displaySurface, surfaceOptions, t]);

  const deviceSummary = useMemo(() => {
    const parts = [audioEnabled ? selectedMicLabel : t("preRecord.noAudio")];
    if (needsCamera && selectedCameraLabel) parts.push(selectedCameraLabel);
    else if (supportsCameraToggle) parts.push(t("preRecord.noCamera"));
    return parts.filter(Boolean).join(" • ");
  }, [
    audioEnabled,
    needsCamera,
    selectedCameraLabel,
    selectedMicLabel,
    supportsCameraToggle,
    t,
  ]);

  const handleMicStatusChange = useCallback(
    (status: MicrophoneTestStatus, detail?: { error?: string | null }) => {
      setMicTest({
        status,
        error: detail?.error ?? null,
        hasSignal: false,
      });
      if (status === "live") {
        setMicAccessStatus("granted");
        setMicAccessError(null);
        enumerateDevices().catch(() => {});
      }
    },
    [enumerateDevices],
  );

  const handleMicIdChange = useCallback(
    (value: string) => {
      if (value === REQUEST_MIC_ACCESS_VALUE) {
        void requestMicrophoneChoices();
        return;
      }
      chooseMic(value);
    },
    [requestMicrophoneChoices, chooseMic],
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
      if (status === "live") {
        enumerateDevices().catch(() => {});
      }
    },
    [enumerateDevices],
  );

  const handleCameraPreviewChange = useCallback((hasPreview: boolean) => {
    setCameraTest((prev) => ({ ...prev, hasPreview }));
  }, []);

  const handleLoomImport = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const url = loomUrl.trim();
      if (!url || !onImportLoom) return;

      setLoomError(null);
      try {
        await onImportLoom(url);
        setLoomUrl("");
        setLoomImportOpen(false);
      } catch (err) {
        setLoomError(
          err instanceof Error ? err.message : t("preRecord.loomImportFailed"),
        );
      }
    },
    [loomUrl, onImportLoom, t],
  );

  useEffect(() => {
    if (!loomImportOpen) return;
    const frame = window.requestAnimationFrame(() => {
      loomInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loomImportOpen]);

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
        availableDeviceCount: mics.length,
        deviceLabelsUnlocked: microphoneLabelsUnlocked,
        accessStatus: micAccessStatus,
        accessError: micAccessError,
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
      import: onImportLoom
        ? {
            loomPanelOpen: loomImportOpen,
            loomUrlPresent: loomUrl.trim().length > 0,
            loomImporting: Boolean(importingLoom),
          }
        : undefined,
    }).catch(() => {});
  }, [
    cameraId,
    cameraTest.error,
    cameraTest.hasPreview,
    cameraTest.status,
    audioEnabled,
    micId,
    micAccessError,
    micAccessStatus,
    micTest.error,
    micTest.hasSignal,
    micTest.status,
    microphoneLabelsUnlocked,
    mics.length,
    mode,
    needsCamera,
    importingLoom,
    loomImportOpen,
    loomUrl,
    onImportLoom,
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
      return t("preRecord.fixMicrophoneAccess");
    }
    if (needsCamera && cameraTest.status === "error") {
      return t("preRecord.fixCameraAccess");
    }
    return null;
  }, [audioEnabled, cameraTest.status, micTest.status, needsCamera, t]);

  return (
    <div className="mx-auto w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
      <div className="p-6">
        <div className="grid gap-2 sm:grid-cols-3">
          {modeOptions.map((opt) => {
            const Icon = opt.icon;
            const active = opt.value === mode;
            return (
              <button
                key={opt.value}
                type="button"
                // Camera-only mode needs a camera; the [mode, cameraId] effect
                // below coerces a restored "off" sentinel to "default" for both
                // this click and the ?mode=camera deep-link path.
                onClick={() => chooseMode(opt.value)}
                className={cn(
                  "flex min-h-20 min-w-0 flex-col justify-between rounded-xl border p-3 text-start transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border bg-background text-foreground hover:border-foreground/30 hover:bg-muted/45",
                )}
                aria-pressed={active}
              >
                <span
                  className={cn(
                    "mb-3 flex h-9 w-9 items-center justify-center rounded-full",
                    active
                      ? "bg-primary-foreground/15 text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-sm font-medium leading-tight">
                  {opt.label}
                </span>
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
              className="flex w-full items-center gap-3 px-6 py-4 text-start transition-colors hover:bg-muted/35"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <IconDeviceDesktop className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {t("preRecord.captureSource")}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {t("preRecord.selectedSurface", {
                    surface: selectedSurfaceLabel,
                  })}
                </div>
              </div>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {t("preRecord.change")}
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
              {surfaceOptions.map((opt) => {
                const Icon = opt.icon;
                const active = opt.value === displaySurface;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => chooseDisplaySurface(opt.value)}
                    className={cn(
                      "flex min-h-[76px] flex-col rounded-lg border p-2 text-start transition-colors",
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
            className="flex w-full items-center gap-3 px-6 py-4 text-start transition-colors hover:bg-muted/35"
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
                {showCameraControls
                  ? t("preRecord.audioAndCamera")
                  : t("preRecord.audio")}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {deviceSummary}
              </div>
            </div>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {t("preRecord.check")}
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
          <div className="px-6 pb-5">
            <div className="overflow-visible rounded-xl border border-border bg-background">
              <div className="space-y-2 p-2.5">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <IconMicrophone className="h-4 w-4" />
                  </div>
                  <Select value={micId} onValueChange={handleMicIdChange}>
                    <SelectTrigger
                      className="h-9 min-w-0 flex-1 border-0 bg-transparent px-2 shadow-none hover:bg-muted/45 focus:ring-0 focus:ring-offset-0"
                      disabled={!audioEnabled}
                    >
                      <SelectValue
                        placeholder={t("preRecord.defaultMicPlaceholder")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">
                        {t("preRecord.defaultMicrophone")}
                      </SelectItem>
                      {!microphoneLabelsUnlocked && audioEnabled && (
                        <SelectItem value={REQUEST_MIC_ACCESS_VALUE}>
                          {micAccessStatus === "requesting"
                            ? t("preRecord.openingMicrophone")
                            : t("preRecord.chooseMicrophone")}
                        </SelectItem>
                      )}
                      <SelectItem value={NO_MIC_DEVICE_ID}>
                        {t("preRecord.noAudio")}
                      </SelectItem>
                      {microphoneLabelsUnlocked &&
                        mics.map((m) => (
                          <SelectItem key={m.deviceId} value={m.deviceId}>
                            {m.label ||
                              t("preRecord.shortMicLabel", {
                                id: m.deviceId.slice(0, 4),
                              })}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Switch
                    checked={audioEnabled}
                    onCheckedChange={(checked) =>
                      chooseMic(checked ? "default" : NO_MIC_DEVICE_ID)
                    }
                    disabled={busy}
                    aria-label={t("preRecord.includeAudioAria")}
                  />
                </div>

                {audioEnabled ? (
                  <MicrophoneVisualizer
                    deviceId={micId === "default" ? null : micId}
                    disabled={busy}
                    idleActionLabel={
                      microphoneLabelsUnlocked
                        ? t("preRecord.check")
                        : t("preRecord.choose")
                    }
                    onStatusChange={handleMicStatusChange}
                    onSignalChange={handleMicSignalChange}
                  />
                ) : null}

                {micAccessError ? (
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    {micAccessError}{" "}
                    <CaptureInstallInlineLink className="text-foreground underline-offset-4 hover:underline">
                      {t("preRecord.tryClipsDesktop")}
                    </CaptureInstallInlineLink>
                  </p>
                ) : null}
              </div>

              {showCameraControls ? (
                <div className="space-y-2 border-t border-border p-2.5">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <IconCamera className="h-4 w-4" />
                    </div>
                    <Select
                      value={cameraId}
                      onValueChange={chooseCamera}
                      disabled={!needsCamera}
                    >
                      <SelectTrigger className="h-9 min-w-0 flex-1 border-0 bg-transparent px-2 shadow-none hover:bg-muted/45 focus:ring-0 focus:ring-offset-0 disabled:opacity-60">
                        <SelectValue
                          placeholder={t("preRecord.defaultCamera")}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_CAMERA_DEVICE_ID}>
                          {t("preRecord.cameraOff")}
                        </SelectItem>
                        <SelectItem value="default">
                          {t("preRecord.defaultCamera")}
                        </SelectItem>
                        {cameras.map((c) => (
                          <SelectItem key={c.deviceId} value={c.deviceId}>
                            {c.label ||
                              t("preRecord.shortCameraLabel", {
                                id: c.deviceId.slice(0, 4),
                              })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {supportsCameraToggle ? (
                      <Switch
                        checked={needsCamera}
                        onCheckedChange={(checked) =>
                          chooseCamera(
                            checked ? "default" : NO_CAMERA_DEVICE_ID,
                          )
                        }
                        disabled={busy}
                        aria-label={t("preRecord.includeCameraAria")}
                      />
                    ) : null}
                  </div>

                  {needsCamera ? (
                    <CameraVisualizer
                      deviceId={cameraId === "default" ? null : cameraId}
                      disabled={busy}
                      size={cameraSize}
                      onSizeChange={onCameraSizeChange}
                      onStatusChange={handleCameraStatusChange}
                      onPreviewChange={handleCameraPreviewChange}
                    />
                  ) : null}
                </div>
              ) : null}

              {enumError ? (
                <p className="border-t border-border p-2.5 text-[11px] text-muted-foreground">
                  {enumError}
                </p>
              ) : null}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div className="space-y-3 border-t border-border p-6">
        {setupBlockedMessage && (
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            {setupBlockedMessage}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          {onCancel && (
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              {t("common.cancel")}
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
            className={cn("h-12 gap-2", onCancel ? "flex-1" : "w-full")}
          >
            <IconPlayerRecord className="h-4 w-4" />
            {t("preRecord.startRecording")}
          </Button>
        </div>

        {(onUpload || onImportLoom) && (
          <>
            <div
              className={cn(
                "grid gap-2",
                onUpload && onImportLoom && "sm:grid-cols-2",
              )}
            >
              {onUpload ? (
                <button
                  type="button"
                  disabled={busy || importingLoom}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <IconUpload className="h-4 w-4" />
                  {t("preRecord.uploadVideo")}
                </button>
              ) : null}

              {onImportLoom ? (
                <Popover
                  open={loomImportOpen}
                  onOpenChange={(open) => {
                    setLoomImportOpen(open);
                    setLoomError(null);
                  }}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      disabled={busy || importingLoom}
                      className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <IconLink className="h-4 w-4" />
                      {t("preRecord.importLoom")}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    className="w-80 max-w-[calc(100vw-2rem)] p-3"
                    onOpenAutoFocus={(event) => {
                      event.preventDefault();
                      window.requestAnimationFrame(() => {
                        loomInputRef.current?.focus();
                      });
                    }}
                  >
                    <form onSubmit={handleLoomImport}>
                      <div className="flex gap-2">
                        <Input
                          ref={loomInputRef}
                          value={loomUrl}
                          onChange={(event) => {
                            setLoomUrl(event.target.value);
                            setLoomError(null);
                          }}
                          disabled={busy || importingLoom}
                          placeholder="https://www.loom.com/share/..."
                          className="h-9 text-sm"
                          inputMode="url"
                        />
                        <Button
                          type="submit"
                          size="sm"
                          className="h-9 shrink-0"
                          disabled={busy || importingLoom || !loomUrl.trim()}
                        >
                          {importingLoom
                            ? t("preRecord.importing")
                            : t("preRecord.import")}
                        </Button>
                      </div>
                      {loomError ? (
                        <p className="mt-2 text-xs leading-relaxed text-destructive">
                          {loomError}
                        </p>
                      ) : null}
                    </form>
                  </PopoverContent>
                </Popover>
              ) : null}
            </div>

            {onUpload ? (
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
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
