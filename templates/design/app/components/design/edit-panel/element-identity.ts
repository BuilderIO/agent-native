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

/**
 * Stable per-element identity for UI-only inspector state that must survive
 * resizing (unlike elementIdentityKey, which folds in the bounding rect and
 * therefore changes on every resize — exactly what an aspect-ratio lock needs
 * to persist across). Falls back through the same id chain.
 *
 * Uses `||`, not `??`, between the fallback candidates: the bridge
 * (editor-chrome.bridge.ts getElementInfo) reports `sourceId` as the empty
 * string `""` — not `undefined` — for any element that isn't source-backed
 * (e.g. a runtime-only DOM node in a connected localhost/fusion screen). `??`
 * only skips a nullish left-hand side, so an empty-string `sourceId` short-
 * circuited the whole chain and every non-source-backed element collapsed to
 * the SAME key ("" here, and just the rounded bounding rect in
 * elementIdentityKey). For this hook that meant locking the aspect ratio on
 * one such element silently applied its captured ratio to every other
 * non-source-backed element too. `||` falls through empty strings the same
 * way the bridge itself already does (`getSourceId(el) || getSelector(el)`),
 * reaching the real per-element `selector` instead. Exported for tests.
 */
export function elementStableKey(element: ElementInfo): string {
  return element.sourceId || element.id || element.selector || element.tagName;
}

/**
 * Stable identity for inspector interaction-state UI (Default / Hover /
 * Focus / Focus visible / Pressed / Disabled).
 *
 * Unlike `elementIdentityKey`, this intentionally excludes the bounding box:
 * editing width/height/position while a non-default state is selected must
 * not look like a new selection and snap the picker back to Default. The file
 * id is included because generated node ids are only document-local; moving
 * between two screens that both contain `button_1` is a real selection change
 * and must clear the previous screen's forced preview.
 */
export function interactionStateSelectionKey(
  element: ElementInfo,
  fileId: string | null | undefined,
  selectedCount: number,
): string {
  return `${fileId || "no-file"}:${selectedCount}:${elementStableKey(element)}`;
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
