import React, { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { Camera, Move, ZoomIn, RotateCw, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnimationTrack } from "@/types";
import { getPropValueKeyframed } from "@/remotion/trackAnimation";

interface CameraToolbarProps {
  currentFrame: number;
  fps: number;
  tracks: AnimationTrack[];
  onUpdateTrack: (id: string, patch: Partial<AnimationTrack>) => void;
  onAddTrack?: (track: AnimationTrack) => void;
  durationInFrames?: number;
  videoContainerRef?: React.RefObject<HTMLDivElement>;
}

type CameraTool = "none" | "pan" | "zoom" | "tilt";

// Helper function to create a default camera track
const createDefaultCameraTrack = (durationInFrames: number): AnimationTrack => ({
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
    { property: "perspective", from: "800", to: "800", unit: "px", keyframes: [] },
  ],
});

export const CameraToolbar: React.FC<CameraToolbarProps> = ({
  currentFrame,
  fps,
  tracks,
  onUpdateTrack,
  onAddTrack,
  durationInFrames = 240,
  videoContainerRef,
}) => {
  // Allow unlimited zoom - high max for flexibility
  const maxZoom = 10;
  const [activeTool, setActiveTool] = useState<CameraTool>("none");
  const [isDragging, setIsDragging] = useState(false);
  const [showCrosshair, setShowCrosshair] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; values: Record<string, number> }>({
    x: 0,
    y: 0,
    values: {}
  });
  const lockPositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const cameraTrack = tracks.find((t) => t.id === "camera");

  // Ensure camera track exists before performing operations
  const ensureCameraTrack = useCallback(() => {
    if (!cameraTrack && onAddTrack) {
      const newTrack = createDefaultCameraTrack(durationInFrames);
      onAddTrack(newTrack);
      return newTrack;
    }
    return cameraTrack;
  }, [cameraTrack, onAddTrack, durationInFrames]);

  const getCurrentCameraValue = (property: string, defaultValue: number): number => {
    if (!cameraTrack) return defaultValue;
    return getPropValueKeyframed(currentFrame, fps, cameraTrack, property, defaultValue);
  };

  const updateCameraProperties = useCallback((updates: Record<string, number>) => {
    // Ensure camera track exists (will create if deleted)
    const track = ensureCameraTrack();
    if (!track) return;

    // Get ALL current camera values (even ones not being updated)
    // This ensures each keyframe is a complete snapshot
    const allCurrentValues: Record<string, number> = {
      translateX: getPropValueKeyframed(currentFrame, fps, track, "translateX", 0),
      translateY: getPropValueKeyframed(currentFrame, fps, track, "translateY", 0),
      scale: getPropValueKeyframed(currentFrame, fps, track, "scale", 1),
      rotateX: getPropValueKeyframed(currentFrame, fps, track, "rotateX", 0),
      rotateY: getPropValueKeyframed(currentFrame, fps, track, "rotateY", 0),
      perspective: getPropValueKeyframed(currentFrame, fps, track, "perspective", 800),
      ...updates, // Override with the values being changed
    };

    const updatedProps = track.animatedProps?.map((prop) => {
      const newValue = allCurrentValues[prop.property];

      // Validate value
      if (!Number.isFinite(newValue)) return prop;

      const valueStr = String(newValue);

      if (!prop.keyframes) {
        return {
          ...prop,
          keyframes: [{ frame: currentFrame, value: valueStr, easing: "expo.inOut" }],
        };
      }

      const existingIndex = prop.keyframes.findIndex((kf) => kf.frame === currentFrame);

      if (existingIndex >= 0) {
        const newKeyframes = [...prop.keyframes];
        newKeyframes[existingIndex] = { ...newKeyframes[existingIndex], frame: currentFrame, value: valueStr };
        return { ...prop, keyframes: newKeyframes };
      } else {
        const newKeyframes = [...prop.keyframes, { frame: currentFrame, value: valueStr, easing: "expo.inOut" }];
        newKeyframes.sort((a, b) => a.frame - b.frame);
        return { ...prop, keyframes: newKeyframes };
      }
    });

    onUpdateTrack("camera", { animatedProps: updatedProps });
  }, [ensureCameraTrack, currentFrame, fps, onUpdateTrack]);

  // Add keyframe at current frame with current camera state
  const addKeyframe = () => {
    // Ensure camera track exists (will create if deleted)
    const track = ensureCameraTrack();
    if (!track) return;

    // Get all current camera values at this frame
    const currentValues: Record<string, number> = {
      translateX: getCurrentCameraValue("translateX", 0),
      translateY: getCurrentCameraValue("translateY", 0),
      scale: getCurrentCameraValue("scale", 1),
      rotateX: getCurrentCameraValue("rotateX", 0),
      rotateY: getCurrentCameraValue("rotateY", 0),
      perspective: getCurrentCameraValue("perspective", 800),
    };

    // Create or update keyframes for all camera properties
    updateCameraProperties(currentValues);
  };

  const handleMouseDown = (e: React.MouseEvent, tool: CameraTool) => {
    e.preventDefault();
    setActiveTool(tool);
    setIsDragging(true);
    setShowCrosshair(true);

    // Request pointer lock on video container to truly lock cursor
    if (videoContainerRef?.current) {
      videoContainerRef.current.requestPointerLock();
    }

    // Capture starting values
    const startValues: Record<string, number> = {
      translateX: getCurrentCameraValue("translateX", 0),
      translateY: getCurrentCameraValue("translateY", 0),
      scale: getCurrentCameraValue("scale", 1),
      rotateX: getCurrentCameraValue("rotateX", 0),
      rotateY: getCurrentCameraValue("rotateY", 0),
    };

    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      values: startValues,
    };
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || activeTool === "none") return;

    // Use movementX/Y for smooth delta tracking regardless of cursor position
    const deltaX = e.movementX;
    const deltaY = e.movementY;

    switch (activeTool) {
      case "pan": {
        // Pan: cursor movement directly controls camera position
        const newX = dragStartRef.current.values.translateX + deltaX;
        const newY = dragStartRef.current.values.translateY + deltaY;
        dragStartRef.current.values.translateX = newX;
        dragStartRef.current.values.translateY = newY;
        updateCameraProperties({
          translateX: newX,
          translateY: newY,
        });
        break;
      }

      case "zoom": {
        // Zoom: vertical movement controls scale (up = zoom in, down = zoom out)
        // Higher sensitivity for easier control
        const zoomSensitivity = 0.015;
        const zoomDelta = -deltaY * zoomSensitivity;
        const newScale = Math.max(0.1, Math.min(maxZoom, dragStartRef.current.values.scale + zoomDelta));
        dragStartRef.current.values.scale = newScale;
        updateCameraProperties({ scale: newScale });
        break;
      }

      case "tilt": {
        // Tilt: horizontal = rotateY, vertical = rotateX
        const tiltSensitivity = 0.3;
        const newRotateY = dragStartRef.current.values.rotateY + deltaX * tiltSensitivity;
        const newRotateX = dragStartRef.current.values.rotateX + deltaY * tiltSensitivity;
        const clampedRotateY = Math.max(-90, Math.min(90, newRotateY));
        const clampedRotateX = Math.max(-90, Math.min(90, newRotateX));
        dragStartRef.current.values.rotateY = clampedRotateY;
        dragStartRef.current.values.rotateX = clampedRotateX;
        updateCameraProperties({
          rotateY: clampedRotateY,
          rotateX: clampedRotateX,
        });
        break;
      }
    }
  }, [isDragging, activeTool, updateCameraProperties, maxZoom]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setActiveTool("none");
    setShowCrosshair(false);

    // Exit pointer lock
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
  }, []);

  // Register global mouse handlers
  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const tools = [
    { id: "pan" as const, icon: Move, label: "Pan", hint: "Click and drag to move camera" },
    { id: "zoom" as const, icon: ZoomIn, label: "Zoom", hint: "Drag up/down to zoom" },
    { id: "tilt" as const, icon: RotateCw, label: "Tilt", hint: "Drag to rotate 3D" },
  ];

  return (
    <>
      <div className="flex items-center gap-1 px-2 py-1 bg-card/40 border border-border rounded-lg">
        <Camera className="w-3.5 h-3.5 text-blue-400" />

        {tools.map((tool) => {
          const Icon = tool.icon;
          const isActive = activeTool === tool.id;

          return (
            <button
              key={tool.id}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded transition-all text-[11px] font-medium select-none",
                isActive
                  ? "bg-blue-500 text-white shadow-md"
                  : "bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground"
              )}
              onMouseDown={(e) => handleMouseDown(e, tool.id)}
              title={tool.hint}
            >
              <Icon className="w-3 h-3" />
              <span>{tool.label}</span>
            </button>
          );
        })}

        {/* Add Keyframe button */}
        <div className="h-3.5 w-px bg-border mx-0.5" />
        <button
          onClick={addKeyframe}
          className="flex items-center gap-1 px-2 py-1 rounded transition-all text-[11px] font-medium bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30"
          title="Create camera keyframe at current frame"
        >
          <Plus className="w-3 h-3" />
          <span>Add Keyframe</span>
        </button>

        {isDragging && (
          <div className="ml-2 text-[11px] text-blue-400 font-mono animate-pulse">
            Adjusting...
          </div>
        )}
      </div>

      {/* Crosshair overlay when dragging - only over video area, excluding control bar */}
      {showCrosshair && videoContainerRef?.current && createPortal(
        <div
          className="absolute pointer-events-none z-[100]"
          style={{
            top: 0,
            left: 0,
            right: 0,
            bottom: 56, // Exclude control bar at bottom
            cursor: "none",
          }}
        >
          {/* Crosshair lines */}
          <div
            className="absolute left-0 right-0 h-px bg-blue-400/30"
            style={{ top: "50%" }}
          />
          <div
            className="absolute top-0 bottom-0 w-px bg-blue-400/30"
            style={{ left: "50%" }}
          />

          {/* Center circle */}
          <div
            className="absolute w-8 h-8 border-2 border-blue-400/30 rounded-full"
            style={{
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
            }}
          />
        </div>,
        videoContainerRef.current
      )}
    </>
  );
};
