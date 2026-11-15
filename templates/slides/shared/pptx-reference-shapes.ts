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
const color = "#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?";
const decimal = "-?\\d+(?:\\.\\d+)?";
const stop = `${color}(?: ${decimal}%)?`;
const fillPattern = new RegExp(
  `^(?:${color}|linear-gradient\\(${decimal}deg, ${stop}(?:, ${stop}){1,15}\\)|radial-gradient\\(circle at ${decimal}% ${decimal}%, ${stop}(?:, ${stop}){1,15}\\))$`,
);

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
  sourceText: z.string().max(500).optional(),
  sourceTextTruncated: z.boolean().optional(),
  fill: z.string().max(256).regex(fillPattern).optional(),
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

function sourceTextForShape(element: ParsedElement) {
  let text = "";
  for (const [index, paragraph] of (element.paragraphs ?? []).entries()) {
    if (index > 0) {
      if (text.length === 500)
        return { sourceText: text, sourceTextTruncated: true };
      text += "\n";
    }
    for (const run of paragraph.runs) {
      const room = 500 - text.length;
      if (run.content.length > room)
        return {
          sourceText: text + run.content.slice(0, room),
          sourceTextTruncated: true,
        };
      text += run.content;
    }
  }
  return { sourceText: text || undefined, sourceTextTruncated: undefined };
}

export function summarizePptxShapes(slides: ParsedSlide[]) {
  const summaries = slides.map(() => ({
    shapes: [] as z.infer<typeof pptxReferenceShapeSchema>[],
    omitted: 0,
  }));
  const positions = slides.map(() => 0);
  const active = new Set(slides.map((_, index) => index));
  let remaining = MAX_TOTAL_SHAPE_CHARS;
  let count = 0;
  while (active.size > 0) {
    for (const slideIndex of active) {
      const elements = slides[slideIndex].elements ?? [];
      while (
        positions[slideIndex] < elements.length &&
        elements[positions[slideIndex]].kind !== "shape" &&
        elements[positions[slideIndex]].kind !== "text"
      ) {
        positions[slideIndex]++;
      }
      if (positions[slideIndex] >= elements.length) {
        active.delete(slideIndex);
        continue;
      }
      const order = positions[slideIndex]++;
      const element = elements[order];
      const summary = summaries[slideIndex];
      if (count >= MAX_SHAPES || remaining <= 0) {
        summary.omitted++;
        continue;
      }
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
        ...(element.kind === "text" ? sourceTextForShape(element) : {}),
      } satisfies Omit<ParsedElement, "id"> & {
        order: number;
        adjustments?: { name: string; value: number }[];
        sourceText?: string;
        sourceTextTruncated?: boolean;
      });
      if (!candidate.success) {
        summary.omitted++;
        continue;
      }
      const size = JSON.stringify(candidate.data).length;
      if (size > MAX_SHAPE_CHARS || size > remaining) {
        summary.omitted++;
        continue;
      }
      summary.shapes.push(candidate.data);
      remaining -= size;
      count++;
    }
  }
  return summaries;
}
