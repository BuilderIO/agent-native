import { safeParseIconValue, type IconValue } from "@agent-native/core/icons";
import { ResourceIcon } from "@agent-native/toolkit/icons";
import type { ReactNode } from "react";

import { contentImageIconUrl } from "./private-icon-assets";

interface ContentIconProps {
  value: IconValue | string | null | undefined;
  size?: number;
  className?: string;
  fallback?: ReactNode;
  label?: string;
}

export function contentIconValue(
  value: IconValue | string | null | undefined,
): IconValue | null {
  if (value === undefined) return null;
  const parsed = safeParseIconValue(value);
  return parsed.success ? parsed.data : null;
}

export function ContentIcon({
  value,
  size,
  className,
  fallback,
  label,
}: ContentIconProps) {
  return (
    <ResourceIcon
      value={contentIconValue(value)}
      size={size}
      className={className}
      fallback={fallback}
      label={label}
      resolveImageUrl={contentImageIconUrl}
    />
  );
}
