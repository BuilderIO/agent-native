import {
  getBreakpointOverrideState,
  type BreakpointOverrideState,
} from "@shared/breakpoint-media";
import type { InteractionState } from "@shared/interaction-states";

import type { MotionKeyframeCssProperty } from "../inspector";

/**
 * PF12: gesture-lifecycle metadata threaded alongside a style commit.
 *
 * - "preview": a live, in-progress tick (a ScrubInput scrub sample or a
 *   DesignColorPicker drag tick) — cheap to show in the live iframe preview,
 *   but must NOT trigger the expensive source commit (projection parse + HTML
 *   patch + history entry) on every tick.
 * - "commit" (or omitted, for callers that don't pass meta at all): the
 *   gesture's authoritative final value — exactly one per gesture — which
 *   DOES trigger the full source commit. Omitting meta entirely preserves
 *   prior behavior (treated as "commit") for every non-scrub/color call site.
 *
 * - `interactionState`: set on EVERY style commit (regardless of `phase`)
 *   while the inspector's element interaction-state selector
 *   (`InteractionStatePanel`) has a non-default state active — see
 *   `shared/interaction-states.ts` for the persisted format. Omitted (or
 *   `undefined`) means "commit to the element's normal inline style /
 *   class", exactly like today. This is a PHASE-2 CONTRACT: EditPanel only
 *   attaches the field, it never calls the shared upsert helpers itself —
 *   DesignEditor's `onStyleChange`/`onStylesChange` handlers must branch on
 *   `meta.interactionState` and, when present, route the commit through
 *   `upsertStateStyle` / `upsertStateStyles` (targeting `activeContent` +
 *   the selected element's `sourceId` as the node id) instead of the normal
 *   inline-style patch path, then re-derive the forced-preview twins with
 *   `duplicateStatePreviewRules` before persisting — all as ONE history
 *   step, same as any other single style commit today.
 *
 * - `breakpointReset`: set ONLY on the synthetic commit fired by a
 *   `BreakpointOverrideIndicator`'s reset button (see `breakpointContext` on
 *   `EditPanelProps`). Means "clear this property's override at
 *   `maxWidthPx`, don't write a new value" — the accompanying `value`
 *   argument on `onStyleChange`/`onStylesChange` is the CURRENT (base or
 *   wider-scope) value the field falls back to displaying, not a value to
 *   persist. CONTRACT: DesignEditor's handlers must branch on
 *   `meta.breakpointReset` and, when present, call
 *   `removeBreakpointMediaDeclaration` (or clear the matching max-width
 *   utility class — whichever persistence layer
 *   `getBreakpointOverrideState` reported the override on) for `property` at
 *   `maxWidthPx`, instead of writing `value` through the normal inline-style
 *   /  managed-breakpoint-block commit path.
 */
export interface StyleChangeMeta {
  phase?: "preview" | "commit";
  interactionState?: InteractionState;
  breakpointReset?: { property: string; maxWidthPx: number };
}

export type StyleChangeHandler = (
  property: string,
  value: string,
  meta?: StyleChangeMeta,
) => void;

export type StylesChangeHandler = (
  styles: Record<string, string>,
  meta?: StyleChangeMeta,
) => void;

/**
 * Per-render bundle the style-section components below use to render the
 * motion keyframe diamond next to a field — precomputed once in `EditPanel`
 * from `motionKeyframeState`/`onToggleMotionKeyframe` so each section only
 * needs to know its own field's CSS property name. `undefined` (the whole
 * bundle, or `hasTimeline: false`) means "render no diamonds" — sections
 * check this before rendering `MotionKeyframeDiamond` at all.
 */
export interface MotionKeyframeFieldContext {
  hasTimeline: boolean;
  keyframedProperties: readonly string[];
  onToggle?: (cssProperty: MotionKeyframeCssProperty) => void;
}

/**
 * Per-render bundle the style-section components below use to render the
 * breakpoint override indicator next to a field — precomputed once in
 * `EditPanel` from `breakpointContext`. `undefined` means "render no
 * indicators" (feature off or editing the base frame).
 */
export interface BreakpointOverrideFieldContext {
  nodeId: string | undefined;
  breakpointWidths: readonly number[];
  baseWidthPx: number;
  activeWidthPx: number | null;
  html: string;
  onReset: (property: string, maxWidthPx: number) => void;
}

/**
 * Resolve a single property's override state against
 * `BreakpointOverrideFieldContext`, or `undefined` when the feature is off /
 * there's no stable node id for the current selection. Thin wrapper around
 * `getBreakpointOverrideState` so call sites don't repeat the
 * className/nodeId/html plumbing at every field.
 */
export function resolveBreakpointOverride(
  ctx: BreakpointOverrideFieldContext | undefined,
  className: string,
  property: string,
): BreakpointOverrideState | undefined {
  if (!ctx || !ctx.nodeId || ctx.activeWidthPx == null) return undefined;
  return getBreakpointOverrideState({
    className,
    html: ctx.html,
    nodeId: ctx.nodeId,
    property,
    breakpointWidths: ctx.breakpointWidths,
    baseWidthPx: ctx.baseWidthPx,
    activeWidthPx: ctx.activeWidthPx,
  });
}
