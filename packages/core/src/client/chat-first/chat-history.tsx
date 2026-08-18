import type { ReactNode } from "react";

import {
  ChatHistoryList,
  type ChatHistoryItem,
  type ChatHistoryListProps,
} from "../chat/ChatHistoryList.js";

export interface ChatFirstChatHistoryProps extends Omit<
  ChatHistoryListProps,
  "items" | "sections" | "variant"
> {
  items: ChatHistoryItem[];
  label?: ReactNode;
  /** Optional contextual actions for the Chats section header. */
  headerAction?: ReactNode;
}

/**
 * The single chat-list presentation used by the chat-first rail on every
 * host. Hosts still own thread fetching and actions, but row rhythm and the
 * Chats section treatment stay identical.
 */
export function ChatFirstChatHistory({
  items,
  label = "Chats",
  headerAction,
  className,
  ...props
}: ChatFirstChatHistoryProps) {
  if (items.length === 0) {
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
      <ChatHistoryList
        {...props}
        items={items}
        variant="rail"
        className="min-w-0"
      />
    </section>
  );
}
