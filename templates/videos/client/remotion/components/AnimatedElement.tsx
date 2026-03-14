import React from "react";
import type { InteractiveComponentState } from "../hooks/useInteractiveComponent";

/**
 * AnimatedElement - Universal wrapper that applies ALL animated properties
 *
 * This component automatically converts animated properties from useInteractiveComponent
 * into inline styles, supporting ANY CSS property.
 *
 * 🎯 Receives duration-based animation values from useInteractiveComponent that respect
 * the animation.duration setting from the UI. No hardcoded frame counts!
 *
 * USAGE:
 * ```tsx
 * const button = useInteractiveComponent({ ... });
 *
 * <AnimatedElement interactive={button} as="button">
 *   Click me
 * </AnimatedElement>
 * ```
 *
 * SUPPORTED PROPERTIES (auto-detected):
 * - scale → transform: scale()
 * - translateX, translateY → transform: translate()
 * - rotateX, rotateY, rotateZ, rotate → transform: rotate()
 * - opacity → opacity
 * - backgroundColor, background → background/backgroundColor
 * - color, textColor → color
 * - borderColor, borderTopColor, borderBottomColor, etc. → individual border properties
 * - borderWidth, borderTopWidth, borderBottomWidth, etc. → individual border properties
 * - borderStyle, borderTopStyle, borderBottomStyle, etc. → individual border properties
 * - borderRadius → borderRadius
 *
 * NOTE: Uses individual border properties (not shorthands) to avoid React warnings
 * - boxShadow, shadow → boxShadow
 * - blur → filter: blur()
 * - brightness → filter: brightness()
 * - contrast → filter: contrast()
 * - saturate → filter: saturate()
 * - hueRotate → filter: hue-rotate()
 * - width, height → width, height
 * - padding, margin → padding, margin
 * - ANY other CSS property directly
 */

export interface AnimatedElementProps {
  /** Interactive component state from useInteractiveComponent */
  interactive: InteractiveComponentState;

  /** HTML element type or React component */
  as?: keyof JSX.IntrinsicElements | React.ComponentType<any>;

  /** Additional inline styles (merged with animated properties) */
  style?: React.CSSProperties;

  /** Class name */
  className?: string;

  /** Children */
  children?: React.ReactNode;

  /** Any other props to pass to the underlying element */
  [key: string]: any;
}

/**
 * Convert animated properties to inline styles
 * Handles transforms, filters, and all CSS properties
 *
 * IMPORTANT: Uses longhand properties (borderTopWidth, borderTopColor) instead of
 * shorthand properties (borderTop) to avoid React warnings when mixing with static styles.
 */
function animatedPropsToStyles(
  props: Record<string, number | string>,
): React.CSSProperties {
  const styles: React.CSSProperties = {};
  const transforms: string[] = [];
  const filters: string[] = [];

  // Detect if any longhand border/padding/margin properties exist
  const hasLonghandBorder = Object.keys(props).some(
    (k) =>
      k.startsWith("borderTop") ||
      k.startsWith("borderBottom") ||
      k.startsWith("borderLeft") ||
      k.startsWith("borderRight"),
  );
  const hasLonghandPadding = Object.keys(props).some(
    (k) =>
      k === "paddingTop" ||
      k === "paddingBottom" ||
      k === "paddingLeft" ||
      k === "paddingRight",
  );
  const hasLonghandMargin = Object.keys(props).some(
    (k) =>
      k === "marginTop" ||
      k === "marginBottom" ||
      k === "marginLeft" ||
      k === "marginRight",
  );

  // Process each animated property
  Object.entries(props).forEach(([key, value]) => {
    // Skip if value is undefined/null
    if (value === undefined || value === null) return;

    // CRITICAL: Skip shorthand properties if any longhand versions exist
    // This prevents React warnings about mixing shorthand and longhand properties
    if (key === "border" && hasLonghandBorder) return;
    if (
      (key === "borderTop" ||
        key === "borderBottom" ||
        key === "borderLeft" ||
        key === "borderRight") &&
      hasLonghandBorder
    )
      return;
    if (key === "padding" && hasLonghandPadding) return;
    if (key === "margin" && hasLonghandMargin) return;

    // Handle transform properties
    if (key === "scale") {
      transforms.push(`scale(${value})`);
    } else if (key === "translateX") {
      transforms.push(
        `translateX(${value}${typeof value === "number" ? "px" : ""})`,
      );
    } else if (key === "translateY") {
      transforms.push(
        `translateY(${value}${typeof value === "number" ? "px" : ""})`,
      );
    } else if (key === "translateZ") {
      transforms.push(
        `translateZ(${value}${typeof value === "number" ? "px" : ""})`,
      );
    } else if (key === "rotateX") {
      transforms.push(
        `rotateX(${value}${typeof value === "number" ? "deg" : ""})`,
      );
    } else if (key === "rotateY") {
      transforms.push(
        `rotateY(${value}${typeof value === "number" ? "deg" : ""})`,
      );
    } else if (key === "rotateZ" || key === "rotate") {
      transforms.push(
        `rotateZ(${value}${typeof value === "number" ? "deg" : ""})`,
      );
    } else if (key === "skewX") {
      transforms.push(
        `skewX(${value}${typeof value === "number" ? "deg" : ""})`,
      );
    } else if (key === "skewY") {
      transforms.push(
        `skewY(${value}${typeof value === "number" ? "deg" : ""})`,
      );
    }
    // Handle filter properties
    // CRITICAL: brightness/contrast/saturate use UNITLESS multipliers (1 = normal, 1.5 = 50% brighter)
    // Only blur uses pixels, hue-rotate uses degrees. See AGENTS.md for details.
    else if (key === "blur") {
      filters.push(`blur(${value}${typeof value === "number" ? "px" : ""})`);
    } else if (key === "brightness") {
      filters.push(`brightness(${value})`); // Unitless: 1 = normal, 1.5 = 50% brighter
    } else if (key === "contrast") {
      filters.push(`contrast(${value})`); // Unitless: 1 = normal, 2 = 2x contrast
    } else if (key === "saturate") {
      filters.push(`saturate(${value})`); // Unitless: 1 = normal, 0.5 = 50% saturation
    } else if (key === "hueRotate") {
      filters.push(
        `hue-rotate(${value}${typeof value === "number" ? "deg" : ""})`,
      );
    }
    // Handle direct CSS properties
    else if (key === "opacity") {
      styles.opacity = value as number;
    } else if (key === "backgroundColor") {
      styles.backgroundColor = value as string;
    } else if (key === "background") {
      // Keep as background for complex values (gradients, images, etc.)
      styles.background = value as string;
    } else if (key === "color" || key === "textColor") {
      styles.color = value as string;
    } else if (key === "borderColor") {
      // Skip if directional border colors exist
      if (!hasLonghandBorder) {
        styles.borderColor = value as string;
      }
    } else if (key === "borderWidth") {
      // Skip if directional border widths exist
      if (!hasLonghandBorder) {
        styles.borderWidth = typeof value === "number" ? `${value}px` : value;
      }
    } else if (key === "borderRadius") {
      styles.borderRadius = typeof value === "number" ? `${value}px` : value;
    } else if (key === "borderStyle") {
      // Skip if directional border styles exist
      if (!hasLonghandBorder) {
        styles.borderStyle = value as string;
      }
    }
    // Directional border properties
    else if (key === "borderTopColor") {
      styles.borderTopColor = value as string;
    } else if (key === "borderBottomColor") {
      styles.borderBottomColor = value as string;
    } else if (key === "borderLeftColor") {
      styles.borderLeftColor = value as string;
    } else if (key === "borderRightColor") {
      styles.borderRightColor = value as string;
    } else if (key === "borderTopWidth") {
      styles.borderTopWidth = typeof value === "number" ? `${value}px` : value;
    } else if (key === "borderBottomWidth") {
      styles.borderBottomWidth =
        typeof value === "number" ? `${value}px` : value;
    } else if (key === "borderLeftWidth") {
      styles.borderLeftWidth = typeof value === "number" ? `${value}px` : value;
    } else if (key === "borderRightWidth") {
      styles.borderRightWidth =
        typeof value === "number" ? `${value}px` : value;
    } else if (key === "borderTopStyle") {
      styles.borderTopStyle = value as string;
    } else if (key === "borderBottomStyle") {
      styles.borderBottomStyle = value as string;
    } else if (key === "borderLeftStyle") {
      styles.borderLeftStyle = value as string;
    } else if (key === "borderRightStyle") {
      styles.borderRightStyle = value as string;
    } else if (key === "boxShadow" || key === "shadow") {
      styles.boxShadow = value as string;
    } else if (key === "width") {
      styles.width = typeof value === "number" ? `${value}px` : value;
    } else if (key === "height") {
      styles.height = typeof value === "number" ? `${value}px` : value;
    }
    // Padding properties (shorthand and longhand)
    else if (key === "padding") {
      styles.padding = typeof value === "number" ? `${value}px` : value;
    } else if (key === "paddingTop") {
      styles.paddingTop = typeof value === "number" ? `${value}px` : value;
    } else if (key === "paddingBottom") {
      styles.paddingBottom = typeof value === "number" ? `${value}px` : value;
    } else if (key === "paddingLeft") {
      styles.paddingLeft = typeof value === "number" ? `${value}px` : value;
    } else if (key === "paddingRight") {
      styles.paddingRight = typeof value === "number" ? `${value}px` : value;
    }
    // Margin properties (shorthand and longhand)
    else if (key === "margin") {
      styles.margin = typeof value === "number" ? `${value}px` : value;
    } else if (key === "marginTop") {
      styles.marginTop = typeof value === "number" ? `${value}px` : value;
    } else if (key === "marginBottom") {
      styles.marginBottom = typeof value === "number" ? `${value}px` : value;
    } else if (key === "marginLeft") {
      styles.marginLeft = typeof value === "number" ? `${value}px` : value;
    } else if (key === "marginRight") {
      styles.marginRight = typeof value === "number" ? `${value}px` : value;
    }
    // For any other property, add it directly as camelCase CSS property
    else {
      // Skip problematic shorthand properties that could conflict
      const shorthandPropsToSkip = [
        "border",
        "borderTop",
        "borderBottom",
        "borderLeft",
        "borderRight",
        "padding",
        "margin",
      ];

      if (shorthandPropsToSkip.includes(key)) {
        // Skip - these would conflict with longhand properties
        return;
      }

      // Convert kebab-case to camelCase for React inline styles
      const camelKey = key.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
      (styles as any)[camelKey] = value;
    }
  });

  // Apply transform if any transform functions were added
  if (transforms.length > 0) {
    styles.transform = transforms.join(" ");
  }

  // Apply filter if any filter functions were added
  if (filters.length > 0) {
    styles.filter = filters.join(" ");
  }

  return styles;
}

/**
 * AnimatedElement component
 * Automatically applies all animated properties as inline styles
 */
/**
 * Interpolate between two colors (hex format)
 */
function interpolateColors(
  color1: string,
  color2: string,
  progress: number,
): string {
  // Handle transparent/rgba/rgb
  if (color1 === "transparent") color1 = "#000000";
  if (color2 === "transparent") color2 = "#000000";

  // Simple hex interpolation
  const parseHex = (hex: string) => {
    const clean = hex.replace("#", "");
    return {
      r: parseInt(clean.substring(0, 2), 16),
      g: parseInt(clean.substring(2, 4), 16),
      b: parseInt(clean.substring(4, 6), 16),
    };
  };

  const c1 = parseHex(color1.startsWith("#") ? color1 : "#000000");
  const c2 = parseHex(color2.startsWith("#") ? color2 : "#000000");

  const r = Math.round(c1.r + (c2.r - c1.r) * progress);
  const g = Math.round(c1.g + (c2.g - c1.g) * progress);
  const b = Math.round(c1.b + (c2.b - c1.b) * progress);

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export function AnimatedElement({
  interactive,
  as: Component = "div",
  style = {},
  className,
  children,
  ...restProps
}: AnimatedElementProps) {
  // TWO-TRACK SYSTEM: When clicking during hover, we need to:
  // 1. Calculate what the hover color would be (even though we don't show it)
  // 2. Use that hover color as the starting point for click animation
  // This prevents the "HOVER → STANDARD → CLICK" jump
  const isClicking = interactive.click.isClicking;
  const isHovering = interactive.hover.isHovering;

  // Check if there's any animation progress (includes animate-out!)
  const hasAnimation =
    interactive.hover.progress > 0 || interactive.click.progress > 0;

  if (hasAnimation) {
    // Convert animated properties
    const animatedStyles = animatedPropsToStyles(
      interactive.animatedProperties,
    );
    const targetStyles = animatedPropsToStyles(interactive.animatedTargets);

    // Two-track targets for smooth color transitions
    const hoverTargetStyles = animatedPropsToStyles(interactive.hoverTargets);
    const clickTargetStyles = animatedPropsToStyles(interactive.clickTargets);

    // Start with static styles
    const blendedStyles: React.CSSProperties = { ...style };

    // Get all unique property keys from all sources
    const allKeys = new Set([
      ...Object.keys(animatedStyles),
      ...Object.keys(targetStyles),
      ...Object.keys(hoverTargetStyles),
      ...Object.keys(clickTargetStyles),
    ]);

    allKeys.forEach((key) => {
      const animatedValue = (animatedStyles as any)[key];
      const staticValue = (style as any)[key];
      const hoverTarget = (hoverTargetStyles as any)[key];
      const clickTarget = (clickTargetStyles as any)[key];

      // Check if this is a color property
      const isColorProperty =
        key === "backgroundColor" ||
        key === "background" ||
        key === "color" ||
        key === "borderColor" ||
        key.includes("Color");

      // TWO-TRACK COLOR BLENDING: Calculate hover and click colors separately
      // NOTE: Use clickProgress > 0 (not isClicking) to catch animate-out phase too
      const clickProgress = interactive.click.progress;
      if (isColorProperty) {
        if (
          clickProgress > 0 &&
          isHovering &&
          clickTarget &&
          hoverTarget &&
          typeof staticValue === "string" &&
          typeof hoverTarget === "string" &&
          typeof clickTarget === "string"
        ) {
          // BOTH hover and click animating: Calculate two-track blend
          // Works during click-in AND click animate-out (clickProgress > 0 but isClicking=false)
          // Step 1: Calculate current hover color
          const currentHoverColor = interpolateColors(
            staticValue,
            hoverTarget,
            interactive.hover.progress,
          );

          // Step 2: Blend from hover color → click target using click progress
          // As clickProgress→0 (animate-out), blendedColor approaches hoverColor (not static!)
          const blendedColor = interpolateColors(
            currentHoverColor,
            clickTarget,
            clickProgress,
          );
          (blendedStyles as any)[key] = blendedColor;
        } else if (
          isHovering &&
          hoverTarget &&
          typeof staticValue === "string" &&
          typeof hoverTarget === "string"
        ) {
          // Only hovering: Blend static → hover target
          const blendedColor = interpolateColors(
            staticValue,
            hoverTarget,
            interactive.hover.progress,
          );
          (blendedStyles as any)[key] = blendedColor;
        } else if (
          isClicking &&
          clickTarget &&
          typeof staticValue === "string" &&
          typeof clickTarget === "string"
        ) {
          // Only clicking (rare case): Blend static → click target
          const blendedColor = interpolateColors(
            staticValue,
            clickTarget,
            interactive.click.progress,
          );
          (blendedStyles as any)[key] = blendedColor;
        } else if (staticValue) {
          // No animation targets, use static color
          (blendedStyles as any)[key] = staticValue;
        }
        return;
      }

      // For non-color properties: Use two-track blend when BOTH targets exist,
      // NOTE: Use clickProgress > 0 (not isClicking) to catch animate-out phase too
      // This ensures click→hover is smooth, not click→static→hover
      if (
        clickProgress > 0 &&
        isHovering &&
        typeof clickTarget === "number" &&
        typeof hoverTarget === "number"
      ) {
        // BOTH hover and click animating: Calculate two-track blend
        // Works during click-in AND click animate-out
        const staticNum = typeof staticValue === "number" ? staticValue : 0;

        // Step 1: Calculate current hover value
        const currentHoverValue =
          staticNum + (hoverTarget - staticNum) * interactive.hover.progress;

        // Step 2: Blend from hover value → click target using click progress
        // As clickProgress→0 (animate-out), blendedValue approaches hoverValue (not static!)
        const blendedValue =
          currentHoverValue + (clickTarget - currentHoverValue) * clickProgress;
        (blendedStyles as any)[key] = blendedValue;
      } else if (animatedValue !== undefined) {
        // Use the animated value from the animation system
        // Now includes hover during click (for properties without click animations)
        (blendedStyles as any)[key] = animatedValue;
      }
    });

    return (
      <Component style={blendedStyles} className={className} {...restProps}>
        {children}
      </Component>
    );
  }

  // At rest: use only static styles
  return (
    <Component style={style} className={className} {...restProps}>
      {children}
    </Component>
  );
}
