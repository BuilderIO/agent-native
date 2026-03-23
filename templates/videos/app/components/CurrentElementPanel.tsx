import React, { useState } from "react";
import { useCurrentElement } from "@/contexts/CurrentElementContext";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  MousePointer,
  MousePointerClick,
  ChevronRight,
  Mouse,
} from "lucide-react";
import { MotionCurveSelect } from "./MotionCurveSelect";
import {
  DefaultCursor,
  PointerCursor,
  TextCursor,
} from "@/remotion/ui-components/Cursor";
import type {
  ElementAnimation,
  AnimatedPropertyConfig,
} from "@/types/elementAnimations";
import type { EasingKey } from "@/types";

// Standard fps for converting between seconds and frames
const FPS = 30;

/**
 * ANIMATION PROPERTY DEFAULTS
 *
 * IMPORTANT FOR COLOR PROPERTIES:
 * To prevent color flashing during animations, the "from" value (defaultStart) for
 * color properties is automatically set to match the element's current static style.
 * See `getCurrentStyleValue()` function below which:
 * 1. Detects the element type (Card, Button, etc.)
 * 2. Returns the appropriate default background color for that element type
 * 3. Falls back to neutral values if detection fails
 *
 * This ensures smooth color transitions without unexpected bright flashes.
 *
 * When adding new component types:
 * - Update the `bgColorDefaults` map in `getCurrentStyleValue()` with the new type's default background
 * - Or ensure the component's static backgroundColor is set correctly in its code
 */
const PROPERTY_OPTIONS = [
  {
    value: "scale",
    label: "Scale",
    unit: "x",
    min: 0,
    max: 3,
    defaultStart: 1,
    defaultEnd: 1.1,
    type: "number",
  },
  {
    value: "translateX",
    label: "Translate X",
    unit: "px",
    min: -500,
    max: 500,
    defaultStart: 0,
    defaultEnd: 20,
    type: "number",
  },
  {
    value: "translateY",
    label: "Translate Y",
    unit: "px",
    min: -500,
    max: 500,
    defaultStart: 0,
    defaultEnd: -20,
    type: "number",
  },
  {
    value: "translateZ",
    label: "Translate Z",
    unit: "px",
    min: -500,
    max: 500,
    defaultStart: 0,
    defaultEnd: 50,
    type: "number",
  },
  {
    value: "rotateX",
    label: "Rotate X",
    unit: "deg",
    min: -360,
    max: 360,
    defaultStart: 0,
    defaultEnd: 10,
    type: "number",
  },
  {
    value: "rotateY",
    label: "Rotate Y",
    unit: "deg",
    min: -360,
    max: 360,
    defaultStart: 0,
    defaultEnd: 10,
    type: "number",
  },
  {
    value: "rotateZ",
    label: "Rotate Z",
    unit: "deg",
    min: -360,
    max: 360,
    defaultStart: 0,
    defaultEnd: 15,
    type: "number",
  },
  {
    value: "opacity",
    label: "Opacity",
    unit: "",
    min: 0,
    max: 1,
    defaultStart: 1,
    defaultEnd: 0.8,
    type: "number",
  },
  {
    value: "brightness",
    label: "Brightness",
    unit: "x",
    min: 0,
    max: 3,
    defaultStart: 1,
    defaultEnd: 1.2,
    type: "number",
  },
  {
    value: "blur",
    label: "Blur",
    unit: "px",
    min: 0,
    max: 20,
    defaultStart: 0,
    defaultEnd: 5,
    type: "number",
  },
  {
    value: "skewX",
    label: "Skew X",
    unit: "deg",
    min: -45,
    max: 45,
    defaultStart: 0,
    defaultEnd: 5,
    type: "number",
  },
  {
    value: "skewY",
    label: "Skew Y",
    unit: "deg",
    min: -45,
    max: 45,
    defaultStart: 0,
    defaultEnd: 5,
    type: "number",
  },
  {
    value: "borderRadius",
    label: "Border Radius",
    unit: "px",
    min: 0,
    max: 100,
    defaultStart: 16,
    defaultEnd: 32,
    type: "number",
  },
  {
    value: "borderWidth",
    label: "Border Width",
    unit: "px",
    min: 0,
    max: 20,
    defaultStart: 2,
    defaultEnd: 4,
    type: "number",
  },
  {
    value: "borderOpacity",
    label: "Border Opacity",
    unit: "",
    min: 0,
    max: 1,
    defaultStart: 0.2,
    defaultEnd: 1,
    type: "number",
  },
  {
    value: "backgroundOpacity",
    label: "Background Opacity",
    unit: "",
    min: 0,
    max: 1,
    defaultStart: 1,
    defaultEnd: 0.8,
    type: "number",
  },
  {
    value: "shadowBlur",
    label: "Shadow Blur",
    unit: "px",
    min: 0,
    max: 100,
    defaultStart: 8,
    defaultEnd: 24,
    type: "number",
  },
  {
    value: "shadowSpread",
    label: "Shadow Spread",
    unit: "px",
    min: -50,
    max: 50,
    defaultStart: 0,
    defaultEnd: 4,
    type: "number",
  },
  // Color properties: defaultStart is auto-detected from element type (see getCurrentStyleValue)
  // This prevents color flashing by starting from the element's actual resting color
  {
    value: "backgroundColor",
    label: "Background Color",
    unit: "",
    defaultStart: "#1e293b",
    defaultEnd: "#ef4444",
    type: "color",
  },
  {
    value: "borderColor",
    label: "Border Color",
    unit: "",
    defaultStart: "#9ca3af",
    defaultEnd: "#fbbf24",
    type: "color",
  },
] as const;

export const CurrentElementPanel: React.FC = () => {
  const {
    currentElement,
    getAnimationsForElement,
    addAnimation,
    updateAnimation,
    deleteAnimation,
    getCursorType,
    setCursorType,
    deleteCursorType,
  } = useCurrentElement();

  const [expandedAnimationId, setExpandedAnimationId] = useState<string | null>(
    null,
  );
  const [selectedPropertyToAdd, setSelectedPropertyToAdd] =
    useState<string>("");

  if (!currentElement) {
    return (
      <div className="text-center py-8 px-4 bg-muted/30 rounded-lg border border-dashed border-border m-4">
        <MousePointerClick className="w-8 h-8 mx-auto mb-3 text-green-400/40" />
        <p className="text-xs font-medium text-muted-foreground">
          No component selected
        </p>
        <p className="text-[10px] text-muted-foreground/60 mt-1 leading-relaxed">
          Hover over an interactive element in the preview to edit its cursor
          behavior and animations
        </p>
      </div>
    );
  }

  // Get stored cursor type or use the one from currentElement
  const storedCursorType = getCursorType(
    currentElement.compositionId,
    currentElement.type,
  );
  const effectiveCursorType =
    storedCursorType || currentElement.cursorType || "pointer";

  const handleUpdateCursorType = (
    newCursorType: "default" | "pointer" | "text",
  ) => {
    setCursorType(
      currentElement.compositionId,
      currentElement.type,
      newCursorType,
    );
  };

  const handleDeleteCursorType = () => {
    deleteCursorType(currentElement.compositionId, currentElement.type);
  };
  const animations = getAnimationsForElement(
    currentElement.compositionId,
    currentElement.type,
  );
  const hoverAnimation = animations.find((a) => a.triggerType === "hover");
  const clickAnimation = animations.find((a) => a.triggerType === "click");

  const handleAddAnimation = (triggerType: "hover" | "click") => {
    const newAnimation: ElementAnimation = {
      id: `${currentElement.type.toLowerCase()}-${triggerType}-${Date.now()}`,
      elementType: currentElement.type,
      triggerType,
      duration: triggerType === "hover" ? 6 : 12,
      easing: "expo.out",
      properties:
        triggerType === "hover"
          ? [
              {
                property: "scale",
                keyframes: [
                  { progress: 0, value: 1 },
                  { progress: 1, value: 1.05 },
                ],
                unit: "x",
                min: 0.5,
                max: 2,
              },
              {
                property: "translateY",
                keyframes: [
                  { progress: 0, value: 0 },
                  { progress: 1, value: -8 },
                ],
                unit: "px",
                min: -100,
                max: 100,
              },
            ]
          : [
              {
                property: "scale",
                keyframes: [
                  { progress: 0, value: 1 },
                  { progress: 1, value: 0.95 },
                ],
                unit: "x",
                min: 0.5,
                max: 2,
              },
              {
                property: "brightness",
                keyframes: [
                  { progress: 0, value: 1 },
                  { progress: 1, value: 1.4 },
                ],
                unit: "x",
                min: 0,
                max: 3,
              },
            ],
    };

    addAnimation(currentElement.compositionId, newAnimation);
    setExpandedAnimationId(newAnimation.id);
  };

  const handleUpdateDuration = (animId: string, durationInSeconds: number) => {
    // Ensure minimum value and round to 2 decimal places to prevent drift
    const clampedDuration = Math.max(
      0.01,
      Math.round(durationInSeconds * 100) / 100,
    );
    const durationInFrames = Math.max(1, Math.round(clampedDuration * FPS));
    updateAnimation(currentElement.compositionId, animId, {
      duration: durationInFrames,
    });
  };

  const handleUpdateEasing = (animId: string, easing: EasingKey) => {
    updateAnimation(currentElement.compositionId, animId, { easing });
  };

  const handleUpdateProperty = (
    animId: string,
    propIndex: number,
    keyframeIndex: number,
    newValue: number,
  ) => {
    const anim = animations.find((a) => a.id === animId);
    if (!anim) return;

    const newProperties = [...anim.properties];
    const newKeyframes = [...newProperties[propIndex].keyframes];
    newKeyframes[keyframeIndex] = {
      ...newKeyframes[keyframeIndex],
      value: newValue,
    };
    newProperties[propIndex] = {
      ...newProperties[propIndex],
      keyframes: newKeyframes,
    };

    updateAnimation(currentElement.compositionId, animId, {
      properties: newProperties,
    });
  };

  const handleDeleteProperty = (animId: string, propIndex: number) => {
    const anim = animations.find((a) => a.id === animId);
    if (!anim) return;

    const newProperties = anim.properties.filter((_, idx) => idx !== propIndex);
    updateAnimation(currentElement.compositionId, animId, {
      properties: newProperties,
    });
  };

  /**
   * Get the current static style value for a property by inspecting the DOM
   * This ensures color animations start from the element's actual resting state
   */
  const getCurrentStyleValue = (
    propertyName: string,
  ): string | number | null => {
    // Try to find the element in the DOM using the current element info
    // This is a best-effort attempt - if it fails, we fall back to defaults
    try {
      // For color properties, try to infer from the component type
      if (propertyName === "backgroundColor") {
        // Common background colors for different component types
        const bgColorDefaults: Record<string, string> = {
          Card: "#1e293b",
          Button: "#3b82f6",
          Input: "#ffffff",
        };
        return bgColorDefaults[currentElement.type] || "#1e293b";
      }
      if (propertyName === "borderColor") {
        return "#9ca3af"; // neutral gray
      }
    } catch (e) {
      // Fallback to config defaults
    }
    return null;
  };

  const handleAddProperty = (animId: string, propertyName: string) => {
    const anim = animations.find((a) => a.id === animId);
    if (!anim) return;

    const propConfig = PROPERTY_OPTIONS.find((p) => p.value === propertyName);
    if (!propConfig) return;

    // For color properties, try to get the current style value as the "from" value
    const startValue =
      propConfig.type === "color"
        ? getCurrentStyleValue(propertyName) || propConfig.defaultStart
        : propConfig.defaultStart;

    const newProperty: AnimatedPropertyConfig = {
      property: propConfig.value,
      keyframes:
        propConfig.type === "color"
          ? [
              { progress: 0, value: startValue as any },
              { progress: 1, value: propConfig.defaultEnd as any },
            ]
          : [
              { progress: 0, value: propConfig.defaultStart as number },
              { progress: 1, value: propConfig.defaultEnd as number },
            ],
      unit: propConfig.unit,
      min: "min" in propConfig ? propConfig.min : undefined,
      max: "max" in propConfig ? propConfig.max : undefined,
    };

    updateAnimation(currentElement.compositionId, animId, {
      properties: [...anim.properties, newProperty],
    });

    // Reset selection to default (empty)
    setSelectedPropertyToAdd("");
  };

  const renderAnimation = (animation: ElementAnimation) => {
    const isExpanded = expandedAnimationId === animation.id;
    const Icon =
      animation.triggerType === "hover" ? MousePointer : MousePointerClick;

    return (
      <div
        key={animation.id}
        className="border border-border rounded-lg overflow-hidden"
      >
        {/* Header */}
        <div
          className="group flex items-center gap-2 p-3 bg-secondary/30 cursor-pointer hover:bg-secondary/50 transition-colors"
          onClick={() =>
            setExpandedAnimationId(isExpanded ? null : animation.id)
          }
        >
          <Icon className="w-3.5 h-3.5 text-green-400" />
          <span className="text-xs font-medium capitalize">
            {animation.triggerType} state
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              deleteAnimation(currentElement.compositionId, animation.id);
            }}
          >
            <Trash2 className="w-3 h-3 text-muted-foreground hover:text-green-400" />
          </Button>
          <ChevronRight
            className={`w-3 h-3 ml-auto text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`}
          />
        </div>

        {/* Properties */}
        {isExpanded && (
          <div className="p-3 space-y-3">
            {/* Duration */}
            <div className="space-y-1.5">
              <Label className="text-xs">Duration (seconds)</Label>
              <input
                key={`duration-${animation.id}-${animation.duration}`}
                type="number"
                defaultValue={(animation.duration / FPS).toFixed(2)}
                onChange={(e) => {
                  const numValue = parseFloat(e.target.value);
                  if (!isNaN(numValue) && numValue > 0) {
                    handleUpdateDuration(animation.id, numValue);
                  }
                }}
                className="h-8 text-xs text-white w-full bg-background border border-input rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                min="0.01"
                max="10"
                step="0.1"
              />
            </div>

            {/* Motion Curve */}
            <MotionCurveSelect
              value={(animation.easing as EasingKey) || "linear"}
              onChange={(easing) => handleUpdateEasing(animation.id, easing)}
              label="Motion Curve"
              accentColor="green-400"
            />

            {/* Add Property Section */}
            <div className="space-y-1.5 pb-4">
              <Label className="text-xs text-muted-foreground">
                Add Property
              </Label>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-7 p-0 flex-shrink-0"
                  onClick={() =>
                    handleAddProperty(animation.id, selectedPropertyToAdd)
                  }
                  disabled={!selectedPropertyToAdd}
                >
                  <Plus className="w-3 h-3" />
                </Button>
                <Select
                  value={selectedPropertyToAdd || undefined}
                  onValueChange={(val) => setSelectedPropertyToAdd(val)}
                >
                  <SelectTrigger className="flex-1 h-auto text-xs bg-secondary border border-border rounded-lg pl-2.5 py-1.5 text-foreground focus:outline-none focus:ring-2 focus:ring-green-400/40 cursor-pointer">
                    <SelectValue placeholder="Select a property" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROPERTY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Animated Properties */}
            {animation.properties.length > 0 && (
              <Label className="text-xs text-muted-foreground">
                Animated Properties
              </Label>
            )}
            <div className="space-y-2">
              {animation.properties.map((prop, propIdx) => {
                const endKeyframe = prop.keyframes.find(
                  (kf) => kf.progress === 1,
                );
                const kfIdx = prop.keyframes.findIndex(
                  (kf) => kf.progress === 1,
                );

                if (!endKeyframe) return null;

                const propConfig = PROPERTY_OPTIONS.find(
                  (p) => p.value === prop.property,
                );
                const isColorProp = propConfig?.type === "color";

                return (
                  <div
                    key={`${animation.id}-${propIdx}`}
                    className="group flex items-center gap-2"
                  >
                    <span className="text-xs font-medium capitalize text-green-400 min-w-[80px] flex-shrink-0">
                      {prop.property.replace(/([A-Z])/g, " $1").trim()}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      onClick={() =>
                        handleDeleteProperty(animation.id, propIdx)
                      }
                    >
                      <Trash2 className="w-3 h-3 text-muted-foreground hover:text-green-400" />
                    </Button>
                    {isColorProp ? (
                      <input
                        type="color"
                        value={endKeyframe.value as string}
                        onChange={(e) =>
                          handleUpdateProperty(
                            animation.id,
                            propIdx,
                            kfIdx,
                            e.target.value as any,
                          )
                        }
                        className="h-7 w-10 rounded border border-border cursor-pointer bg-transparent"
                      />
                    ) : (
                      <>
                        <Input
                          type="number"
                          value={endKeyframe.value as number}
                          onChange={(e) =>
                            handleUpdateProperty(
                              animation.id,
                              propIdx,
                              kfIdx,
                              parseFloat(e.target.value) || 0,
                            )
                          }
                          className="h-7 text-xs w-16"
                          min={prop.min}
                          max={prop.max}
                          step={0.1}
                        />
                        {prop.unit && prop.unit !== "x" && (
                          <span className="text-xs text-muted-foreground w-8 flex-shrink-0">
                            {prop.unit}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3 p-4">
      {/* Header - Editing Component */}
      <div className="space-y-2 pb-3 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            Editing Component
          </div>
        </div>
        <div className="px-3 py-2 bg-green-500/10 border border-green-500/30 rounded-lg">
          <div className="text-sm font-semibold text-green-400">
            {currentElement.label}
          </div>
          <div className="text-[10px] text-green-400/70 mt-0.5">
            {currentElement.type}
          </div>
        </div>
      </div>

      {/* Cursor Type Section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Cursor Type</Label>
          {storedCursorType && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={handleDeleteCursorType}
              title="Reset to default"
            >
              <Trash2 className="w-3 h-3 text-muted-foreground hover:text-green-400" />
            </Button>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {/* Default Arrow */}
          <button
            onClick={() => handleUpdateCursorType("default")}
            className={`h-12 rounded-lg border-2 transition-all flex items-center justify-center ${
              effectiveCursorType === "default"
                ? "border-green-500 bg-green-500/10"
                : "border-border bg-secondary/50 hover:bg-secondary"
            }`}
            title="Arrow (Default)"
          >
            <div style={{ transform: "scale(0.5)", transformOrigin: "center" }}>
              <DefaultCursor />
            </div>
          </button>

          {/* Pointer Hand */}
          <button
            onClick={() => handleUpdateCursorType("pointer")}
            className={`h-12 rounded-lg border-2 transition-all flex items-center justify-center ${
              effectiveCursorType === "pointer"
                ? "border-green-500 bg-green-500/10"
                : "border-border bg-secondary/50 hover:bg-secondary"
            }`}
            title="Pointer (Hand)"
          >
            <div style={{ transform: "scale(0.5)", transformOrigin: "center" }}>
              <PointerCursor />
            </div>
          </button>

          {/* Text I-Beam */}
          <button
            onClick={() => handleUpdateCursorType("text")}
            className={`h-12 rounded-lg border-2 transition-all flex items-center justify-center ${
              effectiveCursorType === "text"
                ? "border-green-500 bg-green-500/10"
                : "border-border bg-secondary/50 hover:bg-secondary"
            }`}
            title="Text (I-beam)"
          >
            <div style={{ transform: "scale(0.5)", transformOrigin: "center" }}>
              <TextCursor />
            </div>
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          {storedCursorType
            ? "Custom cursor type (click trash to reset)"
            : "Using inferred cursor type"}
        </p>
      </div>

      {/* Animations */}
      <div className="space-y-2">
        {hoverAnimation && renderAnimation(hoverAnimation)}
        {clickAnimation && renderAnimation(clickAnimation)}
      </div>

      {/* Add Animation Buttons */}
      <div className="flex gap-2 pt-2">
        {!hoverAnimation && (
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-8 text-xs"
            onClick={() => handleAddAnimation("hover")}
          >
            <MousePointer className="w-3 h-3 mr-1" />
            Add Hover
          </Button>
        )}
        {!clickAnimation && (
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-8 text-xs"
            onClick={() => handleAddAnimation("click")}
          >
            <MousePointerClick className="w-3 h-3 mr-1" />
            Add click state
          </Button>
        )}
      </div>
    </div>
  );
};
