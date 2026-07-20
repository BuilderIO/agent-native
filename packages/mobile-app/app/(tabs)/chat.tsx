import { TEMPLATE_APPS } from "@agent-native/shared-app-config";
import {
  IconCopy,
  IconGitFork,
  IconHistory,
  IconId,
  IconShare2,
  IconSquareRoundedPlus,
} from "@tabler/icons-react-native";
import * as Clipboard from "expo-clipboard";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Share,
  Text,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import AppWebView from "@/components/AppWebView";
import {
  ChatSettingsSheet,
  useChatSettings,
} from "@/components/chat/ChatSettingsSheet";
import { Composer } from "@/components/chat/Composer";
import { MessagesList } from "@/components/chat/MessagesList";
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
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [actionsFor, setActionsFor] = useState<ChatMessage | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settings, setSettings] = useChatSettings();
  const chat = useAgentChat(settings);

  const refreshAuth = useCallback(async () => {
    const token = await getSessionToken().catch(() => null);
    setAuthState(token ? "connected" : "signed-out");
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshAuth();
    }, [refreshAuth]),
  );

  // While signed out we render the web app so its session bridge can hand us
  // a token; poll until it lands, then switch to the native chat.
  useEffect(() => {
    if (authState !== "signed-out") return;
    const interval = setInterval(() => void refreshAuth(), 800);
    return () => clearInterval(interval);
  }, [authState, refreshAuth]);

  const { authRequired, clearAuthRequired } = chat;
  useEffect(() => {
    if (authRequired) {
      clearAuthRequired();
      setAuthState("signed-out");
    }
  }, [authRequired, clearAuthRequired]);

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

  if (authState === "checking") {
    return (
      <SafeAreaView className="flex-1 bg-background-dark">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#c7f36b" />
          <Text className="text-status-gray text-[13px] mt-2.5">
            Opening Chat…
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (authState === "signed-out") {
    return (
      <SafeAreaView className="flex-1 bg-background-dark">
        <AppWebView url={getAppUrl(chatApp)} captureSessionToken />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background-dark">
      <View className="flex-row items-center gap-0.5 px-2 py-1.5 border-b border-border-dark">
        <Text className="flex-1 text-white text-[17px] font-bold pl-2">
          Chat
        </Text>
        <HeaderButton label="Share chat" onPress={shareThread}>
          <IconShare2 color="#fafafa" size={19} strokeWidth={1.9} />
        </HeaderButton>
        <HeaderButton label="Chat history" onPress={() => setHistoryOpen(true)}>
          <IconHistory color="#fafafa" size={20} strokeWidth={1.9} />
        </HeaderButton>
        <HeaderButton label="New chat" onPress={chat.newChat}>
          <IconSquareRoundedPlus color="#fafafa" size={20} strokeWidth={1.9} />
        </HeaderButton>
      </View>

      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={TAB_BAR_HEIGHT}
        className="flex-1"
      >
        {chat.historyLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#c7f36b" />
          </View>
        ) : (
          <MessagesList
            chat={chat}
            bottomInset={8}
            onMessageActions={setActionsFor}
          />
        )}
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
        onClose={() => setHistoryOpen(false)}
      />
      <ChatSettingsSheet
        visible={settingsOpen}
        settings={settings}
        onChange={setSettings}
        onClose={() => setSettingsOpen(false)}
      />
    </SafeAreaView>
  );
}
