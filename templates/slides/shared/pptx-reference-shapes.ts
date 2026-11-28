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
    .array(
      z.object({
        name: z.string().regex(/^(?:adj\d{0,2}|hf|vf)$/),
        value: number,
      }),
    )
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

export const MAX_PPTX_SLIDES_IN_CONTEXT = 20;
export const MAX_PPTX_SHAPE_CHARS = 3000;

export function serializePptxReferenceShape(
  shape: z.infer<typeof pptxReferenceShapeSchema>,
): string {
  return JSON.stringify(shape).replace(
    /[\u0085\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
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
  const entries = slides.map((slide, index) => ({
    elements: slide.elements.entries(),
    summary: {
      shapes: [] as z.infer<typeof pptxReferenceShapeSchema>[],
      omitted:
        index < MAX_PPTX_SLIDES_IN_CONTEXT
          ? 0
          : slide.elements.filter(
              (element) => element.kind === "shape" || element.kind === "text",
            ).length,
    },
  }));
  const active = new Set(entries.slice(0, MAX_PPTX_SLIDES_IN_CONTEXT));
  let remaining = MAX_TOTAL_SHAPE_CHARS;
  let count = 0;
  while (active.size > 0) {
    for (const entry of active) {
      const summary = entry.summary;
      let next = entry.elements.next();
      while (
        !next.done &&
        next.value[1].kind !== "shape" &&
        next.value[1].kind !== "text"
      ) {
        next = entry.elements.next();
      }
      if (next.done) {
        active.delete(entry);
        continue;
      }
      const [order, element] = next.value;
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
      });
      if (!candidate.success) {
        summary.omitted++;
        continue;
      }
      const size = serializePptxReferenceShape(candidate.data).length;
      if (size > MAX_PPTX_SHAPE_CHARS || size > remaining) {
        summary.omitted++;
        continue;
      }
      summary.shapes.push(candidate.data);
      remaining -= size;
      count++;
    }
  }
  return entries.map((entry) => entry.summary);
}
