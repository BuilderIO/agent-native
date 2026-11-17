import { hasPaperClipboardMarker } from "@shared/design-tool-markers";
import { z } from "zod";

import { emitFrames } from "./emit";
import type { DesignToolRead } from "./index";
import {
  firstIssue,
  hexColor,
  inexact,
  lookup,
  PASTE_LIMITS,
  pushWarning,
  uniqueWarnings,
  type PasteFrame,
  type PasteNode,
  type PasteStyle,
  type PasteWarnings,
} from "./ir";

/**
 * Paper writes a copied frame as `text/html` whose only useful content is a
 * `<paper-paste-start data-embed="{json}">` comment. The JSON is not escaped
 * for the attribute, so it is cut out by its delimiters rather than parsed
 * as markup.
 */
const EMBED_OPEN = 'data-embed="';
const EMBED_CLOSE = '"></paper-paste-start>';

const Color = z.object({
  value: z.object({
    mode: z.string(),
    l: z.number(),
    c: z.number(),
    h: z.number(),
    alpha: z.number().optional(),
  }),
});
type Color = z.infer<typeof Color>;

const Fill = z.object({
  type: z.string(),
  isVisible: z.boolean().optional(),
  color: Color.nullish(),
});

const BorderSide = z.object({
  isVisible: z.boolean().optional(),
  width: z.string().optional(),
  style: z.string().optional(),
  color: Color.nullish(),
});

const Shadow = z.object({
  isVisible: z.boolean().optional(),
  color: Color.nullish(),
  offsetX: z.string().optional(),
  offsetY: z.string().optional(),
  blur: z.string().optional(),
  spread: z.string().optional(),
});

const Node = z.object({
  label: z.string(),
  component: z.string(),
  styles: z.record(z.string(), z.union([z.string(), z.number()])),
  styleMeta: z
    .object({
      fill: z.array(Fill).optional(),
      font: z
        .object({
          family: z.string().optional(),
          weight: z.number().optional(),
          isItalic: z.boolean().optional(),
        })
        .optional(),
      borders: z
        .object({
          top: BorderSide.optional(),
          right: BorderSide.optional(),
          bottom: BorderSide.optional(),
          left: BorderSide.optional(),
        })
        .optional(),
      svgFill: z.object({ color: Color.nullish() }).optional(),
      svgStroke: z
        .object({
          color: Color.nullish(),
          width: z.number().optional(),
          lineCap: z.string().optional(),
          lineJoin: z.string().optional(),
        })
        .optional(),
      outerShadow: z.array(Shadow).optional(),
      filter: z
        .array(
          z.object({
            type: z.string(),
            value: z.string(),
            isVisible: z.boolean().optional(),
          }),
        )
        .optional(),
      textDecoration: z
        .object({
          line: z.string().optional(),
          style: z.string().optional(),
          isVisible: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
  props: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  tag: z.string().optional(),
  // Text runs: index -> [marker, [text]]. The marker's meaning is not known;
  // every run's text is kept in order.
  b: z
    .record(z.string(), z.tuple([z.string(), z.array(z.string())]))
    .optional(),
});
type Node = z.infer<typeof Node>;

const Payload = z
  .object({
    topLevelNodeIds: z.array(z.string()).min(1).max(PASTE_LIMITS.frames),
    nodes: z.record(z.string(), Node),
    parentToChildrenIndex: z.record(z.string(), z.array(z.string())),
    positions: z
      .record(z.string(), z.tuple([z.number(), z.number()]))
      .default({}),
  })
  .refine(
    (payload) => Object.keys(payload.nodes).length <= PASTE_LIMITS.nodes,
    {
      message: `more than ${PASTE_LIMITS.nodes} layers`,
    },
  )
  .refine(
    (payload) =>
      Object.values(payload.parentToChildrenIndex).reduce(
        (total, children) => total + children.length,
        0,
      ) <= PASTE_LIMITS.nodes,
    { message: "more child references than the paste limit" },
  )
  .refine(
    (payload) =>
      payload.topLevelNodeIds.every((id) => lookup(payload.nodes, id)),
    {
      message: "a top-level layer is missing",
    },
  );
type Payload = z.infer<typeof Payload>;

const KNOWN_COMPONENTS = new Set([
  "Frame",
  "Rectangle",
  "Text",
  "SVG",
  "SVGVisualElement",
]);

export function detectPaper(html: string): boolean {
  return hasPaperClipboardMarker(html);
}

type PaperParse =
  | { status: "invalid"; reason: string }
  | { status: "ok"; payload: Payload };

function parsePaper(html: string): PaperParse {
  const start = html.indexOf(EMBED_OPEN);
  const end = html.lastIndexOf(EMBED_CLOSE);
  if (start < 0 || end <= start) {
    return { status: "invalid", reason: "embed is truncated" };
  }
  if (end - start > PASTE_LIMITS.encodedChars) {
    return { status: "invalid", reason: "embed is too large" };
  }
  let json: unknown;
  try {
    json = JSON.parse(html.slice(start + EMBED_OPEN.length, end));
  } catch {
    return { status: "invalid", reason: "embed is not valid JSON" };
  }
  const parsed = Payload.safeParse(json);
  return parsed.success
    ? { status: "ok", payload: parsed.data }
    : { status: "invalid", reason: firstIssue(parsed.error) };
}

function linearToByte(channel: number): number {
  const clamped = Math.min(1, Math.max(0, channel));
  return (
    (clamped <= 0.0031308
      ? 12.92 * clamped
      : 1.055 * clamped ** (1 / 2.4) - 0.055) * 255
  );
}

/** Paper stores every color as OKLCH; the editor's pickers work in sRGB. */
function color(value: Color | null | undefined): string {
  const channels = value?.value;
  if (!channels || channels.mode !== "oklch") return "transparent";
  const { l, c, h } = channels;
  const hue = (h * Math.PI) / 180;
  const a = c * Math.cos(hue);
  const b = c * Math.sin(hue);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return hexColor(
    linearToByte(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    linearToByte(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    linearToByte(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
    channels.alpha ?? 1,
  );
}

function visible<T extends { isVisible?: boolean | undefined }>(
  items: T[] | undefined,
): T[] {
  return (items ?? []).filter((item) => item.isVisible !== false);
}

function styleFor(node: Node, isRoot: boolean): PasteStyle {
  const style: PasteStyle = {};
  for (const [name, value] of Object.entries(node.styles)) {
    // The root's left/top are its spot on Paper's canvas; placement is planned
    // from `positions`, so they must not leak into the pasted element.
    if (isRoot && (name === "left" || name === "top")) continue;
    style[name] = value;
  }
  const meta = node.styleMeta ?? {};
  const fills = visible(meta.fill);
  const solid = fills.find((fill) => fill.type === "solid");
  const image = fills.find((fill) => fill.type === "image");
  if (node.component === "Text") {
    if (solid) style.color = color(solid.color);
  } else if (solid) {
    style.backgroundColor = color(solid.color);
  } else if (image) {
    // guard:allow-raw-color — placeholder fill in pasted design content, not app chrome
    style.backgroundColor = "#d4d4d8";
  }
  if (meta.font?.weight) style.fontWeight = meta.font.weight;
  if (meta.font?.isItalic) style.fontStyle = "italic";
  const decoration = meta.textDecoration;
  if (decoration && decoration.isVisible !== false && decoration.line) {
    style.textDecoration = `${decoration.line} ${decoration.style ?? "solid"}`;
  }
  const sides = ["top", "right", "bottom", "left"] as const;
  for (const side of sides) {
    const border = meta.borders?.[side];
    if (!border || border.isVisible === false) continue;
    const name = `border${side[0]?.toUpperCase()}${side.slice(1)}`;
    style[name] =
      `${border.width ?? "1px"} ${border.style ?? "solid"} ${color(border.color)}`;
  }
  const shadows = visible(meta.outerShadow);
  if (shadows.length > 0) {
    style.boxShadow = shadows
      .map(
        (shadow) =>
          `${shadow.offsetX ?? "0px"} ${shadow.offsetY ?? "0px"} ${shadow.blur ?? "0px"} ${shadow.spread ?? "0px"} ${color(shadow.color)}`,
      )
      .join(",");
  }
  const blur = visible(meta.filter).find((filter) => filter.type === "blur");
  if (blur) style.filter = `blur(${blur.value})`;
  return style;
}

function svgAttrs(node: Node): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const [name, value] of Object.entries(node.props ?? {})) {
    attrs[name] = String(value);
  }
  const meta = node.styleMeta ?? {};
  if (meta.svgFill) attrs.fill = color(meta.svgFill.color);
  const stroke = meta.svgStroke;
  if (stroke) {
    attrs.stroke = color(stroke.color);
    if (stroke.width !== undefined)
      attrs["stroke-width"] = String(stroke.width);
    if (stroke.lineCap) attrs["stroke-linecap"] = stroke.lineCap;
    if (stroke.lineJoin) attrs["stroke-linejoin"] = stroke.lineJoin;
  }
  return attrs;
}

function textOf(node: Node): string {
  const runs = node.b ?? {};
  return Object.keys(runs)
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => (lookup(runs, key)?.[1] ?? []).join(""))
    .join("");
}

interface Walk {
  payload: Payload;
  seen: Set<string>;
  warnings: PasteWarnings;
  placeholders: number;
}

function toNode(
  id: string,
  walk: Walk,
  isRoot: boolean,
  depth = 0,
): PasteNode | null {
  if (depth > PASTE_LIMITS.depth) {
    pushWarning(
      walk.warnings,
      inexact(`Stopped at ${PASTE_LIMITS.depth} nested layers.`),
    );
    return null;
  }
  const node = lookup(walk.payload.nodes, id);
  if (!node || walk.seen.has(id)) return null;
  walk.seen.add(id);
  const font = node.styleMeta?.font?.family
    ? { family: node.styleMeta.font.family }
    : undefined;
  if (visible(node.styleMeta?.fill).some((fill) => fill.type === "image")) {
    walk.placeholders += 1;
  }
  if (!KNOWN_COMPONENTS.has(node.component)) {
    pushWarning(walk.warnings, { kind: "layer-type", type: node.component });
  }
  if (node.component === "SVGVisualElement") {
    return { kind: "shape", tag: node.tag ?? "path", attrs: svgAttrs(node) };
  }
  const children = (
    lookup(walk.payload.parentToChildrenIndex, id) ?? []
  ).flatMap((childId) => toNode(childId, walk, false) ?? []);
  const style = styleFor(node, isRoot);
  if (node.component === "SVG") {
    return {
      kind: "svg",
      label: node.label,
      attrs: svgAttrs(node),
      style,
      children,
    };
  }
  if (node.component === "Text") {
    return { kind: "text", label: node.label, style, font, text: textOf(node) };
  }
  return { kind: "box", label: node.label, style, font, children };
}

export function readPaper(html: string): DesignToolRead {
  const parsed = parsePaper(html);
  if (parsed.status !== "ok") return { ...parsed, tool: "paper" };
  const { payload } = parsed;
  const warnings: PasteWarnings = [];
  const walk: Walk = { payload, seen: new Set(), warnings, placeholders: 0 };
  const frames = payload.topLevelNodeIds.flatMap((id): PasteFrame[] => {
    const node = lookup(payload.nodes, id);
    const root = toNode(id, walk, true);
    if (!node || !root) return [];
    const position = lookup(payload.positions, id);
    return [
      {
        title: node.label,
        root,
        width: node.styles.width,
        height: node.styles.height,
        origin: position ? { x: position[0], y: position[1] } : null,
      },
    ];
  });
  if (walk.placeholders > 0) {
    pushWarning(warnings, {
      kind: "image-placeholders",
      count: walk.placeholders,
    });
  }
  const { layers } = emitFrames(frames, warnings);
  return {
    status: "ok",
    tool: "paper",
    layers,
    warnings: uniqueWarnings(warnings),
  };
}
