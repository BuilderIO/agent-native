import * as React from "react";

import { cn } from "../utils.js";
import { loadTablerIcon, type TablerIconComponent } from "./catalog.js";
import { resourceIconColorClasses } from "./icon-colors.js";
import type { ResourceIconValue } from "./types.js";

export interface ResourceIconProps {
  value: ResourceIconValue | null | undefined;
  size?: number | string;
  fallback?: React.ReactNode;
  label?: string;
  className?: string;
  resolveImageUrl?: (
    image: Extract<ResourceIconValue, { kind: "image" }>,
  ) => string | undefined;
}

export function ResourceIcon({
  value,
  size = 20,
  fallback = null,
  label,
  className,
  resolveImageUrl,
}: ResourceIconProps) {
  const [LibraryIcon, setLibraryIcon] =
    React.useState<TablerIconComponent | null>(null);

  React.useEffect(() => {
    let active = true;
    setLibraryIcon(null);
    if (value?.kind === "library") {
      const catalogName =
        value.variant === "filled" ? `${value.name}-filled` : value.name;
      void loadTablerIcon(catalogName).then((component) => {
        if (active) setLibraryIcon(() => component);
      });
    }
    return () => {
      active = false;
    };
  }, [
    value?.kind === "library" ? value.name : undefined,
    value?.kind === "library" ? value.variant : undefined,
  ]);

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
  if (!LibraryIcon) return fallback;
  return (
    <LibraryIcon
      {...accessibility}
      size={size}
      stroke={2}
      className={cn(
        value.color && resourceIconColorClasses[value.color],
        className,
      )}
    />
  );
}
