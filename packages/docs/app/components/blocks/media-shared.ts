import { z } from "zod";

export type MediaAlign = "full" | "left" | "right";

export const mediaSrcSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .regex(/^(https?:\/\/|\/(?!\/))/i, {
    message: "src must be an absolute path (/...) or an https URL",
  });

export const mediaAlignSchema = z.enum(["full", "left", "right"]).optional();

export const mediaWidthSchema = z.number().int().min(80).max(800).optional();

export const mediaCaptionSchema = z.string().trim().max(400).optional();

export const mediaTextSchema = z.string().max(4_000).optional();
