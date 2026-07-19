import {
  IconCheck,
  IconChevronLeft,
  IconClipboard,
  IconRefresh,
  IconShare,
} from "@tabler/icons-react-native";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import AudioCaptureView, {
  type CapturedAudioMedia,
} from "@/components/AudioCaptureView";
import {
  bindCaptureJobOwner,
  enqueueCaptureJob,
  releaseCaptureJobLocalFile,
  type CaptureJob,
} from "@/lib/capture-queue";
import { syncCaptureJob } from "@/lib/clips-api";
import { getClipsSession } from "@/lib/clips-session";
import {
  getPendingKeyboardDictationRequestId,
  publishKeyboardDictation,
} from "@/lib/ios-companion";
import { setMobileCaptureStateBestEffort } from "@/lib/mobile-state-api";
import { persistCaptureFile } from "@/lib/persist-capture";
import {
  saveMobileDictation,
  transcribeMobileAudio,
  updateMobileDictation,
} from "@/lib/voice-api";

type Phase = "capture" | "transcribing" | "review";

export default function DictationCaptureScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    requestId?: string | string[];
    source?: string | string[];
  }>();
  const routeKeyboardRequestId =
    params.source === "keyboard" &&
    typeof params.requestId === "string" &&
    /^[a-z0-9-]{20,80}$/i.test(params.requestId)
      ? params.requestId
      : undefined;
  const [keyboardRequestId] = useState(
    () => routeKeyboardRequestId ?? getPendingKeyboardDictationRequestId(),
  );
  const [phase, setPhase] = useState<Phase>("capture");
  const [job, setJob] = useState<CaptureJob | null>(null);
  const [media, setMedia] = useState<CapturedAudioMedia | null>(null);
  const [text, setText] = useState("");
  const [dictationId, setDictationId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(true);
  const transcriptionAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      transcriptionAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (phase === "capture") return;
    void setMobileCaptureStateBestEffort({
      view: "dictate",
      phase: phase === "transcribing" ? "processing" : "review",
      captureId: job?.id,
    });
  }, [job?.id, phase]);

  const transcribe = useCallback(
    async (nextJob: CaptureJob, captured: CapturedAudioMedia) => {
      transcriptionAbortRef.current?.abort();
      const controller = new AbortController();
      transcriptionAbortRef.current = controller;
      setPhase("transcribing");
      setMessage(null);
      try {
        const session = await getClipsSession();
        if (!session) {
          throw new Error("Connect to Clips before using dictation.");
        }
        const boundJob = await bindCaptureJobOwner(
          nextJob.id,
          session.ownerKey,
        );
        if (mountedRef.current) setJob(boundJob);
        const transcript = await transcribeMobileAudio(
          boundJob.localUri,
          captured.mimeType,
          controller.signal,
          boundJob.ownerKey,
        );
        if (!mountedRef.current || controller.signal.aborted) return;
        setText(transcript);
        publishKeyboardDictation(transcript, keyboardRequestId);
        await Clipboard.setStringAsync(transcript);
        await releaseCaptureJobLocalFile(boundJob.id).catch(() => null);
        if (!mountedRef.current || controller.signal.aborted) return;
        let id: string;
        try {
          id = await saveMobileDictation({
            id: nextJob.id,
            text: transcript,
            durationMs: boundJob.durationMs,
            startedAt: boundJob.capturedAt,
            ownerKey: boundJob.ownerKey,
          });
        } catch (cause) {
          if (
            controller.signal.aborted ||
            (cause instanceof Error && cause.name === "AbortError")
          ) {
            return;
          }
          if (!mountedRef.current) return;
          setMessage(
            "Copied, but Clips history could not be saved. Tap Copy & Retry.",
          );
          setPhase("review");
          return;
        }
        if (!mountedRef.current || controller.signal.aborted) return;
        setDictationId(id);
        setMessage("Copied to your clipboard");
        setPhase("review");
      } catch (cause) {
        if (
          controller.signal.aborted ||
          (cause instanceof Error && cause.name === "AbortError")
        ) {
          return;
        }
        if (!mountedRef.current) return;
        setMessage(
          cause instanceof Error
            ? cause.message
            : "Could not transcribe this recording.",
        );
        setPhase("review");
      } finally {
        if (transcriptionAbortRef.current === controller) {
          transcriptionAbortRef.current = null;
        }
      }
    },
    [keyboardRequestId],
  );

  const handleCaptured = useCallback(
    async (captured: CapturedAudioMedia) => {
      const localUri = await persistCaptureFile(
        captured.uri,
        captured.mimeType,
        captured.captureId,
      );
      const session = await getClipsSession();
      const nextJob = await enqueueCaptureJob({
        id: captured.captureId,
        localUri,
        ownerKey: session?.ownerKey,
        kind: "dictation",
        durationMs: captured.durationMs,
        mimeType: captured.mimeType,
        title: captured.title,
        capturedAt: captured.startedAt,
        retainLocalFile: true,
      });
      setJob(nextJob);
      setMedia(captured);
      void syncCaptureJob(nextJob.id).catch(() => null);
      await transcribe(nextJob, captured);
    },
    [transcribe],
  );

  const saveEdit = useCallback(async () => {
    const value = text.trim();
    if (!value) return;
    setSaving(true);
    try {
      await Clipboard.setStringAsync(value);
      publishKeyboardDictation(value, keyboardRequestId);
      if (!mountedRef.current) return;
      if (dictationId) {
        try {
          await updateMobileDictation(dictationId, value, job?.ownerKey);
          if (mountedRef.current) setMessage("Copied to your clipboard");
        } catch {
          if (mountedRef.current) {
            setMessage("Copied; Clips history will update when you retry.");
          }
        }
      } else if (job) {
        try {
          const id = await saveMobileDictation({
            id: job.id,
            text: value,
            durationMs: job.durationMs,
            startedAt: job.capturedAt,
            ownerKey: job.ownerKey,
          });
          if (!mountedRef.current) return;
          setDictationId(id);
          setMessage("Copied and saved to Clips history");
        } catch {
          if (mountedRef.current) {
            setMessage(
              "Copied, but Clips history could not be saved. Tap Copy & Retry.",
            );
          }
        }
      } else {
        setMessage("Copied, but this dictation cannot be saved to history.");
      }
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [dictationId, job, keyboardRequestId, text]);

  const needsHistoryRetry = Boolean(text && !dictationId);

  if (phase === "capture") {
    return (
      <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1 }}>
        <AudioCaptureView
          kind="dictation"
          onCancel={() => router.back()}
          onCaptured={handleCaptured}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.container}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Close dictation"
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => router.replace("/" as never)}
            style={styles.headerButton}
          >
            <IconChevronLeft color="#f4f4f5" size={24} />
          </Pressable>
          <Text style={styles.eyebrow}>VOICE DICTATION</Text>
          <View style={styles.headerButton} />
        </View>

        {phase === "transcribing" ? (
          <View style={styles.processing}>
            <View style={styles.processingOrb}>
              <ActivityIndicator color="#0b0b0c" size="large" />
            </View>
            <Text style={styles.processingTitle}>Cleaning up your words</Text>
            <Text style={styles.processingDescription}>
              Your recording is already saved on this phone. You can safely
              leave if the network drops.
            </Text>
          </View>
        ) : (
          <View style={styles.review}>
            <View style={styles.reviewHeader}>
              <View>
                <Text style={styles.reviewTitle}>Ready to paste</Text>
                <Text style={styles.reviewDescription}>
                  Edit anything you want before copying.
                </Text>
              </View>
              {text ? (
                <View style={styles.copiedBadge}>
                  <IconCheck color="#0b0b0c" size={14} strokeWidth={2.5} />
                  <Text style={styles.copiedText}>Copied</Text>
                </View>
              ) : null}
            </View>

            {message ? (
              <Text
                style={[
                  styles.message,
                  (!text || needsHistoryRetry) && styles.messageError,
                ]}
              >
                {message}
              </Text>
            ) : null}

            {text ? (
              <TextInput
                accessibilityLabel="Dictation transcript"
                multiline
                onChangeText={setText}
                placeholder="Your transcript"
                placeholderTextColor="#52525b"
                selectionColor="#c7f36b"
                style={styles.editor}
                textAlignVertical="top"
                value={text}
              />
            ) : (
              <View style={styles.recoveryCard}>
                <Text style={styles.recoveryTitle}>Your audio is safe</Text>
                <Text style={styles.recoveryDescription}>
                  Retry transcription now, or return Home and upload it later.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={!job || !media}
                  onPress={() => {
                    if (job && media) void transcribe(job, media);
                  }}
                  style={styles.retryButton}
                >
                  <IconRefresh color="#0b0b0c" size={19} />
                  <Text style={styles.retryText}>Retry</Text>
                </Pressable>
              </View>
            )}

            {text ? (
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    void Share.share({ message: text, title: "Dictation" })
                  }
                  style={styles.shareButton}
                >
                  <IconShare color="#f4f4f5" size={20} />
                  <Text style={styles.shareText}>Share</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={saving}
                  onPress={() => void saveEdit()}
                  style={styles.copyButton}
                >
                  {saving ? (
                    <ActivityIndicator color="#0b0b0c" size="small" />
                  ) : needsHistoryRetry ? (
                    <IconRefresh color="#0b0b0c" size={20} />
                  ) : (
                    <IconClipboard color="#0b0b0c" size={20} />
                  )}
                  <Text style={styles.copyText}>
                    {needsHistoryRetry ? "Copy & Retry" : "Copy"}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: "#0b0b0c", flex: 1 },
  container: { flex: 1, paddingHorizontal: 20 },
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
  eyebrow: {
    color: "#71717a",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  processing: { alignItems: "center", flex: 1, justifyContent: "center" },
  processingOrb: {
    alignItems: "center",
    backgroundColor: "#c7f36b",
    borderRadius: 42,
    height: 84,
    justifyContent: "center",
    width: 84,
  },
  processingTitle: {
    color: "#fafafa",
    fontSize: 22,
    fontWeight: "700",
    marginTop: 24,
  },
  processingDescription: {
    color: "#71717a",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
    maxWidth: 310,
    textAlign: "center",
  },
  review: { flex: 1, paddingBottom: 12, paddingTop: 22 },
  reviewHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  reviewTitle: { color: "#fafafa", fontSize: 25, fontWeight: "700" },
  reviewDescription: { color: "#71717a", fontSize: 13, marginTop: 3 },
  copiedBadge: {
    alignItems: "center",
    backgroundColor: "#c7f36b",
    borderRadius: 14,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  copiedText: { color: "#0b0b0c", fontSize: 11, fontWeight: "700" },
  message: { color: "#a3e635", fontSize: 12, marginTop: 16 },
  messageError: {
    backgroundColor: "#2b1115",
    borderRadius: 10,
    color: "#fda4af",
    lineHeight: 18,
    padding: 10,
  },
  editor: {
    backgroundColor: "#18181b",
    borderColor: "#27272a",
    borderRadius: 18,
    borderWidth: 1,
    color: "#f4f4f5",
    flex: 1,
    fontSize: 17,
    lineHeight: 26,
    marginTop: 14,
    padding: 16,
  },
  recoveryCard: {
    alignItems: "center",
    backgroundColor: "#18181b",
    borderColor: "#27272a",
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 18,
    padding: 22,
  },
  recoveryTitle: { color: "#fafafa", fontSize: 17, fontWeight: "700" },
  recoveryDescription: {
    color: "#71717a",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
    textAlign: "center",
  },
  retryButton: {
    alignItems: "center",
    backgroundColor: "#c7f36b",
    borderRadius: 22,
    flexDirection: "row",
    gap: 8,
    marginTop: 18,
    minHeight: 44,
    paddingHorizontal: 18,
  },
  retryText: { color: "#0b0b0c", fontSize: 14, fontWeight: "700" },
  actions: { flexDirection: "row", gap: 10, marginTop: 12 },
  shareButton: {
    alignItems: "center",
    backgroundColor: "#27272a",
    borderRadius: 14,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 18,
  },
  shareText: { color: "#f4f4f5", fontSize: 15, fontWeight: "600" },
  copyButton: {
    alignItems: "center",
    backgroundColor: "#c7f36b",
    borderRadius: 14,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 52,
  },
  copyText: { color: "#0b0b0c", fontSize: 15, fontWeight: "700" },
});
