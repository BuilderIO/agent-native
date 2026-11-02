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
  /**
   * When set, shows the agent's brand mark and never a photo. Without a
   * `label` the mark has no name to give, so it is hidden from assistive tech.
   */
  agent?:
    | (Pick<ReviewAgentIdentity, "kind"> & { label?: string | undefined })
    | null
    | undefined;
  size?: 16 | 24 | 32 | undefined;
  /** Hides the avatar from assistive tech when the person's name sits beside it. */
  decorative?: boolean | undefined;
  className?: string | undefined;
}

// Each class names one `--review-avatar-N` token. They are spelled out in full
// so Tailwind emits every class. An app that defines no tokens gets a dark gray
// that still holds white initials above 4.5:1.
const FALLBACK_BACKGROUNDS = [
  "bg-[hsl(var(--review-avatar-1,0_0%_40%))]",
  "bg-[hsl(var(--review-avatar-2,0_0%_40%))]",
  "bg-[hsl(var(--review-avatar-3,0_0%_40%))]",
  "bg-[hsl(var(--review-avatar-4,0_0%_40%))]",
  "bg-[hsl(var(--review-avatar-5,0_0%_40%))]",
  "bg-[hsl(var(--review-avatar-6,0_0%_40%))]",
] as const;

const SIZES = {
  16: { box: "size-4", text: "text-[9px]", mark: "size-3", letters: 1 },
  24: { box: "size-6", text: "text-[10px]", mark: "size-4", letters: 2 },
  32: { box: "size-8", text: "text-xs", mark: "size-5", letters: 2 },
} as const;

/**
 * One person, one look on every review surface: their photo when they have a
 * real one, otherwise their initials on a color that never changes for them,
 * and an agent's brand mark for an agent.
 */
export function ReviewAuthorAvatar({
  name,
  email,
  agent = null,
  size = 24,
  decorative = false,
  className,
}: ReviewAuthorAvatarProps) {
  const avatarUrl = useAvatarUrl(agent ? null : email);
  const { box, text, mark, letters } = SIZES[size];
  if (agent) {
    return (
      <span
        {...(decorative || !agent.label
          ? { "aria-hidden": true }
          : { role: "img", "aria-label": agent.label })}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full border border-border bg-popover text-foreground",
          box,
          className,
        )}
      >
        <ReviewAgentMark kind={agent.kind} className={mark} />
      </span>
    );
  }
  return (
    <Avatar
      {...(decorative ? { "aria-hidden": true } : {})}
      className={cn(box, className)}
    >
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} /> : null}
      <AvatarFallback
        className={cn(
          "font-semibold leading-none text-[hsl(var(--review-avatar-foreground,0_0%_100%))]",
          text,
          FALLBACK_BACKGROUNDS[colorIndex(email?.trim() || name)],
        )}
      >
        {reviewInitials(name, letters)}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * Up to `letters` capitals from a display name, or from the part of an address
 * before its `@`: "Enzo Ames" is "EA", "dev@local.test" is "D". A word with no
 * letter in it ("02") adds nothing.
 */
export function reviewInitials(source: string, letters: 1 | 2 = 2): string {
  const normalized = source.split("@")[0]?.trim() ?? "";
  const initials = normalized
    .split(/[\s._+-]+/)
    .map((part) => part.match(/\p{L}/u)?.[0])
    .filter((letter): letter is string => letter !== undefined)
    .slice(0, letters)
    .map((letter) => letter.toUpperCase())
    .join("");
  return initials || "?";
}

function colorIndex(key: string): number {
  let hash = 0;
  for (const char of key.toLowerCase()) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return Math.abs(hash) % FALLBACK_BACKGROUNDS.length;
}
