import { z } from "zod";

const percentSchema = z.number().finite().min(0).max(100);
const sourceLocatorSchema = z
  .object({
    line: z.number().int().min(1).max(256_000),
    column: z.number().int().min(0).max(256_000),
  })
  .strict();
const regionSchema = z
  .object({
    x: percentSchema,
    y: percentSchema,
    width: z.number().finite().gt(0).max(100),
    height: z.number().finite().gt(0).max(100),
  })
  .strict()
  .refine(
    (region) => region.x + region.width <= 100,
    "region exceeds slide width",
  )
  .refine(
    (region) => region.y + region.height <= 100,
    "region exceeds slide height",
  );

export const slideCommentAnchorSchema = z
  .object({
    version: z.literal(1).optional(),
    x: percentSchema,
    y: percentSchema,
    targetText: z.string().max(200).optional(),
    objectId: z.string().trim().min(1).max(200).optional(),
    objectX: percentSchema.optional(),
    objectY: percentSchema.optional(),
    textStartOffset: z.number().int().min(0).max(200_000).optional(),
    textEndOffset: z.number().int().min(1).max(200_000).optional(),
    sourceHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    sourceLocator: sourceLocatorSchema.optional(),
    region: regionSchema.optional(),
  })
  .strict()
  .refine((anchor) => {
    const hasObjectCoordinates =
      anchor.objectX !== undefined || anchor.objectY !== undefined;
    if (anchor.region) {
      return !hasObjectCoordinates;
    }
    if (anchor.objectId) {
      return anchor.objectX !== undefined && anchor.objectY !== undefined;
    }
    if (anchor.sourceLocator) {
      return (
        !hasObjectCoordinates ||
        (anchor.objectX !== undefined && anchor.objectY !== undefined)
      );
    }
    return !hasObjectCoordinates;
  }, "object-relative coordinates require a target and both coordinates")
  .refine(
    (anchor) =>
      (anchor.textStartOffset === undefined) ===
        (anchor.textEndOffset === undefined) &&
      (anchor.textStartOffset === undefined ||
        anchor.textEndOffset! > anchor.textStartOffset),
    "text-relative coordinates require both offsets in increasing order",
  )
  .refine(
    (anchor) =>
      anchor.version === 1
        ? anchor.sourceHash !== undefined &&
          (anchor.sourceLocator !== undefined || anchor.region !== undefined)
        : anchor.sourceHash === undefined &&
          anchor.sourceLocator === undefined &&
          anchor.region === undefined,
    "source anchors require version 1, a source hash, and a source locator or region",
  )
  .refine(
    (anchor) => !(anchor.objectId && anchor.sourceLocator),
    "a comment anchor cannot target both a legacy object and source location",
  )
  .refine(
    (anchor) => !anchor.region || anchor.version === 1,
    "region anchors require version 1",
  );

export interface SlideCommentAnchor {
  version?: 1;
  x: number;
  y: number;
  targetText?: string;
  objectId?: string;
  objectX?: number;
  objectY?: number;
  textStartOffset?: number;
  textEndOffset?: number;
  sourceHash?: string;
  sourceLocator?: { line: number; column: number };
  region?: { x: number; y: number; width: number; height: number };
}

export function parseSlideCommentAnchor(
  value: string | null | undefined,
): SlideCommentAnchor | null {
  if (!value) return null;

  return slideCommentAnchorSchema.parse(JSON.parse(value));
}

export function serializeSlideCommentAnchor(
  anchor: SlideCommentAnchor | null | undefined,
): string | null {
  return anchor ? JSON.stringify(anchor) : null;
}
