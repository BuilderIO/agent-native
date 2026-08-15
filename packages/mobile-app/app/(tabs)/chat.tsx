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
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Modal,
  Pressable,
  Share,
  Text,
  View,
} from "react-native";
import {
  KeyboardAvoidingView,
  useReanimatedKeyboardAnimation,
} from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle } from "react-native-reanimated";

import AppWebView from "@/components/AppWebView";
import {
  ChatSettingsSheet,
  DEFAULT_CHAT_SETTINGS,
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
import { useTabBarLayout } from "@/lib/tab-bar-layout";

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

export default function ChatTab() {
  const { contentInset } = useTabBarLayout();
  const { progress: keyboardProgress } = useReanimatedKeyboardAnimation();
  const tabBarSpacerStyle = useAnimatedStyle(() => ({
    height: contentInset * (1 - keyboardProgress.value),
  }));
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [actionsFor, setActionsFor] = useState<ChatMessage | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settings, setSettings] = useChatSettings();
  const chat = useAgentChat(settings);

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
          <ActivityIndicator color="#d4d4d8" />
          <Text className="text-status-gray text-[13px] mt-2.5">
            Opening Chat…
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (authState === "signed-out") {
    return (
      <SafeAreaView
        className="flex-1 bg-background-dark"
        style={{ paddingBottom: contentInset }}
      >
        <AppWebView url={getAppUrl(chatApp)} captureSessionToken />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background-dark">
      <View className="flex-row items-center gap-0.5 px-2 py-1.5">
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

      <KeyboardAvoidingView behavior="padding" className="flex-1">
        {chat.historyLoading ? (
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
        {/* The glass tab bar floats over the screen, so the composer has to
            hold its own space — and give it back while the keyboard covers
            the bar anyway. */}
        <Animated.View style={tabBarSpacerStyle} />
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
        baseUrl={chat.baseUrl}
        onChange={setSettings}
        onClose={() => setSettingsOpen(false)}
      />
    </SafeAreaView>
  );
}
