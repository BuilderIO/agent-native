import { IconTrash, IconX } from "@tabler/icons-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  Text,
  View,
} from "react-native";

import { SafeAreaView } from "@/components/uniwind-interop";
import { deleteChatThread, listChatThreads } from "@/lib/agent-chat/api";
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

export function ThreadHistorySheet({
  visible,
  activeThreadId,
  onSelect,
  onClose,
}: {
  visible: boolean;
  activeThreadId: string;
  onSelect: (threadId: string) => void;
  onClose: () => void;
}) {
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );

  const refresh = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    listChatThreads()
      .then(setThreads)
      .catch((error) => {
        setLoadError(
          error instanceof Error ? error.message : "Failed to load chats",
        );
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (visible) {
      setConfirmingDeleteId(null);
      refresh();
    }
  }, [visible, refresh]);

  const handleDelete = (threadId: string) => {
    if (confirmingDeleteId !== threadId) {
      setConfirmingDeleteId(threadId);
      return;
    }
    setConfirmingDeleteId(null);
    setThreads((current) => current.filter((t) => t.id !== threadId));
    void deleteChatThread(threadId).catch(() => refresh());
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
              No chats yet. Start a conversation and it will show up here.
            </Text>
          </View>
        ) : (
          <FlatList
            data={threads}
            keyExtractor={(thread) => thread.id}
            renderItem={({ item }) => (
              <Pressable
                className={`flex-row items-center gap-3 px-4 py-3 border-b border-border-dark active:opacity-75 ${
                  item.id === activeThreadId ? "bg-card-dark" : ""
                }`}
                onPress={() => {
                  onSelect(item.id);
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityLabel={`Open chat ${item.title}`}
              >
                <View className="flex-1">
                  <Text
                    className="text-white text-[15px] font-medium"
                    numberOfLines={1}
                  >
                    {item.title}
                  </Text>
                  {item.preview ? (
                    <Text
                      className="text-status-gray text-[13px] mt-0.5"
                      numberOfLines={1}
                    >
                      {item.preview}
                    </Text>
                  ) : null}
                </View>
                <Text className="text-status-gray text-xs">
                  {formatWhen(item.updatedAt)}
                </Text>
                <Pressable
                  className="p-1.5 active:opacity-75"
                  onPress={() => handleDelete(item.id)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    confirmingDeleteId === item.id
                      ? "Confirm delete"
                      : `Delete chat ${item.title}`
                  }
                >
                  <IconTrash
                    color={
                      confirmingDeleteId === item.id ? "#fb7185" : "#71717a"
                    }
                    size={17}
                    strokeWidth={1.8}
                  />
                </Pressable>
              </Pressable>
            )}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}
