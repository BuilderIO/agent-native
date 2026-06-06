import { z } from "zod";
import type { BlockMdxConfig } from "../types.js";
import type { NestedBlock } from "../types.js";

/**
 * Pure (React-free) part of the standard `tabs` block: its data schema and MDX
 * round-trip config. Shared by the server MDX adapter (a plan/content app
 * registers it via `@agent-native/core/blocks/server`) and the full client spec
 * (`tabs.tsx`). Keeping this React-free means importing it into a server module
 * never pulls React into the Nitro/SSR bundle.
 *
 * `tabs` is a STANDARD library block: a horizontal pill-tab container where each
 * tab holds a list of child blocks. The children are rendered RECURSIVELY
 * through the app's own block dispatcher (`ctx.renderBlock`), so registered
 * children render via their spec and unconverted children still fall through the
 * app's legacy switch — the coexistence seam.
 *
 * Its schema MUST stay data-compatible with the legacy plan `tabs` branch of
 * `planBlockSchema` (`tabs[]` of `{ id, label, blocks: Block[] }`), and the MDX
 * `tag` + attribute shape MUST match the legacy
 * `<TabsBlock … tabs={[…]} />` encoding — the WHOLE `tabs` array (including
 * nested child blocks) encoded as one JSON prop, NOT nested MDX
 * (`plan-mdx.ts` `serializeBlock` L349 / `parseBlock` L705) — so stored `.mdx`
 * round-trips byte-compatibly.
 */

/** One tab: a label and the child blocks it contains. */
export interface TabsTab {
  id: string;
  label: string;
  /**
   * Child blocks. Typed loosely as {@link NestedBlock} because the app owns the
   * authoritative recursive block union (`planBlockSchema`); the tabs spec only
   * validates the tab envelope (`id`/`label`) and passes children through.
   */
  blocks: NestedBlock[];
}

export interface TabsData {
  tabs: TabsTab[];
}

/** Matches the plan `idSchema` (`z.string().trim().min(1).max(120)`). */
const tabIdSchema = z.string().trim().min(1).max(120);

/**
 * Child blocks are validated by the app's own recursive `planBlockSchema` when
 * the plan persists; here they pass through untyped (`z.any()`) so core never
 * needs to import an app-specific block union. The tab envelope (`id`/`label`)
 * mirrors the plan tabs schema bounds (`plan-content.ts` L1051) exactly.
 */
export const tabsSchema = z.object({
  tabs: z
    .array(
      z.object({
        id: tabIdSchema,
        label: z.string().trim().min(1).max(120),
        blocks: z.array(z.any()).max(40),
      }),
    )
    .min(1)
    .max(12),
}) as unknown as z.ZodType<TabsData>;

/**
 * MDX config: `tabs` is a single JSON-encoded attribute and the block is
 * self-closing — exactly the legacy `<TabsBlock id … tabs={[…]} />` form. The
 * entire `tabs` array (labels + nested child blocks) is one JSON prop; child
 * blocks are NOT serialized as nested MDX, which preserves the current byte
 * output. `toAttrs` returns only `tabs`; `fromAttrs` reads the `tabs` array
 * (defaulting to `[]` for backward-compat with malformed/empty stored blocks,
 * mirroring the legacy `arrayAttr(node, "tabs") ?? []`).
 */
export const tabsMdx: BlockMdxConfig<TabsData> = {
  tag: "TabsBlock",
  toAttrs: (data) => ({ tabs: data.tabs }),
  fromAttrs: (attrs) => ({
    tabs: (attrs.array<TabsTab>("tabs") ?? []) as TabsTab[],
  }),
};
