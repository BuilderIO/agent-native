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
  labels,
  ...props
}: ChatFirstChatHistorySectionsProps) {
  const t = useT();
  return (
    <ChatHistoryRail
      {...props}
      labels={{
        copyLink: t("agentChat.history.copyLink"),
        onlyYou: t("agentChat.history.onlyYou"),
        hide: t("agentChat.history.hide"),
        unread: t("agentChat.history.unread"),
        ...labels,
      }}
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
  label,
  headerAction,
  className,
  ...props
}: ChatFirstChatHistoryProps) {
  const t = useT();
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

  // Sections carry their own labels (My chats, Shared with you), so a sectioned
  // list keeps the header only for its action.
  const showLabel = !props.sections;
  return (
    <section
      data-chat-first-chat-history
      className={["min-h-0 min-w-0", className].filter(Boolean).join(" ")}
    >
      {showLabel || headerAction ? (
        <div
          data-chat-first-chat-history-header
          className="group mb-1 flex min-h-6 items-center justify-between gap-2 px-2"
        >
          {showLabel ? (
            <p className="min-w-0 text-[11px] font-medium text-sidebar-foreground/50">
              {label ?? t("agentChat.chatFirst.chats")}
            </p>
          ) : null}
          {headerAction ? (
            <div className="ms-auto shrink-0 opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
              {headerAction}
            </div>
          ) : null}
        </div>
      ) : null}
      {props.sections ? (
        <SectionedChatHistory {...props} className="min-w-0" />
      ) : (
        <ChatHistoryList {...props} variant="rail" className="min-w-0" />
      )}
    </section>
  );
}
