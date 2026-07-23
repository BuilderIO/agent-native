export interface FigmaRgba {
  r: number;
  g: number;
  b: number;
  a?: number;
}

export interface FigmaFrameSummary {
  id: string;
  name: string;
  type: string;
  text: string[];
  colors: string[];
  typography: Array<{
    family?: string;
    size?: number;
    weight?: number;
    lineHeight?: number;
  }>;
  spacing: number[];
  radii: number[];
}

export interface FigmaContextNode {
  id: string;
  name: string;
  type: string;
  box?: { x: number; y: number; width: number; height: number };
  text?: {
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
  };
  fills?: Array<{
    type: string;
    color?: string;
    opacity?: number;
    angleDeg?: number;
    stops?: Array<{ position: number; color: string }>;
    imageRef?: string;
    scaleMode?: string;
  }>;
  opacity?: number;
  blendMode?: string;
  rotation?: number;
  isMask?: boolean;
  strokes?: {
    paints: NonNullable<FigmaContextNode["fills"]>;
    weight?: number;
    align?: string;
  };
  cornerRadius?: number | [number, number, number, number];
  effects?: Array<{
    type: string;
    color?: string;
    offset?: { x: number; y: number };
    radius?: number;
    spread?: number;
  }>;
  layout?: {
    mode: string;
    primaryAxisAlignItems?: string;
    counterAxisAlignItems?: string;
    itemSpacing?: number;
    wrap?: string;
    padding: { top: number; right: number; bottom: number; left: number };
    sizingHorizontal?: string;
    sizingVertical?: string;
  };
  componentId?: string;
  isComponent?: boolean;
  isInstance?: boolean;
  styles?: Record<string, string>;
  children?: FigmaContextNode[];
  childCount?: number;
  truncatedChildren?: boolean;
  truncatedDepth?: boolean;
}

export interface SummarizeFigmaNodeResult {
  node: FigmaContextNode;
  nodeCount: number;
  truncated: boolean;
}

export function summarizeFigmaNode(
  value: unknown,
  options: { maxDepth?: number; maxNodes?: number } = {},
): SummarizeFigmaNodeResult {
  const root = asRecord(value);
  if (!root) throw new Error("Figma node must be an object.");
  const maxDepth = options.maxDepth ?? 4;
  const maxNodes = options.maxNodes ?? 300;
  let nodeCount = 0;
  let truncated = false;
  const build = (
    node: Record<string, unknown>,
    depth: number,
  ): FigmaContextNode => {
    nodeCount++;
    const bounding = asRecord(node.absoluteBoundingBox);
    const box = bounding
      ? {
          x: round(numberValue(bounding.x) ?? 0),
          y: round(numberValue(bounding.y) ?? 0),
          width: round(numberValue(bounding.width) ?? 0),
          height: round(numberValue(bounding.height) ?? 0),
        }
      : undefined;
    const fills = array(node.fills).flatMap((paint) => {
      const described = describeFigmaPaint(asRecord(paint), box);
      return described ? [described] : [];
    });
    const strokePaints = array(node.strokes).flatMap((paint) => {
      const described = describeFigmaPaint(asRecord(paint), box);
      return described ? [described] : [];
    });
    const effects = array(node.effects).flatMap((effect) => {
      const described = describeFigmaEffect(asRecord(effect));
      return described ? [described] : [];
    });
    const characters =
      typeof node.characters === "string" ? node.characters : undefined;
    const style = asRecord(node.style);
    const children = array(node.children).flatMap((child) => {
      const record = asRecord(child);
      return record?.visible === false || !record ? [] : [record];
    });
    const summary: FigmaContextNode = {
      id: stringValue(node.id) ?? "",
      name: stringValue(node.name) ?? stringValue(node.type) ?? "Untitled",
      type: stringValue(node.type) ?? "UNKNOWN",
      box,
      opacity:
        numberValue(node.opacity) !== undefined &&
        numberValue(node.opacity)! < 1
          ? round(numberValue(node.opacity)!, 2)
          : undefined,
      blendMode:
        stringValue(node.blendMode) &&
        node.blendMode !== "NORMAL" &&
        node.blendMode !== "PASS_THROUGH"
          ? String(node.blendMode)
          : undefined,
      rotation: numberValue(node.rotation)
        ? round(numberValue(node.rotation)!, 2)
        : undefined,
      isMask: node.isMask === true ? true : undefined,
      ...(characters !== undefined
        ? {
            text: {
              characters:
                characters.length > 500
                  ? `${characters.slice(0, 500)}…`
                  : characters,
              truncated: characters.length > 500,
              fontFamily: stringValue(style?.fontFamily),
              fontWeight: numberValue(style?.fontWeight),
              fontSize: numberValue(style?.fontSize),
              lineHeightPx: numberValue(style?.lineHeightPx),
              lineHeightPercent: numberValue(style?.lineHeightPercent),
              letterSpacing: numberValue(style?.letterSpacing),
              textAlignHorizontal: stringValue(style?.textAlignHorizontal),
              textCase:
                stringValue(style?.textCase) && style?.textCase !== "ORIGINAL"
                  ? String(style?.textCase)
                  : undefined,
              textDecoration:
                stringValue(style?.textDecoration) &&
                style?.textDecoration !== "NONE"
                  ? String(style?.textDecoration)
                  : undefined,
            },
          }
        : {}),
      ...(fills.length ? { fills } : {}),
      ...(strokePaints.length
        ? {
            strokes: {
              paints: strokePaints,
              weight: numberValue(node.strokeWeight),
              align: stringValue(node.strokeAlign),
            },
          }
        : {}),
      cornerRadius: figmaCornerRadius(node),
      ...(effects.length ? { effects } : {}),
      ...(node.layoutMode && node.layoutMode !== "NONE"
        ? {
            layout: {
              mode: String(node.layoutMode),
              primaryAxisAlignItems: stringValue(node.primaryAxisAlignItems),
              counterAxisAlignItems: stringValue(node.counterAxisAlignItems),
              itemSpacing: numberValue(node.itemSpacing),
              wrap: stringValue(node.layoutWrap),
              padding: {
                top: numberValue(node.paddingTop) ?? 0,
                right: numberValue(node.paddingRight) ?? 0,
                bottom: numberValue(node.paddingBottom) ?? 0,
                left: numberValue(node.paddingLeft) ?? 0,
              },
              sizingHorizontal: stringValue(node.layoutSizingHorizontal),
              sizingVertical: stringValue(node.layoutSizingVertical),
            },
          }
        : {}),
      componentId: stringValue(node.componentId),
      isComponent: node.type === "COMPONENT" ? true : undefined,
      isInstance: node.type === "INSTANCE" ? true : undefined,
      styles: stringRecord(node.styles),
    };
    if (!children.length) return summary;
    if (depth >= maxDepth) {
      summary.childCount = children.length;
      summary.truncatedDepth = true;
      truncated = true;
      return summary;
    }
    const built: FigmaContextNode[] = [];
    for (const child of children) {
      if (nodeCount >= maxNodes) {
        summary.childCount = children.length - built.length;
        summary.truncatedChildren = true;
        truncated = true;
        break;
      }
      built.push(build(child, depth + 1));
    }
    summary.children = built;
    return summary;
  };
  return { node: build(root, 0), nodeCount, truncated };
}

export function extractFigmaTopLevelFrames(
  value: unknown,
): Record<string, unknown>[] {
  const document = asRecord(value);
  const pages = array(document?.children);
  const frames = pages
    .flatMap((page) => array(asRecord(page)?.children))
    .flatMap((child) => {
      const record = asRecord(child);
      return record ? [record] : [];
    });
  return frames.length > 0 ? frames : document ? [document] : [];
}

export function summarizeFigmaFrame(value: unknown): FigmaFrameSummary {
  const frame = asRecord(value) ?? {};
  const text = new Set<string>();
  const colors = new Set<string>();
  const typography = new Map<string, FigmaFrameSummary["typography"][number]>();
  const spacing = new Set<number>();
  const radii = new Set<number>();
  visitFigmaNode(frame, { text, colors, typography, spacing, radii });
  return {
    id: stringValue(frame.id) ?? "",
    name: stringValue(frame.name) ?? "Untitled frame",
    type: stringValue(frame.type) ?? "UNKNOWN",
    text: [...text],
    colors: [...colors],
    typography: [...typography.values()],
    spacing: [...spacing].sort(numberSort),
    radii: [...radii].sort(numberSort),
  };
}

export function figmaColorToHex(color: FigmaRgba, opacity = 1): string {
  const alpha = clamp(color.a ?? 1) * clamp(opacity);
  const channels = [color.r, color.g, color.b].map((channel) =>
    Math.round(clamp(channel) * 255)
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${channels.join("")}${
    alpha < 1
      ? Math.round(alpha * 255)
          .toString(16)
          .padStart(2, "0")
      : ""
  }`.toUpperCase();
}

export function compositeFigmaColors(
  foreground: FigmaRgba,
  background: FigmaRgba,
): Required<FigmaRgba> {
  const foregroundAlpha = clamp(foreground.a ?? 1);
  const backgroundAlpha = clamp(background.a ?? 1);
  const alpha = foregroundAlpha + backgroundAlpha * (1 - foregroundAlpha);
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r:
      (clamp(foreground.r) * foregroundAlpha +
        clamp(background.r) * backgroundAlpha * (1 - foregroundAlpha)) /
      alpha,
    g:
      (clamp(foreground.g) * foregroundAlpha +
        clamp(background.g) * backgroundAlpha * (1 - foregroundAlpha)) /
      alpha,
    b:
      (clamp(foreground.b) * foregroundAlpha +
        clamp(background.b) * backgroundAlpha * (1 - foregroundAlpha)) /
      alpha,
    a: alpha,
  };
}

export function figmaContrastRatio(a: FigmaRgba, b: FigmaRgba): number {
  const light = Math.max(relativeLuminance(a), relativeLuminance(b));
  const dark = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (light + 0.05) / (dark + 0.05);
}

function visitFigmaNode(
  node: Record<string, unknown>,
  output: {
    text: Set<string>;
    colors: Set<string>;
    typography: Map<string, FigmaFrameSummary["typography"][number]>;
    spacing: Set<number>;
    radii: Set<number>;
  },
): void {
  const characters = stringValue(node.characters);
  if (characters) output.text.add(characters);
  for (const collection of [node.fills, node.strokes, node.background]) {
    for (const value of array(collection)) {
      const paint = asRecord(value);
      const color = asColor(paint?.color);
      if (color && paint?.visible !== false) {
        output.colors.add(
          figmaColorToHex(color, numberValue(paint?.opacity) ?? 1),
        );
      }
    }
  }
  const style = asRecord(node.style);
  if (style) {
    const typography = {
      family: stringValue(style.fontFamily),
      size: numberValue(style.fontSize),
      weight: numberValue(style.fontWeight),
      lineHeight: numberValue(style.lineHeightPx),
    };
    if (Object.values(typography).some((value) => value !== undefined)) {
      output.typography.set(JSON.stringify(typography), typography);
    }
  }
  for (const key of [
    "itemSpacing",
    "paddingLeft",
    "paddingRight",
    "paddingTop",
    "paddingBottom",
  ]) {
    const value = numberValue(node[key]);
    if (value !== undefined) output.spacing.add(value);
  }
  for (const value of [
    node.cornerRadius,
    ...array(node.rectangleCornerRadii),
  ]) {
    const radius = numberValue(value);
    if (radius !== undefined) output.radii.add(radius);
  }
  for (const child of array(node.children)) {
    const record = asRecord(child);
    if (record) visitFigmaNode(record, output);
  }
}

function relativeLuminance(color: FigmaRgba): number {
  const channels = [color.r, color.g, color.b].map((channel) => {
    const value = clamp(channel);
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function describeFigmaPaint(
  paint: Record<string, unknown> | null,
  box: { width: number; height: number } | undefined,
): NonNullable<FigmaContextNode["fills"]>[number] | null {
  if (!paint || paint.visible === false) return null;
  const type = stringValue(paint.type) ?? "UNKNOWN";
  const opacity = numberValue(paint.opacity);
  if (type === "SOLID") {
    const color = asColor(paint.color);
    return {
      type: "solid",
      ...(color ? { color: figmaColorToHex(color) } : {}),
      ...(opacity !== undefined && opacity < 1
        ? { opacity: round(opacity, 2) }
        : {}),
    };
  }
  if (type.startsWith("GRADIENT_")) {
    const handles = array(paint.gradientHandlePositions)
      .map(asRecord)
      .filter(Boolean) as Record<string, unknown>[];
    const figmaAngle =
      handles.length >= 2
        ? Math.atan2(
            ((numberValue(handles[1].y) ?? 0) -
              (numberValue(handles[0].y) ?? 0)) *
              (box?.height ?? 1),
            ((numberValue(handles[1].x) ?? 0) -
              (numberValue(handles[0].x) ?? 0)) *
              (box?.width ?? 1),
          ) *
          (180 / Math.PI)
        : undefined;
    const angle =
      figmaAngle === undefined
        ? undefined
        : (((figmaAngle + 90) % 360) + 360) % 360;
    return {
      type: `${type.replace("GRADIENT_", "").toLowerCase()}-gradient`,
      ...(opacity !== undefined && opacity < 1
        ? { opacity: round(opacity, 2) }
        : {}),
      ...(angle !== undefined ? { angleDeg: round(angle) } : {}),
      stops: array(paint.gradientStops).flatMap((value) => {
        const stop = asRecord(value);
        const color = asColor(stop?.color);
        return color
          ? [
              {
                position: round(numberValue(stop?.position) ?? 0, 3),
                color: figmaColorToHex(color),
              },
            ]
          : [];
      }),
    };
  }
  return {
    type: type.toLowerCase(),
    ...(opacity !== undefined && opacity < 1
      ? { opacity: round(opacity, 2) }
      : {}),
    ...(stringValue(paint.imageRef)
      ? { imageRef: stringValue(paint.imageRef) }
      : {}),
    ...(stringValue(paint.scaleMode)
      ? { scaleMode: stringValue(paint.scaleMode) }
      : {}),
  };
}

function describeFigmaEffect(
  effect: Record<string, unknown> | null,
): NonNullable<FigmaContextNode["effects"]>[number] | null {
  if (!effect || effect.visible === false) return null;
  const offset = asRecord(effect.offset);
  const color = asColor(effect.color);
  return {
    type: (stringValue(effect.type) ?? "unknown")
      .toLowerCase()
      .replace(/_/g, "-"),
    ...(color ? { color: figmaColorToHex(color) } : {}),
    ...(offset
      ? {
          offset: {
            x: round(numberValue(offset.x) ?? 0),
            y: round(numberValue(offset.y) ?? 0),
          },
        }
      : {}),
    ...(numberValue(effect.radius) !== undefined
      ? { radius: round(numberValue(effect.radius)!) }
      : {}),
    ...(numberValue(effect.spread) !== undefined
      ? { spread: round(numberValue(effect.spread)!) }
      : {}),
  };
}

function figmaCornerRadius(
  node: Record<string, unknown>,
): FigmaContextNode["cornerRadius"] {
  const corners = array(node.rectangleCornerRadii).map(numberValue);
  if (corners.length === 4 && corners.every((value) => value !== undefined)) {
    return corners as [number, number, number, number];
  }
  return numberValue(node.cornerRadius);
}

function asColor(value: unknown): FigmaRgba | null {
  const record = asRecord(value);
  const r = numberValue(record?.r);
  const g = numberValue(record?.g);
  const b = numberValue(record?.b);
  if (r === undefined || g === undefined || b === undefined) return null;
  return { r, g, b, a: numberValue(record?.a) };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function numberSort(a: number, b: number): number {
  return a - b;
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const entries = Object.entries(record).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
}
