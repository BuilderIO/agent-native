/**
 * Builds an LLM-friendly, depth/size-limited summary of a Figma node subtree
 * (Framelink/official-Figma-MCP `get_metadata` + `get_design_context` style)
 * for "what's in this Figma file/frame?" chat questions — distinct from
 * `import-figma-frame`, which maps the same REST node JSON into a persisted,
 * editable Design screen. This module only reads and summarizes; it never
 * writes a screen.
 *
 * Reuses the existing fetch (`figma-node-import.ts`) and pure paint/gradient
 * math (`figma-node-to-html.ts`) so the node-JSON shape and gradient-angle
 * derivation stay in exactly one place instead of drifting from the import
 * path's already-verified behavior.
 */

import { figmaGet, providerJson } from "./figma-node-import.js";
import {
  gradientAngleDegrees,
  type FigmaColor,
  type FigmaEffect,
  type FigmaNode,
  type FigmaPaint,
} from "./figma-node-to-html.js";

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_NODES = 300;
const MAX_TEXT_CHARACTERS = 500;

export interface FigmaPaintSummary {
  type: string;
  opacity?: number;
  color?: string;
  angleDeg?: number;
  stops?: Array<{ position: number; color: string }>;
  imageRef?: string;
  scaleMode?: string;
}

export interface FigmaEffectSummary {
  type: string;
  color?: string;
  offset?: { x: number; y: number };
  radius?: number;
  spread?: number;
}

export interface FigmaLayoutSummary {
  mode: "HORIZONTAL" | "VERTICAL" | "GRID";
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  itemSpacing?: number;
  wrap?: string;
  padding?: { top: number; right: number; bottom: number; left: number };
  sizingHorizontal?: string;
  sizingVertical?: string;
}

export interface FigmaTextSummary {
  characters: string;
  truncated: boolean;
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  lineHeightPx?: number;
  lineHeightPercent?: number;
  letterSpacing?: number;
  textAlignHorizontal?: string;
  textCase?: string;
  textDecoration?: string;
}

export interface FigmaContextNode {
  id: string;
  name: string;
  type: string;
  box?: { x: number; y: number; width: number; height: number };
  opacity?: number;
  blendMode?: string;
  rotation?: number;
  isMask?: boolean;
  text?: FigmaTextSummary;
  fills?: FigmaPaintSummary[];
  strokes?: {
    paints: FigmaPaintSummary[];
    weight?: number;
    align?: string;
  };
  cornerRadius?: number | [number, number, number, number];
  effects?: FigmaEffectSummary[];
  layout?: FigmaLayoutSummary;
  componentId?: string;
  isComponent?: boolean;
  isInstance?: boolean;
  children?: FigmaContextNode[];
  childCount?: number;
  truncatedChildren?: boolean;
  truncatedDepth?: boolean;
}

export interface SummarizeFigmaNodeOptions {
  maxDepth?: number;
  maxNodes?: number;
}

export interface SummarizeFigmaNodeResult {
  node: FigmaContextNode;
  nodeCount: number;
  truncated: boolean;
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function colorToHex(color: FigmaColor | undefined): string | undefined {
  if (!color) return undefined;
  const channel = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, "0");
  const hex = `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
  return color.a !== undefined && color.a < 1
    ? `${hex}${channel(color.a)}`
    : hex;
}

function describePaint(
  paint: FigmaPaint,
  box: { width: number; height: number },
): FigmaPaintSummary | null {
  if (paint.visible === false) return null;
  const opacity =
    paint.opacity !== undefined && paint.opacity < 1
      ? round(paint.opacity, 2)
      : undefined;
  switch (paint.type) {
    case "SOLID":
      return { type: "solid", color: colorToHex(paint.color), opacity };
    case "GRADIENT_LINEAR":
    case "GRADIENT_RADIAL":
    case "GRADIENT_ANGULAR":
    case "GRADIENT_DIAMOND": {
      const label = paint.type.replace("GRADIENT_", "").toLowerCase() as
        | "linear"
        | "radial"
        | "angular"
        | "diamond";
      const angle = gradientAngleDegrees(paint, box);
      return {
        type: `${label}-gradient`,
        opacity,
        angleDeg: angle !== null ? round(angle) : undefined,
        stops: (paint.gradientStops ?? []).map((stop) => ({
          position: round(stop.position, 3),
          color: colorToHex(stop.color) ?? "#000000",
        })),
      };
    }
    case "IMAGE":
      return {
        type: "image",
        opacity,
        imageRef: paint.imageRef,
        scaleMode: paint.scaleMode,
      };
    default:
      return { type: paint.type.toLowerCase(), opacity };
  }
}

function describeEffect(effect: FigmaEffect): FigmaEffectSummary | null {
  if (effect.visible === false) return null;
  return {
    type: effect.type.toLowerCase().replace(/_/g, "-"),
    color: colorToHex(effect.color),
    offset: effect.offset
      ? { x: round(effect.offset.x), y: round(effect.offset.y) }
      : undefined,
    radius: effect.radius !== undefined ? round(effect.radius) : undefined,
    spread: effect.spread !== undefined ? round(effect.spread) : undefined,
  };
}

function describeLayout(node: FigmaNode): FigmaLayoutSummary | undefined {
  if (!node.layoutMode || node.layoutMode === "NONE") return undefined;
  return {
    mode: node.layoutMode,
    primaryAxisAlignItems: node.primaryAxisAlignItems,
    counterAxisAlignItems: node.counterAxisAlignItems,
    itemSpacing: node.itemSpacing,
    wrap: node.layoutWrap,
    padding: {
      top: node.paddingTop ?? 0,
      right: node.paddingRight ?? 0,
      bottom: node.paddingBottom ?? 0,
      left: node.paddingLeft ?? 0,
    },
    sizingHorizontal: node.layoutSizingHorizontal,
    sizingVertical: node.layoutSizingVertical,
  };
}

function describeText(node: FigmaNode): FigmaTextSummary | undefined {
  if (typeof node.characters !== "string") return undefined;
  const truncated = node.characters.length > MAX_TEXT_CHARACTERS;
  return {
    characters: truncated
      ? `${node.characters.slice(0, MAX_TEXT_CHARACTERS)}…`
      : node.characters,
    truncated,
    fontFamily: node.style?.fontFamily,
    fontWeight: node.style?.fontWeight,
    fontSize: node.style?.fontSize,
    lineHeightPx: node.style?.lineHeightPx,
    lineHeightPercent: node.style?.lineHeightPercent,
    letterSpacing: node.style?.letterSpacing,
    textAlignHorizontal: node.style?.textAlignHorizontal,
    textCase:
      node.style?.textCase && node.style.textCase !== "ORIGINAL"
        ? node.style.textCase
        : undefined,
    textDecoration:
      node.style?.textDecoration && node.style.textDecoration !== "NONE"
        ? node.style.textDecoration
        : undefined,
  };
}

/**
 * Recursively summarizes a Figma node tree into a compact, descriptive
 * structure: box geometry, fills/strokes/effects/corner radii, auto-layout,
 * and text/style — depth-limited and size-capped so a large frame doesn't
 * blow the agent's context the way a raw node-JSON dump would.
 */
export function summarizeFigmaNode(
  root: FigmaNode,
  options: SummarizeFigmaNodeOptions = {},
): SummarizeFigmaNodeResult {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  let nodeCount = 0;
  let truncated = false;

  function build(node: FigmaNode, depth: number): FigmaContextNode {
    nodeCount += 1;
    const box = node.absoluteBoundingBox
      ? {
          x: round(node.absoluteBoundingBox.x),
          y: round(node.absoluteBoundingBox.y),
          width: round(node.absoluteBoundingBox.width),
          height: round(node.absoluteBoundingBox.height),
        }
      : undefined;

    const fills = (node.fills ?? [])
      .map((paint) => describePaint(paint, box ?? { width: 0, height: 0 }))
      .filter((paint): paint is FigmaPaintSummary => paint !== null);
    const strokePaints = (node.strokes ?? [])
      .map((paint) => describePaint(paint, box ?? { width: 0, height: 0 }))
      .filter((paint): paint is FigmaPaintSummary => paint !== null);
    const effects = (node.effects ?? [])
      .map(describeEffect)
      .filter((effect): effect is FigmaEffectSummary => effect !== null);

    const summary: FigmaContextNode = {
      id: node.id,
      name: node.name ?? node.type,
      type: node.type,
      box,
      opacity:
        node.opacity !== undefined && node.opacity < 1
          ? round(node.opacity, 2)
          : undefined,
      // "PASS_THROUGH" is the default blend mode Figma reports on every
      // frame/group container (it means "don't blend as a group", not an
      // actual visual blend) — surfacing it alongside real paint/effect
      // blend modes like MULTIPLY would be noise on every single frame.
      blendMode:
        node.blendMode &&
        node.blendMode !== "NORMAL" &&
        node.blendMode !== "PASS_THROUGH"
          ? node.blendMode
          : undefined,
      rotation: node.rotation ? round(node.rotation, 2) : undefined,
      isMask: node.isMask || undefined,
      text: describeText(node),
      fills: fills.length ? fills : undefined,
      strokes: strokePaints.length
        ? {
            paints: strokePaints,
            weight: node.strokeWeight,
            align: node.strokeAlign,
          }
        : undefined,
      cornerRadius: node.rectangleCornerRadii ?? node.cornerRadius,
      effects: effects.length ? effects : undefined,
      layout: describeLayout(node),
      componentId: node.componentId,
      isComponent: node.type === "COMPONENT" ? true : undefined,
      isInstance: node.type === "INSTANCE" ? true : undefined,
    };

    const children = node.children ?? [];
    if (children.length === 0) return summary;

    if (depth >= maxDepth) {
      summary.childCount = children.length;
      summary.truncatedDepth = true;
      truncated = true;
      return summary;
    }

    const visibleChildren = children.filter((child) => child.visible !== false);
    const built: FigmaContextNode[] = [];
    for (const child of visibleChildren) {
      if (nodeCount >= maxNodes) {
        summary.childCount = visibleChildren.length - built.length;
        summary.truncatedChildren = true;
        truncated = true;
        break;
      }
      built.push(build(child, depth + 1));
    }
    summary.children = built;
    return summary;
  }

  const node = build(root, 0);
  return { node, nodeCount, truncated };
}

/**
 * Fetches a rendered image URL for a node via Figma's `/v1/images/:key`
 * endpoint — the same REST render used by `list-figma-library-assets` and the
 * official Figma MCP's `get_screenshot`. Returns `null` on any provider error
 * instead of throwing, since a missing screenshot shouldn't fail an otherwise
 * successful context summary.
 */
export async function fetchFigmaRenderUrl(
  fileKey: string,
  nodeId: string,
  format: "png" | "svg" = "png",
): Promise<string | null> {
  try {
    const envelope = await figmaGet(`/images/${fileKey}`, {
      ids: nodeId,
      format,
      scale: format === "png" ? 2 : undefined,
      svg_include_id: format === "svg" ? true : undefined,
    });
    const json = providerJson(envelope, "images") as {
      images?: Record<string, string | null | undefined>;
    };
    const url = json.images?.[nodeId];
    return typeof url === "string" && url ? url : null;
  } catch {
    return null;
  }
}
