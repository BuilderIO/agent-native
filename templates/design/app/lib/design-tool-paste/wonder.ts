import { hasWonderClipboardMarker } from "@shared/design-tool-markers";
import { z } from "zod";

import { emitFrames } from "./emit";
import type { DesignToolRead } from "./index";
import {
  firstIssue,
  hexColor,
  inexact,
  PASTE_LIMITS,
  pushWarning,
  uniqueWarnings,
  type PasteFont,
  type PasteFrame,
  type PasteImage,
  type PasteNode,
  type PasteStyle,
  type PasteWarnings,
} from "./ir";

/**
 * Wonder writes a copied frame as `text/html` that is an empty document behind
 * a `<!-- wonder-clipboard:BASE64 -->` comment. The base64 is UTF-8 JSON:
 * `{ version, payload: { nodes: [tree] } }`. Its `signature` is Wonder's own
 * integrity token for pasting back into Wonder; it is not checked here, so the
 * payload is treated as untrusted input like any other paste.
 */
const COMMENT = /<!--\s*wonder-clipboard:([A-Za-z0-9+/=_-]+)\s*-->/;
const SUPPORTED_VERSION = "1";
const STYLE_GROUPS = new Set([
  "layout",
  "tokenBindings",
  "typography",
  "spacing",
  "fills",
  "borderRadius",
  "border",
  "effects",
  "blending",
]);

const Color = z.object({
  value: z.object({
    r: z.number().optional(),
    g: z.number().optional(),
    b: z.number().optional(),
    alpha: z.number().optional(),
    mode: z.string().optional(),
    scale: z.string().optional(),
  }),
});
type Color = z.infer<typeof Color>;

const Fill = z.object({
  type: z.string(),
  color: Color.optional(),
  image: z.string().optional(),
  backgroundSize: z.string().optional(),
  backgroundPosition: z.string().optional(),
  backgroundRepeat: z.string().optional(),
});
type Fill = z.infer<typeof Fill>;

const CssScalar = z.union([z.number(), z.string()]);

const Style = z
  .object({
    layout: z.record(z.string(), z.unknown()).optional(),
    spacing: z
      .object({
        padding: z.unknown().optional(),
        margin: z.unknown().optional(),
      })
      .optional(),
    typography: z
      .object({
        fills: z.array(Fill).max(PASTE_LIMITS.fillsPerLayer).optional(),
        fontFamily: z.string().optional(),
        fontFallback: z.string().optional(),
        fontSize: CssScalar.optional(),
        fontStyle: CssScalar.optional(),
        fontWeight: CssScalar.optional(),
        lineHeight: CssScalar.optional(),
        textAlign: CssScalar.optional(),
        textOverflow: CssScalar.optional(),
        whiteSpace: CssScalar.optional(),
        wordBreak: CssScalar.optional(),
      })
      .optional(),
    fills: z.array(Fill).max(PASTE_LIMITS.fillsPerLayer).optional(),
    borderRadius: z.unknown().optional(),
    border: z
      .object({
        color: Color.optional(),
        style: z.string().optional(),
        width: z.number().optional(),
      })
      .optional(),
    effects: z
      .object({
        boxShadow: z
          .array(
            z.object({
              blur: z.number().optional(),
              spread: z.number().optional(),
              inset: z.boolean().optional(),
              offset: z
                .object({ x: z.number().optional(), y: z.number().optional() })
                .optional(),
              color: Color.optional(),
            }),
          )
          .max(PASTE_LIMITS.shadowsPerLayer)
          .optional(),
      })
      .catchall(z.unknown())
      .optional(),
    blending: z.object({ opacity: z.number().optional() }).optional(),
  })
  .catchall(z.unknown());
type Style = z.infer<typeof Style>;

interface WonderNode {
  source: {
    label: string;
    type: string;
    tagName?: string | undefined;
    content?: string | undefined;
    style: Style;
  };
  metadata?:
    | {
        bounds?:
          | { width?: number | undefined; height?: number | undefined }
          | undefined;
      }
    | undefined;
  globalX?: number | undefined;
  globalY?: number | undefined;
  children?: WonderNode[] | undefined;
}

const Node: z.ZodType<WonderNode, unknown> = z.lazy(() =>
  z.object({
    source: z.object({
      label: z.string(),
      type: z.string(),
      tagName: z.string().optional(),
      content: z.string().optional(),
      style: Style.default({}),
    }),
    metadata: z
      .object({
        bounds: z
          .object({
            width: z.number().optional(),
            height: z.number().optional(),
          })
          .optional(),
      })
      .optional(),
    globalX: z.number().optional(),
    globalY: z.number().optional(),
    children: z.array(Node).optional(),
  }),
);

const Clipboard = z.object({
  version: z.union([z.string(), z.number()]),
  payload: z.object({ nodes: z.array(Node).min(1) }),
});

export function detectWonder(html: string): boolean {
  return hasWonderClipboardMarker(html);
}

type WonderParse =
  | { status: "invalid"; reason: string }
  | { status: "ok"; roots: WonderNode[] };

function decodeBase64Json(encoded: string): unknown {
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * Walks the raw tree iteratively, so a payload built to be huge or deeply
 * nested is refused before validation and conversion recurse over it.
 */
function boundsViolation(roots: unknown): string | null {
  if (!Array.isArray(roots)) return null;
  if (roots.length > PASTE_LIMITS.frames) {
    return `more than ${PASTE_LIMITS.frames} frames`;
  }
  const stack: Array<[unknown, number]> = roots.map((root) => [root, 1]);
  let count = 0;
  for (let item = stack.pop(); item; item = stack.pop()) {
    const [node, depth] = item;
    count += 1;
    if (count > PASTE_LIMITS.nodes) {
      return `more than ${PASTE_LIMITS.nodes} layers`;
    }
    if (depth > PASTE_LIMITS.depth) {
      return `layers nested more than ${PASTE_LIMITS.depth} deep`;
    }
    const children =
      typeof node === "object" && node !== null
        ? (node as { children?: unknown }).children
        : undefined;
    if (Array.isArray(children)) {
      // Counted before they are queued, so one huge child array cannot
      // allocate millions of entries ahead of the limit.
      if (count + stack.length + children.length > PASTE_LIMITS.nodes) {
        return `more than ${PASTE_LIMITS.nodes} layers`;
      }
      for (const child of children) stack.push([child, depth + 1]);
    }
  }
  return null;
}

function parseWonder(html: string): WonderParse {
  const encoded = COMMENT.exec(html)?.[1];
  if (!encoded) {
    return { status: "invalid", reason: "clipboard data is unreadable" };
  }
  if (encoded.length > PASTE_LIMITS.encodedChars) {
    return { status: "invalid", reason: "clipboard data is too large" };
  }
  let json: unknown;
  try {
    json = decodeBase64Json(encoded);
  } catch {
    return { status: "invalid", reason: "clipboard data is not valid JSON" };
  }
  const roots =
    typeof json === "object" && json !== null
      ? (json as { payload?: { nodes?: unknown } }).payload?.nodes
      : undefined;
  const violation = boundsViolation(roots);
  if (violation) return { status: "invalid", reason: violation };
  const parsed = Clipboard.safeParse(json);
  if (!parsed.success) {
    return { status: "invalid", reason: firstIssue(parsed.error) };
  }
  if (String(parsed.data.version) !== SUPPORTED_VERSION) {
    return {
      status: "invalid",
      reason: `clipboard version ${String(parsed.data.version)} is not supported`,
    };
  }
  return { status: "ok", roots: parsed.data.payload.nodes };
}

function color(
  value: Color | undefined,
  warnings: PasteWarnings,
): string | null {
  const channels = value?.value;
  if (
    channels?.mode !== "rgb" ||
    channels.scale !== "int255" ||
    channels.r === undefined ||
    channels.g === undefined ||
    channels.b === undefined
  ) {
    pushWarning(
      warnings,
      inexact("Skipped a color in a format Design does not read yet."),
    );
    return null;
  }
  return hexColor(channels.r, channels.g, channels.b, channels.alpha ?? 1);
}

function gridTrack(track: unknown, depth = 0): string | null {
  // Nested min/max objects are not covered by the layer-tree depth guard.
  if (depth > PASTE_LIMITS.gridTrackDepth) return null;
  if (typeof track === "number") return `${track}px`;
  if (typeof track === "string") return track;
  if (!track || typeof track !== "object") return null;
  const t = track as { fr?: unknown; min?: unknown; max?: unknown };
  if (typeof t.fr === "number") return `${t.fr}fr`;
  if (t.min !== undefined && t.max !== undefined) {
    const min = gridTrack(t.min, depth + 1);
    const max = gridTrack(t.max, depth + 1);
    return min && max ? `minmax(${min},${max})` : null;
  }
  return null;
}

function box(value: unknown): string | null {
  if (typeof value === "number") return `${value}px`;
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const px = (key: string) => (typeof v[key] === "number" ? v[key] : 0);
  return "x" in v || "y" in v
    ? `${px("y")}px ${px("x")}px`
    : `${px("top")}px ${px("right")}px ${px("bottom")}px ${px("left")}px`;
}

function layoutStyle(
  layout: Record<string, unknown>,
  isRoot: boolean,
  warnings: PasteWarnings,
): PasteStyle {
  const style: PasteStyle = {};
  for (const [name, value] of Object.entries(layout)) {
    // The root's left/top are its spot on Wonder's canvas; placement is
    // planned from globalX/globalY, so they must not leak into the element.
    if (isRoot && (name === "left" || name === "top")) continue;
    if (name === "gridTemplateColumns" && Array.isArray(value)) {
      const tracks =
        value.length <= PASTE_LIMITS.gridTracks
          ? value.map((track) => gridTrack(track))
          : [null];
      if (tracks.every((track) => track !== null)) {
        style[name] = tracks.join(" ");
      } else {
        pushWarning(
          warnings,
          inexact("Skipped a grid column definition Design cannot read."),
        );
      }
    } else if (name === "gap" && value && typeof value === "object") {
      const { x, y } = value as { x?: unknown; y?: unknown };
      if (typeof x === "number" && typeof y === "number") {
        style.gap = `${y}px ${x}px`;
      } else {
        pushWarning(warnings, inexact('Skipped the "gap" layout value.'));
      }
    } else if (typeof value === "number" || typeof value === "string") {
      style[name] = value;
    } else {
      pushWarning(warnings, inexact(`Skipped the "${name}" layout value.`));
    }
  }
  return style;
}

function styleFor(
  source: Style,
  isRoot: boolean,
  warnings: PasteWarnings,
): { style: PasteStyle; font?: PasteFont; images: PasteImage[] } {
  for (const key of Object.keys(source)) {
    if (!STYLE_GROUPS.has(key)) {
      pushWarning(warnings, inexact(`Skipped the unsupported "${key}" style.`));
    }
  }
  const style: PasteStyle = layoutStyle(source.layout ?? {}, isRoot, warnings);
  const set = (name: string, value: string | number | null) => {
    if (value !== null) style[name] = value;
  };
  for (const group of ["padding", "margin"] as const) {
    const value = source.spacing?.[group];
    if (value === undefined) continue;
    const css = box(value);
    if (css) set(group, css);
    else
      pushWarning(warnings, inexact(`Skipped a ${group} Design cannot read.`));
  }
  const fills = source.fills ?? [];
  const solid = fills.find((fill) => fill.type === "solid");
  if (solid) set("backgroundColor", color(solid.color, warnings));
  const images: PasteImage[] = [];
  for (const fill of fills) {
    if (fill.type !== "image" || !fill.image) continue;
    if (images.length >= PASTE_LIMITS.imageFills) {
      pushWarning(
        warnings,
        inexact(
          `Kept the first ${PASTE_LIMITS.imageFills} image fills of a layer.`,
        ),
      );
      break;
    }
    images.push({
      url: fill.image,
      size: fill.backgroundSize,
      position: fill.backgroundPosition,
      repeat: fill.backgroundRepeat,
    });
  }
  const type = source.typography;
  let font: PasteFont | undefined;
  if (type) {
    const text = type.fills?.find((fill) => fill.type === "solid");
    if (text) set("color", color(text.color, warnings));
    if (type.fontFamily) {
      font = { family: type.fontFamily, fallback: type.fontFallback };
    }
    for (const name of [
      "fontSize",
      "fontStyle",
      "fontWeight",
      "lineHeight",
      "textAlign",
      "textOverflow",
      "whiteSpace",
      "wordBreak",
    ] as const) {
      const value = type[name];
      if (value !== undefined) set(name, value);
    }
  }
  if (typeof source.borderRadius === "number") {
    set("borderRadius", source.borderRadius);
  } else if (source.borderRadius !== undefined) {
    pushWarning(
      warnings,
      inexact("Skipped a corner radius Design cannot read."),
    );
  }
  const border = source.border;
  if (border) {
    const stroke = color(border.color, warnings);
    if (stroke) {
      set(
        "border",
        `${border.width ?? 1}px ${border.style ?? "solid"} ${stroke}`,
      );
    }
  }
  const shadows = (source.effects?.boxShadow ?? []).flatMap((shadow) => {
    const shadowColor = color(shadow.color, warnings);
    return shadowColor
      ? [
          `${shadow.inset ? "inset " : ""}${shadow.offset?.x ?? 0}px ${shadow.offset?.y ?? 0}px ${shadow.blur ?? 0}px ${shadow.spread ?? 0}px ${shadowColor}`,
        ]
      : [];
  });
  if (shadows.length > 0) set("boxShadow", shadows.join(","));
  for (const key of Object.keys(source.effects ?? {})) {
    if (key !== "boxShadow")
      pushWarning(warnings, inexact(`Skipped the "${key}" effect.`));
  }
  if (source.blending?.opacity !== undefined) {
    set("opacity", source.blending.opacity);
  }
  return font ? { style, font, images } : { style, images };
}

function toNode(
  node: WonderNode,
  isRoot: boolean,
  warnings: PasteWarnings,
): PasteNode {
  const { source } = node;
  if (source.type !== "frame" && source.type !== "text") {
    pushWarning(warnings, { kind: "layer-type", type: source.type });
  }
  const { style, font, images } = styleFor(source.style, isRoot, warnings);
  if (source.type === "text") {
    return {
      kind: "text",
      label: source.label,
      tag: source.tagName,
      style,
      font,
      text: source.content ?? "",
    };
  }
  return {
    kind: "box",
    label: source.label,
    tag: source.tagName,
    style,
    font,
    images: images.length > 0 ? images : undefined,
    children: (node.children ?? []).map((child) =>
      toNode(child, false, warnings),
    ),
  };
}

export function readWonder(html: string): DesignToolRead {
  const parsed = parseWonder(html);
  if (parsed.status !== "ok") return { ...parsed, tool: "wonder" };
  const warnings: PasteWarnings = [];
  const frames: PasteFrame[] = parsed.roots.map((root) => {
    const layout = root.source.style.layout;
    return {
      title: root.source.label,
      root: toNode(root, true, warnings),
      width: layout?.width ?? root.metadata?.bounds?.width,
      height: layout?.height ?? root.metadata?.bounds?.height,
      origin:
        typeof root.globalX === "number" && typeof root.globalY === "number"
          ? { x: root.globalX, y: root.globalY }
          : null,
    };
  });
  const { layers, imageUrls } = emitFrames(frames, warnings);
  return {
    status: "ok",
    tool: "wonder",
    layers,
    warnings: uniqueWarnings(warnings),
    remoteImages: imageUrls,
  };
}
