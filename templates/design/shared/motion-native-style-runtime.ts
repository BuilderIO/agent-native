import {
  isMotionEaseVariableReference,
  isValidMotionEase,
  springToken,
} from "./motion-easing";
import type {
  MotionNativeStyleInstance,
  MotionNativeStyleKey,
  MotionNativeStyleJsonValue,
} from "./motion-native-style";
import type {
  MotionTextAnimation,
  MotionTextDocument,
} from "./motion-text-code";
import {
  isMotionPathSegmentV1,
  type MotionTrack,
  parseMotionPosition,
} from "./motion-timeline";

const DEFAULT_EASING = { type: "EASE_OUT" } as const;

const DEFAULT_PROPS: Record<MotionNativeStyleKey, Record<string, unknown>> = {
  TextStagger: {
    positionEnabled: true,
    positionVisible: true,
    rotationEnabled: false,
    rotationVisible: true,
    scaleEnabled: false,
    scaleVisible: true,
    opacityEnabled: false,
    opacityVisible: true,
    blurEnabled: false,
    blurVisible: true,
    animationDirection: "in",
    direction: "top",
    distance: 40,
    rotationDirection: "clockwise",
    rotationAmount: 180,
    scaleAmount: 120,
    opacityAmount: 0,
    blurAmount: 20,
    delay: 0,
    easing: DEFAULT_EASING,
    textDelayGrouping: "CHARACTER",
    presetStaggerOverlap: 50,
    textDelayOrder: "LEFT_RIGHT",
    clipContent: false,
    elementTransformOriginMode: "MATCH",
    elementTransformOriginX: 50,
    elementTransformOriginY: 50,
  },
  Position: {
    type: "slide_in",
    direction: "left",
    distance: 200,
    axis: "xy",
    startX: 200,
    startY: 200,
    endX: 0,
    endY: 0,
    delay: 0,
    easing: DEFAULT_EASING,
  },
  Scale: {
    type: "scaleIn",
    axis: "whCombined",
    amount: 120,
    wStartWithDivider: 120,
    wEndWithoutDivider: 100,
    hStartWithoutDivider: 120,
    wEndWithDivider: 100,
    hStartWithDivider: 120,
    hEndWithoutDivider: 100,
    delay: 0,
    easing: DEFAULT_EASING,
  },
  Rotation: {
    type: "rotateIn",
    direction: "clockwise",
    amount: 180,
    start: 180,
    end: 0,
    delay: 0,
    easing: DEFAULT_EASING,
  },
  Size: {
    type: "resize_in",
    amount: 50,
    axis: "xy",
    startWidth: 50,
    startHeight: 50,
    endWidth: 100,
    endHeight: 100,
    delay: 0,
    easing: DEFAULT_EASING,
  },
  Opacity: {
    type: "fadeIn",
    amount: 0,
    startFrame: 0,
    endFrame: 100,
    delay: 0,
    easing: DEFAULT_EASING,
  },
  Path: {
    type: "draw",
    direction: "forward",
    axis: "pathTrimStart",
    segment: 10,
    pathStartStartFrame: 100,
    pathStartEndWithoutDivider: 0,
    pathEndStartWithoutDivider: 20,
    pathStartEndWithDivider: 80,
    pathEndStartWithDivider: 0,
    pathEndEndFrame: 100,
    delay: 0,
    easing: DEFAULT_EASING,
  },
};

const STYLE_SPECIFIC_PROP_KEYS = new Set(
  Object.values(DEFAULT_PROPS).flatMap((props) => Object.keys(props)),
);
const SHARED_STYLE_PROP_KEYS = ["delay", "easing"] as const;

const TEXT_STAGGER_SUPPORTED_PROPS = new Set([
  "positionEnabled",
  "positionVisible",
  "rotationEnabled",
  "rotationVisible",
  "scaleEnabled",
  "scaleVisible",
  "opacityEnabled",
  "opacityVisible",
  "blurEnabled",
  "blurVisible",
  "animationDirection",
  "direction",
  "distance",
  "rotationDirection",
  "rotationAmount",
  "scaleAmount",
  "opacityAmount",
  "blurAmount",
  "delay",
  "easing",
  "textDelayGrouping",
  "presetStaggerOverlap",
  "textDelayOrder",
  "clipContent",
  "elementTransformOriginMode",
  "elementTransformOriginX",
  "elementTransformOriginY",
]);

export function createMotionNativeStyleInstance(args: {
  styleKey: MotionNativeStyleKey;
  targetNodeId: string;
}): MotionNativeStyleInstance {
  return {
    type: "FIGMA",
    styleKey: args.styleKey,
    nameKey: `motion.preset_name.${args.styleKey.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).replace(/^_/, "")}`,
    duration: args.styleKey === "TextStagger" ? 0.5 : 1,
    timelineOffset: 0,
    targetNodeId: args.targetNodeId,
    enabled: true,
    props: JSON.parse(JSON.stringify(DEFAULT_PROPS[args.styleKey])) as {
      [key: string]: MotionNativeStyleJsonValue;
    },
  };
}

export function switchMotionNativeStyleKey(
  instance: MotionNativeStyleInstance,
  styleKey: MotionNativeStyleKey,
): MotionNativeStyleInstance {
  if (instance.styleKey === styleKey) return instance;

  const defaults = createMotionNativeStyleInstance({
    styleKey,
    targetNodeId: instance.targetNodeId,
  });
  const customProps = Object.fromEntries(
    Object.entries(instance.props).filter(
      ([key]) => !STYLE_SPECIFIC_PROP_KEYS.has(key),
    ),
  ) as { [key: string]: MotionNativeStyleJsonValue };
  const sharedProps = Object.fromEntries(
    SHARED_STYLE_PROP_KEYS.flatMap((key) =>
      Object.prototype.hasOwnProperty.call(instance.props, key)
        ? [[key, instance.props[key]]]
        : [],
    ),
  ) as { [key: string]: MotionNativeStyleJsonValue };

  return {
    ...defaults,
    ...(instance.sourceStyleId
      ? { sourceStyleId: instance.sourceStyleId }
      : {}),
    ...(instance.sourceInstanceId
      ? { sourceInstanceId: instance.sourceInstanceId }
      : {}),
    duration: instance.duration,
    timelineOffset: instance.timelineOffset,
    enabled: instance.enabled ?? true,
    props: { ...defaults.props, ...customProps, ...sharedProps },
  };
}

export function motionNativeStyleEndTimeMs(
  style: MotionNativeStyleInstance,
): number {
  const delaySeconds = numeric(style.props.delay, 0);
  if (
    style.duration <= 0 ||
    style.timelineOffset < 0 ||
    delaySeconds < 0 ||
    style.timelineOffset + delaySeconds + style.duration > 120
  ) {
    invalid(
      "Native Figma duration must be positive and offsets and delays non-negative.",
    );
  }
  return (style.timelineOffset + delaySeconds + style.duration) * 1000;
}

export function motionNativeStylesToTracks(
  styles: readonly MotionNativeStyleInstance[],
): MotionTrack[] {
  return styles.flatMap((style) => {
    if (style.enabled === false) return [];
    switch (style.styleKey) {
      case "Position":
        return positionTracks(style);
      case "Scale":
        return scaleTracks(style);
      case "Rotation":
        return rotationTracks(style);
      case "Opacity":
        return opacityTracks(style);
      case "Size":
        return sizeTracks(style);
      case "TextStagger":
        return [];
      case "Path":
        return pathTrimTracks(style);
    }
  });
}

/** Derives local text-unit runtime tracks without changing Figma source props. */
export function motionNativeStylesToTextAnimations(
  styles: readonly MotionNativeStyleInstance[],
): MotionTextAnimation[] {
  return styles.flatMap((style) => {
    if (style.enabled === false || style.styleKey !== "TextStagger") return [];
    return textStaggerAnimations(style);
  });
}

/** Returns authored text tracks after removing an exact native-style projection. */
export function motionTextDocumentWithoutNativeStyles(
  document: MotionTextDocument | null,
  styles: readonly MotionNativeStyleInstance[],
): MotionTextDocument | null {
  if (!document) return null;
  const projected = new Map<string, number>();
  for (const animation of motionNativeStylesToTextAnimations(styles)) {
    const key = textAnimationKey(animation);
    projected.set(key, (projected.get(key) ?? 0) + 1);
  }
  const animations = document.animations.filter((animation) => {
    const key = textAnimationKey(animation);
    const count = projected.get(key) ?? 0;
    if (count === 0) return true;
    projected.set(key, count - 1);
    return false;
  });
  return animations.length > 0 ? { version: 1, animations } : null;
}

/** Combines authored and derived tracks only for runtime compilation. */
export function motionTextDocumentWithNativeStyles(
  document: MotionTextDocument | null,
  styles: readonly MotionNativeStyleInstance[],
): MotionTextDocument | null {
  const nativeAnimations = motionNativeStylesToTextAnimations(styles);
  if (nativeAnimations.length === 0) return document;

  const authoredAnimations = document?.animations ?? [];
  const keys = new Set(authoredAnimations.map(textAnimationKey));
  for (const animation of nativeAnimations) {
    const key = textAnimationKey(animation);
    if (keys.has(key)) {
      throw new MotionNativeStyleRuntimeError(
        "unsupported-style",
        `Native Figma TextStagger for target "${animation.targetNodeId}" duplicates an authored Motion Text property. Remove one of the duplicate tracks before previewing.`,
      );
    }
    keys.add(key);
  }

  return {
    version: 1,
    animations: [...authoredAnimations, ...nativeAnimations],
  };
}

export class MotionNativeStyleRuntimeError extends Error {
  constructor(
    readonly code: "invalid-style-props" | "unsupported-style",
    message: string,
  ) {
    super(message);
    this.name = "MotionNativeStyleRuntimeError";
  }
}

export function motionNativeStyleWithPositionTrack(
  style: MotionNativeStyleInstance,
  updatedTrack: MotionTrack,
): MotionNativeStyleInstance {
  if (
    style.styleKey !== "Position" ||
    updatedTrack.property !== "translate" ||
    updatedTrack.targetNodeId !== style.targetNodeId
  ) {
    throw new MotionNativeStyleRuntimeError(
      "unsupported-style",
      "Native Figma Position edits must target their source Position style.",
    );
  }

  const [originalTrack] = positionTracks(style);
  const [startFrame, endFrame] = updatedTrack.keyframes;
  if (
    updatedTrack.keyframes.length !== 2 ||
    startFrame?.t !== 0 ||
    endFrame?.t !== 1 ||
    !startFrame ||
    !endFrame ||
    endFrame.motionPath
  ) {
    throw new MotionNativeStyleRuntimeError(
      "unsupported-style",
      "Native Figma Position edits must keep the two source endpoints.",
    );
  }

  const start = parseMotionPosition(startFrame.value);
  const end = parseMotionPosition(endFrame.value);
  if (!start || !end) {
    throw new MotionNativeStyleRuntimeError(
      "invalid-style-props",
      "Native Figma Position endpoints must remain finite px values.",
    );
  }

  const props = { ...style.props };
  if (
    startFrame.value !== originalTrack.keyframes[0]?.value ||
    endFrame.value !== originalTrack.keyframes[1]?.value
  ) {
    props.type = "custom";
    props.axis = "xy";
    props.startX = start.x;
    props.startY = start.y;
    props.endX = end.x;
    props.endY = end.y;
  }

  if (startFrame.motionPath) {
    if (!isMotionPathSegmentV1(startFrame.motionPath)) {
      throw new MotionNativeStyleRuntimeError(
        "invalid-style-props",
        "Native Figma Position path must use the version 1 cubic format.",
      );
    }
    props.motionPath = {
      version: startFrame.motionPath.version,
      type: startFrame.motionPath.type,
      control1: {
        x: startFrame.motionPath.control1.x,
        y: startFrame.motionPath.control1.y,
      },
      control2: {
        x: startFrame.motionPath.control2.x,
        y: startFrame.motionPath.control2.y,
      },
    };
  } else {
    delete props.motionPath;
  }

  return { ...style, props };
}

export function motionNativeStyleWithPathTrimTrack(
  style: MotionNativeStyleInstance,
  updatedTrack: MotionTrack,
): MotionNativeStyleInstance {
  if (
    style.styleKey !== "Path" ||
    updatedTrack.property !== "path-trim" ||
    updatedTrack.targetNodeId !== style.targetNodeId
  ) {
    throw new MotionNativeStyleRuntimeError(
      "unsupported-style",
      "Native Figma Path edits must target their source Path style.",
    );
  }

  const [startFrame, endFrame] = updatedTrack.keyframes;
  if (
    updatedTrack.keyframes.length !== 2 ||
    startFrame?.t !== 0 ||
    endFrame?.t !== 1 ||
    !startFrame ||
    !endFrame ||
    startFrame.motionPath ||
    endFrame.motionPath
  ) {
    throw new MotionNativeStyleRuntimeError(
      "unsupported-style",
      "Native Figma Path edits must keep two start/end trim endpoints.",
    );
  }

  const start = parsePathTrimValue(startFrame.value);
  const end = parsePathTrimValue(endFrame.value);
  if (!start || !end) {
    throw new MotionNativeStyleRuntimeError(
      "invalid-style-props",
      "Native Figma Path endpoints must be start/end percentages between 0 and 100.",
    );
  }

  const original = pathTrimTracks(style)[0]!;
  const props = { ...style.props };
  if (
    startFrame.value !== original.keyframes[0]?.value ||
    endFrame.value !== original.keyframes[1]?.value
  ) {
    props.type = "custom";
    props.pathStartStartFrame = start.start;
    props.pathEndStartWithoutDivider = start.end;
    props.pathStartEndWithoutDivider = end.start;
    props.pathEndEndFrame = end.end;
  }
  return { ...style, props };
}

function pathTrimTracks(style: MotionNativeStyleInstance): MotionTrack[] {
  const props = style.props;
  const type = text(props.type, "draw");
  if (type !== "draw" && type !== "custom") {
    throw new MotionNativeStyleRuntimeError(
      "unsupported-style",
      `Native Figma Path type "${type}" is preserved in source but is not supported by the local path-trim adapter.`,
    );
  }
  const values = [
    [
      numeric(props.pathStartStartFrame, 100),
      numeric(props.pathEndStartWithoutDivider, 20),
    ],
    [
      numeric(props.pathStartEndWithoutDivider, 0),
      numeric(props.pathEndEndFrame, 100),
    ],
  ] as const;
  for (const [start, end] of values) {
    if (start < 0 || start > 100 || end < 0 || end > 100) {
      throw new MotionNativeStyleRuntimeError(
        "invalid-style-props",
        "Native Figma Path trim endpoints must be percentages between 0 and 100.",
      );
    }
  }
  return [
    track(
      style,
      "path-trim",
      values.map(([start, end]) => formatPathTrimValue(start, end)) as [
        string,
        string,
      ],
    ),
  ];
}

function parsePathTrimValue(
  value: string,
): { start: number; end: number } | null {
  const match =
    /^\s*(-?(?:\d+(?:\.\d*)?|\.\d+))%\s+(-?(?:\d+(?:\.\d*)?|\.\d+))%\s*$/.exec(
      value,
    );
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    start > 100 ||
    end < 0 ||
    end > 100
  ) {
    return null;
  }
  return { start, end };
}

function formatPathTrimValue(start: number, end: number): string {
  return `${formatPathTrimNumber(start)}% ${formatPathTrimNumber(end)}%`;
}

function formatPathTrimNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function positionTracks(style: MotionNativeStyleInstance): MotionTrack[] {
  const props = style.props;
  const type = text(props.type, "slide_in");
  let start: [number, number];
  let end: [number, number];
  if (type === "custom") {
    const axis = text(props.axis, "xy");
    if (axis !== "x" && axis !== "y" && axis !== "xy") {
      invalid("Position axis must be x, y, or xy.");
    }
    start = [
      axis === "y" ? 0 : numeric(props.startX, 200),
      axis === "x" ? 0 : numeric(props.startY, 200),
    ];
    end = [
      axis === "y" ? 0 : numeric(props.endX, 0),
      axis === "x" ? 0 : numeric(props.endY, 0),
    ];
  } else if (type === "slide_in" || type === "slide_out") {
    const vector = directionVector(text(props.direction, "left"));
    const distance = numeric(props.distance, 200);
    const offset: [number, number] = [
      vector[0] * distance,
      vector[1] * distance,
    ];
    start = type === "slide_in" ? offset : [0, 0];
    end = type === "slide_in" ? [0, 0] : offset;
  } else {
    invalid(`Unsupported Position type "${type}".`);
  }
  const positionTrack = track(style, "translate", [
    formatPosition(start),
    formatPosition(end),
  ]);
  const motionPath = readMotionPath(style.props.motionPath);
  if (motionPath) {
    positionTrack.keyframes[0] = {
      ...positionTrack.keyframes[0],
      motionPath,
    };
  }
  return [positionTrack];
}

function readMotionPath(value: MotionNativeStyleJsonValue | undefined) {
  if (value === undefined || value === null) return null;
  if (!isMotionPathSegmentV1(value)) {
    invalid("Native Figma Position path must use the version 1 cubic format.");
  }
  return value;
}

function scaleTracks(style: MotionNativeStyleInstance): MotionTrack[] {
  const props = style.props;
  const type = text(props.type, "scaleIn");
  let start: [number, number];
  let end: [number, number];
  if (type === "scaleIn" || type === "scaleOut") {
    const amount = numeric(props.amount, 120) / 100;
    start = type === "scaleIn" ? [amount, amount] : [1, 1];
    end = type === "scaleIn" ? [1, 1] : [amount, amount];
  } else if (type === "custom") {
    const axis = text(props.axis, "whCombined");
    const startW =
      numeric(props.wStartWithDivider ?? props.hStartWithoutDivider, 120) / 100;
    const endW =
      numeric(props.wEndWithoutDivider ?? props.wEndWithDivider, 100) / 100;
    const startH =
      numeric(props.hStartWithDivider ?? props.hStartWithoutDivider, 120) / 100;
    const endH = numeric(props.hEndWithoutDivider, 100) / 100;
    start =
      axis === "w"
        ? [startW, 1]
        : axis === "h"
          ? [1, startH]
          : [startW, startH];
    end = axis === "w" ? [endW, 1] : axis === "h" ? [1, endH] : [endW, endH];
  } else {
    invalid(`Unsupported Scale type "${type}".`);
  }
  return [track(style, "scale", [formatScale(start), formatScale(end)])];
}

function rotationTracks(style: MotionNativeStyleInstance): MotionTrack[] {
  const props = style.props;
  const type = text(props.type, "rotateIn");
  let start: number;
  let end: number;
  if (type === "custom") {
    start = numeric(props.start, 180);
    end = numeric(props.end, 0);
  } else if (type === "rotateIn" || type === "rotateOut") {
    const clockwise = text(props.direction, "clockwise") === "clockwise";
    const amount = numeric(props.amount, 180);
    const signed = amount * (clockwise ? -1 : 1);
    start = type === "rotateIn" ? signed : 0;
    end = type === "rotateIn" ? 0 : -signed;
  } else {
    invalid(`Unsupported Rotation type "${type}".`);
  }
  return [track(style, "rotate", [`${start}deg`, `${end}deg`])];
}

function opacityTracks(style: MotionNativeStyleInstance): MotionTrack[] {
  const props = style.props;
  const type = text(props.type, "fadeIn");
  let start: number;
  let end: number;
  if (type === "fadeIn") {
    start = numeric(props.amount, 0) / 100;
    end = 1;
  } else if (type === "fadeOut") {
    start = 1;
    end = numeric(props.amount, 0) / 100;
  } else if (type === "custom") {
    start = numeric(props.startFrame, 0) / 100;
    end = numeric(props.endFrame, 100) / 100;
  } else {
    invalid(`Unsupported Opacity type "${type}".`);
  }
  return [track(style, "opacity", [String(start), String(end)])];
}

function sizeTracks(style: MotionNativeStyleInstance): MotionTrack[] {
  const props = style.props;
  const type = text(props.type, "resize_in");
  const axis = text(props.axis, "xy");
  if (type !== "custom") {
    const amount = numeric(props.amount, 50);
    const sign = type === "resize_in" ? -1 : 1;
    const from = type === "resize_in" ? 0 : sign * amount;
    const to = type === "resize_in" ? sign * amount : 0;
    return [
      ...(axis !== "y"
        ? [
            track(style, "width", [
              `calc(100% + ${from}px)`,
              `calc(100% + ${to}px)`,
            ]),
          ]
        : []),
      ...(axis !== "x"
        ? [
            track(style, "height", [
              `calc(100% + ${from}px)`,
              `calc(100% + ${to}px)`,
            ]),
          ]
        : []),
    ];
  }
  const startWidth = numeric(props.startWidth, 50);
  const endWidth = numeric(props.endWidth, 100);
  const startHeight = numeric(props.startHeight, 50);
  const endHeight = numeric(props.endHeight, 100);
  return [
    ...(axis !== "y"
      ? [
          track(style, "width", [
            `calc(100% + ${startWidth}px)`,
            `calc(100% + ${endWidth}px)`,
          ]),
        ]
      : []),
    ...(axis !== "x"
      ? [
          track(style, "height", [
            `calc(100% + ${startHeight}px)`,
            `calc(100% + ${endHeight}px)`,
          ]),
        ]
      : []),
  ];
}

function textStaggerAnimations(
  style: MotionNativeStyleInstance,
): MotionTextAnimation[] {
  const props = style.props;
  for (const key of Object.keys(props)) {
    if (!TEXT_STAGGER_SUPPORTED_PROPS.has(key)) {
      unsupportedTextStaggerProp(key);
    }
  }
  const unit = textStaggerUnit(text(props.textDelayGrouping, "CHARACTER"));
  const direction = textStaggerOrder(
    text(props.textDelayOrder, "LEFT_RIGHT"),
    unit,
  );
  const animationDirection = text(props.animationDirection, "in");
  if (animationDirection !== "in" && animationDirection !== "out") {
    invalid("Native Figma TextStagger animationDirection must be in or out.");
  }
  const overlap = numeric(props.presetStaggerOverlap, 50);
  if (overlap < 0 || overlap > 100) {
    invalid("Native Figma TextStagger overlap must be between 0 and 100.");
  }
  const durationMs = Math.round(style.duration * 1000);
  const staggerMs = Math.round((durationMs * (100 - overlap)) / 100);
  const delayMs = Math.round(
    (style.timelineOffset + numeric(props.delay, 0)) * 1000,
  );
  const ease = easing(props.easing);
  const animations: MotionTextAnimation[] = [];

  if (booleanProp(props.blurEnabled, false, "blurEnabled")) {
    const amount = numeric(props.blurAmount, 20);
    const values: [string, string] =
      animationDirection === "in"
        ? [`blur(${amount}px)`, "blur(0px)"]
        : ["blur(0px)", `blur(${amount}px)`];
    animations.push(
      textAnimation(
        style,
        unit,
        direction,
        staggerMs,
        delayMs,
        durationMs,
        "filter",
        values,
        ease,
      ),
    );
  }
  if (booleanProp(props.clipContent, false, "clipContent")) {
    unsupportedTextStaggerProp("clipContent");
  }
  if (
    props.elementTransformOriginMode !== undefined &&
    props.elementTransformOriginMode !== "MATCH"
  ) {
    unsupportedTextStaggerProp("elementTransformOriginMode");
  }
  for (const key of [
    "elementTransformOriginX",
    "elementTransformOriginY",
  ] as const) {
    if (props[key] !== undefined && props[key] !== 50) {
      unsupportedTextStaggerProp(key);
    }
  }

  if (booleanProp(props.positionEnabled, true, "positionEnabled")) {
    const vector = directionVector(text(props.direction, "top"));
    const distance = numeric(props.distance, 40);
    animations.push(
      textAnimation(
        style,
        unit,
        direction,
        staggerMs,
        delayMs,
        durationMs,
        "translate",
        animationDirection === "in"
          ? [`${vector[0] * distance}px ${vector[1] * distance}px`, "0px 0px"]
          : ["0px 0px", `${vector[0] * distance}px ${vector[1] * distance}px`],
        ease,
      ),
    );
  }
  if (booleanProp(props.rotationEnabled, false, "rotationEnabled")) {
    const rotationDirection = text(props.rotationDirection, "clockwise");
    if (
      rotationDirection !== "clockwise" &&
      rotationDirection !== "counterclockwise"
    ) {
      invalid(
        "Native Figma TextStagger rotationDirection must be clockwise or counterclockwise.",
      );
    }
    const clockwise = rotationDirection === "clockwise";
    const amount = numeric(props.rotationAmount, 180);
    const signed = amount * (clockwise ? -1 : 1);
    animations.push(
      textAnimation(
        style,
        unit,
        direction,
        staggerMs,
        delayMs,
        durationMs,
        "rotate",
        animationDirection === "in"
          ? [`${signed}deg`, "0deg"]
          : ["0deg", `${-signed}deg`],
        ease,
      ),
    );
  }
  if (booleanProp(props.scaleEnabled, false, "scaleEnabled")) {
    const amount = numeric(props.scaleAmount, 120) / 100;
    animations.push(
      textAnimation(
        style,
        unit,
        direction,
        staggerMs,
        delayMs,
        durationMs,
        "scale",
        animationDirection === "in"
          ? [String(amount), "1"]
          : ["1", String(amount)],
        ease,
      ),
    );
  }
  if (booleanProp(props.opacityEnabled, false, "opacityEnabled")) {
    const amount = numeric(props.opacityAmount, 0) / 100;
    animations.push(
      textAnimation(
        style,
        unit,
        direction,
        staggerMs,
        delayMs,
        durationMs,
        "opacity",
        animationDirection === "in"
          ? [String(amount), "1"]
          : ["1", String(amount)],
        ease,
      ),
    );
  }
  return animations;
}

function textAnimation(
  style: MotionNativeStyleInstance,
  unit: MotionTextAnimation["unit"],
  direction: MotionTextAnimation["direction"],
  staggerMs: number,
  delayMs: number,
  durationMs: number,
  property: MotionTextAnimation["property"],
  values: [string, string],
  ease: string,
): MotionTextAnimation {
  return {
    targetNodeId: style.targetNodeId,
    unit,
    direction,
    staggerMs,
    delayMs,
    property,
    durationMs,
    keyframes: [
      { t: 0, value: values[0], ease },
      { t: 1, value: values[1] },
    ],
  };
}

function textStaggerUnit(value: string): MotionTextAnimation["unit"] {
  const units: Record<string, MotionTextAnimation["unit"]> = {
    CHARACTER: "character",
    WORD: "word",
    LINE: "line",
    PARAGRAPH: "paragraph",
  };
  const unit = units[value];
  if (!unit) {
    invalid(`Native Figma TextStagger grouping "${value}" is unsupported.`);
  }
  return unit;
}

function textStaggerOrder(
  value: string,
  unit: MotionTextAnimation["unit"],
): MotionTextAnimation["direction"] {
  if (value === "LEFT_RIGHT") return "forward";
  if (value === "RIGHT_LEFT") return "reverse";
  if (
    (value === "TOP_BOTTOM" || value === "BOTTOM_TOP") &&
    (unit === "line" || unit === "paragraph")
  ) {
    return value === "TOP_BOTTOM" ? "forward" : "reverse";
  }
  if (value === "CENTER_OUT" || value === "OUTSIDE_IN") {
    unsupportedTextStaggerProp("textDelayOrder");
  }
  if (value === "TOP_BOTTOM" || value === "BOTTOM_TOP") {
    unsupportedTextStaggerProp("textDelayOrder");
  }
  invalid(`Native Figma TextStagger order "${value}" is unsupported.`);
}

function booleanProp(
  value: MotionNativeStyleJsonValue | undefined,
  fallback: boolean,
  property: string,
): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    invalid(`Native Figma TextStagger ${property} must be a boolean.`);
  }
  return value;
}

function textAnimationKey(animation: MotionTextAnimation): string {
  return JSON.stringify(animation);
}

function unsupportedTextStaggerProp(property: string): never {
  throw new MotionNativeStyleRuntimeError(
    "unsupported-style",
    `Native Figma TextStagger property "${property}" is preserved in source but is not supported by the local text runtime yet.`,
  );
}

function track(
  style: MotionNativeStyleInstance,
  property: string,
  values: [string, string],
): MotionTrack {
  return {
    targetNodeId: style.targetNodeId,
    property,
    keyframes: [
      { t: 0, value: values[0], ease: easing(style.props.easing) },
      { t: 1, value: values[1] },
    ],
    delayMs: Math.round(
      (style.timelineOffset + numeric(style.props.delay, 0)) * 1000,
    ),
    durationMs: Math.round(style.duration * 1000),
  };
}

function easing(value: MotionNativeStyleJsonValue | undefined): string {
  if (typeof value === "string") {
    const normalized = value.toUpperCase();
    if (normalized === "LINEAR") return "linear";
    if (normalized === "EASE_IN") return "ease-in";
    if (normalized === "EASE_OUT") return "ease-out";
    if (normalized === "EASE_IN_OUT") return "ease-in-out";
    if (isValidMotionEase(value) || isMotionEaseVariableReference(value)) {
      return value;
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const type = text(value.type, "").toUpperCase();
    if (type === "LINEAR") return "linear";
    if (type === "EASE_IN") return "ease-in";
    if (type === "EASE_OUT") return "ease-out";
    if (type === "EASE_IN_OUT") return "ease-in-out";
    if (type === "CUSTOM") {
      return `cubic-bezier(${numeric(value.x1, 0)}, ${numeric(value.y1, 0)}, ${numeric(value.x2, 1)}, ${numeric(value.y2, 1)})`;
    }
    if (type === "SPRING") {
      return springToken({
        bounce: numeric(value.bounce, 0.25),
        settle: numeric(value.settle, 1),
      });
    }
  }
  invalid("Native Figma easing is not supported by the CSS runtime adapter.");
}

function numeric(
  value: MotionNativeStyleJsonValue | undefined,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalid("Native Figma motion property must be a finite number.");
  }
  return value;
}

function text(
  value: MotionNativeStyleJsonValue | undefined,
  fallback: string,
): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string")
    invalid("Native Figma motion property must be a string.");
  return value;
}

function directionVector(direction: string): [number, number] {
  const vectors: Record<string, [number, number]> = {
    left: [-1, 0],
    right: [1, 0],
    top: [0, -1],
    bottom: [0, 1],
    top_left: [-1, -1],
    top_right: [1, -1],
    bottom_left: [-1, 1],
    bottom_right: [1, 1],
  };
  const vector = vectors[direction];
  if (!vector) invalid(`Unsupported Position direction "${direction}".`);
  return vector;
}

function formatPosition([x, y]: [number, number]): string {
  return `${x}px ${y}px`;
}

function formatScale([x, y]: [number, number]): string {
  return `${x} ${y}`;
}

function invalid(message: string): never {
  throw new MotionNativeStyleRuntimeError("invalid-style-props", message);
}
