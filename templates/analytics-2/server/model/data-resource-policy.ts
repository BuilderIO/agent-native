import type {
  DataResourceRef,
  DataResourceAiUsage,
} from "../../app/lib/model/data-resource-contracts.js";
import { resolveResourceAiUsage } from "./data-connection-policy.js";
import {
  readDataResourceMetadata,
  type MetadataStoreOptions,
} from "./data-resource-metadata.js";
import type { WorkspaceScope } from "./scope.js";

export function resourcePolicyPath(
  resource: DataResourceRef,
): readonly DataResourceRef[] {
  if (resource.kind === "table") {
    const parts = resource.id.split(":");
    if (
      (parts.length === 4 && parts[0] === "table") ||
      (parts.length === 5 && parts[0] === "pg-table")
    ) {
      return [
        { kind: "schema", id: `schema:${parts[1]}:${parts[2]}` },
        resource,
      ];
    }
  }
  return [resource];
}

/** Only authorized local annotations are consulted; this never probes a provider. */
export async function resourcePolicies(
  scope: WorkspaceScope,
  connectionId: string,
  resources: readonly DataResourceRef[],
  root: DataResourceAiUsage,
  options: MetadataStoreOptions = {},
): Promise<ReadonlyMap<string, DataResourceAiUsage>> {
  const refs = new Map<string, DataResourceRef>();
  for (const resource of resources)
    for (const ref of resourcePolicyPath(resource))
      refs.set(`${ref.kind}:${ref.id}`, ref);
  const stored = await readDataResourceMetadata(
    scope,
    connectionId,
    [...refs.values()],
    options,
  );
  const overrides = new Map(
    stored.resources.map((ref) => [`${ref.kind}:${ref.id}`, ref.aiUsage]),
  );
  return new Map(
    resources.map((resource) => {
      const usage = resourcePolicyPath(resource).reduce(
        (ancestor, ref) =>
          resolveResourceAiUsage(
            ancestor,
            overrides.get(`${ref.kind}:${ref.id}`),
          ),
        root,
      );
      return [`${resource.kind}:${resource.id}`, usage];
    }),
  );
}
