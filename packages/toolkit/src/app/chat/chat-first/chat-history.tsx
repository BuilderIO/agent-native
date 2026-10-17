import { useT } from "@agent-native/core/client/i18n";
import {
  ChatHistoryRail,
  type ChatHistoryRailLabels,
  type ChatHistoryRailProps,
  type ChatHistoryRailSection,
} from "@agent-native/toolkit/chat-history/ChatHistoryRail";
import type { ReactNode } from "react";

import {
  ChatHistoryList,
  type ChatHistoryItem,
  type ChatHistoryListProps,
} from "../chat/ChatHistoryList.js";

interface ChatFirstChatHistoryItemsProps extends Omit<
  ChatHistoryListProps,
  "items" | "sections" | "variant"
> {
  items: ChatHistoryItem[];
  sections?: never;
  label?: ReactNode;
  headerAction?: ReactNode;
}

type ChatFirstChatHistorySectionsProps = Omit<
  Extract<ChatHistoryRailProps, { sections: ChatHistoryRailSection[] }>,
  "railLabels" | "renderRail"
> & {
  railLabels?: Partial<ChatHistoryRailLabels>;
  label?: ReactNode;
  headerAction?: ReactNode;
};

export type ChatFirstChatHistoryProps =
  | ChatFirstChatHistoryItemsProps
  | ChatFirstChatHistorySectionsProps;

function SectionedChatHistory({
  railLabels,
  ...props
}: ChatFirstChatHistorySectionsProps) {
  const t = useT();
  return (
    <ChatHistoryRail
      {...props}
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

export function ChatFirstChatHistory({
  label = "Chats",
  headerAction,
  className,
  ...props
}: ChatFirstChatHistoryProps) {
  if (!props.sections && props.items.length === 0) {
    return (
      <section
        data-chat-first-chat-history
        className={["min-h-0 min-w-0 flex-1", className]
          .filter(Boolean)
          .join(" ")}
      />
    );
  }

  return (
    <section
      data-chat-first-chat-history
      className={["min-h-0 min-w-0", className].filter(Boolean).join(" ")}
    >
      <div
        data-chat-first-chat-history-header
        className="group mb-1 flex min-h-6 items-center justify-between gap-2 px-2"
      >
        <p className="min-w-0 text-[11px] font-medium text-sidebar-foreground/50">
          {label}
        </p>
        {headerAction ? (
          <div className="shrink-0 opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100">
            {headerAction}
          </div>
        ) : null}
      </div>
      {props.sections ? (
        <SectionedChatHistory {...props} className="min-w-0" />
      ) : (
        <ChatHistoryList {...props} variant="rail" className="min-w-0" />
      )}
    </section>
  );
}
