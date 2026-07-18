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
  StyleSheet,
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
  accent: string;
  icon: ReactNode;
  onPress: () => void;
}

function QuickAction({
  title,
  description,
  accent,
  icon,
  onPress,
}: QuickActionProps) {
  return (
    <Pressable
      accessibilityHint={description}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.quickAction,
        pressed && styles.quickActionPressed,
      ]}
    >
      <View style={[styles.quickActionIcon, { backgroundColor: accent }]}>
        {icon}
      </View>
      <Text style={styles.quickActionTitle}>{title}</Text>
      <Text style={styles.quickActionDescription}>{description}</Text>
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
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            onRefresh={() => void refresh()}
            refreshing={refreshing}
            tintColor="#f4f4f5"
          />
        }
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>AGENT NATIVE</Text>
            <Text style={styles.title}>What’s happening?</Text>
          </View>
          <View style={styles.statusPill}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: connected ? "#c7f36b" : "#f59e0b" },
              ]}
            />
            <Text style={styles.statusText}>
              {connected ? "Connected" : "Connect"}
            </Text>
          </View>
        </View>

        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <IconSparkles color="#0b0b0c" size={24} strokeWidth={1.8} />
          </View>
          <Text style={styles.heroTitle}>
            Your phone is now a capture tool.
          </Text>
          <Text style={styles.heroDescription}>
            Dictate anywhere, record a meeting in the background, share a video,
            or steer an agent running on your computer.
          </Text>
        </View>

        <UpcomingMeetingCard onPrepare={prepareUpcomingMeeting} />

        <Text style={styles.sectionLabel}>QUICK CAPTURE</Text>
        <View style={styles.quickGrid}>
          <QuickAction
            accent="#c7f36b"
            description="Speak, review, copy"
            icon={<IconMicrophone color="#0b0b0c" size={24} />}
            onPress={() => router.push("/capture/dictate" as never)}
            title="Dictate"
          />
          <QuickAction
            accent="#8dd7ff"
            description="Background audio"
            icon={<IconUsers color="#0b0b0c" size={24} />}
            onPress={() => router.push("/capture/audio" as never)}
            title="Meeting"
          />
          <QuickAction
            accent="#f4a7ff"
            description="Record or import"
            icon={<IconCamera color="#0b0b0c" size={24} />}
            onPress={() => router.push("/capture/video" as never)}
            title="Video"
          />
          <QuickAction
            accent="#ffd38d"
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
            style={styles.connectCard}
          >
            <View style={styles.connectIcon}>
              <IconCloudUpload color="#c7f36b" size={22} strokeWidth={1.8} />
            </View>
            <View style={styles.connectCopy}>
              <Text style={styles.connectTitle}>Connect Clips to sync</Text>
              <Text style={styles.connectDescription}>
                Sign in once. Every capture stays safely on this phone until it
                uploads.
              </Text>
            </View>
            <IconArrowRight color="#a1a1aa" size={20} />
          </Pressable>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>
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
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Nothing captured yet</Text>
            <Text style={styles.emptyDescription}>
              Your recordings will appear here immediately—even before they
              finish uploading.
            </Text>
          </View>
        ) : (
          <View style={styles.jobList}>
            {visibleJobs.map((job) => {
              const canRetry =
                job.state === "captured" ||
                job.state === "failed" ||
                job.state === "exhausted";
              return (
                <View key={job.id} style={styles.jobRow}>
                  <View
                    style={[
                      styles.jobIcon,
                      job.state === "completed" && styles.jobIconCompleted,
                    ]}
                  >
                    {jobIcon(job)}
                  </View>
                  <View style={styles.jobCopy}>
                    <Text numberOfLines={1} style={styles.jobTitle}>
                      {job.title}
                    </Text>
                    <Text
                      numberOfLines={2}
                      style={[
                        styles.jobStatus,
                        (job.state === "failed" || job.state === "exhausted") &&
                          styles.jobStatusError,
                      ]}
                    >
                      {jobStatus(job)}
                    </Text>
                  </View>
                  {canRetry && connected ? (
                    <Pressable
                      accessibilityLabel={`Retry ${job.title}`}
                      accessibilityRole="button"
                      disabled={syncingJobId === job.id}
                      onPress={() => void retry(job)}
                      style={styles.retryButton}
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
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: "#0b0b0c", flex: 1 },
  content: { padding: 20, paddingBottom: 34 },
  header: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  eyebrow: {
    color: "#71717a",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.3,
  },
  title: {
    color: "#fafafa",
    fontSize: 31,
    fontWeight: "700",
    letterSpacing: -1,
    marginTop: 4,
  },
  statusPill: {
    alignItems: "center",
    backgroundColor: "#18181b",
    borderColor: "#27272a",
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    marginBottom: 3,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  statusDot: { borderRadius: 4, height: 7, width: 7 },
  statusText: { color: "#d4d4d8", fontSize: 11, fontWeight: "600" },
  heroCard: {
    backgroundColor: "#18181b",
    borderColor: "#27272a",
    borderRadius: 22,
    borderWidth: 1,
    marginTop: 22,
    padding: 20,
  },
  heroIcon: {
    alignItems: "center",
    backgroundColor: "#c7f36b",
    borderRadius: 14,
    height: 44,
    justifyContent: "center",
    marginBottom: 20,
    width: 44,
  },
  heroTitle: {
    color: "#fafafa",
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.4,
  },
  heroDescription: {
    color: "#a1a1aa",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  sectionLabel: {
    color: "#71717a",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.15,
    marginTop: 25,
  },
  quickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 11,
  },
  quickAction: {
    backgroundColor: "#18181b",
    borderColor: "#27272a",
    borderRadius: 18,
    borderWidth: 1,
    minHeight: 150,
    padding: 15,
    width: "48.5%",
  },
  quickActionPressed: { opacity: 0.72 },
  quickActionIcon: {
    alignItems: "center",
    borderRadius: 12,
    height: 42,
    justifyContent: "center",
    marginBottom: 18,
    width: 42,
  },
  quickActionTitle: { color: "#fafafa", fontSize: 17, fontWeight: "700" },
  quickActionDescription: { color: "#71717a", fontSize: 12, marginTop: 4 },
  connectCard: {
    alignItems: "center",
    backgroundColor: "#171b12",
    borderColor: "#344222",
    borderRadius: 17,
    borderWidth: 1,
    flexDirection: "row",
    marginTop: 20,
    padding: 14,
  },
  connectIcon: {
    alignItems: "center",
    backgroundColor: "#232b19",
    borderRadius: 12,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  connectCopy: { flex: 1, marginHorizontal: 12 },
  connectTitle: { color: "#f4f4f5", fontSize: 14, fontWeight: "700" },
  connectDescription: {
    color: "#a1a1aa",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  sectionHeader: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  emptyCard: {
    alignItems: "center",
    borderColor: "#27272a",
    borderRadius: 17,
    borderStyle: "dashed",
    borderWidth: 1,
    marginTop: 11,
    padding: 24,
  },
  emptyTitle: { color: "#d4d4d8", fontSize: 14, fontWeight: "600" },
  emptyDescription: {
    color: "#71717a",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 5,
    textAlign: "center",
  },
  jobList: {
    borderColor: "#27272a",
    borderRadius: 17,
    borderWidth: 1,
    marginTop: 11,
    overflow: "hidden",
  },
  jobRow: {
    alignItems: "center",
    backgroundColor: "#18181b",
    borderBottomColor: "#27272a",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 72,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  jobIcon: {
    alignItems: "center",
    backgroundColor: "#27272a",
    borderRadius: 10,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  jobIconCompleted: { backgroundColor: "#c7f36b" },
  jobCopy: { flex: 1, marginHorizontal: 11 },
  jobTitle: { color: "#f4f4f5", fontSize: 14, fontWeight: "600" },
  jobStatus: { color: "#71717a", fontSize: 12, lineHeight: 17, marginTop: 3 },
  jobStatusError: { color: "#fb7185" },
  retryButton: {
    alignItems: "center",
    backgroundColor: "#24281f",
    borderRadius: 17,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
});
