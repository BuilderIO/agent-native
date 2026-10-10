import type { NativeSourceBox } from "./native-source-composition";

export type NativeSourceIsolation =
  | { id: string; kind: "opacity"; opacity: number }
  | { id: string; kind: "clip"; clipId: string };

export interface NativeSourcePaintInput {
  id: string;
  box: NativeSourceBox;
  isolationPath: readonly NativeSourceIsolation[];
  opacity: number;
  ownOpacityBaked?: boolean;
}

export interface NativeSourcePaintLeaf {
  kind: "leaf";
  id: string;
  box: NativeSourceBox;
  opacity: number;
  ownOpacityBaked: boolean;
}

export interface NativeSourcePaintGroup {
  kind: "group";
  id: string;
  isolationKind: "root" | "opacity" | "clip";
  box: NativeSourceBox;
  opacity: number;
  clipId?: string;
  isolate: boolean;
  children: NativeSourcePaintNode[];
}

export type NativeSourcePaintNode =
  | NativeSourcePaintLeaf
  | NativeSourcePaintGroup;

export type NativeSourceCompositionPlan =
  | { ok: true; root: NativeSourcePaintGroup; nodeCount: number }
  | {
      ok: false;
      reason: "invalid-input" | "invalid-hierarchy" | "limit-exceeded";
      detail: string;
    };

export const MAX_NATIVE_SOURCE_PAINT_NODES = 512;
export const MAX_NATIVE_SOURCE_GROUP_DEPTH = 16;

function validBox(box: NativeSourceBox): boolean {
  return (
    [box.x, box.y, box.width, box.height].every(Number.isFinite) &&
    Number.isFinite(box.x + box.width) &&
    Number.isFinite(box.y + box.height) &&
    box.width >= 0 &&
    box.height >= 0
  );
}

function union(a: NativeSourceBox, b: NativeSourceBox): NativeSourceBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

function flatten(group: NativeSourcePaintGroup): NativeSourcePaintGroup {
  const children: NativeSourcePaintNode[] = [];
  for (const child of group.children) {
    if (child.kind !== "group") {
      children.push(child);
      continue;
    }
    const nested = flatten(child);
    if (!nested.isolate) children.push(...nested.children);
    else children.push(nested);
  }
  return { ...group, children };
}

export function planNativeSourceComposition(
  paints: readonly NativeSourcePaintInput[],
): NativeSourceCompositionPlan {
  const root: NativeSourcePaintGroup = {
    kind: "group",
    id: "$root",
    isolationKind: "root",
    box: { x: 0, y: 0, width: 0, height: 0 },
    opacity: 1,
    isolate: false,
    children: [],
  };
  const stack: NativeSourcePaintGroup[] = [root];
  const closed = new Set<string>();
  const leafIds = new Set<string>();
  const groupIds = new Set<string>();
  let nodeCount = 1;
  let firstBox = true;

  for (const paint of paints) {
    if (
      !paint.id ||
      paint.id === "$root" ||
      leafIds.has(paint.id) ||
      groupIds.has(paint.id) ||
      !validBox(paint.box) ||
      !Number.isFinite(paint.opacity) ||
      paint.opacity < 0 ||
      paint.opacity > 1 ||
      (paint.ownOpacityBaked && paint.opacity !== 1)
    )
      return {
        ok: false,
        reason: "invalid-input",
        detail: "A source paint has invalid identity, geometry, or opacity.",
      };
    if (paint.isolationPath.length > MAX_NATIVE_SOURCE_GROUP_DEPTH)
      return {
        ok: false,
        reason: "limit-exceeded",
        detail: "Source group nesting exceeds the bounded composition depth.",
      };
    const pathIds = new Set<string>();
    for (const ancestor of paint.isolationPath) {
      const key = `${ancestor.kind}:${ancestor.id}`;
      if (
        !ancestor.id ||
        ancestor.id === "$root" ||
        ancestor.id === paint.id ||
        pathIds.has(key) ||
        leafIds.has(ancestor.id) ||
        (ancestor.kind === "opacity" &&
          (!Number.isFinite(ancestor.opacity) ||
            ancestor.opacity < 0 ||
            ancestor.opacity > 1)) ||
        (ancestor.kind === "clip" && !ancestor.clipId)
      )
        return {
          ok: false,
          reason: "invalid-input",
          detail:
            "A source ancestor has invalid identity, opacity, or clip identity.",
        };
      pathIds.add(key);
    }

    let common = 0;
    while (
      common < paint.isolationPath.length &&
      common + 1 < stack.length &&
      stack[common + 1].id === paint.isolationPath[common].id &&
      stack[common + 1].isolationKind === paint.isolationPath[common].kind
    ) {
      const current = stack[common + 1];
      const incoming = paint.isolationPath[common];
      if (
        (incoming.kind === "opacity" && current.opacity !== incoming.opacity) ||
        (incoming.kind === "clip" && current.clipId !== incoming.clipId)
      )
        return {
          ok: false,
          reason: "invalid-hierarchy",
          detail:
            "A source group changed its opacity or clip identity within one paint order.",
        };
      common += 1;
    }
    while (stack.length > common + 1) {
      const removed = stack.pop()!;
      closed.add(`${removed.isolationKind}:${removed.id}`);
    }
    for (const ancestor of paint.isolationPath.slice(common)) {
      if (closed.has(`${ancestor.kind}:${ancestor.id}`))
        return {
          ok: false,
          reason: "invalid-hierarchy",
          detail:
            "A source group reappeared after another paint group; DOM paint order cannot be preserved.",
        };
      const group: NativeSourcePaintGroup = {
        kind: "group",
        id: ancestor.id,
        isolationKind: ancestor.kind,
        box: paint.box,
        opacity: ancestor.kind === "opacity" ? ancestor.opacity : 1,
        clipId: ancestor.kind === "clip" ? ancestor.clipId : undefined,
        isolate: ancestor.kind === "clip" || ancestor.opacity < 1,
        children: [],
      };
      stack[stack.length - 1].children.push(group);
      stack.push(group);
      groupIds.add(ancestor.id);
      nodeCount += 1;
    }
    const leaf: NativeSourcePaintLeaf = {
      kind: "leaf",
      id: paint.id,
      box: paint.box,
      opacity: paint.opacity,
      ownOpacityBaked: paint.ownOpacityBaked === true,
    };
    stack[stack.length - 1].children.push(leaf);
    leafIds.add(paint.id);
    nodeCount += 1;
    if (nodeCount > MAX_NATIVE_SOURCE_PAINT_NODES)
      return {
        ok: false,
        reason: "limit-exceeded",
        detail: "Source paint nodes exceed the bounded composition size.",
      };
    for (const group of stack) {
      const next =
        group === root && firstBox ? paint.box : union(group.box, paint.box);
      if (!validBox(next))
        return {
          ok: false,
          reason: "invalid-input",
          detail: "Source group bounds exceed finite geometry.",
        };
      group.box = next;
    }
    firstBox = false;
  }
  return { ok: true, root: flatten(root), nodeCount };
}
