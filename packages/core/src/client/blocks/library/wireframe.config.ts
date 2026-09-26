import { z } from "zod";

import { prop, attributeValue } from "../mdx.js";
import type { BlockMdxConfig, BlockVisualFrame } from "../types.js";

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


export type WireframeSurface =
  | "desktop"
  | "mobile"
  | "popover"
  | "panel"
  | "browser";

export type WireframeRenderMode = "wireframe" | "design";

export type WireframeTone = "default" | "accent" | "warn" | "ok" | "muted";

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

export type WireframeNode = {
  id?: string;
  el: WireframeElName;
  children?: WireframeNode[];

  text?: string;
  value?: string;
  label?: string;
  placeholder?: string;
  title?: string;

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

  count?: number;
  prio?: number;
  n?: number;
  widths?: number[];
  icon?: string;

  note?: string;
  due?: string;
  dueTone?: WireframeTone;

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
  renderMode?: WireframeRenderMode;
  caption?: string;
  frame?: BlockVisualFrame;
  skeleton?: boolean;
  html?: string;
  css?: string;
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


const toneSchema = z.enum(["default", "accent", "warn", "ok", "muted"]);
const elNameSchema = z.enum(
  WIREFRAME_EL_NAMES as [WireframeElName, ...WireframeElName[]],
);
const idSchema = z.string().trim().min(1).max(120);
const visualFrameSchema = z.enum(["auto", "show", "hide"]);

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
    frame: visualFrameSchema.optional(),
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

function serializeScreen(data: WireframeData): string {
  const attrs = [
    prop("surface", data.surface),
    prop("renderMode", data.renderMode),
    prop("caption", data.caption),
    prop("frame", data.frame),
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
    frame: stringAttr(node, "frame") as WireframeData["frame"],
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
