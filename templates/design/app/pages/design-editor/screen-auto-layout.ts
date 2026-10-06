import {
  applyVisualEdit,
  buildCodeLayerProjection,
  type CodeLayerNode,
  type CodeLayerProjection,
  type CodeLayerSource,
} from "@shared/code-layer";

import {
  inferAutoLayoutFromChildren,
  type AlignableRect,
} from "./layout-operations";

export type EnableInlineScreenAutoLayoutResult =
  | {
      status: "applied" | "unchanged";
      content: string;
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

export function enableInlineScreenAutoLayout(args: {
  content: string;
  width?: number;
  height?: number;
  source?: CodeLayerSource;
}): EnableInlineScreenAutoLayoutResult {
  const source = args.source ?? { kind: "inline-html" as const };
  const projection = buildCodeLayerProjection(args.content, { source });
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
  const autoLayoutPatch = applyVisualEdit(
    args.content,
    {
      kind: "autoLayout",
      targetId: target.id,
      enabled: true,
      containerStyles: {
        display: "flex",
        "flex-direction": inferred.direction,
        gap: `${inferred.gap}px`,
        ...(inferred.padding > 0 ? { padding: `${inferred.padding}px` } : {}),
      },
    },
    { source },
  );
  if (autoLayoutPatch.result.status !== "applied") {
    return {
      status: "failed",
      content: args.content,
      message: autoLayoutPatch.result.message,
    };
  }

  const content = autoLayoutPatch.content;
  return {
    status: content === args.content ? "unchanged" : "applied",
    content,
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
