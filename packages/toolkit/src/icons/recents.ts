import * as React from "react";

import type { ResourceIconValue } from "./types.js";

export const RESOURCE_ICON_RECENTS_LIMIT = 24;

export function resourceIconKey(value: ResourceIconValue): string {
  if (value.kind === "emoji") return `emoji:${value.emoji}`;
  if (value.kind === "library") {
    return `library:${value.library}:${value.name}:${value.variant ?? "outline"}:${value.color ?? "default"}`;
  }
  return `image:${value.authority}:${value.assetId}`;
}

export function addResourceIconRecent(
  recents: readonly ResourceIconValue[],
  value: ResourceIconValue,
  limit = RESOURCE_ICON_RECENTS_LIMIT,
): ResourceIconValue[] {
  const key = resourceIconKey(value);
  return [
    value,
    ...recents.filter((recent) => resourceIconKey(recent) !== key),
  ].slice(0, limit);
}

export function useResourceIconRecents(
  recents: readonly ResourceIconValue[],
  onRecentsChange?: (recents: ResourceIconValue[]) => void,
) {
  return React.useCallback(
    (value: ResourceIconValue) => {
      onRecentsChange?.(addResourceIconRecent(recents, value));
    },
    [onRecentsChange, recents],
  );
}
