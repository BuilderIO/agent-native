/**
 * The two per-type primitives both surfaces render identically: an option chip
 * and a star rating. Everything larger — the grid's fixed-height cell, the
 * record panel's labelled row — stays with its own surface.
 */

import { IconStar, IconStarFilled } from "@tabler/icons-react";

import { cn } from "@/lib/utils";

import {
  RATING_MAX,
  type CrmAttributeValue,
  type CrmValueToken,
} from "./attribute-value";

/**
 * An option's colour tints the chip rather than filling it. `color-mix` instead
 * of an appended hex alpha: an option colour may be any CSS colour, and
 * `#0a0` + "22" is not a colour at all — it silently rendered untinted.
 */
export function AttributeOptionChip({
  token,
  className,
}: {
  token: CrmValueToken;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-xs font-medium",
        className,
      )}
      style={
        token.color
          ? {
              backgroundColor: `color-mix(in srgb, ${token.color} 14%, transparent)`,
              borderColor: `color-mix(in srgb, ${token.color} 35%, transparent)`,
              color: token.color,
            }
          : undefined
      }
    >
      <span className="truncate">{token.label}</span>
    </span>
  );
}

export function AttributeRating({
  value,
  className,
}: {
  value: CrmAttributeValue | undefined;
  className?: string;
}) {
  const filled = typeof value === "number" ? Math.round(value) : 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {Array.from({ length: RATING_MAX }, (_, index) => index + 1).map((step) =>
        step <= filled ? (
          <IconStarFilled key={step} className="size-3.5 text-amber-500" />
        ) : (
          <IconStar key={step} className="size-3.5 text-muted-foreground/40" />
        ),
      )}
    </span>
  );
}
