import {
  IconArrowRight,
  IconCamera,
  IconCheck,
  IconCloudUpload,
  IconMicrophone,
  IconRefresh,
  IconSparkles,
  IconTerminal2,
  IconUsers,
} from "@tabler/icons-react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import UpcomingMeetingCard from "@/components/UpcomingMeetingCard";
import { type CaptureJob, listCaptureJobs } from "@/lib/capture-queue";
import {
  hasClipsSessionToken,
  syncCaptureJob,
  syncPendingCaptureJobs,
} from "@/lib/clips-api";
import { setMobileCaptureStateBestEffort } from "@/lib/mobile-state-api";

interface QuickActionProps {
  title: string;
  description: string;
  accentClass: string;
  icon: ReactNode;
  onPress: () => void;
}

function QuickAction({
  title,
  description,
  accentClass,
  icon,
  onPress,
}: QuickActionProps) {
  return (
    <Pressable
      accessibilityHint={description}
      accessibilityRole="button"
      onPress={onPress}
      className="bg-card-dark border border-border-dark rounded-2xl min-h-37.5 p-4 w-[48%] sm:w-[23.5%] active:opacity-72"
    >
      <View
        className={`items-center justify-center rounded-xl h-10 w-10 mb-4 ${accentClass}`}
      >
        {icon}
      </View>
      <Text className="text-foreground text-lg font-bold">{title}</Text>
      <Text className="text-status-gray text-xs mt-1">{description}</Text>
    </Pressable>
  );
}

function jobStatus(job: CaptureJob): string {
  if (job.state === "captured") return "Saved on this phone";
  if (job.state === "uploading") {
    const total = job.resume.fileSizeBytes ?? 0;
    const uploaded = job.resume.uploadedBytes;
    if (total > 0) return `${Math.round((uploaded / total) * 100)}% uploaded`;
    return "Uploading";
  }
  if (job.state === "processing") return "Processing in Clips";
  if (job.state === "completed") return "Ready in Clips";
  if (job.state === "exhausted") {
    return job.resume.lastError
      ? `Automatic retries stopped · ${job.resume.lastError}`
      : "Automatic retries stopped";
  }
  return job.resume.lastError || "Needs attention";
}

function jobIcon(job: CaptureJob) {
  if (job.state === "completed") {
    return <IconCheck color="#0b0b0c" size={17} strokeWidth={2.4} />;
  }
  if (job.kind === "video") {
    return <IconCamera color="#f4f4f5" size={17} strokeWidth={1.8} />;
  }
  return <IconMicrophone color="#f4f4f5" size={17} strokeWidth={1.8} />;
}

export default function HomeScreen() {
  const router = useRouter();
  const [jobs, setJobs] = useState<CaptureJob[]>([]);
  const [connected, setConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [syncingJobId, setSyncingJobId] = useState<string | null>(null);

  const load = useCallback(async (sync = false) => {
    const hasToken = await hasClipsSessionToken();
    setConnected(hasToken);
    if (sync && hasToken) {
      await syncPendingCaptureJobs().catch(() => null);
    }
    const nextJobs = await listCaptureJobs().catch(() => []);
    setJobs(nextJobs.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void setMobileCaptureStateBestEffort({ view: "home", phase: "idle" });
      void load(true);
    }, [load]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  const retry = useCallback(
    async (job: CaptureJob) => {
      setSyncingJobId(job.id);
      await syncCaptureJob(job.id, { force: true }).catch(() => null);
      await load();
      setSyncingJobId(null);
    },
    [load],
  );

  const pendingCount = useMemo(
    () => jobs.filter((job) => job.state !== "completed").length,
    [jobs],
  );
  const visibleJobs = useMemo(() => {
    const unresolved = jobs.filter((job) => job.state !== "completed");
    const recentCompleted = jobs
      .filter((job) => job.state === "completed")
      .slice(0, 6);
    return [...unresolved, ...recentCompleted].sort((a, b) =>
      b.capturedAt.localeCompare(a.capturedAt),
    );
  }, [jobs]);

  const prepareUpcomingMeeting = useCallback(() => {
    void setMobileCaptureStateBestEffort({
      view: "meeting",
      phase: "ready",
    });
  }, []);

  return (
    <View className="bg-background-dark flex-1">
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScrollView
          contentContainerClassName="p-5 pb-8.5"
          refreshControl={
            <RefreshControl
              onRefresh={() => void refresh()}
              refreshing={refreshing}
              tintColor="#f4f4f5"
            />
          }
        >
          <View className="items-end flex-row justify-between">
            <View>
              <Text className="text-status-gray text-xs font-bold tracking-widest">
                AGENT NATIVE
              </Text>
              <Text
                style={{ letterSpacing: -1 }}
                className="text-foreground text-3xl font-bold mt-1"
              >
                What’s happening?
              </Text>
            </View>
            <View className="items-center bg-card-dark border border-border-dark rounded-full flex-row gap-1.5 mb-1 px-2.5 py-1.5">
              <View
                className={`rounded-full h-1.5 w-1.5 ${connected ? "bg-primary" : "bg-[#f59e0b]"}`}
              />
              <Text className="text-text-light text-xs font-semibold">
                {connected ? "Connected" : "Connect"}
              </Text>
            </View>
          </View>

          <View className="bg-card-dark border border-border-dark rounded-3xl mt-5.5 p-5">
            <View className="items-center justify-center bg-primary rounded-xl h-11 w-11 mb-5">
              <IconSparkles color="#0b0b0c" size={24} strokeWidth={1.8} />
            </View>
            <Text className="text-foreground text-2xl font-bold tracking-normal">
              Your phone is now a capture tool.
            </Text>
            <Text className="text-text-muted text-sm leading-5 mt-2">
              Dictate anywhere, record a meeting in the background, share a
              video, or steer an agent running on your computer.
            </Text>
          </View>

          <UpcomingMeetingCard onPrepare={prepareUpcomingMeeting} />

          <Text className="text-status-gray text-xs font-bold tracking-wider mt-6">
            QUICK CAPTURE
          </Text>
          <View className="flex-row flex-wrap justify-between gap-y-2.5 mt-3">
            <QuickAction
              accentClass="bg-accent-green"
              description="Speak, review, copy"
              icon={<IconMicrophone color="#0b0b0c" size={24} />}
              onPress={() => router.push("/capture/dictate" as never)}
              title="Dictate"
            />
            <QuickAction
              accentClass="bg-accent-blue"
              description="Background audio"
              icon={<IconUsers color="#0b0b0c" size={24} />}
              onPress={() => router.push("/capture/audio" as never)}
              title="Meeting"
            />
            <QuickAction
              accentClass="bg-accent-pink"
              description="Record or import"
              icon={<IconCamera color="#0b0b0c" size={24} />}
              onPress={() => router.push("/capture/video" as never)}
              title="Video"
            />
            <QuickAction
              accentClass="bg-accent-orange"
              description="Run on your Mac"
              icon={<IconTerminal2 color="#0b0b0c" size={24} />}
              onPress={() => router.push("/sessions" as never)}
              title="Agent"
            />
          </View>

          {!connected ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/clips" as never)}
              className="items-center bg-accent-green-dark border border-accent-green-border rounded-2xl flex-row mt-5 p-3.5"
            >
              <View className="items-center justify-center bg-accent-green-medium rounded-xl h-11 w-11">
                <IconCloudUpload color="#c7f36b" size={22} strokeWidth={1.8} />
              </View>
              <View className="flex-1 mx-3">
                <Text className="text-text-light text-sm font-bold">
                  Connect Clips to sync
                </Text>
                <Text className="text-text-muted text-xs leading-4 mt-1">
                  Sign in once. Every capture stays safely on this phone until
                  it uploads.
                </Text>
              </View>
              <IconArrowRight color="#a1a1aa" size={20} />
            </Pressable>
          ) : null}

          <View className="items-end flex-row justify-between mt-6">
            <Text className="text-status-gray text-xs font-bold tracking-wider">
              {pendingCount > 0
                ? `${pendingCount} IN PROGRESS`
                : "RECENT CAPTURES"}
            </Text>
            {jobs.length > 0 ? (
              <Pressable
                accessibilityLabel="Sync captures"
                accessibilityRole="button"
                hitSlop={10}
                onPress={() => void refresh()}
              >
                <IconRefresh color="#71717a" size={18} />
              </Pressable>
            ) : null}
          </View>

          {jobs.length === 0 ? (
            <View className="items-center border border-dashed border-border-dark rounded-2xl mt-3 p-6">
              <Text className="text-text-light text-sm font-semibold">
                Nothing captured yet
              </Text>
              <Text className="text-status-gray text-xs leading-5 mt-1 text-center">
                Your recordings will appear here immediately—even before they
                finish uploading.
              </Text>
            </View>
          ) : (
            <View className="gap-2.5 mt-3">
              {visibleJobs.map((job) => {
                const canRetry =
                  job.state === "captured" ||
                  job.state === "failed" ||
                  job.state === "exhausted";
                const inProgress =
                  job.state !== "completed" &&
                  job.state !== "exhausted" &&
                  job.state !== "failed";

                return (
                  <View
                    key={job.id}
                    className={`flex-row items-center p-3.5 rounded-2xl border transition-all ${
                      inProgress
                        ? "border-dashed border-zinc-700/60 bg-zinc-900/30"
                        : "border-border-dark bg-card-dark/60"
                    }`}
                  >
                    <View
                      className={`items-center justify-center rounded-xl h-9 w-9 ${
                        job.state === "completed"
                          ? "bg-primary"
                          : "bg-gray-charcoal/60"
                      }`}
                    >
                      {jobIcon(job)}
                    </View>
                    <View className="flex-1 mx-3">
                      <Text
                        numberOfLines={1}
                        className="text-text-light text-sm font-semibold"
                      >
                        {job.title}
                      </Text>
                      <View className="flex-row items-center gap-1.5 mt-1">
                        {inProgress && (
                          <View className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                        )}
                        <Text
                          numberOfLines={1}
                          className={`text-xs ${
                            job.state === "failed" || job.state === "exhausted"
                              ? "text-status-error"
                              : "text-status-gray"
                          }`}
                        >
                          {jobStatus(job)}
                        </Text>
                      </View>
                    </View>
                    {canRetry && connected ? (
                      <Pressable
                        accessibilityLabel={`Retry ${job.title}`}
                        accessibilityRole="button"
                        disabled={syncingJobId === job.id}
                        onPress={() => void retry(job)}
                        className="items-center justify-center bg-accent-green-medium-dark rounded-full h-8 w-8 active:opacity-75"
                      >
                        {syncingJobId === job.id ? (
                          <ActivityIndicator color="#c7f36b" size="small" />
                        ) : (
                          <IconCloudUpload color="#c7f36b" size={18} />
                        )}
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
