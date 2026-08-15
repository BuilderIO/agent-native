import { TEMPLATE_APPS } from "@agent-native/shared-app-config";
import {
  IconCopy,
  IconGitFork,
  IconId,
  IconMessageCircle,
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
  type MobileExecutionTarget,
} from "@/components/chat/MobileWorkspaceControls";
import { ThreadHistorySheet } from "@/components/chat/ThreadHistorySheet";
import { SafeAreaView } from "@/components/uniwind-interop";
import { createThreadShareLink, forkChatThread } from "@/lib/agent-chat/api";
import type { ChatMessage } from "@/lib/agent-chat/types";
import { messageText } from "@/lib/agent-chat/types";
import { useAgentChat } from "@/lib/agent-chat/use-agent-chat";
import { getAppUrl } from "@/lib/get-app-url";
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
  const [workspaceFolder, setWorkspaceFolder] = useState("");
  const [workspaceTarget, setWorkspaceTarget] =
    useState<MobileExecutionTarget>("local");
  const chat = useAgentChat(settings);

  const startNewChat = useCallback(() => {
    setWorkspaceFolder("");
    setWorkspaceTarget("local");
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
  // a token; poll until it lands, then switch to the native chat.
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
            <View className="h-14 w-14 items-center justify-center rounded-2xl bg-gray-charcoal">
              <IconMessageCircle color="#d4d4d8" size={27} strokeWidth={1.7} />
            </View>
            <Text className="mt-5 text-center text-2xl font-bold text-foreground">
              Native Chat
            </Text>
            <Text className="mt-2 max-w-[300px] text-center text-[15px] leading-6 text-text-muted">
              Sign in once to use the native chat experience on your phone.
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
        ) : chat.historyLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#d4d4d8" />
          </View>
        ) : (
          <MessagesList
            chat={chat}
            bottomInset={8}
            onMessageActions={setActionsFor}
            onConnectDesktop={() => router.push("/sessions" as never)}
          />
        )}
        {authState === "connected" &&
          chat.messages.length === 0 &&
          !chat.historyLoading && (
            <MobileWorkspaceControls
              folder={workspaceFolder}
              target={workspaceTarget}
              onFolderChange={setWorkspaceFolder}
              onTargetChange={setWorkspaceTarget}
            />
          )}
        {authState === "connected" ? (
          <Composer
            isStreaming={chat.isStreaming}
            settings={settings}
            baseUrl={chat.baseUrl}
            onSend={chat.send}
            onStop={chat.stop}
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
        <SafeAreaView className="flex-1 bg-background-dark">
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
