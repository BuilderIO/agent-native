import { z } from "zod";

/**
 * Shared shape for the `image` and `video` docs blocks: full width, or
 * aligned to one side with markdown "text" as the paired content on the
 * other side. Kept in one place so both blocks validate `src`/`width`/etc
 * identically instead of drifting.
 */
export type MediaAlign = "full" | "left" | "right";

/** Rejects javascript:/data:/vbscript:/file:/protocol-relative sources —
 *  only an absolute path or an https(s) URL is accepted. */
export const mediaSrcSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .regex(/^(https?:\/\/|\/)/i, {
    message: "src must be an absolute path (/...) or an https URL",
  });

export const mediaAlignSchema = z.enum(["full", "left", "right"]).optional();

/** Pixel width hint for the media column when aligned left/right. */
export const mediaWidthSchema = z.number().int().min(80).max(800).optional();

export const mediaCaptionSchema = z.string().trim().max(400).optional();

/** Markdown paired text, rendered beside the media when aligned. */
export const mediaTextSchema = z.string().max(4_000).optional();
