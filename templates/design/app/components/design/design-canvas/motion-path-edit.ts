import {
  MOTION_PATH_MAX_CONTROL_OFFSET_PX,
  type MotionPathSegmentV1,
} from "@shared/motion-timeline";

export interface MotionPathKeyframeEdit {
  keyframeT: number;
  segmentStartT?: number;
  value?: string;
  motionPath?: MotionPathSegmentV1 | null;
}

export interface MotionPathEditMessage {
  targetNodeId: string;
  edits: MotionPathKeyframeEdit[];
}

const KEYFRAME_TIME_EPSILON = 0.000001;
const MAX_POSITION_PX = 1_000_000;

interface MotionPathTrackLike {
  targetNodeId: string;
  property: string;
  keyframes: Array<{
    t: number;
    value: string;
    ease?: string;
    motionPath?: MotionPathSegmentV1;
  }>;
}

const isFinitePoint = (value: unknown): value is { x: number; y: number } =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => key === "x" || key === "y") &&
  "x" in value &&
  "y" in value &&
  typeof value.x === "number" &&
  Number.isFinite(value.x) &&
  Math.abs(value.x) <= MOTION_PATH_MAX_CONTROL_OFFSET_PX &&
  typeof value.y === "number" &&
  Number.isFinite(value.y) &&
  Math.abs(value.y) <= MOTION_PATH_MAX_CONTROL_OFFSET_PX;

const isMotionPathSegment = (value: unknown): value is MotionPathSegmentV1 => {
  if (typeof value !== "object" || value === null) return false;
  const segment = value as Record<string, unknown>;
  return (
    Object.keys(segment).every(
      (key) =>
        key === "version" ||
        key === "type" ||
        key === "control1" ||
        key === "control2",
    ) &&
    segment.version === 1 &&
    segment.type === "cubic" &&
    isFinitePoint(segment.control1) &&
    isFinitePoint(segment.control2)
  );
};

export function parseMotionPathEditMessage(
  value: unknown,
  selectedTargetNodeId: string | null,
): MotionPathEditMessage | null {
  if (
    selectedTargetNodeId === null ||
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return null;
  }
  const message = value as Record<string, unknown>;
  const allowedKeys = new Set(["type", "targetNodeId", "edits"]);
  if (Object.keys(message).some((key) => !allowedKeys.has(key))) return null;
  if (
    message.type !== "motion-path-edit" ||
    message.targetNodeId !== selectedTargetNodeId ||
    !Array.isArray(message.edits) ||
    message.edits.length === 0 ||
    message.edits.length > 4
  ) {
    return null;
  }

  const edits: MotionPathKeyframeEdit[] = [];
  for (const rawEdit of message.edits) {
    if (
      typeof rawEdit !== "object" ||
      rawEdit === null ||
      Array.isArray(rawEdit)
    ) {
      return null;
    }
    const edit = rawEdit as Record<string, unknown>;
    const editKeys = new Set([
      "keyframeT",
      "segmentStartT",
      "value",
      "motionPath",
    ]);
    if (
      Object.keys(edit).some((key) => !editKeys.has(key)) ||
      typeof edit.keyframeT !== "number" ||
      !Number.isFinite(edit.keyframeT) ||
      (edit.segmentStartT !== undefined &&
        (typeof edit.segmentStartT !== "number" ||
          !Number.isFinite(edit.segmentStartT))) ||
      (edit.value !== undefined && typeof edit.value !== "string") ||
      (edit.motionPath !== undefined &&
        edit.motionPath !== null &&
        !isMotionPathSegment(edit.motionPath)) ||
      (edit.value === undefined && edit.motionPath === undefined)
    ) {
      return null;
    }
    edits.push({
      keyframeT: edit.keyframeT,
      ...(typeof edit.segmentStartT === "number"
        ? { segmentStartT: edit.segmentStartT }
        : {}),
      ...(typeof edit.value === "string" ? { value: edit.value } : {}),
      ...(edit.motionPath === null || isMotionPathSegment(edit.motionPath)
        ? { motionPath: edit.motionPath }
        : {}),
    });
  }

  return {
    targetNodeId: selectedTargetNodeId,
    edits,
  };
}

const isPositionValue = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 96) return false;
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 2) return false;
  return parts.every((part) => {
    const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(px)?$/.exec(part);
    if (!match) return false;
    const amount = Number(match[1]);
    return (
      Number.isFinite(amount) &&
      Math.abs(amount) <= MAX_POSITION_PX &&
      (match[2] === "px" || amount === 0)
    );
  });
};

const frameIndexAt = (track: MotionPathTrackLike, t: number) =>
  track.keyframes.findIndex(
    (frame) => Math.abs(frame.t - t) <= KEYFRAME_TIME_EPSILON,
  );

export function applyMotionPathEdit<Track extends MotionPathTrackLike>(
  track: Track,
  edit: MotionPathEditMessage,
): Track | null {
  if (
    track.property !== "translate" ||
    edit.targetNodeId !== track.targetNodeId ||
    edit.edits.length === 0
  ) {
    return null;
  }
  let keyframes = track.keyframes;
  for (const change of edit.edits) {
    if (
      !Number.isFinite(change.keyframeT) ||
      change.keyframeT < 0 ||
      change.keyframeT > 1 ||
      (change.value === undefined && change.motionPath === undefined)
    ) {
      return null;
    }
    const keyframeIndex = frameIndexAt(
      { ...track, keyframes },
      change.keyframeT,
    );
    if (keyframeIndex < 0) return null;
    if (change.value !== undefined && !isPositionValue(change.value))
      return null;

    const segmentIndex =
      change.segmentStartT === undefined
        ? keyframeIndex
        : frameIndexAt({ ...track, keyframes }, change.segmentStartT);
    if (
      change.segmentStartT !== undefined &&
      (!Number.isFinite(change.segmentStartT) || segmentIndex < 0)
    ) {
      return null;
    }
    if (
      change.motionPath !== undefined &&
      change.motionPath !== null &&
      !isMotionPathSegment(change.motionPath)
    ) {
      return null;
    }
    if (
      change.motionPath !== undefined &&
      segmentIndex >= keyframes.length - 1
    ) {
      return null;
    }

    keyframes = keyframes.map((frame, index) =>
      index === keyframeIndex && change.value !== undefined
        ? { ...frame, value: change.value }
        : frame,
    );
    if (change.motionPath !== undefined) {
      const segmentFrame = keyframes[segmentIndex];
      if (!segmentFrame) return null;
      if (change.motionPath === null) {
        const { motionPath: _motionPath, ...withoutPath } = segmentFrame;
        keyframes[segmentIndex] = withoutPath;
      } else {
        keyframes[segmentIndex] = {
          ...segmentFrame,
          motionPath: change.motionPath,
        };
      }
    }
  }

  return { ...track, keyframes };
}
