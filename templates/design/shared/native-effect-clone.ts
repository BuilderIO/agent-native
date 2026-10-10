import { parseFragment } from "parse5";

import {
  authoredNodeCount,
  parseEffectsFromHtml,
  validateEffectDocument,
  writeEffectsToHtml,
  type EffectDocument,
  type EffectInstance,
} from "./native-effects";
import { ensureNativeShaderRuntime } from "./shader-fills";
import { sourceContentHash } from "./source-workspace";

export interface NativeEffectCloneSnapshot {
  sourceHash: string;
  fragmentHash: string;
  document: EffectDocument;
}

type ParsedNode = {
  attrs?: { name: string; value: string }[];
  childNodes?: ParsedNode[];
};

function authoredNodeIds(fragment: string): Set<string> {
  const ids = new Set<string>();
  const visit = (node: ParsedNode) => {
    const id = node.attrs?.find(
      (attribute) => attribute.name === "data-agent-native-node-id",
    )?.value;
    if (id) ids.add(id);
    node.childNodes?.forEach(visit);
  };
  visit(parseFragment(fragment) as ParsedNode);
  return ids;
}

function definitionKey(id: string, version: number) {
  return `${id}\u0000${version}`;
}

export function captureNativeEffectsForClone(
  sourceHtml: string,
  fragment: string,
): { snapshot: NativeEffectCloneSnapshot | null; errors: string[] } {
  const source = parseEffectsFromHtml(sourceHtml);
  if (source.errors.length) return { snapshot: null, errors: source.errors };
  const ids = authoredNodeIds(fragment);
  const instances = source.document?.instances.filter((instance) =>
    ids.has(instance.nodeId),
  );
  if (!instances?.length) return { snapshot: null, errors: [] };
  for (const instance of instances) {
    if (authoredNodeCount(sourceHtml, instance.nodeId) !== 1)
      return {
        snapshot: null,
        errors: [`native clone source node ${instance.nodeId} is ambiguous`],
      };
    for (const binding of Object.values(instance.bindings ?? {})) {
      if (binding.kind === "authored-node" && !ids.has(binding.nodeId))
        return {
          snapshot: null,
          errors: [`native clone binding ${binding.nodeId} leaves the subtree`],
        };
    }
  }
  const keys = new Set(
    instances.map((instance) =>
      definitionKey(instance.definitionId, instance.definitionVersion),
    ),
  );
  const definitions = source.document!.definitions.filter((definition) =>
    keys.has(definitionKey(definition.id, definition.version)),
  );
  const document: EffectDocument = {
    schemaVersion: 2,
    definitions,
    instances,
  };
  const validation = validateEffectDocument(document);
  if (!validation.valid) return { snapshot: null, errors: validation.errors };
  return {
    snapshot: {
      sourceHash: sourceContentHash(sourceHtml),
      fragmentHash: sourceContentHash(fragment),
      document,
    },
    errors: [],
  };
}

export function mergeNativeEffectsForClone(
  destinationHtml: string,
  fragment: string,
  snapshot: NativeEffectCloneSnapshot | null | undefined,
  nodeIdMap: ReadonlyMap<string, string>,
): { html: string; errors: string[] } {
  if (!snapshot) return { html: destinationHtml, errors: [] };
  if (snapshot.fragmentHash !== sourceContentHash(fragment))
    return {
      html: destinationHtml,
      errors: ["native clipboard fragment changed"],
    };
  const source = validateEffectDocument(snapshot.document);
  if (!source.valid || !source.document)
    return { html: destinationHtml, errors: source.errors };
  const destination = parseEffectsFromHtml(destinationHtml);
  if (destination.errors.length)
    return { html: destinationHtml, errors: destination.errors };
  const document: EffectDocument = destination.document ?? {
    schemaVersion: 2,
    definitions: [],
    instances: [],
  };
  const definitions = [...document.definitions];
  for (const definition of source.document.definitions) {
    const existing = definitions.find(
      (candidate) =>
        candidate.id === definition.id &&
        candidate.version === definition.version,
    );
    if (existing && JSON.stringify(existing) !== JSON.stringify(definition))
      return {
        html: destinationHtml,
        errors: [
          `native definition ${definition.id} v${definition.version} conflicts`,
        ],
      };
    if (!existing) definitions.push(definition);
  }
  const instances = [...document.instances];
  const reserved = new Set(instances.map((instance) => instance.id));
  for (const sourceInstance of source.document.instances) {
    const nodeId = nodeIdMap.get(sourceInstance.nodeId);
    if (!nodeId || authoredNodeCount(destinationHtml, nodeId) !== 1)
      return {
        html: destinationHtml,
        errors: [
          `native clone target ${sourceInstance.nodeId} is missing or ambiguous`,
        ],
      };
    const bindings: EffectInstance["bindings"] = {};
    for (const [name, binding] of Object.entries(
      sourceInstance.bindings ?? {},
    )) {
      if (binding.kind === "authored-node") {
        const mapped = nodeIdMap.get(binding.nodeId);
        if (!mapped || authoredNodeCount(destinationHtml, mapped) !== 1)
          return {
            html: destinationHtml,
            errors: [`native clone binding ${binding.nodeId} is missing`],
          };
        bindings[name] = { ...binding, nodeId: mapped };
      } else bindings[name] = binding;
    }
    let id: string;
    do id = `an-effect-${crypto.randomUUID()}`;
    while (reserved.has(id));
    reserved.add(id);
    instances.push({
      ...sourceInstance,
      id,
      nodeId,
      ...(sourceInstance.bindings && { bindings }),
    });
  }
  const next = { ...document, definitions, instances };
  const validation = validateEffectDocument(next);
  if (!validation.valid)
    return { html: destinationHtml, errors: validation.errors };
  try {
    return {
      html: ensureNativeShaderRuntime(
        writeEffectsToHtml(destinationHtml, next),
      ),
      errors: [],
    };
  } catch (error) {
    return { html: destinationHtml, errors: [String(error)] };
  }
}
