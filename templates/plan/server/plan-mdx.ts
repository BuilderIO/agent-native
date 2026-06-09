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
  type PlanPrototype,
  type PlanPrototypeScreen,
  type PlanWireframeElName,
  type PlanWireframeBlock,
  type PlanWireframeNode,
} from "../shared/plan-content.js";
import { normalizePlanContent } from "./plan-content.js";
import {
  BlockRegistry,
  prop,
  attributeValue,
  serializeSpecBlock,
  parseSpecBlock,
  type MdxJsxNode,
} from "@agent-native/core/blocks/server";
import { registerPlanBlocks } from "../shared/plan-block-registry.js";

// Server-side plan block registry. Registered specs (currently the editable
// callout) drive serialize/parse via the registry; every other block type still
// falls through to the legacy `serializeBlock`/`parseBlock` below, so stored
// `.mdx` round-trips byte-compatibly. See `plan-block-registry.ts`.
const planMdxRegistry = new BlockRegistry();
registerPlanBlocks(planMdxRegistry);

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
  "prototype.mdx"?: string;
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

const HOSTED_PLAN_ORIGIN = "https://plan.agent-native.com";

export const planMdxFileSchema = z.object({
  "plan.mdx": z.string().min(1),
  "canvas.mdx": z.string().optional(),
  "prototype.mdx": z.string().optional(),
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

const ANNOTATION_TYPES = ["note", "text", "callout", "arrow"] as const;

export const planMdxSourcePatchSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("replace-file"),
    file: z.enum([
      "plan.mdx",
      "canvas.mdx",
      "prototype.mdx",
      ".plan-state.json",
    ]),
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
    file: z.enum(["plan.mdx", "canvas.mdx", "prototype.mdx"]),
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
      type: z.enum(ANNOTATION_TYPES).optional(),
      title: z.string().optional(),
      text: z.string().optional(),
      points: z
        .array(z.object({ x: z.number(), y: z.number() }))
        .min(1)
        .max(12)
        .optional(),
      style: z
        .object({
          tone: z.enum(["default", "accent", "warn", "ok", "muted"]).optional(),
          stroke: z.enum(["solid", "dashed"]).optional(),
          width: z.number().min(1).max(12).optional(),
        })
        .optional(),
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
  "Columns",
  "HtmlBlock",
  "QuestionForm",
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

// `prop`, `escapeAttr`, `jsonExpression`, and the attribute reader
// (`attributeValue` + its estree literal walker) now live in
// `@agent-native/core/blocks` and are imported above. They are the MDX
// round-trip contract — shared verbatim so registry-driven and legacy blocks
// encode/decode identically.

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

function serializeScreen(
  data: {
    surface: string;
    renderMode?: string;
    caption?: string;
    html?: string;
    css?: string;
    skeleton?: boolean;
    screen?: PlanWireframeNode[];
  },
  indent = "",
): string {
  const attrs = [
    prop("surface", data.surface),
    prop("renderMode", data.renderMode),
    prop("caption", data.caption),
    prop("html", data.html),
    prop("css", data.css),
    prop("skeleton", data.skeleton),
  ].join("");
  const children = (data.screen ?? [])
    .map((node) => serializeNode(node, `${indent}  `))
    .join("\n");
  if (!children) return `${indent}<Screen${attrs} />`;
  return `${indent}<Screen${attrs}>\n${children}\n${indent}</Screen>`;
}

function serializeBlock(block: PlanBlock): string {
  if (block.type === "columns") {
    return serializeColumnsBlock(block);
  }
  // Registry-first: a registered block type serializes through its spec's `mdx`
  // config (byte-identical to the legacy branch below). Unregistered types fall
  // through to the hand-written switch, so unconverted blocks are unchanged.
  const registered = planMdxRegistry.get(block.type);
  if (registered) {
    return serializeSpecBlock(registered, {
      id: block.id,
      title: block.title,
      summary: block.summary,
      editable: block.editable,
      data: (block as { data: unknown }).data,
    });
  }
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
    return `<WireframeBlock${prop("id", block.id)}${title}${summary}${editable}>\n${serializeScreen(block.data, "  ")}\n</WireframeBlock>`;
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
  if (block.type === "tabs") {
    return `<TabsBlock${prop("id", block.id)}${title}${summary}${editable}${prop("tabs", block.data.tabs)}${prop("orientation", block.data.orientation === "vertical" ? block.data.orientation : undefined)} />`;
  }
  if (block.type === "custom-html") {
    return `<HtmlBlock${prop("id", block.id)}${title}${summary}${editable}${prop("html", block.data.html)}${prop("css", block.data.css)}${prop("caption", block.data.caption)} />`;
  }
  if (block.type === "visual-questions") {
    return `<VisualQuestions${prop("id", block.id)}${title}${summary}${editable}${prop("questions", block.data.questions)}${prop("submitLabel", block.data.submitLabel)} />`;
  }
  throw new Error(`Unsupported plan block type: ${block.type}`);
}

function serializeColumnChild(block: PlanBlock): string {
  if (block.type === "rich-text") {
    return block.data.markdown.trim();
  }
  return serializeBlock(block);
}

function serializeColumnsBlock(
  block: Extract<PlanBlock, { type: "columns" }>,
): string {
  const title = prop("title", block.title);
  const summary = prop("summary", block.summary);
  const editable = prop("editable", block.editable);
  const columns = block.data.columns
    .map((column) => {
      const body = column.blocks.map(serializeColumnChild).join("\n\n").trim();
      const contentId =
        column.blocks.length === 1 && column.blocks[0]?.type === "rich-text"
          ? column.blocks[0].id
          : undefined;
      return `<Column${prop("id", column.id)}${prop("label", column.label)}${prop("contentId", contentId)}>\n\n${body}\n\n</Column>`;
    })
    .join("\n\n");
  return `<Columns${prop("id", block.id)}${title}${summary}${editable}>\n${columns}\n</Columns>`;
}

function frontmatter(data: Record<string, unknown>): string {
  const visualUrl =
    typeof data.visualUrl === "string" && data.visualUrl.trim().length > 0
      ? data.visualUrl.trim()
      : null;
  const lines = Object.entries(data)
    .filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    )
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  if (visualUrl) {
    lines.unshift(
      `# Visual plan: open ${visualUrl} in a browser for the canvas and review UI.`,
    );
  }
  return `---\n${lines.join("\n")}\n---\n\n`;
}

function visualUrlForMdx(input: Pick<ExportPlanMdxInput, "planId" | "url">) {
  if (input.planId) {
    return `${HOSTED_PLAN_ORIGIN}/plans/${encodeURIComponent(input.planId)}`;
  }
  if (!input.url) return undefined;
  try {
    const parsed = new URL(input.url, HOSTED_PLAN_ORIGIN);
    return `${HOSTED_PLAN_ORIGIN}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return undefined;
  }
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
  const visualUrl = visualUrlForMdx(input);

  const planSource = [
    frontmatter({
      visualUrl,
      title: content.title ?? input.title,
      brief: content.brief ?? input.brief ?? undefined,
      version: content.version,
      notionSync: content.notionSync ? true : undefined,
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
    folder["canvas.mdx"] = await formatMdx(serializeCanvas(content, visualUrl));
  }
  if (content.prototype) {
    folder["prototype.mdx"] = await formatMdx(
      serializePrototype(content.prototype),
    );
  }

  return folder;
}

function serializePrototype(prototype: PlanPrototype): string {
  const screens = prototype.screens
    .map(
      (screen) =>
        `<PrototypeScreen${prop("id", screen.id)}${prop("title", screen.title)}${prop("summary", screen.summary)}${prop("surface", screen.surface)}${prop("renderMode", screen.renderMode)}${prop("state", screen.state)}${prop("html", screen.html)}${prop("css", screen.css)} />`,
    )
    .join("\n\n");
  const transitions = (prototype.transitions ?? [])
    .map(
      (transition) =>
        `<PrototypeTransition${prop("id", transition.id)}${prop("from", transition.from)}${prop("to", transition.to)}${prop("label", transition.label)}${prop("trigger", transition.trigger)} />`,
    )
    .join("\n");
  return `<Prototype${prop("title", prototype.title)}${prop("brief", prototype.brief)}${prop("surface", prototype.surface)}${prop("initialScreenId", prototype.initialScreenId)}>\n${[
    screens,
    transitions,
  ]
    .filter(Boolean)
    .join("\n\n")}\n</Prototype>`;
}

function serializeCanvasSourceComment(visualUrl: string | undefined): string {
  if (visualUrl) return `{/* Canvas source. Open ${visualUrl} */}\n\n`;
  return `{/* Canvas source. */}\n\n`;
}

function serializeCanvas(content: PlanContent, visualUrl?: string): string {
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
          return serializeArtboard(frame, "    ");
        })
        .join("\n\n");
      return `  <Section${prop("id", section.id)}${prop("title", section.title)}${prop("subtitle", section.subtitle)}>\n${artboards}\n  </Section>`;
    })
    .join("\n\n");
  const looseFrames = canvas.frames
    .filter((frame) => !emitted.has(frame.id))
    .map((frame) => serializeArtboard(frame, "  "))
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
        `  <Annotation${prop("id", annotation.id)}${prop("type", annotation.type)}${prop("title", annotation.title)}${prop("points", annotation.points)}${prop("style", annotation.style)}${prop("targetId", annotation.targetId)}${prop("placement", annotation.placement)}${prop("x", annotation.x)}${prop("y", annotation.y)}>\n\n${annotation.text.trim()}\n\n  </Annotation>`,
    )
    .join("\n\n");
  const connectors = (canvas.flow ?? [])
    .map(
      (connector) =>
        `  <Connector${prop("from", connector.from)}${prop("to", connector.to)}${prop("label", connector.label)} />`,
    )
    .join("\n");

  const board = `<DesignBoard${prop("title", canvas.title)}${prop("mode", canvas.mode)}${prop("design", canvas.design)}${prop("version", content.version)}>\n${[
    sectionSource,
    looseFrames,
    annotations,
    connectors,
  ]
    .filter(Boolean)
    .join("\n\n")}\n</DesignBoard>`;
  return `${serializeCanvasSourceComment(visualUrl)}${board}`;
}

function serializeArtboard(frame: PlanArtboard, indent = ""): string {
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
    return `${indent}<Artboard${attrs}>\n${serializeScreen(frame.wireframe, `${indent}  `)}\n${indent}</Artboard>`;
  }
  if (frame.legacyWireframe) {
    return `${indent}<Artboard${attrs}>\n${indent}  <LegacyWireframe${prop("data", frame.legacyWireframe)} />\n${indent}</Artboard>`;
  }
  return `${indent}<Artboard${attrs} />`;
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

function parseBlocksFromNodes(
  nodes: MdxNode[] | undefined,
  idContext: string,
  options: { firstMarkdownBlockId?: string } = {},
): PlanBlock[] {
  const blocks: PlanBlock[] = [];
  const looseNodes: MdxNode[] = [];
  let markdownIndex = 0;
  const flushLoose = () => {
    const markdown = stringifyChildren(looseNodes).trim();
    looseNodes.length = 0;
    if (!markdown) return;
    blocks.push({
      id:
        markdownIndex === 0 && options.firstMarkdownBlockId
          ? options.firstMarkdownBlockId
          : createPlanBlockId("markdown"),
      type: "rich-text",
      data: { markdown },
    });
    markdownIndex += 1;
  };

  for (const [index, child] of (nodes ?? []).entries()) {
    const block = parseBlock(child, `${idContext}-${index}`);
    if (block) {
      flushLoose();
      blocks.push(block);
    } else {
      looseNodes.push(child);
    }
  }
  flushLoose();
  return blocks;
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

// `attributeValue` and its estree literal walker now come from
// `@agent-native/core/blocks` (imported above) — the shared parse-side contract.

function stringAttr(node: MdxNode, name: string): string | undefined {
  const value = attributeValue(findAttribute(node, name));
  return typeof value === "string" ? value : undefined;
}

/**
 * Resolve a `<Screen>`/wireframe string attribute that must be a string when
 * present. Absent → undefined; present but not a string (number, object, or an
 * expression that can't be statically evaluated) → THROW, so a malformed
 * wireframe fails the import instead of silently dropping the value.
 */
function requiredStringAttr(node: MdxNode, name: string): string | undefined {
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

// Wireframe component tags (`Screen` plus every kit component like
// `FrameScreen`/`Row`/`Btn`/…). These are only valid INSIDE a `<WireframeBlock>`
// (plan.mdx) or an `<Artboard>` (canvas.mdx). If one appears as a standalone
// block-level node it is a malformed wireframe — we must fail loudly rather than
// let it fall through into rich-text and render as raw `<Screen .../>` source.
const WIREFRAME_ONLY_COMPONENTS = new Set<string>([
  "Screen",
  ...Object.keys(COMPONENT_TO_NODE),
]);

function parseBlock(node: MdxNode, idContext = "block"): PlanBlock | null {
  const name = elementName(node);
  if (name === "Columns") {
    const parsed = parseReadableColumnsBlock(node, idContext);
    if (parsed) return parsed;
  }
  // Fail loud: a bare wireframe element (`<Screen .../>` or a stray kit node) at
  // the block level is a malformed wireframe. Wrap it in `<WireframeBlock>` (or
  // an `<Artboard>` in canvas.mdx). Never silently emit it as raw text.
  if (name && WIREFRAME_ONLY_COMPONENTS.has(name)) {
    throw new Error(
      `Malformed wireframe: <${name}> must be nested inside a <WireframeBlock> (plan.mdx) or <Artboard> (canvas.mdx), not used as a standalone block.`,
    );
  }
  // Registry-first: a registered MDX tag parses through its spec. The shared
  // attribute reader resolves props the same way the legacy readers do, and the
  // stringified prose children feed the spec's `fromAttrs` (callout/rich-text).
  if (name && planMdxRegistry.hasTag(name)) {
    const base = baseBlock(node);
    const parsed = parseSpecBlock(
      planMdxRegistry,
      node as unknown as MdxJsxNode,
      base,
      stringifyChildren(node.children),
      idContext,
    );
    if (parsed) {
      return { ...base, type: parsed.type, data: parsed.data } as PlanBlock;
    }
  }
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
    // The `decision` block was retired; a legacy `<Decision>` round-trips into a
    // decision-tone `callout` whose body carries the question + options (matching
    // the stored-content migration in `plan-content.ts`).
    const question = stringAttr(node, "question") ?? base.title ?? "Decision";
    const options = (arrayAttr(node, "options") ?? []) as Array<{
      label?: string;
      detail?: string;
      recommended?: boolean;
    }>;
    const lines = options.map((option) => {
      const head = `- **${option.label ?? ""}**${
        option.recommended === true ? " — recommended" : ""
      }`;
      return option.detail ? `${head}: ${option.detail}` : head;
    });
    const body =
      [`**${question}**`, lines.join("\n")].filter(Boolean).join("\n\n") ||
      "Decision";
    return { ...base, type: "callout", data: { tone: "decision", body } };
  }
  if (name === "TabsBlock") {
    return {
      ...base,
      type: "tabs",
      data: {
        tabs: arrayAttr(node, "tabs") ?? [],
        orientation:
          stringAttr(node, "orientation") === "vertical"
            ? "vertical"
            : undefined,
      },
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

function parseReadableColumnsBlock(
  node: MdxNode,
  idContext: string,
): PlanBlock | null {
  const columnNodes = (node.children ?? []).filter(
    (child) => elementName(child) === "Column",
  );
  if (columnNodes.length === 0) return null;
  const base = baseBlock(node);
  return {
    ...base,
    type: "columns",
    data: {
      columns: columnNodes.map((column, index) => {
        const id =
          stringAttr(column, "id") ?? createPlanBlockId(`column-${index + 1}`);
        return {
          id,
          label: stringAttr(column, "label")?.trim() || undefined,
          blocks: parseBlocksFromNodes(
            column.children,
            `${idContext}-${base.id}-${id}`,
            { firstMarkdownBlockId: stringAttr(column, "contentId") },
          ),
        };
      }),
    },
  };
}

function parseScreen(
  node: MdxNode,
  idContext = "screen",
): PlanWireframeBlock["data"] {
  return {
    surface:
      (stringAttr(node, "surface") as PlanArtboard["surface"]) ?? "desktop",
    renderMode: stringAttr(
      node,
      "renderMode",
    ) as PlanWireframeBlock["data"]["renderMode"],
    caption: stringAttr(node, "caption"),
    html: requiredStringAttr(node, "html"),
    css: requiredStringAttr(node, "css"),
    skeleton: boolAttr(node, "skeleton"),
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
  const blocks = parseBlocksFromNodes(planTree.children, "plan-block");

  const canvas = files["canvas.mdx"]
    ? parseCanvas(files["canvas.mdx"])
    : undefined;
  const prototype = files["prototype.mdx"]
    ? parsePrototype(files["prototype.mdx"])
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
    notionSync: parsedMatter.data.notionSync === true ? true : undefined,
    prototype,
    canvas,
    blocks,
  };
  const normalized = normalizePlanContent(content);
  if (!normalized)
    throw new Error("MDX source did not parse into valid plan content.");
  return normalized;
}

function parsePrototype(source: string): PlanPrototype | undefined {
  const tree = parseMdx(source);
  const node = (tree.children ?? []).find(
    (child) => elementName(child) === "Prototype",
  );
  if (!node) return undefined;
  const screens: PlanPrototypeScreen[] = [];
  const transitions: NonNullable<PlanPrototype["transitions"]> = [];
  for (const child of node.children ?? []) {
    const name = elementName(child);
    if (name === "PrototypeScreen") {
      const id = stringAttr(child, "id");
      const html = stringAttr(child, "html");
      if (!id || !html) continue;
      screens.push({
        id,
        title: stringAttr(child, "title"),
        summary: stringAttr(child, "summary"),
        surface: stringAttr(child, "surface") as PlanPrototypeScreen["surface"],
        renderMode: stringAttr(
          child,
          "renderMode",
        ) as PlanPrototypeScreen["renderMode"],
        state: arrayAttr<NonNullable<PlanPrototypeScreen["state"]>[number]>(
          child,
          "state",
        ),
        html,
        css: stringAttr(child, "css"),
      });
      continue;
    }
    if (name === "PrototypeTransition") {
      const from = stringAttr(child, "from");
      const to = stringAttr(child, "to");
      if (!from || !to) continue;
      transitions.push({
        id: stringAttr(child, "id"),
        from,
        to,
        label: stringAttr(child, "label"),
        trigger: stringAttr(child, "trigger"),
      });
    }
  }
  if (screens.length === 0) return undefined;
  return {
    title: stringAttr(node, "title"),
    brief: stringAttr(node, "brief"),
    surface: stringAttr(node, "surface") as PlanPrototype["surface"],
    initialScreenId: stringAttr(node, "initialScreenId"),
    screens,
    ...(transitions.length > 0 ? { transitions } : {}),
  };
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
        type: stringAttr(child, "type") as PlanAnnotation["type"],
        title: stringAttr(child, "title"),
        text:
          stringifyChildren(child.children) ||
          stringAttr(child, "text") ||
          stringAttr(child, "body") ||
          "",
        points: arrayAttr<NonNullable<PlanAnnotation["points"]>[number]>(
          child,
          "points",
        ),
        style: dataAttr<PlanAnnotation["style"]>(child, "style"),
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
    mode: stringAttr(board, "mode") as NonNullable<
      PlanContent["canvas"]
    >["mode"],
    title: stringAttr(board, "title"),
    design: dataAttr<NonNullable<PlanContent["canvas"]>["design"]>(
      board,
      "design",
    ),
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

type MdxSourceFile = "plan.mdx" | "canvas.mdx" | "prototype.mdx";

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
