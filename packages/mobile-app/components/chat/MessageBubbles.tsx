import { normalizeConnectRequiredResult } from "@agent-native/core/shared";
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconDots,
  IconExternalLink,
  IconPlugConnected,
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
import { NativeInteractiveResult } from "./NativeInteractiveResult";
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
  onActions,
}: {
  message: ChatMessage;
  animateIn: boolean;
  onActions?: (message: ChatMessage) => void;
}) {
  const { mutedForeground } = useMobileThemeColors();
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
        {onActions ? (
          <View className="flex-row items-center gap-1.5 self-end">
            <Pressable
              className="p-1 active:opacity-75"
              onPress={() => onActions(message)}
              accessibilityRole="button"
              accessibilityLabel="Message actions"
            >
              <IconDots color={mutedForeground} size={16} strokeWidth={2} />
            </Pressable>
            <Text className="text-status-gray text-[11px]">
              {formatTime(message.createdAt)}
            </Text>
          </View>
        ) : null}
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

function connectionRequestForToolCall(
  part: Extract<ChatContentPart, { type: "tool-call" }>,
): Extract<ChatContentPart, { type: "connection-request" }> | null {
  if (!part.resultText) return null;
  let result: unknown;
  try {
    result = JSON.parse(part.resultText) as unknown;
    // coercion-ok: Plain-text tool output cannot define a structured native connection card.
  } catch {
    return null;
  }

  const connectRequired = normalizeConnectRequiredResult(result);
  if (connectRequired) {
    return {
      type: "connection-request",
      id: part.toolCallId,
      provider: connectRequired.providerLabel,
      reason: connectRequired.reason,
      detail: connectRequired.reason,
    };
  }

  const card = result as Record<string, unknown> | null;
  if (
    !card ||
    typeof card !== "object" ||
    card.kind !== "connect-builder-card"
  ) {
    return null;
  }
  return {
    type: "connection-request",
    id: part.toolCallId,
    provider: "Builder.io",
    detail:
      typeof card.prompt === "string" && card.prompt.trim()
        ? card.prompt.trim()
        : undefined,
  };
}

function AssistantPart({
  part,
  streaming,
  canChat,
  durationMs,
  embedded = false,
  onApprove,
  onDeny,
  onOpenConnections,
  onContinueAfterConnection,
  onInvokeWidgetAction,
}: {
  part: ChatContentPart;
  streaming: boolean;
  canChat: boolean;
  durationMs?: number | null;
  embedded?: boolean;
  onApprove?: (approvalKey: string) => void;
  onDeny?: (approvalKey?: string) => void;
  onOpenConnections?: () => void;
  onContinueAfterConnection?: (requestId: string, provider: string) => void;
  onInvokeWidgetAction?: (
    widgetId: string,
    action: string,
    payload?: unknown,
  ) => Promise<void>;
}) {
  const { mutedForeground } = useMobileThemeColors();
  const connectionRequest =
    part.type === "connection-request"
      ? part
      : part.type === "tool-call"
        ? connectionRequestForToolCall(part)
        : null;
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
  if (connectionRequest) {
    const provider = connectionRequest.provider.trim() || "this integration";
    const connecting = connectionRequest.status === "connecting";
    const connected = connectionRequest.status === "connected";
    return (
      <View className="mx-0.5 rounded-2xl border border-border-dark bg-card-dark p-4 gap-3">
        <View className="flex-row items-start gap-3">
          <View className="mt-0.5 rounded-xl bg-primary/10 p-2">
            <IconPlugConnected
              color={mutedForeground}
              size={18}
              strokeWidth={2}
            />
          </View>
          <View className="flex-1 gap-1">
            <Text className="text-foreground text-[14px] font-semibold">
              Connect {provider}
            </Text>
            <Text className="text-text-muted text-[13px] leading-5">
              {connectionRequest.detail ??
                `Connect ${provider} to continue this request.`}
            </Text>
          </View>
        </View>
        <View className="flex-row gap-2">
          <Pressable
            disabled={connecting || connected}
            accessibilityRole="button"
            accessibilityLabel={`Connect ${provider}`}
            className="min-h-10 flex-1 items-center justify-center rounded-lg bg-primary px-3 active:opacity-75"
            onPress={onOpenConnections}
          >
            <Text className="text-primary-foreground text-[13px] font-bold">
              Connect
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Continue after connecting ${provider}`}
            disabled={!canChat || connecting || connected}
            className="min-h-10 flex-1 items-center justify-center rounded-lg border border-border-dark px-3 active:opacity-75 disabled:opacity-45"
            onPress={() =>
              onContinueAfterConnection?.(connectionRequest.id, provider)
            }
          >
            <Text className="text-foreground text-[13px] font-semibold">
              {connecting
                ? "Connecting…"
                : connected
                  ? "Connected"
                  : "I connected it"}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }
  if (part.type === "widget") {
    return (
      <WidgetCard
        widget={part.widget}
        canChat={canChat}
        onInvokeWidgetAction={onInvokeWidgetAction}
      />
    );
  }
  if (part.type !== "tool-call") return null;
  return (
    <View className="gap-2">
      {part.mcpApp || part.chatUI ? (
        <NativeInteractiveResult part={part} />
      ) : null}
      <ToolCallCard
        part={part}
        isActiveTail={streaming && part.status === "running"}
        onApprove={onApprove}
        onDeny={onDeny}
      />
    </View>
  );
}

function WidgetCard({
  widget,
  canChat,
  onInvokeWidgetAction,
}: {
  widget: Extract<ChatContentPart, { type: "widget" }>["widget"];
  canChat: boolean;
  onInvokeWidgetAction?: (
    widgetId: string,
    action: string,
    payload?: unknown,
  ) => Promise<void>;
}) {
  const { mutedForeground, destructive } = useMobileThemeColors();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data =
    widget.data &&
    typeof widget.data === "object" &&
    !Array.isArray(widget.data)
      ? (widget.data as Record<string, unknown>)
      : {};
  const titleValue = [data.title, data.label, data.name].find(
    (item): item is string => typeof item === "string",
  );
  const title = widget.title ?? titleValue ?? "Update";
  const description = [
    data.description,
    data.message,
    data.summary,
    data.text,
  ].find((item): item is string => typeof item === "string");

  return (
    <View className="mx-0.5 rounded-2xl border border-border-dark bg-card-dark p-4 gap-3">
      <View className="gap-1">
        <Text className="text-foreground text-[14px] font-semibold">
          {title}
        </Text>
        {description ? (
          <Text className="text-text-muted text-[13px] leading-5">
            {description}
          </Text>
        ) : null}
      </View>
      {widget.actions?.length ? (
        <View className="flex-row flex-wrap gap-2">
          {widget.actions.map((action) => (
            <Pressable
              key={action.id}
              disabled={
                !canChat ||
                action.disabled ||
                pendingAction !== null ||
                !action.action
              }
              accessibilityRole="button"
              accessibilityLabel={action.label}
              className={`min-h-9 items-center justify-center rounded-lg px-3 ${action.kind === "primary" ? "bg-primary" : "border border-border-dark"} active:opacity-75`}
              onPress={() => {
                if (!action.action || !onInvokeWidgetAction) return;
                setPendingAction(action.id);
                setError(null);
                void onInvokeWidgetAction(
                  widget.id,
                  action.action,
                  action.payload,
                )
                  .catch((reason: unknown) => {
                    setError(
                      reason instanceof Error
                        ? reason.message
                        : "Action failed.",
                    );
                  })
                  .finally(() => setPendingAction(null));
              }}
            >
              <Text
                className={
                  action.kind === "primary"
                    ? "text-primary-foreground text-[13px] font-semibold"
                    : "text-foreground text-[13px] font-semibold"
                }
              >
                {pendingAction === action.id ? "Working…" : action.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {error ? (
        <Text style={{ color: destructive }} className="text-[12px]">
          {error}
        </Text>
      ) : null}
      <Text style={{ color: mutedForeground }} className="text-[11px]">
        {widget.kind}
      </Text>
    </View>
  );
}

function WorkSummary({
  parts,
  streaming,
  canChat,
  durationMs,
  onApprove,
  onDeny,
  onOpenConnections,
  onContinueAfterConnection,
  onInvokeWidgetAction,
}: {
  parts: Array<{ part: ChatContentPart; index: number }>;
  streaming: boolean;
  canChat: boolean;
  durationMs?: number | null;
  onApprove?: (approvalKey: string) => void;
  onDeny?: (approvalKey?: string) => void;
  onOpenConnections?: () => void;
  onContinueAfterConnection?: (requestId: string, provider: string) => void;
  onInvokeWidgetAction?: (
    widgetId: string,
    action: string,
    payload?: unknown,
  ) => Promise<void>;
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
              canChat={canChat}
              embedded={part.type === "reasoning"}
              onApprove={onApprove}
              onDeny={onDeny}
              onOpenConnections={onOpenConnections}
              onContinueAfterConnection={onContinueAfterConnection}
              onInvokeWidgetAction={onInvokeWidgetAction}
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
  canChat,
  onApprove,
  onDeny,
  onActions,
  onOpenConnections,
  onContinueAfterConnection,
  onInvokeWidgetAction,
}: {
  message: ChatMessage;
  animateIn: boolean;
  showFooter: boolean;
  isStreamingMessage?: boolean;
  canChat: boolean;
  onApprove?: (approvalKey: string) => void;
  onDeny?: (approvalKey?: string) => void;
  onActions?: (message: ChatMessage) => void;
  onOpenConnections?: () => void;
  onContinueAfterConnection?: (requestId: string, provider: string) => void;
  onInvokeWidgetAction?: (
    widgetId: string,
    action: string,
    payload?: unknown,
  ) => Promise<void>;
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
    const isConnectionGate =
      part.type === "tool-call" && connectionRequestForToolCall(part) !== null;
    if (showWorkSummary && isCollapsibleWorkPart(part) && !isConnectionGate) {
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
              canChat={canChat}
              durationMs={
                groupIndex === firstWorkGroupIndex ? workDurationMs : undefined
              }
              onApprove={onApprove}
              onDeny={onDeny}
              onOpenConnections={onOpenConnections}
              onContinueAfterConnection={onContinueAfterConnection}
              onInvokeWidgetAction={onInvokeWidgetAction}
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
            canChat={canChat}
            durationMs={
              index === firstReasoningIndex ? workDurationMs : undefined
            }
            onApprove={onApprove}
            onDeny={onDeny}
            onOpenConnections={onOpenConnections}
            onContinueAfterConnection={onContinueAfterConnection}
            onInvokeWidgetAction={onInvokeWidgetAction}
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
  onSignIn,
  onOpenSettings,
}: {
  error: string;
  errorCode: string | null;
  onRetry?: () => void;
  onSignIn?: () => void;
  onOpenSettings?: () => void;
}) {
  const { accentOrange, mutedForeground, foreground } = useMobileThemeColors();
  const [copied, setCopied] = useState(false);
  const isCreditLimit =
    errorCode?.toLowerCase().includes("credit") ||
    error.toLowerCase().includes("credit");

  const handleCopy = async () => {
    await Clipboard.setStringAsync(error);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleUpgrade = () => {
    void Linking.openURL("https://builder.io");
  };

  const isAuth = errorCode === "auth";
  const isMissingAiKey = errorCode === "missing_api_key";
  const isSetupUnavailable = errorCode === "chat_setup_unavailable";
  const displayedError = isMissingAiKey
    ? "Use Builder.io or a custom provider API key in settings to start chatting."
    : isAuth
      ? "Your session expired. Sign in again to keep chatting."
      : error;

  if (isMissingAiKey) {
    return (
      <View className="mx-4 my-2 flex-row items-center justify-between gap-3 rounded-xl border border-border bg-card-dark p-4">
        <Text className="flex-1 text-[14px] leading-5 text-foreground">
          {displayedError}
        </Text>
        {onOpenSettings && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open AI provider settings"
            className="min-h-9 items-center justify-center rounded-lg bg-primary px-3 active:opacity-75"
            onPress={onOpenSettings}
          >
            <Text className="text-xs font-bold text-primary-foreground">
              Use Builder.io
            </Text>
          </Pressable>
        )}
      </View>
    );
  }

  if (isSetupUnavailable) {
    return (
      <View className="mx-4 my-2 flex-row items-center justify-between gap-3 rounded-xl border border-border bg-card-dark p-4">
        <Text className="flex-1 text-[14px] leading-5 text-foreground">
          Chat setup could not be checked. Try again.
        </Text>
        {onRetry && (
          <Pressable
            accessibilityRole="button"
            className="min-h-9 items-center justify-center rounded-lg bg-white/10 px-3 active:opacity-75"
            onPress={onRetry}
          >
            <Text className="text-xs font-bold text-foreground">Retry</Text>
          </Pressable>
        )}
      </View>
    );
  }

  if (isCreditLimit) {
    return (
      <View className="mx-4 my-2 flex-row items-center justify-between gap-3 rounded-xl border border-border bg-card-dark p-4">
        <Text className="flex-1 text-[14px] leading-5 text-foreground">
          You’re out of AI credits. Upgrade your plan on Builder to continue.
        </Text>
        <Pressable
          accessibilityRole="link"
          onPress={handleUpgrade}
          className="min-h-9 flex-row items-center justify-center gap-1 rounded-lg bg-primary px-3 active:opacity-75"
        >
          <Text className="text-xs font-bold text-primary-foreground">
            Upgrade
          </Text>
          <IconExternalLink color={foreground} size={13} strokeWidth={2.5} />
        </Pressable>
      </View>
    );
  }

  return (
    <View className="mx-4 my-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4.5 gap-3">
      <View className="flex-row items-start gap-3">
        <View className="mt-0.5 bg-amber-500/10 rounded-lg p-1.5 text-amber-500">
          <IconAlertTriangle color={accentOrange} size={16} strokeWidth={2.5} />
        </View>
        <View className="flex-1">
          <Text className="text-foreground font-bold text-[14px]">
            {isAuth ? "Signed out" : "The agent hit an error"}
          </Text>
          <Text className="text-status-gray text-[13px] leading-4.5 mt-1">
            {displayedError}
          </Text>
        </View>
      </View>

      <View className="flex-row items-center justify-between mt-1">
        <View className="flex-row gap-2">
          {/* Retrying a signed-out run just fails again — offer the only
              action that can actually clear it. */}
          {isAuth ? (
            onSignIn && (
              <Pressable
                accessibilityRole="button"
                className="h-8.5 px-4 bg-primary rounded-lg items-center justify-center active:opacity-75"
                onPress={onSignIn}
              >
                <Text className="text-primary-foreground text-xs font-bold">
                  Sign in
                </Text>
              </Pressable>
            )
          ) : onRetry ? (
            <Pressable
              accessibilityRole="button"
              className="h-8.5 px-4 bg-white/10 rounded-lg items-center justify-center active:opacity-75"
              onPress={onRetry}
            >
              <Text className="text-foreground text-xs font-bold">Retry</Text>
            </Pressable>
          ) : null}
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
