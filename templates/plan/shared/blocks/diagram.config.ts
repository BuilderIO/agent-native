import { z } from "zod";
import type { BlockMdxConfig } from "@agent-native/core/blocks/server";

/**
 * Pure (React-free) part of the PLAN-SPECIFIC diagram block: its data schema and
 * MDX round-trip config. Shared by the server MDX adapter (`plan-mdx.ts`) and the
 * client spec (`planBlocks.tsx`). Keeping this React-free means importing it into
 * a server module never pulls React into the Nitro/SSR bundle.
 *
 * The schema MUST stay data-compatible with the `diagram` branch of
 * `planBlockSchema` (`plan-content.ts` `diagramDataSchema`), and the MDX `tag` +
 * attribute shape MUST match the legacy `<Diagram … data={…} />` encoding
 * (`plan-mdx.ts` `serializeBlock`/`parseBlock`) — the whole `data` object is one
 * JSON `data` prop — so stored `.mdx` round-trips byte-compatibly.
 */

export interface DiagramNode {
  id: string;
  label: string;
  detail?: string;
  x?: number;
  y?: number;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

export interface DiagramNote {
  id: string;
  text: string;
  x?: number;
  y?: number;
}

export interface DiagramData {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  notes?: DiagramNote[];
}

const idSchema = z.string().trim().min(1).max(120);

const diagramNodeSchema = z.object({
  id: idSchema,
  label: z.string().trim().min(1).max(160),
  detail: z.string().trim().max(500).optional(),
  x: z.number().min(0).max(100).optional(),
  y: z.number().min(0).max(100).optional(),
}) as z.ZodType<DiagramNode>;

const diagramEdgeSchema = z.object({
  from: idSchema,
  to: idSchema,
  label: z.string().trim().max(100).optional(),
}) as z.ZodType<DiagramEdge>;

const diagramNoteSchema = z.object({
  id: idSchema,
  text: z.string().trim().min(1).max(500),
  x: z.number().min(0).max(100).optional(),
  y: z.number().min(0).max(100).optional(),
}) as z.ZodType<DiagramNote>;

/**
 * Data-compatible with `diagramDataSchema` in `plan-content.ts`. The block has no
 * `markdown()`-tagged or scalar fields — its `data` is positional node/edge/note
 * arrays — so it ships a custom read-only `Edit` (the diagram canvas) rather than
 * relying on the schema auto-editor. Editing stays comment/patch-driven.
 */
export const diagramSchema = z.object({
  nodes: z.array(diagramNodeSchema).min(1).max(80),
  edges: z.array(diagramEdgeSchema).max(120).default([]),
  notes: z.array(diagramNoteSchema).max(40).optional(),
}) as unknown as z.ZodType<DiagramData>;

/**
 * MDX config: the entire `data` object is serialized as one JSON `data` prop and
 * the element is self-closing — exactly the legacy `<Diagram id … data={…} />`
 * form. `toAttrs` returns `{ data }`; `fromAttrs` reads the `data` object,
 * mirroring the legacy `dataAttr(node, "data") ?? { nodes: [], edges: [] }`
 * default so plans missing the prop still parse.
 */
export const diagramMdx: BlockMdxConfig<DiagramData> = {
  tag: "Diagram",
  // The whole data object becomes one JSON `data` prop. Cast to the
  // structured-attr member of `MdxAttrValue` — `DiagramData` is a closed
  // interface without an index signature, which the union member requires.
  toAttrs: (data) => ({ data: data as unknown as Record<string, unknown> }),
  fromAttrs: (attrs) =>
    (attrs.object<DiagramData>("data") ?? {
      nodes: [],
      edges: [],
    }) as DiagramData,
};
