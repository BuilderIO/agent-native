import type { ImportedFigmaHtmlFile } from "./types.js";

const MAX_RENDERED_FRAMES = 24;

export interface RenderFigmaHtmlOptions {
  filename: string;
  document: unknown;
  imageMap?: Map<string, string>;
  selectionNodeId?: string;
  meta?: Record<string, unknown>;
}

export interface RenderFigmaHtmlResult {
  files: ImportedFigmaHtmlFile[];
  warnings: string[];
}

interface RenderContext {
  imageMap: Map<string, string>;
  unresolvedImages: Set<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function childrenOf(node: Record<string, unknown>): Record<string, unknown>[] {
  const candidates = [
    node.children,
    node.childNodes,
    node.nodes,
    node.canvasChildren,
    node.rootChildren,
  ];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    return candidate.filter(isRecord);
  }
  return [];
}

function findRootNode(document: unknown): Record<string, unknown> | null {
  if (!isRecord(document)) return null;
  const direct = [
    document.document,
    document.root,
    document.canvas,
    document.node,
  ];
  for (const candidate of direct) {
    if (isRecord(candidate)) return candidate;
  }
  return document;
}

function nodeId(node: Record<string, unknown>): string | undefined {
  for (const key of ["id", "guid", "nodeId"]) {
    const value = node[key];
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function nodeName(node: Record<string, unknown>): string {
  for (const key of ["name", "title", "label"]) {
    const value = node[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "Frame";
}

function nodeType(node: Record<string, unknown>): string {
  for (const key of ["type", "nodeType", "class", "kind"]) {
    const value = node[key];
    if (typeof value === "string") return value.toUpperCase();
  }
  return "";
}

function isTopLevelFrameNode(node: Record<string, unknown>): boolean {
  return ["FRAME", "COMPONENT", "INSTANCE", "CANVAS", "SECTION"].includes(
    nodeType(node),
  );
}

function slug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "frame";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function numberValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function dimension(node: Record<string, unknown>, key: "width" | "height") {
  const absoluteBoundingBox = isRecord(node.absoluteBoundingBox)
    ? node.absoluteBoundingBox
    : {};
  const size = isRecord(node.size) ? node.size : {};
  const bounds = isRecord(node.bounds) ? node.bounds : {};
  return numberValue(
    node[key],
    absoluteBoundingBox[key],
    size[key],
    bounds[key],
    key === "width" ? node.w : node.h,
  );
}

function colorToCss(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return undefined;
  const r = numberValue(value.r, value.red);
  const g = numberValue(value.g, value.green);
  const b = numberValue(value.b, value.blue);
  if (r === undefined || g === undefined || b === undefined) return undefined;
  const alpha = numberValue(value.a, value.alpha, value.opacity) ?? 1;
  const rr = r <= 1 ? Math.round(r * 255) : Math.round(r);
  const gg = g <= 1 ? Math.round(g * 255) : Math.round(g);
  const bb = b <= 1 ? Math.round(b * 255) : Math.round(b);
  return `rgba(${rr}, ${gg}, ${bb}, ${Math.max(0, Math.min(alpha, 1))})`;
}

function firstVisibleFill(
  node: Record<string, unknown>,
): Record<string, unknown> | null {
  const fills = Array.isArray(node.fills)
    ? node.fills
    : Array.isArray(node.fillPaints)
      ? node.fillPaints
      : [];
  for (const fill of fills) {
    if (!isRecord(fill)) continue;
    if (fill.visible === false) continue;
    return fill;
  }
  return null;
}

function imageRefFromFill(fill: Record<string, unknown>): string | undefined {
  for (const key of ["imageRef", "imageHash", "hash", "ref"]) {
    const value = fill[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function imageUrl(hashHex: string, ctx: RenderContext): string | null {
  const mapped = ctx.imageMap.get(hashHex);
  if (!mapped) {
    ctx.unresolvedImages.add(hashHex);
    return null;
  }
  if (
    mapped.startsWith("data:") ||
    mapped.startsWith("http:") ||
    mapped.startsWith("https:") ||
    mapped.startsWith("/")
  ) {
    return mapped;
  }
  return `./${mapped.replace(/^\.?\//, "")}`;
}

function nodeText(node: Record<string, unknown>): string {
  for (const key of ["characters", "text", "content"]) {
    const value = node[key];
    if (typeof value === "string") return value;
  }
  return "";
}

function styleForNode(node: Record<string, unknown>): string {
  const styles: string[] = ["box-sizing: border-box"];
  const width = dimension(node, "width");
  const height = dimension(node, "height");
  if (width !== undefined) styles.push(`width: ${Math.round(width)}px`);
  if (height !== undefined) styles.push(`min-height: ${Math.round(height)}px`);

  const layoutMode =
    typeof node.layoutMode === "string" ? node.layoutMode.toUpperCase() : "";
  if (layoutMode === "HORIZONTAL" || layoutMode === "VERTICAL") {
    styles.push("display: flex");
    styles.push(
      `flex-direction: ${layoutMode === "HORIZONTAL" ? "row" : "column"}`,
    );
    const gap = numberValue(node.itemSpacing, node.gap);
    if (gap !== undefined) styles.push(`gap: ${Math.round(gap)}px`);
    const padding = [
      numberValue(node.paddingTop) ?? 0,
      numberValue(node.paddingRight) ?? 0,
      numberValue(node.paddingBottom) ?? 0,
      numberValue(node.paddingLeft) ?? 0,
    ];
    if (padding.some((value) => value > 0)) {
      styles.push(
        `padding: ${padding.map((value) => `${Math.round(value)}px`).join(" ")}`,
      );
    }
  } else {
    styles.push("position: relative");
  }

  const fill = firstVisibleFill(node);
  const fillType =
    typeof fill?.type === "string" ? fill.type.toUpperCase() : "";
  const color = colorToCss(fill?.color ?? node.backgroundColor);
  if (fillType !== "IMAGE" && color) styles.push(`background: ${color}`);

  const radius = numberValue(node.cornerRadius, node.borderRadius);
  if (radius !== undefined)
    styles.push(`border-radius: ${Math.round(radius)}px`);
  const opacity = numberValue(node.opacity);
  if (opacity !== undefined && opacity < 1) styles.push(`opacity: ${opacity}`);
  const fontSize = numberValue(node.fontSize);
  if (fontSize !== undefined)
    styles.push(`font-size: ${Math.round(fontSize)}px`);
  const fontWeight = numberValue(node.fontWeight);
  if (fontWeight !== undefined)
    styles.push(`font-weight: ${Math.round(fontWeight)}`);
  const lineHeight = numberValue(node.lineHeightPx, node.lineHeight);
  if (lineHeight !== undefined)
    styles.push(`line-height: ${Math.round(lineHeight)}px`);
  const textColor = colorToCss(
    node.style && isRecord(node.style) ? node.style.color : undefined,
  );
  if (textColor) styles.push(`color: ${textColor}`);
  return styles.join("; ");
}

function renderNode(node: Record<string, unknown>, ctx: RenderContext): string {
  const type = nodeType(node);
  const id = nodeId(node);
  const name = nodeName(node);
  const attrs = [
    `data-figma-node-name="${escapeHtml(name)}"`,
    id ? `data-figma-node-id="${escapeHtml(id)}"` : "",
    `data-figma-node-type="${escapeHtml(type || "NODE")}"`,
    `style="${escapeHtml(styleForNode(node))}"`,
  ]
    .filter(Boolean)
    .join(" ");

  const fill = firstVisibleFill(node);
  const imageRef = fill ? imageRefFromFill(fill) : undefined;
  if (imageRef) {
    const src = imageUrl(imageRef, ctx);
    if (src) {
      return `<div ${attrs}><img src="${escapeHtml(src)}" alt="${escapeHtml(
        name,
      )}" style="width:100%;height:100%;object-fit:cover;display:block" /></div>`;
    }
  }

  if (type === "TEXT") {
    return `<div ${attrs}>${escapeHtml(nodeText(node)).replace(/\n/g, "<br />")}</div>`;
  }

  const children = childrenOf(node);
  const inner = children.map((child) => renderNode(child, ctx)).join("\n");
  return `<section ${attrs}>${inner}</section>`;
}

function topLevelFrames(
  root: Record<string, unknown>,
  selectionNodeId?: string,
): Record<string, unknown>[] {
  const children = childrenOf(root);
  const candidates = children.length > 0 ? children : [root];
  if (selectionNodeId) {
    const selected = findNode(root, selectionNodeId);
    if (selected) return [selected];
  }
  if (isTopLevelFrameNode(root)) return [root];
  const frames = candidates.filter((node) => {
    return isTopLevelFrameNode(node);
  });
  return frames.length > 0 ? frames : candidates.filter(isRecord).slice(0, 12);
}

function findNode(
  node: Record<string, unknown>,
  targetId: string,
): Record<string, unknown> | null {
  if (nodeId(node) === targetId) return node;
  for (const child of childrenOf(node)) {
    const found = findNode(child, targetId);
    if (found) return found;
  }
  return null;
}

function standaloneHtml(
  title: string,
  body: string,
  meta: Record<string, unknown>,
) {
  const metaJson = escapeHtml(JSON.stringify(meta));
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <!-- Imported from Figma data. Source metadata: ${metaJson} -->
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; background: #f8fafc; color: #0f172a; }
    .design-import-frame { margin: 0 auto; background: white; overflow: hidden; box-shadow: 0 24px 80px rgba(15, 23, 42, 0.14); }
  </style>
</head>
<body>
  <main class="design-import-frame">
${body
  .split("\n")
  .map((line) => `    ${line}`)
  .join("\n")}
  </main>
</body>
</html>`;
}

export function renderFigmaHtml(
  options: RenderFigmaHtmlOptions,
): RenderFigmaHtmlResult {
  const root = findRootNode(options.document);
  if (!root) {
    throw new Error(
      "Decoded Figma document did not contain a renderable root.",
    );
  }
  const ctx: RenderContext = {
    imageMap: options.imageMap ?? new Map(),
    unresolvedImages: new Set(),
  };
  const frameCandidates = topLevelFrames(root, options.selectionNodeId);
  const frames = frameCandidates.slice(0, MAX_RENDERED_FRAMES);
  if (frames.length === 0) {
    throw new Error("Decoded Figma document did not contain any frames.");
  }
  const base = options.filename.replace(/\.[^.]+$/, "") || "figma-import";
  const files = frames.map((frame, index) => {
    const title = nodeName(frame);
    const width = dimension(frame, "width") ?? 1440;
    const height = dimension(frame, "height") ?? 900;
    const filename =
      frames.length === 1
        ? `${slug(base)}.html`
        : `${slug(base)}-${slug(title || `frame-${index + 1}`)}.html`;
    return {
      filename,
      width,
      height,
      source: {
        ...options.meta,
        sourceType: "figma",
        frameName: title,
        frameNodeId: nodeId(frame),
      },
      content: standaloneHtml(title, renderNode(frame, ctx), {
        ...options.meta,
        frameName: title,
        frameNodeId: nodeId(frame),
      }),
    };
  });

  const warnings = Array.from(ctx.unresolvedImages).map(
    (hash) =>
      `Image ${hash} was referenced by the Figma file but was not available in the import payload.`,
  );
  if (frameCandidates.length > MAX_RENDERED_FRAMES) {
    warnings.push(
      `Only the first ${MAX_RENDERED_FRAMES} top-level Figma frames were imported. Export fewer frames or select a specific frame to import the rest.`,
    );
  }
  return { files, warnings };
}
