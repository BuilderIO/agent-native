export const MOTION_PROTOTYPE_TRANSITION_ATTRIBUTE =
  "data-an-prototype-transition" as const;
export const MOTION_PROTOTYPE_TRANSITION_VERSION = 1 as const;

export const MOTION_PROTOTYPE_TRANSITION_KINDS = [
  "instant",
  "dissolve",
  "smart-animate",
  "move-in",
  "move-out",
  "push",
  "slide-in",
  "slide-out",
] as const;

export type MotionPrototypeTransitionKind =
  (typeof MOTION_PROTOTYPE_TRANSITION_KINDS)[number];
export type MotionPrototypeDirection = "left" | "right" | "top" | "bottom";
export type MotionPrototypeEasePreset =
  | "linear"
  | "ease"
  | "ease-in"
  | "ease-out"
  | "ease-in-out";

export type MotionPrototypeEase =
  | { kind: "preset"; preset: MotionPrototypeEasePreset }
  | {
      kind: "custom-bezier";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    };

export interface MotionPrototypeNavigationTransition {
  version: typeof MOTION_PROTOTYPE_TRANSITION_VERSION;
  trigger: "click";
  action: "navigate";
  transition: MotionPrototypeTransitionKind;
  direction?: MotionPrototypeDirection;
  durationMs?: number;
  ease?: MotionPrototypeEase;
}

export type MotionPrototypeTransitionErrorCode =
  | "not-a-string"
  | "malformed-json"
  | "invalid-document"
  | "unsupported-version"
  | "invalid-value"
  | "unserializable-document";

export class MotionPrototypeTransitionError extends Error {
  constructor(
    readonly code: MotionPrototypeTransitionErrorCode,
    message: string,
    readonly path?: string,
  ) {
    super(message);
    this.name = "MotionPrototypeTransitionError";
  }
}

export type MotionPrototypeTransitionDecodeResult =
  | { status: "absent" }
  | { status: "valid"; transition: MotionPrototypeNavigationTransition }
  | { status: "invalid"; error: MotionPrototypeTransitionError };

export type MotionPrototypeTransitionValidationResult =
  | { valid: true; transition: MotionPrototypeNavigationTransition }
  | { valid: false; error: MotionPrototypeTransitionError };

const ROOT_FIELDS = new Set([
  "version",
  "trigger",
  "action",
  "transition",
  "direction",
  "durationMs",
  "ease",
]);
const DIRECTIONAL_TRANSITIONS = new Set<MotionPrototypeTransitionKind>([
  "move-in",
  "move-out",
  "push",
  "slide-in",
  "slide-out",
]);
const EASE_PRESETS = new Set<MotionPrototypeEasePreset>([
  "linear",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
]);
const DIRECTIONS = new Set<MotionPrototypeDirection>([
  "left",
  "right",
  "top",
  "bottom",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(
  code: MotionPrototypeTransitionErrorCode,
  message: string,
  path?: string,
): MotionPrototypeTransitionValidationResult {
  return {
    valid: false,
    error: new MotionPrototypeTransitionError(code, message, path),
  };
}

function hasOnlyFields(
  value: Record<string, unknown>,
  fields: ReadonlySet<string>,
  path: string,
): MotionPrototypeTransitionValidationResult | null {
  const unknown = Object.keys(value).find((key) => !fields.has(key));
  return unknown === undefined
    ? null
    : invalid(
        "invalid-document",
        `Unsupported field "${unknown}" in ${path}.`,
        `${path}.${unknown}`,
      );
}

function validateEase(
  value: unknown,
): MotionPrototypeTransitionValidationResult | null {
  if (!isRecord(value)) {
    return invalid("invalid-value", "Ease must be an object.", "ease");
  }

  if (value.kind === "preset") {
    const fields = hasOnlyFields(value, new Set(["kind", "preset"]), "ease");
    if (fields) return fields;
    return EASE_PRESETS.has(value.preset as MotionPrototypeEasePreset)
      ? null
      : invalid("invalid-value", "Ease preset is unsupported.", "ease.preset");
  }

  if (value.kind === "custom-bezier") {
    const fields = hasOnlyFields(
      value,
      new Set(["kind", "x1", "y1", "x2", "y2"]),
      "ease",
    );
    if (fields) return fields;
    for (const coordinate of ["x1", "y1", "x2", "y2"] as const) {
      if (
        typeof value[coordinate] !== "number" ||
        !Number.isFinite(value[coordinate])
      ) {
        return invalid(
          "invalid-value",
          `Bezier coordinate ${coordinate} must be finite.`,
          `ease.${coordinate}`,
        );
      }
    }
    for (const coordinate of ["x1", "x2"] as const) {
      const control = value[coordinate] as number;
      if (control < 0 || control > 1) {
        return invalid(
          "invalid-value",
          `Bezier coordinate ${coordinate} must be between 0 and 1.`,
          `ease.${coordinate}`,
        );
      }
    }
    return null;
  }

  return invalid("invalid-value", "Ease kind is unsupported.", "ease.kind");
}

/** Validates explicit transition data without guessing missing timing values. */
export function validateMotionPrototypeNavigationTransition(
  value: unknown,
): MotionPrototypeTransitionValidationResult {
  if (!isRecord(value)) {
    return invalid("invalid-document", "Transition must be an object.");
  }
  const unknown = hasOnlyFields(value, ROOT_FIELDS, "transition");
  if (unknown) return unknown;
  if (value.version !== MOTION_PROTOTYPE_TRANSITION_VERSION) {
    return invalid(
      "unsupported-version",
      "Transition version is unsupported.",
      "transition.version",
    );
  }
  if (value.trigger !== "click") {
    return invalid(
      "invalid-value",
      "Only click navigation is supported by this document version.",
      "transition.trigger",
    );
  }
  if (value.action !== "navigate") {
    return invalid(
      "invalid-value",
      "Only navigation is supported by this document version.",
      "transition.action",
    );
  }
  if (
    typeof value.transition !== "string" ||
    !MOTION_PROTOTYPE_TRANSITION_KINDS.includes(
      value.transition as MotionPrototypeTransitionKind,
    )
  ) {
    return invalid(
      "invalid-value",
      "Transition kind is unsupported.",
      "transition.transition",
    );
  }

  const transition = value.transition as MotionPrototypeTransitionKind;
  if (transition === "instant") {
    for (const field of ["direction", "durationMs", "ease"] as const) {
      if (Object.prototype.hasOwnProperty.call(value, field)) {
        return invalid(
          "invalid-value",
          `Instant transitions do not accept ${field}.`,
          `transition.${field}`,
        );
      }
    }
  } else {
    if (
      typeof value.durationMs !== "number" ||
      !Number.isFinite(value.durationMs) ||
      value.durationMs <= 0
    ) {
      return invalid(
        "invalid-value",
        "Timed transitions require a finite positive durationMs.",
        "transition.durationMs",
      );
    }
    if (value.ease === undefined) {
      return invalid(
        "invalid-value",
        "Timed transitions require an explicit ease.",
        "transition.ease",
      );
    }
    const easeError = validateEase(value.ease);
    if (easeError) return easeError;

    if (DIRECTIONAL_TRANSITIONS.has(transition)) {
      if (!DIRECTIONS.has(value.direction as MotionPrototypeDirection)) {
        return invalid(
          "invalid-value",
          "Directional transitions require a supported direction.",
          "transition.direction",
        );
      }
    } else if (value.direction !== undefined) {
      return invalid(
        "invalid-value",
        "This transition does not accept a direction.",
        "transition.direction",
      );
    }
  }

  return {
    valid: true,
    transition: value as unknown as MotionPrototypeNavigationTransition,
  };
}

/** Reads the source attribute while preserving absent and invalid as distinct states. */
export function decodeMotionPrototypeTransitionAttribute(
  value: unknown,
): MotionPrototypeTransitionDecodeResult {
  if (value === undefined || value === null) return { status: "absent" };
  if (typeof value !== "string") {
    return {
      status: "invalid",
      error: new MotionPrototypeTransitionError(
        "not-a-string",
        "Transition attribute must be a string.",
      ),
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {
      status: "invalid",
      error: new MotionPrototypeTransitionError(
        "malformed-json",
        "Transition attribute contains malformed JSON.",
      ),
    };
  }
  const result = validateMotionPrototypeNavigationTransition(parsed);
  return result.valid
    ? { status: "valid", transition: result.transition }
    : { status: "invalid", error: result.error };
}

/** Serializes only a validated document and never inserts inferred defaults. */
export function encodeMotionPrototypeTransitionAttribute(
  value: unknown,
): string {
  const result = validateMotionPrototypeNavigationTransition(value);
  if (!result.valid) throw result.error;
  try {
    return JSON.stringify(result.transition);
  } catch {
    throw new MotionPrototypeTransitionError(
      "unserializable-document",
      "Transition document could not be serialized.",
    );
  }
}
