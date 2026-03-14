import { useEffect, useState, useMemo } from "react";
import type { AnimationTrack, EasingKey } from "@/types";
import { getPropValueKeyframed } from "@/remotion/trackAnimation";
import {
  Mouse,
  Plus,
  Eye,
  EyeOff,
  MousePointerClick,
  AlertCircle,
} from "lucide-react";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import {
  DefaultCursor,
  PointerCursor,
  TextCursor,
} from "@/remotion/ui-components/Cursor";
import { MotionCurveSelect } from "./MotionCurveSelect";
import { KeyframeNavigation } from "./keyframes/KeyframeNavigation";
import { KeyframeActionButtons } from "./keyframes/KeyframeActionButtons";
import { useCurrentElement } from "@/contexts/CurrentElementContext";
import {
  getAllKeyframeFrames,
  isFrameOnKeyframe,
  duplicateKeyframeForTrack,
  removeKeyframeForTrack,
  updateKeyframeEasing as updateKeyframeEasingUtil,
  getCurrentKeyframeEasing as getCurrentKeyframeEasingUtil,
  setOrUpdateKeyframe as setOrUpdateKeyframeUtil,
} from "@/utils/keyframeUtils";

interface CursorControlsProps {
  currentFrame: number;
  fps: number;
  tracks: AnimationTrack[];
  onUpdateTrack: (id: string, patch: Partial<AnimationTrack>) => void;
  onAddTrack: (track: AnimationTrack) => void;
  onSeek?: (frame: number) => void;
  durationInFrames?: number;
  compositionWidth?: number;
  compositionHeight?: number;
  compositionId?: string;
}

interface CursorState {
  x: number;
  y: number;
  opacity: number;
  scale: number;
  type: string;
}

const DEFAULT_CURSOR: CursorState = {
  x: 960,
  y: 540,
  opacity: 1,
  scale: 1,
  type: "default",
};

export const CursorControls: React.FC<CursorControlsProps> = ({
  currentFrame,
  fps,
  tracks,
  onUpdateTrack,
  onAddTrack,
  onSeek,
  durationInFrames = 240,
  compositionWidth = 1920,
  compositionHeight = 1080,
  compositionId,
}) => {
  const [localState, setLocalState] = useState<CursorState>(DEFAULT_CURSOR);
  const [isOnKeyframe, setIsOnKeyframe] = useState(false);

  const cursorTrack = tracks.find((t) => t.id === "cursor");
  const { elementAnimations } = useCurrentElement();

  // Check if there are any cursor interactions (hover/click animations) for this composition
  // If there are, the cursor type should be controlled by hover zones, not manual keyframes
  const hasCursorInteractions = useMemo(() => {
    if (!compositionId || !elementAnimations) return false;
    const animations = elementAnimations[compositionId] || [];
    return animations.length > 0;
  }, [compositionId, elementAnimations]);

  // Sync local state with track values when playhead moves
  useEffect(() => {
    if (!cursorTrack) {
      setLocalState(DEFAULT_CURSOR);
      setIsOnKeyframe(false);
      return;
    }

    // Get cursor type (stepped, not interpolated)
    const typeProp = cursorTrack.animatedProps?.find(
      (p) => p.property === "type",
    );
    let cursorType = "default";
    if (typeProp?.keyframes && typeProp.keyframes.length > 0) {
      const sorted = [...typeProp.keyframes].sort((a, b) => a.frame - b.frame);
      for (const kf of sorted) {
        if (currentFrame >= kf.frame) {
          cursorType = kf.value;
        } else {
          break;
        }
      }
    } else if (typeProp?.from) {
      cursorType = typeProp.from;
    }

    const newState: CursorState = {
      x: getPropValueKeyframed(currentFrame, fps, cursorTrack, "x", 960),
      y: getPropValueKeyframed(currentFrame, fps, cursorTrack, "y", 540),
      opacity: getPropValueKeyframed(
        currentFrame,
        fps,
        cursorTrack,
        "opacity",
        1,
      ),
      scale: getPropValueKeyframed(currentFrame, fps, cursorTrack, "scale", 1),
      type: cursorType,
    };

    const allValuesValid =
      Number.isFinite(newState.x) &&
      Number.isFinite(newState.y) &&
      Number.isFinite(newState.opacity) &&
      Number.isFinite(newState.scale);

    if (allValuesValid) {
      setLocalState(newState);
    }

    // Check if current frame is on a keyframe
    const onKeyframe = isFrameOnKeyframe(cursorTrack, currentFrame);
    setIsOnKeyframe(onKeyframe);
  }, [currentFrame, fps, cursorTrack]);

  const addCursorTrack = () => {
    // Calculate center position based on composition dimensions
    const centerX = Math.round(compositionWidth / 2);
    const centerY = Math.round(compositionHeight / 2);

    const newCursorTrack: AnimationTrack = {
      id: "cursor",
      label: "Cursor",
      startFrame: 0,
      endFrame: durationInFrames,
      easing: "expo.inOut",
      animatedProps: [
        {
          property: "x",
          from: centerX.toString(),
          to: centerX.toString(),
          unit: "px",
          keyframes: [
            {
              frame: currentFrame,
              value: centerX.toString(),
              easing: "expo.inOut",
            },
          ],
        },
        {
          property: "y",
          from: centerY.toString(),
          to: centerY.toString(),
          unit: "px",
          keyframes: [
            {
              frame: currentFrame,
              value: centerY.toString(),
              easing: "expo.inOut",
            },
          ],
        },
        {
          property: "opacity",
          from: "1",
          to: "1",
          unit: "",
          keyframes: [
            { frame: currentFrame, value: "1", easing: "expo.inOut" },
          ],
        },
        {
          property: "scale",
          from: "1",
          to: "1",
          unit: "",
          keyframes: [
            { frame: currentFrame, value: "1", easing: "expo.inOut" },
          ],
        },
        {
          property: "type",
          from: "default",
          to: "default",
          unit: "",
          keyframes: [], // No initial keyframe - allows autoType to work
        },
        {
          property: "isClicking",
          from: "0",
          to: "0",
          unit: "",
          keyframes: [],
        },
      ],
    };

    onAddTrack(newCursorTrack);
  };

  const setOrUpdateKeyframe = (property: string, value: string) => {
    if (!cursorTrack) return;

    // Handle string properties (like cursor type) differently from numeric properties
    if (property === "type" || property === "isClicking") {
      // For string properties, directly update the keyframe without parseFloat
      const updatedProps = cursorTrack.animatedProps?.map((prop) => {
        if (prop.property !== property) return prop;

        const keyframes = prop.keyframes || [];
        const existingIdx = keyframes.findIndex(
          (kf) => kf.frame === currentFrame,
        );

        let newKeyframes;
        if (existingIdx >= 0) {
          // Update existing keyframe
          newKeyframes = keyframes.map((kf, i) =>
            i === existingIdx ? { ...kf, value } : kf,
          );
        } else {
          // Add new keyframe
          newKeyframes = [
            ...keyframes,
            { frame: currentFrame, value, easing: "expo.inOut" },
          ];
          newKeyframes.sort((a, b) => a.frame - b.frame);
        }

        return { ...prop, keyframes: newKeyframes };
      });
      onUpdateTrack("cursor", { animatedProps: updatedProps });
    } else {
      // For numeric properties, use the existing utility
      const numericValue = parseFloat(value);
      const updatedProps = setOrUpdateKeyframeUtil(
        cursorTrack,
        property,
        currentFrame,
        numericValue,
      );
      onUpdateTrack("cursor", { animatedProps: updatedProps });
    }
  };

  const removeKeyframe = () => {
    if (!cursorTrack) return;

    const updatedProps = removeKeyframeForTrack(
      cursorTrack,
      currentFrame,
      true,
    );
    onUpdateTrack("cursor", { animatedProps: updatedProps });
  };

  const resetAll = () => {
    if (!cursorTrack) return;

    const updatedProps = cursorTrack.animatedProps?.map((prop) => ({
      ...prop,
      keyframes: [],
    }));

    onUpdateTrack("cursor", { animatedProps: updatedProps });
  };

  const toggleClick = () => {
    if (!cursorTrack) return;

    const clickProp = cursorTrack.animatedProps?.find(
      (p) => p.property === "isClicking",
    );
    if (!clickProp) return;

    const keyframes = clickProp.keyframes || [];
    const existingIdx = keyframes.findIndex((kf) => kf.frame === currentFrame);

    let newKeyframes;
    if (existingIdx >= 0) {
      // Remove this click keyframe
      newKeyframes = keyframes.filter((kf) => kf.frame !== currentFrame);
    } else {
      // Add a single click keyframe at current frame
      // Value "1" marks "click happens here"
      const clickKeyframe = { frame: currentFrame, value: "1" };
      newKeyframes = [...keyframes, clickKeyframe].sort(
        (a, b) => a.frame - b.frame,
      );

      // IMPORTANT: Also ensure cursor position is keyframed at this frame
      // so the click happens at the exact position shown in the UI
      setOrUpdateKeyframe("x", localState.x.toString());
      setOrUpdateKeyframe("y", localState.y.toString());
    }

    const updatedProps = cursorTrack.animatedProps?.map((p) =>
      p.property === "isClicking" ? { ...p, keyframes: newKeyframes } : p,
    );

    onUpdateTrack("cursor", { animatedProps: updatedProps });
  };

  const isClickingAtFrame = () => {
    if (!cursorTrack) return false;
    const clickProp = cursorTrack.animatedProps?.find(
      (p) => p.property === "isClicking",
    );
    return (
      clickProp?.keyframes?.some((kf) => kf.frame === currentFrame) || false
    );
  };

  const handleDuplicateKeyframe = () => {
    if (!cursorTrack || !isOnKeyframe) return;

    const targetFrame = currentFrame + 30;
    const updatedProps = duplicateKeyframeForTrack(
      cursorTrack,
      currentFrame,
      30,
    );
    onUpdateTrack("cursor", { animatedProps: updatedProps });

    // Seek to the newly created/updated keyframe
    if (onSeek) {
      onSeek(targetFrame);
    }
  };

  const handleUpdateKeyframeEasing = (easing: EasingKey) => {
    if (!cursorTrack || !isOnKeyframe) return;

    const updatedProps = updateKeyframeEasingUtil(
      cursorTrack,
      currentFrame,
      easing,
    );
    onUpdateTrack("cursor", { animatedProps: updatedProps });
  };

  const handleGetCurrentKeyframeEasing = (): EasingKey => {
    if (!cursorTrack) return "expo.inOut";
    return getCurrentKeyframeEasingUtil(
      cursorTrack,
      currentFrame,
      "expo.inOut",
    );
  };

  if (!cursorTrack) {
    return (
      <div className="space-y-3 p-4 text-center">
        <Mouse className="h-8 w-8 mx-auto opacity-50 text-purple-400" />
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground/80">
            Add animated cursor
          </p>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Animate a cursor overlay for tutorials, demos, and screen recordings
          </p>
        </div>
        <Button
          size="sm"
          onClick={addCursorTrack}
          className="w-full bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/30"
        >
          <Plus className="h-3 w-3 mr-1" />
          Cursor Animation
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      {/* Keyframe Navigation */}
      <KeyframeNavigation
        currentFrame={currentFrame}
        allKeyframes={getAllKeyframeFrames(cursorTrack)}
        onSeek={onSeek || (() => {})}
        disabled={!onSeek}
      />

      {/* Click Animation */}
      <Button
        variant="outline"
        size="sm"
        onClick={toggleClick}
        className={`w-full text-xs gap-1.5 ${
          isClickingAtFrame()
            ? "bg-purple-500/20 text-purple-400 border-purple-500/30"
            : ""
        }`}
        title={isClickingAtFrame() ? "Click ON" : "Add Click"}
      >
        <MousePointerClick className="h-3 w-3" />
        Play click
      </Button>

      {/* Position Controls */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Position</Label>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] text-muted-foreground">X (px)</Label>
            <Input
              type="number"
              value={Math.round(localState.x)}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (Number.isFinite(val)) {
                  setLocalState((prev) => ({ ...prev, x: val }));
                  setOrUpdateKeyframe("x", val.toString());
                }
              }}
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Y (px)</Label>
            <Input
              type="number"
              value={Math.round(localState.y)}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (Number.isFinite(val)) {
                  setLocalState((prev) => ({ ...prev, y: val }));
                  setOrUpdateKeyframe("y", val.toString());
                }
              }}
              className="h-7 text-xs"
            />
          </div>
        </div>
      </div>

      {/* Cursor Type - Only show when no cursor interactions */}
      {!hasCursorInteractions && (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Cursor Type</Label>
          <div className="grid grid-cols-3 gap-2">
            {/* Default Arrow */}
            <button
              onClick={() => {
                setLocalState((prev) => ({ ...prev, type: "default" }));
                setOrUpdateKeyframe("type", "default");
              }}
              className={`h-12 rounded-lg border-2 transition-all flex items-center justify-center ${
                localState.type === "default"
                  ? "border-purple-500 bg-purple-500/10"
                  : "border-border bg-secondary/50 hover:bg-secondary"
              }`}
              title="Arrow (Default)"
            >
              <div
                style={{ transform: "scale(0.5)", transformOrigin: "center" }}
              >
                <DefaultCursor />
              </div>
            </button>

            {/* Pointer Hand */}
            <button
              onClick={() => {
                setLocalState((prev) => ({ ...prev, type: "pointer" }));
                setOrUpdateKeyframe("type", "pointer");
              }}
              className={`h-12 rounded-lg border-2 transition-all flex items-center justify-center ${
                localState.type === "pointer"
                  ? "border-purple-500 bg-purple-500/10"
                  : "border-border bg-secondary/50 hover:bg-secondary"
              }`}
              title="Pointer (Hand)"
            >
              <div
                style={{ transform: "scale(0.5)", transformOrigin: "center" }}
              >
                <PointerCursor />
              </div>
            </button>

            {/* Text I-Beam */}
            <button
              onClick={() => {
                setLocalState((prev) => ({ ...prev, type: "text" }));
                setOrUpdateKeyframe("type", "text");
              }}
              className={`h-12 rounded-lg border-2 transition-all flex items-center justify-center ${
                localState.type === "text"
                  ? "border-purple-500 bg-purple-500/10"
                  : "border-border bg-secondary/50 hover:bg-secondary"
              }`}
              title="Text (I-beam)"
            >
              <div
                style={{ transform: "scale(0.5)", transformOrigin: "center" }}
              >
                <TextCursor />
              </div>
            </button>
          </div>
        </div>
      )}
      {hasCursorInteractions && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 p-2 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <AlertCircle className="w-3 h-3 text-blue-400 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-[10px] text-blue-200/90 font-medium">
                Interactive Composition
              </p>
              <p className="text-[9px] text-blue-200/70 mt-0.5">
                Cursor type should be "default" - it will auto-change to
                "pointer" when hovering over interactive elements
              </p>
            </div>
          </div>
        </div>
      )}
      {/* Visibility & Scale */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Visibility</Label>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const newOpacity = localState.opacity > 0 ? 0 : 1;
              setLocalState((prev) => ({ ...prev, opacity: newOpacity }));
              setOrUpdateKeyframe("opacity", newOpacity.toString());
            }}
            className="w-full h-7 text-xs"
          >
            {localState.opacity > 0 ? (
              <>
                <Eye className="h-3 w-3 mr-1" />
                Visible
              </>
            ) : (
              <>
                <EyeOff className="h-3 w-3 mr-1" />
                Hidden
              </>
            )}
          </Button>
        </div>
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Scale</Label>
          <Input
            type="number"
            step="0.1"
            min="0"
            max="3"
            value={localState.scale.toFixed(1)}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (Number.isFinite(val)) {
                setLocalState((prev) => ({ ...prev, scale: val }));
                setOrUpdateKeyframe("scale", val.toString());
              }
            }}
            className="h-7 text-xs"
          />
        </div>
      </div>

      {/* Motion Curve Control - only visible when on a keyframe */}
      {isOnKeyframe && (
        <MotionCurveSelect
          value={handleGetCurrentKeyframeEasing()}
          onChange={handleUpdateKeyframeEasing}
          accentColor="purple-400"
        />
      )}

      {/* Keyframe Actions */}
      <KeyframeActionButtons
        isOnKeyframe={isOnKeyframe}
        onDuplicate={handleDuplicateKeyframe}
        onReset={resetAll}
        onRemove={removeKeyframe}
        resetTooltip="Reset all keyframes"
      />
    </div>
  );
};
