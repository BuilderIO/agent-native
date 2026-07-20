import { IconTrash, IconX } from "@tabler/icons-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { AppIcon } from "@/components/AppCard";
import { SafeAreaView } from "@/components/uniwind-interop";
import {
  chatCapableApps,
  deleteChatThread,
  listThreadsForApp,
} from "@/lib/agent-chat/api";
import { groupThreadsByApp, threadKey } from "@/lib/agent-chat/thread-grouping";
import type { ChatThreadSummary } from "@/lib/agent-chat/types";

function formatWhen(timestamp: number): string {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function AppFilterChip({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center gap-1.5 rounded-full px-3 py-1.5 active:opacity-75 ${
        selected ? "bg-white" : "bg-card-dark border border-border-dark"
      }`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`Show ${label} chats`}
    >
      {icon ? (
        <AppIcon
          iconName={icon}
          size={13}
          color={selected ? "#18181b" : "#a1a1aa"}
        />
      ) : null}
      <Text
        className={`text-[13px] font-semibold ${
          selected ? "text-background-dark" : "text-text-light"
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function ThreadHistorySheet({
  visible,
  activeThreadId,
  activeBaseUrl,
  onSelect,
  onClose,
}: {
  visible: boolean;
  activeThreadId: string;
  activeBaseUrl: string;
  onSelect: (threadId: string, baseUrl?: string) => void;
  onClose: () => void;
}) {
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmingDeleteKey, setConfirmingDeleteKey] = useState<string | null>(
    null,
  );
  // History shows one app at a time, defaulting to Chat.
  const [selectedAppId, setSelectedAppId] = useState<string>("chat");

  // Chat first (the default view), then the rest in registry order.
  const apps = useMemo(
    () =>
      [...chatCapableApps()].sort((a, b) =>
        a.id === "chat" ? -1 : b.id === "chat" ? 1 : 0,
      ),
    [],
  );

  const refresh = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    listThreadsForApp(selectedAppId)
      .then(setThreads)
      .catch((error) => {
        setLoadError(
          error instanceof Error ? error.message : "Failed to load chats",
        );
      })
      .finally(() => setLoading(false));
  }, [selectedAppId]);

  useEffect(() => {
    if (visible) {
      setConfirmingDeleteKey(null);
      refresh();
    }
  }, [visible, refresh]);

  // The chip row already names the app, so the per-app section header is
  // redundant — keep only the thread rows.
  const rows = useMemo(
    () => groupThreadsByApp(threads).filter((r) => r.type !== "header"),
    [threads],
  );

  const handleDelete = (thread: ChatThreadSummary) => {
    const key = threadKey(thread);
    if (confirmingDeleteKey !== key) {
      setConfirmingDeleteKey(key);
      return;
    }
    setConfirmingDeleteKey(null);
    setThreads((current) => current.filter((t) => threadKey(t) !== key));
    void deleteChatThread(thread.id, thread.baseUrl).catch(() => refresh());
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="formSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView
        edges={["top", "bottom"]}
        className="flex-1 bg-background-dark"
      >
        <View className="flex-row items-center justify-between px-4 pt-3 pb-2 border-b border-border-dark">
          <Text className="text-white text-lg font-bold">Chats</Text>
          <Pressable
            className="p-1.5 active:opacity-75"
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close chat history"
          >
            <IconX color="#71717a" size={20} strokeWidth={2} />
          </Pressable>
        </View>

        <View className="border-b border-border-dark">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="flex-row items-center gap-2 px-3 py-3"
          >
            {apps.map((app) => (
              <AppFilterChip
                key={app.id}
                label={app.name}
                icon={app.icon}
                selected={selectedAppId === app.id}
                onPress={() => setSelectedAppId(app.id)}
              />
            ))}
          </ScrollView>
        </View>

        {loading && threads.length === 0 ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#c7f36b" />
          </View>
        ) : loadError ? (
          <View className="flex-1 items-center justify-center px-8 gap-3">
            <Text className="text-error-text text-sm text-center">
              {loadError}
            </Text>
            <Pressable
              className="h-9 px-4 rounded-lg border border-gray-border-light items-center justify-center active:opacity-75"
              onPress={refresh}
            >
              <Text className="text-text-light text-[13px] font-semibold">
                Retry
              </Text>
            </Pressable>
          </View>
        ) : threads.length === 0 ? (
          <View className="flex-1 items-center justify-center px-8">
            <Text className="text-status-gray text-sm text-center">
              {`No ${apps.find((a) => a.id === selectedAppId)?.name ?? "app"} chats yet. Start a conversation there and it will show up here.`}
            </Text>
          </View>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(row) => row.key}
            renderItem={({ item }) => {
              const thread = item.thread;
              const isActive =
                thread.id === activeThreadId &&
                (thread.baseUrl ?? "") === activeBaseUrl;
              const confirming = confirmingDeleteKey === item.key;
              return (
                <Pressable
                  className={`flex-row items-center gap-3 px-4 py-3 border-b border-border-dark active:opacity-75 ${
                    isActive ? "bg-card-dark" : ""
                  }`}
                  onPress={() => {
                    onSelect(thread.id, thread.baseUrl);
                    onClose();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Open chat ${thread.title}`}
                >
                  <View className="flex-1">
                    <Text
                      className="text-white text-[15px] font-medium"
                      numberOfLines={1}
                    >
                      {thread.title}
                    </Text>
                    {thread.preview ? (
                      <Text
                        className="text-status-gray text-[13px] mt-0.5"
                        numberOfLines={1}
                      >
                        {thread.preview}
                      </Text>
                    ) : null}
                  </View>
                  <Text className="text-status-gray text-xs">
                    {formatWhen(thread.updatedAt)}
                  </Text>
                  <Pressable
                    className="p-1.5 active:opacity-75"
                    onPress={() => handleDelete(thread)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      confirming
                        ? "Confirm delete"
                        : `Delete chat ${thread.title}`
                    }
                  >
                    <IconTrash
                      color={confirming ? "#fb7185" : "#71717a"}
                      size={17}
                      strokeWidth={1.8}
                    />
                  </Pressable>
                </Pressable>
              );
            }}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}
