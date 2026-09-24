/**
 * Pure decision logic for Figma-parity in-screen drag & drop.
 *
 * This module is the typed, unit-tested source of truth for the drag
 * behaviors added in the "live reflow" work (Phase 0 + Phase 1 of the
 * auto-layout DnD plan). It is deliberately free of DOM access so it can be
 * exercised directly by vitest.
 *
 * The editor bridge (`app/components/design/bridge/editor-chrome.bridge.ts`)
 * cannot `import` anything — it is compiled to a self-contained IIFE by
 * `bridge/codegen.ts`. So, exactly like `shared/canvas-math.ts` →
 * `computeMoveSnapOffset`, the bridge carries a hand-ported copy of these
 * functions. Keep the two in sync; this file is the reference implementation
 * and the place where behavior is proven.
 *
 * Four independent concerns live here:
 *   1. Hysteresis — stabilize the resolved drop target so the insertion
 *      preview never strobes on a boundary (Phase 0.1).
 *   2. Size guard — refuse to auto-nest a large element into a smaller
 *      container, Figma-style (Phase 0.2).
 *   3. Packed-container detection — decide whether a flex container is simple
 *      enough that live sibling reflow can be modeled by a constant slot
 *      shift; everything else falls back to an indicator only (Phase 1).
 *   4. Reflow offsets — the per-sibling translate deltas that visually open /
 *      close a slot while dragging, for the packed case (Phase 1).
 */

// ---------------------------------------------------------------------------
// 1. Hysteresis
// ---------------------------------------------------------------------------

/**
 * Identity of a resolved drop target. `containerKey` is any stable string id
 * for the target container (the bridge uses a per-drag element→key map);
 * `index` is the insertion index within that container.
 */
export interface DragTargetKey {
  containerKey: string;
  index: number;
}

/**
 * A freshly resolved (raw) drop-target candidate for the current pointer
 * position, plus the geometry the hysteresis gate needs to decide whether to
 * accept it. All coordinates are in one consistent space (the bridge uses
 * iframe-local client coordinates — see canvas-math note about the host
 * scaling the whole iframe uniformly).
 */
export interface CandidatePoint {
  x: number;
  y: number;
}

export interface DragTargetCandidate {
  /** The resolved target, or null when the pointer is over no valid target. */
  key: DragTargetKey | null;
  /** Pointer position this tick, in a consistent space, for the movement
   *  deadband (distance from where the current target was committed). */
  pointer: CandidatePoint;
  /** How far the pointer has penetrated a *different* container from its
   *  entering edge, px. Pass Infinity for a same-container change. */
  containerPenetrationPx: number;
  /** True when the candidate container is an ancestor of the committed one
   *  (leaving toward a parent) — reverses instantly. */
  isLeave: boolean;
}

export interface HysteresisState {
  key: DragTargetKey;
  committedAt: number;
  committedPointer: CandidatePoint;
  /** The differing candidate currently being timed out, and since when. */
  pendingKey: DragTargetKey | null;
  pendingAt: number;
}

export interface HysteresisOptions {
  /** Pointer must move at least this far from the last commit before a
   *  same-container slot change is accepted. Default 8. */
  movePx?: number;
  /** …or the new candidate must persist this long (ms). Default 60. */
  dwellMs?: number;
  /** Pointer must penetrate a different container this far, px. Default 10. */
  containerPenetrationPx?: number;
  /** …or the new container must persist this long (ms). Default 80. */
  containerDwellMs?: number;
}

export interface HysteresisResult {
  key: DragTargetKey | null;
  changed: boolean;
  state: HysteresisState | null;
}

const DEFAULT_HYSTERESIS: Required<HysteresisOptions> = {
  movePx: 8,
  dwellMs: 60,
  containerPenetrationPx: 10,
  containerDwellMs: 80,
};

function keysEqual(a: DragTargetKey | null, b: DragTargetKey | null): boolean {
  if (a === null || b === null) return a === b;
  return a.containerKey === b.containerKey && a.index === b.index;
}

function commitTarget(
  key: DragTargetKey,
  pointer: CandidatePoint,
  now: number,
): HysteresisResult {
  return {
    key,
    changed: true,
    state: {
      key,
      committedAt: now,
      committedPointer: pointer,
      pendingKey: null,
      pendingAt: 0,
    },
  };
}

/**
 * Stabilize a raw drop-target candidate against the committed one so the
 * preview only transitions when the pointer deliberately moves to a new
 * slot/container. A change is accepted when the pointer has moved `movePx`
 * from the last commit (deliberate move) OR the *new* candidate has persisted
 * `dwellMs` — dwell is timed from when the candidate first appeared, not from
 * the committed target's age. Cross-container leaves reverse instantly; other
 * container entries need penetration or dwell. Pure: `now` is passed in.
 */
export function resolveTargetHysteresis(
  prev: HysteresisState | null,
  candidate: DragTargetCandidate,
  now: number,
  options: HysteresisOptions = {},
): HysteresisResult {
  const opts = { ...DEFAULT_HYSTERESIS, ...options };

  if (candidate.key === null) {
    return { key: null, changed: prev !== null, state: null };
  }
  if (prev === null) {
    return commitTarget(candidate.key, candidate.pointer, now);
  }
  if (keysEqual(candidate.key, prev.key)) {
    return {
      key: prev.key,
      changed: false,
      state: { ...prev, pendingKey: null, pendingAt: 0 },
    };
  }

  const pendingContinues = keysEqual(candidate.key, prev.pendingKey);
  const pendingKey = candidate.key;
  const pendingAt = pendingContinues ? prev.pendingAt : now;
  const dwelledFor = now - pendingAt;
  const sameContainer = candidate.key.containerKey === prev.key.containerKey;

  let accept: boolean;
  if (sameContainer) {
    const movedPx = Math.hypot(
      candidate.pointer.x - prev.committedPointer.x,
      candidate.pointer.y - prev.committedPointer.y,
    );
    accept = movedPx >= opts.movePx || dwelledFor >= opts.dwellMs;
  } else if (candidate.isLeave) {
    accept = true;
  } else {
    accept =
      candidate.containerPenetrationPx >= opts.containerPenetrationPx ||
      dwelledFor >= opts.containerDwellMs;
  }

  if (accept) {
    return commitTarget(candidate.key, candidate.pointer, now);
  }
  return {
    key: prev.key,
    changed: false,
    state: { ...prev, pendingKey, pendingAt },
  };
}

// ---------------------------------------------------------------------------
// 2. Size guard
// ---------------------------------------------------------------------------

export interface SizeGuardBox {
  width: number;
  height: number;
}

export interface SizeGuardOptions {
  /** Cmd/⌘ held — user override, always allow. Default false. */
  bypass?: boolean;
  /** Slack in px before a container counts as "too small". Default 0. */
  tolerancePx?: number;
  /**
   * Axis on which the container hugs its content (and would therefore grow to
   * fit a larger child, so it should NOT be rejected on that axis). Matches
   * Figma "Hug contents". Default "none".
   */
  hugAxis?: "none" | "main" | "cross" | "both" | "width" | "height";
}

/**
 * Figma's "don't drop a large image into a button" guard: reject a container
 * whose content box is smaller than the dragged element on an axis it cannot
 * grow on. Bypassed by ⌘ (the same modifier that disables snapping).
 */
export function isContainerTooSmallForDrag(
  containerContentBox: SizeGuardBox,
  draggedRect: SizeGuardBox,
  options: SizeGuardOptions = {},
): boolean {
  if (options.bypass) return false;
  const tol = options.tolerancePx ?? 0;
  const hug = options.hugAxis ?? "none";
  const hugsWidth = hug === "both" || hug === "width" || hug === "main";
  const hugsHeight = hug === "both" || hug === "height" || hug === "cross";

  const tooNarrow =
    !hugsWidth && containerContentBox.width + tol < draggedRect.width;
  const tooShort =
    !hugsHeight && containerContentBox.height + tol < draggedRect.height;
  return tooNarrow || tooShort;
}

// ---------------------------------------------------------------------------
// 3. Packed-container detection (Phase 1, option-1 restriction)
// ---------------------------------------------------------------------------

export interface PackedContainerInfo {
  /** Computed `display`. */
  display: string;
  /** Computed `flex-direction`. */
  flexDirection: string;
  /** Computed `flex-wrap`. */
  flexWrap: string;
  /** Computed `justify-content`. */
  justifyContent: string;
  /** Resolved main-axis gap in px (row-gap or column-gap as appropriate). */
  gap: number;
  /** True if any direct child has `flex-grow` > 0 (it absorbs space instead
   *  of translating, so a constant slot shift would misrepresent the drop). */
  hasFlexGrowChild: boolean;
}

const START_JUSTIFY = new Set(["flex-start", "start", "normal", "left", ""]);

/**
 * Whether a container is simple enough that a same-magnitude per-sibling
 * translate exactly reproduces the post-drop layout (see
 * `computeReorderOffsets`). Only START-aligned, non-wrapping, fixed-gap,
 * non-reverse flex rows/columns with no growing child qualify.
 *
 * Everything else (space-between/around/evenly, center/end, wrap, grid,
 * reverse, or a flex-grow child) must fall back to an indicator-only preview,
 * because the real reflow is NOT a uniform shift and animating a constant
 * translate would show a preview that does not match where the item lands.
 */
export function isSimplePackedContainer(info: PackedContainerInfo): boolean {
  const isFlex = info.display === "flex" || info.display === "inline-flex";
  if (!isFlex) return false;
  if (info.flexDirection !== "row" && info.flexDirection !== "column") {
    return false;
  }
  if (info.flexWrap !== "nowrap") return false;
  if (!START_JUSTIFY.has(info.justifyContent)) return false;
  if (!Number.isFinite(info.gap) || info.gap < 0) return false;
  if (info.hasFlexGrowChild) return false;
  return true;
}

/** The main flow axis (x/y) for a packed container's flex-direction. */
export function mainAxisForDirection(flexDirection: string): "x" | "y" {
  return flexDirection === "column" || flexDirection === "column-reverse"
    ? "y"
    : "x";
}

// ---------------------------------------------------------------------------
// 4. Reflow offsets (packed case)
// ---------------------------------------------------------------------------

export interface ReorderOffsetsInput {
  /** Number of direct children currently in the container (incl. dragged). */
  count: number;
  /** The dragged element's current index. */
  originIndex: number;
  /**
   * Insertion slot in current indexing: the item lands *before* the child at
   * `targetSlot` (0..count, where `count` means "at the end").
   */
  targetSlot: number;
  /** Dragged element's main-axis size + the container gap, in px. */
  slotMain: number;
}

/**
 * Per-sibling translate offsets (px, signed along the main axis) that preview
 * a same-container reorder by opening the destination slot and closing the
 * origin slot. Negative = toward the container start (up/left); positive =
 * toward the end (down/right). The dragged element's own index is always 0
 * here (it follows the cursor separately).
 *
 * For a packed container, moving the dragged item (size s, plus one gap g)
 * from `originIndex` to `targetSlot` shifts exactly the siblings between the
 * two positions by ±(s + g) — the shift magnitude is independent of each
 * sibling's own size, which is why the constant model is exact for this case.
 */
export function computeReorderOffsets(input: ReorderOffsetsInput): number[] {
  const { count, originIndex, targetSlot, slotMain } = input;
  const offsets = new Array(count).fill(0);
  if (targetSlot > originIndex + 1) {
    // Moving later: siblings between move toward the start to fill the origin.
    for (let i = originIndex + 1; i <= targetSlot - 1; i += 1) {
      offsets[i] = -slotMain;
    }
  } else if (targetSlot < originIndex) {
    // Moving earlier: siblings from targetSlot..originIndex-1 move toward end.
    for (let i = targetSlot; i <= originIndex - 1; i += 1) {
      offsets[i] = slotMain;
    }
  }
  // targetSlot === originIndex or originIndex + 1 → no net movement.
  return offsets;
}

export interface VacateOffsetsInput {
  count: number;
  originIndex: number;
  slotMain: number;
}

/**
 * Offsets for the ORIGIN container when the dragged item leaves it entirely
 * (drag-out or cross-container move): every following sibling closes the gap
 * by shifting toward the start. This is what erases the "hole" the old
 * relative-promotion approach left behind.
 */
export function computeVacateOffsets(input: VacateOffsetsInput): number[] {
  const { count, originIndex, slotMain } = input;
  const offsets = new Array(count).fill(0);
  for (let i = originIndex + 1; i <= count - 1; i += 1) {
    offsets[i] = -slotMain;
  }
  return offsets;
}

export interface InsertOffsetsInput {
  /** Number of children currently in the TARGET container (excl. incoming). */
  count: number;
  /** Insertion slot: incoming item lands before child at `targetSlot`. */
  targetSlot: number;
  /** Incoming element's main-axis size + the target container's gap, in px. */
  slotMain: number;
}

/**
 * Offsets for a TARGET container the dragged item is entering: children at and
 * after the insertion slot shift toward the end to open a slot sized to the
 * incoming element.
 */
export function computeInsertOffsets(input: InsertOffsetsInput): number[] {
  const { count, targetSlot, slotMain } = input;
  const offsets = new Array(count).fill(0);
  for (let i = targetSlot; i <= count - 1; i += 1) {
    offsets[i] = slotMain;
  }
  return offsets;
}
