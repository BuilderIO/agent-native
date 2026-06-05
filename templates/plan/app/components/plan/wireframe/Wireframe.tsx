import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type {
  PlanDiagramBlock,
  PlanLegacyWireframeBlock,
  PlanWireframeBlock,
  PlanWireframeSurface,
} from "@shared/plan-content";
import { LegacyRegionWireframe } from "./LegacyRegionWireframe";
import { Screen, renderNodes } from "./kit";

/**
 * Wireframe renderer.
 *
 * PRIMARY PATH — declarative KIT TREE. New plans emit geometry-free semantic
 * nodes (`{ el, ...props, children }`). The shared kit owns the flex layout,
 * Virgil font, spacing, subtle whole-frame wobble, placeholder line style, and
 * button/chrome quality.
 *
 * LEGACY PATH — coordinate region fallback. Old/imported plans still render
 * through `LegacyRegionWireframe`; new generation should not emit regions.
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

function isKitTreeData(
  data: WireframeData,
): data is PlanWireframeBlock["data"] {
  return Array.isArray((data as PlanWireframeBlock["data"]).screen);
}

export function Wireframe({
  data,
  compact,
  canvasSize,
}: {
  data: WireframeData;
  compact?: boolean;
  canvasSize?: number;
}) {
  if (isKitTreeData(data)) {
    return (
      <KitWireframe data={data} compact={compact} canvasSize={canvasSize} />
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
}: {
  data: PlanWireframeBlock["data"];
  compact?: boolean;
  canvasSize?: number;
}) {
  const preset = SURFACE_PRESETS[data.surface] ?? SURFACE_PRESETS.desktop;
  const height = canvasSize ?? preset.height;
  const scale = compact ? Math.min(1, 320 / preset.width) : 1;

  return (
    <div
      className="plan-kit-wireframe"
      style={{
        width: compact ? preset.width * scale : "100%",
        maxWidth: preset.width,
      }}
    >
      <div
        style={{
          width: compact ? preset.width * scale : "100%",
          maxWidth: preset.width,
          height: compact ? height * scale : height,
          marginInline: "auto",
        }}
      >
        <div
          className="plan-kit-artboard relative h-full w-full overflow-hidden bg-white"
          style={{
            width: preset.width,
            height,
            borderRadius: preset.radius,
            border: "1.4px solid var(--plan-sketch-line, #34322e)",
            boxShadow: "0 10px 34px rgba(24, 24, 27, 0.10)",
            ...(scale !== 1
              ? { transform: `scale(${scale})`, transformOrigin: "top left" }
              : {}),
            ...(compact ? {} : { width: "100%" }),
          }}
        >
          {renderKitScreen(data.screen)}
        </div>
      </div>
      {data.caption && (
        <p className="mt-2 text-center text-xs text-plan-muted">
          {data.caption}
        </p>
      )}
    </div>
  );
}

function renderKitScreen(
  nodes: PlanWireframeBlock["data"]["screen"],
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
