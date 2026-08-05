import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import { IconArrowDown } from "@tabler/icons-react-native";
import { useCallback, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { KeyboardGestureArea } from "react-native-keyboard-controller";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import type { ChatMessage } from "@/lib/agent-chat/types";
import type { AgentChatController } from "@/lib/agent-chat/use-agent-chat";

import {
  ActivityRow,
  AssistantMessage,
  ErrorRow,
  PulsingText,
  UserMessage,
} from "./MessageBubbles";

type Row =
  | { kind: "message"; message: ChatMessage }
  | { kind: "activity"; label: string }
  | { kind: "thinking" }
  | { kind: "error"; error: string; errorCode: string | null };

function buildRows(chat: AgentChatController): Row[] {
  const rows: Row[] = chat.messages.map((message) => ({
    kind: "message",
    message,
  }));
  if (chat.isStreaming && chat.activity) {
    rows.push({ kind: "activity", label: chat.activity });
  } else if (chat.isStreaming) {
    // No assistant output and no activity yet — mirror the web's pulsing
    // "Thinking" placeholder until the first token or tool event lands.
    const last = chat.messages[chat.messages.length - 1];
    if (!last || last.role === "user") rows.push({ kind: "thinking" });
  }
  if (chat.error) {
    rows.push({ kind: "error", error: chat.error, errorCode: chat.errorCode });
  }
  return rows;
}

function rowKey(row: Row, index: number): string {
  if (row.kind === "message") return row.message.id;
  return `${row.kind}-${index}`;
}

export function MessagesList({
  chat,
  bottomInset,
  onMessageActions,
}: {
  chat: AgentChatController;
  /** Height of the floating composer + keyboard area to pad the scroll end. */
  bottomInset: number;
  onMessageActions?: (message: ChatMessage) => void;
}) {
  const listRef = useRef<LegendListRef>(null);
  const [awayFromEnd, setAwayFromEnd] = useState(false);
  const rows = buildRows(chat);
  // Streaming turns animate in; opening an existing thread must not replay
  // entry animations for the whole transcript.
  const animateFromIndex = useRef(chat.messages.length);
  if (!chat.isStreaming && !chat.historyLoading) {
    animateFromIndex.current = chat.messages.length;
  }

  const renderRow = useCallback(
    ({ item, index }: { item: Row; index: number }) => {
      if (item.kind === "activity") return <ActivityRow label={item.label} />;
      if (item.kind === "thinking") {
        return (
          <View className="px-4 py-1.5">
            <PulsingText>Thinking</PulsingText>
          </View>
        );
      }
      if (item.kind === "error") {
        return (
          <ErrorRow
            error={item.error}
            errorCode={item.errorCode}
            onRetry={chat.retry}
          />
        );
      }
      const animateIn = index >= animateFromIndex.current - 1;
      if (item.message.role === "user") {
        return <UserMessage message={item.message} animateIn={animateIn} />;
      }
      const isLast = index === rows.length - 1;
      return (
        <AssistantMessage
          message={item.message}
          animateIn={animateIn}
          showFooter={!chat.isStreaming || !isLast}
          isStreamingMessage={chat.isStreaming && isLast}
          onApprove={chat.approve}
          onDeny={chat.deny}
          onActions={onMessageActions}
        />
      );
    },
    [
      chat.approve,
      chat.deny,
      chat.retry,
      chat.isStreaming,
      rows.length,
      onMessageActions,
    ],
  );

  return (
    <View className="flex-1">
      <KeyboardGestureArea
        interpolator="ios"
        textInputNativeID="chat-composer-input"
        style={{ flex: 1 }}
      >
        <LegendList
          ref={listRef}
          data={rows}
          keyExtractor={rowKey}
          renderItem={renderRow}
          estimatedItemSize={96}
          maintainScrollAtEnd
          maintainScrollAtEndThreshold={0.15}
          alignItemsAtEnd
          initialScrollIndex={rows.length > 0 ? rows.length - 1 : undefined}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingTop: 12, paddingBottom: bottomInset }}
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } =
              event.nativeEvent;
            const distance =
              contentSize.height - contentOffset.y - layoutMeasurement.height;
            setAwayFromEnd(distance > 160);
          }}
          scrollEventThrottle={32}
          showsVerticalScrollIndicator={false}
        />
      </KeyboardGestureArea>

      {awayFromEnd && (
        <Animated.View
          entering={FadeIn.duration(150)}
          exiting={FadeOut.duration(150)}
          className="absolute right-4"
          style={{ bottom: bottomInset + 8 }}
        >
          <Pressable
            className="w-9 h-9 rounded-full bg-card-dark border border-border-dark items-center justify-center active:opacity-75"
            onPress={() => listRef.current?.scrollToEnd({ animated: true })}
            accessibilityRole="button"
            accessibilityLabel="Scroll to latest message"
          >
            <IconArrowDown color="#fafafa" size={18} strokeWidth={2} />
          </Pressable>
        </Animated.View>
      )}

      {rows.length === 0 && !chat.historyLoading && (
        <View
          className="absolute inset-0 items-center justify-center px-8"
          pointerEvents="none"
        >
          <Text className="text-white text-xl font-semibold text-center">
            What can I help with?
          </Text>
          <Text className="text-status-gray text-sm text-center mt-2 leading-5">
            Ask the agent anything — it can answer, take actions, and update the
            app for you.
          </Text>
        </View>
      )}
    </View>
  );
}
