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
}

/**
 * The single chat-list presentation used by the chat-first rail on every
 * host. Hosts still own thread fetching and actions, but row rhythm and the
 * Chats section treatment stay identical.
 */
export function ChatFirstChatHistory({
  items,
  label = "Chats",
  className,
  ...props
}: ChatFirstChatHistoryProps) {
  return (
    <section
      data-chat-first-chat-history
      className={["min-h-0 min-w-0", className].filter(Boolean).join(" ")}
    >
      <p className="mb-1 px-2 text-[11px] font-medium text-sidebar-foreground/50">
        {label}
      </p>
      <ChatHistoryList
        {...props}
        items={items}
        variant="rail"
        className="min-w-0"
      />
    </section>
  );
}
