import {
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { IconPencil } from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import type {
  PlanDiagramBlock,
  PlanLegacyWireframeBlock,
  PlanWireframeBlock,
  PlanWireframeSurface,
} from "@shared/plan-content";
import { LegacyRegionWireframe } from "./LegacyRegionWireframe";
import {
  HTML_ROUGH_SELECTOR,
  KitConfigContext,
  RoughOverlay,
  Screen,
  renderNodes,
} from "./kit";
import { toggleWireframeStyle, useWireframeStyle } from "./use-wireframe-style";
import {
  sanitizeDiagramHtml,
  sanitizeWireframeCss,
  sanitizeWireframeHtml,
  scopeDesignCss,
} from "./sanitize-html";
import {
  RUNTIME_SENTINEL_ATTR,
  mountPrototypeRuntime,
} from "./prototype-runtime";
import { renderWireframeIconHtml } from "./wireframe-icons";
import "./html-artboard.css";

/**
 * Wireframe renderer.
 *
 * PRIMARY PATH — an HTML mockup (`data.html`). The model writes a plain semantic
 * HTML screen; the renderer owns the surface footprint/aspect, the dark/light
 * theme, the hand-drawn font, and the rough.js sketch overlay. Everything is
 * laid out by the model's own (real) HTML/CSS, so there is no geometry to place.
 *
 * KIT PATH — declarative kit tree (`data.screen`). Kept for older plans; the
 * shared kit owns flex layout, fonts, spacing, and the same rough overlay.
 *
 * LEGACY PATH — coordinate region fallback for the oldest imported plans.
 *
 * All three paths share one frame shell (surface-locked aspect, theme, rough
 * overlay, clean-mode crisp frame) via `ArtboardFrame`.
 */

type SurfacePreset = {
  width: number;
  height: number;
  radius: number;
};

const SURFACE_PRESETS: Record<PlanWireframeSurface, SurfacePreset> = {
  mobile: { width: 300, height: 624, radius: 30 },
  desktop: { width: 840, height: 520, radius: 14 },
  browser: { width: 900, height: 560, radius: 14 },
  popover: { width: 360, height: 360, radius: 16 },
  panel: { width: 420, height: 560, radius: 16 },
};

type WireframeData =
  | PlanWireframeBlock["data"]
  | PlanLegacyWireframeBlock["data"];

export type DesignElementSelection = {
  frameId?: string;
  blockId?: string;
  elementId: string;
  tagName: string;
  className: string;
  inlineStyle: string;
  text: string;
  computedStyles: Record<string, string>;
};

function isHtmlData(data: WireframeData): data is PlanWireframeBlock["data"] {
  const html = (data as PlanWireframeBlock["data"]).html;
  return typeof html === "string" && html.trim().length > 0;
}

function isKitTreeData(
  data: WireframeData,
): data is PlanWireframeBlock["data"] {
  return Array.isArray((data as PlanWireframeBlock["data"]).screen);
}

export function Wireframe({
  data,
  compact,
  canvasSize,
  canvasWidth,
  interactive,
  frameId,
  blockId,
  selectedDesignElementKey,
  onDesignElementSelect,
}: {
  data: WireframeData;
  compact?: boolean;
  canvasSize?: number;
  canvasWidth?: number;
  interactive?: boolean;
  frameId?: string;
  blockId?: string;
  selectedDesignElementKey?: string | null;
  onDesignElementSelect?: (selection: DesignElementSelection) => void;
}) {
  if (isHtmlData(data)) {
    return (
      <HtmlArtboard
        data={data}
        compact={compact}
        canvasSize={canvasSize}
        canvasWidth={canvasWidth}
        interactive={interactive}
        frameId={frameId}
        blockId={blockId}
        selectedDesignElementKey={selectedDesignElementKey}
        onDesignElementSelect={onDesignElementSelect}
      />
    );
  }
  if (isKitTreeData(data)) {
    return (
      <KitWireframe
        data={data}
        compact={compact}
        canvasSize={canvasSize}
        canvasWidth={canvasWidth}
      />
    );
  }
  return (
    <LegacyRegionWireframe
      data={data}
      compact={compact}
      canvasSize={canvasSize}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Shared frame shell: surface-locked aspect + theme + rough overlay.         */
/* -------------------------------------------------------------------------- */

function ArtboardFrame({
  surface,
  compact,
  canvasSize,
  canvasWidth,
  skeleton,
  renderMode,
  roughOverlay = true,
  selector,
  caption,
  render,
}: {
  surface: PlanWireframeSurface;
  compact?: boolean;
  canvasSize?: number;
  canvasWidth?: number;
  skeleton?: boolean;
  renderMode?: "wireframe" | "design";
  roughOverlay?: boolean;
  selector: string;
  caption?: string;
  render: (ctx: {
    theme: "light" | "dark";
    style: "sketchy" | "clean";
  }) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fitRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const theme: "light" | "dark" = resolvedTheme === "dark" ? "dark" : "light";
  const style = useWireframeStyle();
  const preset = SURFACE_PRESETS[surface] ?? SURFACE_PRESETS.desktop;
  const height = canvasSize ?? preset.height;
  const width = canvasWidth ?? preset.width;
  const baseScale = compact ? Math.min(1, 320 / preset.width) : 1;
  const maxFrameWidth = compact ? preset.width * baseScale : width;
  const [fitScale, setFitScale] = useState(baseScale);
  const designMode = renderMode === "design";
  const sketchy = !designMode && style === "sketchy" && !skeleton;
  const roughEnabled = sketchy && roughOverlay;
  const paper = designMode
    ? "hsl(var(--background))"
    : "var(--plan-document, hsl(var(--background)))";
  // Frame border for clean + skeleton modes (sketchy draws its frame via the
  // rough overlay). Soft, matching --wf-line — not hard ink. Skeleton uses its
  // own neutral fill so the loader frame still reads as a frame.
  const frameBorder = skeleton
    ? "var(--plan-placeholder-line, var(--plan-line, hsl(var(--border))))"
    : "var(--plan-line, hsl(var(--border)))";

  useEffect(() => {
    const element = fitRef.current;
    if (!element) return;
    const measure = () => {
      const availableWidth = element.clientWidth;
      const nextScale =
        availableWidth > 0
          ? Math.min(baseScale, availableWidth / width)
          : baseScale;
      setFitScale((current) =>
        Math.abs(current - nextScale) < 0.001 ? current : nextScale,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [baseScale, width]);

  return (
    <div
      ref={fitRef}
      className="plan-kit-wireframe"
      style={{
        width: "100%",
        maxWidth: maxFrameWidth,
      }}
    >
      <div
        className="group/wireframe-artboard relative"
        style={{
          width: "100%",
          maxWidth: maxFrameWidth,
          height: height * fitScale,
          marginInline: "auto",
        }}
      >
        <div
          ref={ref}
          className="plan-kit-artboard relative"
          data-rough-scope="wireframe"
          style={{
            width,
            height,
            borderRadius: preset.radius,
            background: paper,
            ...(fitScale !== 1
              ? {
                  transform: `scale(${fitScale})`,
                  transformOrigin: "top left",
                }
              : {}),
          }}
        >
          <div
            className="absolute inset-0 overflow-hidden"
            style={{ borderRadius: preset.radius }}
          >
            {render({ theme, style })}
          </div>
          {/* Clean + skeleton draw a crisp rounded frame (un-clipped, so corners
              are never cut, and a skeleton frame still reads as a frame). Sketchy
              mode gets its frame from the rough overlay unless the caller needs
              all borders to stay in the normal scrolling DOM. */}
          {!roughEnabled && (
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                borderRadius: preset.radius,
                border: `1.5px solid ${frameBorder}`,
              }}
            />
          )}
          <RoughOverlay
            scopeRef={ref}
            enabled={roughEnabled}
            frameRadius={preset.radius}
            selector={selector}
          />
        </div>
        {!designMode && !skeleton && <WireframeStyleToggleButton />}
      </div>
      {caption && (
        <p className="mt-2 text-center text-xs text-plan-muted">{caption}</p>
      )}
    </div>
  );
}

function WireframeStyleToggleButton() {
  const style = useWireframeStyle();
  const nextStyle = style === "sketchy" ? "clean" : "sketchy";
  const label = nextStyle === "clean" ? "Clean" : "Sketchy";
  const description = `Switch to ${label.toLowerCase()} visual style`;

  return (
    <button
      type="button"
      data-plan-interactive
      data-rough="none"
      data-wireframe-style-toggle
      aria-label={description}
      title={description}
      onClick={(event) => {
        event.stopPropagation();
        toggleWireframeStyle();
      }}
      className="absolute right-2 top-2 z-30 inline-flex h-7 items-center gap-1 rounded-md border border-border/60 bg-background/90 px-2 text-xs font-medium text-muted-foreground opacity-0 shadow-sm backdrop-blur transition-[color,opacity] hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover/wireframe-artboard:opacity-100"
    >
      <IconPencil className="size-3.5" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* HTML artboard — model-authored HTML, themed + roughened by the renderer.   */
/* -------------------------------------------------------------------------- */

function HtmlArtboard({
  data,
  compact,
  canvasSize,
  canvasWidth,
  interactive,
  frameId,
  blockId,
  selectedDesignElementKey,
  onDesignElementSelect,
}: {
  data: PlanWireframeBlock["data"];
  compact?: boolean;
  canvasSize?: number;
  canvasWidth?: number;
  interactive?: boolean;
  frameId?: string;
  blockId?: string;
  selectedDesignElementKey?: string | null;
  onDesignElementSelect?: (selection: DesignElementSelection) => void;
}) {
  // Sanitize model-authored HTML at the render point (defense-in-depth against
  // stored XSS) — see sanitize-html.ts. Memoized so it only re-runs when the
  // html changes, not on every theme/zoom re-render.
  const safeHtml = useMemo(
    () => renderWireframeIconHtml(sanitizeWireframeHtml(data.html)),
    [data.html],
  );
  const renderMode = data.renderMode ?? "wireframe";
  const designMode = renderMode === "design";
  const scopeId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const scopeSelector = `[data-plan-design-scope="${scopeId}"]`;
  const scopedCss = useMemo(() => {
    const safeCss = sanitizeWireframeCss(data.css);
    return scopeDesignCss(safeCss, scopeSelector);
  }, [data.css, scopeSelector]);
  const htmlRef = useRef<HTMLDivElement>(null);
  const runtimeCleanupRef = useRef<(() => void) | null>(null);
  const runtimeTimerRef = useRef<number | null>(null);
  const cleanupRuntime = useCallback(() => {
    if (runtimeTimerRef.current !== null) {
      window.clearTimeout(runtimeTimerRef.current);
      runtimeTimerRef.current = null;
    }
    runtimeCleanupRef.current?.();
    runtimeCleanupRef.current = null;
  }, []);

  useEffect(() => {
    const node = htmlRef.current;
    if (!interactive || !node) {
      cleanupRuntime();
      return;
    }
    if (node.querySelector(`[${RUNTIME_SENTINEL_ATTR}]`)) return;
    cleanupRuntime();
    if (interactive && node) {
      runtimeTimerRef.current = window.setTimeout(() => {
        runtimeTimerRef.current = null;
        if (htmlRef.current === node) {
          runtimeCleanupRef.current = mountPrototypeRuntime(node);
        }
      }, 0);
    }
  });

  useEffect(() => cleanupRuntime, [cleanupRuntime]);

  useEffect(() => {
    if (!designMode) return;
    const root = htmlRef.current;
    if (!root) return;
    root
      .querySelectorAll("[data-plan-design-selected]")
      .forEach((node) => node.removeAttribute("data-plan-design-selected"));
    if (!selectedDesignElementKey) return;
    const [selectedFrameId, selectedBlockId, selectedElementId] =
      selectedDesignElementKey.split("::");
    if (
      selectedFrameId !== (frameId ?? "") ||
      selectedBlockId !== (blockId ?? "") ||
      !selectedElementId
    ) {
      return;
    }
    const target = Array.from(
      root.querySelectorAll<HTMLElement>(
        "[data-design-id], [data-plan-design-id]",
      ),
    ).find(
      (candidate) =>
        candidate.getAttribute("data-design-id") === selectedElementId ||
        candidate.getAttribute("data-plan-design-id") === selectedElementId,
    );
    target?.setAttribute("data-plan-design-selected", "true");
  }, [blockId, designMode, frameId, selectedDesignElementKey, safeHtml]);

  const handleDesignClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!designMode || !onDesignElementSelect) return;
      const root = htmlRef.current;
      const rawTarget = event.target;
      if (!root || !(rawTarget instanceof HTMLElement)) return;
      const target = rawTarget.closest<HTMLElement>(
        "[data-design-id], [data-plan-design-id]",
      );
      if (!target || !root.contains(target)) return;
      event.preventDefault();
      event.stopPropagation();
      const computed = window.getComputedStyle(target);
      onDesignElementSelect({
        frameId,
        blockId,
        elementId:
          target.getAttribute("data-design-id") ??
          target.getAttribute("data-plan-design-id") ??
          "",
        tagName: target.tagName.toLowerCase(),
        className: target.getAttribute("class") ?? "",
        inlineStyle: target.getAttribute("style") ?? "",
        text: (target.textContent ?? "").trim().slice(0, 120),
        computedStyles: {
          color: computed.color,
          backgroundColor: computed.backgroundColor,
          fontFamily: computed.fontFamily,
          fontSize: computed.fontSize,
          fontWeight: computed.fontWeight,
          borderRadius: computed.borderRadius,
          padding: computed.padding,
          margin: computed.margin,
        },
      });
    },
    [blockId, designMode, frameId, onDesignElementSelect],
  );

  return (
    <ArtboardFrame
      surface={data.surface}
      compact={compact}
      canvasSize={canvasSize}
      canvasWidth={canvasWidth}
      skeleton={data.skeleton}
      renderMode={renderMode}
      roughOverlay={!interactive}
      selector={HTML_ROUGH_SELECTOR}
      caption={data.caption}
      render={({ theme, style }) => (
        <div
          ref={htmlRef}
          className="plan-html-frame"
          data-theme={theme}
          data-style={style}
          data-render-mode={renderMode}
          data-plan-design-scope={scopeId}
          data-skeleton={data.skeleton ? "true" : undefined}
          data-prototype-live={interactive ? "true" : undefined}
          onClick={handleDesignClick}
        >
          {scopedCss && <style>{scopedCss}</style>}
          <div
            className="plan-html-frame-content"
            dangerouslySetInnerHTML={{ __html: safeHtml }}
          />
        </div>
      )}
    />
  );
}

export function KitWireframeBlock({
  block,
  compact,
}: {
  block: PlanWireframeBlock;
  compact?: boolean;
}) {
  return <Wireframe data={block.data} compact={compact} />;
}

export function KitWireframePreview({
  data,
  compact = true,
  className,
}: {
  data: PlanWireframeBlock["data"];
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <KitWireframe data={data} compact={compact} />
    </div>
  );
}

function KitWireframe({
  data,
  compact,
  canvasSize,
  canvasWidth,
}: {
  data: PlanWireframeBlock["data"];
  compact?: boolean;
  canvasSize?: number;
  canvasWidth?: number;
}) {
  return (
    <ArtboardFrame
      surface={data.surface}
      compact={compact}
      canvasSize={canvasSize}
      canvasWidth={canvasWidth}
      skeleton={data.skeleton}
      selector="[data-rough]"
      caption={data.caption}
      render={({ theme, style }) => (
        <KitConfigContext.Provider
          value={{ skeleton: data.skeleton, theme, style }}
        >
          {renderKitScreen(data.screen ?? [])}
        </KitConfigContext.Provider>
      )}
    />
  );
}

function renderKitScreen(
  nodes: NonNullable<PlanWireframeBlock["data"]["screen"]>,
): ReactNode {
  if (nodes.length === 1 && nodes[0]?.el === "screen") {
    return renderNodes(nodes);
  }
  return (
    <Screen pad="calc(var(--pad) * 1.35)" style={{ height: "100%" }}>
      {renderNodes(nodes)}
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */
/* SketchDiagram — document + canvas import it from this module               */
/* -------------------------------------------------------------------------- */

const DIAGRAM_ROUGH_SELECTOR =
  "[data-rough],.diagram-panel,.diagram-node,.diagram-box,.diagram-pill,.diagram-card,[class*='card'],[class*='box'],[class*='panel'],[class*='pill'],[class*='chip'],[class*='badge'],hr";

export function SketchDiagram({
  data,
  compact,
}: {
  data: PlanDiagramBlock["data"];
  compact?: boolean;
}) {
  if (data.html?.trim()) {
    return <HtmlDiagram data={data} compact={compact} />;
  }

  const markerId = useId().replace(/:/g, "");
  if (hasPositionedDiagramNodes(data)) {
    return (
      <PositionedSketchDiagram
        data={data}
        compact={compact}
        markerId={markerId}
      />
    );
  }

  const edges = data.edges ?? [];
  const nodes = orderDiagramNodes(data.nodes ?? [], edges);
  if (nodes.length === 0) {
    return (
      <div className="rounded-[12px] border border-plan-line bg-plan-block p-4 text-sm text-plan-muted">
        Diagram content is empty.
      </div>
    );
  }
  return (
    <div className="plan-sketch rounded-[16px] border border-plan-line bg-plan-wireframe p-5">
      <div
        className={cn(
          "flex gap-3 overflow-x-auto pb-2",
          compact ? "items-center" : "items-stretch",
        )}
      >
        {nodes.map((node, index) => {
          const next = nodes[index + 1];
          const edge = next
            ? edges.find(
                (candidate) =>
                  candidate.from === node.id && candidate.to === next.id,
              )
            : undefined;
          return (
            <div key={node.id} className="flex min-w-max items-center gap-3">
              <article
                className={cn(
                  "w-[180px] rounded-xl border-2 border-plan-sketch-line bg-plan-document p-3 text-plan-text",
                  compact && "w-[150px]",
                )}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-plan-muted">
                  {index + 1}
                </p>
                <h3 className="mt-2 text-base font-semibold leading-tight">
                  {node.label}
                </h3>
                {node.detail && !compact && (
                  <p className="mt-2 text-xs leading-5 text-plan-muted">
                    {node.detail}
                  </p>
                )}
              </article>
              {next && (
                <div className="grid min-w-[72px] justify-items-center gap-1 text-plan-muted">
                  {edge?.label && (
                    <span className="max-w-[96px] truncate rounded-full border border-plan-line px-2 py-0.5 text-[11px] font-semibold">
                      {edge.label}
                    </span>
                  )}
                  <span className="h-0.5 w-full rounded-full border-t-2 border-dashed border-plan-muted-line" />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {data.notes && data.notes.length > 0 && !compact && (
        <div className="mt-4 grid gap-2 border-t border-plan-line pt-4 text-sm text-plan-muted md:grid-cols-2">
          {data.notes.map((note) => (
            <p key={note.id}>{note.text}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function HtmlDiagram({
  data,
  compact,
}: {
  data: PlanDiagramBlock["data"];
  compact?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const theme: "light" | "dark" = resolvedTheme === "dark" ? "dark" : "light";
  const style = useWireframeStyle();
  const scopeId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const scopeSelector = `[data-plan-diagram-scope="${scopeId}"]`;
  const safeHtml = useMemo(() => sanitizeDiagramHtml(data.html), [data.html]);
  const scopedCss = useMemo(() => {
    const safeCss = sanitizeWireframeCss(data.css);
    return scopeDesignCss(safeCss, scopeSelector);
  }, [data.css, scopeSelector]);

  return (
    <div
      ref={ref}
      className={cn("plan-diagram-shell", compact && "plan-diagram-compact")}
    >
      <div
        className="plan-diagram-frame"
        data-theme={theme}
        data-style={style}
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
        drawFrame={false}
        selector={DIAGRAM_ROUGH_SELECTOR}
      />
      {data.caption && !compact && (
        <p className="mt-3 text-sm leading-6 text-plan-muted">{data.caption}</p>
      )}
    </div>
  );
}

function PositionedSketchDiagram({
  data,
  compact,
  markerId,
}: {
  data: PlanDiagramBlock["data"];
  compact?: boolean;
  markerId: string;
}) {
  const nodes = (data.nodes ?? []).map((node) => ({
    ...node,
    x: clampDiagramPercent(node.x ?? 50),
    y: clampDiagramPercent(node.y ?? 50),
  }));
  const edges = data.edges ?? [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const arrowId = `${markerId}-diagram-arrow`;
  const nodeWidth = compact ? 150 : 190;
  const canvasHeight = compact ? 280 : 430;

  return (
    <div className="plan-sketch rounded-[16px] border border-plan-line bg-plan-wireframe p-5">
      <div
        className="relative overflow-hidden rounded-xl border border-plan-line bg-plan-document"
        style={{ minHeight: canvasHeight }}
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
              <path d="M 0 0 L 10 5 L 0 10 z" className="fill-plan-muted" />
            </marker>
          </defs>
          {edges.map((edge, index) => {
            const from = nodeById.get(edge.from);
            const to = nodeById.get(edge.to);
            if (!from || !to) return null;
            return (
              <line
                key={`${edge.from}-${edge.to}-${index}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                markerEnd={`url(#${arrowId})`}
                vectorEffect="non-scaling-stroke"
                className="stroke-plan-muted-line"
                strokeWidth={2}
                strokeDasharray={edge.label ? "0" : "6 5"}
              />
            );
          })}
        </svg>

        {!compact &&
          edges.map((edge, index) => {
            const from = nodeById.get(edge.from);
            const to = nodeById.get(edge.to);
            if (!edge.label || !from || !to) return null;
            return (
              <span
                key={`${edge.from}-${edge.to}-${index}-label`}
                className="absolute z-10 max-w-[130px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-plan-line bg-plan-document px-2 py-0.5 text-center text-[11px] font-semibold text-plan-muted shadow-sm"
                style={{
                  left: `${(from.x + to.x) / 2}%`,
                  top: `${(from.y + to.y) / 2}%`,
                }}
              >
                {edge.label}
              </span>
            );
          })}

        {nodes.map((node, index) => (
          <article
            key={node.id}
            className="absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded-xl border-2 border-plan-sketch-line bg-plan-document p-3 text-plan-text shadow-sm"
            style={{
              left: `${node.x}%`,
              top: `${node.y}%`,
              width: nodeWidth,
            }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-plan-muted">
              {index + 1}
            </p>
            <h3 className="mt-2 text-base font-semibold leading-tight">
              {node.label}
            </h3>
            {node.detail && !compact && (
              <p className="mt-2 text-xs leading-5 text-plan-muted">
                {node.detail}
              </p>
            )}
          </article>
        ))}
      </div>
      {data.notes && data.notes.length > 0 && !compact && (
        <div className="mt-4 grid gap-2 border-t border-plan-line pt-4 text-sm text-plan-muted md:grid-cols-2">
          {data.notes.map((note) => (
            <p key={note.id}>{note.text}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function hasPositionedDiagramNodes(data: PlanDiagramBlock["data"]) {
  const nodes = data.nodes ?? [];
  return (
    nodes.length > 0 &&
    nodes.every(
      (node) =>
        typeof node.x === "number" &&
        Number.isFinite(node.x) &&
        typeof node.y === "number" &&
        Number.isFinite(node.y),
    )
  );
}

function clampDiagramPercent(value: number) {
  return Math.min(88, Math.max(12, value));
}

function orderDiagramNodes(
  nodes: PlanDiagramBlock["data"]["nodes"],
  edges: PlanDiagramBlock["data"]["edges"],
) {
  nodes = nodes ?? [];
  edges = edges ?? [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const targets = new Set(edges.map((edge) => edge.to));
  const first = nodes.find((node) => !targets.has(node.id)) ?? nodes[0];
  if (!first) return nodes;

  const ordered = [first];
  const seen = new Set([first.id]);
  let current = first;
  while (current) {
    const nextEdge = edges.find(
      (edge) => edge.from === current.id && !seen.has(edge.to),
    );
    const next = nextEdge ? nodeById.get(nextEdge.to) : undefined;
    if (!next) break;
    ordered.push(next);
    seen.add(next.id);
    current = next;
  }

  for (const node of nodes) {
    if (!seen.has(node.id)) ordered.push(node);
  }
  return ordered;
}
