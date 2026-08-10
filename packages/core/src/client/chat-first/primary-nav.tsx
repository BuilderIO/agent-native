import {
  IconClock,
  IconPlus,
  IconPlugConnected,
  IconSearch,
} from "@tabler/icons-react";

import { defaultChatFirstCopy } from "./copy.js";
import type { ChatFirstCopy } from "./types.js";

export function ChatFirstPrimaryNavigation({
  onNewChat,
  onOpenIntegrations,
  onOpenScheduled,
  onSearch,
  copy = defaultChatFirstCopy,
}: {
  onNewChat?: () => void;
  onOpenIntegrations: () => void;
  onOpenScheduled: () => void;
  onSearch?: () => void;
  copy?: ChatFirstCopy;
}) {
  return (
    <>
      {onNewChat ? (
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onNewChat}
        >
          <IconPlus size={15} className="shrink-0" aria-hidden="true" />
          <span>{copy("newChat")}</span>
        </button>
      ) : null}
      <button
        type="button"
        className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onOpenIntegrations}
      >
        <IconPlugConnected size={15} className="shrink-0" aria-hidden="true" />
        <span>{copy("integrations")}</span>
      </button>
      <button
        type="button"
        className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onOpenScheduled}
      >
        <IconClock size={15} className="shrink-0" aria-hidden="true" />
        <span>{copy("scheduled")}</span>
      </button>
      {onSearch ? (
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onSearch}
        >
          <IconSearch size={15} className="shrink-0" aria-hidden="true" />
          <span>{copy("search")}</span>
        </button>
      ) : null}
    </>
  );
}
