import { z } from "zod";

const easingSchema = z
  .string()
  .max(160)
  .refine(
    (value) =>
      /^(?:linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end|cubic-bezier\(\s*-?(?:\d+\.?\d*|\.\d+)\s*,\s*-?(?:\d+\.?\d*|\.\d+)\s*,\s*-?(?:\d+\.?\d*|\.\d+)\s*,\s*-?(?:\d+\.?\d*|\.\d+)\s*\)|steps\(\s*\d+\s*(?:,\s*(?:start|end|jump-start|jump-end|jump-none|jump-both))?\s*\)|linear\(\s*[-+\d.%\s,]+\s*\))$/i.test(
        value,
      ),
    "must be a supported CSS timing function",
  );

const timingOptions = {
  duration: z.number().finite().min(0).max(10_000).optional(),
  easing: easingSchema.optional(),
  delay: z.number().finite().min(-10_000).max(10_000).optional(),
};

const transitionValueSchema = z
  .union([z.string().max(2048), z.number().finite(), z.null()])
  .refine(
    (value) =>
      typeof value !== "string" ||
      !/[\\\u0000-\u001f\u007f<>]|\/\*|\*\/|(?:url|expression)\s*\(|javascript:/i.test(
        value,
      ),
    "must be a safe animation value",
  );

const framePropertySchema = z
  .string()
  .max(100)
  .regex(/^(?:--[a-z0-9_-]+|-?[a-z][a-z0-9-]*)$/i);

const keyframesSchema = z.unknown().superRefine((value, context) => {
  const validateRecord = (
    frame: unknown,
    path: Array<string | number>,
    propertyIndexed: boolean,
  ) => {
    if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
      context.addIssue({
        code: "custom",
        path,
        message: "must be an animation keyframe object",
      });
      return;
    }

    const entries = Object.entries(frame);
    if (entries.length > 100) {
      context.addIssue({
        code: "custom",
        path,
        message: "has too many animated properties",
      });
      return;
    }

    for (const [property, rawValue] of entries) {
      if (property === "offset") {
        const offsets = Array.isArray(rawValue) ? rawValue : [rawValue];
        if (
          offsets.length > 100 ||
          offsets.some(
            (offset) =>
              typeof offset !== "number" ||
              !Number.isFinite(offset) ||
              offset < 0 ||
              offset > 1,
          )
        ) {
          context.addIssue({
            code: "custom",
            path: [...path, property],
            message: "offsets must be between 0 and 1",
          });
        }
        continue;
      }
      if (property === "easing") {
        const easings = Array.isArray(rawValue) ? rawValue : [rawValue];
        if (
          easings.length > 100 ||
          easings.some((easing) => !easingSchema.safeParse(easing).success)
        ) {
          context.addIssue({
            code: "custom",
            path: [...path, property],
            message: "contains an unsupported easing",
          });
        }
        continue;
      }
      if (property === "composite") {
        const composites = Array.isArray(rawValue) ? rawValue : [rawValue];
        if (
          composites.length > 100 ||
          composites.some(
            (composite) =>
              !["replace", "add", "accumulate"].includes(String(composite)),
          )
        ) {
          context.addIssue({
            code: "custom",
            path: [...path, property],
            message: "contains an unsupported composite mode",
          });
        }
        continue;
      }
      if (
        !framePropertySchema.safeParse(property).success ||
        ["-moz-binding", "behavior", "src"].includes(property.toLowerCase()) ||
        /^on/i.test(property)
      ) {
        context.addIssue({
          code: "custom",
          path: [...path, property],
          message: "contains an unsupported animated property",
        });
      }

      const values =
        propertyIndexed && Array.isArray(rawValue) ? rawValue : [rawValue];
      if (
        values.length > 100 ||
        values.some((entry) => !transitionValueSchema.safeParse(entry).success)
      ) {
        context.addIssue({
          code: "custom",
          path: [...path, property],
          message: "contains an unsafe animation value",
        });
      }
    }
  };

  if (Array.isArray(value)) {
    if (value.length < 1 || value.length > 100) {
      context.addIssue({
        code: "custom",
        message: "must contain between 1 and 100 keyframes",
      });
      return;
    }
    value.forEach((frame, index) => validateRecord(frame, [index], false));
    return;
  }
  validateRecord(value, [], true);
});

export const SlideTransitionPhaseSchema = z
  .object({
    keyframes: keyframesSchema,
    ...timingOptions,
  })
  .strict();

export const SlideTransitionSchema = z
  .object({
    duration: z.number().finite().min(0).max(10_000),
    easing: easingSchema.optional(),
    enter: SlideTransitionPhaseSchema.optional(),
    exit: SlideTransitionPhaseSchema.optional(),
    morph: z.union([z.boolean(), z.object(timingOptions).strict()]).optional(),
    throughBackground: z.boolean().optional(),
  })
  .strict();

export type SlideTransitionValue = string | number | null;
export type SlideTransitionKeyframe = Record<string, SlideTransitionValue>;
export type SlideTransitionKeyframes =
  | SlideTransitionKeyframe[]
  | Record<string, SlideTransitionValue | readonly SlideTransitionValue[]>;
export type SlideTransitionPhase = {
  keyframes: SlideTransitionKeyframes;
  duration?: number;
  easing?: string;
  delay?: number;
};
export type SlideTransition = {
  duration: number;
  easing?: string;
  enter?: SlideTransitionPhase;
  exit?: SlideTransitionPhase;
  morph?: boolean | { duration?: number; easing?: string; delay?: number };
  throughBackground?: boolean;
};

export function isSlideTransition(value: unknown): value is SlideTransition {
  return SlideTransitionSchema.safeParse(value).success;
}
