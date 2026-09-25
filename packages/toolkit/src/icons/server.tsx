import * as React from "react";

import { cn } from "../utils.js";
import type { ResourceIconProps } from "./ResourceIcon.js";

export * from "./recents.js";
export * from "./types.js";

export function ResourceIcon({
  value,
  size = 20,
  fallback = null,
  label,
  className,
  resolveImageUrl,
}: ResourceIconProps) {
  const accessibility = label
    ? { role: "img", "aria-label": label }
    : { "aria-hidden": true as const };

  if (!value) return fallback;
  if (value.kind === "emoji") {
    return (
      <span
        {...accessibility}
        className={cn(
          "inline-flex shrink-0 items-center justify-center",
          className,
        )}
        style={{ fontSize: size, lineHeight: 1 }}
      >
        {value.emoji}
      </span>
    );
  }
  if (value.kind === "image") {
    const src = resolveImageUrl?.(value);
    if (!src) return fallback;
    return (
      <img
        src={src}
        alt={label ?? value.alt ?? ""}
        className={cn("inline-block shrink-0 object-contain", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return fallback;
}

export function ResourceIconPicker() {
  return null;
}
