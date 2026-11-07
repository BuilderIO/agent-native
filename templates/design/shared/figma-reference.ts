import { z } from "zod";

/** One decoded Figma frame, as the composer attaches it for reference. */
export const figmaReferenceFrameSchema = z.object({
  /** Null when Figma's clipboard carried no frame name. */
  name: z.string().nullable(),
  width: z.number().optional(),
  height: z.number().optional(),
  html: z.string(),
});

export const MAX_FIGMA_REFERENCE_FRAMES = 1000;

export const figmaReferencePayloadSchema = z.object({
  frames: z
    .array(figmaReferenceFrameSchema)
    .min(1)
    .max(MAX_FIGMA_REFERENCE_FRAMES),
  /** Frames in the source, including any left out of `frames`. */
  frameCount: z.number().int().positive(),
  unresolvedImages: z.number().int().nonnegative(),
});

export type FigmaReferenceFrame = z.infer<typeof figmaReferenceFrameSchema>;
export type FigmaReferencePayload = z.infer<typeof figmaReferencePayloadSchema>;
