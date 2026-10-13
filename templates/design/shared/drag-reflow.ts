export interface DragTargetKey {
  containerKey: string;
  index: number;
}

export interface CandidatePoint {
  x: number;
  y: number;
}

export interface DragTargetCandidate {
  key: DragTargetKey | null;
  pointer: CandidatePoint;
  containerPenetrationPx: number;
  isLeave: boolean;
}

export interface HysteresisState {
  key: DragTargetKey;
  committedAt: number;
  committedPointer: CandidatePoint;
  pendingKey: DragTargetKey | null;
  pendingAt: number;
}

export interface HysteresisOptions {
  movePx?: number;
  dwellMs?: number;
  containerPenetrationPx?: number;
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

export interface SizeGuardBox {
  width: number;
  height: number;
}

export interface SizeGuardOptions {
  bypass?: boolean;
  tolerancePx?: number;
  hugAxis?: "none" | "main" | "cross" | "both" | "width" | "height";
}

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

export interface PackedContainerInfo {
  display: string;
  flexDirection: string;
  flexWrap: string;
  justifyContent: string;
  gap: number;
  hasFlexGrowChild: boolean;
}

const START_JUSTIFY = new Set(["flex-start", "start", "normal", "left", ""]);

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

export function mainAxisForDirection(flexDirection: string): "x" | "y" {
  return flexDirection === "column" || flexDirection === "column-reverse"
    ? "y"
    : "x";
}

export interface ReorderOffsetsInput {
  count: number;
  originIndex: number;
  targetSlot: number;
  slotMain: number;
}

export function computeReorderOffsets(input: ReorderOffsetsInput): number[] {
  const { count, originIndex, targetSlot, slotMain } = input;
  const offsets = new Array(count).fill(0);
  if (targetSlot > originIndex + 1) {
    for (let i = originIndex + 1; i <= targetSlot - 1; i += 1) {
      offsets[i] = -slotMain;
    }
  } else if (targetSlot < originIndex) {
    for (let i = targetSlot; i <= originIndex - 1; i += 1) {
      offsets[i] = slotMain;
    }
  }
  return offsets;
}

export interface VacateOffsetsInput {
  count: number;
  originIndex: number;
  slotMain: number;
}

export function computeVacateOffsets(input: VacateOffsetsInput): number[] {
  const { count, originIndex, slotMain } = input;
  const offsets = new Array(count).fill(0);
  for (let i = originIndex + 1; i <= count - 1; i += 1) {
    offsets[i] = -slotMain;
  }
  return offsets;
}

export interface InsertOffsetsInput {
  count: number;
  targetSlot: number;
  slotMain: number;
}

export function computeInsertOffsets(input: InsertOffsetsInput): number[] {
  const { count, targetSlot, slotMain } = input;
  const offsets = new Array(count).fill(0);
  for (let i = targetSlot; i <= count - 1; i += 1) {
    offsets[i] = slotMain;
  }
  return offsets;
}
