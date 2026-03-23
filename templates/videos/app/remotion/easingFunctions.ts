/**
 * GSAP-style easing functions
 * All functions take a value t between 0 and 1 and return the eased value
 */

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

export type EasingFunction = (t: number) => number;

// Linear
const linear: EasingFunction = (t) => t;

// Power1 (Quad)
const power1In: EasingFunction = (t) => t * t;
const power1Out: EasingFunction = (t) => t * (2 - t);
const power1InOut: EasingFunction = (t) =>
  t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

// Power2 (Cubic)
const power2In: EasingFunction = (t) => t * t * t;
const power2Out: EasingFunction = (t) => --t * t * t + 1;
const power2InOut: EasingFunction = (t) =>
  t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;

// Power3 (Quart)
const power3In: EasingFunction = (t) => t * t * t * t;
const power3Out: EasingFunction = (t) => 1 - --t * t * t * t;
const power3InOut: EasingFunction = (t) =>
  t < 0.5 ? 8 * t * t * t * t : 1 - 8 * --t * t * t * t;

// Power4 (Quint)
const power4In: EasingFunction = (t) => t * t * t * t * t;
const power4Out: EasingFunction = (t) => 1 + --t * t * t * t * t;
const power4InOut: EasingFunction = (t) =>
  t < 0.5 ? 16 * t * t * t * t * t : 1 + 16 * --t * t * t * t * t;

// Back
const backIn: EasingFunction = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return c3 * t * t * t - c1 * t * t;
};
const backOut: EasingFunction = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const backInOut: EasingFunction = (t) => {
  const c1 = 1.70158;
  const c2 = c1 * 1.525;
  return t < 0.5
    ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
    : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
};

// Bounce
const bounceOut: EasingFunction = (t) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) {
    return n1 * t * t;
  } else if (t < 2 / d1) {
    return n1 * (t -= 1.5 / d1) * t + 0.75;
  } else if (t < 2.5 / d1) {
    return n1 * (t -= 2.25 / d1) * t + 0.9375;
  } else {
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  }
};
const bounceIn: EasingFunction = (t) => 1 - bounceOut(1 - t);
const bounceInOut: EasingFunction = (t) =>
  t < 0.5 ? (1 - bounceOut(1 - 2 * t)) / 2 : (1 + bounceOut(2 * t - 1)) / 2;

// Circ
const circIn: EasingFunction = (t) => 1 - Math.sqrt(1 - Math.pow(t, 2));
const circOut: EasingFunction = (t) => Math.sqrt(1 - Math.pow(t - 1, 2));
const circInOut: EasingFunction = (t) =>
  t < 0.5
    ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2
    : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2;

// Elastic
const elasticIn: EasingFunction = (t) => {
  const c4 = (2 * Math.PI) / 3;
  return t === 0
    ? 0
    : t === 1
      ? 1
      : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4);
};
const elasticOut: EasingFunction = (t) => {
  const c4 = (2 * Math.PI) / 3;
  return t === 0
    ? 0
    : t === 1
      ? 1
      : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};
const elasticInOut: EasingFunction = (t) => {
  const c5 = (2 * Math.PI) / 4.5;
  return t === 0
    ? 0
    : t === 1
      ? 1
      : t < 0.5
        ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
        : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 +
          1;
};

// Expo
const expoIn: EasingFunction = (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10));
const expoOut: EasingFunction = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));
const expoInOut: EasingFunction = (t) =>
  t === 0
    ? 0
    : t === 1
      ? 1
      : t < 0.5
        ? Math.pow(2, 20 * t - 10) / 2
        : (2 - Math.pow(2, -20 * t + 10)) / 2;

// Sine
const sineIn: EasingFunction = (t) => 1 - Math.cos((t * Math.PI) / 2);
const sineOut: EasingFunction = (t) => Math.sin((t * Math.PI) / 2);
const sineInOut: EasingFunction = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

// Spring (simple damped spring approximation)
const spring: EasingFunction = (t) => {
  const damping = 0.3;
  const frequency = 1.5;
  return 1 - Math.exp(-damping * 10 * t) * Math.cos(frequency * 10 * t);
};

// Easing function map
const easingFunctions: Record<EasingKey, EasingFunction> = {
  linear,
  "power1.in": power1In,
  "power1.out": power1Out,
  "power1.inOut": power1InOut,
  "power2.in": power2In,
  "power2.out": power2Out,
  "power2.inOut": power2InOut,
  "power3.in": power3In,
  "power3.out": power3Out,
  "power3.inOut": power3InOut,
  "power4.in": power4In,
  "power4.out": power4Out,
  "power4.inOut": power4InOut,
  "back.in": backIn,
  "back.out": backOut,
  "back.inOut": backInOut,
  "bounce.in": bounceIn,
  "bounce.out": bounceOut,
  "bounce.inOut": bounceInOut,
  "circ.in": circIn,
  "circ.out": circOut,
  "circ.inOut": circInOut,
  "elastic.in": elasticIn,
  "elastic.out": elasticOut,
  "elastic.inOut": elasticInOut,
  "expo.in": expoIn,
  "expo.out": expoOut,
  "expo.inOut": expoInOut,
  "sine.in": sineIn,
  "sine.out": sineOut,
  "sine.inOut": sineInOut,
  spring,
};

/**
 * Get easing function by key
 */
export function getEasingFunction(key: EasingKey): EasingFunction {
  return easingFunctions[key] || linear;
}

/**
 * Easing options for UI dropdowns
 */
export const EASING_OPTIONS: Array<{ value: EasingKey; label: string }> = [
  { value: "linear", label: "Linear" },
  { value: "power1.in", label: "Power1 In" },
  { value: "power1.out", label: "Power1 Out" },
  { value: "power1.inOut", label: "Power1 InOut" },
  { value: "power2.in", label: "Power2 In" },
  { value: "power2.out", label: "Power2 Out" },
  { value: "power2.inOut", label: "Power2 InOut" },
  { value: "power3.in", label: "Power3 In" },
  { value: "power3.out", label: "Power3 Out" },
  { value: "power3.inOut", label: "Power3 InOut" },
  { value: "power4.in", label: "Power4 In" },
  { value: "power4.out", label: "Power4 Out" },
  { value: "power4.inOut", label: "Power4 InOut" },
  { value: "back.in", label: "Back In" },
  { value: "back.out", label: "Back Out" },
  { value: "back.inOut", label: "Back InOut" },
  { value: "bounce.in", label: "Bounce In" },
  { value: "bounce.out", label: "Bounce Out" },
  { value: "bounce.inOut", label: "Bounce InOut" },
  { value: "circ.in", label: "Circ In" },
  { value: "circ.out", label: "Circ Out" },
  { value: "circ.inOut", label: "Circ InOut" },
  { value: "elastic.in", label: "Elastic In" },
  { value: "elastic.out", label: "Elastic Out" },
  { value: "elastic.inOut", label: "Elastic InOut" },
  { value: "expo.in", label: "Expo In" },
  { value: "expo.out", label: "Expo Out" },
  { value: "expo.inOut", label: "Expo InOut" },
  { value: "sine.in", label: "Sine In" },
  { value: "sine.out", label: "Sine Out" },
  { value: "sine.inOut", label: "Sine InOut" },
  { value: "spring", label: "Spring" },
];
