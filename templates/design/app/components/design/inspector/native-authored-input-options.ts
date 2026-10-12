import { buildCodeLayerProjection } from "@shared/code-layer";
import type { EffectDefinition } from "@shared/native-effects";

export interface NativeAuthoredLayerOption {
  key: string;
  nodeId: string | null;
  selector: string;
  name: string | null;
}

export function nativeAuthoredLayerOptions(
  html: string,
  targetNodeId: string,
): NativeAuthoredLayerOption[] {
  if (!html) return [];
  const nodes = buildCodeLayerProjection(html).nodes;
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const id = node.dataAttributes["data-agent-native-node-id"]?.trim();
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const target = nodes.find(
    (node) => node.dataAttributes["data-agent-native-node-id"] === targetNodeId,
  );
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const containsTarget = (nodeId: string): boolean => {
    let parentId = target?.parentId;
    while (parentId) {
      if (parentId === nodeId) return true;
      parentId = byId.get(parentId)?.parentId;
    }
    return false;
  };
  const isLocked = (nodeId: string): boolean => {
    let current = byId.get(nodeId);
    while (current) {
      if (current.dataAttributes["data-agent-native-locked"] === "true")
        return true;
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return false;
  };
  return nodes.flatMap((node) => {
    if (
      !node.source ||
      !node.selector ||
      node.id === target?.id ||
      containsTarget(node.id) ||
      ["html", "body", "head", "script", "style"].includes(node.tag)
    )
      return [];
    const rawId = node.dataAttributes["data-agent-native-node-id"]?.trim();
    const nodeId =
      rawId && /^[A-Za-z0-9_.:-]{1,128}$/.test(rawId) && counts.get(rawId) === 1
        ? rawId
        : null;
    if (!nodeId && isLocked(node.id)) return [];
    return [
      {
        key: nodeId ? `node:${nodeId}` : `selector:${node.selector}`,
        nodeId,
        selector: node.selector,
        name:
          node.dataAttributes["data-agent-native-layer-name"]?.trim() ||
          (typeof node.attributes.alt === "string"
            ? node.attributes.alt.trim()
            : null) ||
          (typeof node.attributes["aria-label"] === "string"
            ? node.attributes["aria-label"].trim()
            : null) ||
          (node.layerNameSource === "tag" ? null : node.layerName),
      },
    ];
  });
}

export function nativeAuthoredInputPorts(definition: EffectDefinition) {
  if (
    definition.statelessCompute ||
    definition.simulation ||
    definition.feedback
  )
    return [];
  const produced = new Set(
    definition.passes.flatMap((pass) => [
      pass.output,
      ...(pass.additionalOutputs ?? []),
    ]),
  );
  const read = new Set(
    definition.passes
      .flatMap((pass) => pass.reads)
      .filter((resource) => !produced.has(resource)),
  );
  return Object.entries(definition.inputs ?? {}).filter(([name, port]) => {
    if (
      (port.kind !== "texture-2d" && port.kind !== "mask") ||
      !port.resource ||
      !read.has(port.resource) ||
      name === definition.optionalImage?.port ||
      (definition.optionalImage &&
        definition.passes[0]?.reads[1] === "noise" &&
        name === "noise")
    )
      return false;
    return !definition.resources?.some(
      (resource) =>
        resource.name === port.resource &&
        resource.sampleEncoding === "linear-data",
    );
  });
}
