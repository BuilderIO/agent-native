import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  appendRemoteFollowUp,
  createRemoteRun,
  decidePendingCommand,
  getPendingCommand,
  getRemoteRunDetail,
  getRemoteRelayBaseUrl,
  isRemoteRunActive,
  listPairedHosts,
  listRemoteRuns,
  readRemoteTranscript,
  stopRemoteRun,
  type PendingCommand,
  type RemoteHost,
  type RemoteHostStatus,
  type RemoteRun,
  type RemoteRunStatus,
  type RemoteTranscriptEvent,
  type RemoteTranscriptEventType,
} from "@/lib/remote-sessions-api";

const POLL_INTERVAL_MS = 4000;
const GOAL_ID = "task";

export default function SessionsScreen() {
  const [hosts, setHosts] = useState<RemoteHost[]>([]);
  const [runs, setRuns] = useState<RemoteRun[]>([]);
  const [events, setEvents] = useState<RemoteTranscriptEvent[]>([]);
  const [selectedHostId, setSelectedHostId] = useState<string | undefined>();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [newPrompt, setNewPrompt] = useState("");
  const [followUpPrompt, setFollowUpPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [acting, setActing] = useState<"approve" | "deny" | "stop" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );
  const pendingCommand = useMemo(
    () => getPendingCommand(selectedRun),
    [selectedRun],
  );

  const loadHosts = useCallback(async () => {
    const result = await listPairedHosts();
    if (result.ok) {
      const nextHosts = result.data ?? [];
      setHosts(nextHosts);
      setSelectedHostId((current) => current ?? nextHosts[0]?.id);
    } else {
      setError(result.error ?? "Could not load paired hosts.");
    }
  }, []);

  const loadRuns = useCallback(async () => {
    const result = await listRemoteRuns(GOAL_ID);
    if (result.ok) {
      const nextRuns = result.data ?? [];
      setRuns(nextRuns);
      setSelectedRunId((current) => {
        if (current && nextRuns.some((run) => run.id === current))
          return current;
        return nextRuns[0]?.id ?? null;
      });
      if (nextRuns.length > 0) setError(null);
    } else {
      setError(result.error ?? "Could not load sessions.");
    }
  }, []);

  const loadTranscript = useCallback(async (runId: string, quiet = false) => {
    if (!quiet) setTranscriptLoading(true);
    const result = await readRemoteTranscript(runId);
    if (result.ok) {
      setEvents(result.data ?? []);
      setError(null);
    } else if (!quiet) {
      setEvents([]);
      setError(result.error ?? "Could not load the transcript.");
    }
    if (!quiet) setTranscriptLoading(false);
  }, []);

  const loadRunDetail = useCallback(async (runId: string) => {
    const result = await getRemoteRunDetail(runId);
    if (result.ok && result.data) {
      setRuns((current) =>
        current.map((run) => (run.id === runId ? result.data! : run)),
      );
    }
  }, []);

  const refresh = useCallback(
    async (quiet = false) => {
      if (!quiet) setRefreshing(true);
      await Promise.all([loadHosts(), loadRuns()]);
      if (!quiet) setRefreshing(false);
    },
    [loadHosts, loadRuns],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refresh(true).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (selectedRunId) {
      void loadRunDetail(selectedRunId);
      void loadTranscript(selectedRunId);
    } else {
      setEvents([]);
    }
  }, [loadRunDetail, loadTranscript, selectedRunId]);

  useEffect(() => {
    const interval = setInterval(() => {
      void refresh(true);
      if (selectedRunId) {
        void loadRunDetail(selectedRunId);
        void loadTranscript(selectedRunId, true);
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadRunDetail, loadTranscript, refresh, selectedRunId]);

  const selectedHost = hosts.find((host) => host.id === selectedHostId);

  const handleCreateRun = useCallback(async () => {
    const prompt = newPrompt.trim();
    if (!prompt || creating) return;
    setCreating(true);
    setError(null);
    setNotice(null);
    const result = await createRemoteRun({
      prompt,
      hostId: selectedHostId,
      goalId: GOAL_ID,
      permissionMode: "full-auto",
    });
    if (!result.ok || !result.data?.run) {
      setError(result.error ?? "Could not start the session.");
      setCreating(false);
      return;
    }
    const run = result.data.run;
    setNewPrompt("");
    setRuns((current) => [
      run,
      ...current.filter((item) => item.id !== run.id),
    ]);
    setSelectedRunId(run.id);
    setEvents(result.data.event ? [result.data.event] : []);
    setNotice(result.data.message ?? "Session started.");
    await refresh(true);
    await loadTranscript(run.id, true);
    setCreating(false);
  }, [creating, loadTranscript, newPrompt, refresh, selectedHostId]);

  const handleFollowUp = useCallback(async () => {
    const prompt = followUpPrompt.trim();
    if (!prompt || !selectedRun || sending) return;
    const optimisticEvent: RemoteTranscriptEvent = {
      id: `pending-${Date.now()}`,
      runId: selectedRun.id,
      type: "user",
      title: "Follow-up",
      text: prompt,
      createdAt: new Date().toISOString(),
      metadata: { pending: true, source: "mobile" },
    };
    setFollowUpPrompt("");
    setSending(true);
    setError(null);
    setEvents((current) => [...current, optimisticEvent]);
    const result = await appendRemoteFollowUp({
      runId: selectedRun.id,
      hostId: selectedRun.hostId ?? selectedHostId,
      goalId: selectedRun.goalId ?? GOAL_ID,
      prompt,
      followUpMode: isRemoteRunActive(selectedRun) ? "queued" : "immediate",
    });
    if (!result.ok) {
      setEvents((current) =>
        current.filter((event) => event.id !== optimisticEvent.id),
      );
      setError(result.error ?? "Could not send the follow-up.");
    } else {
      setNotice(result.data?.message ?? "Follow-up queued.");
      await loadTranscript(selectedRun.id, true);
      await refresh(true);
    }
    setSending(false);
  }, [
    followUpPrompt,
    loadTranscript,
    refresh,
    selectedHostId,
    selectedRun,
    sending,
  ]);

  const handleDecision = useCallback(
    async (decision: "approve" | "deny", command: PendingCommand | null) => {
      if (!selectedRun || acting) return;
      setActing(decision);
      setError(null);
      const result = await decidePendingCommand({
        runId: selectedRun.id,
        hostId: selectedRun.hostId ?? selectedHostId,
        commandId: command?.id,
        decision,
      });
      if (!result.ok) {
        setError(result.error ?? `Could not ${decision} the command.`);
      } else {
        setNotice(result.data?.message ?? `Command ${decision}d.`);
        setRuns((current) =>
          current.map((run) =>
            run.id === selectedRun.id
              ? { ...run, needsApproval: false, status: "running" }
              : run,
          ),
        );
        await refresh(true);
        await loadTranscript(selectedRun.id, true);
      }
      setActing(null);
    },
    [acting, loadTranscript, refresh, selectedHostId, selectedRun],
  );

  const handleStop = useCallback(async () => {
    if (!selectedRun || acting) return;
    setActing("stop");
    setError(null);
    const result = await stopRemoteRun(selectedRun.id, selectedRun.hostId);
    if (!result.ok) {
      setError(result.error ?? "Could not stop the session.");
    } else {
      setNotice(result.data?.message ?? "Stop requested.");
      setRuns((current) =>
        current.map((run) =>
          run.id === selectedRun.id ? { ...run, status: "paused" } : run,
        ),
      );
      await refresh(true);
      await loadTranscript(selectedRun.id, true);
    }
    setActing(null);
  }, [acting, loadTranscript, refresh, selectedRun]);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={80}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor="#ffffff"
              onRefresh={() => void refresh(false)}
            />
          }
        >
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <Feather name="terminal" size={20} color="#ffffff" />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.kicker}>Code Agents</Text>
              <Text style={styles.title}>Sessions</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {getRemoteRelayBaseUrl()}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => void refresh(false)}
              accessibilityLabel="Refresh sessions"
            >
              <Feather name="refresh-cw" size={18} color="#ffffff" />
            </TouchableOpacity>
          </View>

          {error && (
            <View style={styles.banner}>
              <Feather name="alert-circle" size={16} color="#FCA5A5" />
              <Text style={styles.bannerText}>{error}</Text>
            </View>
          )}
          {notice && (
            <View style={[styles.banner, styles.noticeBanner]}>
              <Feather name="check-circle" size={16} color="#86EFAC" />
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          )}

          <SectionHeader title="Paired Hosts" action={selectedHost?.name} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.hostRail}
          >
            {hosts.length === 0 && !loading ? (
              <EmptyInline
                icon="monitor"
                text="No paired hosts found. Pair a desktop host, then pull to refresh."
              />
            ) : (
              hosts.map((host) => (
                <HostCard
                  key={host.id}
                  host={host}
                  selected={host.id === selectedHostId}
                  onPress={() => setSelectedHostId(host.id)}
                />
              ))
            )}
          </ScrollView>

          <View style={styles.composerCard}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardTitle}>New Session</Text>
              {creating && <ActivityIndicator color="#ffffff" />}
            </View>
            <TextInput
              style={styles.promptInput}
              value={newPrompt}
              onChangeText={setNewPrompt}
              placeholder="Ask a paired host to implement, inspect, or fix something..."
              placeholderTextColor="#666666"
              multiline
              textAlignVertical="top"
            />
            <TouchableOpacity
              style={[
                styles.primaryButton,
                (!newPrompt.trim() || creating) && styles.disabledButton,
              ]}
              disabled={!newPrompt.trim() || creating}
              onPress={handleCreateRun}
            >
              <Feather name="play" size={16} color="#111111" />
              <Text style={styles.primaryButtonText}>Start Session</Text>
            </TouchableOpacity>
          </View>

          <SectionHeader
            title="Recent Runs"
            action={runs.length ? `${runs.length}` : undefined}
          />
          {loading ? (
            <View style={styles.loadingBlock}>
              <ActivityIndicator color="#ffffff" />
              <Text style={styles.mutedText}>Loading sessions...</Text>
            </View>
          ) : runs.length === 0 ? (
            <EmptyBlock
              icon="inbox"
              title="No sessions yet"
              text="Start a new session from this phone and the transcript will stay here."
            />
          ) : (
            <View style={styles.runList}>
              {runs.map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  selected={run.id === selectedRunId}
                  onPress={() => setSelectedRunId(run.id)}
                />
              ))}
            </View>
          )}

          <SectionHeader title="Transcript" action={selectedRun?.status} />
          {selectedRun ? (
            <View style={styles.detailCard}>
              <View style={styles.detailHeader}>
                <View style={styles.detailTitleWrap}>
                  <Text style={styles.detailTitle}>{selectedRun.title}</Text>
                  {selectedRun.subtitle && (
                    <Text style={styles.detailSubtitle} numberOfLines={2}>
                      {selectedRun.subtitle}
                    </Text>
                  )}
                </View>
                <StatusPill status={selectedRun.status} />
              </View>

              {pendingCommand && (
                <View style={styles.approvalBox}>
                  <View style={styles.approvalTitleRow}>
                    <Feather name="shield" size={16} color="#FBBF24" />
                    <Text style={styles.approvalTitle}>Command pending</Text>
                  </View>
                  <Text style={styles.approvalReason}>
                    {pendingCommand.reason}
                  </Text>
                  {pendingCommand.command && (
                    <Text style={styles.commandText} numberOfLines={4}>
                      {pendingCommand.command}
                    </Text>
                  )}
                  <View style={styles.approvalActions}>
                    <TouchableOpacity
                      style={[styles.secondaryButton, styles.denyButton]}
                      disabled={Boolean(acting)}
                      onPress={() =>
                        void handleDecision("deny", pendingCommand)
                      }
                    >
                      <Feather name="x" size={15} color="#FCA5A5" />
                      <Text style={styles.denyButtonText}>
                        {acting === "deny" ? "Denying" : "Deny"}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.primarySmallButton}
                      disabled={Boolean(acting)}
                      onPress={() =>
                        void handleDecision("approve", pendingCommand)
                      }
                    >
                      <Feather name="check" size={15} color="#111111" />
                      <Text style={styles.primarySmallButtonText}>
                        {acting === "approve" ? "Approving" : "Approve"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              <View style={styles.detailActions}>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => void loadTranscript(selectedRun.id)}
                >
                  <Feather name="rotate-cw" size={15} color="#ffffff" />
                  <Text style={styles.secondaryButtonText}>Status</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  disabled={
                    Boolean(acting) || selectedRun.status === "completed"
                  }
                  onPress={handleStop}
                >
                  <Feather name="square" size={15} color="#ffffff" />
                  <Text style={styles.secondaryButtonText}>
                    {acting === "stop" ? "Stopping" : "Stop"}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.timeline}>
                {transcriptLoading ? (
                  <View style={styles.loadingBlock}>
                    <ActivityIndicator color="#ffffff" />
                  </View>
                ) : events.length === 0 ? (
                  <EmptyInline
                    icon="clock"
                    text="No transcript events recorded for this session yet."
                  />
                ) : (
                  events.map((event) => (
                    <TranscriptItem key={event.id} event={event} />
                  ))
                )}
              </View>

              <View style={styles.followUpBox}>
                <TextInput
                  style={styles.followUpInput}
                  value={followUpPrompt}
                  onChangeText={setFollowUpPrompt}
                  placeholder="Send a follow-up..."
                  placeholderTextColor="#666666"
                  multiline
                  textAlignVertical="top"
                />
                <TouchableOpacity
                  style={[
                    styles.sendButton,
                    (!followUpPrompt.trim() || sending) &&
                      styles.disabledButton,
                  ]}
                  disabled={!followUpPrompt.trim() || sending}
                  onPress={handleFollowUp}
                  accessibilityLabel="Send follow-up"
                >
                  {sending ? (
                    <ActivityIndicator color="#111111" />
                  ) : (
                    <Feather name="send" size={17} color="#111111" />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <EmptyBlock
              icon="terminal"
              title="Select a session"
              text="Choose a recent run to inspect status, approve commands, or continue the transcript."
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function SectionHeader({ title, action }: { title: string; action?: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action && <Text style={styles.sectionAction}>{action}</Text>}
    </View>
  );
}

function HostCard({
  host,
  selected,
  onPress,
}: {
  host: RemoteHost;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.hostCard, selected && styles.selectedCard]}
      onPress={onPress}
    >
      <View style={styles.hostTopline}>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: hostStatusColor(host.status) },
          ]}
        />
        <Text style={styles.hostName} numberOfLines={1}>
          {host.name}
        </Text>
      </View>
      <Text style={styles.hostMeta} numberOfLines={1}>
        {host.platform || "Desktop host"}
      </Text>
      <Text style={styles.hostTime}>{formatRelativeTime(host.lastSeenAt)}</Text>
    </TouchableOpacity>
  );
}

function RunRow({
  run,
  selected,
  onPress,
}: {
  run: RemoteRun;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.runRow, selected && styles.selectedRunRow]}
      onPress={onPress}
    >
      <View style={styles.runTopline}>
        <Text style={styles.runTitle} numberOfLines={1}>
          {run.title}
        </Text>
        <StatusPill status={run.status} compact />
      </View>
      {run.subtitle && (
        <Text style={styles.runSubtitle} numberOfLines={1}>
          {run.subtitle}
        </Text>
      )}
      <View style={styles.runMeta}>
        <Text style={styles.runMetaText}>{run.phase ?? run.status}</Text>
        <Text style={styles.runMetaText}>
          {formatRelativeTime(run.updatedAt)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function StatusPill({
  status,
  compact = false,
}: {
  status: RemoteRunStatus;
  compact?: boolean;
}) {
  return (
    <View
      style={[
        styles.statusPill,
        {
          borderColor: runStatusColor(status),
          backgroundColor: runStatusBg(status),
        },
        compact && styles.compactPill,
      ]}
    >
      <Text style={[styles.statusText, { color: runStatusColor(status) }]}>
        {statusLabel(status)}
      </Text>
    </View>
  );
}

function TranscriptItem({ event }: { event: RemoteTranscriptEvent }) {
  return (
    <View style={styles.eventRow}>
      <View style={styles.eventIcon}>
        <Feather
          name={eventIcon(event.type)}
          size={14}
          color={event.type === "user" ? "#111111" : "#ffffff"}
        />
      </View>
      <View style={styles.eventBody}>
        <View style={styles.eventMeta}>
          <Text style={styles.eventTitle}>
            {event.title || eventTypeLabel(event.type)}
          </Text>
          <Text style={styles.eventTime}>
            {formatRelativeTime(event.createdAt)}
          </Text>
        </View>
        <Text style={styles.eventText}>{event.text}</Text>
        {(event.artifactPath || event.artifactUrl) && (
          <View style={styles.artifactBox}>
            <Feather name="paperclip" size={13} color="#9CA3AF" />
            <Text style={styles.artifactText} numberOfLines={2}>
              {event.artifactPath || event.artifactUrl}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function EmptyBlock({
  icon,
  title,
  text,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  text: string;
}) {
  return (
    <View style={styles.emptyBlock}>
      <Feather name={icon} size={24} color="#666666" />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function EmptyInline({
  icon,
  text,
}: {
  icon: keyof typeof Feather.glyphMap;
  text: string;
}) {
  return (
    <View style={styles.emptyInline}>
      <Feather name={icon} size={18} color="#666666" />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function hostStatusColor(status: RemoteHostStatus): string {
  if (status === "online") return "#86EFAC";
  if (status === "busy") return "#FBBF24";
  if (status === "offline") return "#6B7280";
  return "#9CA3AF";
}

function runStatusColor(status: RemoteRunStatus): string {
  if (status === "completed") return "#86EFAC";
  if (status === "needs-approval") return "#FBBF24";
  if (status === "errored") return "#FCA5A5";
  if (status === "running" || status === "queued") return "#93C5FD";
  return "#9CA3AF";
}

function runStatusBg(status: RemoteRunStatus): string {
  if (status === "completed") return "#052E16";
  if (status === "needs-approval") return "#422006";
  if (status === "errored") return "#450A0A";
  if (status === "running" || status === "queued") return "#172554";
  return "#1F2937";
}

function statusLabel(status: RemoteRunStatus): string {
  return status === "needs-approval" ? "approval" : status;
}

function eventIcon(
  type: RemoteTranscriptEventType,
): keyof typeof Feather.glyphMap {
  if (type === "user") return "corner-up-right";
  if (type === "artifact") return "paperclip";
  if (type === "status") return "check-circle";
  return "code";
}

function eventTypeLabel(type: RemoteTranscriptEventType): string {
  if (type === "user") return "User prompt";
  if (type === "artifact") return "Artifact";
  if (type === "status") return "Status";
  return "System";
}

function formatRelativeTime(value?: string): string {
  if (!value) return "Never";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return value;
  const diff = Date.now() - time;
  if (diff < 30_000) return "Just now";
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString();
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111111",
  },
  keyboard: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 36,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingBottom: 12,
  },
  headerIcon: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: "#202020",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#333333",
  },
  headerText: {
    flex: 1,
  },
  kicker: {
    color: "#999999",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  title: {
    color: "#ffffff",
    fontSize: 28,
    fontWeight: "700",
    marginTop: 2,
  },
  subtitle: {
    color: "#666666",
    fontSize: 12,
    marginTop: 2,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1A1A1A",
    borderWidth: 1,
    borderColor: "#33333366",
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#2A1212",
    borderWidth: 1,
    borderColor: "#7F1D1D",
    marginVertical: 8,
  },
  noticeBanner: {
    backgroundColor: "#102015",
    borderColor: "#14532D",
  },
  bannerText: {
    flex: 1,
    color: "#FECACA",
    fontSize: 13,
  },
  noticeText: {
    flex: 1,
    color: "#BBF7D0",
    fontSize: 13,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 18,
    paddingBottom: 8,
  },
  sectionTitle: {
    color: "#999999",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sectionAction: {
    color: "#666666",
    fontSize: 12,
  },
  hostRail: {
    gap: 10,
    paddingRight: 16,
  },
  hostCard: {
    width: 164,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#181818",
    borderWidth: 1,
    borderColor: "#2A2A2A",
  },
  selectedCard: {
    borderColor: "#ffffff",
    backgroundColor: "#202020",
  },
  hostTopline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  hostName: {
    flex: 1,
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
  hostMeta: {
    color: "#8A8A8A",
    fontSize: 12,
    marginTop: 8,
  },
  hostTime: {
    color: "#666666",
    fontSize: 12,
    marginTop: 4,
  },
  composerCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#181818",
    borderWidth: 1,
    borderColor: "#2A2A2A",
    marginTop: 10,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  cardTitle: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "700",
  },
  promptInput: {
    minHeight: 96,
    color: "#ffffff",
    fontSize: 15,
    lineHeight: 21,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#101010",
    borderWidth: 1,
    borderColor: "#2A2A2A",
  },
  primaryButton: {
    marginTop: 12,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryButtonText: {
    color: "#111111",
    fontSize: 15,
    fontWeight: "700",
  },
  disabledButton: {
    opacity: 0.45,
  },
  loadingBlock: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 20,
  },
  mutedText: {
    color: "#777777",
    fontSize: 13,
  },
  runList: {
    gap: 8,
  },
  runRow: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#181818",
    borderWidth: 1,
    borderColor: "#242424",
  },
  selectedRunRow: {
    borderColor: "#ffffff",
    backgroundColor: "#202020",
  },
  runTopline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  runTitle: {
    flex: 1,
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
  runSubtitle: {
    color: "#8A8A8A",
    fontSize: 13,
    marginTop: 6,
  },
  runMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  runMetaText: {
    color: "#666666",
    fontSize: 12,
  },
  statusPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  compactPill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  detailCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#181818",
    borderWidth: 1,
    borderColor: "#2A2A2A",
  },
  detailHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  detailTitleWrap: {
    flex: 1,
  },
  detailTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
  },
  detailSubtitle: {
    color: "#888888",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  approvalBox: {
    marginTop: 14,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#211805",
    borderWidth: 1,
    borderColor: "#5F420D",
  },
  approvalTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  approvalTitle: {
    color: "#FDE68A",
    fontSize: 14,
    fontWeight: "700",
  },
  approvalReason: {
    color: "#F5D999",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
  },
  commandText: {
    color: "#ffffff",
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
    fontSize: 12,
    lineHeight: 17,
    padding: 10,
    marginTop: 10,
    borderRadius: 8,
    backgroundColor: "#111111",
  },
  approvalActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  detailActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  secondaryButton: {
    flex: 1,
    height: 40,
    borderRadius: 9,
    backgroundColor: "#242424",
    borderWidth: 1,
    borderColor: "#333333",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  secondaryButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
  denyButton: {
    backgroundColor: "#2A1212",
    borderColor: "#7F1D1D",
  },
  denyButtonText: {
    color: "#FCA5A5",
    fontSize: 14,
    fontWeight: "700",
  },
  primarySmallButton: {
    flex: 1,
    height: 40,
    borderRadius: 9,
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  primarySmallButtonText: {
    color: "#111111",
    fontSize: 14,
    fontWeight: "700",
  },
  timeline: {
    gap: 12,
    paddingTop: 16,
    paddingBottom: 12,
  },
  eventRow: {
    flexDirection: "row",
    gap: 10,
  },
  eventIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2A2A2A",
    marginTop: 2,
  },
  eventBody: {
    flex: 1,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#242424",
  },
  eventMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  eventTitle: {
    flex: 1,
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
  eventTime: {
    color: "#666666",
    fontSize: 11,
  },
  eventText: {
    color: "#D4D4D4",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  artifactBox: {
    marginTop: 8,
    padding: 8,
    borderRadius: 8,
    backgroundColor: "#111111",
    flexDirection: "row",
    gap: 6,
  },
  artifactText: {
    flex: 1,
    color: "#9CA3AF",
    fontSize: 12,
  },
  followUpBox: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingTop: 4,
  },
  followUpInput: {
    flex: 1,
    minHeight: 46,
    maxHeight: 120,
    color: "#ffffff",
    fontSize: 14,
    lineHeight: 20,
    padding: 11,
    borderRadius: 10,
    backgroundColor: "#101010",
    borderWidth: 1,
    borderColor: "#2A2A2A",
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
  emptyBlock: {
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    borderRadius: 12,
    backgroundColor: "#181818",
    borderWidth: 1,
    borderColor: "#242424",
  },
  emptyInline: {
    minWidth: 220,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
  },
  emptyTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
    marginTop: 10,
  },
  emptyText: {
    color: "#777777",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 4,
  },
});
