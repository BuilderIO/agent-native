/**
 * Deterministic left-to-right tidy-tree layout for onboarding-journey
 * storyboards. Depth is the column, every subtree owns a vertical band at
 * least as tall as its tallest node, and a parent is centred on its children
 * inside that band — so two nodes in one column can never overlap, whatever
 * their heights. Pure: no DOM, no database, no clock.
 */

export const MIN_CARD_ASPECT = 0.5;
export const MAX_CARD_ASPECT = 2;
export const CARD_HEADER_HEIGHT = 56;
export const STACK_STEP = 10;
export const FOOTER_GAP = 6;
export const FOOTER_HEIGHT = 22;
export const STUB_WIDTH = 176;
export const STUB_HEIGHT = 52;
export const COLUMN_GAP = 160;
export const ROW_GAP = 56;
export const ROOT_GAP = 96;
export const ELBOW_OFFSET = 48;
export const LABEL_WIDTH = 60;
export const LABEL_HEIGHT = 22;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export class JourneyLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JourneyLayoutError";
  }
}

export interface JourneyLayoutNode {
  key: string;
  parentKey: string | null;
  kind: "card" | "stub";
  /** Real pixel size of the card's screenshot. Cards without one use `fallbackAspect`. */
  frame?: { width: number; height: number };
  /** Extra examples stacked behind the front card. */
  layers?: number;
  /** Cards with a captured date get a footer line under the stack. */
  footer?: boolean;
}

export interface PlacedNode {
  key: string;
  parentKey: string | null;
  kind: "card" | "stub";
  depth: number;
  /** The front card, or the stub. */
  rect: Rect;
  /** Pixel height of the image area inside the front card (cards only). */
  imageHeight: number;
  /** One rect per stacked extra example, nearest first. */
  layers: Rect[];
  footer: Rect | null;
  /** Everything the node paints: front card, stack and footer. */
  footprint: Rect;
}

export interface PlacedEdge {
  fromKey: string;
  toKey: string;
  points: Point[];
  labelRect: Rect;
}

export interface JourneyLayout {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  bounds: Rect;
}

export function clampAspect(aspect: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0) return MAX_CARD_ASPECT / 2;
  return Math.min(MAX_CARD_ASPECT, Math.max(MIN_CARD_ASPECT, aspect));
}

/**
 * Card size for a fixed width. The image area follows the frame's aspect
 * ratio, clamped to [0.5, 2]; the image is drawn with `object-fit: contain`,
 * so a frame outside the clamp is letterboxed rather than stretched or cropped.
 */
export function cardSize(
  cardWidth: number,
  frame: { width: number; height: number } | undefined,
  fallbackAspect = 4 / 3,
): { width: number; height: number; imageHeight: number } {
  const aspect = clampAspect(
    frame ? frame.width / frame.height : fallbackAspect,
  );
  const imageHeight = Math.round(cardWidth / aspect);
  return {
    width: cardWidth,
    height: CARD_HEADER_HEIGHT + imageHeight,
    imageHeight,
  };
}

interface Sized {
  node: JourneyLayoutNode;
  depth: number;
  width: number;
  height: number;
  frontHeight: number;
  imageHeight: number;
  layers: number;
  footerHeight: number;
  band: number;
  children: Sized[];
  x: number;
  y: number;
}

function size(node: JourneyLayoutNode, cardWidth: number): Sized {
  if (node.kind === "stub") {
    return {
      node,
      depth: 0,
      width: STUB_WIDTH,
      height: STUB_HEIGHT,
      frontHeight: STUB_HEIGHT,
      imageHeight: 0,
      layers: 0,
      footerHeight: 0,
      band: 0,
      children: [],
      x: 0,
      y: 0,
    };
  }
  const card = cardSize(cardWidth, node.frame);
  const layers = node.layers ?? 0;
  const footerHeight = node.footer ? FOOTER_GAP + FOOTER_HEIGHT : 0;
  return {
    node,
    depth: 0,
    width: card.width,
    height: card.height + layers * STACK_STEP + footerHeight,
    frontHeight: card.height,
    imageHeight: card.imageHeight,
    layers,
    footerHeight,
    band: 0,
    children: [],
    x: 0,
    y: 0,
  };
}

function link(sized: Sized[]): Sized[] {
  const byKey = new Map<string, Sized>();
  for (const entry of sized) {
    if (byKey.has(entry.node.key)) {
      throw new JourneyLayoutError(`Duplicate node key "${entry.node.key}".`);
    }
    byKey.set(entry.node.key, entry);
  }
  const roots: Sized[] = [];
  for (const entry of sized) {
    const { parentKey } = entry.node;
    if (parentKey === null) {
      roots.push(entry);
      continue;
    }
    const parent = byKey.get(parentKey);
    if (!parent) {
      throw new JourneyLayoutError(
        `Node "${entry.node.key}" references missing parent "${parentKey}".`,
      );
    }
    if (parent.node.kind === "stub") {
      throw new JourneyLayoutError(
        `Stub "${parentKey}" cannot have child "${entry.node.key}".`,
      );
    }
    parent.children.push(entry);
  }
  return roots;
}

function measure(entry: Sized, depth: number): void {
  entry.depth = depth;
  let block = 0;
  entry.children.forEach((child, index) => {
    measure(child, depth + 1);
    block += child.band + (index > 0 ? ROW_GAP : 0);
  });
  entry.band = Math.max(entry.height, block);
}

function place(entry: Sized, top: number, columnX: number[]): void {
  entry.x = columnX[entry.depth]!;
  if (entry.children.length === 0) {
    entry.y = top + Math.round((entry.band - entry.height) / 2);
    return;
  }
  const block =
    entry.children.reduce((sum, child) => sum + child.band, 0) +
    ROW_GAP * (entry.children.length - 1);
  let cursor = top + Math.round((entry.band - block) / 2);
  for (const child of entry.children) {
    place(child, cursor, columnX);
    cursor += child.band + ROW_GAP;
  }
  const first = entry.children[0]!;
  const last = entry.children[entry.children.length - 1]!;
  const anchor =
    (first.y + first.frontHeight / 2 + last.y + last.frontHeight / 2) / 2;
  const desired = Math.round(anchor - entry.frontHeight / 2);
  entry.y = Math.min(top + entry.band - entry.height, Math.max(top, desired));
}

function collect(entries: Sized[], out: Sized[]): void {
  for (const entry of entries) {
    out.push(entry);
    collect(entry.children, out);
  }
}

function union(rects: Rect[]): Rect {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Siblings keep the order they have in `nodes`; roots are laid out top to
 * bottom in that order too. Throws `JourneyLayoutError` on duplicate keys,
 * missing parents, stub parents, and cycles.
 */
export function layoutJourney(
  nodes: readonly JourneyLayoutNode[],
  options: { cardWidth: number },
): JourneyLayout {
  if (nodes.length === 0) {
    return {
      nodes: [],
      edges: [],
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    };
  }
  const sized = nodes.map((node) => size(node, options.cardWidth));
  const roots = link(sized);
  roots.forEach((root) => measure(root, 0));
  const ordered: Sized[] = [];
  collect(roots, ordered);
  if (ordered.length !== sized.length) {
    const reached = new Set(ordered.map((entry) => entry.node.key));
    const stuck = sized.find((entry) => !reached.has(entry.node.key));
    throw new JourneyLayoutError(
      `Node "${stuck?.node.key}" is part of a parent cycle.`,
    );
  }

  const columnWidths: number[] = [];
  for (const entry of ordered) {
    columnWidths[entry.depth] = Math.max(
      columnWidths[entry.depth] ?? 0,
      entry.width,
    );
  }
  const columnX: number[] = [];
  let left = 0;
  columnWidths.forEach((width, depth) => {
    columnX[depth] = left;
    left += width + COLUMN_GAP;
  });

  let top = 0;
  for (const root of roots) {
    place(root, top, columnX);
    top += root.band + ROOT_GAP;
  }

  const placed: PlacedNode[] = sized.map((entry) => {
    const rect: Rect = {
      x: entry.x,
      y: entry.y,
      width: entry.width,
      height: entry.frontHeight,
    };
    const layers: Rect[] = Array.from({ length: entry.layers }, (_, index) => ({
      ...rect,
      y: rect.y + STACK_STEP * (index + 1),
    }));
    const stackBottom = rect.y + rect.height + entry.layers * STACK_STEP;
    const footer: Rect | null = entry.footerHeight
      ? {
          x: rect.x,
          y: stackBottom + FOOTER_GAP,
          width: rect.width,
          height: FOOTER_HEIGHT,
        }
      : null;
    return {
      key: entry.node.key,
      parentKey: entry.node.parentKey,
      kind: entry.node.kind,
      depth: entry.depth,
      rect,
      imageHeight: entry.imageHeight,
      layers,
      footer,
      footprint: union([rect, ...layers, ...(footer ? [footer] : [])]),
    };
  });

  const placedByKey = new Map(placed.map((entry) => [entry.key, entry]));
  const edges: PlacedEdge[] = [];
  for (const entry of sized) {
    const { parentKey } = entry.node;
    if (parentKey === null) continue;
    const parent = placedByKey.get(parentKey)!;
    const child = placedByKey.get(entry.node.key)!;
    const x1 = parent.rect.x + parent.rect.width;
    const y1 = Math.round(parent.rect.y + parent.rect.height / 2);
    const x2 = child.rect.x;
    const y2 = Math.round(child.rect.y + child.rect.height / 2);
    const midX = x1 + ELBOW_OFFSET;
    const points: Point[] =
      y1 === y2
        ? [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
          ]
        : [
            { x: x1, y: y1 },
            { x: midX, y: y1 },
            { x: midX, y: y2 },
            { x: x2, y: y2 },
          ];
    edges.push({
      fromKey: parentKey,
      toKey: entry.node.key,
      points,
      labelRect: {
        x: Math.round((midX + x2) / 2 - LABEL_WIDTH / 2),
        y: y2 - LABEL_HEIGHT / 2,
        width: LABEL_WIDTH,
        height: LABEL_HEIGHT,
      },
    });
  }

  return {
    nodes: placed,
    edges,
    bounds: union([
      ...placed.map((entry) => entry.footprint),
      ...edges.map((edge) => edge.labelRect),
    ]),
  };
}
