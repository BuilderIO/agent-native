import { z } from "zod";

const percentSchema = z.number().finite().min(0).max(100);

export const slideCommentAnchorSchema = z
  .object({
    x: percentSchema,
    y: percentSchema,
    targetText: z.string().max(200).optional(),
    objectId: z.string().trim().min(1).max(200).optional(),
    objectX: percentSchema.optional(),
    objectY: percentSchema.optional(),
  })
  .strict()
  .refine(
    (anchor) =>
      anchor.objectId
        ? anchor.objectX !== undefined && anchor.objectY !== undefined
        : anchor.objectX === undefined && anchor.objectY === undefined,
    "object-relative coordinates require an object ID and both coordinates",
  );

export interface SlideCommentAnchor {
  x: number;
  y: number;
  targetText?: string;
  objectId?: string;
  objectX?: number;
  objectY?: number;
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
