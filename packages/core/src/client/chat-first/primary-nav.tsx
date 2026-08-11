import {
  IconClock,
  IconPlus,
  IconPlugConnected,
  IconSearch,
} from "@tabler/icons-react";
import type { ReactNode } from "react";

import { defaultChatFirstCopy } from "./copy.js";
import type { ChatFirstCopy } from "./types.js";

export type ChatFirstPrimaryTab = "new-chat" | "integrations" | "scheduled";

export function ChatFirstPrimaryNavigation({
  onNewChat,
  onOpenIntegrations,
  onOpenScheduled,
  onSearch,
  activeTab,
  copy = defaultChatFirstCopy,
}: {
  onNewChat?: () => void;
  onOpenIntegrations: () => void;
  onOpenScheduled: () => void;
  onSearch?: () => void;
  activeTab?: ChatFirstPrimaryTab;
  copy?: ChatFirstCopy;
}) {
  const tabClassName = (tab: ChatFirstPrimaryTab) =>
    `flex h-8 w-full items-center gap-2 rounded-md border px-2 text-[13px] font-medium transition-[background-color,border-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      activeTab === tab
        ? "border-sidebar-foreground/45 bg-sidebar-accent text-sidebar-accent-foreground"
        : "border-transparent text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    }`;

  const renderTab = (
    tab: ChatFirstPrimaryTab,
    content: ReactNode,
    onSelect: () => void,
  ) => (
    <button
      type="button"
      role="tab"
      aria-selected={activeTab === tab}
      className={tabClassName(tab)}
      onClick={onSelect}
    >
      {content}
    </button>
  );

  return (
    <div>
      <div
        role="tablist"
        aria-label="Primary navigation"
        className="grid gap-px"
      >
        {onNewChat
          ? renderTab(
              "new-chat",
              <>
                <IconPlus size={15} className="shrink-0" aria-hidden="true" />
                <span>{copy("newChat")}</span>
              </>,
              onNewChat,
            )
          : null}
        {renderTab(
          "integrations",
          <>
            <IconPlugConnected
              size={15}
              className="shrink-0"
              aria-hidden="true"
            />
            <span>{copy("integrations")}</span>
          </>,
          onOpenIntegrations,
        )}
        {renderTab(
          "scheduled",
          <>
            <IconClock size={15} className="shrink-0" aria-hidden="true" />
            <span>{copy("scheduled")}</span>
          </>,
          onOpenScheduled,
        )}
      </div>
      {onSearch ? (
        <button
          type="button"
          className="mt-px flex h-8 w-full items-center gap-2 rounded-md border border-transparent px-2 text-[13px] font-medium text-sidebar-foreground/80 transition-[background-color,color] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onSearch}
        >
          <IconSearch size={15} className="shrink-0" aria-hidden="true" />
          <span>{copy("search")}</span>
        </button>
      ) : null}
    </div>
  );
}
