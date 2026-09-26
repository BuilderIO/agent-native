import { useState } from "react";

import type { ElementInfo } from "../types";
import { roundToOneDecimal } from "./position-helpers";

export function elementIdentityKey(element: ElementInfo): string {
  return [
    elementStableKey(element),
    Math.round(element.boundingRect.x),
    Math.round(element.boundingRect.y),
    Math.round(element.boundingRect.width),
    Math.round(element.boundingRect.height),
  ].join(":");
}

export function elementStableKey(element: ElementInfo): string {
  return element.sourceId || element.id || element.selector || element.tagName;
}

export function interactionStateSelectionKey(
  element: ElementInfo,
  fileId: string | null | undefined,
  selectedCount: number,
): string {
  return `${fileId || "no-file"}:${selectedCount}:${elementStableKey(element)}`;
}

const aspectRatioLocks = new Map<string, number>();

export function useAspectRatioLock(element: ElementInfo) {
  const key = elementStableKey(element);
  const [, forceRender] = useState(0);
  const locked = aspectRatioLocks.has(key);
  const ratio = aspectRatioLocks.get(key);

  const setLocked = (nextLocked: boolean, currentRatio?: number) => {
    if (nextLocked) {
      if (Number.isFinite(currentRatio) && (currentRatio as number) > 0) {
        aspectRatioLocks.set(key, currentRatio as number);
      }
    } else {
      aspectRatioLocks.delete(key);
    }
    forceRender((n) => n + 1);
  };

  return { locked, ratio, setLocked };
}

export function deriveLockedAspectSize(
  axis: "width" | "height",
  px: number,
  ratio: number,
): number {
  return axis === "width"
    ? roundToOneDecimal(px / ratio)
    : roundToOneDecimal(px * ratio);
}
