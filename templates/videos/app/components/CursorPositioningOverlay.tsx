import { useRef, useState, useCallback } from "react";
import type { AnimationTrack } from "@/types";
import { getPropValueKeyframed } from "@/remotion/trackAnimation";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface CursorPositioningOverlayProps {
  compositionWidth: number;
  compositionHeight: number;
  currentFrame: number;
  fps: number;
  tracks: AnimationTrack[];
  onUpdateTrack: (id: string, patch: Partial<AnimationTrack>) => void;
  isPlaying: boolean;
}

/**
 * Interactive overlay for click-and-drag cursor positioning.
 * Only visible when video is paused.
 * Automatically creates/updates x/y keyframes at current frame.
 */
export const CursorPositioningOverlay: React.FC<
  CursorPositioningOverlayProps
> = ({
  compositionWidth,
  compositionHeight,
  currentFrame,
  fps,
  tracks,
  onUpdateTrack,
  isPlaying,
}) => {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const cursorTrack = tracks.find((t) => t.id === "cursor");
  const cameraTrack = tracks.find((t) => t.id === "camera");

  // Get current camera transform values to adjust cursor coordinates
  const getCameraTransform = useCallback(() => {
    if (!cameraTrack) {
      return { translateX: 0, translateY: 0, scale: 1 };
    }
    return {
      translateX: getPropValueKeyframed(
        currentFrame,
        fps,
        cameraTrack,
        "translateX",
        0,
      ),
      translateY: getPropValueKeyframed(
        currentFrame,
        fps,
        cameraTrack,
        "translateY",
        0,
      ),
      scale: getPropValueKeyframed(currentFrame, fps, cameraTrack, "scale", 1),
    };
  }, [cameraTrack, currentFrame, fps]);

  const updateCursorPosition = useCallback(
    (x: number, y: number) => {
      if (!cursorTrack) return;

      // Get camera transforms
      const camera = getCameraTransform();

      // Convert screen coordinates to composition coordinates accounting for camera
      // Formula: (screenPos - translate) / scale
      // Also account for composition center offset
      const centerX = compositionWidth / 2;
      const centerY = compositionHeight / 2;

      const adjustedX =
        (x - centerX - camera.translateX) / camera.scale + centerX;
      const adjustedY =
        (y - centerY - camera.translateY) / camera.scale + centerY;

      // Clamp to composition bounds
      const clampedX = Math.max(0, Math.min(compositionWidth, adjustedX));
      const clampedY = Math.max(0, Math.min(compositionHeight, adjustedY));

      // Find x and y properties
      const xProp = cursorTrack.animatedProps?.find((p) => p.property === "x");
      const yProp = cursorTrack.animatedProps?.find((p) => p.property === "y");

      if (!xProp || !yProp) return;

      // Update or create keyframes
      const updateKeyframes = (keyframes: any[] = [], value: string) => {
        const existingIdx = keyframes.findIndex(
          (kf) => kf.frame === currentFrame,
        );
        if (existingIdx >= 0) {
          return keyframes.map((kf, i) =>
            i === existingIdx ? { ...kf, value } : kf,
          );
        }
        return [
          ...keyframes,
          { frame: currentFrame, value, easing: "expo.inOut" },
        ];
      };

      const newXKeyframes = updateKeyframes(
        xProp.keyframes,
        clampedX.toString(),
      );
      const newYKeyframes = updateKeyframes(
        yProp.keyframes,
        clampedY.toString(),
      );

      const updatedProps = cursorTrack.animatedProps?.map((p) => {
        if (p.property === "x") return { ...p, keyframes: newXKeyframes };
        if (p.property === "y") return { ...p, keyframes: newYKeyframes };
        return p;
      });

      onUpdateTrack("cursor", { animatedProps: updatedProps });
    },
    [
      cursorTrack,
      currentFrame,
      compositionWidth,
      compositionHeight,
      onUpdateTrack,
      getCameraTransform,
    ],
  );

  /**
   * Convert mouse event to composition coordinates, accounting for:
   * 1. Player aspect ratio and letterboxing/pillarboxing
   * 2. Actual rendered size vs overlay size
   */
  const getCompositionCoordinates = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!overlayRef.current) return { x: 0, y: 0 };

      const rect = overlayRef.current.getBoundingClientRect();
      const compositionAspect = compositionWidth / compositionHeight;
      const containerAspect = rect.width / rect.height;

      let renderWidth: number;
      let renderHeight: number;
      let offsetX = 0;
      let offsetY = 0;

      if (containerAspect > compositionAspect) {
        // Container is wider - pillarboxing (black bars on sides)
        renderHeight = rect.height;
        renderWidth = renderHeight * compositionAspect;
        offsetX = (rect.width - renderWidth) / 2;
      } else {
        // Container is taller - letterboxing (black bars on top/bottom)
        renderWidth = rect.width;
        renderHeight = renderWidth / compositionAspect;
        offsetY = (rect.height - renderHeight) / 2;
      }

      // Convert mouse position to composition coordinates
      const mouseX = e.clientX - rect.left - offsetX;
      const mouseY = e.clientY - rect.top - offsetY;

      const x = (mouseX / renderWidth) * compositionWidth;
      const y = (mouseY / renderHeight) * compositionHeight;

      return { x, y };
    },
    [compositionWidth, compositionHeight],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!cursorTrack) return;

      const { x, y } = getCompositionCoordinates(e);
      updateCursorPosition(x, y);
      setIsDragging(true);
    },
    [cursorTrack, getCompositionCoordinates, updateCursorPosition],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isDragging) return;

      const { x, y } = getCompositionCoordinates(e);
      updateCursorPosition(x, y);
    },
    [isDragging, getCompositionCoordinates, updateCursorPosition],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Don't show overlay during playback or if no cursor track exists
  if (isPlaying || !cursorTrack) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          ref={overlayRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 56, // Exclude control bar at bottom
            cursor: isDragging ? "grabbing" : "crosshair",
            zIndex: 10,
            pointerEvents: isPlaying ? "none" : "auto",
          }}
        >
          {/* Invisible overlay for click-and-drag */}
        </div>
      </TooltipTrigger>
      <TooltipContent>Click and drag to position cursor</TooltipContent>
    </Tooltip>
  );
};
