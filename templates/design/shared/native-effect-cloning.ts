import {
  NATIVE_EFFECT_SCRIPT_TYPE,
  parseEffectsFromHtml,
  writeEffectsToHtml,
  type EffectDocument,
  type EffectInputBinding,
} from "./native-effects";

export class NativeEffectCloningError extends Error {
  readonly code = "native_effect_clone_failed";

  constructor(errors: readonly string[]) {
    super(`Native effects could not be cloned: ${errors.join("; ")}`);
    this.name = "NativeEffectCloningError";
  }
}

function readEffects(html: string): EffectDocument | null {
  const parsed = parseEffectsFromHtml(html);
  if (parsed.errors.length) throw new NativeEffectCloningError(parsed.errors);
  return parsed.document;
}

function remapBindings(
  bindings: Record<string, EffectInputBinding> | undefined,
  nodeIdMap: ReadonlyMap<string, string>,
): Record<string, EffectInputBinding> | undefined {
  if (!bindings) return bindings;
  return Object.fromEntries(
    Object.entries(bindings).map(([name, binding]) => [
      name,
      binding.kind === "authored-node"
        ? {
            ...binding,
            nodeId: nodeIdMap.get(binding.nodeId) ?? binding.nodeId,
          }
        : binding,
    ]),
  );
}

export function cloneNativeEffectsForNodes(
  sourceHtml: string,
  targetHtml: string,
  nodeIdMap: ReadonlyMap<string, string>,
  options: { wholeDocument?: boolean } = {},
): string {
  if (!sourceHtml.includes(NATIVE_EFFECT_SCRIPT_TYPE)) return targetHtml;
  const source = readEffects(sourceHtml);
  if (!source) return targetHtml;
  const target = readEffects(targetHtml);
  const instances = options.wholeDocument
    ? source.instances
    : source.instances.filter((instance) => nodeIdMap.has(instance.nodeId));
  if (!options.wholeDocument && instances.length === 0) return targetHtml;
  const reservedIds = new Set([
    ...source.instances.map((instance) => instance.id),
    ...(target?.instances.map((instance) => instance.id) ?? []),
  ]);
  const clones = instances.map((instance) => {
    let id: string;
    do {
      id = `an-effect-${crypto.randomUUID()}`;
    } while (reservedIds.has(id));
    reservedIds.add(id);
    return {
      ...instance,
      id,
      nodeId: nodeIdMap.get(instance.nodeId) ?? instance.nodeId,
      ...(instance.bindings
        ? { bindings: remapBindings(instance.bindings, nodeIdMap) }
        : {}),
    };
  });
  if (options.wholeDocument) {
    return writeEffectsToHtml(targetHtml, {
      ...source,
      instances: clones,
      ...(source.presets
        ? {
            presets: source.presets.map((preset) => ({
              ...preset,
              ...(preset.bindings
                ? { bindings: remapBindings(preset.bindings, nodeIdMap) }
                : {}),
            })),
          }
        : {}),
    });
  }
  const document: EffectDocument = target ?? {
    schemaVersion: 2,
    definitions: [],
    instances: [],
  };
  const definitions = [...document.definitions];
  for (const definition of source.definitions) {
    if (
      !instances.some(
        (instance) =>
          instance.definitionId === definition.id &&
          instance.definitionVersion === definition.version,
      )
    )
      continue;
    const existing = definitions.find(
      (candidate) =>
        candidate.id === definition.id &&
        candidate.version === definition.version,
    );
    if (existing && JSON.stringify(existing) !== JSON.stringify(definition)) {
      throw new NativeEffectCloningError([
        `conflicting definition ${definition.id} v${definition.version}`,
      ]);
    }
    if (!existing) definitions.push(definition);
  }
  return writeEffectsToHtml(targetHtml, {
    ...document,
    definitions,
    instances: [...document.instances, ...clones],
  });
}

export function remapClonedNativeEffectBindings(
  html: string,
  nodeIdMap: ReadonlyMap<string, string>,
): string {
  if (!html.includes(NATIVE_EFFECT_SCRIPT_TYPE)) return html;
  const document = readEffects(html);
  if (!document) return html;
  const clonedNodeIds = new Set(nodeIdMap.values());
  return writeEffectsToHtml(html, {
    ...document,
    instances: document.instances.map((instance) =>
      clonedNodeIds.has(instance.nodeId) && instance.bindings
        ? { ...instance, bindings: remapBindings(instance.bindings, nodeIdMap) }
        : instance,
    ),
  });
}
