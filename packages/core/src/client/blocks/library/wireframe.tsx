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
  height: number;
  radius: number;
};

const SURFACE_PRESETS: Record<WireframeSurface, SurfacePreset> = {
  mobile: { width: 300, height: 624, radius: 30 },
  desktop: { width: 840, height: 520, radius: 14 },
  browser: { width: 900, height: 560, radius: 14 },
  popover: { width: 360, height: 360, radius: 16 },
  panel: { width: 420, height: 560, radius: 16 },
};

function isHtmlData(data: WireframeData): boolean {
  return typeof data.html === "string" && data.html.trim().length > 0;
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
  surface: WireframeSurface;
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
  const isDark = useIsDark();
  const theme: "light" | "dark" = isDark ? "dark" : "light";
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
          style={{
            width,
            height,
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
          <div
            className="absolute inset-0 overflow-hidden"
            style={{ borderRadius: preset.radius }}
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
  ctx,
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
    return safeCss ? `[data-plan-design-scope="${scopeId}"]{}\n${safeCss}` : "";
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
  return (
    <Screen pad="calc(var(--pad) * 1.35)" style={{ height: "100%" }}>
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
