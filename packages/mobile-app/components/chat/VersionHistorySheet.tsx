import {
  IconArrowBackUp,
  IconClock,
  IconRefresh,
} from "@tabler/icons-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { MobilePopover } from "@/components/chat/MobilePopover";
import { callAppAction, callAppActionGet } from "@/lib/agent-chat/api";
import type {
  MobileChatScope,
  MobileChatVersion,
} from "@/lib/agent-chat/types";
import {
  mobileVersionHistoryListRequest,
  mobileVersionHistoryRestoreRequest,
  normalizeMobileChatVersions,
} from "@/lib/agent-chat/version-history";
import { useMobileThemeColors } from "@/lib/mobile-colors";
import {
  flushMobileSlidesDeckSave,
  MobileDeckSaveFlushError,
} from "@/lib/mobile-deck-save-bridge";

export function VersionHistorySheet({
  visible,
  scope,
  threadId,
  baseUrl,
  canRestore,
  onClose,
  onRestoringChange,
  onRestored,
}: {
  visible: boolean;
  scope: MobileChatScope | null;
  threadId: string;
  baseUrl: string;
  canRestore: boolean;
  onClose: () => void;
  onRestoringChange?: (restoring: boolean) => void;
  onRestored?: () => void;
}) {
  const { foreground, mutedForeground, destructive } = useMobileThemeColors();
  const [versions, setVersions] = useState<MobileChatVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadVersions = async () => {
    if (!scope) return;
    const request = mobileVersionHistoryListRequest(scope, threadId);
    if (!request) {
      setError("Version history is not available for this item.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await callAppActionGet(
        request.action,
        request.args,
        baseUrl,
      );
      setVersions(normalizeMobileChatVersions(result));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not load version history.",
      );
      setVersions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible) void loadVersions();
  }, [baseUrl, scope?.id, scope?.type, threadId, visible]);

  const restore = async (version: MobileChatVersion) => {
    if (!scope || !version.editable || restoringId || !canRestore) return;
    const request = mobileVersionHistoryRestoreRequest(scope, version.id);
    if (!request) return;
    setRestoringId(version.id);
    setError(null);
    onRestoringChange?.(true);
    try {
      let args = request.args;
      if (scope.type === "document") {
        const current = await callAppActionGet<{ updatedAt?: unknown }>(
          "get-document",
          { id: scope.id },
          baseUrl,
        );
        if (typeof current.updatedAt !== "string" || !current.updatedAt) {
          throw new Error("Could not confirm the latest document version.");
        }
        args = { ...args, expectedUpdatedAt: current.updatedAt };
      }
      if (scope.type === "deck") {
        await flushMobileSlidesDeckSave(scope.id);
      }
      await callAppAction(request.action, args, baseUrl);
      onRestored?.();
      onClose();
    } catch (reason) {
      setError(
        reason instanceof MobileDeckSaveFlushError
          ? "Could not restore this version."
          : reason instanceof Error
            ? reason.message
            : "Could not restore this version.",
      );
    } finally {
      setRestoringId(null);
      onRestoringChange?.(false);
    }
  };

  return (
    <MobilePopover
      visible={visible}
      title="Version history"
      onClose={onClose}
      bottomClassName="mb-4"
      accessibilityLabel="Dismiss version history"
    >
      <View className="max-h-[72vh]">
        {loading ? (
          <View className="items-center justify-center py-10">
            <ActivityIndicator color={mutedForeground} />
          </View>
        ) : versions.length > 0 ? (
          <ScrollView contentContainerClassName="gap-2 p-3">
            {versions.map((version) => (
              <View
                key={version.id}
                className="flex-row items-center gap-3 rounded-xl border border-border-dark bg-card-dark p-3"
              >
                <IconClock
                  color={mutedForeground}
                  size={17}
                  strokeWidth={1.9}
                />
                <View className="flex-1 gap-0.5">
                  <Text
                    className="text-foreground text-[13px] font-semibold"
                    numberOfLines={1}
                  >
                    {version.isBeginning
                      ? "Beginning of this chat"
                      : version.label}
                  </Text>
                  <Text className="text-text-muted text-[11px]">
                    {new Date(version.createdAt).toLocaleString()}
                  </Text>
                </View>
                <Pressable
                  disabled={
                    !canRestore || !version.editable || restoringId !== null
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Revert to ${version.isBeginning ? "beginning of this chat" : version.label}`}
                  className="min-h-9 flex-row items-center gap-1.5 rounded-lg bg-primary px-3 active:opacity-75 disabled:opacity-45"
                  onPress={() => void restore(version)}
                >
                  {restoringId === version.id ? (
                    <ActivityIndicator color={foreground} size="small" />
                  ) : (
                    <IconArrowBackUp
                      color={foreground}
                      size={15}
                      strokeWidth={2}
                    />
                  )}
                  <Text className="text-primary-foreground text-[12px] font-bold">
                    Revert
                  </Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        ) : (
          <View className="items-center justify-center gap-3 px-6 py-10">
            <Text className="text-center text-[13px] leading-5 text-text-muted">
              {error ?? "No saved versions yet."}
            </Text>
            {error ? (
              <Pressable
                accessibilityRole="button"
                className="flex-row items-center gap-2 rounded-lg border border-border-dark px-3 py-2 active:opacity-75"
                onPress={() => void loadVersions()}
              >
                <IconRefresh color={mutedForeground} size={15} />
                <Text className="text-foreground text-[12px] font-semibold">
                  Retry
                </Text>
              </Pressable>
            ) : null}
          </View>
        )}
        {error && versions.length > 0 ? (
          <Text
            style={{ color: destructive }}
            className="px-4 pb-3 text-[12px]"
          >
            {error}
          </Text>
        ) : null}
        {!canRestore ? (
          <Text className="px-4 pb-3 text-[12px] text-text-muted">
            Stop the current chat before restoring a version.
          </Text>
        ) : null}
      </View>
    </MobilePopover>
  );
}
