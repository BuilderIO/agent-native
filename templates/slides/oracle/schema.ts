import { z } from "zod";

// The md ledger uses a digit section for measured rows and a letter family for
// the text-fitting ledger (T, H, V, P, E, O, F, K), so the family is either.
export const ORACLE_ID_PATTERN =
  /^(?:\d+|[A-Z])\.\d+[a-z]?$|^G\.[a-z0-9][a-z0-9.-]*$/;

export const ORACLE_HIT_VALUES = [
  "nothing",
  "object",
  "group",
  "text",
  "child",
  "sibling",
] as const;
// The cursor classes the oracle channel reports (interaction-oracle.md, "Method and calibration").
export const ORACLE_CURSOR_VALUES = [
  "move",
  "text",
  "default",
  "crosshair",
  "nw-resize",
  "n-resize",
  "ne-resize",
  "e-resize",
  "se-resize",
  "s-resize",
  "sw-resize",
  "w-resize",
] as const;
// A compound ledger cell cannot be one value: keep its lower bound here and
// the full cell in confidenceNote.
export const ORACLE_CONFIDENCE_VALUES = [
  "high",
  "medium-high",
  "medium",
  "low-medium",
  "low",
  "gap",
] as const;
export const ORACLE_STATUS_VALUES = ["measured", "deviation", "gap"] as const;
export const ORACLE_CLAIM_VALUES = ["positive", "negative", "mixed"] as const;
export const ORACLE_INPUT_PATH_VALUES = [
  "raw-pointer",
  "cdp-input",
  "claude-in-chrome",
  "unknown",
] as const;
export const ORACLE_EXPECT_KEYS = ["hit", "cursor", "outlineVisible"] as const;

export const OracleExpectSchema = z
  .strictObject({
    hit: z.enum(ORACLE_HIT_VALUES).optional(),
    cursor: z.enum(ORACLE_CURSOR_VALUES).optional(),
    outlineVisible: z.boolean().optional(),
  })
  // An expect with no keys would compare as a vacuous match.
  .refine(
    (value) => ORACLE_EXPECT_KEYS.some((key) => value[key] !== undefined),
    {
      message: "expect must define at least one of hit, cursor, outlineVisible",
    },
  );

export const OracleRowSchema = z
  .strictObject({
    id: z.string().regex(ORACLE_ID_PATTERN),
    family: z.string().min(1),
    familyName: z.string().min(1),
    probe: z.string().min(1),
    result: z.string().min(1),
    notes: z.string(),
    confidence: z.enum(ORACLE_CONFIDENCE_VALUES),
    confidenceNote: z.string().min(1).optional(),
    status: z.enum(ORACLE_STATUS_VALUES),
    claim: z.enum(ORACLE_CLAIM_VALUES),
    inputPath: z.enum(ORACLE_INPUT_PATH_VALUES),
    source: z.string().min(1).optional(),
    expect: OracleExpectSchema.optional(),
  })
  // A gap row was never measured, so no measurement checks an expect on it.
  .refine((row) => row.status !== "gap" || row.expect === undefined, {
    message: "a gap row cannot carry an expect, since nothing measured it",
  });

export const OracleFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  rows: z.array(OracleRowSchema),
});

export type OracleExpect = z.infer<typeof OracleExpectSchema>;
export type OracleExpectKey = (typeof ORACLE_EXPECT_KEYS)[number];
export type OracleRow = z.infer<typeof OracleRowSchema>;
export type OracleFile = z.infer<typeof OracleFileSchema>;
