import type { EffectDefinition, EffectDocument } from "./native-effects";

export const MAX_APPROVED_NATIVE_DEFINITION_HASHES = 32;
export const NATIVE_EFFECT_APPROVALS_SCHEMA_VERSION = 1;
const SHA256_RE = /^[a-f0-9]{64}$/;

export interface NativeEffectApprovalState {
  schemaVersion: 1;
  hashes: string[];
}

export class NativeEffectApprovalStateError extends TypeError {
  constructor() {
    super("Native effect approvals are unreadable");
    this.name = "NativeEffectApprovalStateError";
  }
}

export function nativeEffectApprovalKey(designId: string): string {
  return `design-native-effect-approvals:${designId}`;
}

export function parseNativeEffectApprovalState(
  value: Record<string, unknown> | null,
): NativeEffectApprovalState {
  if (value === null) return { schemaVersion: 1, hashes: [] };
  if (
    value.schemaVersion !== NATIVE_EFFECT_APPROVALS_SCHEMA_VERSION ||
    !Array.isArray(value.hashes) ||
    value.hashes.length > MAX_APPROVED_NATIVE_DEFINITION_HASHES ||
    !value.hashes.every(
      (hash) => typeof hash === "string" && SHA256_RE.test(hash),
    ) ||
    new Set(value.hashes).size !== value.hashes.length
  ) {
    throw new NativeEffectApprovalStateError();
  }
  return { schemaVersion: 1, hashes: [...value.hashes] };
}

export function nativeEffectExecutionPayload(definition: EffectDefinition) {
  return {
    schema: "an-native-effect-execution-v1",
    id: definition.id,
    version: definition.version,
    kind: definition.kind,
    placements: definition.placements,
    properties: Object.entries(definition.properties),
    ...(definition.parameterConstraints === undefined
      ? {}
      : { parameterConstraints: definition.parameterConstraints }),
    inputs: definition.inputs ?? null,
    outputs: definition.outputs ?? null,
    resources: definition.resources ?? null,
    output: definition.output ?? null,
    ...(definition.extent === undefined ? {} : { extent: definition.extent }),
    ...(definition.sourceSizing === undefined
      ? {}
      : { sourceSizing: definition.sourceSizing }),
    ...(definition.optionalImage === undefined
      ? {}
      : { optionalImage: definition.optionalImage }),
    ...(definition.feedback === undefined
      ? {}
      : { feedback: definition.feedback }),
    ...(definition.statelessCompute === undefined
      ? {}
      : { statelessCompute: definition.statelessCompute }),
    ...(definition.simulation === undefined
      ? {}
      : { simulation: definition.simulation }),
    passes: definition.passes,
  };
}

export async function hashEffectDefinition(
  definition: EffectDefinition,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify(nativeEffectExecutionPayload(definition)),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export class NativeSceneAuthorizationError extends TypeError {
  constructor(readonly code: "unapproved" | "limit" | "catalog-conflict") {
    super(`Native scene authorization ${code}`);
    this.name = "NativeSceneAuthorizationError";
  }
}

export async function nativeSceneExecutableHashes(
  document: EffectDocument,
  viewerApprovedHashes: readonly string[],
  builtinCatalog: readonly EffectDefinition[],
): Promise<string[]> {
  const catalog = new Map<string, EffectDefinition>();
  for (const definition of builtinCatalog) {
    const key = `${definition.id}@${definition.version}`;
    if (catalog.has(key))
      throw new NativeSceneAuthorizationError("catalog-conflict");
    catalog.set(key, definition);
  }
  const enabled = new Set(
    document.instances
      .filter((instance) => instance.enabled)
      .map(
        (instance) => `${instance.definitionId}@${instance.definitionVersion}`,
      ),
  );
  const viewerApproved = new Set(viewerApprovedHashes);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const definition of document.definitions) {
    const key = `${definition.id}@${definition.version}`;
    if (!enabled.has(key)) continue;
    const hash = await hashEffectDefinition(definition);
    const builtin = catalog.get(key);
    const exactBuiltin =
      builtin !== undefined && hash === (await hashEffectDefinition(builtin));
    if (!exactBuiltin && !viewerApproved.has(hash))
      throw new NativeSceneAuthorizationError("unapproved");
    if (seen.has(hash)) continue;
    seen.add(hash);
    result.push(hash);
    if (result.length > MAX_APPROVED_NATIVE_DEFINITION_HASHES)
      throw new NativeSceneAuthorizationError("limit");
  }
  return result;
}
