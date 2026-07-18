import {
  IconChevronLeft,
  IconMicrophone,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
  IconSettings,
} from "@tabler/icons-react-native";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingStatus,
} from "expo-audio";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BackHandler,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { createCaptureId } from "@/lib/capture-id";
import {
  audioRecorderFailureMessage,
  reconcileAudioCaptureState,
  type AudioCaptureUiState,
} from "@/lib/capture-lifecycle";
import {
  endIOSCaptureActivity,
  startIOSCaptureActivity,
  subscribeToIOSCaptureStop,
  updateIOSCaptureActivity,
} from "@/lib/ios-companion";
import { setMobileCaptureStateBestEffort } from "@/lib/mobile-state-api";

export type AudioCaptureKind = "dictation" | "meeting";

export interface CapturedAudioMedia {
  captureId: string;
  type: "audio";
  kind: AudioCaptureKind;
  uri: string;
  mimeType: "audio/mp4";
  durationMs: number;
  title: string;
  startedAt: string;
}

interface AudioCaptureViewProps {
  kind: AudioCaptureKind;
  onCaptured: (media: CapturedAudioMedia) => void | Promise<void>;
  onCancel: () => void;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function captureTitle(kind: AudioCaptureKind, startedAt: string): string {
  const time = new Date(startedAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return kind === "meeting" ? `Meeting · ${time}` : `Dictation · ${time}`;
}

function capturedAudioMedia(
  captureId: string,
  kind: AudioCaptureKind,
  uri: string,
  durationMs: number,
  startedAt: string,
): CapturedAudioMedia {
  return {
    captureId,
    type: "audio",
    kind,
    uri,
    mimeType: "audio/mp4",
    durationMs,
    startedAt,
    title: captureTitle(kind, startedAt),
  };
}

export default function AudioCaptureView({
  kind,
  onCaptured,
  onCancel,
}: AudioCaptureViewProps) {
  const [captureState, setCaptureState] = useState<AudioCaptureUiState>(
    "checking-permission",
  );
  const [error, setError] = useState<string | null>(null);
  const [permissionIssue, setPermissionIssue] = useState<
    "microphone" | "notifications" | null
  >(null);
  const [pendingMedia, setPendingMedia] = useState<CapturedAudioMedia | null>(
    null,
  );
  const startedAtRef = useRef<string | null>(null);
  const captureIdRef = useRef<string | null>(null);
  const recordedDurationMsRef = useRef(0);
  const nativeRecordingStartedRef = useRef(false);
  const recoveredUrlRef = useRef<string | null>(null);
  const stoppingRef = useRef(false);
  const mountedRef = useRef(true);
  const onCapturedRef = useRef(onCaptured);

  useEffect(() => {
    onCapturedRef.current = onCaptured;
  }, [onCaptured]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const deliver = useCallback(async (media: CapturedAudioMedia) => {
    if (mountedRef.current) {
      setPendingMedia(media);
      setCaptureState("saving");
      setError(null);
    }
    try {
      await onCapturedRef.current(media);
      if (mountedRef.current) setPendingMedia(null);
    } catch (cause) {
      if (mountedRef.current) {
        setError(
          cause instanceof Error ? cause.message : "Could not save recording.",
        );
        setCaptureState("error");
      }
    }
  }, []);

  const handleRecorderStatus = useCallback(
    (status: RecordingStatus) => {
      const failureMessage = audioRecorderFailureMessage(status);
      if (status.mediaServicesDidReset) {
        const interruptedCapture = nativeRecordingStartedRef.current;
        stoppingRef.current = false;
        nativeRecordingStartedRef.current = false;
        if (!interruptedCapture) return;
        if (captureIdRef.current) {
          void endIOSCaptureActivity(captureIdRef.current, "failed");
        }
        if (mountedRef.current) {
          setError(failureMessage);
          setCaptureState("error");
        }
        return;
      }
      if (!status.hasError && !status.isFinished) return;
      if (status.url) {
        if (stoppingRef.current || !nativeRecordingStartedRef.current) return;
        if (recoveredUrlRef.current === status.url) return;
        recoveredUrlRef.current = status.url;
        stoppingRef.current = false;
        const startedAt = startedAtRef.current ?? new Date().toISOString();
        const media = capturedAudioMedia(
          captureIdRef.current ?? createCaptureId(),
          kind,
          status.url,
          recordedDurationMsRef.current,
          startedAt,
        );
        nativeRecordingStartedRef.current = false;
        void endIOSCaptureActivity(media.captureId, "completed");
        void deliver(media);
        return;
      }
      if (stoppingRef.current || !nativeRecordingStartedRef.current) return;
      stoppingRef.current = false;
      nativeRecordingStartedRef.current = false;
      if (captureIdRef.current) {
        void endIOSCaptureActivity(captureIdRef.current, "failed");
      }
      if (mountedRef.current) {
        setError(failureMessage ?? "The recording stopped unexpectedly.");
        setCaptureState("error");
      }
    },
    [deliver, kind],
  );

  const recorder = useAudioRecorder(
    RecordingPresets.HIGH_QUALITY,
    handleRecorderStatus,
  );
  const recorderState = useAudioRecorderState(recorder, 100);
  recordedDurationMsRef.current = Math.max(
    recordedDurationMsRef.current,
    recorderState.durationMillis,
  );

  useEffect(() => {
    if (recorderState.isRecording) nativeRecordingStartedRef.current = true;
    setCaptureState((current) =>
      reconcileAudioCaptureState(
        current,
        recorderState.isRecording,
        nativeRecordingStartedRef.current,
      ),
    );
  }, [recorderState.isRecording]);

  const prepareRecorder = useCallback(async () => {
    setCaptureState("checking-permission");
    setError(null);
    setPermissionIssue(null);
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setPermissionIssue("microphone");
      setCaptureState("permission-denied");
      return;
    }
    if (kind === "meeting" && Platform.OS === "android") {
      const currentNotifications = await Notifications.getPermissionsAsync();
      const notifications = currentNotifications.granted
        ? currentNotifications
        : await Notifications.requestPermissionsAsync();
      if (!notifications.granted) {
        setPermissionIssue("notifications");
        setCaptureState("permission-denied");
        return;
      }
    }
    await setAudioModeAsync({
      allowsRecording: true,
      allowsBackgroundRecording: kind === "meeting",
      interruptionMode: "doNotMix",
      playsInSilentMode: true,
      shouldPlayInBackground: kind === "meeting",
      shouldRouteThroughEarpiece: false,
    });
    await recorder.prepareToRecordAsync();
    if (mountedRef.current) setCaptureState("ready");
  }, [kind, recorder]);

  useEffect(() => {
    void prepareRecorder().catch((cause) => {
      if (!mountedRef.current) return;
      setError(
        cause instanceof Error ? cause.message : "Could not prepare recording.",
      );
      setCaptureState("error");
    });
  }, [prepareRecorder]);

  const start = useCallback(() => {
    const startedAt = new Date();
    const captureId = createCaptureId();
    startedAtRef.current = startedAt.toISOString();
    captureIdRef.current = captureId;
    recordedDurationMsRef.current = 0;
    nativeRecordingStartedRef.current = false;
    recoveredUrlRef.current = null;
    recorder.record();
    void startIOSCaptureActivity({
      captureId,
      kind,
      startedAt: startedAt.getTime(),
    });
    setCaptureState("recording");
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [kind, recorder]);

  const pause = useCallback(() => {
    recorder.pause();
    if (captureIdRef.current) {
      void updateIOSCaptureActivity(captureIdRef.current, "paused");
    }
    setCaptureState("paused");
    void Haptics.selectionAsync();
  }, [recorder]);

  const resume = useCallback(() => {
    nativeRecordingStartedRef.current = false;
    recorder.record();
    if (captureIdRef.current) {
      void updateIOSCaptureActivity(captureIdRef.current, "recording");
    }
    setCaptureState("recording");
    void Haptics.selectionAsync();
  }, [recorder]);

  const stop = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    if (mountedRef.current) setCaptureState("saving");
    const durationMs = Math.max(
      recordedDurationMsRef.current,
      recorderState.durationMillis,
    );
    const startedAt = startedAtRef.current ?? new Date().toISOString();
    try {
      await recorder.stop();
      const uri = recorder.uri ?? recorder.getStatus().url;
      if (!uri) throw new Error("The recording file could not be recovered.");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const media = capturedAudioMedia(
        captureIdRef.current ?? createCaptureId(),
        kind,
        uri,
        durationMs,
        startedAt,
      );
      void endIOSCaptureActivity(media.captureId, "completed");
      await deliver(media);
    } catch (cause) {
      if (mountedRef.current) {
        setError(
          cause instanceof Error ? cause.message : "Could not save recording.",
        );
        setCaptureState("error");
      }
      if (captureIdRef.current) {
        void endIOSCaptureActivity(captureIdRef.current, "failed");
      }
    } finally {
      stoppingRef.current = false;
    }
  }, [deliver, kind, recorder, recorderState.durationMillis]);

  useEffect(
    () =>
      subscribeToIOSCaptureStop((captureId) => {
        if (captureId === captureIdRef.current) void stop();
      }),
    [stop],
  );

  const level = useMemo(() => {
    const metering = recorderState.metering ?? -56;
    return Math.min(1, Math.max(0.08, (metering + 60) / 60));
  }, [recorderState.metering]);

  const isActive = captureState === "recording" || captureState === "paused";
  useEffect(() => {
    const phase =
      captureState === "recording" ||
      captureState === "paused" ||
      captureState === "saving"
        ? captureState
        : captureState === "error" || captureState === "permission-denied"
          ? "error"
          : "ready";
    void setMobileCaptureStateBestEffort({
      view: kind === "meeting" ? "meeting" : "dictate",
      phase,
    });
  }, [captureState, kind]);

  const handleClose = useCallback(() => {
    if (pendingMedia) {
      void deliver(pendingMedia);
      return;
    }
    if (isActive) {
      void stop();
      return;
    }
    if (captureState === "saving") return;
    onCancel();
  }, [captureState, deliver, isActive, onCancel, pendingMedia, stop]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (isActive || pendingMedia || captureState === "saving") {
          handleClose();
          return true;
        }
        return false;
      },
    );
    return () => subscription.remove();
  }, [captureState, handleClose, isActive, pendingMedia]);
  const statusCopy =
    kind === "meeting"
      ? "Keep Agent Native open or lock your phone—capture continues in the background."
      : "Speak naturally. You can review and edit the transcript before copying it.";

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Close capture"
          accessibilityRole="button"
          hitSlop={12}
          onPress={handleClose}
          style={styles.headerButton}
        >
          <IconChevronLeft color="#f4f4f5" size={24} strokeWidth={1.8} />
        </Pressable>
        <Text style={styles.eyebrow}>
          {kind === "meeting" ? "MEETING CAPTURE" : "VOICE DICTATION"}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.hero}>
        <View style={[styles.orb, isActive && styles.orbActive]}>
          <IconMicrophone
            color={isActive ? "#0b0b0c" : "#f4f4f5"}
            size={42}
            strokeWidth={1.6}
          />
        </View>
        <Text style={styles.timer}>
          {formatDuration(
            pendingMedia?.durationMs ?? recorderState.durationMillis,
          )}
        </Text>
        <Text style={styles.stateLabel}>
          {captureState === "recording"
            ? "Listening"
            : captureState === "paused"
              ? "Paused"
              : captureState === "saving"
                ? "Saving locally"
                : "Ready when you are"}
        </Text>

        <View accessibilityElementsHidden style={styles.waveform}>
          {Array.from({ length: 24 }, (_, index) => {
            const shape = 0.34 + ((index * 17) % 11) / 16;
            const height = isActive ? 8 + level * shape * 52 : 8;
            return (
              <View
                key={index}
                style={[
                  styles.waveBar,
                  { height },
                  captureState === "paused" && styles.waveBarPaused,
                ]}
              />
            );
          })}
        </View>
      </View>

      <View style={styles.bottom}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {captureState === "permission-denied" ? (
          <View style={styles.permissionCard}>
            <Text style={styles.permissionTitle}>
              {permissionIssue === "notifications"
                ? "Recording notification is off"
                : "Microphone access is off"}
            </Text>
            <Text style={styles.permissionBody}>
              {permissionIssue === "notifications"
                ? "Android requires a visible notification while a meeting records in the background. Enable notifications in system settings to continue."
                : "Agent Native only records after you tap Start. Enable microphone access in system settings to continue."}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void Linking.openSettings()}
              style={styles.secondaryButton}
            >
              <IconSettings color="#f4f4f5" size={18} />
              <Text style={styles.secondaryButtonText}>Open settings</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.help}>{statusCopy}</Text>
            <View style={styles.controls}>
              {captureState === "recording" ? (
                <Pressable
                  accessibilityLabel="Pause recording"
                  accessibilityRole="button"
                  onPress={pause}
                  style={styles.secondaryControl}
                >
                  <IconPlayerPauseFilled color="#f4f4f5" size={24} />
                </Pressable>
              ) : captureState === "paused" ? (
                <Pressable
                  accessibilityLabel="Resume recording"
                  accessibilityRole="button"
                  onPress={resume}
                  style={styles.secondaryControl}
                >
                  <IconPlayerPlayFilled color="#f4f4f5" size={24} />
                </Pressable>
              ) : null}

              {isActive ? (
                <Pressable
                  accessibilityLabel="Finish recording"
                  accessibilityRole="button"
                  onPress={() => void stop()}
                  style={styles.stopButton}
                >
                  <IconPlayerStopFilled color="#ffffff" size={28} />
                  <Text style={styles.stopButtonText}>Finish</Text>
                </Pressable>
              ) : pendingMedia ? (
                <Pressable
                  accessibilityLabel="Retry saving recording"
                  accessibilityRole="button"
                  onPress={() => void deliver(pendingMedia)}
                  style={styles.startButton}
                >
                  <IconPlayerPlayFilled color="#0b0b0c" size={22} />
                  <Text style={styles.startButtonText}>Retry save</Text>
                </Pressable>
              ) : captureState === "error" ? (
                <Pressable
                  accessibilityLabel="Prepare recorder again"
                  accessibilityRole="button"
                  onPress={() => void prepareRecorder()}
                  style={styles.startButton}
                >
                  <IconPlayerPlayFilled color="#0b0b0c" size={22} />
                  <Text style={styles.startButtonText}>Try again</Text>
                </Pressable>
              ) : (
                <Pressable
                  accessibilityLabel="Start recording"
                  accessibilityRole="button"
                  disabled={
                    captureState === "checking-permission" ||
                    captureState === "saving"
                  }
                  onPress={start}
                  style={styles.startButton}
                >
                  <IconMicrophone color="#0b0b0c" size={24} />
                  <Text style={styles.startButtonText}>
                    {captureState === "checking-permission"
                      ? "Getting ready…"
                      : "Start"}
                  </Text>
                </Pressable>
              )}
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0b0b0c",
    paddingHorizontal: 20,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 14,
  },
  headerButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  headerSpacer: { width: 44 },
  eyebrow: {
    color: "#71717a",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  hero: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  orb: {
    alignItems: "center",
    backgroundColor: "#18181b",
    borderColor: "#27272a",
    borderRadius: 48,
    borderWidth: 1,
    height: 96,
    justifyContent: "center",
    marginBottom: 28,
    width: 96,
  },
  orbActive: {
    backgroundColor: "#c7f36b",
    borderColor: "#d9ff8a",
  },
  timer: {
    color: "#fafafa",
    fontSize: 56,
    fontVariant: ["tabular-nums"],
    fontWeight: "300",
    letterSpacing: -2,
  },
  stateLabel: {
    color: "#a1a1aa",
    fontSize: 15,
    marginTop: 8,
  },
  waveform: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    height: 72,
    justifyContent: "center",
    marginTop: 30,
  },
  waveBar: {
    backgroundColor: "#c7f36b",
    borderRadius: 2,
    width: 3,
  },
  waveBarPaused: { backgroundColor: "#52525b" },
  bottom: { paddingBottom: 26 },
  help: {
    color: "#71717a",
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 20,
    textAlign: "center",
  },
  error: {
    backgroundColor: "#2b1115",
    borderColor: "#5f2029",
    borderRadius: 12,
    borderWidth: 1,
    color: "#fda4af",
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 16,
    padding: 12,
  },
  controls: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "center",
  },
  startButton: {
    alignItems: "center",
    backgroundColor: "#c7f36b",
    borderRadius: 28,
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    minHeight: 56,
    paddingHorizontal: 28,
  },
  startButtonText: { color: "#0b0b0c", fontSize: 16, fontWeight: "700" },
  stopButton: {
    alignItems: "center",
    backgroundColor: "#dc2626",
    borderRadius: 28,
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    minHeight: 56,
    paddingHorizontal: 26,
  },
  stopButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "700" },
  secondaryControl: {
    alignItems: "center",
    backgroundColor: "#18181b",
    borderColor: "#27272a",
    borderRadius: 28,
    borderWidth: 1,
    height: 56,
    justifyContent: "center",
    width: 56,
  },
  permissionCard: {
    backgroundColor: "#18181b",
    borderColor: "#27272a",
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
  },
  permissionTitle: { color: "#fafafa", fontSize: 17, fontWeight: "700" },
  permissionBody: {
    color: "#a1a1aa",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
    marginTop: 6,
  },
  secondaryButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#27272a",
    borderRadius: 10,
    flexDirection: "row",
    gap: 8,
    minHeight: 42,
    paddingHorizontal: 14,
  },
  secondaryButtonText: { color: "#f4f4f5", fontSize: 14, fontWeight: "600" },
});
