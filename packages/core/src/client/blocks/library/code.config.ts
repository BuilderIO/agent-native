import { z } from "zod";
import type { BlockMdxConfig } from "../types.js";

/**
 * Pure (React-free) part of the standard `code` block: its data schema and MDX
 * round-trip config. Shared by the server MDX adapter (a plan/content app
 * registers it via `@agent-native/core/blocks/server`) and the full client spec
 * (`code.tsx`). Keeping this React-free means importing it into a server module
 * never pulls React into the Nitro/SSR bundle.
 *
 * `code` is THE primitive code block — a single syntax-highlighted snippet,
 * Notion-style (one border, hover-revealed language switcher + copy, collapse to
 * N lines). It deliberately holds ONE snippet: a "file rail" of several files is
 * just the `tabs` primitive containing `code` blocks, so there is no bespoke
 * "code-tabs" container. The legacy `code-tabs` block stays renderable for stored
 * documents but is no longer authored.
 */

export interface CodeData {
  /** The snippet. */
  code: string;
  /** Language hint (e.g. `ts`). Drives highlighting + the language label/switcher. */
  language?: string;
  /** Optional file path shown in the header (e.g. `src/server/auth.ts`). */
  filename?: string;
  /** Optional one-line caption under the header. */
  caption?: string;
  /**
   * Lines shown before the snippet collapses behind a "Show N more lines"
   * toggle. Omitted ⇒ the default cap (`DEFAULT_CODE_MAX_LINES`, 30). `0` ⇒
   * never collapse (always show the whole snippet).
   */
  maxLines?: number;
}

export const codeSchema = z.object({
  code: z.string().max(100_000),
  language: z.string().trim().max(40).optional(),
  filename: z.string().trim().max(400).optional(),
  caption: z.string().trim().max(400).optional(),
  maxLines: z.number().int().min(0).max(2000).optional(),
}) as unknown as z.ZodType<CodeData>;

/**
 * MDX config: `<Code filename language caption maxLines code />` self-closing
 * form. `code` is a multiline string attribute (the shared `prop()` encoder
 * round-trips multiline strings cleanly, and keeping it an attribute — not MDX
 * children — avoids the source being reflowed as prose). `fromAttrs` is forgiving
 * (`code ?? ""`, optional fields undefined when absent) so a snippet missing an
 * attribute still parses.
 */
export const codeMdx: BlockMdxConfig<CodeData> = {
  tag: "Code",
  toAttrs: (data) => ({
    filename: data.filename,
    language: data.language,
    caption: data.caption,
    maxLines: data.maxLines,
    code: data.code,
  }),
  fromAttrs: (attrs) => ({
    code: attrs.string("code") ?? "",
    language: attrs.string("language"),
    filename: attrs.string("filename"),
    caption: attrs.string("caption"),
    maxLines: attrs.number("maxLines"),
  }),
};
