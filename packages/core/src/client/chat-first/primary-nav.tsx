import { IconClock, IconPlugConnected } from "@tabler/icons-react";

import { defaultChatFirstCopy } from "./copy.js";
import type { ChatFirstCopy } from "./types.js";

export function ChatFirstPrimaryNavigation({
  onOpenIntegrations,
  onOpenScheduled,
  copy = defaultChatFirstCopy,
}: {
  onOpenIntegrations: () => void;
  onOpenScheduled: () => void;
  copy?: ChatFirstCopy;
}) {
  return (
    <>
      <button
        type="button"
        className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ color: "hsl(var(--sidebar-foreground) / 0.8)" }}
        onClick={onOpenIntegrations}
      >
        <IconPlugConnected size={15} className="shrink-0" aria-hidden="true" />
        <span>{copy("integrations")}</span>
      </button>
      <button
        type="button"
        className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ color: "hsl(var(--sidebar-foreground) / 0.8)" }}
        onClick={onOpenScheduled}
      >
        <IconClock size={15} className="shrink-0" aria-hidden="true" />
        <span>{copy("scheduled")}</span>
      </button>
    </>
  );
}
