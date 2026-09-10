import type { ResourceVersion } from "../../history/types.js";
import { useActionMutation, useActionQuery } from "../use-action.js";

export interface ResourceVersionsParams {
  resourceType: string;
  resourceId: string;
  limit?: number;
  offset?: number;
}

export interface ResourceHistoryParams {
  resourceType: string;
  resourceId: string;
  limit?: number;
}

export interface CreateResourceVersionInput {
  resourceType: string;
  resourceId: string;
  title?: string;
  summary?: string;
  snapshot?: unknown;
  metadata?: Record<string, unknown>;
}

export interface RestoreResourceVersionInput {
  id?: string;
  resourceType?: string;
  resourceId?: string;
  versionNumber?: number;
}

export interface GetResourceVersionInput {
  id?: string;
  resourceType?: string;
  resourceId?: string;
  versionNumber?: number;
}

export interface ListResourceVersionsResult {
  versions: ResourceVersion[];
}

export interface ListResourceHistoryResult {
  versions: ResourceVersion[];
  auditEvents: unknown[];
}

export interface GetResourceVersionResult {
  version: ResourceVersion;
}

export interface RestoreResourceVersionResult {
  version: ResourceVersion;
  result: unknown;
}

export function useResourceVersions(
  params: ResourceVersionsParams,
  options?: { enabled?: boolean },
) {
  return useActionQuery<ListResourceVersionsResult>(
    "list-resource-versions",
    params,
    {
      enabled:
        options?.enabled ?? Boolean(params.resourceType && params.resourceId),
    },
  );
}

export function useResourceHistory(
  params: ResourceHistoryParams,
  options?: { enabled?: boolean },
) {
  return useActionQuery<ListResourceHistoryResult>(
    "list-resource-history",
    params,
    {
      enabled:
        options?.enabled ?? Boolean(params.resourceType && params.resourceId),
    },
  );
}

export function useResourceVersion(
  params: GetResourceVersionInput,
  options?: { enabled?: boolean },
) {
  const enabled =
    options?.enabled ??
    Boolean(
      params.id ||
      (params.resourceType && params.resourceId && params.versionNumber),
    );
  return useActionQuery<GetResourceVersionResult>(
    "get-resource-version",
    params,
    { enabled },
  );
}

export function useCreateResourceVersion() {
  return useActionMutation<ResourceVersion, CreateResourceVersionInput>(
    "create-resource-version",
  );
}

export function useRestoreResourceVersion() {
  return useActionMutation<
    RestoreResourceVersionResult,
    RestoreResourceVersionInput
  >("restore-resource-version");
}
