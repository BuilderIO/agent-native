import { useAvatarUrl } from "@agent-native/core/client/use-avatar";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@agent-native/toolkit/ui/avatar";
import { cn } from "@agent-native/toolkit/utils";

import type { ReviewAgentIdentity } from "./review-agent.js";
import { ReviewAgentMark } from "./ReviewAgentMark.js";

export interface ReviewAuthorAvatarProps {
  name: string;
  email?: string | null | undefined;
  /** When set, shows the agent's brand mark and never a photo. */
  agent?: ReviewAgentIdentity | null | undefined;
  size?: 24 | 32 | undefined;
  className?: string | undefined;
}

export function ReviewAuthorAvatar({
  name,
  email,
  agent = null,
  size = 24,
  className,
}: ReviewAuthorAvatarProps) {
  const avatarUrl = useAvatarUrl(agent ? null : email);
  const sizeClass = size === 32 ? "size-8" : "size-6";
  if (agent) {
    return (
      <span
        role="img"
        aria-label={agent.label}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full border border-border bg-popover",
          sizeClass,
          className,
        )}
      >
        <ReviewAgentMark
          kind={agent.kind}
          className={size === 32 ? "size-5" : "size-4"}
        />
      </span>
    );
  }
  return (
    <Avatar className={cn(sizeClass, className)}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} /> : null}
      {/* text-muted-foreground on bg-muted is 4.23:1 in light mode, below AA. */}
      <AvatarFallback
        className={cn(
          "bg-muted font-semibold text-foreground",
          size === 32 ? "text-xs" : "text-[10px]",
        )}
      >
        {authorInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

function authorInitials(value: string): string {
  const normalized = value.split("@")[0]?.trim() ?? "";
  const parts = normalized.split(/[\s._+-]+/).filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return initials || "R";
}
