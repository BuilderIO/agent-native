import {
  IconCopy,
  IconGitFork,
  IconId,
  IconMenu2,
  IconShare2,
  IconSquareRoundedPlus,
} from "@tabler/icons-react-native";
import * as Clipboard from "expo-clipboard";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  Platform,
  Share,
  Text,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import {
  ChatSettingsSheet,
  DEFAULT_CHAT_SETTINGS,
  useChatSettings,
} from "@/components/chat/ChatSettingsSheet";
import { Composer } from "@/components/chat/Composer";
import { MessagesList } from "@/components/chat/MessagesList";
import { MobilePopover } from "@/components/chat/MobilePopover";
import {
  MobileWorkspaceControls,
  type ChatTarget,
} from "@/components/chat/MobileWorkspaceControls";
import { ThreadHistorySheet } from "@/components/chat/ThreadHistorySheet";
import { ComputerConnectSheet } from "@/components/ComputerConnectSheet";
import { NativeSignInSheet } from "@/components/NativeSignInSheet";
import { SafeAreaView } from "@/components/uniwind-interop";
import { createThreadShareLink, forkChatThread } from "@/lib/agent-chat/api";
import { buildRemoteChatState } from "@/lib/agent-chat/remote-presentation";
import type { ChatMessage } from "@/lib/agent-chat/types";
import { messageText } from "@/lib/agent-chat/types";
import type { AgentChatController } from "@/lib/agent-chat/use-agent-chat";
import { useAgentChat } from "@/lib/agent-chat/use-agent-chat";
import { useMobileThemeColors } from "@/lib/mobile-colors";
import { inspectNativeSession, NATIVE_AUTH_BASE_URL } from "@/lib/native-auth";
import {
  appendRemoteFollowUp,
  createRemoteRun,
  decidePendingCommand,
  getPendingCommand,
  getRemoteRunDetail,
  isRemoteRunActive,
  listPairedHosts,
  readRemoteTranscript,
  stopRemoteRun,
  type RemoteHost,
  type RemoteRun,
  type RemoteTranscriptEvent,
} from "@/lib/remote-sessions-api";
import { getSessionToken } from "@/lib/session-token-store";

type AuthState = "checking" | "connected" | "signed-out";

function HeaderButton({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      className="p-2 active:opacity-75"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {children}
    </Pressable>
  );
}

function ActionSheetRow({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      className="flex-row items-center gap-3 px-4 py-3.5 active:opacity-75"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {children}
      <Text className="text-foreground text-[15px]">{label}</Text>
    </Pressable>
  );
}

// The tabs layout pins the bar to a fixed height; the keyboard overlaps that
// strip first, so keyboard padding must be reduced by it.
const TAB_BAR_HEIGHT = 22;

function ComputerMessages({
  events,
  loading,
  host,
  onConnect,
  mutedForeground,
  run,
  sending,
  remoteError,
  onApprove,
  onDeny,
  onMessageActions,
}: {
  events: RemoteTranscriptEvent[];
  loading: boolean;
  host?: RemoteHost;
  onConnect: () => void;
  mutedForeground: string;
  run: RemoteRun | null;
  sending: boolean;
  remoteError: string | null;
  onApprove: (approvalKey: string) => void;
  onDeny: (approvalKey?: string) => void;
  onMessageActions?: (message: ChatMessage) => void;
}) {
  const remoteState = useMemo(
    () =>
      buildRemoteChatState({
        events,
        run,
        sending,
        error: remoteError,
      }),
    [events, remoteError, run, sending],
  );
  const remoteChat = useMemo<AgentChatController>(
    () => ({
      threadId: run?.id ?? events[0]?.runId ?? "remote-chat",
      baseUrl: "",
      messages: remoteState.messages,
      isStreaming: remoteState.isStreaming,
      activity: remoteState.activity,
      error: remoteState.error,
      errorCode: remoteState.errorCode,
      authRequired: false,
      historyLoading: loading,
      send: () => {},
      stop: () => {},
      approve: onApprove,
      deny: onDeny,
      retry: () => {},
      newChat: () => {},
      openThread: () => {},
      clearAuthRequired: () => {},
      getRunId: () => run?.id ?? null,
    }),
    [events, loading, onApprove, onDeny, remoteState, run?.id],
  );

  if (loading && events.length === 0) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={mutedForeground} />
      </View>
    );
  }

  if (events.length === 0) {
    return (
      <View className="flex-1 items-center justify-center px-7">
        <Text className="text-foreground text-[22px] font-bold text-center">
          {host ? "Ready for your computer" : "Connect a computer"}
        </Text>
        <Text className="mt-2 max-w-[290px] text-center text-[14px] leading-5 text-text-muted">
          {host
            ? `Messages will run on ${host.name}.`
            : "Pair a computer once, then chat with it here."}
        </Text>
        {remoteError ? (
          <Text className="mt-3 max-w-[300px] text-center text-error-text text-[12px] leading-4">
            {remoteError}
          </Text>
        ) : null}
        {!host ? (
          <Pressable
            className="mt-5 min-h-11 items-center justify-center rounded-xl bg-primary px-5 active:opacity-75"
            onPress={onConnect}
            accessibilityRole="button"
            accessibilityLabel="Connect a computer"
          >
            <Text className="text-primary-foreground text-[14px] font-bold">
              Connect computer
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <MessagesList
      chat={remoteChat}
      bottomInset={8}
      onMessageActions={onMessageActions}
    />
  );
}

export default function ChatTab() {
  const { foreground, mutedForeground } = useMobileThemeColors();
  const previewMode =
    __DEV__ && Platform.OS === "web" && typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("preview")
      : null;
  const isWebPreview = previewMode === "chat-empty";
  const isComputerPreview =
    previewMode === "chat-computer" || previewMode === "chat-computer-complete";
  const computerPreviewComplete = previewMode === "chat-computer-complete";
  const [authState, setAuthState] = useState<AuthState>(
    isWebPreview || isComputerPreview ? "connected" : "checking",
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [connectComputerOpen, setConnectComputerOpen] = useState(false);
  const [actionsFor, setActionsFor] = useState<ChatMessage | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settings, setSettings] = useChatSettings();
  const [chatTarget, setChatTarget] = useState<ChatTarget>(
    isComputerPreview ? "computer" : "cloud",
  );
  const [remoteHosts, setRemoteHosts] = useState<RemoteHost[]>([]);
  const [selectedRemoteHostId, setSelectedRemoteHostId] = useState<
    string | undefined
  >();
  const [remoteRun, setRemoteRun] = useState<RemoteRun | null>(null);
  const [remoteEvents, setRemoteEvents] = useState<RemoteTranscriptEvent[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteSending, setRemoteSending] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const chat = useAgentChat(settings);
  const signInPromptedRef = useRef(false);

  const startNewChat = useCallback(() => {
    setChatTarget("cloud");
    setRemoteRun(null);
    setRemoteEvents([]);
    setRemoteError(null);
    chat.newChat();
  }, [chat]);

  // A model/engine chosen for one app may not exist in another deployment.
  // Reset to the shared Luna/high default when the active thread's app changes
  // so we never submit a model selected for a different origin.
  const prevBaseUrlRef = useRef(chat.baseUrl);
  useEffect(() => {
    // Guard makes re-runs on unrelated `settings` changes a no-op, so reading
    // `settings` here is current without resetting the user's fresh pick.
    if (prevBaseUrlRef.current === chat.baseUrl) return;
    prevBaseUrlRef.current = chat.baseUrl;
    setSettings({ ...DEFAULT_CHAT_SETTINGS, mode: settings.mode });
  }, [chat.baseUrl, settings, setSettings]);

  const refreshAuth = useCallback(async () => {
    if (isWebPreview || isComputerPreview) {
      setAuthState("connected");
      return;
    }
    const token = await getSessionToken().catch(() => null);
    if (!token) {
      // Keep the shared parent credential intact. A validation failure can be
      // transient while another app is exchanging the same parent session;
      // only an explicit native sign-out may clear it.
      setAuthState("signed-out");
      return;
    }
    const result = await inspectNativeSession(token, NATIVE_AUTH_BASE_URL);
    if (result.status === "valid") {
      setAuthState("connected");
    } else if (result.status === "invalid") {
      setAuthState("signed-out");
    }
  }, [isComputerPreview, isWebPreview]);

  useEffect(() => {
    if (authState !== "checking") return;
    const retry = setTimeout(() => void refreshAuth(), 1_000);
    return () => clearTimeout(retry);
  }, [authState, refreshAuth]);

  useFocusEffect(
    useCallback(() => {
      void refreshAuth();
    }, [refreshAuth]),
  );

  // While signed out we render the web app so its session bridge can hand us
  // a token; poll until it lands, then switch to the Chat surface.
  useEffect(() => {
    if (authState !== "signed-out") return;
    let active = AppState.currentState === "active";
    let inFlight = false;
    const tick = () => {
      if (!active || inFlight) return;
      inFlight = true;
      void refreshAuth().finally(() => {
        inFlight = false;
      });
    };
    const interval = setInterval(tick, 800);
    const subscription = AppState.addEventListener("change", (state) => {
      active = state === "active";
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [authState, refreshAuth]);

  const { authRequired, clearAuthRequired } = chat;
  useEffect(() => {
    if (authRequired) {
      clearAuthRequired();
      setAuthState("signed-out");
    }
  }, [authRequired, clearAuthRequired]);

  useEffect(() => {
    if (authState === "connected") setSignInOpen(false);
  }, [authState]);

  useEffect(() => {
    if (authState === "connected") {
      signInPromptedRef.current = false;
      return;
    }
    if (authState === "signed-out" && !signInPromptedRef.current) {
      signInPromptedRef.current = true;
      setSignInOpen(true);
    }
  }, [authState]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2000);
    return () => clearTimeout(timer);
  }, [notice]);

  const selectedRemoteHost = remoteHosts.find(
    (host) => host.id === selectedRemoteHostId,
  );

  useEffect(() => {
    if (!isComputerPreview) return;
    const runId = "preview-remote-run";
    const hostId = "preview-computer";
    const baseTime = "2026-08-16T10:00:";
    const previewEvents: RemoteTranscriptEvent[] = [
      {
        id: "preview-user",
        runId,
        type: "user",
        text: "Inspect the workspace and run the checks.",
        createdAt: `${baseTime}00.000Z`,
      },
      {
        id: "preview-thinking",
        runId,
        type: "status",
        text: "I will inspect the workspace first.",
        createdAt: `${baseTime}01.000Z`,
        metadata: { type: "thinking" },
      },
      {
        id: "preview-tool-start",
        runId,
        type: "status",
        text: "Running exec_command.",
        createdAt: `${baseTime}02.000Z`,
        metadata: {
          type: "tool_start",
          tool: "exec_command",
          toolCallId: "preview-call",
          input: { cmd: "pnpm test" },
        },
      },
      ...(computerPreviewComplete
        ? [
            {
              id: "preview-tool-done",
              runId,
              type: "status" as const,
              text: "Finished exec_command.",
              createdAt: `${baseTime}08.000Z`,
              metadata: {
                type: "tool_done",
                tool: "exec_command",
                toolCallId: "preview-call",
                result: "All checks passed.",
              },
            },
            {
              id: "preview-answer",
              runId,
              type: "system" as const,
              text: "The workspace checks are green.",
              createdAt: `${baseTime}09.000Z`,
            },
          ]
        : []),
    ];
    setRemoteHosts([
      {
        id: hostId,
        name: "Studio Mac",
        status: "online",
      },
    ]);
    setSelectedRemoteHostId(hostId);
    setRemoteRun({
      id: runId,
      hostId,
      title: "Remote task",
      status: computerPreviewComplete ? "completed" : "running",
      createdAt: `${baseTime}00.000Z`,
      updatedAt: `${baseTime}${computerPreviewComplete ? "09" : "02"}.000Z`,
    });
    setRemoteEvents(previewEvents);
    setRemoteError(null);
  }, [computerPreviewComplete, isComputerPreview]);

  const refreshRemoteHosts = useCallback(async () => {
    const result = await listPairedHosts();
    if (!result.ok) {
      setRemoteError(result.error ?? "Could not load connected computers.");
      return;
    }
    const hosts = result.data ?? [];
    setRemoteHosts(hosts);
    setSelectedRemoteHostId((current) => {
      if (current && hosts.some((host) => host.id === current)) return current;
      return hosts.find((host) => host.status === "online")?.id ?? hosts[0]?.id;
    });
    setRemoteError(null);
  }, []);

  const refreshRemoteTranscript = useCallback(async (runId: string) => {
    setRemoteLoading(true);
    try {
      const [result, runResult] = await Promise.all([
        readRemoteTranscript(runId),
        getRemoteRunDetail(runId),
      ]);
      if (runResult.ok && runResult.data) {
        setRemoteRun(runResult.data);
      }
      if (result.ok) {
        setRemoteEvents(result.data ?? []);
        setRemoteError(null);
      } else {
        setRemoteError(result.error ?? "Could not load computer chat.");
      }
    } finally {
      setRemoteLoading(false);
    }
  }, []);

  useEffect(() => {
    if (
      isComputerPreview ||
      authState !== "connected" ||
      chatTarget !== "computer"
    )
      return;
    void refreshRemoteHosts();
  }, [authState, chatTarget, isComputerPreview, refreshRemoteHosts]);

  useEffect(() => {
    if (
      isComputerPreview ||
      authState !== "connected" ||
      chatTarget !== "computer" ||
      !remoteRun
    ) {
      return;
    }
    void refreshRemoteTranscript(remoteRun.id);
    const interval = setInterval(() => {
      void refreshRemoteTranscript(remoteRun.id);
    }, 2000);
    return () => clearInterval(interval);
  }, [
    authState,
    chatTarget,
    isComputerPreview,
    refreshRemoteTranscript,
    remoteRun,
  ]);

  const handleRemoteSend = useCallback(
    (text: string) => {
      const prompt = text.trim();
      if (!prompt || remoteSending) return;
      if (!selectedRemoteHostId) {
        setConnectComputerOpen(true);
        return;
      }

      void (async () => {
        setRemoteSending(true);
        setRemoteError(null);
        const result =
          remoteRun && isRemoteRunActive(remoteRun)
            ? await appendRemoteFollowUp({
                runId: remoteRun.id,
                hostId: selectedRemoteHostId,
                prompt,
                followUpMode: "immediate",
              })
            : await createRemoteRun({
                prompt,
                hostId: selectedRemoteHostId,
                permissionMode: "ask-before-edit",
                engine: settings.engine,
                model: settings.model,
                effort: settings.effort,
              });

        if (!result.ok) {
          if (result.status === 401) setAuthState("signed-out");
          setRemoteError(result.error ?? "Could not reach the computer.");
          setRemoteSending(false);
          return;
        }

        const responseData = result.data;
        const createdRun =
          responseData && "run" in responseData
            ? (responseData as { run?: RemoteRun }).run
            : undefined;
        const nextRun = createdRun ?? remoteRun;
        if (nextRun) {
          setRemoteRun(nextRun);
          await refreshRemoteTranscript(nextRun.id);
        }
        const responseEvent = responseData?.event;
        if (responseEvent) {
          setRemoteEvents((current) => [
            ...current.filter((event) => event.id !== responseEvent.id),
            responseEvent,
          ]);
        }
        setRemoteSending(false);
      })().catch(() => {
        setRemoteError("Could not reach the computer.");
        setRemoteSending(false);
      });
    },
    [
      remoteRun,
      remoteSending,
      refreshRemoteTranscript,
      selectedRemoteHostId,
      settings.engine,
      settings.effort,
      settings.model,
    ],
  );

  const handleRemoteStop = useCallback(() => {
    if (!remoteRun) return;
    setRemoteSending(false);
    void stopRemoteRun(remoteRun.id, selectedRemoteHostId).catch(() => {});
  }, [remoteRun, selectedRemoteHostId]);

  const handleRemoteApprove = useCallback(
    (approvalKey: string) => {
      if (!remoteRun) return;
      void decidePendingCommand({
        runId: remoteRun.id,
        hostId: selectedRemoteHostId,
        commandId: getPendingCommand(remoteRun)?.id ?? approvalKey,
        decision: "approve",
      })
        .then((result) => {
          if (!result.ok) {
            setRemoteError(result.error ?? "Could not approve the command.");
            return;
          }
          setRemoteError(null);
          void refreshRemoteTranscript(remoteRun.id);
        })
        .catch(() => setRemoteError("Could not approve the command."));
    },
    [refreshRemoteTranscript, remoteRun, selectedRemoteHostId],
  );

  const handleRemoteDeny = useCallback(
    (approvalKey?: string) => {
      if (!remoteRun) return;
      void decidePendingCommand({
        runId: remoteRun.id,
        hostId: selectedRemoteHostId,
        commandId: getPendingCommand(remoteRun)?.id ?? approvalKey,
        decision: "deny",
        reason: "Denied from mobile chat.",
      })
        .then((result) => {
          if (!result.ok) {
            setRemoteError(result.error ?? "Could not deny the command.");
            return;
          }
          setRemoteError(null);
          void refreshRemoteTranscript(remoteRun.id);
        })
        .catch(() => setRemoteError("Could not deny the command."));
    },
    [refreshRemoteTranscript, remoteRun, selectedRemoteHostId],
  );

  const showNotice = (message: string) => setNotice(message);

  const shareThread = () => {
    if (chat.messages.length === 0) return;
    void createThreadShareLink(chat.threadId, chat.baseUrl)
      .then((url) => {
        if (url) return Share.share({ message: url });
        showNotice("Could not create share link");
        return undefined;
      })
      .catch(() => showNotice("Could not create share link"));
  };

  const copyMessage = (message: ChatMessage) => {
    setActionsFor(null);
    void Clipboard.setStringAsync(messageText(message)).then(() =>
      showNotice("Message copied"),
    );
  };

  const copyRequestId = (message: ChatMessage) => {
    setActionsFor(null);
    const runId = chat.getRunId(message.id);
    if (!runId) {
      showNotice("Request id unavailable for this message");
      return;
    }
    void Clipboard.setStringAsync(runId).then(() =>
      showNotice("Request id copied"),
    );
  };

  const forkChat = () => {
    setActionsFor(null);
    void forkChatThread(chat.threadId, chat.baseUrl)
      .then((forkedId) => {
        if (forkedId) {
          chat.openThread(forkedId, chat.baseUrl);
          showNotice("Chat forked");
        } else {
          showNotice("Could not fork chat");
        }
      })
      .catch(() => showNotice("Could not fork chat"));
  };

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background-dark">
      <View className="flex-row items-center gap-0.5 px-2 py-1.5">
        <HeaderButton
          label="Open chat history"
          onPress={() => setHistoryOpen(true)}
        >
          <IconMenu2 color={foreground} size={21} strokeWidth={1.9} />
        </HeaderButton>
        <View className="flex-1" />
        {chat.messages.length > 0 || remoteEvents.length > 0 ? (
          <>
            <HeaderButton label="Share chat" onPress={shareThread}>
              <IconShare2 color={foreground} size={19} strokeWidth={1.9} />
            </HeaderButton>
            <HeaderButton label="New chat" onPress={startNewChat}>
              <IconSquareRoundedPlus
                color={foreground}
                size={20}
                strokeWidth={1.9}
              />
            </HeaderButton>
          </>
        ) : null}
      </View>

      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={TAB_BAR_HEIGHT}
        className="flex-1"
      >
        {authState === "checking" ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color={mutedForeground} />
            <Text className="text-status-gray text-[13px] mt-2.5">
              Opening Chat…
            </Text>
          </View>
        ) : authState === "signed-out" ? (
          <View className="flex-1 items-center justify-center px-7">
            <Text className="text-center text-[22px] font-bold text-foreground">
              Sign in to start chatting
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign in to Chat"
              onPress={() => setSignInOpen(true)}
              className="mt-6 min-h-11 items-center justify-center rounded-xl bg-primary px-5 active:opacity-75"
            >
              <Text className="text-[14px] font-bold text-primary-foreground">
                Sign in
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            {chatTarget === "computer" ? (
              <ComputerMessages
                events={remoteEvents}
                loading={remoteLoading}
                host={selectedRemoteHost}
                onConnect={() => setConnectComputerOpen(true)}
                mutedForeground={mutedForeground}
                run={remoteRun}
                sending={remoteSending}
                remoteError={remoteError}
                onApprove={handleRemoteApprove}
                onDeny={handleRemoteDeny}
                onMessageActions={setActionsFor}
              />
            ) : chat.historyLoading ? (
              <View className="flex-1 items-center justify-center">
                <ActivityIndicator color={mutedForeground} />
              </View>
            ) : (
              <MessagesList
                chat={chat}
                bottomInset={8}
                onMessageActions={setActionsFor}
              />
            )}
          </>
        )}
        {authState === "connected" ? (
          <>
            <MobileWorkspaceControls
              target={chatTarget}
              hosts={remoteHosts}
              selectedHostId={selectedRemoteHostId}
              onTargetChange={setChatTarget}
              onHostChange={setSelectedRemoteHostId}
              onConnectComputer={() => setConnectComputerOpen(true)}
            />
            <Composer
              isStreaming={
                chatTarget === "computer" ? remoteSending : chat.isStreaming
              }
              settings={settings}
              baseUrl={chat.baseUrl}
              onSend={chatTarget === "computer" ? handleRemoteSend : chat.send}
              onStop={chatTarget === "computer" ? handleRemoteStop : chat.stop}
              onOpenSettings={() => setSettingsOpen(true)}
              onToggleMode={() =>
                setSettings({
                  ...settings,
                  mode: settings.mode === "plan" ? undefined : "plan",
                })
              }
              onSelectMode={(mode) => setSettings({ ...settings, mode })}
            />
          </>
        ) : null}
      </KeyboardAvoidingView>

      {notice && (
        <View className="absolute bottom-24 self-center rounded-full bg-card-dark border border-border-dark px-4 py-2">
          <Text className="text-text-light text-[13px]">{notice}</Text>
        </View>
      )}

      <MobilePopover
        visible={actionsFor !== null}
        title="Message actions"
        onClose={() => setActionsFor(null)}
        bottomClassName="mb-8"
        overlayClassName="bg-overlay-dark"
        accessibilityLabel="Dismiss message actions"
      >
        <ActionSheetRow
          label="Copy Message"
          onPress={() => actionsFor && copyMessage(actionsFor)}
        >
          <IconCopy color={foreground} size={18} strokeWidth={1.9} />
        </ActionSheetRow>
        <View className="h-px bg-border-dark" />
        <ActionSheetRow
          label="Copy Request ID"
          onPress={() => actionsFor && copyRequestId(actionsFor)}
        >
          <IconId color={foreground} size={18} strokeWidth={1.9} />
        </ActionSheetRow>
        <View className="h-px bg-border-dark" />
        <ActionSheetRow label="Fork Chat" onPress={forkChat}>
          <IconGitFork color={foreground} size={18} strokeWidth={1.9} />
        </ActionSheetRow>
      </MobilePopover>

      <ThreadHistorySheet
        visible={historyOpen}
        activeThreadId={chat.threadId}
        activeBaseUrl={chat.baseUrl}
        onSelect={chat.openThread}
        onNewChat={chat.newChat}
        onClose={() => setHistoryOpen(false)}
      />
      <ChatSettingsSheet
        visible={settingsOpen}
        settings={settings}
        baseUrl={chat.baseUrl}
        onChange={setSettings}
        onClose={() => setSettingsOpen(false)}
      />

      <NativeSignInSheet
        visible={signInOpen}
        onClose={() => setSignInOpen(false)}
        onSignedIn={async () => {
          setSignInOpen(false);
          await refreshAuth();
        }}
      />
      <ComputerConnectSheet
        visible={connectComputerOpen}
        onClose={() => setConnectComputerOpen(false)}
        onRefresh={refreshRemoteHosts}
      />
    </SafeAreaView>
  );
}
