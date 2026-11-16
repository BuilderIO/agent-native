import { z } from "zod";

export const booleanParam = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  return value;
}, z.boolean());

const NUMERIC = /^\d+(?:\.\d+)?$/;

/** A numeric string becomes its number; anything else stays as sent, for the schema to reject. */
function numericOrAsSent(value: number | string): number | string {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return NUMERIC.test(trimmed) ? Number(trimmed) : value;
}

/**
 * A list of numbers sent as an array, one number, one numeric string, or a
 * comma-separated string, as MCP models, query strings and the CLI each send
 * it. `item` validates each entry, so a bad one is rejected, never read as 0.
 * The tool input schema still advertises the raw shapes.
 */
export function numberListParam(list: z.ZodType<number[]>) {
  const raw = z.union([z.number(), z.string()]);
  return (
    z
      .union([z.array(raw), raw])
      .transform((value): unknown[] =>
        (Array.isArray(value)
          ? value
          : typeof value === "string"
            ? value.split(",")
            : [value]
        ).map(numericOrAsSent),
      )
      // The list schema rejects any entry that is not a number it accepts.
      .pipe(list as z.ZodType<number[], unknown[]>)
  );
}
