import { useT } from "@agent-native/core/client/i18n";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@agent-native/toolkit/ui";
import {
  IconClock,
  IconPlus,
  IconPlugConnected,
  IconSearch,
} from "@tabler/icons-react";
import type { ReactNode } from "react";

import {
  chatFirstActiveSurface,
  chatFirstNavTabActive,
  type ChatFirstPrimaryTab,
} from "./active-surface.js";
import { useChatFirstCopy } from "./copy.js";
import type { ChatFirstCopy } from "./types.js";

export type { ChatFirstPrimaryTab };

export function ChatFirstPrimaryNavigation({
  onNewChat,
  onOpenIntegrations,
  onOpenScheduled,
  onSearch,
  activeTab,
  collapsed = false,
  stickyNewChat = false,
  copy: copyProp,
}: {
  onNewChat?: () => void;
  onOpenIntegrations: () => void;
  onOpenScheduled: () => void;
  onSearch?: () => void;
  activeTab?: ChatFirstPrimaryTab;
  collapsed?: boolean;
  stickyNewChat?: boolean;
  copy?: ChatFirstCopy;
}) {
  const t = useT();
  const copy = useChatFirstCopy(copyProp);
  const surface = chatFirstActiveSurface({ activeTab });
  const isTabActive = (tab: ChatFirstPrimaryTab) =>
    chatFirstNavTabActive(surface, tab);

  const tabClassName = (tab: ChatFirstPrimaryTab) =>
    `agent-kit-density flex h-8 w-full items-center gap-2 rounded-md font-medium transition-[background-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      collapsed ? "justify-center px-0" : "px-2"
    } ${
      isTabActive(tab)
        ? "bg-sidebar-accent text-sidebar-accent-foreground"
        : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    }`;

  const tabLabel = (tab: ChatFirstPrimaryTab) =>
    tab === "new-chat"
      ? copy("newChat")
      : tab === "integrations"
        ? copy("integrations")
        : tab === "search"
          ? copy("search")
          : copy("scheduled");

  const renderTab = (
    tab: ChatFirstPrimaryTab,
    content: ReactNode,
    onSelect: () => void,
    className?: string,
  ) => {
    const label = tabLabel(tab);
    const control = (
      <button
        type="button"
        aria-current={isTabActive(tab) ? "page" : undefined}
        aria-label={collapsed || tab === "new-chat" ? label : undefined}
        className={[tabClassName(tab), className].filter(Boolean).join(" ")}
        onClick={onSelect}
      >
        {content}
      </button>
    );

    return collapsed ? (
      <Tooltip>
        <TooltipTrigger asChild>{control}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    ) : (
      control
    );
  };

  const newChatTab = onNewChat
    ? renderTab(
        "new-chat",
        <>
          <IconPlus size={16} className="shrink-0" aria-hidden="true" />
          <span className={collapsed ? "sr-only" : undefined}>
            {copy("newChat")}
          </span>
        </>,
        onNewChat,
        "code-agents-primary-new-chat",
      )
    : null;
  const integrationsTab = renderTab(
    "integrations",
    <>
      <IconPlugConnected size={16} className="shrink-0" aria-hidden="true" />
      <span className={collapsed ? "sr-only" : undefined}>
        {copy("integrations")}
      </span>
    </>,
    onOpenIntegrations,
  );
  const scheduledTab = renderTab(
    "scheduled",
    <>
      <IconClock size={16} className="shrink-0" aria-hidden="true" />
      <span className={collapsed ? "sr-only" : undefined}>
        {copy("scheduled")}
      </span>
    </>,
    onOpenScheduled,
  );
  const searchTab = onSearch
    ? renderTab(
        "search",
        <>
          <IconSearch size={16} className="shrink-0" aria-hidden="true" />
          <span className={collapsed ? "sr-only" : undefined}>
            {copy("search")}
          </span>
        </>,
        onSearch,
      )
    : null;

  return (
    <TooltipProvider delayDuration={0}>
      {stickyNewChat ? (
        <>
          {newChatTab ? (
            <div className="code-agents-primary-new-chat-shell">
              {newChatTab}
            </div>
          ) : null}
          <nav
            className="code-agents-nav-list"
            aria-label={t("agentChat.chatFirst.agentNavigation")}
          >
            <div className="grid gap-px">
              {integrationsTab}
              {scheduledTab}
              {searchTab}
            </div>
          </nav>
        </>
      ) : (
        <nav aria-label={t("agentChat.chatFirst.primaryNavigation")}>
          <div className="grid gap-px">
            {newChatTab}
            {integrationsTab}
            {scheduledTab}
            {searchTab}
          </div>
        </nav>
      )}
    </TooltipProvider>
  );
}
