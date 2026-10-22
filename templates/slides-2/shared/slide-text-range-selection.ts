import { z } from "zod";

export const MAX_SLIDE_TEXT_RANGE_EXPECTED_TEXT_LENGTH = 10_000;

export const slideTextRangeSelectionSchema = z
  .object({
    slideId: z.string().min(1),
    sourceLine: z.number().int().min(1),
    sourceColumn: z.number().int().min(0),
    sourceRevision: z.number().int().positive(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    start: z.number().int().min(0),
    end: z.number().int().min(1),
    expectedText: z
      .string()
      .min(1)
      .max(MAX_SLIDE_TEXT_RANGE_EXPECTED_TEXT_LENGTH),
  })
  .strict()
  .refine(
    ({ start, end, expectedText }) => end > start && end <= expectedText.length,
    "text range offsets must select text within expectedText",
  );

export type SlideTextRangeSelection = z.infer<
  typeof slideTextRangeSelectionSchema
>;

export function currentSlideTextRangeSelection(
  value: unknown,
  sourceIdentity: {
    slideId: string;
    revision: number;
    sourceHash: string;
  } | null,
  locator: { line: number; column: number } | null,
): SlideTextRangeSelection | null {
  if (!sourceIdentity || !locator) return null;
  const parsed = slideTextRangeSelectionSchema.safeParse(value);
  if (!parsed.success) return null;

  const selection = parsed.data;
  return selection.slideId === sourceIdentity.slideId &&
    selection.sourceRevision === sourceIdentity.revision &&
    selection.sourceHash === sourceIdentity.sourceHash &&
    selection.sourceLine === locator.line &&
    selection.sourceColumn === locator.column
    ? selection
    : null;
}
