import { z } from "zod";
import type { BlockMdxConfig } from "@agent-native/core/blocks/server";

/**
 * Pure (React-free) part of the PLAN-SPECIFIC `json-explorer` block: its data
 * schema and MDX round-trip config. Shared by the server MDX adapter
 * (`plan-mdx.ts` via `plan-block-registry.ts`) and the client spec
 * (`planBlocks.tsx`). Keeping this React-free means importing it into a server
 * module never pulls React into the Nitro/SSR bundle.
 *
 * The block renders a browser-devtools / Postman-style collapsible JSON tree:
 * object/array nodes show a chevron + a one-line summary ("{…} 3 keys" /
 * "[…] 5 items") and expand/collapse; leaf values are type-colored (string =
 * green, number = blue, boolean = violet, null = muted). The raw JSON TEXT is
 * the source of truth (`json`), so authoring round-trips losslessly even when
 * the JSON is invalid — the reader parses defensively and falls back to the raw
 * text on a parse error rather than throwing.
 *
 * The schema MUST stay data-compatible with the inline `json-explorer` member of
 * `planBlockSchema` (`plan-content.ts`), and the MDX `tag` (`Json`) +
 * attribute shape MUST match the `<Json title json collapsedDepth />` encoding so
 * stored `.mdx` round-trips. `json` lives in the `json` ATTRIBUTE (not MDX
 * children) — the shared `prop()` encoder round-trips multiline strings cleanly,
 * and keeping it an attribute avoids the payload being reflowed as prose.
 */

export interface JsonExplorerData {
  /** Optional heading shown above the tree. */
  title?: string;
  /** Raw JSON text — the source of truth, parsed defensively at render time. */
  json: string;
  /**
   * Depth beyond which nodes start collapsed (default 1). Nodes at a depth `<`
   * this value render expanded; deeper nodes render collapsed until clicked.
   */
  collapsedDepth?: number;
}

export const jsonExplorerSchema = z.object({
  title: z.string().trim().max(200).optional(),
  json: z.string().max(200_000),
  collapsedDepth: z.number().int().min(0).max(20).optional(),
}) as unknown as z.ZodType<JsonExplorerData>;

/**
 * MDX config: `title`, `json`, and `collapsedDepth` are flat attributes — the
 * `<Json id … title json collapsedDepth />` self-closing form. Insertion order
 * of `toAttrs` is the on-disk attribute order (`title` → `json` →
 * `collapsedDepth`). `fromAttrs` mirrors a forgiving parse (`json ?? ""`,
 * `title`/`collapsedDepth` undefined when absent) so a plan missing an attribute
 * still parses.
 */
export const jsonExplorerMdx: BlockMdxConfig<JsonExplorerData> = {
  tag: "Json",
  toAttrs: (data) => ({
    title: data.title,
    json: data.json,
    collapsedDepth: data.collapsedDepth,
  }),
  fromAttrs: (attrs) => ({
    json: attrs.string("json") ?? "",
    title: attrs.string("title"),
    collapsedDepth: attrs.number("collapsedDepth"),
  }),
};
