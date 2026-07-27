import { z } from "zod";

import type { BlockMdxConfig } from "../types.js";

/**
 * Pure (React-free) part of the PLAN-SPECIFIC diff block: its data schema and MDX
 * round-trip config. Shared by the server MDX adapter (`plan-mdx.ts` via
 * `plan-block-registry.ts`) and the client spec (`planBlocks.tsx`). Keeping this
 * React-free means importing it into a server module never pulls React (or the
 * `diff` line-differ used only by the renderer) into the Nitro/SSR bundle.
 *
 * The schema MUST stay data-compatible with the `diff` branch of `planBlockSchema`
 * (`plan-content.ts`), and the MDX `tag` + flat attribute shape MUST match the
 * `<Diff filename language mode before after />` self-closing encoding so stored
 * `.mdx` round-trips. The `before`/`after` source lives in ATTRIBUTES (not MDX
 * children) — the shared `prop()` encoder round-trips multiline strings cleanly,
 * and keeping them attributes avoids the code being reflowed as prose.
 */

/** Rendering layout for the diff body. */
export type DiffMode = "unified" | "split";

/**
 * One line-anchored note attached to a diff, mirroring the `annotated-code`
 * annotation shape but adding `side`. The `lines` ref is 1-based against the
 * chosen side's source: `side: "after"` (the default) targets the new file's
 * line numbers, `side: "before"` the old file's. Optional ⇒ a diff without
 * annotations renders exactly as before.
 */
export interface DiffAnnotation {
  /** Which side the line ref targets; defaults to "after". */
  side?: "before" | "after";
  /** 1-based line ref against that side's text: "13" or "13-15" (inclusive). */
  lines: string;
  /** Optional short label shown before the note (e.g. "Validation"). */
  label?: string;
  /** The note prose (markdown), rendered through `ctx.renderMarkdown`. */
  note: string;
}

export interface DiffData {
  /** Optional file path shown in the header (e.g. `src/add.ts`). */
  filename?: string;
  /** Optional language label rendered as a chip (e.g. `ts`). Purely cosmetic. */
  language?: string;
  /** Original ("before") source. */
  before: string;
  /** New ("after") source. */
  after: string;
  /** Layout: split (default, side-by-side) or unified (one column). */
  mode?: DiffMode;
  /** Line-anchored notes over the before/after sides. */
  annotations?: DiffAnnotation[];
}

/**
 * A 1-based line reference: `"3"` or `"3-5"` (inclusive). Whitespace tolerant.
 * Matches the `annotated-code` line-ref schema so both blocks validate refs
 * identically.
 */
const lineRefSchema = z
  .string()
  .trim()
  .regex(/^\d+(\s*-\s*\d+)?$/, {
    message: 'lines must be a 1-based line ref like "3" or "3-5"',
  })
  .max(40);

const diffAnnotationSchema = z.object({
  side: z.enum(["before", "after"]).optional(),
  lines: lineRefSchema,
  label: z.string().trim().max(160).optional(),
  note: z.string().trim().min(1).max(4_000),
}) as z.ZodType<DiffAnnotation>;

export const diffSchema = z.object({
  filename: z.string().trim().max(400).optional(),
  language: z.string().trim().max(40).optional(),
  before: z.string().max(100_000),
  after: z.string().max(100_000),
  mode: z.enum(["unified", "split"]).optional(),
  annotations: z.array(diffAnnotationSchema).max(80).optional(),
}) as unknown as z.ZodType<DiffData>;

/**
 * MDX config: `filename`, `language`, `mode`, `before`, `after`, and
 * `annotations` are flat attributes — the
 * `<Diff id … filename language mode before after annotations />` self-closing
 * form. Insertion order of `toAttrs` is the on-disk attribute order. `before`/
 * `after` are multiline string attributes (round-trip through the shared `prop()`
 * encoder); `annotations` is a JSON array attribute, encoded the same way as the
 * `annotated-code` block. `fromAttrs` mirrors a forgiving parse (`before ?? ""`,
 * `after ?? ""`, optional `filename`/`language`/`mode`/`annotations` undefined
 * when absent) so a plan missing an attribute still parses without re-emitting
 * unauthored empty arrays.
 */
export const diffMdx: BlockMdxConfig<DiffData> = {
  tag: "Diff",
  toAttrs: (data) => ({
    filename: data.filename,
    language: data.language,
    mode: data.mode,
    before: data.before,
    after: data.after,
    annotations: data.annotations,
  }),
  fromAttrs: (attrs) => ({
    filename: attrs.string("filename"),
    language: attrs.string("language"),
    mode: attrs.string("mode") as DiffMode | undefined,
    before: attrs.string("before") ?? "",
    after: attrs.string("after") ?? "",
    annotations: attrs.array<DiffAnnotation>("annotations"),
  }),
};
