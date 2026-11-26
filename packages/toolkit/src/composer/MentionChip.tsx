import type { ComponentPropsWithRef, ReactNode } from "react";

import { cn } from "../utils.js";
import { MentionItemMedia } from "./MentionItemMedia.js";
import type { MentionItemMedia as MentionItemMediaValue } from "./types.js";

export interface MentionChipProps extends Omit<
  ComponentPropsWithRef<"span">,
  "children"
> {
  label: ReactNode;
  icon?: string;
  media?: MentionItemMediaValue | null;
  fallbackIcon?: "clipboard" | "file" | "stack";
}

/**
 * The inline chip a mention is drawn as, in the composer and wherever a sent
 * message shows its mentions, so the two always look the same.
 */
export function MentionChip({
  label,
  icon,
  media,
  fallbackIcon = "stack",
  className,
  ...props
}: MentionChipProps) {
  return (
    <span
      {...props}
      className={cn(
        "mx-1 inline-flex max-w-[200px] items-center h-5 gap-1 rounded-[var(--agent-kit-radius-xs,0.25rem)] border border-border bg-muted/50 px-2 text-xs leading-4 font-medium text-foreground align-middle",
        className,
      )}
    >
      <MentionItemMedia
        icon={icon}
        media={media}
        size="sm"
        fallbackIcon={fallbackIcon}
      />
      <span className="truncate">{label}</span>
    </span>
  );
}
