import { z } from "zod";

export const MAX_HANDOFF_RECORDS = 500;
export const MAX_HANDOFF_RECORD_PROMPT_LENGTH = 64 * 1024;

export const visualEditHandoffRecordSchema = z.object({
  kind: z.enum(["style", "tweak"]),
  key: z.string().min(1).max(1_024),
  value: z.union([z.string().max(4_096), z.number(), z.boolean()]),
  prompt: z.string().max(MAX_HANDOFF_RECORD_PROMPT_LENGTH),
});

/**
 * One pending change in a visual-edit handoff. A record is self-contained:
 * its prompt carries its own instructions, so dropping or replacing another
 * record never loses this one's text. Two records describe the same change
 * only when kind, key, and value all match.
 */
export type VisualEditHandoffRecord = z.infer<
  typeof visualEditHandoffRecordSchema
>;

export function handoffRecordSlot(record: {
  kind: string;
  key: string;
}): string {
  return `${record.kind}\u0000${record.key}`;
}

export function sameHandoffRecordValue(
  a: VisualEditHandoffRecord["value"],
  b: VisualEditHandoffRecord["value"],
): boolean {
  return typeof a === typeof b && Object.is(a, b);
}

/**
 * Reads the stored record list. A row written before records existed (or a
 * corrupt column) yields `unreadable`, never an empty list that would read as
 * "this handoff covers nothing".
 */
export function parseHandoffRecords(
  stored: string,
):
  | { status: "readable"; records: VisualEditHandoffRecord[] }
  | { status: "unreadable" } {
  try {
    const parsed = z
      .array(visualEditHandoffRecordSchema)
      .safeParse(JSON.parse(stored));
    return parsed.success
      ? { status: "readable", records: parsed.data }
      : { status: "unreadable" };
  } catch {
    return { status: "unreadable" };
  }
}
