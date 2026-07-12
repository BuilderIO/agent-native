import { z } from "zod";

import type { BlockMdxConfig } from "../types.js";

/**
 * Pure (React-free) part of the standard `code-tabs` block: its data schema and
 * MDX round-trip config. Shared by the server MDX adapter (a plan/content app
 * registers it via `@agent-native/core/blocks/server`) and the full client spec
 * (`code-tabs.tsx`). Keeping this React-free means importing it into a server
 * module never pulls React into the Nitro/SSR bundle.
 *
 * `code-tabs` is a STANDARD library block (a vertical file tab rail of Shiki-
 * highlighted code), shareable by any app. Its schema MUST stay data-compatible
 * with the legacy plan `code-tabs` branch of `planBlockSchema`, and the MDX
 * `tag` + attribute shape MUST match the legacy
 * `<CodeTabs … tabs={[…]} />` encoding (`plan-mdx.ts` `serializeBlock`/
 * `parseBlock`) so stored `.mdx` round-trips byte-compatibly.
 */

export interface CodeTabsTab {
  id: string;
  label: string;
  language?: string;
  code: string;
  caption?: string;
  /**
   * Lines shown before the pane collapses behind a "Show N more lines" toggle.
   * Omitted ⇒ the default cap (`DEFAULT_CODE_MAX_LINES`, 30). `0` ⇒ never
   * collapse (always show the whole snippet).
   */
  maxLines?: number;
}

export interface CodeTabsData {
  tabs: CodeTabsTab[];
}

/** Matches the plan `idSchema` (`z.string().trim().min(1).max(120)`). */
const tabIdSchema = z.string().trim().min(1).max(120);

export const codeTabsSchema = z.object({
  tabs: z
    .array(
      z.object({
        id: tabIdSchema,
        label: z.string().trim().min(1).max(120),
        language: z.string().trim().max(40).optional(),
        code: z.string().max(100_000),
        caption: z.string().trim().max(400).optional(),
        maxLines: z.number().int().min(0).max(2000).optional(),
      }),
    )
    .min(1)
    .max(12),
}) as unknown as z.ZodType<CodeTabsData>;

/**
 * MDX config: `tabs` is a single JSON-encoded attribute and the block is
 * self-closing — exactly the legacy `<CodeTabs id … tabs={[…]} />` form.
 * `toAttrs` returns only `tabs`; `fromAttrs` reads the `tabs` array (defaulting
 * to `[]` for backward-compat with malformed/empty stored blocks, mirroring the
 * legacy `arrayAttr(node, "tabs") ?? []`).
 */
export const codeTabsMdx: BlockMdxConfig<CodeTabsData> = {
  tag: "CodeTabs",
  toAttrs: (data) => ({ tabs: data.tabs }),
  fromAttrs: (attrs) => ({
    tabs: attrs.array<CodeTabsTab>("tabs") ?? [],
  }),
};
