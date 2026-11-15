import { z } from "zod";

import { MAX_FIG_FRAME_HTML_BYTES } from "./fig-to-frames.js";

/** One frame's HTML: the bound Design's HTML importer already applies. */
export const MAX_FIGMA_REFERENCE_FRAME_HTML_CHARS = MAX_FIG_FRAME_HTML_BYTES;
/** Every frame together, so one attachment cannot write unbounded screens. */
export const MAX_FIGMA_REFERENCE_TOTAL_HTML_CHARS = 64 * 1024 * 1024;

/** One decoded Figma frame, as the composer attaches it for reference. */
export const figmaReferenceFrameSchema = z.object({
  /** Null when Figma's clipboard carried no frame name. */
  name: z.string().nullable(),
  width: z.number().optional(),
  height: z.number().optional(),
  html: z.string().max(MAX_FIGMA_REFERENCE_FRAME_HTML_CHARS),
});

export const MAX_FIGMA_REFERENCE_FRAMES = 1000;

/** A linked Figma page imports at most this many of its top-level frames. */
export const MAX_FIGMA_PAGE_IMPORT_FRAMES = 50;

export const figmaReferencePayloadSchema = z
  .object({
    frames: z
      .array(figmaReferenceFrameSchema)
      .min(1)
      .max(MAX_FIGMA_REFERENCE_FRAMES),
    /** Frames in the source, including any left out of `frames`. */
    frameCount: z.number().int().positive(),
    unresolvedImages: z.number().int().nonnegative(),
  })
  .superRefine((payload, ctx) => {
    if (
      figmaReferenceHtmlChars(payload.frames) >
      MAX_FIGMA_REFERENCE_TOTAL_HTML_CHARS
    )
      ctx.addIssue({
        code: "custom",
        path: ["frames"],
        message: "The frames' HTML is larger than one attachment holds.",
      });
  });

export function figmaReferenceHtmlChars(
  frames: ReadonlyArray<{ html: string }>,
): number {
  return frames.reduce((total, frame) => total + frame.html.length, 0);
}

/**
 * Why a decoded payload is too large to attach, in the user's terms, or null.
 * Checked before the schema so an oversized file gets this message instead of
 * a generic parse failure.
 */
export function figmaReferenceSizeProblem(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || !("frames" in raw)) return null;
  const frames: unknown = raw.frames;
  if (!Array.isArray(frames)) return null;
  const htmls = frames.flatMap((frame: unknown) =>
    frame &&
    typeof frame === "object" &&
    "html" in frame &&
    typeof frame.html === "string"
      ? [frame.html]
      : [],
  );
  const tip =
    "Copy the frames you need in Figma and paste them into the prompt instead.";
  if (frames.length > MAX_FIGMA_REFERENCE_FRAMES)
    return `This Figma file has ${frames.length} frames, more than the ${MAX_FIGMA_REFERENCE_FRAMES} one attachment holds. ${tip}`;
  if (htmls.some((html) => html.length > MAX_FIGMA_REFERENCE_FRAME_HTML_CHARS))
    return `A frame in this Figma file is larger than the ${Math.round(MAX_FIGMA_REFERENCE_FRAME_HTML_CHARS / 1024 / 1024)} MB one screen can hold. ${tip}`;
  if (
    figmaReferenceHtmlChars(htmls.map((html) => ({ html }))) >
    MAX_FIGMA_REFERENCE_TOTAL_HTML_CHARS
  )
    return `This Figma file's frames are larger than the ${Math.round(MAX_FIGMA_REFERENCE_TOTAL_HTML_CHARS / 1024 / 1024)} MB one attachment holds. ${tip}`;
  return null;
}

export type FigmaReferenceFrame = z.infer<typeof figmaReferenceFrameSchema>;
export type FigmaReferencePayload = z.infer<typeof figmaReferencePayloadSchema>;
