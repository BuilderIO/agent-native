import type { CodeLayerNode } from "@shared/code-layer";
import {
  motionAnimatedNodeIds,
  motionLayerCss,
  motionLayersData,
  type MotionLayerCodeSource,
  type MotionLayerCss,
} from "@shared/motion-layer-code";

const MOTION_NODE_ID_ATTRIBUTE = "data-agent-native-node-id";

export interface MotionCodeLayerRef {
  nodeId: string;
  layerId: string;
  label: string;
}

export interface MotionCodeLayer extends MotionCodeLayerRef {
  /** CSS for the layer's own track motion; null when it has none to write. */
  css: MotionLayerCss | null;
  /** Animated layers beneath a layer that has no motion of its own. */
  animatedBelow: MotionCodeLayerRef[];
  /** The layer has motion of its own. Text-only motion is animated but has no CSS. */
  animated: boolean;
}

export interface MotionCodeModel {
  layers: MotionCodeLayer[];
  /** Every animated layer in the selection, as JSON text. */
  data: string;
  /** Layers in the selection that have motion of their own. */
  animatedCount: number;
}

type MotionCodeNode = Pick<
  CodeLayerNode,
  "id" | "layerName" | "children" | "dataAttributes" | "style"
>;

export function buildMotionCodeModel(args: {
  source: MotionLayerCodeSource;
  nodes: readonly MotionCodeNode[];
  targets: readonly { nodeId: string; label: string }[];
}): MotionCodeModel {
  const animated = motionAnimatedNodeIds(args.source);
  const nodesById = new Map(args.nodes.map((node) => [node.id, node]));
  const nodesByMotionId = new Map(
    args.nodes.flatMap((node) => {
      const nodeId = node.dataAttributes[MOTION_NODE_ID_ATTRIBUTE]?.trim();
      return nodeId ? [[nodeId, node] as const] : [];
    }),
  );

  const animatedBelow = (root: MotionCodeNode): MotionCodeLayerRef[] => {
    const found: MotionCodeLayerRef[] = [];
    const pending = [...root.children].reverse();
    while (pending.length > 0) {
      const node = nodesById.get(pending.pop()!);
      if (!node) continue;
      const nodeId = node.dataAttributes[MOTION_NODE_ID_ATTRIBUTE]?.trim();
      if (nodeId && animated.has(nodeId)) {
        found.push({ nodeId, layerId: node.id, label: node.layerName });
      }
      pending.push(...[...node.children].reverse());
    }
    return found;
  };

  const layers = args.targets.map((target): MotionCodeLayer => {
    const node = nodesByMotionId.get(target.nodeId);
    const ref = {
      nodeId: target.nodeId,
      layerId: node?.id ?? target.nodeId,
      label: target.label,
    };
    if (!node) return { ...ref, css: null, animatedBelow: [], animated: false };
    return animated.has(target.nodeId)
      ? {
          ...ref,
          css: motionLayerCss(args.source, target.nodeId, node.style),
          animatedBelow: [],
          animated: true,
        }
      : {
          ...ref,
          css: null,
          animatedBelow: animatedBelow(node),
          animated: false,
        };
  });

  const dataLayers = new Map<string, { nodeId: string; label: string }>();
  for (const [index, layer] of layers.entries()) {
    if (animated.has(layer.nodeId)) dataLayers.set(layer.nodeId, layer);
    const node = nodesByMotionId.get(args.targets[index]!.nodeId);
    for (const below of node ? animatedBelow(node) : []) {
      dataLayers.set(below.nodeId, below);
    }
  }

  return {
    layers,
    data: motionLayersData(args.source, [...dataLayers.values()]),
    animatedCount: dataLayers.size,
  };
}
