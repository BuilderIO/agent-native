import { z } from "zod";

import type { BlockMdxConfig } from "../types.js";

/**
 * Pure (React-free) part of the standard HTML / Tailwind block: its data schema
 * and MDX round-trip config. Shared by the React spec (`html.tsx`) and any
 * server-side / agent registry (e.g. the plan app's `plan-block-registry.ts`),
 * so importing it into a server module never pulls React in.
 *
 * This is the registry form of the plan `custom-html` block. The schema MUST
 * stay data-compatible with the `custom-html` branch of the plan
 * `planBlockSchema` (bounded `html`, optional bounded `css`, optional trimmed
 * `caption`, all rejecting full-document / script markup) so a registered block
 * still validates through the app's generic `update-block` re-validation. The
 * MDX `tag` (`HtmlBlock`) + flat `html`/`css`/`caption` attribute shape MUST
 * match the legacy `<HtmlBlock … html css caption />` encoding
 * (`plan-mdx.ts` `serializeBlock`/`parseBlock`) so stored `.mdx` round-trips
 * byte-compatibly.
 */

export interface HtmlBlockData {
  /** Bounded HTML fragment (no html/head/body/script/style document markup). */
  html: string;
  /** Optional bounded CSS, scoped into the sandboxed iframe. */
  css?: string;
  /** Optional short caption rendered under the rendered fragment. */
  caption?: string;
}

/**
 * Rejects full HTML documents, executable/structural tags, and JS/data URLs.
 * Kept byte-identical to the plan `noFullHtmlDocument` refine so the registry
 * schema accepts exactly what `planBlockSchema` accepts (and nothing it would
 * reject). Defense in depth — the block also renders inside a sandboxed iframe.
 */
const unsafeHtmlPattern =
  /(?:<!doctype|<\/?(?:html|head|body|script|style|iframe|object|embed|link|meta|base|form)[\s>/]|\b(?:javascript|data:text\/html)\s*:|\bsrcdoc\s*=|\bon[a-z][\w:-]*\s*=)/i;

const noFullHtmlDocument = (value: string) => !unsafeHtmlPattern.test(value);

export const htmlSchema = z
  .object({
    html: z.string().max(100_000).refine(noFullHtmlDocument, {
      message:
        "Custom HTML blocks must be bounded fragments without html/head/body/script/style tags.",
    }),
    css: z
      .string()
      .max(50_000)
      .refine(noFullHtmlDocument, {
        message: "Custom CSS blocks must not include document or script tags.",
      })
      .optional(),
    caption: z.string().trim().max(400).optional(),
  })
  .strict() as unknown as z.ZodType<HtmlBlockData>;

/**
 * MDX config: `html`, `css`, and `caption` are flat attributes (no children) —
 * exactly the legacy `<HtmlBlock id … html css caption />` self-closing form.
 * Insertion order of `toAttrs` is the on-disk attribute order, so it stays
 * `html` → `css` → `caption` to match `plan-mdx.ts:serializeBlock`. `fromAttrs`
 * mirrors the legacy parse defaults (`html ?? ""`, `css`/`caption` undefined
 * when absent).
 */
export const htmlMdx: BlockMdxConfig<HtmlBlockData> = {
  tag: "HtmlBlock",
  toAttrs: (data) => ({
    html: data.html,
    css: data.css,
    caption: data.caption,
  }),
  fromAttrs: (attrs) => ({
    html: attrs.string("html") ?? "",
    css: attrs.string("css"),
    caption: attrs.string("caption"),
  }),
};
