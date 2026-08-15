import { IconPlus, IconTrash, IconX } from "@tabler/icons-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  listAllThreadsWithStatus,
  listThreadsForApp,
} from "@/lib/agent-chat/api";
import { threadKey } from "@/lib/agent-chat/thread-grouping";
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
  onNewChat,
  onClose,
}: {
  visible: boolean;
  activeThreadId: string;
  activeBaseUrl: string;
  onSelect: (threadId: string, baseUrl?: string) => void;
  onNewChat: (baseUrl?: string) => void;
  onClose: () => void;
}) {
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [partialError, setPartialError] = useState(false);
  const [confirmingDeleteKey, setConfirmingDeleteKey] = useState<string | null>(
    null,
  );
  // Start with the complete workspace history, then let the user narrow it.
  const [selectedAppId, setSelectedAppId] = useState<"all" | string>("all");
  // Discards results from a superseded app-filter request.
  const requestIdRef = useRef(0);

  // Chat first (the default view), then the rest in registry order.
  const apps = useMemo(
    () =>
      [...chatCapableApps()].sort((a, b) =>
        a.id === "chat" ? -1 : b.id === "chat" ? 1 : 0,
      ),
    [],
  );

  const refresh = useCallback(() => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadError(null);
    setPartialError(false);
    const resultPromise =
      selectedAppId === "all"
        ? listAllThreadsWithStatus()
        : listThreadsForApp(selectedAppId).then((result) => ({
            threads: result,
            failedAppIds: [],
          }));
    resultPromise
      .then((result) => {
        if (requestIdRef.current !== requestId) return;
        setThreads(result.threads);
        setPartialError(result.failedAppIds.length > 0);
      })
      .catch((error) => {
        if (requestIdRef.current !== requestId) return;
        setLoadError(
          error instanceof Error ? error.message : "Failed to load chats",
        );
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setLoading(false);
      });
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
    () =>
      threads.map((thread) => ({
        type: "thread" as const,
        thread,
        key: threadKey(thread),
      })),
    [threads],
  );

  const selectedApp = apps.find((app) => app.id === selectedAppId);

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
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View className="flex-1 flex-row">
        <View className="w-[88%] max-w-[380px] bg-background-dark">
          <SafeAreaView edges={["top", "bottom"]} className="flex-1">
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

            <Pressable
              className="flex-row items-center gap-3 px-4 py-3.5 border-b border-border-dark active:opacity-75"
              onPress={() => {
                onNewChat(selectedApp?.url);
                onClose();
              }}
              accessibilityRole="button"
              accessibilityLabel="Start a new chat"
            >
              <View className="h-8 w-8 items-center justify-center rounded-lg bg-white">
                <IconPlus color="#18181b" size={18} strokeWidth={2.2} />
              </View>
              <Text className="text-white text-[15px] font-semibold">
                New chat
              </Text>
            </Pressable>

            <View className="border-b border-border-dark">
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerClassName="flex-row items-center gap-2 px-3 py-3"
              >
                <AppFilterChip
                  label="All"
                  selected={selectedAppId === "all"}
                  onPress={() => setSelectedAppId("all")}
                />
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

            {partialError ? (
              <View className="flex-row items-center justify-between gap-3 px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20">
                <Text className="flex-1 text-amber-200 text-xs">
                  Some app chats could not be loaded.
                </Text>
                <Pressable onPress={refresh} accessibilityRole="button">
                  <Text className="text-amber-200 text-xs font-semibold">
                    Retry
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {loading && threads.length === 0 ? (
              <View className="flex-1 items-center justify-center">
                <ActivityIndicator color="#d4d4d8" />
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
                  {selectedAppId === "all"
                    ? "No chats yet. Start a conversation and it will show up here."
                    : `No ${selectedApp?.name ?? "app"} chats yet. Start a conversation there and it will show up here.`}
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
                    <View
                      className={`flex-row items-center gap-3 px-4 py-3 border-b border-border-dark active:opacity-75 ${
                        isActive ? "bg-card-dark" : ""
                      }`}
                    >
                      <Pressable
                        className="flex-1 flex-row items-center gap-3 active:opacity-75"
                        onPress={() => {
                          onSelect(thread.id, thread.baseUrl);
                          onClose();
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Open chat ${thread.title}`}
                      >
                        <View className="flex-1">
                          {selectedAppId === "all" && thread.appName ? (
                            <View className="flex-row items-center gap-1.5 mb-0.5">
                              <AppIcon
                                iconName={thread.appIcon ?? "MessageSquare"}
                                size={12}
                                color="#a1a1aa"
                              />
                              <Text className="text-status-gray text-[11px]">
                                {thread.appName}
                              </Text>
                            </View>
                          ) : null}
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
                      </Pressable>
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
                    </View>
                  );
                }}
              />
            )}
          </SafeAreaView>
        </View>
        <Pressable
          className="flex-1 bg-black/60"
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close chat history"
        />
      </View>
    </Modal>
  );
}
