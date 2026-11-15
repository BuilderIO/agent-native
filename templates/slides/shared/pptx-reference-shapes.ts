import { z } from "zod";

import type {
  ParsedElement,
  ParsedSlide,
} from "../server/handlers/import/pptx-parser.js";

const number = z.number().finite();
const point = z.object({ x: number, y: number });
const command = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("moveTo"), points: z.array(point).length(1) }),
  z.object({ kind: z.literal("lnTo"), points: z.array(point).length(1) }),
  z.object({ kind: z.literal("quadBezTo"), points: z.array(point).length(2) }),
  z.object({ kind: z.literal("cubicBezTo"), points: z.array(point).length(3) }),
  z.object({
    kind: z.literal("arcTo"),
    wR: number,
    hR: number,
    stAng: number,
    swAng: number,
  }),
  z.object({ kind: z.literal("close") }),
]);
const token = z
  .string()
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/);
const lineEnd = z.object({
  type: token,
  w: token.optional(),
  len: token.optional(),
});

export const pptxReferenceShapeSchema = z.object({
  order: z.number().int().nonnegative(),
  kind: z.enum(["shape", "text"]),
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number.optional(),
  flipH: z.boolean().optional(),
  flipV: z.boolean().optional(),
  shapeType: token.optional(),
  adjustments: z
    .array(z.object({ name: z.string().regex(/^adj\d{0,2}$/), value: number }))
    .max(20)
    .optional(),
  geometry: z
    .object({
      kind: z.literal("custom"),
      paths: z
        .array(
          z.object({
            w: number.positive(),
            h: number.positive(),
            commands: z.array(command).min(1).max(100),
          }),
        )
        .min(1)
        .max(8),
    })
    .optional(),
  fill: z
    .string()
    .max(256)
    .regex(/^[#(),.%\sa-zA-Z0-9-]+$/)
    .optional(),
  lineColor: z
    .string()
    .max(64)
    .regex(/^#[0-9a-fA-F]{3,8}$/)
    .optional(),
  lineWidth: number.optional(),
  lineHeadEnd: lineEnd.optional(),
  lineTailEnd: lineEnd.optional(),
});

const MAX_SHAPE_CHARS = 3000;
const MAX_TOTAL_SHAPE_CHARS = 6000;
const MAX_SHAPES = 100;

export function summarizePptxShapes(slides: ParsedSlide[]) {
  let remaining = MAX_TOTAL_SHAPE_CHARS;
  let count = 0;
  return slides.map((slide) => {
    const shapes: z.infer<typeof pptxReferenceShapeSchema>[] = [];
    let omitted = 0;
    for (const [order, element] of (slide.elements ?? []).entries()) {
      if (
        element.kind !== "shape" &&
        !(
          element.kind === "text" &&
          (element.shapeType ||
            element.geometry ||
            element.fill ||
            element.lineColor)
        )
      )
        continue;
      const adjustments = element.shapeAdjustments
        ? Object.entries(element.shapeAdjustments).map(([name, value]) => ({
            name,
            value,
          }))
        : undefined;
      const candidate = pptxReferenceShapeSchema.safeParse({
        order,
        kind: element.kind,
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        rotation: element.rotation,
        flipH: element.flipH,
        flipV: element.flipV,
        shapeType: element.shapeType,
        adjustments,
        geometry: element.geometry,
        fill: element.fill,
        lineColor: element.lineColor,
        lineWidth: element.lineWidth,
        lineHeadEnd: element.lineHeadEnd,
        lineTailEnd: element.lineTailEnd,
      } satisfies Omit<ParsedElement, "id"> & {
        order: number;
        adjustments?: { name: string; value: number }[];
      });
      if (!candidate.success) {
        omitted++;
        continue;
      }
      const size = JSON.stringify(candidate.data).length;
      if (size > MAX_SHAPE_CHARS || size > remaining || count >= MAX_SHAPES) {
        omitted++;
        continue;
      }
      remaining -= size;
      count++;
      shapes.push(candidate.data);
    }
    return { shapes, omitted };
  });
}
