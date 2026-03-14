/**
 * Animation Helper Utilities
 * 
 * Type-safe helpers for creating and managing element animations
 */

import type { ElementAnimation, AnimatedPropertyConfig, AnimationKeyframe } from "@/types/elementAnimations";

/**
 * Type-safe animation property builder
 */
export class AnimationPropertyBuilder {
  private property: string;
  private keyframes: AnimationKeyframe[] = [];
  private unit: string = "";
  private min?: number;
  private max?: number;

  constructor(property: string) {
    this.property = property;
  }

  /**
   * Add a keyframe at specific progress (0-1)
   */
  at(progress: number, value: number | string): this {
    this.keyframes.push({ progress, value });
    return this;
  }

  /**
   * Set the unit (px, deg, x, %, etc.)
   */
  withUnit(unit: string): this {
    this.unit = unit;
    return this;
  }

  /**
   * Set min/max bounds for sliders
   */
  withBounds(min: number, max: number): this {
    this.min = min;
    this.max = max;
    return this;
  }

  /**
   * Build the property config
   */
  build(): AnimatedPropertyConfig {
    if (this.keyframes.length === 0) {
      throw new Error(`Property "${this.property}" has no keyframes`);
    }

    return {
      property: this.property,
      keyframes: this.keyframes.sort((a, b) => a.progress - b.progress),
      unit: this.unit,
      min: this.min,
      max: this.max,
    };
  }
}

/**
 * Type-safe animation builder
 */
export class AnimationBuilder {
  private id: string;
  private elementType: string;
  private triggerType: "hover" | "click";
  private duration: number = 12;
  private easing: string = "expo.out";
  private properties: AnimatedPropertyConfig[] = [];

  constructor(id: string, elementType: string, triggerType: "hover" | "click") {
    this.id = id;
    this.elementType = elementType;
    this.triggerType = triggerType;
  }

  /**
   * Set animation duration in frames
   */
  setDuration(frames: number): this {
    this.duration = frames;
    return this;
  }

  /**
   * Set easing function
   */
  setEasing(easing: string): this {
    this.easing = easing;
    return this;
  }

  /**
   * Add a property animation
   */
  addProperty(property: AnimatedPropertyConfig): this {
    this.properties.push(property);
    return this;
  }

  /**
   * Build the complete animation
   */
  build(): ElementAnimation {
    if (this.properties.length === 0) {
      throw new Error(`Animation "${this.id}" has no properties`);
    }

    return {
      id: this.id,
      elementType: this.elementType,
      triggerType: this.triggerType,
      duration: this.duration,
      easing: this.easing,
      properties: this.properties,
    };
  }
}

/**
 * Fluent API for creating animations
 */
export const createAnimation = (id: string, elementType: string, triggerType: "hover" | "click") =>
  new AnimationBuilder(id, elementType, triggerType);

export const createProperty = (property: string) => new AnimationPropertyBuilder(property);

/**
 * Pre-built animation presets
 */
export const AnimationPresets = {
  /**
   * Lift on hover - card lifts up with shadow
   */
  hoverLift: (elementType: string) =>
    createAnimation(`${elementType.toLowerCase()}-hover-lift`, elementType, "hover")
      .setDuration(8)
      .setEasing("expo.out")
      .addProperty(
        createProperty("translateY")
          .at(0, 0)
          .at(1, -10)
          .withUnit("px")
          .withBounds(-100, 100)
          .build()
      )
      .addProperty(
        createProperty("scale")
          .at(0, 1)
          .at(1, 1.02)
          .withUnit("x")
          .withBounds(0.5, 2)
          .build()
      )
      .addProperty(
        createProperty("shadowBlur")
          .at(0, 8)
          .at(1, 24)
          .withUnit("px")
          .withBounds(0, 100)
          .build()
      )
      .build(),

  /**
   * Press on click - button press down
   */
  clickPress: (elementType: string) =>
    createAnimation(`${elementType.toLowerCase()}-click-press`, elementType, "click")
      .setDuration(10)
      .setEasing("expo.out")
      .addProperty(
        createProperty("scale")
          .at(0, 1)
          .at(1, 0.95)
          .withUnit("x")
          .withBounds(0.5, 2)
          .build()
      )
      .addProperty(
        createProperty("brightness")
          .at(0, 1)
          .at(1, 1.2)
          .withUnit("x")
          .withBounds(0, 3)
          .build()
      )
      .build(),

  /**
   * Glow on hover - element glows
   */
  hoverGlow: (elementType: string, glowColor: string = "#3b82f6") =>
    createAnimation(`${elementType.toLowerCase()}-hover-glow`, elementType, "hover")
      .setDuration(6)
      .setEasing("expo.out")
      .addProperty(
        createProperty("borderColor")
          .at(0, "#ffffff")
          .at(1, glowColor)
          .withUnit("")
          .build()
      )
      .addProperty(
        createProperty("shadowBlur")
          .at(0, 0)
          .at(1, 20)
          .withUnit("px")
          .withBounds(0, 100)
          .build()
      )
      .addProperty(
        createProperty("brightness")
          .at(0, 1)
          .at(1, 1.1)
          .withUnit("x")
          .withBounds(0, 3)
          .build()
      )
      .build(),

  /**
   * Bounce on click - element bounces
   */
  clickBounce: (elementType: string) =>
    createAnimation(`${elementType.toLowerCase()}-click-bounce`, elementType, "click")
      .setDuration(12)
      .setEasing("expo.out")
      .addProperty(
        createProperty("scale")
          .at(0, 1)
          .at(0.5, 0.9)
          .at(1, 1.05)
          .withUnit("x")
          .withBounds(0.5, 2)
          .build()
      )
      .addProperty(
        createProperty("brightness")
          .at(0, 1)
          .at(0.5, 1.3)
          .at(1, 1)
          .withUnit("x")
          .withBounds(0, 3)
          .build()
      )
      .build(),

  /**
   * Fade on hover - element fades in/out
   */
  hoverFade: (elementType: string, targetOpacity: number = 0.8) =>
    createAnimation(`${elementType.toLowerCase()}-hover-fade`, elementType, "hover")
      .setDuration(6)
      .setEasing("linear")
      .addProperty(
        createProperty("opacity")
          .at(0, 1)
          .at(1, targetOpacity)
          .withUnit("")
          .withBounds(0, 1)
          .build()
      )
      .build(),
};

/**
 * Validate an animation configuration
 */
export function validateAnimation(animation: ElementAnimation): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!animation.id) errors.push("Animation missing id");
  if (!animation.elementType) errors.push("Animation missing elementType");
  if (!animation.triggerType) errors.push("Animation missing triggerType");
  if (!animation.duration || animation.duration <= 0) errors.push("Animation duration must be > 0");
  if (!animation.properties || animation.properties.length === 0) {
    errors.push("Animation must have at least one property");
  }

  animation.properties.forEach((prop, i) => {
    if (!prop.property) errors.push(`Property ${i} missing name`);
    if (!prop.keyframes || prop.keyframes.length === 0) {
      errors.push(`Property "${prop.property}" has no keyframes`);
    }
    
    // Validate keyframes are in order
    for (let j = 1; j < prop.keyframes.length; j++) {
      if (prop.keyframes[j].progress < prop.keyframes[j - 1].progress) {
        errors.push(`Property "${prop.property}" keyframes not in order`);
      }
    }

    // Validate progress is 0-1
    prop.keyframes.forEach((kf, kfIdx) => {
      if (kf.progress < 0 || kf.progress > 1) {
        errors.push(`Property "${prop.property}" keyframe ${kfIdx} progress must be 0-1`);
      }
    });
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Initialize default animations for a composition
 */
export function initializeDefaultAnimations(
  compositionId: string,
  animations: ElementAnimation[],
  options: { force?: boolean } = {}
): void {
  const KEY = "videos-element-animations";
  
  try {
    const stored = localStorage.getItem(KEY);
    const current: Record<string, ElementAnimation[]> = stored ? JSON.parse(stored) : {};

    // Skip if already initialized (unless force is true)
    if (!options.force && current[compositionId] && current[compositionId].length > 0) {
      console.log(`✅ Animations for "${compositionId}" already initialized:`, current[compositionId].length);
      return;
    }

    // Validate all animations before storing
    const validationErrors: string[] = [];
    animations.forEach((anim, i) => {
      const result = validateAnimation(anim);
      if (!result.valid) {
        validationErrors.push(`Animation ${i} (${anim.id}): ${result.errors.join(", ")}`);
      }
    });

    if (validationErrors.length > 0) {
      console.error(`❌ Invalid animations for "${compositionId}":`, validationErrors);
      return;
    }

    current[compositionId] = animations;
    localStorage.setItem(KEY, JSON.stringify(current));
    console.log(`🎬 Initialized ${animations.length} animations for "${compositionId}"`);
  } catch (err) {
    console.error(`❌ Failed to initialize animations for "${compositionId}":`, err);
  }
}

/**
 * Get all animations for a composition
 */
export function getCompositionAnimations(compositionId: string): ElementAnimation[] {
  const KEY = "videos-element-animations";
  
  try {
    const stored = localStorage.getItem(KEY);
    if (!stored) return [];
    
    const data: Record<string, ElementAnimation[]> = JSON.parse(stored);
    return data[compositionId] || [];
  } catch {
    return [];
  }
}

/**
 * Clear all animations for a composition
 */
export function clearCompositionAnimations(compositionId: string): void {
  const KEY = "videos-element-animations";
  
  try {
    const stored = localStorage.getItem(KEY);
    if (!stored) return;
    
    const data: Record<string, ElementAnimation[]> = JSON.parse(stored);
    delete data[compositionId];
    localStorage.setItem(KEY, JSON.stringify(data));
    console.log(`🗑️ Cleared animations for "${compositionId}"`);
  } catch (err) {
    console.error(`❌ Failed to clear animations for "${compositionId}":`, err);
  }
}
