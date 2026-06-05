import matter from "gray-matter";
import prettier from "prettier";
import { unified } from "unified";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { visit } from "unist-util-visit";
import { z } from "zod";
import {
  PLAN_CONTENT_VERSION,
  createPlanBlockId,
  planContentSchema,
  type PlanAnnotation,
  type PlanAnnotationPlacement,
  type PlanArtboard,
  type PlanBlock,
  type PlanBoardSection,
  type PlanConnector,
  type PlanContent,
  type PlanLegacyWireframeBlock,
  type PlanWireframeElName,
  type PlanWireframeNode,
} from "../shared/plan-content.js";
import { normalizePlanContent } from "./plan-content.js";

type MdxNode = {
  type: string;
  name?: string;
  value?: string;
  children?: MdxNode[];
  attributes?: MdxAttribute[];
  [key: string]: unknown;
};

type MdxAttribute = {
  type: "mdxJsxAttribute" | string;
  name: string;
  value?: string | null | MdxExpression;
};

type MdxExpression = {
  type: "mdxJsxAttributeValueExpression";
  value: string;
  data?: unknown;
};

type EstreeNode = {
  type: string;
  value?: unknown;
  name?: string;
  expression?: EstreeNode;
  body?: EstreeNode[];
  elements?: Array<EstreeNode | null>;
  properties?: EstreeNode[];
  key?: EstreeNode;
  computed?: boolean;
  argument?: EstreeNode;
  operator?: string;
  kind?: string;
  property?: EstreeNode;
  object?: EstreeNode;
  sourceType?: string;
  comments?: unknown[];
  loc?: unknown;
  range?: unknown;
  start?: number;
  end?: number;
};

export type PlanMdxFolder = {
  "plan.mdx": string;
  "canvas.mdx"?: string;
  "assets/"?: Record<string, string>;
  ".plan-state.json"?: string;
};

export type ExportPlanMdxInput = {
  content: PlanContent | null | undefined;
  title: string;
  brief?: string | null;
  planId?: string;
  url?: string;
};

export const planMdxFileSchema = z.object({
  "plan.mdx": z.string().min(1),
  "canvas.mdx": z.string().optional(),
  ".plan-state.json": z.string().optional(),
});

const planMdxStateSchema = z
  .object({
    version: z.number().optional(),
    planId: z.string().optional(),
    canvas: z
      .object({
        zoom: z.number().min(0.05).max(8).optional(),
        pan: z
          .object({
            x: z.number().optional(),
            y: z.number().optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .passthrough();

const ANNOTATION_PLACEMENTS = [
  "top",
  "right",
  "bottom",
  "left",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
] as const satisfies readonly PlanAnnotationPlacement[];

export const planMdxSourcePatchSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("replace-file"),
    file: z.enum(["plan.mdx", "canvas.mdx", ".plan-state.json"]),
    content: z.string(),
  }),
  z.object({
    op: z.literal("replace-markdown-block"),
    blockId: z.string().min(1),
    markdown: z.string(),
    title: z.string().optional(),
  }),
  z.object({
    op: z.literal("update-component-prop"),
    file: z.enum(["plan.mdx", "canvas.mdx"]),
    componentId: z.string().min(1),
    prop: z.string().min(1),
    value: z.unknown(),
  }),
  z.object({
    op: z.literal("update-wireframe-node"),
    nodeId: z.string().min(1),
    patch: z.record(z.string(), z.unknown()),
  }),
  z.object({
    op: z.literal("update-annotation"),
    annotationId: z.string().min(1),
    patch: z.object({
      title: z.string().optional(),
      text: z.string().optional(),
      targetId: z.string().optional(),
      placement: z.enum(ANNOTATION_PLACEMENTS).optional(),
      x: z.number().optional(),
      y: z.number().optional(),
    }),
  }),
  z.object({
    op: z.literal("replace-artboard"),
    artboardId: z.string().min(1),
    mdx: z.string().min(1),
  }),
]);

export const planMdxSourcePatchesSchema = z
  .array(planMdxSourcePatchSchema)
  .max(80);

export type PlanMdxSourcePatch = z.infer<typeof planMdxSourcePatchSchema>;

const NODE_TO_COMPONENT: Record<PlanWireframeElName, string> = {
  screen: "FrameScreen",
  browserBar: "BrowserBar",
  statusBar: "StatusBar",
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

const BLOCK_COMPONENTS = new Set([
  "RichText",
  "Callout",
  "Checklist",
  "Table",
  "CodeTabs",
  "ImplementationMap",
  "WireframeBlock",
  "LegacyWireframeBlock",
  "Diagram",
  "Image",
  "Decision",
  "TabsBlock",
  "HtmlBlock",
  "VisualQuestions",
]);

function mdxProcessor() {
  return unified().use(remarkParse).use(remarkMdx).use(remarkStringify, {
    bullet: "-",
    fences: true,
    incrementListMarker: true,
  });
}

async function formatMdx(source: string): Promise<string> {
  try {
    return await prettier.format(source.trim() + "\n", { parser: "mdx" });
  } catch {
    return source.trim() + "\n";
  }
}

function jsonExpression(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function prop(name: string, value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") {
    return value ? ` ${name}` : ` ${name}={false}`;
  }
  if (typeof value === "number") return ` ${name}={${value}}`;
  if (typeof value === "string") {
    if (/^[\w .:/@#,+()[\]-]+$/.test(value) && value.length < 140) {
      return ` ${name}="${escapeAttr(value)}"`;
    }
    return ` ${name}={${jsonExpression(value)}}`;
  }
  return ` ${name}={${jsonExpression(value)}}`;
}

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

function serializeScreen(data: {
  surface: string;
  caption?: string;
  screen: PlanWireframeNode[];
}): string {
  const children = data.screen
    .map((node) => serializeNode(node, "  "))
    .join("\n");
  return `<Screen${prop("surface", data.surface)}${prop("caption", data.caption)}>\n${children}\n</Screen>`;
}

function serializeBlock(block: PlanBlock): string {
  const title = prop("title", block.title);
  const summary = prop("summary", block.summary);
  const editable = prop("editable", block.editable);
  if (block.type === "rich-text") {
    return `<RichText${prop("id", block.id)}${title}${summary}${editable}>\n\n${block.data.markdown.trim()}\n\n</RichText>`;
  }
  if (block.type === "callout") {
    return `<Callout${prop("id", block.id)}${title}${summary}${editable}${prop("tone", block.data.tone)}>\n\n${block.data.body.trim()}\n\n</Callout>`;
  }
  if (block.type === "checklist") {
    return `<Checklist${prop("id", block.id)}${title}${summary}${editable}${prop("items", block.data.items)} />`;
  }
  if (block.type === "table") {
    return `<Table${prop("id", block.id)}${title}${summary}${editable}${prop("columns", block.data.columns)}${prop("rows", block.data.rows)} />`;
  }
  if (block.type === "code-tabs") {
    return `<CodeTabs${prop("id", block.id)}${title}${summary}${editable}${prop("tabs", block.data.tabs)} />`;
  }
  if (block.type === "implementation-map") {
    return `<ImplementationMap${prop("id", block.id)}${title}${summary}${editable}${prop("files", block.data.files)} />`;
  }
  if (block.type === "wireframe") {
    return `<WireframeBlock${prop("id", block.id)}${title}${summary}${editable}>\n${serializeScreen(block.data)}\n</WireframeBlock>`;
  }
  if (block.type === "legacy-wireframe") {
    return `<LegacyWireframeBlock${prop("id", block.id)}${title}${summary}${editable}${prop("data", block.data)} />`;
  }
  if (block.type === "diagram") {
    return `<Diagram${prop("id", block.id)}${title}${summary}${editable}${prop("data", block.data)} />`;
  }
  if (block.type === "image") {
    return `<Image${prop("id", block.id)}${title}${summary}${editable}${prop("assetId", block.data.assetId)}${prop("url", block.data.url)}${prop("alt", block.data.alt)}${prop("caption", block.data.caption)}${prop("fit", block.data.fit)} />`;
  }
  if (block.type === "decision") {
    return `<Decision${prop("id", block.id)}${title}${summary}${editable}${prop("question", block.data.question)}${prop("options", block.data.options)} />`;
  }
  if (block.type === "tabs") {
    return `<TabsBlock${prop("id", block.id)}${title}${summary}${editable}${prop("tabs", block.data.tabs)} />`;
  }
  if (block.type === "custom-html") {
    return `<HtmlBlock${prop("id", block.id)}${title}${summary}${editable}${prop("html", block.data.html)}${prop("css", block.data.css)}${prop("caption", block.data.caption)} />`;
  }
  return `<VisualQuestions${prop("id", block.id)}${title}${summary}${editable}${prop("questions", block.data.questions)}${prop("submitLabel", block.data.submitLabel)} />`;
}

function frontmatter(data: Record<string, unknown>): string {
  const lines = Object.entries(data)
    .filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    )
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  return `---\n${lines.join("\n")}\n---\n\n`;
}

export async function exportPlanContentToMdxFolder(
  input: ExportPlanMdxInput,
): Promise<PlanMdxFolder> {
  const content =
    normalizePlanContent(
      input.content ?? {
        version: PLAN_CONTENT_VERSION,
        title: input.title,
        brief: input.brief ?? undefined,
        blocks: [
          {
            id: "plan-body",
            type: "rich-text",
            title: "Plan",
            data: {
              markdown: [
                input.brief ?? "",
                input.url ? `Live plan: ${input.url}` : "",
              ]
                .filter(Boolean)
                .join("\n\n"),
            },
          },
        ],
      },
    ) ?? planContentSchema.parse({ version: PLAN_CONTENT_VERSION, blocks: [] });

  const planSource = [
    frontmatter({
      title: content.title ?? input.title,
      brief: content.brief ?? input.brief ?? undefined,
      version: content.version,
      planId: input.planId,
      source: "agent-native-plan",
    }),
    content.blocks.map(serializeBlock).join("\n\n"),
  ].join("");

  const folder: PlanMdxFolder = {
    "plan.mdx": await formatMdx(planSource),
    "assets/": {},
    ".plan-state.json": JSON.stringify(
      {
        version: 1,
        planId: input.planId,
        canvas: content.canvas
          ? (content.canvas.viewport ?? {
              zoom: 0.68,
              pan: { x: 80, y: 54 },
            })
          : undefined,
      },
      null,
      2,
    ),
  };

  if (content.canvas) {
    folder["canvas.mdx"] = await formatMdx(serializeCanvas(content));
  }

  return folder;
}

function serializeCanvas(content: PlanContent): string {
  const canvas = content.canvas;
  if (!canvas) return "";
  const frameById = new Map(canvas.frames.map((frame) => [frame.id, frame]));
  const emitted = new Set<string>();
  const sections = canvas.sections?.length
    ? canvas.sections
    : [
        {
          id: "main",
          title: canvas.title ?? "Canvas",
          artboardIds: canvas.frames.map((frame) => frame.id),
        },
      ];
  const sectionSource = sections
    .map((section) => {
      const artboardIds = section.artboardIds ?? canvas.frames.map((f) => f.id);
      const artboards = artboardIds
        .map((id) => frameById.get(id))
        .filter(Boolean)
        .map((frame) => {
          emitted.add(frame.id);
          return serializeArtboard(frame);
        })
        .join("\n\n");
      return `<Section${prop("id", section.id)}${prop("title", section.title)}${prop("subtitle", section.subtitle)}>\n${artboards}\n</Section>`;
    })
    .join("\n\n");
  const looseFrames = canvas.frames
    .filter((frame) => !emitted.has(frame.id))
    .map(serializeArtboard)
    .join("\n\n");
  const annotationsSource: PlanAnnotation[] = [
    ...(canvas.annotations ?? []),
    ...(canvas.notes ?? []).map((note) => ({
      id: note.id,
      title: note.title,
      text: note.body,
      targetId: note.arrowToFrameId,
      x: note.x,
      y: note.y,
    })),
  ];
  const annotations = annotationsSource
    .map(
      (annotation) =>
        `<Annotation${prop("id", annotation.id)}${prop("title", annotation.title)}${prop("targetId", annotation.targetId)}${prop("placement", annotation.placement)}${prop("x", annotation.x)}${prop("y", annotation.y)}>\n\n${annotation.text.trim()}\n\n</Annotation>`,
    )
    .join("\n\n");
  const connectors = (canvas.flow ?? [])
    .map(
      (connector) =>
        `<Connector${prop("from", connector.from)}${prop("to", connector.to)}${prop("label", connector.label)} />`,
    )
    .join("\n");

  return `<DesignBoard${prop("title", canvas.title)}${prop("version", content.version)}>\n${[
    sectionSource,
    looseFrames,
    annotations,
    connectors,
  ]
    .filter(Boolean)
    .join("\n\n")}\n</DesignBoard>`;
}

function serializeArtboard(frame: PlanArtboard): string {
  const attrs = [
    prop("id", frame.id),
    prop("label", frame.label),
    prop("surface", frame.surface),
    prop("blockId", frame.blockId),
    prop("x", frame.x),
    prop("y", frame.y),
    prop("width", frame.width),
    prop("height", frame.height),
    prop("order", frame.order),
  ].join("");
  if (frame.wireframe) {
    return `<Artboard${attrs}>\n${serializeScreen(frame.wireframe)}\n</Artboard>`;
  }
  if (frame.legacyWireframe) {
    return `<Artboard${attrs}>\n<LegacyWireframe${prop("data", frame.legacyWireframe)} />\n</Artboard>`;
  }
  return `<Artboard${attrs} />`;
}

function parseMdx(source: string): MdxNode {
  return mdxProcessor().parse(source) as unknown as MdxNode;
}

function stringifyMdx(tree: MdxNode): string {
  return mdxProcessor().stringify(tree as never);
}

function visitMdx(
  tree: MdxNode,
  check: string | string[],
  visitor: (node: MdxNode, index?: number, parent?: MdxNode) => void,
) {
  visit(tree as never, check as never, visitor as never);
}

function stringifyChildren(children: MdxNode[] | undefined): string {
  if (!children?.length) return "";
  return stringifyMdx({ type: "root", children }).trim();
}

function elementName(node: MdxNode | undefined): string | undefined {
  return node?.type === "mdxJsxFlowElement" ||
    node?.type === "mdxJsxTextElement"
    ? node.name
    : undefined;
}

function findAttribute(node: MdxNode, name: string): MdxAttribute | undefined {
  return node.attributes?.find(
    (attr) => attr.type === "mdxJsxAttribute" && attr.name === name,
  );
}

function attributeValue(attr: MdxAttribute | undefined): unknown {
  if (!attr) return undefined;
  if (attr.value === null || attr.value === undefined) return true;
  if (typeof attr.value === "string") return attr.value;
  const astValue = literalExpressionValue(attr.value);
  if (astValue !== undefined) return astValue;
  const expression = attr.value.value.trim();
  if (!expression) return undefined;
  if (expression === "undefined") return undefined;
  try {
    return JSON.parse(expression);
  } catch {
    throw new Error(
      `Unsupported MDX attribute expression for "${attr.name}": {${expression}}. Use literal values or valid JSON.`,
    );
  }
}

function literalExpressionValue(expression: MdxExpression): unknown {
  const estree = (expression.data as { estree?: EstreeNode } | undefined)
    ?.estree;
  const statement = estree?.body?.[0];
  if (!statement || statement.type !== "ExpressionStatement") return undefined;
  return literalNodeValue(statement.expression);
}

function literalNodeValue(node: EstreeNode | undefined | null): unknown {
  if (!node) return undefined;
  if (node.type === "Literal") return node.value;
  if (node.type === "ArrayExpression") {
    return (node.elements ?? []).map((item) => literalNodeValue(item));
  }
  if (node.type === "ObjectExpression") {
    const out: Record<string, unknown> = {};
    for (const property of node.properties ?? []) {
      if (property.type !== "Property" || property.computed) return undefined;
      const key = property.key;
      const rawKey =
        key?.type === "Identifier"
          ? key.name
          : key?.type === "Literal" && typeof key.value === "string"
            ? key.value
            : undefined;
      if (!rawKey) return undefined;
      const value = literalNodeValue(property.value as EstreeNode | undefined);
      if (value !== undefined) out[rawKey] = value;
    }
    return out;
  }
  if (node.type === "UnaryExpression") {
    const value = literalNodeValue(node.argument);
    if (typeof value !== "number") return undefined;
    if (node.operator === "-") return -value;
    if (node.operator === "+") return value;
  }
  if (node.type === "Identifier") {
    if (node.name === "undefined") return undefined;
    if (node.name === "NaN") return Number.NaN;
    if (node.name === "Infinity") return Infinity;
  }
  return undefined;
}

function stringAttr(node: MdxNode, name: string): string | undefined {
  const value = attributeValue(findAttribute(node, name));
  return typeof value === "string" ? value : undefined;
}

function numberAttr(node: MdxNode, name: string): number | undefined {
  const value = attributeValue(findAttribute(node, name));
  return typeof value === "number" ? value : undefined;
}

function boolAttr(node: MdxNode, name: string): boolean | undefined {
  const value = attributeValue(findAttribute(node, name));
  return typeof value === "boolean" ? value : undefined;
}

function arrayAttr<T>(node: MdxNode, name: string): T[] | undefined {
  const value = attributeValue(findAttribute(node, name));
  return Array.isArray(value) ? (value as T[]) : undefined;
}

function dataAttr<T>(node: MdxNode, name: string): T | undefined {
  const value = attributeValue(findAttribute(node, name));
  return value && typeof value === "object" ? (value as T) : undefined;
}

function baseBlock(node: MdxNode) {
  return {
    id: stringAttr(node, "id") ?? createPlanBlockId("block"),
    title: stringAttr(node, "title"),
    summary: stringAttr(node, "summary"),
    editable: boolAttr(node, "editable"),
  };
}

function parseBlock(node: MdxNode, idContext = "block"): PlanBlock | null {
  const name = elementName(node);
  if (!name || !BLOCK_COMPONENTS.has(name)) return null;
  const base = baseBlock(node);
  if (name === "RichText") {
    return {
      ...base,
      type: "rich-text",
      data: { markdown: stringifyChildren(node.children) },
    };
  }
  if (name === "Callout") {
    return {
      ...base,
      type: "callout",
      data: {
        tone: stringAttr(node, "tone") as never,
        body: stringifyChildren(node.children),
      },
    };
  }
  if (name === "Checklist") {
    return {
      ...base,
      type: "checklist",
      data: { items: arrayAttr(node, "items") ?? [] },
    };
  }
  if (name === "Table") {
    return {
      ...base,
      type: "table",
      data: {
        columns: arrayAttr(node, "columns") ?? [],
        rows: arrayAttr(node, "rows") ?? [],
      },
    };
  }
  if (name === "CodeTabs") {
    return {
      ...base,
      type: "code-tabs",
      data: { tabs: arrayAttr(node, "tabs") ?? [] },
    };
  }
  if (name === "ImplementationMap") {
    return {
      ...base,
      type: "implementation-map",
      data: { files: arrayAttr(node, "files") ?? [] },
    };
  }
  if (name === "WireframeBlock") {
    const screen = node.children?.find(
      (child) => elementName(child) === "Screen",
    );
    if (!screen) return null;
    return {
      ...base,
      type: "wireframe",
      data: parseScreen(screen, `${idContext}-${base.id}`),
    };
  }
  if (name === "LegacyWireframeBlock") {
    return {
      ...base,
      type: "legacy-wireframe",
      data: dataAttr(node, "data") ?? { regions: [] },
    };
  }
  if (name === "Diagram") {
    return {
      ...base,
      type: "diagram",
      data: dataAttr(node, "data") ?? { nodes: [], edges: [] },
    };
  }
  if (name === "Image") {
    return {
      ...base,
      type: "image",
      data: {
        assetId: stringAttr(node, "assetId"),
        url: stringAttr(node, "url"),
        alt: stringAttr(node, "alt") ?? "Plan image",
        caption: stringAttr(node, "caption"),
        fit: stringAttr(node, "fit") as never,
      },
    };
  }
  if (name === "Decision") {
    return {
      ...base,
      type: "decision",
      data: {
        question: stringAttr(node, "question") ?? base.title ?? "Decision",
        options: arrayAttr(node, "options") ?? [],
      },
    };
  }
  if (name === "TabsBlock") {
    return {
      ...base,
      type: "tabs",
      data: { tabs: arrayAttr(node, "tabs") ?? [] },
    };
  }
  if (name === "HtmlBlock") {
    return {
      ...base,
      type: "custom-html",
      data: {
        html: stringAttr(node, "html") ?? "",
        css: stringAttr(node, "css"),
        caption: stringAttr(node, "caption"),
      },
    };
  }
  return {
    ...base,
    type: "visual-questions",
    data: {
      questions: arrayAttr(node, "questions") ?? [],
      submitLabel: stringAttr(node, "submitLabel"),
    },
  };
}

function parseScreen(
  node: MdxNode,
  idContext = "screen",
): {
  surface: PlanArtboard["surface"];
  caption?: string;
  screen: PlanWireframeNode[];
} {
  return {
    surface:
      (stringAttr(node, "surface") as PlanArtboard["surface"]) ?? "desktop",
    caption: stringAttr(node, "caption"),
    screen: (node.children ?? [])
      .map((child, index) =>
        parseWireframeNode(child, `${idContext}-screen-${index}`),
      )
      .filter(Boolean) as PlanWireframeNode[],
  };
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
  node: MdxNode,
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

export async function parsePlanMdxFolder(
  folder: PlanMdxFolder,
): Promise<PlanContent> {
  const files = planMdxFileSchema.parse(folder);
  const parsedMatter = matter(files["plan.mdx"]);
  const planTree = parseMdx(parsedMatter.content);
  const looseNodes: MdxNode[] = [];
  const blocks: PlanBlock[] = [];
  const flushLoose = () => {
    const markdown = stringifyChildren(looseNodes).trim();
    looseNodes.length = 0;
    if (!markdown) return;
    blocks.push({
      id: createPlanBlockId("markdown"),
      type: "rich-text",
      data: { markdown },
    });
  };
  for (const [index, child] of (planTree.children ?? []).entries()) {
    const block = parseBlock(child, `plan-block-${index}`);
    if (block) {
      flushLoose();
      blocks.push(block);
    } else {
      looseNodes.push(child);
    }
  }
  flushLoose();

  const canvas = files["canvas.mdx"]
    ? parseCanvas(files["canvas.mdx"])
    : undefined;
  const state = parsePlanState(files[".plan-state.json"]);
  if (canvas && state?.canvas) canvas.viewport = state.canvas;

  const content: PlanContent = {
    version:
      typeof parsedMatter.data.version === "number"
        ? parsedMatter.data.version
        : PLAN_CONTENT_VERSION,
    title:
      typeof parsedMatter.data.title === "string"
        ? parsedMatter.data.title
        : undefined,
    brief:
      typeof parsedMatter.data.brief === "string"
        ? parsedMatter.data.brief
        : undefined,
    canvas,
    blocks,
  };
  const normalized = normalizePlanContent(content);
  if (!normalized)
    throw new Error("MDX source did not parse into valid plan content.");
  return normalized;
}

function parsePlanState(source: string | undefined) {
  if (!source) return undefined;
  try {
    return planMdxStateSchema.parse(JSON.parse(source));
  } catch {
    throw new Error(".plan-state.json is not valid visual plan state.");
  }
}

function parseCanvas(source: string): PlanContent["canvas"] {
  const tree = parseMdx(source);
  const board = (tree.children ?? []).find(
    (child) => elementName(child) === "DesignBoard",
  );
  if (!board) return undefined;
  const frames: PlanArtboard[] = [];
  const sections: PlanBoardSection[] = [];
  const annotations: PlanAnnotation[] = [];
  const flow: PlanConnector[] = [];

  const parseCanvasChild = (
    child: MdxNode,
    section: PlanBoardSection | undefined,
    path: string,
  ) => {
    const name = elementName(child);
    if (name === "Section") {
      const nextSection: PlanBoardSection = {
        id: stringAttr(child, "id") ?? createPlanBlockId("section"),
        title: stringAttr(child, "title"),
        subtitle: stringAttr(child, "subtitle"),
        artboardIds: [],
      };
      sections.push(nextSection);
      for (const [index, grandchild] of (child.children ?? []).entries())
        parseCanvasChild(grandchild, nextSection, `${path}-section-${index}`);
      if (nextSection.artboardIds?.length === 0) delete nextSection.artboardIds;
      return;
    }
    if (name === "Artboard") {
      const frame = parseArtboard(child, path);
      frames.push(frame);
      section?.artboardIds?.push(frame.id);
      return;
    }
    if (name === "Annotation") {
      annotations.push({
        id: stringAttr(child, "id") ?? createPlanBlockId("annotation"),
        title: stringAttr(child, "title"),
        text:
          stringifyChildren(child.children) ||
          stringAttr(child, "text") ||
          stringAttr(child, "body") ||
          "",
        targetId: stringAttr(child, "targetId"),
        placement: stringAttr(
          child,
          "placement",
        ) as PlanAnnotation["placement"],
        x: numberAttr(child, "x"),
        y: numberAttr(child, "y"),
      });
      return;
    }
    if (name === "Connector") {
      const from = stringAttr(child, "from");
      const to = stringAttr(child, "to");
      if (from && to)
        flow.push({ from, to, label: stringAttr(child, "label") });
    }
  };

  for (const [index, child] of (board.children ?? []).entries())
    parseCanvasChild(child, undefined, `canvas-${index}`);

  return {
    title: stringAttr(board, "title"),
    sections: sections.length ? sections : undefined,
    frames,
    flow: flow.length ? flow : undefined,
    annotations: annotations.length ? annotations : undefined,
  };
}

function parseArtboard(node: MdxNode, idContext = "artboard"): PlanArtboard {
  const id = stringAttr(node, "id") ?? createPlanBlockId("artboard");
  const screen = node.children?.find(
    (child) => elementName(child) === "Screen",
  );
  const legacy = node.children?.find(
    (child) => elementName(child) === "LegacyWireframe",
  );
  return {
    id,
    label: stringAttr(node, "label"),
    surface: stringAttr(node, "surface") as PlanArtboard["surface"],
    blockId: stringAttr(node, "blockId"),
    x: numberAttr(node, "x"),
    y: numberAttr(node, "y"),
    width: numberAttr(node, "width"),
    height: numberAttr(node, "height"),
    order: numberAttr(node, "order"),
    wireframe: screen ? parseScreen(screen, `${idContext}-${id}`) : undefined,
    legacyWireframe: legacy
      ? dataAttr<PlanLegacyWireframeBlock["data"]>(legacy, "data")
      : undefined,
  };
}

function setAttribute(node: MdxNode, name: string, value: unknown) {
  node.attributes ??= [];
  const attr =
    node.attributes.find(
      (candidate) =>
        candidate.type === "mdxJsxAttribute" && candidate.name === name,
    ) ??
    (() => {
      const next: MdxAttribute = { type: "mdxJsxAttribute", name };
      node.attributes?.push(next);
      return next;
    })();
  if (value === undefined) {
    node.attributes = node.attributes.filter((candidate) => candidate !== attr);
    return;
  }
  if (typeof value === "boolean" && value) {
    attr.value = null;
    return;
  }
  if (typeof value === "string") {
    attr.value = value;
    return;
  }
  attr.value = {
    type: "mdxJsxAttributeValueExpression",
    value: JSON.stringify(value),
  };
}

function elementId(node: MdxNode): string | undefined {
  return stringAttr(node, "id");
}

function parseFragmentElement(source: string, name: string): MdxNode {
  const tree = parseMdx(source);
  const found = (tree.children ?? []).find(
    (child) => elementName(child) === name,
  );
  if (!found) throw new Error(`Expected a ${name} MDX component fragment.`);
  return found;
}

async function updateMdxSource(
  source: string,
  updater: (tree: MdxNode) => void,
): Promise<string> {
  const parsedMatter = matter(source);
  const tree = parseMdx(parsedMatter.content);
  updater(tree);
  const body = stringifyMdx(tree);
  const withMatter =
    Object.keys(parsedMatter.data).length > 0
      ? matter.stringify(body, parsedMatter.data)
      : body;
  return formatMdx(withMatter);
}

async function updateMdxSourceIf(
  source: string,
  updater: (tree: MdxNode) => boolean,
): Promise<{ source: string; changed: boolean }> {
  const parsedMatter = matter(source);
  const tree = parseMdx(parsedMatter.content);
  const changed = updater(tree);
  if (!changed) return { source, changed: false };
  const body = stringifyMdx(tree);
  const withMatter =
    Object.keys(parsedMatter.data).length > 0
      ? matter.stringify(body, parsedMatter.data)
      : body;
  return { source: await formatMdx(withMatter), changed: true };
}

type MdxSourceFile = "plan.mdx" | "canvas.mdx";

function requireMdxSource(
  folder: PlanMdxFolder,
  file: MdxSourceFile,
  operation: string,
): string {
  const source = folder[file];
  if (source === undefined) {
    throw new Error(
      `${file} is not present; cannot ${operation}. Use replace-file to create it first.`,
    );
  }
  return source;
}

export async function applyPlanMdxSourcePatches(
  folder: PlanMdxFolder,
  patches: PlanMdxSourcePatch[],
): Promise<PlanMdxFolder> {
  const next: PlanMdxFolder = { ...folder };
  for (const patch of planMdxSourcePatchesSchema.parse(patches)) {
    if (patch.op === "replace-file") {
      if (patch.file === ".plan-state.json") next[patch.file] = patch.content;
      else next[patch.file] = await formatMdx(patch.content);
      continue;
    }

    if (patch.op === "replace-markdown-block") {
      next["plan.mdx"] = await updateMdxSource(next["plan.mdx"], (tree) => {
        let changed = false;
        visitMdx(tree, "mdxJsxFlowElement", (node) => {
          if (
            elementName(node) !== "RichText" ||
            elementId(node) !== patch.blockId
          )
            return;
          const replacement = parseMdx(patch.markdown);
          node.children = replacement.children ?? [];
          if (patch.title) setAttribute(node, "title", patch.title);
          changed = true;
        });
        if (!changed)
          throw new Error(
            `RichText block ${patch.blockId} not found in plan.mdx.`,
          );
      });
      continue;
    }

    if (patch.op === "update-component-prop") {
      next[patch.file] = await updateMdxSource(
        requireMdxSource(
          next,
          patch.file,
          `update component ${patch.componentId}`,
        ),
        (tree) => {
          let changed = false;
          visitMdx(tree, ["mdxJsxFlowElement", "mdxJsxTextElement"], (node) => {
            if (elementId(node) !== patch.componentId) return;
            setAttribute(node, patch.prop, patch.value);
            changed = true;
          });
          if (!changed)
            throw new Error(
              `Component ${patch.componentId} not found in ${patch.file}.`,
            );
        },
      );
      continue;
    }

    if (patch.op === "update-wireframe-node") {
      const filesToSearch: MdxSourceFile[] = next["canvas.mdx"]
        ? ["canvas.mdx", "plan.mdx"]
        : ["plan.mdx"];
      const changedFiles: MdxSourceFile[] = [];
      for (const file of filesToSearch) {
        const result = await updateMdxSourceIf(
          requireMdxSource(next, file, `update wireframe node ${patch.nodeId}`),
          (tree) => {
            let changed = false;
            visitMdx(
              tree,
              ["mdxJsxFlowElement", "mdxJsxTextElement"],
              (node) => {
                if (elementId(node) !== patch.nodeId) return;
                if (
                  !elementName(node) ||
                  !COMPONENT_TO_NODE[elementName(node) ?? ""]
                )
                  return;
                for (const [key, value] of Object.entries(patch.patch))
                  setAttribute(node, key, value);
                changed = true;
              },
            );
            return changed;
          },
        );
        if (result.changed) {
          next[file] = result.source;
          changedFiles.push(file);
        }
      }
      if (changedFiles.length === 0) {
        const searched = filesToSearch.join(" or ");
        const missingCanvas = next["canvas.mdx"]
          ? ""
          : " canvas.mdx is not present.";
        throw new Error(
          `Wireframe node ${patch.nodeId} not found in ${searched}.${missingCanvas}`,
        );
      }
      continue;
    }

    if (patch.op === "update-annotation") {
      next["canvas.mdx"] = await updateMdxSource(
        requireMdxSource(
          next,
          "canvas.mdx",
          `update annotation ${patch.annotationId}`,
        ),
        (tree) => {
          let changed = false;
          visitMdx(tree, "mdxJsxFlowElement", (node) => {
            if (
              elementName(node) !== "Annotation" ||
              elementId(node) !== patch.annotationId
            )
              return;
            const { text, ...props } = patch.patch;
            for (const [key, value] of Object.entries(props))
              setAttribute(node, key, value);
            if (text !== undefined)
              node.children = parseMdx(text).children ?? [];
            changed = true;
          });
          if (!changed)
            throw new Error(
              `Annotation ${patch.annotationId} not found in canvas.mdx.`,
            );
        },
      );
      continue;
    }

    if (patch.op === "replace-artboard") {
      const replacement = parseFragmentElement(patch.mdx, "Artboard");
      next["canvas.mdx"] = await updateMdxSource(
        requireMdxSource(
          next,
          "canvas.mdx",
          `replace artboard ${patch.artboardId}`,
        ),
        (tree) => {
          let changed = false;
          visitMdx(tree, "mdxJsxFlowElement", (node, index, parent) => {
            if (
              elementName(node) !== "Artboard" ||
              elementId(node) !== patch.artboardId
            )
              return;
            if (!parent?.children || index === undefined) return;
            parent.children[index] = replacement;
            changed = true;
          });
          if (!changed)
            throw new Error(
              `Artboard ${patch.artboardId} not found in canvas.mdx.`,
            );
        },
      );
    }
  }
  return next;
}
