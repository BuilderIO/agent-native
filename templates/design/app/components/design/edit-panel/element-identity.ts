import { useState } from "react";

import type { ElementInfo } from "../types";
import { roundToOneDecimal } from "./position-helpers";

export function elementIdentityKey(element: ElementInfo): string {
  return [
    element.sourceId ?? element.id ?? element.selector ?? element.tagName,
    Math.round(element.boundingRect.x),
    Math.round(element.boundingRect.y),
    Math.round(element.boundingRect.width),
    Math.round(element.boundingRect.height),
  ].join(":");
}

/**
 * Stable per-element identity for UI-only inspector state that must survive
 * resizing (unlike elementIdentityKey, which folds in the bounding rect and
 * therefore changes on every resize — exactly what an aspect-ratio lock needs
 * to persist across). Falls back through the same id chain.
 */
function elementStableKey(element: ElementInfo): string {
  return element.sourceId ?? element.id ?? element.selector ?? element.tagName;
}

/**
 * Module-level aspect-ratio lock state, keyed by elementStableKey. Module
 * scope (not React state) so the lock survives EditPanel remounts across
 * selection changes, matching this file's existing convention of using
 * plain data structures for cross-render inspector UI state (see
 * hiddenEffectStash for the analogous per-element pattern kept in React
 * state instead — the lock uses module scope specifically so a toggle
 * doesn't need to be re-applied if the panel remounts).
 */
const aspectRatioLocks = new Map<string, number>();

/**
 * Reads/writes the aspect-ratio lock for the given element. The map stores
 * the locked ratio (width / height) captured at lock time, not just a
 * boolean, so a W or H edit can derive the other axis without re-reading
 * stale computed styles. Returns a React-state-backed `locked`/`ratio` pair
 * plus a `toggle` that forces a re-render (the Map itself is not reactive).
 */
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

/**
 * Derives the paired dimension for an aspect-locked W/H commit. `ratio` is
 * width / height, captured once when the lock was toggled on. `axis`
 * identifies which dimension the user just edited (`px`); the function
 * returns the other axis's next value, rounded to one decimal to match the
 * precision every other size/position field commits at.
 */
export function deriveLockedAspectSize(
  axis: "width" | "height",
  px: number,
  ratio: number,
): number {
  return axis === "width"
    ? roundToOneDecimal(px / ratio)
    : roundToOneDecimal(px * ratio);
}
