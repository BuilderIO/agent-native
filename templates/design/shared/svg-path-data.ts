import type { PenNode, PenPath, PenPoint } from "./pen-path";

export function parseSvgPathData(d: string): PenPath[] | null {
  const tokens = d.match(/[a-df-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi);
  if (!tokens) return null;
  const paths: PenPath[] = [];
  let nodes: PenNode[] = [];
  let current: PenPoint = { x: 0, y: 0 };
  let start: PenPoint = { x: 0, y: 0 };
  const last: { control: PenPoint | null; quad: PenPoint | null } = {
    control: null,
    quad: null,
  };
  let command = "";
  let index = 0;

  const finish = (closed: boolean) => {
    if (nodes.length === 0) return;
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    if (closed && nodes.length > 1 && samePoint(first.point, last.point)) {
      if (last.handleIn) first.handleIn = last.handleIn;
      nodes.pop();
    }
    paths.push({ nodes, closed: closed && nodes.length > 1 });
    nodes = [];
  };
  const number = () => {
    const token = tokens[index++];
    const value = Number(token);
    if (token === undefined || !Number.isFinite(value)) throw new Error("nan");
    return value;
  };
  const point = (relative: boolean): PenPoint => {
    const x = number();
    const y = number();
    return relative ? { x: current.x + x, y: current.y + y } : { x, y };
  };
  const ensureStarted = () => {
    if (nodes.length === 0) nodes.push({ point: current });
  };
  const cubicTo = (c1: PenPoint, c2: PenPoint, end: PenPoint) => {
    ensureStarted();
    const previous = nodes[nodes.length - 1];
    if (previous) previous.handleOut = c1;
    nodes.push({ point: end, handleIn: c2 });
    current = end;
    last.control = c2;
  };
  const lineTo = (end: PenPoint) => {
    ensureStarted();
    nodes.push({ point: end });
    current = end;
  };

  try {
    while (index < tokens.length) {
      if (/[a-z]/i.test(tokens[index]!)) command = tokens[index++]!;
      else if (!command) return null;
      const relative = command === command.toLowerCase();
      const upper = command.toUpperCase();
      if (upper !== "C" && upper !== "S") last.control = null;
      if (upper !== "Q" && upper !== "T") last.quad = null;
      switch (upper) {
        case "M": {
          finish(false);
          current = point(relative);
          start = current;
          nodes.push({ point: current });
          command = relative ? "l" : "L";
          break;
        }
        case "L":
          lineTo(point(relative));
          break;
        case "H": {
          const x = number();
          lineTo({ x: relative ? current.x + x : x, y: current.y });
          break;
        }
        case "V": {
          const y = number();
          lineTo({ x: current.x, y: relative ? current.y + y : y });
          break;
        }
        case "C": {
          const c1 = point(relative);
          const c2 = point(relative);
          cubicTo(c1, c2, point(relative));
          break;
        }
        case "S": {
          const control = last.control;
          const reflected: PenPoint = control
            ? { x: 2 * current.x - control.x, y: 2 * current.y - control.y }
            : current;
          const c2 = point(relative);
          cubicTo(reflected, c2, point(relative));
          break;
        }
        case "Q":
        case "T": {
          const q: PenPoint =
            upper === "Q"
              ? point(relative)
              : last.quad
                ? {
                    x: 2 * current.x - last.quad.x,
                    y: 2 * current.y - last.quad.y,
                  }
                : current;
          const from = current;
          const end = point(relative);
          cubicTo(
            {
              x: from.x + ((q.x - from.x) * 2) / 3,
              y: from.y + ((q.y - from.y) * 2) / 3,
            },
            {
              x: end.x + ((q.x - end.x) * 2) / 3,
              y: end.y + ((q.y - end.y) * 2) / 3,
            },
            end,
          );
          last.quad = q;
          break;
        }
        case "A": {
          const rx = number();
          const ry = number();
          const rotation = number();
          const large = number() !== 0;
          const sweep = number() !== 0;
          const end = point(relative);
          for (const [c1, c2, to] of arcToCubics(
            current,
            end,
            rx,
            ry,
            rotation,
            large,
            sweep,
          )) {
            cubicTo(c1, c2, to);
          }
          current = end;
          break;
        }
        case "Z":
          finish(true);
          current = start;
          break;
        default:
          return null;
      }
    }
    // coercion-ok: null is the documented "malformed path data" result.
  } catch {
    return null;
  }
  finish(false);
  return paths.length > 0 ? paths : null;
}

function samePoint(a: PenPoint, b: PenPoint) {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
}

function arcToCubics(
  from: PenPoint,
  to: PenPoint,
  rxIn: number,
  ryIn: number,
  rotationDeg: number,
  large: boolean,
  sweep: boolean,
): [PenPoint, PenPoint, PenPoint][] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0 || samePoint(from, to)) {
    return [[from, to, to]];
  }
  const phi = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const sign = large === sweep ? -1 : 1;
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const factor =
    sign *
    Math.sqrt(Math.max(0, numerator / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
  const cx1 = (factor * rx * y1) / ry;
  const cy1 = (-factor * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (from.x + to.x) / 2;
  const cy = sin * cx1 + cos * cy1 + (from.y + to.y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta1 = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = angle(
    (x1 - cx1) / rx,
    (y1 - cy1) / ry,
    (-x1 - cx1) / rx,
    (-y1 - cy1) / ry,
  );
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const segments = Math.ceil(Math.abs(delta) / (Math.PI / 2));
  const step = delta / segments;
  const k = (4 / 3) * Math.tan(step / 4);
  const at = (t: number) => ({
    x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
    y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
  });
  const derivative = (t: number) => ({
    x: -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin,
    y: -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos,
  });
  const result: [PenPoint, PenPoint, PenPoint][] = [];
  for (let i = 0; i < segments; i++) {
    const t1 = theta1 + i * step;
    const t2 = t1 + step;
    const p1 = at(t1);
    const p2 = i === segments - 1 ? to : at(t2);
    const d1 = derivative(t1);
    const d2 = derivative(t2);
    result.push([
      { x: p1.x + k * d1.x, y: p1.y + k * d1.y },
      { x: p2.x - k * d2.x, y: p2.y - k * d2.y },
      p2,
    ]);
  }
  return result;
}
