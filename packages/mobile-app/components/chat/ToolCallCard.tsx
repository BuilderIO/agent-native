import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconPlayerStopFilled,
} from "@tabler/icons-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";

import type { ChatContentPart } from "@/lib/agent-chat/types";

const MONO_FONT = Platform.select({ ios: "Menlo", android: "monospace" });
const DETAIL_LIMIT = 1200;
// Matches the web client's TOOL_LONG_RUNNING_HINT_DELAY_MS.
const LONG_RUNNING_HINT_DELAY_MS = 45_000;

function truncate(value: string): string {
  return value.length > DETAIL_LIMIT
    ? `${value.slice(0, DETAIL_LIMIT)}…`
    : value;
}

/** First string value in the tool input — e.g. the query of a search tool. */
function inputPreview(inputText: string): string | null {
  if (!inputText) return null;
  try {
    const parsed = JSON.parse(inputText) as unknown;
    if (typeof parsed === "string") return parsed;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const value of Object.values(parsed)) {
        if (typeof value === "string" && value.trim()) return value;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function StatusIcon({
  status,
}: {
  status: Extract<ChatContentPart, { type: "tool-call" }>["status"];
}) {
  if (status === "running") {
    return <ActivityIndicator size="small" color="#c7f36b" />;
  }
  if (status === "failed") {
    return <IconAlertTriangle color="#fb7185" size={15} strokeWidth={2} />;
  }
  if (status === "cancelled") {
    return <IconPlayerStopFilled color="#71717a" size={13} />;
  }
  if (status === "awaiting-approval") {
    return <IconAlertTriangle color="#f5d999" size={15} strokeWidth={2} />;
  }
  return <IconCheck color="#86efac" size={15} strokeWidth={2.2} />;
}

export function ToolCallCard({
  part,
  onApprove,
  onDeny,
}: {
  part: Extract<ChatContentPart, { type: "tool-call" }>;
  onApprove?: (approvalKey: string) => void;
  onDeny?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showLongRunningHint, setShowLongRunningHint] = useState(false);
  const awaitingApproval = part.status === "awaiting-approval";
  const isRunning = part.status === "running";
  const preview = inputPreview(part.inputText);

  useEffect(() => {
    if (!isRunning) {
      setShowLongRunningHint(false);
      return;
    }
    const timeout = setTimeout(
      () => setShowLongRunningHint(true),
      LONG_RUNNING_HINT_DELAY_MS,
    );
    return () => clearTimeout(timeout);
  }, [isRunning]);

  return (
    <View>
      <Pressable
        className="flex-row items-center gap-1.5 py-0.5 active:opacity-75"
        onPress={() => setExpanded((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`Tool ${part.toolName}, ${part.status}`}
      >
        {expanded ? (
          <IconChevronDown color="#71717a" size={14} strokeWidth={2} />
        ) : (
          <IconChevronRight color="#71717a" size={14} strokeWidth={2} />
        )}
        <Text
          className="text-status-gray text-[13px] font-medium"
          numberOfLines={1}
        >
          {part.toolName}
        </Text>
        <StatusIcon status={part.status} />
        {preview && !expanded ? (
          <Text
            className="flex-1 text-gray-medium text-[13px]"
            numberOfLines={1}
          >
            {preview}
          </Text>
        ) : null}
      </Pressable>

      {isRunning && showLongRunningHint && (
        <Text className="text-status-gray text-[11px] leading-4 pl-5 pt-0.5">
          Still working. Large updates can take a minute or two.
        </Text>
      )}

      {awaitingApproval && (
        <View className="pl-5 pt-1.5 gap-2">
          <Text className="text-warning-yellow-text text-xs leading-4">
            The agent wants to run this tool. Approve to continue.
          </Text>
          <View className="flex-row gap-2">
            <Pressable
              className="flex-1 h-9 rounded-lg bg-white items-center justify-center active:opacity-75"
              onPress={() => part.approvalKey && onApprove?.(part.approvalKey)}
              accessibilityRole="button"
              accessibilityLabel="Approve tool call"
            >
              <Text className="text-background-dark text-[13px] font-bold">
                Approve
              </Text>
            </Pressable>
            <Pressable
              className="flex-1 h-9 rounded-lg border border-gray-border-light items-center justify-center active:opacity-75"
              onPress={() => onDeny?.()}
              accessibilityRole="button"
              accessibilityLabel="Deny tool call"
            >
              <Text className="text-text-light text-[13px] font-semibold">
                Deny
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {expanded && (
        <View className="ml-5 mt-1.5 rounded-xl border border-border-dark bg-card-dark px-3 py-2.5 gap-2">
          {part.inputText ? (
            <View className="gap-1">
              <Text className="text-status-gray text-[11px] font-semibold uppercase tracking-wider">
                Input
              </Text>
              <Text
                className="text-text-muted text-[12px] leading-4"
                style={{ fontFamily: MONO_FONT }}
              >
                {truncate(part.inputText)}
              </Text>
            </View>
          ) : null}
          {part.error ? (
            <View className="gap-1">
              <Text className="text-status-gray text-[11px] font-semibold uppercase tracking-wider">
                Error
              </Text>
              <Text className="text-error-text text-[12px] leading-4">
                {truncate(part.error)}
              </Text>
            </View>
          ) : part.resultText ? (
            <View className="gap-1">
              <Text className="text-status-gray text-[11px] font-semibold uppercase tracking-wider">
                Result
              </Text>
              <Text
                className="text-text-muted text-[12px] leading-4"
                style={{ fontFamily: MONO_FONT }}
              >
                {truncate(part.resultText)}
              </Text>
            </View>
          ) : part.status === "cancelled" ? (
            <Text className="text-status-gray text-[12px]">Stopped</Text>
          ) : null}
        </View>
      )}
    </View>
  );
}
