export interface PenPoint {
  x: number;
  y: number;
}

export interface PenNode {
  point: PenPoint;
  handleIn?: PenPoint;
  handleOut?: PenPoint;
}

export interface PenPath {
  nodes: PenNode[];
  closed: boolean;
}

export interface PenGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_PATH_SIZE = 12;

export function createCornerNode(point: PenPoint): PenNode {
  return { point: { ...point } };
}

export function createSmoothNode(anchor: PenPoint, handleOut: PenPoint) {
  return {
    point: { ...anchor },
    handleIn: mirrorPoint(anchor, handleOut),
    handleOut: { ...handleOut },
  };
}

export function appendPenNode(path: PenPath | null, node: PenNode): PenPath {
  return {
    nodes: [...(path?.nodes ?? []), clonePenNode(node)],
    closed: false,
  };
}

export function clonePenPath(path: PenPath): PenPath {
  return {
    nodes: path.nodes.map(clonePenNode),
    closed: path.closed,
  };
}

export function closePenPath(path: PenPath): PenPath {
  return {
    nodes: path.nodes.map(clonePenNode),
    closed: path.nodes.length > 1,
  };
}

export function constrainPointTo45Degrees(
  origin: PenPoint,
  point: PenPoint,
): PenPoint {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return { ...point };

  const angle = Math.atan2(dy, dx);
  const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  return {
    x: origin.x + Math.cos(snappedAngle) * distance,
    y: origin.y + Math.sin(snappedAngle) * distance,
  };
}

export function isPenCloseTarget(
  path: PenPath | null,
  point: PenPoint,
  hitRadius: number,
) {
  const start = path?.nodes[0]?.point;
  if (!start || (path?.nodes.length ?? 0) < 2) return false;
  return Math.hypot(point.x - start.x, point.y - start.y) <= hitRadius;
}

export function getPenPathGeometry(path: PenPath): PenGeometry {
  const points = path.nodes.flatMap((node) =>
    [node.point, node.handleIn, node.handleOut].filter(isPenPoint),
  );
  if (points.length === 0) {
    return { x: 0, y: 0, width: MIN_PATH_SIZE, height: MIN_PATH_SIZE };
  }

  const left = Math.min(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const right = Math.max(...points.map((point) => point.x));
  const bottom = Math.max(...points.map((point) => point.y));
  return {
    x: left,
    y: top,
    width: Math.max(MIN_PATH_SIZE, right - left),
    height: Math.max(MIN_PATH_SIZE, bottom - top),
  };
}

export function serializePenPath(path: PenPath): string {
  const [first, ...rest] = path.nodes;
  if (!first) return "";

  const commands = [`M ${formatPoint(first.point)}`];
  rest.forEach((node, index) => {
    const previous = path.nodes[index];
    commands.push(serializeSegment(previous, node));
  });

  if (path.closed && path.nodes.length > 1) {
    commands.push(serializeSegment(path.nodes[path.nodes.length - 1], first));
    commands.push("Z");
  }

  return commands.join(" ");
}

export function offsetPenPath(path: PenPath, offset: PenPoint): PenPath {
  return transformPenPath(path, (point) => ({
    x: point.x - offset.x,
    y: point.y - offset.y,
  }));
}

export function translatePenPath(
  path: PenPath,
  dx: number,
  dy: number,
): PenPath {
  return transformPenPath(path, (point) => ({
    x: point.x + dx,
    y: point.y + dy,
  }));
}

export function scalePenPathToGeometry(
  path: PenPath,
  origin: PenGeometry,
  next: PenGeometry,
): PenPath {
  const scaleX = next.width / Math.max(1, origin.width);
  const scaleY = next.height / Math.max(1, origin.height);
  return transformPenPath(path, (point) => ({
    x: next.x + (point.x - origin.x) * scaleX,
    y: next.y + (point.y - origin.y) * scaleY,
  }));
}

function serializeSegment(from: PenNode, to: PenNode) {
  const c1 = from.handleOut ?? from.point;
  const c2 = to.handleIn ?? to.point;
  if (samePoint(c1, from.point) && samePoint(c2, to.point)) {
    return `L ${formatPoint(to.point)}`;
  }
  return `C ${formatPoint(c1)} ${formatPoint(c2)} ${formatPoint(to.point)}`;
}

function transformPenPath(
  path: PenPath,
  transform: (point: PenPoint) => PenPoint,
): PenPath {
  return {
    nodes: path.nodes.map((node) => ({
      point: transform(node.point),
      handleIn: node.handleIn ? transform(node.handleIn) : undefined,
      handleOut: node.handleOut ? transform(node.handleOut) : undefined,
    })),
    closed: path.closed,
  };
}

function clonePenNode(node: PenNode): PenNode {
  return {
    point: { ...node.point },
    handleIn: node.handleIn ? { ...node.handleIn } : undefined,
    handleOut: node.handleOut ? { ...node.handleOut } : undefined,
  };
}

function mirrorPoint(anchor: PenPoint, point: PenPoint): PenPoint {
  return {
    x: anchor.x - (point.x - anchor.x),
    y: anchor.y - (point.y - anchor.y),
  };
}

function formatPoint(point: PenPoint) {
  return `${roundCoord(point.x)} ${roundCoord(point.y)}`;
}

function roundCoord(value: number) {
  return Math.round(value * 10) / 10;
}

function samePoint(a: PenPoint, b: PenPoint) {
  return a.x === b.x && a.y === b.y;
}

function isPenPoint(point: PenPoint | undefined): point is PenPoint {
  return !!point;
}
