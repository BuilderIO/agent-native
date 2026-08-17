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
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";

import {
  formatWorkedDuration,
  isCollapsibleWorkPart,
  shouldShowWorkSummary,
} from "@/lib/agent-chat/presentation";
import type { ChatContentPart, ChatMessage } from "@/lib/agent-chat/types";
import { messageText } from "@/lib/agent-chat/types";
import { useMobileThemeColors } from "@/lib/mobile-colors";

import { MarkdownText } from "./MarkdownText";
import { ShineText } from "./ShineText";
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
      <View className="max-w-[78%] items-end gap-1.5">
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
          <View className="rounded-xl bg-muted px-[11px] py-[9px]">
            <Text className="text-foreground text-[13px] leading-5">
              {text}
            </Text>
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

/**
 * Web-parity reasoning cell: open and labelled "Thinking" while the thought
 * streams, auto-collapses to "Thought" when the stream moves on.
 */
function ReasoningPart({
  text,
  streaming,
  durationMs,
  embedded = false,
}: {
  text: string;
  streaming: boolean;
  durationMs?: number | null;
  embedded?: boolean;
}) {
  const { mutedForeground } = useMobileThemeColors();
  const [expanded, setExpanded] = useState(streaming);
  const wasStreamingRef = useRef(streaming);
  useEffect(() => {
    if (wasStreamingRef.current && !streaming) setExpanded(false);
    wasStreamingRef.current = streaming;
  }, [streaming]);

  if (embedded) {
    return (
      <Text className="pb-1 pl-5 text-text-muted text-[13px] leading-4.5">
        {text || "…"}
      </Text>
    );
  }

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
          <IconChevronDown color={mutedForeground} size={14} strokeWidth={2} />
        ) : (
          <IconChevronRight color={mutedForeground} size={14} strokeWidth={2} />
        )}
        {streaming ? (
          <ShineText>Thinking</ShineText>
        ) : durationMs != null ? (
          <Text className="text-status-gray text-[13px] font-medium">
            Thought for {formatWorkedDuration(durationMs)}
          </Text>
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
  durationMs,
  embedded = false,
  onApprove,
  onDeny,
}: {
  part: ChatContentPart;
  /** True while this part is the live tail of a streaming message. */
  streaming: boolean;
  durationMs?: number | null;
  embedded?: boolean;
  onApprove?: (approvalKey: string) => void;
  onDeny?: (approvalKey?: string) => void;
}) {
  if (part.type === "text") return <MarkdownText text={part.text} />;
  if (part.type === "reasoning") {
    return (
      <ReasoningPart
        text={part.text}
        streaming={streaming}
        durationMs={durationMs}
        embedded={embedded}
      />
    );
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
  return (
    <ToolCallCard
      part={part}
      isActiveTail={streaming && part.status === "running"}
      onApprove={onApprove}
      onDeny={onDeny}
    />
  );
}

function WorkSummary({
  parts,
  streaming,
  durationMs,
  onApprove,
  onDeny,
}: {
  parts: Array<{ part: ChatContentPart; index: number }>;
  streaming: boolean;
  durationMs?: number | null;
  onApprove?: (approvalKey: string) => void;
  onDeny?: (approvalKey?: string) => void;
}) {
  const { mutedForeground } = useMobileThemeColors();
  const [open, setOpen] = useState(false);
  const label =
    durationMs != null && durationMs >= 1000
      ? `Worked for ${formatWorkedDuration(durationMs)}`
      : "Worked";

  return (
    <View className="my-0.5 w-full">
      <Pressable
        className="flex-row items-center gap-1.5 py-0.5 active:opacity-75"
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="Toggle completed work"
      >
        {open ? (
          <IconChevronDown color={mutedForeground} size={14} strokeWidth={2} />
        ) : (
          <IconChevronRight color={mutedForeground} size={14} strokeWidth={2} />
        )}
        <Text className="text-status-gray text-[13px] font-medium">
          {label}
        </Text>
      </Pressable>
      {open ? (
        <View className="gap-2 pt-1">
          {parts.map(({ part, index }) => (
            <AssistantPart
              key={
                part.type === "tool-call"
                  ? `tool-${part.toolCallId}`
                  : `${part.type}-${index}`
              }
              part={part}
              streaming={streaming}
              embedded={part.type === "reasoning"}
              onApprove={onApprove}
              onDeny={onDeny}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
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
  onDeny?: (approvalKey?: string) => void;
  onActions?: (message: ChatMessage) => void;
}) {
  const { mutedForeground } = useMobileThemeColors();
  const contextValue = useMemo(
    () => ({
      isStreaming: isStreamingMessage,
      messageId: message.id,
    }),
    [isStreamingMessage, message.id],
  );
  const workStartedAtRef = useRef<number | null>(null);
  const [workDurationMs, setWorkDurationMs] = useState<number | null>(
    message.workDurationMs ?? null,
  );
  const firstReasoningIndex = message.parts.findIndex(
    (part) => part.type === "reasoning",
  );

  useEffect(() => {
    if (!isStreamingMessage && message.workDurationMs != null) {
      setWorkDurationMs(message.workDurationMs);
    }
  }, [isStreamingMessage, message.workDurationMs]);

  useEffect(() => {
    if (isStreamingMessage) {
      workStartedAtRef.current ??= Date.now();
      return;
    }
    if (workStartedAtRef.current != null) {
      setWorkDurationMs(Date.now() - workStartedAtRef.current);
      workStartedAtRef.current = null;
    }
  }, [isStreamingMessage]);

  const showWorkSummary = shouldShowWorkSummary({
    isLast: isStreamingMessage,
    isComplete: !isStreamingMessage,
    parts: message.parts,
    isStreaming: isStreamingMessage,
  });

  const partGroups: Array<
    | { kind: "work"; parts: Array<{ part: ChatContentPart; index: number }> }
    | { kind: "part"; part: ChatContentPart; index: number }
  > = [];
  for (let index = 0; index < message.parts.length; index += 1) {
    const part = message.parts[index]!;
    if (showWorkSummary && isCollapsibleWorkPart(part)) {
      const previous = partGroups[partGroups.length - 1];
      if (previous?.kind === "work") {
        previous.parts.push({ part, index });
      } else {
        partGroups.push({ kind: "work", parts: [{ part, index }] });
      }
    } else {
      partGroups.push({ kind: "part", part, index });
    }
  }
  const firstWorkGroupIndex = partGroups.findIndex(
    (group) => group.kind === "work",
  );

  const body = (
    <View className="px-4 py-1.5 gap-2">
      {partGroups.map((group, groupIndex) => {
        if (group.kind === "work") {
          return (
            <WorkSummary
              key={`work-${group.parts[0]?.index ?? groupIndex}`}
              parts={group.parts}
              streaming={false}
              durationMs={
                groupIndex === firstWorkGroupIndex ? workDurationMs : undefined
              }
              onApprove={onApprove}
              onDeny={onDeny}
            />
          );
        }
        const { part, index } = group;
        return (
          <AssistantPart
            key={
              part.type === "tool-call"
                ? `tool-${part.toolCallId}`
                : `${part.type}-${index}`
            }
            part={part}
            streaming={isStreamingMessage && index === message.parts.length - 1}
            durationMs={
              index === firstReasoningIndex ? workDurationMs : undefined
            }
            onApprove={onApprove}
            onDeny={onDeny}
          />
        );
      })}
      {showFooter && (
        <View className="flex-row items-center gap-2 mt-0.5">
          <Pressable
            className="p-1 active:opacity-75"
            onPress={() => onActions?.(message)}
            accessibilityRole="button"
            accessibilityLabel="Message actions"
          >
            <IconDots color={mutedForeground} size={16} strokeWidth={2} />
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
      <ShineText>{label}</ShineText>
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
  const { accentOrange, mutedForeground, foreground } = useMobileThemeColors();
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
          <Text className="text-foreground text-[14px] leading-5 flex-1 pr-4">
            You've reached the monthly AI credits limit for your current plan.
          </Text>
          <Pressable
            onPress={handleUpgrade}
            className="bg-primary rounded-lg flex-row items-center gap-1 px-3 py-1.5 active:opacity-75"
          >
            <Text className="text-primary-foreground text-xs font-bold">
              Upgrade at builder.io
            </Text>
            <IconExternalLink color={foreground} size={13} strokeWidth={2.5} />
          </Pressable>
        </View>
      )}

      <View className="flex-row items-start gap-3">
        <View className="mt-0.5 bg-amber-500/10 rounded-lg p-1.5 text-amber-500">
          <IconAlertTriangle color={accentOrange} size={16} strokeWidth={2.5} />
        </View>
        <View className="flex-1">
          <Text className="text-foreground font-bold text-[14px]">
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
              <Text className="text-foreground text-xs font-bold">Retry</Text>
            </Pressable>
          )}
        </View>
        <Pressable
          className="flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-lg active:bg-white/5"
          onPress={handleCopy}
        >
          {copied ? (
            <>
              <IconCheck color={mutedForeground} size={14} strokeWidth={2.5} />
              <Text className="text-status-gray text-xs font-bold">Copied</Text>
            </>
          ) : (
            <>
              <IconCopy color={mutedForeground} size={14} strokeWidth={2.5} />
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
