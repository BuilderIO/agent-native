import type { AnimationTrack, EasingKey } from "@/types";

/**
 * Get all unique keyframe frames across all properties in a track
 */
export function getAllKeyframeFrames(track?: AnimationTrack): number[] {
  if (!track) return [];

  const frameSet = new Set<number>();
  track.animatedProps?.forEach((prop) => {
    prop.keyframes?.forEach((kf) => frameSet.add(kf.frame));
  });

  return Array.from(frameSet).sort((a, b) => a - b);
}

/**
 * Check if a specific frame has a keyframe on any property
 */
export function isFrameOnKeyframe(
  track: AnimationTrack | undefined,
  frame: number,
): boolean {
  if (!track) return false;

  return (
    track.animatedProps?.some((prop) =>
      prop.keyframes?.some((kf) => kf.frame === frame),
    ) ?? false
  );
}

/**
 * Navigate to the previous or next keyframe from the current frame
 * Returns the frame number to seek to, or null if none found
 */
export function navigateKeyframe(
  track: AnimationTrack,
  currentFrame: number,
  direction: "prev" | "next",
): number | null {
  const allFrames = getAllKeyframeFrames(track);
  if (allFrames.length === 0) return null;

  if (direction === "prev") {
    const prevFrames = allFrames.filter((f) => f < currentFrame);
    if (prevFrames.length > 0) {
      return prevFrames[prevFrames.length - 1];
    }
  } else {
    const nextFrames = allFrames.filter((f) => f > currentFrame);
    if (nextFrames.length > 0) {
      return nextFrames[0];
    }
  }

  return null;
}

/**
 * Duplicate a keyframe at the current frame, offsetting it by the specified number of frames
 * Returns the new animatedProps array (does not mutate the track)
 */
export function duplicateKeyframeForTrack(
  track: AnimationTrack,
  currentFrame: number,
  offset: number = 30,
): AnimationTrack["animatedProps"] {
  if (!track.animatedProps) return undefined;

  const targetFrame = currentFrame + offset;

  return track.animatedProps.map((prop) => {
    if (!prop.keyframes) return prop;

    // Find the current keyframe to duplicate
    const currentKf = prop.keyframes.find((kf) => kf.frame === currentFrame);
    if (!currentKf) return prop;

    // Check if keyframe already exists at target frame
    const existingIndex = prop.keyframes.findIndex(
      (kf) => kf.frame === targetFrame,
    );

    let newKeyframes = [...prop.keyframes];

    if (existingIndex >= 0) {
      // Update existing keyframe with current values
      newKeyframes[existingIndex] = {
        frame: targetFrame,
        value: currentKf.value,
        easing: currentKf.easing,
      };
    } else {
      // Add new keyframe
      newKeyframes.push({
        frame: targetFrame,
        value: currentKf.value,
        easing: currentKf.easing,
      });
      newKeyframes.sort((a, b) => a.frame - b.frame);
    }

    return { ...prop, keyframes: newKeyframes };
  });
}

/**
 * Remove a keyframe at the current frame
 * Returns the new animatedProps array (does not mutate the track)
 * If keepEmptyArrays is false, converts empty keyframes arrays to undefined
 */
export function removeKeyframeForTrack(
  track: AnimationTrack,
  currentFrame: number,
  keepEmptyArrays: boolean = false,
): AnimationTrack["animatedProps"] {
  if (!track.animatedProps) return undefined;

  return track.animatedProps.map((prop) => {
    if (!prop.keyframes) return prop;

    const newKeyframes = prop.keyframes.filter(
      (kf) => kf.frame !== currentFrame,
    );

    return {
      ...prop,
      keyframes:
        keepEmptyArrays || newKeyframes.length > 0 ? newKeyframes : undefined,
    };
  });
}

/**
 * Update the easing of a keyframe at the current frame
 * Returns the new animatedProps array (does not mutate the track)
 */
export function updateKeyframeEasing(
  track: AnimationTrack,
  currentFrame: number,
  easing: EasingKey,
): AnimationTrack["animatedProps"] {
  if (!track.animatedProps) return undefined;

  return track.animatedProps.map((prop) => {
    if (!prop.keyframes) return prop;

    const keyframeIndex = prop.keyframes.findIndex(
      (kf) => kf.frame === currentFrame,
    );
    if (keyframeIndex < 0) return prop;

    const newKeyframes = [...prop.keyframes];
    newKeyframes[keyframeIndex] = {
      ...newKeyframes[keyframeIndex],
      easing,
    };

    return { ...prop, keyframes: newKeyframes };
  });
}

/**
 * Get the easing value from a keyframe at the current frame
 * Returns the easing, or the fallback if not found
 */
export function getCurrentKeyframeEasing(
  track: AnimationTrack,
  currentFrame: number,
  fallback: EasingKey = "linear",
): EasingKey {
  if (!track.animatedProps) return fallback;

  // Get easing from first property's current keyframe (all should be in sync)
  const firstProp = track.animatedProps.find(
    (p) => p.keyframes && p.keyframes.length > 0,
  );
  if (!firstProp?.keyframes) return fallback;

  const keyframe = firstProp.keyframes.find((kf) => kf.frame === currentFrame);
  return keyframe?.easing ?? fallback;
}

/**
 * Set or update a keyframe for a specific property at the current frame
 * Returns the new animatedProps array (does not mutate the track)
 */
export function setOrUpdateKeyframe(
  track: AnimationTrack,
  property: string,
  currentFrame: number,
  value: number,
  easing: EasingKey = "expo.inOut",
): AnimationTrack["animatedProps"] {
  if (!track.animatedProps) return undefined;

  return track.animatedProps.map((prop) => {
    if (prop.property !== property) return prop;

    const valueStr = value.toString();
    const keyframes = prop.keyframes || [];
    const existingIdx = keyframes.findIndex((kf) => kf.frame === currentFrame);

    let newKeyframes;
    if (existingIdx >= 0) {
      // Update existing keyframe (preserve easing)
      newKeyframes = keyframes.map((kf, i) =>
        i === existingIdx ? { ...kf, value: valueStr } : kf,
      );
    } else {
      // Add new keyframe
      newKeyframes = [
        ...keyframes,
        { frame: currentFrame, value: valueStr, easing },
      ];
      newKeyframes.sort((a, b) => a.frame - b.frame);
    }

    return { ...prop, keyframes: newKeyframes };
  });
}

/**
 * Update all camera properties at once for the current keyframe
 * This is a specialized version for camera controls that updates multiple properties together
 */
export function updateCameraKeyframe(
  track: AnimationTrack,
  currentFrame: number,
  allValues: Record<string, number>,
  defaultEasing: EasingKey = "expo.inOut",
): AnimationTrack["animatedProps"] {
  if (!track.animatedProps) return undefined;

  return track.animatedProps.map((prop) => {
    const propertyKey = prop.property;
    const newValue = allValues[propertyKey];

    // Skip if this property isn't in the values object
    if (newValue === undefined) return prop;

    // Validate value
    if (!Number.isFinite(newValue)) return prop;

    const valueStr = String(newValue);

    if (!prop.keyframes) {
      // Initialize keyframes array with current value
      return {
        ...prop,
        keyframes: [
          { frame: currentFrame, value: valueStr, easing: defaultEasing },
        ],
      };
    }

    const existingIndex = prop.keyframes.findIndex(
      (kf) => kf.frame === currentFrame,
    );

    if (existingIndex >= 0) {
      // Update existing keyframe (preserve easing)
      const newKeyframes = [...prop.keyframes];
      newKeyframes[existingIndex] = {
        ...newKeyframes[existingIndex],
        frame: currentFrame,
        value: valueStr,
      };
      return { ...prop, keyframes: newKeyframes };
    } else {
      // Add new keyframe
      const newKeyframes = [
        ...prop.keyframes,
        { frame: currentFrame, value: valueStr, easing: defaultEasing },
      ];
      newKeyframes.sort((a, b) => a.frame - b.frame);
      return { ...prop, keyframes: newKeyframes };
    }
  });
}

/**
 * Reset all properties to their default values at the current frame
 * Returns the new animatedProps array (does not mutate the track)
 */
export function resetToDefaults(
  track: AnimationTrack,
  currentFrame: number,
  defaults: Record<string, number>,
  defaultEasing: EasingKey = "expo.inOut",
): AnimationTrack["animatedProps"] {
  if (!track.animatedProps) return undefined;

  return track.animatedProps.map((prop) => {
    const defaultValue = defaults[prop.property];
    const valueStr = defaultValue?.toString() || "0";

    if (!prop.keyframes) {
      return {
        ...prop,
        keyframes: [
          { frame: currentFrame, value: valueStr, easing: defaultEasing },
        ],
      };
    }

    const existingIndex = prop.keyframes.findIndex(
      (kf) => kf.frame === currentFrame,
    );

    if (existingIndex >= 0) {
      // Update existing keyframe to default value (preserve easing)
      const newKeyframes = [...prop.keyframes];
      newKeyframes[existingIndex] = {
        ...newKeyframes[existingIndex],
        frame: currentFrame,
        value: valueStr,
      };
      return { ...prop, keyframes: newKeyframes };
    } else {
      // Add new keyframe with default value
      const newKeyframes = [
        ...prop.keyframes,
        { frame: currentFrame, value: valueStr, easing: defaultEasing },
      ];
      newKeyframes.sort((a, b) => a.frame - b.frame);
      return { ...prop, keyframes: newKeyframes };
    }
  });
}
