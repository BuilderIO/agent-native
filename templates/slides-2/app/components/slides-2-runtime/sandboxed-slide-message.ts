import type { ElementSnapshot } from "../slides-2-editor/types";
import {
  isSlideFrameAncestorData,
  isSlideFrameMessage,
  isSlideFramePointerType,
  type SlideFrameContext,
  type SlideFrameMessage,
  type SlideFramePointerType,
} from "./protocol";

const MAX_RENDERED_SLIDE_INSTANCES_PER_SOURCE_LOCATOR = 8_000;

export type FramePointerTarget = {
  line: number;
  column: number;
  nodeId: string;
  snapshot: ElementSnapshot;
};

export type FramePointer = {
  phase: "down" | "move" | "up" | "cancel" | "double-click";
  x: number;
  y: number;
  button: number;
  pointerId: number;
  pointerType: SlideFramePointerType;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  target: FramePointerTarget | null;
  hitTarget?: FramePointerTarget | null;
};

type FrameMessageEvent = Pick<
  MessageEvent<unknown>,
  "data" | "origin" | "source"
>;

export type ParsedSlideFrameMessage = {
  message: SlideFrameMessage;
  nodes?: ElementSnapshot[];
  pointer?: FramePointer | null;
  pointerActivity?: SlideFramePointerType | null;
};

export function parseSandboxedSlideFrameMessage(
  event: FrameMessageEvent,
  frameWindow: MessageEventSource,
  context: SlideFrameContext,
): ParsedSlideFrameMessage | null {
  if (
    event.source !== frameWindow ||
    event.origin !== "null" ||
    !isSlideFrameMessage(event.data, context)
  ) {
    return null;
  }

  const message = event.data;
  if (
    (message.type === "snapshot" || message.type === "inspect") &&
    Array.isArray(message.nodes)
  ) {
    return {
      message,
      nodes: message.nodes.flatMap((node) => {
        const parsed = parseElementSnapshot(node);
        return parsed ? [parsed] : [];
      }),
    };
  }

  if (message.type === "pointer") {
    const pointer = parsePointer(message.pointer);
    return {
      message,
      pointer,
      pointerActivity: pointer?.phase === "down" ? pointer.pointerType : null,
    };
  }

  return { message };
}

export function forwardSandboxedSlidePointer(
  parsedMessage: ParsedSlideFrameMessage,
  onPointer: (pointer: FramePointer) => void,
  onPointerActivity?: (pointerType: SlideFramePointerType) => void,
): void {
  if (parsedMessage.message.type !== "pointer" || !parsedMessage.pointer) {
    return;
  }
  if (parsedMessage.pointerActivity) {
    onPointerActivity?.(parsedMessage.pointerActivity);
  }
  onPointer(parsedMessage.pointer);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseElementSnapshot(value: unknown): ElementSnapshot | null {
  if (!isRecord(value) || !isRecord(value.bounds) || !isRecord(value.styles))
    return null;
  const { line, column, nodeId, tagName, text, bounds, styles } = value;
  if (
    !Number.isInteger(line) ||
    Number(line) < 1 ||
    !Number.isInteger(column) ||
    Number(column) < 0 ||
    typeof nodeId !== "string" ||
    nodeId.length > 100 ||
    typeof tagName !== "string" ||
    tagName.length > 32 ||
    typeof text !== "string" ||
    text.length > 12000
  ) {
    return null;
  }
  const instanceIndex = value.instanceIndex;
  const instanceCount = value.instanceCount;
  const hasAncestorData =
    "ancestorLocators" in value || "ancestorLocatorsComplete" in value;
  if (
    hasAncestorData &&
    !isSlideFrameAncestorData(
      value.ancestorLocators,
      value.ancestorLocatorsComplete,
    )
  ) {
    return null;
  }
  const instanceNodeId = /^(\d+):(\d+):(\d+)$/.exec(nodeId);
  const hasInstanceMetadata =
    Number.isSafeInteger(instanceIndex) &&
    Number(instanceIndex) >= 0 &&
    Number.isSafeInteger(instanceCount) &&
    Number(instanceCount) > 0 &&
    Number(instanceCount) <= MAX_RENDERED_SLIDE_INSTANCES_PER_SOURCE_LOCATOR &&
    Number(instanceIndex) < Number(instanceCount) &&
    Number(instanceNodeId?.[1]) === Number(line) &&
    Number(instanceNodeId?.[2]) === Number(column) &&
    Number(instanceNodeId?.[3]) === Number(instanceIndex);
  const rectValues = [bounds.x, bounds.y, bounds.width, bounds.height];
  if (
    rectValues.some(
      (entry) => typeof entry !== "number" || !Number.isFinite(entry),
    )
  ) {
    return null;
  }
  const rect = {
    x: bounds.x as number,
    y: bounds.y as number,
    width: bounds.width as number,
    height: bounds.height as number,
  };
  const safeStyles: Record<string, string> = {};
  for (const [key, entry] of Object.entries(styles)) {
    if (typeof entry !== "string" || entry.length > 400) continue;
    safeStyles[key] = entry;
  }
  let transform: ElementSnapshot["transform"];
  if (isRecord(value.transform)) {
    const { basis, translate, width, height, rotation } = value.transform;
    if (
      isRecord(basis) &&
      isRecord(translate) &&
      [
        basis.a,
        basis.b,
        basis.c,
        basis.d,
        translate.x,
        translate.y,
        width,
        height,
        rotation,
      ].every((entry) => typeof entry === "number" && Number.isFinite(entry)) &&
      Number(width) >= 0 &&
      Number(height) >= 0
    ) {
      transform = {
        basis: {
          a: Number(basis.a),
          b: Number(basis.b),
          c: Number(basis.c),
          d: Number(basis.d),
        },
        translate: { x: Number(translate.x), y: Number(translate.y) },
        width: Number(width),
        height: Number(height),
        rotation: Number(rotation),
      };
    }
  }
  return {
    line: Number(line),
    column: Number(column),
    ...(hasInstanceMetadata
      ? {
          instanceIndex: Number(instanceIndex),
          instanceCount: Number(instanceCount),
        }
      : {}),
    nodeId,
    tagName,
    text,
    bounds: rect,
    styles: safeStyles,
    ...(hasAncestorData
      ? {
          ancestorLocators: value.ancestorLocators as string[],
          ancestorLocatorsComplete: value.ancestorLocatorsComplete as boolean,
        }
      : {}),
    ...(transform ? { transform } : {}),
  };
}

function parsePointer(value: unknown): FramePointer | null {
  if (!isRecord(value)) return null;
  const {
    phase,
    x,
    y,
    button,
    pointerId,
    pointerType,
    shiftKey,
    altKey,
    ctrlKey,
    metaKey,
  } = value;
  if (
    (phase !== "down" &&
      phase !== "move" &&
      phase !== "up" &&
      phase !== "cancel" &&
      phase !== "double-click") ||
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    typeof y !== "number" ||
    !Number.isFinite(y) ||
    typeof button !== "number" ||
    !Number.isInteger(pointerId) ||
    !isSlideFramePointerType(pointerType) ||
    typeof shiftKey !== "boolean" ||
    typeof altKey !== "boolean" ||
    typeof ctrlKey !== "boolean" ||
    typeof metaKey !== "boolean"
  ) {
    return null;
  }
  const safeTarget = parseFramePointerTarget(value.target);
  const hitTarget = parseFramePointerTarget(value.hitTarget);

  return {
    phase,
    x,
    y,
    button,
    pointerId: Number(pointerId),
    pointerType,
    shiftKey,
    altKey,
    ctrlKey,
    metaKey,
    target: safeTarget,
    hitTarget,
  };
}

function parseFramePointerTarget(value: unknown): FramePointerTarget | null {
  if (!isRecord(value)) return null;
  if (
    Number.isInteger(value.line) &&
    Number(value.line) > 0 &&
    Number.isInteger(value.column) &&
    Number(value.column) >= 0 &&
    typeof value.nodeId === "string" &&
    value.nodeId.length <= 100
  ) {
    const snapshot = parseElementSnapshot(value.snapshot);
    if (
      snapshot &&
      snapshot.line === Number(value.line) &&
      snapshot.column === Number(value.column) &&
      snapshot.nodeId === value.nodeId
    ) {
      return {
        line: Number(value.line),
        column: Number(value.column),
        nodeId: value.nodeId,
        snapshot,
      };
    }
  }
  return null;
}
