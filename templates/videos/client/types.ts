export type EasingKey =
  | "linear"
  | "power1.in"
  | "power1.out"
  | "power1.inOut"
  | "power2.in"
  | "power2.out"
  | "power2.inOut"
  | "power3.in"
  | "power3.out"
  | "power3.inOut"
  | "power4.in"
  | "power4.out"
  | "power4.inOut"
  | "back.in"
  | "back.out"
  | "back.inOut"
  | "bounce.in"
  | "bounce.out"
  | "bounce.inOut"
  | "circ.in"
  | "circ.out"
  | "circ.inOut"
  | "elastic.in"
  | "elastic.out"
  | "elastic.inOut"
  | "expo.in"
  | "expo.out"
  | "expo.inOut"
  | "sine.in"
  | "sine.out"
  | "sine.inOut"
  | "spring";

// ─── Animated property ────────────────────────────────────────────────────────

export interface AnimatedProp {
  /** CSS property name, e.g. "translateY", "opacity", or any custom string */
  property: string;
  /** Initial value (numeric as string, e.g. "60") OR a CSS snippet for custom props */
  from: string;
  /** Final value */
  to: string;
  /** Unit appended when rendering, e.g. "px", "deg", "" */
  unit: string;
  /** When true, 'property' is user-defined and from/to are raw CSS value strings */
  isCustom?: boolean;
  /**
   * Plain-English explanation of what this property does and how its
   * parameters work. Shown prominently above the code block.
   */
  description?: string;
  /**
   * Source code snippet showing exactly how this value is computed.
   * Read-only — shown for transparency. Edit the source file to change behavior.
   */
  codeSnippet?: string;
  /**
   * When true, this property is driven entirely by code (no editable from/to).
   * The description + code viewer are shown instead of numeric inputs.
   */
  programmatic?: boolean;
  /**
   * For programmatic animations: exposes internal values as user-adjustable parameters.
   * These appear as number inputs in the UI, giving users control over hardcoded values
   * without needing to edit the source code.
   */
  parameters?: Array<{
    name: string; // Key used to access value (e.g., "avgCharWidth")
    label: string; // Display label in UI (e.g., "Character Width")
    default: number; // Default value
    min?: number; // Minimum value (for validation/slider)
    max?: number; // Maximum value (for validation/slider)
    step?: number; // Step increment (e.g., 0.05)
  }>;
  /**
   * Stores user-adjusted parameter values for programmatic animations.
   * Keys match the `name` field in parameters array.
   */
  parameterValues?: Record<string, number>;
  /**
   * Optional keyframe array for multi-point animations.
   * When present, keyframes take precedence from/to values.
   * Each keyframe specifies an absolute frame number and value.
   */
  keyframes?: Array<{
    frame: number; // Absolute frame number
    value: string; // Numeric value as string (e.g., "1.5")
    easing?: EasingKey; // Motion curve for this keyframe segment
  }>;
  /** Motion curve for keyframed properties (applies to all segments) */
  easing?: EasingKey;
}

export interface CommonPropTemplate {
  label: string;
  property: string;
  unit: string;
  defaultFrom: string;
  defaultTo: string;
  isCustom?: boolean;
}

/** Preset list shown in the "Add Property" picker inside TrackPropertiesPanel */
export const COMMON_PROP_TEMPLATES: CommonPropTemplate[] = [
  {
    label: "Translate Y",
    property: "translateY",
    unit: "px",
    defaultFrom: "40",
    defaultTo: "0",
  },
  {
    label: "Translate X",
    property: "translateX",
    unit: "px",
    defaultFrom: "-40",
    defaultTo: "0",
  },
  {
    label: "Opacity",
    property: "opacity",
    unit: "",
    defaultFrom: "0",
    defaultTo: "1",
  },
  {
    label: "Scale",
    property: "scale",
    unit: "",
    defaultFrom: "0",
    defaultTo: "1",
  },
  {
    label: "Rotate",
    property: "rotate",
    unit: "deg",
    defaultFrom: "-15",
    defaultTo: "0",
  },
  {
    label: "Width",
    property: "width",
    unit: "px",
    defaultFrom: "0",
    defaultTo: "200",
  },
  {
    label: "Blur",
    property: "blur",
    unit: "px",
    defaultFrom: "8",
    defaultTo: "0",
  },
  {
    label: "Radius (%)",
    property: "radius",
    unit: "%",
    defaultFrom: "0",
    defaultTo: "35",
  },
  {
    label: "Custom CSS",
    property: "custom",
    unit: "",
    defaultFrom: "",
    defaultTo: "",
    isCustom: true,
  },
];

// ─── Animation track ──────────────────────────────────────────────────────────

export interface AnimationTrack {
  id: string;
  label: string;
  startFrame: number;
  endFrame: number;
  easing: EasingKey;
  /** CSS properties this track animates, with their from → to values */
  animatedProps?: AnimatedProp[];
}
