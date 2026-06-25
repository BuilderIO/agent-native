import { z } from "zod";

import { prop, attributeValue } from "../mdx.js";
import type { BlockMdxConfig } from "../types.js";

/**
 * Pure (React-free) part of the shared `wireframe` block: its data shape, zod
 * schema, the stable node-id helper, and the nested-MDX round-trip config. Lives
 * in core so BOTH apps' server/shared registries and the client spec
 * (`wireframe.tsx`) consume one definition; importing it into a server module
 * never pulls React into the Nitro/SSR bundle.
 *
 * The wireframe block originated in the plan template. The vocabulary
 * (`PlanWireframe*` names, the `el` set, the `--wf-*` token contract) and the
 * MDX encoding (`<WireframeBlock>…<Screen>…</Screen></WireframeBlock>` with kit
 * component names `FrameScreen`/`Row`/`Col`/…) are preserved EXACTLY so stored
 * plans round-trip byte-compatibly and existing node ids never change.
 *
 * The wireframe is NESTED MDX, not a flat-attribute or prose block: its body is
 * a `<Screen surface caption>…kit-tree…</Screen>` subtree. So the config uses
 * `serializeChildren`/`parseChildren` (the registry's nested-MDX path) rather
 * than `toAttrs`/`childrenField`.
 */

/* -------------------------------------------------------------------------- */
/* Vocabulary (decoupled copy of the plan-content wireframe types)            */
/* -------------------------------------------------------------------------- */

export type WireframeSurface =
  | "desktop"
  | "mobile"
  | "popover"
  | "panel"
  | "browser";

export type WireframeRenderMode = "wireframe" | "design";

/** Tone keyword reused across screen primitives. The renderer maps to color. */
export type WireframeTone = "default" | "accent" | "warn" | "ok" | "muted";

/**
 * Names of the kit primitives. Component-like (MDX-friendly). The renderer maps
 * each to a flex kit component. Layout is ALWAYS flex; row/col/sidebar/main set
 * the flex direction.
 */
export type WireframeElName =
  | "screen"
  | "browserBar"
  | "statusBar"
  | "toolbar"
  | "row"
  | "col"
  | "sidebar"
  | "navItem"
  | "main"
  | "title"
  | "text"
  | "lines"
  | "section"
  | "taskRow"
  | "chips"
  | "chip"
  | "pill"
  | "check"
  | "field"
  | "btn"
  | "fab"
  | "card"
  | "column"
  | "avatar"
  | "iconSquare"
  | "kv"
  | "searchBar"
  | "box"
  | "divider";

/**
 * A single node in the wireframe kit tree. `el` is the primitive name; the
 * remaining props are the union of every primitive's props (kept permissive so
 * the model can compose freely). `children` nests other nodes. `id` is a stable
 * node id used by node-addressable patch ops (auto-assigned on create).
 *
 * There is intentionally NO x/y/width/height here — wireframe internals are
 * geometry-free and laid out by the renderer with flex.
 */
export type WireframeNode = {
  /** Stable id for node-addressable patches; auto-assigned when absent. */
  id?: string;
  el: WireframeElName;
  children?: WireframeNode[];

  // Generic content props
  text?: string;
  value?: string;
  label?: string;
  placeholder?: string;
  title?: string;

  // Styling-by-intent (semantic only; renderer owns actual color/size)
  tone?: WireframeTone;
  color?: WireframeTone;
  weight?: "normal" | "medium" | "bold";
  active?: boolean;
  done?: boolean;
  emphasis?: boolean;
  full?: boolean;
  solid?: boolean;
  dashed?: boolean;
  dot?: boolean;
  script?: boolean;
  area?: boolean;
  shape?: "square" | "circle";

  // Numeric / structured props
  count?: number;
  prio?: number;
  n?: number;
  widths?: number[];
  icon?: string;

  // taskRow specifics
  note?: string;
  due?: string;
  dueTone?: WireframeTone;

  // Collection props (chips, kv)
  items?: Array<{
    label: string;
    active?: boolean;
    count?: number;
    dot?: boolean;
  }>;
  rows?: Array<{ k: string; v: string }>;
};

export interface WireframeData {
  surface: WireframeSurface;
  /** `design` renders full-fidelity branded HTML/CSS instead of a sketch. */
  renderMode?: WireframeRenderMode;
  caption?: string;
  /**
   * Neutral, textless loading register. The renderer drops borders, the sketch
   * outline, and color, rendering soft placeholder geometry only.
   */
  skeleton?: boolean;
  /**
   * PRIMARY content: a self-contained HTML mockup of the screen (sanitized
   * fragment — no document/script/style tags). The renderer owns the surface
   * aspect, the dark/light theme, the hand-drawn font, and the rough overlay.
   * When `html` is set, `screen` is ignored.
   */
  html?: string;
  /** Optional scoped CSS for the html mockup (sanitized fragment). */
  css?: string;
  /** Kit-tree screen. Used when `html` is absent. */
  screen?: WireframeNode[];
}

export const WIREFRAME_SURFACES: WireframeSurface[] = [
  "desktop",
  "mobile",
  "popover",
  "panel",
  "browser",
];

export const WIREFRAME_EL_NAMES: WireframeElName[] = [
  "screen",
  "browserBar",
  "statusBar",
  "toolbar",
  "row",
  "col",
  "sidebar",
  "navItem",
  "main",
  "title",
  "text",
  "lines",
  "section",
  "taskRow",
  "chips",
  "chip",
  "pill",
  "check",
  "field",
  "btn",
  "fab",
  "card",
  "column",
  "avatar",
  "iconSquare",
  "kv",
  "searchBar",
  "box",
  "divider",
];

/* -------------------------------------------------------------------------- */
/* Schema (mirrors the plan-content wireframeDataSchema)                       */
/* -------------------------------------------------------------------------- */

const toneSchema = z.enum(["default", "accent", "warn", "ok", "muted"]);
const elNameSchema = z.enum(
  WIREFRAME_EL_NAMES as [WireframeElName, ...WireframeElName[]],
);
const idSchema = z.string().trim().min(1).max(120);

/**
 * Reject full-document HTML (html/head/body/script/style tags) in the `html` /
 * `css` fields. Wireframe content must be a bounded fragment; document or script
 * tags are a stored-XSS and layout-escape hazard.
 */
function noFullHtmlDocument(value: string): boolean {
  return !/<\s*(?:!doctype|html|head|body|script|style)\b/i.test(value);
}

const wireframeNodeSchema: z.ZodType<WireframeNode> = z.lazy(() =>
  z
    .object({
      id: idSchema.optional(),
      el: elNameSchema,
      children: z.array(wireframeNodeSchema).max(60).optional(),

      text: z.string().trim().max(400).optional(),
      value: z.string().trim().max(400).optional(),
      label: z.string().trim().max(200).optional(),
      placeholder: z.string().trim().max(200).optional(),
      title: z.string().trim().max(200).optional(),

      tone: toneSchema.optional(),
      color: toneSchema.optional(),
      weight: z.enum(["normal", "medium", "bold"]).optional(),
      active: z.boolean().optional(),
      done: z.boolean().optional(),
      emphasis: z.boolean().optional(),
      full: z.boolean().optional(),
      solid: z.boolean().optional(),
      dashed: z.boolean().optional(),
      dot: z.boolean().optional(),
      script: z.boolean().optional(),
      area: z.boolean().optional(),
      shape: z.enum(["square", "circle"]).optional(),

      count: z.number().int().min(0).max(9_999).optional(),
      prio: z.number().int().min(0).max(9).optional(),
      n: z.number().int().min(0).max(20).optional(),
      widths: z.array(z.number().min(0).max(100)).max(20).optional(),
      icon: z.string().trim().max(40).optional(),

      note: z.string().trim().max(400).optional(),
      due: z.string().trim().max(120).optional(),
      dueTone: toneSchema.optional(),

      items: z
        .array(
          z.object({
            label: z.string().trim().min(1).max(200),
            active: z.boolean().optional(),
            count: z.number().int().min(0).max(9_999).optional(),
            dot: z.boolean().optional(),
          }),
        )
        .max(40)
        .optional(),
      rows: z
        .array(
          z.object({
            k: z.string().trim().min(1).max(200),
            v: z.string().trim().max(400),
          }),
        )
        .max(40)
        .optional(),
    })
    .passthrough(),
) as z.ZodType<WireframeNode>;

export const wireframeSchema = z
  .object({
    surface: z.enum(["desktop", "mobile", "popover", "panel", "browser"]),
    renderMode: z.enum(["wireframe", "design"]).optional(),
    caption: z.string().trim().max(400).optional(),
    skeleton: z.boolean().optional(),
    html: z
      .string()
      .max(40_000)
      .refine(noFullHtmlDocument, {
        message:
          "Wireframe html must be a bounded fragment without html/head/body/script/style tags.",
      })
      .optional(),
    css: z
      .string()
      .max(20_000)
      .refine(noFullHtmlDocument, {
        message: "Wireframe css must not include document or script tags.",
      })
      .optional(),
    screen: z.array(wireframeNodeSchema).max(200).optional(),
  })
  .passthrough() as unknown as z.ZodType<WireframeData>;

/* -------------------------------------------------------------------------- */
/* Stable node-id derivation (verbatim from plan-mdx.ts)                       */
/* -------------------------------------------------------------------------- */

/**
 * Derive a stable node id from the element name and tree path. Re-runs identically
 * to the legacy plan derivation so stored plans round-trip without changing ids.
 */
export function createStableWireframeNodeId(
  el: WireframeElName,
  path: string,
): string {
  return `node-${el}-${path}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/* -------------------------------------------------------------------------- */
/* Kit node <-> MDX component name maps (mirrors plan-mdx.ts NODE_TO_COMPONENT) */
/* -------------------------------------------------------------------------- */

const NODE_TO_COMPONENT: Record<WireframeElName, string> = {
  screen: "FrameScreen",
  browserBar: "BrowserBar",
  statusBar: "StatusBar",
  toolbar: "Toolbar",
  row: "Row",
  col: "Col",
  sidebar: "Sidebar",
  navItem: "NavItem",
  main: "Main",
  title: "Title",
  text: "Text",
  lines: "Lines",
  section: "SectionLabel",
  taskRow: "TaskRow",
  chips: "Chips",
  chip: "Chip",
  pill: "Pill",
  check: "Check",
  field: "Field",
  btn: "Btn",
  fab: "Fab",
  card: "Card",
  column: "Column",
  avatar: "Avatar",
  iconSquare: "IconSquare",
  kv: "KV",
  searchBar: "SearchBar",
  box: "Box",
  divider: "Divider",
};

const COMPONENT_TO_NODE = Object.fromEntries(
  Object.entries(NODE_TO_COMPONENT).map(([el, component]) => [component, el]),
) as Record<string, WireframeElName>;

/* -------------------------------------------------------------------------- */
/* Serialize (verbatim port of plan-mdx.ts serializeNode/serializeScreen)      */
/* -------------------------------------------------------------------------- */

function serializeNode(node: WireframeNode, indent = ""): string {
  const name = NODE_TO_COMPONENT[node.el] ?? "Box";
  const attrs = Object.entries(node)
    .filter(([key]) => key !== "children" && key !== "el")
    .map(([key, value]) => prop(key, value))
    .join("");
  if (!node.children?.length) return `${indent}<${name}${attrs} />`;
  const children = node.children
    .map((child) => serializeNode(child, `${indent}  `))
    .join("\n");
  return `${indent}<${name}${attrs}>\n${children}\n${indent}</${name}>`;
}

/**
 * Serialize the wireframe data to its inner `<Screen>` MDX subtree. The registry
 * serializer wraps this between the `<WireframeBlock …>` open/close tags, so the
 * total output equals the legacy `serializeBlock` wireframe branch exactly.
 */
function serializeScreen(data: WireframeData): string {
  const attrs = [
    prop("surface", data.surface),
    prop("renderMode", data.renderMode),
    prop("caption", data.caption),
    prop("html", data.html),
    prop("css", data.css),
    prop("skeleton", data.skeleton),
  ].join("");
  const children = (data.screen ?? [])
    .map((node) => serializeNode(node, "  "))
    .join("\n");
  if (!children) return `<Screen${attrs} />`;
  return `<Screen${attrs}>\n${children}\n</Screen>`;
}

/* -------------------------------------------------------------------------- */
/* Parse (verbatim port of plan-mdx.ts parseScreen/parseWireframeNode)         */
/* -------------------------------------------------------------------------- */

/**
 * Minimal MDX AST node shape used while walking the wireframe subtree. Declared
 * standalone (not an intersection with `MdxJsxNode`, whose `children` is
 * `unknown[]`) so recursive `children` stays narrowed to `WireframeMdxNode`.
 */
type WireframeMdxNode = {
  type: string;
  name?: string;
  attributes?: Array<{
    type: string;
    name?: string;
    value?: string | null | { type: string; value: string; data?: unknown };
  }>;
  children?: WireframeMdxNode[];
};

function elementName(node: WireframeMdxNode | undefined): string | undefined {
  return node?.type === "mdxJsxFlowElement" ||
    node?.type === "mdxJsxTextElement"
    ? node.name
    : undefined;
}

function findAttribute(node: WireframeMdxNode, name: string) {
  return node.attributes?.find(
    (attr) => attr.type === "mdxJsxAttribute" && attr.name === name,
  );
}

function stringAttr(node: WireframeMdxNode, name: string): string | undefined {
  const value = attributeValue(findAttribute(node, name));
  return typeof value === "string" ? value : undefined;
}

/**
 * Resolve a required-when-present string attribute on a `<Screen>`. If the
 * attribute is absent we return undefined, but if it is present yet cannot be
 * resolved to a string (e.g. a number, an object, or an unevaluable expression)
 * we THROW so a malformed wireframe fails the import instead of silently
 * dropping the value and rendering an empty wireframe.
 */
function requiredStringAttr(
  node: WireframeMdxNode,
  name: string,
): string | undefined {
  const attr = findAttribute(node, name);
  if (!attr) return undefined;
  const value = attributeValue(attr);
  if (typeof value !== "string") {
    throw new Error(
      `Wireframe <Screen> attribute "${name}" must resolve to a string, got ${typeof value}. Use a quoted string or a static template literal.`,
    );
  }
  return value;
}

function boolAttr(node: WireframeMdxNode, name: string): boolean | undefined {
  const value = attributeValue(findAttribute(node, name));
  return typeof value === "boolean" ? value : undefined;
}

function parseWireframeNode(
  node: WireframeMdxNode,
  path = "node",
): WireframeNode | null {
  const component = elementName(node);
  if (!component) return null;
  const el = COMPONENT_TO_NODE[component];
  if (!el) return null;
  const attrs = node.attributes ?? [];
  const parsed: WireframeNode = { el };
  for (const attr of attrs) {
    if (attr.type !== "mdxJsxAttribute") continue;
    const value = attributeValue(attr);
    if (value !== undefined)
      (parsed as Record<string, unknown>)[attr.name as string] = value;
  }
  parsed.el = el;
  parsed.id ??= createStableWireframeNodeId(el, path);
  const children = (node.children ?? [])
    .map((child, index) => parseWireframeNode(child, `${path}-${index}`))
    .filter(Boolean) as WireframeNode[];
  if (children.length > 0) parsed.children = children;
  return parsed;
}

function parseScreen(node: WireframeMdxNode, idContext: string): WireframeData {
  return {
    surface:
      (stringAttr(node, "surface") as WireframeData["surface"]) ?? "desktop",
    renderMode: stringAttr(node, "renderMode") as WireframeData["renderMode"],
    caption: stringAttr(node, "caption"),
    html: requiredStringAttr(node, "html"),
    css: requiredStringAttr(node, "css"),
    skeleton: boolAttr(node, "skeleton"),
    screen: (node.children ?? [])
      .map((child, index) =>
        parseWireframeNode(child, `${idContext}-screen-${index}`),
      )
      .filter(Boolean) as WireframeNode[],
  };
}

/* -------------------------------------------------------------------------- */
/* MDX config                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Registry MDX config for the wireframe block. `tag` matches the legacy
 * `WireframeBlock`. The block has no flat attributes (`toAttrs` → `{}`); all data
 * lives in the nested `<Screen>` subtree handled by `serializeChildren` /
 * `parseChildren`. The registry serializer wraps `serializeChildren` between the
 * `<WireframeBlock>` open/close, producing the exact legacy bytes. On parse, the
 * registry passes the already-extended `${idContext}-${blockId}` to
 * `parseChildren` — the same id base the legacy `parseScreen` receives — so node
 * ids are reproduced identically.
 */
export const wireframeMdx: BlockMdxConfig<WireframeData> = {
  tag: "WireframeBlock",
  toAttrs: () => ({}),
  fromAttrs: () => ({ surface: "desktop", screen: [] }),
  serializeChildren: (data) => serializeScreen(data),
  parseChildren: (childNodes, idContext) => {
    const nodes = childNodes as WireframeMdxNode[];
    const screen = nodes.find((child) => elementName(child) === "Screen");
    if (!screen) return { surface: "desktop", screen: [] };
    return parseScreen(screen, idContext);
  },
};
