import { buildCodeLayerProjection } from "./code-layer";
import type { EffectInputBinding } from "./native-effects";

export function authoredSourceBindingsAvailable(
  html: string,
  bindings: Record<string, EffectInputBinding> | null | undefined,
): boolean {
  const referenced = Object.values(bindings ?? {}).flatMap((binding) =>
    binding.kind === "authored-node" ? [binding.nodeId] : [],
  );
  if (!referenced.length) return true;
  if (!html) return false;
  const counts = new Map<string, number>();
  for (const node of buildCodeLayerProjection(html).nodes) {
    if (!node.source) continue;
    const id = node.dataAttributes["data-agent-native-node-id"];
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return referenced.every((nodeId) => counts.get(nodeId) === 1);
}
