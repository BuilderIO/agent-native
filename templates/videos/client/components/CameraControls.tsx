import { useEffect, useState, useCallback } from "react";
import type { AnimationTrack, EasingKey } from "@/types";
import { getPropValueKeyframed } from "@/remotion/trackAnimation";
import { ArrowLeftRight, ArrowUpDown, RotateCw, ZoomIn, Eye } from "lucide-react";
import { Label } from "./ui/label";
import { MotionCurveSelect } from "./MotionCurveSelect";
import { KeyframeNavigation } from "./keyframes/KeyframeNavigation";
import { KeyframeActionButtons } from "./keyframes/KeyframeActionButtons";
import {
  getAllKeyframeFrames,
  isFrameOnKeyframe,
  duplicateKeyframeForTrack,
  removeKeyframeForTrack,
  updateKeyframeEasing as updateKeyframeEasingUtil,
  getCurrentKeyframeEasing as getCurrentKeyframeEasingUtil,
  updateCameraKeyframe,
  resetToDefaults,
} from "@/utils/keyframeUtils";

interface CameraControlsProps {
  currentFrame: number;
  fps: number;
  tracks: AnimationTrack[];
  onUpdateTrack: (id: string, patch: Partial<AnimationTrack>) => void;
  onAddTrack?: (track: AnimationTrack) => void;
  onSeek?: (frame: number) => void;
  durationInFrames?: number;
}

interface CameraState {
  translateX: number;
  translateY: number;
  scale: number;
  rotateX: number;
  rotateY: number;
  perspective: number;
}

const DEFAULT_CAMERA: CameraState = {
  translateX: 0,
  translateY: 0,
  scale: 1,
  rotateX: 0,
  rotateY: 0,
  perspective: 800,
};

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

export const CameraControls: React.FC<CameraControlsProps> = ({
  currentFrame,
  fps,
  tracks,
  onUpdateTrack,
  onAddTrack,
  onSeek,
  durationInFrames = 240,
}) => {
  // Allow unlimited zoom - high max for flexibility
  const maxZoom = 10;
  const [localState, setLocalState] = useState<CameraState>(DEFAULT_CAMERA);
  const [isOnKeyframe, setIsOnKeyframe] = useState(false);
  const [keyframeCount, setKeyframeCount] = useState(0);

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

  // Sync local state with track values when playhead moves
  useEffect(() => {
    if (!cameraTrack) {
      setLocalState(DEFAULT_CAMERA);
      return;
    }

    const newState: CameraState = {
      translateX: getPropValueKeyframed(currentFrame, fps, cameraTrack, "translateX", 0),
      translateY: getPropValueKeyframed(currentFrame, fps, cameraTrack, "translateY", 0),
      scale: getPropValueKeyframed(currentFrame, fps, cameraTrack, "scale", 1),
      rotateX: getPropValueKeyframed(currentFrame, fps, cameraTrack, "rotateX", 0),
      rotateY: getPropValueKeyframed(currentFrame, fps, cameraTrack, "rotateY", 0),
      perspective: getPropValueKeyframed(currentFrame, fps, cameraTrack, "perspective", 800),
    };

    // Validate all values are finite before setting state
    const allValuesValid = Object.values(newState).every(v => Number.isFinite(v));
    if (allValuesValid) {
      setLocalState(newState);
    } else {
      console.warn("Camera: Received invalid values from track, skipping update", newState);
    }

    // Check if current frame is on a keyframe
    const onKeyframe = isFrameOnKeyframe(cameraTrack, currentFrame);
    const allFrames = getAllKeyframeFrames(cameraTrack);

    setIsOnKeyframe(onKeyframe);
    setKeyframeCount(allFrames.length);
  }, [currentFrame, fps, cameraTrack]);

  const updateLocalProperty = (property: keyof CameraState, value: number) => {
    // Safety check: ensure value is finite
    if (!Number.isFinite(value)) {
      console.warn(`Camera: Invalid value for ${property}:`, value);
      return;
    }

    setLocalState((prev) => ({ ...prev, [property]: value }));

    // Ensure camera track exists (will create if deleted)
    const track = ensureCameraTrack();
    if (!track) return;

    // Get ALL current camera values at this frame to create a complete snapshot
    const allCurrentValues: Record<string, number> = {
      translateX: getPropValueKeyframed(currentFrame, fps, track, "translateX", 0),
      translateY: getPropValueKeyframed(currentFrame, fps, track, "translateY", 0),
      scale: getPropValueKeyframed(currentFrame, fps, track, "scale", 1),
      rotateX: getPropValueKeyframed(currentFrame, fps, track, "rotateX", 0),
      rotateY: getPropValueKeyframed(currentFrame, fps, track, "rotateY", 0),
      perspective: getPropValueKeyframed(currentFrame, fps, track, "perspective", 800),
      [property]: value, // Override with the new value being set
    };

    const updatedProps = updateCameraKeyframe(track, currentFrame, allCurrentValues);
    onUpdateTrack("camera", { animatedProps: updatedProps });
  };

  const removeKeyframe = () => {
    if (!cameraTrack || !isOnKeyframe) return;

    const updatedProps = removeKeyframeForTrack(cameraTrack, currentFrame);
    onUpdateTrack("camera", { animatedProps: updatedProps });
  };


  const handleResetToDefaults = () => {
    if (!cameraTrack) return;

    const resetProps = resetToDefaults(cameraTrack, currentFrame, DEFAULT_CAMERA);
    onUpdateTrack("camera", { animatedProps: resetProps });
    setLocalState(DEFAULT_CAMERA);
  };

  const handleUpdateKeyframeEasing = (easing: EasingKey) => {
    if (!cameraTrack || !isOnKeyframe) return;

    const updatedProps = updateKeyframeEasingUtil(cameraTrack, currentFrame, easing);
    onUpdateTrack("camera", { animatedProps: updatedProps });
  };

  const handleGetCurrentKeyframeEasing = (): EasingKey => {
    if (!cameraTrack) return "linear";
    return getCurrentKeyframeEasingUtil(cameraTrack, currentFrame, "linear");
  };

  const handleDuplicateKeyframe = () => {
    if (!cameraTrack || !isOnKeyframe) return;

    const targetFrame = currentFrame + 30;
    const updatedProps = duplicateKeyframeForTrack(cameraTrack, currentFrame, 30);
    onUpdateTrack("camera", { animatedProps: updatedProps });

    // Seek to the newly created/updated keyframe
    if (onSeek) {
      onSeek(targetFrame);
    }
  };

  if (!cameraTrack) return null;

  return (
    <div className="space-y-4 p-4 border-t">
      {/* Keyframe status message */}
      {!isOnKeyframe && (
        <div className="text-center py-6 px-4 bg-muted/30 rounded-lg border border-dashed border-border animate-in fade-in slide-in-from-top-2 duration-200">
          <p className="text-xs text-muted-foreground">No keyframe selected</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Use the camera toolbar above the video to create keyframes
          </p>
        </div>
      )}

      {/* Only show controls when on a keyframe */}
      {isOnKeyframe && (
        <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Keyframe Navigation */}
          <KeyframeNavigation
            currentFrame={currentFrame}
            allKeyframes={getAllKeyframeFrames(cameraTrack)}
            onSeek={onSeek || (() => {})}
            disabled={!onSeek}
          />

          {/* Compact grid layout */}
          <div className="grid grid-cols-2 gap-3">
            {/* Pan X */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <ArrowLeftRight className="w-3 h-3" />
                Pan X
              </Label>
              <input
                type="number"
                value={localState.translateX.toFixed(0)}
                onChange={(e) => updateLocalProperty("translateX", parseFloat(e.target.value) || 0)}
                className="w-full text-xs bg-secondary border border-border rounded-lg px-2.5 py-1.5 text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-blue-400/40"
              />
            </div>

            {/* Pan Y */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <ArrowUpDown className="w-3 h-3" />
                Pan Y
              </Label>
              <input
                type="number"
                value={localState.translateY.toFixed(0)}
                onChange={(e) => updateLocalProperty("translateY", parseFloat(e.target.value) || 0)}
                className="w-full text-xs bg-secondary border border-border rounded-lg px-2.5 py-1.5 text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-blue-400/40"
              />
            </div>

            {/* Tilt X */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <RotateCw className="w-3 h-3" />
                Tilt X
              </Label>
              <input
                type="number"
                value={localState.rotateX.toFixed(0)}
                onChange={(e) => updateLocalProperty("rotateX", parseFloat(e.target.value) || 0)}
                className="w-full text-xs bg-secondary border border-border rounded-lg px-2.5 py-1.5 text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-blue-400/40"
              />
            </div>

            {/* Tilt Y */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <RotateCw className="w-3 h-3" style={{ transform: 'rotate(90deg)' }} />
                Tilt Y
              </Label>
              <input
                type="number"
                value={localState.rotateY.toFixed(0)}
                onChange={(e) => updateLocalProperty("rotateY", parseFloat(e.target.value) || 0)}
                className="w-full text-xs bg-secondary border border-border rounded-lg px-2.5 py-1.5 text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-blue-400/40"
              />
            </div>

            {/* Zoom */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <ZoomIn className="w-3 h-3" />
                Zoom
              </Label>
              <input
                type="number"
                step="0.1"
                value={localState.scale.toFixed(1)}
                onChange={(e) => updateLocalProperty("scale", parseFloat(e.target.value) || 1)}
                className="w-full text-xs bg-secondary border border-border rounded-lg px-2.5 py-1.5 text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-blue-400/40"
              />
            </div>

            {/* Perspective */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Eye className="w-3 h-3" />
                Perspective
              </Label>
              <input
                type="number"
                step="50"
                value={localState.perspective.toFixed(0)}
                onChange={(e) => updateLocalProperty("perspective", parseFloat(e.target.value) || 800)}
                className="w-full text-xs bg-secondary border border-border rounded-lg px-2.5 py-1.5 text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-blue-400/40"
              />
            </div>
          </div>

          {/* Motion Curve Control */}
          <MotionCurveSelect
            value={handleGetCurrentKeyframeEasing()}
            onChange={handleUpdateKeyframeEasing}
            accentColor="blue-400"
          />

          {/* Keyframe Actions */}
          <KeyframeActionButtons
            isOnKeyframe={isOnKeyframe}
            onDuplicate={handleDuplicateKeyframe}
            onReset={handleResetToDefaults}
            onRemove={removeKeyframe}
            resetTooltip="Reset camera to default view for this keyframe"
          />
        </div>
      )}
    </div>
  );
};
