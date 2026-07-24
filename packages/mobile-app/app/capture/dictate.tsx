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
  Text,
  TextInput,
  View,
} from "react-native";

import AudioCaptureView, {
  type CapturedAudioMedia,
} from "@/components/AudioCaptureView";
import { SafeAreaView } from "@/components/uniwind-interop";
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
  setLastDictatedText,
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
        setLastDictatedText(transcript);
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
      setLastDictatedText(value);
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
      <SafeAreaView
        edges={["top", "bottom"]}
        className="flex-1 bg-background-dark"
      >
        <AudioCaptureView
          kind="dictation"
          onCancel={() => router.back()}
          onCaptured={handleCaptured}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      className="bg-background-dark flex-1"
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 px-5"
      >
        <View className="items-center flex-row justify-between pt-3.5">
          <Pressable
            accessibilityLabel="Close dictation"
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => router.replace("/" as never)}
            className="items-center h-11 justify-center w-11 active:opacity-75"
          >
            <IconChevronLeft color="#f4f4f5" size={24} />
          </Pressable>
          <Text className="text-status-gray text-xs font-bold tracking-[1.2px]">
            VOICE DICTATION
          </Text>
          <View className="items-center h-11 justify-center w-11" />
        </View>

        {phase === "transcribing" ? (
          <View className="items-center flex-1 justify-center">
            <View className="items-center bg-primary rounded-full h-21 w-21 justify-center">
              <ActivityIndicator color="#0b0b0c" size="large" />
            </View>
            <Text className="text-text-bright text-2xl font-bold mt-6">
              Cleaning up your words
            </Text>
            <Text className="text-status-gray text-sm leading-5 mt-2 max-w-xs text-center">
              Your recording is already saved on this phone. You can safely
              leave if the network drops.
            </Text>
          </View>
        ) : (
          <View className="flex-1 pb-3 pt-5.5">
            <View className="items-center flex-row justify-between">
              <View>
                <Text className="text-text-bright text-3xl font-bold">
                  Ready to paste
                </Text>
                <Text className="text-status-gray text-xs mt-0.5">
                  Edit anything you want before copying.
                </Text>
              </View>
              {text ? (
                <View className="items-center bg-primary rounded-xl flex-row gap-1 px-2.25 py-1.5">
                  <IconCheck color="#0b0b0c" size={14} strokeWidth={2.5} />
                  <Text className="text-background-dark text-xs font-bold">
                    Copied
                  </Text>
                </View>
              ) : null}
            </View>

            {message ? (
              <Text
                className={`text-primary text-xs mt-4 ${
                  !text || needsHistoryRetry
                    ? "bg-error-bg rounded-xl text-error-text leading-5 p-2.5"
                    : ""
                }`}
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
                className="bg-card-dark border border-border-dark rounded-2xl text-text-light flex-1 text-lg leading-6 mt-3.5 p-4"
                textAlignVertical="top"
                value={text}
              />
            ) : (
              <View className="items-center bg-card-dark border border-border-dark rounded-2xl mt-4.5 p-5.5">
                <Text className="text-text-bright text-lg font-bold">
                  Your audio is safe
                </Text>
                <Text className="text-status-gray text-xs leading-5 mt-1.5 text-center">
                  Retry transcription now, or return Home and upload it later.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={!job || !media}
                  onPress={() => {
                    if (job && media) void transcribe(job, media);
                  }}
                  className="items-center bg-primary rounded-3xl flex-row gap-2 mt-4.5 h-11 px-4.5 active:opacity-75"
                >
                  <IconRefresh color="#0b0b0c" size={19} />
                  <Text className="text-background-dark text-sm font-bold">
                    Retry
                  </Text>
                </Pressable>
              </View>
            )}

            {text ? (
              <View className="flex-row gap-2.5 mt-3">
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    void Share.share({ message: text, title: "Dictation" })
                  }
                  className="items-center bg-gray-charcoal rounded-xl flex-row gap-2 justify-center h-13 px-4.5 active:opacity-75"
                >
                  <IconShare color="#f4f4f5" size={20} />
                  <Text className="text-text-light text-base font-semibold">
                    Share
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={saving}
                  onPress={() => void saveEdit()}
                  className="items-center bg-primary rounded-xl flex-1 flex-row gap-2 justify-center h-13 active:opacity-75"
                >
                  {saving ? (
                    <ActivityIndicator color="#0b0b0c" size="small" />
                  ) : needsHistoryRetry ? (
                    <IconRefresh color="#0b0b0c" size={20} />
                  ) : (
                    <IconClipboard color="#0b0b0c" size={20} />
                  )}
                  <Text className="text-background-dark text-base font-bold">
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
