import { TEMPLATE_APPS } from "@agent-native/shared-app-config";
import {
  IconCopy,
  IconGitFork,
  IconId,
  IconMenu2,
  IconShare2,
  IconSquareRoundedPlus,
} from "@tabler/icons-react-native";
import * as Clipboard from "expo-clipboard";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Modal,
  Pressable,
  Platform,
  ScrollView,
  Share,
  Text,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import AppWebView from "@/components/AppWebView";
import {
  ChatSettingsSheet,
  DEFAULT_CHAT_SETTINGS,
  useChatSettings,
} from "@/components/chat/ChatSettingsSheet";
import { Composer } from "@/components/chat/Composer";
import { MessagesList } from "@/components/chat/MessagesList";
import {
  MobileWorkspaceControls,
  type ChatTarget,
} from "@/components/chat/MobileWorkspaceControls";
import { ThreadHistorySheet } from "@/components/chat/ThreadHistorySheet";
import { SafeAreaView } from "@/components/uniwind-interop";
import { createThreadShareLink, forkChatThread } from "@/lib/agent-chat/api";
import type { ChatMessage } from "@/lib/agent-chat/types";
import { messageText } from "@/lib/agent-chat/types";
import { useAgentChat } from "@/lib/agent-chat/use-agent-chat";
import { getAppUrl } from "@/lib/get-app-url";
import {
  appendRemoteFollowUp,
  createRemoteRun,
  isRemoteRunActive,
  listPairedHosts,
  readRemoteTranscript,
  stopRemoteRun,
  type RemoteHost,
  type RemoteRun,
  type RemoteTranscriptEvent,
} from "@/lib/remote-sessions-api";
import { getSessionToken } from "@/lib/session-token-store";

const chatApp = TEMPLATE_APPS.find((a) => a.id === "chat")!;

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
      <Text className="text-white text-[15px]">{label}</Text>
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
}: {
  events: RemoteTranscriptEvent[];
  loading: boolean;
  host?: RemoteHost;
  onConnect: () => void;
}) {
  if (loading && events.length === 0) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color="#d4d4d8" />
      </View>
    );
  }

  if (events.length === 0) {
    return (
      <View className="flex-1 items-center justify-center px-7">
        <Text className="text-white text-[22px] font-bold text-center">
          {host ? "Ready for your computer" : "Connect a computer"}
        </Text>
        <Text className="mt-2 max-w-[290px] text-center text-[14px] leading-5 text-text-muted">
          {host
            ? `Messages will run on ${host.name}.`
            : "Pair a computer once, then chat with it here."}
        </Text>
        {!host ? (
          <Pressable
            className="mt-5 min-h-11 items-center justify-center rounded-xl bg-white px-5 active:opacity-75"
            onPress={onConnect}
            accessibilityRole="button"
            accessibilityLabel="Connect a computer"
          >
            <Text className="text-background-dark text-[14px] font-bold">
              Connect computer
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{
        paddingTop: 12,
        paddingHorizontal: 16,
        paddingBottom: 12,
      }}
      showsVerticalScrollIndicator={false}
    >
      {events.map((event) => {
        const isUser = event.type === "user";
        return (
          <View
            key={event.id}
            className={`mb-3 max-w-[88%] rounded-2xl px-3.5 py-3 ${
              isUser ? "self-end bg-white" : "self-start bg-card-dark"
            }`}
          >
            {event.title && !isUser ? (
              <Text className="mb-1 text-status-gray text-[11px] font-semibold uppercase tracking-wide">
                {event.title}
              </Text>
            ) : null}
            <Text
              className={`text-[14px] leading-5 ${
                isUser ? "text-background-dark" : "text-text-light"
              }`}
            >
              {event.text}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

export default function ChatTab() {
  const router = useRouter();
  const isWebPreview =
    __DEV__ &&
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("preview") === "chat-empty";
  const [authState, setAuthState] = useState<AuthState>(
    isWebPreview ? "connected" : "checking",
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [actionsFor, setActionsFor] = useState<ChatMessage | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settings, setSettings] = useChatSettings();
  const [chatTarget, setChatTarget] = useState<ChatTarget>("cloud");
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
    if (isWebPreview) {
      setAuthState("connected");
      return;
    }
    const token = await getSessionToken().catch(() => null);
    setAuthState(token ? "connected" : "signed-out");
  }, [isWebPreview]);

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
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2000);
    return () => clearTimeout(timer);
  }, [notice]);

  const selectedRemoteHost = remoteHosts.find(
    (host) => host.id === selectedRemoteHostId,
  );

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
      const result = await readRemoteTranscript(runId);
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
    if (authState !== "connected" || chatTarget !== "computer") return;
    void refreshRemoteHosts();
  }, [authState, chatTarget, refreshRemoteHosts]);

  useEffect(() => {
    if (authState !== "connected" || chatTarget !== "computer" || !remoteRun) {
      return;
    }
    void refreshRemoteTranscript(remoteRun.id);
    const interval = setInterval(() => {
      void refreshRemoteTranscript(remoteRun.id);
    }, 2000);
    return () => clearInterval(interval);
  }, [authState, chatTarget, refreshRemoteTranscript, remoteRun]);

  const handleRemoteSend = useCallback(
    (text: string) => {
      const prompt = text.trim();
      if (!prompt || remoteSending) return;
      if (!selectedRemoteHostId) {
        setNotice("Connect a computer first");
        router.push("/sessions" as never);
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
      router,
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
          <IconMenu2 color="#fafafa" size={21} strokeWidth={1.9} />
        </HeaderButton>
        <Text className="flex-1 text-white text-[17px] font-bold pl-2">
          Chat
        </Text>
        <HeaderButton label="Share chat" onPress={shareThread}>
          <IconShare2 color="#fafafa" size={19} strokeWidth={1.9} />
        </HeaderButton>
        <HeaderButton label="New chat" onPress={startNewChat}>
          <IconSquareRoundedPlus color="#fafafa" size={20} strokeWidth={1.9} />
        </HeaderButton>
      </View>

      {authState === "connected" ? (
        <MobileWorkspaceControls
          target={chatTarget}
          hosts={remoteHosts}
          selectedHostId={selectedRemoteHostId}
          onTargetChange={setChatTarget}
          onHostChange={setSelectedRemoteHostId}
          onConnectComputer={() => router.push("/sessions" as never)}
        />
      ) : null}

      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={TAB_BAR_HEIGHT}
        className="flex-1"
      >
        {authState === "checking" ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#d4d4d8" />
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
              <Text className="text-[14px] font-bold text-background-dark">
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
                onConnect={() => router.push("/sessions" as never)}
              />
            ) : chat.historyLoading ? (
              <View className="flex-1 items-center justify-center">
                <ActivityIndicator color="#d4d4d8" />
              </View>
            ) : (
              <MessagesList
                chat={chat}
                bottomInset={8}
                onMessageActions={setActionsFor}
              />
            )}
            {chatTarget === "computer" && remoteError ? (
              <Text className="px-5 pb-1 text-center text-error-text text-[12px]">
                {remoteError}
              </Text>
            ) : null}
          </>
        )}
        {authState === "connected" ? (
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
          />
        ) : null}
      </KeyboardAvoidingView>

      {notice && (
        <View className="absolute bottom-24 self-center rounded-full bg-card-dark border border-border-dark px-4 py-2">
          <Text className="text-text-light text-[13px]">{notice}</Text>
        </View>
      )}

      <Modal
        visible={actionsFor !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setActionsFor(null)}
      >
        <Pressable
          className="flex-1 bg-overlay-dark justify-end"
          onPress={() => setActionsFor(null)}
          accessibilityLabel="Dismiss message actions"
        >
          <View className="mx-3 mb-8 rounded-2xl bg-card-dark border border-border-dark overflow-hidden">
            <ActionSheetRow
              label="Copy Message"
              onPress={() => actionsFor && copyMessage(actionsFor)}
            >
              <IconCopy color="#fafafa" size={18} strokeWidth={1.9} />
            </ActionSheetRow>
            <View className="h-px bg-border-dark" />
            <ActionSheetRow
              label="Copy Request ID"
              onPress={() => actionsFor && copyRequestId(actionsFor)}
            >
              <IconId color="#fafafa" size={18} strokeWidth={1.9} />
            </ActionSheetRow>
            <View className="h-px bg-border-dark" />
            <ActionSheetRow label="Fork Chat" onPress={forkChat}>
              <IconGitFork color="#fafafa" size={18} strokeWidth={1.9} />
            </ActionSheetRow>
          </View>
        </Pressable>
      </Modal>

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

      <Modal
        visible={signInOpen}
        animationType="slide"
        onRequestClose={() => setSignInOpen(false)}
      >
        <SafeAreaView
          edges={["top", "bottom"]}
          className="flex-1 bg-background-dark"
        >
          <View className="flex-row items-center justify-between border-b border-border-dark px-3 py-2">
            <Text className="px-2 text-[17px] font-bold text-foreground">
              Sign in to Chat
            </Text>
            <HeaderButton
              label="Close sign in"
              onPress={() => setSignInOpen(false)}
            >
              <Text className="text-[15px] font-semibold text-text-muted">
                Close
              </Text>
            </HeaderButton>
          </View>
          <AppWebView url={getAppUrl(chatApp)} captureSessionToken />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
