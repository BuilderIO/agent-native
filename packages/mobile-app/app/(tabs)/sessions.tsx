import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { SafeAreaView } from "@/components/uniwind-interop";
import {
  appendRemoteFollowUp,
  clearRemoteSessionToken,
  createRemoteRun,
  decidePendingCommand,
  getPendingCommand,
  getRemoteRelayBaseUrl,
  getRemoteRunDetail,
  isRemoteAuthError,
  isRemoteRunActive,
  listPairedHosts,
  listRemoteRuns,
  readRemoteTranscript,
  revokeRemoteHost,
  stopRemoteRun,
  type PendingCommand,
  type RemoteHost,
  type RemoteHostStatus,
  type RemoteRun,
  type RemoteRunStatus,
  type RemoteTranscriptEvent,
  type RemoteTranscriptEventType,
} from "@/lib/remote-sessions-api";
import { useRemotePushRegistration } from "@/lib/use-remote-push-registration";

const POLL_INTERVAL_MS = 4000;
const GOAL_ID = "task";
type RelayState = "checking" | "online" | "offline" | "error" | "signed-out";

export default function SessionsScreen() {
  const router = useRouter();
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
  const [relayState, setRelayState] = useState<RelayState>("checking");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [revokingHostId, setRevokingHostId] = useState<string | null>(null);
  const [confirmingRevokeHostId, setConfirmingRevokeHostId] = useState<
    string | null
  >(null);
  const [acting, setActing] = useState<"approve" | "deny" | "stop" | null>(
    null,
  );
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pushRegistration = useRemotePushRegistration();

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );
  const pendingCommand = useMemo(
    () => getPendingCommand(selectedRun),
    [selectedRun],
  );

  const hostSummary = useMemo(() => {
    const online = hosts.filter((host) => host.status === "online").length;
    const busy = hosts.filter((host) => host.status === "busy").length;
    if (hosts.length === 0) return "No hosts paired";
    if (online > 0 || busy > 0) {
      return `${online + busy}/${hosts.length} available`;
    }
    return "All hosts offline";
  }, [hosts]);

  const loadHosts = useCallback(async () => {
    const result = await listPairedHosts();
    if (result.ok) {
      const nextHosts = result.data ?? [];
      setAuthRequired(false);
      setHosts(nextHosts);
      setSelectedHostId((current) => {
        if (current && nextHosts.some((host) => host.id === current)) {
          return current;
        }
        return nextHosts[0]?.id;
      });
    } else if (isRemoteAuthError(result)) {
      setAuthRequired(true);
      setError(null);
      setHosts([]);
    } else {
      setError(result.error ?? "Could not load paired hosts.");
    }
    return result;
  }, []);

  const loadRuns = useCallback(async () => {
    const result = await listRemoteRuns(GOAL_ID);
    if (result.ok) {
      const nextRuns = result.data ?? [];
      setAuthRequired(false);
      setRuns(nextRuns);
      setSelectedRunId((current) => {
        if (current && nextRuns.some((run) => run.id === current))
          return current;
        return nextRuns[0]?.id ?? null;
      });
      if (nextRuns.length > 0) setError(null);
    } else if (isRemoteAuthError(result)) {
      setAuthRequired(true);
      setError(null);
      setRuns([]);
      setSelectedRunId(null);
    } else {
      setError(result.error ?? "Could not load sessions.");
    }
    return result;
  }, []);

  const loadTranscript = useCallback(async (runId: string, quiet = false) => {
    if (!quiet) setTranscriptLoading(true);
    const result = await readRemoteTranscript(runId);
    if (result.ok) {
      setEvents(result.data ?? []);
      setError(null);
    } else if (isRemoteAuthError(result)) {
      setAuthRequired(true);
      setEvents([]);
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
      setAuthRequired(false);
      setRuns((current) =>
        current.map((run) => (run.id === runId ? result.data! : run)),
      );
    } else if (isRemoteAuthError(result)) {
      setAuthRequired(true);
      setError(null);
    }
  }, []);

  const refresh = useCallback(
    async (quiet = false) => {
      if (!quiet) setRefreshing(true);
      const [hostsResult, runsResult] = await Promise.all([
        loadHosts(),
        loadRuns(),
      ]);
      if (isRemoteAuthError(hostsResult) || isRemoteAuthError(runsResult)) {
        setAuthRequired(true);
        setRelayState("signed-out");
        setLastSyncedAt(null);
      } else if (hostsResult.ok || runsResult.ok) {
        setAuthRequired(false);
        setRelayState("online");
        setLastSyncedAt(new Date().toISOString());
      } else if (hostsResult.status === 0 || runsResult.status === 0) {
        setRelayState("offline");
      } else {
        setRelayState("error");
      }
      if (!quiet) setRefreshing(false);
    },
    [loadHosts, loadRuns],
  );

  const handleConnectPhone = useCallback(async () => {
    await clearRemoteSessionToken();
    setAuthRequired(false);
    setError(null);
    setNotice(null);
    setRelayState("checking");
    router.push("/dispatch" as never);
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void refresh(true).finally(() => {
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
  const selectedHostOffline =
    selectedHost &&
    selectedHost.status !== "online" &&
    selectedHost.status !== "busy";

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
      if (isRemoteAuthError(result)) {
        setAuthRequired(true);
        setRelayState("signed-out");
        setError(null);
      } else {
        setError(result.error ?? "Could not start the session.");
      }
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
    setRuns((current) =>
      current.map((run) =>
        run.id === selectedRun.id
          ? {
              ...run,
              status: isRemoteRunActive(run) ? run.status : "queued",
              updatedAt: optimisticEvent.createdAt,
            }
          : run,
      ),
    );
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
      setFollowUpPrompt(prompt);
      if (isRemoteAuthError(result)) {
        setAuthRequired(true);
        setRelayState("signed-out");
        setError(null);
      } else {
        setError(result.error ?? "Could not send the follow-up.");
      }
    } else {
      setNotice(result.data?.message ?? "Follow-up queued.");
      if (result.data?.event) {
        setEvents((current) =>
          current.map((event) =>
            event.id === optimisticEvent.id ? result.data!.event! : event,
          ),
        );
      }
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
        if (isRemoteAuthError(result)) {
          setAuthRequired(true);
          setRelayState("signed-out");
          setError(null);
        } else {
          setError(result.error ?? `Could not ${decision} the command.`);
        }
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
    const result = await stopRemoteRun(
      selectedRun.id,
      selectedRun.hostId ?? selectedHostId,
    );
    if (!result.ok) {
      if (isRemoteAuthError(result)) {
        setAuthRequired(true);
        setRelayState("signed-out");
        setError(null);
      } else {
        setError(result.error ?? "Could not stop the session.");
      }
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
  }, [acting, loadTranscript, refresh, selectedHostId, selectedRun]);

  const handleRevokeHost = useCallback(async () => {
    if (!selectedHost || revokingHostId) return;
    if (confirmingRevokeHostId !== selectedHost.id) {
      setConfirmingRevokeHostId(selectedHost.id);
      setNotice(`Tap Revoke ${selectedHost.name} again to forget this host.`);
      return;
    }
    setRevokingHostId(selectedHost.id);
    setError(null);
    setNotice(null);
    const result = await revokeRemoteHost(selectedHost.id);
    if (result.ok) {
      setNotice(result.data?.message ?? "Host revoked.");
      setHosts((current) =>
        current.filter((host) => host.id !== selectedHost.id),
      );
      setSelectedHostId((current) =>
        current === selectedHost.id
          ? hosts.find((host) => host.id !== selectedHost.id)?.id
          : current,
      );
      await refresh(true);
    } else {
      if (isRemoteAuthError(result)) {
        setAuthRequired(true);
        setRelayState("signed-out");
        setError(null);
      } else {
        setError(result.error ?? "Could not revoke this host.");
      }
    }
    setConfirmingRevokeHostId(null);
    setRevokingHostId(null);
  }, [confirmingRevokeHostId, hosts, refresh, revokingHostId, selectedHost]);

  return (
    <SafeAreaView className="flex-1 bg-background-dark">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={80}
      >
        <ScrollView
          contentContainerClassName="p-4 pb-9"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor="#ffffff"
              onRefresh={() => void refresh(false)}
            />
          }
        >
          <View className="flex-row items-center gap-3 pb-3">
            <View className="w-10.5 h-10.5 rounded-lg bg-gray-medium-dark items-center justify-center border border-gray-border-light">
              <Feather name="terminal" size={20} color="#ffffff" />
            </View>
            <View className="flex-1">
              <Text className="text-text-muted text-xs font-bold uppercase tracking-wider">
                Code Agents
              </Text>
              <Text className="text-white text-3xl font-bold mt-0.5">
                Sessions
              </Text>
              <Text
                className="text-status-gray text-xs mt-0.5"
                numberOfLines={1}
              >
                {getRemoteRelayBaseUrl()}
              </Text>
            </View>
            <RelayPill state={relayState} />
            <TouchableOpacity
              className="w-10 h-10 rounded-lg items-center justify-center bg-gray-dark border border-gray-border-dim active:opacity-75"
              onPress={() => void refresh(false)}
              accessibilityLabel="Refresh sessions"
            >
              <Feather name="refresh-cw" size={18} color="#ffffff" />
            </TouchableOpacity>
          </View>

          {error && !authRequired && (
            <View className="flex-row items-center gap-2 p-3 rounded-lg bg-error-bg border border-error-border my-2">
              <Feather name="alert-circle" size={16} color="#FCA5A5" />
              <Text className="flex-1 text-error-text text-sm">{error}</Text>
            </View>
          )}
          {notice && (
            <View className="flex-row items-center gap-2 p-3 rounded-lg bg-success-bg border border-success-border my-2">
              <Feather name="check-circle" size={16} color="#86EFAC" />
              <Text className="flex-1 text-success-text text-sm">{notice}</Text>
            </View>
          )}

          {authRequired ? (
            <ConnectPhoneCard
              relayUrl={getRemoteRelayBaseUrl()}
              onConnect={handleConnectPhone}
              onRefresh={() => void refresh(false)}
            />
          ) : (
            <>
              <RelayStatusCard
                state={relayState}
                lastSyncedAt={lastSyncedAt}
                hostSummary={hostSummary}
              />

              <SectionHeader title="Paired Hosts" action={selectedHost?.name} />
              {hosts.length === 0 && !loading ? (
                <PairDesktopCard
                  relayUrl={getRemoteRelayBaseUrl()}
                  onRefresh={() => void refresh(false)}
                />
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerClassName="gap-2.5 pr-4"
                >
                  {hosts.map((host) => (
                    <HostCard
                      key={host.id}
                      host={host}
                      selected={host.id === selectedHostId}
                      onPress={() => setSelectedHostId(host.id)}
                    />
                  ))}
                </ScrollView>
              )}

              <HostControls
                host={selectedHost}
                confirming={confirmingRevokeHostId === selectedHost?.id}
                revoking={revokingHostId === selectedHost?.id}
                pushStatus={pushRegistration.status}
                pushMessage={pushRegistration.message}
                registeringPush={pushRegistration.registering}
                onRevoke={() => void handleRevokeHost()}
                onRegisterPush={() => void pushRegistration.register()}
              />

              <View className="p-3.5 rounded-xl bg-card-dark border border-border-dark mt-2.5">
                <View className="flex-row items-center justify-between mb-2.5">
                  <Text className="text-white text-lg font-bold">
                    New Session
                  </Text>
                  {creating && <ActivityIndicator color="#ffffff" />}
                </View>
                {selectedHostOffline && (
                  <View className="flex-row items-start gap-2 p-2.5 rounded-lg bg-warning-yellow-bg border border-warning-yellow-border mb-2.5">
                    <Feather name="wifi-off" size={15} color="#FBBF24" />
                    <Text className="flex-1 text-warning-yellow-text text-xs leading-4">
                      {selectedHost.name} looks offline. New work will queue
                      until it reconnects.
                    </Text>
                  </View>
                )}
                <TextInput
                  className="min-h-24 text-white text-base leading-5 p-3 rounded-lg bg-background-pure border border-border-dark"
                  value={newPrompt}
                  onChangeText={setNewPrompt}
                  placeholder="Ask a paired host to implement, inspect, or fix something..."
                  placeholderTextColor="#666666"
                  multiline
                  textAlignVertical="top"
                />
                <TouchableOpacity
                  className={`mt-3 h-11 rounded-lg bg-white flex-row items-center justify-center gap-2 active:opacity-75 ${
                    !newPrompt.trim() || creating || relayState === "offline"
                      ? "opacity-45"
                      : ""
                  }`}
                  disabled={
                    !newPrompt.trim() || creating || relayState === "offline"
                  }
                  onPress={handleCreateRun}
                >
                  <Feather name="play" size={16} color="#111111" />
                  <Text className="text-background-pure text-sm font-bold">
                    {relayState === "offline"
                      ? "Relay Offline"
                      : "Start Session"}
                  </Text>
                </TouchableOpacity>
              </View>

              <SectionHeader
                title="Recent Runs"
                action={runs.length ? `${runs.length}` : undefined}
              />
              {loading ? (
                <View className="items-center justify-center gap-2 py-5">
                  <ActivityIndicator color="#ffffff" />
                  <Text className="text-status-gray text-xs">
                    Loading sessions...
                  </Text>
                </View>
              ) : runs.length === 0 ? (
                <EmptyBlock
                  icon="inbox"
                  title="No sessions yet"
                  text="Start a new session from this phone and the transcript will stay here."
                />
              ) : (
                <View className="gap-2">
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
                <View className="p-3.5 rounded-xl bg-card-dark border border-border-dark">
                  <View className="flex-row items-start gap-2.5">
                    <View className="flex-1">
                      <Text className="text-white text-xl font-bold">
                        {selectedRun.title}
                      </Text>
                      {selectedRun.subtitle && (
                        <Text
                          className="text-status-gray text-sm leading-4 mt-1"
                          numberOfLines={2}
                        >
                          {selectedRun.subtitle}
                        </Text>
                      )}
                    </View>
                    <StatusPill status={selectedRun.status} />
                  </View>

                  {pendingCommand && (
                    <View className="mt-3.5 p-3 rounded-lg bg-warning-yellow-bg border border-warning-yellow-border">
                      <View className="flex-row items-center gap-2">
                        <Feather name="shield" size={16} color="#FBBF24" />
                        <Text className="text-warning-yellow-text text-sm font-bold">
                          Approval needed
                        </Text>
                      </View>
                      <Text className="text-warning-yellow-text text-sm leading-4 mt-2">
                        {pendingCommand.reason}
                      </Text>
                      {pendingCommand.command && (
                        <Text
                          style={{
                            fontFamily: Platform.select({
                              ios: "Menlo",
                              android: "monospace",
                            }),
                          }}
                          className="text-white text-xs leading-4 p-2.5 mt-2.5 rounded-lg bg-background-pure"
                          numberOfLines={4}
                        >
                          {pendingCommand.command}
                        </Text>
                      )}
                      <View className="flex-row gap-2.5 mt-3">
                        <TouchableOpacity
                          className="flex-1 h-10 rounded-lg bg-error-bg border border-error-border flex-row items-center justify-center gap-1.75 active:opacity-75"
                          disabled={Boolean(acting)}
                          onPress={() =>
                            void handleDecision("deny", pendingCommand)
                          }
                        >
                          {acting === "deny" ? (
                            <ActivityIndicator color="#FCA5A5" />
                          ) : (
                            <Feather name="x" size={15} color="#FCA5A5" />
                          )}
                          <Text className="text-error-text text-sm font-bold">
                            {acting === "deny" ? "Denying" : "Deny"}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          className="flex-1 h-10 rounded-lg bg-white flex-row items-center justify-center gap-1.75 active:opacity-75"
                          disabled={Boolean(acting)}
                          onPress={() =>
                            void handleDecision("approve", pendingCommand)
                          }
                        >
                          {acting === "approve" ? (
                            <ActivityIndicator color="#111111" />
                          ) : (
                            <Feather name="check" size={15} color="#111111" />
                          )}
                          <Text className="text-background-pure text-sm font-bold">
                            {acting === "approve" ? "Approving" : "Approve"}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  <View className="flex-row gap-2.5 mt-3.5">
                    <TouchableOpacity
                      className="flex-1 h-10 rounded-lg bg-gray-medium-dark border border-gray-border-light flex-row items-center justify-center gap-1.75 active:opacity-75"
                      onPress={() => void loadTranscript(selectedRun.id)}
                    >
                      <Feather name="rotate-cw" size={15} color="#ffffff" />
                      <Text className="text-white text-sm font-semibold">
                        Refresh
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      className="flex-1 h-10 rounded-lg bg-gray-medium-dark border border-gray-border-light flex-row items-center justify-center gap-1.75 active:opacity-75"
                      disabled={
                        Boolean(acting) || selectedRun.status === "completed"
                      }
                      onPress={handleStop}
                    >
                      {acting === "stop" ? (
                        <ActivityIndicator color="#ffffff" />
                      ) : (
                        <Feather name="square" size={15} color="#ffffff" />
                      )}
                      <Text className="text-white text-sm font-semibold">
                        {acting === "stop" ? "Stopping" : "Stop Run"}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <View className="gap-3 pt-4 pb-3">
                    {transcriptLoading ? (
                      <View className="items-center justify-center gap-2 py-5">
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

                  <View className="flex-row items-end gap-2.5 pt-1">
                    <TextInput
                      className="flex-1 min-h-11.5 max-h-30 text-white text-sm leading-5 p-2.75 rounded-lg bg-background-pure border border-border-dark"
                      value={followUpPrompt}
                      onChangeText={setFollowUpPrompt}
                      placeholder="Send a follow-up..."
                      placeholderTextColor="#666666"
                      multiline
                      textAlignVertical="top"
                    />
                    <TouchableOpacity
                      className={`w-11.5 h-11.5 rounded-lg items-center justify-center bg-white active:opacity-75 ${
                        !followUpPrompt.trim() || sending ? "opacity-45" : ""
                      }`}
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
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function SectionHeader({ title, action }: { title: string; action?: string }) {
  return (
    <View className="flex-row items-center justify-between pt-4.5 pb-2">
      <Text className="text-text-muted text-xs font-bold uppercase tracking-wider">
        {title}
      </Text>
      {action && <Text className="text-status-gray text-xs">{action}</Text>}
    </View>
  );
}

function ConnectPhoneCard({
  relayUrl,
  onConnect,
  onRefresh,
}: {
  relayUrl: string;
  onConnect: () => void;
  onRefresh: () => void;
}) {
  return (
    <View className="items-stretch p-4.5 rounded-2xl bg-card-dark border border-border-dark mt-2.5">
      <View className="w-11 h-11 rounded-xl bg-white items-center justify-center mb-3.5">
        <Feather name="log-in" size={22} color="#111111" />
      </View>
      <Text className="text-white text-2xl font-extrabold">
        Connect this phone
      </Text>
      <Text className="text-text-muted text-sm leading-5 mt-2">
        Sign in to Dispatch once, then return to Sessions. The app will use that
        session to list paired computers and start remote code-agent runs.
      </Text>
      <View className="flex-row items-center gap-2 p-2.5 rounded-lg bg-background-pure border border-border-dark mt-3.5">
        <Feather name="globe" size={14} color="#9CA3AF" />
        <Text className="flex-1 text-text-light text-xs" numberOfLines={1}>
          {relayUrl}
        </Text>
      </View>
      <TouchableOpacity
        className="mt-3 h-11 rounded-lg bg-white flex-row items-center justify-center gap-2 active:opacity-75"
        onPress={onConnect}
      >
        <Feather name="external-link" size={16} color="#111111" />
        <Text className="text-background-pure text-sm font-bold">
          Open Dispatch sign-in
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        className="mt-2.5 h-10.5 rounded-lg bg-gray-medium-dark border border-gray-border-light flex-row items-center justify-center gap-1.75 active:opacity-75"
        onPress={onRefresh}
      >
        <Feather name="refresh-cw" size={15} color="#ffffff" />
        <Text className="text-white text-sm font-semibold">
          I signed in, refresh
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function PairDesktopCard({
  relayUrl,
  onRefresh,
}: {
  relayUrl: string;
  onRefresh: () => void;
}) {
  return (
    <View className="p-3.5 rounded-xl bg-card-dark border border-border-dark">
      <View className="flex-row items-center gap-2.5">
        <View className="w-9.5 h-9.5 rounded-lg bg-gray-medium-dark items-center justify-center">
          <Feather name="monitor" size={17} color="#ffffff" />
        </View>
        <View className="flex-1">
          <Text className="text-white text-base font-bold">
            Pair your desktop
          </Text>
          <Text className="text-status-gray text-xs leading-4 mt-0.75">
            Remote sessions need an awake Mac polling this relay.
          </Text>
        </View>
      </View>
      <View className="gap-2.5 mt-3.5">
        <StepRow
          index="1"
          text="Open Agent Native Desktop and sign in to Dispatch."
        />
        <StepRow
          index="2"
          text="Go to Settings, Remote Control, then Pair or repair."
        />
        <StepRow index="3" text={`Pair this Mac with ${relayUrl}.`} />
      </View>
      <TouchableOpacity
        className="mt-2.5 h-10.5 rounded-lg bg-gray-medium-dark border border-gray-border-light flex-row items-center justify-center gap-1.75 active:opacity-75"
        onPress={onRefresh}
      >
        <Feather name="refresh-cw" size={15} color="#ffffff" />
        <Text className="text-white text-sm font-semibold">
          Refresh paired hosts
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function StepRow({ index, text }: { index: string; text: string }) {
  return (
    <View className="flex-row items-start gap-2.5">
      <View className="w-5.5 h-5.5 rounded-full items-center justify-center bg-gray-charcoal">
        <Text className="text-white text-xs font-bold">{index}</Text>
      </View>
      <Text className="flex-1 text-text-light text-sm leading-5">{text}</Text>
    </View>
  );
}

function RelayPill({ state }: { state: RelayState }) {
  const color =
    state === "online"
      ? "#86EFAC"
      : state === "offline"
        ? "#FCA5A5"
        : state === "error"
          ? "#FBBF24"
          : state === "signed-out"
            ? "#93C5FD"
            : "#9CA3AF";
  return (
    <View
      style={{ borderColor: color }}
      className="h-8.5 rounded-full border px-2.5 flex-row items-center gap-1.5 bg-card-dark"
    >
      <View
        style={{ backgroundColor: color }}
        className="w-2 h-2 rounded-full"
      />
      <Text style={{ color }} className="text-xs font-bold uppercase">
        {state === "checking"
          ? "syncing"
          : state === "signed-out"
            ? "connect"
            : state}
      </Text>
    </View>
  );
}

function RelayStatusCard({
  state,
  lastSyncedAt,
  hostSummary,
}: {
  state: RelayState;
  lastSyncedAt: string | null;
  hostSummary: string;
}) {
  const offline = state === "offline";
  return (
    <View
      className={`flex-row items-center gap-3 p-3 rounded-xl bg-card-dark border border-border-dark mt-1 ${offline ? "bg-[#211212] border-error-border" : ""}`}
    >
      <View className="w-9 h-9 rounded-lg items-center justify-center bg-gray-medium-dark">
        <Feather
          name={offline ? "wifi-off" : "radio"}
          size={17}
          color={offline ? "#FCA5A5" : "#ffffff"}
        />
      </View>
      <View className="flex-1">
        <Text className="text-white text-base font-bold">
          {offline ? "Relay unreachable" : hostSummary}
        </Text>
        <Text
          className="text-status-gray text-xs leading-4 mt-0.75"
          numberOfLines={2}
        >
          {offline
            ? "Pull to retry. Queued work and approvals need the relay before they can sync."
            : lastSyncedAt
              ? `Synced ${formatRelativeTime(lastSyncedAt)}`
              : "Checking relay status..."}
        </Text>
      </View>
    </View>
  );
}

function HostControls({
  host,
  confirming,
  revoking,
  pushStatus,
  pushMessage,
  registeringPush,
  onRevoke,
  onRegisterPush,
}: {
  host?: RemoteHost;
  confirming: boolean;
  revoking: boolean;
  pushStatus: string;
  pushMessage: string;
  registeringPush: boolean;
  onRevoke: () => void;
  onRegisterPush: () => void;
}) {
  if (!host) return null;
  const pushDone = pushStatus === "registered";
  return (
    <View className="p-3 rounded-xl bg-card-dark border border-border-dark mt-2.5">
      <View className="mb-2.5">
        <Text className="text-white text-base font-bold">
          {hostStatusLabel(host)}
        </Text>
        <Text
          className="text-status-gray text-xs leading-4 mt-0.75"
          numberOfLines={2}
        >
          {host.version
            ? `${host.platform || "Desktop"} · ${host.version}`
            : host.platform || "Desktop host"}
        </Text>
      </View>
      <View className="flex-row gap-2.5">
        <TouchableOpacity
          className={`flex-1 h-10 rounded-lg bg-gray-medium-dark border border-gray-border-light flex-row items-center justify-center gap-1.75 active:opacity-75 h-9.5 ${
            confirming ? "bg-error-bg border-error-border" : ""
          }`}
          disabled={revoking}
          onPress={onRevoke}
          accessibilityLabel={`Revoke ${host.name}`}
        >
          {revoking ? (
            <ActivityIndicator color="#FCA5A5" />
          ) : (
            <Feather
              name="trash-2"
              size={14}
              color={confirming ? "#FCA5A5" : "#ffffff"}
            />
          )}
          <Text
            className={`text-white text-sm font-semibold ${
              confirming ? "text-error-text" : ""
            }`}
          >
            {confirming ? "Revoke" : "Forget"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          className={`flex-1 h-10 rounded-lg bg-gray-medium-dark border border-gray-border-light flex-row items-center justify-center gap-1.75 active:opacity-75 h-9.5 ${
            pushDone ? "bg-success-bg border-success-border" : ""
          }`}
          disabled={registeringPush || pushDone}
          onPress={onRegisterPush}
          accessibilityLabel="Enable push alerts"
        >
          {registeringPush ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Feather
              name={pushDone ? "bell" : "bell-off"}
              size={14}
              color={pushDone ? "#86EFAC" : "#ffffff"}
            />
          )}
          <Text
            className={`text-white text-sm font-semibold ${
              pushDone ? "text-success-text" : ""
            }`}
          >
            {pushDone ? "Alerts On" : "Alerts"}
          </Text>
        </TouchableOpacity>
      </View>
      <Text
        className="text-status-gray text-xs leading-4 mt-2.5"
        numberOfLines={2}
      >
        {pushMessage}
      </Text>
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
      className={`w-41 p-3 rounded-lg bg-card-dark border border-border-dark ${
        selected ? "border-white bg-[#202020]" : ""
      }`}
      onPress={onPress}
    >
      <View className="flex-row items-center gap-2">
        <View
          style={{ backgroundColor: hostStatusColor(host.status) }}
          className="w-2 h-2 rounded-full"
        />
        <Text
          className="flex-1 text-white text-base font-semibold"
          numberOfLines={1}
        >
          {host.name}
        </Text>
      </View>
      <Text className="text-status-gray text-xs mt-2" numberOfLines={1}>
        {hostStatusLabel(host)}
      </Text>
      <Text className="text-status-gray text-xs mt-1">
        {formatRelativeTime(host.lastSeenAt)}
      </Text>
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
      className={`p-3 rounded-lg bg-card-dark border border-[#242424] ${
        selected ? "border-white bg-[#202020]" : ""
      }`}
      onPress={onPress}
    >
      <View className="flex-row items-center gap-2.5">
        <Text
          className="flex-1 text-white text-base font-semibold"
          numberOfLines={1}
        >
          {run.title}
        </Text>
        <StatusPill status={run.status} compact />
      </View>
      {run.subtitle && (
        <Text className="text-status-gray text-sm mt-1.5" numberOfLines={1}>
          {run.subtitle}
        </Text>
      )}
      <View className="flex-row justify-between mt-2">
        <Text className="text-status-gray text-xs">
          {run.phase ?? run.status}
        </Text>
        <Text className="text-status-gray text-xs">
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
      style={{
        borderColor: runStatusColor(status),
        backgroundColor: runStatusBg(status),
      }}
      className={`border rounded-full px-2.25 py-1 ${compact ? "px-1.75 py-0.75" : ""}`}
    >
      <Text
        style={{ color: runStatusColor(status) }}
        className="text-xs font-bold uppercase"
      >
        {statusLabel(status)}
      </Text>
    </View>
  );
}

function TranscriptItem({ event }: { event: RemoteTranscriptEvent }) {
  return (
    <View className="flex-row gap-2.5">
      <View className="w-7 h-7 rounded bg-gray-charcoal items-center justify-center mt-0.5">
        <Feather
          name={eventIcon(event.type)}
          size={14}
          color={event.type === "user" ? "#111111" : "#ffffff"}
        />
      </View>
      <View className="flex-1 pb-3 border-b border-[#242424]">
        <View className="flex-row items-center justify-between gap-2">
          <Text className="flex-1 text-white text-sm font-bold">
            {event.title || eventTypeLabel(event.type)}
          </Text>
          <Text className="text-status-gray text-xs">
            {formatRelativeTime(event.createdAt)}
          </Text>
        </View>
        <Text className="text-text-light text-sm leading-5 mt-1.5">
          {event.text}
        </Text>
        {(event.artifactPath || event.artifactUrl) && (
          <View className="mt-2 p-2 rounded-lg bg-background-pure flex-row gap-1.5">
            <Feather name="paperclip" size={13} color="#9CA3AF" />
            <Text className="flex-1 text-text-muted text-xs" numberOfLines={2}>
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
    <View className="items-center justify-center p-6 rounded-xl bg-card-dark border border-[#242424]">
      <Feather name={icon} size={24} color="#666666" />
      <Text className="text-white text-base font-bold mt-2.5">{title}</Text>
      <Text className="text-status-gray text-sm leading-4 text-center mt-1">
        {text}
      </Text>
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
    <View className="min-w-55 flex-row items-center gap-2 p-3">
      <Feather name={icon} size={18} color="#666666" />
      <Text className="text-status-gray text-sm leading-4 text-center mt-1">
        {text}
      </Text>
    </View>
  );
}

function hostStatusColor(status: RemoteHostStatus): string {
  if (status === "online") return "#86EFAC";
  if (status === "busy") return "#FBBF24";
  if (status === "offline") return "#6B7280";
  return "#9CA3AF";
}

function hostStatusLabel(host: RemoteHost): string {
  if (host.status === "online") return `${host.name} is online`;
  if (host.status === "busy") return `${host.name} is busy`;
  if (host.status === "offline") return `${host.name} is offline`;
  return `${host.name} status unknown`;
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
