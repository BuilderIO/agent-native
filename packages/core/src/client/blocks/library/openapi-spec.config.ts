import { z } from "zod";

import type { BlockMdxConfig } from "../types.js";

/**
 * Pure (React-free) part of the PLAN-SPECIFIC `openapi-spec` block: its data
 * schema and MDX round-trip config. Shared by the server MDX adapter
 * (`plan-mdx.ts` via `plan-block-registry.ts`) and the client spec
 * (`planBlocks.tsx`). Keeping this React-free means importing it into a server
 * module never pulls React into the Nitro/SSR bundle.
 *
 * This is the WHOLE-DOCUMENT counterpart to the single-endpoint `api-endpoint`
 * block: instead of one operation, it carries a complete OpenAPI 3 / Swagger 2
 * document (the `spec` string) and the reader renders a Redoc / Swagger-UI-style
 * reference — operations grouped by tag, each a collapsible row (colored method
 * pill + path + summary) expanding to params / request body / per-status
 * responses, with `$ref` models resolved. The raw `spec` TEXT is the source of
 * truth, so authoring round-trips losslessly even when the spec is malformed —
 * the reader parses defensively and falls back to a graceful error rather than
 * throwing.
 *
 * v1 supports JSON specs only. A YAML parser (`yaml`) is NOT a declared
 * dependency of this package, so to avoid pulling in an undeclared/transitive
 * module the reader parses JSON (a superset of nothing — pure `JSON.parse`).
 * The Edit form documents the JSON-only constraint inline. When `yaml` is later
 * added as a real dependency, the reader's `parseSpec` is the single seam to
 * extend.
 *
 * The schema MUST stay data-compatible with the inline `openapi-spec` member of
 * `planBlockSchema` (`plan-content.ts`), and the MDX `tag` (`OpenApi`) +
 * attribute shape MUST match the `<OpenApi title spec />` encoding so stored
 * `.mdx` round-trips. `spec` lives in the `spec` ATTRIBUTE (not MDX children) —
 * the shared `prop()` encoder round-trips multiline strings cleanly, and keeping
 * it an attribute avoids the payload being reflowed as prose.
 */

export interface OpenApiSpecData {
  /** Raw OpenAPI 3 / Swagger 2 document text (JSON in v1). Source of truth. */
  spec: string;
  /** Optional heading shown above the reference. */
  title?: string;
}

export const openApiSpecSchema = z.object({
  spec: z.string().max(400_000),
  title: z.string().trim().max(200).optional(),
}) as unknown as z.ZodType<OpenApiSpecData>;

/**
 * MDX config: `title` and `spec` are flat attributes — the `<OpenApi id … title
 * spec />` self-closing form. Insertion order of `toAttrs` is the on-disk
 * attribute order (`title` → `spec`). `fromAttrs` mirrors a forgiving parse
 * (`spec ?? ""`, `title` undefined when absent) so a plan missing an attribute
 * still parses.
 */
export const openApiSpecMdx: BlockMdxConfig<OpenApiSpecData> = {
  tag: "OpenApi",
  toAttrs: (data) => ({
    title: data.title,
    spec: data.spec,
  }),
  fromAttrs: (attrs) => ({
    spec: attrs.string("spec") ?? "",
    title: attrs.string("title"),
  }),
};
