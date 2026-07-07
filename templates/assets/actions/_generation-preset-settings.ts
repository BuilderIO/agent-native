import { z } from "zod";

const fractionSchema = z.coerce.number().min(0).max(1);
const positiveFractionSchema = z.coerce.number().min(0.02).max(1);

export const presetSkeletonSpecSchema = z.object({
  background: z.object({
    type: z.literal("asset"),
    assetId: z.string().min(1),
  }),
  mask: z
    .object({
      type: z.literal("asset"),
      assetId: z.string().min(1),
    })
    .optional(),
  contentMode: z.enum(["cutout", "fill"]),
  contentRegion: z
    .object({
      x: fractionSchema,
      y: fractionSchema,
      w: positiveFractionSchema,
      h: positiveFractionSchema,
    })
    .optional(),
  dropShadow: z.coerce.boolean().optional(),
  foreground: z
    .array(
      z.object({
        source: z.union([
          z.literal("canonicalLogo"),
          z.object({ assetId: z.string().min(1) }),
        ]),
        x: fractionSchema,
        y: fractionSchema,
        w: positiveFractionSchema,
      }),
    )
    .max(8)
    .optional(),
});

export const generationPresetSettingsSchema = z
  .object({
    includeLogo: z.coerce.boolean().optional(),
    skeletonSpec: presetSkeletonSpecSchema.nullable().optional(),
  })
  .catchall(z.unknown());
