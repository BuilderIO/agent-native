import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { defineBlock } from "../types.js";
import type {
  BlockReadProps,
  BlockEditProps,
  BlockRenderContext,
} from "../types.js";
import {
  wireframeSchema,
  wireframeMdx,
  type WireframeData,
  type WireframeSurface,
} from "./wireframe.config.js";
import {
  HTML_ROUGH_SELECTOR,
  KitConfigContext,
  RoughOverlay,
  Screen,
  renderNodes,
  useIsDark,
  useWireframeStyle,
} from "./wireframe-kit.js";
import {
  sanitizeWireframeCss,
  sanitizeWireframeHtml,
  scopeDesignCss,
} from "./sanitize-html.js";

/**
 * Shared `wireframe` block — a hand-drawn low-fi mockup of one screen, rendered
 * from either a declarative kit tree (`data.screen`) or a self-contained HTML
 * mockup (`data.html`), inside a surface-locked frame (desktop/mobile/popover/
 * panel/browser) with a rough.js sketch overlay. Lives in core so any app can
 * register it (it originated in the plan template).
 *
 * DECOUPLING from the plan original:
 * - Theme: `useIsDark()` reads `document.documentElement.classList` instead of
 *   `next-themes` (the MermaidBlock precedent), so core stays dependency-light.
 * - HTML sanitize: the HTML path runs `data.html`/`data.css` through the
 *   app-injected `ctx.sanitizeHtml`. If no sanitizer is wired the HTML path is
 *   skipped (kit tree or an empty frame renders) — core never injects unsanitized
 *   author HTML.
 * - The plan-only prototype runtime, design-element selection, and legacy region
 *   fallback are intentionally NOT ported; those are plan-canvas features, not
 *   part of the document-block render. The kit element vocabulary, the `--wf-*`
 *   token contract, and the `.plan-wf` / `[data-rough]` classes the overlay
 *   measures are preserved exactly.
 *
 * The section carries the app-neutral `an-block` class plus the legacy
 * `plan-block` class so plan renders byte-identically while any other app gets
 * the theme-token treatment from core's `blocks.css`.
 *
 * The wireframe is canvas / agent-patch edited (node-addressable content patches
 * applied server-side), NOT schema-form edited in the browser — so `Edit` reuses
 * the same static render as `Read`, mirroring the plan `WireframeEditor`.
 */

type SurfacePreset = {
  width: number;
  /**
   * Floor height for the surface. The frame is AUTO-HEIGHT (content-driven): it
   * grows past this when content is tall and shrinks toward its content height
   * when content is short, but never collapses below this floor — so an empty or
   * near-empty frame still reads as that surface instead of a thin sliver. This
   * is a `min-height`, not a fixed `height`: it is the lower bound the old fixed
   * preset height used to also be the UPPER bound, which is what left a big empty
   * vertical band below short content (e.g. a header + one dropdown padded to a
   * tall fixed aspect).
   */
  minHeight: number;
  radius: number;
};

const SURFACE_PRESETS: Record<WireframeSurface, SurfacePreset> = {
  // mobile keeps a tall floor: a phone frame reads as a phone even when short.
  mobile: { width: 300, minHeight: 360, radius: 30 },
  desktop: { width: 840, minHeight: 200, radius: 14 },
  browser: { width: 900, minHeight: 200, radius: 14 },
  popover: { width: 360, minHeight: 120, radius: 16 },
  panel: { width: 420, minHeight: 200, radius: 16 },
};

function isHtmlData(data: WireframeData): boolean {
  return typeof data.html === "string" && data.html.trim().length > 0;
}

/* -------------------------------------------------------------------------- */
/* Shared frame shell: surface-locked WIDTH + auto (content-driven) height +   */
/* theme + rough overlay. The frame keeps each surface's footprint and chrome  */
/* but fits its content height instead of padding to a fixed aspect, so short  */
/* content yields a short frame and tall content grows. Pass `canvasSize` to   */
/* opt a fixed-aspect canvas artboard back into a hard pixel height.           */
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
  surface: WireframeSurface;
  compact?: boolean;
  /**
   * Force a FIXED pixel height instead of the auto-height (content-driven)
   * default. Reserved for fixed-aspect canvas artboards (pan/zoom). Document-flow
   * wireframes — what recaps render — leave this unset so the frame fits content.
   */
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
  const isDark = useIsDark();
  const theme: "light" | "dark" = isDark ? "dark" : "light";
  const style = useWireframeStyle();
  const preset = SURFACE_PRESETS[surface] ?? SURFACE_PRESETS.desktop;
  const width = canvasWidth ?? preset.width;
  // AUTO-HEIGHT: with no explicit `canvasSize` the artboard height is driven by
  // its content (`height: auto`), floored at the surface's `minHeight` so a short
  // screen produces a short frame and a tall screen grows — instead of every
  // surface being padded to a fixed preset height that left a big empty band
  // below short content. A `canvasSize` (fixed-aspect canvas artboard) overrides
  // this with a hard pixel height.
  const fixedHeight = canvasSize;
  const minHeight = fixedHeight ?? preset.minHeight;
  const baseScale = compact ? Math.min(1, 320 / preset.width) : 1;
  const maxFrameWidth = compact ? preset.width * baseScale : width;
  const [fitScale, setFitScale] = useState(baseScale);
  // The scaled artboard is `transform: scale()`-ed, which does not change its
  // layout box, so the wrapper that reserves vertical space must track the
  // artboard's ACTUAL rendered height. With a fixed height that's known up front;
  // with auto-height we measure it.
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(
    fixedHeight ?? null,
  );
  const designMode = renderMode === "design";
  const sketchy = !designMode && style === "sketchy" && !skeleton;
  const roughEnabled = sketchy && roughOverlay;
  const paper = designMode
    ? "hsl(var(--background))"
    : "var(--plan-document, hsl(var(--background)))";
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

  // Track the auto-height artboard's rendered height so the (un-transformed)
  // wrapper reserves exactly the scaled space the frame occupies. Skipped when a
  // fixed height is supplied — there's nothing to measure.
  useEffect(() => {
    if (fixedHeight != null) return;
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const next = element.offsetHeight;
      setMeasuredHeight((current) =>
        current != null && Math.abs(current - next) < 0.5 ? current : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fixedHeight]);

  // Height the wrapper reserves: the measured (or fixed) artboard height scaled
  // by the fit factor. Falls back to the surface floor before the first measure
  // so SSR / first paint reserves a sensible box rather than collapsing.
  const reservedHeight = (measuredHeight ?? minHeight) * fitScale;

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
        style={{
          width: "100%",
          maxWidth: maxFrameWidth,
          height: reservedHeight,
          marginInline: "auto",
        }}
      >
        <div
          ref={ref}
          className="plan-kit-artboard relative"
          style={{
            width,
            // Auto-height by default (content-driven, floored at `minHeight`);
            // a fixed `canvasSize` locks the height for canvas artboards.
            ...(fixedHeight != null ? { height: fixedHeight } : { minHeight }),
            borderRadius: preset.radius,
            background: paper,
            boxShadow: "0 10px 34px hsl(var(--foreground) / 0.10)",
            ...(fitScale !== 1
              ? {
                  transform: `scale(${fitScale})`,
                  transformOrigin: "top left",
                }
              : {}),
          }}
        >
          {/* Content drives the artboard height in flow when auto-height; for a
              fixed height it's pinned to the box. Rounded corners clip overflow
              either way. */}
          <div
            className="overflow-hidden"
            style={{
              borderRadius: preset.radius,
              ...(fixedHeight != null
                ? { position: "absolute", inset: 0 }
                : { minHeight }),
            }}
          >
            {render({ theme, style })}
          </div>
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
      </div>
      {caption && (
        <p className="mt-2 text-center text-xs text-plan-muted">{caption}</p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* HTML artboard — author HTML, themed + roughened by the renderer.           */
/* -------------------------------------------------------------------------- */

function HtmlArtboard({
  data,
  ctx: _ctx,
  compact,
}: {
  data: WireframeData;
  ctx: BlockRenderContext;
  compact?: boolean;
}) {
  const renderMode = data.renderMode ?? "wireframe";
  // Sanitize author HTML/CSS at the render point (defense-in-depth against stored
  // XSS). Self-contained in core via the shared block sanitizer (DOM-based in the
  // browser, regex fallback on the server) so the HTML mockup path renders in any
  // app without the host wiring a sanitizer hook.
  const safeHtml = useMemo(() => sanitizeWireframeHtml(data.html), [data.html]);
  const scopeId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const scopedCss = useMemo(() => {
    const safeCss = sanitizeWireframeCss(data.css);
    // Scope every author selector under this instance's artboard so global
    // selectors (body, *, .app-shell, :root) can't restyle/hide the host app.
    return safeCss
      ? scopeDesignCss(safeCss, `[data-plan-design-scope="${scopeId}"]`)
      : "";
  }, [data.css, scopeId]);

  return (
    <ArtboardFrame
      surface={data.surface}
      compact={compact}
      skeleton={data.skeleton}
      renderMode={renderMode}
      selector={HTML_ROUGH_SELECTOR}
      caption={data.caption}
      render={({ theme, style }) => (
        <div
          className="plan-html-frame"
          data-theme={theme}
          data-style={style}
          data-render-mode={renderMode}
          data-plan-design-scope={scopeId}
          data-skeleton={data.skeleton ? "true" : undefined}
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

/* -------------------------------------------------------------------------- */
/* Kit artboard — declarative kit tree.                                       */
/* -------------------------------------------------------------------------- */

function KitArtboard({
  data,
  compact,
}: {
  data: WireframeData;
  compact?: boolean;
}) {
  return (
    <ArtboardFrame
      surface={data.surface}
      compact={compact}
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
  nodes: NonNullable<WireframeData["screen"]>,
): ReactNode {
  if (nodes.length === 1 && nodes[0]?.el === "screen") {
    return renderNodes(nodes);
  }
  // `minHeight` (not `height`) so the screen fills the auto-height artboard floor
  // but grows past it when content is tall, instead of locking to a fixed box.
  return (
    <Screen pad="calc(var(--pad) * 1.35)" style={{ minHeight: "100%" }}>
      {renderNodes(nodes)}
    </Screen>
  );
}

/**
 * The bare wireframe surface (no block section / title). Routes to the HTML
 * mockup when `data.html` is present and a sanitizer is wired; otherwise renders
 * the kit tree.
 */
function WireframeSurfaceView({
  data,
  ctx,
  compact,
}: {
  data: WireframeData;
  ctx: BlockRenderContext;
  compact?: boolean;
}) {
  if (isHtmlData(data)) {
    return <HtmlArtboard data={data} ctx={ctx} compact={compact} />;
  }
  return <KitArtboard data={data} compact={compact} />;
}

/* -------------------------------------------------------------------------- */
/* Block Read / Edit                                                          */
/* -------------------------------------------------------------------------- */

/** Read-only renderer for a `wireframe` block. */
export function WireframeBlock({
  data,
  blockId,
  title,
  summary,
  ctx,
}: BlockReadProps<WireframeData>) {
  return (
    <section
      className="an-block plan-block an-wireframe"
      data-block-id={blockId}
    >
      {title && <div className="an-block-label plan-block-label">{title}</div>}
      <WireframeSurfaceView data={data} ctx={ctx} />
      {summary && <p className="mt-5 text-plan-muted">{summary}</p>}
    </section>
  );
}

/**
 * Editor for the `wireframe` block. The wireframe is canvas / agent-patch edited
 * (it never calls `onChange`), so edit mode reuses the read surface — mirroring
 * the plan `WireframeEditor`. The host document editor already wraps the registry
 * edit path in a titled section, so this renders only the surface to avoid
 * double-nesting.
 */
export function WireframeEditor({ data, ctx }: BlockEditProps<WireframeData>) {
  return <WireframeSurfaceView data={data} ctx={ctx} />;
}

/** Full client spec for the shared `wireframe` block (schema + MDX + Read/Edit). */
export const wireframeBlock = defineBlock<WireframeData>({
  type: "wireframe",
  schema: wireframeSchema,
  mdx: wireframeMdx,
  Read: WireframeBlock,
  Edit: WireframeEditor,
  placement: ["block"],
  editSurface: "inline",
  label: "Wireframe",
  description:
    "A sketch wireframe of one screen built from kit primitives (or an HTML mockup), rendered in a chosen surface frame (desktop/mobile/popover/panel/browser).",
  // `surface` is the only required field; `screen` defaults to []. Start on the
  // desktop surface with an empty screen so the canvas/agent can fill it in.
  empty: () => ({ surface: "desktop", screen: [] }),
});
