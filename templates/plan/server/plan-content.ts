import {
  PLAN_CONTENT_VERSION,
  createPlanBlockId,
  migratePlanContent,
  planContentSchema,
  type PlanArtboard,
  type PlanAnnotation,
  type PlanBlock,
  type PlanContent,
  type PlanContentInput,
  type PlanConnector,
  type PlanDiagramBlock,
  type PlanImageBlock,
  type PlanLegacyWireframeBlock,
  type PlanPrototype,
  type PlanPrototypeScreen,
  type PlanWireframeBlock,
  type PlanWireframeNode,
  type PlanWireframeSurface,
  type PlanWireframeRegion,
  type PlanVisualQuestion,
} from "../shared/plan-content.js";
import type { PlanSection } from "../shared/types.js";

type SectionLike = Pick<PlanSection, "id" | "type" | "title" | "body" | "html">;

/** Region-based wireframe data — the renderer's legacy fallback shape. */
type LegacyWireframeData = PlanLegacyWireframeBlock["data"];

export function parsePlanContent(value: unknown): PlanContent | null {
  if (!value) return null;
  // Drizzle returns a Buffer for any `content` row stored with BLOB affinity
  // (e.g. a raw SQL insert via readfile()/a Buffer instead of a JSON string).
  // Decode it to text so the JSON path below runs — otherwise the Buffer falls
  // through as an "object", migrate reads undefined version/blocks, and the
  // plan silently parses to an empty body with no warning.
  const source =
    value instanceof Uint8Array ? new TextDecoder().decode(value) : value;
  const parsedValue =
    typeof source === "string"
      ? (() => {
          try {
            return JSON.parse(source);
          } catch {
            return null;
          }
        })()
      : source;
  if (!parsedValue) return null;
  // Upgrade old/raw shapes (region wireframes -> legacy-wireframe, sketch-* ->
  // diagram, version backfill) before validating. Never lossily migrate.
  try {
    const migrated = migratePlanContent(parsedValue);
    const result = planContentSchema.safeParse(
      preSanitizePlanContentInput(migrated),
    );
    if (result.success) return result.data;
    // Surface parse failures instead of swallowing them so a bad migration is
    // diagnosable rather than silently erasing a plan body.
    console.warn(
      "[plan-content] failed to parse stored content:",
      result.error.issues.slice(0, 4),
    );
    return null;
  } catch (error) {
    // Defense-in-depth: pathological input (e.g. deeply nested tabs) can overflow
    // the recursive schema/migration and throw a RangeError that safeParse does
    // NOT catch. Fail closed so the reading route shows a graceful fallback
    // instead of crashing the entire plan page.
    console.warn("[plan-content] errored while parsing stored content:", error);
    return null;
  }
}

export function serializePlanContent(content: PlanContentInput): string {
  return JSON.stringify(
    sanitizePlanContent(
      planContentSchema.parse(preSanitizePlanContentInput(content)),
    ),
  );
}

export function normalizePlanContent(
  content: PlanContentInput | undefined,
): PlanContent | null {
  if (!content) return null;
  return sanitizePlanContent(
    planContentSchema.parse(migratePlanContent(content)),
  );
}

export function normalizePlanDesignContent(
  content: PlanContentInput | undefined,
  input: PlanDesignContentInput,
): PlanContent | null {
  const normalized = normalizePlanContent(content);
  if (!normalized) return null;
  const next = cloneJson(normalized);

  if (next.prototype) {
    next.prototype = sanitizePrototype({
      ...next.prototype,
      screens: next.prototype.screens.map((screen) => ({
        ...screen,
        renderMode: "design",
      })),
    });
  }

  if (!next.prototype && next.canvas?.frames.length) {
    const prototype = createPrototypeFromPlanContent(next, {
      title: input.title,
      brief: input.brief,
    });
    if (prototype) {
      next.prototype = sanitizePrototype({
        ...prototype,
        screens: prototype.screens.map((screen) => ({
          ...screen,
          renderMode: "design",
        })),
      });
    }
  }

  if (!next.canvas && next.prototype) {
    next.canvas = prototypeToCanvas(next.prototype);
  }

  if (!next.canvas) {
    const fallback = createPlanDesignContent({ ...input, screens: [] });
    next.canvas = fallback.canvas;
    next.prototype = fallback.prototype;
  }

  if (next.canvas) {
    next.canvas = {
      ...next.canvas,
      mode: "design",
      title: next.canvas.title ?? "Design Direction",
      design: mergeDesignMetadata(next.canvas.design, input),
      frames: next.canvas.frames.map((frame) => ({
        ...frame,
        wireframe: frame.wireframe?.html
          ? { ...frame.wireframe, renderMode: "design" }
          : frame.wireframe,
      })),
    };
  }

  return sanitizePlanContent(
    planContentSchema.parse({
      ...next,
      blocks: next.blocks.map(forceDesignWireframeBlocks),
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* custom-html sanitization (defense in depth at the action boundary)         */
/* -------------------------------------------------------------------------- */

/**
 * Tags that may NEVER survive in a stored custom-html fragment. The zod schema
 * already rejects these at validation time; this is a second, allowlist-style
 * pass so the value we persist (and later export) is structurally clean even if
 * validation is ever bypassed or relaxed. The in-app React path renders these
 * fragments in a sandboxed iframe; the export path shows escaped source.
 */
/**
 * Content-bearing dangerous elements: the whole element (open tag, body, close
 * tag) must go, not just the tags — otherwise script/style bodies leak through.
 */
const FORBIDDEN_ELEMENT =
  /<(script|style|iframe|object|embed|noscript|svg|math|applet|portal|frameset|marquee)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi;

/** Standalone / self-closing forbidden tags (e.g. <link>, <meta>, dangling). */
const FORBIDDEN_TAG =
  /<\/?\s*(?:script|style|iframe|object|embed|link|meta|base|form|svg|math|noscript|frame|frameset|applet|portal|marquee)\b[^>]*>/gi;

const DIAGRAM_FORBIDDEN_ELEMENT =
  /<(script|style|iframe|object|embed|noscript|math|foreignObject|applet|portal|frameset|marquee)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi;

const DIAGRAM_FORBIDDEN_TAG =
  /<\/?\s*(?:script|style|iframe|object|embed|link|meta|base|form|math|foreignObject|noscript|frame|frameset|applet|portal|marquee)\b[^>]*>/gi;

/** Inline event handlers and javascript:/data: URLs in attributes. */
const FORBIDDEN_ATTR = /\son[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const FORBIDDEN_BOUND_ATTR =
  /\s(?::on[a-z][\w:-]*|x-bind:on[a-z][\w:-]*|:style|x-bind:style)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const DIAGRAM_FORBIDDEN_BOUND_ATTR =
  /\s(?:@[\w:.-]+|x-on:[\w:.-]+|:on[\w:.-]+|x-bind:on[\w:.-]+|:style|x-bind:style)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const URL_ATTR =
  /\s(?:href|src|xlink:href|srcdoc|action|formaction|data|background|poster|ping)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const STYLE_ATTR = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

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

function hasUnsafeUrl(value: string): boolean {
  const compact = compactSafetyText(value);
  return (
    compact.startsWith("javascript:") ||
    compact.startsWith("vbscript:") ||
    compact.startsWith("data:text/html") ||
    compact.startsWith("data:image/svg+xml")
  );
}

function hasUnsafeStyle(value: string): boolean {
  const decoded = decodedSafetyText(value);
  const compact = compactSafetyText(value);
  return (
    unsafeViewportCssPattern.test(decoded) ||
    compact.includes("expression(") ||
    compact.includes("javascript:") ||
    compact.includes("vbscript:") ||
    compact.includes("url(data:text/html") ||
    compact.includes("url(data:image/svg+xml")
  );
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sanitizeMaybeWireframeData(data: unknown) {
  if (!data || typeof data !== "object") return;
  const record = data as Record<string, unknown>;
  if (typeof record.html === "string") {
    record.html = sanitizeCustomHtml(record.html);
  }
  if (typeof record.css === "string") {
    record.css = sanitizeCustomHtml(record.css);
  }
}

function sanitizeMaybeDiagramData(data: unknown) {
  if (!data || typeof data !== "object") return;
  const record = data as Record<string, unknown>;
  if (typeof record.html === "string") {
    record.html = sanitizeDiagramHtml(record.html);
  }
  if (typeof record.css === "string") {
    record.css = sanitizeCustomHtml(record.css);
  }
}

function sanitizeMaybeQuestionPreviews(data: unknown) {
  if (!data || typeof data !== "object") return;
  const questions = (data as Record<string, unknown>).questions;
  if (!Array.isArray(questions)) return;
  for (const question of questions) {
    if (!question || typeof question !== "object") continue;
    const options = (question as Record<string, unknown>).options;
    if (!Array.isArray(options)) continue;
    for (const option of options) {
      if (!option || typeof option !== "object") continue;
      sanitizeMaybeWireframeData((option as Record<string, unknown>).wireframe);
      sanitizeMaybeDiagramData((option as Record<string, unknown>).diagram);
    }
  }
}

function sanitizeMaybeBlocks(blocks: unknown) {
  if (!Array.isArray(blocks)) return;
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    const data = record.data as Record<string, unknown> | undefined;
    if (record.type === "custom-html" || record.type === "wireframe") {
      sanitizeMaybeWireframeData(data);
    }
    if (record.type === "diagram") {
      sanitizeMaybeDiagramData(data);
    }
    if (record.type === "question-form" || record.type === "visual-questions") {
      sanitizeMaybeQuestionPreviews(data);
    }
    if (record.type === "tabs" && data && Array.isArray(data.tabs)) {
      for (const tab of data.tabs) {
        if (!tab || typeof tab !== "object") continue;
        sanitizeMaybeBlocks((tab as Record<string, unknown>).blocks);
      }
    }
  }
}

function preSanitizePlanContentInput(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const content = cloneJson(input) as Record<string, unknown>;
  const prototype = content.prototype as Record<string, unknown> | undefined;
  if (prototype && Array.isArray(prototype.screens)) {
    for (const screen of prototype.screens) {
      if (!screen || typeof screen !== "object") continue;
      const record = screen as Record<string, unknown>;
      if (typeof record.html === "string") {
        record.html = sanitizeCustomHtml(record.html);
      }
      if (typeof record.css === "string") {
        record.css = sanitizeCustomHtml(record.css);
      }
    }
  }
  const canvas = content.canvas as Record<string, unknown> | undefined;
  if (canvas && Array.isArray(canvas.frames)) {
    for (const frame of canvas.frames) {
      if (!frame || typeof frame !== "object") continue;
      sanitizeMaybeWireframeData((frame as Record<string, unknown>).wireframe);
    }
  }
  sanitizeMaybeBlocks(content.blocks);
  return content;
}

/** Strip the dangerous surface from a stored custom-html / css string. */
export function sanitizeCustomHtml(value: string): string {
  let out = value;
  // Iterate element-stripping so nested / sequential cases collapse fully.
  for (let i = 0; i < 4; i += 1) {
    const next = out.replace(FORBIDDEN_ELEMENT, "");
    if (next === out) break;
    out = next;
  }
  return out
    .replace(FORBIDDEN_TAG, "")
    .replace(FORBIDDEN_ATTR, "")
    .replace(FORBIDDEN_BOUND_ATTR, "")
    .replace(URL_ATTR, (match, doubleQuoted, singleQuoted, bare) =>
      hasUnsafeUrl(doubleQuoted ?? singleQuoted ?? bare ?? "") ? "" : match,
    )
    .replace(STYLE_ATTR, (match, doubleQuoted, singleQuoted, bare) =>
      hasUnsafeStyle(doubleQuoted ?? singleQuoted ?? bare ?? "") ? "" : match,
    )
    .replace(/\bjava\s*script\s*:/gi, "")
    .replace(/\bvb\s*script\s*:/gi, "")
    .replace(/\bdata\s*:\s*(?:text\/html|image\/svg\+xml)/gi, "");
}

export function sanitizeDiagramHtml(value: string): string {
  let out = value;
  for (let i = 0; i < 4; i += 1) {
    const next = out.replace(DIAGRAM_FORBIDDEN_ELEMENT, "");
    if (next === out) break;
    out = next;
  }
  return out
    .replace(DIAGRAM_FORBIDDEN_TAG, "")
    .replace(FORBIDDEN_ATTR, "")
    .replace(FORBIDDEN_BOUND_ATTR, "")
    .replace(DIAGRAM_FORBIDDEN_BOUND_ATTR, "")
    .replace(URL_ATTR, (match, doubleQuoted, singleQuoted, bare) =>
      hasUnsafeUrl(doubleQuoted ?? singleQuoted ?? bare ?? "") ? "" : match,
    )
    .replace(STYLE_ATTR, (match, doubleQuoted, singleQuoted, bare) =>
      hasUnsafeStyle(doubleQuoted ?? singleQuoted ?? bare ?? "") ? "" : match,
    )
    .replace(/\bjava\s*script\s*:/gi, "")
    .replace(/\bvb\s*script\s*:/gi, "")
    .replace(/\bdata\s*:\s*(?:text\/html|image\/svg\+xml)/gi, "");
}

function sanitizeBlock(block: PlanBlock): PlanBlock {
  if (block.type === "wireframe") {
    return {
      ...block,
      data: {
        ...block.data,
        html:
          block.data.html === undefined
            ? undefined
            : sanitizeCustomHtml(block.data.html),
        css:
          block.data.css === undefined
            ? undefined
            : sanitizeCustomHtml(block.data.css),
      },
    };
  }
  if (block.type === "custom-html") {
    return {
      ...block,
      data: {
        ...block.data,
        html: sanitizeCustomHtml(block.data.html),
        css:
          block.data.css === undefined
            ? undefined
            : sanitizeCustomHtml(block.data.css),
      },
    };
  }
  if (block.type === "diagram") {
    return {
      ...block,
      data: sanitizeDiagramData(block.data),
    };
  }
  if (block.type === "question-form" || block.type === "visual-questions") {
    return {
      ...block,
      data: {
        ...block.data,
        questions: block.data.questions.map((question) => ({
          ...question,
          options: question.options?.map((option) => ({
            ...option,
            wireframe: sanitizeWireframeData(option.wireframe),
            diagram: sanitizeDiagramData(option.diagram),
          })),
        })),
      },
    };
  }
  if (block.type === "tabs") {
    return {
      ...block,
      data: {
        ...block.data,
        tabs: block.data.tabs.map((tab) => ({
          ...tab,
          blocks: tab.blocks.map(sanitizeBlock),
        })),
      },
    };
  }
  return block;
}

function sanitizePrototype(prototype: PlanPrototype | undefined) {
  if (!prototype) return undefined;
  return {
    ...prototype,
    screens: prototype.screens.map((screen) => ({
      ...screen,
      html: sanitizeCustomHtml(screen.html),
      css:
        screen.css === undefined ? undefined : sanitizeCustomHtml(screen.css),
    })),
  };
}

function sanitizeWireframeData(
  wireframe: PlanWireframeBlock["data"] | undefined,
) {
  if (!wireframe) return undefined;
  return {
    ...wireframe,
    html:
      wireframe.html === undefined
        ? undefined
        : sanitizeCustomHtml(wireframe.html),
    css:
      wireframe.css === undefined
        ? undefined
        : sanitizeCustomHtml(wireframe.css),
  };
}

function sanitizeDiagramData(diagram: PlanDiagramBlock["data"] | undefined) {
  if (!diagram) return undefined;
  return {
    ...diagram,
    html:
      diagram.html === undefined
        ? undefined
        : sanitizeDiagramHtml(diagram.html),
    css:
      diagram.css === undefined ? undefined : sanitizeCustomHtml(diagram.css),
  };
}

function sanitizeCanvas(canvas: PlanContent["canvas"] | undefined) {
  if (!canvas) return undefined;
  return {
    ...canvas,
    frames: canvas.frames.map((frame) => ({
      ...frame,
      wireframe: sanitizeWireframeData(frame.wireframe),
    })),
  };
}

/** Sanitize every custom-html fragment in a plan before it is stored. */
export function sanitizePlanContent(content: PlanContent): PlanContent {
  return {
    ...content,
    prototype: sanitizePrototype(content.prototype),
    canvas: sanitizeCanvas(content.canvas),
    blocks: content.blocks.map(sanitizeBlock),
  };
}

export function createPlanContentFromSections(input: {
  title: string;
  brief: string;
  sections: SectionLike[];
}): PlanContent {
  const blocks = input.sections.map((section, index) =>
    blockFromSection(section, index),
  );
  return sanitizePlanContent(
    planContentSchema.parse({
      version: PLAN_CONTENT_VERSION,
      title: input.title,
      brief: input.brief,
      canvas: findCanvas(blocks),
      blocks,
    }),
  );
}

export function createDefaultPlanContent(input: {
  title: string;
  brief: string;
  repoPath?: string | null;
}): PlanContent {
  return sanitizePlanContent(
    planContentSchema.parse({
      version: PLAN_CONTENT_VERSION,
      title: input.title,
      brief: input.brief,
      blocks: [
        {
          id: createPlanBlockId("plan-summary"),
          type: "rich-text",
          title: "What Matters Most",
          editable: true,
          data: {
            markdown: input.brief,
          },
        },
        {
          id: createPlanBlockId("flow"),
          type: "diagram",
          title: "Plan Flow",
          data: {
            nodes: [
              { id: "intent", label: "Intent", detail: "Clarify the target" },
              { id: "review", label: "Review", detail: "Comment on the plan" },
              { id: "build", label: "Build", detail: "Agent implements" },
              { id: "verify", label: "Verify", detail: "Check the result" },
            ],
            edges: [
              { from: "intent", to: "review" },
              { from: "review", to: "build" },
              { from: "build", to: "verify" },
            ],
          },
        },
        {
          id: createPlanBlockId("implementation-map"),
          type: "implementation-map",
          title: "Implementation Map",
          data: {
            files: [
              {
                path: input.repoPath
                  ? `${input.repoPath}/...`
                  : "repo/path.tsx",
                title: "Files to inspect",
                note: "Replace this with concrete file references, symbols, and short snippets after the repo pass.",
                language: "text",
              },
            ],
          },
        },
      ],
    }),
  );
}

type UiPlanContentInput = {
  title: string;
  brief: string;
  source?: string;
  repoPath?: string | null;
  states: Array<{ name: string; description: string }>;
  components: Array<{ name: string; description: string }>;
  implementationNotes?: string | null;
};

type PrototypePlanContentInput = {
  title: string;
  brief: string;
  source?: string;
  repoPath?: string | null;
  prototype?: PlanPrototype | null;
  screens: Array<{
    id?: string;
    title: string;
    summary?: string;
    surface?: PlanWireframeSurface;
    renderMode?: "wireframe" | "design";
    html?: string;
    css?: string;
    state?: PlanPrototypeScreen["state"];
  }>;
  transitions?: PlanPrototype["transitions"];
  implementationNotes?: string | null;
};

type PlanDesignContentInput = Omit<PrototypePlanContentInput, "prototype"> & {
  designMd?: string | null;
  brandKit?: Record<string, unknown> | null;
  codebaseStyles?: Record<string, unknown> | null;
  designNotes?: string | null;
};

function forceDesignWireframeBlocks(block: PlanBlock): PlanBlock {
  if (block.type === "wireframe" && block.data.html) {
    return {
      ...block,
      data: { ...block.data, renderMode: "design" },
    };
  }
  if (block.type === "tabs") {
    return {
      ...block,
      data: {
        ...block.data,
        tabs: block.data.tabs.map((tab) => ({
          ...tab,
          blocks: tab.blocks.map(forceDesignWireframeBlocks),
        })),
      },
    };
  }
  return block;
}

function mergeDesignMetadata(
  existing: NonNullable<PlanContent["canvas"]>["design"],
  input: PlanDesignContentInput,
): NonNullable<PlanContent["canvas"]>["design"] {
  const incoming = createDesignMetadata(input);
  const styleSources = [
    ...(existing?.styleSources ?? []),
    ...(incoming.styleSources ?? []),
  ];
  return {
    ...(existing ?? {}),
    ...incoming,
    ...(styleSources.length > 0 ? { styleSources } : {}),
  };
}

function createDesignMetadata(
  input: Pick<
    PlanDesignContentInput,
    "designMd" | "brandKit" | "codebaseStyles" | "designNotes"
  >,
): NonNullable<PlanContent["canvas"]>["design"] {
  return {
    ...(input.designMd ? { designMd: input.designMd } : {}),
    ...(input.brandKit ? { brandKit: input.brandKit } : {}),
    ...(input.codebaseStyles ? { codebaseStyles: input.codebaseStyles } : {}),
    ...(input.designNotes ? { notes: input.designNotes } : {}),
    styleSources: [
      ...(input.designMd
        ? [{ kind: "design-md" as const, title: "design.md" }]
        : []),
      ...(input.brandKit
        ? [{ kind: "fig-file" as const, title: "Brand kit" }]
        : []),
      ...(input.codebaseStyles
        ? [{ kind: "codebase" as const, title: "Codebase styles" }]
        : []),
    ],
  };
}

export function createUiPlanContent(input: UiPlanContentInput): PlanContent {
  const states = input.states;
  const stateIds = uniqueIds(
    states.map((state, index) => slug(state.name) || `state-${index + 1}`),
  );
  const stateBlockIds = stateIds.map((id) => ({
    notes: createPlanBlockId(`${id}-notes`),
    wireframe: createPlanBlockId(`${id}-wireframe`),
  }));
  const componentIds = uniqueIds(
    input.components.map(
      (component, index) => slug(component.name) || `component-${index + 1}`,
    ),
  );
  const componentPlan = isComponentPlan(input);
  const includeComponentContext =
    componentPlan && shouldShowComponentContext(input);
  const stateFlow = shouldUseStateFlow(input, componentPlan);
  const stateFrames: PlanArtboard[] = states.slice(0, 6).map((state, index) => {
    const wireframe = createUiWireframeData({
      title: state.name,
      description: state.description,
      viewport: viewportForState(state, componentPlan, {
        index,
        stateFlow,
      }),
      component: componentPlan,
    });
    return {
      id: `frame-${stateIds[index] ?? index + 1}`,
      label: state.name,
      blockId: stateBlockIds[index]?.wireframe,
      surface: wireframe.surface,
      wireframe,
      ...(componentPlan
        ? {
            x: (includeComponentContext ? 780 : 80) + (index % 2) * 420,
            y: 96 + Math.floor(index / 2) * 500,
          }
        : {}),
    };
  });
  const contextWireframe = includeComponentContext
    ? createComponentContextKitWireframe(input)
    : undefined;
  const contextFrame: PlanArtboard | undefined = includeComponentContext
    ? {
        id: "frame-app-context",
        label: "App context",
        surface: contextWireframe?.surface,
        wireframe: contextWireframe,
        x: 80,
        y: 96,
      }
    : undefined;
  const frames: PlanArtboard[] = contextFrame
    ? [contextFrame, ...stateFrames]
    : stateFrames;
  const flow: PlanConnector[] = stateFlow
    ? stateFrames.slice(0, -1).map((frame, index) => ({
        from: frame.id,
        to: stateFrames[index + 1]?.id ?? frame.id,
        label: `Step ${index + 1}`,
      }))
    : [];
  const annotations = createCanvasAnnotations({
    componentPlan,
    includeComponentContext,
    contextFrame,
    stateFrames,
  });
  const duplicateVisualBlocks = !componentPlan;
  const blocks: PlanBlock[] = [
    {
      id: createPlanBlockId("summary"),
      type: "rich-text",
      title: componentPlan ? "Plan Overview" : "What Matters Most",
      editable: true,
      data: {
        markdown: componentPlan
          ? createComponentPlanOverview(input)
          : input.brief,
      },
    },
    ...(states.length > 0 && duplicateVisualBlocks
      ? ([
          {
            id: createPlanBlockId("screen-states"),
            type: "tabs",
            title: componentPlan ? "Component States" : "Screen States",
            data: {
              tabs: states.map((state, index) => ({
                id: stateIds[index] ?? createPlanBlockId("state"),
                label: state.name,
                blocks: [
                  {
                    id:
                      stateBlockIds[index]?.notes ??
                      createPlanBlockId(`${state.name}-notes`),
                    type: "rich-text",
                    title: state.name,
                    editable: true,
                    data: { markdown: state.description },
                  },
                  {
                    id:
                      stateBlockIds[index]?.wireframe ??
                      createPlanBlockId(`${state.name}-wireframe`),
                    type: "wireframe",
                    title: `${state.name} Wireframe`,
                    data: createUiWireframeData({
                      title: state.name,
                      description: state.description,
                      viewport: viewportForState(state, componentPlan, {
                        index,
                        stateFlow,
                      }),
                      component: componentPlan,
                    }),
                  },
                ],
              })),
            },
          },
          ...(stateFlow
            ? ([
                {
                  id: createPlanBlockId("flow-diagram"),
                  type: "diagram",
                  title: "Flow Diagram",
                  data: {
                    nodes: states.slice(0, 6).map((state, index) => ({
                      id: stateIds[index] ?? `state-${index + 1}`,
                      label: state.name,
                      detail: state.description,
                    })),
                    edges: states.slice(0, -1).map((state, index) => ({
                      from: stateIds[index] ?? `state-${index + 1}`,
                      to: stateIds[index + 1] ?? `state-${index + 2}`,
                      label: `Step ${index + 1}`,
                    })),
                  },
                },
              ] satisfies PlanBlock[])
            : []),
        ] satisfies PlanBlock[])
      : []),
    ...(input.components.length > 0 && duplicateVisualBlocks
      ? ([
          {
            id: createPlanBlockId("components"),
            type: "tabs",
            title: "Interaction Notes",
            data: {
              tabs: input.components.map((component, index) => ({
                id: componentIds[index] ?? `component-${index + 1}`,
                label: component.name,
                blocks: [
                  {
                    id: createPlanBlockId(`${component.name}-detail`),
                    type: "rich-text",
                    title: component.name,
                    editable: true,
                    data: { markdown: component.description },
                  },
                  {
                    id: createPlanBlockId(`${component.name}-sketch`),
                    type: "wireframe",
                    title: `${component.name} Sketch`,
                    data: createUiWireframeData({
                      title: component.name,
                      description: component.description,
                      viewport: "desktop",
                      component: true,
                    }),
                  },
                ],
              })),
            },
          },
        ] satisfies PlanBlock[])
      : []),
    ...(componentPlan
      ? ([
          {
            id: createPlanBlockId("implementation-plan"),
            type: "rich-text",
            title: "Implementation Plan",
            editable: true,
            data: {
              markdown: createImplementationPlanMarkdown(input),
            },
          },
          {
            id: createPlanBlockId("implementation-snippets"),
            type: "code-tabs",
            title: "Implementation Details",
            data: {
              tabs: [
                {
                  id: "component-shape",
                  label: "Component shape",
                  language: "tsx",
                  code: `// Keep the visual system in app-owned components.\n<ContextXRayPanel\n  segments={segments}\n  view={view}\n  onPin={pinSegment}\n  onEvict={evictSegment}\n/>\n`,
                  caption:
                    "Use concrete file paths and symbol names once the implementation agent inspects the target code.",
                },
                {
                  id: "verification-shape",
                  label: "Verification",
                  language: "ts",
                  code: `await expect(page.getByText("Context X-Ray")).toBeVisible();\nawait expect(page.getByText(/step/i)).toHaveCount(0);\nawait expect(contextPanel).toHaveScreenshot("context-xray-panel.png");\n`,
                  caption:
                    "Favor visual regression and DOM checks for alignment, overflow, and removed step chrome.",
                },
              ],
            },
          },
        ] satisfies PlanBlock[])
      : []),
    {
      id: createPlanBlockId("implementation-map"),
      type: "implementation-map",
      title: "Implementation Map",
      data: {
        files: [
          {
            path: input.repoPath ? `${input.repoPath}/...` : "repo/path.tsx",
            title: componentPlan
              ? "Files to inspect and update"
              : "Implementation notes",
            note:
              input.implementationNotes ||
              "Replace this with concrete file references, state ownership, actions, accessibility checks, and the smallest snippets needed before implementation.",
            language: "tsx",
            snippet: componentPlan
              ? `const planShape = {\n  canvas: "visual review surface",\n  document: "implementation plan, not duplicate mockups",\n};`
              : `const planShape = {\n  canvas: "when states or components exist",\n  document: "editable rich blocks",\n};`,
          },
        ],
      },
    },
    ...(componentPlan
      ? ([
          {
            id: createPlanBlockId("verification"),
            type: "checklist",
            title: "Verification",
            data: {
              items: [
                {
                  id: "canvas-review",
                  label:
                    "Review the canvas for product context, focused component states, annotations, and no redundant visual sections below.",
                },
                {
                  id: "alignment-review",
                  label:
                    "Check wireframe labels, placeholder strokes, arrows, and padding at the current viewport and a narrow sidebar width.",
                },
                {
                  id: "step-removal",
                  label:
                    "Run a chat turn and confirm no visible step UI appears above chat or after messages.",
                },
                {
                  id: "focused-tests",
                  label:
                    "Run focused type checks and UI tests for the touched chat/context files.",
                },
              ],
            },
          },
        ] satisfies PlanBlock[])
      : []),
  ];

  return sanitizePlanContent(
    planContentSchema.parse({
      version: PLAN_CONTENT_VERSION,
      title: input.title,
      brief: input.brief,
      ...(frames.length > 0
        ? {
            canvas: {
              title: componentPlan ? "Component States" : "UI Flow",
              frames,
              ...(flow.length > 0 ? { flow } : {}),
              ...(annotations.length > 0 ? { annotations } : {}),
            },
          }
        : {}),
      blocks,
    }),
  );
}

export function createPrototypePlanContent(
  input: PrototypePlanContentInput,
): PlanContent {
  const prototype =
    input.prototype ??
    createPrototypeFromScreens({
      title: input.title,
      brief: input.brief,
      screens: input.screens,
      transitions: input.transitions,
    });
  const wireframeBlocks = prototype.screens
    .slice(0, 6)
    .map<PlanBlock>((screen) => ({
      id: createPlanBlockId(`${screen.id}-static-mock`),
      type: "wireframe",
      title: `${screen.title ?? screen.id} Static Mock`,
      summary:
        screen.summary ??
        "Static reference for the live prototype screen above.",
      data: {
        surface: screen.surface ?? prototype.surface ?? "browser",
        renderMode: screen.renderMode,
        html: screen.html,
        css: screen.css,
        caption:
          screen.summary ?? "Static screen reference from the prototype.",
      },
    }));
  const blocks: PlanBlock[] = [
    {
      id: createPlanBlockId("prototype-plan-overview"),
      type: "rich-text",
      title: "Prototype Plan",
      editable: true,
      data: {
        markdown: [
          `## Question\n${input.brief}`,
          "## Prototype Review\nUse the functional prototype above like a small app: type into fields, press buttons, toggle rows, and try the core behavior. The static mocks below are reference frames for specific details, while implementation details and risks stay in the document.",
          "## Inspired By Prototype Discipline\nThis plan treats the prototype as a way to answer a concrete question: what should the interaction feel like before implementation hardens it.",
        ].join("\n\n"),
      },
    },
    ...(wireframeBlocks.length > 0
      ? ([
          {
            id: createPlanBlockId("prototype-static-mocks"),
            type: "tabs",
            title: "Static Mocks",
            data: {
              tabs: wireframeBlocks.map((block, index) => ({
                id: prototype.screens[index]?.id ?? `screen-${index + 1}`,
                label: prototype.screens[index]?.title ?? `Screen ${index + 1}`,
                blocks: [block],
              })),
            },
          },
        ] satisfies PlanBlock[])
      : []),
    {
      id: createPlanBlockId("prototype-flow"),
      type: "diagram",
      title: "Prototype Flow",
      data: {
        nodes: prototype.screens.map((screen) => ({
          id: screen.id,
          label: screen.title ?? screen.id,
          detail: screen.summary,
        })),
        edges: (prototype.transitions ?? []).map((transition) => ({
          from: transition.from,
          to: transition.to,
          label: transition.label ?? transition.trigger,
        })),
      },
    },
    {
      id: createPlanBlockId("implementation-map"),
      type: "implementation-map",
      title: "Implementation Map",
      data: {
        files: [
          {
            path: input.repoPath ? `${input.repoPath}/...` : "repo/path.tsx",
            title: "Files to inspect and update",
            note:
              input.implementationNotes ||
              "Replace this with concrete file references, actions, state ownership, route helpers, accessibility checks, and the smallest snippets needed after the prototype direction is approved.",
            language: "tsx",
            snippet:
              'const prototypeDecision = {\n  liveFlow: "reviewed in the prototype viewer",\n  implementation: "rewrite the chosen behavior in production components",\n};',
          },
        ],
      },
    },
    {
      id: createPlanBlockId("verification"),
      type: "checklist",
      title: "Verification",
      data: {
        items: [
          {
            id: "prototype-clicks",
            label:
              "Click every prototype transition and confirm the expected screen, state chips, and back/forward behavior.",
          },
          {
            id: "comments",
            label:
              "Place at least one comment on the prototype and confirm agent feedback includes an exact prototype target.",
          },
          {
            id: "implementation",
            label:
              "After approval, rewrite the chosen behavior in production code rather than copying throwaway prototype markup.",
          },
        ],
      },
    },
  ];

  return sanitizePlanContent(
    planContentSchema.parse({
      version: PLAN_CONTENT_VERSION,
      title: input.title,
      brief: input.brief,
      prototype,
      canvas: prototypeToCanvas(prototype),
      blocks,
    }),
  );
}

export function createPlanDesignContent(
  input: PlanDesignContentInput,
): PlanContent {
  const designScreens =
    input.screens.length > 0
      ? input.screens
      : [
          {
            title: "Design draft",
            summary: input.brief,
            surface: "browser" as const,
            html: `<main class="pd-shell" data-design-id="design-shell"><section class="pd-hero" data-design-id="hero-panel"><p class="pd-kicker">Design direction</p><h1>${escapeHtml(input.title)}</h1><p>${escapeHtml(input.brief)}</p><button class="pd-primary" data-design-id="primary-action">Review direction</button></section><aside class="pd-card" data-design-id="detail-card"><span>Brand signals</span><strong>Use design.md, .fig tokens, and codebase styles when available.</strong></aside></main>`,
            css: [
              ".pd-shell { min-height: 100%; display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 24px; padding: 32px; background: #f8fafc; color: #111827; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }",
              ".pd-hero { display: grid; align-content: center; gap: 14px; border: 1px solid rgba(17, 24, 39, 0.1); border-radius: 18px; padding: 36px; background: linear-gradient(135deg, #ffffff 0%, #ecfeff 100%); box-shadow: 0 18px 45px rgba(15, 23, 42, 0.08); }",
              ".pd-kicker { margin: 0; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #0f766e; }",
              ".pd-hero h1 { margin: 0; font-size: 34px; line-height: 1.08; max-width: 720px; }",
              ".pd-hero p { margin: 0; max-width: 680px; color: #475569; line-height: 1.6; }",
              ".pd-primary { justify-self: start; border: 0; border-radius: 12px; padding: 12px 16px; background: #0f766e; color: #ffffff; font-weight: 700; }",
              ".pd-card { display: grid; align-content: end; gap: 10px; border-radius: 16px; padding: 24px; background: #111827; color: #f8fafc; }",
              ".pd-card span { color: #99f6e4; font-size: 12px; font-weight: 700; text-transform: uppercase; }",
            ].join("\n"),
          },
        ];
  const prototype = createPrototypeFromScreens({
    title: input.title,
    brief: input.brief,
    screens: designScreens.map((screen) => ({
      ...screen,
      renderMode: "design",
    })),
    transitions: input.transitions,
  });
  const canvas = prototypeToCanvas(prototype);
  const sourceLines = [
    input.designMd
      ? "- `design.md` was provided and should drive tone, layout, and component details."
      : "",
    input.brandKit
      ? "- Brand kit / `.fig` style data was provided and should drive color, typography, spacing, radii, and imagery."
      : "",
    input.codebaseStyles
      ? "- Codebase style tokens were provided and should drive CSS variables, Tailwind classes, and existing visual conventions."
      : "",
    input.designNotes ? `- ${input.designNotes}` : "",
  ].filter(Boolean);
  const blocks: PlanBlock[] = [
    {
      id: createPlanBlockId("plan-design-overview"),
      type: "rich-text",
      title: "Design Plan",
      editable: true,
      data: {
        markdown: [
          `## Objective\n${input.brief}`,
          "## Design Review\nUse the Design tab as the full-fidelity source of truth. It should contain detailed, on-brand HTML/CSS screens on the Figma-style canvas, with editable `data-design-id` targets for focused style changes. Use the Prototype tab only when interaction, flow, or state needs to be felt before implementation.",
          sourceLines.length
            ? `## Style Sources\n${sourceLines.join("\n")}`
            : "## Style Sources\nNo external brand kit was provided; infer the smallest useful design system from the inspected codebase and document the assumptions here.",
        ].join("\n\n"),
      },
    },
    {
      id: createPlanBlockId("design-implementation-map"),
      type: "implementation-map",
      title: "Implementation Map",
      data: {
        files: [
          {
            path: input.repoPath ? `${input.repoPath}/...` : "repo/path.tsx",
            title: "Production files to update",
            note:
              input.implementationNotes ||
              "Replace with concrete components, routes, style files, token sources, actions, and tests after the design direction is approved.",
            language: "tsx",
            snippet:
              'const designDecision = {\n  designTab: "full-fidelity HTML/CSS review",\n  prototypeTab: "interactive behavior to rebuild in production components",\n};',
          },
        ],
      },
    },
    {
      id: createPlanBlockId("design-verification"),
      type: "checklist",
      title: "Verification",
      data: {
        items: [
          {
            id: "design-canvas",
            label:
              "Review the Design tab at desktop and narrow widths for real content, brand fidelity, readable type, and no clipped controls.",
          },
          {
            id: "prototype-behavior",
            label:
              "Click through the Prototype tab when present and verify the design styling matches the canvas.",
          },
          {
            id: "targeted-edits",
            label:
              "Select at least one `data-design-id` element in design mode and confirm targeted style patches preserve the rest of the screen.",
          },
          {
            id: "implementation",
            label:
              "After approval, rebuild the chosen direction in production components rather than copying temporary prototype markup.",
          },
        ],
      },
    },
  ];

  return sanitizePlanContent(
    planContentSchema.parse({
      version: PLAN_CONTENT_VERSION,
      title: input.title,
      brief: input.brief,
      prototype,
      canvas: canvas
        ? {
            ...canvas,
            mode: "design",
            title: "Design Direction",
            design: createDesignMetadata(input),
          }
        : undefined,
      blocks,
    }),
  );
}

export function createPrototypeFromPlanContent(
  content: PlanContent,
  input?: { title?: string; brief?: string },
): PlanPrototype | null {
  if (content.prototype) return content.prototype;
  if (!content.canvas?.frames.length) return null;
  const blocks = new Map<string, PlanBlock>();
  const visitBlock = (block: PlanBlock) => {
    blocks.set(block.id, block);
    if (block.type === "tabs") {
      for (const tab of block.data.tabs) {
        for (const child of tab.blocks) visitBlock(child);
      }
    }
  };
  for (const block of content.blocks) visitBlock(block);
  const screens: PlanPrototypeScreen[] = content.canvas.frames
    .map((frame, index) =>
      prototypeScreenFromArtboard(frame, blocks, index, content.canvas?.title),
    )
    .filter((screen): screen is PlanPrototypeScreen => Boolean(screen));
  if (screens.length === 0) return null;
  const transitions =
    content.canvas.flow
      ?.filter(
        (transition) =>
          screens.some((screen) => screen.id === transition.from) &&
          screens.some((screen) => screen.id === transition.to),
      )
      .map((transition) => ({
        from: transition.from,
        to: transition.to,
        label: transition.label,
        trigger: transition.label
          ? `Follow ${transition.label}`
          : "Advance to the next screen",
      })) ?? createLinearTransitions(screens);
  return sanitizePrototype({
    title: input?.title ?? content.canvas.title ?? content.title,
    brief: input?.brief ?? content.brief,
    surface: screens[0]?.surface ?? "browser",
    initialScreenId: screens[0]?.id,
    screens: addConvertedPrototypeRouteControls(screens, transitions),
    transitions,
  });
}

function createPrototypeFromScreens(input: {
  title: string;
  brief: string;
  screens: PrototypePlanContentInput["screens"];
  transitions?: PlanPrototype["transitions"];
}): PlanPrototype {
  const screens = input.screens.length
    ? input.screens
    : [
        {
          title: "Interactive draft",
          summary: input.brief || "Prototype the core interaction.",
          surface: "browser" as const,
        },
      ];
  const visibleScreens = screens.slice(0, 16);
  const screenIds = uniqueIds(
    visibleScreens.map(
      (screen, index) =>
        screen.id ?? (slug(screen.title) || `screen-${index + 1}`),
    ),
  );
  const remapScreenId = (id: string) => {
    const indexMatch = id.match(/^screen-(\d+)$/);
    if (indexMatch) {
      const index = Number(indexMatch[1]) - 1;
      return screenIds[index] ?? id;
    }
    const explicitIndex = visibleScreens.findIndex(
      (screen) => screen.id === id || slug(screen.title) === id,
    );
    return explicitIndex >= 0 ? (screenIds[explicitIndex] ?? id) : id;
  };
  const normalizedScreens = visibleScreens.map((screen, index) => {
    const id = screenIds[index] ?? `screen-${index + 1}`;
    const nextId = screenIds[index + 1] ?? "";
    return {
      id,
      title: screen.title,
      summary: screen.summary,
      surface: screen.surface ?? "browser",
      renderMode: screen.renderMode,
      html:
        screen.html ??
        createPrototypeScreenHtml({
          title: screen.title,
          summary: screen.summary ?? input.brief,
          nextId,
        }),
      css: screen.css,
      state: screen.state,
    } satisfies PlanPrototypeScreen;
  });
  return sanitizePrototype({
    title: input.title,
    brief: input.brief,
    surface: normalizedScreens[0]?.surface ?? "browser",
    initialScreenId: normalizedScreens[0]?.id,
    screens: normalizedScreens,
    transitions:
      input.transitions?.map((transition) => ({
        ...transition,
        from: remapScreenId(transition.from),
        to: remapScreenId(transition.to),
      })) ?? createLinearTransitions(normalizedScreens),
  });
}

function createPrototypeScreenHtml(input: {
  title: string;
  summary: string;
  nextId?: string;
}) {
  return [
    `<div x-data="{ draft: '', filter: 'all', todos: [{ text: 'Review the primary path', done: false }, { text: 'Check the edge state', done: true }] }" style="display:flex;flex-direction:column;gap:14px;padding:18px;height:100%">`,
    `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px">`,
    `<div><h1>${escapeHtml(input.title)}</h1><p class="wf-muted">${escapeHtml(input.summary)}</p></div>`,
    input.nextId
      ? `<button class="primary" data-goto="${escapeHtml(input.nextId)}">Open next screen</button>`
      : `<span class="wf-pill accent">Functional prototype</span>`,
    `</div>`,
    `<div class="wf-card" style="display:flex;flex-direction:column;gap:10px;flex:1">`,
    `<div style="display:flex;gap:8px;align-items:center">`,
    `<input x-model="draft" @keydown.enter="draft && todos.push({ text: draft, done: false }); draft = ''" placeholder="Add a prototype task">`,
    `<button class="primary" @click="draft && todos.push({ text: draft, done: false }); draft = ''">Add</button>`,
    `</div>`,
    `<div style="display:flex;gap:8px;flex-wrap:wrap">`,
    `<button @click="filter = 'all'" :class="{ 'primary': filter === 'all' }">All</button>`,
    `<button @click="filter = 'active'" :class="{ 'primary': filter === 'active' }">Active</button>`,
    `<button @click="filter = 'done'" :class="{ 'primary': filter === 'done' }">Done</button>`,
    `</div>`,
    `<div style="display:flex;flex-direction:column;gap:8px">`,
    `<div class="wf-box" x-for="todo in todos" x-show="filter === 'all' || (filter === 'active' && !todo.done) || (filter === 'done' && todo.done)" :class="{ 'is-done': todo.done }" :data-done="todo.done" style="display:flex;align-items:center;justify-content:space-between;gap:10px">`,
    `<label style="display:flex;align-items:center;gap:8px;min-width:0"><input type="checkbox" x-model="todo.done"><span x-text="todo.text"></span></label>`,
    `<button @click="remove(todos, todo)">Remove</button>`,
    `</div>`,
    `</div>`,
    `</div>`,
    `</div>`,
  ].join("");
}

function prototypeScreenFromArtboard(
  frame: PlanArtboard,
  blocks: Map<string, PlanBlock>,
  index: number,
  canvasTitle?: string,
): PlanPrototypeScreen | null {
  const block = frame.blockId ? blocks.get(frame.blockId) : undefined;
  const wireframe =
    frame.wireframe ?? (block?.type === "wireframe" ? block.data : undefined);
  if (!wireframe?.html) return null;
  return {
    id: frame.id,
    title: frame.label ?? block?.title ?? `Screen ${index + 1}`,
    summary:
      wireframe.caption ??
      block?.summary ??
      (canvasTitle ? `From ${canvasTitle}` : undefined),
    surface: frame.surface ?? wireframe.surface,
    renderMode: wireframe.renderMode,
    html: wireframe.html,
    css: wireframe.css,
  };
}

function addConvertedPrototypeRouteControls(
  screens: PlanPrototypeScreen[],
  transitions: PlanPrototype["transitions"] = [],
): PlanPrototypeScreen[] {
  const outgoing = new Map<string, PlanPrototype["transitions"]>();
  for (const transition of transitions) {
    outgoing.set(transition.from, [
      ...(outgoing.get(transition.from) ?? []),
      transition,
    ]);
  }
  return screens.map((screen) => {
    const routes = (outgoing.get(screen.id) ?? []).filter(
      (transition) => !screen.html.includes(`data-goto="${transition.to}"`),
    );
    if (routes.length === 0) return screen;
    const routeControls = [
      `<div class="wf-box" style="position:absolute;right:14px;bottom:14px;display:flex;gap:8px;align-items:center;background:var(--wf-card);padding:8px">`,
      ...routes
        .slice(0, 3)
        .map(
          (transition) =>
            `<button data-goto="${escapeHtml(transition.to)}">${escapeHtml(transition.label || "Open")}</button>`,
        ),
      `</div>`,
    ].join("");
    return { ...screen, html: `${screen.html}${routeControls}` };
  });
}

function createLinearTransitions(
  screens: PlanPrototypeScreen[],
): PlanPrototype["transitions"] {
  return screens.slice(0, -1).map((screen, index) => ({
    from: screen.id,
    to: screens[index + 1]?.id ?? screen.id,
    label: `Step ${index + 1}`,
    trigger: "Continue",
  }));
}

function prototypeToCanvas(prototype: PlanPrototype): PlanContent["canvas"] {
  const frames = prototype.screens.slice(0, 8).map<PlanArtboard>((screen) => ({
    id: `frame-${screen.id}`,
    label: screen.title ?? screen.id,
    surface: screen.surface ?? prototype.surface ?? "browser",
    wireframe: {
      surface: screen.surface ?? prototype.surface ?? "browser",
      renderMode: screen.renderMode,
      html: screen.html,
      css: screen.css,
      caption: screen.summary,
    },
  }));
  if (frames.length === 0) return undefined;
  const annotations: PlanAnnotation[] = frames[0]
    ? [
        {
          id: "prototype-static-note",
          type: "note",
          targetId: frames[0].id,
          placement: "bottom",
          title: "Static reference",
          text: "The live functional prototype is above the document; these frames preserve static mocks for review and source export.",
        },
      ]
    : [];
  return {
    title: `${prototype.title ?? "Prototype"} Static Mocks`,
    frames,
    flow: (prototype.transitions ?? [])
      .map((transition) => ({
        from: `frame-${transition.from}`,
        to: `frame-${transition.to}`,
        label: transition.label,
      }))
      .filter(
        (transition) =>
          frames.some((frame) => frame.id === transition.from) &&
          frames.some((frame) => frame.id === transition.to),
      ),
    annotations,
  };
}

function createComponentPlanOverview(input: UiPlanContentInput) {
  const states = input.states
    .slice(0, 6)
    .map((state) => state.name)
    .join(", ");
  const components = input.components
    .slice(0, 6)
    .map((component) => component.name)
    .join(", ");

  return [
    `## Objective\n${input.brief}`,
    states
      ? `## Canvas Review\nUse the top board as the visual source of truth. It covers ${states}, with product context first and focused component variants next. Keep annotations near the artboards and only add arrows for specific controls or transitions.`
      : "",
    components
      ? `## Component Scope\nGround implementation in the actual ${components} surfaces and nearby chat/sidebar chrome. The document below should name concrete files, contracts, risks, and verification rather than repeating the same mockups.`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function createImplementationPlanMarkdown(input: UiPlanContentInput) {
  const implementationNotes = input.implementationNotes?.trim();
  return [
    "## Current vs Proposed",
    "Describe the current UI behavior, then the proposed component behavior. Keep visual specifics on the canvas; keep implementation specifics here.",
    "## Files And Contracts",
    implementationNotes ||
      "List the exact components, hooks, actions, state keys, tests, and stylesheets the implementation agent should inspect or update.",
    "## Implementation Phases",
    "1. Inspect the existing component, surrounding app chrome, and chat step rendering paths.\n2. Update the smallest app-owned components or tokens that control the visual system.\n3. Remove redundant or stale UI surfaces rather than hiding them with extra chrome.\n4. Add focused tests or screenshots for layout, overflow, and removed step UI.",
    "## Risks",
    "- Wireframe-only feedback can drift from real components if the plan omits file and symbol names.\n- Placeholder text, arrows, and diagrams should be cut when they do not answer a concrete review question.\n- Custom HTML fragments should stay bounded inside document blocks, not replace the app-owned canvas and document shell.",
  ].join("\n\n");
}

function createCanvasAnnotations(input: {
  componentPlan: boolean;
  includeComponentContext: boolean;
  contextFrame?: PlanArtboard;
  stateFrames: PlanArtboard[];
}): NonNullable<NonNullable<PlanContent["canvas"]>["annotations"]> {
  if (input.componentPlan) {
    const annotations: NonNullable<
      NonNullable<PlanContent["canvas"]>["annotations"]
    > = [];
    if (input.includeComponentContext && input.contextFrame) {
      annotations.push({
        id: "canvas-note-app-context",
        type: "note",
        targetId: input.contextFrame.id,
        placement: "bottom",
        title: "Start in the product.",
        text: "Show the host chat and agent sidebar first so scale, anchor, and surrounding chrome are reviewable before zooming into the widget.",
      });
    }
    if (input.stateFrames[0]) {
      annotations.push({
        id: "canvas-note-focused-states",
        type: "note",
        targetId: input.stateFrames[0].id,
        placement: "bottom",
        title: "Then focus the component.",
        text: "Compare compact widget variants. Do not turn component work into a fake desktop/mobile journey unless responsive behavior is the issue.",
      });
    }
    const chatCleanupFrame = input.stateFrames.find((frame) =>
      /\b(chat|cleanup|step)\b/i.test(frame.label ?? ""),
    );
    if (chatCleanupFrame) {
      annotations.push({
        id: "canvas-note-chat-cleanup",
        type: "note",
        targetId: chatCleanupFrame.id,
        placement: "bottom",
        title: "Remove step chrome.",
        text: "The chat frame should show ordinary messages, thinking status, and composer without step rows above chat or after each turn.",
      });
    }
    return annotations;
  }

  if (!input.stateFrames[0]) return [];
  return [
    {
      id: "canvas-note-review",
      type: "note",
      targetId: input.stateFrames[0].id,
      placement: "bottom",
      title: "Read this like a design handoff.",
      text: "Use the canvas to critique layout and state changes first; use the document below for files, contracts, risks, and validation.",
    },
  ];
}

function createUiWireframeData(input: {
  title: string;
  description?: string;
  viewport?: NonNullable<LegacyWireframeData["viewport"]>;
  component?: boolean;
}): PlanWireframeBlock["data"] {
  if (input.component) {
    const template = inferComponentWireframeTemplate(input);
    if (template === "context-xray-expanded") {
      return createContextXRayExpandedKitWireframe(input);
    }
    if (template === "context-xray-map") {
      return createContextXRayMapKitWireframe(input);
    }
    if (template === "context-xray-chat-cleanup") {
      return createChatCleanupKitWireframe(input);
    }
    if (template === "context-xray-default") {
      return createContextXRayDefaultKitWireframe(input);
    }
    return createGenericComponentKitWireframe(input);
  }

  if (input.viewport === "phone") {
    return createMobileUiKitWireframe(input);
  }
  return createDesktopUiKitWireframe(input);
}

function createComponentContextKitWireframe(input: {
  title: string;
  brief: string;
}): PlanWireframeBlock["data"] {
  return createKitWireframe(
    "browser",
    [
      { el: "browserBar", title: "agent" },
      {
        el: "row",
        full: true,
        children: [
          {
            el: "main",
            children: [
              { el: "title", text: "Chat thread", script: true },
              {
                el: "card",
                children: [
                  {
                    el: "text",
                    value: "User asks for Context X-Ray cleanup",
                    weight: "medium",
                  },
                  { el: "lines", n: 2, widths: [72, 48] },
                ],
              },
              {
                el: "box",
                children: [{ el: "text", value: "Thinking status" }],
              },
              { el: "field", value: "Ask the agent..." },
            ],
          },
          {
            el: "sidebar",
            children: [
              {
                el: "col",
                full: true,
                children: [
                  { el: "title", text: "Agent sidebar", script: true },
                  {
                    el: "box",
                    children: [
                      {
                        el: "text",
                        value: "Context X-Ray popover",
                        weight: "bold",
                      },
                      {
                        el: "box",
                        children: [{ el: "text", value: "2.0k used" }],
                      },
                      {
                        el: "chips",
                        items: [
                          { label: "List", active: true },
                          { label: "Map" },
                        ],
                      },
                      {
                        el: "card",
                        children: [
                          {
                            el: "text",
                            value: "Conversation",
                            weight: "medium",
                          },
                          { el: "text", value: "Protected context rows" },
                        ],
                      },
                    ],
                  },
                ],
              },
              { el: "divider" },
              { el: "btn", label: "X-Ray", solid: true },
            ],
          },
        ],
      },
    ],
    `Show ${input.title} in the surrounding app before focused component states.`,
  );
}

function createContextXRayDefaultKitWireframe(input: {
  title: string;
  description?: string;
}): PlanWireframeBlock["data"] {
  return createKitWireframe(
    "popover",
    [
      { el: "title", text: "Context X-Ray", script: true },
      {
        el: "box",
        children: [
          { el: "text", value: "2.0k used", weight: "bold" },
          { el: "text", value: "1% used - 198k free", color: "muted" },
        ],
      },
      {
        el: "chips",
        items: [{ label: "List", active: true }, { label: "Map" }],
      },
      {
        el: "card",
        children: [
          { el: "text", value: "Conversation", weight: "bold" },
          { el: "text", value: "Protected row", color: "muted" },
          { el: "btn", label: "Pin", solid: false },
        ],
      },
    ],
    input.description,
  );
}

function createContextXRayExpandedKitWireframe(input: {
  title: string;
  description?: string;
}): PlanWireframeBlock["data"] {
  return createKitWireframe(
    "popover",
    [
      {
        el: "row",
        children: [
          { el: "pill", label: "Conversation", tone: "accent" },
          { el: "pill", label: "2.0k protected" },
        ],
      },
      {
        el: "card",
        children: [
          { el: "text", value: "User message", weight: "bold" },
          { el: "text", value: "Original request and current screen snapshot" },
        ],
      },
      {
        el: "card",
        children: [
          { el: "text", value: "Tool result", weight: "bold" },
          { el: "text", value: "Relevant output kept for the next turn" },
        ],
      },
      { el: "btn", label: "Pin / evict", solid: true },
    ],
    input.description,
  );
}

function createContextXRayMapKitWireframe(input: {
  title: string;
  description?: string;
}): PlanWireframeBlock["data"] {
  return createKitWireframe(
    "popover",
    [
      { el: "title", text: "Context map", script: true },
      {
        el: "box",
        children: [
          { el: "text", value: "Token map", weight: "bold" },
          {
            el: "kv",
            rows: [
              { k: "Conversation", v: "2.0k" },
              { k: "Pinned", v: "0" },
              { k: "Evicted", v: "0" },
            ],
          },
        ],
      },
      {
        el: "row",
        children: [
          { el: "pill", label: "Legend" },
          { el: "pill", label: "Selected 2.0k", tone: "accent" },
        ],
      },
    ],
    input.description,
  );
}

function createChatCleanupKitWireframe(input: {
  title: string;
  description?: string;
}): PlanWireframeBlock["data"] {
  return createKitWireframe(
    "panel",
    [
      { el: "title", text: "Chat without step chrome", script: true },
      {
        el: "card",
        children: [
          { el: "text", value: "Chat messages", weight: "bold" },
          { el: "text", value: "User turn" },
          { el: "text", value: "Assistant response" },
        ],
      },
      {
        el: "box",
        children: [{ el: "text", value: "Thinking status only" }],
      },
      { el: "field", value: "Message the agent..." },
    ],
    input.description,
  );
}

function createGenericComponentKitWireframe(input: {
  title: string;
  description?: string;
}): PlanWireframeBlock["data"] {
  const title = compactLabel(input.title, 24) || "Component";
  return createKitWireframe(
    "panel",
    [
      { el: "title", text: title, script: true },
      {
        el: "box",
        children: [
          { el: "text", value: compactLabel(input.description ?? title, 80) },
          {
            el: "chips",
            items: [{ label: "Default", active: true }, { label: "Focused" }],
          },
        ],
      },
      {
        el: "card",
        children: [
          { el: "text", value: "Primary content", weight: "bold" },
          { el: "text", value: "Real labels and controls stay visible" },
          { el: "btn", label: "Primary", solid: true },
        ],
      },
    ],
    input.description,
  );
}

function createDesktopUiKitWireframe(input: {
  title: string;
  description?: string;
}): PlanWireframeBlock["data"] {
  const title = compactLabel(input.title, 28) || "Overview";
  return createKitWireframe(
    "desktop",
    [
      { el: "browserBar", title: slug(title) || "app" },
      {
        el: "row",
        full: true,
        children: [
          {
            el: "sidebar",
            children: [
              {
                el: "col",
                full: true,
                children: [
                  { el: "title", text: "Workspace", script: true },
                  { el: "searchBar", placeholder: "Search" },
                  { el: "navItem", label: "Overview", active: true, count: 4 },
                  { el: "navItem", label: "Today", count: 2 },
                  { el: "navItem", label: "Done" },
                  { el: "divider" },
                  { el: "section", label: "PROJECTS" },
                  { el: "navItem", label: "Project", dot: true },
                  { el: "navItem", label: "Review", dot: true },
                  { el: "navItem", label: "Handoff", dot: true },
                ],
              },
              {
                el: "box",
                children: [
                  { el: "text", value: "Ready for review", weight: "bold" },
                  { el: "text", value: "Canvas plus implementation notes" },
                  { el: "btn", label: "Open plan", solid: true, full: true },
                ],
              },
            ],
          },
          {
            el: "main",
            children: [
              { el: "title", text: title, script: true },
              {
                el: "text",
                value: compactLabel(input.description ?? title, 86),
              },
              {
                el: "chips",
                items: [
                  { label: "All", active: true },
                  { label: "Active" },
                  { label: "Done" },
                ],
              },
              { el: "section", label: "TODAY" },
              {
                el: "taskRow",
                title: compactLabel(input.description ?? "Review state", 42),
                due: "Soon",
                dueTone: "warn",
                prio: 1,
              },
              {
                el: "taskRow",
                title: "Update implementation notes",
                due: "Later",
                prio: 2,
              },
              { el: "divider" },
              { el: "section", label: "NEXT" },
              { el: "taskRow", title: "Verify empty and error states" },
            ],
          },
        ],
      },
    ],
    input.description,
  );
}

function createMobileUiKitWireframe(input: {
  title: string;
  description?: string;
}): PlanWireframeBlock["data"] {
  const title = compactLabel(input.title, 22) || "Today";
  return createKitWireframe(
    "mobile",
    [
      { el: "statusBar" },
      { el: "title", text: title, script: true },
      { el: "text", value: compactLabel(input.description ?? title, 64) },
      {
        el: "chips",
        items: [
          { label: "All", active: true },
          { label: "Active" },
          { label: "Done" },
        ],
      },
      { el: "section", label: "TODAY" },
      {
        el: "taskRow",
        title: compactLabel(input.description ?? "Review item", 34),
        due: "2 PM",
        prio: 1,
      },
      { el: "taskRow", title: "Reply to feedback", prio: 2 },
      { el: "taskRow", title: "Check narrow layout", done: true },
      { el: "fab", icon: "+" },
    ],
    input.description,
  );
}

function createKitWireframe(
  surface: PlanWireframeSurface,
  children: PlanWireframeNode[],
  caption?: string,
): PlanWireframeBlock["data"] {
  return {
    surface,
    ...(caption ? { caption } : {}),
    screen: [{ el: "screen", children }],
  };
}

function createCanvasNotes(input: {
  componentPlan: boolean;
  includeComponentContext: boolean;
  contextFrame?: PlanArtboard;
  stateFrames: PlanArtboard[];
}): NonNullable<NonNullable<PlanContent["canvas"]>["notes"]> {
  // Back-compat helper retained for old callers; new `/ui-plan` generation uses
  // canvas.annotations so notes can attach to frames and avoid overlap.
  if (input.componentPlan) {
    if (!input.includeComponentContext || !input.contextFrame) return [];
    return [
      {
        id: "canvas-note-app-context",
        title: "Start in the product.",
        body: "Show the host chat and agent sidebar first so the popover scale, anchor, and surrounding chrome are reviewable.",
        x: input.contextFrame.x ?? 80,
        y:
          (input.contextFrame.y ?? 96) +
          (input.contextFrame.height ?? 420) +
          52,
      },
      ...(input.stateFrames[0]
        ? [
            {
              id: "canvas-note-focused-states",
              title: "Then focus the component.",
              body: "Compare compact popover states as widget variants, not as a fake desktop/mobile journey.",
              x: input.stateFrames[0].x ?? 80,
              y:
                (input.stateFrames[0].y ?? 96) +
                (input.stateFrames[0].height ?? 360) +
                52,
            },
          ]
        : []),
      ...(input.stateFrames[3]
        ? [
            {
              id: "canvas-note-chat-cleanup",
              title: "Remove step chrome.",
              body: "The chat frame should show ordinary messages, thinking status, and composer without step rows above or after turns.",
              x: input.stateFrames[3].x ?? input.stateFrames[0]?.x ?? 80,
              y:
                (input.stateFrames[3].y ?? 600) +
                (input.stateFrames[3].height ?? 340) +
                46,
            },
          ]
        : []),
    ];
  }

  if (!input.stateFrames[0]) return [];
  return [
    {
      id: "canvas-note-review",
      title: "Read this like a design handoff.",
      body: "Pan and zoom to compare states, then scroll for the document spec.",
      x: input.stateFrames[0].x ?? 80,
      y:
        (input.stateFrames[0].y ?? 80) +
        (input.stateFrames[0].height ?? 420) +
        60,
    },
  ];
}

function isComponentPlan(input: {
  title: string;
  brief: string;
  states: Array<{ name: string; description: string }>;
  components: Array<{ name: string; description: string }>;
}) {
  const text = [
    input.title,
    input.brief,
    ...input.states.flatMap((state) => [state.name, state.description]),
    ...input.components.flatMap((component) => [
      component.name,
      component.description,
    ]),
  ]
    .join(" ")
    .toLowerCase();
  return /\b(component|widget|popover|sidebar|side\s*panel|panel|dialog|modal|dropdown|toolbar|inspector|menu|card)\b/.test(
    text,
  );
}

function shouldShowComponentContext(input: {
  title: string;
  brief: string;
  states: Array<{ name: string; description: string }>;
  components: Array<{ name: string; description: string }>;
}) {
  const text = [
    input.title,
    input.brief,
    ...input.states.flatMap((state) => [state.name, state.description]),
    ...input.components.flatMap((component) => [
      component.name,
      component.description,
    ]),
  ]
    .join(" ")
    .toLowerCase();
  return /\b(popover|sidebar|side\s*panel|agent sidebar|chat|composer|inspector|floating|anchored|context)\b/.test(
    text,
  );
}

function shouldUseStateFlow(
  input: {
    title: string;
    brief: string;
    states: Array<{ name: string; description: string }>;
  },
  componentPlan: boolean,
) {
  if (componentPlan || input.states.length < 2) return false;
  const text = [
    input.title,
    input.brief,
    ...input.states.map((state) => state.name),
  ]
    .join(" ")
    .toLowerCase();
  return /\b(flow|journey|sequence|wizard|checkout|onboard|handoff|step|next|submit|confirm|complete|path)\b/.test(
    text,
  );
}

function viewportForState(
  state: { name: string; description: string },
  componentPlan: boolean,
  options?: { index?: number; stateFlow?: boolean },
): "desktop" | "tablet" | "phone" {
  if (componentPlan) return "desktop";
  const name = state.name.toLowerCase();
  const description = state.description.toLowerCase();
  if (/\b(desktop|overview|home|dashboard|workspace|board)\b/.test(name)) {
    return "desktop";
  }
  if (/\b(phone|mobile|narrow)\b/.test(name)) return "phone";
  if (/\b(tablet)\b/.test(name)) return "tablet";
  if (/\b(tablet-only|tablet first|tablet-first)\b/.test(description)) {
    return "tablet";
  }
  if (
    /\b(phone-only|mobile-only|mobile first|mobile-first|narrow screen|single-column mobile)\b/.test(
      description,
    )
  ) {
    return "phone";
  }
  if (options?.stateFlow && (options.index ?? 0) > 0) return "phone";
  return "desktop";
}

function uniqueIds(values: string[]): string[] {
  const counts = new Map<string, number>();
  return values.map((value) => {
    const count = counts.get(value) ?? 0;
    counts.set(value, count + 1);
    return count === 0 ? value : `${value}-${count + 1}`;
  });
}

export type VisualQuestionBuilderInput = {
  id: string;
  type: "single" | "multi" | "freeform" | "visual";
  title: string;
  subtitle?: string;
  options?: Array<{
    value?: string;
    label: string;
    description?: string;
    recommended?: boolean;
    preview?: "desktop" | "mobile" | "split" | "flow" | "diagram";
    bullets?: string[];
  }>;
  allowOther?: boolean;
  placeholder?: string;
  required?: boolean;
};

type VisualQuestionPreview = NonNullable<
  VisualQuestionBuilderInput["options"]
>[number]["preview"];

export function createVisualQuestionsContent(input: {
  title: string;
  brief: string;
  questions: VisualQuestionBuilderInput[];
}): PlanContent {
  const questions = input.questions.length
    ? input.questions
    : defaultVisualQuestions(input.brief);
  const visualQuestions: PlanVisualQuestion[] = questions.map((question) => ({
    id: question.id,
    title: question.title,
    subtitle: question.subtitle,
    mode:
      question.type === "multi"
        ? "multi"
        : question.type === "freeform"
          ? "freeform"
          : "single",
    allowOther: question.allowOther,
    placeholder: question.placeholder,
    required: question.required,
    options: question.options?.map((option, index) => ({
      id: option.value || slug(option.label) || `option-${index + 1}`,
      label: option.label,
      detail: [
        option.description,
        ...(option.bullets?.map((bullet) => `- ${bullet}`) ?? []),
      ]
        .filter(Boolean)
        .join("\n"),
      recommended: option.recommended,
      wireframe: previewToWireframe(option.preview, option.label),
      diagram: previewToDiagram(option.preview, option.label),
    })),
  }));

  return sanitizePlanContent(
    planContentSchema.parse({
      version: PLAN_CONTENT_VERSION,
      title: input.title,
      brief: input.brief,
      blocks: [
        {
          id: createPlanBlockId("visual-intake"),
          type: "visual-questions",
          title: input.title,
          data: {
            questions: visualQuestions,
            submitLabel: "Send to agent",
          },
        },
      ],
    }),
  );
}

export function buildPlanContentHtml(input: {
  content: PlanContent;
  title: string;
  brief: string;
  source?: string | null;
  status?: string | null;
  repoPath?: string | null;
}) {
  const planLabel = input.content.prototype
    ? "Prototype Plan"
    : input.content.canvas?.title === "UI Flow"
      ? "UI Plan"
      : "Visual Plan";
  const prototype = input.content.prototype
    ? renderPrototypeHtml(input.content.prototype)
    : "";
  const canvas = input.content.canvas
    ? renderCanvasHtml(input.content.canvas)
    : "";
  const blocks = input.content.blocks.map(renderBlockHtml).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(input.title)}</title>
  <style>${CONTENT_EXPORT_CSS}</style>
</head>
<body>
  ${prototype}
  ${canvas}
  <main>
    <section class="hero">
      <p class="kicker">${escapeHtml(planLabel)}</p>
      <h1>${escapeHtml(input.content.title || input.title)}</h1>
      <p class="lede">${escapeHtml(input.content.brief || input.brief)}</p>
    </section>
    ${blocks}
  </main>
</body>
</html>`;
}

function blockFromSection(section: SectionLike, index: number): PlanBlock {
  if (section.html?.trim()) {
    return {
      id: section.id || createPlanBlockId(section.title),
      type: "custom-html",
      title: section.title,
      data: {
        html: section.html,
        caption: section.body,
      },
    };
  }
  if (section.type === "implementation") {
    return {
      id: section.id || createPlanBlockId(section.title),
      type: "implementation-map",
      title: section.title,
      data: {
        files: [
          {
            path: "repo/path.tsx",
            title: "Implementation detail",
            note: section.body || "Add concrete file and symbol notes here.",
            language: "tsx",
          },
        ],
      },
    };
  }
  if (section.type === "wireframe" || section.type === "mockup") {
    return {
      id: section.id || createPlanBlockId(section.title),
      type: "wireframe",
      title: section.title,
      summary: section.body,
      data: createUiWireframeData({
        title: section.title,
        description: section.body,
        viewport: index === 0 ? "desktop" : "phone",
      }),
    };
  }
  if (section.type === "diagram") {
    return {
      id: section.id || createPlanBlockId(section.title),
      type: "diagram",
      title: section.title,
      data: createBasicDiagram(section.title, section.body),
    };
  }
  if (section.type === "questions") {
    const questions = markdownLines(section.body);
    return {
      id: section.id || createPlanBlockId(section.title),
      type: "question-form",
      title: section.title,
      data: {
        submitLabel: "Send to agent",
        questions: (questions.length ? questions : [section.title]).map(
          (question, questionIndex) => ({
            id: `question-${questionIndex + 1}`,
            title: question,
            mode: "freeform" as const,
            placeholder: "Answer to revise the plan...",
          }),
        ),
      },
    };
  }
  if (section.type === "decisions") {
    // Legacy "decisions" section → a decision-tone `callout` (the `decision`
    // block was retired). The section title is the question; each body line is an
    // option.
    const optionLines = markdownLines(section.body).map((line) => `- ${line}`);
    const body =
      [`**${section.title}**`, optionLines.join("\n")]
        .filter(Boolean)
        .join("\n\n") ||
      section.title ||
      "Decision";
    return {
      id: section.id || createPlanBlockId(section.title),
      type: "callout",
      data: { tone: "decision", body },
    };
  }
  return {
    id: section.id || createPlanBlockId(section.title),
    type: "rich-text",
    title: section.title,
    editable: true,
    data: {
      markdown: section.body,
    },
  };
}

function findCanvas(blocks: PlanBlock[]): PlanContent["canvas"] | undefined {
  const frames = blocks
    .filter((block): block is PlanWireframeBlock | PlanLegacyWireframeBlock => {
      return block.type === "wireframe" || block.type === "legacy-wireframe";
    })
    .slice(0, 6)
    .map<PlanArtboard>((block, index) => ({
      id: `frame-${block.id}`,
      label: block.title || `Frame ${index + 1}`,
      blockId: block.id,
      ...(block.type === "wireframe"
        ? { surface: block.data.surface, wireframe: block.data }
        : { legacyWireframe: block.data }),
    }));
  if (frames.length === 0) return undefined;
  return {
    title: "Wireframes",
    frames,
    flow: frames.slice(0, -1).map((frame, index) => ({
      from: frame.id,
      to: frames[index + 1]?.id ?? frame.id,
      label: `Step ${index + 1}`,
    })),
  };
}

function createComponentContextWireframe(input: {
  title: string;
  brief: string;
}): LegacyWireframeData {
  return {
    viewport: "desktop",
    template: "context-xray-app",
    caption: `Show ${input.title} in the surrounding app before reviewing focused component states.`,
    regions: [],
  };
}

function createWireframeData(input: {
  title: string;
  description?: string;
  viewport?: "desktop" | "tablet" | "phone";
  component?: boolean;
}): LegacyWireframeData {
  const viewport = input.viewport ?? "desktop";
  const title = compactLabel(input.title, 24);
  const description = compactLabel(input.description ?? "", 78);
  if (input.component) {
    const template = inferComponentWireframeTemplate(input);
    return {
      viewport,
      ...(template ? { template } : {}),
      caption: input.description,
      regions: template ? [] : createComponentWireframeRegions(input),
    };
  }
  if (viewport === "phone") {
    return {
      viewport,
      caption: input.description,
      regions: [
        {
          id: "phone-back",
          kind: "button",
          label: "Back",
          x: 9,
          y: 7,
          width: 18,
          height: 7,
          emphasis: true,
        },
        {
          id: "phone-title",
          kind: "header",
          label: title,
          x: 32,
          y: 7,
          width: 34,
          height: 7,
        },
        {
          id: "phone-menu",
          kind: "toolbar",
          label: "...",
          x: 76,
          y: 7,
          width: 12,
          height: 7,
        },
        {
          id: "phone-filter-all",
          kind: "button",
          label: "All",
          x: 9,
          y: 20,
          width: 17,
          height: 8,
        },
        {
          id: "phone-filter-active",
          kind: "button",
          label: "Active",
          x: 29,
          y: 20,
          width: 24,
          height: 8,
        },
        {
          id: "phone-filter-done",
          kind: "button",
          label: "Done",
          x: 56,
          y: 20,
          width: 21,
          height: 8,
        },
        {
          id: "phone-row-1",
          kind: "list",
          x: 9,
          y: 35,
          width: 80,
          height: 10,
        },
        {
          id: "phone-row-2",
          kind: "list",
          x: 9,
          y: 49,
          width: 80,
          height: 10,
        },
        {
          id: "phone-row-3",
          kind: "list",
          x: 9,
          y: 63,
          width: 80,
          height: 10,
        },
        {
          id: "action",
          kind: "button",
          label: "+",
          x: 70,
          y: 82,
          width: 16,
          height: 9,
          emphasis: true,
        },
      ],
    };
  }
  return {
    viewport,
    caption: input.description,
    regions: [
      {
        id: "chrome",
        kind: "header",
        label: title,
        x: 3,
        y: 4,
        width: 94,
        height: 8,
      },
      {
        id: "nav",
        kind: "nav",
        label: "Workspace",
        x: 3,
        y: 12,
        width: 22,
        height: 78,
      },
      {
        id: "nav-active",
        kind: "button",
        x: 6,
        y: 25,
        width: 16,
        height: 7,
        emphasis: true,
      },
      { id: "nav-item-1", kind: "toolbar", x: 6, y: 37, width: 16, height: 6 },
      { id: "nav-item-2", kind: "toolbar", x: 6, y: 48, width: 16, height: 6 },
      { id: "nav-item-3", kind: "toolbar", x: 6, y: 59, width: 16, height: 6 },
      {
        id: "title",
        kind: "header",
        label: title,
        x: 30,
        y: 18,
        width: 36,
        height: 8,
      },
      {
        id: "summary",
        kind: "content",
        label: description,
        x: 30,
        y: 29,
        width: 50,
        height: 11,
      },
      {
        id: "filter-all",
        kind: "button",
        label: "All",
        x: 30,
        y: 45,
        width: 9,
        height: 7,
      },
      {
        id: "filter-active",
        kind: "button",
        label: "Active",
        x: 42,
        y: 45,
        width: 14,
        height: 7,
      },
      {
        id: "filter-done",
        kind: "button",
        label: "Done",
        x: 59,
        y: 45,
        width: 13,
        height: 7,
      },
      { id: "row-1", kind: "list", x: 30, y: 58, width: 62, height: 10 },
      { id: "row-2", kind: "list", x: 30, y: 71, width: 62, height: 10 },
      { id: "row-3", kind: "list", x: 30, y: 84, width: 62, height: 8 },
      {
        id: "primary",
        kind: "button",
        label: "Primary",
        x: 82,
        y: 20,
        width: 12,
        height: 8,
        emphasis: true,
      },
    ],
  };
}

function compactLabel(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function inferComponentWireframeTemplate(input: {
  title: string;
  description?: string;
}): LegacyWireframeData["template"] | undefined {
  const text = `${input.title} ${input.description ?? ""}`.toLowerCase();
  if (/\b(map view|treemap|token map|token distribution)\b/.test(text)) {
    return "context-xray-map";
  }
  if (
    /\b(expanded|segment detail|detail|pin\s*\/\s*evict|evict|tool result|user message)\b/.test(
      text,
    )
  ) {
    return "context-xray-expanded";
  }
  if (
    /\b(chat cleanup|chat messages|composer|thinking|step chrome)\b/.test(text)
  ) {
    return "context-xray-chat-cleanup";
  }
  if (
    /\b(context\s*x-?ray|x-?ray|popover|usage|meter|list\/?map|conversation group)\b/.test(
      text,
    )
  ) {
    return "context-xray-default";
  }
  return undefined;
}

function createComponentWireframeRegions(input: {
  title: string;
  description?: string;
}): PlanWireframeRegion[] {
  const text = `${input.title} ${input.description ?? ""}`.toLowerCase();
  if (/\b(chat|message|composer|thinking)\b/.test(text)) {
    return [
      componentShell(),
      {
        id: "messages",
        kind: "list",
        label: "Chat messages",
        x: 16,
        y: 16,
        width: 68,
        height: 40,
        emphasis: true,
      },
      {
        id: "thinking-status",
        kind: "toolbar",
        label: "Thinking status",
        x: 16,
        y: 62,
        width: 38,
        height: 8,
      },
      {
        id: "composer",
        kind: "input",
        label: "Composer",
        x: 16,
        y: 76,
        width: 68,
        height: 10,
      },
    ];
  }

  const looksLikeContextXRay =
    /\b(context\s*x-?ray|x-?ray|popover|usage|meter|list\/?map)\b/.test(text);

  if (
    !looksLikeContextXRay &&
    /\b(map|treemap|token distribution)\b/.test(text)
  ) {
    return [
      componentShell(),
      {
        id: "map-title",
        kind: "header",
        label: "Map",
        x: 16,
        y: 13,
        width: 34,
        height: 9,
        emphasis: true,
      },
      {
        id: "token-map",
        kind: "content",
        label: "Token map",
        x: 16,
        y: 29,
        width: 68,
        height: 36,
        emphasis: true,
      },
      {
        id: "legend",
        kind: "toolbar",
        label: "Legend",
        x: 16,
        y: 72,
        width: 32,
        height: 8,
      },
      {
        id: "selected-summary",
        kind: "content",
        label: "Selected 2.0k",
        x: 54,
        y: 72,
        width: 30,
        height: 8,
      },
    ];
  }

  if (/\b(expanded|segment|detail|pin|evict|protected)\b/.test(text)) {
    return [
      componentShell(),
      {
        id: "segment-title",
        kind: "header",
        label: "Conversation",
        x: 16,
        y: 13,
        width: 40,
        height: 9,
        emphasis: true,
      },
      {
        id: "segment-usage",
        kind: "toolbar",
        label: "2.0k protected",
        x: 58,
        y: 13,
        width: 26,
        height: 9,
      },
      {
        id: "user-row",
        kind: "list",
        label: "User message",
        x: 16,
        y: 31,
        width: 68,
        height: 13,
      },
      {
        id: "tool-row",
        kind: "list",
        label: "Tool result",
        x: 16,
        y: 50,
        width: 68,
        height: 13,
      },
      {
        id: "pin-evict",
        kind: "button",
        label: "Pin / evict",
        x: 60,
        y: 72,
        width: 26,
        height: 9,
        emphasis: true,
      },
    ];
  }

  if (looksLikeContextXRay) {
    return [
      componentShell(),
      {
        id: "xray-title",
        kind: "header",
        label: "Context X-Ray",
        x: 16,
        y: 13,
        width: 42,
        height: 9,
        emphasis: true,
      },
      {
        id: "usage-meter",
        kind: "content",
        label: "2.0k used",
        x: 16,
        y: 30,
        width: 68,
        height: 18,
      },
      {
        id: "view-toggle",
        kind: "toolbar",
        label: "List / Map",
        x: 16,
        y: 54,
        width: 36,
        height: 8,
      },
      {
        id: "conversation-group",
        kind: "list",
        label: "Conversation",
        x: 16,
        y: 68,
        width: 68,
        height: 18,
        emphasis: true,
      },
      {
        id: "row-action",
        kind: "button",
        label: "Pin",
        x: 68,
        y: 76,
        width: 14,
        height: 7,
      },
    ];
  }

  return [
    componentShell(),
    {
      id: "title",
      kind: "header",
      label: input.title,
      x: 14,
      y: 12,
      width: 42,
      height: 9,
      emphasis: true,
    },
    { id: "summary", kind: "content", x: 14, y: 28, width: 72, height: 18 },
    { id: "controls", kind: "toolbar", x: 14, y: 52, width: 36, height: 8 },
    {
      id: "content",
      kind: "list",
      x: 14,
      y: 66,
      width: 72,
      height: 20,
      emphasis: true,
    },
  ];
}

function componentShell(): PlanWireframeRegion {
  return { id: "shell", kind: "content", x: 9, y: 7, width: 82, height: 86 };
}

function createBasicDiagram(
  title: string,
  body: string,
): PlanDiagramBlock["data"] {
  const labels = markdownLines(body).slice(0, 5);
  const nodes = (labels.length ? labels : [title, "Review", "Build", "Verify"])
    .slice(0, 6)
    .map((label, index) => ({
      id: `node-${index + 1}`,
      label,
    }));
  return {
    nodes,
    edges: nodes.slice(0, -1).map((node, index) => ({
      from: node.id,
      to: nodes[index + 1]?.id ?? node.id,
    })),
  };
}

function renderBlockHtml(block: PlanBlock): string {
  const title = block.title ? `<h2>${escapeHtml(block.title)}</h2>` : "";
  if (block.type === "rich-text") {
    return `<section class="plan-block">${title}<div class="copy">${markdownToHtml(block.data.markdown)}</div></section>`;
  }
  if (block.type === "callout") {
    return `<aside class="callout ${escapeHtml(block.data.tone || "info")}">${title}<p>${escapeHtml(block.data.body)}</p></aside>`;
  }
  if (block.type === "checklist") {
    return `<section class="plan-block">${title}<ul class="checklist">${block.data.items.map((item) => `<li>${item.checked ? "[x]" : "[ ]"} ${escapeHtml(item.label)}</li>`).join("")}</ul></section>`;
  }
  if (block.type === "table") {
    return `<section class="plan-block">${title}<table><thead><tr>${block.data.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${block.data.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></section>`;
  }
  if (block.type === "code-tabs") {
    return `<section class="plan-block">${title}<div class="code-tabs">${block.data.tabs.map((tab) => `<article><h3>${escapeHtml(tab.label)}</h3><pre><code>${escapeHtml(tab.code)}</code></pre></article>`).join("")}</div></section>`;
  }
  if (block.type === "implementation-map") {
    return `<section class="plan-block">${title}<div class="implementation-map">${block.data.files.map((file) => `<article><h3>${escapeHtml(file.title || file.path)}</h3><p><code>${escapeHtml(file.path)}</code></p><p>${escapeHtml(file.note)}</p>${file.snippet ? `<pre><code>${escapeHtml(file.snippet)}</code></pre>` : ""}</article>`).join("")}</div></section>`;
  }
  if (block.type === "legacy-wireframe") {
    return `<section class="plan-block sketch-block">${title}${renderWireframeHtml(block.data)}</section>`;
  }
  if (block.type === "wireframe") {
    return `<section class="plan-block sketch-block">${title}${renderKitWireframeHtml(block.data)}</section>`;
  }
  if (block.type === "diagram") {
    return `<section class="plan-block sketch-block">${title}${renderDiagramHtml(block.data)}</section>`;
  }
  if (block.type === "image") {
    return renderImageHtml(block);
  }
  if (block.type === "tabs") {
    return `<section class="plan-block">${title}<div class="tab-export">${block.data.tabs.map((tab) => `<article><h3>${escapeHtml(tab.label)}</h3>${tab.blocks.map(renderBlockHtml).join("")}</article>`).join("")}</div></section>`;
  }
  if (block.type === "custom-html") {
    const source = [
      block.data.css ? `<style>\n${block.data.css}\n</style>` : "",
      block.data.html,
    ]
      .filter(Boolean)
      .join("\n");
    return `<section class="plan-block">${title}<div class="custom-fragment"><p class="caption">Custom HTML fragment. Plan renders this safely in a sandboxed iframe; standalone exports show the source instead of executing it.</p><pre><code>${escapeHtml(source)}</code></pre></div>${block.data.caption ? `<p class="caption">${escapeHtml(block.data.caption)}</p>` : ""}</section>`;
  }
  if (block.type === "question-form" || block.type === "visual-questions") {
    return `<section class="plan-block">${title}${block.data.questions.map((question, index) => `<article class="question"><h3>${index + 1}. ${escapeHtml(question.title)}</h3>${question.subtitle ? `<p>${escapeHtml(question.subtitle)}</p>` : ""}<div class="chips">${question.options?.map((option) => `<span>${escapeHtml(option.label)}</span>`).join("") ?? ""}</div></article>`).join("")}</section>`;
  }
  return "";
}

function frameLegacyData(frame: PlanArtboard): LegacyWireframeData | undefined {
  return frame.legacyWireframe;
}

function renderPrototypeHtml(prototype: PlanPrototype): string {
  const initial =
    prototype.screens.find(
      (screen) => screen.id === prototype.initialScreenId,
    ) ?? prototype.screens[0];
  if (!initial) return "";
  const transitions = prototype.transitions ?? [];
  return `<section class="prototype-export">
    <div class="prototype-export-header">
      <div>
        <p class="kicker">Prototype</p>
        <h2>${escapeHtml(prototype.title ?? "Clickable prototype")}</h2>
        ${prototype.brief ? `<p>${escapeHtml(prototype.brief)}</p>` : ""}
      </div>
      <span>${escapeHtml(initial.title ?? initial.id)}</span>
    </div>
    <div class="prototype-export-screen">
      <p class="caption">Prototype HTML is shown as static source in standalone exports. Open the live plan to click through screens and add anchored comments.</p>
      <pre><code>${escapeHtml(initial.html)}</code></pre>
    </div>
    ${
      transitions.length > 0
        ? `<ol class="prototype-export-flow">${transitions
            .map(
              (transition) =>
                `<li><strong>${escapeHtml(transition.from)}</strong> to <strong>${escapeHtml(transition.to)}</strong>${transition.label ? ` — ${escapeHtml(transition.label)}` : ""}${transition.trigger ? ` <span>${escapeHtml(transition.trigger)}</span>` : ""}</li>`,
            )
            .join("")}</ol>`
        : ""
    }
  </section>`;
}

function renderCanvasHtml(canvas: NonNullable<PlanContent["canvas"]>): string {
  const layoutFrames = layoutCanvasFrames(canvas.frames);
  const frames = layoutFrames
    .map((frame) => {
      const legacy = frameLegacyData(frame);
      const inner = frame.wireframe
        ? renderKitWireframeHtml(frame.wireframe)
        : legacy
          ? renderWireframeHtml(legacy)
          : "";
      return `<div class="canvas-frame" style="left:${frame.x ?? 80}px;top:${frame.y ?? 80}px;width:${frame.width ?? 420}px;height:${frame.height ?? 360}px">
        <h3>${escapeHtml(frame.label ?? "")}</h3>
        ${inner}
      </div>`;
    })
    .join("");
  const legacyNotes = (canvas.notes ?? []).map(
    (note) =>
      `<aside class="canvas-note" style="left:${note.x ?? 80}px;top:${note.y ?? 40}px"><strong>${escapeHtml(note.title || "Note")}</strong><p>${escapeHtml(note.body)}</p></aside>`,
  );
  const annotations = (canvas.annotations ?? []).map(
    (annotation) =>
      `<aside class="canvas-note" style="left:${annotation.x ?? 80}px;top:${annotation.y ?? 40}px">${annotation.title ? `<strong>${escapeHtml(annotation.title)}</strong>` : ""}<p>${escapeHtml(annotation.text)}</p></aside>`,
  );
  const notes = [...legacyNotes, ...annotations].join("");
  return `<section class="canvas-export"><div class="canvas-inner">${frames}${notes}</div></section>`;
}

function isPhoneFrame(frame: PlanArtboard): boolean {
  return (
    frame.surface === "mobile" || frameLegacyData(frame)?.viewport === "phone"
  );
}

function layoutCanvasFrames(frames: PlanArtboard[]): PlanArtboard[] {
  return frames.map((frame, index) => {
    const explicitSize =
      frame.width !== undefined || frame.height !== undefined;
    const isPhone = isPhoneFrame(frame);
    const width = frame.width ?? (isPhone ? 300 : index === 0 ? 640 : 560);
    const height = frame.height ?? (isPhone ? 520 : 420);
    if (frame.x !== undefined || frame.y !== undefined || explicitSize) {
      return {
        ...frame,
        width,
        height,
        x: frame.x ?? 80,
        y: frame.y ?? 80,
      };
    }
    const desktopCountBefore = frames
      .slice(0, index)
      .filter((candidate) => !isPhoneFrame(candidate)).length;
    const phoneCountBefore = frames
      .slice(0, index)
      .filter((candidate) => isPhoneFrame(candidate)).length;
    return {
      ...frame,
      width,
      height,
      x: isPhone ? 760 + phoneCountBefore * 380 : 80 + desktopCountBefore * 700,
      y: isPhone ? 80 : 80 + Math.floor(desktopCountBefore / 2) * 520,
    };
  });
}

function renderWireframeHtml(data: LegacyWireframeData) {
  if (data.template) {
    return `<div class="sketch-wireframe template ${escapeHtml(data.template)}">${renderWireframeTemplateHtml(data.template)}</div>`;
  }
  return `<div class="sketch-wireframe ${escapeHtml(data.viewport || "desktop")}">
    ${data.regions
      .map(
        (region) =>
          `<span class="sketch-region ${escapeHtml(region.kind)}${region.emphasis ? " emphasis" : ""}" style="left:${region.x}%;top:${region.y}%;width:${region.width}%;height:${region.height}%">${region.label ? escapeHtml(region.label) : ""}</span>`,
      )
      .join("")}
  </div>`;
}

function renderWireframeTemplateHtml(
  template: NonNullable<LegacyWireframeData["template"]>,
) {
  if (template === "context-xray-app") {
    return `<div class="wf-template app">
      <div class="wf-box app-shell">
        <div class="wf-topbar"><span>App shell</span><i></i></div>
        <div class="wf-app-grid">
          <div class="wf-box wf-chat"><strong>Chat thread</strong><span class="wf-lines"><i></i><i></i><i></i></span><span class="wf-lines reply"><i></i><i></i></span></div>
          <div class="wf-sidebar">
            <div class="wf-box wf-side-title">Agent sidebar</div>
            <div class="wf-box wf-popover"><strong>Context X-Ray popover</strong>${renderXRayMeterHtml(true)}<div class="wf-toggle"><b>List</b><b>Map</b></div><div class="wf-box wf-row"><strong>Conversation</strong><span class="wf-lines"><i></i></span></div></div>
            <div class="wf-button solid">X-Ray</div>
          </div>
          <div class="wf-box wf-status">Thinking status</div>
          <div class="wf-box wf-composer">Composer <i></i></div>
        </div>
      </div>
    </div>`;
  }
  if (template === "context-xray-expanded") {
    return `<div class="wf-template popover">
      <div class="wf-head"><div class="wf-box emphasis">Conversation</div><div class="wf-box">2.0k protected</div></div>
      <div class="wf-box message"><strong>User message</strong><span class="wf-lines"><i></i><i></i></span></div>
      <div class="wf-box message"><strong>Tool result</strong><span class="wf-lines"><i></i><i></i></span></div>
      <div class="wf-actions"><span class="wf-pill">Protected</span><div class="wf-button solid">Pin / evict</div></div>
    </div>`;
  }
  if (template === "context-xray-map") {
    return `<div class="wf-template popover map">
      <div class="wf-head"><div class="wf-box emphasis">Context X-Ray</div><span>Map</span></div>
      <div class="wf-box wf-map-area"><div class="wf-rowhead"><strong>Token map</strong><span>2.0k selected</span></div><div class="wf-treemap"><i></i><i></i><i></i><i></i><i></i></div></div>
      <div class="wf-foot"><div class="wf-box">Legend</div><div class="wf-box">Selected 2.0k</div></div>
    </div>`;
  }
  if (template === "context-xray-chat-cleanup") {
    return `<div class="wf-template chat-cleanup">
      <div class="wf-box wf-chat-thread"><div class="wf-bubble"><strong>Chat messages</strong><span class="wf-lines"><i></i><i></i><i></i></span></div><div class="wf-bubble reply"><span class="wf-lines"><i></i><i></i><i></i></span></div></div>
      <div class="wf-box wf-status">Thinking status</div>
      <div class="wf-box wf-composer">Composer <i></i></div>
    </div>`;
  }
  return `<div class="wf-template popover">
    <div class="wf-head"><div class="wf-box emphasis">Context X-Ray</div><span>Pinned 0 · Evicted 0</span></div>
    ${renderXRayMeterHtml(false)}
    <div class="wf-toggle"><b>List</b><b>Map</b></div>
    <div class="wf-box group"><div class="wf-rowhead"><strong>Conversation</strong><span>2.0k</span></div><div class="wf-box wf-row"><strong>Conversation</strong><span class="wf-lines"><i></i></span><span class="wf-button">Pin</span></div></div>
  </div>`;
}

function renderXRayMeterHtml(compact: boolean) {
  return `<div class="wf-box wf-meter"><div><strong>2.0k used</strong>${compact ? "" : "<span>1% used · 198k free</span>"}</div><span class="wf-progress"><i></i></span></div>`;
}

function renderDiagramHtml(data: PlanDiagramBlock["data"]) {
  if (data.html?.trim()) {
    return `<div class="standalone-diagram-fragment">
      ${data.css ? `<style>${data.css}</style>` : ""}
      ${data.html}
      ${data.caption ? `<p class="caption">${escapeHtml(data.caption)}</p>` : ""}
    </div>`;
  }
  const nodes = data.nodes ?? [];
  const edges = data.edges ?? [];
  const positioned = nodes.map((node, index) => ({
    ...node,
    x: node.x ?? 12 + index * (76 / Math.max(nodes.length - 1, 1)),
    y: node.y ?? 50,
  }));
  return `<svg class="sketch-diagram" viewBox="0 0 100 100" role="img">
    ${edges
      .map((edge) => {
        const from = positioned.find((node) => node.id === edge.from);
        const to = positioned.find((node) => node.id === edge.to);
        if (!from || !to) return "";
        return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" />`;
      })
      .join("")}
    ${positioned
      .map(
        (node) =>
          `<g><rect x="${node.x - 8}" y="${node.y - 6}" width="16" height="12" rx="2" /><text x="${node.x}" y="${node.y + 1}">${escapeHtml(node.label)}</text></g>`,
      )
      .join("")}
  </svg>`;
}

/* -------------------------------------------------------------------------- */
/* Kit-tree wireframe export (semantic flex tree -> inert HTML)               */
/* -------------------------------------------------------------------------- */

function renderKitWireframeHtml(data: PlanWireframeBlock["data"]): string {
  const surface = escapeHtml(data.surface || "desktop");
  const screen = data.screen.map(renderKitNodeHtml).join("");
  return `<div class="kit-wireframe surface-${surface}">${screen}</div>`;
}

function renderKitNodeHtml(node: PlanWireframeNode): string {
  const el = escapeHtml(node.el);
  const classes = ["kit-node", `kit-${el}`];
  if (node.tone) classes.push(`tone-${escapeHtml(node.tone)}`);
  if (node.active) classes.push("is-active");
  if (node.emphasis) classes.push("is-emphasis");
  if (node.done) classes.push("is-done");

  const label = node.text ?? node.label ?? node.title ?? node.value ?? "";
  const text = label ? escapeHtml(label) : "";

  if (node.el === "lines") {
    const count = node.n ?? 2;
    const lines = Array.from({ length: Math.min(count, 8) })
      .map(() => `<i></i>`)
      .join("");
    return `<span class="${classes.join(" ")}">${lines}</span>`;
  }
  if (node.el === "chips" && node.items?.length) {
    const chips = node.items
      .map(
        (item) =>
          `<span class="kit-chip${item.active ? " is-active" : ""}">${escapeHtml(item.label)}${item.count !== undefined ? ` <b>${item.count}</b>` : ""}</span>`,
      )
      .join("");
    return `<div class="${classes.join(" ")}">${chips}</div>`;
  }
  if (node.el === "kv" && node.rows?.length) {
    const rows = node.rows
      .map(
        (row) =>
          `<div class="kit-kv-row"><span>${escapeHtml(row.k)}</span><span>${escapeHtml(row.v)}</span></div>`,
      )
      .join("");
    return `<div class="${classes.join(" ")}">${rows}</div>`;
  }

  const children = node.children?.length
    ? node.children.map(renderKitNodeHtml).join("")
    : "";
  return `<div class="${classes.join(" ")}">${text ? `<span class="kit-text">${text}</span>` : ""}${children}</div>`;
}

function renderImageHtml(block: PlanImageBlock): string {
  const title = block.title ? `<h2>${escapeHtml(block.title)}</h2>` : "";
  const src = block.data.url;
  const alt = escapeHtml(block.data.alt);
  const caption = block.data.caption
    ? `<p class="caption">${escapeHtml(block.data.caption)}</p>`
    : "";
  // Only inline a same-origin-safe src when an explicit url is present; asset
  // ids resolve in-app, so the standalone export shows a placeholder instead.
  const body = src
    ? `<img class="plan-image" src="${escapeHtml(src)}" alt="${alt}" loading="lazy" />`
    : `<div class="plan-image placeholder" role="img" aria-label="${alt}">${alt}</div>`;
  return `<section class="plan-block">${title}${body}${caption}</section>`;
}

function previewToWireframe(
  preview: VisualQuestionPreview,
  label: string,
): PlanWireframeBlock["data"] | undefined {
  if (preview === "desktop" || preview === "mobile" || preview === "split") {
    // Visual-question previews use the lean kit tree so they validate against
    // the new wireframe model (region data is rejected there by design).
    return {
      surface: preview === "mobile" ? "mobile" : "desktop",
      screen: [
        {
          el: "screen",
          children: [
            { el: "title", script: true, text: label },
            { el: "text", value: "Preview direction" },
            {
              el: "row",
              children: [
                { el: "btn", label: "Primary", solid: true },
                { el: "btn", label: "Secondary" },
              ],
            },
          ],
        },
      ],
    };
  }
  return undefined;
}

function previewToDiagram(preview: VisualQuestionPreview, label: string) {
  if (preview === "flow" || preview === "diagram") {
    return createBasicDiagram(label, "Start\nChoose\nBuild");
  }
  return undefined;
}

function defaultVisualQuestions(brief: string): VisualQuestionBuilderInput[] {
  return [
    {
      id: "form-factor",
      type: "single",
      title: "What form factor should lead?",
      subtitle: "Where should the first design direction feel native?",
      options: [
        { label: "Desktop web app", preview: "desktop" },
        { label: "Mobile app", preview: "mobile" },
        { label: "Both / responsive", recommended: true, preview: "split" },
        { label: "Decide for me" },
      ],
    },
    {
      id: "aesthetic",
      type: "multi",
      title: "What aesthetic direction appeals?",
      subtitle: "Pick any signals worth exploring.",
      options: [
        { label: "Calm and minimal" },
        { label: "Dense and productive" },
        { label: "Playful and colorful" },
        { label: "Editorial / typographic" },
        { label: "Sleek dark mode" },
      ],
    },
    {
      id: "scope",
      type: "freeform",
      title: "Anything the plan must include?",
      subtitle: brief,
    },
    {
      id: "flow-complexity",
      type: "visual",
      title: "How complex should the flow be?",
      subtitle: "Choose how much canvas vs document detail the plan needs.",
      options: [
        {
          label: "One polished path",
          description: "Fastest to approve with fewer branches.",
          preview: "flow",
          recommended: true,
        },
        {
          label: "A few variations",
          description: "Useful when direction is fuzzy and tradeoffs matter.",
          preview: "diagram",
        },
      ],
    },
  ];
}

function markdownLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^[-*]\s+/, "")
        .replace(/^#+\s+/, "")
        .trim(),
    )
    .filter(Boolean);
}

function markdownToHtml(value: string) {
  const lines = value.split(/\r?\n/);
  const html: string[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (list.length === 0) return;
    html.push(
      `<ul>${list.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`,
    );
    list = [];
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushList();
      const level = Math.min(heading[1]?.length ?? 2, 3);
      html.push(`<h${level + 1}>${escapeHtml(heading[2])}</h${level + 1}>`);
      continue;
    }
    const listItem = /^[-*]\s+(.+)$/.exec(line);
    if (listItem?.[1]) {
      list.push(listItem[1]);
      continue;
    }
    flushList();
    html.push(`<p>${escapeHtml(line)}</p>`);
  }
  flushList();
  return html.join("\n");
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CONTENT_EXPORT_CSS = `
:root { color-scheme: light dark; --bg: #fbfaf8; --canvas: #f2f1ee; --paper: #ffffff; --line: #dedbd5; --text: #191918; --muted: #68645f; --accent: #3f7cff; --code-bg: #f4f4f2; --code-text: #242321; }
@media (prefers-color-scheme: dark) { :root { --bg: #1f1e1d; --canvas: #1c1b1a; --paper: #22211f; --line: #393735; --text: #f3f2ef; --muted: #aaa6a0; --code-bg: #171615; --code-text: #f0efeb; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.55; }
main { width: min(1120px, calc(100vw - 48px)); margin: 0 auto; padding: 72px 0 96px; }
.prototype-export { padding: 42px clamp(24px, 4vw, 64px); border-bottom: 1px solid var(--line); background: var(--paper); }
.prototype-export-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; max-width: 1120px; margin: 0 auto 24px; }
.prototype-export-header h2 { margin: 0 0 8px; }
.prototype-export-header > span { border: 1px solid var(--line); border-radius: 999px; padding: 6px 12px; color: var(--muted); font-size: 12px; font-weight: 700; white-space: nowrap; }
.prototype-export-screen { max-width: 1120px; margin: 0 auto; }
.prototype-export-flow { max-width: 1120px; margin: 22px auto 0; color: var(--muted); }
.prototype-export-flow span { color: var(--muted); }
.canvas-export { height: 65vh; overflow: hidden; background-color: var(--canvas); background-image: linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px); background-size: 28px 28px; border-bottom: 1px solid var(--line); }
.canvas-inner { position: relative; width: 2400px; height: 1400px; }
.canvas-frame, .canvas-note { position: absolute; }
.canvas-frame h3 { margin: 0 0 8px; font-size: 14px; }
.canvas-note { width: 280px; color: var(--muted); }
.hero { padding-bottom: 34px; border-bottom: 1px solid var(--line); }
.kicker { color: var(--muted); font-size: 12px; font-weight: 760; letter-spacing: .12em; text-transform: uppercase; }
h1 { margin: 0; max-width: 880px; font-size: clamp(42px, 5vw, 74px); line-height: .98; letter-spacing: -.03em; }
.lede { max-width: 880px; color: var(--muted); font-size: 22px; }
.plan-block, .callout { margin-top: 60px; padding-top: 34px; border-top: 1px solid var(--line); }
h2 { margin: 0 0 18px; font-size: clamp(28px, 4vw, 44px); letter-spacing: -.025em; }
h3 { margin: 0 0 10px; }
.copy { max-width: 840px; color: var(--muted); font-size: 18px; }
.sketch-wireframe { position: relative; height: 360px; border: 2px solid currentColor; border-radius: 18px; color: #eceae5; background: var(--paper); }
.sketch-wireframe.phone { width: 260px; height: 480px; border-radius: 38px; }
.sketch-wireframe.template { display: flex; color: var(--text); padding: 18px; font-family: "Excalifont", "Comic Sans MS", "Bradley Hand", cursive; }
.wf-template { display: grid; width: 100%; height: 100%; min-height: 0; gap: 14px; }
.wf-template.popover { grid-template-rows: auto auto auto 1fr; gap: 16px; padding: 10px; }
.wf-template.popover.map { grid-template-rows: auto 1fr auto; }
.wf-template.chat-cleanup { grid-template-rows: 1fr auto auto; padding: 10px; }
.wf-box { min-width: 0; min-height: 0; border: 1.5px solid currentColor; border-radius: 12px; background: transparent; padding: 12px 14px; }
.wf-box.emphasis { color: var(--accent); }
.wf-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; }
.wf-head > span { color: var(--muted); font: 700 11px Inter, sans-serif; }
.wf-lines { display: flex; width: min(100%, 230px); flex-direction: column; gap: 4px; }
.wf-lines i { display: block; width: 70%; height: 4px; border-radius: 999px; background: var(--line); opacity: .72; }
.wf-lines i:nth-child(2) { width: 54%; }
.wf-lines i:nth-child(3) { width: 34%; }
.wf-meter { display: grid; gap: 9px; }
.wf-meter > div { display: flex; justify-content: space-between; gap: 10px; }
.wf-meter span { color: var(--muted); font: 700 11px Inter, sans-serif; }
.wf-progress { height: 5px; overflow: hidden; border-radius: 999px; background: var(--line); opacity: .72; }
.wf-progress i { display: block; width: 18%; height: 100%; background: var(--accent); }
.wf-toggle { display: inline-flex; gap: 8px; }
.wf-toggle b, .wf-pill { display: inline-flex; align-items: center; justify-content: center; min-height: 24px; border: 1.4px solid currentColor; border-radius: 999px; padding: 3px 10px 4px; font-size: 12px; white-space: nowrap; }
.wf-toggle b:first-child { color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }
.wf-rowhead { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.wf-rowhead span { color: var(--muted); font: 700 11px Inter, sans-serif; }
.wf-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; }
.wf-button { display: inline-flex; align-items: center; justify-content: center; border: 1.4px solid currentColor; border-radius: 10px; padding: 7px 12px; font-weight: 700; white-space: nowrap; }
.wf-button.solid { color: #fff; border-color: var(--accent); background: var(--accent); }
.wf-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; }
.wf-map-area { display: grid; gap: 12px; }
.wf-treemap { display: grid; min-height: 130px; grid-template-columns: 1.4fr .9fr .7fr; grid-template-rows: 1fr .8fr; gap: 8px; }
.wf-treemap i { border-radius: 8px; background: color-mix(in srgb, var(--accent) 18%, transparent); outline: 1px solid color-mix(in srgb, var(--accent) 55%, transparent); }
.wf-treemap i:first-child { grid-row: span 2; background: color-mix(in srgb, var(--accent) 30%, transparent); }
.wf-foot { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.wf-chat-thread { display: grid; align-content: center; gap: 28px; padding: 18px 20px; }
.wf-bubble { display: grid; gap: 8px; }
.wf-bubble.reply { width: 84%; margin-left: auto; }
.wf-status { width: 48%; }
.wf-composer { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 10px; }
.wf-template.app .app-shell { display: grid; height: 100%; grid-template-rows: auto 1fr; gap: 12px; padding: 18px; }
.wf-topbar { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 12px; }
.wf-topbar i, .wf-composer i { display: block; height: 4px; border-radius: 999px; background: var(--line); }
.wf-app-grid { display: grid; min-height: 0; grid-template-columns: minmax(0, 1fr) minmax(188px, 34%); grid-template-rows: minmax(0, 1fr) auto auto; gap: 14px 18px; }
.wf-chat { display: grid; align-content: center; gap: 24px; padding: 22px 26px; }
.wf-sidebar { display: grid; grid-row: 1 / span 3; grid-template-rows: auto 1fr auto; gap: 12px; }
.wf-side-title { width: 78%; justify-self: end; }
.wf-popover { display: grid; gap: 10px; background: var(--canvas); }
.wf-sidebar > .wf-button { width: 84px; justify-self: end; }
.sketch-region { position: absolute; border: 1.5px solid currentColor; border-radius: 10px; color: inherit; }
.sketch-region.emphasis { border-color: var(--accent); }
.sketch-diagram { width: 100%; max-width: 900px; min-height: 260px; color: #eceae5; }
.sketch-diagram line { stroke: var(--accent); stroke-width: 1.7; stroke-linecap: round; }
.sketch-diagram rect { fill: var(--paper); stroke: currentColor; stroke-width: 1.3; }
.sketch-diagram text { fill: currentColor; font: 4px ui-sans-serif, system-ui; text-anchor: middle; dominant-baseline: middle; }
.kit-wireframe { display: flex; flex-direction: column; gap: var(--kit-gap, 11px); min-height: 320px; padding: 16px; border: 1.4px solid var(--line); border-radius: 16px; background: var(--paper); color: var(--text); font-family: "Gaegu", "Excalifont", "Comic Sans MS", "Bradley Hand", cursive; }
.kit-wireframe.surface-mobile { width: 300px; min-height: 560px; border-radius: 30px; margin: 0 auto; }
.kit-wireframe .kit-node { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.kit-wireframe .kit-row { flex-direction: row; align-items: center; gap: 10px; }
.kit-wireframe .kit-sidebar { width: 30%; gap: 7px; }
.kit-wireframe .kit-main { flex: 1; }
.kit-wireframe .kit-title { font-family: "Caveat", "Gaegu", cursive; font-size: 24px; font-weight: 700; }
.kit-wireframe .kit-text { display: block; }
.kit-wireframe .kit-btn, .kit-wireframe .kit-pill, .kit-wireframe .kit-chip { display: inline-flex; align-items: center; gap: 6px; border: 1.3px solid currentColor; border-radius: 999px; padding: 3px 12px; font-size: 13px; width: fit-content; }
.kit-wireframe .kit-btn.tone-accent, .kit-wireframe .kit-chip.is-active { color: var(--accent); border-color: var(--accent); }
.kit-wireframe .kit-chips { flex-direction: row; flex-wrap: wrap; gap: 8px; }
.kit-wireframe .kit-card, .kit-wireframe .kit-box, .kit-wireframe .kit-taskRow, .kit-wireframe .kit-field, .kit-wireframe .kit-searchBar { border: 1.3px solid var(--line); border-radius: 10px; padding: 10px 12px; }
.kit-wireframe .kit-lines { gap: 5px; }
.kit-wireframe .kit-lines i { display: block; height: 5px; border-radius: 999px; background: var(--line); opacity: .8; }
.kit-wireframe .kit-lines i:nth-child(2) { width: 78%; }
.kit-wireframe .kit-lines i:nth-child(3) { width: 56%; }
.kit-wireframe .kit-divider { height: 1px; background: var(--line); margin: 4px 0; }
.kit-wireframe .kit-kv-row { display: flex; justify-content: space-between; gap: 12px; }
.kit-wireframe .tone-warn { color: var(--warn, #b5503a); }
.kit-wireframe .tone-ok { color: var(--ok, #5b8c6e); }
.kit-wireframe .tone-muted { color: var(--muted); }
.plan-image { max-width: 100%; border: 1px solid var(--line); border-radius: 14px; }
.plan-image.placeholder { display: grid; place-items: center; min-height: 220px; color: var(--muted); background: var(--code-bg); font-size: 14px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chips span { border: 1px solid var(--line); border-radius: 999px; padding: 6px 12px; color: var(--muted); }
pre { overflow: auto; border: 1px solid var(--line); border-radius: 12px; background: var(--code-bg); padding: 16px; color: var(--code-text); }
code { font-family: "SFMono-Regular", Consolas, monospace; }
table { width: 100%; border-collapse: collapse; }
th, td { border-bottom: 1px solid var(--line); padding: 10px; text-align: left; }
`;
