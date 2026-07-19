import {
  IconAlertCircle,
  IconCamera,
  IconCameraRotate,
  IconPhoto,
  IconSettings,
  IconX,
} from "@tabler/icons-react-native";
import {
  CameraView,
  useCameraPermissions,
  useMicrophonePermissions,
  type CameraType,
} from "expo-camera";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  Text,
  View,
  type AppStateStatus,
} from "react-native";

import IOSBroadcastPicker from "@/components/IOSBroadcastPicker";
import { SafeAreaView } from "@/components/uniwind-interop";
import { createCaptureId } from "@/lib/capture-id";
import { shouldStopVideoForAppState } from "@/lib/capture-lifecycle";
import {
  endIOSCaptureActivity,
  startIOSCaptureActivity,
  subscribeToIOSCaptureStop,
} from "@/lib/ios-companion";
import { setMobileCaptureStateBestEffort } from "@/lib/mobile-state-api";

export type CapturedVideoMedia = {
  captureId: string;
  type: "video";
  source: "camera" | "library";
  uri: string;
  mimeType: string;
  title: string;
  durationMs?: number;
  width?: number;
  height?: number;
};

export interface VideoCaptureViewProps {
  onCaptured: (media: CapturedVideoMedia) => void | Promise<void>;
  onCancel: () => void;
}

type RepairTarget = "capture" | "library" | null;
type RecordingCompletionDisposition = "capture" | "discard";

function positiveNumber(value: number | null | undefined) {
  return typeof value === "number" && value > 0 ? value : undefined;
}

function inferVideoMimeType(uri: string, provided?: string | null) {
  if (provided === "video/x-m4v") return "video/mp4";
  if (provided?.startsWith("video/")) return provided;

  const cleanUri = uri.split(/[?#]/, 1)[0]?.toLowerCase() ?? "";
  if (cleanUri.endsWith(".mov")) return "video/quicktime";
  if (cleanUri.endsWith(".m4v")) return "video/mp4";
  if (cleanUri.endsWith(".webm")) return "video/webm";
  if (cleanUri.endsWith(".3gp")) return "video/3gpp";
  return "video/mp4";
}

function isSupportedClipsVideoMimeType(mimeType: string) {
  const baseType = mimeType.split(";")[0]?.trim().toLowerCase();
  return (
    baseType === "video/mp4" ||
    baseType === "video/quicktime" ||
    baseType === "video/webm"
  );
}

function createTitle(source: CapturedVideoMedia["source"], date = new Date()) {
  const prefix = source === "camera" ? "Camera video" : "Imported video";
  const datePart = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timePart = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${prefix} · ${datePart}, ${timePart}`;
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function discardLocalVideo(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // The recording remains logically discarded if platform cache cleanup fails.
  }
}

function mediaFromPickerAsset(
  asset: ImagePicker.ImagePickerAsset,
): CapturedVideoMedia {
  return {
    captureId: createCaptureId(),
    type: "video",
    source: "library",
    uri: asset.uri,
    mimeType: inferVideoMimeType(asset.uri, asset.mimeType),
    title: createTitle("library"),
    durationMs: positiveNumber(asset.duration),
    width: positiveNumber(asset.width),
    height: positiveNumber(asset.height),
  };
}

export function canCancelVideoRecording(deliveryStarted: boolean): boolean {
  return !deliveryStarted;
}

export async function completeVideoRecording({
  captureId,
  disposition,
  uri,
  startedAt,
  stoppedAt,
  deliverMedia,
  discardMedia = discardLocalVideo,
}: {
  captureId: string;
  disposition: RecordingCompletionDisposition;
  uri?: string;
  startedAt: number | null;
  stoppedAt: number;
  deliverMedia: (media: CapturedVideoMedia) => void | Promise<void>;
  discardMedia?: (uri: string) => void | Promise<void>;
}): Promise<"captured" | "discarded"> {
  if (disposition === "discard") {
    if (uri) await discardMedia(uri);
    return "discarded";
  }
  if (!uri) throw new Error("The recording did not produce a video.");

  const durationMs =
    startedAt === null ? undefined : Math.max(0, stoppedAt - startedAt);
  await deliverMedia({
    captureId,
    type: "video",
    source: "camera",
    uri,
    mimeType: inferVideoMimeType(uri),
    title: createTitle("camera"),
    durationMs,
  });
  return "captured";
}

function RoundIconButton({
  accessibilityLabel,
  accessibilityHint,
  disabled = false,
  onPress,
  children,
}: {
  accessibilityLabel: string;
  accessibilityHint?: string;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={10}
      onPress={onPress}
      className={`w-12 h-12 rounded-full items-center justify-center bg-[rgba(18,18,18,0.72)] border-[0.5px] border-[rgba(255,255,255,0.18)] active:opacity-70 ${
        disabled ? "opacity-45" : ""
      }`}
    >
      {children}
    </Pressable>
  );
}

export function VideoCaptureView({
  onCaptured,
  onCancel,
}: VideoCaptureViewProps) {
  const cameraRef = useRef<CameraView>(null);
  const mountedRef = useRef(true);
  const onCapturedRef = useRef(onCaptured);
  const recordingRef = useRef(false);
  const stoppingRef = useRef(false);
  const deliveryStartedRef = useRef(false);
  const recordingCompletionDispositionRef =
    useRef<RecordingCompletionDisposition>("capture");
  const recordingStartedAtRef = useRef<number | null>(null);
  const recordingStoppedAtRef = useRef<number | null>(null);
  const recordingCaptureIdRef = useRef<string | null>(null);

  const [cameraPermission, requestCameraPermission, getCameraPermission] =
    useCameraPermissions();
  const [
    microphonePermission,
    requestMicrophonePermission,
    getMicrophonePermission,
  ] = useMicrophonePermissions();
  const [facing, setFacing] = useState<CameraType>("front");
  const [cameraReady, setCameraReady] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDelivering, setIsDelivering] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<CapturedVideoMedia | null>(
    null,
  );
  const [elapsedMs, setElapsedMs] = useState(0);
  const [appState, setAppState] = useState<AppStateStatus>(
    AppState.currentState,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [repairTarget, setRepairTarget] = useState<RepairTarget>(null);

  const cameraGranted = cameraPermission?.granted === true;
  const microphoneGranted = microphonePermission?.granted === true;
  const permissionsLoaded =
    cameraPermission !== null && microphonePermission !== null;
  const captureGranted = cameraGranted && microphoneGranted;
  const isBusy = isImporting || isDelivering || isStopping;

  useEffect(() => {
    const phase = isRecording
      ? "recording"
      : isDelivering || isStopping
        ? "saving"
        : message
          ? "error"
          : "ready";
    void setMobileCaptureStateBestEffort({ view: "video", phase });
  }, [isDelivering, isRecording, isStopping, message]);

  useEffect(() => {
    onCapturedRef.current = onCaptured;
  }, [onCaptured]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      if (
        recordingRef.current &&
        canCancelVideoRecording(deliveryStartedRef.current)
      ) {
        recordingCompletionDispositionRef.current = "discard";
        if (!stoppingRef.current) {
          stoppingRef.current = true;
          recordingStoppedAtRef.current = Date.now();
          cameraRef.current?.stopRecording();
        }
      }
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isRecording) return;

    const updateElapsed = () => {
      const startedAt = recordingStartedAtRef.current;
      if (startedAt !== null) setElapsedMs(Date.now() - startedAt);
    };
    updateElapsed();
    const interval = setInterval(updateElapsed, 250);
    return () => clearInterval(interval);
  }, [isRecording]);

  const deliverMedia = useCallback(async (media: CapturedVideoMedia) => {
    deliveryStartedRef.current = true;
    if (mountedRef.current) {
      setPendingMedia(media);
      setIsDelivering(true);
      setMessage(null);
      setRepairTarget(null);
    }
    try {
      await onCapturedRef.current(media);
      if (mountedRef.current) setPendingMedia(null);
    } catch (error) {
      if (mountedRef.current) {
        setMessage(errorMessage(error, "Could not use this video."));
      }
    } finally {
      deliveryStartedRef.current = false;
      if (mountedRef.current) setIsDelivering(false);
    }
  }, []);

  const deliverPickerResult = useCallback(
    async (result: ImagePicker.ImagePickerResult) => {
      if (result.canceled) return;
      const asset = result.assets[0];
      if (
        !asset ||
        (asset.type !== null &&
          asset.type !== undefined &&
          asset.type !== "video")
      ) {
        if (mountedRef.current) {
          setMessage("Choose a video from your library.");
        }
        return;
      }
      const media = mediaFromPickerAsset(asset);
      if (!isSupportedClipsVideoMimeType(media.mimeType)) {
        setMessage(
          "This video format is not supported yet. Choose an MP4, MOV, or WebM video.",
        );
        return;
      }
      await deliverMedia(media);
    },
    [deliverMedia],
  );

  useEffect(() => {
    let cancelled = false;

    // Android can recreate the activity while its system picker is open.
    void ImagePicker.getPendingResultAsync()
      .then(async (result) => {
        if (cancelled || !result) return;
        if ("code" in result) {
          setMessage(result.message || "Could not restore the selected video.");
          return;
        }
        await deliverPickerResult(result);
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage(
            errorMessage(error, "Could not restore the selected video."),
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [deliverPickerResult]);

  const stopRecording = useCallback(() => {
    if (!recordingRef.current || stoppingRef.current) return;
    stoppingRef.current = true;
    recordingStoppedAtRef.current = Date.now();
    setIsStopping(true);
    cameraRef.current?.stopRecording();
  }, []);

  useEffect(
    () =>
      subscribeToIOSCaptureStop((captureId) => {
        if (captureId === recordingCaptureIdRef.current) stopRecording();
      }),
    [stopRecording],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      setAppState(nextState);
      if (shouldStopVideoForAppState(nextState) && recordingRef.current) {
        setMessage("Recording stopped because the camera was interrupted.");
        stopRecording();
      } else if (nextState === "active") {
        void Promise.all([getCameraPermission(), getMicrophonePermission()]);
      }
    });
    return () => subscription.remove();
  }, [getCameraPermission, getMicrophonePermission, stopRecording]);

  const requestCaptureAccess = useCallback(async () => {
    setIsRequestingPermission(true);
    setMessage(null);
    setRepairTarget(null);

    try {
      const nextCamera = cameraGranted
        ? cameraPermission
        : cameraPermission?.canAskAgain === false
          ? cameraPermission
          : await requestCameraPermission();
      const nextMicrophone = microphoneGranted
        ? microphonePermission
        : microphonePermission?.canAskAgain === false
          ? microphonePermission
          : await requestMicrophonePermission();

      if (!nextCamera?.granted || !nextMicrophone?.granted) {
        const blocked =
          (!nextCamera?.granted && nextCamera?.canAskAgain === false) ||
          (!nextMicrophone?.granted && nextMicrophone?.canAskAgain === false);
        setMessage(
          blocked
            ? "Camera or microphone access is disabled. Open Settings to enable both."
            : "Camera and microphone access are both required to record video with sound.",
        );
        setRepairTarget(blocked ? "capture" : null);
      }
    } catch (error) {
      setMessage(errorMessage(error, "Could not request camera access."));
    } finally {
      setIsRequestingPermission(false);
    }
  }, [
    cameraGranted,
    cameraPermission,
    microphoneGranted,
    microphonePermission,
    requestCameraPermission,
    requestMicrophonePermission,
  ]);

  const openSettings = useCallback(async () => {
    try {
      await Linking.openSettings();
    } catch (error) {
      setMessage(errorMessage(error, "Open device Settings to repair access."));
    }
  }, []);

  const importVideo = useCallback(async () => {
    if (isBusy || isRecording) return;
    setIsImporting(true);
    setMessage(null);
    setRepairTarget(null);

    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        const blocked = permission.canAskAgain === false;
        setMessage(
          blocked
            ? "Photo library access is disabled. Open Settings to choose a video."
            : "Photo library access is needed to choose a video.",
        );
        setRepairTarget(blocked ? "library" : null);
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["videos"],
        allowsEditing: false,
        allowsMultipleSelection: false,
        quality: 1,
      });
      await deliverPickerResult(result);
    } catch (error) {
      setMessage(errorMessage(error, "Could not open your video library."));
    } finally {
      if (mountedRef.current) setIsImporting(false);
    }
  }, [deliverPickerResult, isBusy, isRecording]);

  const startRecording = useCallback(async () => {
    if (!cameraReady || !captureGranted || isBusy || recordingRef.current) {
      return;
    }

    setMessage(null);
    setRepairTarget(null);
    recordingRef.current = true;
    stoppingRef.current = false;
    deliveryStartedRef.current = false;
    recordingCompletionDispositionRef.current = "capture";
    recordingStartedAtRef.current = Date.now();
    recordingCaptureIdRef.current = createCaptureId();
    recordingStoppedAtRef.current = null;
    setElapsedMs(0);
    setIsRecording(true);
    setIsStopping(false);
    void startIOSCaptureActivity({
      captureId: recordingCaptureIdRef.current,
      kind: "video",
      startedAt: recordingStartedAtRef.current,
    });

    try {
      const result = await cameraRef.current?.recordAsync();
      const startedAt = recordingStartedAtRef.current;
      const stoppedAt = recordingStoppedAtRef.current ?? Date.now();
      const outcome = await completeVideoRecording({
        captureId: recordingCaptureIdRef.current,
        disposition: recordingCompletionDispositionRef.current,
        uri: result?.uri,
        startedAt,
        stoppedAt,
        deliverMedia,
      });
      void endIOSCaptureActivity(
        recordingCaptureIdRef.current,
        outcome === "discarded" ? "discarded" : "completed",
      );
    } catch (error) {
      if (recordingCaptureIdRef.current) {
        void endIOSCaptureActivity(recordingCaptureIdRef.current, "failed");
      }
      if (mountedRef.current) {
        setMessage(errorMessage(error, "Recording stopped unexpectedly."));
      }
    } finally {
      recordingRef.current = false;
      stoppingRef.current = false;
      recordingStartedAtRef.current = null;
      recordingStoppedAtRef.current = null;
      recordingCaptureIdRef.current = null;
      if (mountedRef.current) {
        setIsRecording(false);
        setIsStopping(false);
        setElapsedMs(0);
      }
    }
  }, [cameraReady, captureGranted, deliverMedia, isBusy]);

  const cancel = useCallback(() => {
    if (!canCancelVideoRecording(deliveryStartedRef.current)) return;
    if (recordingRef.current) {
      recordingCompletionDispositionRef.current = "discard";
      stopRecording();
      onCancel();
      return;
    }
    if (isDelivering) return;
    if (pendingMedia) {
      setPendingMedia(null);
    }
    onCancel();
  }, [isDelivering, onCancel, pendingMedia, stopRecording]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (recordingRef.current || isDelivering || pendingMedia) {
          cancel();
          return true;
        }
        return false;
      },
    );
    return () => subscription.remove();
  }, [cancel, isDelivering, pendingMedia]);

  const flipCamera = useCallback(() => {
    if (isRecording || isBusy) return;
    setCameraReady(false);
    setFacing((current) => (current === "front" ? "back" : "front"));
  }, [isBusy, isRecording]);

  if (!permissionsLoaded) {
    return (
      <SafeAreaView className="flex-1 bg-background-dark">
        <View className="flex-1 items-center justify-center gap-3.5">
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text className="text-gray-light text-sm">Preparing camera…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!captureGranted) {
    const permanentlyBlocked =
      (!cameraGranted && cameraPermission.canAskAgain === false) ||
      (!microphoneGranted && microphonePermission.canAskAgain === false);

    return (
      <SafeAreaView
        className="flex-1 bg-background-dark"
        edges={["top", "bottom"]}
      >
        <View className="px-4.5 pt-2">
          <RoundIconButton
            accessibilityLabel="Cancel video capture"
            onPress={cancel}
          >
            <IconX size={22} color="#FFFFFF" strokeWidth={2} />
          </RoundIconButton>
        </View>

        <View className="flex-1 items-center justify-center px-7 pb-16">
          <View
            className="w-18 h-18 rounded-3xl items-center justify-center mb-5 bg-[#1C1C1C] border border-gray-border-light"
            accessible={false}
          >
            <IconCamera size={34} color="#FFFFFF" strokeWidth={1.7} />
          </View>
          <Text className="text-white text-3xl font-bold tracking-tight text-center">
            Camera & microphone
          </Text>
          <Text className="text-text-muted text-base leading-5 text-center mt-2.5 mb-6">
            Allow both to record a video with sound. You can still choose an
            existing video without recording.
          </Text>

          {message && (
            <View className="w-full max-w-sm flex-row items-start gap-2 mb-4 px-3.5 py-3 rounded-2xl bg-warning-red-bg border border-warning-red-border">
              <IconAlertCircle size={18} color="#FF7A6B" strokeWidth={2} />
              <Text className="flex-1 text-banner-error-text text-xs leading-4">
                {message}
              </Text>
            </View>
          )}

          {permanentlyBlocked || repairTarget === "capture" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open device Settings"
              onPress={() => void openSettings()}
              className="w-full max-w-sm h-13 flex-row items-center justify-center gap-2 rounded-2xl bg-white active:opacity-70"
            >
              <IconSettings size={20} color="#111111" strokeWidth={2} />
              <Text className="text-background-pure text-base font-bold">
                Open Settings
              </Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Allow camera and microphone access"
              accessibilityState={{ busy: isRequestingPermission }}
              disabled={isRequestingPermission}
              onPress={() => void requestCaptureAccess()}
              className={`w-full max-w-sm h-13 flex-row items-center justify-center gap-2 rounded-2xl bg-white active:opacity-70 ${isRequestingPermission ? "opacity-45" : ""}`}
            >
              {isRequestingPermission ? (
                <ActivityIndicator size="small" color="#111111" />
              ) : (
                <IconCamera size={20} color="#111111" strokeWidth={2} />
              )}
              <Text className="text-background-pure text-base font-bold">
                Allow access
              </Text>
            </Pressable>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose an existing video"
            accessibilityState={{ busy: isImporting }}
            disabled={isImporting || isDelivering}
            onPress={() => void importVideo()}
            className={`w-full max-w-sm h-13 flex-row items-center justify-center gap-2 mt-3 rounded-2xl bg-gray-dark border border-gray-border-light active:opacity-70 ${isImporting || isDelivering ? "opacity-45" : ""}`}
          >
            {isImporting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <IconPhoto size={20} color="#FFFFFF" strokeWidth={2} />
            )}
            <Text className="text-white text-base font-semibold">
              Choose from library
            </Text>
          </Pressable>

          {repairTarget === "library" && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open Settings for photo library access"
              onPress={() => void openSettings()}
              className="px-3 py-3.5 active:opacity-70"
            >
              <Text className="text-text-muted text-sm font-semibold">
                Repair library access
              </Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      className="flex-1 bg-background-dark"
      edges={["top", "bottom"]}
    >
      <View className="flex-1 overflow-hidden bg-background-pure">
        <CameraView
          ref={cameraRef}
          accessible={false}
          active={appState === "active"}
          facing={facing}
          mirror={facing === "front"}
          mode="video"
          mute={false}
          responsiveOrientationWhenOrientationLocked
          className="absolute inset-0"
          videoStabilizationMode="auto"
          onCameraReady={() => {
            setCameraReady(true);
            setMessage(null);
          }}
          onMountError={({ message: mountMessage }) => {
            setCameraReady(false);
            setMessage(mountMessage || "Camera preview is unavailable.");
          }}
        />

        {!cameraReady && appState === "active" && (
          <View
            className="absolute inset-0 items-center justify-center bg-background-pure"
            pointerEvents="none"
          >
            <ActivityIndicator size="large" color="#FFFFFF" />
          </View>
        )}

        <View
          className="absolute top-0 left-0 right-0 flex-row items-center justify-between px-4.5 pt-3"
          pointerEvents="box-none"
        >
          <RoundIconButton
            accessibilityLabel="Cancel video capture"
            onPress={cancel}
          >
            <IconX size={22} color="#FFFFFF" strokeWidth={2} />
          </RoundIconButton>

          <View
            accessibilityRole="timer"
            accessibilityLiveRegion="polite"
            accessibilityLabel={
              isRecording
                ? `Recording ${formatDuration(elapsedMs)}`
                : "Video camera ready"
            }
            className={`min-w-20 h-9.5 flex-row items-center justify-center gap-2 px-3.5 rounded-full bg-overlay-dark border border-overlay-border ${
              isRecording
                ? "bg-status-recording-bg border-status-recording-border"
                : ""
            }`}
          >
            {isRecording && (
              <View className="w-2 h-2 rounded-full bg-status-recording-dot" />
            )}
            <Text className="text-white text-sm font-bold font-[tabular-nums]">
              {isRecording ? formatDuration(elapsedMs) : "Video"}
            </Text>
          </View>

          <View className="w-12 h-12" />
        </View>

        <View
          className="absolute left-0 right-0 bottom-0 px-4.5 pt-4.5 pb-3.5 bg-panel-bg"
          pointerEvents="box-none"
        >
          {message && (
            <View
              accessibilityLiveRegion="assertive"
              className="flex-row items-center gap-2.25 mb-4.5 px-3.5 py-2.75 rounded-xl bg-banner-error-bg border border-banner-error-border"
            >
              <IconAlertCircle size={18} color="#FF8A7D" strokeWidth={2} />
              <Text className="flex-1 text-banner-error-text text-xs leading-4">
                {message}
              </Text>
              {repairTarget && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open device Settings"
                  onPress={() => void openSettings()}
                  hitSlop={8}
                >
                  <Text className="text-white text-xs font-bold">Settings</Text>
                </Pressable>
              )}
              {!repairTarget && pendingMedia && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retry saving video"
                  disabled={isDelivering}
                  onPress={() => void deliverMedia(pendingMedia)}
                  hitSlop={8}
                >
                  <Text className="text-white text-xs font-bold">Retry</Text>
                </Pressable>
              )}
            </View>
          )}

          <View className="flex-row items-start justify-between">
            <View className="w-19 items-center gap-1.75 pt-2.5">
              <RoundIconButton
                accessibilityLabel="Switch camera"
                accessibilityHint={`Switch to the ${facing === "front" ? "back" : "front"} camera`}
                disabled={isRecording || isBusy}
                onPress={flipCamera}
              >
                <IconCameraRotate size={24} color="#FFFFFF" strokeWidth={1.8} />
              </RoundIconButton>
              <Text className="text-text-medium-light text-xs font-semibold">
                Flip
              </Text>
            </View>

            <View className="min-w-24 items-center gap-2">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isStopping
                    ? "Finishing recording"
                    : isRecording
                      ? "Stop recording"
                      : "Start recording"
                }
                accessibilityHint={
                  isRecording
                    ? "Stops and uses this video"
                    : "Records video with sound"
                }
                accessibilityState={{
                  busy: isStopping || isDelivering,
                  disabled: !cameraReady || isBusy,
                }}
                disabled={!cameraReady || isBusy}
                onPress={
                  isRecording ? stopRecording : () => void startRecording()
                }
                className={`w-20 h-20 rounded-full items-center justify-center bg-record-border-outer border-2 border-white active:scale-95 ${
                  !cameraReady || isBusy ? "opacity-45" : ""
                }`}
              >
                {isStopping || isDelivering ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <View
                    className={`w-16 h-16 rounded-full bg-status-recording-dot ${
                      isRecording ? "w-7 h-7 rounded-lg" : ""
                    }`}
                  />
                )}
              </Pressable>
              <Text className="text-white text-xs font-bold">
                {isStopping || isDelivering
                  ? "Finishing…"
                  : isRecording
                    ? "Stop"
                    : "Record"}
              </Text>
            </View>

            <View className="w-19 items-center gap-1.75 pt-2.5">
              <RoundIconButton
                accessibilityLabel="Choose an existing video"
                accessibilityHint="Opens your photo library"
                disabled={isRecording || isBusy}
                onPress={() => void importVideo()}
              >
                {isImporting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <IconPhoto size={24} color="#FFFFFF" strokeWidth={1.8} />
                )}
              </RoundIconButton>
              <Text className="text-text-medium-light text-xs font-semibold">
                Library
              </Text>
            </View>
          </View>
          {Platform.OS === "ios" && !isRecording ? (
            <View className="items-center border-t border-divider-light flex-row gap-3 mt-3.5 pt-3">
              <View className="flex-1">
                <Text className="text-white text-sm font-bold">
                  Record your screen
                </Text>
                <Text className="text-text-muted text-xs leading-4 mt-0.75">
                  Capture other apps with ReplayKit, system audio, and optional
                  microphone.
                </Text>
              </View>
              <IOSBroadcastPicker />
            </View>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

export default VideoCaptureView;
