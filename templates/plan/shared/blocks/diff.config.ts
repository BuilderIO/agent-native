import { z } from "zod";
import type { BlockMdxConfig } from "@agent-native/core/blocks/server";

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

export interface DiffData {
  /** Optional file path shown in the header (e.g. `src/add.ts`). */
  filename?: string;
  /** Optional language label rendered as a chip (e.g. `ts`). Purely cosmetic. */
  language?: string;
  /** Original ("before") source. */
  before: string;
  /** New ("after") source. */
  after: string;
  /** Layout: unified (default, one column) or split (side-by-side). */
  mode?: DiffMode;
}

export const diffSchema = z.object({
  filename: z.string().trim().max(400).optional(),
  language: z.string().trim().max(40).optional(),
  before: z.string().max(100_000),
  after: z.string().max(100_000),
  mode: z.enum(["unified", "split"]).optional(),
}) as unknown as z.ZodType<DiffData>;

/**
 * MDX config: `filename`, `language`, `mode`, `before`, and `after` are flat
 * attributes — the `<Diff id … filename language mode before after />`
 * self-closing form. Insertion order of `toAttrs` is the on-disk attribute order.
 * `fromAttrs` mirrors a forgiving parse (`before ?? ""`, `after ?? ""`, optional
 * `filename`/`language`/`mode` undefined when absent) so a plan missing an
 * attribute still parses.
 */
export const diffMdx: BlockMdxConfig<DiffData> = {
  tag: "Diff",
  toAttrs: (data) => ({
    filename: data.filename,
    language: data.language,
    mode: data.mode,
    before: data.before,
    after: data.after,
  }),
  fromAttrs: (attrs) => ({
    filename: attrs.string("filename"),
    language: attrs.string("language"),
    mode: attrs.string("mode") as DiffMode | undefined,
    before: attrs.string("before") ?? "",
    after: attrs.string("after") ?? "",
  }),
};
