import { z } from "zod";

import type { BlockMdxConfig } from "../types.js";
import type { NestedBlock } from "../types.js";

/**
 * Pure (React-free) part of the standard `columns` block: its data schema and
 * MDX round-trip config. Shared by the server MDX adapter (a plan/content app
 * registers it via `@agent-native/core/blocks/server`) and the full client spec
 * (`columns.tsx`). Keeping this React-free means importing it into a server
 * module never pulls React into the Nitro/SSR bundle.
 *
 * `columns` is a STANDARD library block: a multi-column side-by-side container
 * where each column holds a list of child blocks and an optional header label
 * (e.g. "Before"/"After"). The children are rendered RECURSIVELY through the
 * app's own block dispatcher (`ctx.renderBlock`), so registered children render
 * via their spec and unconverted children still fall through the app's legacy
 * switch — the coexistence seam. It mirrors `tabs` exactly, only laid out as a
 * grid instead of a pill rail.
 *
 * Its schema MUST stay data-compatible with the plan `columns` branch of
 * `planBlockSchema` (`columns[]` of `{ id, label?, blocks: Block[] }`). The
 * registry MDX config below keeps the compact self-closing `<Columns …
 * columns={[…]} />` encoding for generic apps and backward compatibility. The
 * Plan app also accepts and exports a more human-editable source form:
 * `<Columns><Column label="Before">…markdown and block components…</Column></Columns>`.
 */

/** One column: an optional label and the child blocks it contains. */
export interface ColumnsColumn {
  id: string;
  /** Optional per-column header (e.g. "Before"/"After"). */
  label?: string;
  /**
   * Child blocks. Typed loosely as {@link NestedBlock} because the app owns the
   * authoritative recursive block union (`planBlockSchema`); the columns spec
   * only validates the column envelope (`id`/`label`) and passes children
   * through.
   */
  blocks: NestedBlock[];
}

export interface ColumnsData {
  columns: ColumnsColumn[];
}

/** Matches the plan `idSchema` (`z.string().trim().min(1).max(120)`). */
const columnIdSchema = z.string().trim().min(1).max(120);

/**
 * Child blocks are validated by the app's own recursive `planBlockSchema` when
 * the plan persists; here they pass through untyped (`z.any()`) so core never
 * needs to import an app-specific block union. The column envelope (`id`/`label`)
 * mirrors the plan columns schema bounds exactly; a layout can temporarily have
 * one remaining column after deleting another column's final block, and tops
 * out at four to stay legible.
 */
export const columnsSchema = z.object({
  columns: z
    .array(
      z.object({
        id: columnIdSchema,
        label: z.string().trim().min(1).max(120).optional(),
        blocks: z.array(z.any()).max(40),
      }),
    )
    .min(1)
    .max(4),
}) as unknown as z.ZodType<ColumnsData>;

/**
 * MDX config: `columns` is a single JSON-encoded attribute and the block is
 * self-closing — the `<Columns id … columns={[…]} />` form. The entire `columns`
 * array (labels + nested child blocks) is one JSON prop; child blocks are NOT
 * serialized as nested MDX, mirroring how `tabs` encodes its `tabs` array.
 * `toAttrs` returns only `columns`; `fromAttrs` reads the `columns` array
 * (defaulting to `[]` for backward-compat with malformed/empty stored blocks).
 */
export const columnsMdx: BlockMdxConfig<ColumnsData> = {
  tag: "Columns",
  toAttrs: (data) => ({ columns: data.columns }),
  fromAttrs: (attrs) => ({
    columns: (attrs.array<ColumnsColumn>("columns") ?? []) as ColumnsColumn[],
  }),
};
