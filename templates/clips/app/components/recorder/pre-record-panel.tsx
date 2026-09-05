import { agentNativePath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import { isSelectableAudioInputDevice } from "@shared/media-device-selection";
import {
  normalizeRecorderSetup,
  recorderSetupForCamera,
  recorderSetupForMode,
  recorderSetupModeFromBrowser,
  recorderSetupModeToBrowser,
  type RecorderSetup,
} from "@shared/recorder-setup";
import {
  IconCamera,
  IconChevronDown,
  IconDeviceDesktop,
  IconMicrophone,
  IconVideo,
} from "@tabler/icons-react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { CaptureInstallInlineLink } from "@/components/capture-install-options";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  loadRecorderPreferences,
  saveRecorderPreferences,
} from "@/lib/recorder-preferences";
import { cn } from "@/lib/utils";

import {
  MicrophoneVisualizer,
  friendlyMicError,
  type MicrophoneTestStatus,
} from "./microphone-visualizer";
import {
  NO_CAMERA_DEVICE_ID,
  NO_MIC_DEVICE_ID,
  normalizeDisplaySurfaceForRuntime,
  supportsBrowserTabCapture,
  type DisplaySurface,
  type RecordingMode,
} from "./recorder-engine";

export interface PreRecordPanelProps {
  onStart: (opts: {
    mode: RecordingMode;
    displaySurface: DisplaySurface;
    micDeviceId: string | null;
    micDeviceLabel?: string | null;
    cameraDeviceId: string | null;
  }) => void;
  initialMode?: RecordingMode | null;
  initialDisplaySurface?: DisplaySurface | null;
  onCancel?: () => void;
  busy?: boolean;
}

type MicTestState = {
  status: MicrophoneTestStatus;
  error: string | null;
  hasSignal: boolean;
};

type DeviceAccessStatus = "idle" | "requesting" | "granted" | "error";

async function writeRecordingSetupState(value: unknown): Promise<void> {
  const response = await fetch(
    agentNativePath("/_agent-native/application-state/recording-setup"),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Recording setup state request failed with status ${response.status}`,
    );
  }
}

type ModeOption = {
  value: RecordingMode;
  label: string;
  icon: typeof IconDeviceDesktop;
  cameraBadge?: boolean;
};

type SurfaceOption = {
  value: DisplaySurface;
  label: string;
};

type DeviceOption = {
  value: string;
  label: string;
};

const REQUEST_MIC_ACCESS_VALUE = "__clips_request_microphone_access__";
const COMPACT_DEVICE_LIMIT = 4;
const CONTROL_ROW_CLASS =
  "grid min-h-10 grid-cols-[20px_minmax(0,1fr)_44px] items-center gap-3 rounded-lg px-2";
const CONTROL_TRIGGER_CLASS =
  "flex h-10 w-full min-w-0 items-center gap-2 rounded-md text-start text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card";
const DEVICE_MENU_CLASS = "w-64";
const SWITCH_CLASS =
  "data-[state=checked]:bg-success data-[state=unchecked]:bg-muted-foreground/30";

function compactDeviceOptions(
  options: DeviceOption[],
  selectedValue: string,
): DeviceOption[] {
  if (options.length <= COMPACT_DEVICE_LIMIT) return options;

  const visible = options.slice(0, COMPACT_DEVICE_LIMIT);
  const selected = options.find((option) => option.value === selectedValue);
  if (!selected || visible.some((option) => option.value === selected.value)) {
    return visible;
  }
  return [...visible.slice(0, -1), selected];
}

function DevicePickerDialog({
  open,
  onOpenChange,
  title,
  value,
  options,
  onValueChange,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  value: string;
  options: DeviceOption[];
  onValueChange: (value: string) => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const t = useT();
  const optionId = useId();
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        className="w-[calc(100vw-1.5rem)] max-w-sm gap-0 p-0"
        closeLabel={t("preRecord.closeDevicePicker")}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          queueMicrotask(() => {
            contentRef.current
              ?.querySelector<HTMLElement>('[data-state="checked"]')
              ?.focus();
          });
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          queueMicrotask(() => returnFocusRef.current?.focus());
        }}
      >
        <DialogHeader className="border-b border-border px-4 py-3 pe-12 text-start">
          <DialogTitle className="text-base">{title}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="h-[min(60vh,20rem)]">
          <RadioGroup
            value={value}
            aria-label={title}
            className="gap-1 p-2"
            onValueChange={(nextValue) => {
              onValueChange(nextValue);
              onOpenChange(false);
            }}
          >
            {options.map((option, index) => {
              const id = `${optionId}-${index}`;
              return (
                <label
                  key={option.value}
                  htmlFor={id}
                  className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground focus-within:bg-accent focus-within:text-accent-foreground"
                >
                  <RadioGroupItem id={id} value={option.value} />
                  <span className="min-w-0 flex-1 truncate">
                    {option.label}
                  </span>
                </label>
              );
            })}
          </RadioGroup>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function MicOffConfirmation({
  open,
  onBack,
  onUnmute,
  onContinue,
  returnFocusRef,
}: {
  open: boolean;
  onBack: () => void;
  onUnmute: () => void;
  onContinue: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const t = useT();
  const unmuteButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onBack();
      }}
    >
      <AlertDialogContent
        className="max-w-sm"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          unmuteButtonRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          queueMicrotask(() => returnFocusRef.current?.focus());
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("preRecord.micOffConfirmTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("preRecord.micOffConfirmDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onContinue}>
            {t("preRecord.startWithoutMic")}
          </AlertDialogCancel>
          <AlertDialogAction ref={unmuteButtonRef} onClick={onUnmute}>
            {t("preRecord.unmuteMicrophone")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

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
  onCancel,
  busy,
}: PreRecordPanelProps) {
  const t = useT();
  const recordingSetupWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const screenCaptureSupported = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getDisplayMedia === "function",
    [],
  );
  const browserTabCaptureSupported = useMemo(
    () => supportsBrowserTabCapture(),
    [],
  );
  // Saved selections from the last visit. A `?mode=`/`?surface=` deep link
  // (initialMode/initialDisplaySurface) still takes precedence over them.
  const savedPrefs = useMemo(() => loadRecorderPreferences(), []);
  const initialCaptureSetup = useMemo(() => {
    const requestedMode = initialMode ?? savedPrefs.mode ?? "screen+camera";
    const savedCameraOn =
      savedPrefs.cameraOn ?? savedPrefs.cameraId !== NO_CAMERA_DEVICE_ID;
    const preferredSetup = initialMode
      ? recorderSetupForMode(recorderSetupModeFromBrowser(initialMode))
      : normalizeRecorderSetup(
          recorderSetupModeFromBrowser(requestedMode),
          savedCameraOn,
        );
    return screenCaptureSupported
      ? preferredSetup
      : recorderSetupForMode("camera");
  }, [initialMode, savedPrefs, screenCaptureSupported]);
  const [captureSetup, setCaptureSetup] =
    useState<RecorderSetup>(initialCaptureSetup);
  const mode = recorderSetupModeToBrowser(captureSetup.mode);
  const cameraOn = captureSetup.cameraOn;
  const [displaySurface, setDisplaySurface] = useState<DisplaySurface>(() =>
    normalizeDisplaySurfaceForRuntime(
      initialDisplaySurface ?? savedPrefs.displaySurface ?? "window",
    ),
  );
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string>(
    () => savedPrefs.micId ?? "default",
  );
  const [micLabel, setMicLabel] = useState<string>(
    () => savedPrefs.micLabel ?? "",
  );
  const lastActiveMicRef = useRef({
    id:
      savedPrefs.micId && savedPrefs.micId !== NO_MIC_DEVICE_ID
        ? savedPrefs.micId
        : (savedPrefs.lastActiveMicId ?? "default"),
    label:
      savedPrefs.micId && savedPrefs.micId !== NO_MIC_DEVICE_ID
        ? (savedPrefs.micLabel ?? "")
        : (savedPrefs.lastActiveMicLabel ?? ""),
  });
  const [cameraId, setCameraId] = useState<string>(() =>
    savedPrefs.cameraId && savedPrefs.cameraId !== NO_CAMERA_DEVICE_ID
      ? savedPrefs.cameraId
      : "default",
  );
  const [cameraPickerOpen, setCameraPickerOpen] = useState(false);
  const [microphonePickerOpen, setMicrophonePickerOpen] = useState(false);
  const cameraMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const microphoneMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const [enumError, setEnumError] = useState<string | null>(null);
  const [micAccessStatus, setMicAccessStatus] =
    useState<DeviceAccessStatus>("idle");
  const [micAccessError, setMicAccessError] = useState<string | null>(null);
  const [micTest, setMicTest] = useState<MicTestState>({
    status: "idle",
    error: null,
    hasSignal: false,
  });
  const queueRecordingSetupStateWrite = useCallback((value: unknown) => {
    recordingSetupWriteQueueRef.current = recordingSetupWriteQueueRef.current
      .then(() => writeRecordingSetupState(value))
      .catch((error: unknown) => {
        console.error(
          "[Clips recorder] Failed to sync recording setup application state; queued updates will continue.",
          error,
        );
      });
  }, []);

  const modeOptions = useMemo<ModeOption[]>(
    () => [
      {
        value: "screen",
        label: t("preRecord.modeScreenOnly"),
        icon: IconDeviceDesktop,
      },
      {
        value: "screen+camera",
        label: t("preRecord.modeScreenCamera"),
        icon: IconDeviceDesktop,
        cameraBadge: true,
      },
      {
        value: "camera",
        label: t("preRecord.modeCameraOnly"),
        icon: IconVideo,
      },
    ],
    [t],
  );
  const visibleModeOptions = useMemo(
    () =>
      screenCaptureSupported
        ? modeOptions
        : modeOptions.filter((option) => option.value === "camera"),
    [modeOptions, screenCaptureSupported],
  );

  const surfaceOptions = useMemo<SurfaceOption[]>(() => {
    const options: SurfaceOption[] = [
      {
        value: "monitor",
        label: t("preRecord.surfaceScreen"),
      },
      {
        value: "window",
        label: t("preRecord.surfaceWindow"),
      },
      {
        value: "browser",
        label: t("preRecord.surfaceBrowser"),
      },
    ];
    return browserTabCaptureSupported
      ? options
      : options.filter((option) => option.value !== "browser");
  }, [browserTabCaptureSupported, t]);

  useEffect(() => {
    if (!screenCaptureSupported) {
      // This capability fallback is session-only so an unsupported device
      // cannot overwrite the user's preferred desktop recording mode.
      setCaptureSetup(recorderSetupForMode("camera"));
      return;
    }
    if (initialMode) {
      const next = recorderSetupForMode(
        recorderSetupModeFromBrowser(initialMode),
      );
      setCaptureSetup(next);
    }
  }, [initialMode, screenCaptureSupported]);

  useEffect(() => {
    if (initialDisplaySurface) {
      setDisplaySurface(
        normalizeDisplaySurfaceForRuntime(initialDisplaySurface),
      );
    }
  }, [initialDisplaySurface]);

  useEffect(() => {
    if (displaySurface !== "browser" || browserTabCaptureSupported) return;
    setDisplaySurface("window");
    saveRecorderPreferences({ displaySurface: "window" });
  }, [browserTabCaptureSupported, displaySurface]);

  const enumerateDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) {
        throw new Error(t("preRecord.microphoneSelectionUnsupported"));
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      setEnumError(null);
      setMics(devices.filter((d) => isSelectableAudioInputDevice(d)));
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

  useEffect(() => {
    if (micId === "default" || micId === NO_MIC_DEVICE_ID) return;
    const match = mics.find((mic) => mic.deviceId === micId);
    if (match?.label) {
      setMicLabel(match.label);
      saveRecorderPreferences({ micId, micLabel: match.label });
    }
  }, [micId, mics]);

  // A temporarily missing device falls back to the runtime default without
  // changing whether the camera is on.
  useEffect(() => {
    if (cameraId === "default") return;
    if (
      cameras.length > 0 &&
      !cameras.some((camera) => camera.deviceId === cameraId)
    ) {
      setCameraId("default");
    }
  }, [cameraId, cameras]);

  // Persist deliberate picks only (not the resets above), so an unavailable
  // device on load can't clobber the stored preference.
  const chooseMode = useCallback((value: RecordingMode) => {
    const next = recorderSetupForMode(recorderSetupModeFromBrowser(value));
    const nextMode = recorderSetupModeToBrowser(next.mode);
    setCaptureSetup(next);
    saveRecorderPreferences({ mode: nextMode, cameraOn: next.cameraOn });
  }, []);
  const chooseDisplaySurface = useCallback((value: DisplaySurface) => {
    const next = normalizeDisplaySurfaceForRuntime(value);
    setDisplaySurface(next);
    saveRecorderPreferences({ displaySurface: next });
  }, []);
  const chooseMic = useCallback(
    (value: string) => {
      const label =
        value === "default" || value === NO_MIC_DEVICE_ID
          ? ""
          : (mics.find((mic) => mic.deviceId === value)?.label ?? "");
      setMicId(value);
      setMicLabel(label);
      if (value !== NO_MIC_DEVICE_ID) {
        lastActiveMicRef.current = { id: value, label };
        saveRecorderPreferences({
          micId: value,
          micLabel: label,
          lastActiveMicId: value,
          lastActiveMicLabel: label,
        });
        return;
      }
      saveRecorderPreferences({ micId: value, micLabel: label });
    },
    [mics],
  );
  const chooseCamera = useCallback((value: string) => {
    setCameraId(value);
    saveRecorderPreferences({ cameraId: value });
  }, []);
  const toggleCamera = useCallback(
    (nextCameraOn: boolean) => {
      const next = recorderSetupForCamera(
        recorderSetupModeFromBrowser(mode),
        nextCameraOn,
      );
      const nextMode = recorderSetupModeToBrowser(next.mode);
      setCaptureSetup(next);
      saveRecorderPreferences({ mode: nextMode, cameraOn: next.cameraOn });
    },
    [mode],
  );
  const toggleMicrophone = useCallback(
    (nextAudioEnabled: boolean) => {
      if (!nextAudioEnabled) {
        chooseMic(NO_MIC_DEVICE_ID);
        return;
      }
      const remembered = lastActiveMicRef.current;
      const rememberedDeviceStillExists = mics.some(
        (microphone) => microphone.deviceId === remembered.id,
      );
      chooseMic(
        remembered.id === "default" || rememberedDeviceStillExists
          ? remembered.id
          : "default",
      );
    },
    [chooseMic, mics],
  );

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
      setMicAccessError(await friendlyMicError(err, t));
    }
  }, [enumerateDevices, t]);

  const supportsCameraToggle = screenCaptureSupported;
  const needsCamera = cameraOn;
  const needsScreen = mode === "screen" || mode === "screen+camera";
  const audioEnabled = micId !== NO_MIC_DEVICE_ID;

  const selectedMicLabel = useMemo(() => {
    if (micId === NO_MIC_DEVICE_ID) return t("preRecord.noMicrophone");
    if (micId === "default") return t("preRecord.defaultMicrophone");
    return (
      mics.find((mic) => mic.deviceId === micId)?.label ||
      micLabel ||
      t("preRecord.shortMicLabel", { id: micId.slice(0, 4) })
    );
  }, [micId, micLabel, mics, t]);

  const [micWarningOpen, setMicWarningOpen] = useState(false);
  const startButtonRef = useRef<HTMLButtonElement>(null);

  const buildStartOpts = useCallback(
    () => ({
      mode,
      displaySurface: normalizeDisplaySurfaceForRuntime(displaySurface),
      micDeviceId: micId === "default" ? null : micId,
      micDeviceLabel:
        micId === "default" || micId === NO_MIC_DEVICE_ID
          ? null
          : selectedMicLabel,
      cameraDeviceId: needsCamera && cameraId !== "default" ? cameraId : null,
    }),
    [mode, needsCamera, displaySurface, micId, selectedMicLabel, cameraId],
  );

  const handleStartClick = useCallback(() => {
    if (micId === NO_MIC_DEVICE_ID) {
      setMicWarningOpen(true);
      return;
    }
    onStart(buildStartOpts());
  }, [micId, buildStartOpts, onStart]);

  const handleMicWarningBack = useCallback(() => {
    setMicWarningOpen(false);
  }, []);

  const handleMicWarningUnmute = useCallback(() => {
    chooseMic("default");
    setMicWarningOpen(false);
  }, [chooseMic]);

  const handleMicWarningContinue = useCallback(() => {
    setMicWarningOpen(false);
    onStart(buildStartOpts());
  }, [buildStartOpts, onStart]);

  const selectedCameraLabel = useMemo(() => {
    if (cameraId === "default") return t("preRecord.defaultCamera");
    return (
      cameras.find((camera) => camera.deviceId === cameraId)?.label ||
      t("preRecord.shortCameraLabel", { id: cameraId.slice(0, 4) })
    );
  }, [cameraId, cameras, t]);

  const cameraDeviceOptions = useMemo<DeviceOption[]>(
    () =>
      cameras.map((camera) => ({
        value: camera.deviceId,
        label:
          camera.label ||
          t("preRecord.shortCameraLabel", {
            id: camera.deviceId.slice(0, 4),
          }),
      })),
    [cameras, t],
  );
  const microphoneDeviceOptions = useMemo<DeviceOption[]>(
    () =>
      microphoneLabelsUnlocked
        ? mics.map((microphone) => ({
            value: microphone.deviceId,
            label:
              microphone.label ||
              t("preRecord.shortMicLabel", {
                id: microphone.deviceId.slice(0, 4),
              }),
          }))
        : [],
    [microphoneLabelsUnlocked, mics, t],
  );
  const compactCameraDeviceOptions = useMemo(
    () => compactDeviceOptions(cameraDeviceOptions, cameraId),
    [cameraDeviceOptions, cameraId],
  );
  const compactMicrophoneDeviceOptions = useMemo(
    () => compactDeviceOptions(microphoneDeviceOptions, micId),
    [microphoneDeviceOptions, micId],
  );
  const allCameraDeviceOptions = useMemo(
    () => [
      { value: "default", label: t("preRecord.defaultCamera") },
      ...cameraDeviceOptions,
    ],
    [cameraDeviceOptions, t],
  );
  const allMicrophoneDeviceOptions = useMemo(
    () => [
      { value: "default", label: t("preRecord.defaultMicrophone") },
      ...microphoneDeviceOptions,
    ],
    [microphoneDeviceOptions, t],
  );

  const selectedSurfaceLabel = useMemo(() => {
    return (
      surfaceOptions.find((surface) => surface.value === displaySurface)
        ?.label ?? t("preRecord.surfaceWindow")
    );
  }, [displaySurface, surfaceOptions, t]);

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
  useEffect(() => {
    setMicTest({ status: "idle", error: null, hasSignal: false });
  }, [micId]);

  useEffect(() => {
    queueRecordingSetupStateWrite({
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
      },
      updatedAt: new Date().toISOString(),
    });
  }, [
    cameraId,
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
    selectedCameraLabel,
    selectedMicLabel,
    queueRecordingSetupStateWrite,
  ]);

  const startDisabled = useMemo(() => {
    if (busy) return true;
    if (audioEnabled && micTest.status === "error") return true;
    return false;
  }, [audioEnabled, busy, micTest.status]);
  const microphoneError = audioEnabled
    ? (micTest.error ?? micAccessError)
    : null;

  return (
    <TooltipProvider delayDuration={180}>
      <div className="mx-auto w-full max-w-[320px] overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
        {visibleModeOptions.length > 1 ? (
          <div className="flex justify-center px-4 pb-3 pt-4">
            <ToggleGroup
              type="single"
              value={mode}
              onValueChange={(value) => {
                if (value) chooseMode(value as RecordingMode);
              }}
              variant="outline"
              aria-label={t("recordRoute.clipsRecorder")}
              className="grid w-[240px] grid-cols-3 gap-1 rounded-full border border-border bg-muted p-1"
            >
              {visibleModeOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <Tooltip key={option.value}>
                    <TooltipTrigger asChild>
                      <span className="flex min-w-0">
                        <ToggleGroupItem
                          value={option.value}
                          aria-label={option.label}
                          className="h-9 w-full rounded-full border-0 px-0 text-muted-foreground shadow-none hover:bg-background/70 hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm dark:data-[state=on]:bg-foreground dark:data-[state=on]:text-background"
                        >
                          <span
                            className="relative inline-flex"
                            aria-hidden="true"
                          >
                            <Icon className="size-4" />
                            {option.cameraBadge ? (
                              <span className="absolute -bottom-0.5 -end-0.5 size-1.5 rounded-full bg-current ring-2 ring-background dark:ring-foreground" />
                            ) : null}
                          </span>
                        </ToggleGroupItem>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" collisionPadding={8}>
                      {option.label}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </ToggleGroup>
          </div>
        ) : null}

        <div className="grid gap-0.5 px-3 pb-3">
          {needsScreen ? (
            <div className={cn(CONTROL_ROW_CLASS, "hover:bg-muted/45")}>
              <IconDeviceDesktop
                className="size-5 text-foreground"
                stroke={1.75}
                aria-hidden="true"
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      CONTROL_TRIGGER_CLASS,
                      "col-span-2 grid grid-cols-[minmax(0,1fr)_44px] gap-3",
                    )}
                    aria-label={t("preRecord.selectedSurface", {
                      surface: selectedSurfaceLabel,
                    })}
                  >
                    <span className="truncate">{selectedSurfaceLabel}</span>
                    <IconChevronDown
                      className="size-4 shrink-0 justify-self-center text-muted-foreground"
                      stroke={1.75}
                      aria-hidden="true"
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  sideOffset={6}
                  className="w-[216px]"
                  collisionPadding={8}
                >
                  <DropdownMenuRadioGroup
                    value={displaySurface}
                    onValueChange={(value) =>
                      chooseDisplaySurface(value as DisplaySurface)
                    }
                  >
                    {surfaceOptions.map((option) => (
                      <DropdownMenuRadioItem
                        key={option.value}
                        value={option.value}
                      >
                        {option.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}

          <div
            className={cn(
              CONTROL_ROW_CLASS,
              needsCamera ? "hover:bg-muted/45" : "text-muted-foreground",
            )}
          >
            <IconCamera className="size-5" stroke={1.75} aria-hidden="true" />
            {needsCamera ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    ref={cameraMenuTriggerRef}
                    type="button"
                    className={CONTROL_TRIGGER_CLASS}
                    aria-label={selectedCameraLabel}
                  >
                    <span className="truncate">{selectedCameraLabel}</span>
                    <IconChevronDown
                      className="ms-auto size-4 shrink-0 text-muted-foreground"
                      stroke={1.75}
                      aria-hidden="true"
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  sideOffset={6}
                  className={DEVICE_MENU_CLASS}
                  collisionPadding={8}
                >
                  <DropdownMenuRadioGroup
                    value={cameraId}
                    onValueChange={chooseCamera}
                  >
                    <DropdownMenuRadioItem value="default">
                      {t("preRecord.defaultCamera")}
                    </DropdownMenuRadioItem>
                    {compactCameraDeviceOptions.map((camera) => (
                      <DropdownMenuRadioItem
                        key={camera.value}
                        value={camera.value}
                      >
                        {camera.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  {cameraDeviceOptions.length > COMPACT_DEVICE_LIMIT ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => setCameraPickerOpen(true)}
                      >
                        {t("preRecord.moreCameras")}
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="truncate py-2 text-sm font-medium">
                {t("preRecord.cameraOff")}
              </span>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex justify-self-end">
                  <Switch
                    checked={needsCamera}
                    onCheckedChange={toggleCamera}
                    disabled={busy || !supportsCameraToggle}
                    aria-label={t("preRecord.includeCameraAria")}
                    className={SWITCH_CLASS}
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" collisionPadding={8}>
                {t("preRecord.includeCameraAria")}
              </TooltipContent>
            </Tooltip>
          </div>

          <div
            className={cn(
              CONTROL_ROW_CLASS,
              audioEnabled ? "hover:bg-muted/45" : "text-muted-foreground",
            )}
          >
            <IconMicrophone
              className="size-5"
              stroke={1.75}
              aria-hidden="true"
            />
            {audioEnabled ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    ref={microphoneMenuTriggerRef}
                    type="button"
                    className={CONTROL_TRIGGER_CLASS}
                    aria-label={selectedMicLabel}
                  >
                    <span className="min-w-0 max-w-[7.5rem] truncate">
                      {selectedMicLabel}
                    </span>
                    <MicrophoneVisualizer
                      deviceId={micId === "default" ? null : micId}
                      disabled={busy}
                      unlocked={
                        micAccessStatus === "granted" ||
                        microphoneLabelsUnlocked
                      }
                      onStatusChange={handleMicStatusChange}
                      onSignalChange={handleMicSignalChange}
                    />
                    <IconChevronDown
                      className="size-4 shrink-0 text-muted-foreground"
                      stroke={1.75}
                      aria-hidden="true"
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  sideOffset={6}
                  className={DEVICE_MENU_CLASS}
                  collisionPadding={8}
                >
                  <DropdownMenuRadioGroup
                    value={micId}
                    onValueChange={handleMicIdChange}
                  >
                    <DropdownMenuRadioItem value="default">
                      {t("preRecord.defaultMicrophone")}
                    </DropdownMenuRadioItem>
                    {compactMicrophoneDeviceOptions.map((microphone) => (
                      <DropdownMenuRadioItem
                        key={microphone.value}
                        value={microphone.value}
                      >
                        {microphone.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  {microphoneDeviceOptions.length > COMPACT_DEVICE_LIMIT ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => setMicrophonePickerOpen(true)}
                      >
                        {t("preRecord.moreMicrophones")}
                      </DropdownMenuItem>
                    </>
                  ) : null}
                  {!microphoneLabelsUnlocked ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        disabled={micAccessStatus === "requesting"}
                        onSelect={() =>
                          handleMicIdChange(REQUEST_MIC_ACCESS_VALUE)
                        }
                      >
                        {micAccessStatus === "requesting"
                          ? t("preRecord.openingMicrophone")
                          : t("preRecord.chooseMicrophone")}
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="truncate py-2 text-sm font-medium">
                {t("preRecord.noMicrophone")}
              </span>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex justify-self-end">
                  <Switch
                    checked={audioEnabled}
                    onCheckedChange={toggleMicrophone}
                    disabled={busy}
                    aria-label={t("preRecord.includeAudioAria")}
                    className={SWITCH_CLASS}
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" collisionPadding={8}>
                {t("preRecord.includeAudioAria")}
              </TooltipContent>
            </Tooltip>
          </div>

          {microphoneError ? (
            <p
              role="alert"
              className="px-2 ps-[52px] text-[11px] leading-snug text-destructive"
            >
              {microphoneError}{" "}
              <CaptureInstallInlineLink className="text-foreground underline-offset-4 hover:underline">
                {t("preRecord.tryClipsDesktop")}
              </CaptureInstallInlineLink>
            </p>
          ) : null}

          {enumError ? (
            <p className="px-2 ps-[52px] text-[11px] text-muted-foreground">
              {enumError}
            </p>
          ) : null}
        </div>

        <div className="grid gap-3 border-t border-border p-3">
          <div className="flex items-center gap-2">
            {onCancel ? (
              <Button variant="ghost" onClick={onCancel} disabled={busy}>
                {t("common.cancel")}
              </Button>
            ) : null}
            <Button
              ref={startButtonRef}
              disabled={startDisabled}
              onClick={handleStartClick}
              className={cn("h-11 gap-2", onCancel ? "flex-1" : "w-full")}
            >
              <span
                className="size-2 shrink-0 rounded-full bg-destructive"
                aria-hidden="true"
              />
              {mode === "camera"
                ? t("preRecord.startCameraRecording")
                : t("preRecord.startRecording")}
            </Button>
          </div>
        </div>
      </div>
      <MicOffConfirmation
        open={micWarningOpen}
        onBack={handleMicWarningBack}
        onUnmute={handleMicWarningUnmute}
        onContinue={handleMicWarningContinue}
        returnFocusRef={startButtonRef}
      />
      <DevicePickerDialog
        open={cameraPickerOpen}
        onOpenChange={setCameraPickerOpen}
        title={t("preRecord.cameraPickerTitle")}
        value={cameraId}
        options={allCameraDeviceOptions}
        onValueChange={chooseCamera}
        returnFocusRef={cameraMenuTriggerRef}
      />
      <DevicePickerDialog
        open={microphonePickerOpen}
        onOpenChange={setMicrophonePickerOpen}
        title={t("preRecord.microphonePickerTitle")}
        value={micId}
        options={allMicrophoneDeviceOptions}
        onValueChange={handleMicIdChange}
        returnFocusRef={microphoneMenuTriggerRef}
      />
    </TooltipProvider>
  );
}
