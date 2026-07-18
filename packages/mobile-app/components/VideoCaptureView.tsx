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
  StyleSheet,
  Text,
  View,
  type AppStateStatus,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import IOSBroadcastPicker from "@/components/IOSBroadcastPicker";
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
      style={({ pressed }) => [
        styles.iconButton,
        pressed && !disabled && styles.buttonPressed,
        disabled && styles.buttonDisabled,
      ]}
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
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text style={styles.loadingText}>Preparing camera…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!captureGranted) {
    const permanentlyBlocked =
      (!cameraGranted && cameraPermission.canAskAgain === false) ||
      (!microphoneGranted && microphonePermission.canAskAgain === false);

    return (
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        <View style={styles.permissionHeader}>
          <RoundIconButton
            accessibilityLabel="Cancel video capture"
            onPress={cancel}
          >
            <IconX size={22} color="#FFFFFF" strokeWidth={2} />
          </RoundIconButton>
        </View>

        <View style={styles.permissionContent}>
          <View style={styles.permissionIcon} accessible={false}>
            <IconCamera size={34} color="#FFFFFF" strokeWidth={1.7} />
          </View>
          <Text style={styles.permissionTitle}>Camera & microphone</Text>
          <Text style={styles.permissionDescription}>
            Allow both to record a video with sound. You can still choose an
            existing video without recording.
          </Text>

          {message && (
            <View style={styles.permissionMessage}>
              <IconAlertCircle size={18} color="#FF7A6B" strokeWidth={2} />
              <Text style={styles.permissionMessageText}>{message}</Text>
            </View>
          )}

          {permanentlyBlocked || repairTarget === "capture" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open device Settings"
              onPress={() => void openSettings()}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <IconSettings size={20} color="#111111" strokeWidth={2} />
              <Text style={styles.primaryButtonText}>Open Settings</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Allow camera and microphone access"
              accessibilityState={{ busy: isRequestingPermission }}
              disabled={isRequestingPermission}
              onPress={() => void requestCaptureAccess()}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.buttonPressed,
                isRequestingPermission && styles.buttonDisabled,
              ]}
            >
              {isRequestingPermission ? (
                <ActivityIndicator size="small" color="#111111" />
              ) : (
                <IconCamera size={20} color="#111111" strokeWidth={2} />
              )}
              <Text style={styles.primaryButtonText}>Allow access</Text>
            </Pressable>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose an existing video"
            accessibilityState={{ busy: isImporting }}
            disabled={isImporting || isDelivering}
            onPress={() => void importVideo()}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.buttonPressed,
              (isImporting || isDelivering) && styles.buttonDisabled,
            ]}
          >
            {isImporting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <IconPhoto size={20} color="#FFFFFF" strokeWidth={2} />
            )}
            <Text style={styles.secondaryButtonText}>Choose from library</Text>
          </Pressable>

          {repairTarget === "library" && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open Settings for photo library access"
              onPress={() => void openSettings()}
              style={({ pressed }) => [
                styles.repairLink,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.repairLinkText}>Repair library access</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.preview}>
        <CameraView
          ref={cameraRef}
          accessible={false}
          active={appState === "active"}
          facing={facing}
          mirror={facing === "front"}
          mode="video"
          mute={false}
          responsiveOrientationWhenOrientationLocked
          style={StyleSheet.absoluteFill}
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
          <View style={styles.cameraLoading} pointerEvents="none">
            <ActivityIndicator size="large" color="#FFFFFF" />
          </View>
        )}

        <View style={styles.topControls} pointerEvents="box-none">
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
            style={[
              styles.statusPill,
              isRecording && styles.statusPillRecording,
            ]}
          >
            {isRecording && <View style={styles.recordingDot} />}
            <Text style={styles.statusText}>
              {isRecording ? formatDuration(elapsedMs) : "Video"}
            </Text>
          </View>

          <View style={styles.topControlSpacer} />
        </View>

        <View style={styles.bottomPanel} pointerEvents="box-none">
          {message && (
            <View
              accessibilityLiveRegion="assertive"
              style={styles.errorBanner}
            >
              <IconAlertCircle size={18} color="#FF8A7D" strokeWidth={2} />
              <Text style={styles.errorBannerText}>{message}</Text>
              {repairTarget && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open device Settings"
                  onPress={() => void openSettings()}
                  hitSlop={8}
                >
                  <Text style={styles.errorBannerAction}>Settings</Text>
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
                  <Text style={styles.errorBannerAction}>Retry</Text>
                </Pressable>
              )}
            </View>
          )}

          <View style={styles.captureControls}>
            <View style={styles.sideControl}>
              <RoundIconButton
                accessibilityLabel="Switch camera"
                accessibilityHint={`Switch to the ${facing === "front" ? "back" : "front"} camera`}
                disabled={isRecording || isBusy}
                onPress={flipCamera}
              >
                <IconCameraRotate size={24} color="#FFFFFF" strokeWidth={1.8} />
              </RoundIconButton>
              <Text style={styles.controlLabel}>Flip</Text>
            </View>

            <View style={styles.recordControl}>
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
                style={({ pressed }) => [
                  styles.recordButton,
                  pressed && !isBusy && styles.recordButtonPressed,
                  (!cameraReady || isBusy) && styles.buttonDisabled,
                ]}
              >
                {isStopping || isDelivering ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <View
                    style={[
                      styles.recordButtonInner,
                      isRecording && styles.recordButtonStop,
                    ]}
                  />
                )}
              </Pressable>
              <Text style={styles.recordLabel}>
                {isStopping || isDelivering
                  ? "Finishing…"
                  : isRecording
                    ? "Stop"
                    : "Record"}
              </Text>
            </View>

            <View style={styles.sideControl}>
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
              <Text style={styles.controlLabel}>Library</Text>
            </View>
          </View>
          {Platform.OS === "ios" && !isRecording ? (
            <View style={styles.screenCaptureRow}>
              <View style={styles.screenCaptureCopy}>
                <Text style={styles.screenCaptureTitle}>
                  Record your screen
                </Text>
                <Text style={styles.screenCaptureDescription}>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#090909",
  },
  preview: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: "#111111",
  },
  loadingState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },
  loadingText: {
    color: "#9A9A9A",
    fontSize: 14,
  },
  permissionHeader: {
    paddingHorizontal: 18,
    paddingTop: 8,
  },
  permissionContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 30,
    paddingBottom: 70,
  },
  permissionIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 22,
    backgroundColor: "#1C1C1C",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#333333",
  },
  permissionTitle: {
    color: "#FFFFFF",
    fontSize: 25,
    lineHeight: 31,
    fontWeight: "700",
    letterSpacing: -0.4,
    textAlign: "center",
  },
  permissionDescription: {
    maxWidth: 340,
    marginTop: 10,
    marginBottom: 24,
    color: "#A6A6A6",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  permissionMessage: {
    width: "100%",
    maxWidth: 360,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    marginBottom: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: "#271715",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#63332D",
  },
  permissionMessageText: {
    flex: 1,
    color: "#F1B1A9",
    fontSize: 13,
    lineHeight: 18,
  },
  primaryButton: {
    width: "100%",
    maxWidth: 360,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
  },
  primaryButtonText: {
    color: "#111111",
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryButton: {
    width: "100%",
    maxWidth: 360,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    marginTop: 12,
    borderRadius: 16,
    backgroundColor: "#1A1A1A",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#333333",
  },
  secondaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  repairLink: {
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  repairLinkText: {
    color: "#BEBEBE",
    fontSize: 14,
    fontWeight: "600",
  },
  topControls: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 12,
  },
  topControlSpacer: {
    width: 48,
    height: 48,
  },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(18, 18, 18, 0.72)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.18)",
  },
  statusPill: {
    minWidth: 82,
    height: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: 19,
    backgroundColor: "rgba(18, 18, 18, 0.72)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.18)",
  },
  statusPillRecording: {
    backgroundColor: "rgba(30, 12, 10, 0.88)",
    borderColor: "rgba(255, 102, 87, 0.5)",
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FF5D4D",
  },
  statusText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  cameraLoading: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111111",
  },
  bottomPanel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 14,
    backgroundColor: "rgba(8, 8, 8, 0.76)",
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginBottom: 18,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 14,
    backgroundColor: "rgba(37, 18, 16, 0.96)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#62322C",
  },
  errorBannerText: {
    flex: 1,
    color: "#F1B1A9",
    fontSize: 13,
    lineHeight: 18,
  },
  errorBannerAction: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  captureControls: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  screenCaptureRow: {
    alignItems: "center",
    borderTopColor: "rgba(255, 255, 255, 0.14)",
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    marginTop: 14,
    paddingTop: 12,
  },
  screenCaptureCopy: { flex: 1 },
  screenCaptureTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  screenCaptureDescription: {
    color: "#A6A6A6",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  sideControl: {
    width: 76,
    alignItems: "center",
    gap: 7,
    paddingTop: 10,
  },
  controlLabel: {
    color: "#D2D2D2",
    fontSize: 12,
    fontWeight: "600",
  },
  recordControl: {
    minWidth: 96,
    alignItems: "center",
    gap: 8,
  },
  recordButton: {
    width: 82,
    height: 82,
    borderRadius: 41,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    borderWidth: 3,
    borderColor: "#FFFFFF",
  },
  recordButtonInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#FF5D4D",
  },
  recordButtonStop: {
    width: 30,
    height: 30,
    borderRadius: 8,
  },
  recordLabel: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  buttonPressed: {
    opacity: 0.72,
  },
  recordButtonPressed: {
    transform: [{ scale: 0.96 }],
  },
  buttonDisabled: {
    opacity: 0.45,
  },
});
