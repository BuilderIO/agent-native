import {
  prop,
  attributeValue,
  type BlockMdxConfig,
} from "@agent-native/core/blocks/server";
import {
  wireframeDataSchema,
  type PlanWireframeBlock,
  type PlanWireframeElName,
  type PlanWireframeNode,
} from "../plan-content.js";

/**
 * Pure (React-free) part of the PLAN-SPECIFIC `wireframe` block: its data schema
 * (the shared {@link wireframeDataSchema}, identical to the `wireframe` arm of
 * `planBlockSchema`) and its MDX round-trip config. Shared by the server MDX
 * adapter registry (`shared/plan-block-registry.ts`) and the client registry
 * (`app/components/plan/planBlocks.tsx`) so serialize/parse never drift from
 * render.
 *
 * The wireframe block is NESTED MDX, not a flat-attribute or prose block: its
 * body is a `<Screen surface caption>…kit-tree…</Screen>` subtree. So the config
 * uses `serializeChildren`/`parseChildren` (the registry's nested-MDX path)
 * rather than `toAttrs`/`childrenField`. The emitted shape is byte-identical to
 * the legacy `<WireframeBlock>…<Screen>…</Screen>…</WireframeBlock>` form in
 * `plan-mdx.ts` (`serializeScreen` + `serializeNode`), and parsing reproduces the
 * exact stable node-id derivation (`createStableWireframeNodeId`) so stored
 * plans round-trip without changing any node ids.
 */

export type WireframeData = PlanWireframeBlock["data"];

export const wireframeSchema =
  wireframeDataSchema as unknown as import("zod").ZodType<WireframeData>;

/* -------------------------------------------------------------------------- */
/* Kit node <-> MDX component name maps (mirrors plan-mdx.ts NODE_TO_COMPONENT) */
/* -------------------------------------------------------------------------- */

const NODE_TO_COMPONENT: Record<PlanWireframeElName, string> = {
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
) as Record<string, PlanWireframeElName>;

/* -------------------------------------------------------------------------- */
/* Serialize (verbatim port of plan-mdx.ts serializeNode/serializeScreen)      */
/* -------------------------------------------------------------------------- */

function serializeNode(node: PlanWireframeNode, indent = ""): string {
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
 * standalone (not an intersection with {@link MdxJsxNode}, whose `children` is
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

function boolAttr(node: WireframeMdxNode, name: string): boolean | undefined {
  const value = attributeValue(findAttribute(node, name));
  return typeof value === "boolean" ? value : undefined;
}

function createStableWireframeNodeId(
  el: PlanWireframeElName,
  path: string,
): string {
  return `node-${el}-${path}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function parseWireframeNode(
  node: WireframeMdxNode,
  path = "node",
): PlanWireframeNode | null {
  const component = elementName(node);
  if (!component) return null;
  const el = COMPONENT_TO_NODE[component];
  if (!el) return null;
  const attrs = node.attributes ?? [];
  const parsed: PlanWireframeNode = { el };
  for (const attr of attrs) {
    if (attr.type !== "mdxJsxAttribute") continue;
    const value = attributeValue(attr);
    if (value !== undefined)
      (parsed as Record<string, unknown>)[attr.name] = value;
  }
  parsed.el = el;
  parsed.id ??= createStableWireframeNodeId(el, path);
  const children = (node.children ?? [])
    .map((child, index) => parseWireframeNode(child, `${path}-${index}`))
    .filter(Boolean) as PlanWireframeNode[];
  if (children.length > 0) parsed.children = children;
  return parsed;
}

function parseScreen(node: WireframeMdxNode, idContext: string): WireframeData {
  return {
    surface:
      (stringAttr(node, "surface") as WireframeData["surface"]) ?? "desktop",
    renderMode: stringAttr(node, "renderMode") as WireframeData["renderMode"],
    caption: stringAttr(node, "caption"),
    html: stringAttr(node, "html"),
    css: stringAttr(node, "css"),
    skeleton: boolAttr(node, "skeleton"),
    screen: (node.children ?? [])
      .map((child, index) =>
        parseWireframeNode(child, `${idContext}-screen-${index}`),
      )
      .filter(Boolean) as PlanWireframeNode[],
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
