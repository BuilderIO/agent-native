import { z } from "zod";

import type { BlockMdxConfig } from "../types.js";

/**
 * Pure (React-free) part of the PLAN-SPECIFIC mermaid block: its data schema and
 * MDX round-trip config. Shared by the server MDX adapter (`plan-mdx.ts` via
 * `plan-block-registry.ts`) and the client spec (`planBlocks.tsx`). Keeping this
 * React-free means importing it into a server module never pulls React (or the
 * client-only `mermaid` runtime) into the Nitro/SSR bundle.
 *
 * The schema MUST stay data-compatible with the `mermaid` branch of
 * `planBlockSchema` (`plan-content.ts`), and the MDX `tag` + flat `source` /
 * `caption` attribute shape MUST match the `<Mermaid source caption />` encoding
 * so stored `.mdx` round-trips. The diagram code lives in the `source` ATTRIBUTE
 * (not MDX children) — the shared `prop()` encoder round-trips multiline strings
 * cleanly, and keeping it an attribute avoids the source being reflowed as prose.
 */

export interface MermaidData {
  /** Mermaid diagram definition (flowchart/sequence/etc.) edited as raw text. */
  source: string;
  /** Optional short caption rendered (muted) under the diagram. */
  caption?: string;
}

export const mermaidSchema = z.object({
  source: z.string().max(50_000),
  caption: z.string().trim().max(400).optional(),
}) as unknown as z.ZodType<MermaidData>;

/**
 * MDX config: `source` and `caption` are flat attributes — the `<Mermaid id …
 * source caption />` self-closing form. Insertion order of `toAttrs` is the
 * on-disk attribute order (`source` → `caption`). `fromAttrs` mirrors a
 * forgiving parse (`source ?? ""`, `caption` undefined when absent) so a plan
 * missing the attribute still parses.
 */
export const mermaidMdx: BlockMdxConfig<MermaidData> = {
  tag: "Mermaid",
  toAttrs: (data) => ({
    source: data.source,
    caption: data.caption,
  }),
  fromAttrs: (attrs) => ({
    source: attrs.string("source") ?? "",
    caption: attrs.string("caption"),
  }),
};
