import { z } from "zod";

import { childCodeFenceFields, serializeChildCodeFenceFields } from "../mdx.js";
import type { BlockMdxConfig, BlockVisualFrame } from "../types.js";

/**
 * Pure (React-free) part of the shared `diagram` block: its data schema and MDX
 * round-trip config. Lives in core so BOTH apps' server/shared registries
 * (`plan-block-registry.ts`, `nfm-registry.ts`) and the client spec
 * (`diagram.tsx`) consume one definition. Keeping it React-free means importing
 * it into a server module never pulls React into the Nitro/SSR bundle.
 *
 * The MDX `tag` keeps backward compatibility with legacy
 * `<Diagram … data={…} />` files while the current authoring form stores
 * maintainable `html`/`css` as child code fences.
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
  /**
   * Preferred authoring path for architecture/code diagrams: a scoped, inert
   * HTML/SVG fragment. Use .diagram-* primitives and --wf-* tokens; the
   * renderer supplies theme-token-backed styling plus sketch/clean style hooks.
   */
  html?: string;
  css?: string;
  caption?: string;
  /** Outer surface frame. `auto` lets the host choose the right default. */
  frame?: BlockVisualFrame;
  /**
   * Legacy compatibility path for older/simple node graphs. New plans should use
   * `html`/`css` when layout quality matters.
   */
  nodes?: DiagramNode[];
  edges?: DiagramEdge[];
  notes?: DiagramNote[];
}

const idSchema = z.string().trim().min(1).max(120);
const unsafeDiagramHtmlPattern =
  /(?:<!doctype|<\/?(?:html|head|body|script|style|iframe|object|embed|link|meta|base|form|math|foreignObject|noscript|frame|frameset|applet|portal|marquee)[\s>/]|@(?:import|font-face|keyframes|page|namespace|charset)\b|\b(?:java\s*script|vb\s*script|data\s*:\s*(?:text\/html|image\/svg\+xml))\s*:?\s*|\bsrcdoc\s*=|(?:^|\s)(?:on[a-z][\w:-]*|@[\w:.-]+|x-on:[\w:.-]+|:on[a-z][\w:-]*|x-bind:on[a-z][\w:-]*|:style|x-bind:style)\s*=|expression\s*\(|url\s*\(\s*['"]?\s*(?:java\s*script|vb\s*script|data\s*:\s*(?:text\/html|image\/svg\+xml)))/i;
const unsafeViewportCssPattern =
  /(?:^|[;{\s])position\s*:\s*(?:fixed|sticky)\b|(?:^|[;{\s])z-index\s*:\s*[1-9]\d{4,}\b/i;

function decodeSafetyEntities(value: string): string {
  return value
    .replace(/&#(x[0-9a-f]+|\d+);?/gi, (_, code: string) => {
      const point = code.toLowerCase().startsWith("x")
        ? Number.parseInt(code.slice(1), 16)
        : Number.parseInt(code, 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : "";
    })
    .replace(/&(colon|tab|newline);/gi, (_, name: string) => {
      if (name.toLowerCase() === "colon") return ":";
      if (name.toLowerCase() === "tab") return "\t";
      return "\n";
    });
}

function decodeCssSafetyEscapes(value: string): string {
  return value.replace(/\\([0-9a-fA-F]{1,6}\s?|.)/g, (_match, escaped) => {
    const hex = String(escaped).match(/^[0-9a-fA-F]{1,6}/)?.[0];
    if (hex) {
      const point = Number.parseInt(hex, 16);
      return Number.isFinite(point) ? String.fromCodePoint(point) : "";
    }
    return String(escaped)[0] ?? "";
  });
}

function noActiveDiagramText(value: string) {
  const decoded = decodeCssSafetyEscapes(decodeSafetyEntities(value));
  const compact = decoded.toLowerCase().replace(/[\u0000-\u0020]+/g, "");
  return (
    !unsafeDiagramHtmlPattern.test(value) &&
    !unsafeDiagramHtmlPattern.test(decoded) &&
    !unsafeViewportCssPattern.test(decoded) &&
    !/(?:javascript|vbscript):|data:(?:text\/html|image\/svg\+xml)|expression\(|url\(['"]?(?:javascript|vbscript|data:(?:text\/html|image\/svg\+xml))/.test(
      compact,
    )
  );
}

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

const visualFrameSchema = z.enum(["auto", "show", "hide"]);

/**
 * The block can be a flexible HTML/SVG fragment or a legacy positional
 * node/edge/note graph, so it ships a custom `Edit` rather than relying on the
 * schema auto-editor. Editing stays comment/patch-driven.
 */
export const diagramSchema = z
  .object({
    html: z
      .string()
      .trim()
      .max(100_000)
      .refine(noActiveDiagramText, {
        message:
          "Diagram html must be an inert fragment; SVG is allowed, scripts/events are not.",
      })
      .optional(),
    css: z
      .string()
      .max(50_000)
      .refine(noActiveDiagramText, {
        message: "Diagram css must not include document or script tags.",
      })
      .optional(),
    caption: z.string().trim().max(600).optional(),
    frame: visualFrameSchema.optional(),
    nodes: z.array(diagramNodeSchema).max(80).optional(),
    edges: z.array(diagramEdgeSchema).max(120).optional(),
    notes: z.array(diagramNoteSchema).max(40).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.html?.trim() || (data.nodes?.length ?? 0) > 0) return;
    ctx.addIssue({
      code: "custom",
      path: ["html"],
      message: "Diagram block requires html or at least one node.",
    });
  }) as unknown as z.ZodType<DiagramData>;

function hasChildFenceData(data: DiagramData) {
  return Boolean(data.html || data.css);
}

function graphDataForAttr(data: DiagramData): DiagramData | undefined {
  const graph: DiagramData = {};
  if (data.nodes?.length) graph.nodes = data.nodes;
  if (data.edges?.length) graph.edges = data.edges;
  if (data.notes?.length) graph.notes = data.notes;
  if (Object.keys(graph).length > 0) return graph;
  if (hasChildFenceData(data)) return undefined;
  const { frame: _frame, ...dataForAttr } = data;
  return Object.keys(dataForAttr).length > 0 ? dataForAttr : undefined;
}

/**
 * MDX config: new source uses normal fenced-code children:
 *
 * `<Diagram caption="...">` plus child `html` / `css` fences. Legacy
 * `<Diagram data={...} />` remains accepted by `fromAttrs`; `toAttrs` keeps the
 * `data` key present-but-undefined when using child fences so docs validation
 * still recognizes old `data={...}` as a supported compatibility attribute.
 */
export const diagramMdx: BlockMdxConfig<DiagramData> = {
  tag: "Diagram",
  toAttrs: (data) => ({
    data: graphDataForAttr(data) as unknown as
      | Record<string, unknown>
      | undefined,
    caption: data.caption,
    frame: data.frame,
  }),
  fromAttrs: (attrs) => ({
    ...(attrs.object<DiagramData>("data") ?? {}),
    ...(attrs.string("caption") !== undefined
      ? { caption: attrs.string("caption") }
      : {}),
    ...(attrs.string("frame") !== undefined
      ? { frame: attrs.string("frame") as BlockVisualFrame }
      : {}),
  }),
  serializeChildren: (data) =>
    serializeChildCodeFenceFields(data, { html: "html", css: "css" }),
  parseChildren: (childNodes) =>
    childCodeFenceFields<DiagramData>(childNodes, {
      html: "html",
      css: "css",
    }),
};
