import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  BlockRegistry,
  prop,
  attributeValue,
  serializeSpecBlock,
  parseSpecBlock,
  type MdxJsxNode,
} from "@agent-native/core/blocks/server";
import matter from "gray-matter";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { z } from "zod";

import { parsePlanCommentAnchor } from "../shared/comment-context.js";
import {
  PLAN_ASSET_MAX_SINGLE_BYTES,
  PLAN_ASSET_MAX_TOTAL_BYTES,
  mimeTypeFromFilename,
} from "../shared/plan-assets.js";
import { registerPlanBlocks } from "../shared/plan-block-registry.js";
import {
  assertPlanContentAuthoringChanges,
  PLAN_BLOCK_MAX_DEPTH,
  PLAN_CONTENT_VERSION,
  createPlanBlockId,
  PlanContentValidationError,
  planContentSchema,
  storedPlanContentSchema,
  type PlanAnnotation,
  type PlanAnnotationPlacement,
  type PlanArtboard,
  type PlanBlock,
  type PlanBoardSection,
  type PlanColumnsBlock,
  type PlanConnector,
  type PlanContent,
  type PlanLegacyWireframeBlock,
  type PlanPrototype,
  type PlanPrototypeScreen,
  type PlanWireframeElName,
  type PlanWireframeBlock,
  type PlanWireframeNode,
} from "../shared/plan-content.js";
import type { PlanComment } from "../shared/types.js";
import {
  normalizePlanContent,
  normalizeStoredPlanContent,
} from "./plan-content.js";

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
  quasis?: Array<{
    type?: string;
    value?: { cooked?: string | null; raw?: string };
    range?: unknown;
  }>;
  expressions?: EstreeNode[];
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
  referencedBlockIds?: Iterable<string>;
};

const HOSTED_PLAN_ORIGIN = "https://plan.agent-native.com";

export const planMdxFileSchema = z.object({
  "plan.mdx": z.string().min(1),
  "canvas.mdx": z.string().optional(),
  "prototype.mdx": z.string().optional(),
  ".plan-state.json": z.string().optional(),
  "assets/": z.record(z.string(), z.string()).optional(),
});

const markdownBlockStateSchema = z.object({
  id: z.string().min(1),
  hash: z.string().min(1).optional(),
});

type MarkdownBlockState = z.infer<typeof markdownBlockStateSchema>;

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
    markdownBlockIds: z.array(z.string().min(1)).optional(),
    markdownBlocks: z.array(markdownBlockStateSchema).optional(),
  })
  .passthrough();

type PlanMdxState = z.infer<typeof planMdxStateSchema>;

export function referencedBlockIdsForPlanComments(
  comments: PlanComment[] | null | undefined,
): Set<string> {
  const ids = new Set<string>();
  for (const comment of comments ?? []) {
    if (comment.deletedAt) continue;
    const anchor = parsePlanCommentAnchor(comment.anchor);
    if (anchor?.sectionId) ids.add(anchor.sectionId);
    const selectorBlockId = anchor?.targetSelector?.match(
      /\[data-block-id=(?:"([^"]+)"|'([^']+)')\]/,
    );
    const matched = selectorBlockId?.[1] ?? selectorBlockId?.[2];
    if (matched) ids.add(matched);
  }
  return ids;
}

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

const BLOCK_TAG_ALIASES: Record<string, string> = {
  JsonExplorer: "Json",
  Tabs: "TabsBlock",
  ApiEndpoint: "Endpoint",
  DiffBlock: "Diff",
  AnnotatedCodeBlock: "AnnotatedCode",
  Wireframe: "WireframeBlock",
};

function resolveBlockTagAlias(name: string): string {
  return BLOCK_TAG_ALIASES[name] ?? name;
}

function normalizeBlockAliasNode(node: MdxNode, rawName: string): MdxNode {
  const name = resolveBlockTagAlias(rawName);
  if (name === rawName) return node;

  let attributes = node.attributes;
  if (rawName === "JsonExplorer") {
    const hasJson = attributes?.some(
      (attr) => attr.type === "mdxJsxAttribute" && attr.name === "json",
    );
    const dataAttr = attributes?.find(
      (attr) => attr.type === "mdxJsxAttribute" && attr.name === "data",
    );
    if (!hasJson && dataAttr) {
      const dataValue = attributeValue(dataAttr);
      const jsonValue =
        typeof dataValue === "string"
          ? dataValue
          : JSON.stringify(dataValue ?? null);
      attributes = [
        ...(attributes ?? []),
        {
          type: "mdxJsxAttribute",
          name: "json",
          value: jsonValue,
        },
      ];
    }
  }

  return { ...node, name, attributes };
}

function mdxProcessor() {
  return unified().use(remarkParse).use(remarkMdx).use(remarkStringify, {
    bullet: "-",
    fences: true,
    incrementListMarker: true,
  });
}

async function formatMdx(source: string): Promise<string> {
  const protectedSource = protectRawPayloadCodeFences(source.trim() + "\n");
  try {
    const prettier = await import("prettier");
    return restoreRawPayloadCodeFences(
      await prettier.format(protectedSource.source, { parser: "mdx" }),
      protectedSource.fences,
    );
  } catch {
    return source.trim() + "\n";
  }
}

const RAW_PAYLOAD_CODE_FENCE_RE = /^(`{3,})(html|css)([^\n]*)\n[\s\S]*?^\1$/gm;

function protectRawPayloadCodeFences(source: string): {
  source: string;
  fences: string[];
} {
  const fences: string[] = [];
  return {
    source: source.replace(RAW_PAYLOAD_CODE_FENCE_RE, (fence) => {
      const index = fences.push(fence) - 1;
      return `{/* __PLAN_MDX_RAW_FENCE_${index}__ */}`;
    }),
    fences,
  };
}

function restoreRawPayloadCodeFences(source: string, fences: string[]) {
  return source.replace(
    /\{\/\*\s*__PLAN_MDX_RAW_FENCE_(\d+)__\s*\*\/\}/g,
    (_marker, rawIndex: string) => fences[Number(rawIndex)] ?? "",
  );
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

function serializeScreen(
  data: {
    surface: string;
    renderMode?: string;
    caption?: string;
    frame?: string;
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
    prop("frame", data.frame),
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

function hasTopLevelCapitalizedMdxComponent(markdown: string): boolean {
  try {
    const tree = parseMdx(markdown);
    return (tree.children ?? []).some((child) => {
      const name = elementName(child);
      return !!name && /^[A-Z]/.test(name);
    });
  } catch {
    return true;
  }
}

function markdownRunHash(markdown: string): string {
  let hash = 0xcbf29ce484222325n;
  const value = markdown.trim();
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function markdownBlockState(id: string, markdown: string): MarkdownBlockState {
  return { id, hash: markdownRunHash(markdown) };
}

function shouldWrapTopLevelRichTextBlock(
  block: Extract<PlanBlock, { type: "rich-text" }>,
  referencedBlockIds: ReadonlySet<string>,
): boolean {
  return (
    block.data.markdown.trim().length === 0 ||
    Boolean(block.title) ||
    Boolean(block.summary) ||
    block.editable !== undefined ||
    referencedBlockIds.has(block.id) ||
    hasTopLevelCapitalizedMdxComponent(block.data.markdown)
  );
}

function serializeTopLevelBlock(
  block: PlanBlock,
  options: {
    referencedBlockIds: ReadonlySet<string>;
    markdownBlocks: MarkdownBlockState[];
  },
): string {
  if (
    block.type === "rich-text" &&
    !shouldWrapTopLevelRichTextBlock(block, options.referencedBlockIds)
  ) {
    const markdown = block.data.markdown.trim();
    options.markdownBlocks.push(markdownBlockState(block.id, markdown));
    return markdown;
  }
  return serializeBlock(block);
}

function serializeTopLevelBlocks(
  blocks: PlanBlock[],
  referencedBlockIds: ReadonlySet<string>,
): { body: string; markdownBlocks: MarkdownBlockState[] } {
  const markdownBlocks: MarkdownBlockState[] = [];
  const body = blocks
    .map((block) =>
      serializeTopLevelBlock(block, { referencedBlockIds, markdownBlocks }),
    )
    .join("\n\n");
  return { body, markdownBlocks };
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

function parseSimpleFrontmatter(source: string): {
  data: Record<string, unknown>;
  content: string;
} {
  if (!source.startsWith("---\n")) return { data: {}, content: source };

  const end = source.indexOf("\n---", 4);
  if (end < 0) return { data: {}, content: source };

  const raw = source.slice(4, end).trim();
  const content = source.slice(end + 4).replace(/^\r?\n/, "");
  const data: Record<string, unknown> = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const value = match[2].trim();
    if (!value) {
      data[match[1]] = "";
      continue;
    }
    try {
      data[match[1]] = JSON.parse(value);
    } catch {
      data[match[1]] = value.replace(/^['"]|['"]$/g, "").trim();
    }
  }
  return { data, content };
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

const PLAN_ASSET_ROUTE_PREFIX = "/_agent-native/plan-asset/";

function collectAssetRefs(blocks: PlanBlock[]): Map<string, PlanBlock> {
  const refs = new Map<string, PlanBlock>();
  for (const block of blocks) {
    if (block.type !== "image") continue;
    if (block.data.assetId) {
      refs.set(block.data.assetId, block);
    } else if (
      block.data.url &&
      block.data.url.startsWith(PLAN_ASSET_ROUTE_PREFIX)
    ) {
      const rest = block.data.url.slice(PLAN_ASSET_ROUTE_PREFIX.length);
      const assetId = decodeURIComponent(rest.split("/")[0] ?? "");
      if (assetId) refs.set(assetId, block);
    }
  }
  return refs;
}

async function loadAssetDataForExport(
  assetIds: string[],
): Promise<
  Map<
    string,
    { filename: string; base64: string | null; cdnUrl: string | null }
  >
> {
  if (assetIds.length === 0) return new Map();
  try {
    const { getDb, schema } = await import("./db/index.js");
    const { eq, inArray } = await import("drizzle-orm");
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.planAssets)
      .where(inArray(schema.planAssets.id, assetIds));

    const result = new Map<
      string,
      { filename: string; base64: string | null; cdnUrl: string | null }
    >();
    for (const row of rows) {
      if (row.data.startsWith("cdn:")) {
        result.set(row.id, {
          filename: row.filename,
          base64: null,
          cdnUrl: row.data.slice(4),
        });
      } else {
        result.set(row.id, {
          filename: row.filename,
          base64: row.data,
          cdnUrl: null,
        });
      }
    }
    return result;
  } catch {
    return new Map();
  }
}

export async function exportPlanContentToMdxFolder(
  input: ExportPlanMdxInput,
): Promise<PlanMdxFolder> {
  const content =
    normalizeStoredPlanContent(
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

  const assetRefs = collectAssetRefs(content.blocks);
  const assetData = await loadAssetDataForExport([...assetRefs.keys()]);

  const assetsFolder: Record<string, string> = {};
  const assetIdToRelativePath = new Map<string, string>();

  for (const [assetId, assetInfo] of assetData) {
    if (assetInfo.cdnUrl) {
      assetIdToRelativePath.set(assetId, assetInfo.cdnUrl);
      continue;
    }
    if (!assetInfo.base64) continue;

    const bytes = Buffer.from(assetInfo.base64, "base64");
    if (bytes.byteLength > PLAN_ASSET_MAX_SINGLE_BYTES) continue;

    const filename = assetInfo.filename;
    const relPath = `assets/${filename}`;
    assetsFolder[filename] = assetInfo.base64;
    assetIdToRelativePath.set(assetId, relPath);
  }

  const rewrittenBlocks = content.blocks.map((block): PlanBlock => {
    if (block.type !== "image") return block;
    const targetId = block.data.assetId;
    if (!targetId) return block;
    const resolvedPath = assetIdToRelativePath.get(targetId);
    if (!resolvedPath) return block;
    return {
      ...block,
      data: {
        ...block.data,
        assetId: undefined,
        url: resolvedPath,
      },
    };
  });

  const rewrittenContent: PlanContent = {
    ...content,
    blocks: rewrittenBlocks,
  };
  const referencedBlockIds = new Set(input.referencedBlockIds ?? []);
  const serializedPlanBlocks = serializeTopLevelBlocks(
    rewrittenContent.blocks,
    referencedBlockIds,
  );

  const planSource = [
    frontmatter({
      visualUrl,
      title: content.title ?? input.title,
      brief: content.brief ?? input.brief ?? undefined,
      version: content.version,
      notionSync: content.notionSync ? true : undefined,
    }),
    serializedPlanBlocks.body,
  ].join("");

  const folder: PlanMdxFolder = {
    "plan.mdx": await formatMdx(planSource),
    "assets/": Object.keys(assetsFolder).length > 0 ? assetsFolder : {},
    ".plan-state.json": JSON.stringify(
      {
        version: 1,
        planId: input.planId,
        markdownBlockIds:
          serializedPlanBlocks.markdownBlocks.length > 0
            ? serializedPlanBlocks.markdownBlocks.map((block) => block.id)
            : undefined,
        markdownBlocks:
          serializedPlanBlocks.markdownBlocks.length > 0
            ? serializedPlanBlocks.markdownBlocks
            : undefined,
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
        `  <Annotation${prop("id", annotation.id)}${prop("type", annotation.type)}${prop("title", annotation.title)}${prop("points", annotation.points)}${prop("style", annotation.style)}${prop("targetId", annotation.targetId)}${prop("placement", annotation.placement)}${prop("x", annotation.x)}${prop("y", annotation.y)}${prop("text", annotation.text.trim())} />`,
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
  const tree = mdxProcessor().parse(source) as unknown as MdxNode;
  restoreStaticTemplateLiteralAttributes(tree, source);
  return tree;
}

function findMdxTagEnd(source: string, start: number): number {
  let quote: '"' | "'" | "`" | null = null;
  let expressionDepth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") {
      expressionDepth += 1;
      continue;
    }
    if (char === "}" && expressionDepth > 0) {
      expressionDepth -= 1;
      continue;
    }
    if (char === ">" && expressionDepth === 0) return index;
  }
  return -1;
}

function rewriteCanvasAnnotationBodies(source: string): string {
  const annotationStart = /<Annotation\b/g;
  let cursor = 0;
  let changed = false;
  let output = "";
  let match: RegExpExecArray | null;

  while ((match = annotationStart.exec(source))) {
    const start = match.index;
    const openEnd = findMdxTagEnd(source, start + match[0].length);
    if (openEnd < 0) break;
    const openTag = source.slice(start, openEnd + 1);
    if (openTag.trimEnd().endsWith("/>") || openTag.includes(" text=")) {
      continue;
    }
    const closeStart = source.indexOf("</Annotation>", openEnd + 1);
    if (closeStart < 0) break;
    const closeEnd = closeStart + "</Annotation>".length;
    const text = source.slice(openEnd + 1, closeStart).trim();
    output += source.slice(cursor, start);
    output += `${openTag.slice(0, -1).trimEnd()}${prop("text", text)} />`;
    cursor = closeEnd;
    annotationStart.lastIndex = closeEnd;
    changed = true;
  }

  return changed ? `${output}${source.slice(cursor)}` : source;
}

function parseCanvasMdxFile(source: string): MdxNode {
  try {
    return parsePlanMdxFile("canvas.mdx", source);
  } catch (initialError) {
    const rewritten = rewriteCanvasAnnotationBodies(source);
    if (rewritten === source) throw initialError;
    try {
      return parsePlanMdxFile("canvas.mdx", rewritten);
    } catch {
      throw initialError;
    }
  }
}

type MdxParseError = {
  column?: unknown;
  line?: unknown;
  position?: { start?: { column?: unknown; line?: unknown } };
  reason?: unknown;
};

function parsePlanMdxFile(
  filename: "plan.mdx" | "canvas.mdx" | "prototype.mdx",
  source: string,
  lineOffset = 0,
): MdxNode {
  try {
    return parseMdx(source);
  } catch (error) {
    const mdxError = error as MdxParseError;
    const line = numericMdxPosition(
      mdxError.line ?? mdxError.position?.start?.line,
    );
    const column = numericMdxPosition(
      mdxError.column ?? mdxError.position?.start?.column,
    );
    const reason =
      typeof mdxError.reason === "string"
        ? mdxError.reason
        : error instanceof Error
          ? error.message
          : String(error);
    const location = line && column ? `:${line + lineOffset}:${column}` : "";
    throw new PlanContentValidationError(`${filename}${location}: ${reason}`);
  }
}

function numericMdxPosition(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function lineCountBeforeContent(source: string, content: string): number {
  const prefix = source.slice(0, Math.max(0, source.length - content.length));
  return (prefix.match(/\r?\n/g) ?? []).length;
}

function restoreStaticTemplateLiteralAttributes(tree: MdxNode, source: string) {
  const walk = (node: MdxNode | undefined) => {
    if (!node) return;
    for (const attr of node.attributes ?? []) {
      restoreStaticTemplateLiteralAttribute(attr, source);
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
}

function restoreStaticTemplateLiteralAttribute(
  attr: MdxAttribute,
  source: string,
) {
  if (attr.type !== "mdxJsxAttribute") return;
  if (!attr.value || typeof attr.value !== "object") return;
  const expression = staticTemplateLiteralExpression(attr.value);
  if (!expression) return;
  const range = expression.range;
  if (
    !Array.isArray(range) ||
    range.length !== 2 ||
    typeof range[0] !== "number" ||
    typeof range[1] !== "number"
  ) {
    return;
  }
  const rawTemplate = source.slice(range[0], range[1]);
  if (!rawTemplate.startsWith("`") || !rawTemplate.endsWith("`")) return;

  const restored = decodeTemplateLiteralRaw(rawTemplate.slice(1, -1));
  const quasi = expression.quasis?.[0];
  if (quasi?.value) {
    quasi.value.cooked = restored;
    quasi.value.raw = rawTemplate.slice(1, -1);
  }
  attr.value.value = rawTemplate;
}

function staticTemplateLiteralExpression(
  expression: MdxExpression,
): EstreeNode | undefined {
  const estree = (expression.data as { estree?: EstreeNode } | undefined)
    ?.estree;
  const statement = estree?.body?.[0];
  const node = statement?.expression;
  if (!node || node.type !== "TemplateLiteral") return undefined;
  if ((node.expressions?.length ?? 0) > 0) return undefined;
  if ((node.quasis?.length ?? 0) !== 1) return undefined;
  return node;
}

function decodeTemplateLiteralRaw(raw: string): string {
  let out = "";
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char !== "\\") {
      out += char;
      continue;
    }

    const next = raw[index + 1];
    if (next === undefined) {
      out += "\\";
      continue;
    }
    if (next === "\r" && raw[index + 2] === "\n") {
      index += 2;
      continue;
    }
    if (next === "\n" || next === "\r") {
      index += 1;
      continue;
    }

    switch (next) {
      case "b":
        out += "\b";
        index += 1;
        continue;
      case "f":
        out += "\f";
        index += 1;
        continue;
      case "n":
        out += "\n";
        index += 1;
        continue;
      case "r":
        out += "\r";
        index += 1;
        continue;
      case "t":
        out += "\t";
        index += 1;
        continue;
      case "v":
        out += "\v";
        index += 1;
        continue;
      case "0":
        out += "\0";
        index += 1;
        continue;
      case "x": {
        const hex = raw.slice(index + 2, index + 4);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          out += String.fromCharCode(Number.parseInt(hex, 16));
          index += 3;
          continue;
        }
        break;
      }
      case "u": {
        if (raw[index + 2] === "{") {
          const close = raw.indexOf("}", index + 3);
          const hex = close >= 0 ? raw.slice(index + 3, close) : "";
          if (/^[0-9a-fA-F]+$/.test(hex)) {
            out += String.fromCodePoint(Number.parseInt(hex, 16));
            index = close;
            continue;
          }
        }
        const hex = raw.slice(index + 2, index + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(Number.parseInt(hex, 16));
          index += 5;
          continue;
        }
        break;
      }
    }

    out += next;
    index += 1;
  }
  return out;
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

type ParsedPlanNode =
  | {
      type: "block";
      block: PlanBlock;
      hasSourceId: boolean;
      sourceId?: string;
      sourceIndex: number;
      matchPrevious: boolean;
      matchedPreviousId?: string;
    }
  | { type: "markdown"; markdown: string };

function resolveMarkdownRunIds(
  markdowns: string[],
  options: {
    firstMarkdownBlockId?: string;
    markdownBlockIds?: string[];
    markdownBlocks?: MarkdownBlockState[];
    previousBlocks?: PlanBlock[];
    usedBlockIds?: ReadonlySet<string>;
  } = {},
): string[] {
  const stateBlocks: MarkdownBlockState[] =
    options.markdownBlocks && options.markdownBlocks.length > 0
      ? options.markdownBlocks
      : (options.markdownBlockIds?.map((id) => ({ id })) ?? []);

  const previousIdsByMarkdown = new Map<string, string[]>();
  if (stateBlocks.length === 0) {
    const usedBlockIds = new Set(options.usedBlockIds);
    if (options.firstMarkdownBlockId) {
      usedBlockIds.add(options.firstMarkdownBlockId);
    }
    for (const block of options.previousBlocks ?? []) {
      if (block.type !== "rich-text" || usedBlockIds.has(block.id)) continue;
      const markdown = block.data.markdown.trim();
      const ids = previousIdsByMarkdown.get(markdown) ?? [];
      ids.push(block.id);
      previousIdsByMarkdown.set(markdown, ids);
    }
  }

  const hasHashes = stateBlocks.some((block) => block.hash);
  if (!hasHashes && stateBlocks.length === markdowns.length) {
    return stateBlocks.map((block) => block.id);
  }

  const byHash = new Map<string, string[]>();
  for (const block of stateBlocks) {
    if (!block.hash) continue;
    const ids = byHash.get(block.hash) ?? [];
    ids.push(block.id);
    byHash.set(block.hash, ids);
  }

  return markdowns.map((markdown, index) => {
    const ids = byHash.get(markdownRunHash(markdown));
    const matched = ids?.shift();
    if (matched) return matched;
    if (index === 0 && options.firstMarkdownBlockId) {
      return options.firstMarkdownBlockId;
    }
    const previousId = previousIdsByMarkdown.get(markdown.trim())?.shift();
    if (previousId) return previousId;
    return createPlanBlockId("markdown");
  });
}

function parseBlocksFromNodes(
  nodes: MdxNode[] | undefined,
  idContext: string,
  options: {
    firstMarkdownBlockId?: string;
    markdownBlockIds?: string[];
    markdownBlocks?: MarkdownBlockState[];
    preserveAuthoringFieldPresence?: boolean;
    salvageInvalidBlocks?: boolean;
    blockDepth?: number;
    previousBlocks?: PlanBlock[];
    generatedIds?: WeakSet<object>;
  } = {},
): PlanBlock[] {
  const generatedIds = options.generatedIds ?? new WeakSet<object>();
  const parsedNodes: ParsedPlanNode[] = [];
  const looseNodes: MdxNode[] = [];
  let previousBlockIndex = 0;
  let hasPendingMarkdown = false;
  const flushLoose = () => {
    const markdown = stringifyChildren(looseNodes).trim();
    looseNodes.length = 0;
    hasPendingMarkdown = false;
    if (!markdown) return;
    parsedNodes.push({ type: "markdown", markdown });
    previousBlockIndex += 1;
  };

  for (const child of nodes ?? []) {
    const blockIndex = previousBlockIndex + (hasPendingMarkdown ? 1 : 0);
    const sourceIdAttribute = findAttribute(child, "id");
    const sourceId = stringAttr(child, "id");
    const previousBlock = sourceIdAttribute
      ? options.previousBlocks?.find((candidate) => candidate.id === sourceId)
      : options.previousBlocks?.[blockIndex];
    let block: PlanBlock | null;
    try {
      const parsedBlock = parseBlock(
        child,
        `${idContext}-${blockIndex}`,
        options.preserveAuthoringFieldPresence,
        options.salvageInvalidBlocks,
        options.blockDepth ?? 0,
        previousBlock,
        generatedIds,
      );
      block = parsedBlock
        ? validateAndPreserveAuthoringField(
            parsedBlock,
            child,
            options.preserveAuthoringFieldPresence === true,
          )
        : parsedBlock;
      if (block && previousBlock) {
        block = reuseMatchingNestedBlockIds(block, previousBlock, generatedIds);
      }
      if (
        block &&
        !sourceIdAttribute &&
        previousBlock &&
        samePlanBlockSource(block, previousBlock)
      ) {
        block = { ...block, id: previousBlock.id };
      }
    } catch (error) {
      if (!options.salvageInvalidBlocks) throw error;
      flushLoose();
      const placeholder = invalidBlockWarningPlaceholder(
        sourceId ?? createStablePlanSourceId(`${idContext}-${blockIndex}`),
        elementName(child) ?? "unknown",
        stringAttr(child, "title"),
        error,
      );
      if (!sourceIdAttribute) generatedIds.add(placeholder);
      parsedNodes.push({
        type: "block",
        block: placeholder,
        hasSourceId: !!sourceIdAttribute,
        sourceId,
        sourceIndex: blockIndex,
        matchPrevious: false,
      });
      previousBlockIndex += 1;
      continue;
    }
    if (block) {
      flushLoose();
      if (!sourceIdAttribute) generatedIds.add(block);
      parsedNodes.push({
        type: "block",
        block,
        hasSourceId: !!sourceIdAttribute,
        sourceId,
        sourceIndex: blockIndex,
        matchPrevious: true,
      });
      previousBlockIndex += 1;
    } else {
      looseNodes.push(child);
      if (!hasPendingMarkdown) {
        hasPendingMarkdown = stringifyChildren([child]).trim().length > 0;
      }
    }
  }
  flushLoose();
  preserveIdlessBlockIds(
    parsedNodes,
    options.previousBlocks,
    idContext,
    generatedIds,
  );

  const markdowns = parsedNodes
    .filter(
      (node): node is Extract<ParsedPlanNode, { type: "markdown" }> =>
        node.type === "markdown",
    )
    .map((node) => node.markdown);
  const usedBlockIds = new Set<string>();
  for (const node of parsedNodes) {
    if (node.type === "block") usedBlockIds.add(node.block.id);
  }
  const markdownIds = resolveMarkdownRunIds(markdowns, {
    ...options,
    previousBlocks: options.previousBlocks,
    usedBlockIds,
  });
  let markdownIndex = 0;
  const blocks = parsedNodes.map((node) => {
    if (node.type === "block") return node.block;
    const id = markdownIds[markdownIndex++] ?? createPlanBlockId("markdown");
    return {
      id,
      type: "rich-text",
      data: { markdown: node.markdown },
    } satisfies PlanBlock;
  });
  return blocks;
}

function invalidBlockWarningPlaceholder(
  id: string,
  originalType: string,
  title: string | undefined,
  error: unknown,
): PlanBlock {
  const summary =
    error instanceof Error ? error.message.slice(0, 500) : "Parse error";
  return {
    id,
    type: "callout",
    title,
    data: {
      tone: "warning",
      body: `​__unknown_block__:${originalType}\n${summary}`,
    },
  };
}

function elementName(node: MdxNode | undefined): string | undefined {
  return node?.type === "mdxJsxFlowElement" ||
    node?.type === "mdxJsxTextElement"
    ? node.name
    : undefined;
}

const requiredAuthoringFieldByBlockType: Partial<
  Record<PlanBlock["type"], string>
> = {
  checklist: "items",
  "question-form": "questions",
  "visual-questions": "questions",
  tabs: "tabs",
  "data-model": "entities",
  "annotated-code": "code",
};

function isLegacyDefault(value: unknown): boolean {
  return (Array.isArray(value) && value.length === 0) || value === "";
}

function stripBlockIdsForSourceComparison(
  current: Record<string, unknown>,
  previous: Record<string, unknown>,
): void {
  if (current.type !== previous.type) return;
  delete current.id;
  delete previous.id;

  const type = current.type as PlanBlock["type"];
  const currentData = current.data as Record<string, unknown> | undefined;
  const previousData = previous.data as Record<string, unknown> | undefined;
  if (!currentData || !previousData) return;

  const requiredField = requiredAuthoringFieldByBlockType[type];
  if (
    requiredField &&
    currentData[requiredField] === undefined &&
    isLegacyDefault(previousData[requiredField])
  ) {
    delete currentData[requiredField];
    delete previousData[requiredField];
  }

  const nestedKey =
    type === "tabs" ? "tabs" : type === "columns" ? "columns" : null;
  if (!nestedKey) return;
  const currentGroups = currentData[nestedKey];
  const previousGroups = previousData[nestedKey];
  if (!Array.isArray(currentGroups) || !Array.isArray(previousGroups)) return;

  for (
    let index = 0;
    index < Math.min(currentGroups.length, previousGroups.length);
    index += 1
  ) {
    const currentGroup = currentGroups[index];
    const previousGroup = previousGroups[index];
    if (
      !currentGroup ||
      typeof currentGroup !== "object" ||
      !previousGroup ||
      typeof previousGroup !== "object"
    ) {
      continue;
    }
    delete (currentGroup as Record<string, unknown>).id;
    delete (previousGroup as Record<string, unknown>).id;
    const currentBlocks = (currentGroup as Record<string, unknown>).blocks;
    const previousBlocks = (previousGroup as Record<string, unknown>).blocks;
    if (!Array.isArray(currentBlocks) || !Array.isArray(previousBlocks))
      continue;
    for (
      let blockIndex = 0;
      blockIndex < Math.min(currentBlocks.length, previousBlocks.length);
      blockIndex += 1
    ) {
      const currentBlock = currentBlocks[blockIndex];
      const previousBlock = previousBlocks[blockIndex];
      if (
        currentBlock &&
        typeof currentBlock === "object" &&
        previousBlock &&
        typeof previousBlock === "object"
      ) {
        stripBlockIdsForSourceComparison(
          currentBlock as Record<string, unknown>,
          previousBlock as Record<string, unknown>,
        );
      }
    }
  }
}

function samePlanBlockSource(current: PlanBlock, previous: PlanBlock): boolean {
  if (current.type !== previous.type) return false;
  const currentCopy = JSON.parse(JSON.stringify(current)) as Record<
    string,
    unknown
  >;
  const previousCopy = JSON.parse(JSON.stringify(previous)) as Record<
    string,
    unknown
  >;
  stripBlockIdsForSourceComparison(currentCopy, previousCopy);
  return isDeepStrictEqual(currentCopy, previousCopy);
}

function canonicalSourceJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalSourceJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(
        ([key, entry]) =>
          `${JSON.stringify(key)}:${canonicalSourceJson(entry)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function stripEmptyRequiredFieldsForSourceKey(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const block = value as Record<string, unknown>;
  if (typeof block.type !== "string") return;
  const data = block.data as Record<string, unknown> | undefined;
  if (!data) return;

  const requiredField =
    requiredAuthoringFieldByBlockType[block.type as PlanBlock["type"]];
  if (requiredField && isLegacyDefault(data[requiredField])) {
    delete data[requiredField];
  }

  const nestedKey =
    block.type === "tabs"
      ? "tabs"
      : block.type === "columns"
        ? "columns"
        : null;
  const groups = nestedKey ? data[nestedKey] : null;
  if (!Array.isArray(groups)) return;
  for (const group of groups) {
    if (!group || typeof group !== "object") continue;
    const blocks = (group as Record<string, unknown>).blocks;
    if (!Array.isArray(blocks)) continue;
    for (const nestedBlock of blocks) {
      stripEmptyRequiredFieldsForSourceKey(nestedBlock);
    }
  }
}

function hasMissingRequiredSourceField(block: PlanBlock): boolean {
  const requiredField = requiredAuthoringFieldByBlockType[block.type];
  const data = block.data as Record<string, unknown>;
  if (requiredField && data[requiredField] === undefined) return true;

  const nestedKey =
    block.type === "tabs"
      ? "tabs"
      : block.type === "columns"
        ? "columns"
        : null;
  const groups = nestedKey ? data[nestedKey] : null;
  return (
    Array.isArray(groups) &&
    groups.some((group) => {
      if (!group || typeof group !== "object") return false;
      const blocks = (group as Record<string, unknown>).blocks;
      return (
        Array.isArray(blocks) &&
        blocks.some(
          (nestedBlock) =>
            nestedBlock &&
            typeof nestedBlock === "object" &&
            hasMissingRequiredSourceField(nestedBlock as PlanBlock),
        )
      );
    })
  );
}

function planBlockSourceFingerprint(
  block: PlanBlock,
  normalizeLegacyDefaults = false,
): string {
  const currentCopy = JSON.parse(JSON.stringify(block)) as Record<
    string,
    unknown
  >;
  const previousCopy = JSON.parse(JSON.stringify(block)) as Record<
    string,
    unknown
  >;
  stripBlockIdsForSourceComparison(currentCopy, previousCopy);
  if (normalizeLegacyDefaults) {
    stripEmptyRequiredFieldsForSourceKey(currentCopy);
  }
  return createHash("sha256")
    .update(canonicalSourceJson(currentCopy))
    .digest("hex");
}

function nestedPlanGroups(block: PlanBlock): unknown[] | null {
  if (block.type !== "tabs" && block.type !== "columns") return null;
  const groups = (block.data as Record<string, unknown>)[block.type];
  return Array.isArray(groups) ? groups : null;
}

function nestedGroupShellKey(group: unknown): string | null {
  if (!group || typeof group !== "object" || Array.isArray(group)) return null;
  const copy = JSON.parse(JSON.stringify(group)) as Record<string, unknown>;
  delete copy.id;
  delete copy.blocks;
  return canonicalSourceJson(copy);
}

function nestedGroupPairs(
  currentGroups: unknown[],
  previousGroups: unknown[],
  generatedIds: WeakSet<object>,
): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  const claimedPrevious = new Set<number>();
  const previousById = new Map<string, number>();
  for (const [index, group] of previousGroups.entries()) {
    if (!group || typeof group !== "object") continue;
    const id = (group as Record<string, unknown>).id;
    if (typeof id === "string" && id) previousById.set(id, index);
  }

  for (const [currentIndex, group] of currentGroups.entries()) {
    if (!group || typeof group !== "object") continue;
    const record = group as Record<string, unknown>;
    if (generatedIds.has(group)) continue;
    const id = record.id;
    const previousIndex = typeof id === "string" ? previousById.get(id) : null;
    if (previousIndex === undefined || previousIndex === null) continue;
    pairs.push([currentIndex, previousIndex]);
    claimedPrevious.add(previousIndex);
  }

  const currentByShell = new Map<string, number[]>();
  const previousByShell = new Map<string, number[]>();
  for (const [index, group] of currentGroups.entries()) {
    if (!group || typeof group !== "object" || !generatedIds.has(group)) {
      continue;
    }
    const key = nestedGroupShellKey(group);
    if (key === null) continue;
    const indices = currentByShell.get(key) ?? [];
    indices.push(index);
    currentByShell.set(key, indices);
  }
  for (const [index, group] of previousGroups.entries()) {
    if (!group || typeof group !== "object") continue;
    const key = nestedGroupShellKey(group);
    if (key === null) continue;
    const indices = previousByShell.get(key) ?? [];
    indices.push(index);
    previousByShell.set(key, indices);
  }

  for (const [key, currentIndices] of currentByShell) {
    const previousIndices = previousByShell.get(key);
    if (!previousIndices) continue;
    if (currentIndices.length === 1 && previousIndices.length === 1) {
      if (!claimedPrevious.has(previousIndices[0]!)) {
        pairs.push([currentIndices[0]!, previousIndices[0]!]);
      }
      continue;
    }
    if (currentIndices.length !== previousIndices.length) continue;
    for (const [offset, currentIndex] of currentIndices.entries()) {
      const previousIndex = previousIndices[offset];
      if (previousIndex === undefined || claimedPrevious.has(previousIndex)) {
        continue;
      }
      pairs.push([currentIndex, previousIndex]);
      claimedPrevious.add(previousIndex);
    }
  }
  return pairs;
}

function nestedSourceOverlapCount(
  current: PlanBlock,
  previous: PlanBlock,
  generatedIds: WeakSet<object>,
  fingerprintCountsByBlock: WeakMap<object, Map<string, number>>,
): number {
  const currentGroups = nestedPlanGroups(current);
  const previousGroups = nestedPlanGroups(previous);
  if (!currentGroups || !previousGroups) return 0;

  let overlap = 0;
  for (const [currentIndex, previousIndex] of nestedGroupPairs(
    currentGroups,
    previousGroups,
    generatedIds,
  )) {
    const currentGroup = currentGroups[currentIndex];
    const previousGroup = previousGroups[previousIndex];
    if (
      !currentGroup ||
      typeof currentGroup !== "object" ||
      !previousGroup ||
      typeof previousGroup !== "object"
    ) {
      continue;
    }
    const currentBlocks = (currentGroup as Record<string, unknown>).blocks;
    const previousBlocks = (previousGroup as Record<string, unknown>).blocks;
    if (!Array.isArray(currentBlocks) || !Array.isArray(previousBlocks)) {
      continue;
    }
    const currentCounts = new Map<string, number>();
    const previousCounts = new Map<string, number>();
    const addBlockSources = (
      counts: Map<string, number>,
      blocks: unknown[],
    ) => {
      for (const block of blocks) {
        if (!block || typeof block !== "object") continue;
        const blockCounts = nestedBlockSourceFingerprintCounts(
          block as PlanBlock,
          fingerprintCountsByBlock,
        );
        for (const [fingerprint, count] of blockCounts) {
          counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + count);
        }
      }
    };
    addBlockSources(currentCounts, currentBlocks);
    addBlockSources(previousCounts, previousBlocks);
    for (const [fingerprint, currentCount] of currentCounts) {
      overlap += Math.min(currentCount, previousCounts.get(fingerprint) ?? 0);
    }
  }
  return overlap;
}

function nestedBlockSourceFingerprintCounts(
  block: PlanBlock,
  cache: WeakMap<object, Map<string, number>>,
): Map<string, number> {
  const cached = cache.get(block);
  if (cached) return cached;

  const counts = new Map<string, number>();
  const fingerprint = planBlockSourceFingerprint(block, true);
  counts.set(fingerprint, 1);
  for (const group of nestedPlanGroups(block) ?? []) {
    if (!group || typeof group !== "object") continue;
    const children = (group as Record<string, unknown>).blocks;
    if (!Array.isArray(children)) continue;
    for (const child of children) {
      if (!child || typeof child !== "object") continue;
      for (const [
        childFingerprint,
        count,
      ] of nestedBlockSourceFingerprintCounts(child as PlanBlock, cache)) {
        counts.set(
          childFingerprint,
          (counts.get(childFingerprint) ?? 0) + count,
        );
      }
    }
  }
  cache.set(block, counts);
  return counts;
}

function nestedParentShellFingerprint(block: PlanBlock): string | null {
  const groups = nestedPlanGroups(block);
  if (!groups) return null;
  const copy = JSON.parse(JSON.stringify(block)) as Record<string, unknown>;
  delete copy.id;
  const data = copy.data as Record<string, unknown> | undefined;
  const copiedGroups = data?.[block.type];
  if (!Array.isArray(copiedGroups)) return null;
  for (const group of copiedGroups) {
    if (!group || typeof group !== "object") continue;
    const record = group as Record<string, unknown>;
    delete record.id;
    delete record.blocks;
  }
  return createHash("sha256").update(canonicalSourceJson(copy)).digest("hex");
}

function preserveIdlessBlockIds(
  parsedNodes: ParsedPlanNode[],
  previousBlocks: PlanBlock[] | undefined,
  idContext: string,
  generatedIds: WeakSet<object>,
): void {
  if (!previousBlocks?.length) return;

  const nestedFingerprintCountsByBlock = new WeakMap<
    object,
    Map<string, number>
  >();
  type Candidate = { block: PlanBlock; index: number };
  const exactCandidates = new Map<string, Candidate[]>();
  const legacyCandidates = new Map<string, Candidate[]>();
  const nestedShellCandidates = new Map<string, Candidate[]>();
  const addCandidate = (
    map: Map<string, Candidate[]>,
    key: string,
    candidate: Candidate,
  ) => {
    const candidates = map.get(key) ?? [];
    candidates.push(candidate);
    map.set(key, candidates);
  };
  const previousById = new Map(
    previousBlocks.map((block) => [block.id, block]),
  );
  for (const [index, block] of previousBlocks.entries()) {
    const candidate = { block, index };
    addCandidate(exactCandidates, planBlockSourceFingerprint(block), candidate);
    addCandidate(
      legacyCandidates,
      planBlockSourceFingerprint(block, true),
      candidate,
    );
    const shell = nestedParentShellFingerprint(block);
    if (shell) addCandidate(nestedShellCandidates, shell, candidate);
  }

  const claimedPreviousIds = new Set<string>();
  for (const node of parsedNodes) {
    if (node.type !== "block" || !node.hasSourceId || !node.sourceId) continue;
    const previous = previousById.get(node.sourceId);
    if (!previous) continue;
    node.matchedPreviousId = previous.id;
    claimedPreviousIds.add(previous.id);
    node.block = preserveGeneratedNestedIds(
      reuseMatchingNestedBlockIds(node.block, previous, generatedIds),
      previous,
      generatedIds,
      `${idContext}-${node.sourceIndex}`,
    );
  }

  const currentKeys = parsedNodes.map((node) =>
    node.type === "block"
      ? planBlockSourceFingerprint(node.block, true)
      : planBlockSourceFingerprint(
          {
            id: "",
            type: "rich-text",
            data: { markdown: node.markdown },
          },
          true,
        ),
  );
  const previousKeys = previousBlocks.map((block) =>
    planBlockSourceFingerprint(block, true),
  );
  const countKeys = (keys: string[]) => {
    const counts = new Map<string, number>();
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  };
  const currentKeyCounts = countKeys(currentKeys);
  const previousKeyCounts = countKeys(previousKeys);
  const previousUniqueIndexByKey = new Map<string, number>();
  previousKeys.forEach((key, index) => {
    if (previousKeyCounts.get(key) === 1) {
      previousUniqueIndexByKey.set(key, index);
    }
  });
  const anchorByCurrentIndex = new Map<
    number,
    { currentIndex: number; previousIndex: number }
  >();
  currentKeys.forEach((key, index) => {
    const previousIndex = previousUniqueIndexByKey.get(key);
    if (currentKeyCounts.get(key) === 1 && previousIndex !== undefined) {
      anchorByCurrentIndex.set(index, { currentIndex: index, previousIndex });
    }
  });
  const previousAnchorBefore: Array<
    { currentIndex: number; previousIndex: number } | undefined
  > = [];
  let previousAnchor:
    | { currentIndex: number; previousIndex: number }
    | undefined;
  for (let index = 0; index < currentKeys.length; index += 1) {
    previousAnchorBefore[index] = previousAnchor;
    previousAnchor = anchorByCurrentIndex.get(index) ?? previousAnchor;
  }
  const previousAnchorAfter: Array<
    { currentIndex: number; previousIndex: number } | undefined
  > = [];
  previousAnchor = undefined;
  for (let index = currentKeys.length - 1; index >= 0; index -= 1) {
    previousAnchorAfter[index] = previousAnchor;
    previousAnchor = anchorByCurrentIndex.get(index) ?? previousAnchor;
  }
  const anchorCountBefore: number[] = [];
  let anchorCount = 0;
  for (let index = 0; index < currentKeys.length; index += 1) {
    anchorCountBefore[index] = anchorCount;
    if (anchorByCurrentIndex.has(index)) anchorCount += 1;
  }
  const anchorCountAfter: number[] = [];
  anchorCount = 0;
  for (let index = currentKeys.length - 1; index >= 0; index -= 1) {
    anchorCountAfter[index] = anchorCount;
    if (anchorByCurrentIndex.has(index)) anchorCount += 1;
  }
  const predictedPreviousIndex = (currentIndex: number) => {
    const before = previousAnchorBefore[currentIndex];
    const after = previousAnchorAfter[currentIndex];
    if (
      before &&
      after &&
      before.currentIndex < currentIndex &&
      after.currentIndex > currentIndex &&
      after.previousIndex > before.previousIndex
    ) {
      const currentDistance = after.currentIndex - before.currentIndex;
      const previousDistance = after.previousIndex - before.previousIndex;
      return (
        before.previousIndex +
        ((currentIndex - before.currentIndex) / currentDistance) *
          previousDistance
      );
    }
    const nearest =
      before && after
        ? currentIndex - before.currentIndex <=
          after.currentIndex - currentIndex
          ? before
          : after
        : (before ?? after);
    return nearest
      ? nearest.previousIndex + (currentIndex - nearest.currentIndex)
      : currentIndex;
  };
  const currentCandidateRanks = new Map<ParsedPlanNode, Map<string, number>>();
  const currentCandidateCounts = new Map<string, number>();
  const candidateMatchKey = (
    node: Extract<ParsedPlanNode, { type: "block" }>,
    matchKind: "exact" | "legacy" | "nested-shell",
  ) => {
    const fingerprint =
      matchKind === "nested-shell"
        ? nestedParentShellFingerprint(node.block)
        : planBlockSourceFingerprint(node.block, matchKind === "legacy");
    return fingerprint ? `${matchKind}:${fingerprint}` : undefined;
  };
  parsedNodes.forEach((node) => {
    if (node.type !== "block" || node.hasSourceId || !node.matchPrevious) {
      return;
    }
    const ranks = new Map<string, number>();
    for (const matchKind of ["exact", "legacy", "nested-shell"] as const) {
      const key = candidateMatchKey(node, matchKind);
      if (!key || ranks.has(key)) continue;
      const rank = currentCandidateCounts.get(key) ?? 0;
      ranks.set(key, rank);
      currentCandidateCounts.set(key, rank + 1);
    }
    currentCandidateRanks.set(node, ranks);
  });
  const hasConfidentOutOfRangePrediction = (currentIndex: number) => {
    const before = previousAnchorBefore[currentIndex];
    const after = previousAnchorAfter[currentIndex];
    if (before && after) {
      const nearest =
        currentIndex - before.currentIndex <= after.currentIndex - currentIndex
          ? before
          : after;
      return nearest === before
        ? anchorCountBefore[currentIndex]! >= 2
        : anchorCountAfter[currentIndex]! >= 2;
    }
    return before
      ? anchorCountBefore[currentIndex]! >= 2
      : after
        ? anchorCountAfter[currentIndex]! >= 2
        : false;
  };
  const currentNestedShellCounts = new Map<string, number>();
  for (const node of parsedNodes) {
    if (node.type !== "block" || node.hasSourceId || !node.matchPrevious) {
      continue;
    }
    const shell = nestedParentShellFingerprint(node.block);
    if (shell) {
      currentNestedShellCounts.set(
        shell,
        (currentNestedShellCounts.get(shell) ?? 0) + 1,
      );
    }
  }
  const contextScore = (currentIndex: number, previousIndex: number) => {
    if (currentKeyCounts.size === 1 && previousKeyCounts.size === 1) return 0;
    let score = 0;
    for (let distance = 1; distance <= 16; distance += 1) {
      const weight = 17 - distance;
      const currentBefore = currentKeys[currentIndex - distance];
      const previousBefore = previousKeys[previousIndex - distance];
      if (
        currentBefore === undefined ||
        previousBefore === undefined ||
        currentBefore !== previousBefore
      ) {
        break;
      }
      score += weight;
    }
    for (let distance = 1; distance <= 16; distance += 1) {
      const weight = 17 - distance;
      const currentAfter = currentKeys[currentIndex + distance];
      const previousAfter = previousKeys[previousIndex + distance];
      if (
        currentAfter === undefined ||
        previousAfter === undefined ||
        currentAfter !== previousAfter
      ) {
        break;
      }
      score += weight;
    }
    return score;
  };
  type MatchPair = {
    node: Extract<ParsedPlanNode, { type: "block" }>;
    currentIndex: number;
    candidate: Candidate;
    priority: number;
    context: number;
    distance: number;
    matchKind: "exact" | "legacy" | "nested-shell";
  };
  const pairs: MatchPair[] = [];
  const insertedOutsidePreviousSource = new Set<ParsedPlanNode>();
  const addPairs = (
    node: Extract<ParsedPlanNode, { type: "block" }>,
    currentIndex: number,
    candidates: Candidate[] | undefined,
    priority: number,
    matchKind: "exact" | "legacy" | "nested-shell",
  ) => {
    const allCandidates = candidates ?? [];
    const useBoundedCandidates = allCandidates.length > 64;
    const matchKey = candidateMatchKey(node, matchKind);
    const rank = matchKey
      ? currentCandidateRanks.get(node)?.get(matchKey)
      : undefined;
    const rankedCandidate =
      rank === undefined ? undefined : allCandidates[rank];
    const currentCandidateCount = matchKey
      ? (currentCandidateCounts.get(matchKey) ?? 0)
      : 0;
    const before = previousAnchorBefore[currentIndex];
    const after = previousAnchorAfter[currentIndex];
    const previousCandidateStart = allCandidates[0]?.index;
    const previousCandidateEnd = allCandidates[allCandidates.length - 1]?.index;
    const anchorsCrossedCandidateRun =
      (before !== undefined &&
        previousCandidateStart !== undefined &&
        before.previousIndex >= previousCandidateStart) ||
      (after !== undefined &&
        previousCandidateEnd !== undefined &&
        after.previousIndex <= previousCandidateEnd);
    let expectedPreviousIndex = useBoundedCandidates
      ? predictedPreviousIndex(currentIndex)
      : null;
    if (useBoundedCandidates && matchKey && anchorsCrossedCandidateRun) {
      if (rankedCandidate) {
        expectedPreviousIndex = rankedCandidate.index;
      } else if (rank !== undefined) {
        insertedOutsidePreviousSource.add(node);
        return;
      }
    }
    if (
      expectedPreviousIndex !== null &&
      (expectedPreviousIndex < 0 ||
        expectedPreviousIndex >= previousBlocks.length)
    ) {
      const hasLeadingInsertionSignal =
        after !== undefined &&
        previousCandidateEnd !== undefined &&
        after.previousIndex > previousCandidateEnd;
      if (
        expectedPreviousIndex < 0 &&
        hasConfidentOutOfRangePrediction(currentIndex) &&
        allCandidates.length < currentCandidateCount &&
        (!rankedCandidate || hasLeadingInsertionSignal)
      ) {
        insertedOutsidePreviousSource.add(node);
        return;
      }
      if (!rankedCandidate) {
        insertedOutsidePreviousSource.add(node);
        return;
      }
      expectedPreviousIndex = rankedCandidate.index;
    }
    let candidateStart = 0;
    let candidateEnd = allCandidates.length;
    if (useBoundedCandidates) {
      const minimum = expectedPreviousIndex! - 16;
      const maximum = expectedPreviousIndex! + 16;
      let low = 0;
      let high = allCandidates.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (allCandidates[middle]!.index < minimum) low = middle + 1;
        else high = middle;
      }
      candidateStart = low;
      high = allCandidates.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (allCandidates[middle]!.index <= maximum) low = middle + 1;
        else high = middle;
      }
      candidateEnd = low;
    }
    const available = allCandidates
      .slice(candidateStart, candidateEnd)
      .filter((candidate) => !claimedPreviousIds.has(candidate.block.id));
    const representative = available[0];
    if (!representative) {
      return;
    }
    const isValid = (candidate: Candidate) =>
      matchKind === "nested-shell"
        ? nestedParentShellFingerprint(node.block) ===
            nestedParentShellFingerprint(candidate.block) &&
          nestedSourceOverlapCount(
            node.block,
            candidate.block,
            generatedIds,
            nestedFingerprintCountsByBlock,
          ) > 0
        : samePlanBlockSource(node.block, candidate.block);
    if (!isValid(representative)) return;
    const rankedPairs: MatchPair[] = [];
    for (const candidate of available) {
      if (!isValid(candidate)) continue;
      rankedPairs.push({
        node,
        currentIndex,
        candidate,
        priority,
        context: contextScore(currentIndex, candidate.index),
        distance:
          expectedPreviousIndex === null
            ? 0
            : Math.abs(candidate.index - expectedPreviousIndex),
        matchKind,
      });
    }
    rankedPairs.sort(
      (left, right) =>
        (expectedPreviousIndex === null
          ? right.context - left.context
          : left.distance - right.distance || right.context - left.context) ||
        left.candidate.index - right.candidate.index,
    );
    pairs.push(...rankedPairs.slice(0, useBoundedCandidates ? 4 : undefined));
  };

  parsedNodes.forEach((node, currentIndex) => {
    if (node.type === "block" && !node.hasSourceId && node.matchPrevious) {
      addPairs(
        node,
        currentIndex,
        exactCandidates.get(planBlockSourceFingerprint(node.block)),
        2_048,
        "exact",
      );
      if (hasMissingRequiredSourceField(node.block)) {
        addPairs(
          node,
          currentIndex,
          legacyCandidates.get(planBlockSourceFingerprint(node.block, true)),
          1_024,
          "legacy",
        );
      }
      const shell = nestedParentShellFingerprint(node.block);
      if (
        shell &&
        currentNestedShellCounts.get(shell) === 1 &&
        nestedShellCandidates.get(shell)?.length === 1
      ) {
        addPairs(
          node,
          currentIndex,
          nestedShellCandidates.get(shell),
          0,
          "nested-shell",
        );
      }
    }
  });

  pairs.sort(
    (left, right) =>
      right.priority - left.priority ||
      left.distance - right.distance ||
      right.context - left.context ||
      left.currentIndex - right.currentIndex ||
      left.candidate.index - right.candidate.index,
  );
  const matchedCurrentNodes = new Set<ParsedPlanNode>();
  for (const { node, candidate, matchKind } of pairs) {
    if (
      matchedCurrentNodes.has(node) ||
      claimedPreviousIds.has(candidate.block.id)
    ) {
      continue;
    }
    const matchedBlock = reuseMatchingNestedBlockIds(
      node.block,
      candidate.block,
      generatedIds,
    );
    if (
      matchKind === "nested-shell"
        ? nestedSourceOverlapCount(
            matchedBlock,
            candidate.block,
            generatedIds,
            nestedFingerprintCountsByBlock,
          ) === 0
        : !samePlanBlockSource(matchedBlock, candidate.block)
    ) {
      continue;
    }
    const matchedWithNestedIds = preserveGeneratedNestedIds(
      matchedBlock,
      candidate.block,
      generatedIds,
      `${idContext}-${candidate.index}`,
    );
    node.block = { ...matchedWithNestedIds, id: candidate.block.id };
    generatedIds.add(node.block);
    node.matchedPreviousId = candidate.block.id;
    claimedPreviousIds.add(candidate.block.id);
    matchedCurrentNodes.add(node);
  }

  const currentIdCounts = new Map<string, number>();
  for (const node of parsedNodes) {
    if (node.type !== "block") continue;
    currentIdCounts.set(
      node.block.id,
      (currentIdCounts.get(node.block.id) ?? 0) + 1,
    );
  }
  const reservedIds = new Set([
    ...previousBlocks.map((block) => block.id),
    ...currentIdCounts.keys(),
  ]);
  for (const node of parsedNodes) {
    if (node.type !== "block" || node.hasSourceId || node.matchedPreviousId) {
      continue;
    }
    const previousCount = currentIdCounts.get(node.block.id) ?? 0;
    const isInsertedOutsidePreviousSource =
      insertedOutsidePreviousSource.has(node);
    if (
      !isInsertedOutsidePreviousSource &&
      !claimedPreviousIds.has(node.block.id) &&
      previousCount <= 1
    ) {
      continue;
    }

    const positionalPrevious = isInsertedOutsidePreviousSource
      ? undefined
      : previousBlocks[node.sourceIndex];
    if (
      positionalPrevious &&
      !claimedPreviousIds.has(positionalPrevious.id) &&
      (currentIdCounts.get(positionalPrevious.id) ?? 0) <= 1
    ) {
      const previousId = node.block.id;
      const hasGeneratedId = generatedIds.has(node.block);
      node.block = { ...node.block, id: positionalPrevious.id };
      if (hasGeneratedId) generatedIds.add(node.block);
      node.matchedPreviousId = positionalPrevious.id;
      claimedPreviousIds.add(positionalPrevious.id);
      if (previousId !== positionalPrevious.id) {
        currentIdCounts.set(previousId, Math.max(0, previousCount - 1));
        currentIdCounts.set(
          positionalPrevious.id,
          (currentIdCounts.get(positionalPrevious.id) ?? 0) + 1,
        );
      }
      continue;
    }

    const previousId = node.block.id;
    const sourceKey = planBlockSourceFingerprint(node.block, true);
    let suffix = 0;
    let id: string;
    do {
      id = createStablePlanSourceId(
        `${idContext}-new-${node.sourceIndex}-${sourceKey}-${suffix}`,
      );
      suffix += 1;
    } while (reservedIds.has(id));
    const hasGeneratedId = generatedIds.has(node.block);
    node.block = { ...node.block, id };
    if (hasGeneratedId) generatedIds.add(node.block);
    currentIdCounts.set(previousId, Math.max(0, previousCount - 1));
    currentIdCounts.set(id, 1);
    reservedIds.add(id);
  }
}

function samePlanColumnSource(
  current: PlanColumnsBlock["data"]["columns"][number],
  previous: PlanColumnsBlock["data"]["columns"][number],
): boolean {
  const currentCopy = JSON.parse(JSON.stringify(current)) as Record<
    string,
    unknown
  >;
  const previousCopy = JSON.parse(JSON.stringify(previous)) as Record<
    string,
    unknown
  >;
  delete currentCopy.id;
  delete previousCopy.id;
  const currentBlocks = currentCopy.blocks;
  const previousBlocks = previousCopy.blocks;
  if (Array.isArray(currentBlocks) && Array.isArray(previousBlocks)) {
    for (
      let index = 0;
      index < Math.min(currentBlocks.length, previousBlocks.length);
      index += 1
    ) {
      const currentBlock = currentBlocks[index];
      const previousBlock = previousBlocks[index];
      if (
        currentBlock &&
        typeof currentBlock === "object" &&
        previousBlock &&
        typeof previousBlock === "object"
      ) {
        stripBlockIdsForSourceComparison(
          currentBlock as Record<string, unknown>,
          previousBlock as Record<string, unknown>,
        );
      }
    }
  }
  return isDeepStrictEqual(currentCopy, previousCopy);
}

function samePlanNestedGroupSource(
  current: Record<string, unknown>,
  previous: Record<string, unknown>,
): boolean {
  const currentCopy = JSON.parse(JSON.stringify(current)) as Record<
    string,
    unknown
  >;
  const previousCopy = JSON.parse(JSON.stringify(previous)) as Record<
    string,
    unknown
  >;
  delete currentCopy.id;
  delete previousCopy.id;

  const currentBlocks = currentCopy.blocks;
  const previousBlocks = previousCopy.blocks;
  if (Array.isArray(currentBlocks) && Array.isArray(previousBlocks)) {
    if (currentBlocks.length !== previousBlocks.length) return false;
    const blocksMatch = currentBlocks.every((block, index) => {
      const previousBlock = previousBlocks[index];
      return (
        !!block &&
        typeof block === "object" &&
        !!previousBlock &&
        typeof previousBlock === "object" &&
        samePlanBlockSource(block as PlanBlock, previousBlock as PlanBlock)
      );
    });
    if (!blocksMatch) return false;
    delete currentCopy.blocks;
    delete previousCopy.blocks;
  }
  return isDeepStrictEqual(currentCopy, previousCopy);
}

function reuseMatchingNestedBlockIds(
  current: PlanBlock,
  previous: PlanBlock,
  generatedIds?: WeakSet<object>,
): PlanBlock {
  if (current.type !== previous.type) return current;
  const nestedKey =
    current.type === "tabs"
      ? "tabs"
      : current.type === "columns"
        ? "columns"
        : null;
  if (!nestedKey) return current;

  const currentData = current.data as Record<string, unknown>;
  const previousData = previous.data as Record<string, unknown>;
  const currentGroups = currentData[nestedKey];
  const previousGroups = previousData[nestedKey];
  if (!Array.isArray(currentGroups) || !Array.isArray(previousGroups)) {
    return current;
  }

  const groups = currentGroups.map((group, groupIndex) => {
    const previousGroup = previousGroups[groupIndex];
    if (
      !group ||
      typeof group !== "object" ||
      !previousGroup ||
      typeof previousGroup !== "object"
    ) {
      return group;
    }

    const currentGroup = group as Record<string, unknown>;
    const previousGroupRecord = previousGroup as Record<string, unknown>;
    const currentBlocks = currentGroup.blocks;
    const previousBlocks = previousGroupRecord.blocks;
    const blocks =
      Array.isArray(currentBlocks) && Array.isArray(previousBlocks)
        ? currentBlocks.map((block, blockIndex) => {
            const previousBlock = previousBlocks[blockIndex];
            if (
              !block ||
              typeof block !== "object" ||
              !previousBlock ||
              typeof previousBlock !== "object"
            ) {
              return block;
            }
            const currentBlock = block as PlanBlock;
            const previousNestedBlock = previousBlock as PlanBlock;
            const hasCurrentId =
              typeof currentBlock.id === "string" && currentBlock.id;
            if (
              (hasCurrentId && currentBlock.id !== previousNestedBlock.id) ||
              (!hasCurrentId &&
                !samePlanBlockSource(currentBlock, previousNestedBlock))
            ) {
              return block;
            }
            const matchedBlock = {
              ...currentBlock,
              id: hasCurrentId ? currentBlock.id : previousNestedBlock.id,
            };
            if (generatedIds?.has(currentBlock)) generatedIds.add(matchedBlock);
            return reuseMatchingNestedBlockIds(
              matchedBlock,
              previousNestedBlock,
              generatedIds,
            );
          })
        : currentBlocks;

    const updatedGroup: Record<string, unknown> = {
      ...currentGroup,
      ...(Array.isArray(currentBlocks) ? { blocks } : {}),
    };
    if (generatedIds?.has(group)) generatedIds.add(updatedGroup);
    if (
      !(typeof currentGroup.id === "string" && currentGroup.id) &&
      samePlanNestedGroupSource(updatedGroup, previousGroupRecord)
    ) {
      updatedGroup.id = previousGroupRecord.id;
    }
    return updatedGroup;
  });

  const updated: PlanBlock = {
    ...current,
    data: { ...currentData, [nestedKey]: groups },
  } as PlanBlock;
  if (generatedIds?.has(current)) generatedIds.add(updated);
  return updated;
}

function preserveGeneratedNestedIds(
  current: PlanBlock,
  previous: PlanBlock,
  generatedIds: WeakSet<object>,
  idContext: string,
): PlanBlock {
  if (current.type !== previous.type) return current;
  const currentGroups = nestedPlanGroups(current);
  const previousGroups = nestedPlanGroups(previous);
  if (!currentGroups || !previousGroups) return current;

  const groupPairs = nestedGroupPairs(
    currentGroups,
    previousGroups,
    generatedIds,
  );
  const previousGroupIds = new Set(
    previousGroups.flatMap((group) => {
      if (!group || typeof group !== "object") return [];
      const id = (group as Record<string, unknown>).id;
      return typeof id === "string" && id ? [id] : [];
    }),
  );
  const matchedGroups = new Set(groupPairs.map(([index]) => index));
  const matchedGroupByCurrent = new Map(groupPairs);
  const groups = currentGroups.map((group, groupIndex) => {
    if (!group || typeof group !== "object") return group;
    const previousGroupIndex = matchedGroupByCurrent.get(groupIndex);
    const previousGroup =
      previousGroupIndex === undefined
        ? undefined
        : previousGroups[previousGroupIndex];
    if (!previousGroup || typeof previousGroup !== "object") return group;

    const currentGroup = group as Record<string, unknown>;
    const previousGroupRecord = previousGroup as Record<string, unknown>;
    let updatedGroup = currentGroup;
    if (
      generatedIds.has(group) &&
      typeof previousGroupRecord.id === "string" &&
      previousGroupRecord.id !== currentGroup.id
    ) {
      updatedGroup = { ...updatedGroup, id: previousGroupRecord.id };
      generatedIds.add(updatedGroup);
    }

    const currentBlocks = currentGroup.blocks;
    const previousBlocks = previousGroupRecord.blocks;
    if (!Array.isArray(currentBlocks) || !Array.isArray(previousBlocks)) {
      return updatedGroup;
    }
    if (
      !currentBlocks.every(
        (block) =>
          !!block &&
          typeof block === "object" &&
          typeof (block as Record<string, unknown>).type === "string",
      )
    ) {
      return updatedGroup;
    }
    const parsedBlocks: ParsedPlanNode[] = currentBlocks.map((block, index) => {
      const record = block as Record<string, unknown>;
      const hasSourceId = !generatedIds.has(block);
      return {
        type: "block",
        block: block as PlanBlock,
        hasSourceId,
        sourceId:
          hasSourceId && typeof record.id === "string" ? record.id : undefined,
        sourceIndex: index,
        matchPrevious: true,
      };
    });
    preserveIdlessBlockIds(
      parsedBlocks,
      previousBlocks as PlanBlock[],
      `${idContext}-${groupIndex}`,
      generatedIds,
    );
    const blocks = parsedBlocks.map((node) =>
      node.type === "block" ? node.block : null,
    );

    const updatedGroupWithBlocks = { ...updatedGroup, blocks };
    if (generatedIds.has(group)) generatedIds.add(updatedGroupWithBlocks);
    return updatedGroupWithBlocks;
  });

  const usedGroupIds = new Set<string>();
  for (const [groupIndex, group] of groups.entries()) {
    if (!group || typeof group !== "object") continue;
    const id = (group as Record<string, unknown>).id;
    if (
      typeof id === "string" &&
      id &&
      (!generatedIds.has(group) || matchedGroups.has(groupIndex))
    ) {
      usedGroupIds.add(id);
    }
  }
  const uniqueGroups = groups.map((group, groupIndex) => {
    if (
      !group ||
      typeof group !== "object" ||
      !generatedIds.has(group) ||
      matchedGroups.has(groupIndex)
    ) {
      return group;
    }
    const record = group as Record<string, unknown>;
    const oldId = record.id;
    if (typeof oldId !== "string" || !oldId) return group;
    if (!previousGroupIds.has(oldId) && !usedGroupIds.has(oldId)) {
      usedGroupIds.add(oldId);
      return group;
    }
    const shellKey = nestedGroupShellKey(group) ?? "group";
    let suffix = 0;
    let id: string;
    do {
      id = createStablePlanSourceId(
        `${idContext}-group-${groupIndex}-new-${shellKey}-${suffix}`,
      );
      suffix += 1;
    } while (previousGroupIds.has(id) || usedGroupIds.has(id));
    usedGroupIds.add(id);
    const updated = { ...record, id };
    generatedIds.add(updated);
    return updated;
  });

  const currentData = current.data as Record<string, unknown>;
  const updatedData =
    current.type === "tabs"
      ? {
          ...currentData,
          tabs: uniqueGroups as Extract<
            PlanBlock,
            { type: "tabs" }
          >["data"]["tabs"],
        }
      : {
          ...currentData,
          columns: uniqueGroups as PlanColumnsBlock["data"]["columns"],
        };
  const updated: PlanBlock = {
    ...current,
    data: updatedData,
  } as PlanBlock;
  if (generatedIds.has(current)) generatedIds.add(updated);
  return updated;
}

function validateAndPreserveAuthoringField(
  block: PlanBlock,
  node: MdxNode,
  preserveMissing: boolean,
): PlanBlock {
  const field = requiredAuthoringFieldByBlockType[block.type];
  if (!field) return block;
  const attribute = findAttribute(node, field);
  if (!attribute) {
    if (!preserveMissing) return block;
    const data = { ...block.data } as Record<string, unknown>;
    delete data[field];
    return { ...block, data } as PlanBlock;
  }

  const fieldValue = attributeValue(attribute);
  const valid =
    field === "code"
      ? typeof fieldValue === "string"
      : Array.isArray(fieldValue);
  if (!valid) {
    const expected = field === "code" ? "a string" : "an array";
    throw new PlanContentValidationError(
      `Plan MDX <${elementName(node) ?? block.type}> attribute "${field}" must resolve to ${expected}.`,
    );
  }

  return block;
}

function findAttribute(node: MdxNode, name: string): MdxAttribute | undefined {
  return node.attributes?.find(
    (attr) => attr.type === "mdxJsxAttribute" && attr.name === name,
  );
}

function stringAttr(node: MdxNode, name: string): string | undefined {
  const value = attributeValue(findAttribute(node, name));
  return typeof value === "string" ? value : undefined;
}

function requiredStringAttr(node: MdxNode, name: string): string | undefined {
  const attr = findAttribute(node, name);
  if (!attr) return undefined;
  const value = attributeValue(attr);
  if (typeof value !== "string") {
    throw new PlanContentValidationError(
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

function baseBlock(node: MdxNode, idContext: string) {
  return {
    id: stringAttr(node, "id") ?? createStablePlanSourceId(idContext),
    title: stringAttr(node, "title"),
    summary: stringAttr(node, "summary"),
    editable: boolAttr(node, "editable"),
  };
}

const WIREFRAME_ONLY_COMPONENTS = new Set<string>([
  "Screen",
  ...Object.keys(COMPONENT_TO_NODE),
]);

const NESTED_BLOCK_CHILD_COMPONENTS = new Set<string>([
  "Column",
  ...WIREFRAME_ONLY_COMPONENTS,
  "DesignBoard",
  "Section",
  "Artboard",
  "Annotation",
  "Connector",
  "LegacyWireframe",
  "Prototype",
  "PrototypeScreen",
  "PrototypeTransition",
]);

function knownBlockTags(): string[] {
  return [
    ...new Set<string>([...planMdxRegistry.tags(), ...BLOCK_COMPONENTS]),
  ].sort();
}

function editDistance(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  const rows = s.length + 1;
  const cols = t.length + 1;
  const dp: number[] = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i += 1) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j < cols; j += 1) {
      const tmp = dp[j];
      dp[j] =
        s[i - 1] === t[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[cols - 1];
}

function suggestBlockTag(name: string): string | undefined {
  const candidates = [...knownBlockTags(), ...Object.keys(BLOCK_TAG_ALIASES)];
  let best: string | undefined;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const score = editDistance(name, candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  const threshold = Math.max(3, Math.ceil(name.length / 3));
  if (best && bestScore <= threshold) {
    return resolveBlockTagAlias(best);
  }
  return undefined;
}

function parseBlock(
  node: MdxNode,
  idContext = "block",
  preserveAuthoringFieldPresence = false,
  salvageInvalidBlocks = false,
  blockDepth = 0,
  previousBlock?: PlanBlock,
  generatedIds?: WeakSet<object>,
): PlanBlock | null {
  const rawName = elementName(node);
  const dispatchNode: MdxNode = rawName
    ? normalizeBlockAliasNode(node, rawName)
    : node;
  const name = dispatchNode.name;
  node = dispatchNode;
  if (name === "Columns") {
    if (blockDepth >= PLAN_BLOCK_MAX_DEPTH) {
      throw new PlanContentValidationError(
        `Plan blocks exceed max depth ${PLAN_BLOCK_MAX_DEPTH}.`,
      );
    }
    const parsed = parseReadableColumnsBlock(
      node,
      idContext,
      preserveAuthoringFieldPresence,
      salvageInvalidBlocks,
      blockDepth,
      previousBlock,
      generatedIds,
    );
    if (parsed) return parsed;
  }
  if (name && WIREFRAME_ONLY_COMPONENTS.has(name)) {
    throw new PlanContentValidationError(
      `Malformed wireframe: <${name}> must be nested inside a <WireframeBlock> (plan.mdx) or <Artboard> (canvas.mdx), not used as a standalone block.`,
    );
  }
  if (name && planMdxRegistry.hasTag(name)) {
    const base = baseBlock(node, idContext);
    const parsed = parseSpecBlock(
      planMdxRegistry,
      node as unknown as MdxJsxNode,
      base,
      stringifyChildren(node.children),
      idContext,
    );
    if (parsed) {
      const block = {
        ...base,
        type: parsed.type,
        data: parsed.data,
      } as PlanBlock;
      if (block.type === "tabs" && generatedIds) {
        markGeneratedNestedContentIds(block.data.tabs, generatedIds);
      }
      return block;
    }
  }
  if (!name || !BLOCK_COMPONENTS.has(name)) {
    const isJsxElement =
      node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement";
    const isComponentTag = !!rawName && /^[A-Z]/.test(rawName);
    if (
      isJsxElement &&
      isComponentTag &&
      name &&
      !NESTED_BLOCK_CHILD_COMPONENTS.has(name)
    ) {
      const known = knownBlockTags().join(", ");
      const suggestion = suggestBlockTag(rawName);
      const hint = suggestion ? ` Did you mean <${suggestion}>?` : "";
      throw new PlanContentValidationError(
        `Unknown plan block <${rawName}> (plan.mdx).${hint} Known blocks: ${known}. ` +
          `If you meant a different block, use its exact tag. Lowercase HTML tags ` +
          `inside RichText are fine; capitalized component tags must be real blocks.`,
      );
    }
    return null;
  }
  const base = baseBlock(node, idContext);
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
    const tabs = (arrayAttr(node, "tabs") ?? []) as Extract<
      PlanBlock,
      { type: "tabs" }
    >["data"]["tabs"];
    if (generatedIds) markGeneratedNestedContentIds(tabs, generatedIds);
    return {
      ...base,
      type: "tabs",
      data: {
        tabs,
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

function markGeneratedNestedContentIds(
  value: unknown,
  generatedIds: WeakSet<object>,
): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) markGeneratedNestedContentIds(item, generatedIds);
    return;
  }

  const record = value as Record<string, unknown>;
  if (
    (typeof record.type === "string" || Array.isArray(record.blocks)) &&
    (typeof record.id !== "string" || !record.id)
  ) {
    generatedIds.add(record);
  }

  if (Array.isArray(record.blocks)) {
    markGeneratedNestedContentIds(record.blocks, generatedIds);
  }

  if (record.type === "tabs" || record.type === "columns") {
    const groups =
      record.data && typeof record.data === "object"
        ? (record.data as Record<string, unknown>)[record.type]
        : undefined;
    if (Array.isArray(groups)) {
      for (const group of groups) {
        if (!group || typeof group !== "object") continue;
        const groupRecord = group as Record<string, unknown>;
        if (typeof groupRecord.id !== "string" || !groupRecord.id) {
          generatedIds.add(groupRecord);
        }
        if (Array.isArray(groupRecord.blocks)) {
          markGeneratedNestedContentIds(groupRecord.blocks, generatedIds);
        }
      }
    }
  }
}

function parseReadableColumnsBlock(
  node: MdxNode,
  idContext: string,
  preserveAuthoringFieldPresence = false,
  salvageInvalidBlocks = false,
  blockDepth = 0,
  previousBlock?: PlanBlock,
  generatedIds?: WeakSet<object>,
): PlanBlock | null {
  const columnNodes = (node.children ?? []).filter(
    (child) => elementName(child) === "Column",
  );
  if (columnNodes.length === 0) return null;
  const base = baseBlock(node, idContext);
  const previousColumns =
    previousBlock?.type === "columns" ? previousBlock.data.columns : [];
  return {
    ...base,
    type: "columns",
    data: {
      columns: columnNodes.map((column, index) => {
        const sourceId = stringAttr(column, "id");
        const id =
          sourceId ??
          createStablePlanSourceId(`${idContext}-${base.id}-column-${index}`);
        const previousColumn = sourceId
          ? previousColumns.find((candidate) => candidate.id === sourceId)
          : previousColumns[index];
        const blocks = parseBlocksFromNodes(
          column.children,
          `${idContext}-${base.id}-${id}`,
          {
            firstMarkdownBlockId: stringAttr(column, "contentId"),
            preserveAuthoringFieldPresence,
            salvageInvalidBlocks,
            blockDepth: blockDepth + 1,
            previousBlocks: previousColumn?.blocks,
            generatedIds,
          },
        );
        const columnId =
          !sourceId &&
          previousColumn &&
          samePlanColumnSource(
            {
              id,
              label: stringAttr(column, "label")?.trim() || undefined,
              blocks,
            },
            previousColumn,
          )
            ? previousColumn.id
            : id;
        const parsedColumn = {
          id: columnId,
          label: stringAttr(column, "label")?.trim() || undefined,
          blocks,
        };
        if (!findAttribute(column, "id")) generatedIds?.add(parsedColumn);
        return parsedColumn;
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
    frame: stringAttr(node, "frame") as PlanWireframeBlock["data"]["frame"],
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

function createStablePlanSourceId(context: string): string {
  return `source-${createHash("sha256").update(context).digest("hex").slice(0, 24)}`;
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
  options: {
    allowStoredLegacyDefaults?: boolean;
    salvageInvalidBlocks?: boolean;
    validateAuthoringChangesAgainst?: PlanContent | null;
  } = {},
): Promise<PlanContent> {
  const files = planMdxFileSchema.parse(folder);
  const parsedMatter = parseSimpleFrontmatter(files["plan.mdx"]);
  const planTree = parsePlanMdxFile(
    "plan.mdx",
    parsedMatter.content,
    lineCountBeforeContent(files["plan.mdx"], parsedMatter.content),
  );
  const state = parsePlanState(files[".plan-state.json"]);
  const generatedIds = new WeakSet<object>();
  const blocks = parseBlocksFromNodes(planTree.children, "plan-block", {
    markdownBlockIds: state?.markdownBlockIds,
    markdownBlocks: state?.markdownBlocks,
    preserveAuthoringFieldPresence:
      options.validateAuthoringChangesAgainst !== undefined,
    salvageInvalidBlocks: options.salvageInvalidBlocks,
    previousBlocks: options.validateAuthoringChangesAgainst?.blocks,
    generatedIds,
  });

  const canvas = files["canvas.mdx"]
    ? parseCanvas(parseCanvasMdxFile(files["canvas.mdx"]))
    : undefined;
  const prototype = files["prototype.mdx"]
    ? parsePrototype(parsePlanMdxFile("prototype.mdx", files["prototype.mdx"]))
    : undefined;
  if (canvas && state?.canvas) canvas.viewport = state.canvas;

  let content: PlanContent = {
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
  if (
    options.salvageInvalidBlocks &&
    options.validateAuthoringChangesAgainst !== undefined
  ) {
    content = salvageInvalidAuthoringBlocks(
      content,
      options.validateAuthoringChangesAgainst,
    );
  } else if (options.validateAuthoringChangesAgainst !== undefined) {
    assertPlanContentAuthoringChanges(
      content,
      options.validateAuthoringChangesAgainst,
    );
  }
  const normalized = normalizePlanContent(content, {
    allowStoredLegacyDefaults: options.allowStoredLegacyDefaults,
    salvageInvalidBlocks: options.salvageInvalidBlocks,
  });
  if (!normalized)
    throw new PlanContentValidationError(
      "MDX source did not parse into valid plan content.",
    );
  return normalized;
}

function salvageInvalidAuthoringBlocks(
  content: PlanContent,
  previous: PlanContent | null | undefined,
): PlanContent {
  const blocks = salvageAuthoringBlockList(
    content.blocks,
    content.version,
    previous,
    0,
  );
  return { ...content, blocks };
}

function salvageAuthoringBlockList(
  blocks: PlanBlock[],
  version: number,
  previous: PlanContent | null | undefined,
  depth: number,
): PlanBlock[] {
  return blocks.map((block) => {
    const nested = salvageNestedAuthoringBlocks(
      block,
      version,
      previous,
      depth,
    );
    const validationSchema = previous
      ? storedPlanContentSchema
      : planContentSchema;
    const result = validationSchema.safeParse({ version, blocks: [nested] });
    if (!result.success) {
      return invalidBlockWarningPlaceholder(
        block.id,
        block.type,
        block.title,
        result.error,
      );
    }

    try {
      assertPlanContentAuthoringChanges(
        { version, blocks: [nested] },
        previous,
      );
      return nested;
    } catch (error) {
      if (
        previous &&
        !(
          error instanceof Error &&
          error.message.startsWith(
            "Plan source edit contains invalid authored block data",
          )
        )
      ) {
        throw error;
      }
      return invalidBlockWarningPlaceholder(
        block.id,
        block.type,
        block.title,
        error,
      );
    }
  });
}

function salvageNestedAuthoringBlocks(
  block: PlanBlock,
  version: number,
  previous: PlanContent | null | undefined,
  depth: number,
): PlanBlock {
  const record = block as unknown as Record<string, unknown>;
  const data = record.data;
  if (!data || typeof data !== "object") return block;
  const nestedKey =
    record.type === "tabs"
      ? "tabs"
      : record.type === "columns"
        ? "columns"
        : null;
  if (!nestedKey) return block;

  const nestedData = data as Record<string, unknown>;
  const groups = nestedData[nestedKey];
  if (!Array.isArray(groups)) return block;
  if (depth >= PLAN_BLOCK_MAX_DEPTH && hasNestedBlocks(groups)) {
    return invalidBlockWarningPlaceholder(
      block.id,
      block.type,
      block.title,
      new Error(`Plan blocks exceed max depth ${PLAN_BLOCK_MAX_DEPTH}.`),
    );
  }

  return {
    ...block,
    data: {
      ...nestedData,
      [nestedKey]: groups.map((group) => {
        if (!group || typeof group !== "object") return group;
        const groupRecord = group as Record<string, unknown>;
        if (!Array.isArray(groupRecord.blocks)) return group;
        return {
          ...groupRecord,
          blocks: salvageAuthoringBlockList(
            groupRecord.blocks as PlanBlock[],
            version,
            previous,
            depth + 1,
          ),
        };
      }),
    },
  } as PlanBlock;
}

function hasNestedBlocks(groups: unknown[]): boolean {
  return groups.some(
    (group) =>
      !!group &&
      typeof group === "object" &&
      Array.isArray((group as Record<string, unknown>).blocks) &&
      ((group as Record<string, unknown>).blocks as unknown[]).length > 0,
  );
}

function parsePrototype(tree: MdxNode): PlanPrototype | undefined {
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
    throw new PlanContentValidationError(
      ".plan-state.json is not valid visual plan state.",
    );
  }
}

function parseCanvas(tree: MdxNode): PlanContent["canvas"] {
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

function makeRichTextMdxNode(input: {
  blockId: string;
  markdown: string;
  title?: string;
}): MdxNode {
  const node: MdxNode = {
    type: "mdxJsxFlowElement",
    name: "RichText",
    attributes: [],
    children: parseMdx(input.markdown).children ?? [],
  };
  setAttribute(node, "id", input.blockId);
  setAttribute(node, "title", input.title);
  return node;
}

function hasTopLevelComponent(nodes: MdxNode[] | undefined): boolean {
  return (nodes ?? []).some((node) => {
    const name = elementName(node);
    return !!name && /^[A-Z]/.test(name);
  });
}

type LooseMarkdownRun = {
  start: number;
  end: number;
  markdown: string;
};

function collectLooseMarkdownRuns(children: MdxNode[]): LooseMarkdownRun[] {
  const runs: LooseMarkdownRun[] = [];
  let runStart: number | null = null;
  for (let index = 0; index <= children.length; index += 1) {
    const child = children[index];
    const atEnd = index === children.length;
    const isBlockBoundary =
      !atEnd && !!parseBlock(child, `markdown-run-${index}`);
    if (!atEnd && !isBlockBoundary) {
      runStart ??= index;
      continue;
    }
    if (runStart === null) continue;
    const markdown = stringifyChildren(children.slice(runStart, index)).trim();
    if (markdown) runs.push({ start: runStart, end: index, markdown });
    runStart = null;
  }
  return runs;
}

function markdownStatesForRuns(
  runs: LooseMarkdownRun[],
  ids: string[],
): MarkdownBlockState[] {
  return runs.map((run, index) =>
    markdownBlockState(
      ids[index] ?? createPlanBlockId("markdown"),
      run.markdown,
    ),
  );
}

function replaceLooseMarkdownBlockById(
  tree: MdxNode,
  patch: Extract<PlanMdxSourcePatch, { op: "replace-markdown-block" }>,
  options: {
    markdownBlockIds?: string[];
    markdownBlocks?: MarkdownBlockState[];
  },
): { changed: boolean; markdownBlocks: MarkdownBlockState[] } {
  const children = tree.children ?? [];
  const runs = collectLooseMarkdownRuns(children);
  const runIds = resolveMarkdownRunIds(
    runs.map((run) => run.markdown),
    options,
  );
  const targetIndex = runIds.indexOf(patch.blockId);
  if (targetIndex < 0) {
    return { changed: false, markdownBlocks: options.markdownBlocks ?? [] };
  }
  const targetRun = runs[targetIndex];
  if (!targetRun) {
    return { changed: false, markdownBlocks: options.markdownBlocks ?? [] };
  }

  const replacement = parseMdx(patch.markdown);
  const replacementChildren = replacement.children ?? [];
  const replacementMarkdown = stringifyChildren(replacementChildren).trim();
  let nextRunIds = [...runIds];

  if (!replacementMarkdown) {
    children.splice(targetRun.start, targetRun.end - targetRun.start);
    nextRunIds.splice(targetIndex, 1);
  } else if (patch.title || hasTopLevelComponent(replacementChildren)) {
    children.splice(
      targetRun.start,
      targetRun.end - targetRun.start,
      makeRichTextMdxNode({
        blockId: patch.blockId,
        markdown: patch.markdown,
        title: patch.title,
      }),
    );
    nextRunIds.splice(targetIndex, 1);
  } else {
    children.splice(
      targetRun.start,
      targetRun.end - targetRun.start,
      ...replacementChildren,
    );
  }

  tree.children = children;
  const nextRuns = collectLooseMarkdownRuns(children);
  return {
    changed: true,
    markdownBlocks: markdownStatesForRuns(nextRuns, nextRunIds),
  };
}

function writePlanState(
  folder: PlanMdxFolder,
  state: PlanMdxState | undefined,
) {
  const markdownBlocks = state?.markdownBlocks;
  const markdownBlockIds = Array.isArray(markdownBlocks)
    ? markdownBlocks.map((block) => block.id)
    : (state?.markdownBlockIds ?? []);
  folder[".plan-state.json"] = JSON.stringify(
    {
      ...(state ?? { version: 1 }),
      markdownBlockIds:
        markdownBlockIds.length > 0 ? markdownBlockIds : undefined,
      markdownBlocks:
        markdownBlocks && markdownBlocks.length > 0
          ? markdownBlocks
          : undefined,
    },
    null,
    2,
  );
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
      const state = parsePlanState(next[".plan-state.json"]);
      let markdownBlocks = state?.markdownBlocks
        ? [...state.markdownBlocks]
        : [];
      let markdownBlocksChanged = false;
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
        if (!changed) {
          const result = replaceLooseMarkdownBlockById(tree, patch, {
            markdownBlockIds: state?.markdownBlockIds,
            markdownBlocks,
          });
          changed = result.changed;
          markdownBlocksChanged = result.changed;
          markdownBlocks = result.markdownBlocks;
        }
        if (!changed)
          throw new Error(
            `Markdown block ${patch.blockId} not found in plan.mdx.`,
          );
      });
      if (markdownBlocksChanged) {
        writePlanState(next, {
          ...(state ?? { version: 1 }),
          markdownBlocks,
        });
      }
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
