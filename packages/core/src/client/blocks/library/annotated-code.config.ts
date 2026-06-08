import { z } from "zod";
import type { BlockMdxConfig } from "../types.js";

/**
 * Pure (React-free) part of the PLAN-SPECIFIC `annotated-code` block: its data
 * schema and MDX round-trip config. Shared by the server MDX adapter
 * (`plan-mdx.ts` via `plan-block-registry.ts`) and the client spec
 * (`planBlocks.tsx`). Keeping this React-free means importing it into a server
 * module never pulls React into the Nitro/SSR bundle.
 *
 * The block renders a Stripe-docs / Sourcegraph "explain this code" style
 * walkthrough: a line-numbered monospace code surface where annotated line
 * ranges get a highlight band + numbered gutter marker, paired with a list of
 * line-anchored notes (each note targets a 1-based `lines` ref like `"3"` or
 * `"3-5"`). Hovering a note highlights its lines, and vice-versa.
 *
 * The schema MUST stay data-compatible with the `annotated-code` branch of
 * `planBlockSchema` (`plan-content.ts`), and the MDX `tag` (`AnnotatedCode`) +
 * flat attribute shape MUST match that inline member so stored `.mdx`
 * round-trips. `code` is a multiline string ATTRIBUTE (the shared `prop()`
 * encoder round-trips multiline strings cleanly, and keeping it an attribute —
 * not MDX children — avoids the source being reflowed as prose); `annotations`
 * is a JSON array attribute.
 */

/** One line-anchored note over the code. */
export interface AnnotatedCodeAnnotation {
  /** 1-based line reference: a single line `"3"` or an inclusive range `"3-5"`. */
  lines: string;
  /** Optional short label shown before the note (e.g. "Lookup"). */
  label?: string;
  /** The note prose (markdown), rendered through `ctx.renderMarkdown`. */
  note: string;
}

export interface AnnotatedCodeData {
  /** Optional file path shown in the header (e.g. `src/server/auth.ts`). */
  filename?: string;
  /** Optional language label (e.g. `ts`). Cosmetic chip + future highlighting. */
  language?: string;
  /** The source the walkthrough annotates. Rendered line-numbered. */
  code: string;
  /** Line-anchored notes. */
  annotations?: AnnotatedCodeAnnotation[];
}

/**
 * A 1-based line reference: `"3"` or `"3-5"` (inclusive). Whitespace tolerant.
 * The renderer parses this defensively too, but the schema rejects clearly
 * malformed refs so authored/agent-generated data stays clean.
 */
const lineRefSchema = z
  .string()
  .trim()
  .regex(/^\d+(\s*-\s*\d+)?$/, {
    message: 'lines must be a 1-based line ref like "3" or "3-5"',
  })
  .max(40);

const annotationSchema = z.object({
  lines: lineRefSchema,
  label: z.string().trim().max(160).optional(),
  note: z.string().trim().min(1).max(4_000),
}) as z.ZodType<AnnotatedCodeAnnotation>;

/**
 * Data-compatible with the inline `annotated-code` member of `planBlockSchema`
 * (`plan-content.ts`). `code` is the only required field; `annotations` defaults
 * to omitted so a fresh block validates from `{ code: "…" }`.
 */
export const annotatedCodeSchema = z.object({
  filename: z.string().trim().max(400).optional(),
  language: z.string().trim().max(40).optional(),
  code: z.string().max(100_000),
  annotations: z.array(annotationSchema).max(80).optional(),
}) as unknown as z.ZodType<AnnotatedCodeData>;

/**
 * MDX config: `<AnnotatedCode filename language code annotations />` self-closing
 * form. Insertion order of `toAttrs` is the on-disk attribute order. `code` is a
 * multiline string attribute (round-trips through the shared `prop()` encoder);
 * `annotations` is a JSON array attribute. `fromAttrs` mirrors a forgiving parse
 * (`code ?? ""`, `annotations ?? []`, optional `filename`/`language` undefined
 * when absent) so a plan missing an attribute still parses.
 */
export const annotatedCodeMdx: BlockMdxConfig<AnnotatedCodeData> = {
  tag: "AnnotatedCode",
  toAttrs: (data) => ({
    filename: data.filename,
    language: data.language,
    code: data.code,
    annotations: data.annotations,
  }),
  fromAttrs: (attrs) => ({
    filename: attrs.string("filename"),
    language: attrs.string("language"),
    code: attrs.string("code") ?? "",
    annotations: attrs.array<AnnotatedCodeAnnotation>("annotations") ?? [],
  }),
};
