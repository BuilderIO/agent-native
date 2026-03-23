import { useCurrentFrame, useVideoConfig } from "remotion";
import type { AnimationTrack } from "@/types";
import { findTrack, getPropValueKeyframed } from "./trackAnimation";
import type { ReactNode } from "react";
import { Cursor, type CursorType } from "./ui-components/Cursor";

export interface CameraHostProps {
  tracks?: AnimationTrack[];
  children: ReactNode;
  renderCursor?: boolean; // Set to false to disable CameraHost's cursor (for compositions that render their own)
  autoCursorType?: CursorType; // Override cursor type from hover zones (takes priority over track)
}

// Fallback camera track with default values
const FALLBACK_CAMERA_TRACK: AnimationTrack = {
  id: "camera",
  label: "Camera",
  startFrame: 0,
  endFrame: 90,
  easing: "linear",
  animatedProps: [
    { property: "translateX", from: "0", to: "0", unit: "px" },
    { property: "translateY", from: "0", to: "0", unit: "px" },
    { property: "scale", from: "1", to: "1", unit: "" },
    { property: "rotateX", from: "0", to: "0", unit: "deg" },
    { property: "rotateY", from: "0", to: "0", unit: "deg" },
    { property: "perspective", from: "800", to: "800", unit: "px" },
  ],
};

/**
 * CameraHost wraps composition content and applies camera transforms
 * (zoom, pan, 3D tilt) based on the camera track's animated properties.
 *
 * Strategy to avoid pixelation while keeping immutable layout:
 * 1. Content is rendered at INTERNAL_RENDER_SCALE (e.g., 3×) via CSS variable
 * 2. Scaled down by 1/INTERNAL_RENDER_SCALE to appear normal size
 * 3. Camera zoom scales back up (so at 3× zoom, 3× render is at 1:1 - perfectly sharp)
 *
 * Transform chain: perspective(N) translate3d(x, y, 0) rotateX(rx) rotateY(ry) scale(s)
 */

const INTERNAL_RENDER_SCALE = 3; // Render content at 3× size for crisp zoom up to 3×

export const CameraHost: React.FC<CameraHostProps> = ({
  tracks = [],
  children,
  renderCursor = true,
  autoCursorType,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const cameraTrack = findTrack(tracks, "camera", FALLBACK_CAMERA_TRACK);

  // Read all camera properties using keyframe interpolation
  const translateX = getPropValueKeyframed(
    frame,
    fps,
    cameraTrack,
    "translateX",
    0,
  );
  const translateY = getPropValueKeyframed(
    frame,
    fps,
    cameraTrack,
    "translateY",
    0,
  );
  const scale = getPropValueKeyframed(frame, fps, cameraTrack, "scale", 1);
  const rotateX = getPropValueKeyframed(frame, fps, cameraTrack, "rotateX", 0);
  const rotateY = getPropValueKeyframed(frame, fps, cameraTrack, "rotateY", 0);
  const perspective = getPropValueKeyframed(
    frame,
    fps,
    cameraTrack,
    "perspective",
    800,
  );

  // Validate all values are finite (safety check)
  const allValid = [
    translateX,
    translateY,
    scale,
    rotateX,
    rotateY,
    perspective,
  ].every((v) => Number.isFinite(v));

  // Calculate final camera transform scale
  // Content is pre-rendered at INTERNAL_RENDER_SCALE, then camera zoom is applied on top
  // Example: at 1× camera zoom → scale 1/3 → appears normal
  //          at 3× camera zoom → scale 3/3 = 1 → 3× render at 1:1 (sharp!)
  const cameraTransformScale = allValid
    ? scale / INTERNAL_RENDER_SCALE
    : 1 / INTERNAL_RENDER_SCALE;

  // Build transform string (perspective → translate → rotate → scale)
  const transformStyle = allValid
    ? [
        `perspective(${perspective}px)`,
        `translate3d(${translateX}px, ${translateY}px, 0)`,
        `rotateX(${rotateX}deg)`,
        `rotateY(${rotateY}deg)`,
        `scale(${cameraTransformScale})`,
      ].join(" ")
    : `perspective(800px) translate3d(0px, 0px, 0) rotateX(0deg) rotateY(0deg) scale(${1 / INTERNAL_RENDER_SCALE})`;

  // ── Cursor System ──────────────────────────────────────────────────────
  const cursorTrack = tracks.find((t) => t.id === "cursor");
  const hasCursor = !!cursorTrack;

  // Get cursor position
  const cursorX = hasCursor
    ? getPropValueKeyframed(frame, fps, cursorTrack, "x", 960)
    : 0;
  const cursorY = hasCursor
    ? getPropValueKeyframed(frame, fps, cursorTrack, "y", 540)
    : 0;

  // Get cursor appearance
  const cursorOpacity = hasCursor
    ? getPropValueKeyframed(frame, fps, cursorTrack, "opacity", 1)
    : 0;
  const cursorScale = hasCursor
    ? getPropValueKeyframed(frame, fps, cursorTrack, "scale", 1)
    : 1;

  // Get cursor type (stepped, not interpolated)
  const getCursorType = (): CursorType => {
    if (!cursorTrack) return "default";

    const prop = cursorTrack.animatedProps?.find((p) => p.property === "type");
    if (!prop?.keyframes || prop.keyframes.length === 0) {
      return (prop?.from as CursorType) || "default";
    }

    // Find the most recent keyframe at or before current frame
    const sorted = [...prop.keyframes].sort((a, b) => a.frame - b.frame);
    let currentValue = (prop.from as CursorType) || "default";

    for (const kf of sorted) {
      if (frame >= kf.frame) {
        currentValue = kf.value as CursorType;
      } else {
        break;
      }
    }

    return currentValue;
  };

  const cursorType = getCursorType();

  // Get all click start frames
  const getClickStartFrames = (): number[] => {
    if (!cursorTrack) return [];

    const clickProp = cursorTrack.animatedProps?.find(
      (p) => p.property === "isClicking",
    );
    if (!clickProp?.keyframes || clickProp.keyframes.length === 0) {
      return [];
    }

    // Return all frames where clicking is set to "1"
    return clickProp.keyframes
      .filter((kf) => kf.value === "1")
      .map((kf) => kf.frame)
      .sort((a, b) => a - b);
  };

  const clickStartFrames = getClickStartFrames();

  // Determine if currently clicking (within 6 frames of any click)
  const isClicking = clickStartFrames.some(
    (clickFrame) => frame >= clickFrame && frame - clickFrame < 6,
  );

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        transform: transformStyle,
        transformOrigin: "50% 50%",
        transformStyle: "preserve-3d",
        willChange: "transform",
      }}
    >
      {/* Inner wrapper: pre-render content at high quality */}
      <div
        style={{
          width: "100%",
          height: "100%",
          transform: `scale(${INTERNAL_RENDER_SCALE})`,
          transformOrigin: "50% 50%",
        }}
      >
        {children}

        {/* Cursor overlay - rendered inside camera transforms so it zooms with camera */}
        {renderCursor && hasCursor && (
          <Cursor
            x={cursorX}
            y={cursorY}
            type={cursorType}
            autoType={autoCursorType} // Override from hover zones (takes priority)
            opacity={cursorOpacity}
            scale={cursorScale}
            isClicking={isClicking}
            currentFrame={frame}
            clickStartFrames={clickStartFrames}
          />
        )}
      </div>
    </div>
  );
};
