import type { ProviderApiRuntime } from "@agent-native/core/provider-api";

import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../../shared/bigquery-source-contract.js";
import {
  requireOrganizationBigQueryAuthority,
  withOrganizationBigQueryRequestContext,
} from "../lib/org-bigquery-credentials.js";
import { getAnalytics2OrganizationQueryProviderApiRuntime } from "../lib/provider-api.js";
import {
  isBuiltinSampleConnection,
  resolveNotebookWarehouseConnection,
} from "../model/data-connections.js";
import {
  digest,
  type ExecutionCell,
} from "../model/notebook-execution/planner.js";
import type { ExecutionActor } from "../model/notebook-execution/snapshot.js";

type SqlContents = Extract<ExecutionCell["contents"], { kind: "sql" }>;

export function sqlSource(contents: SqlContents) {
  if (contents.connectionMode === "dataframes")
    return { kind: "dataframes" } as const;
  const id = contents.dataConnectionId;
  if (!id || isBuiltinSampleConnection(id))
    return { kind: "sample", builtin: isBuiltinSampleConnection(id) } as const;
  return { kind: "warehouse", id } as const;
}

export async function withBigQuerySource<T>(
  id: string,
  actor: ExecutionActor,
  run: (source: BigQuerySource) => Promise<T>,
) {
  if (id === ORGANIZATION_BIGQUERY_SOURCE_ID) {
    const scope = { orgId: actor.orgId, userEmail: actor.ownerEmail };
    const { projectId, revision } =
      await requireOrganizationBigQueryAuthority(scope);
    return withOrganizationBigQueryRequestContext(scope, () =>
      run({
        projectId,
        location: "US",
        storage: null,
        runtime: getAnalytics2OrganizationQueryProviderApiRuntime(),
        generation: warehouseGeneration([id, projectId, revision]),
        normalizeSql: (query) => query.trim(),
        maximumBytesBilled: "50000000000",
      }),
    );
  }
  const connection = await resolveNotebookWarehouseConnection(id, actor.caller);
  return run({
    ...connection,
    generation: warehouseGeneration([
      id,
      connection.projectId,
      connection.location,
      connection.revision,
    ]),
  });
}

function warehouseGeneration(input: unknown) {
  return BigInt(`0x${digest(input)}`).toString();
}

export type BigQuerySource = Pick<
  Awaited<ReturnType<typeof resolveNotebookWarehouseConnection>>,
  "projectId" | "location" | "storage" | "defaultDatasetId"
> & {
  runtime: ProviderApiRuntime;
  generation: string;
  normalizeSql?: (query: string) => string;
  maximumBytesBilled?: string;
};
