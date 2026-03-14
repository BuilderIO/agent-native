/**
 * Animation Testing Utilities
 *
 * Helpers for testing animated components and animations
 */

import type {
  ElementAnimation,
  AnimatedPropertyConfig,
} from "@/types/elementAnimations";
import type { CursorFrame } from "@/remotion/hooks/useCursorHistory";
import type { AnimationTrack } from "@/types";
import {
  validateAnimation,
  getAnimationValue,
} from "@/remotion/utils/animationHelpers";

/**
 * Create mock cursor history for testing hover states
 */
export function createMockCursorHistory(
  frames: number,
  position: { x: number; y: number },
  clicking: number = 0,
): CursorFrame[] {
  return Array.from({ length: frames }, () => ({
    x: position.x,
    y: position.y,
    clicking,
  }));
}

/**
 * Create mock cursor track for testing
 */
export function createMockCursorTrack(
  clickFrames: number[] = [],
): AnimationTrack {
  return {
    id: "cursor",
    label: "Cursor",
    startFrame: 0,
    endFrame: 300,
    easing: "linear",
    animatedProps: [
      {
        property: "x",
        from: "0",
        to: "0",
        unit: "px",
        keyframes: [],
      },
      {
        property: "y",
        from: "0",
        to: "0",
        unit: "px",
        keyframes: [],
      },
      {
        property: "isClicking",
        from: "0",
        to: "0",
        unit: "",
        keyframes: clickFrames.flatMap((frame) => [
          { frame, value: "1", easing: "linear" },
          { frame: frame + 2, value: "0", easing: "linear" },
        ]),
      },
    ],
  };
}

/**
 * Test if hover state is detected correctly
 */
export function testHoverDetection(
  cursorHistory: CursorFrame[],
  zone: { x: number; y: number; width: number; height: number },
  expectedProgress: number,
  tolerance: number = 0.01,
): { passed: boolean; actual: number; expected: number } {
  let hoverFrames = 0;
  const cursorSize = 32;
  const padding = 8;

  cursorHistory.forEach(({ x, y }) => {
    const wasHovering =
      x + cursorSize > zone.x - padding &&
      x < zone.x + zone.width + padding &&
      y + cursorSize > zone.y - padding &&
      y < zone.y + zone.height + padding;

    if (wasHovering) hoverFrames++;
  });

  const actualProgress = hoverFrames / cursorHistory.length;
  const passed = Math.abs(actualProgress - expectedProgress) <= tolerance;

  return {
    passed,
    actual: actualProgress,
    expected: expectedProgress,
  };
}

/**
 * Test animation property interpolation
 */
export function testPropertyInterpolation(
  property: AnimatedPropertyConfig,
  testCases: Array<{ progress: number; expected: number | string }>,
): {
  passed: boolean;
  failures: Array<{ progress: number; actual: any; expected: any }>;
} {
  const failures: Array<{ progress: number; actual: any; expected: any }> = [];

  testCases.forEach(({ progress, expected }) => {
    const actual = getAnimationValue(property, progress);

    // Handle numeric comparison with tolerance
    if (typeof expected === "number" && typeof actual === "number") {
      if (Math.abs(actual - expected) > 0.01) {
        failures.push({ progress, actual, expected });
      }
    } else if (actual !== expected) {
      failures.push({ progress, actual, expected });
    }
  });

  return {
    passed: failures.length === 0,
    failures,
  };
}

/**
 * Test animation configuration validity
 */
export function testAnimationValidity(animation: ElementAnimation): {
  passed: boolean;
  errors: string[];
} {
  return validateAnimation(animation);
}

/**
 * Create a test suite for an element's animations
 */
export function createAnimationTestSuite(
  elementType: string,
  hoverAnimation?: ElementAnimation,
  clickAnimation?: ElementAnimation,
) {
  return {
    /**
     * Test hover animation properties
     */
    testHoverAnimation() {
      if (!hoverAnimation) {
        console.warn(`No hover animation for ${elementType}`);
        return { passed: false, reason: "No hover animation defined" };
      }

      const validity = validateAnimation(hoverAnimation);
      if (!validity.valid) {
        return {
          passed: false,
          reason: "Invalid animation",
          errors: validity.errors,
        };
      }

      // Test that hover animation has reasonable duration (3-15 frames)
      if (hoverAnimation.duration < 3 || hoverAnimation.duration > 15) {
        return {
          passed: false,
          reason: `Hover duration ${hoverAnimation.duration} outside recommended range (3-15 frames)`,
        };
      }

      return { passed: true };
    },

    /**
     * Test click animation properties
     */
    testClickAnimation() {
      if (!clickAnimation) {
        console.warn(`No click animation for ${elementType}`);
        return { passed: false, reason: "No click animation defined" };
      }

      const validity = validateAnimation(clickAnimation);
      if (!validity.valid) {
        return {
          passed: false,
          reason: "Invalid animation",
          errors: validity.errors,
        };
      }

      // Test that click animation has reasonable duration (5-20 frames)
      if (clickAnimation.duration < 5 || clickAnimation.duration > 20) {
        return {
          passed: false,
          reason: `Click duration ${clickAnimation.duration} outside recommended range (5-20 frames)`,
        };
      }

      return { passed: true };
    },

    /**
     * Test all property keyframes
     */
    testKeyframes() {
      const results: Record<string, any> = {};

      if (hoverAnimation) {
        hoverAnimation.properties.forEach((prop) => {
          results[`hover-${prop.property}`] = {
            keyframeCount: prop.keyframes.length,
            hasStart: prop.keyframes.some((kf) => kf.progress === 0),
            hasEnd: prop.keyframes.some((kf) => kf.progress === 1),
          };
        });
      }

      if (clickAnimation) {
        clickAnimation.properties.forEach((prop) => {
          results[`click-${prop.property}`] = {
            keyframeCount: prop.keyframes.length,
            hasStart: prop.keyframes.some((kf) => kf.progress === 0),
            hasEnd: prop.keyframes.some((kf) => kf.progress === 1),
          };
        });
      }

      return results;
    },

    /**
     * Run all tests
     */
    runAll() {
      const results = {
        hover: this.testHoverAnimation(),
        click: this.testClickAnimation(),
        keyframes: this.testKeyframes(),
      };

      const passed = results.hover.passed && results.click.passed;

      return {
        passed,
        results,
        elementType,
      };
    },
  };
}

/**
 * Mock getAnimationsForElement function for testing
 */
export function createMockGetAnimations(
  animations: Record<string, ElementAnimation[]>,
) {
  return (compositionId: string, elementType: string): ElementAnimation[] => {
    const key = `${compositionId}-${elementType}`;
    return animations[key] || [];
  };
}

/**
 * Snapshot test for animated styles at different progress values
 */
export function snapshotAnimatedStyles(
  animation: ElementAnimation,
  progressSteps: number[] = [0, 0.25, 0.5, 0.75, 1],
): Record<number, Record<string, any>> {
  const snapshots: Record<number, Record<string, any>> = {};

  progressSteps.forEach((progress) => {
    const styles: Record<string, any> = {};

    animation.properties.forEach((prop) => {
      styles[prop.property] = getAnimationValue(prop, progress);
    });

    snapshots[progress] = styles;
  });

  return snapshots;
}

/**
 * Performance test - measure animation calculation time
 */
export function benchmarkAnimation(
  animation: ElementAnimation,
  iterations: number = 1000,
): { averageMs: number; minMs: number; maxMs: number } {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const progress = Math.random();
    const start = performance.now();

    animation.properties.forEach((prop) => {
      getAnimationValue(prop, progress);
    });

    const end = performance.now();
    times.push(end - start);
  }

  return {
    averageMs: times.reduce((a, b) => a + b) / times.length,
    minMs: Math.min(...times),
    maxMs: Math.max(...times),
  };
}

/**
 * Visual regression helper - generate test frames
 */
export function generateTestFrames(
  totalFrames: number,
  hoverStart: number,
  hoverEnd: number,
  clickFrame: number,
): {
  frame: number;
  hoverProgress: number;
  clickProgress: number;
}[] {
  const frames: any[] = [];

  for (let frame = 0; frame < totalFrames; frame++) {
    let hoverProgress = 0;
    if (frame >= hoverStart && frame <= hoverEnd) {
      hoverProgress = (frame - hoverStart) / (hoverEnd - hoverStart);
    } else if (frame > hoverEnd) {
      hoverProgress = 1 - (frame - hoverEnd) / 10;
      hoverProgress = Math.max(0, hoverProgress);
    }

    let clickProgress = 0;
    const clickDuration = 12;
    if (frame >= clickFrame && frame < clickFrame + clickDuration * 2) {
      const elapsed = frame - clickFrame;
      const raw = elapsed / clickDuration;
      clickProgress = raw <= 1 ? raw : 2 - raw;
    }

    frames.push({
      frame,
      hoverProgress: Math.max(0, Math.min(1, hoverProgress)),
      clickProgress: Math.max(0, Math.min(1, clickProgress)),
    });
  }

  return frames;
}
