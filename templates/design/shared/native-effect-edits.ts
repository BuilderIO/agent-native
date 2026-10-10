import {
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_PRESETS,
} from "./native-effect-presets";
import {
  applyNativeEffectToHtml,
  parseEffectsFromHtml,
  validateEffectDocument,
  usesRetiredNativeImageAbi,
  writeEffectsToHtml,
  type EffectDefinition,
  type EffectDocument,
  type EffectHtmlResult,
  type EffectInstance,
  type EffectPreset,
  type EffectPreviewPolicy,
  type EffectTransform2D,
  type EffectInputBinding,
  type EffectValue,
  type NativeSourceSizing,
} from "./native-effects";
import {
  ensureNativeShaderRuntime,
  listShaderMounts,
  removeShaderFromNode,
} from "./shader-fills";

export type NativeEffectEdit =
  | {
      kind: "apply";
      nodeId: string;
      placement: EffectInstance["placement"];
      definitionId?: string;
      definitionVersion?: number;
      definition?: EffectDefinition;
      params?: Record<string, EffectValue>;
      clip?: EffectInstance["clip"];
      bindings?: Record<string, EffectInputBinding>;
      transform?: EffectTransform2D;
      sourceSizing?: NativeSourceSizing;
      timing?: EffectPreset["timing"];
    }
  | {
      kind: "apply-many";
      nodeIds: string[];
      placement: EffectInstance["placement"];
      definitionId?: string;
      definitionVersion?: number;
      definition?: EffectDefinition;
      params?: Record<string, EffectValue>;
      clip?: EffectInstance["clip"];
      bindings?: Record<string, EffectInputBinding>;
      transform?: EffectTransform2D;
      sourceSizing?: NativeSourceSizing;
      sourceSizingByNodeId?: Record<string, NativeSourceSizing>;
      timing?: EffectPreset["timing"];
    }
  | {
      kind: "apply-preset";
      nodeId: string;
      presetId: string;
      params?: Record<string, EffectValue>;
      sourceSizing?: NativeSourceSizing;
    }
  | {
      kind: "set-params";
      instanceId: string;
      params: Record<string, EffectValue>;
    }
  | {
      kind: "set-params-many";
      instanceIds: string[];
      params: Record<string, EffectValue>;
    }
  | {
      kind: "set-instance";
      instanceId: string;
      enabled?: boolean;
      opacity?: number;
      seed?: number;
      clip?: EffectInstance["clip"];
      placement?: EffectInstance["placement"];
      bindings?: Record<string, EffectInputBinding> | null;
      transform?: EffectTransform2D | null;
      sourceSizing?: NativeSourceSizing | null;
    }
  | {
      kind: "playback";
      instanceId: string;
      speed?: number;
      paused?: boolean;
      time?: number;
      seekRevision?: number;
    }
  | { kind: "reset-instance"; instanceId: string }
  | { kind: "set-preview"; preview: EffectPreviewPolicy | null }
  | { kind: "duplicate"; instanceId: string }
  | { kind: "reorder"; instanceId: string; beforeInstanceId: string | null }
  | { kind: "remove"; instanceId: string }
  | { kind: "save-preset"; preset: EffectPreset }
  | { kind: "remove-preset"; presetId: string }
  | {
      kind: "revise-definition";
      definition: EffectDefinition;
      fromVersion: number;
      instanceIds: string[];
      params?: Record<string, EffectValue>;
    };

export interface NativeEffectEditResult {
  html: string;
  errors: string[];
  instanceIds: string[];
  nodeIds: string[];
}

function finish(
  html: string,
  document: EffectDocument,
): NativeEffectEditResult {
  const validation = validateEffectDocument(document);
  if (!validation.valid) return failed(html, validation.errors);
  const authoredHtml = writeEffectsToHtml(html, document);
  const nextHtml = document.instances.length
    ? ensureNativeShaderRuntime(authoredHtml)
    : removeNativeRuntime(authoredHtml);
  return {
    html: nextHtml,
    errors: [],
    instanceIds: document.instances.map((instance) => instance.id),
    nodeIds: [
      ...new Set(document.instances.map((instance) => instance.nodeId)),
    ],
  };
}

function removeNativeRuntime(html: string): string {
  return html.replace(
    /<script\s+data-agent-native-native-shader-runtime\b[^>]*>[\s\S]*?<\/script\s*>\s*/gi,
    "",
  );
}

function failed(html: string, errors: string[]): NativeEffectEditResult {
  return { html, errors, instanceIds: [], nodeIds: [] };
}

function key(definition: EffectDefinition): string {
  return `${definition.id}\u0000${definition.version}`;
}

function sameDefinition(a: EffectDefinition, b: EffectDefinition): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function nextId(document: EffectDocument): string {
  let id: string;
  do {
    id = `an-effect-${crypto.randomUUID()}`;
  } while (document.instances.some((instance) => instance.id === id));
  return id;
}

export function clearNativeFillFromHtml(
  html: string,
  nodeId: string,
): EffectHtmlResult {
  const parsed = parseEffectsFromHtml(html);
  if (parsed.errors.length) return { html, errors: parsed.errors };
  let nextHtml = html;
  if (
    parsed.document?.instances.some(
      (instance) => instance.nodeId === nodeId && instance.placement === "fill",
    )
  ) {
    nextHtml = writeEffectsToHtml(html, {
      ...parsed.document,
      instances: parsed.document.instances.filter(
        (instance) =>
          instance.nodeId !== nodeId || instance.placement !== "fill",
      ),
    });
  }
  if (
    listShaderMounts(nextHtml).some(
      (mount) => mount.nodeId === nodeId && mount.mode === "fill",
    )
  ) {
    const removed = removeShaderFromNode(nextHtml, nodeId, "fill");
    if (removed.errors.length) return { html, errors: removed.errors };
    nextHtml = removed.html;
  }
  const nextDocument = parseEffectsFromHtml(nextHtml).document;
  if (!nextDocument?.instances.length) nextHtml = removeNativeRuntime(nextHtml);
  return { html: nextHtml, errors: [] };
}

export function editNativeEffectHtml(
  html: string,
  operation: NativeEffectEdit,
): NativeEffectEditResult {
  const parsed = parseEffectsFromHtml(html);
  if (parsed.errors.length) return failed(html, parsed.errors);
  const document: EffectDocument = parsed.document ?? {
    schemaVersion: 2 as const,
    definitions: [],
    instances: [],
  };

  if (operation.kind === "set-preview") {
    const preview = operation.preview ?? undefined;
    const prior = document.preview;
    const nextIsDefault =
      preview?.quality === "auto" &&
      preview.frameRateTarget === 60 &&
      (preview.colorMode ?? "srgb") === "srgb" &&
      (preview.dynamicRange ?? "sdr") === "sdr";
    if (
      (!prior && (!preview || nextIsDefault)) ||
      (prior?.quality === preview?.quality &&
        prior?.frameRateTarget === preview?.frameRateTarget &&
        (prior?.colorMode ?? "srgb") === (preview?.colorMode ?? "srgb") &&
        (prior?.dynamicRange ?? "sdr") === (preview?.dynamicRange ?? "sdr"))
    )
      return {
        html,
        errors: [],
        instanceIds: document.instances.map((instance) => instance.id),
        nodeIds: [
          ...new Set(document.instances.map((instance) => instance.nodeId)),
        ],
      };
    return finish(html, { ...document, preview });
  }

  if (operation.kind === "apply-many") {
    const { nodeIds, sourceSizingByNodeId, kind: _kind, ...apply } = operation;
    if (
      nodeIds.length < 2 ||
      nodeIds.length > 32 ||
      new Set(nodeIds).size !== nodeIds.length
    )
      return failed(html, ["apply-many needs 2–32 distinct authored nodes"]);
    if (
      sourceSizingByNodeId !== undefined &&
      (apply.sourceSizing !== undefined ||
        Object.keys(sourceSizingByNodeId).length !== nodeIds.length ||
        nodeIds.some(
          (id) =>
            !Object.prototype.hasOwnProperty.call(sourceSizingByNodeId, id),
        ))
    )
      return failed(html, [
        "per-node source sizing needs every target and no shared sizing",
      ]);
    let nextHtml = html;
    for (const nodeId of nodeIds) {
      const result = editNativeEffectHtml(nextHtml, {
        kind: "apply",
        nodeId,
        ...apply,
        sourceSizing: sourceSizingByNodeId
          ? sourceSizingByNodeId[nodeId]
          : apply.sourceSizing,
      });
      if (result.errors.length) return failed(html, result.errors);
      nextHtml = result.html;
    }
    const nextDocument = parseEffectsFromHtml(nextHtml).document;
    if (!nextDocument)
      return failed(html, ["effect manifest missing after apply-many"]);
    return finish(nextHtml, nextDocument);
  }

  if (operation.kind === "set-params-many") {
    const { instanceIds } = operation;
    if (
      instanceIds.length < 2 ||
      instanceIds.length > 32 ||
      new Set(instanceIds).size !== instanceIds.length
    )
      return failed(html, ["set-params-many needs 2–32 distinct instances"]);
    const selected = instanceIds.map((id) =>
      document.instances.find((instance) => instance.id === id),
    );
    if (selected.some((instance) => !instance))
      return failed(html, ["one or more native instances were not found"]);
    if (
      new Set(
        selected.map(
          (instance) =>
            `${instance!.definitionId}@${instance!.definitionVersion}`,
        ),
      ).size !== 1
    )
      return failed(html, ["selected instances need one definition version"]);
    let nextHtml = html;
    for (const instanceId of instanceIds) {
      const result = editNativeEffectHtml(nextHtml, {
        kind: "set-params",
        instanceId,
        params: operation.params,
      });
      if (result.errors.length) return failed(html, result.errors);
      nextHtml = result.html;
    }
    const nextDocument = parseEffectsFromHtml(nextHtml).document;
    if (!nextDocument)
      return failed(html, ["effect manifest missing after set-params-many"]);
    return finish(nextHtml, nextDocument);
  }

  if (operation.kind === "apply-preset") {
    const preset = [...(document.presets ?? []), ...NATIVE_EFFECT_PRESETS].find(
      (candidate) => candidate.id === operation.presetId,
    );
    if (!preset)
      return failed(html, [
        `native effect preset "${operation.presetId}" not found`,
      ]);
    return editNativeEffectHtml(html, {
      kind: "apply",
      nodeId: operation.nodeId,
      placement: preset.placement,
      definitionId: preset.definitionId,
      definitionVersion: preset.definitionVersion,
      params: { ...preset.params, ...operation.params },
      clip: preset.clip,
      bindings: preset.bindings,
      transform: preset.transform,
      sourceSizing: operation.sourceSizing ?? preset.sourceSizing,
      timing: preset.timing,
    });
  }

  if (operation.kind === "apply") {
    if (Boolean(operation.definitionId) === Boolean(operation.definition)) {
      return failed(html, [
        "apply needs exactly one definitionId or definition",
      ]);
    }
    if (operation.definition) {
      const validation = validateEffectDocument({
        schemaVersion: 2,
        definitions: [operation.definition],
        instances: [],
      });
      if (!validation.valid) return failed(html, validation.errors);
    }
    const matches = [
      ...document.definitions,
      ...NATIVE_EFFECT_DEFINITION_CATALOG,
    ].filter(
      (candidate) =>
        candidate.id === operation.definitionId &&
        (operation.definitionVersion === undefined ||
          candidate.version === operation.definitionVersion),
    );
    const distinct = matches.filter(
      (candidate, index) =>
        matches.findIndex((other) => key(other) === key(candidate)) === index,
    );
    if (!operation.definition && distinct.length > 1)
      return failed(html, [
        "apply needs definitionVersion when multiple versions exist",
      ]);
    const definition = operation.definition ?? distinct[0];
    if (!definition)
      return failed(html, [
        `native effect definition "${operation.definitionId}" not found`,
      ]);
    const cleared =
      operation.placement === "fill"
        ? clearNativeFillFromHtml(html, operation.nodeId)
        : { html, errors: [] };
    if (cleared.errors.length) return failed(html, cleared.errors);
    const baseHtml = cleared.html;
    const result = applyNativeEffectToHtml(baseHtml, {
      nodeId: operation.nodeId,
      definition,
      placement: operation.placement,
      params: operation.params,
      clip: operation.clip,
      bindings: operation.bindings,
      transform: operation.transform,
      sourceSizing: operation.sourceSizing,
      timing: operation.timing,
    });
    if (result.errors.length) return failed(html, result.errors);
    const next = parseEffectsFromHtml(result.html);
    if (!next.document)
      return failed(html, ["effect manifest missing after apply"]);
    return finish(baseHtml, next.document);
  }

  if (operation.kind === "save-preset") {
    if (
      !operation.preset ||
      operation.preset.provenance?.origin !== "user-authored"
    )
      return failed(html, ["custom preset provenance must be user-authored"]);
    if (
      [...NATIVE_EFFECT_PRESETS, ...(document.presets ?? [])].some(
        (preset) => preset.id === operation.preset.id,
      )
    )
      return failed(html, [`preset "${operation.preset.id}" already exists`]);
    const target = [
      ...document.definitions,
      ...NATIVE_EFFECT_DEFINITION_CATALOG,
    ].find(
      (definition) =>
        definition.id === operation.preset.definitionId &&
        definition.version === operation.preset.definitionVersion,
    );
    if (!target) return failed(html, ["preset definition version not found"]);
    const existing = document.definitions.find(
      (definition) => key(definition) === key(target),
    );
    if (existing && !sameDefinition(existing, target))
      return failed(html, [
        "preset definition version conflicts with saved source",
      ]);
    return finish(html, {
      ...document,
      definitions: existing
        ? document.definitions
        : [...document.definitions, target],
      presets: [...(document.presets ?? []), operation.preset],
    });
  }

  if (operation.kind === "remove-preset") {
    if (
      !(document.presets ?? []).some(
        (preset) => preset.id === operation.presetId,
      )
    )
      return failed(html, [`custom preset "${operation.presetId}" not found`]);
    return finish(html, {
      ...document,
      presets: document.presets?.filter(
        (preset) => preset.id !== operation.presetId,
      ),
    });
  }

  if (operation.kind === "revise-definition") {
    const validation = validateEffectDocument({
      schemaVersion: 2,
      definitions: [operation.definition],
      instances: [],
    });
    if (!validation.valid) return failed(html, validation.errors);
    if (usesRetiredNativeImageAbi(operation.definition))
      return failed(html, ["legacy-image-abi-retired"]);
    const previous = document.definitions.find(
      (definition) =>
        definition.id === operation.definition.id &&
        definition.version === operation.fromVersion,
    );
    if (!previous)
      return failed(html, ["previous definition version not found"]);
    if (operation.definition.version <= operation.fromVersion)
      return failed(html, ["revised definition needs a higher version"]);
    if (
      !operation.instanceIds.length ||
      new Set(operation.instanceIds).size !== operation.instanceIds.length
    )
      return failed(html, ["select distinct instances to revise"]);
    const selected = new Set(operation.instanceIds);
    for (const instanceId of selected) {
      const instance = document.instances.find(
        (item) => item.id === instanceId,
      );
      if (
        !instance ||
        instance.definitionId !== previous.id ||
        instance.definitionVersion !== previous.version
      )
        return failed(html, [
          `instance "${instanceId}" is not pinned to the previous definition`,
        ]);
    }
    const existing = document.definitions.find(
      (definition) => key(definition) === key(operation.definition),
    );
    if (existing && !sameDefinition(existing, operation.definition))
      return failed(html, [
        `definition "${operation.definition.id}" v${operation.definition.version} already names different source`,
      ]);
    return finish(html, {
      ...document,
      definitions: existing
        ? document.definitions
        : [...document.definitions, operation.definition],
      instances: document.instances.map((instance) =>
        selected.has(instance.id)
          ? {
              ...instance,
              definitionVersion: operation.definition.version,
              params: { ...instance.params, ...(operation.params ?? {}) },
            }
          : instance,
      ),
    });
  }

  const index = document.instances.findIndex(
    (instance) => instance.id === operation.instanceId,
  );
  if (index < 0)
    return failed(html, [
      `native effect instance "${operation.instanceId}" not found`,
    ]);
  const instance = document.instances[index];
  if (operation.kind === "set-instance" && operation.sourceSizing)
    return failed(html, ["legacy-image-abi-retired"]);
  const instances = [...document.instances];
  switch (operation.kind) {
    case "set-params":
      instances[index] = {
        ...instance,
        params: { ...instance.params, ...operation.params },
      };
      break;
    case "set-instance":
      if (
        operation.seed !== undefined &&
        (!Number.isInteger(operation.seed) ||
          operation.seed < 0 ||
          operation.seed > 1_000_000)
      )
        return failed(html, [
          "native effect seed must be an integer within 0–1000000",
        ]);
      instances[index] = {
        ...instance,
        enabled: operation.enabled ?? instance.enabled,
        opacity: operation.opacity ?? instance.opacity,
        seed: operation.seed ?? instance.seed,
        clip: operation.clip ?? instance.clip,
        placement: operation.placement ?? instance.placement,
        bindings:
          operation.bindings === null
            ? undefined
            : (operation.bindings ?? instance.bindings),
        transform:
          operation.transform === null
            ? undefined
            : (operation.transform ?? instance.transform),
        sourceSizing:
          operation.sourceSizing === null
            ? undefined
            : (operation.sourceSizing ?? instance.sourceSizing),
      };
      break;
    case "playback":
      if (
        operation.seekRevision !== undefined &&
        (!Number.isInteger(operation.seekRevision) ||
          operation.seekRevision < 0 ||
          operation.seekRevision > 1_000_000 ||
          operation.seekRevision <= (instance.timing.seekRevision ?? 0))
      )
        return failed(html, ["native effect seek revision must advance"]);
      instances[index] = {
        ...instance,
        timing: {
          speed: operation.speed ?? instance.timing.speed,
          paused: operation.paused ?? instance.timing.paused,
          time: operation.time ?? instance.timing.time,
          seekRevision: operation.seekRevision ?? instance.timing.seekRevision,
        },
      };
      break;
    case "reset-instance":
      instances[index] = {
        ...instance,
        params: {},
        enabled: true,
        opacity: 1,
        timing: { speed: 1, paused: false, time: 0 },
        bindings: undefined,
        transform: undefined,
        sourceSizing: undefined,
      };
      break;
    case "duplicate":
      instances.splice(index + 1, 0, { ...instance, id: nextId(document) });
      break;
    case "reorder": {
      if (operation.beforeInstanceId === operation.instanceId)
        return failed(html, ["an instance cannot be ordered before itself"]);
      const destination =
        operation.beforeInstanceId === null
          ? instances.length
          : instances.findIndex(
              (item) => item.id === operation.beforeInstanceId,
            );
      if (destination < 0)
        return failed(html, [
          `native effect instance "${operation.beforeInstanceId}" not found`,
        ]);
      instances.splice(index, 1);
      instances.splice(
        destination > index ? destination - 1 : destination,
        0,
        instance,
      );
      break;
    }
    case "remove":
      instances.splice(index, 1);
      break;
  }
  const usedDefinitions = new Set(
    instances.map(
      (item) => `${item.definitionId}\u0000${item.definitionVersion}`,
    ),
  );
  for (const preset of document.presets ?? [])
    usedDefinitions.add(
      `${preset.definitionId}\u0000${preset.definitionVersion}`,
    );
  return finish(html, {
    ...document,
    instances,
    definitions:
      operation.kind === "remove"
        ? document.definitions.filter(
            (definition) =>
              definition.provenance.origin === "user-authored" ||
              usedDefinitions.has(key(definition)),
          )
        : document.definitions,
  });
}
