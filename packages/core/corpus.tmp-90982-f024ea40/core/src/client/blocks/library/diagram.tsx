import {
  IconArrowsMaximize,
  IconScribble,
  IconShape2,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip.js";
import { cn } from "../../utils.js";
import { AiEditableFieldLabel } from "../AiEditableField.js";
import { ltrCodeBlockProps } from "../code-block-direction.js";
import { defineBlock } from "../types.js";
import type {
  BlockReadProps,
  BlockEditProps,
  BlockRenderContext,
} from "../types.js";
import { useBlockCopy } from "./block-copy.js";
import {
  diagramMdx,
  diagramSchema,
  type DiagramData,
  type DiagramEdge,
  type DiagramNode,
} from "./diagram.config.js";
import {
  sanitizeDiagramHtml,
  sanitizeWireframeCss,
  scopeDesignCss,
} from "./sanitize-html.js";
import {
  RoughOverlay,
  toggleWireframeStyle,
  useIsDark,
  useWireframeStyle,
} from "./wireframe-kit.js";

/**
 * Read + Edit renderers for the shared `diagram` block — a flexible inline
 * architecture/code diagram. The preferred authoring path is a scoped, inert
 * HTML/SVG fragment that leans on `.diagram-*` primitives and `--wf-*` tokens;
 * a legacy positional / sequence node-graph path is kept for older/simple plans.
 * Lives in core so any app can register it (it originated in the plan template).
 *
 * DECOUPLING from the plan original (mirrors the sibling `wireframe.tsx` port):
 * - Theme: `useIsDark()` reads `document.documentElement.classList` instead of
 *   `next-themes`; `useWireframeStyle()` reads the viewer's sketchy/clean
 *   preference from the shared `plan-wireframe-style` localStorage key — both
 *   from `./wireframe-kit.js`, so core stays plan-free and shadcn-free.
 * - HTML sanitize: the HTML/SVG fragment + CSS run through the app-injected
 *   `ctx.sanitizeHtml` at the render point (defense-in-depth against stored
 *   XSS). Without a sanitizer wired, the HTML path emits nothing — core never
 *   injects unsanitized author HTML. The React-free `diagramSchema` already
 *   rejects active markup before storage.
 * - The rough.js sketch overlay reuses the kit's shared `RoughOverlay`, scoped
 *   with the diagram selector and `drawFrame={false}` (the same call the plan
 *   `HtmlDiagram` made). The `.plan-diagram-frame` / `.diagram-*` / `data-rough`
 *   class contract is preserved exactly so the theme-token CSS in core's
 *   `blocks.css` styles it in any app.
 *
 * The section carries the app-neutral `an-block` class plus the legacy
 * `plan-block` class so plan renders byte-identically while any other app gets
 * the theme-token treatment.
 */

/* -------------------------------------------------------------------------- */
/* HTML/SVG diagram path                                                       */
/* -------------------------------------------------------------------------- */

/** The rough-overlay selector for diagram bordered boxes (mirrors the plan). */
const DIAGRAM_ROUGH_SELECTOR =
  "[data-rough],.diagram-panel,.diagram-node,.diagram-box,.diagram-pill,.diagram-card,[class*='card'],[class*='box'],[class*='panel'],[class*='pill'],[class*='chip'],[class*='badge'],hr";

function HtmlDiagram({
  data,
  ctx,
  compact,
}: {
  data: DiagramData;
  ctx: BlockRenderContext;
  compact?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isDark = useIsDark();
  const style = useWireframeStyle();
  const showFrame = resolveVisualFrame(data.frame, ctx);
  const scopeId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  // Sanitize author HTML/CSS at the render point (defense-in-depth against
  // stored XSS). Self-contained in core via the shared block sanitizer (DOM-based
  // in the browser, regex fallback on the server) so diagrams render in any app
  // without the host wiring a sanitizer hook.
  const safeHtml = useMemo(() => sanitizeDiagramHtml(data.html), [data.html]);
  const scopedCss = useMemo(() => {
    const safeCss = sanitizeWireframeCss(data.css);
    // Scope every author selector under this diagram instance so global
    // selectors (body, *, .app-shell, :root) can't escape and restyle the page.
    return safeCss
      ? scopeDesignCss(safeCss, `[data-plan-diagram-scope="${scopeId}"]`)
      : "";
  }, [data.css, scopeId]);

  return (
    <div
      ref={ref}
      className={cn("plan-diagram-shell", compact && "plan-diagram-compact")}
    >
      <div
        className="plan-diagram-frame"
        dir={ctx.textDirection}
        data-theme={isDark ? "dark" : "light"}
        data-style={style}
        data-frame={showFrame ? "show" : "hide"}
        data-text-direction={ctx.textDirection}
        data-plan-diagram-scope={scopeId}
      >
        {scopedCss && <style>{scopedCss}</style>}
        <div
          className="plan-diagram-frame-content"
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
      </div>
      <RoughOverlay
        scopeRef={ref}
        enabled={style === "sketchy"}
        drawFrame={showFrame}
        selector={DIAGRAM_ROUGH_SELECTOR}
      />
      {data.caption && !compact && (
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {data.caption}
        </p>
      )}
    </div>
  );
}

function resolveVisualFrame(
  frame: DiagramData["frame"],
  ctx: BlockRenderContext,
): boolean {
  const resolved =
    frame && frame !== "auto" ? frame : (ctx.visualFrame ?? "show");
  return resolved !== "hide";
}

/* -------------------------------------------------------------------------- */
/* Legacy node-graph paths                                                     */
/* -------------------------------------------------------------------------- */

function clampDiagramPercent(value: number) {
  if (!Number.isFinite(value)) return 50;
  return Math.max(4, Math.min(96, value));
}

function hasPositionedDiagramNodes(data: DiagramData): boolean {
  return (data.nodes ?? []).some(
    (node) => typeof node.x === "number" && typeof node.y === "number",
  );
}

function orderDiagramNodes(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
): DiagramNode[] {
  if (nodes.length === 0) return [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    if (byId.has(edge.from) && byId.has(edge.to)) {
      indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    }
  }
  const start = nodes.find((node) => (indegree.get(node.id) ?? 0) === 0);
  if (!start) return nodes;
  const ordered: DiagramNode[] = [];
  const seen = new Set<string>();
  let current: DiagramNode | undefined = start;
  while (current && !seen.has(current.id)) {
    const node: DiagramNode = current;
    ordered.push(node);
    seen.add(node.id);
    const next = edges.find((edge) => edge.from === node.id);
    current = next ? byId.get(next.to) : undefined;
  }
  for (const node of nodes) if (!seen.has(node.id)) ordered.push(node);
  return ordered;
}

function PositionedDiagram({
  data,
  compact,
  markerId,
  direction,
  showFrame,
}: {
  data: DiagramData;
  compact?: boolean;
  markerId: string;
  direction?: BlockRenderContext["textDirection"];
  showFrame: boolean;
}) {
  const nodes = (data.nodes ?? []).map((node) => ({
    ...node,
    x: clampDiagramPercent(node.x ?? 50),
    y: clampDiagramPercent(node.y ?? 50),
  }));
  const edges = data.edges ?? [];
  const arrowId = `${markerId}-diagram-arrow`;
  const nodeWidth = compact ? 150 : 190;
  const rows = diagramRows(nodes, compact);
  const canvasHeight = diagramCanvasHeight(rows.length, compact);
  const canvasMinWidth = compact ? 560 : 720;
  const nodeWidthPct = compact ? 20 : 18;
  const nodeHeightPct = compact ? 14 : 18;
  const paddedViewBox = diagramViewBox(nodes, nodeWidthPct, nodeHeightPct);
  const xMargin = compact ? 13 : 14;
  const yMargin = compact ? 15 : 18;
  const displayNodes = nodes.map((node) => ({
    ...node,
    displayXBase: diagramPointPercent(
      node.x,
      paddedViewBox.x,
      paddedViewBox.width,
      xMargin,
    ),
    displayY: diagramRowPointPercent(node.y, rows, paddedViewBox, yMargin),
  }));
  const displayNodesForDirection = displayNodes.map((node) => ({
    ...node,
    displayX: direction === "rtl" ? 100 - node.displayXBase : node.displayXBase,
  }));
  const nodeByIdForDirection = new Map(
    displayNodesForDirection.map((node) => [node.id, node]),
  );

  return (
    <div
      className={cn(
        "plan-sketch",
        showFrame ? "rounded-[16px] border border-border bg-muted p-5" : "p-0",
      )}
      dir={direction}
      data-text-direction={direction}
    >
      <div
        className="overflow-auto rounded-xl border border-border bg-background"
        style={{ minHeight: canvasHeight }}
      >
        <div
          className="relative"
          style={{ minHeight: canvasHeight, minWidth: canvasMinWidth }}
        >
          <svg
            className="pointer-events-none absolute inset-0 z-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <marker
                id={arrowId}
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path
                  d="M 0 0 L 10 5 L 0 10 z"
                  className="fill-muted-foreground"
                />
              </marker>
            </defs>
            {edges.map((edge, index) => {
              const from = nodeByIdForDirection.get(edge.from);
              const to = nodeByIdForDirection.get(edge.to);
              if (!from || !to) return null;
              return (
                <line
                  key={`${edge.from}-${edge.to}-${index}`}
                  x1={from.displayX}
                  y1={from.displayY}
                  x2={to.displayX}
                  y2={to.displayY}
                  markerEnd={`url(#${arrowId})`}
                  vectorEffect="non-scaling-stroke"
                  className="stroke-border"
                  strokeWidth={2}
                  strokeDasharray={edge.label ? "0" : "6 5"}
                />
              );
            })}
          </svg>

          {!compact &&
            edges.map((edge, index) => {
              const from = nodeByIdForDirection.get(edge.from);
              const to = nodeByIdForDirection.get(edge.to);
              if (!edge.label || !from || !to) return null;
              return (
                <span
                  key={`${edge.from}-${edge.to}-${index}-label`}
                  className="absolute z-10 max-w-[130px] -translate-x-1/2 -translate-y-1/2 break-words rounded-full border border-border bg-background px-2 py-0.5 text-center text-[11px] font-semibold text-muted-foreground shadow-sm [overflow-wrap:anywhere]"
                  style={{
                    left: `${(from.displayX + to.displayX) / 2}%`,
                    top: `${(from.displayY + to.displayY) / 2}%`,
                  }}
                >
                  {edge.label}
                </span>
              );
            })}

          {displayNodesForDirection.map((node, index) => (
            <article
              key={node.id}
              className="absolute z-20 -translate-x-1/2 -translate-y-1/2 break-words rounded-xl border-2 border-border bg-background p-3 text-foreground shadow-sm [overflow-wrap:anywhere]"
              style={{
                left: `${node.displayX}%`,
                top: `${node.displayY}%`,
                width: nodeWidth,
              }}
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {index + 1}
              </p>
              <h3 className="mt-2 text-base font-semibold leading-tight">
                {node.label}
              </h3>
              {node.detail && !compact && (
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {node.detail}
                </p>
              )}
            </article>
          ))}
        </div>
      </div>
      {data.notes && data.notes.length > 0 && !compact && (
        <div className="mt-4 grid gap-2 border-t border-border pt-4 text-sm text-muted-foreground md:grid-cols-2">
          {data.notes.map((note) => (
            <p key={note.id}>{note.text}</p>
          ))}
        </div>
      )}
    </div>
  );
}

type DiagramViewBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function diagramViewBox(
  nodes: Array<Pick<DiagramNode, "x" | "y">>,
  nodeWidthPct: number,
  nodeHeightPct: number,
): DiagramViewBox {
  if (nodes.length === 0) return { x: 0, y: 0, width: 100, height: 100 };

  const halfWidth = nodeWidthPct / 2;
  const halfHeight = nodeHeightPct / 2;
  const left = Math.min(...nodes.map((node) => (node.x ?? 50) - halfWidth));
  const right = Math.max(...nodes.map((node) => (node.x ?? 50) + halfWidth));
  const top = Math.min(...nodes.map((node) => (node.y ?? 50) - halfHeight));
  const bottom = Math.max(...nodes.map((node) => (node.y ?? 50) + halfHeight));

  const x = Math.min(0, left);
  const y = Math.min(0, top);
  const width = Math.max(100, right) - x;
  const height = Math.max(100, bottom) - y;

  return { x, y, width, height };
}

function diagramPointPercent(
  value: number,
  viewBoxStart: number,
  viewBoxSize: number,
  margin = 0,
): number {
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(viewBoxSize) ||
    !viewBoxSize
  ) {
    return 50;
  }
  const percent = ((value - viewBoxStart) / viewBoxSize) * 100;
  return Math.min(100 - margin, Math.max(margin, percent));
}

function diagramRows(
  nodes: Array<Pick<DiagramNode, "y">>,
  compact?: boolean,
): number[] {
  const rowGap = compact ? 8 : 10;
  return [...nodes]
    .sort((a, b) => (a.y ?? 50) - (b.y ?? 50))
    .reduce<number[]>((acc, node) => {
      const y = node.y ?? 50;
      const last = acc[acc.length - 1];
      if (last == null || Math.abs(y - last) >= rowGap) acc.push(y);
      return acc;
    }, []);
}

function diagramRowPointPercent(
  value: number,
  rows: number[],
  viewBox: DiagramViewBox,
  margin: number,
): number {
  if (rows.length <= 2) {
    return diagramPointPercent(value, viewBox.y, viewBox.height, margin);
  }
  const closestIndex = rows.reduce((bestIndex, row, index) => {
    const bestDistance = Math.abs((rows[bestIndex] ?? 50) - value);
    return Math.abs(row - value) < bestDistance ? index : bestIndex;
  }, 0);
  const span = 100 - margin * 2;
  return margin + (span * closestIndex) / Math.max(1, rows.length - 1);
}

function diagramCanvasHeight(rows: number, compact?: boolean): number {
  const base = compact ? 280 : 430;
  if (rows <= 2) return base;
  return Math.max(base, rows * (compact ? 140 : 190) + (compact ? 80 : 120));
}

function SequenceDiagram({
  data,
  compact,
  direction,
  showFrame,
}: {
  data: DiagramData;
  compact?: boolean;
  direction?: BlockRenderContext["textDirection"];
  showFrame: boolean;
}) {
  const edges = data.edges ?? [];
  const nodes = orderDiagramNodes(data.nodes ?? [], edges);
  if (nodes.length === 0) {
    return (
      <div className="rounded-[12px] border border-border bg-muted p-4 text-sm text-muted-foreground">
        Diagram content is empty.
      </div>
    );
  }
  const visualNodes = direction === "rtl" ? [...nodes].reverse() : nodes;
  return (
    <div
      className={cn(
        "plan-sketch",
        showFrame ? "rounded-[16px] border border-border bg-muted p-5" : "p-0",
      )}
      dir={direction}
      data-text-direction={direction}
    >
      <div
        className={cn(
          "flex gap-3 overflow-x-auto pb-2",
          compact ? "items-center" : "items-stretch",
        )}
      >
        {visualNodes.map((node, index) => {
          const next = visualNodes[index + 1];
          const edge = next
            ? edges.find(
                (candidate) =>
                  (candidate.from === node.id && candidate.to === next.id) ||
                  (candidate.from === next.id && candidate.to === node.id),
              )
            : undefined;
          return (
            <div key={node.id} className="flex min-w-max items-center gap-3">
              <article
                className={cn(
                  "w-[180px] rounded-xl border-2 border-border bg-background p-3 text-foreground",
                  compact && "w-[150px]",
                )}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {index + 1}
                </p>
                <h3 className="mt-2 text-base font-semibold leading-tight">
                  {node.label}
                </h3>
                {node.detail && !compact && (
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {node.detail}
                  </p>
                )}
              </article>
              {next && (
                <div className="grid min-w-[72px] justify-items-center gap-1 text-muted-foreground">
                  {edge?.label && (
                    <span className="max-w-[96px] whitespace-normal break-words rounded-full border border-border px-2 py-0.5 text-center text-[11px] font-semibold [overflow-wrap:anywhere]">
                      {edge.label}
                    </span>
                  )}
                  <span className="h-0.5 w-full rounded-full border-t-2 border-dashed border-border" />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {data.notes && data.notes.length > 0 && !compact && (
        <div className="mt-4 grid gap-2 border-t border-border pt-4 text-sm text-muted-foreground md:grid-cols-2">
          {data.notes.map((note) => (
            <p key={note.id}>{note.text}</p>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The diagram body. Routes to the preferred HTML/SVG path (when `data.html` is
 * set) and otherwise to a legacy node-graph path (positioned canvas when nodes
 * carry x/y, else an ordered sequence). Used both inline and, scaled up, inside
 * the expand lightbox — so every variant (html/css, positioned, sequence)
 * enlarges through the same code path.
 */
function DiagramBody({
  data,
  ctx,
  compact,
}: {
  data: DiagramData;
  ctx: BlockRenderContext;
  compact?: boolean;
}) {
  const markerId = useId().replace(/:/g, "");
  const showFrame = resolveVisualFrame(data.frame, ctx);
  if (data.html?.trim()) {
    return <HtmlDiagram data={data} ctx={ctx} compact={compact} />;
  }
  if (hasPositionedDiagramNodes(data)) {
    return (
      <PositionedDiagram
        data={data}
        compact={compact}
        markerId={markerId}
        direction={ctx.textDirection}
        showFrame={showFrame}
      />
    );
  }
  return (
    <SequenceDiagram
      data={data}
      compact={compact}
      direction={ctx.textDirection}
      showFrame={showFrame}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Expand / lightbox                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Enlarge overlay for a rendered diagram. Mirrors the image lightbox contract
 * used by the composer's `ImagePreviewLightbox` (PromptComposer.tsx) so the
 * expand affordance feels identical to viewing an image full-size: a fixed
 * `bg-black/80` backdrop, Escape to close, click-the-backdrop to close, and a
 * top-right close button. Unlike the image variant this renders arbitrary
 * children (the diagram body re-rendered larger) rather than an `<img>`, since a
 * diagram is live HTML/SVG/node-graph markup, not an image URL.
 *
 * Exported so the separate Mermaid block (`MermaidBlock.tsx`, which renders its
 * diagram to an SVG through a different runtime) can reuse the exact same
 * lightbox contract — one expand affordance shared across both diagram types.
 */
export function DiagramLightbox({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Diagram preview"
      onClick={onClose}
      data-plan-interactive
      className="fixed inset-0 z-[300] flex items-center justify-center overflow-auto bg-black/80 p-6 cursor-zoom-out"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-full w-full max-w-5xl cursor-default overflow-auto rounded-md bg-background p-6 shadow-2xl"
      >
        {children}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close preview"
        className="absolute right-4 top-4 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-white/30 bg-black/40 text-white hover:bg-black/60"
      >
        <IconX className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * The diagram body plus a hover-revealed top-right "expand" button (like the
 * image attachment zoom). Opening the button re-renders the exact same
 * `DiagramBody` inside `DiagramLightbox` at a larger size, so html/css and
 * mermaid/legacy node-graph diagrams alike enlarge through one path. The inline
 * (non-expanded) render is otherwise unchanged.
 */
function ExpandableDiagramBody({
  data,
  ctx,
  compact,
}: {
  data: DiagramData;
  ctx: BlockRenderContext;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const supportsStyleToggle = Boolean(data.html);
  const style = useWireframeStyle();
  const copy = useBlockCopy();
  const sketchy = style === "sketchy";
  const styleLabel = sketchy
    ? copy.switchToCleanDiagrams
    : copy.switchToHandDrawnDiagrams;
  const styleTooltip = sketchy
    ? copy.handDrawnDiagramsSwitch
    : copy.cleanDiagramsSwitch;
  return (
    <div className="group/diagram relative">
      <DiagramBody data={data} ctx={ctx} compact={compact} />
      <TooltipProvider delayDuration={100} skipDelayDuration={0}>
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
          {supportsStyleToggle && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-plan-interactive
                  onClick={() => toggleWireframeStyle()}
                  aria-label={styleLabel}
                  aria-pressed={sketchy}
                  className="an-diagram-style-trigger flex size-7 items-center justify-center rounded-md border border-border/60 bg-background text-muted-foreground opacity-0 shadow-sm transition-[color,opacity] hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover/diagram:opacity-100"
                >
                  {sketchy ? (
                    <IconScribble className="size-4" />
                  ) : (
                    <IconShape2 className="size-4" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">{styleTooltip}</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-plan-interactive
                onClick={() => setExpanded(true)}
                aria-label={copy.expandDiagram}
                className="an-diagram-expand-trigger flex size-7 items-center justify-center rounded-md border border-border/60 bg-background text-muted-foreground opacity-0 shadow-sm transition-[color,opacity] hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover/diagram:opacity-100"
              >
                <IconArrowsMaximize className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">{copy.expandDiagram}</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
      {expanded ? (
        <DiagramLightbox onClose={() => setExpanded(false)}>
          <DiagramBody data={data} ctx={ctx} />
        </DiagramLightbox>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Read + Edit                                                                 */
/* -------------------------------------------------------------------------- */

/** Read-only renderer: the diagram body wrapped in the standard titled block. */
export function DiagramRead({
  data,
  blockId,
  title,
  summary,
  ctx,
  compactVisuals,
}: BlockReadProps<DiagramData>) {
  return (
    <section
      {...ltrCodeBlockProps}
      className="an-block plan-block"
      data-block-id={blockId}
    >
      {title && <div className="an-block-label plan-block-label">{title}</div>}
      <ExpandableDiagramBody data={data} ctx={ctx} compact={compactVisuals} />
      {summary && <p className="mt-5 text-muted-foreground">{summary}</p>}
    </section>
  );
}

/**
 * Edit form (panel surface). The block can be an HTML/SVG fragment or a legacy
 * node/edge/note graph, so this exposes html/css/caption plus a collapsible
 * legacy node-graph JSON editor, each with an AI-edit affordance via
 * `ctx.renderAiFieldAction` (through `AiEditableFieldLabel`). `editSurface:
 * "panel"` means the registry renders the `Read` view with a corner edit button
 * that opens this form in the app-provided popover.
 */
export function DiagramEdit({
  data,
  onChange,
  editable,
  blockId,
  title,
  summary,
  ctx,
}: BlockEditProps<DiagramData>) {
  const htmlId = useId();
  const cssId = useId();
  const captionId = useId();
  const legacyId = useId();
  const [html, setHtml] = useState(data.html ?? "");
  const [css, setCss] = useState(data.css ?? "");
  const [caption, setCaption] = useState(data.caption ?? "");
  const [legacyJson, setLegacyJson] = useState(() =>
    JSON.stringify(
      {
        nodes: data.nodes ?? [],
        edges: data.edges ?? [],
        notes: data.notes ?? [],
      },
      null,
      2,
    ),
  );

  useEffect(() => {
    setHtml(data.html ?? "");
    setCss(data.css ?? "");
    setCaption(data.caption ?? "");
    setLegacyJson(
      JSON.stringify(
        {
          nodes: data.nodes ?? [],
          edges: data.edges ?? [],
          notes: data.notes ?? [],
        },
        null,
        2,
      ),
    );
  }, [data]);

  const saveHtmlDiagram = () => {
    onChange({
      html: html.trim() || undefined,
      css: css.trim() || undefined,
      caption: caption.trim() || undefined,
      nodes: data.nodes,
      edges: data.edges,
      notes: data.notes,
    });
  };

  const saveLegacyDiagram = () => {
    const parsed = JSON.parse(legacyJson) as Pick<
      DiagramData,
      "nodes" | "edges" | "notes"
    >;
    onChange({
      ...data,
      nodes: parsed.nodes ?? [],
      edges: parsed.edges ?? [],
      notes: parsed.notes ?? [],
    });
  };

  const fieldAction = (
    field: "HTML / SVG fragment" | "CSS" | "caption" | "legacy node graph JSON",
    value: string,
  ) => ({
    blockId,
    blockType: "diagram",
    blockTitle: title,
    blockSummary: summary,
    fieldValue: value,
    draftScope: `block:diagram:${blockId}:${field.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    disabled: !editable,
    instructions:
      "Update the plan with update-visual-plan using a targeted update-block content patch for this diagram block id. Preserve unrelated diagram fields unless the requested edit requires changing them. Keep diagram HTML/CSS on renderer-owned .diagram-* primitives and --wf-* tokens; do not introduce custom font-family or hard-coded hex/rgb/hsl colors.",
    companionFields: [
      {
        label: "HTML / SVG fragment",
        value: html.trim() || "(empty)",
        language: "html",
      },
      { label: "CSS", value: css.trim() || "(empty)", language: "css" },
      {
        label: "caption",
        value: caption.trim() || "(empty)",
        language: "text",
      },
    ],
  });

  return (
    <div className="grid gap-4" data-plan-interactive>
      <button
        type="button"
        className="inline-flex h-8 w-fit items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
        disabled={!editable}
        onClick={saveHtmlDiagram}
      >
        Save diagram
      </button>
      <div className="group/field grid gap-1.5">
        <AiEditableFieldLabel
          htmlFor={htmlId}
          label="HTML / SVG fragment"
          ctx={ctx}
          action={fieldAction("HTML / SVG fragment", html)}
        />
        <textarea
          id={htmlId}
          className="min-h-48 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-5 text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={html}
          disabled={!editable}
          onChange={(event) => setHtml(event.target.value)}
          placeholder="<div class='diagram'>...</div>"
        />
      </div>
      <div className="group/field grid gap-1.5">
        <AiEditableFieldLabel
          htmlFor={cssId}
          label="CSS"
          ctx={ctx}
          action={fieldAction("CSS", css)}
        />
        <textarea
          id={cssId}
          className="min-h-32 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-5 text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={css}
          disabled={!editable}
          onChange={(event) => setCss(event.target.value)}
          placeholder=".diagram { display: grid; }"
        />
      </div>
      <div className="group/field grid gap-1.5">
        <AiEditableFieldLabel
          htmlFor={captionId}
          label="Caption"
          ctx={ctx}
          action={fieldAction("caption", caption)}
        />
        <input
          id={captionId}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={caption}
          disabled={!editable}
          onChange={(event) => setCaption(event.target.value)}
        />
      </div>
      {!data.html && (
        <details className="rounded-md border border-border p-3">
          <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
            Legacy node graph data
          </summary>
          <div className="group/field mt-3 grid gap-1.5">
            <AiEditableFieldLabel
              htmlFor={legacyId}
              label="JSON"
              ctx={ctx}
              action={fieldAction("legacy node graph JSON", legacyJson)}
            />
            <textarea
              id={legacyId}
              className="min-h-44 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-5 text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={legacyJson}
              disabled={!editable}
              onChange={(event) => setLegacyJson(event.target.value)}
            />
          </div>
          <button
            type="button"
            className="mt-3 inline-flex h-8 items-center justify-center rounded-md border border-input px-3 text-xs font-medium text-foreground disabled:opacity-50"
            disabled={!editable}
            onClick={saveLegacyDiagram}
          >
            Save graph data
          </button>
        </details>
      )}
    </div>
  );
}

/** Full client spec for the shared `diagram` block (schema + MDX + Read/Edit). */
export const diagramBlock = defineBlock<DiagramData>({
  type: "diagram",
  schema: diagramSchema,
  mdx: diagramMdx,
  Read: DiagramRead,
  Edit: DiagramEdit,
  placement: ["block"],
  // Config-driven: the rendered diagram differs from its raw html/css source, so
  // edit from a corner button + panel rather than inline.
  editSurface: "panel",
  label: "Diagram",
  description:
    "A flexible inline architecture/code diagram. Prefer html/css with SVG or semantic HTML for polished two-dimensional layouts; use .diagram-* primitives and --wf-* tokens for theme/sketch compatibility. Legacy nodes/edges are only for simple previews.",
  // Seed the legacy fallback shape so a fresh block validates while agents can
  // replace it with html/css when layout quality matters.
  empty: () => ({ nodes: [{ id: "n1", label: "Module" }], edges: [] }),
});
