import { z } from "zod";

import {
  PRESET_REFERENCE_SUBJECT_IMAGES_ERROR,
  PRESET_REFERENCE_TOTAL_IMAGES_ERROR,
} from "../server/lib/preset-references.js";
import { PRESET_REFERENCE_ROLES } from "../shared/api.js";

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

export const presetReferenceSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .max(40),
  label: z.string().min(1).max(60),
  role: z.enum(PRESET_REFERENCE_ROLES),
  description: z.string().max(400).optional(),
  assetIds: z.array(z.string().min(1)).max(4),
  variable: z.coerce.boolean(),
  required: z.coerce.boolean(),
});

export const generationPresetSettingsSchema = z
  .object({
    includeLogo: z.coerce.boolean().optional(),
    skeletonSpec: presetSkeletonSpecSchema.nullable().optional(),
    presetReferences: z
      .array(presetReferenceSchema)
      .max(6)
      .nullable()
      .optional(),
  })
  .superRefine((settings, ctx) => {
    const references = settings.presetReferences ?? [];
    const seen = new Set<string>();
    for (const entry of references) {
      if (seen.has(entry.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["presetReferences"],
          message: "Reference entry ids must be unique.",
        });
        break;
      }
      seen.add(entry.id);
      if (entry.required && !entry.variable && entry.assetIds.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["presetReferences", entry.id],
          message:
            "A required fixed reference needs at least one image. Pin images or mark it as variable.",
        });
      }
    }
    // Budget with the minimum images each entry consumes at run time: a
    // required entry with no pinned images still needs at least one fill
    // image, so reserve it here or the saved preset can never generate.
    const minimumImages = (entry: { required: boolean; assetIds: string[] }) =>
      Math.max(entry.assetIds.length, entry.required ? 1 : 0);
    const total = references.reduce(
      (sum, entry) => sum + minimumImages(entry),
      0,
    );
    if (total > 8) {
      ctx.addIssue({
        code: "custom",
        path: ["presetReferences"],
        message: PRESET_REFERENCE_TOTAL_IMAGES_ERROR,
      });
    }
    const subjectTotal = references
      .filter((entry) => entry.role === "subject")
      .reduce((sum, entry) => sum + minimumImages(entry), 0);
    if (subjectTotal > 4) {
      ctx.addIssue({
        code: "custom",
        path: ["presetReferences"],
        message: PRESET_REFERENCE_SUBJECT_IMAGES_ERROR,
      });
    }
  })
  .catchall(z.unknown());
