import { IconLayoutSidebarRightCollapse } from "@tabler/icons-react";

import { cn } from "./utils.js";

export function ChatFirstSurfacePanelToggle({
  open,
  onToggle,
  className,
}: {
  open: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex size-7 items-center justify-center rounded-md border border-border bg-card/95 text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      data-chat-first-surface-toggle
      aria-label={open ? "Hide side surface" : "Show side surface"}
      aria-pressed={open}
      title={`${open ? "Hide" : "Show"} side surface · ⌘⌥B`}
      onClick={onToggle}
    >
      <IconLayoutSidebarRightCollapse size={15} aria-hidden="true" />
    </button>
  );
}
