import { useT } from "@agent-native/core/client/i18n";
import {
  ChatHistoryRail,
  type ChatHistoryRailLabels,
  type ChatHistoryRailProps,
} from "@agent-native/toolkit/chat-history/ChatHistoryRail";

import type { UseOwnershipChatHistoryResult } from "./useOwnershipChatHistory.js";

export {
  ownDraftRows,
  chatThreadToHistoryItem,
  type OwnDraftRow,
  type OwnDraftRowsOptions,
  type ChatThreadHistoryItemOptions,
} from "./rows.js";
export {
  useOwnershipChatHistory,
  type UseOwnershipChatHistoryOptions,
  type UseOwnershipChatHistoryResult,
  type OwnershipChatHistoryMutationKind,
  type OwnershipChatHistorySection,
  type OwnershipChatHistoryListProps,
} from "./useOwnershipChatHistory.js";

export type OwnershipChatHistoryRailProps = Omit<
  ChatHistoryRailProps,
  "items" | "sections" | "railLabels" | "loading" | "error"
> &
  Pick<UseOwnershipChatHistoryResult, "sections" | "listProps"> & {
    railLabels?: Partial<ChatHistoryRailLabels>;
    loading?: boolean;
    error?: Error | null;
  };

export function OwnershipChatHistoryRail({
  sections,
  listProps,
  railLabels,
  labels,
  loading: _loading,
  error: _error,
  ...props
}: OwnershipChatHistoryRailProps) {
  const t = useT();
  return (
    <ChatHistoryRail
      {...listProps}
      {...props}
      labels={{
        copyLink: t("agentChat.history.copyLink"),
        onlyYou: t("agentChat.history.onlyYou"),
        hide: t("agentChat.history.hide"),
        unread: t("agentChat.history.unread"),
        ...labels,
      }}
      sections={sections}
      railLabels={{
        newChat: t("agentChat.tabs.newChat"),
        showMore: t("agentChat.history.showAll"),
        showLess: t("agentChat.history.showLess"),
        ...railLabels,
        sections: railLabels?.sections ?? {
          showAll: t("agentChat.history.showAll"),
          showLess: t("agentChat.history.showLess"),
          loadMore: t("agentChat.history.loadMore"),
          loadingMore: t("agentChat.history.loadingMore"),
          retry: t("agentChat.history.retry"),
        },
      }}
    />
  );
}
