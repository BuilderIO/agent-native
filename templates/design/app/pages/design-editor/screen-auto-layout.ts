import {
  applyVisualEdit,
  buildCodeLayerProjection,
  type CodeLayerNode,
  type CodeLayerProjection,
} from "@shared/code-layer";

import {
  inferAutoLayoutFromChildren,
  type AlignableRect,
} from "./layout-operations";

export type EnableInlineScreenAutoLayoutResult =
  | {
      status: "applied" | "unchanged";
      content: string;
      targetNodeId: string;
      direction: "row" | "column";
      gap: number;
      padding: number;
    }
  | {
      status: "unsupported" | "failed";
      content: string;
      message?: string;
    };

function nodeById(projection: CodeLayerProjection): Map<string, CodeLayerNode> {
  return new Map(projection.nodes.map((node) => [node.id, node]));
}

/**
 * A screen frame owns the authored document body. Fragment-only design files
 * have no editable body in source, so a single visual root is the only safe
 * equivalent. Multiple fragment roots would require inventing a wrapper and
 * changing source structure, which is deliberately left to a semantic edit.
 */
export function resolveInlineScreenAutoLayoutRoot(
  projection: CodeLayerProjection,
): CodeLayerNode | null {
  const body = projection.nodes.find((node) => node.tag === "body");
  if (body) return body;

  const nodes = nodeById(projection);
  const roots = projection.rootNodeIds
    .map((id) => nodes.get(id))
    .filter((node): node is CodeLayerNode =>
      Boolean(node && node.tag !== "html" && node.tag !== "head"),
    );
  return roots.length === 1 ? roots[0]! : null;
}

function finiteStyleNumber(value: string | undefined, fallback = 0): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rectForNode(
  node: CodeLayerNode,
  fallback: { width?: number; height?: number } = {},
): AlignableRect {
  return {
    id: node.id,
    x: finiteStyleNumber(node.style.left),
    y: finiteStyleNumber(node.style.top),
    width: finiteStyleNumber(node.style.width, fallback.width ?? 0),
    height: finiteStyleNumber(node.style.height, fallback.height ?? 0),
  };
}

/** Deterministically enable auto layout on an inline HTML/Alpine screen root. */
export function enableInlineScreenAutoLayout(args: {
  content: string;
  width?: number;
  height?: number;
}): EnableInlineScreenAutoLayoutResult {
  const projection = buildCodeLayerProjection(args.content);
  const target = resolveInlineScreenAutoLayoutRoot(projection);
  if (!target) {
    return { status: "unsupported", content: args.content };
  }

  const nodes = nodeById(projection);
  const targetRect = rectForNode(target, {
    width: args.width,
    height: args.height,
  });
  const childRects = target.children
    .map((childId) => nodes.get(childId))
    .filter((node): node is CodeLayerNode => Boolean(node))
    .map((node) => rectForNode(node));
  const inferred = inferAutoLayoutFromChildren(targetRect, childRects);
  const autoLayoutPatch = applyVisualEdit(args.content, {
    kind: "autoLayout",
    targetId: target.id,
    enabled: true,
    direction: inferred.direction,
    gap: `${inferred.gap}px`,
  });
  if (autoLayoutPatch.result.status !== "applied") {
    return {
      status: "failed",
      content: args.content,
      message: autoLayoutPatch.result.message,
    };
  }

  let content = autoLayoutPatch.content;
  if (inferred.padding > 0) {
    const paddingPatch = applyVisualEdit(content, {
      kind: "style",
      target: { nodeId: target.id },
      property: "padding",
      value: `${inferred.padding}px`,
    });
    if (paddingPatch.result.status === "applied") {
      content = paddingPatch.content;
    }
  }

  return {
    status: content === args.content ? "unchanged" : "applied",
    content,
    targetNodeId: target.id,
    ...inferred,
  };
}

function hasExactReactProvenance(node: CodeLayerNode): boolean {
  const sourceFile = node.dataAttributes["data-source-file"]?.trim();
  const line = Number(node.dataAttributes["data-source-line"]);
  const column = Number(node.dataAttributes["data-source-column"]);
  return Boolean(
    sourceFile &&
    Number.isSafeInteger(line) &&
    line > 0 &&
    Number.isSafeInteger(column) &&
    column > 0,
  );
}

/**
 * Resolve the shallowest compiler-provenanced React roots beneath the live
 * screen body. Unsourced mount nodes such as `#root` are traversed, while
 * later body branches (for example portals) are ignored once the primary app
 * branch yields editable roots.
 */
export function getRuntimeScreenAutoLayoutSubjectIds(
  projection: CodeLayerProjection,
): string[] {
  const nodes = nodeById(projection);
  const collect = (nodeId: string, ancestors: Set<string>): string[] => {
    if (ancestors.has(nodeId)) return [];
    const node = nodes.get(nodeId);
    if (!node) return [];
    if (hasExactReactProvenance(node)) return [node.id];
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(nodeId);
    return node.children.flatMap((childId) => collect(childId, nextAncestors));
  };

  const body = projection.nodes.find((node) => node.tag === "body");
  const branchIds = body?.children ?? projection.rootNodeIds;
  for (const branchId of branchIds) {
    const subjects = collect(branchId, new Set());
    if (subjects.length > 0) return Array.from(new Set(subjects));
  }
  return [];
}
