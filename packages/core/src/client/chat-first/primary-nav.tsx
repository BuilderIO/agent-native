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
  stickyNewChat = false,
  copy = defaultChatFirstCopy,
}: {
  onNewChat?: () => void;
  onOpenIntegrations: () => void;
  onOpenScheduled: () => void;
  onSearch?: () => void;
  activeTab?: ChatFirstPrimaryTab;
  stickyNewChat?: boolean;
  copy?: ChatFirstCopy;
}) {
  const tabClassName = (tab: ChatFirstPrimaryTab) =>
    `flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] font-medium transition-[background-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      activeTab === tab
        ? "bg-sidebar-accent text-sidebar-accent-foreground"
        : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    }`;

  const renderTab = (
    tab: ChatFirstPrimaryTab,
    content: ReactNode,
    onSelect: () => void,
    className?: string,
  ) => (
    <button
      type="button"
      role="tab"
      aria-selected={activeTab === tab}
      className={[tabClassName(tab), className].filter(Boolean).join(" ")}
      onClick={onSelect}
    >
      {content}
    </button>
  );

  const newChatTab = onNewChat
    ? renderTab(
        "new-chat",
        <>
          <IconPlus size={15} className="shrink-0" aria-hidden="true" />
          <span>{copy("newChat")}</span>
        </>,
        onNewChat,
        "code-agents-primary-new-chat",
      )
    : null;
  const integrationsTab = renderTab(
    "integrations",
    <>
      <IconPlugConnected size={15} className="shrink-0" aria-hidden="true" />
      <span>{copy("integrations")}</span>
    </>,
    onOpenIntegrations,
  );
  const scheduledTab = renderTab(
    "scheduled",
    <>
      <IconClock size={15} className="shrink-0" aria-hidden="true" />
      <span>{copy("scheduled")}</span>
    </>,
    onOpenScheduled,
  );
  const searchAction = onSearch ? (
    <button
      type="button"
      className="mt-px flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] font-medium text-sidebar-foreground/80 transition-[background-color,color] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onSearch}
    >
      <IconSearch size={15} className="shrink-0" aria-hidden="true" />
      <span>{copy("search")}</span>
    </button>
  ) : null;

  if (stickyNewChat) {
    return (
      <>
        {newChatTab ? (
          <div className="code-agents-primary-new-chat-shell">{newChatTab}</div>
        ) : null}
        <div className="code-agents-nav-list" aria-label="Agent navigation">
          <div
            role="tablist"
            aria-label="Primary navigation"
            className="grid gap-px"
          >
            {integrationsTab}
            {scheduledTab}
          </div>
          {searchAction}
        </div>
      </>
    );
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Primary navigation"
        className="grid gap-px"
      >
        {newChatTab}
        {integrationsTab}
        {scheduledTab}
      </div>
      {searchAction}
    </div>
  );
}
