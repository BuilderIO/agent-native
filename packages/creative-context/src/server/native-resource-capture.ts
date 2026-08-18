import type { NormalizedContextItem } from "../types.js";

/** A native app resource reference supplied by a governed-context submission. */
export interface NativeCreativeResourceRef {
  appId: string;
  resourceType: string;
  resourceId: string;
  expectedUpdatedAt?: string;
}

export interface NativeResourceCaptureAdapter {
  appId: string;
  resourceType: string;
  /**
   * Reads only the version marker for resources visible to the active caller.
   * The Library calls this once per resource type with at most 100 ids.
   */
  listResourceVersions?(resourceIds: readonly string[]): Promise<
    Array<{
      resourceId: string;
      sourceModifiedAt: string | null;
    }>
  >;
  capture(reference: NativeCreativeResourceRef): Promise<{
    artifactKey: string;
    source: {
      name: string;
      kind: "native-app";
      externalRef?: string;
      upstreamAccess?: "available" | "restricted" | "unknown";
      containerOwnerVerifiedAt?: string;
      /** Server-derived from the app's source resource; never client input. */
      access?: {
        visibility: "private" | "org" | "public";
        canManage: boolean;
      };
    };
    items: NormalizedContextItem[];
    /** Persisted only as internal submission metadata; never action output. */
    privateMetadata?: Record<string, unknown>;
  }>;
}

const REGISTRY_KEY = "__agentNativeCreativeContextNativeCaptureAdapters__";
type Registry = Map<string, NativeResourceCaptureAdapter>;

export type NativeCreativeResourceUpdateState =
  | "current"
  | "update-available"
  | "unknown";

export interface PublishedNativeCreativeResourceRef {
  key: string;
  appId: string;
  resourceType: string;
  resourceId: string;
  publishedSourceModifiedAt?: string | null;
}

export interface ResolvedNativeCreativeResourceUpdateStatus {
  key: string;
  state: NativeCreativeResourceUpdateState;
  reference: NativeCreativeResourceRef;
}

const MAX_RESOURCE_VERSION_BATCH = 100;

function registry(): Registry {
  const globalStore = globalThis as typeof globalThis & {
    [REGISTRY_KEY]?: Registry;
  };
  return (globalStore[REGISTRY_KEY] ??= new Map());
}

function key(appId: string, resourceType: string): string {
  return `${appId}:${resourceType}`;
}

export function registerNativeResourceCaptureAdapter(
  adapter: NativeResourceCaptureAdapter,
): () => void {
  const adapterKey = key(adapter.appId, adapter.resourceType);
  registry().set(adapterKey, adapter);
  return () => registry().delete(adapterKey);
}

export function unregisterNativeResourceCaptureAdapter(
  appId: string,
  resourceType: string,
): void {
  registry().delete(key(appId, resourceType));
}

export async function captureNativeCreativeResource(
  reference: NativeCreativeResourceRef,
) {
  const adapter = registry().get(key(reference.appId, reference.resourceType));
  if (!adapter) {
    throw new Error(
      `No native creative-resource capture adapter is registered for ${reference.appId}/${reference.resourceType}`,
    );
  }
  return adapter.capture(reference);
}

export function parseNativeCreativeArtifactKey(
  artifactKey: string,
): Omit<NativeCreativeResourceRef, "expectedUpdatedAt"> | null {
  const firstSeparator = artifactKey.indexOf(":");
  const secondSeparator = artifactKey.indexOf(":", firstSeparator + 1);
  if (firstSeparator <= 0 || secondSeparator <= firstSeparator + 1) return null;
  const appId = artifactKey.slice(0, firstSeparator);
  const resourceType = artifactKey.slice(firstSeparator + 1, secondSeparator);
  const resourceId = artifactKey.slice(secondSeparator + 1);
  return resourceId ? { appId, resourceType, resourceId } : null;
}

/**
 * Resolves update availability in bounded batches. Missing rows are omitted so
 * an inaccessible native resource is indistinguishable from a deleted one.
 */
export async function resolveNativeCreativeResourceUpdateStatuses(
  references: readonly PublishedNativeCreativeResourceRef[],
): Promise<Map<string, ResolvedNativeCreativeResourceUpdateStatus>> {
  if (references.length > MAX_RESOURCE_VERSION_BATCH) {
    throw new Error(
      `Native creative-resource status checks are limited to ${MAX_RESOURCE_VERSION_BATCH} resources`,
    );
  }

  const groups = new Map<
    string,
    {
      adapter: NativeResourceCaptureAdapter;
      references: PublishedNativeCreativeResourceRef[];
    }
  >();
  for (const reference of references) {
    const adapter = registry().get(
      key(reference.appId, reference.resourceType),
    );
    if (!adapter?.listResourceVersions) continue;
    const adapterKey = key(reference.appId, reference.resourceType);
    const group = groups.get(adapterKey) ?? { adapter, references: [] };
    group.references.push(reference);
    groups.set(adapterKey, group);
  }

  const resolved = new Map<
    string,
    ResolvedNativeCreativeResourceUpdateStatus
  >();
  await Promise.all(
    [...groups.values()].map(
      async ({ adapter, references: groupReferences }) => {
        try {
          const resourceIds = [
            ...new Set(groupReferences.map((item) => item.resourceId)),
          ];
          const versions = await adapter.listResourceVersions!(resourceIds);
          const versionByResourceId = new Map(
            versions.map((version) => [
              version.resourceId,
              version.sourceModifiedAt,
            ]),
          );
          for (const reference of groupReferences) {
            if (!versionByResourceId.has(reference.resourceId)) continue;
            const sourceModifiedAt =
              versionByResourceId.get(reference.resourceId) ?? null;
            const state: NativeCreativeResourceUpdateState =
              !sourceModifiedAt || !reference.publishedSourceModifiedAt
                ? "unknown"
                : sourceModifiedAt === reference.publishedSourceModifiedAt
                  ? "current"
                  : "update-available";
            resolved.set(reference.key, {
              key: reference.key,
              state,
              reference: {
                appId: reference.appId,
                resourceType: reference.resourceType,
                resourceId: reference.resourceId,
                ...(sourceModifiedAt
                  ? { expectedUpdatedAt: sourceModifiedAt }
                  : {}),
              },
            });
          }
        } catch {
          // Update status is optional metadata; a native app read must not make
          // the governed Library itself unavailable.
        }
      },
    ),
  );
  return resolved;
}
