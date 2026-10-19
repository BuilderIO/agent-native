import { buildCodeLayerProjection } from "./code-layer";
import type { NativeExternalTextureInput } from "./native-input-resources";

export function authoredSourceBindingsAvailable(
  html: string,
  inputs: ReadonlyMap<string, NativeExternalTextureInput>,
): boolean {
  const referenced = [...inputs.values()].flatMap((binding) =>
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
