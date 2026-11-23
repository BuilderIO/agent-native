import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  readDbtServiceToken,
  readOrganizationDbtConfig,
  requireDbtUserEmail,
  requireExactDbtRequestContext,
  sanitizeDbtConfiguration,
} from "../server/lib/org-bigquery-dbt.js";
import {
  dbtTableMetadataSchema,
  readDbtTableMetadataWithToken,
  type TableIdentity,
} from "../server/lib/warehouse-dbt.js";
import { requireSemanticOrg } from "./_semantic-helpers.js";
import discoverBigQueryTableSchema from "./discover-bigquery-table-schema.js";

/**
 * Reads one table's dbt metadata using the workspace's registered dbt Service
 * token. The BigQuery table identity is the schema-discovery action's verified
 * answer, not the caller's string: a table the caller cannot read from
 * BigQuery is refused before dbt is asked anything.
 */
export default defineAction({
  description:
    "Return dbt model or source metadata, including columns, freshness, tests and parent nodes, for one project-qualified BigQuery table the active workspace can read. Any active workspace member who can read the table can read its dbt metadata; the table permission is checked by BigQuery schema discovery. No table rows are read and no dbt token is returned.",
  schema: z.object({
    tableReference: z
      .string()
      .trim()
      .min(1)
      .max(2200)
      .describe(
        "Exact project.dataset.table reference returned by BigQuery table discovery. The project must match the active organization BigQuery project.",
      ),
  }),
  http: { method: "GET" },
  // Strict: the verified identity and the provider's reviewed metadata shape
  // (parents included). No token field exists in this result.
  outputSchema: z
    .object({
      dbtEnabled: z.boolean(),
      dbtRevision: z.number().int().min(0).nullable(),
      tableIdentity: z
        .object({
          projectId: z.string().min(1),
          datasetId: z.string().min(1),
          tableId: z.string().min(1),
        })
        .strict()
        .nullable(),
      metadata: dbtTableMetadataSchema.nullable(),
    })
    .strict(),
  readOnly: true,
  planMode: { effect: "read" },
  audit: {
    recordInputs: false,
    summary: () => "Read bounded dbt table metadata.",
  },
  run: async ({ tableReference }, ctx) => {
    const orgId = await requireSemanticOrg();
    const userEmail = requireDbtUserEmail();
    const active = requireExactDbtRequestContext({ orgId, userEmail });
    // The nonsecret configuration comes first: a disabled or absent dbt
    // integration answers without reading the token or calling a provider.
    const before = await readOrganizationDbtConfig(active.orgId);
    if (before.status === "absent" || !before.config.hasDbtMetadata)
      return {
        dbtEnabled: false,
        dbtRevision: before.status === "absent" ? null : before.revision,
        tableIdentity: null,
        metadata: null,
      };

    // BigQuery schema discovery runs before dbt: it is the caller's table
    // permission check and it returns the identity dbt is asked about.
    // Discovery needs an explicit page request: without `columnOffset` it
    // refuses any table wider than one page. Only its verified identity is used.
    const discovered = await discoverBigQueryTableSchema.run(
      { tableReference, columnOffset: 0 },
      ctx,
    );
    const identity: TableIdentity = {
      projectId: discovered.projectId,
      datasetId: discovered.datasetId,
      tableId: discovered.tableName,
    };

    const token = await readDbtServiceToken(active.orgId);
    let metadata: Awaited<ReturnType<typeof readDbtTableMetadataWithToken>>;
    try {
      metadata = await readDbtTableMetadataWithToken(
        sanitizeDbtConfiguration(before.config),
        token,
        identity,
      );
    } catch (error) {
      if (error && typeof error === "object" && "errorCode" in error)
        throw error;
      return fail(
        "The dbt metadata could not be read. Check the dbt settings and try again.",
        { errorCode: "dbt_metadata_unavailable", statusCode: 503 },
      );
    }

    // A save that landed while dbt was answering could have changed the
    // project, environment or version under this read.
    const after = await readOrganizationDbtConfig(active.orgId);
    const afterRevision = after.status === "absent" ? null : after.revision;
    if (afterRevision !== before.revision || after.status === "absent")
      return fail(
        "The dbt settings changed while this table was being read. Reload the table metadata.",
        { errorCode: "dbt_configuration_stale", statusCode: 409 },
      );

    return {
      dbtEnabled: true,
      dbtRevision: before.revision,
      tableIdentity: identity,
      metadata,
    };
  },
});
