import { cn } from "@agent-native/toolkit/utils";

import type { ReviewAgentKind } from "./review-agent.js";
import { ReviewAgentMark } from "./ReviewAgentMark.js";

// Each class names one `--review-avatar-N` token from the toolkit styles.
// Spelled out in full so Tailwind emits every class.
const AVATAR_BACKGROUNDS = [
  "bg-[hsl(var(--review-avatar-1))]",
  "bg-[hsl(var(--review-avatar-2))]",
  "bg-[hsl(var(--review-avatar-3))]",
  "bg-[hsl(var(--review-avatar-4))]",
  "bg-[hsl(var(--review-avatar-5))]",
  "bg-[hsl(var(--review-avatar-6))]",
] as const;

export interface ReviewInitialAvatarProps {
  name?: string | null | undefined;
  email?: string | null | undefined;
  agent?: { kind: ReviewAgentKind } | null | undefined;
  size: 16 | 24;
  className?: string | undefined;
}

/** A person's initial on a color picked from their email, or an agent's mark. */
export function ReviewInitialAvatar({
  name,
  email,
  agent,
  size,
  className,
}: ReviewInitialAvatarProps) {
  if (agent) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full border border-border bg-popover text-foreground",
          size === 24 ? "size-6" : "size-4",
          className,
        )}
      >
        <ReviewAgentMark
          kind={agent.kind}
          className={size === 24 ? "size-4" : "size-3"}
        />
      </span>
    );
  }

  const colorKey =
    email?.trim().toLowerCase() || name?.trim().toLowerCase() || "";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold leading-none text-[hsl(var(--review-avatar-foreground))]",
        size === 24 ? "size-6 text-[10px]" : "size-4 text-[9px]",
        AVATAR_BACKGROUNDS[colorIndex(colorKey)],
        className,
      )}
    >
      {initialFor(name, email)}
    </span>
  );
}

function initialFor(name?: string | null, email?: string | null): string {
  const source = name?.trim() || email?.trim() || "";
  const first = Array.from(source)[0];
  return first ? first.toUpperCase() : "?";
}

function colorIndex(key: string): number {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % AVATAR_BACKGROUNDS.length;
}
