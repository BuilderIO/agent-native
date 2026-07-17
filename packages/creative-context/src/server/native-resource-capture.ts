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
  capture(
    reference: NativeCreativeResourceRef,
  ): Promise<{
    artifactKey: string;
    source: {
      name: string;
      kind: "native-app";
      externalRef?: string;
      upstreamAccess?: "available" | "restricted" | "unknown";
      containerOwnerVerifiedAt?: string;
    };
    items: NormalizedContextItem[];
    /** Persisted only as internal submission metadata; never action output. */
    privateMetadata?: Record<string, unknown>;
  }>;
}

const REGISTRY_KEY = "__agentNativeCreativeContextNativeCaptureAdapters__";
type Registry = Map<string, NativeResourceCaptureAdapter>;

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
