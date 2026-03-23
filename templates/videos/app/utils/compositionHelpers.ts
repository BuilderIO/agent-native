/**
 * Composition Creation Helpers
 *
 * Utilities for programmatically creating Remotion compositions
 * with all features: camera, cursor, interactions, multi-keyframe selection
 */

import type { AnimationTrack, AnimatedProp } from "@/types";

/**
 * Create a camera track with default values
 * Camera tracks should always span the full composition duration
 */
export function createCameraTrack(durationInFrames: number): AnimationTrack {
  return {
    id: "camera",
    label: "Camera",
    startFrame: 0,
    endFrame: durationInFrames,
    easing: "linear",
    animatedProps: [
      { property: "translateX", from: "0", to: "0", unit: "px", keyframes: [] },
      { property: "translateY", from: "0", to: "0", unit: "px", keyframes: [] },
      { property: "scale", from: "1", to: "1", unit: "", keyframes: [] },
      { property: "rotateX", from: "0", to: "0", unit: "deg", keyframes: [] },
      { property: "rotateY", from: "0", to: "0", unit: "deg", keyframes: [] },
      {
        property: "perspective",
        from: "800",
        to: "800",
        unit: "px",
        keyframes: [],
      },
    ],
  };
}

/**
 * Create a cursor track with default values
 * Default position is centered for 1920x1080 (Wide format)
 */
export function createCursorTrack(
  durationInFrames: number,
  options: {
    centerX?: number;
    centerY?: number;
    easing?: string;
  } = {},
): AnimationTrack {
  const { centerX = 960, centerY = 540, easing = "expo.inOut" } = options;

  return {
    id: "cursor",
    label: "Cursor",
    startFrame: 0,
    endFrame: durationInFrames,
    easing,
    animatedProps: [
      {
        property: "x",
        from: String(centerX),
        to: String(centerX),
        unit: "px",
        keyframes: [],
      },
      {
        property: "y",
        from: String(centerY),
        to: String(centerY),
        unit: "px",
        keyframes: [],
      },
      { property: "opacity", from: "1", to: "1", unit: "", keyframes: [] },
      { property: "scale", from: "1", to: "1", unit: "", keyframes: [] },
      { property: "type", from: "default", to: "default", unit: "" },
      { property: "isClicking", from: "0", to: "0", unit: "" },
    ],
  };
}

/**
 * Create a simple animation track
 */
export function createAnimationTrack(
  id: string,
  label: string,
  startFrame: number,
  endFrame: number,
  properties: Array<{
    property: string;
    from: string;
    to: string;
    unit: string;
  }>,
  easing: string = "spring",
): AnimationTrack {
  return {
    id,
    label,
    startFrame,
    endFrame,
    easing,
    animatedProps: properties.map((prop) => ({
      ...prop,
      keyframes: [],
    })),
  };
}

/**
 * Create a fade-in animation track
 */
export function createFadeInTrack(
  id: string,
  label: string,
  startFrame: number,
  duration: number = 30,
): AnimationTrack {
  return createAnimationTrack(
    id,
    label,
    startFrame,
    startFrame + duration,
    [{ property: "opacity", from: "0", to: "1", unit: "" }],
    "spring",
  );
}

/**
 * Create a slide-in animation track
 */
export function createSlideInTrack(
  id: string,
  label: string,
  startFrame: number,
  duration: number = 30,
  direction: "left" | "right" | "up" | "down" = "left",
): AnimationTrack {
  const properties: Array<{
    property: string;
    from: string;
    to: string;
    unit: string;
  }> = [{ property: "opacity", from: "0", to: "1", unit: "" }];

  switch (direction) {
    case "left":
      properties.push({
        property: "translateX",
        from: "-80",
        to: "0",
        unit: "px",
      });
      break;
    case "right":
      properties.push({
        property: "translateX",
        from: "80",
        to: "0",
        unit: "px",
      });
      break;
    case "up":
      properties.push({
        property: "translateY",
        from: "80",
        to: "0",
        unit: "px",
      });
      break;
    case "down":
      properties.push({
        property: "translateY",
        from: "-80",
        to: "0",
        unit: "px",
      });
      break;
  }

  return createAnimationTrack(
    id,
    label,
    startFrame,
    startFrame + duration,
    properties,
    "spring",
  );
}

/**
 * Create a scale animation track
 */
export function createScaleTrack(
  id: string,
  label: string,
  startFrame: number,
  duration: number = 30,
  fromScale: number = 0.5,
  toScale: number = 1,
): AnimationTrack {
  return createAnimationTrack(
    id,
    label,
    startFrame,
    startFrame + duration,
    [
      {
        property: "scale",
        from: String(fromScale),
        to: String(toScale),
        unit: "",
      },
      { property: "opacity", from: "0", to: "1", unit: "" },
    ],
    "spring",
  );
}

/**
 * Add a keyframe to an animated property
 */
export function addKeyframe(
  prop: AnimatedProp,
  frame: number,
  value: string,
  easing?: string,
): AnimatedProp {
  const keyframes = prop.keyframes || [];

  // Check if keyframe already exists at this frame
  const existingIndex = keyframes.findIndex((kf) => kf.frame === frame);

  if (existingIndex >= 0) {
    // Update existing keyframe
    keyframes[existingIndex] = { frame, value, ...(easing && { easing }) };
  } else {
    // Add new keyframe and sort
    keyframes.push({ frame, value, ...(easing && { easing }) });
    keyframes.sort((a, b) => a.frame - b.frame);
  }

  return {
    ...prop,
    keyframes,
  };
}

/**
 * Add multiple keyframes at once
 */
export function addKeyframes(
  prop: AnimatedProp,
  keyframes: Array<{ frame: number; value: string; easing?: string }>,
): AnimatedProp {
  let result = prop;
  for (const kf of keyframes) {
    result = addKeyframe(result, kf.frame, kf.value, kf.easing);
  }
  return result;
}

/**
 * Create cursor path keyframes from an array of positions
 */
export function createCursorPath(
  frames: number[],
  positions: Array<{ x: number; y: number }>,
  easing: string = "expo.inOut",
): Array<{
  property: string;
  keyframes: Array<{ frame: number; value: string; easing?: string }>;
}> {
  const xKeyframes = positions.map((pos, i) => ({
    frame: frames[i],
    value: String(pos.x),
    easing,
  }));

  const yKeyframes = positions.map((pos, i) => ({
    frame: frames[i],
    value: String(pos.y),
    easing,
  }));

  return [
    { property: "x", keyframes: xKeyframes },
    { property: "y", keyframes: yKeyframes },
  ];
}

/**
 * Create click event keyframes
 * Each click is 3 frames: click on → click off
 */
export function createClickEvents(
  clickFrames: number[],
): Array<{ frame: number; value: string }> {
  const keyframes: Array<{ frame: number; value: string }> = [];

  for (const frame of clickFrames) {
    keyframes.push(
      { frame, value: "1" }, // Click starts
      { frame: frame + 3, value: "0" }, // Click ends 3 frames later
    );
  }

  keyframes.sort((a, b) => a.frame - b.frame);
  return keyframes;
}

/**
 * Validate that a composition has all required tracks
 */
export function validateComposition(tracks: AnimationTrack[]): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for camera track
  const cameraTrack = tracks.find((t) => t.id === "camera");
  if (!cameraTrack) {
    errors.push("Missing required camera track (id: 'camera')");
  } else {
    // Validate camera properties
    const requiredProps = [
      "translateX",
      "translateY",
      "scale",
      "rotateX",
      "rotateY",
      "perspective",
    ];
    const cameraProps = cameraTrack.animatedProps?.map((p) => p.property) || [];
    const missing = requiredProps.filter((p) => !cameraProps.includes(p));
    if (missing.length > 0) {
      errors.push(`Camera track missing properties: ${missing.join(", ")}`);
    }
  }

  // Check for cursor track (warning, not error - some comps might not need it)
  const cursorTrack = tracks.find((t) => t.id === "cursor");
  if (!cursorTrack) {
    warnings.push("No cursor track found - cursor interactions will not work");
  } else {
    // Validate cursor properties
    const requiredProps = ["x", "y", "opacity", "scale", "type", "isClicking"];
    const cursorProps = cursorTrack.animatedProps?.map((p) => p.property) || [];
    const missing = requiredProps.filter((p) => !cursorProps.includes(p));
    if (missing.length > 0) {
      warnings.push(`Cursor track missing properties: ${missing.join(", ")}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Get composition dimensions based on format preset
 */
export function getCompositionDimensions(
  format: "square" | "wide" | "vertical",
): {
  width: number;
  height: number;
} {
  switch (format) {
    case "square":
      return { width: 1080, height: 1080 };
    case "wide":
      return { width: 1920, height: 1080 };
    case "vertical":
      return { width: 1080, height: 1920 };
    default:
      return { width: 1920, height: 1080 }; // Default to wide
  }
}

/**
 * Calculate center position for cursor based on composition size
 */
export function getCursorCenter(
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: width / 2,
    y: height / 2,
  };
}

/**
 * Convert seconds to frames
 */
export function secondsToFrames(seconds: number, fps: number = 30): number {
  return Math.round(seconds * fps);
}

/**
 * Convert frames to seconds
 */
export function framesToSeconds(frames: number, fps: number = 30): number {
  return frames / fps;
}

/**
 * Create a programmatic animation property
 */
export function createProgrammaticProp(
  property: string,
  description: string,
  codeSnippet: string,
  parameters: Array<{
    name: string;
    label: string;
    default: number;
    min: number;
    max: number;
    step: number;
  }> = [],
): AnimatedProp {
  const parameterValues: Record<string, number> = {};
  parameters.forEach((p) => {
    parameterValues[p.name] = p.default;
  });

  return {
    property,
    from: "",
    to: "",
    unit: "",
    programmatic: true,
    description,
    parameters,
    parameterValues,
    codeSnippet,
  };
}
