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
  | "code"
  | "code-tabs"
  | "implementation-map"
  | "wireframe"
  | "diagram"
  | "image"
  | "tabs"
  | "columns"
  | "custom-html"
  | "question-form"
  | "visual-questions"
  | "mermaid"
  | "api-endpoint"
  | "openapi-spec"
  | "data-model"
  | "diff"
  | "file-tree"
  | "json-explorer"
  | "annotated-code"
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
    density?: "compact" | "normal" | "relaxed";
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

export type PlanCodeBlock = PlanBlockBase & {
  type: "code";
  data: {
    code: string;
    language?: string;
    filename?: string;
    caption?: string;
    maxLines?: number;
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

export type PlanVisualCanvasMode = "wireframe" | "design";

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
    /** `design` renders full-fidelity branded HTML/CSS instead of a sketch. */
    renderMode?: PlanVisualCanvasMode;
    caption?: string;
    /**
     * Neutral, textless loading register. The renderer drops borders, the sketch
     * outline, and color, rendering soft placeholder geometry only — a real
     * skeleton loader, not a sketch of boxes.
     */
    skeleton?: boolean;
    /**
     * PRIMARY content: a self-contained HTML mockup of the screen (sanitized
     * fragment — no document/script/style tags). Write semantic HTML + layout
     * utility classes; the RENDERER owns the surface aspect, the dark/light
     * theme, the hand-drawn font, and the rough sketch overlay. Emit content,
     * never pixels/coordinates. When `html` is set, `screen` is ignored.
     */
    html?: string;
    /** Optional scoped CSS for the html mockup (sanitized fragment). */
    css?: string;
    /** LEGACY kit-tree screen. Kept as a fallback; new plans emit `html`. */
    screen?: PlanWireframeNode[];
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
    /**
     * Preferred authoring path for architecture/code diagrams. This is an inert,
     * scoped fragment rendered by the plan viewer with theme + sketch/clean
     * style hooks. Legacy node graphs remain supported below for old plans and
     * simple previews.
     */
    html?: string;
    css?: string;
    caption?: string;
    nodes?: PlanDiagramNode[];
    edges?: PlanDiagramEdge[];
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

export type PlanTabsBlock = PlanBlockBase & {
  type: "tabs";
  data: {
    tabs: Array<{
      id: string;
      label: string;
      blocks: PlanBlock[];
    }>;
    orientation?: "horizontal" | "vertical";
  };
};

export type PlanColumnsBlock = PlanBlockBase & {
  type: "columns";
  data: {
    columns: Array<{
      id: string;
      label?: string;
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

export type PlanQuestionOption = {
  id: string;
  label: string;
  detail?: string;
  /**
   * Authored recommendation only. A reviewer's actual selection does NOT live
   * here — responses belong in plan_comments / events, never in the canonical
   * plan body.
   */
  recommended?: boolean;
  wireframe?: PlanWireframeBlock["data"];
  diagram?: PlanDiagramBlock["data"];
};

export type PlanQuestion = {
  id: string;
  title: string;
  subtitle?: string;
  mode: "single" | "multi" | "freeform";
  options?: PlanQuestionOption[];
  allowOther?: boolean;
  placeholder?: string;
  required?: boolean;
};

export type PlanVisualQuestion = PlanQuestion;

export type PlanQuestionFormBlock = PlanBlockBase & {
  type: "question-form";
  data: {
    questions: PlanQuestion[];
    submitLabel?: string;
  };
};

export type PlanVisualQuestionsBlock = PlanBlockBase & {
  type: "visual-questions";
  data: {
    questions: PlanVisualQuestion[];
    submitLabel?: string;
  };
};

export type PlanMermaidBlock = PlanBlockBase & {
  type: "mermaid";
  data: {
    source: string;
    caption?: string;
  };
};

export type PlanApiEndpointBlock = PlanBlockBase & {
  type: "api-endpoint";
  data: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
    path: string;
    summary?: string;
    description?: string;
    auth?: string;
    deprecated?: boolean;
    /** Diff state for the whole route (added/removed/renamed endpoint). */
    change?: "added" | "modified" | "removed" | "renamed";
    params?: Array<{
      name: string;
      in: "path" | "query" | "header" | "body";
      type?: string;
      required?: boolean;
      description?: string;
      /** Diff state for this parameter. */
      change?: "added" | "modified" | "removed" | "renamed";
      /** Prior value when change === "modified" (e.g. the old type). */
      was?: string;
    }>;
    request?: { contentType?: string; example?: string };
    responses?: Array<{
      status: string;
      description?: string;
      example?: string;
      /** Diff state for this response. */
      change?: "added" | "modified" | "removed" | "renamed";
    }>;
  };
};

export type PlanOpenApiSpecBlock = PlanBlockBase & {
  type: "openapi-spec";
  data: {
    /** Raw OpenAPI 3 / Swagger 2 document text (JSON in v1). */
    spec: string;
    title?: string;
  };
};

export type PlanDataModelBlock = PlanBlockBase & {
  type: "data-model";
  data: {
    entities: Array<{
      id: string;
      name: string;
      note?: string;
      /** Diff state for the whole table (added/removed/renamed entity). */
      change?: "added" | "modified" | "removed" | "renamed";
      fields: Array<{
        name: string;
        type?: string;
        pk?: boolean;
        fk?: string;
        nullable?: boolean;
        default?: string;
        note?: string;
        /** Diff state for this field. */
        change?: "added" | "modified" | "removed" | "renamed";
        /** Prior value when change === "modified" (e.g. the old type). */
        was?: string;
      }>;
    }>;
    relations?: Array<{
      from: string;
      to: string;
      kind?: "1-1" | "1-n" | "n-n";
      label?: string;
    }>;
  };
};

/**
 * A line-anchored note attached to one side of a `diff` block, mirroring the
 * `annotated-code` annotation shape.
 */
export interface DiffAnnotation {
  /** Which side the line ref targets; defaults to "after". */
  side?: "before" | "after";
  /** 1-based line ref against that side's text: "13" or "13-15". */
  lines: string;
  label?: string;
  note: string;
}

export type PlanDiffBlock = PlanBlockBase & {
  type: "diff";
  data: {
    filename?: string;
    language?: string;
    before: string;
    after: string;
    mode?: "unified" | "split";
    annotations?: DiffAnnotation[];
  };
};

export type PlanFileTreeBlock = PlanBlockBase & {
  type: "file-tree";
  data: {
    title?: string;
    entries: Array<{
      path: string;
      change?: "added" | "modified" | "removed" | "renamed";
      note?: string;
      snippet?: string;
      language?: string;
    }>;
  };
};

export type PlanJsonExplorerBlock = PlanBlockBase & {
  type: "json-explorer";
  data: {
    title?: string;
    json: string;
    collapsedDepth?: number;
  };
};

export type PlanAnnotatedCodeBlock = PlanBlockBase & {
  type: "annotated-code";
  data: {
    filename?: string;
    language?: string;
    code: string;
    annotations?: Array<{ lines: string; label?: string; note: string }>;
  };
};

export type PlanBlock =
  | PlanRichTextBlock
  | PlanCalloutBlock
  | PlanChecklistBlock
  | PlanTableBlock
  | PlanCodeBlock
  | PlanCodeTabsBlock
  | PlanImplementationMapBlock
  | PlanWireframeBlock
  | PlanLegacyWireframeBlock
  | PlanDiagramBlock
  | PlanImageBlock
  | PlanTabsBlock
  | PlanColumnsBlock
  | PlanCustomHtmlBlock
  | PlanQuestionFormBlock
  | PlanVisualQuestionsBlock
  | PlanMermaidBlock
  | PlanApiEndpointBlock
  | PlanOpenApiSpecBlock
  | PlanDataModelBlock
  | PlanDiffBlock
  | PlanFileTreeBlock
  | PlanJsonExplorerBlock
  | PlanAnnotatedCodeBlock;

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

export type PlanAnnotationType = "note" | "text" | "callout" | "arrow";

export type PlanAnnotationPoint = {
  x: number;
  y: number;
};

export type PlanAnnotationStyle = {
  tone?: PlanWireframeTone;
  stroke?: "solid" | "dashed";
  width?: number;
};

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
  /** Semantic markup kind. Omitted legacy annotations render as notes. */
  type?: PlanAnnotationType;
  title?: string;
  text: string;
  /** Optional routed points for callouts/arrows/free placement. */
  points?: PlanAnnotationPoint[];
  /** Semantic style hints only; the renderer owns actual colors. */
  style?: PlanAnnotationStyle;
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

/* -------------------------------------------------------------------------- */
/* Prototype — functional top review surface                                  */
/* -------------------------------------------------------------------------- */

export type PlanPrototypeScreen = {
  id: string;
  title?: string;
  summary?: string;
  surface?: PlanWireframeSurface;
  renderMode?: PlanVisualCanvasMode;
  /**
   * A bounded semantic HTML fragment. Prototype HTML may use the renderer's
   * safe Alpine-like directives (`x-data`, `x-model`, `x-for`, `x-text`,
   * `x-show`, `:class`, `@click`, `@keydown.enter`) for real local
   * interactions. Use `data-goto="screen-id"` only for true screen/route
   * changes; never include scripts.
   */
  html: string;
  /** Scoped CSS for full-fidelity prototype screens. */
  css?: string;
  /** Optional metadata for exports/back-compat; the live viewer does not render this as chrome. */
  state?: Array<{
    id?: string;
    label: string;
    value: string;
  }>;
};

export type PlanPrototypeTransition = {
  id?: string;
  from: string;
  to: string;
  label?: string;
  /**
   * Human-readable trigger hint, such as "click Continue" or
   * "select a task row". Runtime screen navigation still uses `data-goto`.
   */
  trigger?: string;
};

export type PlanPrototype = {
  title?: string;
  brief?: string;
  surface?: PlanWireframeSurface;
  initialScreenId?: string;
  screens: PlanPrototypeScreen[];
  transitions?: PlanPrototypeTransition[];
};

export type PlanContent = {
  version: number;
  title?: string;
  brief?: string;
  /**
   * Opt-in "Sync to Notion" mode. When true, the document editor restricts the
   * slash menu to Notion-Flavored-Markdown-representable blocks and badges any
   * already-present incompatible blocks. Absent/false means normal mode (all
   * block types allowed). See `shared/notion-compat.ts`.
   */
  notionSync?: boolean;
  prototype?: PlanPrototype;
  canvas?: {
    /** `design` changes the top canvas tab from Wireframes to Design. */
    mode?: PlanVisualCanvasMode;
    title?: string;
    /** Captured brand/design source context used by /plan-design. */
    design?: {
      designMd?: string;
      brandKit?: Record<string, unknown>;
      codebaseStyles?: Record<string, unknown>;
      notes?: string;
      styleSources?: Array<{
        kind: "design-md" | "fig-file" | "codebase" | "manual";
        title?: string;
        summary?: string;
      }>;
    };
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
      op: "set-metadata";
      title?: string;
      brief?: string;
    }
  | {
      op: "set-prototype";
      prototype: PlanPrototype;
    }
  | {
      op: "remove-prototype";
    }
  | {
      op: "update-prototype-screen";
      screenId: string;
      patch: Partial<Omit<PlanPrototypeScreen, "id">>;
    }
  | {
      /**
       * Surgically edit a prototype screen's `html` via find/replace snippets.
       * This mirrors `patch-wireframe-html` so agents can patch one live state
       * without regenerating every screen.
       */
      op: "patch-prototype-html";
      screenId: string;
      edits: Array<{ find: string; replace: string; all?: boolean }>;
    }
  | {
      /**
       * Update inline CSS for one full-fidelity design element identified by
       * `data-design-id` or `data-plan-design-id`.
       */
      op: "update-design-element-style";
      elementId: string;
      frameId?: string;
      blockId?: string;
      styles: Record<string, string | null>;
    }
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
      /**
       * Surgically edit a diagram block's `html` via find/replace snippets.
       * Use this for one label, SVG path, or small layout change without
       * regenerating the entire diagram payload.
       */
      op: "patch-diagram-html";
      blockId: string;
      edits: Array<{ find: string; replace: string; all?: boolean }>;
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
      /**
       * Surgically edit a wireframe block's `html` mockup via find/replace
       * snippets, so one element/text/color can change without regenerating the
       * whole frame. Each `find` must be present; a `find` that matches more than
       * once needs `all: true`. The result is re-sanitized.
       */
      op: "patch-wireframe-html";
      blockId: string;
      edits: Array<{ find: string; replace: string; all?: boolean }>;
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
      op: "append-canvas-annotation";
      annotation: PlanAnnotation;
    }
  | {
      op: "append-block";
      block: PlanBlock;
      afterBlockId?: string;
      /**
       * Append into a container child instead of the top-level body. A `tabs`
       * parent addresses a tab by `tabBlockId`/`tabId`; a `columns` parent
       * addresses a column by `columnBlockId`/`columnId`. Omit for a top-level
       * append.
       */
      parent?:
        | {
            tabBlockId: string;
            tabId: string;
          }
        | {
            columnBlockId: string;
            columnId: string;
          };
    }
  | {
      op: "remove-block";
      blockId: string;
    }
  | {
      /** Toggle the per-plan "Sync to Notion" setting (a top-level scalar). */
      op: "set-notion-sync";
      value: boolean;
    };

/* -------------------------------------------------------------------------- */
/* Zod schemas                                                                */
/* -------------------------------------------------------------------------- */

const idSchema = z.string().trim().min(1).max(120);

/**
 * Shared diff-state enum reused by file-tree entries, data-model entities and
 * fields, and api-endpoint routes/params/responses so every block expresses the
 * same vocabulary for added/modified/removed/renamed.
 */
const diffChangeSchema = z.enum(["added", "modified", "removed", "renamed"]);

/**
 * Shared 1-based line-ref schema (e.g. "3" or "3-5") reused by `annotated-code`
 * and `diff` annotations so both validate line refs identically.
 */
const annotationLinesSchema = z
  .string()
  .trim()
  .regex(/^\d+(\s*-\s*\d+)?$/, {
    message: 'lines must be a 1-based line ref like "3" or "3-5"',
  })
  .max(40);

const baseBlockSchema = z.object({
  id: idSchema,
  title: z
    .string()
    .trim()
    .min(1)
    .max(180)
    .optional()
    .describe(
      "Legacy block label — do not set on new blocks. To give a block a heading, put a `rich-text` block whose markdown is a `###` heading directly above this block; those headings are inline-editable and join the document outline. A block `title` still renders (as a small muted label) for older plans, but new plans express block headings as standard markdown headings, not this field.",
    ),
  summary: z.string().trim().max(600).optional(),
  editable: z.boolean().optional(),
});

const unsafeCustomHtmlPattern =
  /(?:<!doctype|<\/?(?:html|head|body|script|style|iframe|object|embed|link|meta|base|form|svg|math|noscript|frame|frameset|applet|portal|marquee)[\s>/]|@(?:import|font-face|keyframes|page|namespace|charset)\b|\b(?:java\s*script|vb\s*script|data\s*:\s*(?:text\/html|image\/svg\+xml))\s*:?\s*|\bsrcdoc\s*=|(?:^|\s)(?:on[a-z][\w:-]*|:on[a-z][\w:-]*|x-bind:on[a-z][\w:-]*|:style|x-bind:style)\s*=|expression\s*\(|url\s*\(\s*['"]?\s*(?:java\s*script|vb\s*script|data\s*:\s*(?:text\/html|image\/svg\+xml)))/i;
const unsafeDiagramHtmlPattern =
  /(?:<!doctype|<\/?(?:html|head|body|script|style|iframe|object|embed|link|meta|base|form|math|foreignObject|noscript|frame|frameset|applet|portal|marquee)[\s>/]|@(?:import|font-face|keyframes|page|namespace|charset)\b|\b(?:java\s*script|vb\s*script|data\s*:\s*(?:text\/html|image\/svg\+xml))\s*:?\s*|\bsrcdoc\s*=|(?:^|\s)(?:on[a-z][\w:-]*|@[\w:.-]+|x-on:[\w:.-]+|:on[a-z][\w:-]*|x-bind:on[a-z][\w:-]*|:style|x-bind:style)\s*=|expression\s*\(|url\s*\(\s*['"]?\s*(?:java\s*script|vb\s*script|data\s*:\s*(?:text\/html|image\/svg\+xml)))/i;

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

const decodedSafetyText = (value: string) =>
  decodeCssSafetyEscapes(decodeSafetyEntities(value));

const compactSafetyText = (value: string) =>
  decodedSafetyText(value)
    .toLowerCase()
    .replace(/[\u0000-\u0020]+/g, "");

const unsafeViewportCssPattern =
  /(?:^|[;{\s])position\s*:\s*(?:fixed|sticky)\b|(?:^|[;{\s])z-index\s*:\s*[1-9]\d{4,}\b/i;

const noFullHtmlDocument = (value: string) => {
  const decoded = decodedSafetyText(value);
  const compact = compactSafetyText(value);
  return (
    !unsafeCustomHtmlPattern.test(value) &&
    !unsafeCustomHtmlPattern.test(decoded) &&
    !unsafeViewportCssPattern.test(decoded) &&
    !/(?:javascript|vbscript):|data:(?:text\/html|image\/svg\+xml)|expression\(|url\(['"]?(?:javascript|vbscript|data:(?:text\/html|image\/svg\+xml))/.test(
      compact,
    )
  );
};

const noActiveDiagramHtml = (value: string) => {
  const decoded = decodedSafetyText(value);
  const compact = compactSafetyText(value);
  return (
    !unsafeDiagramHtmlPattern.test(value) &&
    !unsafeDiagramHtmlPattern.test(decoded) &&
    !unsafeViewportCssPattern.test(decoded) &&
    !/(?:javascript|vbscript):|data:(?:text\/html|image\/svg\+xml)|expression\(|url\(['"]?(?:javascript|vbscript|data:(?:text\/html|image\/svg\+xml))/.test(
      compact,
    )
  );
};

const toneSchema = z.enum(["default", "accent", "warn", "ok", "muted"]);

const elNameSchema = z.enum([
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
]);

const WIREFRAME_MAX_DEPTH = 8;
const WIREFRAME_MAX_NODES = 400;
const PLAN_BLOCK_MAX_DEPTH = 40;
const PLAN_BLOCK_MAX_VISITS = 5_000;

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

const visualCanvasModeSchema = z.enum(["wireframe", "design"]);

export const wireframeDataSchema: z.ZodType<PlanWireframeBlock["data"]> = z
  .object({
    surface: wireframeSurfaceSchema,
    renderMode: visualCanvasModeSchema.optional(),
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
    screen: z
      .array(wireframeNodeSchema)
      .max(WIREFRAME_MAX_NODES)
      .optional()
      .default([])
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

const diagramDataSchema: z.ZodType<PlanDiagramBlock["data"]> = z
  .object({
    html: z
      .string()
      .trim()
      .max(100_000)
      .refine(noActiveDiagramHtml, {
        message:
          "Diagram html must be an inert fragment; SVG is allowed, scripts/events are not.",
      })
      .optional(),
    css: z
      .string()
      .max(50_000)
      .refine(noFullHtmlDocument, {
        message: "Diagram css must not include document or script tags.",
      })
      .optional(),
    caption: z.string().trim().max(600).optional(),
    nodes: z.array(diagramNodeSchema).max(80).optional(),
    edges: z.array(diagramEdgeSchema).max(120).optional(),
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
  })
  .superRefine((data, ctx) => {
    if (data.html?.trim() || (data.nodes?.length ?? 0) > 0) return;
    ctx.addIssue({
      code: "custom",
      path: ["html"],
      message: "Diagram block requires html or at least one node.",
    });
  });

export const imageDataSchema: z.ZodType<PlanImageBlock["data"]> = z
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

const planQuestionOptionSchema: z.ZodType<PlanQuestionOption> = z.object({
  id: idSchema,
  label: z.string().trim().min(1).max(220),
  detail: z.string().trim().max(800).optional(),
  recommended: z.boolean().optional(),
  wireframe: wireframeDataSchema.optional(),
  diagram: diagramDataSchema.optional(),
});

const planQuestionSchema: z.ZodType<PlanQuestion> = z.object({
  id: idSchema,
  title: z.string().trim().min(1).max(260),
  subtitle: z.string().trim().max(700).optional(),
  mode: z.enum(["single", "multi", "freeform"]),
  options: z.array(planQuestionOptionSchema).max(40).optional(),
  allowOther: z.boolean().optional(),
  placeholder: z.string().trim().max(240).optional(),
  required: z.boolean().optional(),
});

export const questionFormDataSchema: z.ZodType<PlanQuestionFormBlock["data"]> =
  z.object({
    questions: z.array(planQuestionSchema).min(1).max(40),
    submitLabel: z.string().trim().max(80).optional(),
  });

export const planBlockSchema: z.ZodType<PlanBlock> = z.lazy(() =>
  z.discriminatedUnion("type", [
    baseBlockSchema.extend({
      type: z.literal("rich-text"),
      data: z.object({
        markdown: z.string().max(100_000),
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
        density: z.enum(["compact", "normal", "relaxed"]).optional(),
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
      type: z.literal("code"),
      data: z.object({
        code: z.string().max(100_000),
        language: z.string().trim().max(40).optional(),
        filename: z.string().trim().max(400).optional(),
        caption: z.string().trim().max(400).optional(),
        maxLines: z.number().int().min(0).max(2000).optional(),
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
        orientation: z.enum(["horizontal", "vertical"]).optional(),
      }),
    }),
    baseBlockSchema.extend({
      type: z.literal("columns"),
      data: z.object({
        columns: z
          .array(
            z.object({
              id: idSchema,
              label: z.string().trim().min(1).max(120).optional(),
              blocks: z.array(planBlockSchema).max(40),
            }),
          )
          .min(1)
          .max(4),
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
      type: z.literal("question-form"),
      data: questionFormDataSchema,
    }),
    baseBlockSchema.extend({
      type: z.literal("visual-questions"),
      data: questionFormDataSchema,
    }),
    baseBlockSchema.extend({
      type: z.literal("mermaid"),
      data: z.object({
        source: z.string().max(50_000),
        caption: z.string().trim().max(400).optional(),
      }),
    }),
    baseBlockSchema.extend({
      type: z.literal("api-endpoint"),
      data: z.object({
        method: z.enum([
          "GET",
          "POST",
          "PUT",
          "PATCH",
          "DELETE",
          "HEAD",
          "OPTIONS",
        ]),
        path: z.string().trim().min(1).max(500),
        summary: z.string().trim().max(400).optional(),
        description: z.string().max(20_000).optional(),
        auth: z.string().trim().max(200).optional(),
        deprecated: z.boolean().optional(),
        change: diffChangeSchema.optional(),
        params: z
          .array(
            z.object({
              name: z.string().trim().min(1).max(160),
              in: z.enum(["path", "query", "header", "body"]),
              type: z.string().trim().max(120).optional(),
              required: z.boolean().optional(),
              description: z.string().trim().max(1_000).optional(),
              change: diffChangeSchema.optional(),
              was: z.string().trim().max(400).optional(),
            }),
          )
          .max(60)
          .optional(),
        request: z
          .object({
            contentType: z.string().trim().max(160).optional(),
            example: z.string().max(20_000).optional(),
          })
          .optional(),
        responses: z
          .array(
            z.object({
              status: z.string().trim().min(1).max(40),
              description: z.string().trim().max(1_000).optional(),
              example: z.string().max(20_000).optional(),
              change: diffChangeSchema.optional(),
            }),
          )
          .max(40)
          .optional(),
      }),
    }),
    baseBlockSchema.extend({
      type: z.literal("openapi-spec"),
      data: z.object({
        spec: z.string().max(400_000),
        title: z.string().trim().max(200).optional(),
      }),
    }),
    baseBlockSchema.extend({
      type: z.literal("data-model"),
      data: z.object({
        entities: z
          .array(
            z.object({
              id: idSchema,
              name: z.string().trim().min(1).max(160),
              note: z.string().trim().max(600).optional(),
              change: diffChangeSchema.optional(),
              fields: z
                .array(
                  z.object({
                    name: z.string().trim().min(1).max(160),
                    type: z.string().trim().max(120).optional(),
                    pk: z.boolean().optional(),
                    fk: z.string().trim().max(200).optional(),
                    nullable: z.boolean().optional(),
                    default: z.string().trim().max(400).optional(),
                    note: z.string().trim().max(600).optional(),
                    change: diffChangeSchema.optional(),
                    was: z.string().trim().max(400).optional(),
                  }),
                )
                .max(80),
            }),
          )
          .min(1)
          .max(60),
        relations: z
          .array(
            z.object({
              from: z.string().trim().min(1).max(120),
              to: z.string().trim().min(1).max(120),
              kind: z.enum(["1-1", "1-n", "n-n"]).optional(),
              label: z.string().trim().max(160).optional(),
            }),
          )
          .max(200)
          .optional(),
      }),
    }),
    baseBlockSchema.extend({
      type: z.literal("diff"),
      data: z.object({
        filename: z.string().trim().max(400).optional(),
        language: z.string().trim().max(40).optional(),
        before: z.string().max(100_000),
        after: z.string().max(100_000),
        mode: z.enum(["unified", "split"]).optional(),
        annotations: z
          .array(
            z.object({
              side: z.enum(["before", "after"]).optional(),
              lines: annotationLinesSchema,
              label: z.string().trim().max(160).optional(),
              note: z.string().trim().min(1).max(4_000),
            }),
          )
          .max(80)
          .optional(),
      }),
    }),
    baseBlockSchema.extend({
      type: z.literal("file-tree"),
      data: z.object({
        title: z.string().trim().max(180).optional(),
        entries: z
          .array(
            z.object({
              path: z.string().trim().min(1).max(500),
              change: diffChangeSchema.optional(),
              note: z.string().trim().max(2_000).optional(),
              snippet: z.string().max(50_000).optional(),
              language: z.string().trim().max(40).optional(),
            }),
          )
          .min(1)
          .max(200),
      }),
    }),
    baseBlockSchema.extend({
      type: z.literal("json-explorer"),
      data: z.object({
        title: z.string().trim().max(200).optional(),
        json: z.string().max(200_000),
        collapsedDepth: z.number().int().min(0).max(20).optional(),
      }),
    }),
    baseBlockSchema.extend({
      type: z.literal("annotated-code"),
      data: z.object({
        filename: z.string().trim().max(400).optional(),
        language: z.string().trim().max(40).optional(),
        code: z.string().max(100_000),
        annotations: z
          .array(
            z.object({
              lines: annotationLinesSchema,
              label: z.string().trim().max(160).optional(),
              note: z.string().trim().min(1).max(4_000),
            }),
          )
          .max(80)
          .optional(),
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

const annotationTypeSchema = z.enum(["note", "text", "callout", "arrow"]);

const annotationPointSchema: z.ZodType<PlanAnnotationPoint> = z.object({
  x: z.number(),
  y: z.number(),
});

const annotationStyleSchema: z.ZodType<PlanAnnotationStyle> = z.object({
  tone: toneSchema.optional(),
  stroke: z.enum(["solid", "dashed"]).optional(),
  width: z.number().min(1).max(12).optional(),
});

const artboardSchema: z.ZodType<PlanArtboard> = z
  .object({
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
  })
  // An artboard is a titled frame on the canvas; a label with no interior
  // wireframe renders as an empty dashed box (a label-only artboard). Reject
  // those at parse time so generation can never emit a frame with no content:
  // the artboard must carry inline kit-tree wireframe data, legacy region data,
  // or a `blockId` reference to a wireframe/legacy-wireframe block.
  .refine(
    (frame) =>
      !frame.label ||
      Boolean(frame.wireframe || frame.legacyWireframe || frame.blockId),
    {
      message:
        "Artboard has a label but no wireframe content. Add a `wireframe` (kit tree), `legacyWireframe`, or a `blockId` referencing a wireframe block — never emit a titled artboard with no interior content.",
      path: ["wireframe"],
    },
  ) as unknown as z.ZodType<PlanArtboard>;

const annotationSchema: z.ZodType<PlanAnnotation> = z.object({
  id: idSchema,
  type: annotationTypeSchema.optional(),
  title: z.string().trim().max(180).optional(),
  text: z.string().trim().min(1).max(2_000),
  points: z.array(annotationPointSchema).min(1).max(12).optional(),
  style: annotationStyleSchema.optional(),
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

const DESIGN_METADATA_JSON_MAX = 20_000;

function isCompactJsonRecord(value: Record<string, unknown>): boolean {
  try {
    return JSON.stringify(value).length <= DESIGN_METADATA_JSON_MAX;
  } catch {
    return false;
  }
}

const designMetadataSchema = z.object({
  designMd: z.string().max(100_000).optional(),
  brandKit: z
    .record(z.string(), z.unknown())
    .refine(isCompactJsonRecord, {
      message: "Brand kit metadata is too large.",
    })
    .optional(),
  codebaseStyles: z
    .record(z.string(), z.unknown())
    .refine(isCompactJsonRecord, {
      message: "Codebase style metadata is too large.",
    })
    .optional(),
  notes: z.string().max(20_000).optional(),
  styleSources: z
    .array(
      z.object({
        kind: z.enum(["design-md", "fig-file", "codebase", "manual"]),
        title: z.string().trim().max(180).optional(),
        summary: z.string().trim().max(2_000).optional(),
      }),
    )
    .max(20)
    .optional(),
});

const prototypeScreenStateSchema = z.object({
  id: idSchema.optional(),
  label: z.string().trim().min(1).max(80),
  value: z.string().trim().max(180),
});

const prototypeScreenSchema: z.ZodType<PlanPrototypeScreen> = z
  .object({
    id: idSchema,
    title: z.string().trim().max(180).optional(),
    summary: z.string().trim().max(500).optional(),
    surface: wireframeSurfaceSchema.optional(),
    renderMode: visualCanvasModeSchema.optional(),
    html: z.string().max(40_000).refine(noFullHtmlDocument, {
      message:
        "Prototype screen html must be a bounded fragment without html/head/body/script/style tags.",
    }),
    css: z
      .string()
      .max(20_000)
      .refine(noFullHtmlDocument, {
        message:
          "Prototype screen css must not include document or script tags.",
      })
      .optional(),
    state: z.array(prototypeScreenStateSchema).max(24).optional(),
  })
  .strict();

const prototypeTransitionSchema: z.ZodType<PlanPrototypeTransition> = z
  .object({
    id: idSchema.optional(),
    from: idSchema,
    to: idSchema,
    label: z.string().trim().max(120).optional(),
    trigger: z.string().trim().max(240).optional(),
  })
  .strict();

const prototypeSchema: z.ZodType<PlanPrototype> = z
  .object({
    title: z.string().trim().max(180).optional(),
    brief: z.string().trim().max(800).optional(),
    surface: wireframeSurfaceSchema.optional(),
    initialScreenId: idSchema.optional(),
    screens: z.array(prototypeScreenSchema).min(1).max(16),
    transitions: z.array(prototypeTransitionSchema).max(80).optional(),
  })
  .strict()
  .superRefine((prototype, context) => {
    const screenIds = new Set<string>();
    for (const [index, screen] of prototype.screens.entries()) {
      if (screenIds.has(screen.id)) {
        context.addIssue({
          code: "custom",
          path: ["screens", index, "id"],
          message: `Duplicate prototype screen id: ${screen.id}`,
        });
      }
      screenIds.add(screen.id);
    }
    if (
      prototype.initialScreenId &&
      !screenIds.has(prototype.initialScreenId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["initialScreenId"],
        message: `Initial prototype screen ${prototype.initialScreenId} was not found.`,
      });
    }
    for (const [index, transition] of (prototype.transitions ?? []).entries()) {
      if (!screenIds.has(transition.from)) {
        context.addIssue({
          code: "custom",
          path: ["transitions", index, "from"],
          message: `Transition source ${transition.from} was not found.`,
        });
      }
      if (!screenIds.has(transition.to)) {
        context.addIssue({
          code: "custom",
          path: ["transitions", index, "to"],
          message: `Transition target ${transition.to} was not found.`,
        });
      }
    }
  });

function exceedsPlanBlockDepth(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;

  const stack: Array<{ blocks: unknown; depth: number }> = [
    { blocks: (input as { blocks?: unknown }).blocks, depth: 0 },
  ];
  let visits = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !Array.isArray(current.blocks)) continue;
    if (current.depth > PLAN_BLOCK_MAX_DEPTH) return true;

    for (const block of current.blocks) {
      visits += 1;
      if (visits > PLAN_BLOCK_MAX_VISITS) return true;
      if (!block || typeof block !== "object") continue;
      const type = (block as { type?: unknown }).type;
      // Both container blocks nest their children one level deeper: `tabs` under
      // `data.tabs[].blocks`, `columns` under `data.columns[].blocks`.
      if (type !== "tabs" && type !== "columns") continue;

      const data = (block as { data?: unknown }).data;
      const groups =
        data && typeof data === "object"
          ? (data as { tabs?: unknown; columns?: unknown })[
              type === "tabs" ? "tabs" : "columns"
            ]
          : undefined;
      if (!Array.isArray(groups)) continue;

      for (const group of groups) {
        const blocks =
          group && typeof group === "object"
            ? (group as { blocks?: unknown }).blocks
            : undefined;
        stack.push({ blocks, depth: current.depth + 1 });
      }
    }
  }

  return false;
}

function preflightPlanContentInput(input: unknown): unknown {
  // MCP clients whose tool schema incorrectly types `content` as a string will
  // JSON-encode the object before sending. Parse it back here so callers don't
  // have to double-encode.
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      // Not valid JSON — let the object schema validation produce the error.
    }
  }
  if (!exceedsPlanBlockDepth(input)) return input;

  return {
    version: 2,
    blocks: [
      {
        id: "invalid-plan-block-depth",
        type: "invalid-plan-block-depth",
        data: {},
      },
    ],
  };
}

export const planContentSchema: z.ZodType<PlanContent> = z
  .preprocess(
    preflightPlanContentInput,
    z.object({
      version: z.number().int().min(PLAN_CONTENT_MIN_VERSION),
      title: z.string().trim().max(240).optional(),
      brief: z.string().trim().max(4_000).optional(),
      notionSync: z.boolean().optional(),
      prototype: prototypeSchema.optional(),
      canvas: z
        .object({
          mode: visualCanvasModeSchema.optional(),
          title: z.string().trim().max(180).optional(),
          design: designMetadataSchema.optional(),
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
    }),
  )
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
    const blocksById = new Map<string, PlanBlock>();
    const visit = (block: PlanBlock) => {
      if (seen.has(block.id)) {
        context.addIssue({
          code: "custom",
          path: ["blocks"],
          message: `Duplicate block id: ${block.id}`,
        });
      }
      seen.add(block.id);
      blocksById.set(block.id, block);
      if (block.type === "tabs") {
        for (const tab of block.data.tabs) {
          for (const child of tab.blocks) {
            visit(child);
          }
        }
      }
      if (block.type === "columns") {
        for (const column of block.data.columns) {
          for (const child of column.blocks) {
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
      for (const [index, frame] of content.canvas.frames.entries()) {
        if (!frame.blockId) continue;
        const block = blocksById.get(frame.blockId);
        if (block?.type === "wireframe" || block?.type === "legacy-wireframe") {
          continue;
        }
        context.addIssue({
          code: "custom",
          path: ["canvas", "frames", index, "blockId"],
          message: `Canvas frame ${frame.id} references missing or non-wireframe block: ${frame.blockId}`,
        });
      }
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

/**
 * The `decision` block was retired (it duplicated a `callout` with `tone:
 * "decision"` plus a `columns`/list comparison). Any stored decision block is
 * migrated on load into a decision-tone `callout` whose markdown body carries the
 * question and the options (recommended one flagged), so existing plans keep
 * loading and rendering instead of failing the (now decision-less) schema. The
 * block id/title/summary are preserved.
 */
function decisionBlockToCallout(
  block: Record<string, unknown>,
): Record<string, unknown> {
  const data = (block.data ?? {}) as Record<string, unknown>;
  const question = typeof data.question === "string" ? data.question : "";
  const options = Array.isArray(data.options) ? data.options : [];
  const lines = options.map((opt) => {
    const o = (opt ?? {}) as Record<string, unknown>;
    const label = typeof o.label === "string" ? o.label : "";
    const detail = typeof o.detail === "string" ? o.detail : "";
    const head = `- **${label}**${o.recommended === true ? " — recommended" : ""}`;
    return detail ? `${head}: ${detail}` : head;
  });
  const body =
    [question ? `**${question}**` : "", lines.join("\n")]
      .filter(Boolean)
      .join("\n\n") || "Decision";
  const { data: _data, ...rest } = block;
  return { ...rest, type: "callout", data: { tone: "decision", body } };
}

function migrateBlock(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const block = raw as Record<string, unknown>;
  const type = typeof block.type === "string" ? block.type : undefined;
  if (type && OLD_BLOCK_TYPE_ALIASES[type]) {
    block.type = OLD_BLOCK_TYPE_ALIASES[type];
  }
  // Retired `decision` block → decision-tone `callout` (see helper above).
  if (block.type === "decision") {
    return decisionBlockToCallout(block);
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
  // Recurse into columns children.
  if (
    block.type === "columns" &&
    block.data &&
    typeof block.data === "object"
  ) {
    const data = block.data as Record<string, unknown>;
    if (Array.isArray(data.columns)) {
      for (const column of data.columns) {
        if (column && typeof column === "object") {
          const columnObj = column as Record<string, unknown>;
          if (Array.isArray(columnObj.blocks)) {
            columnObj.blocks = columnObj.blocks.map(migrateBlock);
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
    type: annotationTypeSchema.optional(),
    title: z.string().trim().max(180).optional(),
    text: z.string().trim().min(1).max(2_000).optional(),
    points: z.array(annotationPointSchema).min(1).max(12).optional(),
    style: annotationStyleSchema.optional(),
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

const prototypeScreenPatchSchema = z
  .object({
    title: z.string().trim().max(180).optional(),
    summary: z.string().trim().max(500).optional(),
    surface: wireframeSurfaceSchema.optional(),
    renderMode: visualCanvasModeSchema.optional(),
    html: z
      .string()
      .max(40_000)
      .refine(noFullHtmlDocument, {
        message:
          "Prototype screen html must be a bounded fragment without html/head/body/script/style tags.",
      })
      .optional(),
    css: z
      .string()
      .max(20_000)
      .refine(noFullHtmlDocument, {
        message:
          "Prototype screen css must not include document or script tags.",
      })
      .optional(),
    state: z.array(prototypeScreenStateSchema).max(24).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Patch must include at least one prototype screen field.",
  });

export const planContentPatchSchema: z.ZodType<PlanContentPatch> =
  z.discriminatedUnion("op", [
    z
      .object({
        op: z.literal("set-metadata"),
        title: z.string().trim().min(1).max(240).optional(),
        brief: z.string().trim().max(4_000).optional(),
      })
      .refine(
        (patch) => patch.title !== undefined || patch.brief !== undefined,
        {
          message: "Metadata patch must include title or brief.",
        },
      ),
    z.object({
      op: z.literal("set-prototype"),
      prototype: prototypeSchema,
    }),
    z.object({
      op: z.literal("remove-prototype"),
    }),
    z.object({
      op: z.literal("update-prototype-screen"),
      screenId: idSchema,
      patch: prototypeScreenPatchSchema,
    }),
    z.object({
      op: z.literal("patch-prototype-html"),
      screenId: idSchema,
      edits: z
        .array(
          z.object({
            find: z.string().min(1).max(20_000),
            replace: z.string().max(40_000).refine(noFullHtmlDocument, {
              message:
                "Prototype html replacement must be a bounded fragment without html/head/body/script/style tags.",
            }),
            all: z.boolean().optional(),
          }),
        )
        .min(1)
        .max(40),
    }),
    z
      .object({
        op: z.literal("update-design-element-style"),
        elementId: z.string().trim().min(1).max(160),
        frameId: idSchema.optional(),
        blockId: idSchema.optional(),
        styles: z.record(
          z.string().trim().min(1).max(80),
          z.union([z.string().max(400), z.null()]),
        ),
      })
      .refine((patch) => Boolean(patch.frameId || patch.blockId), {
        message: "Provide frameId or blockId for update-design-element-style.",
      })
      .refine((patch) => Object.keys(patch.styles).length > 0, {
        message: "Provide at least one style to update.",
        path: ["styles"],
      }),
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
      op: z.literal("patch-diagram-html"),
      blockId: idSchema,
      edits: z
        .array(
          z.object({
            find: z.string().min(1).max(20_000),
            replace: z.string().max(40_000).refine(noActiveDiagramHtml, {
              message:
                "Diagram html replacement must be an inert fragment; SVG is allowed, scripts/events are not.",
            }),
            all: z.boolean().optional(),
          }),
        )
        .min(1)
        .max(40),
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
      op: z.literal("patch-wireframe-html"),
      blockId: idSchema,
      edits: z
        .array(
          z.object({
            find: z.string().min(1).max(20_000),
            replace: z.string().max(40_000).refine(noFullHtmlDocument, {
              message:
                "Wireframe html replacement must be a bounded fragment without html/head/body/script/style tags.",
            }),
            all: z.boolean().optional(),
          }),
        )
        .min(1)
        .max(40),
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
      op: z.literal("append-canvas-annotation"),
      annotation: annotationSchema,
    }),
    z.object({
      op: z.literal("append-block"),
      block: planBlockSchema,
      afterBlockId: idSchema.optional(),
      parent: z
        .union([
          z.object({
            tabBlockId: idSchema,
            tabId: idSchema,
          }),
          z.object({
            columnBlockId: idSchema,
            columnId: idSchema,
          }),
        ])
        .optional(),
    }),
    z.object({
      op: z.literal("remove-block"),
      blockId: idSchema,
    }),
    z.object({
      op: z.literal("set-notion-sync"),
      value: z.boolean(),
    }),
  ]) as z.ZodType<PlanContentPatch>;

export const planContentPatchesSchema = z.array(planContentPatchSchema).max(80);

export function applyPlanContentPatches(
  content: PlanContent,
  patches: PlanContentPatch[],
): PlanContent {
  const next = cloneJson(planContentSchema.parse(content));

  for (const patch of planContentPatchesSchema.parse(patches)) {
    if (patch.op === "set-metadata") {
      if (patch.title !== undefined) next.title = patch.title;
      if (patch.brief !== undefined) next.brief = patch.brief;
      continue;
    }
    if (patch.op === "set-prototype") {
      next.prototype = prototypeSchema.parse(patch.prototype);
      continue;
    }
    if (patch.op === "remove-prototype") {
      delete next.prototype;
      continue;
    }
    if (patch.op === "update-prototype-screen") {
      if (!next.prototype) {
        throw new Error(
          "Cannot update a prototype screen without a prototype.",
        );
      }
      const screen = next.prototype.screens.find(
        (candidate) => candidate.id === patch.screenId,
      );
      if (!screen) {
        throw new Error(`Prototype screen ${patch.screenId} was not found.`);
      }
      Object.assign(screen, patch.patch);
      continue;
    }
    if (patch.op === "patch-prototype-html") {
      if (!next.prototype) {
        throw new Error("Cannot patch prototype html without a prototype.");
      }
      const screen = next.prototype.screens.find(
        (candidate) => candidate.id === patch.screenId,
      );
      if (!screen) {
        throw new Error(`Prototype screen ${patch.screenId} was not found.`);
      }
      screen.html = applyTextEdits(
        "patch-prototype-html",
        screen.html,
        patch.edits,
      );
      continue;
    }
    if (patch.op === "update-design-element-style") {
      updateDesignElementStyle(next, patch);
      continue;
    }
    if (patch.op === "replace-block") {
      preserveCanvasLinkedWireframeBeforeBlockChange(
        next,
        patch.blockId,
        patch.block,
      );
      next.blocks = updateBlock(
        next.blocks,
        patch.blockId,
        () => patch.block,
      ).blocks;
      continue;
    }
    if (patch.op === "replace-blocks") {
      preserveCanvasLinkedWireframesBeforeReplaceBlocks(next, patch.blocks);
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
          // markdown is the only source of truth for rich-text blocks; any
          // legacy Tiptap/ProseMirror `doc` is intentionally dropped here so it
          // can never become a second source of truth.
          data: {
            markdown: patch.markdown ?? block.data.markdown,
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
    if (patch.op === "patch-diagram-html") {
      next.blocks = updateBlock(next.blocks, patch.blockId, (block) => {
        if (block.type !== "diagram") {
          throw new Error(
            `Block ${patch.blockId} is ${block.type}, not diagram.`,
          );
        }
        if (typeof block.data.html !== "string") {
          throw new Error(
            `Block ${patch.blockId} has no html diagram to patch (it may use legacy nodes/edges).`,
          );
        }
        return planBlockSchema.parse({
          ...block,
          data: {
            ...block.data,
            html: applyTextEdits(
              "patch-diagram-html",
              block.data.html,
              patch.edits,
            ),
          },
        });
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
    if (patch.op === "patch-wireframe-html") {
      next.blocks = updateBlock(next.blocks, patch.blockId, (block) => {
        if (block.type !== "wireframe") {
          throw new Error(
            `Block ${patch.blockId} is ${block.type}, not wireframe.`,
          );
        }
        if (typeof block.data.html !== "string") {
          throw new Error(
            `Block ${patch.blockId} has no html mockup to patch (it is a kit-tree wireframe).`,
          );
        }
        // Re-parse so the html refine (no script/style/etc.) re-sanitizes the
        // result — a patch can never smuggle active content in.
        return planBlockSchema.parse({
          ...block,
          data: {
            ...block.data,
            html: applyTextEdits(
              "patch-wireframe-html",
              block.data.html,
              patch.edits,
            ),
          },
        });
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
    if (patch.op === "append-canvas-annotation") {
      if (!next.canvas) {
        throw new Error("Cannot append a canvas annotation without a canvas.");
      }
      if (
        next.canvas.annotations?.some(
          (candidate) => candidate.id === patch.annotation.id,
        )
      ) {
        throw new Error(
          `Canvas annotation ${patch.annotation.id} already exists.`,
        );
      }
      next.canvas.annotations = [
        ...(next.canvas.annotations ?? []),
        patch.annotation,
      ];
      continue;
    }
    if (patch.op === "append-block") {
      const parent = patch.parent;
      if (parent && "tabBlockId" in parent) {
        next.blocks = updateBlock(next.blocks, parent.tabBlockId, (block) => {
          if (block.type !== "tabs") {
            throw new Error(
              `Block ${parent.tabBlockId} is ${block.type}, not tabs.`,
            );
          }
          let changed = false;
          const tabs = block.data.tabs.map((tab) => {
            if (tab.id !== parent.tabId) return tab;
            changed = true;
            return {
              ...tab,
              blocks: insertBlock(tab.blocks, patch.block, patch.afterBlockId),
            };
          });
          if (!changed) {
            throw new Error(`Tab ${parent.tabId} was not found.`);
          }
          return { ...block, data: { ...block.data, tabs } };
        }).blocks;
      } else if (parent && "columnBlockId" in parent) {
        next.blocks = updateBlock(
          next.blocks,
          parent.columnBlockId,
          (block) => {
            if (block.type !== "columns") {
              throw new Error(
                `Block ${parent.columnBlockId} is ${block.type}, not columns.`,
              );
            }
            let changed = false;
            const columns = block.data.columns.map((column) => {
              if (column.id !== parent.columnId) return column;
              changed = true;
              return {
                ...column,
                blocks: insertBlock(
                  column.blocks,
                  patch.block,
                  patch.afterBlockId,
                ),
              };
            });
            if (!changed) {
              throw new Error(`Column ${parent.columnId} was not found.`);
            }
            return { ...block, data: { columns } };
          },
        ).blocks;
      } else {
        next.blocks = insertBlock(next.blocks, patch.block, patch.afterBlockId);
      }
      continue;
    }
    if (patch.op === "remove-block") {
      preserveCanvasLinkedWireframeBeforeBlockChange(next, patch.blockId);
      const result = removeBlock(next.blocks, patch.blockId);
      if (!result.changed) {
        throw new Error(`Block ${patch.blockId} was not found.`);
      }
      next.blocks = result.blocks;
    }
    if (patch.op === "set-notion-sync") {
      // Keep the field absent (not `false`) when off, so plans that never opt in
      // stay byte-identical to their pre-feature shape on round-trip.
      if (patch.value) next.notionSync = true;
      else delete next.notionSync;
    }
  }

  syncCanvasWireframes(next);
  return planContentSchema.parse(next);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isWireframeBlock(
  block: PlanBlock | null | undefined,
): block is PlanWireframeBlock | PlanLegacyWireframeBlock {
  return block?.type === "wireframe" || block?.type === "legacy-wireframe";
}

function findBlock(blocks: PlanBlock[], blockId: string): PlanBlock | null {
  for (const block of blocks) {
    if (block.id === blockId) return block;
    if (block.type === "tabs") {
      for (const tab of block.data.tabs) {
        const child = findBlock(tab.blocks, blockId);
        if (child) return child;
      }
    }
    if (block.type === "columns") {
      for (const column of block.data.columns) {
        const child = findBlock(column.blocks, blockId);
        if (child) return child;
      }
    }
  }
  return null;
}

function collectBlocksById(blocks: PlanBlock[]) {
  const byId = new Map<string, PlanBlock>();
  const visit = (block: PlanBlock) => {
    byId.set(block.id, block);
    if (block.type === "tabs") {
      for (const tab of block.data.tabs) {
        for (const child of tab.blocks) visit(child);
      }
    }
    if (block.type === "columns") {
      for (const column of block.data.columns) {
        for (const child of column.blocks) visit(child);
      }
    }
  };
  for (const block of blocks) visit(block);
  return byId;
}

function inlineWireframeBlockOnFrame(
  frame: PlanArtboard,
  block: PlanWireframeBlock | PlanLegacyWireframeBlock,
) {
  if (block.type === "wireframe") {
    frame.wireframe = cloneJson(block.data);
    delete frame.legacyWireframe;
  } else {
    frame.legacyWireframe = cloneJson(block.data);
    delete frame.wireframe;
  }
  delete frame.blockId;
}

function preservesCanvasBlockReference(
  blockId: string,
  replacement: PlanBlock | null | undefined,
) {
  return replacement?.id === blockId && isWireframeBlock(replacement);
}

function preserveCanvasLinkedWireframeBeforeBlockChange(
  content: PlanContent,
  blockId: string,
  replacement?: PlanBlock,
) {
  if (!content.canvas) return;
  if (preservesCanvasBlockReference(blockId, replacement)) return;

  const existingBlock = findBlock(content.blocks, blockId);
  if (!isWireframeBlock(existingBlock)) return;

  for (const frame of content.canvas.frames) {
    if (frame.blockId !== blockId) continue;
    inlineWireframeBlockOnFrame(frame, existingBlock);
  }
}

function preserveCanvasLinkedWireframesBeforeReplaceBlocks(
  content: PlanContent,
  replacementBlocks: PlanBlock[],
) {
  if (!content.canvas) return;

  const replacementBlocksById = collectBlocksById(replacementBlocks);
  const currentBlocksById = collectBlocksById(content.blocks);

  for (const frame of content.canvas.frames) {
    if (!frame.blockId) continue;
    const replacement = replacementBlocksById.get(frame.blockId);
    if (isWireframeBlock(replacement)) continue;

    const existingBlock = currentBlocksById.get(frame.blockId);
    if (!isWireframeBlock(existingBlock)) continue;
    inlineWireframeBlockOnFrame(frame, existingBlock);
  }
}

type DesignElementStylePatch = Extract<
  PlanContentPatch,
  { op: "update-design-element-style" }
>;

function updateDesignElementStyle(
  content: PlanContent,
  patch: DesignElementStylePatch,
) {
  const updateData = (
    data: PlanWireframeBlock["data"],
    label: string,
  ): PlanWireframeBlock["data"] => {
    if (typeof data.html !== "string") {
      throw new Error(`${label} has no HTML design fragment to edit.`);
    }
    return {
      ...data,
      html: updateDesignElementStyleHtml(
        data.html,
        patch.elementId,
        patch.styles,
      ),
    };
  };

  const updateBlockWireframe = (
    blockId: string,
    sourceData?: PlanWireframeBlock["data"],
  ) => {
    content.blocks = updateBlock(content.blocks, blockId, (block) => {
      if (block.type !== "wireframe") {
        throw new Error(`Block ${blockId} is ${block.type}, not wireframe.`);
      }
      return {
        ...block,
        data: sourceData
          ? updateData(sourceData, `Canvas frame ${patch.frameId}`)
          : updateData(block.data, `Block ${blockId}`),
      };
    }).blocks;
  };

  if (patch.frameId) {
    const frame = content.canvas?.frames.find(
      (candidate) => candidate.id === patch.frameId,
    );
    if (!frame) {
      throw new Error(`Canvas frame ${patch.frameId} was not found.`);
    }
    if (frame.wireframe) {
      const updated = updateData(frame.wireframe, `Canvas frame ${frame.id}`);
      frame.wireframe = updated;
      if (frame.blockId) updateBlockWireframe(frame.blockId, updated);
      updatePrototypeDesignElementStyle(content, patch, frame);
      return;
    }
    if (frame.blockId) {
      updateBlockWireframe(frame.blockId);
      updatePrototypeDesignElementStyle(content, patch, frame);
      return;
    }
    throw new Error(`Canvas frame ${frame.id} has no editable design HTML.`);
  }

  if (patch.blockId) {
    updateBlockWireframe(patch.blockId);
    return;
  }

  throw new Error(
    "Provide frameId or blockId for update-design-element-style.",
  );
}

function updatePrototypeDesignElementStyle(
  content: PlanContent,
  patch: DesignElementStylePatch,
  frame?: PlanArtboard,
) {
  if (!content.prototype) return;
  const candidateIds = new Set<string>();
  const addFrameScreenIds = (id: string | undefined) => {
    if (!id) return;
    candidateIds.add(id);
    if (id.startsWith("frame-")) candidateIds.add(id.slice("frame-".length));
  };

  addFrameScreenIds(frame?.id ?? patch.frameId);
  if (candidateIds.size === 0) return;

  for (const screen of content.prototype.screens) {
    if (!candidateIds.has(screen.id)) continue;
    if (countDesignElementMatches(screen.html, patch.elementId) === 0) continue;
    screen.html = updateDesignElementStyleHtml(
      screen.html,
      patch.elementId,
      patch.styles,
    );
  }
}

function updateDesignElementStyleHtml(
  html: string,
  elementId: string,
  styles: Record<string, string | null>,
): string {
  const escaped = escapeRegExp(elementId);
  const tagPattern = new RegExp(
    `<([a-zA-Z][\\w:-]*)([^<>]*\\s(?:data-design-id|data-plan-design-id)\\s*=\\s*(["'])${escaped}\\3[^<>]*)>`,
    "gi",
  );
  const matches = Array.from(html.matchAll(tagPattern));
  if (matches.length === 0) {
    throw new Error(
      `Design element ${elementId} was not found. Add data-design-id="${elementId}" to the target element or select an existing design id.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Design element ${elementId} matched ${matches.length} elements; data-design-id values must be unique within a design screen.`,
    );
  }
  const match = matches[0];
  if (!match) throw new Error(`Design element ${elementId} was not found.`);
  const [openingTag, tagName, attrs] = match;
  const nextAttrs = mergeStyleAttribute(attrs, styles);
  return html.replace(openingTag, `<${tagName}${nextAttrs}>`);
}

function countDesignElementMatches(html: string, elementId: string): number {
  const escaped = escapeRegExp(elementId);
  return Array.from(
    html.matchAll(
      new RegExp(
        `<[a-zA-Z][\\w:-]*[^<>]*\\s(?:data-design-id|data-plan-design-id)\\s*=\\s*(["'])${escaped}\\1[^<>]*>`,
        "gi",
      ),
    ),
  ).length;
}

function mergeStyleAttribute(
  attrs: string,
  updates: Record<string, string | null>,
) {
  const styleAttr = attrs.match(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/i);
  const styles = parseInlineStyle(styleAttr?.[2] ?? "");

  for (const [rawName, value] of Object.entries(updates)) {
    const name = normalizeCssPropertyName(rawName);
    if (value === null || value.trim() === "") styles.delete(name);
    else {
      const trimmed = value.trim();
      if (!noFullHtmlDocument(`${name}: ${trimmed}`)) {
        throw new Error(`Unsafe CSS style value for ${name}.`);
      }
      styles.set(name, trimmed);
    }
  }

  const nextStyle = serializeInlineStyle(styles);
  if (!nextStyle) return attrs.replace(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/i, "");
  const escapedStyle = escapeHtmlAttribute(nextStyle);
  if (styleAttr) {
    return attrs.replace(
      /\sstyle\s*=\s*(["'])([\s\S]*?)\1/i,
      ` style="${escapedStyle}"`,
    );
  }
  return `${attrs} style="${escapedStyle}"`;
}

function parseInlineStyle(style: string) {
  const parsed = new Map<string, string>();
  for (const entry of style.split(";")) {
    const colon = entry.indexOf(":");
    if (colon <= 0) continue;
    const name = normalizeCssPropertyName(entry.slice(0, colon));
    const value = entry.slice(colon + 1).trim();
    if (value) parsed.set(name, value);
  }
  return parsed;
}

function serializeInlineStyle(styles: Map<string, string>) {
  return Array.from(styles.entries())
    .map(([name, value]) => `${name}: ${value}`)
    .join("; ");
}

function normalizeCssPropertyName(name: string) {
  const normalized = name
    .trim()
    .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
    .toLowerCase();
  if (!/^(?:--)?[a-z0-9][a-z0-9-]*$/.test(normalized)) {
    throw new Error(`Invalid CSS property name: ${name}`);
  }
  return normalized;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Compact a snippet for find/replace error messages. */
function truncateSnippet(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
}

function applyTextEdits(
  op: string,
  value: string,
  edits: Array<{ find: string; replace: string; all?: boolean }>,
) {
  let next = value;
  for (const edit of edits) {
    const count = next.split(edit.find).length - 1;
    if (count === 0) {
      throw new Error(
        `${op}: find snippet not present: ${truncateSnippet(edit.find)}`,
      );
    }
    if (count > 1 && !edit.all) {
      throw new Error(
        `${op}: find snippet matched ${count} times; make it unique or set all:true - ${truncateSnippet(edit.find)}`,
      );
    }
    next = edit.all
      ? next.split(edit.find).join(edit.replace)
      : next.replace(edit.find, edit.replace);
  }
  return next;
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
    if (block.type === "tabs") {
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
      return { ...block, data: { ...block.data, tabs: childResult.tabs } };
    }
    if (block.type === "columns") {
      const childResult = block.data.columns.reduce<{
        columns: PlanColumnsBlock["data"]["columns"];
        changed: boolean;
      }>(
        (acc, column) => {
          const updated = updateBlockRecursive(column.blocks, blockId, updater);
          acc.columns.push({ ...column, blocks: updated.blocks });
          acc.changed = acc.changed || updated.changed;
          return acc;
        },
        { columns: [], changed: false },
      );
      if (!childResult.changed) return block;
      changed = true;
      return { ...block, data: { columns: childResult.columns } };
    }
    return block;
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
      if (block.type === "tabs") {
        const tabs = block.data.tabs.map((tab) => {
          const result = removeBlock(tab.blocks, blockId);
          changed = changed || result.changed;
          return { ...tab, blocks: result.blocks };
        });
        return { ...block, data: { ...block.data, tabs } };
      }
      if (block.type === "columns") {
        const columns = block.data.columns.map((column) => {
          const result = removeBlock(column.blocks, blockId);
          changed = changed || result.changed;
          return { ...column, blocks: result.blocks };
        });
        return { ...block, data: { columns } };
      }
      return block;
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
    if (block.type === "columns") {
      for (const column of block.data.columns) {
        for (const child of column.blocks) visit(child);
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
