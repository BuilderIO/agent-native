import { type ReactNode, useRef } from "react";
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
import { useWireframeStyle } from "./use-wireframe-style";
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
}: {
  data: WireframeData;
  compact?: boolean;
  canvasSize?: number;
  canvasWidth?: number;
}) {
  if (isHtmlData(data)) {
    return (
      <HtmlArtboard
        data={data}
        compact={compact}
        canvasSize={canvasSize}
        canvasWidth={canvasWidth}
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
  selector,
  caption,
  render,
}: {
  surface: PlanWireframeSurface;
  compact?: boolean;
  canvasSize?: number;
  canvasWidth?: number;
  skeleton?: boolean;
  selector: string;
  caption?: string;
  render: (ctx: {
    theme: "light" | "dark";
    style: "sketchy" | "clean";
  }) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const theme: "light" | "dark" = resolvedTheme === "dark" ? "dark" : "light";
  const style = useWireframeStyle();
  const preset = SURFACE_PRESETS[surface] ?? SURFACE_PRESETS.desktop;
  const height = canvasSize ?? preset.height;
  const width = canvasWidth ?? preset.width;
  const scale = compact ? Math.min(1, 320 / preset.width) : 1;
  const sketchy = style === "sketchy" && !skeleton;
  const paper = theme === "dark" ? "#201f1c" : "#fbfaf6";
  // Frame border for clean + skeleton modes (sketchy draws its frame via the
  // rough overlay). Soft, matching --wf-line — not hard ink. Skeleton uses its
  // own neutral fill so the loader frame still reads as a frame.
  const frameBorder = skeleton
    ? theme === "dark"
      ? "#322f2b"
      : "#e7e3db"
    : theme === "dark"
      ? "#43403a"
      : "#d8d3c9";

  return (
    <div
      className="plan-kit-wireframe"
      style={{
        width: compact ? preset.width * scale : "100%",
        maxWidth: compact ? preset.width : width,
      }}
    >
      <div
        style={{
          width: compact ? preset.width * scale : "100%",
          maxWidth: compact ? preset.width : width,
          height: compact ? height * scale : height,
          marginInline: "auto",
        }}
      >
        <div
          ref={ref}
          className="plan-kit-artboard relative"
          style={{
            width: preset.width,
            height,
            borderRadius: preset.radius,
            background: paper,
            boxShadow: "0 10px 34px rgba(24, 24, 27, 0.10)",
            ...(scale !== 1
              ? { transform: `scale(${scale})`, transformOrigin: "top left" }
              : {}),
            ...(compact ? {} : { width }),
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
              mode gets its frame from the rough overlay. */}
          {!sketchy && (
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
            enabled={sketchy}
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
/* HTML artboard — model-authored HTML, themed + roughened by the renderer.   */
/* -------------------------------------------------------------------------- */

function HtmlArtboard({
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
      selector={HTML_ROUGH_SELECTOR}
      caption={data.caption}
      render={({ theme, style }) => (
        <div
          className="plan-html-frame"
          data-theme={theme}
          data-style={style}
          data-skeleton={data.skeleton ? "true" : undefined}
          dangerouslySetInnerHTML={{ __html: data.html ?? "" }}
        />
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

export function SketchDiagram({
  data,
  compact,
}: {
  data: PlanDiagramBlock["data"];
  compact?: boolean;
}) {
  const nodes = orderDiagramNodes(data.nodes, data.edges);
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
            ? data.edges.find(
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

function orderDiagramNodes(
  nodes: PlanDiagramBlock["data"]["nodes"],
  edges: PlanDiagramBlock["data"]["edges"],
) {
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
