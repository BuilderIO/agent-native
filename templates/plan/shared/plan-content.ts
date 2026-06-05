import { z } from "zod";

/**
 * Plan content model.
 *
 * Design contract (read before editing):
 * - The MODEL emits lean, semantic structured content. The RENDERER owns ALL
 *   visual quality (flex layout, fonts, density, theme, spacing, the wobble).
 * - "SEMANTIC wireframes, SPATIAL board." Wireframe INTERNALS (the kit tree)
 *   carry NO geometry — they are pure flex laid out by the renderer. The BOARD
 *   level (artboard placement, annotation placement, connector routing) KEEPS
 *   geometry, because spatial composition legitimately needs positions.
 * - Node/block names mirror component names (Artboard, Annotation, Connector,
 *   Section, and the screen primitives) so the JSON round-trips cleanly to MDX
 *   later. JSON stays the runtime model now; MDX export/import is a follow-on.
 * - A LEGACY region-based wireframe shape is kept as a renderer FALLBACK for
 *   old / imported plans. New generation never emits regions, but the renderer
 *   must still render them. Do NOT delete it; do NOT lossily migrate old plans.
 */

/** Bumped to 2 for the kit-tree wireframe model. Parsing accepts version >= 1. */
export const PLAN_CONTENT_VERSION = 2;

/** Minimum content version the parser/migrator will attempt to read. */
export const PLAN_CONTENT_MIN_VERSION = 1;

export type PlanBlockType =
  | "rich-text"
  | "callout"
  | "checklist"
  | "table"
  | "code-tabs"
  | "implementation-map"
  | "wireframe"
  | "diagram"
  | "image"
  | "decision"
  | "tabs"
  | "custom-html"
  | "visual-questions"
  // Deprecated: region-based wireframe kept for old/imported plans only.
  | "legacy-wireframe";

export type PlanBlockBase = {
  id: string;
  type: PlanBlockType;
  title?: string;
  summary?: string;
  editable?: boolean;
};

export type PlanRichTextBlock = PlanBlockBase & {
  type: "rich-text";
  data: {
    markdown: string;
    doc?: unknown;
  };
};

export type PlanCalloutBlock = PlanBlockBase & {
  type: "callout";
  data: {
    tone?: "info" | "decision" | "risk" | "warning" | "success";
    body: string;
  };
};

export type PlanChecklistBlock = PlanBlockBase & {
  type: "checklist";
  data: {
    items: Array<{
      id: string;
      label: string;
      checked?: boolean;
      note?: string;
    }>;
  };
};

export type PlanTableBlock = PlanBlockBase & {
  type: "table";
  data: {
    columns: string[];
    rows: string[][];
  };
};

export type PlanCodeTabsBlock = PlanBlockBase & {
  type: "code-tabs";
  data: {
    tabs: Array<{
      id: string;
      label: string;
      language?: string;
      code: string;
      caption?: string;
    }>;
  };
};

export type PlanImplementationMapBlock = PlanBlockBase & {
  type: "implementation-map";
  data: {
    files: Array<{
      path: string;
      title?: string;
      note: string;
      language?: string;
      snippet?: string;
    }>;
  };
};

/* -------------------------------------------------------------------------- */
/* Wireframe — declarative KIT TREE (no coordinates, no raw HTML)             */
/* -------------------------------------------------------------------------- */

/**
 * Surface preset. Drives the artboard footprint/aspect in the renderer.
 * Kills the desktop/mobile default bias: a popover wireframe stays a popover.
 */
export type PlanWireframeSurface =
  | "desktop"
  | "mobile"
  | "popover"
  | "panel"
  | "browser";

/** Tone keyword reused across screen primitives. The renderer maps to color. */
export type PlanWireframeTone = "default" | "accent" | "warn" | "ok" | "muted";

/**
 * Names of the kit primitives. These are component-like (MDX-friendly). The
 * renderer maps each to a flex kit component. Layout is ALWAYS flex; row/col/
 * sidebar/main set the flex direction. Real labels/dates live in props; pure
 * placeholder text only via `lines` / valueless `text`.
 */
export type PlanWireframeElName =
  | "screen"
  | "browserBar"
  | "statusBar"
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
 * NOTE: there is intentionally NO x/y/width/height here — wireframe internals
 * are geometry-free and laid out by the renderer with flex.
 */
export type PlanWireframeNode = {
  /** Stable id for node-addressable patches; auto-assigned when absent. */
  id?: string;
  el: PlanWireframeElName;
  children?: PlanWireframeNode[];

  // Generic content props
  /** Real text content (title/text/btn/chip/pill/navItem/section labels, etc.). */
  text?: string;
  value?: string;
  label?: string;
  placeholder?: string;
  title?: string;

  // Styling-by-intent (semantic only; renderer owns actual color/size)
  tone?: PlanWireframeTone;
  color?: PlanWireframeTone;
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
  /** Number of placeholder lines for `lines`. */
  n?: number;
  /** Relative widths (0-100) for placeholder `lines`. */
  widths?: number[];
  /** Icon hint for `fab` / `iconSquare`. */
  icon?: string;

  // taskRow specifics
  note?: string;
  due?: string;
  dueTone?: PlanWireframeTone;

  // Collection props (chips, kv)
  items?: Array<{
    label: string;
    active?: boolean;
    count?: number;
    dot?: boolean;
  }>;
  rows?: Array<{ k: string; v: string }>;
};

export type PlanWireframeBlock = PlanBlockBase & {
  type: "wireframe";
  data: {
    surface: PlanWireframeSurface;
    caption?: string;
    screen: PlanWireframeNode[];
  };
};

/* -------------------------------------------------------------------------- */
/* Legacy region wireframe — renderer FALLBACK for old / imported plans only  */
/* -------------------------------------------------------------------------- */

/**
 * @deprecated Region-based wireframe shape. New generation never emits this;
 * the renderer keeps rendering it so old/imported plans are not lost. Do NOT
 * lossily convert these to empty kit trees.
 */
export type PlanWireframeRegion = {
  id: string;
  kind:
    | "nav"
    | "header"
    | "list"
    | "form"
    | "toolbar"
    | "content"
    | "button"
    | "input"
    | "custom";
  label?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  emphasis?: boolean;
};

export type PlanWireframeTemplate =
  | "context-xray-app"
  | "context-xray-default"
  | "context-xray-expanded"
  | "context-xray-map"
  | "context-xray-chat-cleanup";

/** @deprecated Legacy region-based wireframe block (renderer fallback only). */
export type PlanLegacyWireframeBlock = PlanBlockBase & {
  type: "legacy-wireframe";
  data: {
    viewport?: "desktop" | "tablet" | "phone";
    template?: PlanWireframeTemplate;
    caption?: string;
    regions: PlanWireframeRegion[];
  };
};

/**
 * @deprecated Back-compat alias. Out-of-scope code still references
 * `PlanSketchWireframeBlock` and `PlanSketchWireframeBlock["data"]` (region
 * shape). New code should use `PlanWireframeBlock` (kit tree) or, for the
 * fallback, `PlanLegacyWireframeBlock`.
 */
export type PlanSketchWireframeBlock = PlanLegacyWireframeBlock;

/* -------------------------------------------------------------------------- */
/* Diagram                                                                    */
/* -------------------------------------------------------------------------- */

export type PlanDiagramNode = {
  id: string;
  label: string;
  detail?: string;
  x?: number;
  y?: number;
};

export type PlanDiagramEdge = {
  from: string;
  to: string;
  label?: string;
};

export type PlanDiagramBlock = PlanBlockBase & {
  type: "diagram";
  data: {
    nodes: PlanDiagramNode[];
    edges: PlanDiagramEdge[];
    notes?: Array<{
      id: string;
      text: string;
      x?: number;
      y?: number;
    }>;
  };
};

/** @deprecated Back-compat alias for `PlanDiagramBlock`. */
export type PlanSketchDiagramBlock = PlanDiagramBlock;

/* -------------------------------------------------------------------------- */
/* Image                                                                      */
/* -------------------------------------------------------------------------- */

export type PlanImageBlock = PlanBlockBase & {
  type: "image";
  data: {
    /** Prefer an asset id over a raw url so media stays portable. */
    assetId?: string;
    url?: string;
    alt: string;
    caption?: string;
    fit?: "contain" | "cover";
  };
};

export type PlanDecisionBlock = PlanBlockBase & {
  type: "decision";
  data: {
    question: string;
    options: Array<{
      id: string;
      label: string;
      detail?: string;
      /**
       * Authored recommendation only. A reviewer's actual selection does NOT
       * live here — responses belong in plan_comments / events, never in the
       * canonical plan body.
       */
      recommended?: boolean;
    }>;
  };
};

export type PlanTabsBlock = PlanBlockBase & {
  type: "tabs";
  data: {
    tabs: Array<{
      id: string;
      label: string;
      blocks: PlanBlock[];
    }>;
  };
};

export type PlanCustomHtmlBlock = PlanBlockBase & {
  type: "custom-html";
  data: {
    html: string;
    css?: string;
    caption?: string;
  };
};

export type PlanVisualQuestion = {
  id: string;
  title: string;
  subtitle?: string;
  mode: "single" | "multi" | "freeform";
  options?: Array<{
    id: string;
    label: string;
    detail?: string;
    /** Authored recommendation only — see PlanDecisionBlock note. */
    recommended?: boolean;
    wireframe?: PlanWireframeBlock["data"];
    diagram?: PlanDiagramBlock["data"];
  }>;
};

export type PlanVisualQuestionsBlock = PlanBlockBase & {
  type: "visual-questions";
  data: {
    questions: PlanVisualQuestion[];
    submitLabel?: string;
  };
};

export type PlanBlock =
  | PlanRichTextBlock
  | PlanCalloutBlock
  | PlanChecklistBlock
  | PlanTableBlock
  | PlanCodeTabsBlock
  | PlanImplementationMapBlock
  | PlanWireframeBlock
  | PlanLegacyWireframeBlock
  | PlanDiagramBlock
  | PlanImageBlock
  | PlanDecisionBlock
  | PlanTabsBlock
  | PlanCustomHtmlBlock
  | PlanVisualQuestionsBlock;

/* -------------------------------------------------------------------------- */
/* Board / canvas — SPATIAL; geometry KEPT here on purpose                    */
/* -------------------------------------------------------------------------- */

/** Anchor side for an annotation arrow pointing at an artboard. */
export type PlanAnnotationPlacement =
  | "top"
  | "right"
  | "bottom"
  | "left"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

/**
 * A wireframe placed on the spatial board. Geometry (position/order) is KEPT
 * here — only the wireframe INTERNALS (its kit tree) are geometry-free.
 */
export type PlanArtboard = {
  id: string;
  label?: string;
  surface?: PlanWireframeSurface;
  /** Reference to a wireframe block rendered in this artboard. */
  blockId?: string;
  /** Inline wireframe data (kit tree) when not referencing a block. */
  wireframe?: PlanWireframeBlock["data"];
  /** Legacy region data, for old/imported boards. */
  legacyWireframe?: PlanLegacyWireframeBlock["data"];
  /** Spatial placement on the board. */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** Manual ordering hint for grip-reorder. */
  order?: number;
};

/**
 * @deprecated Back-compat alias for `PlanArtboard`. Out-of-scope code still
 * imports `PlanCanvasFrame`.
 */
export type PlanCanvasFrame = PlanArtboard;

/** A designer note placed on the board. Plain text layers, optional arrow. */
export type PlanAnnotation = {
  id: string;
  title?: string;
  text: string;
  /** Artboard this annotation points at, if any. */
  targetId?: string;
  /** Which side of the target the arrow anchors to. */
  placement?: PlanAnnotationPlacement;
  x?: number;
  y?: number;
};

/** @deprecated Back-compat alias for `PlanAnnotation`. */
export type PlanCanvasNote = {
  id: string;
  title?: string;
  body: string;
  x?: number;
  y?: number;
  arrowToFrameId?: string;
};

/** A connector between two artboards (board-level routing keeps geometry). */
export type PlanConnector = {
  from: string;
  to: string;
  label?: string;
};

/** A grouping of artboards on the board, with a title/subtitle. */
export type PlanBoardSection = {
  id: string;
  title?: string;
  subtitle?: string;
  artboardIds?: string[];
};

export type PlanCanvasViewport = {
  zoom?: number;
  pan?: {
    x?: number;
    y?: number;
  };
};

export type PlanContent = {
  version: number;
  title?: string;
  brief?: string;
  canvas?: {
    title?: string;
    /** Optional initial viewport persisted by source-sync exports. */
    viewport?: PlanCanvasViewport;
    sections?: PlanBoardSection[];
    /** Artboards placed on the board (spatial). */
    frames: PlanArtboard[];
    /** Connectors between artboards. */
    flow?: PlanConnector[];
    /** Designer annotations on the board. */
    annotations?: PlanAnnotation[];
    /** @deprecated Legacy note shape; renderer fallback. */
    notes?: PlanCanvasNote[];
  };
  blocks: PlanBlock[];
};

/* -------------------------------------------------------------------------- */
/* Patch ops                                                                  */
/* -------------------------------------------------------------------------- */

export type PlanContentPatch =
  | {
      op: "replace-block";
      blockId: string;
      block: PlanBlock;
    }
  | {
      /** Generic shallow merge into a block (title/summary/data). */
      op: "update-block";
      blockId: string;
      patch: {
        title?: string | null;
        summary?: string | null;
        editable?: boolean;
        data?: Record<string, unknown>;
      };
    }
  | {
      /** Replace the entire top-level block list. */
      op: "replace-blocks";
      blocks: PlanBlock[];
    }
  | {
      op: "update-rich-text";
      blockId: string;
      title?: string;
      markdown?: string;
      doc?: unknown;
    }
  | {
      op: "update-custom-html";
      blockId: string;
      title?: string;
      html?: string;
      css?: string | null;
      caption?: string | null;
    }
  | {
      /** Patch a single wireframe kit-tree node by its stable node id. */
      op: "update-wireframe-node";
      blockId: string;
      nodeId: string;
      patch: Partial<Omit<PlanWireframeNode, "id" | "el" | "children">>;
    }
  | {
      /** Replace a wireframe block's full screen kit tree. */
      op: "replace-wireframe-screen";
      blockId: string;
      screen: PlanWireframeNode[];
    }
  | {
      op: "update-canvas-frame";
      frameId: string;
      patch: Partial<Omit<PlanArtboard, "id">>;
    }
  | {
      op: "update-canvas-annotation";
      annotationId: string;
      patch: Partial<Omit<PlanAnnotation, "id">>;
    }
  | {
      op: "append-block";
      block: PlanBlock;
      afterBlockId?: string;
      parent?: {
        tabBlockId: string;
        tabId: string;
      };
    }
  | {
      op: "remove-block";
      blockId: string;
    };

/* -------------------------------------------------------------------------- */
/* Zod schemas                                                                */
/* -------------------------------------------------------------------------- */

const idSchema = z.string().trim().min(1).max(120);

const baseBlockSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1).max(180).optional(),
  summary: z.string().trim().max(600).optional(),
  editable: z.boolean().optional(),
});

const unsafeCustomHtmlPattern =
  /(?:<!doctype|<\/?(?:html|head|body|script|style|iframe|object|embed|link|meta|base|form)[\s>/]|\b(?:javascript|data:text\/html)\s*:|\bsrcdoc\s*=|\bon[a-z][\w:-]*\s*=)/i;

const noFullHtmlDocument = (value: string) =>
  !unsafeCustomHtmlPattern.test(value);

const toneSchema = z.enum(["default", "accent", "warn", "ok", "muted"]);

const elNameSchema = z.enum([
  "screen",
  "browserBar",
  "statusBar",
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
]);

const WIREFRAME_MAX_DEPTH = 8;
const WIREFRAME_MAX_NODES = 400;

/**
 * Recursive node schema, bounded in depth and total node count. Props are kept
 * permissive so the model can compose primitives freely, but every string is a
 * real-content field with a sane max length (no raw HTML / CSS smuggling).
 */
const wireframeNodeSchema: z.ZodType<PlanWireframeNode> = z.lazy(() =>
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
) as z.ZodType<PlanWireframeNode>;

const wireframeSurfaceSchema = z.enum([
  "desktop",
  "mobile",
  "popover",
  "panel",
  "browser",
]);

const wireframeDataSchema: z.ZodType<PlanWireframeBlock["data"]> = z
  .object({
    surface: wireframeSurfaceSchema,
    caption: z.string().trim().max(400).optional(),
    screen: z
      .array(wireframeNodeSchema)
      .max(WIREFRAME_MAX_NODES)
      .superRefine((nodes, ctx) => {
        let total = 0;
        const seenNodeIds = new Set<string>();
        const walk = (
          list: PlanWireframeNode[],
          depth: number,
          path: Array<string | number>,
        ) => {
          if (depth > WIREFRAME_MAX_DEPTH) {
            ctx.addIssue({
              code: "custom",
              message: `Wireframe tree exceeds max depth ${WIREFRAME_MAX_DEPTH}.`,
            });
            return;
          }
          for (const [index, node] of list.entries()) {
            total += 1;
            if (total > WIREFRAME_MAX_NODES) {
              ctx.addIssue({
                code: "custom",
                message: `Wireframe tree exceeds max nodes ${WIREFRAME_MAX_NODES}.`,
              });
              return;
            }
            const nodePath = [...path, index];
            if (node.id) {
              if (seenNodeIds.has(node.id)) {
                ctx.addIssue({
                  code: "custom",
                  path: [...nodePath, "id"],
                  message: `Duplicate wireframe node id: ${node.id}`,
                });
              }
              seenNodeIds.add(node.id);
            }
            if (node.children) {
              walk(node.children, depth + 1, [...nodePath, "children"]);
            }
          }
        };
        walk(nodes, 1, []);
      }),
  })
  .strict();

const wireframeRegionSchema: z.ZodType<PlanWireframeRegion> = z.object({
  id: idSchema,
  kind: z.enum([
    "nav",
    "header",
    "list",
    "form",
    "toolbar",
    "content",
    "button",
    "input",
    "custom",
  ]),
  label: z.string().trim().max(120).optional(),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  width: z.number().min(1).max(100),
  height: z.number().min(1).max(100),
  emphasis: z.boolean().optional(),
});

const legacyWireframeDataSchema: z.ZodType<PlanLegacyWireframeBlock["data"]> =
  z.object({
    viewport: z.enum(["desktop", "tablet", "phone"]).optional(),
    template: z
      .enum([
        "context-xray-app",
        "context-xray-default",
        "context-xray-expanded",
        "context-xray-map",
        "context-xray-chat-cleanup",
      ])
      .optional(),
    caption: z.string().trim().max(400).optional(),
    regions: z.array(wireframeRegionSchema).max(80).default([]),
  });

const diagramNodeSchema: z.ZodType<PlanDiagramNode> = z.object({
  id: idSchema,
  label: z.string().trim().min(1).max(160),
  detail: z.string().trim().max(500).optional(),
  x: z.number().min(0).max(100).optional(),
  y: z.number().min(0).max(100).optional(),
});

const diagramEdgeSchema: z.ZodType<PlanDiagramEdge> = z.object({
  from: idSchema,
  to: idSchema,
  label: z.string().trim().max(100).optional(),
});

const diagramDataSchema: z.ZodType<PlanDiagramBlock["data"]> = z.object({
  nodes: z.array(diagramNodeSchema).min(1).max(80),
  edges: z.array(diagramEdgeSchema).max(120).default([]),
  notes: z
    .array(
      z.object({
        id: idSchema,
        text: z.string().trim().min(1).max(500),
        x: z.number().min(0).max(100).optional(),
        y: z.number().min(0).max(100).optional(),
      }),
    )
    .max(40)
    .optional(),
});

const imageDataSchema: z.ZodType<PlanImageBlock["data"]> = z
  .object({
    assetId: z.string().trim().min(1).max(200).optional(),
    url: z.string().trim().max(2_000).url().optional(),
    alt: z.string().trim().min(1).max(400),
    caption: z.string().trim().max(400).optional(),
    fit: z.enum(["contain", "cover"]).optional(),
  })
  .refine((value) => Boolean(value.assetId || value.url), {
    message: "Image block requires an assetId or url.",
  });

export const planBlockSchema: z.ZodType<PlanBlock> = z.lazy(() =>
  z.discriminatedUnion("type", [
    baseBlockSchema.extend({
      type: z.literal("rich-text"),
      data: z.object({
        markdown: z.string().max(100_000),
        doc: z.unknown().optional(),
      }),
    }),
    baseBlockSchema.extend({
      type: z.literal("callout"),
      data: z.object({
        tone: z
          .enum(["info", "decision", "risk", "warning", "success"])
          .optional(),
        body: z.string().trim().min(1).max(10_000),
      }),
    }),
    baseBlockSchema.extend({
      type: z.literal("checklist"),
      data: z.object({
        items: z
          .array(
            z.object({
              id: idSchema,
              label: z.string().trim().min(1).max(400),
              checked: z.boolean().optional(),
              note: z.string().trim().max(800).optional(),
            }),
          )
          .max(200),
      }),
    }),
    baseBlockSchema.extend({
      type: z.literal("table"),
      data: z.object({
        columns: z.array(z.string().trim().min(1).max(120)).min(1).max(12),
        rows: z.array(z.array(z.string().max(2_000)).max(12)).max(100),
      }),
    }),
    baseBlockSchema.extend({
      type: z.literal("code-tabs"),
      data: z.object({
        tabs: z
          .array(
            z.object({
              id: idSchema,
              label: z.string().trim().min(1).max(120),
              language: z.string().trim().max(40).optional(),
              code: z.string().max(100_000),
              caption: z.string().trim().max(400).optional(),
            }),
          )
          .min(1)
          .max(12),
      }),
    }),
    baseBlockSchema.extend({
      type: z.literal("implementation-map"),
      data: z.object({
        files: z
          .array(
            z.object({
              path: z.string().trim().min(1).max(500),
              title: z.string().trim().max(180).optional(),
              note: z.string().trim().min(1).max(2_000),
              language: z.string().trim().max(40).optional(),
              snippet: z.string().max(50_000).optional(),
            }),
          )
          .min(1)
          .max(80),
      }),
    }),
    baseBlockSchema.extend({
      type: z.literal("wireframe"),
      data: wireframeDataSchema,
    }),
    baseBlockSchema.extend({
      type: z.literal("legacy-wireframe"),
      data: legacyWireframeDataSchema,
    }),
    baseBlockSchema.extend({
      type: z.literal("diagram"),
      data: diagramDataSchema,
    }),
    baseBlockSchema.extend({
      type: z.literal("image"),
      data: imageDataSchema,
    }),
    baseBlockSchema.extend({
      type: z.literal("decision"),
      data: z.object({
        question: z.string().trim().min(1).max(500),
        options: z
          .array(
            z.object({
              id: idSchema,
              label: z.string().trim().min(1).max(200),
              detail: z.string().trim().max(800).optional(),
              recommended: z.boolean().optional(),
            }),
          )
          .min(1)
          .max(20),
      }),
    }),
    baseBlockSchema.extend({
      type: z.literal("tabs"),
      data: z.object({
        tabs: z
          .array(
            z.object({
              id: idSchema,
              label: z.string().trim().min(1).max(120),
              blocks: z.array(planBlockSchema).max(40),
            }),
          )
          .min(1)
          .max(12),
      }),
    }),
    baseBlockSchema.extend({
      type: z.literal("custom-html"),
      data: z
        .object({
          html: z.string().max(100_000).refine(noFullHtmlDocument, {
            message:
              "Custom HTML blocks must be bounded fragments without html/head/body/script/style tags.",
          }),
          css: z
            .string()
            .max(50_000)
            .refine(noFullHtmlDocument, {
              message:
                "Custom CSS blocks must not include document or script tags.",
            })
            .optional(),
          caption: z.string().trim().max(400).optional(),
        })
        .strict(),
    }),
    baseBlockSchema.extend({
      type: z.literal("visual-questions"),
      data: z.object({
        questions: z
          .array(
            z.object({
              id: idSchema,
              title: z.string().trim().min(1).max(260),
              subtitle: z.string().trim().max(700).optional(),
              mode: z.enum(["single", "multi", "freeform"]),
              options: z
                .array(
                  z.object({
                    id: idSchema,
                    label: z.string().trim().min(1).max(220),
                    detail: z.string().trim().max(800).optional(),
                    recommended: z.boolean().optional(),
                    wireframe: wireframeDataSchema.optional(),
                    diagram: diagramDataSchema.optional(),
                  }),
                )
                .max(40)
                .optional(),
            }),
          )
          .min(1)
          .max(40),
        submitLabel: z.string().trim().max(80).optional(),
      }),
    }),
  ]),
) as z.ZodType<PlanBlock>;

const annotationPlacementSchema = z.enum([
  "top",
  "right",
  "bottom",
  "left",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
]);

const artboardSchema: z.ZodType<PlanArtboard> = z.object({
  id: idSchema,
  label: z.string().trim().max(180).optional(),
  surface: wireframeSurfaceSchema.optional(),
  blockId: idSchema.optional(),
  wireframe: wireframeDataSchema.optional(),
  legacyWireframe: legacyWireframeDataSchema.optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().min(80).optional(),
  height: z.number().min(80).optional(),
  order: z.number().optional(),
});

const annotationSchema: z.ZodType<PlanAnnotation> = z.object({
  id: idSchema,
  title: z.string().trim().max(180).optional(),
  text: z.string().trim().min(1).max(2_000),
  targetId: idSchema.optional(),
  placement: annotationPlacementSchema.optional(),
  x: z.number().optional(),
  y: z.number().optional(),
});

const legacyNoteSchema: z.ZodType<PlanCanvasNote> = z.object({
  id: idSchema,
  title: z.string().trim().max(180).optional(),
  body: z.string().trim().min(1).max(2_000),
  x: z.number().optional(),
  y: z.number().optional(),
  arrowToFrameId: idSchema.optional(),
});

const connectorSchema: z.ZodType<PlanConnector> = z.object({
  from: idSchema,
  to: idSchema,
  label: z.string().trim().max(100).optional(),
});

const boardSectionSchema: z.ZodType<PlanBoardSection> = z.object({
  id: idSchema,
  title: z.string().trim().max(180).optional(),
  subtitle: z.string().trim().max(400).optional(),
  artboardIds: z.array(idSchema).max(80).optional(),
});

export const planContentSchema: z.ZodType<PlanContent> = z
  .object({
    version: z.number().int().min(PLAN_CONTENT_MIN_VERSION),
    title: z.string().trim().max(240).optional(),
    brief: z.string().trim().max(4_000).optional(),
    canvas: z
      .object({
        title: z.string().trim().max(180).optional(),
        viewport: z
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
        sections: z.array(boardSectionSchema).max(40).optional(),
        frames: z.array(artboardSchema).max(40).default([]),
        flow: z.array(connectorSchema).max(80).optional(),
        annotations: z.array(annotationSchema).max(80).optional(),
        notes: z.array(legacyNoteSchema).max(80).optional(),
      })
      .optional(),
    blocks: z.array(planBlockSchema).max(200).default([]),
  })
  .superRefine((content, context) => {
    const checkUniqueIds = (
      items: Array<{ id: string }> | undefined,
      label: string,
      path: Array<string | number>,
    ) => {
      const seen = new Set<string>();
      for (const [index, item] of (items ?? []).entries()) {
        if (seen.has(item.id)) {
          context.addIssue({
            code: "custom",
            path: [...path, index, "id"],
            message: `Duplicate ${label} id: ${item.id}`,
          });
        }
        seen.add(item.id);
      }
    };

    const seen = new Set<string>();
    const visit = (block: PlanBlock) => {
      if (seen.has(block.id)) {
        context.addIssue({
          code: "custom",
          path: ["blocks"],
          message: `Duplicate block id: ${block.id}`,
        });
      }
      seen.add(block.id);
      if (block.type === "tabs") {
        for (const tab of block.data.tabs) {
          for (const child of tab.blocks) {
            visit(child);
          }
        }
      }
    };

    for (const block of content.blocks) {
      visit(block);
    }

    if (content.canvas) {
      checkUniqueIds(content.canvas.sections, "canvas section", [
        "canvas",
        "sections",
      ]);
      checkUniqueIds(content.canvas.frames, "canvas frame", [
        "canvas",
        "frames",
      ]);
      checkUniqueIds(content.canvas.annotations, "canvas annotation", [
        "canvas",
        "annotations",
      ]);
      checkUniqueIds(content.canvas.notes, "canvas note", ["canvas", "notes"]);
    }
  }) as unknown as z.ZodType<PlanContent>;

export type PlanContentInput = z.input<typeof planContentSchema>;

/* -------------------------------------------------------------------------- */
/* Migration / parsing                                                        */
/* -------------------------------------------------------------------------- */

const OLD_BLOCK_TYPE_ALIASES: Record<string, PlanBlockType> = {
  // sketch-wireframe was the region-based shape → keep it as legacy-wireframe
  // so the renderer fallback still draws old/imported plans (never lose data).
  "sketch-wireframe": "legacy-wireframe",
  "sketch-diagram": "diagram",
};

function migrateBlock(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const block = raw as Record<string, unknown>;
  const type = typeof block.type === "string" ? block.type : undefined;
  if (type && OLD_BLOCK_TYPE_ALIASES[type]) {
    block.type = OLD_BLOCK_TYPE_ALIASES[type];
  }
  // Recurse into tabs children.
  if (block.type === "tabs" && block.data && typeof block.data === "object") {
    const data = block.data as Record<string, unknown>;
    if (Array.isArray(data.tabs)) {
      for (const tab of data.tabs) {
        if (tab && typeof tab === "object") {
          const tabObj = tab as Record<string, unknown>;
          if (Array.isArray(tabObj.blocks)) {
            tabObj.blocks = tabObj.blocks.map(migrateBlock);
          }
        }
      }
    }
  }
  return block;
}

/**
 * Upgrade/normalize an old/raw plan content shape to the current model BEFORE
 * validation. Old region-based wireframes are preserved as `legacy-wireframe`
 * blocks (renderer fallback) — never lossily converted to empty kit trees.
 * Returns a best-effort normalized object; callers still validate via zod.
 */
export function migratePlanContent(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const content = cloneJson(raw) as Record<string, unknown>;

  // Version: missing/old → leave numeric and let the parser accept >= min.
  if (typeof content.version !== "number") {
    content.version = PLAN_CONTENT_MIN_VERSION;
  }

  if (Array.isArray(content.blocks)) {
    content.blocks = content.blocks.map(migrateBlock);
  }

  // Visual-question option wireframes: nested old diagram/region data is left
  // as-is for region wireframes (schema rejects them for the new `wireframe`
  // field, which is acceptable — questions are transient intake, not the body).
  return content;
}

/* -------------------------------------------------------------------------- */
/* Patch schemas                                                              */
/* -------------------------------------------------------------------------- */

const wireframeNodePatchSchema = z
  .object({
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
  .refine((value) => Object.keys(value).length > 0, {
    message: "Patch must include at least one wireframe node field.",
  });

const canvasFramePatchSchema = z
  .object({
    label: z.string().trim().max(180).optional(),
    surface: wireframeSurfaceSchema.optional(),
    blockId: idSchema.optional(),
    wireframe: wireframeDataSchema.optional(),
    legacyWireframe: legacyWireframeDataSchema.optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().min(80).optional(),
    height: z.number().min(80).optional(),
    order: z.number().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Patch must include at least one canvas frame field.",
  });

const canvasAnnotationPatchSchema = z
  .object({
    title: z.string().trim().max(180).optional(),
    text: z.string().trim().min(1).max(2_000).optional(),
    targetId: idSchema.optional(),
    placement: annotationPlacementSchema.optional(),
    x: z.number().optional(),
    y: z.number().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Patch must include at least one canvas annotation field.",
  });

const blockUpdatePatchSchema = z
  .object({
    title: z.string().trim().min(1).max(180).nullable().optional(),
    summary: z.string().trim().max(600).nullable().optional(),
    editable: z.boolean().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Patch must include at least one block field.",
  });

export const planContentPatchSchema: z.ZodType<PlanContentPatch> =
  z.discriminatedUnion("op", [
    z.object({
      op: z.literal("replace-block"),
      blockId: idSchema,
      block: planBlockSchema,
    }),
    z.object({
      op: z.literal("update-block"),
      blockId: idSchema,
      patch: blockUpdatePatchSchema,
    }),
    z.object({
      op: z.literal("replace-blocks"),
      blocks: z.array(planBlockSchema).max(200),
    }),
    z.object({
      op: z.literal("update-rich-text"),
      blockId: idSchema,
      title: z.string().trim().min(1).max(180).optional(),
      markdown: z.string().max(100_000).optional(),
      doc: z.unknown().optional(),
    }),
    z.object({
      op: z.literal("update-custom-html"),
      blockId: idSchema,
      title: z.string().trim().min(1).max(180).optional(),
      html: z
        .string()
        .max(100_000)
        .refine(noFullHtmlDocument, {
          message:
            "Custom HTML blocks must be bounded fragments without html/head/body/script/style tags.",
        })
        .optional(),
      css: z
        .string()
        .max(50_000)
        .refine(noFullHtmlDocument, {
          message:
            "Custom CSS blocks must not include document or script tags.",
        })
        .nullable()
        .optional(),
      caption: z.string().trim().max(400).nullable().optional(),
    }),
    z.object({
      op: z.literal("update-wireframe-node"),
      blockId: idSchema,
      nodeId: idSchema,
      patch: wireframeNodePatchSchema,
    }),
    z.object({
      op: z.literal("replace-wireframe-screen"),
      blockId: idSchema,
      screen: z.array(wireframeNodeSchema).max(WIREFRAME_MAX_NODES),
    }),
    z.object({
      op: z.literal("update-canvas-frame"),
      frameId: idSchema,
      patch: canvasFramePatchSchema,
    }),
    z.object({
      op: z.literal("update-canvas-annotation"),
      annotationId: idSchema,
      patch: canvasAnnotationPatchSchema,
    }),
    z.object({
      op: z.literal("append-block"),
      block: planBlockSchema,
      afterBlockId: idSchema.optional(),
      parent: z
        .object({
          tabBlockId: idSchema,
          tabId: idSchema,
        })
        .optional(),
    }),
    z.object({
      op: z.literal("remove-block"),
      blockId: idSchema,
    }),
  ]) as z.ZodType<PlanContentPatch>;

export const planContentPatchesSchema = z.array(planContentPatchSchema).max(80);

export function applyPlanContentPatches(
  content: PlanContent,
  patches: PlanContentPatch[],
): PlanContent {
  const next = cloneJson(planContentSchema.parse(content));

  for (const patch of planContentPatchesSchema.parse(patches)) {
    if (patch.op === "replace-block") {
      next.blocks = updateBlock(
        next.blocks,
        patch.blockId,
        () => patch.block,
      ).blocks;
      continue;
    }
    if (patch.op === "replace-blocks") {
      next.blocks = patch.blocks.map((block) => planBlockSchema.parse(block));
      continue;
    }
    if (patch.op === "update-block") {
      next.blocks = updateBlock(next.blocks, patch.blockId, (block) => {
        const merged: PlanBlock = { ...block };
        if (patch.patch.title === null) {
          delete merged.title;
        } else if (patch.patch.title !== undefined) {
          merged.title = patch.patch.title;
        }
        if (patch.patch.summary === null) {
          delete merged.summary;
        } else if (patch.patch.summary !== undefined) {
          merged.summary = patch.patch.summary;
        }
        if (patch.patch.editable !== undefined) {
          merged.editable = patch.patch.editable;
        }
        if (patch.patch.data !== undefined) {
          (merged as { data: unknown }).data = {
            ...(block as { data?: Record<string, unknown> }).data,
            ...patch.patch.data,
          };
        }
        return planBlockSchema.parse(merged);
      }).blocks;
      continue;
    }
    if (patch.op === "update-rich-text") {
      next.blocks = updateBlock(next.blocks, patch.blockId, (block) => {
        if (block.type !== "rich-text") {
          throw new Error(
            `Block ${patch.blockId} is ${block.type}, not rich-text.`,
          );
        }
        return {
          ...block,
          ...(patch.title ? { title: patch.title } : {}),
          data: {
            markdown: patch.markdown ?? block.data.markdown,
            doc: patch.doc ?? block.data.doc,
          },
        };
      }).blocks;
      continue;
    }
    if (patch.op === "update-custom-html") {
      next.blocks = updateBlock(next.blocks, patch.blockId, (block) => {
        if (block.type !== "custom-html") {
          throw new Error(
            `Block ${patch.blockId} is ${block.type}, not custom-html.`,
          );
        }
        return {
          ...block,
          ...(patch.title ? { title: patch.title } : {}),
          data: {
            html: patch.html ?? block.data.html,
            css: patch.css === null ? undefined : (patch.css ?? block.data.css),
            caption:
              patch.caption === null
                ? undefined
                : (patch.caption ?? block.data.caption),
          },
        };
      }).blocks;
      continue;
    }
    if (patch.op === "update-wireframe-node") {
      next.blocks = updateBlock(next.blocks, patch.blockId, (block) => {
        if (block.type !== "wireframe") {
          throw new Error(
            `Block ${patch.blockId} is ${block.type}, not wireframe.`,
          );
        }
        const result = updateWireframeNode(
          block.data.screen,
          patch.nodeId,
          (node) => ({ ...node, ...patch.patch }),
        );
        if (!result.changed) {
          throw new Error(
            `Wireframe node ${patch.nodeId} was not found in block ${patch.blockId}.`,
          );
        }
        return { ...block, data: { ...block.data, screen: result.nodes } };
      }).blocks;
      continue;
    }
    if (patch.op === "replace-wireframe-screen") {
      next.blocks = updateBlock(next.blocks, patch.blockId, (block) => {
        if (block.type !== "wireframe") {
          throw new Error(
            `Block ${patch.blockId} is ${block.type}, not wireframe.`,
          );
        }
        return {
          ...block,
          data: { ...block.data, screen: ensureNodeIds(patch.screen) },
        };
      }).blocks;
      continue;
    }
    if (patch.op === "update-canvas-frame") {
      const frame = next.canvas?.frames.find(
        (candidate) => candidate.id === patch.frameId,
      );
      if (!frame) {
        throw new Error(`Canvas frame ${patch.frameId} was not found.`);
      }
      Object.assign(frame, patch.patch);
      continue;
    }
    if (patch.op === "update-canvas-annotation") {
      const annotation = next.canvas?.annotations?.find(
        (candidate) => candidate.id === patch.annotationId,
      );
      if (!annotation) {
        throw new Error(
          `Canvas annotation ${patch.annotationId} was not found.`,
        );
      }
      Object.assign(annotation, patch.patch);
      continue;
    }
    if (patch.op === "append-block") {
      if (patch.parent) {
        next.blocks = updateBlock(
          next.blocks,
          patch.parent.tabBlockId,
          (block) => {
            if (block.type !== "tabs") {
              throw new Error(
                `Block ${patch.parent?.tabBlockId} is ${block.type}, not tabs.`,
              );
            }
            let changed = false;
            const tabs = block.data.tabs.map((tab) => {
              if (tab.id !== patch.parent?.tabId) return tab;
              changed = true;
              return {
                ...tab,
                blocks: insertBlock(
                  tab.blocks,
                  patch.block,
                  patch.afterBlockId,
                ),
              };
            });
            if (!changed) {
              throw new Error(`Tab ${patch.parent.tabId} was not found.`);
            }
            return { ...block, data: { tabs } };
          },
        ).blocks;
      } else {
        next.blocks = insertBlock(next.blocks, patch.block, patch.afterBlockId);
      }
      continue;
    }
    if (patch.op === "remove-block") {
      const result = removeBlock(next.blocks, patch.blockId);
      if (!result.changed) {
        throw new Error(`Block ${patch.blockId} was not found.`);
      }
      next.blocks = result.blocks;
    }
  }

  syncCanvasWireframes(next);
  return planContentSchema.parse(next);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function updateBlock(
  blocks: PlanBlock[],
  blockId: string,
  updater: (block: PlanBlock) => PlanBlock,
): { blocks: PlanBlock[]; changed: boolean } {
  const result = updateBlockRecursive(blocks, blockId, updater);
  if (!result.changed) throw new Error(`Block ${blockId} was not found.`);
  return result;
}

function updateBlockRecursive(
  blocks: PlanBlock[],
  blockId: string,
  updater: (block: PlanBlock) => PlanBlock,
): { blocks: PlanBlock[]; changed: boolean } {
  let changed = false;
  const nextBlocks = blocks.map((block) => {
    if (block.id === blockId) {
      changed = true;
      return updater(block);
    }
    if (block.type !== "tabs") return block;
    const childResult = block.data.tabs.reduce<{
      tabs: PlanTabsBlock["data"]["tabs"];
      changed: boolean;
    }>(
      (acc, tab) => {
        const updated = updateBlockRecursive(tab.blocks, blockId, updater);
        acc.tabs.push({ ...tab, blocks: updated.blocks });
        acc.changed = acc.changed || updated.changed;
        return acc;
      },
      { tabs: [], changed: false },
    );
    if (!childResult.changed) return block;
    changed = true;
    return { ...block, data: { tabs: childResult.tabs } };
  });
  return { blocks: nextBlocks, changed };
}

/** Walk a wireframe kit tree and update the node whose id matches. */
function updateWireframeNode(
  nodes: PlanWireframeNode[],
  nodeId: string,
  updater: (node: PlanWireframeNode) => PlanWireframeNode,
): { nodes: PlanWireframeNode[]; changed: boolean } {
  let changed = false;
  const next = nodes.map((node) => {
    if (node.id === nodeId) {
      changed = true;
      return updater(node);
    }
    if (!node.children) return node;
    const childResult = updateWireframeNode(node.children, nodeId, updater);
    if (!childResult.changed) return node;
    changed = true;
    return { ...node, children: childResult.nodes };
  });
  return { nodes: next, changed };
}

function insertBlock(
  blocks: PlanBlock[],
  block: PlanBlock,
  afterBlockId?: string,
): PlanBlock[] {
  const parsedBlock = planBlockSchema.parse(block);
  if (!afterBlockId) return [...blocks, parsedBlock];
  const index = blocks.findIndex((candidate) => candidate.id === afterBlockId);
  if (index === -1) {
    throw new Error(`Block ${afterBlockId} was not found.`);
  }
  return [
    ...blocks.slice(0, index + 1),
    parsedBlock,
    ...blocks.slice(index + 1),
  ];
}

function removeBlock(
  blocks: PlanBlock[],
  blockId: string,
): { blocks: PlanBlock[]; changed: boolean } {
  let changed = false;
  const filtered = blocks
    .filter((block) => {
      if (block.id === blockId) {
        changed = true;
        return false;
      }
      return true;
    })
    .map((block) => {
      if (block.type !== "tabs") return block;
      const tabs = block.data.tabs.map((tab) => {
        const result = removeBlock(tab.blocks, blockId);
        changed = changed || result.changed;
        return { ...tab, blocks: result.blocks };
      });
      return { ...block, data: { tabs } };
    });
  return { blocks: filtered, changed };
}

function syncCanvasWireframes(content: PlanContent) {
  if (!content.canvas) return;
  const blocks = new Map<string, PlanBlock>();
  const visit = (block: PlanBlock) => {
    blocks.set(block.id, block);
    if (block.type === "tabs") {
      for (const tab of block.data.tabs) {
        for (const child of tab.blocks) visit(child);
      }
    }
  };
  for (const block of content.blocks) visit(block);

  for (const frame of content.canvas.frames) {
    if (!frame.blockId) continue;
    const block = blocks.get(frame.blockId);
    if (block?.type === "wireframe") {
      frame.wireframe = cloneJson(block.data);
      delete frame.legacyWireframe;
    } else if (block?.type === "legacy-wireframe") {
      frame.legacyWireframe = cloneJson(block.data);
      delete frame.wireframe;
    } else {
      delete frame.wireframe;
      delete frame.legacyWireframe;
    }
  }
}

export function createPlanBlockId(prefix: string): string {
  const safePrefix = prefix
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${safePrefix || "block"}-${random}`;
}

/** Stable id for a wireframe kit-tree node. */
export function createWireframeNodeId(el: string): string {
  return createPlanBlockId(`wf-${el}`);
}

/**
 * Ensure every node in a wireframe kit tree has a stable id (auto-assign on
 * create where absent). Returns a new tree; does not mutate the input.
 */
export function ensureNodeIds(nodes: PlanWireframeNode[]): PlanWireframeNode[] {
  return nodes.map((node) => ({
    ...node,
    id: node.id ?? createWireframeNodeId(node.el),
    ...(node.children ? { children: ensureNodeIds(node.children) } : {}),
  }));
}
