import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconDots,
  IconExternalLink,
} from "@tabler/icons-react-native";
import * as Clipboard from "expo-clipboard";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Image, Linking, Pressable, Text, View } from "react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import type { ChatContentPart, ChatMessage } from "@/lib/agent-chat/types";
import { messageText } from "@/lib/agent-chat/types";

import { MarkdownText } from "./MarkdownText";
import { MessageContext } from "./StreamingFade";
import { ToolCallCard } from "./ToolCallCard";

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export const UserMessage = memo(function UserMessage({
  message,
  animateIn,
}: {
  message: ChatMessage;
  animateIn: boolean;
}) {
  const images = message.parts.filter((part) => part.type === "image");
  const text = messageText(message);
  const bubble = (
    <View className="flex-row justify-end px-4 py-1.5">
      <View className="max-w-[85%] items-end gap-1.5">
        {images.map((image, index) => (
          <Image
            key={index}
            source={{ uri: image.dataUrl }}
            className="w-40 h-40 rounded-2xl border border-border-dark"
            resizeMode="cover"
            accessibilityLabel={image.name ?? "Attached image"}
          />
        ))}
        {text.length > 0 && (
          <View className="rounded-2xl rounded-br-md bg-card-dark border border-border-dark px-3.5 py-2.5">
            <Text className="text-white text-[15px] leading-5.5">{text}</Text>
          </View>
        )}
      </View>
    </View>
  );
  if (!animateIn) return bubble;
  return (
    <Animated.View entering={FadeInDown.springify().damping(18)}>
      {bubble}
    </Animated.View>
  );
});

export function PulsingText({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  const opacity = useSharedValue(0.35);
  useEffect(() => {
    opacity.set(withRepeat(withTiming(1, { duration: 700 }), -1, true));
  }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return (
    <Animated.Text
      style={style}
      className={className ?? "text-status-gray text-[13px] font-medium"}
    >
      {children}
    </Animated.Text>
  );
}

/**
 * Web-parity reasoning cell: open and labelled "Thinking" while the thought
 * streams, auto-collapses to "Thought" when the stream moves on.
 */
function ReasoningPart({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  const [expanded, setExpanded] = useState(streaming);
  const wasStreamingRef = useRef(streaming);
  useEffect(() => {
    if (wasStreamingRef.current && !streaming) setExpanded(false);
    wasStreamingRef.current = streaming;
  }, [streaming]);

  return (
    <View>
      <Pressable
        className="flex-row items-center gap-1.5 py-0.5 active:opacity-75"
        onPress={() => setExpanded((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel="Toggle thought"
      >
        {expanded ? (
          <IconChevronDown color="#71717a" size={14} strokeWidth={2} />
        ) : (
          <IconChevronRight color="#71717a" size={14} strokeWidth={2} />
        )}
        {streaming ? (
          <PulsingText>Thinking</PulsingText>
        ) : (
          <Text className="text-status-gray text-[13px] font-medium">
            Thought
          </Text>
        )}
      </Pressable>
      {expanded && (
        <Text className="text-text-muted text-[13px] leading-4.5 pl-5 pt-0.5">
          {text || "…"}
        </Text>
      )}
    </View>
  );
}

function AssistantPart({
  part,
  streaming,
  onApprove,
  onDeny,
}: {
  part: ChatContentPart;
  /** True while this part is the live tail of a streaming message. */
  streaming: boolean;
  onApprove?: (approvalKey: string) => void;
  onDeny?: () => void;
}) {
  if (part.type === "text") return <MarkdownText text={part.text} />;
  if (part.type === "reasoning") {
    return <ReasoningPart text={part.text} streaming={streaming} />;
  }
  if (part.type === "image") {
    return (
      <Image
        source={{ uri: part.dataUrl }}
        className="w-40 h-40 rounded-2xl border border-border-dark"
        resizeMode="cover"
        accessibilityLabel={part.name ?? "Image"}
      />
    );
  }
  return <ToolCallCard part={part} onApprove={onApprove} onDeny={onDeny} />;
}

export const AssistantMessage = memo(function AssistantMessage({
  message,
  animateIn,
  showFooter,
  isStreamingMessage = false,
  onApprove,
  onDeny,
  onActions,
}: {
  message: ChatMessage;
  animateIn: boolean;
  /** Hidden while this message is still streaming in. */
  showFooter: boolean;
  /** True when this is the live message of an in-flight turn. */
  isStreamingMessage?: boolean;
  onApprove?: (approvalKey: string) => void;
  onDeny?: () => void;
  onActions?: (message: ChatMessage) => void;
}) {
  const contextValue = useMemo(
    () => ({
      isStreaming: isStreamingMessage,
      messageId: message.id,
    }),
    [isStreamingMessage, message.id],
  );

  const body = (
    <View className="px-4 py-1.5 gap-2">
      {message.parts.map((part, index) => (
        <AssistantPart
          key={
            part.type === "tool-call"
              ? `tool-${part.toolCallId}`
              : `${part.type}-${index}`
          }
          part={part}
          streaming={isStreamingMessage && index === message.parts.length - 1}
          onApprove={onApprove}
          onDeny={onDeny}
        />
      ))}
      {showFooter && (
        <View className="flex-row items-center gap-2 mt-0.5">
          <Pressable
            className="p-1 active:opacity-75"
            onPress={() => onActions?.(message)}
            accessibilityRole="button"
            accessibilityLabel="Message actions"
          >
            <IconDots color="#71717a" size={16} strokeWidth={2} />
          </Pressable>
          <Text className="text-status-gray text-[11px]">
            {formatTime(message.createdAt)}
          </Text>
        </View>
      )}
    </View>
  );

  const content = animateIn ? (
    <Animated.View entering={FadeIn.duration(350)}>{body}</Animated.View>
  ) : (
    body
  );

  return (
    <MessageContext.Provider value={contextValue}>
      {content}
    </MessageContext.Provider>
  );
});

export function ActivityRow({ label }: { label: string }) {
  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      className="flex-row items-center gap-2 px-4 py-1.5"
    >
      <View className="w-1.5 h-1.5 rounded-full bg-accent-green" />
      <Text className="text-status-gray text-[13px]">{label}</Text>
    </Animated.View>
  );
}

export function ErrorRow({
  error,
  errorCode,
  onRetry,
}: {
  error: string;
  errorCode: string | null;
  onRetry?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const isCreditLimit = error.toLowerCase().includes("credit");

  const handleCopy = async () => {
    await Clipboard.setStringAsync(error);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleUpgrade = () => {
    void Linking.openURL("https://builder.io");
  };

  const displayedError =
    errorCode === "missing_api_key"
      ? "The agent needs an API key. Open the settings to add one."
      : error;

  return (
    <View className="mx-4 my-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4.5 gap-3">
      {isCreditLimit && (
        <View className="flex-row items-center justify-between pb-2 border-b border-zinc-800/40">
          <Text className="text-white text-[14px] leading-5 flex-1 pr-4">
            You've reached the monthly AI credits limit for your current plan.
          </Text>
          <Pressable
            onPress={handleUpgrade}
            className="bg-white rounded-lg flex-row items-center gap-1 px-3 py-1.5 active:opacity-75"
          >
            <Text className="text-black text-xs font-bold">
              Upgrade at builder.io
            </Text>
            <IconExternalLink color="#0b0b0c" size={13} strokeWidth={2.5} />
          </Pressable>
        </View>
      )}

      <View className="flex-row items-start gap-3">
        <View className="mt-0.5 bg-amber-500/10 rounded-lg p-1.5 text-amber-500">
          <IconAlertTriangle color="#f59e0b" size={16} strokeWidth={2.5} />
        </View>
        <View className="flex-1">
          <Text className="text-white font-bold text-[14px]">
            The agent hit an error
          </Text>
          <Text className="text-status-gray text-[13px] leading-4.5 mt-1">
            {displayedError}
          </Text>
        </View>
      </View>

      <View className="flex-row items-center justify-between mt-1">
        <View className="flex-row gap-2">
          {onRetry && (
            <Pressable
              className="h-8.5 px-4 bg-white/10 rounded-lg items-center justify-center active:opacity-75"
              onPress={onRetry}
            >
              <Text className="text-white text-xs font-bold">Retry</Text>
            </Pressable>
          )}
        </View>
        <Pressable
          className="flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-lg active:bg-white/5"
          onPress={handleCopy}
        >
          {copied ? (
            <>
              <IconCheck color="#a1a1aa" size={14} strokeWidth={2.5} />
              <Text className="text-status-gray text-xs font-bold">Copied</Text>
            </>
          ) : (
            <>
              <IconCopy color="#a1a1aa" size={14} strokeWidth={2.5} />
              <Text className="text-status-gray text-xs font-bold">
                Copy debug
              </Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}
